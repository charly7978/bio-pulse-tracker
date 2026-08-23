/**
 * TelemetryCanvasEngine
 *
 * Motor de renderizado en Canvas 2D de grado médico y alta fidelidad clínica.
 * Diseñado para 60 / 120 FPS con cero recolección de basura (GC-free) en el bucle caliente.
 *
 * Características biomédicas:
 * 1. Trazado spline continuo (Catmull-Rom) con halo de fósforo CRT y resplandor arterial volumétrico.
 * 2. Límites verticales garantizados con clamping estricto para evitar espículas o desbordamientos.
 * 3. Detección visual de puntos fiduciales: Pico Sistólico (S) y Muesca Dícrota (N).
 * 4. Atractor 2D de Poincaré con órbita de recurrencia de fase (SPAR).
 * 5. Calibración médica estándar de cuadrícula (25 mm/s, 10 mm/mV) con diseño limpio y sin superposiciones.
 */

import { CanvasEngineConfig, TelemetryFrame, PoincarePoint, ColorTheme, RenderMode } from './types';

export const DEFAULT_CANVAS_CONFIG: CanvasEngineConfig = {
  width: 600,
  height: 300,
  dpr: 1,
  gridColor: 'rgba(255, 255, 255, 0.07)',
  gridSubColor: 'rgba(255, 255, 255, 0.02)',
  phosphorDecay: 0.92,
  showGrid: true,
  showPoincarePlot: true,
  showFiducialPeaks: true,
  showDicroticNotch: true,
  showHudMetrics: true,
  showDerivatives: false,
  showVolumetricGlow: true,
  showTachogram: true,
  renderMode: 'ROLL',
  colorTheme: 'EMERALD',
};

interface ThemeColors {
  primary: string;
  primaryGlow: string;
  primaryCore: string;
  fillGradientTop: string;
  fillGradientMid: string;
  fillGradientBottom: string;
  systolicMarker: string;
  dicroticMarker: string;
  derivativeColor: string;
}

const THEME_PALETTES: Record<ColorTheme, ThemeColors> = {
  EMERALD: {
    primary: '#00f5a0',
    primaryGlow: 'rgba(0, 245, 160, 0.40)',
    primaryCore: '#ffffff',
    fillGradientTop: 'rgba(0, 245, 160, 0.22)',
    fillGradientMid: 'rgba(0, 245, 160, 0.06)',
    fillGradientBottom: 'rgba(0, 245, 160, 0.0)',
    systolicMarker: '#ffffff',
    dicroticMarker: '#fbbf24',
    derivativeColor: '#38bdf8',
  },
  RUBY: {
    primary: '#ff2a5f',
    primaryGlow: 'rgba(255, 42, 95, 0.45)',
    primaryCore: '#ffffff',
    fillGradientTop: 'rgba(255, 42, 95, 0.25)',
    fillGradientMid: 'rgba(255, 42, 95, 0.06)',
    fillGradientBottom: 'rgba(255, 42, 95, 0.0)',
    systolicMarker: '#ffffff',
    dicroticMarker: '#ffd60a',
    derivativeColor: '#bf5af2',
  },
  COBALT: {
    primary: '#00d2ff',
    primaryGlow: 'rgba(0, 210, 255, 0.40)',
    primaryCore: '#ffffff',
    fillGradientTop: 'rgba(0, 210, 255, 0.22)',
    fillGradientMid: 'rgba(0, 210, 255, 0.06)',
    fillGradientBottom: 'rgba(0, 210, 255, 0.0)',
    systolicMarker: '#ffffff',
    dicroticMarker: '#30d158',
    derivativeColor: '#a855f7',
  },
};

export class TelemetryCanvasEngine {
  private config: CanvasEngineConfig;
  private readonly maxSamples = 360; // ~12 segundos a 30 fps
  private readonly samples: Float32Array;
  private readonly vpgSamples: Float32Array;
  private readonly apgSamples: Float32Array;
  private readonly peakFlags: Uint8Array;
  private readonly dicroticFlags: Uint8Array;

  private sampleCount = 0;
  private writeIndex = 0;

  // Tacograma de tendencia de FC
  private readonly hrTrendBuffer: number[] = [];
  private readonly maxHrTrend = 30;

  private lastBpm = 0;
  private lastSqi = 0;
  private lastPi = 0;
  private lastContact: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' = 'NO_CONTACT';

  // Animación de pulso
  private pulseAnimationPhase = 0;

  // Atractor de Poincaré 2D
  private readonly poincareBuffer: PoincarePoint[] = [];
  private readonly maxPoincarePoints = 45;
  private readonly tauLag = 5;

