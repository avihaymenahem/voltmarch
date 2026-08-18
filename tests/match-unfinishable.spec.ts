/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/match-unfinishable.spec.ts — THE MATCH THAT WOULD NOT END
 * ============================================================================
 * Reported as *"Ive ran into a situation inside game that i killed every
 * visible building and troops and game didnt finish."*
 *
 * `game/outcome.system.ts` declares victory when every hostile player is
 * `isBeaten`, and `isBeaten` is `!canRebuild && !canContest`. `canContest`
 * counted EVERY non-harvester unit an opponent owned — including one carrying
 * `EntityFlag.Garrisoned`, which `sim/Garrison.ts` stamps on a man in a window
 * and `sim/Transport.ts` stamps on a passenger in a hull.
 *
 * THE MEASURED FACT THAT MAKES THAT FLAG SPECIAL, and it is pinned below rather
 * than asserted in prose: `Garrisoned` is the ONLY bit a living, owned unit can
 * carry that makes it BOTH undrawn (`RenderBridge.HIDDEN_MASK` is that flag and
 * nothing else) and untargetable (it is the only member of
 * `TARGETABLE_REJECT_MASK` a live unit can hold — `Cloaked` has no caller
 * anywhere in `src/`, `NotATarget` is set only on props and wrecks, and
 * `PendingDestroy` is filtered by the survey itself). So a squad indoors kept
 * the match open against a player who had killed everything they could see.
 *
 * WHAT THIS FILE DOES NOT CLAIM, because it was checked and is not true. The
 * occupants are not immortal: their HOST is an ordinary building and killing it
 * kills them. When the host is a neutral civilian block, `GarrisonService.enter`
 * flips it to the occupier through `CaptureService.captureBuilding` — measured,
 * and pinned in §1 — so it even wears the enemy's colours. The defect is
 * therefore an ACCOUNTING one, not an unkillable entity: the match stayed open
 * on an asset that reads to a player as scenery in a neutral hamlet, with
 * nothing on screen, in the objectives or on the minimap legend to say the
 * apartment block on the far side of the map is now the last enemy position.
 * The fix is in `Viability.surveyViability` §HELD, and the argument for what it
 * costs is written there.
 *
 * THE SWEEP IS DEFINED MECHANICALLY, not by taste (`sweepEverythingVisible`):
 * every enemy Infantry/Vehicle the render bridge would draw, plus every
 * structure the enemy BUILT. It leaves exactly what the report leaves — a
 * civilian building nobody bought and a man nobody can see.
 *
 * All headless. No renderer, no clock, no RNG outside `Rng`.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { CELL, SIM_DT } from '../src/core/config';
import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, TARGETABLE_REJECT_MASK, UnitState,
} from '../src/core/types';
import type {
  EntityId, GameEvents, PlayerId, RenderContext, SimContext,
} from '../src/core/types';

import { BUILDINGS, DEF_TABLES, UNITS } from '../src/data/Defs';
import { FALLBACK_BUILDINGS } from '../src/game/Scenarios';

import { CaptureService, setCaptureService } from '../src/sim/Capture';
import { GarrisonService, setGarrisonService } from '../src/sim/Garrison';
import { TransportService, setTransportService } from '../src/sim/Transport';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import type { BuildEntry } from '../src/sim/Production';
import { resetMoveClasses } from '../src/sim/Movement';
import {
  canContest, canRebuild, describeViability, hasAssets, isBeaten, isStranded,
  makeViabilitySurvey, surveyViability,
} from '../src/sim/Viability';

import outcomeSystem, { OUTCOME } from '../src/game/outcome.system';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

const P0 = 0 as PlayerId;   // local, human
const P1 = 1 as PlayerId;   // the opponent
const GAIA = 2 as PlayerId; // civilian owner, Faction.Neutral

/**
 * `RenderBridge.HIDDEN_MASK`, restated rather than imported.
 *
 * `src/render/RenderBridge.ts` builds THREE.js objects at import time and
 * cannot be loaded under `environment: 'node'`. The value is pinned against the
 * bridge's source text in §1 so this copy cannot drift silently.
 */
