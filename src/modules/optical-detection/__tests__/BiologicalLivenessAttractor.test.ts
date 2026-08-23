import { describe, it, expect } from 'vitest';
import { BiologicalLivenessAttractor } from '../BiologicalLivenessAttractor';

describe('BiologicalLivenessAttractor', () => {
  const attractor = new BiologicalLivenessAttractor({ sampleRate: 30, minSamplesWindow: 45 });

  it('retorna isLiveBiologicalPulse: true para una onda de pulso cardíaco cuasi-periódica (72 BPM)', () => {
    // 72 BPM a 30 FPS = período de 25 muestras
    const fs = 30;
    const hrHz = 72 / 60; // 1.2 Hz
    const samples = 90; // 3 segundos (3.6 ciclos)
    const signal: number[] = [];

    for (let i = 0; i < samples; i++) {
      const t = i / fs;
      // Onda similar a PPG (fundamental + segundo armónico)
      const v = Math.sin(2 * Math.PI * hrHz * t) + 0.35 * Math.sin(4 * Math.PI * hrHz * t + 0.5);
      signal.push(v);
    }

    const verdict = attractor.evaluateSignal(signal);

    expect(verdict.isLiveBiologicalPulse).toBe(true);
    expect(verdict.cardiacPeriodicity).toBeGreaterThan(0.85);
    expect(verdict.attractorRegularity).toBeGreaterThan(0.70);
    expect(verdict.templateSinr).toBeGreaterThan(0.70);
    expect(verdict.dominantBpm).toBe(72);
    expect(verdict.confidence).toBeGreaterThan(0.75);
  });

  it('retorna isLiveBiologicalPulse: false para una señal plana (flatline / estática)', () => {
    const signal = Array(60).fill(100.0);
    const verdict = attractor.evaluateSignal(signal);

    expect(verdict.isLiveBiologicalPulse).toBe(false);
    expect(verdict.reasons).toContain('FLATLINE_SIGNAL');
  });

  it('retorna isLiveBiologicalPulse: false para ruido blanco no periódico', () => {
    const signal: number[] = [];
    let state = 123456789;
    for (let i = 0; i < 90; i++) {
      state = (state * 1664525 + 1013904223) % 4294967296;
      signal.push((state / 4294967296) * 2 - 1);
    }

    const verdict = attractor.evaluateSignal(signal);

    expect(verdict.isLiveBiologicalPulse).toBe(false);
    expect(verdict.reasons).toContain('LOW_CARDIAC_PERIODICITY');
  });

  it('retorna isLiveBiologicalPulse: null cuando la ventana de muestras es insuficiente (< 45)', () => {
    const signal = [1, 2, 3, 4, 5, 4, 3, 2, 1];
    const verdict = attractor.evaluateSignal(signal);

    expect(verdict.isLiveBiologicalPulse).toBeNull();
    expect(verdict.reasons).toContain('INSUFFICIENT_SAMPLES');
  });
});
