/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/sell-lockout.spec.ts
 * ============================================================================
 * THE BUG: "i accidently sold my base at start, now i cant do nothing".
 *
 * Selling the Construction Yard was legal, instantaneous, unconfirmed and
 * irreversible. `Shell.pollOutcome` declares defeat only at ZERO living assets,
 * so a player left holding harvesters was neither able to act nor able to lose.
 * `match:ended` had two subscribers and no emitter, so nothing said anything.
 *
 * Three layers are pinned here, and each one alone is enough to make the
 * reported session recoverable:
 *
 *   1. `Viability` — one definition of "can this player still play".
 *   2. `Production.applySell` — refuses exactly the sell that strands you, and
 *      nothing else. Verified for the AI as well, because a guard that only
 *      binds the human is a balance change.
 *   3. `game/outcome.system.ts` — a match that CANNOT be won resolves inside a
 *      bounded number of frames, and `match:ended` fires exactly once.
 *
 * All headless. Nothing here constructs a renderer or reads a clock.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { EntityFlag, Faction } from '../src/core/types';
import type { EntityId, GameEvents, PlayerId, RenderContext, SimContext } from '../src/core/types';
import { SIM_DT } from '../src/core/config';

import {
  ProductionCatalog, ProductionService, setProduction,
} from '../src/sim/Production';
import { bindDeployTables } from '../src/sim/Deploy';
import {
  canRebuild, canContest, describeViability, hasAssets, isBeaten, isStranded,
  makeViabilitySurvey, surveyViability,
} from '../src/sim/Viability';

import outcomeSystem, { OUTCOME } from '../src/game/outcome.system';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  sold: EntityId[];
  tick: number;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const production = new ProductionService(world, channels, catalog);
  // `Viability`'s default construction-vehicle probe is `Deploy.isDeployable`,
  // which resolves a content key through the production singleton. Publishing
  // the service is what makes an MCV recognisable as an MCV in a headless run.
  setProduction(production);
  bindDeployTables(null);

  const sold: EntityId[] = [];
  channels.events.on('building:sold', (ev) => { sold.push(ev.id); });

  return { world, channels, production, sold, tick: 0 };
}

function step(rig: Rig, steps = 1): void {
  const rng = new Rng(99);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng };
    rig.production.tick(s);
    rig.world.spatial.rebuild();
  }
}

function building(rig: Rig, key: string, cx: number, cz: number, player: PlayerId = P0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnBuilding(rig.world.player(player), entry!, cx, cz, 1);
}

function unit(rig: Rig, key: string, x: number, z: number, player: PlayerId = P0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnUnit(rig.world.player(player), entry!, x, z, 0);
}

function alive(rig: Rig, id: EntityId): boolean {
  return rig.world.store.index(id) >= 0 && !rig.world.store.isPendingDestroy(id);
}

/** Install a fake `globalThis.__vmHud` and hand back the toasts it receives. */
function captureToasts(): string[] {
  const out: string[] = [];
  (globalThis as unknown as Record<string, unknown>).__vmHud = {
    toast(kind: string, key: string, title: string, detail = '') {
      out.push(`${kind}|${key}|${title}|${detail}`);
    },
  };
  return out;
}

function clearHud(): void {
  delete (globalThis as unknown as Record<string, unknown>).__vmHud;
}

/* ==========================================================================
 * 1. Viability — the shared definition
 * ========================================================================== */

