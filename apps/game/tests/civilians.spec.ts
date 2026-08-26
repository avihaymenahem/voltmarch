/**
 * ============================================================================
 * tests/civilians.spec.ts — THE NEUTRAL STRUCTURES, AND THE FIVE TABLES
 * ============================================================================
 * `src/sim/Capture.ts` rule 1 is written about "oil derricks, hospitals,
 * civilian blocks" and `src/sim/Garrison.ts` says in its own header that a
 * neutral-owned structure is eligible "the moment one exists". Both mechanics
 * were finished, tested and unreachable, because nothing on the map was owned
 * by a neutral player. This file is about the content that closes that, and
 * about the specific ways adding a structure fails SILENTLY.
 *
 * A BUILDING NEEDS FIVE TABLES TO AGREE and three of them fail quietly:
 *
 *   `Defs.BUILDINGS`               the def row — missing means defId -1
 *   `Scenarios.FALLBACK_BUILDINGS` `spawnBuilding` returns NONE without it
 *   `Scenarios.BUILDING_ALIASES`   missing means the def NEVER BINDS: the
 *                                  building spawns and draws its faction's
 *                                  default model, with nothing logged
 *   `BuildingDefs.STRUCTURE_MASS_LISTS` + `buildings.system.FACTION_KEYS`
 *                                  missing means no art is registered for the
 *                                  defId, same silent fallback
 *   `Cameos.CAMEO_BUILDING_MODELS` missing means a painted glyph
 *
 * `tests/data.spec.ts` covers the first two against each other and
 * `tests/cameos-coverage.spec.ts` covers the last. The ART table is the one
 * nothing was checking — a mass list built on a footprint the def does not
 * share is a pad the wrong size for its own occupancy rectangle — so it is
 * checked here, for every building in the game rather than only for these
 * three.
 *
 * AND THE INVERSE, which is the other half of the brief: these must never
 * appear in a build tab. That is enforced by an omission (no `CONTENT` row in
 * `src/sim/Production.ts`), and an omission is exactly the kind of thing a
 * later edit restores by accident.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng, footprintOriginCell, isInMap } from '../src/core/math';
import { CELL, DEFAULT_SEED, MAP_SIZE } from '../src/core/config';
import {
  EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';

import {
  CIVILIAN_DIMENSIONS, CIVILIAN_INCOME, CIVILIAN_KEYS, CIVILIAN_MODELS,
} from '../src/data/Civilians';
import { BUILDINGS, DEF_TABLES } from '../src/data/Defs';
import {
  CIVILIAN_CAPTURE_BUILD_CLEARANCE, CIVILIAN_CAPTURE_BUILD_PAD_OFFSET,
  CIVILIAN_HAMLET_OFFSET, FALLBACK_BUILDINGS, START_CLEAR_RADIUS, buildScenario,
  civilianSettlementShape,
  clearScenario, entityKeyOf, resolveDefBinding, startSpots,
} from '../src/game/Scenarios';
import { STRUCTURE_BY_KEY } from '../src/art/BuildingDefs';
import { CAMEO_BUILDING_MODELS, cameoModelKey } from '../src/ui/Cameos';
import {
  PRODUCTION_CONTENT, ProductionCatalog, ProductionService, setProduction,
} from '../src/sim/Production';
import { CaptureService, setCaptureService } from '../src/sim/Capture';
import { GARRISON, GarrisonService, setGarrisonService } from '../src/sim/Garrison';
import { Economy } from '../src/sim/Economy';
import { payDerricks } from '../src/sim/civilian.system';
import { CursorKind } from '../src/input/Input';
import { Selection, SelectMode } from '../src/input/Selection';
import {
  CommandMode, createCapabilities, readCapabilities, resolveContextOrder,
  type OrderResolution,
} from '../src/input/Commands';

const ALLIES = 0 as PlayerId;
const SOVIETS = 1 as PlayerId;
const GAIA = 2 as PlayerId;
const NO_MODS = { shift: false, ctrl: false, alt: false };

/* ==========================================================================
 * 1. THE FIVE TABLES
 * ========================================================================== */

