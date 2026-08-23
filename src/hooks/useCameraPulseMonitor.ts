/**
 * useCameraPulseMonitor
 *
 * Hook de orquestación en tiempo real que integra la captura de cámara óptica con bloqueo 3A,
 * el Web Worker de procesamiento DSP, el motor de renderizado Canvas a 60 FPS,
 * el clasificador de arritmias y el generador de reportes clínicos de sesión.
 *
 * Correcciones aplicadas en auditoría adversarial:
 * - Eliminados valores hardcodeados de SpO₂/PWA/HRV en el reporte — ahora usan métricas reales del Worker.
 * - Eliminado fallback que enmascaraba ausencia de señal como 98/120/80.
 * - Tipado browser-safe para temporizador (number, no NodeJS.Timeout).
 * - Historial BPM acotado (max 600) para evitar fuga de memoria.
 * - Telemetría ampliada para transportar métricas completas (rRatio, pNN50 ratio real, etc).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { CameraCaptureService, CameraState, FrameData } from '../modules/camera';
import { TelemetryCanvasEngine, TelemetryFrame } from '../modules/visualization';
import { ArrhythmiaDiagnosis } from '../modules/arrhythmia';
import { MeasurementSessionReport } from '../modules/clinical-report';

type ContactState = 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';

interface LastMetricsRef {
  spo2: { spo2Percent: number; rRatio: number; acRed: number; dcRed: number; acGreen: number; dcGreen: number; confidence: number } | null;
  hrv: { rmssdMs: number; sdnnMs: number; pnn50Ratio: number; sd1Ms: number; sd2Ms: number; stressIndex: number; sampleCount: number } | null;
  pwa: { crestTimeMs: number; augmentationIndexProxy: number; stiffnessIndexMs: number; estimatedSystolicMmHg: number; estimatedDiastolicMmHg: number } | null;
}

export function useCameraPulseMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [sessionDurationSec, setSessionDurationSec] = useState(0);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [lastReport, setLastReport] = useState<MeasurementSessionReport | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>({
    isActive: false,
    hasTorch: false,
    isTorchOn: false,
    is3aLocked: false,
    fps: 0,
    resolution: { width: 0, height: 0 },
    capabilities: {
      hasTorch: false,
      hasManualExposure: false,
      hasManualWhiteBalance: false,
      hasManualFocus: false,
    },
    error: null,
  });

  const [currentTelemetry, setCurrentTelemetry] = useState<TelemetryFrame>({
    timestampMs: 0,
    filteredValue: 0,
    rawRed: 0,
    rawGreen: 0,
    rawBlue: 0,
    isPeak: false,
    sqi: 0,
    pi: 0,
    bpm: 0,
    confidence: 0,
    contactState: 'NO_CONTACT',
  });

  const [clinicalVitals, setClinicalVitals] = useState({
    bpm: 0,
    spo2: 0,
    rmssd: 0,
    sdnn: 0,
    pnn50: 0,
    stressIndex: 0,
    isArrhythmia: false,
    contactState: 'NO_CONTACT' as ContactState,
    estimatedSystolic: 0,
    estimatedDiastolic: 0,
    crestTimeMs: 0,
    arrhythmia: {
      primaryRhythm: 'NORMAL_SINUS',
      confidence: 0,
      sampleEntropy: 0,
      pvcCount: 0,
      pacCount: 0,
      events: [],
      clinicalSummary: 'En espera de señal capilar...',
    } as ArrhythmiaDiagnosis,
  });

  const cameraServiceRef = useRef<CameraCaptureService | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const canvasEngineRef = useRef<TelemetryCanvasEngine | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const bpmHistoryRef = useRef<number[]>([]);
  const lastMetricsRef = useRef<LastMetricsRef>({ spo2: null, hrv: null, pwa: null });

  // Inicializar Web Worker — una sola vez
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/pulseSignal.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent) => {
      const { type, payload } = event.data;

      if (type === 'TELEMETRY_UPDATE') {
        const frame: TelemetryFrame = {
          timestampMs: payload.timestampMs,
          filteredValue: payload.filteredValue,
          rawRed: payload.rawRed,
          rawGreen: payload.rawGreen,
          rawBlue: payload.rawBlue,
          isPeak: payload.isPeak,
          sqi: payload.sqi,
          pi: payload.pi,
          bpm: payload.bpm,
          confidence: payload.sqi ?? payload.livenessVerdict?.confidence ?? 0,
          contactState: payload.contactState,
        };

        if (canvasEngineRef.current) {
          canvasEngineRef.current.pushFrame(frame);
        }

        setCurrentTelemetry(frame);

        // Historial acotado — máx 600 muestras (~30 s a 20 Hz picos falsos, en práctica ~600 latidos = 10 min)
        if (payload.bpm > 30 && payload.bpm < 220) {
          bpmHistoryRef.current.push(payload.bpm);
          if (bpmHistoryRef.current.length > 600) bpmHistoryRef.current.shift();
        }

        // Persistir métricas reales para reporte clínico
        if (payload.spo2Metrics) {
          lastMetricsRef.current.spo2 = {
            spo2Percent: payload.spo2Metrics.spo2Percent ?? payload.spo2Metrics.spo2 ?? 0,
            rRatio: payload.spo2Metrics.rRatio ?? payload.spo2Metrics.rValue ?? 0,
            acRed: payload.spo2Metrics.acRed ?? 0,
            dcRed: payload.spo2Metrics.dcRed ?? 0,
            acGreen: payload.spo2Metrics.acGreen ?? 0,
            dcGreen: payload.spo2Metrics.dcGreen ?? 0,
            confidence: payload.spo2Metrics.confidence ?? 0,
          };
        }
        if (payload.hrvMetrics) {
          // Worker puede enviar pnn50Percent (0-100) o pnn50Ratio (0-1); normalizar a ratio
          const pnn50RatioRaw = payload.hrvMetrics.pnn50Ratio ?? (payload.hrvMetrics.pnn50Percent != null ? payload.hrvMetrics.pnn50Percent / 100 : 0);
          lastMetricsRef.current.hrv = {
            rmssdMs: payload.hrvMetrics.rmssdMs ?? 0,
            sdnnMs: payload.hrvMetrics.sdnnMs ?? 0,
            pnn50Ratio: pnn50RatioRaw,
            sd1Ms: payload.hrvMetrics.sd1Ms ?? (payload.hrvMetrics.rmssdMs ? Math.round(payload.hrvMetrics.rmssdMs / Math.SQRT2 * 10) / 10 : 0),
            sd2Ms: payload.hrvMetrics.sd2Ms ?? (payload.hrvMetrics.sdnnMs ? Math.round(Math.sqrt(Math.max(0, 2 * payload.hrvMetrics.sdnnMs * payload.hrvMetrics.sdnnMs - 0.5 * (payload.hrvMetrics.rmssdMs ?? 0) * (payload.hrvMetrics.rmssdMs ?? 0)))*10)/10 : 0),
            stressIndex: payload.hrvMetrics.stressIndex ?? 0,
            sampleCount: payload.hrvMetrics.sampleCount ?? 0,
          };
        }
        if (payload.pwaMetrics) {
          lastMetricsRef.current.pwa = {
            crestTimeMs: payload.pwaMetrics.crestTimeMs ?? 0,
            augmentationIndexProxy: payload.pwaMetrics.augmentationIndexProxy ?? 0,
            stiffnessIndexMs: payload.pwaMetrics.stiffnessIndexMs ?? payload.pwaMetrics.stiffnessIndex ?? 0,
            estimatedSystolicMmHg: payload.pwaMetrics.estimatedSystolicMmHg ?? 0,
            estimatedDiastolicMmHg: payload.pwaMetrics.estimatedDiastolicMmHg ?? 0,
          };
        }

        const isStable = payload.contactState === 'STABLE_CONTACT';
        setClinicalVitals({
          bpm: isStable ? payload.bpm : 0,
          spo2: isStable ? (payload.spo2Metrics?.spo2Percent ?? payload.spo2Metrics?.spo2 ?? 0) : 0,
          rmssd: isStable ? (payload.hrvMetrics?.rmssdMs ?? 0) : 0,
          sdnn: isStable ? (payload.hrvMetrics?.sdnnMs ?? 0) : 0,
          pnn50: isStable ? Math.round(((payload.hrvMetrics?.pnn50Ratio ?? (payload.hrvMetrics?.pnn50Percent != null ? payload.hrvMetrics.pnn50Percent / 100 : 0)) * 100)) : 0,
          stressIndex: isStable ? (payload.hrvMetrics?.stressIndex ?? 0) : 0,
          isArrhythmia: payload.isArrhythmiaCandidate || false,
          contactState: payload.contactState,
          estimatedSystolic: isStable ? (payload.pwaMetrics?.estimatedSystolicMmHg ?? 0) : 0,
          estimatedDiastolic: isStable ? (payload.pwaMetrics?.estimatedDiastolicMmHg ?? 0) : 0,
          crestTimeMs: isStable ? (payload.pwaMetrics?.crestTimeMs ?? 0) : 0,
          arrhythmia: payload.arrhythmiaDiagnosis ?? {
            primaryRhythm: 'NORMAL_SINUS',
            confidence: 0,
            sampleEntropy: 0,
            pvcCount: 0,
            pacCount: 0,
            events: [],
            clinicalSummary: payload.livenessVerdict?.userGuidance ?? 'En espera de señal capilar...',
          },
        });
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const registerCanvasEngine = useCallback((engine: TelemetryCanvasEngine) => {
    canvasEngineRef.current = engine;
  }, []);

  const stopMonitoring = useCallback(() => {
    if (cameraServiceRef.current) {
      void cameraServiceRef.current.stop();
    }
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'RESET' });
    }
    if (canvasEngineRef.current) {
      canvasEngineRef.current.reset();
    }
    if (sessionTimerRef.current !== null) {
      window.clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    setIsMonitoring(false);
    setCameraState((prev) => ({ ...prev, isActive: false, isTorchOn: false }));
  }, []);

  const startMonitoring = useCallback(async (videoElement: HTMLVideoElement) => {
    if (isMonitoring) return;

    if (!cameraServiceRef.current) {
      cameraServiceRef.current = new CameraCaptureService();
    }

    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'RESET' });
    }

    if (canvasEngineRef.current) {
      canvasEngineRef.current.reset();
    }

    setSessionDurationSec(0);
    setIsSessionComplete(false);
    bpmHistoryRef.current = [];
    lastMetricsRef.current = { spo2: null, hrv: null, pwa: null };

    const state = await cameraServiceRef.current.start(videoElement, (frame: FrameData) => {
      if (workerRef.current) {
        // Transferir buffer si es posible; clonar si no
        workerRef.current.postMessage({
          type: 'PROCESS_FRAME',
          payload: {
            rgba: frame.rgba,
            width: frame.width,
            height: frame.height,
            timestampMs: frame.timestampMs,
          },
        });
      }
    });

    setCameraState(state);
    if (!state.error) {
      setIsMonitoring(true);

      const startTime = Date.now();
      if (sessionTimerRef.current !== null) window.clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setSessionDurationSec(elapsed);
        if (elapsed >= 30) setIsSessionComplete(true);
      }, 1000);
    }
  }, [isMonitoring]);

  const generateReport = useCallback((): MeasurementSessionReport => {
    const bpms = bpmHistoryRef.current;
    const avgBpm = bpms.length > 0 ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : (clinicalVitals.bpm || 0);
    const minBpm = bpms.length > 0 ? Math.min(...bpms) : (clinicalVitals.bpm || 0);
    const maxBpm = bpms.length > 0 ? Math.max(...bpms) : (clinicalVitals.bpm || 0);

    const spo2Real = lastMetricsRef.current.spo2;
    const hrvReal = lastMetricsRef.current.hrv;
    const pwaReal = lastMetricsRef.current.pwa;

    const report: MeasurementSessionReport = {
      sessionId: `SESSION-${Date.now()}`,
      timestampIso: new Date().toISOString(),
      durationSeconds: Math.max(1, sessionDurationSec),
      averageBpm: avgBpm,
      minBpm: minBpm,
      maxBpm: maxBpm,
      spo2: spo2Real ? {
        spo2Percent: spo2Real.spo2Percent,
        rRatio: spo2Real.rRatio,
        acRed: spo2Real.acRed,
        dcRed: spo2Real.dcRed,
        acGreen: spo2Real.acGreen,
        dcGreen: spo2Real.dcGreen,
        confidence: spo2Real.confidence,
      } : {
        spo2Percent: clinicalVitals.spo2 || 0,
        rRatio: 0,
        acRed: 0,
        dcRed: 0,
        acGreen: 0,
        dcGreen: 0,
        confidence: currentTelemetry.confidence,
      },
      hrv: hrvReal ? {
        rmssdMs: hrvReal.rmssdMs,
        sdnnMs: hrvReal.sdnnMs,
        pnn50Ratio: hrvReal.pnn50Ratio,
        sd1Ms: hrvReal.sd1Ms,
        sd2Ms: hrvReal.sd2Ms,
        stressIndex: hrvReal.stressIndex,
        sampleCount: hrvReal.sampleCount,
      } : {
        rmssdMs: clinicalVitals.rmssd,
        sdnnMs: clinicalVitals.sdnn,
        pnn50Ratio: clinicalVitals.pnn50 / 100,
        sd1Ms: clinicalVitals.rmssd ? Math.round(clinicalVitals.rmssd / Math.SQRT2 * 10) / 10 : 0,
        sd2Ms: clinicalVitals.sdnn ? Math.round(Math.sqrt(Math.max(0, 2 * clinicalVitals.sdnn * clinicalVitals.sdnn - 0.5 * clinicalVitals.rmssd * clinicalVitals.rmssd)) * 10) / 10 : 0,
        stressIndex: clinicalVitals.stressIndex,
        sampleCount: bpms.length,
      },
      pwa: pwaReal ? {
        crestTimeMs: pwaReal.crestTimeMs,
        augmentationIndexProxy: pwaReal.augmentationIndexProxy,
        stiffnessIndexMs: pwaReal.stiffnessIndexMs,
        estimatedSystolicMmHg: pwaReal.estimatedSystolicMmHg,
        estimatedDiastolicMmHg: pwaReal.estimatedDiastolicMmHg,
      } : {
        crestTimeMs: clinicalVitals.crestTimeMs || 0,
        augmentationIndexProxy: 0,
        stiffnessIndexMs: 0,
        estimatedSystolicMmHg: clinicalVitals.estimatedSystolic || 0,
        estimatedDiastolicMmHg: clinicalVitals.estimatedDiastolic || 0,
      },
      arrhythmia: clinicalVitals.arrhythmia,
      signalQualityIndex: currentTelemetry.sqi,
    };

    setLastReport(report);
    return report;
  }, [clinicalVitals, currentTelemetry, sessionDurationSec]);

  const toggleTorch = useCallback(async () => {
    if (!cameraServiceRef.current) return;
    const nextState = !cameraState.isTorchOn;
    const success = await cameraServiceRef.current.setTorch(nextState);
    if (success) {
      setCameraState((prev) => ({ ...prev, isTorchOn: nextState }));
    }
  }, [cameraState.isTorchOn]);

  return {
    isMonitoring,
    sessionDurationSec,
    isSessionComplete,
    lastReport,
    cameraState,
    currentTelemetry,
    clinicalVitals,
    startMonitoring,
    stopMonitoring,
    toggleTorch,
    generateReport,
    registerCanvasEngine,
  };
}
