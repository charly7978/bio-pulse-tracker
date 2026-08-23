/**
 * AdaptiveLmsCanceller
 *
 * Filtro adaptativo NLMS (Normalized Least Mean Squares) con factor de fuga (leakage)
 * para cancelación en tiempo real de artefactos de movimiento y fluctuación lumínica.
 * Utiliza el canal Azul (o referencia externa de aceleración) como referencia de ruido
 * no correlacionada con la absorción arterial profunda (Wang et al. 2017).
 */

import { LmsConfig } from './types';

export const DEFAULT_LMS_CONFIG: LmsConfig = {
  filterOrder: 8,
  learningRate: 0.05,
  leakageFactor: 0.001,
  regularization: 1e-4,
};

export class AdaptiveLmsCanceller {
  private readonly config: LmsConfig;
  private readonly weights: Float64Array;
  private readonly refBuffer: Float64Array;
  private bufferIndex = 0;

  constructor(config: Partial<LmsConfig> = {}) {
    this.config = { ...DEFAULT_LMS_CONFIG, ...config };
    this.weights = new Float64Array(this.config.filterOrder);
    this.refBuffer = new Float64Array(this.config.filterOrder);
  }

  /**
   * Procesa una muestra de señal primaria deseada (d) y una muestra de ruido de referencia (ref).
   * @param primarySignal Muestra de señal deseada (ej. canal Verde)
   * @param noiseReference Muestra de referencia de ruido (ej. canal Azul)
   * @returns Objeto con la señal limpia 'error' e interferencia estimada 'estimatedNoise'
   */
  public processSample(primarySignal: number, noiseReference: number): { cleanSignal: number; estimatedNoise: number } {
    const order = this.config.filterOrder;
    const { learningRate, leakageFactor, regularization } = this.config;

    // 1. Insertar nueva referencia en el buffer circular
    this.refBuffer[this.bufferIndex] = noiseReference;
    this.bufferIndex = (this.bufferIndex + 1) % order;

    // 2. Calcular salida estimada del filtro: y = sum(w[k] * x[n-k])
    let estimatedNoise = 0;
    let refEnergy = 0;

    for (let k = 0; k < order; k++) {
      const idx = (this.bufferIndex - 1 - k + order) % order;
      const refVal = this.refBuffer[idx]!;
      estimatedNoise += this.weights[k]! * refVal;
      refEnergy += refVal * refVal;
    }

    // 3. Señal limpia resultante (error e = d - y)
    const cleanSignal = primarySignal - estimatedNoise;

    // 4. Adaptación normalizada de pesos con fuga para evitar deriva numérica
    const normFactor = learningRate / (refEnergy + regularization);
    for (let k = 0; k < order; k++) {
      const idx = (this.bufferIndex - 1 - k + order) % order;
      const refVal = this.refBuffer[idx]!;
      this.weights[k] = (1.0 - leakageFactor) * this.weights[k]! + normFactor * cleanSignal * refVal;
    }

    return { cleanSignal, estimatedNoise };
  }

  /**
   * Resetea los pesos y el buffer de referencia.
   */
  public reset(): void {
    this.weights.fill(0);
    this.refBuffer.fill(0);
    this.bufferIndex = 0;
  }
}
