/**
 * HrvEngine
 *
 * Motor de Variabilidad de la Frecuencia Cardíaca (HRV) según las directrices de la
 * Task Force of ESC/NASPE (1996) y Tarvainen et al. (2014).
 * Calcula RMSSD, SDNN, pNN50 y métricas de dispersión no lineal de Poincaré (SD1, SD2).
 */

import { HrvMetrics } from './types';

export class HrvEngine {
  private readonly rrBuffer: number[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = 30) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Agrega un nuevo intervalo RR válido en milisegundos.
   */
  public pushRrInterval(rrMs: number): void {
    if (rrMs < 270 || rrMs > 2000) return; // Filtrado de intervalos no fisiológicos

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
    if (n < 4) {
      return {
        rmssdMs: 0,
        sdnnMs: 0,
        pnn50Ratio: 0,
        sd1Ms: 0,
        sd2Ms: 0,
        stressIndex: 1.0,
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

    const rmssd = Math.sqrt(diffSqSum / (n - 1));
    const pnn50Ratio = count50 / (n - 1);

    // 3. Métricas de Poincaré (SD1 = variabilidad a corto plazo, SD2 = a largo plazo)
    const sd1 = rmssd / Math.SQRT2;
    const sd2Arg = 2 * sdnn * sdnn - 0.5 * rmssd * rmssd;
    const sd2 = Math.sqrt(Math.max(0, sd2Arg));

    // Stress Index proxy (proporción simpático-vagal SD2 / SD1)
    const stressIndex = sd1 > 1e-3 ? sd2 / sd1 : 1.0;

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
