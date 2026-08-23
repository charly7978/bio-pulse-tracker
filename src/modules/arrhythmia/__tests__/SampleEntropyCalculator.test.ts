import { describe, it, expect } from 'vitest';
import { SampleEntropyCalculator } from '../SampleEntropyCalculator';

describe('SampleEntropyCalculator', () => {
  it('produce baja entropía para secuencias perfectamente regulares y periódicas', () => {
    // Secuencia regular de 20 latidos
    const regularRr = [800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800];
    const entropy = SampleEntropyCalculator.calculate(regularRr, 2, 0.2);
    expect(entropy).toBeLessThan(0.3);
  });

  it('produce alta entropía para secuencias altamente caóticas o no deterministas', () => {
    // Secuencia no determinista con variaciones aleatorias continuas
    const randomRr = [
      812, 640, 990, 715, 890, 610, 1050, 780,
      830, 605, 940, 720, 1100, 680, 850, 630,
      970, 790, 840, 615, 1080, 730, 895, 650
    ];
    const entropy = SampleEntropyCalculator.calculate(randomRr, 2, 0.2);
    expect(entropy).toBeGreaterThan(0.8);
  });
});
