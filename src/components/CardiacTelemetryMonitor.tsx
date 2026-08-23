import { useEffect, useRef, useState } from 'react';
import { Heart, Activity, ShieldCheck, Zap, Camera, CameraOff, Sparkles, AlertCircle, FileText, Download, CheckCircle2 } from 'lucide-react';
import { TelemetryCanvasEngine } from '../modules/visualization';
import { useCameraPulseMonitor } from '../hooks/useCameraPulseMonitor';
import { ClinicalReportGenerator } from '../modules/clinical-report';

export interface CardiacTelemetryMonitorProps {
  className?: string;
}

export function CardiacTelemetryMonitor({ className = '' }: CardiacTelemetryMonitorProps) {
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
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 260;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const engine = new TelemetryCanvasEngine({
      width,
      height,
      dpr,
    });

    registerCanvasEngine(engine);

    // Bucle de renderizado continuo a 60 FPS
    let isRunning = true;
    const renderLoop = () => {
      if (!isRunning) return;
      engine.render(ctx);
      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    const handleResize = () => {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      engine.resize(w, h, dpr);
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
    } else {
      if (videoRef.current) {
        startMonitoring(videoRef.current);
      }
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
    link.setAttribute('download', `Reporte_Cardiovascular_${report.sessionId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadMarkdown = () => {
    const report = lastReport || generateReport();
    const mdContent = ClinicalReportGenerator.generateMarkdown(report);
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Reporte_Cardiovascular_${report.sessionId}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sessionProgress = Math.min(100, Math.round((sessionDurationSec / 30) * 100));

  return (
    <div className={`glass-panel ${className}`} style={{ padding: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      {/* Video Element oculto para captura del sensor */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: 'none' }}
      />

      {/* Alerta de error de cámara si ocurre */}
      {cameraState.error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem',
          marginBottom: '1rem',
          borderRadius: '0.5rem',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#f87171',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={16} /> Error de cámara: {cameraState.error}
        </div>
      )}

      {/* Barra de Progreso de Sesión (30s de Calibración Fisiológica) */}
      {isMonitoring && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
            <span>Sesión Clínica: {sessionDurationSec}s / 30s</span>
            <span>{sessionProgress}% {isSessionComplete ? '(Sesión Completa)' : ''}</span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '9999px', overflow: 'hidden' }}>
            <div style={{
              width: `${sessionProgress}%`,
              height: '100%',
              background: isSessionComplete ? '#10b981' : '#f43f5e',
              transition: 'width 0.3s ease-out'
            }} />
          </div>
        </div>
      )}

      {/* HUD Superior de Telemetría Clínica en Vivo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#f43f5e', fontSize: '0.75rem', fontWeight: 600 }}>
            <Heart size={14} className={clinicalVitals.bpm > 0 ? 'animate-pulse' : ''} /> FRECUENCIA (BPM)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: '0.2rem' }}>
            {clinicalVitals.bpm > 0 ? clinicalVitals.bpm : '--'}{' '}
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>LPM</span>
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8', fontSize: '0.75rem', fontWeight: 600 }}>
            <Activity size={14} /> SATURACIÓN (SpO₂)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: '0.2rem' }}>
            {clinicalVitals.contactState === 'STABLE_CONTACT' ? `${clinicalVitals.spo2}%` : '--'}
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#a855f7', fontSize: '0.75rem', fontWeight: 600 }}>
            <Sparkles size={14} /> HRV (RMSSD)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: '0.2rem' }}>
            {clinicalVitals.rmssd > 0 ? clinicalVitals.rmssd : '--'}{' '}
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>ms</span>
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fbbf24', fontSize: '0.75rem', fontWeight: 600 }}>
            <ShieldCheck size={14} /> CONTACTO
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, marginTop: '0.6rem' }}>
            {clinicalVitals.contactState === 'STABLE_CONTACT' ? (
              <span style={{ color: '#4ade80' }}>SANGRE VIVA</span>
            ) : clinicalVitals.contactState === 'UNSTABLE_CONTACT' ? (
              <span style={{ color: '#f59e0b' }}>VALIDANDO PULSO...</span>
            ) : (
              <span style={{ color: '#94a3b8' }}>SIN SANGRE / INERTE</span>
            )}
          </div>
        </div>
      </div>

      {/* Banner de Diagnóstico de Ritmo y Arritmias */}
      {clinicalVitals.contactState === 'STABLE_CONTACT' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.9rem',
          marginBottom: '1rem',
          borderRadius: '0.5rem',
          background: clinicalVitals.arrhythmia.primaryRhythm === 'NORMAL_SINUS' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.15)',
          border: `1px solid ${clinicalVitals.arrhythmia.primaryRhythm === 'NORMAL_SINUS' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.35)'}`,
          fontSize: '0.82rem'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: clinicalVitals.arrhythmia.primaryRhythm === 'NORMAL_SINUS' ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
            <CheckCircle2 size={16} /> Ritmo: {clinicalVitals.arrhythmia.clinicalSummary}
          </span>
          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
            Presión Estimada: {clinicalVitals.estimatedSystolic}/{clinicalVitals.estimatedDiastolic} mmHg
          </span>
        </div>
      )}

      {/* Visor de Onda PPG en Tiempo Real */}
      <div style={{ position: 'relative', width: '100%', height: '240px', borderRadius: '0.75rem', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />

        {/* Guía en pantalla si no está monitoreando */}
        {!isMonitoring && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(3, 7, 18, 0.75)',
            backdropFilter: 'blur(4px)',
            gap: '0.75rem'
          }}>
            <Camera size={36} style={{ color: '#f43f5e' }} />
            <p style={{ color: '#cbd5e1', fontSize: '0.9rem', fontWeight: 500 }}>
              Cámara en espera. Pulsa INICIAR MONITOREO para capturar el pulso capilar.
            </p>
          </div>
        )}
      </div>

      {/* Barra de Controles en Vivo */}
      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {isMonitoring && (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#4ade80' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                Sensor 3A Bloqueado ({cameraState.fps} FPS)
              </span>
              <span>{cameraState.resolution.width}x{cameraState.resolution.height}</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(isSessionComplete || sessionDurationSec >= 10) && (
            <button
              onClick={handleOpenReport}
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '0.55rem 0.9rem',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <FileText size={14} /> Reporte Clínico
            </button>
          )}

          {cameraState.hasTorch && (
            <button
              onClick={toggleTorch}
              style={{
                background: cameraState.isTorchOn ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                color: cameraState.isTorchOn ? '#fbbf24' : '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '0.55rem 0.9rem',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <Zap size={14} /> Flash {cameraState.isTorchOn ? 'ON' : 'OFF'}
            </button>
          )}

          <button
            onClick={handleToggleMonitoring}
            style={{
              background: isMonitoring ? '#e11d48' : '#f43f5e',
              color: '#ffffff',
              border: 'none',
              padding: '0.55rem 1.25rem',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: isMonitoring ? '0 0 15px rgba(225, 29, 72, 0.4)' : '0 0 15px rgba(244, 63, 94, 0.3)'
            }}
          >
            {isMonitoring ? (
              <>
                <CameraOff size={16} /> DETENER MONITOREO
              </>
            ) : (
              <>
                <Camera size={16} /> INICIAR MONITOREO EN VIVO
              </>
            )}
          </button>
        </div>
      </div>

      {/* Modal de Reporte Clínico */}
      {showReportModal && lastReport && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(3, 7, 18, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', border: '1px solid rgba(255, 255, 255, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Informe Clínico de Medición</h2>
              <button
                onClick={() => setShowReportModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.6' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                <p><strong>ID:</strong> {lastReport.sessionId}</p>
                <p><strong>Duración:</strong> {lastReport.durationSeconds} segundos | <strong>Calidad (SQI):</strong> {(lastReport.signalQualityIndex * 100).toFixed(0)}%</p>
                <p><strong>Ritmo:</strong> <span style={{ color: '#4ade80' }}>{lastReport.arrhythmia.primaryRhythm}</span></p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                  <p style={{ color: '#f43f5e', fontWeight: 600 }}>Frecuencia Cardíaca</p>
                  <p style={{ fontSize: '1.25rem', fontWeight: 700 }}>{lastReport.averageBpm} LPM</p>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Rango: {lastReport.minBpm} - {lastReport.maxBpm} LPM</p>
                </div>
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                  <p style={{ color: '#38bdf8', fontWeight: 600 }}>Saturación SpO₂</p>
                  <p style={{ fontSize: '1.25rem', fontWeight: 700 }}>{lastReport.spo2.spo2Percent}%</p>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Presión: {lastReport.pwa.estimatedSystolicMmHg}/{lastReport.pwa.estimatedDiastolicMmHg} mmHg</p>
                </div>
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                  <p style={{ color: '#a855f7', fontWeight: 600 }}>HRV (RMSSD / SDNN)</p>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{lastReport.hrv.rmssdMs} ms / {lastReport.hrv.sdnnMs} ms</p>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>pNN50: {(lastReport.hrv.pnn50Ratio * 100).toFixed(0)}%</p>
                </div>
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                  <p style={{ color: '#fbbf24', fontWeight: 600 }}>Complejidad del Ritmo</p>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>SampEn: {lastReport.arrhythmia.sampleEntropy}</p>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PVC: {lastReport.arrhythmia.pvcCount} | PAC: {lastReport.arrhythmia.pacCount}</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                onClick={handleDownloadCsv}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  padding: '0.6rem 1rem',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <Download size={14} /> Exportar CSV
              </button>
              <button
                onClick={handleDownloadMarkdown}
                style={{
                  background: '#f43f5e',
                  color: '#fff',
                  border: 'none',
                  padding: '0.6rem 1.2rem',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <Download size={14} /> Descargar Informe (MD)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
