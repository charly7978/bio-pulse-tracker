/**
 * Tipos e interfaces para el motor de renderizado de telemetría médica en Canvas.
 */

export type RenderMode = 'SWEEP' | 'ROLL';
export type ColorTheme = 'EMERALD' | 'RUBY' | 'COBALT';

export interface TelemetryFrame {
  timestampMs: number;
  filteredValue: number;
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  isPeak: boolean;
  sqi: number; // [0.0 - 1.0]
  pi: number; // [%]
  bpm: number;
  confidence: number;
  contactState: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';
}

export interface CanvasEngineConfig {
  width: number;
  height: number;
  dpr: number; // Device Pixel Ratio
  gridColor: string;
  gridSubColor: string;
  phosphorDecay: number;
  showGrid: boolean;
  showPoincarePlot: boolean;
  showFiducialPeaks: boolean;
  showDicroticNotch: boolean;
  showHudMetrics: boolean;
  showDerivatives: boolean;
  showVolumetricGlow: boolean;
  showTachogram: boolean;
  renderMode: RenderMode;
  colorTheme: ColorTheme;
}

export interface PoincarePoint {
  x: number;
  y: number;
  alpha: number;
}
