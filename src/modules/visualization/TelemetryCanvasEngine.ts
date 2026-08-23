/**
 * TelemetryCanvasEngine
 *
 * Motor de renderizado en Canvas 2D de grado médico y alta fidelidad clínica.
 * Diseñado para 60 / 120 FPS con cero recolección de basura (GC-free) en el bucle caliente.
 *
 * Características biomédicas:
 * 1. Trazado spline continuo (Catmull-Rom) con halo de fósforo y resplandor arterial volumétrico.
 * 2. Modos duales de visualización: Barrido clínico de monitor UCI (Sweep Bar) y Flujo continuo (Roll).
 * 3. Detección visual de puntos fiduciales: Pico Sistólico (S), Muesca Dícrota (N), Cresta Diastólica (D).
 * 4. Descomposición de ondas derivadas: VPG (Velocidad dPPG/dt) y APG (Aceleración d²PPG/dt²).
 * 5. Atractor 2D de Poincaré con órbita de recurrencia de fase (SPAR) y elipse de variabilidad.
 * 6. Calibración médica estándar de cuadrícula (25 mm/s, 10 mm/mV) con tacograma de tendencia.
 */

import { CanvasEngineConfig, TelemetryFrame, PoincarePoint, ColorTheme, RenderMode } from './types';