/**
 * Where `civOilDerrick` sits in `BUILDINGS`. Pinned, because that is what
 * "appended, never inserted" actually means for a replay: the number a
 * recording wrote down has to still name the same content.
 */
const CIVILIAN_DEF_INDEX = 51;

describe('the civilian block is described identically by every table that owns part of it', () => {
  it('has a def row per key, in the declared order, and nothing was INSERTED', () => {
    // Appended, never inserted: `src/game/Replay.ts` records `defId` as a raw
    // array index, so a row inserted mid-array makes every existing recording
    // play back a different game.
    //
    // THIS USED TO SAY "the LAST three rows and nothing else may sit after
    // them", which is a STRICTER claim than the invariant it cites and a
    // WEAKER guard than it looks. Appending a fourth block after the civilians
    // — which v2.6.0 did, with the three Command Posts — moves no existing
    // index and breaks no recording; inserting one ABOVE them does, and the
    // tail check would not have noticed as long as the tail was rewritten to
    // match. So the assertion is now the invariant itself: the three keys are
    // consecutive, in order, and they start where they have always started.
    /* THE BLOCK IS NO LONGER CONTIGUOUS, AND THAT IS THE INVARIANT WORKING
     * RATHER THAN FAILING.
     *
     * `civOreMine` was added after the original three and is APPENDED at the end
     * of `BUILDINGS`, which is the only safe place to put it: every row keeps
     * the `defId` it already had, so every replay on disk still plays back the
     * game it recorded. Putting it fourth — next to its siblings, where it reads
     * more nicely — would have shifted every structure below it and silently
     * rewritten history.
     *
     * So contiguity was never the invariant; it was a proxy for it that held
     * only while the block happened to be the newest thing in the file. The
     * assertions below are the invariant itself: the ORIGINAL three still start
     * where they have always started and are still consecutive, and anything
     * added since sits strictly after them. */
    const keys = BUILDINGS.map((b) => b.key);
    const original = CIVILIAN_KEYS.slice(0, 3);
    const at = keys.indexOf(original[0]);
    expect(keys.slice(at, at + original.length)).toEqual(original);
    // The pinned index. Every row above this one keeps the `defId` every
    // replay on disk recorded for it; a bare number is the only thing that
    // can say so, and a failure here is somebody having inserted rather than
    // appended.
    expect(at, 'a row was INSERTED above the civilian block').toBe(CIVILIAN_DEF_INDEX);

    // Everything added to the civilian family since must exist, and must sit
    // BELOW the pinned block — i.e. it was appended, not spliced in.
    for (const key of CIVILIAN_KEYS.slice(3)) {
      const idx = keys.indexOf(key);
      expect(idx, `${key} has no def row`).toBeGreaterThan(-1);
      expect(idx, `${key} was INSERTED rather than appended`)
        .toBeGreaterThanOrEqual(at + original.length);
    }
  });

  it.each(CIVILIAN_KEYS)('%s: def, fallback and MASS LIST share one footprint', (key) => {
    const dim = CIVILIAN_DIMENSIONS[key];
    expect(dim, `${key} has no entry in CIVILIAN_DIMENSIONS`).toBeDefined();

    const def = BUILDINGS[DEF_TABLES.buildingByKey.get(key)!];
    expect(def, `${key} has no def row`).toBeDefined();
    expect(def.footprintW).toBe(dim.w);
    expect(def.footprintH).toBe(dim.h);

    const fb = FALLBACK_BUILDINGS[key];
    expect(fb, `${key} has no FALLBACK_BUILDINGS row — spawnBuilding returns NONE`).toBeDefined();
    expect(fb.footprintW).toBe(dim.w);
    expect(fb.footprintH).toBe(dim.h);

    const art = STRUCTURE_BY_KEY.get(CIVILIAN_MODELS[key]);
    expect(art, `${key} has no mass list under "${CIVILIAN_MODELS[key]}"`).toBeDefined();
    expect(art!.footprintW).toBe(dim.w);
    expect(art!.footprintH).toBe(dim.h);
    expect(art!.height).toBe(dim.height);
  });

  it('binds every civilian key to its def through BUILDING_ALIASES', async () => {
    // The silent one. Without an alias row the building spawns, blocks nav,
    // takes damage and draws its owner's Construction Yard, with nothing
    // logged anywhere.
    const binding = await resolveDefBinding();
    for (const key of CIVILIAN_KEYS) {
      expect(binding.buildingId[key] ?? -1, `${key} is unbound`).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves a cameo model for every army, since the defs are Neutral-owned', () => {
    for (const key of CIVILIAN_KEYS) {
      expect(CAMEO_BUILDING_MODELS[key], `${key} has no cameo binding`).toBeDefined();
      for (const f of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
        expect(cameoModelKey(key, f, true), `${key} at faction ${f as number}`)
          .toBe(CIVILIAN_MODELS[key]);
      }
    }
  });

  /**
   * THE ART TABLE NOTHING WAS CHECKING, generalised past the three keys that
   * prompted it. `validateStructure` compares a model against its OWN declared
   * footprint and never against the def's, so the two could disagree for any
   * structure in the game and the only symptom would be a foundation pad that
   * does not cover the cells the nav grid marked occupied.
   */
  it('gives every def-backed structure a mass list on the same footprint', () => {
    const mismatched: string[] = [];
    for (const b of BUILDINGS) {
      const art = STRUCTURE_BY_KEY.get(b.model);
      if (art === undefined) continue; // the Pact and the Reclamation keep private rosters
      if (art.footprintW !== b.footprintW || art.footprintH !== b.footprintH) {
        mismatched.push(
          `${b.key}: def ${b.footprintW}x${b.footprintH} vs art ${art.footprintW}x${art.footprintH}`);
      }
    }
    expect(mismatched, 'a pad sized for the wrong occupancy rectangle').toEqual([]);
  });
});

describe('no player can build one', () => {
  it('has no PRODUCTION_CONTENT row, which is the whole enforcement', () => {
    const named = PRODUCTION_CONTENT.filter((c) => CIVILIAN_KEYS.includes(c.key)).map((c) => c.key);
    expect(
      named,
      'a CONTENT row is what puts a key in ProductionCatalog, and every build tab is a view '
      + 'of the catalog — one row here and civilian structures appear in the sidebar',
    ).toEqual([]);
  });

  it('is absent from the bound catalog entirely', async () => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound).toBe(true);
    for (const key of CIVILIAN_KEYS) {
      expect(catalog.byKey(key), `${key} is orderable`).toBeNull();
    }
  });
});

