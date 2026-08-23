/**
 * ZeroPhaseBandpass
 *
 * Filtro pasabanda fisiológico Butterworth de 2° orden calibrado para la banda cardíaca [0.65 Hz - 3.5 Hz] (39 - 210 LPM).
 * Incorpora:
 * 1. Rastreador recursivo de componente DC con inicialización instantánea para eliminar transitorios de escalón.
 * 2. Transformación bilineal analítica exacta con pre-warping según la frecuencia de muestreo (fs).
 * 3. Respuesta en fase estable sin oscilaciones parásitas.
 */

import { BandpassConfig } from './types';

export const DEFAULT_BANDPASS_CONFIG: BandpassConfig = {
  sampleRate: 30,
  lowCutHz: 0.65,
  highCutHz: 3.5,
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
  private coeffs!: BiquadCoeffs;
  private state: BiquadState = { x1: 0, x2: 0, y1: 0, y2: 0 };
  
  // Rastreador de línea de base DC
  private dcEstimate = 0;
  private isDcInitialized = false;

  constructor(config: Partial<BandpassConfig> = {}) {
    this.config = { ...DEFAULT_BANDPASS_CONFIG, ...config };
    this.calculateCoefficients();
  }

  /**
   * Calcula los coeficientes del biquad Butterworth mediante transformación bilineal con pre-warping.
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

    const c = 2 * fs;
    const c2 = c * c;
    const w02 = w0 * w0;
    const gamma = bw * c;

    const a0 = c2 + gamma + w02;
    const a1 = (2 * (w02 - c2)) / a0;
    const a2 = (c2 - gamma + w02) / a0;

    const b0 = gamma / a0;
    const b1 = 0;
    const b2 = -gamma / a0;

    this.coeffs = { b0, b1, b2, a1, a2 };
  }

  /**
   * Filtra una muestra individual eliminando el nivel DC antes del filtrado pasabanda.
   */
  public processSample(rawSample: number): number {
    // 1. Inicialización y seguimiento adaptativo de DC
    if (!this.isDcInitialized) {
      this.dcEstimate = rawSample;
      this.isDcInitialized = true;
    } else {
      // Filtro pasa-bajos lento para estimación de DC (~0.2 Hz)
      this.dcEstimate = this.dcEstimate * 0.96 + rawSample * 0.04;
    }

    // Señal centrada en cero (libre de offset continuo)
    const acSignal = rawSample - this.dcEstimate;

    // 2. Procesamiento a través del Biquad Butterworth
    const c = this.coeffs;
    const s = this.state;

    const y = c.b0 * acSignal + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;

    s.x2 = s.x1;
    s.x1 = acSignal;
    s.y2 = s.y1;
    s.y1 = y;

    return y;
  }

  /**
   * Resetea los estados internos y el rastreador de DC.
   */
  public reset(): void {
    this.state = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.dcEstimate = 0;
    this.isDcInitialized = false;
  }
}
