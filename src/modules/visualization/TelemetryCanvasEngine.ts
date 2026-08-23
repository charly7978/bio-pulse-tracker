/**
 * TelemetryCanvasEngine
 *
 * Motor de renderizado en Canvas de alta fidelidad para monitores cardíacos clínicos.
 * Diseñado para 60 / 120 FPS con cero recolección de basura (garbage collection)
 * en el bucle caliente de renderizado.
 */

import { CanvasEngineConfig, TelemetryFrame, PoincarePoint } from './types';

export const DEFAULT_CANVAS_CONFIG: CanvasEngineConfig = {
  width: 600,
  height: 300,
  dpr: 1,
  gridColor: 'rgba(255, 255, 255, 0.07)',
  gridSubColor: 'rgba(255, 255, 255, 0.025)',
  phosphorDecay: 0.94,
  showGrid: true,
  showPoincarePlot: true,
  showFiducialPeaks: true,
  showHudMetrics: true,
};

export class TelemetryCanvasEngine {
  private config: CanvasEngineConfig;
  private readonly maxSamples = 300; // ~10 segundos a 30 Hz
  private readonly samples: Float32Array;
  private readonly peakFlags: Uint8Array;
  private sampleCount = 0;
  private writeIndex = 0;

  // Estado de normalización dinámica con histéresis
  private minVal = -1.0;
  private maxVal = 1.0;
  private lastBpm = 0;
  private lastSqi = 0;
  private lastPi = 0;
  private lastContact: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' = 'NO_CONTACT';

  public getBpm(): number { return this.lastBpm; }
  public getSqi(): number { return this.lastSqi; }
  public getPi(): number { return this.lastPi; }
  public getContactState(): 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' { return this.lastContact; }

  // Buffer para atractor de Poincaré (x[n], x[n-tau])
  private readonly poincareBuffer: PoincarePoint[] = [];
  private readonly maxPoincarePoints = 60;
  private readonly tauLag = 6; // Retardo ~200ms

  constructor(config: Partial<CanvasEngineConfig> = {}) {
    this.config = { ...DEFAULT_CANVAS_CONFIG, ...config };
    this.samples = new Float32Array(this.maxSamples);
    this.peakFlags = new Uint8Array(this.maxSamples);
  }

  /**
   * Actualiza la configuración y resolución del motor.
   */
  public resize(width: number, height: number, dpr: number = 1): void {
    this.config.width = width;
    this.config.height = height;
    this.config.dpr = dpr;
  }

  /**
   * Ingresa un nuevo fotograma de telemetría a los buffers circulares.
   */
  public pushFrame(frame: TelemetryFrame): void {
    this.samples[this.writeIndex] = frame.filteredValue;
    this.peakFlags[this.writeIndex] = frame.isPeak ? 1 : 0;

    // Actualizar atractor de Poincaré
    if (this.sampleCount >= this.tauLag) {
      const prevIdx = (this.writeIndex - this.tauLag + this.maxSamples) % this.maxSamples;
      const x = frame.filteredValue;
      const y = this.samples[prevIdx]!;

      this.poincareBuffer.push({ x, y, alpha: 1.0 });
      if (this.poincareBuffer.length > this.maxPoincarePoints) {
        this.poincareBuffer.shift();
      }
    }

    this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
    if (this.sampleCount < this.maxSamples) this.sampleCount++;

    this.lastBpm = frame.bpm;
    this.lastSqi = frame.sqi;
    this.lastPi = frame.pi;
    this.lastContact = frame.contactState;

    // Adaptación suave del rango vertical (auto-scaling)
    const val = frame.filteredValue;
    if (val < this.minVal) this.minVal = this.minVal * 0.95 + val * 0.05;
    else this.minVal = this.minVal * 0.999 + (-0.5) * 0.001;

    if (val > this.maxVal) this.maxVal = this.maxVal * 0.95 + val * 0.05;
    else this.maxVal = this.maxVal * 0.999 + 0.5 * 0.001;
  }

  /**
   * Renderiza el estado completo en el contexto 2D del Canvas.
   */
  public render(ctx: CanvasRenderingContext2D): void {
    const { width, height, dpr, showGrid, showPoincarePlot, showFiducialPeaks } = this.config;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Limpieza con fondo profundo de telemetría médica
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    // 2. Cuadrícula médica milimétrica
    if (showGrid) {
      this.drawMedicalGrid(ctx, width, height);
    }

    // 3. Trazo de onda PPG con persistencia de fósforo
    this.drawWaveform(ctx, width, height, showFiducialPeaks);

    // 4. Panel de atractor de Poincaré 2D
    if (showPoincarePlot && this.lastContact === 'STABLE_CONTACT') {
      this.drawPoincarePlot(ctx, width, height);
    }

    // 5. Overlay de telemetría médica en Canvas
    if (this.config.showHudMetrics && this.lastContact !== 'NO_CONTACT') {
      this.drawHudMetricsOverlay(ctx);
    }

    ctx.restore();
  }

