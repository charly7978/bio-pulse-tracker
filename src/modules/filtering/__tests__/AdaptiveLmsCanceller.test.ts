import { describe, it, expect } from 'vitest';
import { AdaptiveLmsCanceller } from '../AdaptiveLmsCanceller';

describe('AdaptiveLmsCanceller', () => {
  it('cancela exitosamente una interferencia correlacionada con la referencia de ruido', () => {
    const canceller = new AdaptiveLmsCanceller({ filterOrder: 8, learningRate: 0.05 });
    const n = 200;

    // Señal pura cardíaca (1.2 Hz) + ruido de movimiento (3.5 Hz)
    const hrFreq = 1.2;
    const noiseFreq = 3.5;

    let initialError = 0;
    let finalError = 0;

    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pureSignal = Math.sin(2 * Math.PI * hrFreq * t);
      const noise = 0.8 * Math.sin(2 * Math.PI * noiseFreq * t);

      const primary = pureSignal + noise; // Señal corrupta en canal Verde
      const ref = noise; // Referencia capturada en canal Azul

      const { cleanSignal } = canceller.processSample(primary, ref);
      const diff = Math.abs(cleanSignal - pureSignal);

      if (i < 30) initialError += diff;
      if (i > 150) finalError += diff;
    }

    // Tras el aprendizaje de los pesos, el error debe reducirse notablemente
    expect(finalError / 50).toBeLessThan((initialError / 30) * 0.4);
  });

  it('resetea los pesos a cero al llamar a reset()', () => {
    const canceller = new AdaptiveLmsCanceller();
    canceller.processSample(1.0, 0.5);
    canceller.reset();
    const out = canceller.processSample(1.0, 0.0);
    expect(out.estimatedNoise).toBe(0);
    expect(out.cleanSignal).toBe(1.0);
  });
});
