import { describe, it, expect } from 'vitest';
import { PulseWaveAnalysisEngine } from '../PulseWaveAnalysisEngine';

describe('PulseWaveAnalysisEngine', () => {
  it('estima parámetros hemodinámicos y presión arterial dentro de rangos normales', () => {
    const engine = new PulseWaveAnalysisEngine();

    // Crest time típico: 120 ms, ciclo RR: 857 ms (~70 BPM)
    const metrics = engine.analyzePulseCycle(120, 857, 70);

    expect(metrics.crestTimeMs).toBeGreaterThanOrEqual(100);
    expect(metrics.crestTimeMs).toBeLessThanOrEqual(150);
    expect(metrics.estimatedSystolicMmHg).toBeGreaterThanOrEqual(100);
    expect(metrics.estimatedSystolicMmHg).toBeLessThanOrEqual(140);
    expect(metrics.estimatedDiastolicMmHg).toBeGreaterThanOrEqual(65);
    expect(metrics.estimatedDiastolicMmHg).toBeLessThanOrEqual(90);
  });
});