describe('Viability', () => {
  beforeEach(() => { clearHud(); });

  it('counts a Construction Yard as production and a Refinery as not', () => {
    const rig = makeRig();
    building(rig, 'conyard', 40, 40);
    building(rig, 'refinery', 46, 40);
    step(rig, 1);

    const s = surveyViability(rig.world, P0, makeViabilitySurvey());
    expect(s.buildings).toBe(2);
    expect(s.producers).toBe(1);
    expect(canRebuild(s)).toBe(true);
  });

  it('a refinery and a harvester are not a way back into the game', () => {
    const rig = makeRig();
    building(rig, 'refinery', 46, 40);
    unit(rig, 'harvester', 200, 200);
    step(rig, 1);

    const s = surveyViability(rig.world, P0, makeViabilitySurvey());
    expect(hasAssets(s)).toBe(true);
    expect(canRebuild(s)).toBe(false);
    expect(canContest(s)).toBe(false);
    expect(isStranded(s)).toBe(true);
    expect(isBeaten(s)).toBe(true);
    expect(describeViability(s)).toContain('BEATEN');
  });

  it('an army with no base is stranded but NOT beaten', () => {
    const rig = makeRig();
    unit(rig, 'gi', 100, 100);
    unit(rig, 'harvester', 200, 200);
    step(rig, 1);

    const s = surveyViability(rig.world, P0, makeViabilitySurvey());
    expect(s.contestingUnits).toBe(1);
    expect(isStranded(s)).toBe(true);
    expect(isBeaten(s)).toBe(false);
  });

  it('an MCV counts as a way to rebuild', () => {
    const rig = makeRig();
    unit(rig, 'mcv', 120, 120);
    step(rig, 1);

    const s = surveyViability(rig.world, P0, makeViabilitySurvey());
    expect(s.constructionVehicles).toBe(1);
    expect(canRebuild(s)).toBe(true);
    expect(isBeaten(s)).toBe(false);
  });

  it('`ignore` answers the question the sell guard actually asks', () => {
    const rig = makeRig();
    const yard = building(rig, 'conyard', 40, 40);
    step(rig, 1);

    const s = makeViabilitySurvey();
    expect(canRebuild(surveyViability(rig.world, P0, s))).toBe(true);
    expect(canRebuild(surveyViability(rig.world, P0, s, { ignore: yard }))).toBe(false);
  });
});

/* ==========================================================================
 * 2. The sell guard
 * ========================================================================== */

describe('selling the last way to build', () => {
  beforeEach(() => { clearHud(); });
  afterEach(() => { clearHud(); });

  it('REFUSES the sell that strands the player, and says why', () => {
    const rig = makeRig();
    const toasts = captureToasts();
    const yard = building(rig, 'conyard', 40, 40);
    unit(rig, 'harvester', 200, 200);
    step(rig, 1);

    const before = rig.world.player(P0).credits;
    rig.production.sell(P0, yard);
    step(rig, 1);

    expect(alive(rig, yard)).toBe(true);
    expect(rig.sold).toHaveLength(0);
    expect(rig.world.player(P0).credits).toBe(before);
    expect(toasts.join('\n')).toContain('Cannot sell');
    // Still playable: the survey the outcome poll reads says so too.
    expect(canRebuild(surveyViability(rig.world, P0, makeViabilitySurvey()))).toBe(true);
  });

  it('binds the AI identically — the guard is in the sim, not in the HUD', () => {
    const rig = makeRig();
    const toasts = captureToasts();
    const yard = building(rig, 'conyard', 60, 60, P1);
    step(rig, 1);

    rig.production.sell(P1, yard);
    step(rig, 1);

    expect(alive(rig, yard)).toBe(true);
    expect(rig.sold).toHaveLength(0);
    // No toast: the refusal is real, but it is not the local player's business.
    expect(toasts).toHaveLength(0);
  });

  it('ALLOWS the sell when another factory can still build', () => {
    const rig = makeRig();
    const yard = building(rig, 'conyard', 40, 40);
    building(rig, 'warFactory', 46, 40);
    step(rig, 1);

    rig.production.sell(P0, yard);
    step(rig, 1);

    expect(alive(rig, yard)).toBe(false);
    expect(rig.sold).toEqual([yard]);
  });

  it('ALLOWS the sell when an MCV is parked — the classic redeploy still works', () => {
    const rig = makeRig();
    const yard = building(rig, 'conyard', 40, 40);
    unit(rig, 'mcv', 200, 200);
    step(rig, 1);

    rig.production.sell(P0, yard);
    step(rig, 1);

    expect(alive(rig, yard)).toBe(false);
    expect(rig.sold).toEqual([yard]);
  });

  it('leaves every other sell alone — a Power Plant next to the last yard still goes', () => {
    const rig = makeRig();
    building(rig, 'conyard', 40, 40);
    const plant = building(rig, 'powerPlant', 46, 40);
    step(rig, 1);

    rig.production.sell(P0, plant);
    step(rig, 1);

    expect(alive(rig, plant)).toBe(false);
    expect(rig.sold).toEqual([plant]);
  });

  it('two sells in one tick cannot slip the last producer out together', () => {
    // The guard surveys the LIVE store, not last tick's census, so the second
    // sell of the tick sees that the first one already took the War Factory.
    const rig = makeRig();
    const yard = building(rig, 'conyard', 40, 40);
    const factory = building(rig, 'warFactory', 46, 40);
    step(rig, 1);

    rig.production.sell(P0, factory);
    rig.production.sell(P0, yard);
    step(rig, 1);

    expect(rig.sold).toEqual([factory]);
    expect(alive(rig, factory)).toBe(false);
    expect(alive(rig, yard)).toBe(true);
  });

  it('does not refuse a player who could ALREADY not build', () => {
    // One Power Plant and no yard: the sell takes nothing away, so saying no
    // would be pure paternalism — and the refund is the only value they have
    // left. This is `tests/features.spec.ts`'s sell-survivors world.
    const rig = makeRig();
    const plant = building(rig, 'powerPlant', 46, 40);
    step(rig, 1);
    expect(canRebuild(surveyViability(rig.world, P0, makeViabilitySurvey()))).toBe(false);

    rig.production.sell(P0, plant);
    step(rig, 1);
    expect(rig.sold).toEqual([plant]);
  });

  it('does not fire when the service was never published as the singleton', () => {
    // `setProduction(null)` is the `?shot=` harness and half the test suite. The
    // guard must still resolve producers, or it would refuse every sell in the
    // game. It answers from the service's OWN catalog, not the singleton.
    const rig = makeRig();
    setProduction(null);
    building(rig, 'conyard', 40, 40);
    const plant = building(rig, 'powerPlant', 46, 40);
    step(rig, 1);

    rig.production.sell(P0, plant);
    step(rig, 1);
    expect(rig.sold).toEqual([plant]);

    setProduction(rig.production);
  });
});

