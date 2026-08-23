/**
 * ElgendiPeakDetector
 *
 * Algoritmo de dos ventanas móviles cuadráticas de Elgendi (2012, 2016)
 * con refinamiento polinomial sub-muestra Savitzky-Golay.
 *
 * Ventajas:
 * 1. Cero dependencia de umbrales fijos: el umbral es dinámico y sigue la envolvente de latido.
 * 2. Cuadratura de señal no lineal para suprimir armónicos y realzar picos sistólicos.
 * 3. Resolución temporal sub-muestra de < 2 ms.
 */

import { PeakDetectorConfig, DetectedPeak } from './types';
import { SavitzkyGolayRefiner } from './SavitzkyGolayRefiner';

export const DEFAULT_PEAK_CONFIG: PeakDetectorConfig = {
  sampleRate: 30,
  w1DurationSec: 0.111, // ~111 ms (pico sistólico)
  w2DurationSec: 0.667, // ~667 ms (latido cardíaco medio)
  betaOffset: 0.02,
  minPeakDistanceMs: 273, // 220 BPM max
};

export class ElgendiPeakDetector {
  private readonly config: PeakDetectorConfig;
  private readonly k1: number; // Ventana W1 en muestras
  private readonly k2: number; // Ventana W2 en muestras

  // Buffers circulares
  private readonly rawBuffer: number[] = [];
  private readonly squaredBuffer: number[] = [];
  private readonly bufferCapacity = 120; // 4 segundos a 30 Hz

  // Estado del bloque de interés
  private inBlockOfInterest = false;
  private blockStartIndex = 0;
  private blockMaxVal = -Infinity;
  private blockMaxIndex = 0;

  private lastPeakTimeMs = -Infinity;
  private totalSamplesProcessed = 0;

  constructor(config: Partial<PeakDetectorConfig> = {}) {
    this.config = { ...DEFAULT_PEAK_CONFIG, ...config };
    this.k1 = Math.max(1, Math.round(this.config.w1DurationSec * this.config.sampleRate));
    this.k2 = Math.max(3, Math.round(this.config.w2DurationSec * this.config.sampleRate));
  }

  /**
   * Procesa una nueva muestra de señal filtrada en tiempo real.
   * @returns DetectedPeak si se confirmó un pico en esta muestra, o null.
   */
  public processSample(sample: number, timestampMs: number): DetectedPeak | null {
    const s = Math.max(0, sample) ** 2; // Realce no lineal cuadrático
    this.rawBuffer.push(sample);
    this.squaredBuffer.push(s);

    if (this.rawBuffer.length > this.bufferCapacity) {
      this.rawBuffer.shift();
      this.squaredBuffer.shift();
    }

    this.totalSamplesProcessed++;
    const n = this.squaredBuffer.length;

    if (n < this.k2 + 2) {
      return null;
    }

    // 1. Media móvil W1 (Pico)
    let sumW1 = 0;
    for (let i = 0; i < this.k1; i++) sumW1 += this.squaredBuffer[n - 1 - i]!;
    const maPeak = sumW1 / this.k1;

    // 2. Media móvil W2 (Latido)
    let sumW2 = 0;
    for (let i = 0; i < this.k2; i++) sumW2 += this.squaredBuffer[n - 1 - i]!;
    const maBeat = sumW2 / this.k2;

    // 3. Media global cuadrática para offset beta
    let sumAll = 0;
    for (let i = 0; i < n; i++) sumAll += this.squaredBuffer[i]!;
    const meanSquared = sumAll / n;

    // 4. Umbral dinámico adaptativo
    const threshold = maBeat + this.config.betaOffset * meanSquared;

    let confirmedPeak: DetectedPeak | null = null;

    // 5. Máquina de estados del Bloque de Interés
    if (maPeak > threshold) {
      if (!this.inBlockOfInterest) {
        this.inBlockOfInterest = true;
        this.blockStartIndex = this.totalSamplesProcessed;
        this.blockMaxVal = sample;
        this.blockMaxIndex = n - 1;
      } else {
        if (sample > this.blockMaxVal) {
          this.blockMaxVal = sample;
          this.blockMaxIndex = n - 1;
        }
      }
    } else {
      if (this.inBlockOfInterest) {
        // Fin del bloque de interés
        const blockDurationSamples = this.totalSamplesProcessed - this.blockStartIndex;
        if (blockDurationSamples >= Math.floor(this.k1 / 2)) {
          // El bloque cumple con la duración mínima de un pico sistólico
          const peakBufIdx = this.blockMaxIndex;
          const dt = 1000 / this.config.sampleRate;

          let exactTimestamp = timestampMs - (n - 1 - peakBufIdx) * dt;
          let subSampleOffset = 0;
          let refinedAmp = this.blockMaxVal;

          // Refinamiento sub-muestra si hay 5 puntos alrededor del pico
          if (peakBufIdx >= 2 && peakBufIdx <= n - 3) {
            const ym2 = this.rawBuffer[peakBufIdx - 2]!;
            const ym1 = this.rawBuffer[peakBufIdx - 1]!;
            const y0 = this.rawBuffer[peakBufIdx]!;
            const yp1 = this.rawBuffer[peakBufIdx + 1]!;
            const yp2 = this.rawBuffer[peakBufIdx + 2]!;

            const refResult = SavitzkyGolayRefiner.refineVertex5(ym2, ym1, y0, yp1, yp2);
            if (refResult.isValidVertex) {
              subSampleOffset = refResult.delta;
              refinedAmp = refResult.refinedAmplitude;
              exactTimestamp += subSampleOffset * dt;
            }
          }

          // Validación de distancia mínima fisiológica (RR > 273 ms)
          if (exactTimestamp - this.lastPeakTimeMs >= this.config.minPeakDistanceMs) {
            this.lastPeakTimeMs = exactTimestamp;
            confirmedPeak = {
              index: this.totalSamplesProcessed - (n - 1 - peakBufIdx),
              subSampleOffset,
              exactTimestampMs: exactTimestamp,
              amplitude: refinedAmp,
              confidence: Math.min(1.0, Math.max(0.5, refinedAmp)),
            };
          }
        }
        this.inBlockOfInterest = false;
        this.blockMaxVal = -Infinity;
      }
    }

    return confirmedPeak;
  }

  /**
   * Resetea el estado y los buffers del detector.
   */
  public reset(): void {
    this.rawBuffer.length = 0;
    this.squaredBuffer.length = 0;
    this.inBlockOfInterest = false;
    this.blockMaxVal = -Infinity;
    this.lastPeakTimeMs = -Infinity;
    this.totalSamplesProcessed = 0;
  }
}
