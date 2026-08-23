import { useEffect, useRef, useState } from 'react';
import {
  Heart, Activity, ShieldCheck, Zap, Camera, CameraOff,
  FileText, Download, CheckCircle2, X, Fingerprint, Waves, Palette,
} from 'lucide-react';
import { TelemetryCanvasEngine, ColorTheme } from '../modules/visualization';
import { useCameraPulseMonitor } from '../hooks/useCameraPulseMonitor';
import { ClinicalReportGenerator } from '../modules/clinical-report';

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

  /* ─── Canvas engine lifecycle ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 600;
    const height = rect.height || 300;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const engine = new TelemetryCanvasEngine({
      width,
      height,
      dpr,
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

    const handleResize = () => {
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      engine.resize(r.width, r.height, dpr);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [registerCanvasEngine]);

  /* ─── Handlers ─── */
  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      stopMonitoring();
    } else if (videoRef.current) {
      startMonitoring(videoRef.current);
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

  const handleDownloadCsv = () => {
    const report = lastReport || generateReport();
    const csvContent = ClinicalReportGenerator.generateCsv(report);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Reporte_${report.sessionId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadMd = () => {
    const report = lastReport || generateReport();
    const mdContent = ClinicalReportGenerator.generateMarkdown(report);
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Reporte_${report.sessionId}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        style={{ opacity: isMonitoring ? 0.80 : 0 }}
      />
      {/* Vignette para enmarcar la previsualización */}
      <div className="camera-vignette" style={{ opacity: isMonitoring ? 1 : 0 }} />

      {/* ═══ Capa 1: Interfaz Spatial superpuesta ═══ */}
      <div className="monitor-overlay">

        {/* ── Barra de Estado ── */}
        <div className="status-bar">
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent-heart)', fontWeight: 800 }}>
            <Heart size={10} className={clinicalVitals.bpm > 0 ? 'animate-pulse' : ''} />
            BIO-PULSE TRACKER
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMonitoring ? (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className={contactDotClass} />
                  {contactLabel}
                </span>
                <span>{cameraState.fps} FPS</span>
                <span>{cameraState.resolution.width}×{cameraState.resolution.height}</span>
              </>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.25)' }}>STANDBY</span>
            )}
          </span>
        </div>

        {/* ── Barra de progreso de sesión ── */}
        {isMonitoring && (
          <div className="session-progress">
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

        {/* ── HUD de Signos Vitales (Spatial Glass Cards) ── */}
        <div className="vitals-hud">
          {/* BPM */}
          <div className="vital-card">
            <div className="vital-label" style={{ color: 'var(--accent-heart)' }}>
              <Heart size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              BPM
            </div>
            <div className="vital-value">
              {isStable && clinicalVitals.bpm > 0 ? clinicalVitals.bpm : '—'}
            </div>
            <div className="vital-unit">LPM</div>
          </div>

          {/* SpO₂ */}
          <div className="vital-card">
            <div className="vital-label" style={{ color: 'var(--accent-spo2)' }}>
              <Activity size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              SpO₂
            </div>
            <div className="vital-value">
              {isStable ? clinicalVitals.spo2 : '—'}
            </div>
            <div className="vital-unit">%</div>
          </div>

          {/* HRV */}
          <div className="vital-card">
            <div className="vital-label" style={{ color: 'var(--accent-hrv)' }}>HRV</div>
            <div className="vital-value">
              {isStable && clinicalVitals.rmssd > 0 ? Math.round(clinicalVitals.rmssd) : '—'}
            </div>
            <div className="vital-unit">ms</div>
          </div>

          {/* Presión arterial */}
          <div className="vital-card">
            <div className="vital-label" style={{ color: 'var(--accent-bp)' }}>
              <ShieldCheck size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              PA
            </div>
            <div className="vital-value" style={{ fontSize: '1.05rem' }}>
              {isStable
                ? `${clinicalVitals.estimatedSystolic}/${clinicalVitals.estimatedDiastolic}`
                : '—/—'}
            </div>
            <div className="vital-unit">mmHg</div>
          </div>
        </div>

        {/* ── Banner de Ritmo Cardíaco ── */}
        {isStable && (
          <div className="rhythm-banner">
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700,
              color: clinicalVitals.arrhythmia.primaryRhythm === 'NORMAL_SINUS' ? 'var(--accent-ok)' : 'var(--accent-warn)',
            }}>
              <CheckCircle2 size={12} />
              {clinicalVitals.arrhythmia.clinicalSummary}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.30)', fontSize: '0.60rem', fontWeight: 500 }}>
              Estrés {clinicalVitals.stressIndex.toFixed(1)} · Notch Dícroto Activo
            </span>
          </div>
        )}

        {/* ── Visor de Onda PPG (Spatial Glass Panel - Ocupa el 100% del espacio central) ── */}
        <div className="waveform-container">
          <canvas ref={canvasRef} className="waveform-canvas" />

          {/* Guía de uso cuando no está monitoreando */}
          {!isMonitoring && (
            <div className="no-contact-guide">
              <div className="guide-icon-ring">
                <Fingerprint size={32} style={{ color: 'var(--accent-heart)', opacity: 0.85 }} />
              </div>
              <p style={{
                color: 'rgba(255,255,255,0.50)',
                fontSize: '0.82rem',
                fontWeight: 500,
                textAlign: 'center',
                maxWidth: 260,
                lineHeight: 1.5,
              }}>
                Cubre la cámara y el flash con tu dedo índice.{' '}
                <span style={{ color: 'var(--accent-heart)', fontWeight: 700 }}>Presiona INICIAR</span>.
              </p>
            </div>
          )}
        </div>

        {/* ── Error de cámara ── */}
        {cameraState.error && (
          <div className="error-banner">⚠ {cameraState.error}</div>
        )}

        {/* ── Barra de Controles (Spatial Floating Pill) ── */}
        <div className="controls-bar">
          <div style={{ display: 'flex', gap: 6 }}>
            {cameraState.hasTorch && (
              <button className="btn-secondary" onClick={toggleTorch}>
                <Zap size={13} style={{ color: cameraState.isTorchOn ? 'var(--accent-bp)' : undefined }} />
                {cameraState.isTorchOn ? 'ON' : 'OFF'}
              </button>
            )}

            {/* Selector de paleta cromática */}
            <button className="btn-secondary" onClick={handleCycleTheme} title="Cambiar tema cromático">
              <Palette size={13} /> {colorTheme}
            </button>

            {/* Toggle de derivadas morfológicas APG/VPG */}
            <button
              className="btn-secondary"
              onClick={handleToggleDerivatives}
              style={{ color: showDerivatives ? 'var(--accent-signal)' : undefined }}
              title="Mostrar aceleración de pulso APG (d²PPG/dt²)"
            >
              <Waves size={13} /> APG
            </button>

            {(isSessionComplete || sessionDurationSec >= 10) && (
              <button className="btn-secondary" onClick={handleOpenReport}
                style={{ color: 'var(--accent-signal)' }}>
                <FileText size={13} /> Informe
              </button>
            )}
          </div>

          <button
            className="btn-monitor"
            onClick={handleToggleMonitoring}
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
              ? <><CameraOff size={16} /> DETENER</>
              : <><Camera size={16} /> INICIAR</>
            }
          </button>
        </div>
      </div>

      {/* ═══ Modal de Reporte Clínico (Spatial Sheet) ═══ */}
      {showReportModal && lastReport && (
        <div className="report-overlay" onClick={() => setShowReportModal(false)}>
          <div className="report-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Informe Clínico
              </h2>
              <button onClick={() => setShowReportModal(false)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Resumen de sesión */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              padding: 12, borderRadius: 12,
              marginBottom: 14,
              border: '0.5px solid rgba(255,255,255,0.05)',
              fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6,
            }}>
              <p><strong style={{ color: '#fff' }}>ID:</strong> {lastReport.sessionId}</p>
              <p>
                <strong style={{ color: '#fff' }}>Duración:</strong> {lastReport.durationSeconds}s ·{' '}
                <strong style={{ color: '#fff' }}>Ritmo:</strong>{' '}
                <span style={{ color: 'var(--accent-ok)' }}>{lastReport.arrhythmia.primaryRhythm}</span>
              </p>
            </div>

            {/* Grid de métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <MetricCard
                label="Frecuencia" color="var(--accent-heart)"
                value={`${lastReport.averageBpm}`} unit="LPM"
                detail={`${lastReport.minBpm}–${lastReport.maxBpm} LPM`}
              />
              <MetricCard
                label="SpO₂" color="var(--accent-spo2)"
                value={`${lastReport.spo2.spo2Percent}%`} unit=""
                detail={`PA: ${lastReport.pwa.estimatedSystolicMmHg}/${lastReport.pwa.estimatedDiastolicMmHg}`}
              />
              <MetricCard
                label="HRV" color="var(--accent-hrv)"
                value={`${lastReport.hrv.rmssdMs}`} unit="ms"
                detail={`SDNN: ${lastReport.hrv.sdnnMs}ms · pNN50: ${(lastReport.hrv.pnn50Ratio * 100).toFixed(0)}%`}
              />
              <MetricCard
                label="Arritmias" color="var(--accent-bp)"
                value={`${lastReport.arrhythmia.sampleEntropy}`} unit="SampEn"
                detail={`PVC: ${lastReport.arrhythmia.pvcCount} · PAC: ${lastReport.arrhythmia.pacCount}`}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn-secondary" onClick={handleDownloadCsv}>
                <Download size={12} /> CSV
              </button>
              <button className="btn-monitor" onClick={handleDownloadMd}
                style={{ background: 'var(--accent-heart)', color: '#fff', padding: '9px 18px', fontSize: '0.78rem' }}>
                <Download size={12} /> Informe MD
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
      border: '0.5px solid rgba(255,255,255,0.04)',
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