/* ==========================================================================
 * 2. THE TWO MECHANICS, AGAINST REAL DEF NUMBERS
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  capture: CaptureService;
  garrison: GarrisonService;
  economy: Economy;
  spawn(key: string, owner: PlayerId, x: number, z: number): EntityId;
}

/**
 * A world with the three armies the resolver needs, and a Gaia allied to
 * everyone exactly as `ScenarioBuilder.gaia` wires it. Buildings are allocated
 * straight from the store with the REAL def and fallback numbers, because
 * `ProductionService.spawnBuilding` cannot help here: it takes a `BuildEntry`,
 * and the whole point of these keys is that they have none.
 */
function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  for (let i = 0; i < world.players.length; i++) {
    world.players[GAIA as number].allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (GAIA as number);
  }

  const channels = new Channels();
  // `CaptureService.isEngineerSlot` asks the def tables first and the catalog
  // key second, so a rig with no production service answers "nothing is an
  // engineer" and every capture test would pass vacuously by refusing.
  const production = new ProductionService(
    world, channels, new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} }),
  );
  production.bindingTables = DEF_TABLES;
  setProduction(production);

  const capture = new CaptureService(world, channels);
  setCaptureService(capture);
  const garrison = new GarrisonService(world, channels);
  // The MODULE ACCESSOR, not just the instance: `input/Commands.ts` asks
  // `garrisonService()` for eligibility rather than re-deriving it, and a rig
  // that skips this makes every cursor case pass by answering Move.
  setGarrisonService(garrison);
  garrison.attach();
  const economy = new Economy(world, channels);

  return {
    world, channels, capture, garrison, economy,
    spawn(key, owner, x, z): EntityId {
      const s = world.store;
      const defId = DEF_TABLES.buildingByKey.get(key)!;
      const def = BUILDINGS[defId];
      const fb = FALLBACK_BUILDINGS[key];
      const id = s.alloc(
        EntityKind.Building, defId, owner, world.player(owner).faction, x, 0, z,
      );
      const i = s.index(id);
      s.footprintW[i] = def.footprintW;
      s.footprintH[i] = def.footprintH;
      s.maxHp[i] = def.maxHp;
      s.hp[i] = def.maxHp;
      s.sight[i] = def.sight;
      s.radius[i] = Math.max(def.footprintW, def.footprintH) * CELL * 0.5;
      s.weaponIndex[i] = def.weapons[0] ?? -1;
      s.locomotor[i] = Locomotor.Static;
      s.buildProgress[i] = 1;
      s.flags[i] |= fb.flags | def.flags;
      world.spatial.rebuild();
      return id;
    },
  };
}

