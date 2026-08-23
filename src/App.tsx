import { Activity, ShieldCheck, Cpu, Waves } from 'lucide-react';
import { CardiacTelemetryMonitor } from './components/CardiacTelemetryMonitor';

export default function App() {
  return (
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.4rem 0.9rem',
          borderRadius: '9999px',
          background: 'rgba(244, 63, 94, 0.12)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          color: '#fb7185',
          fontSize: '0.85rem',
          fontWeight: 600,
          marginBottom: '1rem'
        }}>
          <Activity size={16} /> Bio-Pulse Tracker v1.0
        </div>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.025em', marginBottom: '0.5rem' }}>
          Monitor Clínico Fotopletismográfico
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', maxWidth: '500px', margin: '0 auto' }}>
          Procesamiento de señal óptica por cámara, espectroscopía de hemoglobina y estimación biomédica en tiempo real.
        </p>
      </header>

      <section style={{ marginBottom: '2rem' }}>
        <CardiacTelemetryMonitor />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ color: '#38bdf8', marginBottom: '0.5rem' }}><ShieldCheck size={24} /></div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Anti-Spoofing Biológico</h3>
          <p style={{ color: '#64748b', fontSize: '0.82rem' }}>
            Discriminación inconfundible de sangre viva mediante proyecciones cromáticas diferenciales (Beer-Lambert / CHROM).
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ color: '#4ade80', marginBottom: '0.5rem' }}><Cpu size={24} /></div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>DSP Sub-Muestra</h3>
          <p style={{ color: '#64748b', fontSize: '0.82rem' }}>
            Ajuste parabólico de Savitzky-Golay para resolución temporal milimétrica de intervalos RR.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ color: '#f43f5e', marginBottom: '0.5rem' }}><Waves size={24} /></div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Atractor SPAR 2D</h3>
          <p style={{ color: '#64748b', fontSize: '0.82rem' }}>
            Validación de recurrencia en espacio de fases 2D para cero falsos positivos (Pettit & Charlton 2024).
          </p>
        </div>
      </section>
    </main>
  );
}
