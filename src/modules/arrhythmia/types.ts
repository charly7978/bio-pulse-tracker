/**
 * Tipos e interfaces para el subsistema de detección y clasificación de arritmias (Paso 6).
 */

export type RhythmType =
  | 'NORMAL_SINUS'
  | 'SINUS_BRADYCARDIA'
  | 'SINUS_TACHYCARDIA'
  | 'PREMATURE_VENTRICULAR_CONTRACTION'
  | 'PREMATURE_ATRIAL_CONTRACTION'
  | 'ATRIAL_FIBRILLATION_SUSPECTED'
  | 'INSUFFICIENT_DATA';

export interface ArrhythmiaEvent {
  timestampMs: number;
  type: RhythmType;
  description: string;
  rrIntervalMs: number;
  severity: 'NORMAL' | 'WARNING' | 'ALERT';
}

export interface ArrhythmiaDiagnosis {
  primaryRhythm: RhythmType;
  confidence: number;
  sampleEntropy: number;
  pvcCount: number;
  pacCount: number;
  events: ArrhythmiaEvent[];
  clinicalSummary: string;
}
