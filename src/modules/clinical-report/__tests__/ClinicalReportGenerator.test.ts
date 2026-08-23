import { describe, it, expect } from 'vitest';
import { ClinicalReportGenerator, MeasurementSessionReport } from '../ClinicalReportGenerator';

describe('ClinicalReportGenerator', () => {
  const sampleReport: MeasurementSessionReport = {
    sessionId: 'SESS-20260822-001',
    timestampIso: '2026-08-22T22:00:00.000Z',
    durationSeconds: 30,
    averageBpm: 72,
    minBpm: 68,
    maxBpm: 76,
    spo2: {
      spo2Percent: 98.5,
      rRatio: 0.46,
      acRed: 2.1,
      dcRed: 180,
      acGreen: 3.8,
      dcGreen: 50,
      confidence: 0.95,
    },
    hrv: {
      rmssdMs: 34.2,
      sdnnMs: 28.5,
      pnn50Ratio: 0.18,
      sd1Ms: 24.2,
      sd2Ms: 31.0,
      stressIndex: 1.3,
      sampleCount: 35,
    },
    pwa: {
      crestTimeMs: 120,
      augmentationIndexProxy: 0.35,
      stiffnessIndexMs: 145,
      estimatedSystolicMmHg: 118,
      estimatedDiastolicMmHg: 78,
    },
    arrhythmia: {
      primaryRhythm: 'NORMAL_SINUS',
      confidence: 0.92,
      sampleEntropy: 0.42,
      pvcCount: 0,
      pacCount: 0,
      events: [],
      clinicalSummary: 'Ritmo sinusal normal y regular.',
    },
    signalQualityIndex: 0.96,
  };

  it('genera un reporte en Markdown completo y estructurado', () => {
    const md = ClinicalReportGenerator.generateMarkdown(sampleReport);
    expect(md).toContain('REPORTE BIOMÉDICO DE TELEMETRÍA CARDIOVASCULAR');
    expect(md).toContain('SESS-20260822-001');
    expect(md).toContain('NORMAL_SINUS');
    expect(md).toContain('34.2 ms');
    expect(md).toContain('98.5%');
  });

  it('genera un archivo CSV con todas las columnas clínicas requeridas', () => {
    const csv = ClinicalReportGenerator.generateCsv(sampleReport);
    expect(csv).toContain('SessionId,Timestamp,DurationSec,AvgBPM');
    expect(csv).toContain('SESS-20260822-001');
    expect(csv).toContain('NORMAL_SINUS');
  });
});
