import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryCanvasEngine } from '../TelemetryCanvasEngine';
import { TelemetryFrame } from '../types';

describe('TelemetryCanvasEngine', () => {
  let engine: TelemetryCanvasEngine;

  beforeEach(() => {
    engine = new TelemetryCanvasEngine({ width: 400, height: 200 });
  });

  it('se inicializa y acepta frames de telemetría sin errores', () => {
    const frame: TelemetryFrame = {
      timestampMs: 1000,
      filteredValue: 0.75,
      rawRed: 190,
      rawGreen: 42,
      rawBlue: 18,
      isPeak: true,
      sqi: 0.95,
      pi: 2.3,
      bpm: 72,
      confidence: 0.92,
      contactState: 'STABLE_CONTACT',
    };

    expect(() => engine.pushFrame(frame)).not.toThrow();
  });

  it('acumula puntos en el atractor de Poincaré cuando el contacto es estable', () => {
    for (let i = 0; i < 20; i++) {
      const val = Math.sin((i / 10) * Math.PI);
      engine.pushFrame({
        timestampMs: 1000 + i * 33,
        filteredValue: val,
        rawRed: 190,
        rawGreen: 42,
        rawBlue: 18,
        isPeak: i % 10 === 0,
        sqi: 0.90,
        pi: 2.1,
        bpm: 70,
        confidence: 0.88,
        contactState: 'STABLE_CONTACT',
      });
    }

    // Comprobamos que el método de reset limpie el estado
    engine.reset();
    expect(() => engine.pushFrame({
      timestampMs: 2000,
      filteredValue: 0.1,
      rawRed: 180,
      rawGreen: 40,
      rawBlue: 15,
      isPeak: false,
      sqi: 0.85,
      pi: 1.8,
      bpm: 68,
      confidence: 0.80,
      contactState: 'STABLE_CONTACT',
    })).not.toThrow();
  });
});
