/**
 * PulseWaveAnalysisEngine
 *
 * Análisis de Morfología de Onda de Pulso (PWA) y estimación hemodinámica.
 * Calcula el tiempo de cresta sistólica (Crest Time), índice de rigidez arterial (Stiffness Index)
 * y estimación de presión arterial no invasiva (Elgendi 2012, Millasseau et al. 2006).
 *
 * ADVERTENCIA CLÍNICA: La PA derivada de PPG de un solo sitio sin calibración
 * es ESTIMACIÓN (proxy) no medida esfigmomanométrica. El motor lo etiqueta explícitamente.
 */

import { PulseWaveMetrics } from './types';

export class PulseWaveAnalysisEngine {
  private lastCrestTimeMs = 0;
  private lastStiffnessMs = 0;
  private estimatedSystolic = 0;
  private estimatedDiastolic = 0;
  private hasValidSample = false;

  /**
   * Analiza un ciclo de pulso individual delimitado por el pie diastólico y el pico sistólico.
   * @param crestTimeMs Tiempo en ms desde el inicio del pulso hasta el pico sistólico — MEDIDO del trazado (derivado 0.19*RR si no hay detección morfológica directa).
   * @param totalCycleMs Duración total del ciclo RR en ms — MEDIDO del intervalo RR.
   * @param currentBpm Frecuencia cardíaca actual
   * @returns métricas PWA; si no hay muestra válida aún, retorna 0s para no fabricar 120/80 fantasma.
   */
  public analyzePulseCycle(
    crestTimeMs: number,
    totalCycleMs: number,
    currentBpm: number
  ): PulseWaveMetrics {
    // Sin medición válida aún => retornar 0s y no sembrar fantasma
    const isCrestValid = crestTimeMs >= 60 && crestTimeMs <= 250;
    const isCycleValid = totalCycleMs >= 273 && totalCycleMs <= 2000 && currentBpm >= 30 && currentBpm <= 220;

    if (!isCrestValid || !isCycleValid) {
      if (!this.hasValidSample) {
        return {
          crestTimeMs: 0,
          augmentationIndexProxy: 0,
          stiffnessIndexMs: 0,
          estimatedSystolicMmHg: 0,
          estimatedDiastolicMmHg: 0,
        };
      }
      // Mantener último válido sin avanzar modelo con dato inválido
      const aixProxyHold = Math.max(0.1, Math.min(0.9, (150 - this.lastCrestTimeMs) / 100));
      return {
        crestTimeMs: Math.round(this.lastCrestTimeMs),
        augmentationIndexProxy: Math.round(aixProxyHold * 100) / 100,
        stiffnessIndexMs: Math.round(this.lastStiffnessMs),
        estimatedSystolicMmHg: Math.round(this.estimatedSystolic),
        estimatedDiastolicMmHg: Math.round(this.estimatedDiastolic),
      };
    }

    if (!this.hasValidSample) {
      // Primer ciclo válido: inicialización directa sin EMA fantasma — rango extendido 70-220 sistólica para no ocultar crisis
      this.lastCrestTimeMs = crestTimeMs;
      this.lastStiffnessMs = (crestTimeMs / totalCycleMs) * 1000;
      this.estimatedSystolic = Math.max(70, Math.min(220, 118 + (currentBpm - 70) * 0.35 + (130 - crestTimeMs) * 0.25));
      this.estimatedDiastolic = Math.max(40, Math.min(130, 78 + (currentBpm - 70) * 0.35 * 0.4 + (130 - crestTimeMs) * 0.25 * 0.15));
      this.hasValidSample = true;
    } else {
      this.lastCrestTimeMs = this.lastCrestTimeMs * 0.85 + crestTimeMs * 0.15;
      const stiffnessProxy = (this.lastCrestTimeMs / totalCycleMs) * 1000;
      this.lastStiffnessMs = this.lastStiffnessMs * 0.90 + stiffnessProxy * 0.10;

      const bpmDelta = (currentBpm - 70) * 0.35;
      const stiffnessDelta = (130 - this.lastCrestTimeMs) * 0.25;
      const targetSystolic = Math.max(70, Math.min(220, 118 + bpmDelta + stiffnessDelta));
      const targetDiastolic = Math.max(40, Math.min(130, 78 + bpmDelta * 0.4 + stiffnessDelta * 0.15));
      this.estimatedSystolic = this.estimatedSystolic * 0.92 + targetSystolic * 0.08;
      this.estimatedDiastolic = this.estimatedDiastolic * 0.92 + targetDiastolic * 0.08;
    }

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
    this.lastCrestTimeMs = 0;
    this.lastStiffnessMs = 0;
    this.estimatedSystolic = 0;
    this.estimatedDiastolic = 0;
    this.hasValidSample = false;
  }
}
