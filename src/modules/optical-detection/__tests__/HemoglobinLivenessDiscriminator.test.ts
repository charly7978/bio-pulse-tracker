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
      const g = 50 + 1.8 * pulseWave;
      const r = 180 + 0.9 * pulseWave;
      const b = 18 + 0.1 * pulseWave;

      discriminator.pushSample(r, g, b);
      lastVerdict = discriminator.evaluate(r, g, b, 0.9, 0.08);
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict!.isLivingBlood).toBe(true);
    expect(lastVerdict!.contactState).toBe('STABLE_CONTACT');
    expect(lastVerdict!.confidence).toBeGreaterThanOrEqual(0.75);
    expect(lastVerdict!.metrics.perfusionIndexGreen).toBeGreaterThan(0.05);
  });

  it('RECHAZA AL 100% lámparas cálidas o ambientes con luz cálida (B > 58 o R/B < 2.6)', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    // Lámpara cálida incandescente/LED: R=140, G=95, B=65
    const verdict = discriminator.evaluate(140, 95, 65, 0.9, 0.05);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.contactState).toBe('NO_CONTACT');
    expect(verdict.rejectionReason).toBe('WARM_AMBIENT_OR_SCENE_OBJECT');
  });

  it('RECHAZA AL 100% mesas de madera, cartón o paredes cálidas', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    // Madera o cartón cálido: R=115, G=80, B=55 (normR < 0.58 o ratioRb < 2.6)
    const verdict = discriminator.evaluate(115, 80, 55, 0.85, 0.12);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.contactState).toBe('NO_CONTACT');
    expect(verdict.rejectionReason).toBe('WARM_AMBIENT_OR_SCENE_OBJECT');
  });

  it('RECHAZA AL 100% mano o piel a distancia sin contacto con el flash/lente (R < 70)', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    // Mano a distancia bajo luz ambiente: R=60, G=40, B=25
    const verdict = discriminator.evaluate(60, 40, 25, 0.7, 0.15);
    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.contactState).toBe('NO_CONTACT');
    expect(verdict.rejectionReason).toBe('UNDEREXPOSED');
  });

  it('RECHAZA AL 100% plástico rojo estático / objeto inerte sin pulso arterial', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const n = 60;

    let lastVerdict = null;
    for (let i = 0; i < n; i++) {
      const r = 190 + (Math.random() - 0.5) * 0.01;
      const g = 45 + (Math.random() - 0.5) * 0.01;
      const b = 20 + (Math.random() - 0.5) * 0.01;

      discriminator.pushSample(r, g, b);
      lastVerdict = discriminator.evaluate(r, g, b, 0.95, 0.05);
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict!.isLivingBlood).toBe(false);
    expect(lastVerdict!.rejectionReason).toBe('INANIMATE_STATIC_OBJECT');
  });

  it('aplica histéresis temporal evitando cortes abruptos ante ruido de un solo fotograma', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
    const n = 60;

    // Primero estabilizar en STABLE_CONTACT
    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pulseWave = Math.sin(2 * Math.PI * 1.25 * t);
      const g = 50 + 1.8 * pulseWave;
      const r = 180 + 0.9 * pulseWave;
      const b = 18 + 0.1 * pulseWave;
      discriminator.pushSample(r, g, b);
      discriminator.evaluate(r, g, b, 0.9, 0.08);
    }

    // Simular 2 fotogramas ruidosos (por ejemplo, un destello momentáneo)
    discriminator.pushSample(200, 150, 100);
    const glitchVerdict1 = discriminator.evaluate(200, 150, 100, 0.9, 0.08);
    expect(glitchVerdict1.contactState).toBe('STABLE_CONTACT'); // La histéresis sostiene la conexión

    discriminator.pushSample(200, 150, 100);
    const glitchVerdict2 = discriminator.evaluate(200, 150, 100, 0.9, 0.08);
    expect(glitchVerdict2.contactState).toBe('STABLE_CONTACT'); // Continúa en estado estable
  });

  it('gestiona la transición completa: NO_CONTACT -> UNSTABLE_CONTACT -> STABLE_CONTACT -> NO_CONTACT', () => {
    const discriminator = new HemoglobinLivenessDiscriminator(30, 2.0);

    // Estado inicial
    const v0 = discriminator.evaluate(0, 0, 0, 0, 0);
    expect(v0.contactState).toBe('NO_CONTACT');

    // 1. Colocar el dedo: primeros 5 fotogramas entran a UNSTABLE_CONTACT
    for (let i = 0; i < 5; i++) {
      discriminator.pushSample(180, 50, 18);
      discriminator.evaluate(180, 50, 18, 0.9, 0.05);
    }
    const vUnstable = discriminator.evaluate(180, 50, 18, 0.9, 0.05);
    expect(vUnstable.contactState).toBe('UNSTABLE_CONTACT');
    expect(vUnstable.isLivingBlood).toBe(false);

    // 2. Acumular pulso fisiológico (40 fotogramas con modulación armónica)
    for (let i = 0; i < 40; i++) {
      const t = i / 30;
      const pulseWave = Math.sin(2 * Math.PI * 1.25 * t);
      const g = 50 + 2.0 * pulseWave;
      const r = 180 + 0.8 * pulseWave;
      const b = 18 + 0.1 * pulseWave;
      discriminator.pushSample(r, g, b);
      discriminator.evaluate(r, g, b, 0.9, 0.05);
    }
    const vStable = discriminator.evaluate(180, 50, 18, 0.9, 0.05);
    expect(vStable.contactState).toBe('STABLE_CONTACT');
    expect(vStable.isLivingBlood).toBe(true);

    // 3. Levantar el dedo: 15 fotogramas sin luz/contacto devuelven a NO_CONTACT
    for (let i = 0; i < 16; i++) {
      discriminator.pushSample(20, 15, 10);
      discriminator.evaluate(20, 15, 10, 0, 0);
    }
    const vEnd = discriminator.evaluate(20, 15, 10, 0, 0);
    expect(vEnd.contactState).toBe('NO_CONTACT');
    expect(vEnd.isLivingBlood).toBe(false);
  });
});
