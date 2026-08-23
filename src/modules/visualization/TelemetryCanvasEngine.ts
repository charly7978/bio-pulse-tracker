/**
 * TelemetryCanvasEngine — v2 Médico-CRT de referencia
 *
 * Osciloscopio PPG de grado UCI: fósforo CRT + volumetría arterial + calibración 25mm/s
 * Diseñado para 60 FPS, GC-free, DPR-correcto, trazado fisiológico asimétrico (SP agudo + DN incisura + DP reflejo)
 *
 * Capas (back → front):
 * 0. Negro puro #020408 + grid dots 1mm/5mm (cache offscreen)
 * 1. Pulso de calibración 1mV
 * 2. Glow volumétrico bajo curva
 * 3. Trazo PPG triple-bloom (outer 12px 0.08 + mid 2.8px + core 1.15px blanco) con Catmull-Rom → Bezier monotónico
 * 4. Guías fiduciales S/D + etiquetas
 * 5. APG derivada opcional
 * 6. Atractor Poincaré (SPAR) con marco glass
 * 7. Info superior (PLETH • x1 • 25mm/s • 0.65-3.5Hz) + SQI pill
 * 8. Barra inferior de calibración
 * 9. Sweep-head wiper con cola fósforo + vignette + scanlines + specular
 *
 * Modos: SWEEP (wiper médico real, borrado por phosphor decay) | ROLL (scroll continuo)
 */

import { CanvasEngineConfig, TelemetryFrame, PoincarePoint, ColorTheme, RenderMode } from './types';

export const DEFAULT_CANVAS_CONFIG: CanvasEngineConfig = {
  width: 600,
  height: 300,
  dpr: 1,
  gridColor: 'rgba(255, 255, 255, 0.075)',
  gridSubColor: 'rgba(255, 255, 255, 0.022)',
  phosphorDecay: 0.92,
  showGrid: true,
  showPoincarePlot: true,
  showFiducialPeaks: true,
  showDicroticNotch: true,
  showHudMetrics: true,
  showDerivatives: false,
  showVolumetricGlow: true,
  showTachogram: true,
  renderMode: 'SWEEP',
  colorTheme: 'EMERALD',
};

interface ThemeColors {
  primary: string;
  primaryGlow: string;
  primaryShadow: string;
  primaryCore: string;
  fillTop: string;
  fillMid: string;
  fillBottom: string;
  systolicRing: string;
  systolicCore: string;
  dicroticFill: string;
  dicroticStroke: string;
  derivative: string;
  gridMajor: string;
  gridMinor: string;
  text: string;
  calib: string;
}

const THEME_PALETTES: Record<ColorTheme, ThemeColors> = {
  EMERALD: {
    primary: '#00FF84',
    primaryGlow: 'rgba(0, 255, 132, 0.33)',
    primaryShadow: 'rgba(0, 255, 132, 0.95)',
    primaryCore: '#F8FFF8',
    fillTop: 'rgba(0, 255, 132, 0.20)',
    fillMid: 'rgba(0, 255, 132, 0.07)',
    fillBottom: 'rgba(0, 255, 132, 0.0)',
    systolicRing: 'rgba(0, 255, 132, 1)',
    systolicCore: '#FFFFFF',
    dicroticFill: '#FFD23F',
    dicroticStroke: 'rgba(255, 210, 63, 0.9)',
    derivative: '#38BDF8',
    gridMajor: 'rgba(255,255,255,0.085)',
    gridMinor: 'rgba(255,255,255,0.022)',
    text: 'rgba(255,255,255,0.42)',
    calib: 'rgba(0, 255, 132, 0.85)',
  },
  RUBY: {
    primary: '#FF2A5F',
    primaryGlow: 'rgba(255, 42, 95, 0.38)',
    primaryShadow: 'rgba(255, 42, 95, 0.95)',
    primaryCore: '#FFF2F4',
    fillTop: 'rgba(255, 42, 95, 0.22)',
    fillMid: 'rgba(255, 42, 95, 0.065)',
    fillBottom: 'rgba(255, 42, 95, 0.0)',
    systolicRing: '#FF2A5F',
    systolicCore: '#FFFFFF',
    dicroticFill: '#FFD60A',
    dicroticStroke: 'rgba(255, 214, 10, 0.95)',
    derivative: '#BF5AF2',
    gridMajor: 'rgba(255,255,255,0.075)',
    gridMinor: 'rgba(255,255,255,0.020)',
    text: 'rgba(255,255,255,0.40)',
    calib: 'rgba(255, 56, 90, 0.90)',
  },
  COBALT: {
    primary: '#1EE5FF',
    primaryGlow: 'rgba(30, 229, 255, 0.34)',
    primaryShadow: 'rgba(30, 229, 255, 0.95)',
    primaryCore: '#F0FDFF',
    fillTop: 'rgba(30, 229, 255, 0.20)',
    fillMid: 'rgba(30, 229, 255, 0.06)',
    fillBottom: 'rgba(30, 229, 255, 0.0)',
    systolicRing: '#1EE5FF',
    systolicCore: '#FFFFFF',
    dicroticFill: '#30D158',
    dicroticStroke: 'rgba(48, 209, 88, 0.95)',
    derivative: '#A855F7',
    gridMajor: 'rgba(255,255,255,0.082)',
    gridMinor: 'rgba(255,255,255,0.022)',
    text: 'rgba(255,255,255,0.40)',
    calib: 'rgba(30, 229, 255, 0.90)',
  },
};

