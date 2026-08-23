import { useEffect, useRef, useState } from 'react';
import { Heart, Activity, ShieldCheck, Zap } from 'lucide-react';
import { TelemetryCanvasEngine, TelemetryFrame } from '../modules/visualization';

export interface CardiacTelemetryMonitorProps {
  className?: string;
  onEngineReady?: (engine: TelemetryCanvasEngine) => void;
}

export function CardiacTelemetryMonitor({ className = '', onEngineReady }: CardiacTelemetryMonitorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<TelemetryCanvasEngine | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [hudMetrics, setHudMetrics] = useState({
    bpm: 0,
    sqi: 0,
    pi: 0,
    confidence: 0,
    contactState: 'NO_CONTACT' as TelemetryFrame['contactState'],
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 280;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const engine = new TelemetryCanvasEngine({
      width,
      height,
      dpr,
    });
    engineRef.current = engine;
    if (onEngineReady) onEngineReady(engine);

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
  }, [onEngineReady]);

  // Demo generator para verificar fluidez visual en desarrollo
  const simulateLivePulse = () => {
    const engine = engineRef.current;
    if (!engine) return;

    let t = 0;
    const interval = setInterval(() => {
      t += 0.033;
      const hrHz = 1.2; // 72 BPM
      const val = Math.sin(2 * Math.PI * hrHz * t) + 0.35 * Math.sin(4 * Math.PI * hrHz * t + 0.5);
      const isPeak = Math.sin(2 * Math.PI * hrHz * t) > 0.98;

      const frame: TelemetryFrame = {
        timestampMs: performance.now(),
        filteredValue: val,
        rawRed: 195,
        rawGreen: 42,
        rawBlue: 18,
        isPeak,
        sqi: 0.96,
        pi: 2.4,
        bpm: 72,
        confidence: 0.95,
        contactState: 'STABLE_CONTACT',
      };

      engine.pushFrame(frame);
      setHudMetrics({
        bpm: 72,
        sqi: 96,
        pi: 2.4,
        confidence: 95,
        contactState: 'STABLE_CONTACT',
      });
    }, 33);

    return () => clearInterval(interval);
  };

  return (
    <div className={`glass-panel ${className}`} style={{ padding: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      {/* HUD Superior de Telemetría Clínica */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#f43f5e', fontSize: '0.75rem', fontWeight: 600 }}>
            <Heart size={14} className={hudMetrics.bpm > 0 ? 'animate-pulse' : ''} /> FRECUENCIA
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: '0.2rem' }}>
            {hudMetrics.bpm > 0 ? hudMetrics.bpm : '--'}{' '}
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>BPM</span>
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8', fontSize: '0.75rem', fontWeight: 600 }}>
            <Activity size={14} /> PERFUSIÓN (PI)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: '0.2rem' }}>
            {hudMetrics.pi > 0 ? hudMetrics.pi.toFixed(1) : '--'}{' '}
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>%</span>
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#4ade80', fontSize: '0.75rem', fontWeight: 600 }}>
            <ShieldCheck size={14} /> CALIDAD (SQI)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', marginTop: '0.2rem' }}>
            {hudMetrics.sqi > 0 ? hudMetrics.sqi : '--'}{' '}
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>%</span>
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fbbf24', fontSize: '0.75rem', fontWeight: 600 }}>
            <Zap size={14} /> ESTADO ÓPTICO
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f8fafc', marginTop: '0.6rem' }}>
            {hudMetrics.contactState === 'STABLE_CONTACT' ? (
              <span style={{ color: '#4ade80' }}>TEJIDO ACTIVO</span>
            ) : (
              <span style={{ color: '#94a3b8' }}>LISTO</span>
            )}
          </div>
        </div>
      </div>

      {/* Visor de Onda PPG */}
      <div style={{ position: 'relative', width: '100%', height: '240px', borderRadius: '0.75rem', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Botón de Demostración de Telemetría */}
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={simulateLivePulse}
          style={{
            background: 'rgba(244, 63, 94, 0.15)',
            color: '#fb7185',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            padding: '0.45rem 1rem',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          <Activity size={14} /> Test Telemetría 60 FPS
        </button>
      </div>
    </div>
  );
}
