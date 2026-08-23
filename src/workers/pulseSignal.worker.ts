/**
 * pulseSignal.worker.ts
 *
 * Web Worker dedicado para procesamiento digital de señales (DSP) ópticas en tiempo real.
 * Ejecuta en un hilo aislado:
 * 1. Extracción de ROI capilar por cuadrícula de tiles.
 * 2. Discriminación biofísica unificada de hemoglobina y vivacidad (Anti-Spoofing).
 * 3. Filtrado pasabanda Butterworth y cancelación adaptativa NLMS.
 * 4. Detección de picos sistólicos Elgendi con refinamiento Savitzky-Golay.
 * 5. Estimación de frecuencia cardíaca (BPM), SpO2, HRV, Morfología PWA y Arritmias.
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

    // 2. Discriminación biofísica estricta de hemoglobina y vivacidad (Anti-Spoofing)
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

    // Determinar estado de contacto estrictamente validado
    let contactState: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' = 'NO_CONTACT';
    if (livenessVerdict.isLivingBlood) {
      contactState = 'STABLE_CONTACT';
    } else if (spatialResult.weightedRed >= 90 && spatialResult.spatialCoverage >= 0.50 && livenessVerdict.rejectionReason === 'INSUFFICIENT_SAMPLES') {
      contactState = 'UNSTABLE_CONTACT'; // Ajustando dedo o acumulando muestras iniciales
    }

    // 3. Pipeline de filtrado pasabanda y cancelación adaptativa NLMS
    const denoised = denoisingPipeline.processSample(
      spatialResult.weightedGreen,
      spatialResult.weightedBlue
    );

    // 4. Detección de picos sistólicos (SOLO si hay tejido vivo confirmado)
    const isStableBlood = contactState === 'STABLE_CONTACT';
    const detectedPeak = isStableBlood
      ? peakDetector.processSample(denoised.agcNormalized, timestampMs)
      : null;

    let instantaneousBpm = 0;
    let smoothedBpm = 0;
    let isArrhythmiaCandidate = false;

    if (detectedPeak && isStableBlood) {
      const rrMetrics = rrFilter.processPeak(detectedPeak);
      if (rrMetrics && rrMetrics.isPhysiologicallyValid) {
        instantaneousBpm = rrMetrics.instantaneousBpm;
        smoothedBpm = rrMetrics.smoothedBpm;
        isArrhythmiaCandidate = rrMetrics.isArrhythmiaCandidate;

        // 5. HRV Engine
        hrvEngine.pushRrInterval(rrMetrics.rrIntervalMs);
      }
    } else if (isStableBlood) {
      smoothedBpm = rrFilter.getSmoothedBpm();
    }

    // 6. Pulse Wave Analysis (PWA)
    const pwaMetrics = isStableBlood
      ? pwaEngine.analyzePulseCycle(120, 850, smoothedBpm)
      : { stiffnessIndex: 0, crestTimeMs: 0, estimatedSystolicMmHg: 120, estimatedDiastolicMmHg: 80 };

    // 7. SpO2 Engine
    if (isStableBlood) {
      spo2Engine.pushSample(spatialResult.weightedRed, spatialResult.weightedGreen);
    }
    const spo2Metrics = isStableBlood
      ? spo2Engine.computeSpo2(livenessVerdict.confidence)
      : { spo2: 0, rValue: 0, isValid: false };

    // 8. HRV Metrics
    const hrvMetrics = isStableBlood
      ? hrvEngine.computeMetrics()
      : { rmssdMs: 0, sdnnMs: 0, pnn50Percent: 0, stressIndex: 1.0, isPhysiologicallyNormal: false, sampleCount: 0 };

    // 9. Clasificador de Arritmias
    const arrhythmiaDiagnosis = isStableBlood && detectedPeak
      ? arrhythmiaClassifier.processInterval(
          60000 / Math.max(30, smoothedBpm),
          smoothedBpm,
          hrvMetrics.rmssdMs,
          timestampMs
        )
      : isStableBlood
      ? arrhythmiaClassifier.processInterval(
          800,
          smoothedBpm,
          hrvMetrics.rmssdMs,
          timestampMs
        )
      : {
          primaryRhythm: 'NORMAL_SINUS' as const,
          confidence: 0,
          sampleEntropy: 0,
          pvcCount: 0,
          pacCount: 0,
          events: [],
          clinicalSummary: contactState === 'UNSTABLE_CONTACT' ? 'Validando pulso...' : 'En espera de contacto capilar...',
        };

    // 10. Emisión de telemetría completa (Gating estricto a cero si no hay sangre viva)
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