export class TelemetryCanvasEngine {
  private config: CanvasEngineConfig;
  private readonly maxSamples = 520; // ~17s @30Hz, cubre anchos grandes sin stretching
  private readonly samples: Float32Array;
  private readonly vpgSamples: Float32Array;
  private readonly apgSamples: Float32Array;
  private readonly peakFlags: Uint8Array;
  private readonly dicroticFlags: Uint8Array;

  private sampleCount = 0;
  private writeIndex = 0;

  private readonly hrTrendBuffer: number[] = [];
  private readonly maxHrTrend = 30;

  private lastBpm = 0;
  private lastSqi = 0;
  private lastPi = 0;
  private lastContact: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' = 'NO_CONTACT';

  private pulseFlash = 0; // 0..1 decae, para flash del head en sístole
  private frameCounter = 0;

  // Cache de hora para no crear Date 60 veces por segundo
  private cachedTimeStr = '--:--:--';
  private lastTimeUpdateMs = 0;

  private readonly poincareBuffer: PoincarePoint[] = [];
  private readonly maxPoincarePoints = 48;
  private readonly tauLag = 6;

  // Grid cache
  private gridCache: HTMLCanvasElement | null = null;
  private gridCacheW = 0;
  private gridCacheH = 0;
  private gridCacheDpr = 0;
  private gridCacheTheme: ColorTheme | '' = '';

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
    // invalidar cache
    this.gridCache = null;
  }

  public setRenderMode(mode: RenderMode): void {
    this.config.renderMode = mode;
  }

  public setColorTheme(theme: ColorTheme): void {
    this.config.colorTheme = theme;
    this.gridCache = null;
  }

  public toggleDerivatives(): boolean {
    this.config.showDerivatives = !this.config.showDerivatives;
    return this.config.showDerivatives;
  }

  public getShowDerivatives(): boolean {
    return this.config.showDerivatives;
  }

  public setShowDerivatives(show: boolean): void {
    this.config.showDerivatives = show;
  }

  public getBpm(): number { return this.lastBpm; }
  public getSqi(): number { return this.lastSqi; }
  public getPi(): number { return this.lastPi; }
  public getContactState(): 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' { return this.lastContact; }

  public pushFrame(frame: TelemetryFrame): void {
    const rawVal = frame.filteredValue;
    const val = Math.max(-1.0, Math.min(1.0, isNaN(rawVal) ? 0 : rawVal));

    const prevIdx = (this.writeIndex - 1 + this.maxSamples) % this.maxSamples;
    const prevVal = this.sampleCount > 0 ? this.samples[prevIdx]! : val;
    const prevVpg = this.sampleCount > 0 ? this.vpgSamples[prevIdx]! : 0;

    const vpg = (val - prevVal) * 30.0;
    const apg = (vpg - prevVpg) * 30.0;

    this.samples[this.writeIndex] = val;
    this.vpgSamples[this.writeIndex] = vpg;
    this.apgSamples[this.writeIndex] = apg;
    this.peakFlags[this.writeIndex] = frame.isPeak ? 1 : 0;

    // Muesca dícrota: transición catacrótica — VPG negativa profunda → retorno
    let isDicrotic = false;
    if (this.sampleCount >= 8) {
      const idx2 = (this.writeIndex - 2 + this.maxSamples) % this.maxSamples;
      const idx3 = (this.writeIndex - 3 + this.maxSamples) % this.maxSamples;
      const idx5 = (this.writeIndex - 5 + this.maxSamples) % this.maxSamples;
      const v2 = this.vpgSamples[idx2]!;
      const v3 = this.vpgSamples[idx3]!;
      const v5 = this.vpgSamples[idx5]!;
      // Patrón: descenso sistólico (v5 muy negativo), valle, y pequeño repunte
      // Típica DN está en 38-62% de la altura del flanco descendente
      if (v5 < -0.18 && v3 < -0.06 && v2 >= -0.03 && vpg > -0.02 && vpg < 0.10 && !frame.isPeak) {
        // evitar falsos en meseta sistólica
        isDicrotic = true;
      }
    }
    this.dicroticFlags[this.writeIndex] = isDicrotic ? 1 : 0;

    if (this.sampleCount >= this.tauLag && frame.contactState === 'STABLE_CONTACT') {
      const tauIdx = (this.writeIndex - this.tauLag + this.maxSamples) % this.maxSamples;
      const x = val;
      const y = this.samples[tauIdx]!;
      this.poincareBuffer.push({ x, y, alpha: 1.0 });
      if (this.poincareBuffer.length > this.maxPoincarePoints) this.poincareBuffer.shift();
    }

    if (frame.isPeak && frame.bpm > 30) {
      this.hrTrendBuffer.push(frame.bpm);
      if (this.hrTrendBuffer.length > this.maxHrTrend) this.hrTrendBuffer.shift();
      this.pulseFlash = 1.0;
    }

    this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
    if (this.sampleCount < this.maxSamples) this.sampleCount++;

    this.lastBpm = frame.bpm;
    this.lastSqi = frame.sqi;
    this.lastPi = frame.pi;
    this.lastContact = frame.contactState;
  }

  public render(target: HTMLCanvasElement | CanvasRenderingContext2D): void {
    let ctx: CanvasRenderingContext2D | null = null;
    let isCanvasElement = false;
    if ('getContext' in target) {
      ctx = (target as HTMLCanvasElement).getContext('2d', { alpha: true });
      isCanvasElement = true;
    } else {
      ctx = target as CanvasRenderingContext2D;
    }
    if (!ctx) return;

    const width = this.config.width;
    const height = this.config.height;
    const dpr = this.config.dpr || 1;
    const theme = THEME_PALETTES[this.config.colorTheme] || THEME_PALETTES.EMERALD;

    this.frameCounter++;

    ctx.save();

    // Manejo DPR: si target es canvas element, el contexto ya está en device pixels
    // pero nosotros dibujamos en coordenadas lógicas escalando.
    if (isCanvasElement) {
      // limpiar en device pixels
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width * dpr, height * dpr);
      ctx.scale(dpr, dpr);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // Fondo negro UCI puro
    ctx.fillStyle = '#020408';
    ctx.fillRect(0, 0, width, height);

    // Sutil gradiente de profundidad interior (más claro arriba)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, 'rgba(255,255,255,0.035)');
    bgGrad.addColorStop(0.35, 'rgba(255,255,255,0.0)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0.40)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Grid médico (cacheada)
    if (this.config.showGrid) {
      this.drawHospitalGridCached(ctx, width, height, dpr, theme);
    }

    // Barra superior integrada
    this.drawTopInfoBar(ctx, width, height, theme);

    if (this.lastContact !== 'STABLE_CONTACT') {
      this.drawNoContactGuidance(ctx, width, height, theme);
      // Aún dibujar vignette/scanlines incluso sin contacto para realismo
      this.drawVignetteAndScanlines(ctx, width, height);
      this.drawBottomCalibrationBar(ctx, width, height, theme);
      ctx.restore();
      return;
    }

    // Pulso de calibración 1mV (izquierda, antes del trazo)
    this.drawCalibrationPulse(ctx, width, height, theme);

    // Volumetría arterial bajo curva
    if (this.config.showVolumetricGlow) {
      this.drawVolumetricGlow(ctx, width, height, theme);
    }

    // Trazo PPG primario
    this.drawPrimaryWaveform(ctx, width, height, theme);

    // Fiduciales con guías
    if (this.config.showFiducialPeaks) {
      this.drawFiducialMarkers(ctx, width, height, theme);
    }

    // APG opcional (segunda derivada)
    if (this.config.showDerivatives) {
      this.drawDerivativeWaveform(ctx, width, height, theme);
    }

    // Poincaré
    if (this.config.showPoincarePlot && this.poincareBuffer.length > 4) {
      this.drawPoincareAttractor(ctx, width, height, theme);
    }

    // Sweep head + cola fósforo
    this.drawSweepHead(ctx, width, height, theme);

    // Barra inferior de calibración
    this.drawBottomCalibrationBar(ctx, width, height, theme);

    // Capas finales: vignette, scanlines, specular (no cubren el foco)
    this.drawVignetteAndScanlines(ctx, width, height);

    // Borde interno biselado sutil
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);

    if (this.pulseFlash > 0) {
      this.pulseFlash = Math.max(0, this.pulseFlash - 0.07);
    }

    ctx.restore();
  }

  // ───────────────────────────────── Grid cache ────────────────────────────────
  private drawHospitalGridCached(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, theme: ThemeColors): void {
    const needsRebuild = !this.gridCache || this.gridCacheW !== width || this.gridCacheH !== height || this.gridCacheDpr !== dpr || this.gridCacheTheme !== this.config.colorTheme;
    if (needsRebuild) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(width * dpr));
      c.height = Math.max(1, Math.floor(height * dpr));
      const g = c.getContext('2d')!;
      g.scale(dpr, dpr);
      this.renderGridToContext(g, width, height, theme);
      this.gridCache = c;
      this.gridCacheW = width;
      this.gridCacheH = height;
      this.gridCacheDpr = dpr;
      this.gridCacheTheme = this.config.colorTheme;
    }
    // blit cache
    ctx.drawImage(this.gridCache!, 0, 0, width, height);
  }

  private renderGridToContext(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    // Fondo ya dibujado afuera, aquí solo dots y líneas finas
    // Estándar 25mm/s: en pantalla width representa ~ 6-7 segundos a 25mm/s (150-175mm)
    // Elegimos celdas: major = 22px (~5mm), minor = 5.5px (~1mm) aprox
    const minor = 11;
    const major = 44;

    // Dots menores: puntos en intersección 1mm
    ctx.fillStyle = theme.gridMinor;
    for (let x = 0; x < width; x += minor) {
      for (let y = 0; y < height; y += minor) {
        // evitar dibujar donde está major (se dibuja línea)
        const isMajorX = Math.abs(x % major) < 0.5;
        const isMajorY = Math.abs(y % major) < 0.5;
        if (isMajorX || isMajorY) continue;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Líneas mayores: trazo muy sutil
    ctx.strokeStyle = theme.gridMajor;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 0; x < width; x += major) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y < height; y += major) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();

    // Línea isobárica central (baseline) — dashed muy tenue
    const midY = height * 0.52;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.065)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(midY) + 0.5);
    ctx.lineTo(width, Math.round(midY) + 0.5);
    ctx.stroke();
    ctx.restore();

    // Etiquetas de amplitud sutiles al borde izquierdo (0.5mV ticks)
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.font = '6px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const scale = height * 0.33; // debe coincidir con amplitudeScale en calculatePoints
    for (let v = -1; v <= 1; v += 0.5) {
      if (Math.abs(v) < 0.01) continue;
      const y = midY - v * scale;
      if (y < 8 || y > height - 14) continue;
      ctx.fillText((v > 0 ? '+' : '') + v.toFixed(1), 4, y);
      // tick corto
      ctx.fillRect(0, y, v === 0 ? 8 : 4, 1);
    }
  }

  // ─────────────────────────── Top info bar ─────────────────────────────────
  private drawTopInfoBar(ctx: CanvasRenderingContext2D, width: number, _height: number, theme: ThemeColors): void {
    const padX = 10;
    const padY = 9;
    ctx.save();

    // Título derivación
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 8.5px "Inter", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '0.06em';
    // PLETH label con color del tema
    ctx.fillStyle = theme.primary;
    ctx.fillText('PLETH', padX, padY);
    const plethW = ctx.measureText('PLETH').width;

    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '500 7px "Inter", -apple-system, sans-serif';
    ctx.fillText('  •  x1  •  25 mm/s  •  0.65–8.0 Hz  •  MONITOR', padX + plethW + 2, padY + 0.5);

    // Derecha: SQI pill + HR mini
    const sqiLabel = this.lastSqi > 0.75 ? 'SQI EXCELENTE' : this.lastSqi > 0.45 ? 'SQI BUENO' : this.lastSqi > 0.2 ? 'SQI BAJO' : 'SQI —';
    const sqiColor = this.lastSqi > 0.75 ? theme.primary : this.lastSqi > 0.45 ? '#FFD60A' : 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    void this.lastBpm;
    const rightX = width - padX;

    // Pill SQI
    ctx.font = '700 6.5px "JetBrains Mono", monospace';
    const pillText = `● ${sqiLabel}  PI ${this.lastPi.toFixed(1)}%`;
    const pillW = ctx.measureText(pillText).width + 14;
    const pillH = 14;
    const pillX = rightX - pillW;
    const pillY = padY - 2;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // @ts-ignore roundRect
    if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 7);
    else { ctx.rect(pillX, pillY, pillW, pillH); }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = sqiColor;
    ctx.textAlign = 'center';
    ctx.fillText(pillText, pillX + pillW / 2, pillY + 4.5);

    // Hora / sweep indicador — actualizada solo 1 vez por segundo para evitar GC a 60 FPS
    if (performance.now() - this.lastTimeUpdateMs > 1000) {
      this.cachedTimeStr = new Date().toLocaleTimeString('es-ES', { hour12: false });
      this.lastTimeUpdateMs = performance.now();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '500 6.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(this.cachedTimeStr, width - padX, padY + 16);

    // Separador horizontal sutil bajo top bar
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 24.5);
    ctx.lineTo(width, 24.5);
    ctx.stroke();

    ctx.restore();
  }

  // ─────────────────────── Calib pulse 1mV ──────────────────────────────────
  private drawCalibrationPulse(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    // Rectángulo 1mV = 10mm alto, 200ms ancho a 25mm/s (5mm)
    const midY = height * 0.52;
    const ampScale = height * 0.33;
    const calH = ampScale * 0.60; // ~0.6 unidades = ~0.6mV visual
    const calX = 10;
    const calW = Math.min(22, width * 0.04);
    const topY = midY - calH;
    const bottomY = midY;

    ctx.save();
    ctx.strokeStyle = theme.calib;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = this.pulseFlash > 0 ? 10 : 0;

    ctx.beginPath();
    ctx.moveTo(calX, bottomY);
    ctx.lineTo(calX, topY);
    ctx.lineTo(calX + calW, topY);
    ctx.lineTo(calX + calW, bottomY);
    ctx.stroke();

    ctx.shadowBlur = 0;
    // Etiqueta 1mV
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '600 6px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('1 mV', calX, topY - 4);
    // x1
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '500 6px "Inter", sans-serif';
    ctx.fillText('CAL', calX, bottomY + 9);

    ctx.restore();
  }

  // ───────────────────── Volumetric glow ────────────────────────────────────
  private drawVolumetricGlow(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    if (this.sampleCount < 4) return;
    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;

    ctx.save();
    const grad = ctx.createLinearGradient(0, height * 0.18, 0, height * 0.92);
    grad.addColorStop(0, theme.fillTop);
    grad.addColorStop(0.45, theme.fillMid);
    grad.addColorStop(0.78, 'rgba(0,0,0,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = grad;

    // Path cerrado bajo curva
    ctx.beginPath();
    // arrancar desde baseline
    const baselineY = height * 0.92;
    ctx.moveTo(points[0]!.x, baselineY);
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
      // Si hay salto grande (sweep gap) no conectar
      if (Math.abs(p2.x - p1.x) > width * 0.5) {
        ctx.lineTo(p1.x, baselineY);
        ctx.lineTo(p2.x, baselineY);
        ctx.lineTo(p2.x, p2.y);
      } else {
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }
    const last = points[points.length - 1]!;
    ctx.lineTo(last.x, baselineY);
    ctx.closePath();
    ctx.fill();

    // Glow extra difuso duplicado con blur simulado (segundo fill con alpha menor y offset)
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.restore();
  }

  // ───────────────────── Trazo PPG principal ────────────────────────────────
  private drawPrimaryWaveform(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Capa 0: bloom exterior ultradifuso (phosphor bleed)
    ctx.strokeStyle = theme.primaryGlow;
    ctx.lineWidth = 11;
    ctx.shadowColor = theme.primaryShadow;
    ctx.shadowBlur = 18 + this.pulseFlash * 10;
    ctx.globalAlpha = 0.55;
    this.renderSplinePath(ctx, points, width);
    ctx.stroke();

    // Capa 1: halo medio
    ctx.strokeStyle = theme.primaryGlow;
    ctx.lineWidth = 5.5;
    ctx.shadowBlur = 10 + this.pulseFlash * 6;
    ctx.globalAlpha = 0.85;
    this.renderSplinePath(ctx, points, width);
    ctx.stroke();

    // Capa 2: cuerpo luminoso saturado
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 2.65;
    ctx.shadowBlur = 7;
    ctx.shadowColor = theme.primaryShadow;
    ctx.globalAlpha = 1.0;
    this.renderSplinePath(ctx, points, width);
    ctx.stroke();

    // Capa 3: filamento blanco caliente (hot core) — solo 1.15px
    ctx.strokeStyle = theme.primaryCore;
    ctx.lineWidth = 1.15;
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.95;
    this.renderSplinePath(ctx, points, width);
    ctx.stroke();

    // Brillo especular superior sutil a lo largo de la cresta (highlight)
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 0.85;
    ctx.globalAlpha = 0.55;
    this.renderSplinePath(ctx, points, width);
    ctx.stroke();

    ctx.restore();
  }

  // ───────────────────── Fiduciales ────────────────────────────────────────
  private drawFiducialMarkers(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;
    ctx.save();
    const count = points.length;
    const baseCount = this.sampleCount;
    // Mapear puntos a índices de buffer para flags
    for (let i = 0; i < count; i++) {
      // Para ROLL: idx = writeIndex - count + i ; para SWEEP: idx = implied idx del punto
      // Reconstruimos idx lógico para flags: en calculatePoints ordenamos por tiempo, así que idx = (writeIndex - baseCount + i + max) % max
      const logicalIdx = (this.writeIndex - baseCount + i + this.maxSamples * 2) % this.maxSamples;
      const pt = points[i]!;

      if (this.peakFlags[logicalIdx] === 1) {
        // Guía vertical dashed tenue
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.055)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y + 8);
        ctx.lineTo(pt.x, height * 0.92);
        ctx.stroke();
        ctx.restore();

        // Anillo exterior pulsante
        const pulseR = 6 + this.pulseFlash * 2.5;
        ctx.strokeStyle = theme.systolicRing;
        ctx.lineWidth = 1.4;
        ctx.shadowColor = theme.primary;
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pulseR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Núcleo sistólico blanco
        ctx.fillStyle = theme.systolicCore;
        ctx.shadowColor = theme.primary;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Punto central primario
        ctx.fillStyle = theme.primary;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2);
        ctx.fill();

        // Etiqueta "S" arriba
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.font = '700 7px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('S', pt.x, pt.y - 10);
      }

      if (this.config.showDicroticNotch && this.dicroticFlags[logicalIdx] === 1) {
        // Solo mostrar DN si no coincide con pico (evitar overlap)
        const isNearPeak = this.peakFlags[logicalIdx] === 1 || (i > 0 && this.peakFlags[(logicalIdx - 1 + this.maxSamples) % this.maxSamples] === 1);
        if (isNearPeak) continue;

        // Incisura dícrota - diamante
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = theme.dicroticFill;
        ctx.strokeStyle = theme.dicroticStroke;
        ctx.lineWidth = 1;
        ctx.shadowColor = theme.dicroticFill;
        ctx.shadowBlur = 6;
        const r = 4.2;
        ctx.beginPath();
        ctx.rect(-r / 2, -r / 2, r, r);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Guía sutil
        ctx.strokeStyle = 'rgba(255, 210, 63, 0.10)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y + 5);
        ctx.lineTo(pt.x, pt.y + 18);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255,210,63,0.85)';
        ctx.font = '600 6px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('N', pt.x, pt.y + 20);
      }
    }
    ctx.restore();
  }

  private drawDerivativeWaveform(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    if (this.sampleCount < 6) return;
    const baseY = height * 0.78;
    const points = this.calculateScreenPoints(width, height);
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = theme.derivative;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const logicalIdx = (this.writeIndex - this.sampleCount + i + this.maxSamples * 2) % this.maxSamples;
      const apg = Math.max(-2.2, Math.min(2.2, this.apgSamples[logicalIdx]!));
      const x = points[i]!.x;
      const y = Math.max(height * 0.58, Math.min(height - 18, baseY - apg * 14));
      if (i === 0 || Math.abs(points[i]!.x - points[Math.max(0, i - 1)]!.x) > width * 0.5) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // etiqueta
    ctx.fillStyle = theme.derivative;
    ctx.font = '600 6px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('APG d²PPG/dt²', 10, baseY - 18);
    ctx.restore();
  }

  private drawPoincareAttractor(ctx: CanvasRenderingContext2D, width: number, _height: number, theme: ThemeColors): void {
    const boxSize = 78;
    const pad = 10;
    const originX = width - boxSize - pad;
    const originY = 32;
    const cx = originX + boxSize / 2;
    const cy = originY + boxSize / 2;
    const scale = boxSize * 0.38;

    ctx.save();

    // Fondo glass
    ctx.fillStyle = 'rgba(12, 16, 22, 0.72)';
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // @ts-ignore
    if (ctx.roundRect) ctx.roundRect(originX, originY, boxSize, boxSize, 9);
    else ctx.rect(originX, originY, boxSize, boxSize);
    ctx.fill();
    ctx.stroke();

    // highlight interno
    const grad = ctx.createLinearGradient(originX, originY, originX, originY + boxSize);
    grad.addColorStop(0, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    // @ts-ignore
    if (ctx.roundRect) ctx.roundRect(originX, originY, boxSize, boxSize, 9);
    else ctx.rect(originX, originY, boxSize, boxSize);
    ctx.fill();

    // ejes
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(originX + 7, cy);
    ctx.lineTo(originX + boxSize - 7, cy);
    ctx.moveTo(cx, originY + 7);
    ctx.lineTo(cx, originY + boxSize - 7);
    ctx.stroke();

    // círculo de referencia
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.beginPath();
    ctx.arc(cx, cy, boxSize * 0.30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, boxSize * 0.18, 0, Math.PI * 2);
    ctx.stroke();

    // etiqueta
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.font = '700 6px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0.08em';
    ctx.fillText('ÓRBITA SPAR', originX + 7, originY + 11);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '500 5.5px "JetBrains Mono", monospace';
    ctx.fillText('τ=6', originX + 7, originY + boxSize - 6);

    // puntos con cola fading + último brillante
    const n = this.poincareBuffer.length;
    for (let i = 0; i < n; i++) {
      const pt = this.poincareBuffer[i]!;
      const alpha = Math.pow((i + 1) / n, 1.6); // cola exponencial
      const px = cx + pt.x * scale;
      const py = cy - pt.y * scale;
      const bx = Math.max(originX + 4, Math.min(originX + boxSize - 4, px));
      const by = Math.max(originY + 14, Math.min(originY + boxSize - 4, py));

      const isLast = i === n - 1;
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = theme.primary;
      ctx.shadowColor = theme.primary;
      ctx.shadowBlur = isLast ? 8 : 0;
      ctx.beginPath();
      ctx.arc(bx, by, isLast ? 2.8 : 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // cola de estela (segmento hacia anterior)
      if (i > 0 && alpha > 0.35) {
        const prev = this.poincareBuffer[i - 1]!;
        const ppx = cx + prev.x * scale;
        const ppy = cy - prev.y * scale;
        ctx.strokeStyle = theme.primary;
        ctx.globalAlpha = alpha * 0.22;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ppx, ppy);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawBottomCalibrationBar(ctx: CanvasRenderingContext2D, width: number, height: number, _theme: ThemeColors): void {
    ctx.save();
    // fondo barra
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, height - 16, width, 16);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, height - 16.5);
    ctx.lineTo(width, height - 16.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '600 7px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('25 mm/s  •  10 mm/mV  •  FILTRO 0.65–8.0 Hz  •  MONITOR  •  DERIV. PLETH', 10, height - 8);

    // escala temporal abajo: marcas cada segundo
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = '500 6px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    // Mostrar ventana temporal efectiva
    const winSec = (this.sampleCount / 30).toFixed(1);
    ctx.fillText(`${winSec}s ventana  •  GANANCIA x1`, width - 10, height - 8);
    ctx.restore();
  }

  private drawNoContactGuidance(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    const midY = height * 0.52;
    ctx.save();
    // Línea isobárica pulsante
    const pulseAlpha = 0.10 + Math.sin(this.frameCounter * 0.06) * 0.06;
    ctx.strokeStyle = `rgba(255,255,255,${pulseAlpha})`;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pulso fantasma de demostración — ultra tenue (0.028) no confundible con señal real; indica "aquí irá tu pulso"
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const t = (x / width) * 6;
      const y = midY - Math.sin(t * Math.PI * 2 + this.frameCounter * 0.02) * 4 - Math.sin(t * Math.PI * 6) * 1.2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Texto guía
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = '700 10.5px "Inter", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '0.04em';
    ctx.fillText('CUBRE CÁMARA Y FLASH CON LA YEMA DEL DEDO', width / 2, midY - 22);

    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '500 7.5px "Inter", -apple-system, sans-serif';
    ctx.fillText('presión suave • sin mover • luz ambiente tenue', width / 2, midY - 9);

    // Indicador de espera punteado animado
    const dots = '.'.repeat((Math.floor(this.frameCounter / 18) % 3) + 1);
    ctx.fillStyle = theme.primary;
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.fillText('ESPERANDO SEÑAL CAPILAR' + dots, width / 2, midY + 18);

    ctx.restore();
  }

  private drawSweepHead(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ThemeColors): void {
    // Cabeza de barrido: en SWEEP es la posición circular; en ROLL es el tip final
    let headX: number;
    if (this.config.renderMode === 'SWEEP') {
      headX = (this.writeIndex / this.maxSamples) * width;
    } else {
      const pts = this.calculateScreenPoints(width, height);
      if (pts.length === 0) return;
      headX = pts[pts.length - 1]!.x;
    }
    if (this.sampleCount < 2) return;

    ctx.save();

    // Cola de fósforo: gradiente que borra el pasado inmediato (efecto wiper)
    if (this.config.renderMode === 'SWEEP') {
      const tailW = Math.min(width * 0.12, 54);
      const grad = ctx.createLinearGradient(headX - tailW, 0, headX + 2, 0);
      grad.addColorStop(0, 'rgba(2,4,8,0)');
      grad.addColorStop(0.55, 'rgba(2,4,8,0.35)');
      grad.addColorStop(0.82, 'rgba(2,4,8,0.88)');
      grad.addColorStop(1, 'rgba(2,4,8,1)');
      // No borramos con compositing, solo dibujamos velo oscuro sutil detrás del head
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.42;
      ctx.fillRect(headX - tailW, 26, tailW + 2, height - 42);
      ctx.globalAlpha = 1;
    }

    // Línea vertical del wiper con glow
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 1.1;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(headX + 0.5, 26);
    ctx.lineTo(headX + 0.5, height - 16.5);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Línea blanca central intensa
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(headX + 0.5, 26);
    ctx.lineTo(headX + 0.5, height - 16.5);
    ctx.stroke();

    // Punto de intersección con la onda (halo)
    const midY = height * 0.52;
    const scale = height * 0.33;
    const lastVal = this.samples[(this.writeIndex - 1 + this.maxSamples) % this.maxSamples]!;
    const tipY = Math.max(28, Math.min(height - 18, midY - lastVal * scale));

    ctx.fillStyle = theme.primary;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(headX, tipY, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(headX, tipY, 1.9, 0, Math.PI * 2);
    ctx.fill();

    // Tick superior triangular
    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    ctx.moveTo(headX, 26);
    ctx.lineTo(headX - 5, 18);
    ctx.lineTo(headX + 5, 18);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawVignetteAndScanlines(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();

    // Vignette radial profunda (CRT curvo sin deformar señal)
    const vg = ctx.createRadialGradient(width * 0.52, height * 0.48, Math.min(width, height) * 0.45, width * 0.52, height * 0.48, Math.max(width, height) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.62, 'rgba(0,0,0,0)');
    vg.addColorStop(0.82, 'rgba(0,0,0,0.22)');
    vg.addColorStop(0.94, 'rgba(0,0,0,0.52)');
    vg.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);

    // Viñeta lateral sutil — reducida de 0.38/0.36 a 0.16/0.14 para no tapar señal periférica
    const sideGrad = ctx.createLinearGradient(0, 0, width * 0.22, 0);
    sideGrad.addColorStop(0, 'rgba(0,0,0,0.16)');
    sideGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sideGrad;
    ctx.fillRect(0, 0, width * 0.22, height);
    const sideGradR = ctx.createLinearGradient(width, 0, width * 0.78, 0);
    sideGradR.addColorStop(0, 'rgba(0,0,0,0.14)');
    sideGradR.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sideGradR;
    ctx.fillRect(width * 0.78, 0, width * 0.22, height);

    // Scanlines muy sutiles (líneas horizontales cada 3px)
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    // Segunda capa fosforo mask dots cada 4px
    ctx.fillStyle = 'rgba(255,255,255,0.009)';
    for (let y = 1; y < height; y += 4) {
      for (let x = 0; x < width; x += 6) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Specular highlight superior (vidrio curvo)
    const spec = ctx.createRadialGradient(width * 0.28, height * 0.06, 0, width * 0.28, height * 0.06, width * 0.65);
    spec.addColorStop(0, 'rgba(255,255,255,0.065)');
    spec.addColorStop(0.35, 'rgba(255,255,255,0.022)');
    spec.addColorStop(0.65, 'rgba(255,255,255,0)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(0, 0, width, height * 0.55);

    // Highlight inferior tenue (reflejo de bezel)
    const bottomSpec = ctx.createLinearGradient(0, height * 0.88, 0, height);
    bottomSpec.addColorStop(0, 'rgba(255,255,255,0)');
    bottomSpec.addColorStop(1, 'rgba(255,255,255,0.025)');
    ctx.fillStyle = bottomSpec;
    ctx.fillRect(0, height * 0.88, width, height * 0.12);

    ctx.restore();
  }

  private calculateScreenPoints(width: number, height: number): { x: number; y: number }[] {
    const count = this.sampleCount;
    if (count < 2) return [];
    const midY = height * 0.52;
    const ampScale = height * 0.33;
    const points: { x: number; y: number }[] = [];

    if (this.config.renderMode === 'ROLL') {
      // ROLL: ventana deslizante lineal izq→der
      const dx = width / (this.maxSamples - 1);
      for (let i = 0; i < count; i++) {
        const idx = (this.writeIndex - count + i + this.maxSamples) % this.maxSamples;
        const val = this.samples[idx]!;
        const x = i * dx * (this.maxSamples / Math.max(count, this.maxSamples * 0.65));
        // Ajuste para que onda ocupe todo ancho cuando buffer no lleno: mapear i/count * width
        const actualX = (i / Math.max(1, count - 1)) * width;
        const rawY = midY - val * ampScale;
        const y = Math.max(28, Math.min(height - 18, rawY));
        points.push({ x: actualX, y });
        void x;
      }
    } else {
      // SWEEP: posición circular absoluta; gap en head
      for (let i = 0; i < count; i++) {
        const idx = (this.writeIndex - count + i + this.maxSamples) % this.maxSamples;
        const val = this.samples[idx]!;
        const x = (idx / this.maxSamples) * width;
        const rawY = midY - val * ampScale;
        const y = Math.max(28, Math.min(height - 18, rawY));
        points.push({ x, y });
      }
      // Ordenar por x para que spline se dibuje en orden de barrido (no cronológico)
      // Pero necesitamos preservar cronología cerca del gap: el orden cronológico ya es casi ordenado por x excepto el salto.
      // Detectaremos salto en render en lugar de reordenar.
      // Para evitar línea cruzando gap, mantenemos orden cronológico y el path hará moveTo en el salto.
    }
    return points;
  }

  private renderSplinePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], width: number): void {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;

      // Detectar salto de sweep (gap > 40% width = discontinuidad)
      if (Math.abs(p2.x - p1.x) > width * 0.40) {
        // Terminar segmento actual y empezar nuevo sin curva
        ctx.moveTo(p2.x, p2.y);
        continue;
      }

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
    this.pulseFlash = 0;
    this.cachedTimeStr = '--:--:--';
    this.lastTimeUpdateMs = 0;
    this.gridCache = null;
  }
}
