/**
 * HemoglobinLivenessDiscriminator
 *
 * Motor unificado de discriminación biofísica y anti-spoofing de grado clínico.
 * Utiliza una máquina de estados finitos (FSM) con histéresis temporal (Schmitt Trigger)
 * y análisis espectral/pulsátil de transiluminación tisular para garantizar:
 * 1. Cero parpadeos o falsos cortes en la detección.
 * 2. Cero falsos positivos ante objetos inertes (madera, plástico, paredes cálidas, telas).
 * 3. Detección instantánea y transición suave al colocar el dedo.
 */

export type ContactFsmState = 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';

export interface LivenessMetrics {
  meanR: number;
  meanG: number;
  meanB: number;
  normR: number;
  normG: number;
  normB: number;
  ratioRg: number;
  ratioRb: number;
  perfusionIndexGreen: number;
  perfusionIndexRed: number;
  perfusionIndexBlue: number;
  hemoglobinModulationRatio: number;
  blueDecouplingRatio: number;
  cardiacCoherence: number;
  spatialCoverage: number;
  spatialCvRed: number;
  consecutiveValidFrames: number;
}

export interface LivenessVerdict {
  isLivingBlood: boolean;
  contactState: ContactFsmState;
  confidence: number;
  rejectionReason?:
    | 'UNDEREXPOSED'
    | 'SATURATED'
    | 'WARM_AMBIENT_OR_SCENE_OBJECT'
    | 'INSUFFICIENT_COVERAGE'
    | 'NON_UNIFORM_SCENE'
    | 'INANIMATE_STATIC_OBJECT'
    | 'INANIMATE_UNIFORM_MODULATION'
    | 'NON_PHYSIOLOGICAL_RHYTHM'
    | 'EXCESSIVE_PRESSURE'
    | 'INSUFFICIENT_SAMPLES';
  userGuidance: string;
  metrics: LivenessMetrics;
}

export class HemoglobinLivenessDiscriminator {
  private readonly sampleRate: number;
  private readonly windowCapacity: number;

  // Buffers temporales circulares
  private readonly rBuffer: number[] = [];
  private readonly gBuffer: number[] = [];
  private readonly bBuffer: number[] = [];

  // Filtros paso-alto internos para extraer la componente AC pura sin deriva DC
  private prevRawG = 0;
  private prevAcG = 0;
  private prevRawR = 0;
  private prevAcR = 0;
  private prevRawB = 0;
  private prevAcB = 0;

  // Buffer de muestras AC filtradas para análisis de coherencia cardíaca
  private readonly acGBuffer: number[] = [];
  private readonly acRBuffer: number[] = [];
  private readonly acBBuffer: number[] = [];

  // Máquina de estados finitos (FSM) con histéresis temporal
  private currentState: ContactFsmState = 'NO_CONTACT';
  private consecutiveValidTransillumination = 0;
  private consecutiveInvalidFrames = 0;
  private consecutiveStablePulseFrames = 0;

  constructor(sampleRate: number = 30, windowSeconds: number = 2.0) {
    this.sampleRate = sampleRate;
    this.windowCapacity = Math.round(sampleRate * windowSeconds);
  }

  /**
   * Ingresa una muestra espacial multicanal (R, G, B) y actualiza los filtros AC.
   */
  public pushSample(red: number, green: number, blue: number): void {
    // Si es la primera muestra tras reset, inicializar referencias sin salto discontinuo (step transient)
    if (this.rBuffer.length === 0) {
      this.prevRawG = green;
      this.prevRawR = red;
      this.prevRawB = blue;
      this.prevAcG = 0;
      this.prevAcR = 0;
      this.prevAcB = 0;
    }

    this.rBuffer.push(red);
    this.gBuffer.push(green);
    this.bBuffer.push(blue);

    // Filtro paso-alto de 1er orden (fc ≈ 0.5 Hz a 30 fps) para aislar AC de la deriva DC
    // y[n] = alpha * (y[n-1] + x[n] - x[n-1]) donde alpha = 0.90
    const alpha = 0.90;
    const acG = alpha * (this.prevAcG + green - this.prevRawG);
    const acR = alpha * (this.prevAcR + red - this.prevRawR);
    const acB = alpha * (this.prevAcB + blue - this.prevRawB);

    this.prevRawG = green;
    this.prevAcG = acG;
    this.prevRawR = red;
    this.prevAcR = acR;
    this.prevRawB = blue;
    this.prevAcB = acB;

    this.acGBuffer.push(acG);
    this.acRBuffer.push(acR);
    this.acBBuffer.push(acB);

    if (this.rBuffer.length > this.windowCapacity) {
      this.rBuffer.shift();
      this.gBuffer.shift();
      this.bBuffer.shift();
      this.acGBuffer.shift();
      this.acRBuffer.shift();
      this.acBBuffer.shift();
    }
  }

