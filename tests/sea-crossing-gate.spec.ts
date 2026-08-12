/**
 * ============================================================================
 * tests/sea-crossing-gate.spec.ts — THE ROAD IS NOT A REWARD
 * ============================================================================
 * WHAT SHIPPED, AND WHY NOTHING CAUGHT IT
 * ---------------------------------------
 * v2.5.0 added `Sunder Atoll` — four islands, 54% water, one army per island —
 * deliberately with NO map unlock, so a fresh profile could select it. On a
 * fresh profile it was not merely diminished. It was a PERMANENT STALEMATE:
 *
 *   - `UNLOCK_TAGS` gates all four docks behind `struct.naval`.
 *   - `struct.naval` is paid by ONE mission: "Theatre Command — win 10
 *     skirmishes".
 *   - Every lift is gated on a dock (`transport` -> `navalYard`,
 *     `rclScow` -> `rclDrydock`).
 *   - `UnlockGate.mirrorAI` resolves the AI against the HUMAN's profile, so
 *     every opponent was stranded too.
 *
 * Four armies on four islands, none able to build a hull, and the match could
 * not end. Every existing test was green: `tests/archipelago.spec.ts` measured
 * the geometry, `tests/sunder-atoll.spec.ts` counted 532 legal dock sites,
 * `tests/progression-gate.spec.ts` proved a fresh profile keeps a complete army
 * — and "complete" was derived over CONTENT, with no notion that a battlefield
 * can make one row of the table load-bearing.
 *
 * THE RULE THIS FILE PINS, and it is narrower than "ungate naval":
 *
 *     CONTENT REQUIRED TO REACH THE ENEMY IS NEVER PROGRESSION-GATED.
 *
 * So section 3 is the point of the file. Sections 1 and 2 are the two halves it
 * is built out of, and section 4 is the regression risk: naval on the four land
 * maps — and on the two half-plane SEA maps, which is the subtler case — must
 * still be exactly as locked as it was.
 * ============================================================================
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Faction, Locomotor } from '../src/core/types';
import type { AvailabilityResult, ITerrain, PlayerId } from '../src/core/types';
import { MAP_CELLS, TERRAIN_ISLAND_MIN_CELLS } from '../src/core/config';
import { MAPS } from '../src/shell/settings-store';
import { MAP_SEAS, clearScenario, resolveDefBinding, startPointsFor } from '../src/game/Scenarios';
import { MISSION_UNLOCK_IDS, UNLOCKS } from '../src/data/Missions';
import { LOCKED_REASON, UnlockGate, setUnlockGate } from '../src/progression/UnlockGate';
import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import { invalidateNavalWater, mapSupportsNaval } from '../src/sim/NavalWater';
import {
  invalidateLandRoutes, mapForcesSeaCrossing, mapLandLinked, surveyLandMasses,
} from '../src/sim/LandRoutes';

/* ==========================================================================
 * FIXTURES
 *
 * One real `Terrain` per shipped battlefield, built from the row the lobby
 * actually offers — preset, biome and pinned `mapSeed` together. Same rule as
 * `tests/sunder-atoll.spec.ts`: a capability that is correct and a shipped map
 * that is correct are two different claims, and this file is about the second.
 * ========================================================================== */

const ATOLL = 'sunder-atoll';
/** The two half-plane sea maps. Water, and one land mass. */
const SEA_MAPS = ['contested-strait', 'coral-shore'] as const;
/** The four dry battlefields. */
const LAND_MAPS = ['temperate-valley', 'airbase-flats', 'frozen-sector', 'industrial-grid'] as const;

const terrains = new Map<string, Terrain>();

beforeAll(() => {
  for (const m of MAPS) {
    const sea = MAP_SEAS[m.preset] ?? null;
    terrains.set(m.id, new Terrain({
      scene: new THREE.Scene(),
      seed: m.mapSeed,
      biome: m.biome as never,
      anisotropy: 1,
      starts: startPointsFor(m.players, sea).map((p) => ({ x: p.x, z: p.z })),
      sea,
    }));
  }
}, 300_000);

afterAll(() => {
  setActiveTerrain(null);
  for (const t of terrains.values()) t.dispose();
  terrains.clear();
});

afterEach(() => {
  // The gate is module-level state and so are both memos. A leak here would
  // gate — or ungate — every spec file that runs next.
  setUnlockGate(null);
  setActiveTerrain(null);
  clearScenario();
  invalidateNavalWater();
  invalidateLandRoutes();
});

function terrainFor(id: string): Terrain {
  const t = terrains.get(id);
  if (t === undefined) throw new Error(`no fixture terrain for "${id}"`);
  setActiveTerrain(t);
  invalidateNavalWater();
  invalidateLandRoutes();
  return t;
}

