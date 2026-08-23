/**
 * PhysiologicalRrFilter
 *
 * Filtro de validación y suavizado fisiológico de intervalos RR y cálculo de BPM.
 * Implementa filtrado por mediana móvil, detección de outliers y clasificación
 * de candidatos de arritmia sin bloquear la actualización de frecuencia cardíaca.
 */

import { RrIntervalMetrics, DetectedPeak } from './types';

export interface PhysiologicalFilterConfig {
  minRrMs: number; // 273 ms -> 220 BPM
  maxRrMs: number; // 2000 ms -> 30 BPM
  historyLength: number; // 10 latidos
  maxAbruptJumpRatio: number; // 0.35 (35% de variación abrupta)
}

export const DEFAULT_PHYSIOLOGICAL_CONFIG: PhysiologicalFilterConfig = {
  minRrMs: 273,
  maxRrMs: 2000,
  historyLength: 10,
  maxAbruptJumpRatio: 0.35,
};

export class PhysiologicalRrFilter {
  private readonly config: PhysiologicalFilterConfig;
  private readonly validRrHistory: number[] = [];
  private lastPeakTimeMs = -1;

  constructor(config: Partial<PhysiologicalFilterConfig> = {}) {
    this.config = { ...DEFAULT_PHYSIOLOGICAL_CONFIG, ...config };
  }

  /**
   * Procesa un nuevo pico sistólico detectado y calcula las métricas RR y BPM.
   */
  public processPeak(peak: DetectedPeak): RrIntervalMetrics | null {
    if (this.lastPeakTimeMs < 0) {
      this.lastPeakTimeMs = peak.exactTimestampMs;
      return null;
    }

    const rawRr = peak.exactTimestampMs - this.lastPeakTimeMs;
    this.lastPeakTimeMs = peak.exactTimestampMs;

    // 1. Validación de límites fisiológicos absolutos [273 ms - 2000 ms]
    const isPhysiologicallyValid = rawRr >= this.config.minRrMs && rawRr <= this.config.maxRrMs;

    if (!isPhysiologicallyValid) {
      return {
        rrIntervalMs: rawRr,
        instantaneousBpm: rawRr > 0 ? Math.round(60000 / rawRr) : 0,
        smoothedBpm: this.getSmoothedBpm(),
        confidence: 0.2,
        isPhysiologicallyValid: false,
        isArrhythmiaCandidate: false,
      };
    }

    // 2. Detección de salto abrupto respecto a la mediana móvil previa
    let isArrhythmiaCandidate = false;
    let confidence = peak.confidence;

    if (this.validRrHistory.length >= 3) {
      const medianRr = this.getMedian(this.validRrHistory);
      const diffRatio = Math.abs(rawRr - medianRr) / medianRr;

      if (diffRatio > this.config.maxAbruptJumpRatio) {
        isArrhythmiaCandidate = true;
        confidence = Math.max(0.4, confidence * 0.7);
      }
    }

    // 3. Agregar al historial de intervalos válidos
    this.validRrHistory.push(rawRr);
    if (this.validRrHistory.length > this.config.historyLength) {
      this.validRrHistory.shift();
    }

    const instantaneousBpm = Math.round(60000 / rawRr);
    const smoothedBpm = this.getSmoothedBpm();

    return {
      rrIntervalMs: rawRr,
      instantaneousBpm,
      smoothedBpm,
      confidence,
      isPhysiologicallyValid: true,
      isArrhythmiaCandidate,
    };
  }

  public getSmoothedBpm(): number {
    if (this.validRrHistory.length === 0) return 0;
    const medianRr = this.getMedian(this.validRrHistory);
    return Math.round(60000 / medianRr);
  }

  public getRrHistory(): number[] {
    return [...this.validRrHistory];
  }

  private getMedian(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  public reset(): void {
    this.validRrHistory.length = 0;
    this.lastPeakTimeMs = -1;
  }
}
