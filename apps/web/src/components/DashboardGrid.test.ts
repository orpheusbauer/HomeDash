import { describe, expect, it } from 'vitest';
import { normalizeResponsiveLayout } from './DashboardGrid';

describe('grille responsive', () => {
  it('enregistre la disposition portrait dans les 48 colonnes de référence', () => {
    expect(normalizeResponsiveLayout({ x: 4, w: 12 }, 24)).toEqual({ x: 8, w: 24 });
  });

  it('enregistre un widget mobile pleine largeur sans sortir de la grille', () => {
    expect(normalizeResponsiveLayout({ x: 0, w: 1 }, 1)).toEqual({ x: 0, w: 48 });
    expect(normalizeResponsiveLayout({ x: 23, w: 2 }, 24)).toEqual({ x: 46, w: 2 });
  });
});
