/**
 * Tipos e interfaces para el subsistema de detección de picos sistólicos (Paso 3).
 */

export interface DetectedPeak {
  index: number;
  subSampleOffset: number; // delta in [-0.5, 0.5]
  exactTimestampMs: number;
  amplitude: number;
  confidence: number;
}

export interface PeakDetectorConfig {
  sampleRate: number;
  w1DurationSec: number; // Ventana de pico sistólico (~111 ms)
  w2DurationSec: number; // Ventana de latido cardíaco (~667 ms)
  betaOffset: number;    // Factor de desplazamiento de umbral dinámico
  minPeakDistanceMs: number; // 273 ms -> 220 BPM max
}

export interface RrIntervalMetrics {
  rrIntervalMs: number;
  instantaneousBpm: number;
  smoothedBpm: number;
  confidence: number;
  isPhysiologicallyValid: boolean;
  isArrhythmiaCandidate: boolean;
}
