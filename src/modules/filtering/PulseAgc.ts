/**
 * PulseAgc
 *
 * Control Automático de Ganancia (AGC) fisiológico con seguimiento asimétrico
 * de envolvente (ataque rápido y decaimiento suave).
 * Normaliza la amplitud del pulso arterial independientemente del tono de piel,
 * grosor dérmico o vasoconstricción periférica.
 */

import { AgcConfig } from './types';

export const DEFAULT_AGC_CONFIG: AgcConfig = {
  targetAmplitude: 1.0,
  minGain: 0.1,
  maxGain: 40.0,
  attackRate: 0.15, // Rápido para evitar sobre-modulación
  decayRate: 0.02,  // Suave y continuo para adaptarse en ~1-2 segundos
};

export class PulseAgc {
  private readonly config: AgcConfig;
  private currentGain = 1.0;
  private peakEnvelope = 0.5;

  constructor(config: Partial<AgcConfig> = {}) {
    this.config = { ...DEFAULT_AGC_CONFIG, ...config };
  }

  /**
   * Procesa una muestra centrada y aplica la ganancia normalizada adaptativa.
   */
  public processSample(sample: number): number {
    const absVal = Math.abs(sample);

    // 1. Seguimiento de envolvente asimétrico
    if (absVal > this.peakEnvelope) {
      // Ataque: el pico actual excede la envolvente
      this.peakEnvelope = this.peakEnvelope * (1 - this.config.attackRate) + absVal * this.config.attackRate;
    } else {
      // Decaimiento: la señal es menor a la envolvente previa
      this.peakEnvelope = this.peakEnvelope * (1 - this.config.decayRate) + absVal * this.config.decayRate;
    }

    this.peakEnvelope = Math.max(1e-4, this.peakEnvelope);

    // 2. Ganancia objetivo
    const desiredGain = this.config.targetAmplitude / this.peakEnvelope;
    const clampedGain = Math.max(this.config.minGain, Math.min(this.config.maxGain, desiredGain));

    // 3. Suavizado de ganancia para evitar distorsión armónica
    this.currentGain = this.currentGain * 0.90 + clampedGain * 0.10;

    // 4. Salida normalizada
    return sample * this.currentGain;
  }

  public getGain(): number {
    return this.currentGain;
  }

  public reset(): void {
    this.currentGain = 1.0;
    this.peakEnvelope = 0.5;
  }
}