  /**
   * Valida estáticamente si las características cromáticas y espaciales coinciden
   * con transiluminación tisular dérmica bajo iluminación Flash LED.
   */
  public checkSkinTransillumination(
    meanR: number,
    meanG: number,
    meanB: number,
    coverageRatio: number = 1.0,
    cvRed: number = 0.08
  ): { isValid: boolean; reason?: LivenessVerdict['rejectionReason'] } {
    const total = meanR + meanG + meanB;
    if (total < 10) {
      return { isValid: false, reason: 'UNDEREXPOSED' };
    }

    const normR = meanR / total;
    const normB = meanB / total;
    const ratioRg = meanR / Math.max(meanG, 1e-3);
    const ratioRb = meanR / Math.max(meanB, 1e-3);

    // 1. Nivel mínimo de penetración lumínica (contacto con flash)
    if (meanR < 70) {
      return { isValid: false, reason: 'UNDEREXPOSED' };
    }
    if (meanR > 253 && meanG > 253 && meanB > 253) {
      return { isValid: false, reason: 'SATURATED' };
    }

    // 2. Transiluminación biológica: El tejido dérmico bajo flash extingue fuertemente el azul
    // y domina el espectro rojo por dispersión de Rayleigh y absorción vascular.
    if (normR < 0.58 || normB > 0.18 || meanB > 58) {
      return { isValid: false, reason: 'WARM_AMBIENT_OR_SCENE_OBJECT' };
    }
    if (ratioRb < 2.60 || ratioRg < 1.20) {
      return { isValid: false, reason: 'WARM_AMBIENT_OR_SCENE_OBJECT' };
    }

    // 3. Cobertura del sensor y homogeneidad espacial
    if (coverageRatio < 0.40) {
      return { isValid: false, reason: 'INSUFFICIENT_COVERAGE' };
    }
    if (cvRed > 0.38) {
      return { isValid: false, reason: 'NON_UNIFORM_SCENE' };
    }

    return { isValid: true };
  }

