/**
 * Tipos e interfaces para el subsistema de filtrado DSP y cancelación adaptativa de ruido (Paso 2).
 */

export interface LmsConfig {
  filterOrder: number;
  learningRate: number; // mu
  leakageFactor: number; // gamma
  regularization: number; // epsilon
}

export interface BandpassConfig {
  sampleRate: number;
  lowCutHz: number;
  highCutHz: number;
}

export interface AgcConfig {
  targetAmplitude: number;
  minGain: number;
  maxGain: number;
  attackRate: number;
  decayRate: number;
}

export interface DenoisedSignalOutput {
  rawGreen: number;
  rawBlue: number;
  bandpassFiltered: number;
  lmsNoiseEstimated: number;
  lmsCleaned: number;
  agcNormalized: number;
  snrImprovementDb: number;
}
