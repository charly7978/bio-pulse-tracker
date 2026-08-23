import { describe, it, expect } from 'vitest';
import { PhysiologicalRrFilter } from '../PhysiologicalRrFilter';
import { DetectedPeak } from '../types';

describe('PhysiologicalRrFilter', () => {
  it('calcula intervalos RR válidos y suaviza la frecuencia cardíaca (BPM)', () => {
    const filter = new PhysiologicalRrFilter();

    // Simular picos a intervalos constantes de 857 ms (~70 BPM)
    const timestamps = [1000, 1857, 2714, 3571, 4428, 5285];
    let lastMetrics = null;

    for (let i = 0; i < timestamps.length; i++) {
      const peak: DetectedPeak = {
        index: i * 25,
        subSampleOffset: 0,
        exactTimestampMs: timestamps[i]!,
        amplitude: 1.0,
        confidence: 0.9,
      };

      lastMetrics = filter.processPeak(peak);
    }

    expect(lastMetrics).not.toBeNull();
    expect(lastMetrics!.isPhysiologicallyValid).toBe(true);
    expect(lastMetrics!.instantaneousBpm).toBe(70);
    expect(lastMetrics!.smoothedBpm).toBe(70);
  });

  it('detecta candidatos de arritmia ante saltos abruptos en el intervalo RR', () => {
    const filter = new PhysiologicalRrFilter({ maxAbruptJumpRatio: 0.35 });

    // Ritmo basal de 850 ms (~70 BPM)
    const baseline = [1000, 1850, 2700, 3550];
    for (const t of baseline) {
      filter.processPeak({ index: 0, subSampleOffset: 0, exactTimestampMs: t, amplitude: 1.0, confidence: 0.9 });
    }

    // Extrasístole prematura (450 ms en lugar de 850 ms -> salto de ~47%)
    const prematurePeak: DetectedPeak = {
      index: 100,
      subSampleOffset: 0,
      exactTimestampMs: 3550 + 450,
      amplitude: 0.8,
      confidence: 0.85,
    };

    const result = filter.processPeak(prematurePeak);
    expect(result).not.toBeNull();
    expect(result!.isArrhythmiaCandidate).toBe(true);
  });
});
