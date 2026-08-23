import { describe, it, expect } from 'vitest';
import { Spo2Engine } from '../Spo2Engine';

describe('Spo2Engine', () => {
  it('calcula SpO2 dentro del rango fisiológico clínico [94% - 100%]', () => {
    const engine = new Spo2Engine(60);

    // Simular muestras ópticas: DC alto en rojo (190), AC verde mayor que AC rojo
    for (let i = 0; i < 60; i++) {
      const r = 190 + Math.sin(i * 0.2) * 1.5; // AC/DC Rojo = 3 / 190 = 0.0157
      const g = 45 + Math.sin(i * 0.2) * 1.8;  // AC/DC Verde = 3.6 / 45 = 0.08
      engine.pushSample(r, g);
    }

    const metrics = engine.computeSpo2(0.95);

    expect(metrics.spo2Percent).toBeGreaterThanOrEqual(95.0);
    expect(metrics.spo2Percent).toBeLessThanOrEqual(100.0);
    expect(metrics.confidence).toBeGreaterThan(0.70);
  });
});
