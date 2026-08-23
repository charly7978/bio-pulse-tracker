/**
 * Tipos e interfaces para el servicio de captura de cámara óptica avanzada con bloqueo 3A y flash.
 */

export interface AdvancedCameraCapabilities {
  hasTorch: boolean;
  hasManualExposure: boolean;
  hasManualWhiteBalance: boolean;
  hasManualFocus: boolean;
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  focusMode?: string[];
  minFrameRate?: number;
  maxFrameRate?: number;
}

export interface CameraState {
  isActive: boolean;
  hasTorch: boolean;
  isTorchOn: boolean;
  is3aLocked: boolean; // Auto-Exposure, Auto-White-Balance, Focus bloqueados
  fps: number;
  resolution: { width: number; height: number };
  capabilities: AdvancedCameraCapabilities;
  error: string | null;
}

export interface FrameData {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  timestampMs: number;
}
