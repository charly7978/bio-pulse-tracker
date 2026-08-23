/**
 * PpgSignalDenoisingPipeline
 *
 * Pipeline integral de filtrado digital y cancelación adaptativa de ruido óptico.
 * Integra:
 * 1. Pasabanda Butterworth [0.5 Hz - 4.0 Hz] (30 - 240 BPM).
 * 2. Cancelador adaptativo NLMS con referencia cromática azul de movimiento.
 * 3. Control automático de ganancia (AGC) fisiológico.
 */

import { ZeroPhaseBandpass } from './ZeroPhaseBandpass';
import { AdaptiveLmsCanceller } from './AdaptiveLmsCanceller';
import { PulseAgc } from './PulseAgc';
import { DenoisedSignalOutput } from './types';

export class PpgSignalDenoisingPipeline {
  private readonly greenBandpass: ZeroPhaseBandpass;
  private readonly blueBandpass: ZeroPhaseBandpass;
  private readonly lmsCanceller: AdaptiveLmsCanceller;
  private readonly pulseAgc: PulseAgc;

  constructor(sampleRate: number = 30) {
    this.greenBandpass = new ZeroPhaseBandpass({ sampleRate, lowCutHz: 0.5, highCutHz: 4.0 });
    this.blueBandpass = new ZeroPhaseBandpass({ sampleRate, lowCutHz: 0.5, highCutHz: 4.0 });
    this.lmsCanceller = new AdaptiveLmsCanceller({ filterOrder: 8, learningRate: 0.04 });
    this.pulseAgc = new PulseAgc({ targetAmplitude: 1.0 });
  }

  /**
   * Procesa una muestra multicanal en tiempo real.
   * @param rawGreen Canal verde extraído de la región capilar
   * @param rawBlue Canal azul extraído (referencia de ruido de superficie)
   */
  public processSample(rawGreen: number, rawBlue: number): DenoisedSignalOutput {
    // 1. Filtrado pasabanda fisiológico en ambos canales
    const bpGreen = this.greenBandpass.processSample(rawGreen);
    const bpBlue = this.blueBandpass.processSample(rawBlue);

    // 2. Cancelación adaptativa NLMS (d = bpGreen, ref = bpBlue)
    const { cleanSignal: lmsCleaned, estimatedNoise } = this.lmsCanceller.processSample(bpGreen, bpBlue);

    // 3. Normalización por AGC fisiológico
    const agcNormalized = this.pulseAgc.processSample(lmsCleaned);

    // 4. Estimación de mejora de SNR en dB
    const noisePower = estimatedNoise * estimatedNoise + 1e-6;
    const signalPower = lmsCleaned * lmsCleaned + 1e-6;
    const snrImprovementDb = Math.max(-10, Math.min(30, 10 * Math.log10(signalPower / noisePower)));

    return {
      rawGreen,
      rawBlue,
      bandpassFiltered: bpGreen,
      lmsNoiseEstimated: estimatedNoise,
      lmsCleaned,
      agcNormalized,
      snrImprovementDb,
    };
  }

  /**
   * Resetea todos los módulos del pipeline de filtrado.
   */
  public reset(): void {
    this.greenBandpass.reset();
    this.blueBandpass.reset();
    this.lmsCanceller.reset();
    this.pulseAgc.reset();
  }
}