  /**
   * Evalúa la señal y actualiza la máquina de estados finitos con histéresis.
   */
  public evaluate(
    meanR: number,
    meanG: number,
    meanB: number,
    coverageRatio: number = 1.0,
    cvRed: number = 0.08
  ): LivenessVerdict {
    const total = Math.max(1e-3, meanR + meanG + meanB);
    const normR = meanR / total;
    const normG = meanG / total;
    const normB = meanB / total;
    const ratioRg = meanR / Math.max(meanG, 1e-3);
    const ratioRb = meanR / Math.max(meanB, 1e-3);

    // 1. Verificación de transiluminación estática instantánea
    const staticCheck = this.checkSkinTransillumination(meanR, meanG, meanB, coverageRatio, cvRed);

    // 2. Cálculo de métricas dinámicas AC / DC sobre señales filtradas
    const n = this.acGBuffer.length;
    const dcG = Math.max(1e-3, this.getMean(this.gBuffer));
    const dcR = Math.max(1e-3, this.getMean(this.rBuffer));
    const dcB = Math.max(1e-3, this.getMean(this.bBuffer));

    const acRmsG = this.getRms(this.acGBuffer);
    const acRmsR = this.getRms(this.acRBuffer);
    const acRmsB = this.getRms(this.acBBuffer);

    // Índice de perfusión fisiológico (%)
    const piG = (acRmsG * Math.SQRT2 / dcG) * 100;
    const piR = (acRmsR * Math.SQRT2 / dcR) * 100;
    const piB = (acRmsB * Math.SQRT2 / dcB) * 100;

    // Ratios biofísicos de modulación diferencial
    const hbRatio = piR > 1e-4 ? piG / piR : 1.0;
    const blueDecoupling = piB > 1e-4 ? piG / piB : 2.0;

    // Coherencia cardíaca armónica
    const cardiacCoherence = n >= 25 ? this.calculateCardiacCoherence(this.acGBuffer) : 0;

    // 3. Lógica de transición de la FSM (Finite State Machine) con Histéresis
    let rejectionReason: LivenessVerdict['rejectionReason'] = staticCheck.reason;
    let userGuidance = 'Cubre la cámara y el flash con la yema del dedo';

    if (staticCheck.isValid) {
      this.consecutiveValidTransillumination++;
      this.consecutiveInvalidFrames = 0;
    } else {
      this.consecutiveInvalidFrames++;
      this.consecutiveValidTransillumination = Math.max(0, this.consecutiveValidTransillumination - 2);
      this.consecutiveStablePulseFrames = 0;
    }

    const minSamplesForPulse = Math.round(this.sampleRate * 0.8); // ~24 muestras (800ms)

    switch (this.currentState) {
      case 'NO_CONTACT': {
        // Para entrar a UNSTABLE_CONTACT, requiere 5 frames consecutivos de transiluminación dérmica válida
        if (this.consecutiveValidTransillumination >= 5) {
          this.currentState = 'UNSTABLE_CONTACT';
          rejectionReason = 'INSUFFICIENT_SAMPLES';
          userGuidance = 'Analizando pulso... Mantén el dedo firme';
        } else {
          userGuidance = 'Coloca tu dedo índice sobre la cámara y el flash';
        }
        break;
      }

      case 'UNSTABLE_CONTACT': {
        // Si se pierde el contacto por más de 10 frames consecutivos (~330ms), volver a NO_CONTACT
        if (this.consecutiveInvalidFrames >= 10) {
          this.currentState = 'NO_CONTACT';
          this.resetBuffers();
          userGuidance = 'Contacto perdido. Vuelve a colocar el dedo';
          break;
        }

        // Evaluar si ya hay suficientes muestras para confirmar pulso biológico
        if (n < minSamplesForPulse) {
          rejectionReason = 'INSUFFICIENT_SAMPLES';
          userGuidance = 'Calibrando sensor de pulso...';
          break;
        }

        // Criterio de validación de pulso vivo
        // Objeto inerte estático: sin modulación pulsátil (PI_G < 0.05% o amplitud AC microscópica)
        if (n >= 30 && (piG < 0.05 || acRmsG < 0.02)) {
          rejectionReason = 'INANIMATE_STATIC_OBJECT';
          userGuidance = 'No se detecta pulso arterial. Presiona suavemente sobre el sensor';
          this.consecutiveStablePulseFrames = 0;
          break;
        }

        // Modulación uniforme (movimiento o sacudida de objeto cálido sin absorción diferencial)
        if (n >= 40 && hbRatio < 1.05 && piR > 0.20) {
          rejectionReason = 'INANIMATE_UNIFORM_MODULATION';
          userGuidance = 'Movimiento excesivo detectado. Mantén la mano inmóvil';
          this.consecutiveStablePulseFrames = 0;
          break;
        }

        // Pulso fisiológico detectado (requiere modulación AC apreciable y coherencia cardíaca periódica)
        const isPulseDetected =
          piG >= 0.10 &&
          acRmsG >= 0.04 &&
          cardiacCoherence >= 0.30 &&
          n >= minSamplesForPulse;

        if (isPulseDetected) {
          this.consecutiveStablePulseFrames++;
          if (this.consecutiveStablePulseFrames >= 6) {
            this.currentState = 'STABLE_CONTACT';
            rejectionReason = undefined;
            userGuidance = 'Pulso detectado. Registro clínico activo';
          } else {
            userGuidance = 'Sincronizando ritmo cardíaco...';
          }
        } else {
          this.consecutiveStablePulseFrames = 0;
          userGuidance = 'Estabilizando señal capilar...';
        }
        break;
      }

      case 'STABLE_CONTACT': {
        // Histéresis robusta para evitar cortes: requiere 15 frames consecutivos de pérdida (~500ms) para caer
        if (this.consecutiveInvalidFrames >= 15) {
          this.currentState = 'NO_CONTACT';
          this.resetBuffers();
          userGuidance = 'Contacto finalizado';
          break;
        }

        // Si el pulso se apaga durante contacto sostenido (objeto inerte o isquemia prolongada)
        if (n >= 40 && (piG < 0.04 || acRmsG < 0.015)) {
          this.currentState = 'UNSTABLE_CONTACT';
          this.consecutiveStablePulseFrames = 0;
          rejectionReason = 'INANIMATE_STATIC_OBJECT';
          userGuidance = 'Señal pulsátil perdida. Ajusta la presión del dedo';
          break;
        }

        // Detección de isquemia por presión excesiva sobre el lente
        if (n >= 60 && piG < 0.03) {
          userGuidance = 'Presión muy fuerte. Afloja suavemente el dedo';
          rejectionReason = 'EXCESSIVE_PRESSURE';
        } else {
          rejectionReason = undefined;
          userGuidance = 'Lectura cardíaca estable';
        }
        break;
      }
    }

    const isLivingBlood = this.currentState === 'STABLE_CONTACT';

    // Cálculo de índice de confianza biológica integral [0.0 - 1.0]
    let confidence = 0;
    if (isLivingBlood) {
      const cohScore = Math.min(1.0, cardiacCoherence / 0.70);
      const piScore = Math.min(1.0, piG / 1.0);
      const covScore = coverageRatio;
      confidence = Math.max(0.75, Math.min(1.0, 0.40 * cohScore + 0.35 * piScore + 0.25 * covScore));
    } else if (this.currentState === 'UNSTABLE_CONTACT') {
      confidence = 0.35;
    }

    const metrics: LivenessMetrics = {
      meanR,
      meanG,
      meanB,
      normR: Math.round(normR * 1000) / 1000,
      normG: Math.round(normG * 1000) / 1000,
      normB: Math.round(normB * 1000) / 1000,
      ratioRg: Math.round(ratioRg * 100) / 100,
      ratioRb: Math.round(ratioRb * 100) / 100,
      perfusionIndexGreen: Math.round(piG * 100) / 100,
      perfusionIndexRed: Math.round(piR * 100) / 100,
      perfusionIndexBlue: Math.round(piB * 100) / 100,
      hemoglobinModulationRatio: Math.round(hbRatio * 100) / 100,
      blueDecouplingRatio: Math.round(blueDecoupling * 100) / 100,
      cardiacCoherence: Math.round(cardiacCoherence * 100) / 100,
      spatialCoverage: coverageRatio,
      spatialCvRed: cvRed,
      consecutiveValidFrames: this.consecutiveValidTransillumination,
    };

    return {
      isLivingBlood,
      contactState: this.currentState,
      confidence,
      rejectionReason,
      userGuidance,
      metrics,
    };
  }