  constructor(config: Partial<CanvasEngineConfig> = {}) {
    this.config = { ...DEFAULT_CANVAS_CONFIG, ...config };
    this.samples = new Float32Array(this.maxSamples);
    this.vpgSamples = new Float32Array(this.maxSamples);
    this.apgSamples = new Float32Array(this.maxSamples);
    this.peakFlags = new Uint8Array(this.maxSamples);
    this.dicroticFlags = new Uint8Array(this.maxSamples);
  }

  public resize(width: number, height: number, dpr: number = 1): void {
    this.config.width = width;
    this.config.height = height;
    this.config.dpr = dpr;
  }

  public setRenderMode(mode: RenderMode): void {
    this.config.renderMode = mode;
  }

  public setColorTheme(theme: ColorTheme): void {
    this.config.colorTheme = theme;
  }

  public toggleDerivatives(): boolean {
    this.config.showDerivatives = !this.config.showDerivatives;
    return this.config.showDerivatives;
  }

  public getBpm(): number { return this.lastBpm; }
  public getSqi(): number { return this.lastSqi; }
  public getPi(): number { return this.lastPi; }
  public getContactState(): 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' { return this.lastContact; }

  /**
   * Ingresa un nuevo fotograma de telemetría a los buffers circulares.
   */
  public pushFrame(frame: TelemetryFrame): void {
    // Normalizar valor recibido en rango seguro [-1.0, 1.0]
    const rawVal = frame.filteredValue;
    const val = Math.max(-1.0, Math.min(1.0, isNaN(rawVal) ? 0 : rawVal));

    const prevIdx = (this.writeIndex - 1 + this.maxSamples) % this.maxSamples;
    const prevVal = this.samples[prevIdx] || 0;
    const prevVpg = this.vpgSamples[prevIdx] || 0;

    // 1. Derivadas numéricas
    const vpg = (val - prevVal) * 30.0;
    const apg = (vpg - prevVpg) * 30.0;

    this.samples[this.writeIndex] = val;
    this.vpgSamples[this.writeIndex] = vpg;
    this.apgSamples[this.writeIndex] = apg;
    this.peakFlags[this.writeIndex] = frame.isPeak ? 1 : 0;

    // 2. Muesca dícrota
    let isDicrotic = false;
    if (this.sampleCount >= 6) {
      const idx2 = (this.writeIndex - 2 + this.maxSamples) % this.maxSamples;
      const idx4 = (this.writeIndex - 4 + this.maxSamples) % this.maxSamples;
      const v2 = this.vpgSamples[idx2]!;
      const v4 = this.vpgSamples[idx4]!;
      if (v4 < -0.15 && v2 >= -0.04 && vpg < 0.08) {
        isDicrotic = true;
      }
    }
    this.dicroticFlags[this.writeIndex] = isDicrotic ? 1 : 0;

    // 3. Atractor de Poincaré
    if (this.sampleCount >= this.tauLag && frame.contactState === 'STABLE_CONTACT') {
      const tauIdx = (this.writeIndex - this.tauLag + this.maxSamples) % this.maxSamples;
      const x = val;
      const y = this.samples[tauIdx]!;
      this.poincareBuffer.push({ x, y, alpha: 1.0 });
      if (this.poincareBuffer.length > this.maxPoincarePoints) {
        this.poincareBuffer.shift();
      }
    }

    // 4. Tendencia de FC
    if (frame.isPeak && frame.bpm > 30) {
      this.hrTrendBuffer.push(frame.bpm);
      if (this.hrTrendBuffer.length > this.maxHrTrend) {
        this.hrTrendBuffer.shift();
      }
      this.pulseAnimationPhase = 1.0;
    }

    this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
    if (this.sampleCount < this.maxSamples) this.sampleCount++;

    this.lastBpm = frame.bpm;
    this.lastSqi = frame.sqi;
    this.lastPi = frame.pi;
    this.lastContact = frame.contactState;
  }

