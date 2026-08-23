import { useEffect, useRef } from 'react';
import { Heart, Activity, ShieldCheck, Zap, Camera, CameraOff, Sparkles, AlertCircle } from 'lucide-react';
import { TelemetryCanvasEngine } from '../modules/visualization';
import { useCameraPulseMonitor } from '../hooks/useCameraPulseMonitor';

export interface CardiacTelemetryMonitorProps {
  className?: string;
}

export function CardiacTelemetryMonitor({ className = '' }: CardiacTelemetryMonitorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const {
    isMonitoring,
    cameraState,
    clinicalVitals,
    startMonitoring,
    stopMonitoring,
    toggleTorch,
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
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.6rem' }}>
            {clinicalVitals.contactState === 'STABLE_CONTACT' ? (
              <span style={{ color: '#4ade80' }}>TEJIDO ACTIVO</span>
            ) : clinicalVitals.contactState === 'UNSTABLE_CONTACT' ? (
              <span style={{ color: '#f59e0b' }}>AJUSTANDO DEDO</span>
            ) : (
              <span style={{ color: '#94a3b8' }}>COLOCA EL DEDO</span>
            )}
          </div>
        </div>
      </div>

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
      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {isMonitoring && (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#4ade80' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                Sensor en Vivo ({cameraState.fps} FPS)
              </span>
              <span>{cameraState.resolution.width}x{cameraState.resolution.height}</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {cameraState.hasTorch && (
            <button
              onClick={toggleTorch}
              style={{
                background: cameraState.isTorchOn ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                color: cameraState.isTorchOn ? '#fbbf24' : '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '0.5rem 0.9rem',
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
    </div>
  );
}
