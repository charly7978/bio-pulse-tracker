/**
 * Spo2Engine
 *
 * Motor de estimación de saturación arterial de oxígeno (SpO2 %) mediante el método
 * óptico de razón de razones (R-ratio) adaptado a cámaras de smartphone (Webster 1997, Chatterjee 2018).
 *
 * Fórmula de Calibración:
 * R = (AC_red / DC_red) / (AC_green / DC_green)
 * SpO2 = 110.0 - 25.0 * R
 */

import { Spo2Metrics } from './types';

export class Spo2Engine {
  private readonly redBuffer: number[] = [];
  private readonly greenBuffer: number[] = [];
  private readonly windowSize: number;
  private smoothedSpo2 = 98.0;

  constructor(windowSize: number = 60) {
    this.windowSize = windowSize; // 2 segundos a 30 Hz
  }

  /**
   * Ingresa una muestra de intensidad de rojo y verde.
   */
  public pushSample(rawRed: number, rawGreen: number): void {
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);

    if (this.redBuffer.length > this.windowSize) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
  }

  /**
   * Calcula las métricas de SpO2 actuales.
   */
  public computeSpo2(sqi: number = 1.0): Spo2Metrics {
    const n = this.redBuffer.length;
    if (n < 30) {
      return {
        spo2Percent: 98.0,
        rRatio: 0.5,
        acRed: 0,
        dcRed: 0,
        acGreen: 0,
        dcGreen: 0,
        confidence: 0,
      };
    }

    // 1. Cálculo DC (media) y AC (desviación o pico a pico) para canal Rojo
    let sumR = 0;
    let minR = Infinity;
    let maxR = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = this.redBuffer[i]!;
      sumR += v;
      if (v < minR) minR = v;
      if (v > maxR) maxR = v;
    }
    const dcRed = sumR / n;
    const acRed = maxR - minR;

    // 2. Cálculo DC y AC para canal Verde
    let sumG = 0;
    let minG = Infinity;
    let maxG = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = this.greenBuffer[i]!;
      sumG += v;
      if (v < minG) minG = v;
      if (v > maxG) maxG = v;
    }
    const dcGreen = sumG / n;
    const acGreen = maxG - minG;

    // 3. R-ratio
    const piRed = dcRed > 1e-3 ? acRed / dcRed : 0;
    const piGreen = dcGreen > 1e-3 ? acGreen / dcGreen : 0;

    let rRatio = 0.5;
    if (piGreen > 1e-5) {
      rRatio = piRed / piGreen;
    }

    // 4. Curva de calibración fisiológica: SpO2 = 110 - 25 * R
    const rawSpo2 = Math.max(75.0, Math.min(100.0, 110.0 - 25.0 * rRatio));

    // 5. Suavizado dependiente de la calidad SQI
    const alpha = Math.max(0.02, Math.min(0.20, 0.10 * sqi));
    this.smoothedSpo2 = this.smoothedSpo2 * (1 - alpha) + rawSpo2 * alpha;

    return {
      spo2Percent: Math.round(this.smoothedSpo2 * 10) / 10,
      rRatio: Math.round(rRatio * 1000) / 1000,
      acRed: Math.round(acRed * 10) / 10,
      dcRed: Math.round(dcRed * 10) / 10,
      acGreen: Math.round(acGreen * 10) / 10,
      dcGreen: Math.round(dcGreen * 10) / 10,
      confidence: Math.max(0, Math.min(1.0, sqi * (piGreen > 0.001 ? 1.0 : 0.5))),
    };
  }

  public reset(): void {
    this.redBuffer.length = 0;
    this.greenBuffer.length = 0;
    this.smoothedSpo2 = 98.0;
  }
}