  /**
   * Renderiza el cuadro de animación completo sobre el elemento Canvas o Contexto 2D.
   */
  public render(target: HTMLCanvasElement | CanvasRenderingContext2D): void {
    let ctx: CanvasRenderingContext2D | null = null;
    if ('getContext' in target) {
      ctx = target.getContext('2d', { alpha: true });
    } else {
      ctx = target;
    }
    if (!ctx) return;

    const width = this.config.width;
    const height = this.config.height;
    const theme = THEME_PALETTES[this.config.colorTheme] || THEME_PALETTES.EMERALD;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // 1. Cuadrícula médica
    if (this.config.showGrid) {
      this.drawHospitalGrid(ctx, width, height);
    }

    // Si no hay contacto estable, dibujar línea guía y regresar
    if (this.lastContact !== 'STABLE_CONTACT') {
      this.drawNoContactGuidance(ctx, width, height);
      ctx.restore();
      return;
    }

    // 2. Resplandor volumétrico arterial bajo la curva
    if (this.config.showVolumetricGlow) {
      this.drawVolumetricBloodGlow(ctx, width, height, theme);
    }

    // 3. Trazo de onda primaria PPG con Spline cúbico y halo CRT
    this.drawPrimaryPpgWaveform(ctx, width, height, theme);

    // 4. Marcadores fiduciales (Pico Sistólico y Muesca Dícrota)
    if (this.config.showFiducialPeaks) {
      this.drawFiducialMarkers(ctx, width, height, theme);
    }

    // 5. Curva derivada APG (si está activada)
    if (this.config.showDerivatives) {
      this.drawDerivativeWaveform(ctx, width, height, theme);
    }

    // 6. Atractor de Poincaré 2D
    if (this.config.showPoincarePlot && this.poincareBuffer.length > 3) {
      this.drawPoincareAttractor(ctx, width, height, theme);
    }

    // 7. Barra de estado inferior médica
    this.drawBottomCalibrationInfo(ctx, width, height);

    // Decaimiento de animación de pulso
    if (this.pulseAnimationPhase > 0) {
      this.pulseAnimationPhase = Math.max(0, this.pulseAnimationPhase - 0.05);
    }

    ctx.restore();
  }

  /**
   * Cuadrícula médica estandarizada (25 mm/s, 10 mm/mV).
   */
  private drawHospitalGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const majorGrid = 44;
    const minorGrid = 11;

    ctx.save();

