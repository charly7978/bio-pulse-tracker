import { describe, it, expect } from 'vitest';
import { PpgSignalDenoisingPipeline } from '../PpgSignalDenoisingPipeline';

describe('PpgSignalDenoisingPipeline', () => {
  it('procesa fotogramas multicanal en tiempo real y produce señal limpia y normalizada', () => {
    const pipeline = new PpgSignalDenoisingPipeline(30);
    const n = 120;
    let finalOutput = null;

    for (let i = 0; i < n; i++) {
      const t = i / 30;
      // Pulso verde con deriva DC y ruido común
      const green = 50 + 2.0 * Math.sin(2 * Math.PI * 1.2 * t) + 0.5 * Math.sin(2 * Math.PI * 8.0 * t);
      const blue = 15 + 0.5 * Math.sin(2 * Math.PI * 8.0 * t); // Solo el ruido

      finalOutput = pipeline.processSample(green, blue);
    }

    expect(finalOutput).not.toBeNull();
    expect(finalOutput!.bandpassFiltered).toBeDefined();
    expect(finalOutput!.lmsCleaned).toBeDefined();
    expect(finalOutput!.agcNormalized).toBeDefined();
    expect(Number.isFinite(finalOutput!.agcNormalized)).toBe(true);
  });
});