const HIDDEN_MASK = EntityFlag.Garrisoned;

/* ==========================================================================
 * Fixture
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  garrison: GarrisonService;
  transport: TransportService;
  tick: number;
  /** Garrison (-400) then Transport (-395), the registered Phase.Cleanup order. */
  step(steps?: number): void;
  unit(key: string, owner: PlayerId, x: number, z: number): EntityId;
  building(key: string, owner: PlayerId, cx: number, cz: number): EntityId;
  /** A neutral structure straight from the store: civilian keys have no catalog entry. */
  civilian(key: string, cx: number, cz: number): EntityId;
}

/** A binding over the REAL def tables. Seats and locomotors are content. */
function boundBinding(): {
  tables: typeof DEF_TABLES;
  unitId: Record<string, number>;
  buildingId: Record<string, number>;
} {
  const unitId: Record<string, number> = {};
  DEF_TABLES.unitByKey.forEach((v, k) => { unitId[k] = v; });
  const buildingId: Record<string, number> = {};
  DEF_TABLES.buildingByKey.forEach((v, k) => { buildingId[k] = v; });
  return { tables: DEF_TABLES, unitId, buildingId };
}

function makeRig(): Rig {
  // MODULE-level table that survives a new `World`; `tests/transport.spec.ts`
  // documents the stale-class failure this prevents.
  resetMoveClasses();

  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  // Gaia is allied to everybody, exactly as `ScenarioBuilder.gaia` wires it.
  for (let i = 0; i < world.players.length; i++) {
    world.players[GAIA as number].allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (GAIA as number);
  }

  const channels = new Channels();
  const production = new ProductionService(
    world, channels, new ProductionCatalog(boundBinding()),
  );
  production.bindingTables = DEF_TABLES;
  setProduction(production);

  const capture = new CaptureService(world, channels);
  setCaptureService(capture);
  const garrison = new GarrisonService(world, channels);
  setGarrisonService(garrison);
  garrison.attach();
  const transport = new TransportService(world, channels);
  transport.bindDefs(DEF_TABLES);
  setTransportService(transport);
  transport.attach();

  const rng = new Rng(4242);
  const rig: Rig = {
    world, channels, production, garrison, transport, tick: 0,

    step(steps = 1): void {
      for (let n = 0; n < steps; n++) {
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        world.spatial.rebuild();
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        production.tick(s);
        garrison.simTick(s);
        transport.simTick(s);
      }
    },

    unit(key, owner, x, z): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry | null;
      expect(entry, `catalog is missing unit "${key}"`).not.toBeNull();
      return production.spawnUnit(world.player(owner), entry as BuildEntry, x, z, 0);
    },

    building(key, owner, cx, cz): EntityId {
      const entry = production.catalog.byKey(key) as BuildEntry | null;
      expect(entry, `catalog is missing building "${key}"`).not.toBeNull();
      return production.spawnBuilding(world.player(owner), entry as BuildEntry, cx, cz, 1);
    },

    civilian(key, cx, cz): EntityId {
      const st = world.store;
      const defId = DEF_TABLES.buildingByKey.get(key);
      expect(defId, `no def row for civilian "${key}"`).not.toBeUndefined();
      const def = BUILDINGS[defId as number];
      const fb = FALLBACK_BUILDINGS[key];
      const id = st.alloc(
        EntityKind.Building, defId as number, GAIA, Faction.Neutral, cx, 0, cz,
      );
      const i = st.index(id);
      st.footprintW[i] = def.footprintW;
      st.footprintH[i] = def.footprintH;
      st.maxHp[i] = def.maxHp;
      st.hp[i] = def.maxHp;
      st.sight[i] = def.sight;
      st.radius[i] = Math.max(def.footprintW, def.footprintH) * CELL * 0.5;
      st.weaponIndex[i] = def.weapons[0] ?? -1;
      st.locomotor[i] = Locomotor.Static;
      st.buildProgress[i] = 1;
      st.flags[i] |= fb.flags | def.flags;
      world.spatial.rebuild();
      return id;
    },
  };
  return rig;
}

