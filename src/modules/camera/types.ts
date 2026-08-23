/**
 * Tipos e interfaces para el servicio de captura de cámara óptica con flash LED.
 */

export interface CameraState {
  isActive: boolean;
  hasTorch: boolean;
  isTorchOn: boolean;
  fps: number;
  resolution: { width: number; height: number };
  error: string | null;
}

export interface FrameData {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  timestampMs: number;
}
