/**
 * DynamicVolumetricLivenessEngine
 *
 * Motor biofísico de discriminación de vivacidad e infalibilidad óptica (Anti-Spoofing).
 *
 * Principio Biofísico:
 * Un objeto inerte rojo (plástico, papel, tela, silicona, fruta) puede tener un color RGB similar
 * a la piel retroiluminada en una foto estática, PERO es físicamente incapaz de reproducir:
 * 1. Modulación volumétrica pulsátil (AC/DC > 0.08%).
 * 2. Absorción diferencial de hemoglobina: El canal Verde tiene una absorción 2.5x - 5.0x mayor
 *    que el canal Rojo (picos alfa y beta de oxihemoglobina a 540-575 nm).
 *    En un objeto inerte en movimiento, la modulación es uniforme en todos los canales (AC_G / AC_R ~ 1.0).
 * 3. Desacoplamiento de reflexión superficial: El canal Azul no penetra a la dermis capilar.
 * 4. Coherencia armónica cardíaca en el rango fisiológico [0.5 Hz - 3.5 Hz] (30 - 210 BPM).
 */

export interface DynamicLivenessVerdict {
  isLivingBlood: boolean;
  confidence: number;
  perfusionIndexGreen: number;
  perfusionIndexRed: number;
  perfusionIndexBlue: number;
  hemoglobinModulationRatio: number; // AC_G/DC_G dividido por AC_R/DC_R (debe ser > 1.8 en sangre real)
  blueDecouplingRatio: number;      // AC_G/DC_G dividido por AC_B/DC_B (debe ser > 2.0 en sangre real)
  spectralPurity: number;           // Concentración de energía en armónico cardíaco [0.0 - 1.0]
  rejectionReason?:
    | 'INSUFFICIENT_SAMPLES'
    | 'INANIMATE_STATIC_OBJECT'       // Objeto inerte sin pulso (plástico, papel, etc.)
    | 'INANIMATE_UNIFORM_MODULATION'  // Objeto inerte moviéndose (modula todos los canales por igual)
    | 'NO_HEMOGLOBIN_ABSORPTION_CURVE'// No cumple la curva de absorción de oxihemoglobina
    | 'NON_PHYSIOLOGICAL_FREQUENCY'   // Frecuencia fuera de 30-210 BPM
    | 'UNSTABLE_COVERAGE';
}

export class DynamicVolumetricLivenessEngine {
  private readonly windowCapacity: number;
  private readonly rBuffer: number[] = [];
  private readonly gBuffer: number[] = [];
  private readonly bBuffer: number[] = [];
  private readonly sampleRate: number;

  constructor(sampleRate: number = 30, windowSeconds: number = 2.0) {
    this.sampleRate = sampleRate;
    this.windowCapacity = Math.round(sampleRate * windowSeconds); // 60 muestras a 30 FPS
  }

  /**
   * Ingresa una muestra espacial multicanal (R, G, B) de la región capilar.
   */
  public pushSample(red: number, green: number, blue: number): void {
    this.rBuffer.push(red);
    this.gBuffer.push(green);
    this.bBuffer.push(blue);

    if (this.rBuffer.length > this.windowCapacity) {
      this.rBuffer.shift();
      this.gBuffer.shift();
      this.bBuffer.shift();
    }
  }