/**
 * One infantryman. `role` picks the real def, which is what both the sim's
 * `isEngineerSlot` (def tables first) and the input layer's `HEURISTIC_ROLES`
 * (unarmed foot unit) read — an armed rifleman must carry `CanAttack` or the
 * heuristic calls it an engineer and the garrison branch never fires.
 */
function foot(rig: Rig, owner: PlayerId, x: number, z: number, role: 'engineer' | 'gi'): EntityId {
  const s = rig.world.store;
  const defId = DEF_TABLES.unitByKey.get(role)!;
  const id = s.alloc(
    EntityKind.Infantry, defId, owner, rig.world.player(owner).faction, x, 0, z,
  );
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.Crushable;
  s.radius[i] = 0.5;
  s.maxSpeed[i] = 4;
  s.locomotor[i] = Locomotor.Foot;
  s.hp[i] = 25;
  s.maxHp[i] = 25;
  if (role === 'gi') {
    s.flags[i] |= EntityFlag.CanAttack;
    s.weaponIndex[i] = 0;
  } else {
    s.weaponIndex[i] = -1;
  }
  rig.world.spatial.rebuild();
  return id;
}

/** Stand a unit against a structure's front edge, inside `reachMetres`. */
function placeAgainst(rig: Rig, unit: EntityId, host: EntityId): void {
  const s = rig.world.store;
  const u = s.index(unit);
  const h = s.index(host);
  s.posX[u] = s.posX[h];
  s.posZ[u] = s.posZ[h] + s.footprintH[h] * CELL * 0.5 + 1.0;
  rig.world.spatial.rebuild();
}

function order(rig: Rig, unit: EntityId, kind: OrderKind, target: EntityId): void {
  const s = rig.world.store;
  const i = s.index(unit);
  s.orderKind[i] = kind;
  s.orderTarget[i] = target as number;
  s.orderX[i] = s.posX[s.index(target)];
  s.orderZ[i] = s.posZ[s.index(target)];
  s.state[i] = UnitState.Moving;
}

/** One sim tick. Neither service under test draws from `rng`; a real one is
 *  cheaper than a stub that has to track `IRng`. */
const SIM: SimContext = { dt: 1 / 30, tick: 1, time: 1 / 30, rng: new Rng(1) };

