import { describe, it, expect } from 'vitest';
import { PulseAgc } from '../PulseAgc';

describe('PulseAgc', () => {
  it('amplifica señales débiles de baja amplitud hacia la amplitud objetivo', () => {
    const agc = new PulseAgc({ targetAmplitude: 1.0, maxGain: 20.0 });
    let maxOut = 0;

    // Entrada muy débil (amplitud 0.05)
    for (let i = 0; i < 120; i++) {
      const v = 0.05 * Math.sin((i / 15) * Math.PI);
      const out = agc.processSample(v);
      if (i > 90) maxOut = Math.max(maxOut, Math.abs(out));
    }

    expect(maxOut).toBeGreaterThan(0.25);
    expect(agc.getGain()).toBeGreaterThan(5.0);
  });

  it('atenúa señales de excesiva amplitud de forma rápida para evitar saturación', () => {
    const agc = new PulseAgc({ targetAmplitude: 1.0, minGain: 0.1 });
    let maxOut = 0;

    // Entrada fuerte (amplitud 5.0)
    for (let i = 0; i < 40; i++) {
      const v = 5.0 * Math.sin((i / 15) * Math.PI);
      const out = agc.processSample(v);
      maxOut = Math.max(maxOut, Math.abs(out));
    }

    expect(maxOut).toBeLessThan(6.0);
    expect(agc.getGain()).toBeLessThan(1.0);
  });
});
