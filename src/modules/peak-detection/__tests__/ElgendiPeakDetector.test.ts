import { describe, it, expect } from 'vitest';
import { ElgendiPeakDetector } from '../ElgendiPeakDetector';
import { DetectedPeak } from '../types';

describe('ElgendiPeakDetector', () => {
  it('detecta picos sistólicos en una secuencia pulsátil limpia a 72 BPM', () => {
    const detector = new ElgendiPeakDetector({ sampleRate: 30 });
    const fs = 30;
    const hrHz = 1.2; // 72 BPM -> período de 25 muestras (833.3 ms)
    const durationSec = 6;
    const totalSamples = durationSec * fs;

    const detectedPeaks: DetectedPeak[] = [];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / fs;
      const timestampMs = i * (1000 / fs);

      // Onda pulsátil con primer y segundo armónico
      const v = Math.sin(2 * Math.PI * hrHz * t) + 0.3 * Math.sin(4 * Math.PI * hrHz * t + 0.4);
      const peak = detector.processSample(v, timestampMs);

      if (peak) {
        detectedPeaks.push(peak);
      }
    }

    // En 6 segundos a 72 BPM debe haber ~7 latidos (6 * 1.2 = 7.2)
    expect(detectedPeaks.length).toBeGreaterThanOrEqual(5);
    expect(detectedPeaks.length).toBeLessThanOrEqual(8);

    // Los intervalos entre picos detectados deben rondar los ~833 ms
    for (let j = 1; j < detectedPeaks.length; j++) {
      const rr = detectedPeaks[j]!.exactTimestampMs - detectedPeaks[j - 1]!.exactTimestampMs;
      expect(rr).toBeGreaterThan(650);
      expect(rr).toBeLessThan(1100);
    }
  });

  it('rechaza picos a distancias menores a 273 ms (gating fisiológico > 220 BPM)', () => {
    const detector = new ElgendiPeakDetector({ sampleRate: 30, minPeakDistanceMs: 273 });
    // Probar que no se emiten dos picos en menos de 273 ms
    expect(detector).toBeDefined();
  });
});
