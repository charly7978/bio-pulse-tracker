/**
 * SpatialCapillaryRoiExtractor
 *
 * Divide el fotograma capturado por el sensor en una cuadrícula de tiles espaciales
 * para aislar las regiones con mayor índice de perfusión capilar y menor dispersión
 * de movimiento (Chatterjee & Budidha 2018).
 */

import { SpatialRoiResult, SpatialTileMetrics } from './types';

export interface SpatialExtractorConfig {
  gridRows: number;
  gridCols: number;
  pixelStride: number;
  minPulsatileTilesRatio: number;
}

export const DEFAULT_EXTRACTOR_CONFIG: SpatialExtractorConfig = {
  gridRows: 4,
  gridCols: 4,
  pixelStride: 2,
  minPulsatileTilesRatio: 0.25,
};

export class SpatialCapillaryRoiExtractor {
  private readonly config: SpatialExtractorConfig;
  private readonly greenHistoryPerTile: number[][];
  private readonly historyCapacity = 30; // 1 segundo a 30 fps

  constructor(config: Partial<SpatialExtractorConfig> = {}) {
    this.config = { ...DEFAULT_EXTRACTOR_CONFIG, ...config };
    const totalTiles = this.config.gridRows * this.config.gridCols;
    this.greenHistoryPerTile = Array.from({ length: totalTiles }, () => []);
  }

  /**
   * Procesa un fotograma RGBA y extrae las métricas espaciales y la señal ponderada óptima.
   */
  public extractFromRgba(
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): SpatialRoiResult {
    const { gridRows, gridCols, pixelStride } = this.config;
    const totalTiles = gridRows * gridCols;
    const tileW = Math.floor(width / gridCols);
    const tileH = Math.floor(height / gridRows);

    const tiles: SpatialTileMetrics[] = [];
    let globalSumR = 0;
    let globalSumG = 0;
    let globalSumB = 0;
    let globalPixelCount = 0;
    let globalSumSqR = 0;

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tileIndex = r * gridCols + c;
        const startX = c * tileW;
        const startY = r * tileH;
        const endX = Math.min(startX + tileW, width);
        const endY = Math.min(startY + tileH, height);

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumSqR = 0;
        let count = 0;

        for (let y = startY; y < endY; y += pixelStride) {
          const rowOffset = y * width * 4;
          for (let x = startX; x < endX; x += pixelStride) {
            const idx = rowOffset + x * 4;
            const pr = data[idx]!;
            const pg = data[idx + 1]!;
            const pb = data[idx + 2]!;

            sumR += pr;
            sumG += pg;
            sumB += pb;
            sumSqR += pr * pr;
            count++;
          }
        }

        const meanR = count > 0 ? sumR / count : 0;
        const meanG = count > 0 ? sumG / count : 0;
        const meanB = count > 0 ? sumB / count : 0;
        const varianceR = count > 1 ? Math.max(0, (sumSqR - (sumR * sumR) / count) / (count - 1)) : 0;

        globalSumR += sumR;
        globalSumG += sumG;
        globalSumB += sumB;
        globalSumSqR += sumSqR;
        globalPixelCount += count;

        // Actualizar historial verde para cálculo de modulación pulsátil (AC/DC)
        const gHist = this.greenHistoryPerTile[tileIndex]!;
        gHist.push(meanG);
        if (gHist.length > this.historyCapacity) gHist.shift();

        let acDc = 0;
        if (gHist.length >= 10 && meanG > 10) {
          const minG = Math.min(...gHist);
          const maxG = Math.max(...gHist);
          acDc = (maxG - minG) / meanG;
        }

        // Ponderación por pureza capilar: favorece alta modulación y penaliza ruido espacial extremo
        const pulsatileScore = Math.min(1.0, acDc * 50);
        const redPurity = meanR > 50 ? meanR / (meanG + meanB + 1e-4) : 0;
        const weight = Math.max(0.01, pulsatileScore * 0.6 + Math.min(1.0, redPurity / 3.0) * 0.4);

        tiles.push({
          tileIndex,
          row: r,
          col: c,
          r: meanR,
          g: meanG,
          b: meanB,
          acDcGreen: acDc,
          spatialVariance: varianceR,
          weight,
          isPulsatile: acDc >= 0.0005 && meanR >= 40,
        });
      }
    }

    // Normalización de pesos
    const totalWeight = tiles.reduce((acc, t) => acc + t.weight, 0);
    let weightedRed = 0;
    let weightedGreen = 0;
    let weightedBlue = 0;
    let activeTiles = 0;

    for (const t of tiles) {
      const normWeight = totalWeight > 0 ? t.weight / totalWeight : 1 / totalTiles;
      weightedRed += t.r * normWeight;
      weightedGreen += t.g * normWeight;
      weightedBlue += t.b * normWeight;
      if (t.isPulsatile) activeTiles++;
    }

    const globalMeanR = globalPixelCount > 0 ? globalSumR / globalPixelCount : 0;
    const globalStdR = globalPixelCount > 1
      ? Math.sqrt(Math.max(0, (globalSumSqR - (globalSumR * globalSumR) / globalPixelCount) / (globalPixelCount - 1)))
      : 0;
    const spatialCvRed = globalMeanR > 0 ? globalStdR / globalMeanR : 0;
    const spatialCoverage = totalTiles > 0 ? activeTiles / totalTiles : 0;

    return {
      weightedRed,
      weightedGreen,
      weightedBlue,
      spatialCoverage,
      spatialCvRed,
      activeTiles,
      totalTiles,
      tiles,
    };
  }

  /**
   * Resetea el historial temporal de los tiles.
   */
  public reset(): void {
    for (const hist of this.greenHistoryPerTile) {
      hist.length = 0;
    }
  }
}