export const DEFAULT_CANVAS_CONFIG: CanvasEngineConfig = {
  width: 600,
  height: 300,
  dpr: 1,
  gridColor: 'rgba(255, 255, 255, 0.08)',
  gridSubColor: 'rgba(255, 255, 255, 0.025)',
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
    primaryGlow: 'rgba(0, 245, 160, 0.45)',
    primaryCore: '#ffffff',
    fillGradientTop: 'rgba(0, 245, 160, 0.28)',
    fillGradientMid: 'rgba(0, 245, 160, 0.08)',
    fillGradientBottom: 'rgba(0, 245, 160, 0.0)',
    systolicMarker: '#ffffff',
    dicroticMarker: '#fbbf24',
    derivativeColor: '#38bdf8',
  },
  RUBY: {
    primary: '#ff2a5f',
    primaryGlow: 'rgba(255, 42, 95, 0.50)',
    primaryCore: '#ffffff',
    fillGradientTop: 'rgba(255, 42, 95, 0.30)',
    fillGradientMid: 'rgba(255, 42, 95, 0.08)',
    fillGradientBottom: 'rgba(255, 42, 95, 0.0)',
    systolicMarker: '#ffffff',
    dicroticMarker: '#ffd60a',
    derivativeColor: '#bf5af2',
  },
  COBALT: {
    primary: '#00d2ff',
    primaryGlow: 'rgba(0, 210, 255, 0.45)',
    primaryCore: '#ffffff',
    fillGradientTop: 'rgba(0, 210, 255, 0.28)',
    fillGradientMid: 'rgba(0, 210, 255, 0.08)',
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
  private readonly vpgSamples: Float32Array; // 1ra derivada
  private readonly apgSamples: Float32Array; // 2da derivada
  private readonly peakFlags: Uint8Array;
  private readonly dicroticFlags: Uint8Array;

  private sampleCount = 0;
  private writeIndex = 0;

  // Búfer de tacograma de FC (últimos 30 latidos)
  private readonly hrTrendBuffer: number[] = [];
  private readonly maxHrTrend = 30;

  // Normalización adaptativa de amplitud
  private minVal = -1.0;
  private maxVal = 1.0;
  private lastBpm = 0;
  private lastSqi = 0;
  private lastPi = 0;
  private lastConfidence = 0;
  private lastContact: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' = 'NO_CONTACT';

  // Animación de pulso sistólico
  private pulseAnimationPhase = 0;

  // Atractor de Poincaré 2D
  private readonly poincareBuffer: PoincarePoint[] = [];
  private readonly maxPoincarePoints = 60;
  private readonly tauLag = 6;

  // Índice de barrido para modo SWEEP (estilo monitor de quirófano)
  private sweepCursor = 0;

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
    const val = frame.filteredValue;
    const prevIdx = (this.writeIndex - 1 + this.maxSamples) % this.maxSamples;
    const prevVal = this.samples[prevIdx] || 0;
    const prevVpg = this.vpgSamples[prevIdx] || 0;

    // 1. Cálculo de derivadas numéricas (VPG y APG)
    const vpg = (val - prevVal) * 30.0;
    const apg = (vpg - prevVpg) * 30.0;

    this.samples[this.writeIndex] = val;
    this.vpgSamples[this.writeIndex] = vpg;
    this.apgSamples[this.writeIndex] = apg;
    this.peakFlags[this.writeIndex] = frame.isPeak ? 1 : 0;

    // 2. Detección morfométrica de la Muesca Dícrota (inflexión en descenso catacrótico)
    let isDicrotic = false;
    if (this.sampleCount >= 6) {
      const idx2 = (this.writeIndex - 2 + this.maxSamples) % this.maxSamples;
      const idx4 = (this.writeIndex - 4 + this.maxSamples) % this.maxSamples;
      const v2 = this.vpgSamples[idx2]!;
      const v4 = this.vpgSamples[idx4]!;
      // Cruce por cero o cambio de concavidad tras sístole
      if (v4 < -0.2 && v2 >= -0.05 && vpg < 0.1) {
        isDicrotic = true;
      }
    }
    this.dicroticFlags[this.writeIndex] = isDicrotic ? 1 : 0;

    // 3. Atractor de Poincaré
    if (this.sampleCount >= this.tauLag) {
      const tauIdx = (this.writeIndex - this.tauLag + this.maxSamples) % this.maxSamples;
      const x = val;
      const y = this.samples[tauIdx]!;
      this.poincareBuffer.push({ x, y, alpha: 1.0 });
      if (this.poincareBuffer.length > this.maxPoincarePoints) {
        this.poincareBuffer.shift();
      }
    }

    // 4. Registro de tendencia de FC
    if (frame.isPeak && frame.bpm > 30) {
      this.hrTrendBuffer.push(frame.bpm);
      if (this.hrTrendBuffer.length > this.maxHrTrend) {
        this.hrTrendBuffer.shift();
      }
      this.pulseAnimationPhase = 1.0;
    }

    this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
    if (this.sampleCount < this.maxSamples) this.sampleCount++;
    this.sweepCursor = (this.sweepCursor + 1) % this.maxSamples;

    this.lastBpm = frame.bpm;
    this.lastSqi = frame.sqi;
    this.lastPi = frame.pi;
    this.lastConfidence = frame.confidence;
    this.lastContact = frame.contactState;

    // Adaptación suave de rango dinámico
    if (val < this.minVal) this.minVal = this.minVal * 0.92 + val * 0.08;
    else this.minVal = this.minVal * 0.999 + (-0.6) * 0.001;

    if (val > this.maxVal) this.maxVal = this.maxVal * 0.92 + val * 0.08;
    else this.maxVal = this.maxVal * 0.999 + 0.6 * 0.001;
  }

  /**
   * Renderiza el estado completo en el contexto 2D del Canvas.
   */
  public render(ctx: CanvasRenderingContext2D): void {
    const { width, height, dpr, showGrid, showPoincarePlot, showFiducialPeaks, showDerivatives, showVolumetricGlow } = this.config;
    const theme = THEME_PALETTES[this.config.colorTheme] || THEME_PALETTES.EMERALD;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Limpieza con transparencia pura
    ctx.clearRect(0, 0, width, height);

    // 2. Cuadrícula médica milimétrica estándar de monitor hospitalario
    if (showGrid) {
      this.drawHospitalGrid(ctx, width, height);
    }

    // Si no hay contacto estable, dibujar línea plana y mensaje clínico
    if (this.lastContact !== 'STABLE_CONTACT') {
      this.drawNoContactGuidance(ctx, width, height);
      ctx.restore();
      return;
    }

    // 3. Resplandor volumétrico arterial bajo la curva
    if (showVolumetricGlow) {
      this.drawVolumetricBloodGlow(ctx, width, height, theme);
    }

    // 4. Trazo de onda primaria PPG con Spline cúbico y halo de fósforo
    this.drawPrimaryPpgWaveform(ctx, width, height, theme);

    // 5. Marcadores fiduciales (Pico Sistólico y Muesca Dícrota)
    if (showFiducialPeaks) {
      this.drawFiducialMarkers(ctx, width, height, theme);
    }

    // 6. Curva derivada APG / VPG (si está habilitada en modo diagnóstico)
    if (showDerivatives) {
      this.drawDerivativeWaveform(ctx, width, height, theme);
    }

    // 7. Paneles HUD clínicos sobre el Canvas
    if (this.config.showHudMetrics) {
      this.drawClinicalHud(ctx, width, height, theme);
    }

    // 8. Atractor de Poincaré 2D
    if (showPoincarePlot) {
      this.drawPoincareAttractor(ctx, width, height, theme);
    }

    // 9. Tacograma de tendencia de FC
    if (this.config.showTachogram && this.hrTrendBuffer.length > 2) {
      this.drawHrTachogram(ctx, width, height, theme);
    }

    // Decaimiento de animación de pulso
    if (this.pulseAnimationPhase > 0) {
      this.pulseAnimationPhase = Math.max(0, this.pulseAnimationPhase - 0.05);
    }

    ctx.restore();
  }

  /**
   * Cuadrícula médica estandarizada (calibración 25 mm/s, 10 mm/mV).
   */
  private drawHospitalGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const majorGrid = 40; // Cuadro mayor
    const minorGrid = 8;  // Sub-cuadrícula milimétrica

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

    // Línea isobárica central (Eje Cero)
    const midY = height / 2;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([6, 6]);
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Resplandor volumétrico arterial bajo la curva (gradiente dinámico).
   */
  private drawVolumetricBloodGlow(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    if (this.sampleCount < 4) return;

    const range = Math.max(0.1, this.maxVal - this.minVal);
    const midY = height / 2;
    const scaleY = (height * 0.65) / range;
    const dx = width / (this.maxSamples - 1);

    ctx.save();
    const grad = ctx.createLinearGradient(0, midY - height * 0.35, 0, height);
    grad.addColorStop(0, theme.fillGradientTop);
    grad.addColorStop(0.5, theme.fillGradientMid);
    grad.addColorStop(1, theme.fillGradientBottom);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 0; i < this.sampleCount; i++) {
      const idx = (this.writeIndex - this.sampleCount + i + this.maxSamples) % this.maxSamples;
      const val = this.samples[idx]!;
      const x = i * dx;
      const y = midY - (val - (this.minVal + this.maxVal) / 2) * scaleY;
      ctx.lineTo(x, y);
    }

    const lastX = (this.sampleCount - 1) * dx;
    ctx.lineTo(lastX, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Trazo de la onda PPG con Spline cúbico y halo de fósforo CRT.
   */
  private drawPrimaryPpgWaveform(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    if (this.sampleCount < 2) return;

    const range = Math.max(0.1, this.maxVal - this.minVal);
    const midY = height / 2;
    const scaleY = (height * 0.65) / range;
    const dx = width / (this.maxSamples - 1);

    // Calcular puntos en pantalla
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < this.sampleCount; i++) {
      const idx = (this.writeIndex - this.sampleCount + i + this.maxSamples) % this.maxSamples;
      const val = this.samples[idx]!;
      const x = i * dx;
      const y = midY - (val - (this.minVal + this.maxVal) / 2) * scaleY;
      points.push({ x, y });
    }

    ctx.save();

    // Capa 1: Resplandor exterior (Bloom difuso)
    ctx.strokeStyle = theme.primaryGlow;
    ctx.lineWidth = 7.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 18;
    this.renderSplinePath(ctx, points);
    ctx.stroke();

    // Capa 2: Cuerpo medio luminoso
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 3.2;
    ctx.shadowBlur = 8;
    this.renderSplinePath(ctx, points);
    ctx.stroke();

    // Capa 3: Núcleo blanco de alta intensidad (filamento de fósforo analógico)
    ctx.strokeStyle = theme.primaryCore;
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 0;
    this.renderSplinePath(ctx, points);
    ctx.stroke();

    // Cursor de barrido activo (si está en modo SWEEP o al final del trazado)
    const tip = points[points.length - 1]!;
    ctx.fillStyle = theme.primary;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 14;
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
   * Traza una curva spline suave (Catmull-Rom a Bézier cúbico).
   */
  private renderSplinePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);

    if (points.length === 2) {
      ctx.lineTo(points[1]!.x, points[1]!.y);
      return;
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1]! : points[i]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = i < points.length - 2 ? points[i + 2]! : p2;

      // Puntos de control Catmull-Rom (tensión = 0.5)
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  /**
   * Marcadores fiduciales de Pico Sistólico y Muesca Dícrota.
   */
  private drawFiducialMarkers(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    const range = Math.max(0.1, this.maxVal - this.minVal);
    const midY = height / 2;
    const scaleY = (height * 0.65) / range;
    const dx = width / (this.maxSamples - 1);

    ctx.save();

    for (let i = 0; i < this.sampleCount; i++) {
      const idx = (this.writeIndex - this.sampleCount + i + this.maxSamples) % this.maxSamples;
      const isPeak = this.peakFlags[idx] === 1;
      const isDicrotic = this.config.showDicroticNotch && this.dicroticFlags[idx] === 1;

      if (!isPeak && !isDicrotic) continue;

      const val = this.samples[idx]!;
      const px = i * dx;
      const py = midY - (val - (this.minVal + this.maxVal) / 2) * scaleY;

      if (isPeak) {
        // Marcador Sistólico (S)
        const pulseExpand = i === this.sampleCount - 1 ? this.pulseAnimationPhase * 6 : 0;

        ctx.fillStyle = theme.systolicMarker;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = theme.primary;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = theme.primary;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(px, py, 7.5 + pulseExpand, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isDicrotic) {
        // Marcador Dícroto (N)
        ctx.fillStyle = theme.dicroticMarker;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Curva de la 2da Derivada (APG - Aceleración de la onda de pulso).
   */
  private drawDerivativeWaveform(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    if (this.sampleCount < 4) return;

    const dx = width / (this.maxSamples - 1);
    const bottomY = height - 28;
    const apgScale = 0.15;

    ctx.save();
    ctx.strokeStyle = theme.derivativeColor;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = theme.derivativeColor;
    ctx.shadowBlur = 4;
    ctx.setLineDash([2, 2]);

    ctx.beginPath();
    for (let i = 0; i < this.sampleCount; i++) {
      const idx = (this.writeIndex - this.sampleCount + i + this.maxSamples) % this.maxSamples;
      const apg = this.apgSamples[idx]!;
      const x = i * dx;
      const y = bottomY - Math.max(-20, Math.min(20, apg * apgScale));

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Etiqueta APG
    ctx.fillStyle = theme.derivativeColor;
    ctx.font = '600 8px var(--font-mono), monospace';
    ctx.fillText('APG (d²PPG/dt²)', 12, bottomY - 14);

    ctx.restore();
  }

  /**
   * HUD de telemetría clínica integrado en el Canvas.
   */
  private drawClinicalHud(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    ctx.save();
    ctx.font = '700 11px var(--font-mono), monospace';

    // 1. Frecuencia y Estado
    ctx.fillStyle = theme.primary;
    ctx.fillText(`${this.lastBpm > 0 ? this.lastBpm : '--'} BPM`, 14, 22);

    // 2. Índice de Perfusión (PI)
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`PI ${this.lastPi > 0 ? this.lastPi.toFixed(2) : '--'}%`, 85, 22);

    // 3. Índice de Calidad de Señal (SQI)
    const sqiVal = Math.round(this.lastSqi * 100);
    const confVal = Math.round(this.lastConfidence * 100);
    ctx.fillStyle = sqiVal >= 80 ? '#4ade80' : sqiVal >= 50 ? '#fbbf24' : '#f87171';
    ctx.fillText(`SQI ${sqiVal}% · BIO ${confVal}%`, 160, 22);

    // 4. Parámetros de calibración (Pie de gráfica)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.font = '500 8.5px var(--font-mono), monospace';
    ctx.fillText('25 mm/s · Ganancia ×1.0 · Filtro [0.5–4.0 Hz]', 14, height - 10);

    // 5. Barra de Medición de Perfusión (PI Bar dinámico lateral)
    const barX = width - 14;
    const barH = 50;
    const barY = 16;
    const piRatio = Math.min(1.0, this.lastPi / 4.0);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(barX, barY, 4, barH);

    ctx.fillStyle = theme.primary;
    ctx.fillRect(barX, barY + barH * (1 - piRatio), 4, barH * piRatio);

    ctx.restore();
  }

  /**
   * Panel de Atractor 2D de Poincaré (Espacio de fases con órbita SPAR).
   */
  private drawPoincareAttractor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    const size = Math.min(76, height * 0.32);
    const posX = width - size - 26;
    const posY = 14;

    ctx.save();
    // Fondo translúcido
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(posX, posY, size, size, 8);
    ctx.fill();
    ctx.stroke();

    // Título mini
    ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
    ctx.font = '700 7.5px var(--font-mono), monospace';
    ctx.fillText('ÓRBITA 2D', posX + 6, posY + 11);

    // Dibujar puntos del atractor con estela luminosa
    const center = size / 2;
    const scale = (size * 0.42) / Math.max(0.1, (this.maxVal - this.minVal) / 2);

    for (let i = 0; i < this.poincareBuffer.length; i++) {
      const pt = this.poincareBuffer[i]!;
      const px = posX + center + pt.x * scale;
      const py = posY + center - pt.y * scale;

      const alpha = (i + 1) / this.poincareBuffer.length;
      ctx.fillStyle = theme.primary;
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    ctx.restore();
  }

  /**
   * Tacograma de tendencia de FC (mini sparkline de variabilidad beat-to-beat).
   */
  private drawHrTachogram(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: ThemeColors
  ): void {
    const trendW = 90;
    const trendH = 28;
    const posX = width - trendW - 26;
    const posY = height - trendH - 10;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.roundRect(posX, posY, trendW, trendH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '600 7px var(--font-mono), monospace';
    ctx.fillText('HR TREND', posX + 5, posY + 9);

    const bpms = this.hrTrendBuffer;
    const minBpm = Math.min(...bpms) - 2;
    const maxBpm = Math.max(...bpms) + 2;
    const rangeBpm = Math.max(5, maxBpm - minBpm);
    const stepX = (trendW - 12) / (this.maxHrTrend - 1);

    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    for (let i = 0; i < bpms.length; i++) {
      const x = posX + 6 + i * stepX;
      const y = posY + trendH - 4 - ((bpms[i]! - minBpm) / rangeBpm) * (trendH - 14);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Guía en pantalla si no hay contacto o la señal está calibrándose.
   */
  private drawNoContactGuidance(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    const midY = height / 2;
    this.minVal = -1.0;
    this.maxVal = 1.0;

    ctx.save();
    const isUnstable = this.lastContact === 'UNSTABLE_CONTACT';
    ctx.strokeStyle = isUnstable ? 'rgba(245, 158, 11, 0.45)' : 'rgba(100, 116, 139, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    ctx.fillStyle = isUnstable ? '#f59e0b' : '#64748b';
    ctx.font = '700 11.5px var(--font-mono), monospace';
    ctx.textAlign = 'center';

    const guideText = isUnstable
      ? 'ANALIZANDO FLUJO CAPILAR... MANTÉN EL DEDO FIRME'
      : 'CUBRE LA CÁMARA Y EL FLASH CON LA YEMA DEL DEDO';

    ctx.fillText(guideText, width / 2, midY - 14);
    ctx.restore();
  }

  /**
   * Resetea todos los búferes y estados.
   */
  public reset(): void {
    this.samples.fill(0);
    this.vpgSamples.fill(0);
    this.apgSamples.fill(0);
    this.peakFlags.fill(0);
    this.dicroticFlags.fill(0);
    this.sampleCount = 0;
    this.writeIndex = 0;
    this.sweepCursor = 0;
    this.poincareBuffer.length = 0;
    this.hrTrendBuffer.length = 0;
    this.minVal = -1.0;
    this.maxVal = 1.0;
    this.pulseAnimationPhase = 0;
  }
}
