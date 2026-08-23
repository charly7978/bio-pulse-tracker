import { describe, it, expect } from 'vitest';
import { ArrhythmiaClassifier } from '../ArrhythmiaClassifier';

describe('ArrhythmiaClassifier', () => {
  it('clasifica ritmo sinusal normal en un sujeto con frecuencia y variabilidad estándar', () => {
    const classifier = new ArrhythmiaClassifier();
    const regularRr = [800, 810, 795, 805, 820, 800, 815, 790, 805, 810];

    let diagnosis = null;
    for (let i = 0; i < regularRr.length; i++) {
      diagnosis = classifier.processInterval(regularRr[i]!, 74, 28, 1000 + i * 800);
    }

    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.primaryRhythm).toBe('NORMAL_SINUS');
    expect(diagnosis!.confidence).toBeGreaterThanOrEqual(0.80);
  });

  it('detecta taquicardia sinusal cuando la frecuencia cardíaca supera 100 BPM en reposo', () => {
    const classifier = new ArrhythmiaClassifier();
    const tachyRr = [500, 510, 490, 505, 520, 500, 515, 495, 500, 510];

    let diagnosis = null;
    for (let i = 0; i < tachyRr.length; i++) {
      diagnosis = classifier.processInterval(tachyRr[i]!, 118, 20, 1000 + i * 500);
    }

    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.primaryRhythm).toBe('SINUS_TACHYCARDIA');
  });

  it('detecta extrasístoles ventriculares prematuras (PVC) con pausa compensatoria', () => {
    const classifier = new ArrhythmiaClassifier();
    // 6 latidos normales de 800 ms
    for (let i = 0; i < 6; i++) {
      classifier.processInterval(800, 75, 25, i * 800);
    }

    // Latido prematuro corto (550 ms) + Pausa compensatoria larga (1050 ms) -> suma = 1600 ms = 2 * 800 ms
    classifier.processInterval(550, 75, 25, 4800 + 550);
    const diagnosis = classifier.processInterval(1050, 75, 25, 4800 + 1600);

    expect(diagnosis.pvcCount).toBeGreaterThanOrEqual(1);
    expect(diagnosis.events.some((e) => e.type === 'PREMATURE_VENTRICULAR_CONTRACTION')).toBe(true);
  });
});
