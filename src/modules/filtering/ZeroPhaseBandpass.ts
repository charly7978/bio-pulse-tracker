/**
 * ZeroPhaseBandpass
 *
 * Filtro pasabanda Butterworth de 4° orden (cascada de 2 biquads de 2° orden)
 * calibrado para la banda cardíaca fisiológica [0.5 Hz - 4.0 Hz] (30 - 240 BPM).
 * Incorpora cálculo analítico de coeficientes según la frecuencia de muestreo (fs).
 */

import { BandpassConfig } from './types';

export const DEFAULT_BANDPASS_CONFIG: BandpassConfig = {
  sampleRate: 30,
  lowCutHz: 0.5,
  highCutHz: 4.0,
};

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export class ZeroPhaseBandpass {
  private readonly config: BandpassConfig;
  private s1Coeffs!: BiquadCoeffs;
  private s2Coeffs!: BiquadCoeffs;
  private s1State: BiquadState = { x1: 0, x2: 0, y1: 0, y2: 0 };
  private s2State: BiquadState = { x1: 0, x2: 0, y1: 0, y2: 0 };

  constructor(config: Partial<BandpassConfig> = {}) {
    this.config = { ...DEFAULT_BANDPASS_CONFIG, ...config };
    this.calculateCoefficients();
  }

  /**
   * Calcula los coeficientes de 2 biquads Butterworth mediante transformación bilineal.
   */
  private calculateCoefficients(): void {
    const fs = this.config.sampleRate;
    const fL = this.config.lowCutHz;
    const fH = this.config.highCutHz;

    // Frecuencias angulares pre-warped
    const wL = 2 * fs * Math.tan((Math.PI * fL) / fs);
    const wH = 2 * fs * Math.tan((Math.PI * fH) / fs);
    const w0 = Math.sqrt(wL * wH);
    const bw = wH - wL;

    // Sección 1: Q = 1.30656 (polo par Butterworth 4° orden)
    const q1 = 1.30656;
    const alpha1 = bw / (2 * q1);
    const beta1 = Math.sqrt(w0 * w0 - alpha1 * alpha1);
    this.s1Coeffs = this.bilinearSection(alpha1, beta1, w0, fs);

    // Sección 2: Q = 0.541196 (polo par Butterworth 4° orden)
    const q2 = 0.541196;
    const alpha2 = bw / (2 * q2);
    const beta2 = Math.sqrt(w0 * w0 - alpha2 * alpha2);
    this.s2Coeffs = this.bilinearSection(alpha2, beta2, w0, fs);
  }

  private bilinearSection(alpha: number, _beta: number, w0: number, fs: number): BiquadCoeffs {
    const c = 2 * fs;
    const c2 = c * c;
    const w02 = w0 * w0;
    const gamma = 2 * alpha * c;

    const a0 = c2 + gamma + w02;
    const a1 = 2 * (w02 - c2) / a0;
    const a2 = (c2 - gamma + w02) / a0;

    const b0 = gamma / a0;
    const b1 = 0;
    const b2 = -gamma / a0;

    return { b0, b1, b2, a1, a2 };
  }

  /**
   * Filtra una muestra individual mediante la cascada de 2 biquads.
   */
  public processSample(x: number): number {
    // Paso por Biquad 1
    const y1 = this.processBiquad(x, this.s1Coeffs, this.s1State);
    // Paso por Biquad 2
    const y2 = this.processBiquad(y1, this.s2Coeffs, this.s2State);
    return y2;
  }

  private processBiquad(x: number, c: BiquadCoeffs, s: BiquadState): number {
    const y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
    s.x2 = s.x1;
    s.x1 = x;
    s.y2 = s.y1;
    s.y1 = y;
    return y;
  }

  /**
   * Resetea los estados internos de ambos biquads.
   */
  public reset(): void {
    this.s1State = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.s2State = { x1: 0, x2: 0, y1: 0, y2: 0 };
  }
}
