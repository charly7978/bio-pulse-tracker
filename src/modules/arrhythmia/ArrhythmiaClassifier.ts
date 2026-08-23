/**
 * ArrhythmiaClassifier
 *
 * Clasificador fisiológico multivariable de arritmias cardíacas en tiempo real.
 * Integra criterios de:
 * 1. Frecuencia basal (Bradicardia < 50 BPM, Taquicardia > 100 BPM).
 * 2. Detección de latidos ectópicos prematuros (PVC con pausa compensatoria vs PAC).
 * 3. Detección de Fibrilación Auricular mediante Entropía Muestral (SampEn) y dispersión RMSSD (Chong et al. 2015).
 */

import { ArrhythmiaDiagnosis, ArrhythmiaEvent, RhythmType } from './types';
import { SampleEntropyCalculator } from './SampleEntropyCalculator';

export class ArrhythmiaClassifier {
  private readonly rrHistory: number[] = [];
  private readonly events: ArrhythmiaEvent[] = [];
  private pvcCount = 0;
  private pacCount = 0;
  private readonly maxHistory = 40;

  /**
   * Procesa un nuevo intervalo RR y actualiza el diagnóstico en tiempo real.
   */
  public processInterval(
    rrMs: number,
    currentBpm: number,
    rmssdMs: number,
    timestampMs: number
  ): ArrhythmiaDiagnosis {
    this.rrHistory.push(rrMs);
    if (this.rrHistory.length > this.maxHistory) {
      this.rrHistory.shift();
    }

    const n = this.rrHistory.length;

    if (n < 8) {
      return {
        primaryRhythm: 'INSUFFICIENT_DATA',
        confidence: 0.3,
        sampleEntropy: 0,
        pvcCount: this.pvcCount,
        pacCount: this.pacCount,
        events: [...this.events],
        clinicalSummary: 'Recopilando datos basales (mínimo 8 latidos)...',
      };
    }

    // 1. Media de intervalos RR basales
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.rrHistory[i]!;
    const meanRr = sum / n;

    // 2. Análisis del último acoplamiento para detectar latidos ectópicos (PVC / PAC)
    if (n >= 3) {
      const prevRr = this.rrHistory[n - 2]!;
      const currRr = this.rrHistory[n - 1]!;

      // Si el latido previo fue prematuro (RR < 80% de la media)
      if (prevRr <= 0.80 * meanRr) {
        // Pausa compensatoria completa (prev + curr >= 1.85 * mean) -> PVC
        if (prevRr + currRr >= 1.85 * meanRr) {
          this.pvcCount++;
          this.events.push({
            timestampMs,
            type: 'PREMATURE_VENTRICULAR_CONTRACTION',
            description: `Extrasístole Ventricular Prematura (RR: ${Math.round(prevRr)}ms, Pausa: ${Math.round(currRr)}ms)`,
            rrIntervalMs: prevRr,
            severity: 'WARNING',
          });
        } else {
          // Pausa no compensatoria -> PAC
          this.pacCount++;
          this.events.push({
            timestampMs,
            type: 'PREMATURE_ATRIAL_CONTRACTION',
            description: `Extrasístole Auricular Prematura (RR: ${Math.round(prevRr)}ms)`,
            rrIntervalMs: prevRr,
            severity: 'WARNING',
          });
        }
      }
    }

    // Mantener los últimos 15 eventos
    if (this.events.length > 15) {
      this.events.shift();
    }

    // 3. Cálculo de Entropía Muestral (SampEn)
    const sampEn = SampleEntropyCalculator.calculate(this.rrHistory, 2, 0.2);

    // 4. Clasificación de Ritmo Principal
    let primaryRhythm: RhythmType = 'NORMAL_SINUS';
    let confidence = 0.85;
    let clinicalSummary = 'Ritmo sinusal normal y regular.';

    // Fibrilación Auricular sospechosa (alta entropía + alta dispersión RMSSD)
    if (n >= 15 && sampEn > 1.65 && rmssdMs > 75) {
      primaryRhythm = 'ATRIAL_FIBRILLATION_SUSPECTED';
      confidence = 0.80;
      clinicalSummary = 'Sospecha de Fibrilación Auricular: Ritmo irregularmente irregular con alta entropía.';
    } else if (currentBpm > 100) {
      primaryRhythm = 'SINUS_TACHYCARDIA';
      confidence = 0.90;
      clinicalSummary = `Taquicardia Sinusal (${currentBpm} BPM en reposo).`;
    } else if (currentBpm < 50 && currentBpm > 0) {
      primaryRhythm = 'SINUS_BRADYCARDIA';
      confidence = 0.90;
      clinicalSummary = `Bradicardia Sinusal (${currentBpm} BPM en reposo).`;
    } else if (this.pvcCount > 0 && this.pvcCount > n * 0.15) {
      primaryRhythm = 'PREMATURE_VENTRICULAR_CONTRACTION';
      confidence = 0.85;
      clinicalSummary = `Frecuentes Extrasístoles Ventriculares Prematuras (${this.pvcCount} detectadas).`;
    }

    return {
      primaryRhythm,
      confidence,
      sampleEntropy: Math.round(sampEn * 100) / 100,
      pvcCount: this.pvcCount,
      pacCount: this.pacCount,
      events: [...this.events],
      clinicalSummary,
    };
  }

  public reset(): void {
    this.rrHistory.length = 0;
    this.events.length = 0;
    this.pvcCount = 0;
    this.pacCount = 0;
  }
}