/** A gate that owns exactly `owned` — no arguments means a brand-new profile. */
function gateOwning(...owned: string[]): UnlockGate {
  return new UnlockGate(() => owned, { knownUnlockIds: MISSION_UNLOCK_IDS });
}

async function boundCatalog(): Promise<ProductionCatalog> {
  const catalog = new ProductionCatalog(await resolveDefBinding());
  expect(catalog.bound, 'the def tables must bind or nothing below is testing real content')
    .toBe(true);
  return catalog;
}

/**
 * Player 0 is the human, player 1 the AI, and the world stands on `terrain` —
 * which is the whole point: the exemption is a function of the BATTLEFIELD.
 */
async function makeService(
  terrain: ITerrain, human: Faction, ai: Faction,
): Promise<ProductionService> {
  const world = new World();
  world.addPlayer(human, 'Commander', true, true);
  world.addPlayer(ai, 'Opponent', false, false);
  world.terrain = terrain;
  return new ProductionService(world, new Channels(), await boundCatalog());
}

const SCRATCH: AvailabilityResult = { ok: false, reason: '', capped: false };

/** Why `key` is unavailable to `player`, or '' when it IS available. */
function refusal(service: ProductionService, player: number, key: string): string {
  const entry = service.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const r = service.availabilityOf(player as PlayerId, entry!, SCRATCH);
  return r.ok ? '' : r.reason;
}

/** The dock and the lift each army reaches the water with. */
const MOBILITY: readonly (readonly [Faction, string, string])[] = [
  [Faction.Allies, 'navalYard', 'transport'],
  [Faction.Soviets, 'subPen', 'transport'],
  [Faction.Meridian, 'mrdSlipway', ''],
  [Faction.Reclaim, 'rclDrydock', 'rclScow'],
];

/* ==========================================================================
 * 1. THE MAP ANSWERS THE QUESTION
 * ========================================================================== */