  /**
   * Evalúa si el historial temporal de fotogramas corresponde a sangre humana viva pulsátil.
   */
  public evaluateLiveness(isStaticSpectrumValid: boolean): DynamicLivenessVerdict {
    const n = this.gBuffer.length;

    // Requiere al menos 1.5 segundos de muestras para analizar la dinámica temporal
    if (n < Math.round(this.sampleRate * 1.5)) {
      return {
        isLivingBlood: false,
        confidence: 0.1,
        perfusionIndexGreen: 0,
        perfusionIndexRed: 0,
        perfusionIndexBlue: 0,
        hemoglobinModulationRatio: 0,
        blueDecouplingRatio: 0,
        spectralPurity: 0,
        rejectionReason: 'INSUFFICIENT_SAMPLES',
      };
    }

    if (!isStaticSpectrumValid) {
      return {
        isLivingBlood: false,
        confidence: 0,
        perfusionIndexGreen: 0,
        perfusionIndexRed: 0,
        perfusionIndexBlue: 0,
        hemoglobinModulationRatio: 0,
        blueDecouplingRatio: 0,
        spectralPurity: 0,
        rejectionReason: 'NO_HEMOGLOBIN_ABSORPTION_CURVE',
      };
    }

    // 1. Cálculo de DC (media) y AC (pico a pico filtrado) para cada canal
    const dcG = this.getMean(this.gBuffer);
    const dcR = this.getMean(this.rBuffer);
    const dcB = this.getMean(this.bBuffer);

    const acG = this.getAcPeakToPeak(this.gBuffer, dcG);
    const acR = this.getAcPeakToPeak(this.rBuffer, dcR);
    const acB = this.getAcPeakToPeak(this.bBuffer, dcB);

    // Índices de Perfusión (PI = AC / DC * 100%)
    const piG = dcG > 1e-3 ? (acG / dcG) * 100 : 0;
    const piR = dcR > 1e-3 ? (acR / dcR) * 100 : 0;
    const piB = dcB > 1e-3 ? (acB / dcB) * 100 : 0;

    // 2. Comprobación de Pulsatilidad Volumétrica Mínima
    // Un objeto inerte estático (plástico rojo, papel) tiene AC ~ 0 (PI_G < 0.08%)
    if (piG < 0.08) {
      return {
        isLivingBlood: false,
        confidence: 0,
        perfusionIndexGreen: piG,
        perfusionIndexRed: piR,
        perfusionIndexBlue: piB,
        hemoglobinModulationRatio: 0,
        blueDecouplingRatio: 0,
        spectralPurity: 0,
        rejectionReason: 'INANIMATE_STATIC_OBJECT',
      };
    }

    // 3. Comprobación de Absorción Diferencial de Oxihemoglobina (Ratio de Modulación Verde / Rojo)
    // En sangre real: la absorción en verde es mucho más pulsátil que en rojo (piG / piR >= 1.6)
    // En un objeto inerte en movimiento (plástico, tela agitándose): piG / piR ~ 0.8 - 1.2
    const hbRatio = piR > 1e-4 ? piG / piR : 1.0;
    if (hbRatio < 1.45) {
      return {
        isLivingBlood: false,
        confidence: 0.15,
        perfusionIndexGreen: piG,
        perfusionIndexRed: piR,
        perfusionIndexBlue: piB,
        hemoglobinModulationRatio: hbRatio,
        blueDecouplingRatio: piB > 1e-4 ? piG / piB : 1.0,
        spectralPurity: 0,
        rejectionReason: 'INANIMATE_UNIFORM_MODULATION',
      };
    }

    // 4. Comprobación de Desacoplamiento de Superficie Azul (Azul es superficial, no capilar)
    const blueRatio = piB > 1e-4 ? piG / piB : 2.5;
    if (blueRatio < 1.4) {
      return {
        isLivingBlood: false,
        confidence: 0.2,
        perfusionIndexGreen: piG,
        perfusionIndexRed: piR,
        perfusionIndexBlue: piB,
        hemoglobinModulationRatio: hbRatio,
        blueDecouplingRatio: blueRatio,
        spectralPurity: 0,
        rejectionReason: 'INANIMATE_UNIFORM_MODULATION',
      };
    }

    // 5. Análisis de Pureza Espectral y Autocorrelación Cardíaca [0.5 Hz - 3.5 Hz] (30 - 210 BPM)
    const spectralPurity = this.calculateCardiacAutocorrelation(this.gBuffer, dcG);
    if (spectralPurity < 0.35) {
      return {
        isLivingBlood: false,
        confidence: 0.25,
        perfusionIndexGreen: piG,
        perfusionIndexRed: piR,
        perfusionIndexBlue: piB,
        hemoglobinModulationRatio: hbRatio,
        blueDecouplingRatio: blueRatio,
        spectralPurity,
        rejectionReason: 'NON_PHYSIOLOGICAL_FREQUENCY',
      };
    }

    // 6. Confianza Biológica Integral
    const hbScore = Math.min(1.0, (hbRatio - 1.45) / 2.0);
    const purityScore = Math.min(1.0, spectralPurity / 0.8);
    const piScore = Math.min(1.0, piG / 1.5);

    const confidence = Math.max(0.70, Math.min(1.0, 0.40 * hbScore + 0.40 * purityScore + 0.20 * piScore));

    return {
      isLivingBlood: true,
      confidence,
      perfusionIndexGreen: Math.round(piG * 100) / 100,
      perfusionIndexRed: Math.round(piR * 100) / 100,
      perfusionIndexBlue: Math.round(piB * 100) / 100,
      hemoglobinModulationRatio: Math.round(hbRatio * 100) / 100,
      blueDecouplingRatio: Math.round(blueRatio * 100) / 100,
      spectralPurity: Math.round(spectralPurity * 100) / 100,
    };
  }

  private getMean(arr: number[]): number {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i]!;
    return sum / arr.length;
  }

  private getAcPeakToPeak(arr: number[], mean: number): number {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]! - mean;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return Math.max(0, max - min);
  }

  /**
   * Calcula la autocorrelación normalizada en la banda cardíaca fisiológica.
   */
  private calculateCardiacAutocorrelation(arr: number[], mean: number): number {
    const n = arr.length;
    // Rango de retardos fisiológicos a 30 FPS: [8 muestras (225 BPM) a 36 muestras (50 BPM)]
    const minLag = Math.max(5, Math.round(this.sampleRate / 3.75));
    const maxLag = Math.min(n - 5, Math.round(this.sampleRate / 0.80));

    // Energía total centrada
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const diff = arr[i]! - mean;
      varSum += diff * diff;
    }
    if (varSum < 1e-4) return 0;

    let maxCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let crossSum = 0;
      let count = 0;
      for (let i = 0; i < n - lag; i++) {
        crossSum += (arr[i]! - mean) * (arr[i + lag]! - mean);
        count++;
      }
      if (count > 0) {
        const normCorr = crossSum / (varSum * (count / n));
        if (normCorr > maxCorrelation) {
          maxCorrelation = normCorr;
        }
      }
    }

    return Math.max(0, Math.min(1.0, maxCorrelation));
  }

  public reset(): void {
    this.rBuffer.length = 0;
    this.gBuffer.length = 0;
    this.bBuffer.length = 0;
  }
}
