import { describe, it, expect } from 'vitest';
import { HrvEngine } from '../HrvEngine';

describe('HrvEngine', () => {
  it('calcula métricas de HRV (RMSSD, SDNN, pNN50, SD1/SD2) correctamente', () => {
    const engine = new HrvEngine(30);

    // Secuencia de 20 intervalos RR fisiológicos alrededor de 800 ms con variabilidad
    const rrSequence = [
      800, 820, 790, 840, 810, 850, 780, 830, 810, 860,
      790, 820, 800, 850, 830, 810, 840, 790, 820, 800,
    ];

    for (const rr of rrSequence) {
      engine.pushRrInterval(rr);
    }

    const metrics = engine.computeMetrics();

    expect(metrics.sampleCount).toBe(20);
    expect(metrics.sdnnMs).toBeGreaterThan(15);
    expect(metrics.sdnnMs).toBeLessThan(40);
    expect(metrics.rmssdMs).toBeGreaterThan(25);
    expect(metrics.rmssdMs).toBeLessThan(60);
    expect(metrics.sd1Ms).toBeGreaterThan(15);
    expect(metrics.sd2Ms).toBeGreaterThan(12);
    expect(metrics.pnn50Ratio).toBeGreaterThanOrEqual(0);
    expect(metrics.pnn50Ratio).toBeLessThanOrEqual(1.0);
  });

  it('retorna valores por defecto seguros si hay menos de 4 muestras', () => {
    const engine = new HrvEngine();
    engine.pushRrInterval(800);
    engine.pushRrInterval(820);

    const metrics = engine.computeMetrics();
    expect(metrics.rmssdMs).toBe(0);
    expect(metrics.sdnnMs).toBe(0);
  });
});
