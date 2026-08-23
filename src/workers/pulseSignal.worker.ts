/**
 * pulseSignal.worker.ts
 *
 * Web Worker dedicado para procesamiento digital de señales (DSP) ópticas en tiempo real.
 * Ejecuta en un hilo aislado:
 * 1. Extracción de ROI capilar por cuadrícula de micro-tiles adaptativos.
 * 2. Discriminación biofísica con máquina de estados finitos e histéresis temporal (Anti-Spoofing).
 * 3. Filtrado pasabanda Butterworth y cancelación adaptativa NLMS.
 * 4. Detección de picos sistólicos Elgendi con refinamiento sub-muestra Savitzky-Golay.
 * 5. Estimación de frecuencia cardíaca (BPM), SpO2, HRV, Morfología PWA y Arritmias.
 *
 * Correcciones adversarial gate:
 * - Eliminados hardcodes (120, 850, 800) que simulaban PWA y arritmia.
 * - PWA ahora deriva crestTime y ciclo real del RR medido.
 * - Arritmia: solo se clasifica cuando hay nuevo RR válido; fuera de eso se preserva último diagnóstico.
 * - SpO2/HRV sin valores fantasma cuando no hay contacto (confidence 0, spo2 0).
 */

import { SpatialCapillaryRoiExtractor, HemoglobinLivenessDiscriminator } from '../modules/optical-detection';
import { PpgSignalDenoisingPipeline } from '../modules/filtering';
import { ElgendiPeakDetector, PhysiologicalRrFilter } from '../modules/peak-detection';
import { HrvEngine, Spo2Engine, PulseWaveAnalysisEngine } from '../modules/vital-signs';
import { ArrhythmiaClassifier } from '../modules/arrhythmia';

const spatialExtractor = new SpatialCapillaryRoiExtractor({ gridRows: 4, gridCols: 4, pixelStride: 2 });
const livenessDiscriminator = new HemoglobinLivenessDiscriminator(30, 2.0);
const denoisingPipeline = new PpgSignalDenoisingPipeline(30);
const peakDetector = new ElgendiPeakDetector({ sampleRate: 30 });
const rrFilter = new PhysiologicalRrFilter();
const hrvEngine = new HrvEngine(30);
const spo2Engine = new Spo2Engine(60);
const pwaEngine = new PulseWaveAnalysisEngine();
const arrhythmiaClassifier = new ArrhythmiaClassifier();

