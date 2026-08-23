/**
 * SampleEntropyCalculator
 *
 * Cálculo no lineal de Entropía Muestral (SampEn) para series temporales de intervalos RR
 * según la definición matemática estándar de Richman & Moorman (2000) y Lake et al. (2002).
 *
 * Cuantifica la probabilidad de que secuencias de longitud m que coinciden dentro de una
 * tolerancia r también coincidan al extenderse a longitud m + 1.
 */

export class SampleEntropyCalculator {
  /**
   * Calcula SampEn sobre una serie de intervalos RR.
   * @param rrIntervals Array de intervalos RR en milisegundos
   * @param m Dimensión de incrustación (por defecto 2)
   * @param rTolerance Factor de tolerancia respecto a SDNN (por defecto 0.2)
   */
  public static calculate(
    rrIntervals: number[],
    m: number = 2,
    rTolerance: number = 0.2
  ): number {
    const N = rrIntervals.length;
    if (N < m + 5) return 0;

    // 1. Calcular desviación estándar (SDNN)
    let sum = 0;
    for (let i = 0; i < N; i++) sum += rrIntervals[i]!;
    const mean = sum / N;

    let varSum = 0;
    for (let i = 0; i < N; i++) {
      const diff = rrIntervals[i]! - mean;
      varSum += diff * diff;
    }
    const sdnn = Math.sqrt(varSum / (N - 1));
    const r = Math.max(12, rTolerance * sdnn);

    // 2. Conteo de coincidencias para vectores de longitud m y m+1
    let B = 0; // Coincidencias en longitud m
    let A = 0; // Coincidencias en longitud m+1

    const maxIndex = N - m - 1;

    for (let i = 0; i <= maxIndex; i++) {
      for (let j = i + 1; j <= maxIndex; j++) {
        // Verificar coincidencia en longitud m
        let matchM = true;
        for (let k = 0; k < m; k++) {
          if (Math.abs(rrIntervals[i + k]! - rrIntervals[j + k]!) > r) {
            matchM = false;
            break;
          }
        }

        if (matchM) {
          B++;
          // Si coincide en m, verificar si también coincide el punto adicional (m+1)
          if (Math.abs(rrIntervals[i + m]! - rrIntervals[j + m]!) <= r) {
            A++;
          }
        }
      }
    }

    if (B === 0) return 0;
    if (A === 0) return 2.5; // Máxima entropía finita si no hay coincidencias de orden superior

    const sampEn = -Math.log(A / B);
    return Math.max(0, Math.min(3.5, sampEn));
  }
}
