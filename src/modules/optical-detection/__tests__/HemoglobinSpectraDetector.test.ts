import { describe, it, expect } from 'vitest';
import { HemoglobinSpectraDetector } from '../HemoglobinSpectraDetector';

describe('HemoglobinSpectraDetector', () => {
  const detector = new HemoglobinSpectraDetector();

  it('acepta una firma óptica real de sangre humana con alta confianza', () => {
    // Típico dedo iluminado con flash: R alto, G medio/bajo, B muy bajo
    const verdict = detector.evaluateFrame(195, 42, 18, 0.95, 0.08);

    expect(verdict.isHumanTissue).toBe(true);
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.70);
    expect(verdict.absorptionRatioRg).toBeGreaterThan(3.5);
    expect(verdict.absorptionRatioRb).toBeGreaterThan(8.0);
    expect(verdict.chrominanceSnr).toBeGreaterThan(1.0);
    expect(verdict.rejectionReason).toBeUndefined();
  });

  it('rechaza una superficie inerte (mantel blanco/gris con R ≈ G ≈ B)', () => {
    const verdict = detector.evaluateFrame(120, 118, 115, 1.0, 0.05);

    expect(verdict.isHumanTissue).toBe(false);
    expect(verdict.rejectionReason).toBe('AMBIENT_LIGHT_LEAK');
    expect(verdict.confidence).toBeLessThan(0.3);
  });

  it('rechaza luz ambiental o foco azul/blanco directo', () => {
    const verdict = detector.evaluateFrame(80, 150, 160, 0.9, 0.04);

    expect(verdict.isHumanTissue).toBe(false);
    expect(verdict.rejectionReason).toBe('AMBIENT_LIGHT_LEAK');
  });

  it('rechaza subexposición severa (sin contacto / oscuridad)', () => {
    const verdict = detector.evaluateFrame(15, 8, 5, 0.1, 0.01);

    expect(verdict.isHumanTissue).toBe(false);
    expect(verdict.rejectionReason).toBe('UNDEREXPOSED');
  });

  it('rechaza saturación total del sensor (luz LED directa sin dedo)', () => {
    const verdict = detector.evaluateFrame(255, 255, 250, 1.0, 0.01);

    expect(verdict.isHumanTissue).toBe(false);
    expect(verdict.rejectionReason).toBe('SATURATED');
  });

  it('rechaza cobertura insuficiente del lente (< 65%)', () => {
    const verdict = detector.evaluateFrame(180, 45, 20, 0.40, 0.08);

    expect(verdict.isHumanTissue).toBe(false);
    expect(verdict.rejectionReason).toBe('INSUFFICIENT_COVERAGE');
  });

  it('rechaza plástico rojo uniforme sin dispersión tisular humana (cvRed anómalo)', () => {
    // Plástico rojo perfecto: varianza espacial casi 0 (cvRed = 0.005)
    const verdict = detector.evaluateFrame(200, 20, 10, 1.0, 0.005);

    expect(verdict.isHumanTissue).toBe(false);
    expect(verdict.rejectionReason).toBe('NO_HEMOGLOBIN_ABSORPTION');
  });
});
