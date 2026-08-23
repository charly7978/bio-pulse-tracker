import { useEffect, useRef, useState } from 'react';
import {
  Heart, Activity, ShieldCheck, Zap, Camera, CameraOff,
  FileText, Download, CheckCircle2, X, Fingerprint, Waves, Palette,
} from 'lucide-react';
import { TelemetryCanvasEngine, ColorTheme } from '../modules/visualization';
import { useCameraPulseMonitor } from '../hooks/useCameraPulseMonitor';
import { ClinicalReportGenerator } from '../modules/clinical-report';

function revokeAfterDelay(url: string, ms = 2500) {
  window.setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }, ms);
}

export function CardiacTelemetryMonitor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const engineRef = useRef<TelemetryCanvasEngine | null>(null);

  const [showReportModal, setShowReportModal] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>('EMERALD');
  const [showDerivatives, setShowDerivatives] = useState(false);

  const {
    isMonitoring,
    sessionDurationSec,
    isSessionComplete,
    lastReport,
    cameraState,
    clinicalVitals,
    startMonitoring,
    stopMonitoring,
    toggleTorch,
    generateReport,
    registerCanvasEngine,
  } = useCameraPulseMonitor();

  /* ─── Canvas engine lifecycle — DPR-correct + ResizeObserver — motor estable (no se recrea al cambiar tema) ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Inicializar con DPR fresco — tema/derivadas se sincronizan en efecto separado para no destruir historial PPG
    const initDpr = window.devicePixelRatio || 1;
    const initRect = canvas.getBoundingClientRect();
    const initW = Math.max(320, Math.floor(initRect.width) || 600);
    const initH = Math.max(180, Math.floor(initRect.height) || 300);

    canvas.width = Math.round(initW * initDpr);
    canvas.height = Math.round(initH * initDpr);

    const engine = new TelemetryCanvasEngine({
      width: initW,
      height: initH,
      dpr: initDpr,
      colorTheme,
      showDerivatives,
    });
    engineRef.current = engine;
    registerCanvasEngine(engine);

    let isRunning = true;
    const renderLoop = () => {
      if (!isRunning) return;
      engine.render(ctx);
      animFrameRef.current = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    const applyResize = () => {
      if (!canvas) return;
      const dprNow = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(r.width));
      const h = Math.max(180, Math.floor(r.height));
      // Solo redimensionar si cambió de forma significativa (±2px) para evitar thrashing
      if (Math.abs(canvas.width - w * dprNow) > 2 || Math.abs(canvas.height - h * dprNow) > 2) {
        canvas.width = Math.round(w * dprNow);
        canvas.height = Math.round(h * dprNow);
        engine.resize(w, h, dprNow);
      }
    };

    // ResizeObserver es más preciso que window resize para el contenedor flexible
    let ro: ResizeObserver | null = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => applyResize());
      ro.observe(canvas);
      // También observar el contenedor padre (waveform-container) por si cambia por layout
      if (canvas.parentElement) ro.observe(canvas.parentElement);
    }
    const handleWindowResize = () => applyResize();
    window.addEventListener('resize', handleWindowResize);
    // DPR puede cambiar al hacer zoom; escuchar media query si está disponible
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      // @ts-ignore deprecated addListener fallback
      if (mql && 'addEventListener' in mql) mql.addEventListener('change', applyResize);
      else if (mql && 'addListener' in mql) (mql as unknown as { addListener: (cb: () => void) => void }).addListener(applyResize);
    } catch { /* ignore */ }

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (mql) {
        try {
          // @ts-ignore
          if ('removeEventListener' in mql) mql.removeEventListener('change', applyResize);
          // @ts-ignore
          else if ('removeListener' in mql) (mql as unknown as { removeListener: (cb: () => void) => void }).removeListener(applyResize);
        } catch { /* ignore */ }
      }
    };
  }, [registerCanvasEngine]);

  // Sincronización de tema y derivadas sin destruir buffer PPG (no recrea motor)
  useEffect(() => {
    if (engineRef.current) engineRef.current.setColorTheme(colorTheme);
  }, [colorTheme]);
  useEffect(() => {
    if (engineRef.current) engineRef.current.setShowDerivatives(showDerivatives);
  }, [showDerivatives]);

  /* ─── Handlers ─── */
  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      stopMonitoring();
    } else if (videoRef.current) {
      void startMonitoring(videoRef.current);
    }
  };

  const handleCycleTheme = () => {
    const themes: ColorTheme[] = ['EMERALD', 'RUBY', 'COBALT'];
    const nextIdx = (themes.indexOf(colorTheme) + 1) % themes.length;
    const nextTheme = themes[nextIdx]!;
    setColorTheme(nextTheme);
    if (engineRef.current) {
      engineRef.current.setColorTheme(nextTheme);
    }
  };

  const handleToggleDerivatives = () => {
    if (engineRef.current) {
      const nextState = engineRef.current.toggleDerivatives();
      setShowDerivatives(nextState);
    }
  };

  const handleOpenReport = () => {
    generateReport();
    setShowReportModal(true);
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    revokeAfterDelay(url, 10000);
  };

  const handleDownloadCsv = () => {
    const report = lastReport ?? generateReport();
    const csvContent = ClinicalReportGenerator.generateCsv(report);
    triggerDownload(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `Reporte_${report.sessionId}.csv`);
  };

  const handleDownloadMd = () => {
    const report = lastReport ?? generateReport();
    const mdContent = ClinicalReportGenerator.generateMarkdown(report);
    triggerDownload(new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' }), `Reporte_${report.sessionId}.md`);
  };

  /* ─── Derived state ─── */
  const sessionProgress = Math.min(100, Math.round((sessionDurationSec / 30) * 100));
  const isStable = clinicalVitals.contactState === 'STABLE_CONTACT';
  const isUnstable = clinicalVitals.contactState === 'UNSTABLE_CONTACT';

  const contactDotClass = isStable
    ? 'contact-dot contact-dot--stable'
    : isUnstable
      ? 'contact-dot contact-dot--unstable'
      : 'contact-dot contact-dot--none';

  const contactLabel = isStable
    ? 'SANGRE VIVA'
    : isUnstable
      ? 'VALIDANDO…'
      : 'SIN CONTACTO';

  const paText = isStable && clinicalVitals.estimatedSystolic > 0 && clinicalVitals.estimatedDiastolic > 0
    ? `${clinicalVitals.estimatedSystolic}/${clinicalVitals.estimatedDiastolic}`
    : '—/—';

  const spo2Text = isStable && clinicalVitals.spo2 > 0 ? String(clinicalVitals.spo2) : '—';
  const hrvText = isStable && clinicalVitals.rmssd > 0 ? String(Math.round(clinicalVitals.rmssd)) : '—';
  const bpmText = isStable && clinicalVitals.bpm > 0 ? String(clinicalVitals.bpm) : '—';

  return (
    <>
      {/* ═══ Capa 0: Previsualización de cámara en vivo ═══ */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        controls={false}
        className="camera-bg"
        style={{ opacity: isMonitoring ? 0.58 : 0 }}
        aria-hidden="true"
      />
      {/* Vignette para enmarcar la previsualización */}
      <div className="camera-vignette" style={{ opacity: isMonitoring ? 1 : 0 }} aria-hidden="true" />

      {/* ═══ Capa 1: Interfaz plana superpuesta ═══ */}
      <div className="monitor-overlay" role="main" aria-label="Monitor cardíaco Bio-Pulse">

        {/* ── Barra de Estado ── */}
        <div className="status-bar" role="status" aria-live="polite">
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent-heart)', fontWeight: 800 }}>
            <Heart size={10} className={clinicalVitals.bpm > 0 ? 'animate-pulse' : ''} aria-hidden="true" />
            BIO-PULSE TRACKER
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMonitoring ? (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className={contactDotClass} aria-hidden="true" />
                  <span aria-label={`Estado de contacto: ${contactLabel}`}>{contactLabel}</span>
                </span>
                <span aria-label={`FPS ${cameraState.fps}`}>{cameraState.fps} FPS</span>
                <span aria-label={`Resolución ${cameraState.resolution.width} por ${cameraState.resolution.height}`}>{cameraState.resolution.width}×{cameraState.resolution.height}</span>
              </>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>STANDBY</span>
            )}
          </span>
        </div>

        {/* ── Barra de progreso de sesión ── */}
        {isMonitoring && (
          <div className="session-progress" role="progressbar" aria-valuenow={sessionProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de sesión">
            <div
              className="session-progress-fill"
              style={{
                width: `${sessionProgress}%`,
                background: isSessionComplete
                  ? 'linear-gradient(90deg, #30d158, #34d399)'
                  : 'linear-gradient(90deg, #ff375f, #ff6482)',
              }}
            />
          </div>
        )}

        {/* ── HUD de Signos Vitales ── */}
        <div className="vitals-hud" aria-label="Signos vitales">
          {/* BPM */}
          <div className="vital-card" role="group" aria-label={`Frecuencia cardíaca ${bpmText} latidos por minuto`}>
            <div className="vital-label" style={{ color: 'var(--accent-heart)' }}>
              <Heart size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} aria-hidden="true" />
              BPM
            </div>
            <div className="vital-value" aria-live="polite">{bpmText}</div>
            <div className="vital-unit">LPM</div>
          </div>

          {/* SpO₂ */}
          <div className="vital-card" role="group" aria-label={`Saturación de oxígeno ${spo2Text} por ciento`}>
            <div className="vital-label" style={{ color: 'var(--accent-spo2)' }}>
              <Activity size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} aria-hidden="true" />
              SpO₂
            </div>
            <div className="vital-value" aria-live="polite">{spo2Text}</div>
            <div className="vital-unit">%</div>
          </div>

          {/* HRV */}
          <div className="vital-card" role="group" aria-label={`HRV ${hrvText} milisegundos`}>
            <div className="vital-label" style={{ color: 'var(--accent-hrv)' }}>HRV</div>
            <div className="vital-value" aria-live="polite">{hrvText}</div>
            <div className="vital-unit">ms</div>
          </div>

          {/* Presión arterial */}
          <div className="vital-card" role="group" aria-label={`Presión arterial ${paText} milímetros de mercurio`}>
            <div className="vital-label" style={{ color: 'var(--accent-bp)' }}>
              <ShieldCheck size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} aria-hidden="true" />
              PA
            </div>
            <div className="vital-value" style={{ fontSize: '1.05rem' }} aria-live="polite">
              {paText}
            </div>
            <div className="vital-unit">mmHg</div>
          </div>
        </div>

        {/* ── Banner de Ritmo Cardíaco ── */}
        {isStable && (
          <div className="rhythm-banner" role="status" aria-live="polite">
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700,
              color: clinicalVitals.arrhythmia.primaryRhythm === 'NORMAL_SINUS' ? 'var(--accent-ok)' : 'var(--accent-warn)',
            }}>
              <CheckCircle2 size={12} aria-hidden="true" />
              {clinicalVitals.arrhythmia.clinicalSummary}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.60rem', fontWeight: 500 }}>
              Estrés {clinicalVitals.stressIndex > 0 ? clinicalVitals.stressIndex.toFixed(1) : '—'} · {clinicalVitals.crestTimeMs > 0 ? `Crest ${clinicalVitals.crestTimeMs} ms` : 'Notch Dícroto Activo'}
            </span>
          </div>
        )}

        {/* ── Visor CRT plano — Osciloscopio médico ── */}
        <div className="waveform-container" role="img" aria-label="Trazado fotopletismográfico en tiempo real">
          <canvas ref={canvasRef} className="waveform-canvas" aria-hidden="true" />
          <div className="crt-scanlines" aria-hidden="true" />

          {/* Guía de uso cuando no está monitoreando */}
          {!isMonitoring && (
            <div className="no-contact-guide" aria-hidden="true">
              <div className="guide-icon-ring">
                <Fingerprint size={30} style={{ color: 'var(--accent-heart)', opacity: 0.85 }} />
              </div>
              <p style={{
                color: 'rgba(255,255,255,0.58)',
                fontSize: '0.84rem',
                fontWeight: 500,
                textAlign: 'center',
                maxWidth: 300,
                lineHeight: 1.45,
              }}>
                Cubre la cámara y el flash con tu dedo índice.{' '}
                <span style={{ color: 'var(--accent-heart)', fontWeight: 700 }}>Presiona INICIAR</span>.
              </p>
              <p style={{ color: 'rgba(255,255,255,0.30)', fontSize: '0.70rem', marginTop: 2 }}>Presión suave · sin mover · luz tenue</p>
            </div>
          )}
        </div>

        {/* ── Error de cámara ── */}
        {cameraState.error && (
          <div className="error-banner" role="alert">⚠ {cameraState.error}</div>
        )}

        {/* ── Barra de Controles ── */}
        <div className="controls-bar" role="toolbar" aria-label="Controles del monitor">
          <div>
            {cameraState.hasTorch && (
              <button className="btn-secondary" onClick={toggleTorch} aria-pressed={cameraState.isTorchOn} aria-label={cameraState.isTorchOn ? 'Apagar linterna' : 'Encender linterna'}>
                <Zap size={13} style={{ color: cameraState.isTorchOn ? 'var(--accent-bp)' : undefined }} aria-hidden="true" />
                {cameraState.isTorchOn ? 'ON' : 'OFF'}
              </button>
            )}

            <button className="btn-secondary" onClick={handleCycleTheme} title="Cambiar tema cromático" aria-label={`Tema actual ${colorTheme}, cambiar`}>
              <Palette size={13} aria-hidden="true" /> {colorTheme}
            </button>

            <button
              className="btn-secondary"
              onClick={handleToggleDerivatives}
              style={{ color: showDerivatives ? 'var(--accent-signal)' : undefined }}
              aria-pressed={showDerivatives}
              title="Mostrar aceleración de pulso APG (d²PPG/dt²)"
            >
              <Waves size={13} aria-hidden="true" /> APG
            </button>

            {(isSessionComplete || sessionDurationSec >= 10) && (
              <button className="btn-secondary" onClick={handleOpenReport}
                style={{ color: 'var(--accent-signal)' }} aria-label="Abrir informe clínico">
                <FileText size={13} aria-hidden="true" /> Informe
              </button>
            )}
          </div>

          <button
            className="btn-monitor"
            onClick={handleToggleMonitoring}
            aria-label={isMonitoring ? 'Detener monitoreo' : 'Iniciar monitoreo'}
            style={{
              background: isMonitoring
                ? 'linear-gradient(135deg, #9f1239, #e11d48)'
                : 'linear-gradient(135deg, #e11d48, #ff375f)',
              color: '#fff',
              boxShadow: isMonitoring
                ? '0 4px 24px rgba(159, 18, 57, 0.45)'
                : '0 4px 24px rgba(255, 55, 95, 0.35)',
            }}
          >
            {isMonitoring
              ? <><CameraOff size={16} aria-hidden="true" /> DETENER</>
              : <><Camera size={16} aria-hidden="true" /> INICIAR</>
            }
          </button>
        </div>
      </div>

      {/* ═══ Modal de Reporte Clínico ═══ */}
      {showReportModal && lastReport && (
        <div className="report-overlay" onClick={() => setShowReportModal(false)} role="dialog" aria-modal="true" aria-label="Informe clínico">
          <div className="report-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Informe Clínico
              </h2>
              <button onClick={() => setShowReportModal(false)} aria-label="Cerrar informe"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: 4 }}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div style={{
              background: 'rgba(255,255,255,0.03)',
              padding: 12, borderRadius: 12,
              marginBottom: 12,
              border: '1px solid rgba(255,255,255,0.05)',
              fontSize: '0.78rem', color: 'rgba(255,255,255,0.68)', lineHeight: 1.6,
            }}>
              <p><strong style={{ color: '#fff' }}>ID:</strong> {lastReport.sessionId}</p>
              <p>
                <strong style={{ color: '#fff' }}>Duración:</strong> {lastReport.durationSeconds}s ·{' '}
                <strong style={{ color: '#fff' }}>Ritmo:</strong>{' '}
                <span style={{ color: 'var(--accent-ok)' }}>{lastReport.arrhythmia.primaryRhythm}</span>
              </p>
              <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: '0.70rem', marginTop: 4 }}>SQI {(lastReport.signalQualityIndex * 100).toFixed(0)}% · {new Date(lastReport.timestampIso).toLocaleString('es-ES')}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <MetricCard
                label="Frecuencia" color="var(--accent-heart)"
                value={`${lastReport.averageBpm || '—'}`} unit="LPM"
                detail={`${lastReport.minBpm || '—'}–${lastReport.maxBpm || '—'} LPM`}
              />
              <MetricCard
                label="SpO₂" color="var(--accent-spo2)"
                value={`${lastReport.spo2.spo2Percent || '—'}%`} unit=""
                detail={`PA: ${lastReport.pwa.estimatedSystolicMmHg || '—'}/${lastReport.pwa.estimatedDiastolicMmHg || '—'}`}
              />
              <MetricCard
                label="HRV" color="var(--accent-hrv)"
                value={`${lastReport.hrv.rmssdMs || '—'}`} unit="ms"
                detail={`SDNN: ${lastReport.hrv.sdnnMs || '—'}ms · pNN50: ${(lastReport.hrv.pnn50Ratio * 100).toFixed(0)}%`}
              />
              <MetricCard
                label="Arritmias" color="var(--accent-bp)"
                value={`${lastReport.arrhythmia.sampleEntropy ?? 0}`} unit="SampEn"
                detail={`PVC: ${lastReport.arrhythmia.pvcCount} · PAC: ${lastReport.arrhythmia.pacCount}`}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={handleDownloadCsv} aria-label="Descargar CSV">
                <Download size={12} aria-hidden="true" /> CSV
              </button>
              <button className="btn-monitor" onClick={handleDownloadMd} aria-label="Descargar informe Markdown"
                style={{ background: 'var(--accent-heart)', color: '#fff', padding: '9px 18px', fontSize: '0.78rem' }}>
                <Download size={12} aria-hidden="true" /> Informe MD
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Sub-componente: Tarjeta de Métrica del Reporte ─── */
function MetricCard({ label, color, value, unit, detail }: {
  label: string;
  color: string;
  value: string;
  unit: string;
  detail: string;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      padding: 10,
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.04)',
    }}>
      <p style={{ color, fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ fontSize: '1.15rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: 2 }}>
        {value} <span style={{ fontSize: '0.60rem', color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>{unit}</span>
      </p>
      <p style={{ fontSize: '0.60rem', color: 'rgba(255,255,255,0.30)', marginTop: 2 }}>{detail}</p>
    </div>
  );
}
