/**
 * CameraCaptureService
 *
 * Servicio de control de hardware de cámara y flash LED en tiempo real.
 * Utiliza requestVideoFrameCallback con fallback a requestAnimationFrame
 * para capturar los fotogramas del sensor óptico con mínima latencia y jitter.
 */

import { CameraState, FrameData } from './types';

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

  /**
   * Inicia la captura desde la cámara trasera con soporte de linterna / flash.
   */
  public async start(
    videoElement: HTMLVideoElement,
    onFrame: (frame: FrameData) => void
  ): Promise<CameraState> {
    this.videoElement = videoElement;
    this.onFrameCallback = onFrame;

    // Configuración óptica: cámara trasera ('environment') a 320x240 @ 30 FPS para baja carga computacional
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 30, min: 25 },
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = this.stream;
      await videoElement.play();

      // Canvas de procesamiento offscreen
      this.canvas = document.createElement('canvas');
      this.canvas.width = 320;
      this.canvas.height = 240;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      // Encender flash LED si está disponible en el hardware móvil
      const hasTorch = await this.setTorch(true);

      this.isCapturing = true;
      this.lastFpsUpdateTime = performance.now();
      this.startFrameLoop();

      const track = this.stream.getVideoTracks()[0];
      const settings = track?.getSettings?.();

      return {
        isActive: true,
        hasTorch,
        isTorchOn: hasTorch,
        fps: this.fps,
        resolution: {
          width: settings?.width || 320,
          height: settings?.height || 240,
        },
        error: null,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        isActive: false,
        hasTorch: false,
        isTorchOn: false,
        fps: 0,
        resolution: { width: 0, height: 0 },
        error: errorMsg,
      };
    }
  }

  /**
   * Activa o desactiva el flash / antorcha LED en el hardware móvil.
   */
  public async setTorch(on: boolean): Promise<boolean> {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;

    try {
      // Comprobar soporte de antorcha
      const capabilities = (track as unknown as { getCapabilities?: () => { torch?: boolean } }).getCapabilities?.();
      if (capabilities && 'torch' in capabilities && capabilities.torch) {
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          advanced: [{ torch: on }],
        });
        return true;
      }
    } catch {
      // Dispositivo no compatible con torch API
    }
    return false;
  }

  private startFrameLoop(): void {
    const video = this.videoElement;
    if (!video || !this.ctx || !this.canvas) return;

    const processFrame = (now: number) => {
      if (!this.isCapturing) return;

      // Cálculo de FPS real
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

      // Continuar bucle
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
   * Detiene la captura, apaga la cámara y libera recursos de hardware.
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
