/**
 * CameraCaptureService
 *
 * Servicio unificado de captura óptica para Web y Android Nativo.
 * Aplica:
 * 1. Conexión directa a la cámara trasera con fallback automático de resolución.
 * 2. Bloqueo 3A de hardware (AE, AWB, AF) y activación del Flash LED (Torch).
 * 3. Enrutamiento del flujo de video en vivo al elemento <video> en pantalla completa.
 * 4. Extracción de fotogramas RGBA en tiempo real mediante requestVideoFrameCallback / requestAnimationFrame.
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

  public isNativePlatform(): boolean {
    return false;
  }

  public async start(
    videoElement: HTMLVideoElement,
    onFrame: (frame: FrameData) => void
  ): Promise<CameraState> {
    this.videoElement = videoElement;
    this.onFrameCallback = onFrame;

    // Asegurar atributos clave para reproducción inline en Android WebView / iOS
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('webkit-playsinline', 'true');
    videoElement.setAttribute('autoplay', 'true');
    videoElement.muted = true;

    // Estrategias de constraints con fallback progresivo
    const constraintStrategies: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640, min: 320 },
          height: { ideal: 480, min: 240 },
          frameRate: { ideal: 60, min: 30 },
        },
      },
      {
        audio: false,
        video: {
          facingMode: 'environment',
        },
      },
      {
        audio: false,
        video: true,
      },
    ];

    let lastError: Error | null = null;

    for (const constraints of constraintStrategies) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    if (!this.stream) {
      return {
        isActive: false,
        hasTorch: false,
        isTorchOn: false,
        is3aLocked: false,
        fps: 0,
        resolution: { width: 0, height: 0 },
        capabilities: this.capabilities,
        error: lastError ? lastError.message : 'No se pudo acceder a la cámara del dispositivo',
      };
    }

    try {
      videoElement.srcObject = this.stream;
      await videoElement.play();

      const track = this.stream.getVideoTracks()[0];
      if (track) {
        this.inspectCapabilities(track);
        await this.apply3aLockAndTorch(track, true);
      }

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
        fps: this.fps || 30,
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

  private inspectCapabilities(track: MediaStreamTrack): void {
    try {
      const caps = (track as unknown as { getCapabilities?: () => Record<string, unknown> }).getCapabilities?.();
      if (!caps) return;

      this.capabilities = {
        hasTorch: Boolean(caps['torch']),
        hasManualExposure: Array.isArray(caps['exposureMode']) && (caps['exposureMode'] as string[]).includes('manual'),
        hasManualWhiteBalance: Array.isArray(caps['whiteBalanceMode']) && (caps['whiteBalanceMode'] as string[]).includes('manual'),
        hasManualFocus: Array.isArray(caps['focusMode']) && (caps['focusMode'] as string[]).includes('manual'),
      };
    } catch {
      // Ignorar si el navegador no expone getCapabilities
    }
  }

  public async apply3aLockAndTorch(track: MediaStreamTrack, torchOn: boolean): Promise<void> {
    try {
      const advancedConstraints: Record<string, unknown> = {};
      if (this.capabilities.hasTorch) advancedConstraints['torch'] = torchOn;
      if (this.capabilities.hasManualExposure) advancedConstraints['exposureMode'] = 'manual';
      if (this.capabilities.hasManualWhiteBalance) advancedConstraints['whiteBalanceMode'] = 'manual';
      if (this.capabilities.hasManualFocus) advancedConstraints['focusMode'] = 'manual';

      if (Object.keys(advancedConstraints).length > 0) {
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          advanced: [advancedConstraints],
        });
        this.is3aLocked = true;
      }
    } catch {
      this.is3aLocked = false;
    }
  }

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

  public async stop(): Promise<void> {
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
