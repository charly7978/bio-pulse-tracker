# Análisis Comparativo: Android Camera2 API vs Web MediaStreamTrack API en Fotopletismografía Óptica (PPG)

## 1. Introducción
Para medir señales biomédicas a través del sensor óptico de un smartphone (rPPG y PPG por contacto), la estabilidad del pipeline de adquisición de imagen es tan crítica como el algoritmo matemático de filtrado digital.

---

## 2. Comparativa Técnica de Capacidades

| Característica de Hardware | Web MediaStreamTrack API (Navegador) | Android Camera2 API (Nativo / Kotlin / NDK) | Impacto en la Señal Biomédica |
| :--- | :--- | :--- | :--- |
| **Control 3A (AE / AWB / AF)** | Parcial / Avanzado (vía `applyConstraints` y `ImageCapture` en Chrome Android) | **Total y Estricto** (`CONTROL_AE_MODE_OFF`, `CONTROL_AWB_MODE_OFF`, `CONTROL_AF_MODE_OFF`) | **Crítico**: Si el auto-exposición o balance de blancos fluctúa, genera falsos pulsos AC que corrompen el cálculo de SpO2 y HRV. |
| **Control de Exposición (Sensor Exposure Time)** | Vía `exposureCompensation` o manual si el driver lo expone | **Nanosegundos Exactos** (`SENSOR_EXPOSURE_TIME`) | Permite fijar el tiempo de integración para evitar saturación del fotodiodo con el flash. |
| **Ganancia / Sensibilidad (ISO)** | Generalmente implícito en la exposición | **Directo** (`SENSOR_SENSITIVITY` 100/200 ISO) | Minimiza el ruido térmico del sensor de silicio. |
| **Tasa de Refresco (FPS)** | 30 FPS estándar, 60 FPS en dispositivos de gama media/alta | **60 FPS / 120 FPS / 240 FPS** (High Speed Capture Session) | Mayor resolución temporal para intervalos RR (< 1 ms). |
| **Precisión de Estampa Temporal** | `requestVideoFrameCallback` (~0.5 ms jitter) | **Timestamp de Hardware en Nanosegundos** (`CaptureResult.SENSOR_TIMESTAMP`) | Cero jitter de reloj; ideal para análisis espectral HRV (LF/HF). |
| **Formato de Píxel** | RGBA / ImageData (vía Canvas 2D) | **YUV_420_888** o **RAW Bayer** directo de memoria | Cero sobrecarga de conversión de color; acceso directo al canal de luminancia (Y) y crominancia. |
| **Portabilidad y Despliegue** | **Universal e Inmediato** (Cualquier navegador móvil sin instalar APK) | **Requiere APK Nativo** (Android Studio / Capacitor) | La Web permite acceso instantáneo multiplataforma. |

---

## 3. ¿Cómo logramos la Máxima Precisión en Nuestra Arquitectura?

En `bio-pulse-tracker`, implementamos una estrategia de **2 niveles**:

### Nivel 1: Web Engine de Grado Médico (Activo Actualmente)
1. Consulta de capacidades profundas del hardware mediante `MediaStreamTrack.getCapabilities()`.
2. Bloqueo 3A forzado (`exposureMode: 'manual'`, `whiteBalanceMode: 'manual'`, `focusMode: 'manual'`).
3. Sincronización exacta con el barrido del sensor mediante `requestVideoFrameCallback`.
4. Procesamiento en **Web Worker aislado** (`pulseSignal.worker.ts`) para evitar que el hilo de la UI genere pérdidas de fotogramas.

### Nivel 2: Puente Nativo Android Camera2 (Para compilación APK / Capacitor)
Si decides exportar la aplicación como un APK nativo para Android:
- Se conecta un plugin nativo en Kotlin que instancia `android.hardware.camera2.CameraManager`.
- Configura `CaptureRequest.CONTROL_AE_MODE_OFF` y `CaptureRequest.FLASH_MODE_TORCH`.
- Envía los buffers `YUV_420_888` directamente al motor C++ / WebAssembly o puente JavaScript.
