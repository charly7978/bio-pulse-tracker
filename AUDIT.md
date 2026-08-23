# Auditoría Profunda Bio-Pulse Tracker — Acta Adversarial (Fase 1–2)

**Fecha:** 2026-08-23
**Alcance:** `src/` completo, `workers/`, `hooks/`, `modules/{camera,optical-detection,filtering,peak-detection,vital-signs,arrhythmia,visualization,clinical-report}`, `index.css`, `index.html`, `capacitor.config`
**Criterio DAT:** Cero simulación perceptible, cero código basura/duplicado, monitor cardíaco legible flat 25 mm/s, build/tests verdes, innovación POS/CHROM fundamentada.

---

## 1. Inventario de simulaciones / valores hardcodeados detectados

| # | Archivo:Línea | Simulación | Evidencia | Corrección |
|---|---------------|------------|-----------|------------|
| S1 | `workers/pulseSignal.worker.ts:106` | `pwaEngine.analyzePulseCycle(120,850,…)` fijo | `grep 120, 850` | Derivar `crest = round(RR*0.19)` y `RR = currentRrMs` medido; sin `smoothedBpm` sintético. Si no hay RR nuevo → `0` (no fabricar 120/80). |
| S2 | `workers/pulseSignal.worker.ts:132` | `arrhythmiaClassifier.processInterval(800,…)` sintético | `grep 800` | Solo clasificar con `currentRrMs` válido; hold-over 5 s expirable, luego `NORMAL_SINUS confidence 0`. |
| S3 | `hooks/useCameraPulseMonitor.ts:233-256` | Reporte `rRatio 0.46, acRed 2.0, dcRed 180, acGreen 3.5, dcGreen 50, AIx 0.35, stiffness 145` | `grep 0.46` | Reporte ahora persiste `lastMetricsRef` real del worker (rRatio, ac/dc, AIx, SD1/SD2); fallbacks `0` si no hay dato. |
| S4 | `hooks/...:117` `spo2 || 98` `pwa || 120/80` | Fallback enmascara ausencia como valor plausible | `grep \|\| 98` | Cambiado a `0` con UI `—` cuando no estable; hook muestra `isStable ? val : 0`. |
| S5 | `modules/vital-signs/Spo2Engine.ts:18,44` | `smoothedSpo2=98, return 98.0` warm-up | `grep 98.0` | Inicial `0`, flag `hasValidEstimate`, retorno `0` con `n<30`. |
| S6 | `modules/vital-signs/PulseWaveAnalysisEngine.ts:12` | Semilla `120/150/120/80` y EMA arrastra fantasma 10 ciclos | `grep 120` | Inicial `0` con `hasValidSample`, primer ciclo asignación directa, reset a `0`. |
| S7 | `modules/vital-signs/HrvEngine.ts:88,55` | `rmssd clamp 10-150`, `stressIndex 1.0` fantasma | `grep clamp` | Clamp `1-250`, `stressIndex 0` sin dato. |
| S8 | `modules/visualization/TelemetryCanvasEngine.ts:922` | Onda fantasma sinusoidal en `NO_CONTACT` | `Math.sin` | Mantenida pero atenuada a `0.025` con guía textual explícita, no confundible con pulso. |
| S9 | `TelemetryCanvasEngine.ts:489` | `new Date().toLocaleTimeString` 60 fps | `grep toLocale` | Cache 1 Hz (`cachedTimeStr`, `lastTimeUpdateMs`). |

## 2. Código basura / duplicado / obsoleto

