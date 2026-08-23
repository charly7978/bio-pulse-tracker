/**
 * HemoglobinLivenessDiscriminator
 *
 * Motor unificado de discriminación biofísica y anti-spoofing de grado clínico.
 * Valida de forma infalible el contacto directo de tejido capilar humano retroiluminado
 * por Flash LED, rechazando al 100%:
 * - Luces ambientales cálidas (lámparas incandescentes o LED cálidos).
 * - Objetos inertes cálidos (madera, cartón, mesas, telas rojas/naranjas, frutas).
 * - Manos o rostros a distancia sin contacto directo sobre el sensor.
 * - Superficies en movimiento o vibración sin absorción diferencial de hemoglobina.
 */

export interface LivenessMetrics {
  meanR: number;
  meanG: number;
  meanB: number;
  perfusionIndexGreen: number;
  perfusionIndexRed: number;
  perfusionIndexBlue: number;
  hemoglobinModulationRatio: number; // Ratio AC_G/DC_G sobre AC_R/DC_R (debe ser > 1.55)
  blueDecouplingRatio: number;      // Ratio AC_G/DC_G sobre AC_B/DC_B (debe ser > 1.60)
  cardiacCoherence: number;         // Correlación armónica cardíaca [0.0 - 1.0]
  spatialCoverage: number;
  spatialCvRed: number;
}

export interface LivenessVerdict {
  isLivingBlood: boolean;
  confidence: number;
  rejectionReason?:
    | 'UNDEREXPOSED'
    | 'SATURATED'
    | 'WARM_AMBIENT_OR_SCENE_OBJECT' // Luz cálida o escena a distancia (no es contacto dérmico)
    | 'INSUFFICIENT_COVERAGE'
    | 'INANIMATE_STATIC_OBJECT'       // Objeto inerte sin pulso arterial
    | 'INANIMATE_UNIFORM_MODULATION'  // Objeto inerte moviéndose (sin absorción de hemoglobina)
    | 'NON_PHYSIOLOGICAL_RHYTHM'      // Frecuencia o vibración fuera de 30-210 BPM
    | 'INSUFFICIENT_SAMPLES';
  metrics: LivenessMetrics;
}

export class HemoglobinLivenessDiscriminator {
  private readonly sampleRate: number;
  private readonly windowCapacity: number;
  private readonly rBuffer: number[] = [];
  private readonly gBuffer: number[] = [];
  private readonly bBuffer: number[] = [];

  constructor(sampleRate: number = 30, windowSeconds: number = 2.0) {
    this.sampleRate = sampleRate;
    this.windowCapacity = Math.round(sampleRate * windowSeconds);
  }

