/**
 * Tipos e interfaces para el subsistema de signos vitales clínicos y HRV (Paso 4).
 */

export interface HrvMetrics {
  rmssdMs: number;
  sdnnMs: number;
  pnn50Ratio: number; // [0.0 - 1.0]
  sd1Ms: number;
  sd2Ms: number;
  stressIndex: number;
  sampleCount: number;
}

export interface Spo2Metrics {
  spo2Percent: number; // [70 - 100]
  rRatio: number;
  acRed: number;
  dcRed: number;
  acGreen: number;
  dcGreen: number;
  confidence: number;
}

export interface PulseWaveMetrics {
  crestTimeMs: number;
  augmentationIndexProxy: number;
  stiffnessIndexMs: number;
  estimatedSystolicMmHg: number;
  estimatedDiastolicMmHg: number;
}

export interface VitalSignsSnapshot {
  bpm: number;
  bpmSmoothed: number;
  hrv: HrvMetrics;
  spo2: Spo2Metrics;
  pwa: PulseWaveMetrics;
  timestampMs: number;
  overallConfidence: number;
}
