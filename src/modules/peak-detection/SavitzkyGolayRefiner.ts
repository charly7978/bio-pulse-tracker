/**
 * SavitzkyGolayRefiner
 *
 * Ajuste polinomial cuadrático de 5 puntos centrado en el máximo local discreto.
 * Permite resolución temporal sub-muestra (< 2 ms) para el cálculo de intervalos RR
 * y métricas de variabilidad de frecuencia cardíaca (HRV) de grado clínico.
 */

export interface SubSamplePeakResult {
  delta: number; // Desplazamiento continuo respecto al índice entero [-0.5, 0.5]
  refinedAmplitude: number;
  curvature: number; // Segunda derivada (debe ser negativa para un pico máximo)
  isValidVertex: boolean;
}

export class SavitzkyGolayRefiner {
  /**
   * Refina el vértice de un pico a partir de 5 muestras consecutivas centradas en el índice 2:
   * [y[-2], y[-1], y[0], y[+1], y[+2]]
   */
  public static refineVertex5(
    ym2: number,
    ym1: number,
    y0: number,
    yp1: number,
    yp2: number
  ): SubSamplePeakResult {
    // 1. Convolución con coeficientes de primera derivada Savitzky-Golay (orden 2, ventana 5)
    // Coeficientes: [-2, -1, 0, 1, 2] / 10
    const d1 = (-2 * ym2 - ym1 + yp1 + 2 * yp2) / 10.0;

    // 2. Convolución con coeficientes de segunda derivada Savitzky-Golay (orden 2, ventana 5)
    // Coeficientes: [2, -1, -2, -1, 2] / 7 (segunda derivada = 2 * c2)
    const d2 = (2 * ym2 - ym1 - 2 * y0 - yp1 + 2 * yp2) / 7.0;

    // Para que sea un pico máximo, la curvatura debe ser cóncava hacia abajo (d2 < 0)
    if (d2 >= -1e-6) {
      return {
        delta: 0,
        refinedAmplitude: y0,
        curvature: d2,
        isValidVertex: false,
      };
    }

    // 3. Vértice analítico: delta = - d1 / d2
    let delta = -d1 / d2;
    delta = Math.max(-0.5, Math.min(0.5, delta));

    // 4. Altura en el vértice ajustado: y(delta) = y0 + d1 * delta + 0.5 * d2 * delta^2
    const refinedAmplitude = y0 + d1 * delta + 0.5 * d2 * delta * delta;

    return {
      delta,
      refinedAmplitude,
      curvature: d2,
      isValidVertex: true,
    };
  }
}
