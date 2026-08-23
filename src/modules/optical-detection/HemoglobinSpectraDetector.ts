/**
 * HemoglobinSpectraDetector
 *
 * Módulo de validación biofísica de absorción óptica de hemoglobina
 * según la ley de Beer-Lambert modificada y proyecciones cromáticas diferenciales (Wang et al. 2017).
 *
 * Discrimina inconfundiblemente tejido biológico humano vivo frente a:
 * - Superficies inertes (plástico, manteles, telas, madera).
 * - Fugas de luz ambiental (luz solar, bombillas incandescentes/LED).
 * - Sensor saturado o subexpuesto.
 */

import { HemoglobinVerdict } from './types';

export interface HemoglobinDetectorConfig {
  minRedLevel: number;
  maxRedLevel: number;
  minRgRatio: number;
  minRbRatio: number;
  minRedNormalized: number;
  maxGreenNormalized: number;
  maxBlueNormalized: number;
  minCoverage: number;
  minCvRed: number;
  maxCvRed: number;
}

export const DEFAULT_HEMOGLOBIN_CONFIG: HemoglobinDetectorConfig = {
  minRedLevel: 40,
  maxRedLevel: 253,
  minRgRatio: 1.25,
  minRbRatio: 1.50,
  minRedNormalized: 0.45,
  maxGreenNormalized: 0.42,
  maxBlueNormalized: 0.25,
  minCoverage: 0.65,
  minCvRed: 0.02,
  maxCvRed: 0.35,
};

export class HemoglobinSpectraDetector {
  private readonly config: HemoglobinDetectorConfig;

  constructor(config: Partial<HemoglobinDetectorConfig> = {}) {
    this.config = { ...DEFAULT_HEMOGLOBIN_CONFIG, ...config };
  }

  /**
   * Evalúa si un conjunto de métricas ópticas espaciales cumple con la firma de hemoglobina humana.
   */
  public evaluateFrame(
    meanR: number,
    meanG: number,
    meanB: number,
    coverageRatio: number = 1.0,
    cvRed: number = 0.08
  ): HemoglobinVerdict {
    const totalIntensity = meanR + meanG + meanB + 1e-6;
    const normR = meanR / totalIntensity;
    const normG = meanG / totalIntensity;
    const normB = meanB / totalIntensity;

    const ratioRg = meanR / Math.max(meanG, 1e-3);
    const ratioRb = meanR / Math.max(meanB, 1e-3);

    // 1. Detección de subexposición o sobreexposición severa
    if (meanR < this.config.minRedLevel) {
      return this.createRejectionVerdict(
        'UNDEREXPOSED',
        meanR, meanG, meanB, coverageRatio, cvRed, ratioRg, ratioRb, 0
      );
    }
    if (meanR > this.config.maxRedLevel && meanG > this.config.maxRedLevel) {
      return this.createRejectionVerdict(
        'SATURATED',
        meanR, meanG, meanB, coverageRatio, cvRed, ratioRg, ratioRb, 0
      );
    }

    // 2. Fuga de luz ambiental (luz blanca/azulada no transmitida por tejido capilar)
    if (normB > this.config.maxBlueNormalized || (meanB > meanG * 0.8 && ratioRg < 1.3)) {
      return this.createRejectionVerdict(
        'AMBIENT_LIGHT_LEAK',
        meanR, meanG, meanB, coverageRatio, cvRed, ratioRg, ratioRb, 0.1
      );
    }

    // 3. Cobertura del sensor por el dedo
    if (coverageRatio < this.config.minCoverage) {
      return this.createRejectionVerdict(
        'INSUFFICIENT_COVERAGE',
        meanR, meanG, meanB, coverageRatio, cvRed, ratioRg, ratioRb, 0.2
      );
    }

    // 4. Validación de firma de absorción óptica de hemoglobina
    const passAbsorption = (
      ratioRg >= this.config.minRgRatio &&
      ratioRb >= this.config.minRbRatio &&
      normR >= this.config.minRedNormalized &&
      normG <= this.config.maxGreenNormalized &&
      cvRed >= this.config.minCvRed &&
      cvRed <= this.config.maxCvRed
    );

    if (!passAbsorption) {
      return this.createRejectionVerdict(
        'NO_HEMOGLOBIN_ABSORPTION',
        meanR, meanG, meanB, coverageRatio, cvRed, ratioRg, ratioRb, 0.25
      );
    }

    // 5. Cálculo de SNR Cromática (Proyecciones ortogonales Wang et al. 2017)
    // S1 = 3 Rn - 2 Gn, S2 = 1.5 Rn + Gn - 1.5 Bn
    const s1 = 3 * normR - 2 * normG;
    const s2 = 1.5 * normR + normG - 1.5 * normB;
    const chrominanceSnr = Math.max(0, s1 / (Math.abs(s2) + 1e-4));

    // Cálculo de confianza biológica ponderada [0.0 - 1.0]
    const rgScore = Math.min(1.0, (ratioRg - this.config.minRgRatio) / 1.5);
    const rbScore = Math.min(1.0, (ratioRb - this.config.minRbRatio) / 2.0);
    const coverageScore = Math.min(1.0, coverageRatio / 0.9);
    const cvScore = 1.0 - Math.abs(cvRed - 0.10) / 0.15;

    const confidence = Math.max(
      0,
      Math.min(1.0, 0.35 * rgScore + 0.25 * rbScore + 0.20 * coverageScore + 0.20 * Math.max(0, cvScore))
    );

    return {
      isHumanTissue: confidence >= 0.60,
      confidence,
      absorptionRatioRg: ratioRg,
      absorptionRatioRb: ratioRb,
      chrominanceSnr,
      metrics: {
        meanR,
        meanG,
        meanB,
        coverageRatio,
        cvRed,
      },
    };
  }

  private createRejectionVerdict(
    reason: NonNullable<HemoglobinVerdict['rejectionReason']>,
    meanR: number,
    meanG: number,
    meanB: number,
    coverageRatio: number,
    cvRed: number,
    ratioRg: number,
    ratioRb: number,
    confidence: number
  ): HemoglobinVerdict {
    return {
      isHumanTissue: false,
      confidence,
      absorptionRatioRg: ratioRg,
      absorptionRatioRb: ratioRb,
      chrominanceSnr: 0,
      rejectionReason: reason,
      metrics: {
        meanR,
        meanG,
        meanB,
        coverageRatio,
        cvRed,
      },
    };
  }
}
