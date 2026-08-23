import { useEffect, useRef, useState } from 'react';
import { Heart, Activity, ShieldCheck, Zap, Camera, CameraOff, FileText, Download, CheckCircle2, X } from 'lucide-react';
import { TelemetryCanvasEngine } from '../modules/visualization';
import { useCameraPulseMonitor } from '../hooks/useCameraPulseMonitor';
import { ClinicalReportGenerator } from '../modules/clinical-report';

export function CardiacTelemetryMonitor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 600;
    const height = rect.height || 300;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const engine = new TelemetryCanvasEngine({ width, height, dpr });
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

  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      stopMonitoring();
    } else if (videoRef.current) {
      startMonitoring(videoRef.current);
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

  const sessionProgress = Math.min(100, Math.round((sessionDurationSec / 30) * 100));
  const isStable = clinicalVitals.contactState === 'STABLE_CONTACT';
  const isUnstable = clinicalVitals.contactState === 'UNSTABLE_CONTACT';

  return (
    <>
      {/* Capa 0: Previsualización de cámara en vivo como fondo fullscreen con transparencia */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="camera-bg"
        style={{
          opacity: isMonitoring ? 0.45 : 0,
          transition: 'opacity 0.5s ease-in-out',
        }}
      />

      {/* Capa 1: Interfaz de Monitor Cardíaco en overlay */}
      <div className="monitor-overlay">

        {/* Barra de Estado Superior */}
        <div className="status-bar">
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f43f5e', fontWeight: 700 }}>
            <Heart size={11} className={clinicalVitals.bpm > 0 ? 'animate-pulse' : ''} />
            BIO-PULSE TRACKER
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isMonitoring && (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: isStable ? '#4ade80' : isUnstable ? '#f59e0b' : '#64748b',
                    display: 'inline-block',
                    boxShadow: isStable ? '0 0 6px #4ade80' : 'none',
                  }} />
                  {isStable ? 'SANGRE VIVA' : isUnstable ? 'VALIDANDO...' : 'SIN CONTACTO'}
                </span>
                <span>{cameraState.fps} FPS</span>
                <span>{cameraState.resolution.width}×{cameraState.resolution.height}</span>
              </>
            )}
            {!isMonitoring && <span style={{ color: '#475569' }}>SENSOR INACTIVO</span>}
          </span>
        </div>

        {/* Barra de Progreso de Sesión */}
        {isMonitoring && (
          <div className="session-progress">
            <div className="session-progress-fill" style={{
              width: `${sessionProgress}%`,
              background: isSessionComplete
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : 'linear-gradient(90deg, #f43f5e, #fb7185)',
            }} />
          </div>
        )}

        {/* HUD de Signos Vitales */}
        <div className="vitals-hud">
          <div className="vital-card">
            <div className="vital-label" style={{ color: '#f43f5e' }}>
              <Heart size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />BPM
            </div>
            <div className="vital-value">{isStable && clinicalVitals.bpm > 0 ? clinicalVitals.bpm : '--'}</div>
            <div className="vital-unit">LPM</div>
          </div>

          <div className="vital-card">
            <div className="vital-label" style={{ color: '#38bdf8' }}>
              <Activity size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />SpO₂
            </div>
            <div className="vital-value">{isStable ? `${clinicalVitals.spo2}` : '--'}</div>
            <div className="vital-unit">%</div>
          </div>

          <div className="vital-card">
            <div className="vital-label" style={{ color: '#a855f7' }}>HRV</div>
            <div className="vital-value">{isStable && clinicalVitals.rmssd > 0 ? clinicalVitals.rmssd : '--'}</div>
            <div className="vital-unit">ms RMSSD</div>
          </div>

          <div className="vital-card">
            <div className="vital-label" style={{ color: '#fbbf24' }}>
              <ShieldCheck size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />PRESIÓN
            </div>
            <div className="vital-value" style={{ fontSize: '1.0rem' }}>
              {isStable ? `${clinicalVitals.estimatedSystolic}/${clinicalVitals.estimatedDiastolic}` : '--/--'}
            </div>
            <div className="vital-unit">mmHg</div>
          </div>
        </div>

        {/* Banner de Ritmo y Arritmias */}
        {isStable && (
          <div className="rhythm-banner">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: clinicalVitals.arrhythmia.primaryRhythm === 'NORMAL_SINUS' ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
              <CheckCircle2 size={13} />
              {clinicalVitals.arrhythmia.clinicalSummary}
            </span>
            <span style={{ color: '#64748b', fontSize: '0.65rem' }}>
              Estrés: {clinicalVitals.stressIndex.toFixed(1)} | SQI: {Math.round((clinicalVitals.contactState === 'STABLE_CONTACT' ? 0.85 : 0) * 100)}%
            </span>
          </div>
        )}

        {/* Visor de Onda PPG - Ocupa todo el espacio central */}
        <div className="waveform-container">
          <canvas ref={canvasRef} className="waveform-canvas" />

          {/* Guía de uso cuando no está monitoreando */}
          {!isMonitoring && (
            <div className="no-contact-guide">
              <Camera size={40} style={{ color: '#f43f5e', opacity: 0.7 }} />
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500, textAlign: 'center', maxWidth: 280 }}>
                Cubre la cámara y el flash LED con la yema de tu dedo índice. Luego pulsa <strong style={{ color: '#f43f5e' }}>INICIAR</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Error de cámara */}
        {cameraState.error && (
          <div style={{
            padding: '6px 12px',
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            fontSize: '0.72rem',
            textAlign: 'center',
            flexShrink: 0,
          }}>
            ⚠ {cameraState.error}
          </div>
        )}

        {/* Barra de Controles Inferior */}
        <div className="controls-bar">
          <div style={{ display: 'flex', gap: 6 }}>
            {cameraState.hasTorch && (
              <button className="btn-secondary" onClick={toggleTorch}>
                <Zap size={12} /> {cameraState.isTorchOn ? 'LED ON' : 'LED OFF'}
              </button>
            )}
            {(isSessionComplete || sessionDurationSec >= 10) && (
              <button className="btn-secondary" onClick={handleOpenReport} style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.2)' }}>
                <FileText size={12} /> Informe
              </button>
            )}
          </div>

          <button
            className="btn-monitor"
            onClick={handleToggleMonitoring}
            style={{
              background: isMonitoring
                ? 'linear-gradient(135deg, #9f1239, #e11d48)'
                : 'linear-gradient(135deg, #e11d48, #f43f5e)',
              color: '#fff',
              boxShadow: isMonitoring
                ? '0 0 20px rgba(159, 18, 57, 0.5)'
                : '0 0 20px rgba(244, 63, 94, 0.4)',
            }}
          >
            {isMonitoring ? <><CameraOff size={16} /> DETENER</> : <><Camera size={16} /> INICIAR</>}
          </button>
        </div>
      </div>

      {/* Modal de Reporte Clínico */}
      {showReportModal && lastReport && (
        <div className="report-overlay" onClick={() => setShowReportModal(false)}>
          <div className="report-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Informe Clínico</h2>
              <button onClick={() => setShowReportModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.6 }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <p><strong>ID:</strong> {lastReport.sessionId}</p>
                <p><strong>Duración:</strong> {lastReport.durationSeconds}s | <strong>Ritmo:</strong> <span style={{ color: '#4ade80' }}>{lastReport.arrhythmia.primaryRhythm}</span></p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                  <p style={{ color: '#f43f5e', fontWeight: 600, fontSize: '0.7rem' }}>Frecuencia</p>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{lastReport.averageBpm} <span style={{ fontSize: '0.65rem', color: '#64748b' }}>LPM</span></p>
                  <p style={{ fontSize: '0.65rem', color: '#64748b' }}>Rango: {lastReport.minBpm}–{lastReport.maxBpm}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                  <p style={{ color: '#38bdf8', fontWeight: 600, fontSize: '0.7rem' }}>SpO₂</p>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{lastReport.spo2.spo2Percent}%</p>
                  <p style={{ fontSize: '0.65rem', color: '#64748b' }}>BP: {lastReport.pwa.estimatedSystolicMmHg}/{lastReport.pwa.estimatedDiastolicMmHg}</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                  <p style={{ color: '#a855f7', fontWeight: 600, fontSize: '0.7rem' }}>HRV</p>
                  <p style={{ fontSize: '1.0rem', fontWeight: 700 }}>{lastReport.hrv.rmssdMs} / {lastReport.hrv.sdnnMs} ms</p>
                  <p style={{ fontSize: '0.65rem', color: '#64748b' }}>pNN50: {(lastReport.hrv.pnn50Ratio * 100).toFixed(0)}%</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                  <p style={{ color: '#fbbf24', fontWeight: 600, fontSize: '0.7rem' }}>Arritmias</p>
                  <p style={{ fontSize: '1.0rem', fontWeight: 700 }}>SampEn: {lastReport.arrhythmia.sampleEntropy}</p>
                  <p style={{ fontSize: '0.65rem', color: '#64748b' }}>PVC: {lastReport.arrhythmia.pvcCount} | PAC: {lastReport.arrhythmia.pacCount}</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn-secondary" onClick={handleDownloadCsv}>
                <Download size={12} /> CSV
              </button>
              <button
                className="btn-monitor"
                onClick={handleDownloadMd}
                style={{ background: '#f43f5e', color: '#fff', padding: '8px 16px', fontSize: '0.78rem' }}
              >
                <Download size={12} /> Informe MD
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
