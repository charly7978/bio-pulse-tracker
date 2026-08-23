import { describe, it, expect } from 'vitest';
import { SpatialCapillaryRoiExtractor } from '../SpatialCapillaryRoiExtractor';

describe('SpatialCapillaryRoiExtractor', () => {
  it('extrae cuadrícula de tiles y calcula pesos espaciales adecuadamente', () => {
    const extractor = new SpatialCapillaryRoiExtractor({ gridRows: 4, gridCols: 4, pixelStride: 2 });
    const width = 64;
    const height = 64;
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Rellenar simulación de dedo: fondo rojo con gradiente
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 180 + Math.floor((x / width) * 20); // R
        rgba[idx + 1] = 40 + Math.floor((y / height) * 10); // G
        rgba[idx + 2] = 15; // B
        rgba[idx + 3] = 255; // A
      }
    }

    const result = extractor.extractFromRgba(rgba, width, height);

    expect(result.totalTiles).toBe(16);
    expect(result.tiles.length).toBe(16);
    expect(result.weightedRed).toBeGreaterThan(170);
    expect(result.weightedGreen).toBeGreaterThan(35);
    expect(result.weightedBlue).toBeCloseTo(15, 2);
    expect(result.spatialCvRed).toBeGreaterThan(0.01);
  });

  it('asigna mayor peso a los tiles con modulación pulsátil activa', () => {
    const extractor = new SpatialCapillaryRoiExtractor({ gridRows: 2, gridCols: 2, pixelStride: 1 });
    const width = 20;
    const height = 20;
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Simular múltiples fotogramas donde el tile superior izquierdo (0,0) pulsa en G
    for (let frame = 0; frame < 15; frame++) {
      const gPulse = 40 + Math.sin((frame / 15) * Math.PI * 2) * 5; // Modulación AC
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 190;
          // Solo pulsa el cuadrante 0
          rgba[idx + 1] = (x < 10 && y < 10) ? gPulse : 40;
          rgba[idx + 2] = 15;
          rgba[idx + 3] = 255;
        }
      }
      extractor.extractFromRgba(rgba, width, height);
    }

    const finalResult = extractor.extractFromRgba(rgba, width, height);
    const tile0 = finalResult.tiles[0]!;
    const tile3 = finalResult.tiles[3]!;

    expect(tile0.acDcGreen).toBeGreaterThan(tile3.acDcGreen);
    expect(tile0.weight).toBeGreaterThan(tile3.weight);
  });
});
