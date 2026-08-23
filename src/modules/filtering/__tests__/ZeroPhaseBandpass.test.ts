import { describe, it, expect } from 'vitest';
import { ZeroPhaseBandpass } from '../ZeroPhaseBandpass';

describe('ZeroPhaseBandpass', () => {
  it('atenúa fuertemente componentes DC (0 Hz) y frecuencias fuera de banda', () => {
    const filter = new ZeroPhaseBandpass({ sampleRate: 30, lowCutHz: 0.5, highCutHz: 4.0 });

    // 1. Componente DC constante (100.0) tras disipación de respuesta transitoria
    for (let i = 0; i < 150; i++) filter.processSample(100.0);
    const dcResponse = filter.processSample(100.0);
    // El filtro pasabanda en estado estacionario bloquea DC
    expect(Math.abs(dcResponse)).toBeLessThan(0.05);
  });

  it('permite el paso de frecuencias en la banda cardíaca fisiológica (1.2 Hz ~ 72 BPM)', () => {
    const filter = new ZeroPhaseBandpass({ sampleRate: 30, lowCutHz: 0.5, highCutHz: 4.0 });
    let maxOutput = 0;

    for (let i = 0; i < 120; i++) {
      const t = i / 30;
      const inVal = Math.sin(2 * Math.PI * 1.2 * t);
      const out = filter.processSample(inVal);
      if (i > 60) maxOutput = Math.max(maxOutput, Math.abs(out));
    }

    // La señal en la banda de paso debe conservar al menos el 50% de amplitud
    expect(maxOutput).toBeGreaterThan(0.5);
  });
});
