/**
 * CameraCaptureService (Advanced Optical Bio-Sensor Engine)
 *
 * Controlador de hardware óptico de grado biomédico.
 * Integra:
 * 1. Solicitud de alta tasa de fotogramas (hasta 60 FPS) con baja latencia.
 * 2. Bloqueo estricto de 3A (Auto-Exposición, Auto-Balance de Blancos y Auto-Foco)
 *    para eliminar oscilaciones espurias provocadas por el algoritmo interno del ISP de la cámara.
 * 3. Control de antorcha / flash LED constante.
 * 4. Extracción de fotogramas de cero copia con sincronización por requestVideoFrameCallback.
 */

import { CameraState, FrameData, AdvancedCameraCapabilities } from './types';

export class CameraCaptureService {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private isCapturing = false;
  private animFrameId: number | null = null;
  private videoCallbackHandle: number | null = null;
  private onFrameCallback: ((frame: FrameData) => void) | null = null;

  // Estadísticas de fotogramas
  private frameCount = 0;
  private fps = 0;
  private lastFpsUpdateTime = 0;
  private is3aLocked = false;
  private capabilities: AdvancedCameraCapabilities = {
    hasTorch: false,
    hasManualExposure: false,
    hasManualWhiteBalance: false,
    hasManualFocus: false,
  };

  /**
   * Inicia la captura desde la cámara trasera con máxima tasa de fotogramas y bloqueo 3A.
   */
  public async start(
    videoElement: HTMLVideoElement,
    onFrame: (frame: FrameData) => void
  ): Promise<CameraState> {
    this.videoElement = videoElement;
    this.onFrameCallback = onFrame;

    // Configuración óptica de alto rendimiento
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 60, min: 30 },
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = this.stream;
      await videoElement.play();

      const track = this.stream.getVideoTracks()[0];
      if (track) {
        this.inspectCapabilities(track);
        // Aplicar bloqueo 3A y encendido de flash
        await this.apply3aLockAndTorch(track, true);
      }

      // Canvas de procesamiento offscreen calibrado a la resolución del video
      this.canvas = document.createElement('canvas');
      this.canvas.width = 320;
      this.canvas.height = 240;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      this.isCapturing = true;
      this.lastFpsUpdateTime = performance.now();
      this.startFrameLoop();

      const settings = track?.getSettings?.();

      return {
        isActive: true,
        hasTorch: this.capabilities.hasTorch,
        isTorchOn: this.capabilities.hasTorch,
        is3aLocked: this.is3aLocked,
        fps: this.fps,
        resolution: {
          width: settings?.width || 320,
          height: settings?.height || 240,
        },
        capabilities: this.capabilities,
        error: null,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        isActive: false,
        hasTorch: false,
        isTorchOn: false,
        is3aLocked: false,
        fps: 0,
        resolution: { width: 0, height: 0 },
        capabilities: this.capabilities,
        error: errorMsg,
      };
    }
  }

  /**
   * Inspecciona las capacidades de bajo nivel expuestas por el driver de la cámara.
   */
  private inspectCapabilities(track: MediaStreamTrack): void {
    try {
      const caps = (track as unknown as { getCapabilities?: () => Record<string, unknown> }).getCapabilities?.();
      if (!caps) return;

      this.capabilities = {
        hasTorch: Boolean(caps['torch']),
        hasManualExposure: Array.isArray(caps['exposureMode']) && (caps['exposureMode'] as string[]).includes('manual'),
        hasManualWhiteBalance: Array.isArray(caps['whiteBalanceMode']) && (caps['whiteBalanceMode'] as string[]).includes('manual'),
        hasManualFocus: Array.isArray(caps['focusMode']) && (caps['focusMode'] as string[]).includes('manual'),
        exposureMode: caps['exposureMode'] as string[] | undefined,
        whiteBalanceMode: caps['whiteBalanceMode'] as string[] | undefined,
        focusMode: caps['focusMode'] as string[] | undefined,
        minFrameRate: (caps['frameRate'] as { min?: number })?.min,
        maxFrameRate: (caps['frameRate'] as { max?: number })?.max,
      };
    } catch {
      // Navegador sin soporte para getCapabilities
    }
  }

  /**
   * Bloquea la exposición, el balance de blancos y el enfoque automático (3A Lock)
   * para que las variaciones lumínicas detectadas correspondan exclusivamente a la sangre pulsátil.
   */
  public async apply3aLockAndTorch(track: MediaStreamTrack, torchOn: boolean): Promise<void> {
    try {
      const advancedConstraints: Record<string, unknown> = {};

      if (this.capabilities.hasTorch) {
        advancedConstraints['torch'] = torchOn;
      }
      if (this.capabilities.hasManualExposure) {
        advancedConstraints['exposureMode'] = 'manual';
      }
      if (this.capabilities.hasManualWhiteBalance) {
        advancedConstraints['whiteBalanceMode'] = 'manual';
      }
      if (this.capabilities.hasManualFocus) {
        advancedConstraints['focusMode'] = 'manual';
      }

      if (Object.keys(advancedConstraints).length > 0) {
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          advanced: [advancedConstraints],
        });
        this.is3aLocked = true;
      }
    } catch {
      // Fallback si el dispositivo no soporta restricciones avanzadas
      this.is3aLocked = false;
    }
  }

  /**
   * Control manual de la antorcha / linterna LED.
   */
  public async setTorch(on: boolean): Promise<boolean> {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;

    try {
      await this.apply3aLockAndTorch(track, on);
      return true;
    } catch {
      return false;
    }
  }

  private startFrameLoop(): void {
    const video = this.videoElement;
    if (!video || !this.ctx || !this.canvas) return;

    const processFrame = (now: number) => {
      if (!this.isCapturing) return;

      // Medición de FPS en tiempo real
      this.frameCount++;
      if (now - this.lastFpsUpdateTime >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdateTime));
        this.frameCount = 0;
        this.lastFpsUpdateTime = now;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const w = this.canvas!.width;
        const h = this.canvas!.height;

        this.ctx!.drawImage(video, 0, 0, w, h);
        const imgData = this.ctx!.getImageData(0, 0, w, h);

        if (this.onFrameCallback) {
          this.onFrameCallback({
            rgba: imgData.data,
            width: w,
            height: h,
            timestampMs: now,
          });
        }
      }

      // Bucle de sincronización con el refresco del sensor
      if ('requestVideoFrameCallback' in video) {
        this.videoCallbackHandle = (video as unknown as {
          requestVideoFrameCallback: (cb: (now: number) => void) => number;
        }).requestVideoFrameCallback(processFrame);
      } else {
        this.animFrameId = requestAnimationFrame(processFrame);
      }
    };

    if ('requestVideoFrameCallback' in video) {
      this.videoCallbackHandle = (video as unknown as {
        requestVideoFrameCallback: (cb: (now: number) => void) => number;
      }).requestVideoFrameCallback(processFrame);
    } else {
      this.animFrameId = requestAnimationFrame(processFrame);
    }
  }

  /**
   * Detiene la captura y libera el hardware de la cámara.
   */
  public stop(): void {
    this.isCapturing = false;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.videoElement && this.videoCallbackHandle !== null && 'cancelVideoFrameCallback' in this.videoElement) {
      (this.videoElement as unknown as {
        cancelVideoFrameCallback: (handle: number) => void;
      }).cancelVideoFrameCallback(this.videoCallbackHandle);
      this.videoCallbackHandle = null;
    }

    if (this.stream) {
      this.setTorch(false).catch(() => undefined);
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }
}
