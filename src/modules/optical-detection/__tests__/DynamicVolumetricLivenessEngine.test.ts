import { describe, it, expect } from 'vitest';
import { DynamicVolumetricLivenessEngine } from '../DynamicVolumetricLivenessEngine';

describe('DynamicVolumetricLivenessEngine (Anti-Spoofing Biofísico)', () => {
  it('confirma inconfundiblemente sangre humana viva con modulación capilar real', () => {
    const engine = new DynamicVolumetricLivenessEngine(30, 2.0);
    const n = 60; // 2 segundos a 30 FPS

    // Simulación de sangre viva a 75 BPM (1.25 Hz):
    // - DC Verde = 50, AC Verde = 1.2 (PI_G = 2.4%)
    // - DC Rojo = 180, AC Rojo = 0.8 (PI_R = 0.44%) -> Ratio Hb = 2.4 / 0.44 = 5.45 (> 1.8)
    // - DC Azul = 20, AC Azul = 0.1 (PI_B = 0.5%) -> Desacoplamiento Azul = 4.8 (> 2.0)
    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pulseWave = Math.sin(2 * Math.PI * 1.25 * t);
      const g = 50 + 1.2 * pulseWave;
      const r = 180 + 0.8 * pulseWave;
      const b = 20 + 0.1 * pulseWave;

      engine.pushSample(r, g, b);
    }

    const verdict = engine.evaluateLiveness(true);

    expect(verdict.isLivingBlood).toBe(true);
    expect(verdict.confidence).toBeGreaterThan(0.70);
    expect(verdict.hemoglobinModulationRatio).toBeGreaterThan(2.0);
    expect(verdict.perfusionIndexGreen).toBeGreaterThan(1.0);
  });

  it('RECHAZA AL 100% un objeto inerte estático (plástico rojo, papel, tela, tomate)', () => {
    const engine = new DynamicVolumetricLivenessEngine(30, 2.0);
    const n = 60;

    // Plástico rojo idéntico en color (R=190, G=45, B=20) pero sin pulso cardíaco (solo ruido térmico microscópico)
    for (let i = 0; i < n; i++) {
      const r = 190 + (Math.random() - 0.5) * 0.02;
      const g = 45 + (Math.random() - 0.5) * 0.02;
      const b = 20 + (Math.random() - 0.5) * 0.02;

      engine.pushSample(r, g, b);
    }

    const verdict = engine.evaluateLiveness(true);

    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('INANIMATE_STATIC_OBJECT');
  });

  it('RECHAZA AL 100% un objeto inerte en movimiento (modulación lumínica uniforme no biológica)', () => {
    const engine = new DynamicVolumetricLivenessEngine(30, 2.0);
    const n = 60;

    // Plástico rojo agitándose frente a la luz:
    // Al moverse un objeto inerte, el brillo de TODOS los canales sube y baja en la misma proporción
    for (let i = 0; i < n; i++) {
      const motion = Math.sin((i / 10) * Math.PI);
      const r = 180 + 15 * motion; // 8.3% de modulación
      const g = 45 + 3.75 * motion; // 8.3% de modulación (Ratio de modulación = 1.0)
      const b = 20 + 1.66 * motion; // 8.3% de modulación

      engine.pushSample(r, g, b);
    }

    const verdict = engine.evaluateLiveness(true);

    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('INANIMATE_UNIFORM_MODULATION');
  });

  it('rechaza si el espectro estático inicial no corresponde a tejido orgánico', () => {
    const engine = new DynamicVolumetricLivenessEngine(30, 2.0);
    for (let i = 0; i < 60; i++) {
      engine.pushSample(50, 180, 200); // Objeto azul/verde
    }

    const verdict = engine.evaluateLiveness(false);

    expect(verdict.isLivingBlood).toBe(false);
    expect(verdict.rejectionReason).toBe('NO_HEMOGLOBIN_ABSORPTION_CURVE');
  });
});
