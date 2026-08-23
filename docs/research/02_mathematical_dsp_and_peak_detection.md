# Fundamentación Matemática: Procesamiento Digital de Señales (DSP) y Detección de Picos Sistólicos

## 1. Filtrado Digital Libre de Distorsión de Fase

La señal volumétrica de pulso capilar arterial $x[n]$ extraída de los fotogramas de la cámara contiene componentes en distintas bandas:
- Componente DC de alta energía (tejido estacionario, hueso, tono dérmico): $0\text{ Hz}$.
- Modulación respiratoria y deriva de línea base: $0.1 - 0.4\text{ Hz}$.
- Modulación cardíaca pulsátil (primer y segundo armónico): $0.5 - 4.0\text{ Hz}$ ($30 - 240\text{ BPM}$).
- Ruido de alta frecuencia y cuantización del sensor CMOS: $> 5.0\text{ Hz}$.

### Filtro Pasabanda Butterworth de 4° Orden
Función de transferencia en el dominio Z (mediante transformación bilineal con pre-warping de frecuencia):
$$H(z) = \frac{\sum_{k=0}^4 b_k z^{-k}}{1 + \sum_{k=1}^4 a_k z^{-k}}$$
- Frecuencia de corte inferior $f_L = 0.5\text{ Hz}$.
- Frecuencia de corte superior $f_H = 4.0\text{ Hz}$.
- Compensación de retardo de grupo $\tau_g(f)$ para preservar la alineación temporal de los picos sistólicos.

---

## 2. Cancelación Adaptativa de Ruido de Movimiento (NLMS)

Se utiliza el canal Azul $b[n]$ como entrada de referencia de ruido no correlacionada con la pulsación arterial profunda:
$$y[n] = \mathbf{w}^T[n] \mathbf{x}_{\text{ref}}[n]$$
$$e[n] = d[n] - y[n]$$
$$\mathbf{w}[n+1] = \mathbf{w}[n] + \frac{\mu}{\|\mathbf{x}_{\text{ref}}[n]\|^2 + \epsilon} e[n] \mathbf{x}_{\text{ref}}[n]$$
Donde:
- $d[n]$: Señal pulsátil del canal verde/rojo.
- $e[n]$: Señal de pulso purificada resultante.

---

## 3. Algoritmo de Detección de Picos por Doble Ventana Móvil (Elgendi et al.)

Para detectar picos sistólicos robustos ante variaciones dinámicas de amplitud sin usar umbrales estáticos:

1. **Transformación no lineal de realce**:
   $$s[n] = \max(0, e[n])^2$$

2. **Ventana de Pico Sistólico ($W_1 \approx 110\text{ ms}$)**:
   $$\text{MA}_{\text{peak}}[n] = \frac{1}{K_1} \sum_{k=-K_1/2}^{K_1/2} s[n+k]$$

3. **Ventana de Latido Cardíaco ($W_2 \approx 667\text{ ms}$)**:
   $$\text{MA}_{\text{beat}}[n] = \frac{1}{K_2} \sum_{k=-K_2/2}^{K_2/2} s[n+k]$$

4. **Umbral Adaptativo de Decisión**:
   $$\text{Threshold}[n] = \text{MA}_{\text{beat}}[n] + \beta \cdot \overline{s}$$
   Se genera un bloque de interés cuando $\text{MA}_{\text{peak}}[n] > \text{Threshold}[n]$ durante un tiempo $\ge W_1$.

---

## 4. Refinamiento Sub-Muestra Savitzky-Golay (Ajuste Parabólico)

Para superar la limitación de resolución temporal impuesta por la tasa de muestreo de la cámara ($30\text{ FPS} \rightarrow 33.3\text{ ms}$ por muestra):

En el índice del máximo local $k$, se evalúa un polinomio de segundo orden sobre 5 puntos centrados $[-2, -1, 0, +1, +2]$:
$$y(t) = c_0 + c_1 t + c_2 t^2$$
Las derivadas primera y segunda se obtienen mediante convolución de coeficientes discretos de Savitzky-Golay:
$$d_1 = \frac{-2 y[-2] - y[-1] + y[+1] + 2 y[+2]}{10}$$
$$d_2 = \frac{2 y[-2] - y[-1] - 2 y[0] - y[+1] + 2 y[+2]}{7}$$

El desplazamiento continuo del vértice $\delta$ es:
$$\delta = -\frac{d_1}{d_2}, \quad \delta \in [-0.5, +0.5]$$
$$\text{Timestamp Exacto} = t[k] + \delta \cdot \Delta t$$
Esto reduce el error de estimación del intervalo RR a $< 2\text{ ms}$, permitiendo un cálculo de variabilidad de frecuencia cardíaca (HRV) de grado clínico.
