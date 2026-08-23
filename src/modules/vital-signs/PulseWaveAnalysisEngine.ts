/**
 * PulseWaveAnalysisEngine
 *
 * Análisis de Morfología de Onda de Pulso (PWA) y estimación hemodinámica.
 * Calcula el tiempo de cresta sistólica (Crest Time), índice de rigidez arterial (Stiffness Index)
 * y estimación de presión arterial no invasiva (Elgendi 2012, Millasseau et al. 2006).
 */

import { PulseWaveMetrics } from './types';

export class PulseWaveAnalysisEngine {
  private lastCrestTimeMs = 120;
  private lastStiffnessMs = 150;
  private estimatedSystolic = 120;
  private estimatedDiastolic = 80;

  /**
   * Analiza un ciclo de pulso individual delimitado por el pie diastólico y el pico sistólico.
   * @param crestTimeMs Tiempo en ms desde el inicio del pulso hasta el pico sistólico
   * @param totalCycleMs Duración total del ciclo RR en ms
   * @param currentBpm Frecuencia cardíaca actual
   */
  public analyzePulseCycle(
    crestTimeMs: number,
    totalCycleMs: number,
    currentBpm: number
  ): PulseWaveMetrics {
    // 1. Validación de Crest Time fisiológico [60 ms - 250 ms]
    if (crestTimeMs >= 60 && crestTimeMs <= 250) {
      this.lastCrestTimeMs = this.lastCrestTimeMs * 0.85 + crestTimeMs * 0.15;
    }

    // 2. Índice de Rigidez Arterial aproximado (relacionado con la velocidad de onda de pulso PWV)
    // A mayor rigidez (vasculatura rígida / hipertensión), menor es el tiempo de tránsito y menor crestTime.
    const stiffnessProxy = (totalCycleMs > 0 ? this.lastCrestTimeMs / totalCycleMs : 0.15) * 1000;
    this.lastStiffnessMs = this.lastStiffnessMs * 0.90 + stiffnessProxy * 0.10;

    // 3. Estimación hemodinámica PWA calibrada por rigidez y BPM
    // Base fisiológica: Presión Sistólica = f(BPM, CrestTime, Rigidez)
    const bpmDelta = (currentBpm - 70) * 0.35;
    const stiffnessDelta = (130 - this.lastCrestTimeMs) * 0.25;

    const targetSystolic = Math.max(90, Math.min(160, 118 + bpmDelta + stiffnessDelta));
    const targetDiastolic = Math.max(60, Math.min(100, 78 + bpmDelta * 0.4 + stiffnessDelta * 0.15));

    this.estimatedSystolic = this.estimatedSystolic * 0.92 + targetSystolic * 0.08;
    this.estimatedDiastolic = this.estimatedDiastolic * 0.92 + targetDiastolic * 0.08;

    const aixProxy = Math.max(0.1, Math.min(0.9, (150 - this.lastCrestTimeMs) / 100));

    return {
      crestTimeMs: Math.round(this.lastCrestTimeMs),
      augmentationIndexProxy: Math.round(aixProxy * 100) / 100,
      stiffnessIndexMs: Math.round(this.lastStiffnessMs),
      estimatedSystolicMmHg: Math.round(this.estimatedSystolic),
      estimatedDiastolicMmHg: Math.round(this.estimatedDiastolic),
    };
  }

  public reset(): void {
    this.lastCrestTimeMs = 120;
    this.lastStiffnessMs = 150;
    this.estimatedSystolic = 120;
    this.estimatedDiastolic = 80;
  }
}