/* ==========================================================================
 * 3. The match resolves, and says so
 * ========================================================================== */

interface FakeShell {
  state: string;
  ends: boolean[];
  getState(): string;
  endMatch(r: { won: boolean }): void;
}

function installShell(): FakeShell {
  const shell: FakeShell = {
    state: 'playing',
    ends: [],
    getState() { return this.state; },
    endMatch(r) { this.ends.push(r.won); this.state = 'ended'; },
  };
  (globalThis as unknown as Record<string, unknown>).__vmShell = shell;
  return shell;
}

function frameCtx(dt: number, n: number): RenderContext {
  return { dt, time: n * dt, alpha: 1, frame: n, quality: 0 } as RenderContext;
}

describe('an unwinnable match resolves', () => {
  let rig: Rig;
  let shell: FakeShell;
  let ended: GameEvents['match:ended'][];
  let simTime = 0;

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
    captureToasts();
    outcomeSystem.init?.();
  });

  afterEach(() => {
    outcomeSystem.dispose?.();
    setGameContext(null);
    delete (globalThis as unknown as Record<string, unknown>).__vmShell;
    clearHud();
  });

  /** Run frames until `stop` says so, or fail after `limit`. */
  function run(limit: number, stop: () => boolean): number {
    for (let n = 0; n < limit; n++) {
      outcomeSystem.frame?.(frameCtx(OUTCOME.pollSeconds, n));
      if (stop()) return n + 1;
    }
    return -1;
  }

  it('THE REPORTED SESSION: no production, only harvesters -> defeat, bounded', () => {
    building(rig, 'conyard', 60, 60, P1);
    unit(rig, 'harvester', 200, 200, P0);
    unit(rig, 'harvester', 210, 200, P0);
    step(rig, 1);

    // Two polls per second; the grace is `beatenGraceSeconds`, so this must land
    // well inside twice that many frames. A generous bound that still fails
    // loudly if the rule stops firing at all.
    const frames = run(
      Math.ceil(OUTCOME.beatenGraceSeconds / OUTCOME.pollSeconds) * 3,
      () => shell.ends.length > 0,
    );
    expect(frames).toBeGreaterThan(0);
    expect(shell.ends).toEqual([false]);
    expect(shell.state).toBe('ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].localWon).toBe(false);
    expect(ended[0].durationSec).toBeCloseTo(simTime, 5);
  });

  it('warns instead of ending while the player still has something to fight with', () => {
    const toasts = captureToasts();
    building(rig, 'conyard', 60, 60, P1);
    unit(rig, 'gi', 200, 200, P0);
    step(rig, 1);

    const frames = run(
      Math.ceil(OUTCOME.beatenGraceSeconds / OUTCOME.pollSeconds) * 3,
      () => shell.ends.length > 0,
    );
    expect(frames).toBe(-1);
    expect(shell.ends).toHaveLength(0);
    expect(ended).toHaveLength(0);
    // Silence is the actual bug. There must be a warning on screen.
    expect(toasts.join('\n')).toContain('No production');
  });

  it('says nothing at all inside the start grace', () => {
    simTime = OUTCOME.startGraceSeconds - 1;
    building(rig, 'conyard', 60, 60, P1);
    unit(rig, 'harvester', 200, 200, P0);
    step(rig, 1);

    run(40, () => shell.ends.length > 0);
    expect(shell.ends).toHaveLength(0);
    expect(ended).toHaveLength(0);
  });

  it('declares victory when the last hostile can neither build nor fight', () => {
    building(rig, 'conyard', 40, 40, P0);
    unit(rig, 'harvester', 300, 300, P1);
    step(rig, 1);

    const frames = run(
      Math.ceil(OUTCOME.beatenGraceSeconds / OUTCOME.pollSeconds) * 3,
      () => shell.ends.length > 0,
    );
    expect(frames).toBeGreaterThan(0);
    expect(shell.ends).toEqual([true]);
    expect(ended[0].localWon).toBe(true);
    expect(ended[0].winner).toBe(rig.world.localPlayer);
  });

  it('emits match:ended for an end IT DID NOT CALL, with the right verdict', () => {
    // The shell's own `pollOutcome` gets there first. Before this module there
    // was no emitter at all, so the announcer and the win music never played.
    building(rig, 'conyard', 40, 40, P0);
    step(rig, 1);
    outcomeSystem.frame?.(frameCtx(OUTCOME.pollSeconds, 0));
    expect(ended).toHaveLength(0);

    shell.state = 'ended';
    outcomeSystem.frame?.(frameCtx(OUTCOME.pollSeconds, 1));

    expect(ended).toHaveLength(1);
    // Local holds a yard, the enemy holds nothing: a win, inferred live rather
    // than read from a cache that could predate the last kill.
    expect(ended[0].localWon).toBe(true);
  });

  it('emits match:ended exactly once', () => {
    building(rig, 'conyard', 60, 60, P1);
    unit(rig, 'harvester', 200, 200, P0);
    step(rig, 1);

    run(Math.ceil(OUTCOME.beatenGraceSeconds / OUTCOME.pollSeconds) * 3,
      () => shell.ends.length > 0);
    for (let n = 0; n < 10; n++) outcomeSystem.frame?.(frameCtx(OUTCOME.pollSeconds, 100 + n));

    expect(ended).toHaveLength(1);
    expect(shell.ends).toHaveLength(1);
  });

  it('stands down completely for a tutorial run', () => {
    (globalThis as unknown as Record<string, unknown>).__vmTutorial = {};
    try {
      building(rig, 'conyard', 60, 60, P1);
      unit(rig, 'harvester', 200, 200, P0);
      step(rig, 1);
      run(40, () => shell.ends.length > 0);
      expect(shell.ends).toHaveLength(0);
    } finally {
      delete (globalThis as unknown as Record<string, unknown>).__vmTutorial;
    }
  });

  it('does nothing without a shell — the ?shot= harness is untouched', () => {
    delete (globalThis as unknown as Record<string, unknown>).__vmShell;
    building(rig, 'conyard', 60, 60, P1);
    unit(rig, 'harvester', 200, 200, P0);
    step(rig, 1);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      for (let n = 0; n < 40; n++) outcomeSystem.frame?.(frameCtx(OUTCOME.pollSeconds, n));
      expect(ended).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

/* ==========================================================================
 * 4. The flag the guard leans on
 * ========================================================================== */

describe('producer flags', () => {
  it('every fallback structure that produces carries IsBuilder or IsFactory', () => {
    const rig = makeRig();
    const st = rig.world.store;
    for (const entry of rig.production.catalog.entries) {
      if (entry.producesTabs.length === 0) continue;
      if (entry.kind !== 0 /* BuildKind.Building */) continue;
      // THE POWERS TAB PRODUCES NOTHING, so the structure that publishes it is
      // not a producer in the sense this guard means. A Command Post sells
      // commander powers — bits on the player, never entities — so it carries
      // neither flag deliberately: `IsFactory` would make `Viability` tell a
      // player down to one Command Post that they can still play, and it would
      // move the structure out of the power grid's first shed class, which is
      // the class the Powers tab is gated on. `Viability.defaultIsProducer`
      // makes the same exclusion from the other side.
      if (entry.producesTabs.every((t) => t === 4 /* BuildTab.Powers */)) continue;
      const id = rig.production.spawnBuilding(rig.world.player(P0), entry, 20, 20, 1);
      if (id === (0 as EntityId)) continue;
      const i = st.index(id);
      expect(
        st.flags[i] & (EntityFlag.IsBuilder | EntityFlag.IsFactory),
        `"${entry.key}" produces ${entry.producesTabs.length} tab(s) but carries neither flag`,
      ).not.toBe(0);
      st.markDead(id);
      st.flushDestroyed();
    }
  });
});