describe('mapForcesSeaCrossing is derived from the ground', () => {
  it('finds one land mass on every shipped battlefield but the atoll', () => {
    /*
     * MEASURED, and reported rather than only asserted — durable land masses
     * (>= TERRAIN_ISLAND_MIN_CELLS, 573) and the largest thing below the floor:
     *
     *   temperate-valley  1 x 12802     airbase-flats    1 x 12692
     *   frozen-sector     1 x 12370     industrial-grid  1 x 12849
     *   contested-strait  1 x  9698     coral-shore      1 x  9942
     *   sunder-atoll      4 x 1819..1874, plus one 31-cell noise basin
     *
     * Two orders of magnitude of margin on each side of the floor, which is why
     * this is counted in land masses and not in raw regions: a bare region
     * count reads that 31-cell basin as a fifth island, and would read any
     * comparable pocket on a land map as an archipelago.
     */
    for (const m of MAPS) {
      const s = surveyLandMasses(terrainFor(m.id));
      const want = m.id === ATOLL ? 4 : 1;
      expect(s.landMasses, `${m.id} land masses (largest ${s.largest} of ${s.ground} cells)`)
        .toBe(want);
      expect(mapLandLinked(terrainFor(m.id)), m.id).toBe(m.id !== ATOLL);
    }
  });

  it('fires only where there is water AND the ground is split', () => {
    // The AND is what makes this compose with the landlocked filter rather than
    // fight it. Three combinations exist and only one of them is a road.
    for (const m of MAPS) {
      const t = terrainFor(m.id);
      const sea = mapSupportsNaval(t);
      expect(sea, `${m.id} has a navigable sea`)
        .toBe(m.id === ATOLL || (SEA_MAPS as readonly string[]).includes(m.id));
      expect(mapForcesSeaCrossing(t), `${m.id} forces a sea crossing`).toBe(m.id === ATOLL);
    }
    // ...and the landlocked maps are refused by the FIRST half, so a future
    // land map that somehow split its ground still hides naval rather than
    // ungating cameos `evaluatePlacement` would refuse anyway.
    for (const id of LAND_MAPS) expect(mapSupportsNaval(terrainFor(id)), id).toBe(false);
  });

  it('is not moved by what is parked on the ground', () => {
    /*
     * `ITerrain.isPassable` is false for an occupied cell, so a naive flood
     * would measure today's base layout instead of the battlefield: wall off
     * 573 cells of a continent and the naval arm would silently ungate
     * mid-match. `isGround` cancels occupancy out, so the verdict is a pure
     * function of the heightfield and the waterline.
     */
    const t = terrainFor('temperate-valley');
    const before = surveyLandMasses(t);
    // A 40x40-cell block — 1600 cells, nearly three times the island floor —
    // stamped straight across the middle of the map.
    const c = (MAP_CELLS >> 1) - 20;
    t.markOccupied(c, c, 40, 40, 1 as never);
    try {
      let blocked = 0;
      for (let cz = c; cz < c + 40; cz++) {
        for (let cx = c; cx < c + 40; cx++) {
          if (!t.isPassable(cx, cz, Locomotor.Track)) blocked++;
        }
      }
      expect(blocked, 'the occupancy stamp has to actually block ground').toBe(1600);
      invalidateLandRoutes();
      const after = surveyLandMasses(t);
      expect(after.landMasses).toBe(before.landMasses);
      expect(after.largest).toBeGreaterThanOrEqual(before.largest);
      expect(mapForcesSeaCrossing(t)).toBe(false);
      /*
       * THE ERROR THE UNION MAKES, MEASURED RATHER THAN CLAIMED. Five of the
       * 1600 stamped cells were not track-passable before the stamp — a prop
       * or a slope — and now count as ground because something is standing on
       * them. That is the whole error, it is 0.3% of the stamp, and it only
       * ever ADDS: occupancy can merge two masses and can never split one, so
       * the bias is toward "this is a continent", which is the direction that
       * leaves the progression gate standing.
       */
      expect(after.ground).toBeGreaterThanOrEqual(before.ground);
      expect(after.ground - before.ground).toBeLessThan(1600);
    } finally {
      t.clearOccupied(c, c, 40, 40);
      invalidateLandRoutes();
    }
  });

  it('answers "linked" for a map with no ground to measure', () => {
    // A null terrain, the `?shot=` harness's stub, a headless test. "Nobody is
    // separated" is the right answer to an empty measurement, and it keeps
    // every one of those on the ordinary gated path.
    expect(mapLandLinked(null)).toBe(true);
    expect(mapForcesSeaCrossing(null)).toBe(false);
    expect(surveyLandMasses(null).landMasses).toBe(0);
    expect(TERRAIN_ISLAND_MIN_CELLS).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 2. WHAT THE EXEMPTION COVERS
 * ========================================================================== */

describe('the mobility half of the naval arm', () => {
  it('is the four docks and the two lifts, and nothing else', async () => {
    const catalog = await boundCatalog();
    const got = catalog.entries.filter((e) => catalog.isSeaMobility(e)).map((e) => e.key).sort();
    expect(got).toEqual(
      ['mrdSlipway', 'navalYard', 'rclDrydock', 'rclScow', 'subPen', 'transport'],
    );
  });

  it('excludes every warship, which stays the reward it was', async () => {
    const catalog = await boundCatalog();
    for (const key of [
      'gunboat', 'destroyer', 'submarine', 'dreadnought', 'mrdCorvette', 'mrdMonitor', 'rclHulk',
    ]) {
      const e = catalog.byKey(key);
      expect(e, key).not.toBeNull();
      expect(catalog.requiresSea(e!), `${key} needs a sea`).toBe(true);
      expect(catalog.isSeaMobility(e!), `${key} is a warship, not a road`).toBe(false);
    }
  });

  it('excludes the Sandskiff, which is a land-gated hull with seats', async () => {
    // The case that proves this is the rule and not a name match: `mrdSkiff`
    // carries passengers and IS the Pact's insertion hull, but it is gated on
    // `mrdForgeyard` — a land structure — so it is not sea content and was
    // never part of this question. It stays behind `unit.raider`.
    const catalog = await boundCatalog();
    const e = catalog.byKey('mrdSkiff');
    expect(e, 'mrdSkiff').not.toBeNull();
    expect(catalog.requiresSea(e!)).toBe(false);
    expect(catalog.isSeaMobility(e!)).toBe(false);
    expect(e!.unlockedBy).toBe(UNLOCKS.unitRaider);
  });

  it('still tags the dock and the lift in the def table', async () => {
    // The exemption is a filter on AVAILABILITY. Nothing about the content
    // changed: no def array moved, no `unlockedBy` was cleared, and the same
    // rows are still gated on every other battlefield in the game.
    const catalog = await boundCatalog();
    for (const key of ['navalYard', 'subPen', 'mrdSlipway', 'rclDrydock']) {
      expect(catalog.byKey(key)?.unlockedBy, key).toBe(UNLOCKS.structNaval);
    }
    for (const key of ['transport', 'rclScow']) {
      expect(catalog.byKey(key)?.unlockedBy, key).toBe(UNLOCKS.unitNaval);
    }
  });
});

/* ==========================================================================
 * 3. THE REGRESSION — A BRAND-NEW PROFILE ON SUNDER ATOLL
 *
 * Every assertion below FAILS on the build that shipped v2.5.0.
 * ========================================================================== */

describe('a profile with nothing unlocked, on the atoll', () => {
  it('is offered a dock and a lift by every army', async () => {
    const t = terrainFor(ATOLL);
    for (const [faction, dock, lift] of MOBILITY) {
      setUnlockGate(gateOwning());
      const service = await makeService(t, faction, faction);
      // NOT "available" — an empty world has no construction yard — but the
      // refusal must never again be the progression one. That is the whole
      // difference between "build this later" and "this match cannot end".
      expect(refusal(service, 0, dock), `${dock} for faction ${faction as number}`)
        .not.toBe(LOCKED_REASON);
      if (lift !== '') {
        expect(refusal(service, 0, lift), `${lift} for faction ${faction as number}`)
          .not.toBe(LOCKED_REASON);
      }
      setUnlockGate(null);
    }
  });

  it('exempts the AI on the same battlefield, or the human wins uncontested', async () => {
    // `UnlockGate.mirrorAI` resolves the AI against the HUMAN's profile, so the
    // stalemate was symmetrical and so is the fix. Player 1 is the AI.
    const t = terrainFor(ATOLL);
    setUnlockGate(gateOwning());
    const service = await makeService(t, Faction.Allies, Faction.Soviets);
    expect(refusal(service, 1, 'subPen')).not.toBe(LOCKED_REASON);
    expect(refusal(service, 1, 'transport')).not.toBe(LOCKED_REASON);
  });

  it('keeps every warship locked — the road is free, the fleet is not', async () => {
    const t = terrainFor(ATOLL);
    setUnlockGate(gateOwning());
    const service = await makeService(t, Faction.Allies, Faction.Soviets);
    expect(refusal(service, 0, 'gunboat')).toBe(LOCKED_REASON);
    expect(refusal(service, 0, 'destroyer')).toBe(LOCKED_REASON);
    expect(refusal(service, 1, 'submarine')).toBe(LOCKED_REASON);
    // And nothing else in the game moved either: the two ids that pay for the
    // dock and the lift still gate everything else they gated.
    expect(refusal(service, 0, 'battleLab')).toBe(LOCKED_REASON);
    expect(refusal(service, 0, 'prismTank')).toBe(LOCKED_REASON);
  });

  it('changes nothing for a profile that already owns the ids', async () => {
    // The exemption is a floor, not a switch: a veteran sees exactly what they
    // saw before, on this map and on every other.
    const t = terrainFor(ATOLL);
    setUnlockGate(gateOwning(UNLOCKS.structNaval, UNLOCKS.unitNaval));
    const service = await makeService(t, Faction.Allies, Faction.Soviets);
    expect(refusal(service, 0, 'navalYard')).not.toBe(LOCKED_REASON);
    expect(refusal(service, 0, 'gunboat')).not.toBe(LOCKED_REASON);
  });
});

/* ==========================================================================
 * 4. AND THE OTHER SIX BATTLEFIELDS DID NOT MOVE
 *
 * The regression risk. `contested-strait` and `coral-shore` are the subtle
 * half: they HAVE a sea, so `mapSupportsNaval` is true and the cameos are
 * published — a rule keyed on water alone would have ungated the whole naval
 * arm on both of them and quietly deleted a mission reward.
 * ========================================================================== */

describe('naval stays behind Theatre Command everywhere else', () => {
  it('is locked on both half-plane sea maps, which have a sea and one shore', async () => {
    for (const id of SEA_MAPS) {
      const t = terrainFor(id);
      expect(mapSupportsNaval(t), `${id} has a sea`).toBe(true);
      setUnlockGate(gateOwning());
      const service = await makeService(t, Faction.Allies, Faction.Soviets);
      expect(refusal(service, 0, 'navalYard'), id).toBe(LOCKED_REASON);
      expect(refusal(service, 0, 'transport'), id).toBe(LOCKED_REASON);
      expect(refusal(service, 1, 'subPen'), id).toBe(LOCKED_REASON);
      setUnlockGate(null);
    }
  });

  it('is locked on all four land maps, for all four armies', async () => {
    for (const id of LAND_MAPS) {
      const t = terrainFor(id);
      for (const [faction, dock, lift] of MOBILITY) {
        setUnlockGate(gateOwning());
        const service = await makeService(t, faction, faction);
        expect(refusal(service, 0, dock), `${dock} on ${id}`).toBe(LOCKED_REASON);
        if (lift !== '') {
          expect(refusal(service, 0, lift), `${lift} on ${id}`).toBe(LOCKED_REASON);
        }
        setUnlockGate(null);
      }
    }
  });

  it('leaves a world with no terrain gated, which is every other spec file', async () => {
    // `World.terrain` defaults to the `FlatTerrain` null object. If the
    // exemption leaked there it would ungate naval for the whole suite and for
    // the `?shot=` harness, and nothing would say so.
    setUnlockGate(gateOwning());
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const service = new ProductionService(world, new Channels(), await boundCatalog());
    expect(mapForcesSeaCrossing(world.terrain)).toBe(false);
    expect(refusal(service, 0, 'navalYard')).toBe(LOCKED_REASON);
  });
});
