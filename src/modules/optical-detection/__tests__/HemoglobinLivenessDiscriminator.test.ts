import { describe, it, expect } from 'vitest';
import { HemoglobinLivenessDiscriminator } from '../HemoglobinLivenessDiscriminator';

describe('HemoglobinLivenessDiscriminator (Anti-Spoofing y Discriminación de Sangre)', () => {
  it('confirma inconfundiblemente sangre humana viva con modulación capilar fisiológica', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const n = 60;

    let lastVerdict = null;
    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pulseWave = Math.sin(2 * Math.PI * 1.25 * t);
      const g = 50 + 1.2 * pulseWave;
      const r = 180 + 0.8 * pulseWave;
      const b = 18 + 0.1 * pulseWave;

      discriminator.pushSample(r, g, b);
      lastVerdict = discriminator.evaluate(r, g, b, 0.9, 0.08);
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict!.isLivingBlood).toBe(true);
    expect(lastVerdict!.confidence).toBeGreaterThan(0.75);
    expect(lastVerdict!.metrics.hemoglobinModulationRatio).toBeGreaterThan(2.0);
  });

  it('RECHAZA AL 100% lámparas cálidas o ambientes con luz cálida (B > 42 o R/B < 3.2)', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    // Lámpara cálida incandescente/LED: R=140, G=95, B=58
    const verdict = discriminator.evaluate(140, 95, 58, 0.9, 0.05);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('WARM_AMBIENT_OR_SCENE_OBJECT');
  });

  it('RECHAZA AL 100% mesas de madera, cartón o paredes cálidas', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    // Madera o cartón cálido: R=115, G=75, B=48
    const verdict = discriminator.evaluate(115, 75, 48, 0.85, 0.12);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('WARM_AMBIENT_OR_SCENE_OBJECT');
  });

  it('RECHAZA AL 100% mano o piel a distancia sin contacto con el flash/lente (R < 90)', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    // Mano a distancia bajo luz ambiente: R=75, G=45, B=30
    const verdict = discriminator.evaluate(75, 45, 30, 0.7, 0.15);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('UNDEREXPOSED');
  });

  it('RECHAZA AL 100% plástico rojo estático / objeto inerte sin pulso arterial', () => {
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
});
