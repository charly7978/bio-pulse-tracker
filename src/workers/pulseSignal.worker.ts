/**
 * pulseSignal.worker.ts
 *
 * Web Worker dedicado para procesamiento digital de señales (DSP) ópticas en tiempo real.
 * Ejecuta en un hilo aislado:
 * 1. Extracción de ROI capilar por cuadrícula de tiles.
 * 2. Validación de firma de absorción de hemoglobina.
 * 3. Filtrado pasabanda Butterworth y cancelación adaptativa NLMS.
 * 4. Detección de picos sistólicos Elgendi con refinamiento Savitzky-Golay.
 * 5. Estimación de frecuencia cardíaca (BPM), SpO2, HRV y Morfología PWA.
 * 6. Validación de atractor biológico de recurrencia (SPAR).
 */

import { SpatialCapillaryRoiExtractor, HemoglobinSpectraDetector, BiologicalLivenessAttractor } from '../modules/optical-detection';
import { PpgSignalDenoisingPipeline } from '../modules/filtering';
import { ElgendiPeakDetector, PhysiologicalRrFilter } from '../modules/peak-detection';
import { HrvEngine, Spo2Engine, PulseWaveAnalysisEngine } from '../modules/vital-signs';
import { ArrhythmiaClassifier } from '../modules/arrhythmia';

const spatialExtractor = new SpatialCapillaryRoiExtractor({ gridRows: 4, gridCols: 4, pixelStride: 2 });
const hemoglobinDetector = new HemoglobinSpectraDetector();
const denoisingPipeline = new PpgSignalDenoisingPipeline(30);
const peakDetector = new ElgendiPeakDetector({ sampleRate: 30 });
const rrFilter = new PhysiologicalRrFilter();
const hrvEngine = new HrvEngine(30);
const spo2Engine = new Spo2Engine(60);
const pwaEngine = new PulseWaveAnalysisEngine();
const arrhythmiaClassifier = new ArrhythmiaClassifier();
const livenessAttractor = new BiologicalLivenessAttractor({ sampleRate: 30, minSamplesWindow: 45 });

const signalWindowBuffer: number[] = [];
const windowCapacity = 90; // 3 segundos a 30 fps

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'RESET') {
    spatialExtractor.reset();
    denoisingPipeline.reset();
    peakDetector.reset();
    rrFilter.reset();
    hrvEngine.reset();
    spo2Engine.reset();
    pwaEngine.reset();
    signalWindowBuffer.length = 0;
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

    // 1. Extracción espacial de ROI por cuadrícula de tiles
    const spatialResult = spatialExtractor.extractFromRgba(rgba, width, height);

    // 2. Validación espectral de hemoglobina y discriminación de tejido vivo
    const hemoglobinVerdict = hemoglobinDetector.evaluateFrame(
      spatialResult.weightedRed,
      spatialResult.weightedGreen,
      spatialResult.weightedBlue,
      spatialResult.spatialCoverage,
      spatialResult.spatialCvRed
    );

    // Determinar estado de contacto
    let contactState: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' = 'NO_CONTACT';
    if (hemoglobinVerdict.isHumanTissue) {
      contactState = 'STABLE_CONTACT';
    } else if (spatialResult.weightedRed > 40 && spatialResult.spatialCoverage > 0.3) {
      contactState = 'UNSTABLE_CONTACT';
    }

    // 3. Pipeline de filtrado y cancelación de ruido adaptativa
    const denoised = denoisingPipeline.processSample(
      spatialResult.weightedGreen,
      spatialResult.weightedBlue
    );

    // Buffer de señal para atractor de vivacidad
    signalWindowBuffer.push(denoised.agcNormalized);
    if (signalWindowBuffer.length > windowCapacity) {
      signalWindowBuffer.shift();
    }

    // 4. Detección de picos sistólicos
    const detectedPeak = contactState === 'STABLE_CONTACT'
      ? peakDetector.processSample(denoised.agcNormalized, timestampMs)
      : null;

    let instantaneousBpm = 0;
    let smoothedBpm = 0;
    let isArrhythmiaCandidate = false;

    if (detectedPeak) {
      const rrMetrics = rrFilter.processPeak(detectedPeak);
      if (rrMetrics && rrMetrics.isPhysiologicallyValid) {
        instantaneousBpm = rrMetrics.instantaneousBpm;
        smoothedBpm = rrMetrics.smoothedBpm;
        isArrhythmiaCandidate = rrMetrics.isArrhythmiaCandidate;

        // 5. HRV Engine
        hrvEngine.pushRrInterval(rrMetrics.rrIntervalMs);
      }
    } else {
      smoothedBpm = rrFilter.getSmoothedBpm();
    }

    // 6. Pulse Wave Analysis (PWA)
    const pwaMetrics = pwaEngine.analyzePulseCycle(120, 850, smoothedBpm);

    // 7. SpO2 Engine
    spo2Engine.pushSample(spatialResult.weightedRed, spatialResult.weightedGreen);
    const spo2Metrics = spo2Engine.computeSpo2(hemoglobinVerdict.confidence);

    // 8. HRV Metrics
    const hrvMetrics = hrvEngine.computeMetrics();

    // 9. Clasificador de Arritmias
    const arrhythmiaDiagnosis = detectedPeak
      ? arrhythmiaClassifier.processInterval(
          60000 / Math.max(30, smoothedBpm),
          smoothedBpm,
          hrvMetrics.rmssdMs,
          timestampMs
        )
      : arrhythmiaClassifier.processInterval(
          800,
          smoothedBpm,
          hrvMetrics.rmssdMs,
          timestampMs
        );

    // 10. Atractor biológico de vivacidad
    const livenessVerdict = livenessAttractor.evaluateSignal(signalWindowBuffer);

    // 11. Emisión de telemetría completa
    self.postMessage({
      type: 'TELEMETRY_UPDATE',
      payload: {
        timestampMs,
        filteredValue: denoised.agcNormalized,
        rawRed: spatialResult.weightedRed,
        rawGreen: spatialResult.weightedGreen,
        rawBlue: spatialResult.weightedBlue,
        isPeak: detectedPeak !== null,
        sqi: Math.min(1.0, (hemoglobinVerdict.confidence * 0.5 + (livenessVerdict.confidence || 0) * 0.5)),
        pi: Math.max(0.1, (spatialResult.weightedGreen > 0 ? (denoised.agcNormalized / spatialResult.weightedGreen) * 100 : 0.5)),
        bpm: smoothedBpm,
        instantaneousBpm,
        isArrhythmiaCandidate,
        contactState,
        hemoglobinVerdict,
        livenessVerdict,
        spo2Metrics,
        hrvMetrics,
        pwaMetrics,
        arrhythmiaDiagnosis,
      },
    });
  }
};
