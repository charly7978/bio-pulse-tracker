/**
 * HrvEngine
 *
 * Motor de Variabilidad de la Frecuencia Cardíaca (HRV) según las directrices de la
 * Task Force of ESC/NASPE (1996) y Tarvainen et al. (2014).
 * Calcula RMSSD, SDNN, pNN50 y métricas de dispersión no lineal de Poincaré (SD1, SD2).
 * Incorpora filtrado estricto de intervalos ectópicos para evitar mediciones anómalas.
 */

import { HrvMetrics } from './types';

export class HrvEngine {
  private readonly rrBuffer: number[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = 30) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Agrega un nuevo intervalo RR válido en milisegundos con filtrado de ectopias.
   */
  public pushRrInterval(rrMs: number): void {
    // 1. Filtrado de límites fisiológicos absolutos [300 ms - 1800 ms] (33 - 200 LPM)
    if (rrMs < 300 || rrMs > 1800) return;

    // 2. Filtrado de saltos no fisiológicos respecto al último intervalo registrado
    if (this.rrBuffer.length > 0) {
      const lastRr = this.rrBuffer[this.rrBuffer.length - 1]!;
      const delta = Math.abs(rrMs - lastRr);
      // Un salto mayor a 280 ms en un solo latido se clasifica como artefacto o latido perdido
      if (delta > 280) {
        return;
      }
    }

    this.rrBuffer.push(rrMs);
    if (this.rrBuffer.length > this.maxCapacity) {
      this.rrBuffer.shift();
    }
  }

  /**
   * Calcula las métricas de HRV actuales sobre los intervalos acumulados.
   */
  public computeMetrics(): HrvMetrics {
    const n = this.rrBuffer.length;
    if (n < 5) {
      return {
        rmssdMs: 0,
        sdnnMs: 0,
        pnn50Ratio: 0,
        sd1Ms: 0,
        sd2Ms: 0,
        stressIndex: 0,
        sampleCount: n,
      };
    }

    // 1. Media y SDNN
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.rrBuffer[i]!;
    const mean = sum / n;

    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const diff = this.rrBuffer[i]! - mean;
      varSum += diff * diff;
    }
    const sdnn = Math.sqrt(varSum / (n - 1));

    // 2. RMSSD y pNN50
    let diffSqSum = 0;
    let count50 = 0;

    for (let i = 0; i < n - 1; i++) {
      const succDiff = this.rrBuffer[i + 1]! - this.rrBuffer[i]!;
      diffSqSum += succDiff * succDiff;
      if (Math.abs(succDiff) > 50) {
        count50++;
      }
    }

    const rawRmssd = Math.sqrt(diffSqSum / (n - 1));
    const pnn50Ratio = count50 / (n - 1);

    // RMSSD fisiológico — no clamp inferior artificial de 10ms que enmascara bradicardia vagal;
    // clamp inferior 1ms para evitar artefacto, superior 250ms documentado
    const rmssd = Math.min(250, Math.max(1, rawRmssd));

    // 3. Métricas de Poincaré
    const sd1 = rmssd / Math.SQRT2;
    const sd2Arg = 2 * sdnn * sdnn - 0.5 * rmssd * rmssd;
    const sd2 = Math.sqrt(Math.max(0, sd2Arg));

    // Stress Index proxy (proporción simpático-vagal SD2 / SD1) — sin dato -> 0, no 1.0 fantasma
    const stressIndex = sd1 > 1e-3 ? Math.min(10, sd2 / sd1) : 0;

    return {
      rmssdMs: Math.round(rmssd * 10) / 10,
      sdnnMs: Math.round(sdnn * 10) / 10,
      pnn50Ratio: Math.round(pnn50Ratio * 100) / 100,
      sd1Ms: Math.round(sd1 * 10) / 10,
      sd2Ms: Math.round(sd2 * 10) / 10,
      stressIndex: Math.round(stressIndex * 10) / 10,
      sampleCount: n,
    };
  }

  public reset(): void {
    this.rrBuffer.length = 0;
  }
}