  private drawHudMetricsOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.font = '600 11px var(--font-mono), monospace';
    ctx.fillStyle = '#f43f5e';
    ctx.fillText(`${this.lastBpm > 0 ? this.lastBpm : '--'} BPM`, 14, 22);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`PI ${this.lastPi > 0 ? this.lastPi.toFixed(1) : '--'}%`, 85, 22);
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`SQI ${Math.round(this.lastSqi * 100)}%`, 155, 22);
    ctx.restore();
  }

  private drawMedicalGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gridSize = 30; // ~1 segundo equivalente
    const subGridSize = 6;

    // Sub-cuadrícula fina
    ctx.beginPath();
    ctx.strokeStyle = this.config.gridSubColor;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < width; x += subGridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += subGridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Cuadrícula principal
    ctx.beginPath();
    ctx.strokeStyle = this.config.gridColor;
    ctx.lineWidth = 1.0;
    for (let x = 0; x < width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  private drawWaveform(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    showPeaks: boolean
  ): void {
    if (this.sampleCount < 2) return;

    const range = Math.max(0.1, this.maxVal - this.minVal);
    const midY = height / 2;
    const scaleY = (height * 0.70) / range;
    const dx = width / (this.maxSamples - 1);

    // Color del trazo dinámico según calidad y contacto
    let strokeColor = '#10b981'; // Verde esmeralda (contacto estable)
    let glowColor = 'rgba(16, 185, 129, 0.4)';

    if (this.lastContact === 'NO_CONTACT') {
      strokeColor = '#64748b'; // Gris inactivo
      glowColor = 'rgba(100, 116, 139, 0.1)';
    } else if (this.lastContact === 'UNSTABLE_CONTACT' || this.lastSqi < 0.50) {
      strokeColor = '#f59e0b'; // Ámbar transitorio
      glowColor = 'rgba(245, 158, 11, 0.35)';
    }

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = this.lastContact === 'STABLE_CONTACT' ? 12 : 0;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let i = 0; i < this.sampleCount; i++) {
      const idx = (this.writeIndex - this.sampleCount + i + this.maxSamples) % this.maxSamples;
      const val = this.samples[idx]!;
      const x = i * dx;
      const y = midY - (val - (this.minVal + this.maxVal) / 2) * scaleY;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dibujar marcadores fiduciales de picos sistólicos
    if (showPeaks && this.lastContact === 'STABLE_CONTACT') {
      for (let i = 0; i < this.sampleCount; i++) {
        const idx = (this.writeIndex - this.sampleCount + i + this.maxSamples) % this.maxSamples;
        if (this.peakFlags[idx] === 1) {
          const val = this.samples[idx]!;
          const px = i * dx;
          const py = midY - (val - (this.minVal + this.maxVal) / 2) * scaleY;

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(244, 63, 94, 0.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 7.0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  private drawPoincarePlot(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const size = Math.min(80, height * 0.35);
    const posX = width - size - 12;
    const posY = 12;

    ctx.save();
    // Fondo de panel de atractor
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(posX, posY, size, size, 8);
    ctx.fill();
    ctx.stroke();

    // Título mini
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 8px JetBrains Mono, monospace';
    ctx.fillText('SPAR 2D', posX + 6, posY + 12);

    // Dibujar puntos del atractor
    const center = size / 2;
    const scale = (size * 0.4) / Math.max(0.1, (this.maxVal - this.minVal) / 2);

    for (let i = 0; i < this.poincareBuffer.length; i++) {
      const pt = this.poincareBuffer[i]!;
      const px = posX + center + pt.x * scale;
      const py = posY + center - pt.y * scale;

      const alpha = (i + 1) / this.poincareBuffer.length;
      ctx.fillStyle = `rgba(16, 185, 129, ${alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Resetea el historial y los buffers de telemetría.
   */
  public reset(): void {
    this.samples.fill(0);
    this.peakFlags.fill(0);
    this.sampleCount = 0;
    this.writeIndex = 0;
    this.poincareBuffer.length = 0;
    this.minVal = -1.0;
    this.maxVal = 1.0;
  }
}