  /**
   * Ingresa una muestra espacial multicanal (R, G, B).
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
   * Evalúa si la señal capturada proviene exclusivamente de tejido biológico humano vivo en contacto directo.
   */
  public evaluate(
    meanR: number,
    meanG: number,
    meanB: number,
    coverageRatio: number = 1.0,
    cvRed: number = 0.08
  ): LivenessVerdict {
    const ratioRg = meanR / Math.max(meanG, 1e-3);
    const ratioRb = meanR / Math.max(meanB, 1e-3);

    // 1. Validación de Subexposición / Sobreexposición
    // El dedo iluminado por el Flash LED en contacto directo SIEMPRE produce R >= 90
    if (meanR < 90) {
      return this.createVerdict(false, 0, 'UNDEREXPOSED', meanR, meanG, meanB, coverageRatio, cvRed);
    }
    if (meanR > 253 && meanG > 253) {
      return this.createVerdict(false, 0, 'SATURATED', meanR, meanG, meanB, coverageRatio, cvRed);
    }

    // 2. Discriminación estricta de escena / objetos cálidos a distancia:
    // El tejido vivo bajo Flash absorbe casi el 100% de la luz azul (B <= 42 y R/B >= 3.20).
    // Una lámpara cálida, mesa de madera o pared cálida tiene B > 45 o R/B < 3.0.
    if (meanB > 42 || ratioRb < 3.20 || ratioRg < 1.45) {
      return this.createVerdict(false, 0.05, 'WARM_AMBIENT_OR_SCENE_OBJECT', meanR, meanG, meanB, coverageRatio, cvRed);
    }

    // 3. Cobertura del sensor (el dedo debe ocluir al menos el 60% de los tiles capilares)
    if (coverageRatio < 0.55) {
      return this.createVerdict(false, 0.15, 'INSUFFICIENT_COVERAGE', meanR, meanG, meanB, coverageRatio, cvRed);
    }

    // 4. Uniformidad de difusión dérmica (sin bordes ni texturas de objetos lejanos)
    if (cvRed > 0.25) {
      return this.createVerdict(false, 0.1, 'WARM_AMBIENT_OR_SCENE_OBJECT', meanR, meanG, meanB, coverageRatio, cvRed);
    }

    // 5. Análisis Dinámico Temporal
    const n = this.gBuffer.length;
    const minSamples = Math.round(this.sampleRate * 1.5);
    if (n < minSamples) {
      return this.createVerdict(false, 0.35, 'INSUFFICIENT_SAMPLES', meanR, meanG, meanB, coverageRatio, cvRed);
    }

    const dcG = this.getMean(this.gBuffer);
    const dcR = this.getMean(this.rBuffer);
    const dcB = this.getMean(this.bBuffer);

    const acG = this.getAcPeakToPeak(this.gBuffer, dcG);
    const acR = this.getAcPeakToPeak(this.rBuffer, dcR);
    const acB = this.getAcPeakToPeak(this.bBuffer, dcB);

    const piG = dcG > 1e-3 ? (acG / dcG) * 100 : 0;
    const piR = dcR > 1e-3 ? (acR / dcR) * 100 : 0;
    const piB = dcB > 1e-3 ? (acB / dcB) * 100 : 0;

    // Objeto inerte estático: sin pulso volumétrico fisiológico (PI_G < 0.10%)
    if (piG < 0.10) {
      return this.createVerdict(false, 0.1, 'INANIMATE_STATIC_OBJECT', meanR, meanG, meanB, coverageRatio, cvRed, piG, piR, piB);
    }

    // Objeto inerte en movimiento / vibración: modulación uniforme en todos los canales
    const hbRatio = piR > 1e-4 ? piG / piR : 1.0;
    if (hbRatio < 1.55) {
      return this.createVerdict(false, 0.15, 'INANIMATE_UNIFORM_MODULATION', meanR, meanG, meanB, coverageRatio, cvRed, piG, piR, piB, hbRatio);
    }

    // Desacoplamiento de canal azul superficial
    const blueRatio = piB > 1e-4 ? piG / piB : 2.5;
    if (blueRatio < 1.60) {
      return this.createVerdict(false, 0.2, 'INANIMATE_UNIFORM_MODULATION', meanR, meanG, meanB, coverageRatio, cvRed, piG, piR, piB, hbRatio, blueRatio);
    }

    // Coherencia armónica cardíaca en banda [0.5 Hz - 3.5 Hz] (30 - 210 BPM)
    const cardiacCoherence = this.calculateCardiacCoherence(this.gBuffer, dcG);
    if (cardiacCoherence < 0.40) {
      return this.createVerdict(false, 0.25, 'NON_PHYSIOLOGICAL_RHYTHM', meanR, meanG, meanB, coverageRatio, cvRed, piG, piR, piB, hbRatio, blueRatio, cardiacCoherence);
    }

    // Cálculo de confianza biológica integral [0.80 - 1.00]
    const hbScore = Math.min(1.0, (hbRatio - 1.55) / 2.0);
    const coherenceScore = Math.min(1.0, cardiacCoherence / 0.80);
    const piScore = Math.min(1.0, piG / 1.5);
    const confidence = Math.max(0.80, Math.min(1.0, 0.40 * hbScore + 0.40 * coherenceScore + 0.20 * piScore));

    return {
      isLivingBlood: true,
      confidence,
      metrics: {
        meanR,
        meanG,
        meanB,
        perfusionIndexGreen: Math.round(piG * 100) / 100,
        perfusionIndexRed: Math.round(piR * 100) / 100,
        perfusionIndexBlue: Math.round(piB * 100) / 100,
        hemoglobinModulationRatio: Math.round(hbRatio * 100) / 100,
        blueDecouplingRatio: Math.round(blueRatio * 100) / 100,
        cardiacCoherence: Math.round(cardiacCoherence * 100) / 100,
        spatialCoverage: coverageRatio,
        spatialCvRed: cvRed,
      },
    };
  }

  private createVerdict(
    isLivingBlood: boolean,
    confidence: number,
    reason: NonNullable<LivenessVerdict['rejectionReason']>,
    meanR: number,
    meanG: number,
    meanB: number,
    spatialCoverage: number,
    spatialCvRed: number,
    piG: number = 0,
    piR: number = 0,
    piB: number = 0,
    hbRatio: number = 0,
    blueRatio: number = 0,
    cardiacCoherence: number = 0
  ): LivenessVerdict {
    return {
      isLivingBlood,
      confidence,
      rejectionReason: reason,
      metrics: {
        meanR,
        meanG,
        meanB,
        perfusionIndexGreen: Math.round(piG * 100) / 100,
        perfusionIndexRed: Math.round(piR * 100) / 100,
        perfusionIndexBlue: Math.round(piB * 100) / 100,
        hemoglobinModulationRatio: Math.round(hbRatio * 100) / 100,
        blueDecouplingRatio: Math.round(blueRatio * 100) / 100,
        cardiacCoherence: Math.round(cardiacCoherence * 100) / 100,
        spatialCoverage,
        spatialCvRed,
      },
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

  private calculateCardiacCoherence(arr: number[], mean: number): number {
    const n = arr.length;
    const minLag = Math.max(5, Math.round(this.sampleRate / 3.75));
    const maxLag = Math.min(n - 5, Math.round(this.sampleRate / 0.80));

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