describe('a civilian structure is garrisonable by construction, not by exception', () => {
  it.each(CIVILIAN_KEYS)('%s satisfies every clause of refusalFor', (key) => {
    const rig = makeRig();
    const b = rig.spawn(key, GAIA, 120, 120);
    expect(rig.garrison.refusalFor(b, ALLIES)).toBe('');
  });

  it.each(CIVILIAN_KEYS)('%s is at least GARRISON.minFootprint on BOTH axes', (key) => {
    const dim = CIVILIAN_DIMENSIONS[key];
    expect(dim.w).toBeGreaterThanOrEqual(GARRISON.minFootprint);
    expect(dim.h).toBeGreaterThanOrEqual(GARRISON.minFootprint);
  });

  it.each(CIVILIAN_KEYS)('%s carries no weapon and no production role', (key) => {
    const def = BUILDINGS[DEF_TABLES.buildingByKey.get(key)!];
    expect(def.weapons.length, `${key} would be refused as 'armed'`).toBe(0);
    const busy = EntityFlag.IsBuilder | EntityFlag.IsFactory
      | EntityFlag.IsRefinery | EntityFlag.IsRadar | EntityFlag.CanAttack;
    expect(FALLBACK_BUILDINGS[key].flags & busy, `${key} would be refused`).toBe(0);
  });

  it('flips to the occupier while held and reverts to Gaia when emptied', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const b = rig.spawn('civHospital', GAIA, 120, 120);
    const gi = foot(rig, ALLIES, 0, 0, 'gi');
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);

    rig.garrison.simTick(SIM);
    expect(st.owner[st.index(b)]).toBe(ALLIES as number);
    expect(st.faction[st.index(b)]).toBe(Faction.Allies as number);

    expect(rig.garrison.evacuate(b)).toBe(1);
    expect(st.owner[st.index(b)]).toBe(GAIA as number);
    expect(st.faction[st.index(b)]).toBe(Faction.Neutral as number);
  });

  it('is not sellable, so one misclick cannot demolish it for a zero refund', () => {
    // `Production.applySell` values a sale at `entry?.cost ?? 0`, and these
    // keys have no catalog entry by design — so the flag is the only thing
    // standing between a captured derrick and an instant, silent, unrefunded
    // demolition.
    for (const key of CIVILIAN_KEYS) {
      expect(FALLBACK_BUILDINGS[key].flags & EntityFlag.Sellable, key).toBe(0);
    }
  });
});

describe('an engineer takes a civilian structure outright, at full health', () => {
  it('captures a pristine derrick (rule 1, which had no subject before)', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const b = rig.spawn('civOilDerrick', GAIA, 120, 120);
    expect(st.hp[st.index(b)]).toBe(st.maxHp[st.index(b)]);

    const eng = foot(rig, ALLIES, 0, 0, 'engineer');
    // The heuristic role resolver reads "unarmed foot unit" as an engineer,
    // which is what `CaptureService.isEngineerSlot` falls back to with no def.
    placeAgainst(rig, eng, b);
    order(rig, eng, OrderKind.Capture, b);

    rig.capture.simTick(SIM);
    expect(st.owner[st.index(b)]).toBe(ALLIES as number);
    expect(rig.capture.stats.captures).toBe(1);
    expect(rig.capture.stats.softens, 'a neutral target has no health gate').toBe(0);
  });

  it('cannot take one that is already garrisoned — the veto is live', () => {
    const rig = makeRig();
    const b = rig.spawn('civApartments', GAIA, 120, 120);
    const gi = foot(rig, ALLIES, 0, 0, 'gi');
    placeAgainst(rig, gi, b);
    order(rig, gi, OrderKind.Enter, b);
    rig.garrison.simTick(SIM);

    expect(rig.capture.isCapturable(b, SOVIETS)).toBe(false);
  });
});

/* ==========================================================================
 * 3. THE INCOME
 * ========================================================================== */