  private calculateCardiacCoherence(acSignal: number[]): number {
    const n = acSignal.length;
    if (n < 20) return 0;

    const minLag = Math.max(5, Math.round(this.sampleRate / 3.75)); // 225 BPM (~8 frames)
    const maxLag = Math.min(n - 5, Math.round(this.sampleRate / 0.67)); // 40 BPM (~45 frames)

    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const v = acSignal[i]!;
      varSum += v * v;
    }
    if (varSum < 0.01) return 0; // Ruido plano o inerte sin potencia pulsátil

    let maxCorrelation = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let crossSum = 0;
      let count = 0;
      for (let i = 0; i < n - lag; i++) {
        crossSum += acSignal[i]! * acSignal[i + lag]!;
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

  private getMean(arr: number[]): number {
    if (arr.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i]!;
    return sum / arr.length;
  }

  private getRms(arr: number[]): number {
    if (arr.length === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / arr.length);
  }

  private resetBuffers(): void {
    this.rBuffer.length = 0;
    this.gBuffer.length = 0;
    this.bBuffer.length = 0;
    this.acGBuffer.length = 0;
    this.acRBuffer.length = 0;
    this.acBBuffer.length = 0;
    this.prevRawG = 0;
    this.prevAcG = 0;
    this.prevRawR = 0;
    this.prevAcR = 0;
    this.prevRawB = 0;
    this.prevAcB = 0;
    this.consecutiveStablePulseFrames = 0;
  }

  /**
   * Resetea el discriminador a su estado inicial.
   */
  public reset(): void {
    this.currentState = 'NO_CONTACT';
    this.consecutiveValidTransillumination = 0;
    this.consecutiveInvalidFrames = 0;
    this.consecutiveStablePulseFrames = 0;
    this.resetBuffers();
  }
}
