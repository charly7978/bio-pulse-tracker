/**
 * ClinicalReportGenerator
 *
 * Generador de reportes clínicos estructurados de signos vitales, HRV y análisis de arritmias.
 * Permite la exportación estandarizada en formato Markdown, JSON y CSV.
 */

import { ArrhythmiaDiagnosis } from '../arrhythmia';
import { HrvMetrics, Spo2Metrics, PulseWaveMetrics } from '../vital-signs';

export interface MeasurementSessionReport {
  sessionId: string;
  timestampIso: string;
  durationSeconds: number;
  averageBpm: number;
  minBpm: number;
  maxBpm: number;
  spo2: Spo2Metrics;
  hrv: HrvMetrics;
  pwa: PulseWaveMetrics;
  arrhythmia: ArrhythmiaDiagnosis;
  signalQualityIndex: number;
}

export class ClinicalReportGenerator {
  /**
   * Genera el reporte clínico estructurado en formato Markdown para visualización o impresión médica.
   */
  public static generateMarkdown(report: MeasurementSessionReport): string {
    return `# REPORTE BIOMÉDICO DE TELEMETRÍA CARDIOVASCULAR
**ID de Sesión:** \`${report.sessionId}\`  
**Fecha y Hora:** ${new Date(report.timestampIso).toLocaleString()}  
**Duración de Medición:** ${report.durationSeconds} segundos  
**Índice de Calidad de Señal (SQI):** ${(report.signalQualityIndex * 100).toFixed(1)}%

---

## 1. Signos Vitales Principales
- **Frecuencia Cardíaca Media:** ${report.averageBpm} LPM (Rango: ${report.minBpm} - ${report.maxBpm} LPM)
- **Saturación Arterial de Oxígeno (SpO₂):** ${report.spo2.spo2Percent}% (Confianza: ${(report.spo2.confidence * 100).toFixed(0)}%)
- **Presión Arterial Estimada (PWA):** ${report.pwa.estimatedSystolicMmHg}/${report.pwa.estimatedDiastolicMmHg} mmHg
- **Tiempo de Cresta Sistólica:** ${report.pwa.crestTimeMs} ms
- **Índice de Rigidez Vascular:** ${report.pwa.stiffnessIndexMs} ms

---

## 2. Variabilidad de la Frecuencia Cardíaca (HRV)
- **RMSSD:** ${report.hrv.rmssdMs} ms *(Actividad parasimpática / vagal)*
- **SDNN:** ${report.hrv.sdnnMs} ms *(Variabilidad global total)*
- **pNN50:** ${(report.hrv.pnn50Ratio * 100).toFixed(1)}%
- **Dispersión de Poincaré (SD1 / SD2):** ${report.hrv.sd1Ms} ms / ${report.hrv.sd2Ms} ms
- **Índice de Estrés Fisiológico:** ${report.hrv.stressIndex}

---

## 3. Diagnóstico y Clasificación del Ritmo
- **Ritmo Dominante:** **${report.arrhythmia.primaryRhythm}**
- **Diagnóstico Clínico:** ${report.arrhythmia.clinicalSummary}
- **Entropía Muestral (SampEn):** ${report.arrhythmia.sampleEntropy}
- **Extrasístoles Ventriculares (PVC):** ${report.arrhythmia.pvcCount}
- **Extrasístoles Auriculares (PAC):** ${report.arrhythmia.pacCount}

---
*Nota: Este reporte es generado mediante procesamiento fotopletismográfico de grado biomédico. Consulte con un médico cardiólogo para confirmación diagnóstica con ECG de 12 derivaciones.*
`;
  }

  /**
   * Genera formato CSV para exportación y análisis en software estadístico (ej. R, Python, Excel).
   */
  public static generateCsv(report: MeasurementSessionReport): string {
    const headers = [
      'SessionId', 'Timestamp', 'DurationSec', 'AvgBPM', 'MinBPM', 'MaxBPM',
      'SpO2', 'RMSSD_ms', 'SDNN_ms', 'pNN50_pct', 'StressIndex',
      'SystolicBP_mmHg', 'DiastolicBP_mmHg', 'PrimaryRhythm', 'SampEn', 'PVC_Count', 'PAC_Count'
    ].join(',');

    const row = [
      report.sessionId,
      report.timestampIso,
      report.durationSeconds,
      report.averageBpm,
      report.minBpm,
      report.maxBpm,
      report.spo2.spo2Percent,
      report.hrv.rmssdMs,
      report.hrv.sdnnMs,
      (report.hrv.pnn50Ratio * 100).toFixed(1),
      report.hrv.stressIndex,
      report.pwa.estimatedSystolicMmHg,
      report.pwa.estimatedDiastolicMmHg,
      report.arrhythmia.primaryRhythm,
      report.arrhythmia.sampleEntropy,
      report.arrhythmia.pvcCount,
      report.arrhythmia.pacCount,
    ].join(',');

    return `${headers}\n${row}`;
  }
}
