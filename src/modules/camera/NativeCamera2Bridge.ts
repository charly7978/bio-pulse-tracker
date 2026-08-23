/**
 * NativeCamera2Bridge
 *
 * Puente unificado que detecta automáticamente si la aplicación se ejecuta en
 * el entorno nativo de Android (usando el plugin nativo Camera2 de bajo nivel en YUV_420_888)
 * o en el navegador web (usando MediaStreamTrack con Bloqueo 3A).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { CameraCaptureService } from './CameraCaptureService';
import { CameraState, FrameData } from './types';

interface Camera2PpgPluginInterface {
  startCapture(): Promise<{ status: string; format?: string; width?: number; height?: number }>;
  stopCapture(): Promise<{ status: string }>;
  addListener(
    eventName: 'onOpticalFrame',
    listenerFunc: (data: { luminance: number; timestampNanos: number; timestampMs: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const Camera2Ppg = registerPlugin<Camera2PpgPluginInterface>('Camera2Ppg');

export class UnifiedOpticalSensorEngine {
  private isNative = Capacitor.isNativePlatform();
  private webCaptureService: CameraCaptureService | null = null;
  private nativeListenerHandle: { remove: () => Promise<void> } | null = null;

  public isNativeAndroid(): boolean {
    return this.isNative;
  }

  /**
   * Inicia la captura óptica utilizando el backend óptimo según la plataforma.
   */
  public async start(
    videoElement: HTMLVideoElement,
    onFrame: (frame: FrameData) => void
  ): Promise<CameraState> {
    if (this.isNative) {
      try {
        const result = await Camera2Ppg.startCapture();

        this.nativeListenerHandle = await Camera2Ppg.addListener('onOpticalFrame', (data) => {
          // Sintetizar FrameData a partir de la luminancia Y nativa
          const lum = Math.min(255, Math.max(0, Math.round(data.luminance)));
          const mockRgba = new Uint8ClampedArray(320 * 240 * 4);
          mockRgba.fill(lum);

          onFrame({
            rgba: mockRgba,
            width: result.width || 320,
            height: result.height || 240,
            timestampMs: data.timestampMs,
          });
        });

        return {
          isActive: true,
          hasTorch: true,
          isTorchOn: true,
          is3aLocked: true,
          fps: 60,
          resolution: { width: result.width || 320, height: result.height || 240 },
          capabilities: {
            hasTorch: true,
            hasManualExposure: true,
            hasManualWhiteBalance: true,
            hasManualFocus: true,
          },
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
          capabilities: {
            hasTorch: false,
            hasManualExposure: false,
            hasManualWhiteBalance: false,
            hasManualFocus: false,
          },
          error: errorMsg,
        };
      }
    } else {
      // Backend Web
      if (!this.webCaptureService) {
        this.webCaptureService = new CameraCaptureService();
      }
      return this.webCaptureService.start(videoElement, onFrame);
    }
  }

  public async setTorch(on: boolean): Promise<boolean> {
    if (this.isNative) {
      return true; // En nativo está fijado en el CaptureRequest
    } else if (this.webCaptureService) {
      return this.webCaptureService.setTorch(on);
    }
    return false;
  }

  public async stop(): Promise<void> {
    if (this.isNative) {
      if (this.nativeListenerHandle) {
        await this.nativeListenerHandle.remove();
        this.nativeListenerHandle = null;
      }
      await Camera2Ppg.stopCapture();
    } else if (this.webCaptureService) {
      this.webCaptureService.stop();
    }
  }
}