describe('an oil derrick pays whoever holds the deed', () => {
  it('pays nobody while Gaia owns it', () => {
    const rig = makeRig();
    const defId = DEF_TABLES.buildingByKey.get(CIVILIAN_INCOME.key)!;
    rig.spawn(CIVILIAN_INCOME.key, GAIA, 120, 120);
    const before = rig.world.players[ALLIES as number].credits;

    expect(payDerricks(rig.world, rig.economy, defId)).toBe(0);
    expect(rig.world.players[ALLIES as number].credits).toBe(before);
  });

  it('pays its owner once it has been captured, and only its owner', () => {
    const rig = makeRig();
    const defId = DEF_TABLES.buildingByKey.get(CIVILIAN_INCOME.key)!;
    const b = rig.spawn(CIVILIAN_INCOME.key, GAIA, 120, 120);
    rig.world.players[ALLIES as number].storageMax = 1e6;
    rig.world.players[SOVIETS as number].storageMax = 1e6;
    const mine = rig.world.players[ALLIES as number].credits;
    const theirs = rig.world.players[SOVIETS as number].credits;

    expect(rig.capture.captureBuilding(b, ALLIES)).toBe(true);
    expect(payDerricks(rig.world, rig.economy, defId)).toBe(1);

    expect(rig.world.players[ALLIES as number].credits - mine).toBe(CIVILIAN_INCOME.credits);
    expect(rig.world.players[SOVIETS as number].credits).toBe(theirs);
  });

  it('pays nothing for a structure that is not a derrick', () => {
    const rig = makeRig();
    const defId = DEF_TABLES.buildingByKey.get(CIVILIAN_INCOME.key)!;
    const b = rig.spawn('civHospital', GAIA, 120, 120);
    rig.capture.captureBuilding(b, ALLIES);
    expect(payDerricks(rig.world, rig.economy, defId)).toBe(0);
  });

  it('stops the moment the derrick is marked for destruction', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const defId = DEF_TABLES.buildingByKey.get(CIVILIAN_INCOME.key)!;
    const b = rig.spawn(CIVILIAN_INCOME.key, GAIA, 120, 120);
    rig.capture.captureBuilding(b, ALLIES);
    expect(payDerricks(rig.world, rig.economy, defId)).toBe(1);

    st.markDead(b);
    expect(payDerricks(rig.world, rig.economy, defId)).toBe(0);
  });

  it('pays on a TICK COUNT, never a wall clock', () => {
    // The lockstep contract, asserted as arithmetic rather than trusted to a
    // comment: two clients must credit the same player on the same tick.
    expect(Number.isInteger(CIVILIAN_INCOME.intervalTicks)).toBe(true);
    expect(CIVILIAN_INCOME.intervalTicks).toBeGreaterThan(0);
    expect(Number.isInteger(CIVILIAN_INCOME.credits)).toBe(true);
  });
});

/* ==========================================================================
 * 4. THE RIGHT-CLICK, which is what made both mechanics reachable
 * ========================================================================== */