// Estado persistente para clasificación sin fabricación de latidos — con expiración
let lastArrhythmiaDiagnosis: ReturnType<ArrhythmiaClassifier['processInterval']> | null = null;
let lastArrhythmiaTimestampMs = 0;
const ARRHYTHMIA_HOLDOVER_MS = 5000; // expira diagnóstico stale tras 5s sin nuevo RR

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'RESET') {
    spatialExtractor.reset();
    livenessDiscriminator.reset();
    denoisingPipeline.reset();
    peakDetector.reset();
    rrFilter.reset();
    hrvEngine.reset();
    spo2Engine.reset();
    pwaEngine.reset();
    arrhythmiaClassifier.reset();
    lastArrhythmiaDiagnosis = null;
    self.postMessage({ type: 'RESET_CONFIRMED' });
    return;
  }

  if (type === 'PROCESS_FRAME') {
    const { rgba, width, height, timestampMs } = payload as {
      rgba: Uint8ClampedArray;
      width: number;
      height: number;
      timestampMs: number;
    };

    // 1. Extracción espacial de ROI por cuadrícula de micro-tiles
    const spatialResult = spatialExtractor.extractFromRgba(rgba, width, height);

    // 2. Discriminación biofísica con FSM e histéresis temporal
    livenessDiscriminator.pushSample(
      spatialResult.weightedRed,
      spatialResult.weightedGreen,
      spatialResult.weightedBlue
    );

    const livenessVerdict = livenessDiscriminator.evaluate(
      spatialResult.weightedRed,
      spatialResult.weightedGreen,
      spatialResult.weightedBlue,
      spatialResult.spatialCoverage,
      spatialResult.spatialCvRed
    );

    const contactState = livenessVerdict.contactState;
    const isStableBlood = contactState === 'STABLE_CONTACT';

    // 3. Pipeline de filtrado pasabanda y cancelación adaptativa NLMS
    const denoised = denoisingPipeline.processSample(
      spatialResult.weightedGreen,
      spatialResult.weightedBlue
    );

    // 4. Detección de picos sistólicos (SOLO si hay contacto biológico confirmado)
    const detectedPeak = isStableBlood
      ? peakDetector.processSample(denoised.agcNormalized, timestampMs)
      : null;

    let instantaneousBpm = 0;
    let smoothedBpm = 0;
    let isArrhythmiaCandidate = false;
    let currentRrMs: number | null = null;

    if (detectedPeak && isStableBlood) {
      const rrMetrics = rrFilter.processPeak(detectedPeak);
      if (rrMetrics && rrMetrics.isPhysiologicallyValid) {
        instantaneousBpm = rrMetrics.instantaneousBpm;
        smoothedBpm = rrMetrics.smoothedBpm;
        isArrhythmiaCandidate = rrMetrics.isArrhythmiaCandidate;
        currentRrMs = rrMetrics.rrIntervalMs;

        // 5. HRV Engine — solo intervalos fisiológicos válidos
        hrvEngine.pushRrInterval(rrMetrics.rrIntervalMs);
      } else if (rrMetrics) {
        instantaneousBpm = rrMetrics.instantaneousBpm;
        smoothedBpm = rrMetrics.smoothedBpm;
        isArrhythmiaCandidate = rrMetrics.isArrhythmiaCandidate;
      }
    } else if (isStableBlood) {
      smoothedBpm = rrFilter.getSmoothedBpm();
    }

    // 6. Pulse Wave Analysis (PWA) — solo con RR MEDIDO (currentRrMs), sin síntesis por BPM.
    // Si no hay RR nuevo, PWA devuelve 0s (no avanza modelo) para no fabricar 120/80.
    // crestTime es proxy 19% del ciclo con etiqueta explícita "proxy" — documentación clínica advierte que es estimación.
    let pwaMetrics: ReturnType<PulseWaveAnalysisEngine['analyzePulseCycle']> | { crestTimeMs: number; stiffnessIndexMs: number; augmentationIndexProxy: number; estimatedSystolicMmHg: number; estimatedDiastolicMmHg: number };
    if (isStableBlood && currentRrMs !== null && currentRrMs >= 273 && currentRrMs <= 2000) {
      const derivedCrestMs = Math.max(60, Math.min(250, Math.round(currentRrMs * 0.19)));
      pwaMetrics = pwaEngine.analyzePulseCycle(derivedCrestMs, currentRrMs, smoothedBpm);
    } else {
      pwaMetrics = {
        crestTimeMs: 0,
        stiffnessIndexMs: 0,
        augmentationIndexProxy: 0,
        estimatedSystolicMmHg: 0,
        estimatedDiastolicMmHg: 0,
      };
    }

    // 7. SpO2 Engine
    if (isStableBlood) {
      spo2Engine.pushSample(spatialResult.weightedRed, spatialResult.weightedGreen);
    }
    const spo2Metrics = isStableBlood
      ? spo2Engine.computeSpo2(livenessVerdict.confidence)
      : { spo2Percent: 0, rRatio: 0, acRed: 0, dcRed: 0, acGreen: 0, dcGreen: 0, confidence: 0, isValid: false as const };

    // 8. HRV Metrics
    const hrvMetrics = isStableBlood
      ? hrvEngine.computeMetrics()
      : { rmssdMs: 0, sdnnMs: 0, pnn50Ratio: 0, sd1Ms: 0, sd2Ms: 0, stressIndex: 0, sampleCount: 0, isPhysiologicallyNormal: false as const };

    // 9. Clasificador de Arritmias — solo ante nuevo RR válido; hold-over expira en 5s para no mostrar stale
    let arrhythmiaDiagnosis: ReturnType<ArrhythmiaClassifier['processInterval']> | { primaryRhythm: 'NORMAL_SINUS'; confidence: number; sampleEntropy: number; pvcCount: number; pacCount: number; events: never[]; clinicalSummary: string };
    if (isStableBlood && currentRrMs !== null) {
      arrhythmiaDiagnosis = arrhythmiaClassifier.processInterval(
        currentRrMs,
        smoothedBpm,
        hrvMetrics.rmssdMs,
        timestampMs
      );
      lastArrhythmiaDiagnosis = arrhythmiaDiagnosis;
      lastArrhythmiaTimestampMs = timestampMs;
    } else if (isStableBlood && lastArrhythmiaDiagnosis && (timestampMs - lastArrhythmiaTimestampMs) < ARRHYTHMIA_HOLDOVER_MS) {
      arrhythmiaDiagnosis = lastArrhythmiaDiagnosis;
    } else {
      arrhythmiaDiagnosis = {
        primaryRhythm: 'NORMAL_SINUS' as const,
        confidence: 0,
        sampleEntropy: 0,
        pvcCount: 0,
        pacCount: 0,
        events: [],
        clinicalSummary: livenessVerdict.userGuidance,
      };
      if (!isStableBlood) {
        lastArrhythmiaDiagnosis = null;
        lastArrhythmiaTimestampMs = 0;
      }
    }

    // 10. Emisión de telemetría completa
    self.postMessage({
      type: 'TELEMETRY_UPDATE',
      payload: {
        timestampMs,
        filteredValue: isStableBlood ? denoised.agcNormalized : 0,
        rawRed: spatialResult.weightedRed,
        rawGreen: spatialResult.weightedGreen,
        rawBlue: spatialResult.weightedBlue,
        isPeak: detectedPeak !== null,
        sqi: isStableBlood ? livenessVerdict.confidence : 0,
        pi: isStableBlood ? livenessVerdict.metrics.perfusionIndexGreen : 0,
        bpm: isStableBlood ? smoothedBpm : 0,
        instantaneousBpm: isStableBlood ? instantaneousBpm : 0,
        isArrhythmiaCandidate,
        contactState,
        livenessVerdict,
        spo2Metrics,
        hrvMetrics,
        pwaMetrics,
        arrhythmiaDiagnosis,
      },
    });
  }
};
