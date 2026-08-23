/**
 * BiologicalLivenessAttractor
 *
 * Valida la vivacidad biológica del pulso arterial humano mediante:
 * 1. Detección de período fundamental en la banda cardíaca [30 - 240 BPM].
 * 2. Regularidad del atractor de espacio de estados (SPAR - Pettit & Charlton 2024).
 * 3. Razón Señal/Interferencia por plantilla de ciclo cardíaco (Orphanidou et al. 2015).
 */

import { BiologicalLivenessVerdict } from './types';

export interface LivenessConfig {
  sampleRate: number;
  minBpm: number;
  maxBpm: number;
  minPeriodicity: number;
  minSinr: number;
  minAttractorRegularity: number;
  minSamplesWindow: number;
}

export const DEFAULT_LIVENESS_CONFIG: LivenessConfig = {
  sampleRate: 30,
  minBpm: 30,
  maxBpm: 240,
  minPeriodicity: 0.35,
  minSinr: 0.30,
  minAttractorRegularity: 0.30,
  minSamplesWindow: 45, // 1.5s
};

export class BiologicalLivenessAttractor {
  private readonly config: LivenessConfig;

  constructor(config: Partial<LivenessConfig> = {}) {
    this.config = { ...DEFAULT_LIVENESS_CONFIG, ...config };
  }

  /**
   * Evalúa una ventana temporal de señal filtrada.
   */
  public evaluateSignal(signalWindow: number[]): BiologicalLivenessVerdict {
    const n = signalWindow.length;
    const reasons: string[] = [];

    if (n < this.config.minSamplesWindow) {
      return {
        isLiveBiologicalPulse: null,
        confidence: 0,
        attractorRegularity: 0,
        templateSinr: 0,
        cardiacPeriodicity: 0,
        dominantBpm: 0,
        reasons: ['INSUFFICIENT_SAMPLES'],
      };
    }

    // 1. Centrar señal
    let sum = 0;
    for (let i = 0; i < n; i++) sum += signalWindow[i]!;
    const mean = sum / n;

    const centered = new Float64Array(n);
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const v = signalWindow[i]! - mean;
      centered[i] = v;
      variance += v * v;
    }

    if (variance < 1e-8) {
      return {
        isLiveBiologicalPulse: false,
        confidence: 0,
        attractorRegularity: 0,
        templateSinr: 0,
        cardiacPeriodicity: 0,
        dominantBpm: 0,
        reasons: ['FLATLINE_SIGNAL'],
      };
    }

    // 2. Autocorrelación en banda fisiológica
    const fs = this.config.sampleRate;
    const minLag = Math.max(2, Math.floor((fs * 60) / this.config.maxBpm)); // 240 BPM -> ~7 samples
    const maxLag = Math.min(Math.floor(n / 2), Math.ceil((fs * 60) / this.config.minBpm)); // 30 BPM -> ~60 samples

    let bestLag = 0;
    let bestScore = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let den1 = 0;
      let den2 = 0;
      const count = n - lag;

      for (let i = 0; i < count; i++) {
        const x = centered[i]!;
        const y = centered[i + lag]!;
        num += x * y;
        den1 += x * x;
        den2 += y * y;
      }

      const den = Math.sqrt(den1 * den2);
      const r = den > 1e-9 ? num / den : 0;

      if (r > bestScore) {
        bestScore = r;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestScore < this.config.minPeriodicity) {
      reasons.push('LOW_CARDIAC_PERIODICITY');
      return {
        isLiveBiologicalPulse: false,
        confidence: Math.max(0, bestScore),
        attractorRegularity: 0,
        templateSinr: 0,
        cardiacPeriodicity: Math.max(0, bestScore),
        dominantBpm: bestLag > 0 ? Math.round((fs * 60) / bestLag) : 0,
        reasons,
      };
    }

    // Si la ventana no cubre al menos 2 ciclos completos del lag dominante, retornamos 'null' (indeterminado)
    if (n < bestLag * 2) {
      return {
        isLiveBiologicalPulse: null,
        confidence: bestScore,
        attractorRegularity: 0,
        templateSinr: 0,
        cardiacPeriodicity: bestScore,
        dominantBpm: Math.round((fs * 60) / bestLag),
        reasons: ['INSUFFICIENT_WINDOW_FOR_LAG'],
      };
    }

    // 3. Regularidad del atractor de recurrencia (SPAR)
    let residualDiffSq = 0;
    let totalEnergy = 0;
    for (let i = 0; i < n - bestLag; i++) {
      const diff = centered[i + bestLag]! - centered[i]!;
      residualDiffSq += diff * diff;
      totalEnergy += centered[i]! * centered[i]!;
    }
    const attractorRegularity = totalEnergy > 1e-9
      ? Math.max(0, Math.min(1.0, 1.0 - residualDiffSq / (2 * totalEnergy)))
      : 0;

    // 4. Template Matching SINR (Orphanidou et al. 2015)
    let templateSinr = 0;
    const template = new Float64Array(bestLag);
    let tSumSq = 0;
    for (let i = 0; i < bestLag; i++) {
      const v = centered[i]!;
      template[i] = v;
      tSumSq += v * v;
    }

    if (tSumSq > 1e-9) {
      let cycleResidual = 0;
      let cycleTotal = 0;
      let cycles = 0;

      for (let start = bestLag; start + bestLag <= n; start += bestLag) {
        for (let i = 0; i < bestLag; i++) {
          const x = centered[start + i]!;
          const t = template[i]!;
          cycleResidual += (x - t) * (x - t);
          cycleTotal += x * x;
        }
        cycles++;
      }

      if (cycles > 0 && cycleTotal > 1e-9) {
        templateSinr = Math.max(0, Math.min(1.0, 1.0 - cycleResidual / cycleTotal));
      }
    }

    const passPeriodicity = bestScore >= this.config.minPeriodicity;
    const passAttractor = attractorRegularity >= this.config.minAttractorRegularity;
    const passSinr = templateSinr >= this.config.minSinr;

    if (!passPeriodicity) reasons.push('PERIODICITY_BELOW_MIN');
    if (!passAttractor) reasons.push('ATTRACTOR_BELOW_MIN');
    if (!passSinr) reasons.push('SINR_BELOW_MIN');

    const isLive = passPeriodicity && passAttractor && passSinr;
    const confidence = (bestScore * 0.4 + attractorRegularity * 0.3 + templateSinr * 0.3);

    return {
      isLiveBiologicalPulse: isLive,
      confidence: Math.max(0, Math.min(1.0, confidence)),
      attractorRegularity,
      templateSinr,
      cardiacPeriodicity: bestScore,
      dominantBpm: Math.round((fs * 60) / bestLag),
      reasons,
    };
  }
}
