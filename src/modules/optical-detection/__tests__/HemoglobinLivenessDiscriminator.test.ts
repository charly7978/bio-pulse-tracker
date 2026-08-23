import { describe, it, expect } from 'vitest';
import { HemoglobinLivenessDiscriminator } from '../HemoglobinLivenessDiscriminator';

describe('HemoglobinLivenessDiscriminator (Anti-Spoofing Unificado)', () => {
  it('confirma inconfundiblemente sangre humana viva con modulación capilar fisiológica', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const n = 60;

    let lastVerdict = null;
    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pulseWave = Math.sin(2 * Math.PI * 1.25 * t);
      const g = 50 + 1.2 * pulseWave;
      const r = 180 + 0.8 * pulseWave;
      const b = 20 + 0.1 * pulseWave;

      discriminator.pushSample(r, g, b);
      lastVerdict = discriminator.evaluate(r, g, b, 0.9, 0.08);
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict!.isLivingBlood).toBe(true);
    expect(lastVerdict!.confidence).toBeGreaterThan(0.75);
    expect(lastVerdict!.metrics.hemoglobinModulationRatio).toBeGreaterThan(2.0);
  });

  it('RECHAZA AL 100% plástico rojo estático / objeto inerte', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const n = 60;

    let lastVerdict = null;
    for (let i = 0; i < n; i++) {
      const r = 190 + (Math.random() - 0.5) * 0.02;
      const g = 45 + (Math.random() - 0.5) * 0.02;
      const b = 20 + (Math.random() - 0.5) * 0.02;

      discriminator.pushSample(r, g, b);
      lastVerdict = discriminator.evaluate(r, g, b, 0.95, 0.05);
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict!.isLivingBlood).toBe(false);
    expect(lastVerdict!.rejectionReason).toBe('INANIMATE_STATIC_OBJECT');
  });

  it('RECHAZA AL 100% plástico rojo en movimiento con modulación uniforme no biológica', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const n = 60;

    let lastVerdict = null;
    for (let i = 0; i < n; i++) {
      const motion = Math.sin((i / 10) * Math.PI);
      const r = 180 + 15 * motion;
      const g = 45 + 3.75 * motion;
      const b = 20 + 1.66 * motion;

      discriminator.pushSample(r, g, b);
      lastVerdict = discriminator.evaluate(r, g, b, 0.9, 0.08);
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict!.isLivingBlood).toBe(false);
    expect(lastVerdict!.rejectionReason).toBe('INANIMATE_UNIFORM_MODULATION');
  });

  it('RECHAZA fuga de luz ambiental directa o sobreexposición', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const verdict = discriminator.evaluate(150, 180, 220, 0.5, 0.01);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('AMBIENT_LIGHT_LEAK');
  });
});