/** Walk a unit up to a host and give it the order a right-click produces. */
function sendInto(rig: Rig, mover: EntityId, host: EntityId): void {
  const st = rig.world.store;
  const i = st.index(mover);
  const t = st.index(host);
  st.posX[i] = st.posX[t];
  st.posZ[i] = st.posZ[t] + Math.max(st.footprintH[t], 1) * CELL * 0.5 + 1.0;
  st.orderKind[i] = OrderKind.Enter;
  st.orderTarget[i] = host as number;
  st.orderX[i] = st.posX[t];
  st.orderZ[i] = st.posZ[t];
  st.state[i] = UnitState.Moving;
  rig.world.spatial.rebuild();
}

/** Remove an entity the way a killing blow does, without a Damage service. */
function destroy(rig: Rig, id: EntityId): void {
  rig.world.store.markDead(id);
}

function flush(rig: Rig): void {
  rig.world.store.flushDestroyed();
  rig.world.spatial.rebuild();
}

/**
 * What the player did: kill everything of `owner`'s that they can see.
 *
 * Mechanical, so the reproduction is not a matter of taste. A unit counts as
 * seen when the render bridge would draw it (`flags & HIDDEN_MASK` clear);
 * structures are supplied by the caller, because "buildings the enemy put
 * there" is a thing the player watched happen and a civilian block is not.
 * Returns how many entities were removed.
 */
function sweepEverythingVisible(rig: Rig, owner: PlayerId, structures: EntityId[]): number {
  const st = rig.world.store;
  let killed = 0;
  for (const kind of [EntityKind.Infantry, EntityKind.Vehicle]) {
    const list = st.byKind[kind];
    const n = st.byKindCount[kind];
    for (let a = 0; a < n; a++) {
      const i = list[a];
      if (st.owner[i] !== (owner as number)) continue;
      if ((st.flags[i] & EntityFlag.Alive) === 0) continue;
      if ((st.flags[i] & HIDDEN_MASK) !== 0) continue;   // not on the player's screen
      destroy(rig, st.handleOf(i));
      killed++;
    }
  }
  for (const b of structures) {
    if (st.index(b) < 0) continue;
    destroy(rig, b);
    killed++;
  }
  flush(rig);
  return killed;
}

/* -- the outcome harness --------------------------------------------------- */

interface FakeShell {
  state: string;
  ends: boolean[];
  result: { won: boolean } | null;
  getState(): string;
  endMatch(r: { won: boolean }): void;
  latestResult(): { won: boolean } | null;
}

function installShell(): FakeShell {
  const shell: FakeShell = {
    state: 'playing',
    ends: [],
    result: null,
    getState() { return this.state; },
    endMatch(r) { this.ends.push(r.won); this.result = { won: r.won }; this.state = 'ended'; },
    latestResult() { return this.result; },
  };
  (globalThis as unknown as Record<string, unknown>).__vmShell = shell;
  return shell;
}

function frameCtx(n: number): RenderContext {
  return {
    dt: OUTCOME.pollSeconds, time: n * OUTCOME.pollSeconds, alpha: 1, frame: n, quality: 0,
  } as RenderContext;
}

/** Twice the beaten grace, in polls. Long enough that a live rule always fires. */
const POLL_BUDGET = Math.ceil(OUTCOME.beatenGraceSeconds / OUTCOME.pollSeconds) * 3;

/* ==========================================================================
 * 1. THE REPRODUCTION
 * ========================================================================== */