describe('the cursor can express both verbs against a neutral structure', () => {
  /** `resolveContextOrder` over a live selection, the way Input drives it. */
  function resolveAt(rig: Rig, hover: EntityId): OrderResolution {
    const caps = createCapabilities();
    readCapabilities(rig.world, rig.world.selection.ids, rig.world.selection.count, caps);
    const st = rig.world.store;
    const i = st.index(hover);
    return resolveContextOrder(
      rig.world, hover, st.posX[i], st.posZ[i], true, NO_MODS, CommandMode.None, caps,
      { order: OrderKind.None, target: NONE, x: 0, z: 0, cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '' },
    );
  }

  it('offers Capture to an engineer over a neutral structure', () => {
    // BEFORE THIS BRANCH: Gaia is allied to everyone, so `isEnemyOf` was false,
    // `hoverOwn` was false, and the resolver fell through every rule to
    // "anything else friendly: move to it". No click could produce the ORDER
    // KIND, so `CaptureService`'s rule 1 was unreachable from the mouse.
    const rig = makeRig();
    const sel = new Selection(rig.world, rig.channels);
    const b = rig.spawn('civOilDerrick', GAIA, 120, 120);
    sel.select(foot(rig, ALLIES, 100, 100, 'engineer'), SelectMode.Replace);

    const r = resolveAt(rig, b);
    expect(r.order).toBe(OrderKind.Capture);
    expect(r.cursor).toBe(CursorKind.Capture);
    expect(r.target).toBe(b);
  });

  it('offers Enter to riflemen over a garrisonable neutral structure', () => {
    const rig = makeRig();
    const sel = new Selection(rig.world, rig.channels);
    const b = rig.spawn('civApartments', GAIA, 120, 120);
    sel.select(foot(rig, ALLIES, 100, 100, 'gi'), SelectMode.Replace);

    const r = resolveAt(rig, b);
    expect(r.order).toBe(OrderKind.Enter);
    expect(r.cursor).toBe(CursorKind.Enter);
    expect(r.target).toBe(b);
  });

  it('refuses Enter once the structure is full, rather than promising it', () => {
    // The cursor asks `GarrisonService.refusalFor` rather than re-deriving
    // eligibility, so "full" is one answer in one place. A second copy of the
    // rule here is what would let the pointer promise a garrison while the men
    // walk up to the wall and stand there.
    const rig = makeRig();
    const sel = new Selection(rig.world, rig.channels);
    const b = rig.spawn('civApartments', GAIA, 120, 120);
    for (let k = 0; k < GARRISON.capacity; k++) {
      const man = foot(rig, ALLIES, 0, 0, 'gi');
      placeAgainst(rig, man, b);
      order(rig, man, OrderKind.Enter, b);
      rig.garrison.simTick(SIM);
    }
    sel.select(foot(rig, ALLIES, 100, 100, 'gi'), SelectMode.Replace);

    expect(rig.garrison.refusalFor(b, ALLIES)).toBe('full');
    expect(resolveAt(rig, b).order).not.toBe(OrderKind.Enter);
  });
});

/* ==========================================================================
 * 5. PLACEMENT
 * ========================================================================== */

