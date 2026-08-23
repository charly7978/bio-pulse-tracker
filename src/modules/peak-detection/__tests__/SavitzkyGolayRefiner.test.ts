import { describe, it, expect } from 'vitest';
import { SavitzkyGolayRefiner } from '../SavitzkyGolayRefiner';

describe('SavitzkyGolayRefiner', () => {
  it('calcula con precisión el vértice continuo de una parábola centrada', () => {
    // Parábola f(t) = 1.0 - (t - 0.25)^2 = 1.0 - (t^2 - 0.5t + 0.0625)
    // El vértice teórico está en t = +0.25
    const f = (t: number) => 1.0 - (t - 0.25) ** 2;

    const ym2 = f(-2);
    const ym1 = f(-1);
    const y0 = f(0);
    const yp1 = f(1);
    const yp2 = f(2);

    const result = SavitzkyGolayRefiner.refineVertex5(ym2, ym1, y0, yp1, yp2);

    expect(result.isValidVertex).toBe(true);
    expect(result.delta).toBeCloseTo(0.25, 3);
    expect(result.refinedAmplitude).toBeCloseTo(1.0, 3);
    expect(result.curvature).toBeLessThan(0); // Cóncavo hacia abajo
  });

  it('retorna delta = 0 si la forma no es cóncava (falso pico)', () => {
    // Valle (mínimo local, no máximo)
    const result = SavitzkyGolayRefiner.refineVertex5(1.0, 0.5, 0.2, 0.5, 1.0);
    expect(result.isValidVertex).toBe(false);
    expect(result.delta).toBe(0);
  });
});