describe('the match that would not end', () => {
  let rig: Rig;
  let shell: FakeShell;
  let ended: GameEvents['match:ended'][];
  let simTime = OUTCOME.startGraceSeconds + 1;

  beforeEach(() => {
    rig = makeRig();
    ended = [];
    rig.channels.events.on('match:ended', (p) => { ended.push({ ...p }); });
    simTime = OUTCOME.startGraceSeconds + 1;
    setGameContext({
      world: rig.world,
      channels: rig.channels,
      loop: { get simTime() { return simTime; } },
    } as unknown as GameContext);
    shell = installShell();
    outcomeSystem.init?.();
  });

  afterEach(() => {
    outcomeSystem.dispose?.();
    setGameContext(null);
    delete (globalThis as unknown as Record<string, unknown>).__vmShell;
    delete (globalThis as unknown as Record<string, unknown>).__vmHud;
    setProduction(null);
    setCaptureService(null);
    setGarrisonService(null);
    setTransportService(null);
  });

  /** Poll until the shell records a result, or give up after `POLL_BUDGET`. */
  function pollUntilResolved(): number {
    for (let n = 0; n < POLL_BUDGET; n++) {
      outcomeSystem.frame?.(frameCtx(n));
      if (shell.ends.length > 0) return n + 1;
    }
    return -1;
  }

  /**
   * The whole report, end to end.
   *
   * FAILS AGAINST THE OLD RULE. Revert `surveyViability`'s §HELD branch to the
   * one-line `if ((flags & EntityFlag.IsHarvester) === 0) out.contestingUnits++;`
   * and this test times out at `POLL_BUDGET` polls with `shell.ends` empty —
   * verified by doing exactly that.
   */
  it('resolves after the player kills every enemy unit and building they can see', () => {
    // The player: a base and an army, so nothing here is a defeat.
    rig.building('conyard', P0, 40, 40);
    rig.unit('grizzly', P0, 60, 60);

    // The opponent: a base, an army, and one man who walks into the civilian
    // block in the hamlet between the two openings.
    const enemyYard = rig.building('conyard', P1, 160, 160);
    const enemyBarracks = rig.building('barracks', P1, 168, 160);
    rig.unit('conscript', P1, 150, 150);
    rig.unit('rhino', P1, 152, 150);
    const block = rig.civilian('civApartments', 120, 120);
    const occupant = rig.unit('conscript', P1, 120, 120);
    sendInto(rig, occupant, block);
    rig.step(2);

    const st = rig.world.store;
    const oi = st.index(occupant);
    expect(oi, 'the occupant is still alive').toBeGreaterThanOrEqual(0);
    expect(st.flags[oi] & EntityFlag.Garrisoned, 'he is indoors').not.toBe(0);
    // MEASURED, and the reason this is an accounting bug rather than an
    // immortal unit: the neutral block flips to the occupier.
    expect(st.owner[st.index(block)]).toBe(P1 as number);

    // The sweep. Everything of the opponent's that is on the player's screen.
    const killed = sweepEverythingVisible(rig, P1, [enemyYard, enemyBarracks]);
    expect(killed, 'the base and the field army').toBe(4);

    // What is left, stated in terms that are true under either rule.
    const survey = surveyViability(rig.world, P1, makeViabilitySurvey());
    expect(survey.units, 'one man, still owned and still alive').toBe(1);
    expect(survey.heldUnits, 'and he is indoors').toBe(1);
    expect(survey.producers, 'nothing that builds').toBe(0);
    expect(survey.constructionVehicles).toBe(0);

    // THE HEADLINE. Under the old rule this returns -1 and the session is the
    // one that was reported: nothing left to shoot, and no end screen.
    const polls = pollUntilResolved();
    expect(polls, `the match resolved inside the poll budget — ${describeViability(survey)}`)
      .toBeGreaterThan(0);
    expect(shell.ends).toEqual([true]);
    expect(ended).toHaveLength(1);
    expect(ended[0].localWon).toBe(true);
    expect(ended[0].winner).toBe(rig.world.localPlayer);

    // And the reason, for whoever reads the failure above.
    expect(survey.contestingUnits, 'nothing on the field').toBe(0);
    expect(isBeaten(survey), describeViability(survey)).toBe(true);
  });

  /**
   * The property that makes the occupant special, asserted rather than argued.
   *
   * If a future change adds a second way for a live unit to become both undrawn
   * and untargetable, this is where it shows up — and `Viability` will need to
   * hear about it, because that is the shape of the bug above.
   */
  it('HIDDEN_MASK above is still what the render bridge actually uses', () => {
    // The bridge builds THREE.js objects at import time and cannot be loaded
    // here, so the constant is restated at the top of this file. Reading its
    // source is what stops that copy drifting into a lie.
    const src = readFileSync(
      fileURLToPath(new URL('../src/render/RenderBridge.ts', import.meta.url)), 'utf8',
    );
    expect(src).toContain('const HIDDEN_MASK = EntityFlag.Garrisoned;');
  });

  it('the occupant is the one live unit the engine hides AND refuses to target', () => {
    const block = rig.civilian('civApartments', 120, 120);
    const man = rig.unit('conscript', P1, 120, 120);
    sendInto(rig, man, block);
    rig.step(2);

    const st = rig.world.store;
    const i = st.index(man);
    expect(st.flags[i] & HIDDEN_MASK, 'not drawn').not.toBe(0);
    expect(st.flags[i] & TARGETABLE_REJECT_MASK, 'not acquirable').not.toBe(0);
    expect(st.flags[i] & EntityFlag.Alive, 'and alive the whole time').not.toBe(0);
    // The other two members of the reject mask that a live unit could carry.
    expect(st.flags[i] & EntityFlag.Cloaked, 'Cloaked has no caller in src/').toBe(0);
    expect(st.flags[i] & EntityFlag.NotATarget, 'props and wrecks only').toBe(0);
  });

  /**
   * KILLING THE HOST STILL ENDS IT, which is the half of the old behaviour that
   * was right and must not be lost: the occupant is not being written off, he
   * is being counted through the thing that holds him.
   */
  it('killing the host kills the garrison and resolves the same way', () => {
    rig.building('conyard', P0, 40, 40);
    rig.unit('grizzly', P0, 60, 60);
    const block = rig.civilian('civApartments', 120, 120);
    const man = rig.unit('conscript', P1, 120, 120);
    sendInto(rig, man, block);
    rig.step(2);
    expect(rig.garrison.occupantCount(block)).toBe(1);

    destroy(rig, block);
    rig.step(1);            // Garrison.recover sinks him in front of the death scan
    flush(rig);

    expect(rig.world.store.index(man), 'he went down with the building')
      .toBeLessThan(0);
    expect(rig.garrison.stats.drowned).toBe(1);
    expect(pollUntilResolved()).toBeGreaterThan(0);
    expect(shell.ends).toEqual([true]);
  });

  /* ======================================================================
   * 2. WHAT THE RULE DOES NOT CHANGE
   * ====================================================================== */

  it('a loaded transport is NOT a change: the hull is on the field and counts', () => {
    // The passenger stops being counted; the hull it rides in never was
    // anything but a field unit, so no verdict moves. Written down because
    // "excluding passengers ends matches early" is the obvious worry and it is
    // wrong: every carrier in the roster is a non-harvester vehicle.
    const hull = rig.unit('mrdSkiff', P1, 200, 200);
    const rider = rig.unit('conscript', P1, 200, 200);
    sendInto(rig, rider, hull);
    rig.step(3);

    const st = rig.world.store;
    expect(st.flags[st.index(rider)] & EntityFlag.Garrisoned, 'aboard').not.toBe(0);

    const survey = surveyViability(rig.world, P1, makeViabilitySurvey());
    expect(survey.heldUnits).toBe(1);
    expect(survey.contestingUnits, 'the hull, and only the hull').toBe(1);
    expect(canContest(survey)).toBe(true);
    expect(isBeaten(survey)).toBe(false);
  });

  it('an army in the field is untouched — the loose reading still wins there', () => {
    rig.unit('conscript', P1, 200, 200);
    rig.unit('harvester', P1, 210, 200);
    const s = surveyViability(rig.world, P1, makeViabilitySurvey());
    expect(s.contestingUnits).toBe(1);
    expect(s.heldUnits).toBe(0);
    expect(isStranded(s), 'an army with no base is stranded').toBe(true);
    expect(isBeaten(s), 'but not beaten').toBe(false);
  });

  it('leaves hasAssets, isStranded and the wiped-out defeat byte-identical', () => {
    // The occupant is still `units`, so every predicate that reads `hasAssets`
    // sees exactly what it saw before. This is what keeps the stranded warning
    // firing at a player whose last squad is indoors, instead of the match
    // silently going quiet on them.
    const block = rig.civilian('civApartments', 120, 120);
    const man = rig.unit('conscript', P0, 120, 120);
    sendInto(rig, man, block);
    rig.step(2);

    const s = surveyViability(rig.world, P0, makeViabilitySurvey());
    expect(s.units).toBe(1);
    expect(s.buildings, 'the block flipped to him, so he owns it').toBe(1);
    expect(hasAssets(s)).toBe(true);
    expect(canRebuild(s)).toBe(false);
    expect(isStranded(s), 'warned, and the warning is what buys the grace').toBe(true);
    expect(describeViability(s)).toContain('held 1');
  });

  it('the SELL GUARD does not move: a carried MCV is still a way to rebuild', () => {
    // `canRebuild` is `Production.applySell`'s predicate. `constructionVehicles`
    // deliberately still counts a held unit — only infantry can garrison, so a
    // held MCV is necessarily inside a hull, which is a visible field vehicle.
    const hull = rig.unit('mrdArgosy', P0, 200, 200);
    const mcv = rig.unit('mcv', P0, 200, 200);
    sendInto(rig, mcv, hull);
    rig.step(3);

    const st = rig.world.store;
    expect(st.flags[st.index(mcv)] & EntityFlag.Garrisoned, 'aboard').not.toBe(0);
    const s = surveyViability(rig.world, P0, makeViabilitySurvey());
    expect(s.constructionVehicles).toBe(1);
    expect(canRebuild(s), 'unload, deploy, rebuild — still a real comeback').toBe(true);
    expect(isBeaten(s)).toBe(false);
  });

  /* ======================================================================
   * 3. AIRCRAFT — the opposite hypothesis, and it is false
   * ====================================================================== */

  it('there is no aircraft EntityKind, so every flyer is already surveyed', () => {
    const flyers = UNITS.filter((u) => u.locomotor === Locomotor.Air);
    expect(flyers.length, 'the roster has gunships').toBeGreaterThan(0);
    for (const u of flyers) {
      expect(u.kind, `${u.key} must be a Vehicle for Viability to see it`)
        .toBe(EntityKind.Vehicle);
    }
  });

  it('an opponent down to gunships is NOT declared beaten', () => {
    const kestrel = UNITS.find((u) => u.locomotor === Locomotor.Air);
    expect(kestrel).not.toBeUndefined();
    rig.unit((kestrel as { key: string }).key, P1, 200, 200);

    const s = surveyViability(rig.world, P1, makeViabilitySurvey());
    expect(s.contestingUnits, 'a flyer is a field unit').toBe(1);
    expect(s.heldUnits).toBe(0);
    expect(isBeaten(s)).toBe(false);
  });

  /* ======================================================================
   * 4. THE OTHER SEATS AT THE TABLE
   * ====================================================================== */

  it('victory needs EVERY hostile beaten, not the first one', () => {
    const world = rig.world;
    world.addPlayer(Faction.Meridian, 'Third', false, false);
    const P2 = 3 as PlayerId;

    rig.building('conyard', P0, 40, 40);
    rig.unit('grizzly', P0, 60, 60);
    // One hostile is wiped; the other still has a base.
    const survivorYard = rig.building('conyard', P2, 200, 200);

    let polls = 0;
    for (; polls < POLL_BUDGET; polls++) outcomeSystem.frame?.(frameCtx(polls));
    expect(shell.ends, 'one live opponent keeps the match open').toHaveLength(0);

    destroy(rig, survivorYard);
    flush(rig);
    for (let n = 0; n < POLL_BUDGET && shell.ends.length === 0; n++) {
      outcomeSystem.frame?.(frameCtx(polls + n));
    }
    expect(shell.ends).toEqual([true]);
  });

  it('a Gaia civilian block is never a live opponent', () => {
    rig.building('conyard', P0, 40, 40);
    rig.unit('grizzly', P0, 60, 60);
    rig.civilian('civApartments', 120, 120);
    rig.civilian('civOilDerrick', 130, 120);
    // Nothing hostile exists at all besides an empty P1 seat.
    expect(pollUntilResolved()).toBeGreaterThan(0);
    expect(shell.ends, 'the neutral hamlet is not an enemy').toEqual([true]);
  });

  it('a burning wreck is not an asset', () => {
    const st = rig.world.store;
    st.alloc(EntityKind.Wreck, -1, P1, Faction.Soviets, 200, 0, 200);
    rig.world.spatial.rebuild();
    const s = surveyViability(rig.world, P1, makeViabilitySurvey());
    expect(s.units).toBe(0);
    expect(s.buildings).toBe(0);
    expect(isBeaten(s)).toBe(true);
  });

  /* ======================================================================
   * 5. THE ORPHAN BRANCHES — pinned, because they are what makes §1 safe
   *
   * CLAUDE.md names `GarrisonService.recover`'s no-host branch as the fix for
   * a unit left `Alive | Garrisoned | Immobilized` with nothing holding it.
   * Both services must clear that state within one tick, because under the new
   * rule such a unit contests nothing — so if the repair ever stopped working,
   * the failure would be a player quietly losing a squad rather than a match
   * that will not end, and this is where that shows up.
   * ====================================================================== */

  it('an occupant whose host handle is stale is put back on the ground', () => {
    const block = rig.civilian('civApartments', 120, 120);
    const man = rig.unit('conscript', P1, 120, 120);
    sendInto(rig, man, block);
    rig.step(2);

    const st = rig.world.store;
    // Erase the host WITHOUT the death path, which is what a save load and a
    // `flushDestroyed` race both look like from the occupant's side.
    st.markDead(block);
    st.flushDestroyed();
    st.garrisonId[st.index(man)] = 0;
    rig.step(1);

    const i = st.index(man);
    expect(i, 'not deleted').toBeGreaterThanOrEqual(0);
    expect(st.flags[i] & EntityFlag.Garrisoned, 'no longer indoors').toBe(0);
    expect(st.flags[i] & EntityFlag.Immobilized, 'and free to move').toBe(0);
    expect(rig.garrison.stats.stranded).toBe(1);

    const s = surveyViability(rig.world, P1, makeViabilitySurvey());
    expect(s.contestingUnits, 'back in the field, back in the count').toBe(1);
  });

  it('a passenger whose hull is gone is put down or drowned, never left aboard', () => {
    // `Transport.strand` tries `setDownNear` first and only sinks him when
    // nothing in reach is standable — so on a LAND carrier the right answer is
    // a live man on the ground, and the assertion is about the state he must
    // NOT be left in rather than about which of the two repairs fired.
    const hull = rig.unit('mrdSkiff', P1, 200, 200);
    const rider = rig.unit('conscript', P1, 200, 200);
    sendInto(rig, rider, hull);
    rig.step(3);
    const st = rig.world.store;
    expect(st.flags[st.index(rider)] & EntityFlag.Garrisoned, 'aboard').not.toBe(0);

    st.markDead(hull);
    st.flushDestroyed();
    rig.step(1);

    const i = st.index(rider);
    const gone = i < 0 || st.isPendingDestroy(rider);
    if (!gone) {
      expect(st.flags[i] & EntityFlag.Garrisoned, 'no longer aboard').toBe(0);
      expect(st.flags[i] & EntityFlag.Immobilized, 'and free to move').toBe(0);
      expect(st.carrierId[i], 'and claimed by nothing').toBe(0);
      const s = surveyViability(rig.world, P1, makeViabilitySurvey());
      expect(s.contestingUnits, 'back in the field, back in the count').toBe(1);
      expect(s.heldUnits).toBe(0);
    } else {
      expect(rig.transport.stats.drowned, 'and he was accounted for').toBe(1);
    }
  });
});
