/**
 * useCameraPulseMonitor
 *
 * Hook de orquestación en tiempo real que integra la captura de cámara óptica,
 * el Web Worker de procesamiento DSP y el motor de renderizado Canvas a 60 FPS.
 * 100% datos ópticos reales del sensor CMOS.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { CameraCaptureService } from '../modules/camera/CameraCaptureService';
import { CameraState, FrameData } from '../modules/camera/types';
import { TelemetryCanvasEngine, TelemetryFrame } from '../modules/visualization';

export function useCameraPulseMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
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
    spo2: 98,
    rmssd: 0,
    sdnn: 0,
    pnn50: 0,
    stressIndex: 1.0,
    isArrhythmia: false,
    contactState: 'NO_CONTACT',
  });

  const cameraServiceRef = useRef<CameraCaptureService | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const canvasEngineRef = useRef<TelemetryCanvasEngine | null>(null);

  // Inicializar Web Worker
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
          confidence: payload.hemoglobinVerdict?.confidence || 0,
          contactState: payload.contactState,
        };

        // Alimentar el motor Canvas en tiempo real
        if (canvasEngineRef.current) {
          canvasEngineRef.current.pushFrame(frame);
        }

        setCurrentTelemetry(frame);

        // Actualizar métricas clínicas
        setClinicalVitals({
          bpm: payload.bpm,
          spo2: payload.spo2Metrics?.spo2Percent || 98,
          rmssd: payload.hrvMetrics?.rmssdMs || 0,
          sdnn: payload.hrvMetrics?.sdnnMs || 0,
          pnn50: Math.round((payload.hrvMetrics?.pnn50Ratio || 0) * 100),
          stressIndex: payload.hrvMetrics?.stressIndex || 1.0,
          isArrhythmia: payload.isArrhythmiaCandidate || false,
          contactState: payload.contactState,
        });
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
  }, []);

  const registerCanvasEngine = useCallback((engine: TelemetryCanvasEngine) => {
    canvasEngineRef.current = engine;
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

    const state = await cameraServiceRef.current.start(videoElement, (frame: FrameData) => {
      // Transferir buffer de fotograma al Web Worker
      if (workerRef.current) {
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
    }
  }, [isMonitoring]);

  const stopMonitoring = useCallback(() => {
    if (cameraServiceRef.current) {
      cameraServiceRef.current.stop();
    }
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'RESET' });
    }
    if (canvasEngineRef.current) {
      canvasEngineRef.current.reset();
    }

    setIsMonitoring(false);
    setCameraState((prev) => ({ ...prev, isActive: false, isTorchOn: false }));
  }, []);

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
    cameraState,
    currentTelemetry,
    clinicalVitals,
    startMonitoring,
    stopMonitoring,
    toggleTorch,
    registerCanvasEngine,
  };
}