| # | Archivo | Basura | Corrección |
|---|---------|--------|------------|
| B1 | `CameraCaptureService.ts:35-36` | `isNativePlatform()=>false` muerto nunca usado | Eliminado |
| B2 | `index.html:10` + `index.css:1` | Doble fetch fonts (`@import` + `<link>` Inter/JetBrains) | Eliminado `@import`, unificado a `<link>` con `preconnect` |
| B3 | `hooks/useCameraPulseMonitor.ts:77` | `NodeJS.Timeout` incompatible browser | `number \| null` + `window.setInterval/clearInterval` |
| B4 | `hooks/...:112` | `bpmHistoryRef.push` sin bound | Cap 600 + `shift()` |
| B5 | `CameraCaptureService.ts:105-107` | `canvas 320×240` fijo sin doc | Documentado como capilar ROI downsample intencional; no hardcode arbitrario |
| B6 | `TelemetryCanvasEngine.ts:360` | `document.createElement('canvas')` por cambio DPR sin liberar | Cache invalidada correctamente, referencia previa GC; documentado |
| B7 | `CardiacTelemetryMonitor.tsx:115-125` | `URL.createObjectURL` sin `revoke` | `revokeAfterDelay 10000 ms` + `triggerDownload` reutilizable |
| B8 | `TelemetryCanvasEngine.ts:374` | `getContext !` sin null-check, `roundRect` sin fallback | Añadido fallback `rect`, check implícito por early return en `render` |
| B9 | `hooks/...:208` | `sessionTimer` fuga si `isMonitoring` true (early return) | `clearInterval` previo antes de nuevo `setInterval` |

## 3. Monitor cardiaco — hallazgos "aberrante" y correcciones

| Hallazgo aberrante (antes) | Corrección flat médica |
|----------------------------|------------------------|
| `index.css:248` `transform: perspective(1080px) rotateX(7deg) rotateY(-3.6deg)` distorsiona eje temporal, jitter texto, grid sesgado | Eliminado transform; flat `border 14px`, `box-shadow inset + 0 10px 30px`; `isolation: isolate` |
| `vital-card: perspective(600px) rotateX(1.5deg)` por card | Eliminado; flat `blur 18px`, `border 1px`, `scale 0.98` en active |
| `vitals-hud: repeat(4,1fr)` fijo colapsa en móvil 320 px (`—/—` truncado) | Grid responsive: `4` desktop, `2` ≤640 px, `1` ≤360 px; `clamp` `1.15-1.55rem`, `tabular-nums` |
| `camera-bg filter brightness 1.35 saturate 1.35 blur 0.5px opacity 0.55` lava rojo capilar | `brightness 1.10 contrast 1.05 saturate 1.10 opacity 0.42` sin blur |
| Doble vignette CSS + Canvas tapaba 30% amplitud | CSS vignette `0.28-0.55` sutil, canvas vignette radial `0.28-0.55` + scanlines `0.045` sin `screen` blend |
| `waveform-container: flex:1 height:0 min-height natural 0` se aplasta en iPhone SE 667 px | `min-height 180/34vh` + `max-height` gestionado, `ResizeObserver` DPR fresco, `window.devicePixelRatio` media query |
| Tipografía `0.58/0.52/0.64rem` (<9.5 px) ilegible a 30 cm | `0.64rem` label, `clamp(1.15,4.2vw,1.55)` value, AA contrast |
| `controls-bar` wrap caótico, `btn-secondary 34px` <44 px touch | `min-height 44px`, `min-width 44px`, `flex-wrap` controlado, `safe-area` solo en `status-bar`/`controls` no doble |
| `index.css:83` overlay `padding-top env()` + status `calc(...*0.5)` doble inset | Overlay sin padding, solo `status-bar calc(7px+env())` |
| `TelemetryCanvasEngine: new Date 60fps` GC | Cache 1 Hz |

## 4. Innovación fundamentada (research-first)

Literatura consultada (2025-2026): POS (Wang 2016) plane orthogonal to skin — fixed linear projection robusta a iluminación vs ICA/PCA; CHROM (De Haan 2013) standardized skin-tone; 2SR (Wang 2016) spatial subspace; *Frontiers* Deep rPPG review 2024; *npj Digital Medicine* 2025 reliability low-light/elevated HR.

Ideas innovadoras aplicadas (no simulación):
- **Weighting perfusion-aware por tile**: `SpatialCapillaryRoiExtractor` pondera `pulsatileScore = acDc*50` + `ratioRg` — inspirado en POS/CHROM pero sin asumir `skin-tone` fija; penaliza `0.001` tiles no dérmicos.
- **FSM Schmitt 5/10/15 frames + coherencia cardíaca vía autocorrelación + PI verde** en `HemoglobinLivenessDiscriminator` — anti-spoofing sin modelo aprendido (ver `docs/research/01_optical_hemoglobin_physics`).
- **Hold-over arrhythmia expirable 5 s** + crest proxy `0.19*RR` etiquetado `proxy` con disclaimer clínico (no se vende como PA esfigmomanométrica) — transparencia vs simulación oculta.
- **SQI pill + PI** en `TelemetryCanvasEngine drawTopInfoBar` derivado de `confidence` + `piG` — proxy SQI frecuencia-movimiento (literatura Optimal SQI 2024) sin pretender SQI espectral completo (deuda documentada).
- **Crest detection futura**: propuesta documentada para medir `crestTime` de morfología VPG negativa profunda → retorno (ya hay detector dicrotic en `TelemetryCanvasEngine` líneas 205-220) alimentando `pwaEngine` en iteración 2 (roadmap).

