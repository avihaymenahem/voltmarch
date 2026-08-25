/**
 * ============================================================================
 * tests/cameos-coverage.spec.ts — every buildable resolves to a cameo model
 * ============================================================================
 * THIS FILE IS CITED THREE TIMES BY `src/ui/Cameos.ts` AND DID NOT EXIST.
 *
 * `Cameos.ts:46`, `:280` and `:427` each name `tests/cameos-coverage.spec.ts`
 * as the thing that stops `CAMEO_UNIT_MODELS` / `CAMEO_BUILDING_MODELS` rotting
 * as content is added. It was never written. The tables have been unguarded for
 * their whole life, which was survivable only because nothing in `src/` imported
 * them — the sidebar drew flat glyphs and the whole 3D cameo path was dead code.
 *
 * That changed: the build slots now render the real model. The tables are
 * load-bearing, so the guard the file has been promising has to exist.
 *
 * WHAT A MISS ACTUALLY COSTS, and why this is a warning rather than a crash:
 * an unresolved key falls through to the painted 2D silhouette, so the sidebar
 * stays usable. But it means one cell in a row of models is a flat drawing, and
 * that reads as a bug to a player. Worth a failing test; not worth a throw.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Faction } from '../src/core/types';
import { BUILDINGS, UNITS } from '../src/data/Defs';
import {
  CAMEO_BUILDING_MODELS, CAMEO_UNIT_MODELS, cameoModelKey,
} from '../src/ui/Cameos';

/** The four playable armies. Neutral owns no buildable content. */
const ARMIES: readonly Faction[] = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
];

describe('every buildable def has a cameo model binding', () => {
  it('covers every UNIT key', () => {
    const missing = UNITS
      .map((u) => u.key)
      .filter((key) => CAMEO_UNIT_MODELS[key] === undefined);
    expect(
      missing,
      `${missing.length} unit def(s) have no CAMEO_UNIT_MODELS entry and will draw `
      + 'the flat silhouette instead of their model',
    ).toEqual([]);
  });

  it('covers every BUILDING key', () => {
    const missing = BUILDINGS
      .map((b) => b.key)
      .filter((key) => CAMEO_BUILDING_MODELS[key] === undefined);
    expect(
      missing,
      `${missing.length} building def(s) have no CAMEO_BUILDING_MODELS entry`,
    ).toEqual([]);
  });

  it('resolves a concrete model key for the army that owns each def', () => {
    // A binding can exist and still resolve to null — the per-faction variants
    // are keyed by army, and a def owned by Meridian whose binding only lists
    // Allies/Soviets resolves to nothing at the moment it is actually drawn.
    const unresolved: string[] = [];
    for (const u of UNITS) {
      if (CAMEO_UNIT_MODELS[u.key] === undefined) continue;
      const owner = u.faction as Faction;
      const armies = owner === Faction.Neutral ? ARMIES : [owner];
      for (const f of armies) {
        if (cameoModelKey(u.key, f, false) === null) unresolved.push(`${u.key}@${f}`);
      }
    }
    for (const b of BUILDINGS) {
      if (CAMEO_BUILDING_MODELS[b.key] === undefined) continue;
      const owner = b.faction as Faction;
      const armies = owner === Faction.Neutral ? ARMIES : [owner];
      for (const f of armies) {
        if (cameoModelKey(b.key, f, true) === null) unresolved.push(`${b.key}@${f}`);
      }
    }
    expect(
      unresolved,
      'these defs have a binding that yields no model for the army that owns them',
    ).toEqual([]);
  });

  it('binds no key that is not a real def — the tables must not accrete ghosts', () => {
    // The inverse rot: content is renamed or removed and its cameo entry stays.
    // Harmless at runtime, but it is how a table stops describing the game.
    // The 'gate' allowance that stood here is GONE, because the gate def landed
    // in the same pass. That was the whole point of naming it rather than
    // filtering it out quietly — an allowance you can see is one you can delete.
    const unitKeys = new Set(UNITS.map((u) => u.key));
    const buildingKeys = new Set(BUILDINGS.map((b) => b.key));
    const strayUnits = Object.keys(CAMEO_UNIT_MODELS).filter((k) => !unitKeys.has(k));
    const strayBuildings = Object.keys(CAMEO_BUILDING_MODELS)
      .filter((k) => !buildingKeys.has(k));
    expect(strayUnits, 'CAMEO_UNIT_MODELS names units that no longer exist').toEqual([]);
    expect(
      strayBuildings, 'CAMEO_BUILDING_MODELS names buildings that no longer exist',
    ).toEqual([]);
  });
});
