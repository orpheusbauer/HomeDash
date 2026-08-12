import { describe, expect, it } from 'vitest';
import {
  ingestSensorSchema,
  saveLayoutSchema,
  tabletTelemetrySchema,
  widgetManifestSchema,
} from './index.js';

describe('contrats HomeDash', () => {
  it('valide un manifeste de widget complet', () => {
    const result = widgetManifestSchema.parse({
      id: 'example.widget',
      name: 'Exemple',
      description: 'Widget de test',
      category: 'Test',
      icon: 'Box',
      size: { default: { w: 3, h: 2 }, min: { w: 2, h: 2 } },
      capabilities: [],
      configSchema: {},
      refreshSeconds: 1,
      version: '1.0.0',
    });
    expect(result.id).toBe('example.widget');
  });

  it('refuse une disposition hors de la grille', () => {
    expect(() =>
      saveLayoutSchema.parse({
        expectedRevision: 0,
        items: [{ id: crypto.randomUUID(), x: 11, y: 0, w: 2, h: 2 }],
      }),
    ).toThrow();
  });

  it('normalise une mesure HTTP valide', () => {
    expect(
      ingestSensorSchema.parse({
        id: 'salon',
        type: 'temperature',
        location: 'indoor',
        value: 21.5,
        unit: '°C',
      }).value,
    ).toBe(21.5);
  });

  it('borne la batterie d’une tablette', () => {
    expect(() => tabletTelemetrySchema.parse({ batteryPercent: 101 })).toThrow();
  });
});
