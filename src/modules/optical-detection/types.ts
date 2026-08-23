/**
 * Tipos e interfaces para el subsistema de detección óptica de hemoglobina
 * y validación de tejido biológico humano (Paso 1).
 */

export interface RgbSample {
  r: number;
  g: number;
  b: number;
  timestampMs: number;
}

export interface SpatialTileMetrics {
  tileIndex: number;
  row: number;
  col: number;
  r: number;
  g: number;
  b: number;
  acDcGreen: number;
  spatialVariance: number;
  weight: number;
  isPulsatile: boolean;
}

export interface SpatialRoiResult {
  weightedRed: number;
  weightedGreen: number;
  weightedBlue: number;
  spatialCoverage: number;
  spatialCvRed: number;
  activeTiles: number;
  totalTiles: number;
  tiles: SpatialTileMetrics[];
}

export interface HemoglobinVerdict {
  isHumanTissue: boolean;
  confidence: number;
  absorptionRatioRg: number;
  absorptionRatioRb: number;
  chrominanceSnr: number;
  rejectionReason?: 'SATURATED' | 'UNDEREXPOSED' | 'NO_HEMOGLOBIN_ABSORPTION' | 'INSUFFICIENT_COVERAGE' | 'AMBIENT_LIGHT_LEAK';
  metrics: {
    meanR: number;
    meanG: number;
    meanB: number;
    coverageRatio: number;
    cvRed: number;
  };
}

export interface BiologicalLivenessVerdict {
  isLiveBiologicalPulse: boolean | null;
  confidence: number;
  attractorRegularity: number;
  templateSinr: number;
  cardiacPeriodicity: number;
  dominantBpm: number;
  reasons: string[];
}
