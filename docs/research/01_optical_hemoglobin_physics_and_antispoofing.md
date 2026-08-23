# Fundamentación Óptica: Absorción de Hemoglobina y Detección de Sangre Humana

## 1. Física de la Absorción Óptica en Tejido Vivo (Ley de Beer-Lambert Modificada)

La espectroscopía de fotopletismografía (PPG) por cámara de smartphone se fundamenta en la interacción de la luz con los componentes del tejido cutáneo y la vasculatura microcapilar:

$$I(\lambda, t) = I_0(\lambda) \cdot \exp\left( - \left[ \mu_a^{\text{static}}(\lambda) \cdot d_{\text{eff}} + \Delta C_{\text{HbO}_2}(t)\cdot \epsilon_{\text{HbO}_2}(\lambda)\cdot L + \Delta C_{\text{HHb}}(t)\cdot \epsilon_{\text{HHb}}(\lambda)\cdot L \right] \right)$$

Donde:
- $I_0(\lambda)$: Intensidad lumínica incidente del flash LED del dispositivo.
- $\epsilon_{\text{HbO}_2}(\lambda)$ y $\epsilon_{\text{HHb}}(\lambda)$: Coeficientes de extinción molar de la oxihemoglobina y desoxihemoglobina.
- $\Delta C(t)$: Variación pulsátil de la concentración de hemoglobina volumétrica durante el ciclo cardíaco (sístole / diástole).
- $L$: Longitud de trayectoria óptica diferencial (*differential pathlength factor*).

---

## 2. Firma Espectral Multicanal (RGB)

Los tres canales del sensor CMOS de la cámara responden a diferentes bandas del espectro visible:

1. **Canal Verde ($\lambda \approx 520 - 560\text{ nm}$)**:
   - Coincide con los picos máximos de absorción de la hemoglobina ($\alpha$ y $\beta$ bands a 542 nm y 577 nm).
   - Mayor modulación AC inducida por pulso capilar arterial superficial.
   - Señal primaria de frecuencia cardíaca e intervalos RR.

2. **Canal Rojo ($\lambda \approx 620 - 700\text{ nm}$)**:
   - Menor absorción por hemoglobina, máxima penetración tisular profunda y alta dispersión óptica (*scattering*).
   - Sirve como portadora DC de alta potencia y referencia de saturación de oxígeno (SpO₂).

3. **Canal Azul ($\lambda \approx 440 - 490\text{ nm}$)**:
   - Absorción extrema en superficie cutánea; penetración mínima a los lechos capilares pulsátiles.
   - Actúa como **referencia pura de ruido de superficie y movimiento mecánico**, permitiendo su cancelación adaptativa mediante filtros LMS (Least Mean Squares).

---

## 3. Discriminación Inconfundible vs. Objetos Inertes (Anti-Spoofing Biológico)

Un objeto inerte (manteles, piel sintética, plástico, superficies estáticas o con vibración mecánica) puede presentar oscilaciones lumínicas por modulación de exposición o temblor, pero **carece de la firma hemodinámica biofísica**.

Para garantizar que la señal provenga **exclusivamente de sangre humana viva**, el sistema implementa tres barreras simultáneas:

### Barrera A: Razón Cromática Hemoglobínica Diferencial (de Haan & Wang, IEEE TBME)
Las diferencias normalizadas de color:
$$S_1 = R_n - G_n$$
$$S_2 = R_n - B_n$$
Eliminan en su totalidad las variaciones de intensidad en modo común (*common-mode illumination changes*). En tejido con sangre humana, $S_1$ y $S_2$ exhiben modulación en contrafase y coherencia espectral en la banda cardíaca $[0.5\text{ Hz}, 4.0\text{ Hz}]$ ($30 - 240\text{ BPM}$). En objetos inertes o plástico, la SNR cromática colapsa a $\approx 0$.

### Barrera B: Homogeneidad y Varianza Espacial de Flujo Capilar
El tejido biológico sobre el sensor genera un gradiente de dispersión subdérmica característico:
- Coeficiente de variación espacial del canal rojo $\text{CV}_R = \frac{\sigma_R}{\mu_R} \in [0.03, 0.28]$.
- Cobertura espacial del sensor $\ge 70\%$.
- Niveles medios de rojo $\mu_R \in [45, 252]$ (sin corte por subexposición ni saturación total).

### Barrera C: Atractor de Recurrencia de Retardo (SPAR, Pettit & Charlton 2024)
En un espacio de estados 2D $(s[n], s[n-\tau])$ con $\tau \approx \frac{P}{4}$, la trayectoria de una onda de pulso humana recorre un ciclo límite continuo y recurrente. El error relativo de reconstrucción a un período completo debe satisfacer:
$$\text{Attractor Regularity} = 1 - \frac{\sum \| \vec{x}[j+P] - \vec{x}[j] \|^2}{\sum \| \vec{x}[j] \|^2} \ge 0.32$$

---

## 4. Referencias Científicas Clave
1. **Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017)**. *Algorithmic Principles of Remote PPG*. IEEE Transactions on Biomedical Engineering, 64(7), 1479-1491.
2. **Elgendi, M. (2012)**. *On the Analysis of Fingertip Photoplethysmogram Signals*. Current Cardiology Reviews, 8(1), 14-25.
3. **Orphanidou, C., et al. (2015)**. *Signal Quality Indices for the Electrocardiogram and Photoplethysmogram: Derivation and Applications to Mobile Health*. IEEE Journal of Biomedical and Health Informatics, 19(3), 832-838.
4. **Pettit, T. & Charlton, P. (2024)**. *Signal Periodicity Attractor Regularity (SPAR) for Robust Wearable Photoplethysmography*. Physiological Measurement.
5. **Chatterjee, S. & Budidha, K. (2018)**. *A robust smartphone-based photoplethysmography system for pulse rate and perfusion monitoring*. Sensors, 18(6), 1845.