describe('the hamlets are a symmetric, seeded proposition', () => {
  function civiliansIn(seed: number): { key: string; x: number; z: number; valid: boolean }[] {
    const world = new World();
    world.addPlayer(Faction.Allies, 'A', true, true);
    world.addPlayer(Faction.Soviets, 'B', false, false);
    buildScenario(world, 'skirmish', seed, { start: 'mcv' });

    const out: { key: string; x: number; z: number; valid: boolean }[] = [];
    const origin = new Int32Array(2);
    const s = world.store;
    for (let a = 0; a < s.aliveCount; a++) {
      const i = s.alive[a];
      if (s.kind[i] !== EntityKind.Building) continue;
      const key = entityKeyOf(s.handleOf(i));
      if (!CIVILIAN_KEYS.includes(key)) continue;
      const dim = CIVILIAN_DIMENSIONS[key]!;
      footprintOriginCell(s.posX[i], s.posZ[i], dim.w, dim.h, origin);
      let valid = true;
      for (let dz = 0; dz < dim.h; dz++) for (let dx = 0; dx < dim.w; dx++) {
        const cx = origin[0] + dx;
        const cz = origin[1] + dz;
        if (!isInMap(cx, cz)) valid = false;
      }
      out.push({ key, x: s.posX[i], z: s.posZ[i], valid });
    }
    clearScenario();
    return out;
  }

  it('places two hamlets of all three structures', () => {
    const placed = civiliansIn(4242);
    expect(placed.length).toBe(CIVILIAN_KEYS.length * 2);
    for (const key of CIVILIAN_KEYS) {
      expect(placed.filter((p) => p.key === key).length, key).toBe(2);
    }
  });

  it('is byte-identical from the same seed, and different from another', () => {
    const a = civiliansIn(4242);
    const b = civiliansIn(4242);
    expect(b).toEqual(a);
    // Not vacuous: the layout really is derived from the seed, via the start
    // spots, so a different seed has to move it.
    const c = civiliansIn(90210);
    expect(c.length).toBe(a.length);
    expect(c).not.toEqual(a);
    expect(civilianSettlementShape(4242)).toEqual(civilianSettlementShape(4242));
    expect(civilianSettlementShape(90210)).not.toEqual(civilianSettlementShape(4242));
  });

  it('puts nothing inside either opening', () => {
    // `START_CLEAR_RADIUS` is the ground a deploying MCV needs; a civilian
    // block inside it would be the "im surrounded by rocks, i cant build at
    // all" report with a different noun.
    // 4242 BOTH SIDES. The hamlets are laid out against the spots the scenario
    // built at THIS seed, so deriving the spots at a different one measures the
    // clearance around openings nobody occupied.
    const spots = startSpots(MAP_SIZE * 0.5, MAP_SIZE * 0.5, 2, null, 4242);
    for (const p of civiliansIn(4242)) {
      for (const s of spots) {
        expect(
          Math.hypot(p.x - s.x, p.z - s.z),
          `${p.key} is inside an opening`,
        ).toBeGreaterThan(START_CLEAR_RADIUS * 2);
      }
    }
  });

  it('keeps every capture footprint inside the playable grid across seeds', () => {
    for (const seed of [7, 4242, 90210, 3910129]) {
      const placed = civiliansIn(seed);
      expect(placed.filter((p) => !p.valid), `invalid capture footprint at seed ${seed}`).toEqual([]);
    }
  });

  it('reserves a usable build pocket clear of every capture structure', () => {
    const seed = 4242;
    const spots = startSpots(MAP_SIZE * 0.5, MAP_SIZE * 0.5, 2, null, seed);
    const ax = spots[0].x, az = spots[0].z;
    const bx = spots[1].x, bz = spots[1].z;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const vx = dx / len, vz = dz / len;
    const ux = -vz, uz = vx;
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
    const shape = civilianSettlementShape(seed);
    const captures = civiliansIn(seed).filter((p) => p.key !== CIVILIAN_KEYS[3]);

    for (const side of [1, -1]) {
      const hx = mx + ux * side * shape.offset;
      const hz = mz + uz * side * shape.offset;
      const px = hx + vx * CIVILIAN_CAPTURE_BUILD_PAD_OFFSET;
      const pz = hz + vz * CIVILIAN_CAPTURE_BUILD_PAD_OFFSET;
      expect(isInMap(Math.floor(px / CELL), Math.floor(pz / CELL))).toBe(true);
      for (const c of captures) {
        expect(Math.hypot(c.x - px, c.z - pz), `${c.key} overlaps reserved pad`)
          .toBeGreaterThan(CIVILIAN_CAPTURE_BUILD_CLEARANCE);
      }
    }
  });

  it('is as far from one army as from the other', () => {
    // The perpendicular bisector is the only locus with that property, which
    // is why the layout is derived from the two spots rather than authored as
    // an offset from the map centre. Per HAMLET, not per building: the three
    // structures inside one are deliberately not symmetric with each other.
    // 4242 BOTH SIDES — see the case above. With DEFAULT_SEED here the derricks
    // sat on the bisector of one pair of openings and were measured against
    // another, reading 254.8 m vs 203.1 m against a 12 m tolerance.
    const spots = startSpots(MAP_SIZE * 0.5, MAP_SIZE * 0.5, 2, null, 4242);
    const placed = civiliansIn(4242);
    const derricks = placed.filter((p) => p.key === CIVILIAN_INCOME.key);
    expect(derricks.length).toBe(2);
    for (const d of derricks) {
      const toA = Math.hypot(d.x - spots[0].x, d.z - spots[0].z);
      const toB = Math.hypot(d.x - spots[1].x, d.z - spots[1].z);
      // A few metres of slack: `spawnBuilding` snaps to the footprint grid and
      // may relocate off blocked ground, and an exactly-equal pair would be
      // asserting the snap rather than the layout.
      expect(Math.abs(toA - toB), `${toA.toFixed(1)} vs ${toB.toFixed(1)}`).toBeLessThan(12);
      expect(toA).toBeGreaterThan(CIVILIAN_HAMLET_OFFSET);
    }
  });
});