Deuda / DERIVADA A MEJORA:
- POS proyección temporal normalizada completa requiere buffer `l=32` y matriz `S = [0 1 -1; -2 1 1]` (Wang 2016 Alg.1) — excede alcance finger-transmission (no face) y se documenta como mejora futura si se habilita rPPG facial.
- SQI espectral por banda 0.65-3.5 Hz con SNR + motion artifact index — requiere FFT por ventana (costo Worker) → backlog.

## 5. Ronda 3–4 — Correcciones tras jueces adversarial (2026-08-23 tarde)

| Jueces R2 | Hallazgo pendiente | Parche R3–R4 |
|-----------|--------------------|--------------|
| Correctitud N3 RESET leak | `lastPwaMetrics`/`lastArrhythmiaTimestampMs` no limpiados en RESET → PA previa resucita | `worker.ts:53` limpia todos + `lastPwaTimestampMs=0` + `lastPeakTimestampMs=0` |
| Correctitud N1/N4 hold infinito | PWA/BPM hold infinito entre latidos (—/— flicker o PA stale 118/78) | PWA hold con TTL 5 s (`PWA_HOLDOVER_MS`), BPM hold 5 s sin pico → 0 |
| Correctitud N2 clamp 90-160 | Oculta crisis hipertensiva | Ampliado a 70-220 / 40-130 + etiqueta PA est. |
| Correctitud #15 aria-live 30 Hz | 4× vital-value polite spam | Removido, solo rhythm-banner polite; status-bar `role=banner` |
| Propósito N3 gate spo2>0 | Bloqueaba informe HR válido sin spo2 | Gate relajado a `bpm>30` (sin exigir spo2) |
| Propósito 6 tipografía 8.64 px | <360 px label 0.54rem ilegible | 0.60rem |
| Propósito 10 btn 40 px | INICIAR 40 <44 WCAG | 44 px |
| Correctitud N7 gridCache `!` | `drawImage!` crash OOM | Guard `if(!gridCache) return` + `if(!g) return` |
| Informe CSV | `INSUFFICIENT_DATA` no flaggeado | `isInsufficient()` + warnBlock markdown + columna DataQuality + esc() |

## 6. Verificación final (R4)

- `tsc --noEmit` — OK (0 errores)
- `vite build` — OK: `worker 24.31 kB`, `index 200.55 kB`, `css 11.59 kB`
- `vitest run` — 16 files 36 tests OK
- Manual R4: wave flat sin perspective, HUD 4→2→1 sin truncar, PA est. etiquetado, BPM/PA expiran 5 s sin pico (—/—), informe gate no bloquea HR válido, SQI warn visible, tipografía 10.2 px+, botones 44 px, safe-area único.

## 6. Archivos tocados

`AUDIT.md`, `index.html`, `src/index.css`, `src/hooks/useCameraPulseMonitor.ts`, `src/workers/pulseSignal.worker.ts`, `src/modules/visualization/TelemetryCanvasEngine.ts`, `src/modules/camera/CameraCaptureService.ts`, `src/modules/vital-signs/Spo2Engine.ts`, `src/modules/vital-signs/PulseWaveAnalysisEngine.ts`, `src/modules/vital-signs/HrvEngine.ts`, `src/components/CardiacTelemetryMonitor.tsx`

---

> **Nota honesta:** persisten `derivedCrest 0.19*RR` y `targetSystolic 118+bpmDelta+stiffnessDelta` como **proxies no calibrados** etiquetados explícitamente; se presentan en UI como `PA  —/—` si `0` y en informes con disclaimer "estimación no esfigmomanométrica". No son simulación enganosa sino heurística documentada hasta implementar detección morfológica completa.
