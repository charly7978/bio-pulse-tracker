/**
 * PulseAgc
 *
 * Control Automático de Ganancia (AGC) fisiológico con limitador hiperbólico suave tanh(x).
 * Características:
 * 1. Estimación continua de energía RMS con tasas asimétricas de ataque y decaimiento.
 * 2. Ganancia acotada estrictamente en [0.5, 6.0] para prevenir amplificación de ruido o desbordamiento.
 * 3. Compresión no lineal tanh() que garantiza que la señal esté acotada en (-1.0, 1.0) sin recortar la morfología dícrota.
 */

import { AgcConfig } from './types';

export const DEFAULT_AGC_CONFIG: AgcConfig = {
  targetAmplitude: 0.85,
  minGain: 0.5,
  maxGain: 6.0,
  attackRate: 0.08,
  decayRate: 0.02,
};

export class PulseAgc {
  private readonly config: AgcConfig;
  private currentGain = 1.5;
  private rollingRms = 0.3;

  constructor(config: Partial<AgcConfig> = {}) {
    this.config = { ...DEFAULT_AGC_CONFIG, ...config };
  }

  /**
   * Procesa una muestra AC y aplica ganancia normalizada con limitador suave tanh.
   */
  public processSample(sample: number): number {
    const absVal = Math.abs(sample);

    // 1. Seguimiento adaptativo de envolvente RMS / amplitud
    if (absVal > this.rollingRms) {
      this.rollingRms = this.rollingRms * (1 - this.config.attackRate) + absVal * this.config.attackRate;
    } else {
      this.rollingRms = this.rollingRms * (1 - this.config.decayRate) + absVal * this.config.decayRate;
    }

    const safeRms = Math.max(0.08, this.rollingRms);

    // 2. Ganancia adaptativa acotada
    const desiredGain = this.config.targetAmplitude / safeRms;
    const clampedGain = Math.max(this.config.minGain, Math.min(this.config.maxGain, desiredGain));

    // 3. Suavizado temporal de ganancia para evitar distorsiones de ciclo
    this.currentGain = this.currentGain * 0.94 + clampedGain * 0.06;

    // 4. Salida normalizada con compresión sigmoidal tanh
    const scaledSample = sample * this.currentGain;
    return Math.tanh(scaledSample);
  }

  public getGain(): number {
    return this.currentGain;
  }

  public reset(): void {
    this.currentGain = 1.5;
    this.rollingRms = 0.3;
  }
}