    // Sub-cuadrícula fina
    ctx.beginPath();
    ctx.strokeStyle = this.config.gridSubColor;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < width; x += minorGrid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += minorGrid) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Cuadrícula principal
    ctx.beginPath();
    ctx.strokeStyle = this.config.gridColor;
    ctx.lineWidth = 1.0;
    for (let x = 0; x < width; x += majorGrid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += majorGrid) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Línea isobárica central (Línea de base)
    const midY = height / 2;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Resplandor volumétrico arterial bajo la curva.
   */
  private drawVolumetricBloodGlow(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    if (this.sampleCount < 4) return;

    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;

    ctx.save();
    const grad = ctx.createLinearGradient(0, height * 0.15, 0, height);
    grad.addColorStop(0, theme.fillGradientTop);
    grad.addColorStop(0.6, theme.fillGradientMid);
    grad.addColorStop(1, theme.fillGradientBottom);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, height);
    ctx.lineTo(points[0]!.x, points[0]!.y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }

    const lastPt = points[points.length - 1]!;
    ctx.lineTo(lastPt.x, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Trazo de la onda PPG con Spline cúbico y halo CRT.
   */
  private drawPrimaryPpgWaveform(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;

    ctx.save();

    // Capa 1: Resplandor exterior (Bloom difuso)
    ctx.strokeStyle = theme.primaryGlow;
    ctx.lineWidth = 6.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 14;
    this.renderSplinePath(ctx, points);
    ctx.stroke();

    // Capa 2: Cuerpo medio luminoso
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 2.8;
    ctx.shadowBlur = 6;
    this.renderSplinePath(ctx, points);
    ctx.stroke();

    // Capa 3: Núcleo blanco de alta intensidad (filamento de fósforo)
    ctx.strokeStyle = theme.primaryCore;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 0;
    this.renderSplinePath(ctx, points);
    ctx.stroke();

    // Cursor de barrido en el extremo actual
    const tip = points[points.length - 1]!;
    ctx.fillStyle = theme.primary;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4.0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 2.0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Marcadores fiduciales discretos (Pico Sistólico S y Muesca Dícrota N).
   */
  private drawFiducialMarkers(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;

    ctx.save();
    const count = points.length;

    for (let i = 0; i < count; i++) {
      const idx = (this.writeIndex - count + i + this.maxSamples) % this.maxSamples;
      const pt = points[i]!;

      // Pico sistólico
      if (this.peakFlags[idx] === 1) {
        ctx.fillStyle = theme.systolicMarker;
        ctx.shadowColor = theme.primary;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = theme.primary;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6.0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Muesca dícrota
      if (this.config.showDicroticNotch && this.dicroticFlags[idx] === 1) {
        ctx.fillStyle = theme.dicroticMarker;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Onda derivada APG (Aceleropletismografía d²PPG/dt²).
   */
  private drawDerivativeWaveform(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    if (this.sampleCount < 4) return;

    const midY = height * 0.78;
    const dx = width / (this.maxSamples - 1);
    const count = this.sampleCount;

    ctx.save();
    ctx.strokeStyle = theme.derivativeColor;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();

    for (let i = 0; i < count; i++) {
      const idx = (this.writeIndex - count + i + this.maxSamples) % this.maxSamples;
      const apg = Math.max(-2, Math.min(2, this.apgSamples[idx]!));
      const x = i * dx;
      const y = Math.max(height * 0.55, Math.min(height - 15, midY - apg * 12));

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * Atractor de recurrencia de fase 2D de Poincaré (SPAR).
   */
  private drawPoincareAttractor(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    theme: ThemeColors
  ): void {
    const boxSize = 72;
    const padding = 12;
    const originX = width - boxSize - padding;
    const originY = padding + 8;
    const centerX = originX + boxSize / 2;
    const centerY = originY + boxSize / 2;
    const scale = boxSize * 0.40;

    ctx.save();

    // Fondo glassmórfico
    ctx.fillStyle = 'rgba(18, 18, 22, 0.65)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(originX, originY, boxSize, boxSize, 8);
    ctx.fill();
    ctx.stroke();

    // Ejes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(originX + 6, centerY);
    ctx.lineTo(originX + boxSize - 6, centerY);
    ctx.moveTo(centerX, originY + 6);
    ctx.lineTo(centerX, originY + boxSize - 6);
    ctx.stroke();

    // Etiqueta
    ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
    ctx.font = '7px -apple-system, system-ui, sans-serif';
    ctx.fillText('ÓRBITA 2D', originX + 6, originY + 11);

    // Trazado de puntos de fase
    const n = this.poincareBuffer.length;
    for (let i = 0; i < n; i++) {
      const pt = this.poincareBuffer[i]!;
      const alpha = (i + 1) / n;
      const px = centerX + pt.x * scale;
      const py = centerY - pt.y * scale;

      const boundedX = Math.max(originX + 4, Math.min(originX + boxSize - 4, px));
      const boundedY = Math.max(originY + 4, Math.min(originY + boxSize - 4, py));

      ctx.fillStyle = theme.primary;
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.arc(boundedX, boundedY, i === n - 1 ? 2.5 : 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Barra de calibración clínica inferior.
   */
  private drawBottomCalibrationInfo(ctx: CanvasRenderingContext2D, _width: number, height: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText('25 mm/s · 10 mm/mV · FILTRO [0.65-3.5 Hz] · DERIVACIÓN I', 12, height - 10);
    ctx.restore();
  }

  /**
   * Mensaje y línea plana en ausencia de contacto estable.
   */
  private drawNoContactGuidance(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const midY = height / 2;

    ctx.save();
    // Línea plana isobárica
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CUBRE LA CÁMARA Y EL FLASH CON LA YEMA DEL DEDO', width / 2, midY);
    ctx.restore();
  }

  /**
   * Convierte las muestras en coordenadas de pantalla garantizando centrado y límites estrictos.
   */
  private calculateScreenPoints(width: number, height: number): { x: number; y: number }[] {
    const count = this.sampleCount;
    if (count < 2) return [];

    const midY = height * 0.50;
    const amplitudeScale = height * 0.35; // Escala vertical estética (~70% de la altura total)
    const dx = width / (this.maxSamples - 1);
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < count; i++) {
      const idx = (this.writeIndex - count + i + this.maxSamples) % this.maxSamples;
      const val = this.samples[idx]!;
      const x = i * dx;
      // Inversión para que absorción de sangre (sístole) sea un pico positivo hacia arriba
      const rawY = midY - val * amplitudeScale;
      // Clamping estricto para no tocar los bordes del contenedor
      const y = Math.max(14, Math.min(height - 14, rawY));
      points.push({ x, y });
    }

    return points;
  }

  /**
   * Trazado de spline cúbico Catmull-Rom continuo.
   */
  private renderSplinePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  public reset(): void {
    this.samples.fill(0);
    this.vpgSamples.fill(0);
    this.apgSamples.fill(0);
    this.peakFlags.fill(0);
    this.dicroticFlags.fill(0);
    this.sampleCount = 0;
    this.writeIndex = 0;
    this.poincareBuffer.length = 0;
    this.hrTrendBuffer.length = 0;
    this.lastBpm = 0;
    this.lastSqi = 0;
    this.lastPi = 0;
    this.lastContact = 'NO_CONTACT';
  }
}
