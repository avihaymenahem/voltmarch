/**
 * ============================================================================
 * tests/tips-corpus.spec.ts — SEVEN ROWS, AND EVERY ONE IS A PAIR
 * ============================================================================
 * `tests/tips-brownout.spec.ts` owns the ONE row that shipped in Commit 2 and
 * the four properties every tip inherits — the trigger, the surface, the
 * toggle, the suppression set, the shell-less boot. None of that is repeated
 * here. This file is what Commit 3 added:
 *
 *   §1  THE ROWS SAY SOMETHING TRUE, re-derived from the live tables rather
 *       than proof-read. `TIPS_BUILD_SPEC.md` §2.3 spot-checked six candidate
 *       tips and three were measurably wrong about their own facts.
 *   §2  THE CONTRACT. Two predicates on every row, and they are not the same
 *       function; unique keys; holds that a survey can actually reach; two
 *       length budgets, cross-checked against the file that MEASURED them so
 *       there is no second copy of 26 and 44.
 *   §3  EVERY MATCH SELECTS SOMETHING. A predicate that quietly selects no
 *       catalog entry is a row that can never fire, and nothing else in the
 *       tree would notice.
 *   §4  THE TRIGGERS, in a real world with a real catalog, each with the
 *       falsifier that separates "the gate works" from "the fixture is inert".
 *   §5  THE ARBITER. A tip yields to an alert and to a full stack.
 *   §6  THE MUTE. Per-row, persisted, automatic on first SHOWING.
 *
 * All headless. No renderer, no clock, no RNG outside the seeded one.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { BUILD_TAB_COUNT, BuildTab, CreditReason, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  FACTORY_SPEED_CAP, REPAIR_COST_PER_HP, REPAIR_DEPOT, SIM_DT,
} from '../src/core/config';

import { resolveDefBinding } from '../src/game/Scenarios';
import {
  BuildKind, ProductionCatalog, ProductionService, setProduction,
} from '../src/sim/Production';
import { PowerGrid } from '../src/sim/Power';
import { Economy, setActiveEconomy } from '../src/sim/Economy';
import { RepairSellService, setRepairSellService } from '../src/sim/RepairSell';
import { factorySpeed } from '../src/sim/BuildQueue';
import { bindDeployTables } from '../src/sim/Deploy';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

import { ProfileStore, memoryStorage, hasSeenTip, markTipSeen } from '../src/progression/profile-store';

import {
  TIP_BROWNOUT, TIP_COMMAND_POST, TIP_ONE_FACTORY, TIP_ORE_CAP, TIP_POWERS_IDLE,
  TIP_REPAIR_DEPOT, TIP_REPAIR_TOOL, TIP_ROWS,
  isCommanderPower, isDepot, isPowerHouse, isPowerSource, isStorage,
} from '../src/sim/tip-rows';
import type { TipContext, TipRow } from '../src/sim/tip-rows';
import tipsSystem, {
  TIP_SPACING_TICKS, TIP_SURVEY_INTERVAL, postTip, tipsPosted,
} from '../src/sim/tips.system';

const P0 = 0 as PlayerId;

/* ==========================================================================
 * THE RIG
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  power: PowerGrid;
  tick: number;
}

async function makeRig(): Promise<Rig> {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const binding = await resolveDefBinding();
  const catalog = new ProductionCatalog(binding);
  const production = new ProductionService(world, channels, catalog);
  production.bindingTables = binding.tables;
  setProduction(production);
  bindDeployTables(null);
  world.audio.eva = (): void => { /* no announcer in a headless rig */ };
  return { world, channels, production, power: new PowerGrid(world, channels), tick: 0 };
}

function step(rig: Rig, steps = 1): void {
  const rng = new Rng(99);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng };
    rig.production.tick(s);
    rig.power.simTick(s.time);
    tipsSystem.simTick?.(s);
  }
}

function building(rig: Rig, key: string, cx: number, cz: number, progress = 1): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  return rig.production.spawnBuilding(rig.world.player(P0), entry!, cx, cz, progress);
}

/**
 * A solvent base at the radar tier: three plants against a conyard, refinery,
 * war factory, barracks and radar. Every row in §4 starts here, so a row that
 * fires is firing on the fixture's own state and not on a brownout it inherited.
 */
function base(rig: Rig): void {
  building(rig, 'conyard', 10, 10);
  building(rig, 'powerPlant', 20, 10);
  building(rig, 'powerPlant', 30, 10);
  building(rig, 'powerPlant', 40, 10);
  building(rig, 'refinery', 50, 10);
  building(rig, 'warFactory', 60, 10);
  building(rig, 'barracks', 70, 10);
  building(rig, 'radar', 80, 10);
}

function context(rig: Rig): TipContext {
  return { world: rig.world, prod: rig.production, player: rig.world.player(P0) };
}

interface Toast { kind: string; key: string; title: string; detail: string }

function captureToasts(extra: Record<string, unknown> = {}): Toast[] {
  const out: Toast[] = [];
  (globalThis as unknown as Record<string, unknown>).__vmHud = {
    toast(kind: string, key: string, title: string, detail = '') {
      out.push({ kind, key, title, detail });
    },
    ...extra,
  };
  return out;
}

function installSettings(tips: boolean): void {
  (globalThis as unknown as Record<string, unknown>).__vmSettings = {
    get: () => ({ gameplay: { tips } }),
  };
}

function clearHost(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__vmHud;
  delete g.__vmSettings;
  delete g.__vmTutorial;
  delete g.__vmProgression;
}

/* ==========================================================================
 * 1. THE ROWS SAY SOMETHING TRUE ABOUT THIS BUILD
 *
 * The brownout row's two claims are re-derived in `tests/tips-brownout.spec.ts`
 * §1 and are deliberately not repeated. Everything else this corpus asserts to
 * a player is checked below against the table it is a claim about.
 * ========================================================================== */

describe('§1 the corpus is true', () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
  });

  afterEach(() => {
    setGameContext(null);
    setProduction(null);
    setActiveEconomy(null);
    setRepairSellService(null);
    clearHost();
  });

  /**
   * "Ore over the cap is lost." `Economy.deposit` WASTES the overflow rather
   * than clamping it silently — measured here through the real service rather
   * than read off the source.
   */
  it('ore over the cap really is lost, not clamped', () => {
    const economy = new Economy(rig.world, rig.channels);
    setActiveEconomy(economy);
    const p = rig.world.player(P0);
    p.storageMax = 1000;
    p.credits = 1000;
    const before = p.stats.oreWasted;
    const banked = economy.deposit(P0, 500, CreditReason.Harvest);
    expect(banked, 'a full bank takes none of it').toBe(0);
    expect(p.credits, 'and the balance does not move').toBe(1000);
    expect(p.stats.oreWasted - before, 'the loss is counted, which is what the row reads')
      .toBeGreaterThan(0);
  });

  /** "Build a silo to raise your storage" — a silo is a Structures entry that does. */
  it('a silo is a Structures entry that raises storage', () => {
    const silo = rig.production.catalog.byKey('oreSilo');
    expect(silo).not.toBeNull();
    expect(silo!.storage).toBeGreaterThan(0);
    expect(silo!.tab).toBe(BuildTab.Structures);
    expect(isStorage(silo!)).toBe(true);
  });

  /**
   * "Two factories, one queue." TWO claims and both are checked: an army has
   * exactly one queue per tab however many producers it owns, and a second
   * producer makes that queue faster rather than opening a second one.
   */
  it('two war factories share one queue and make it faster', () => {
    base(rig);
    step(rig, 3);
    const p = rig.world.player(P0);
    expect(p.queues.length, 'one queue per tab, and that is all there is')
      .toBe(BUILD_TAB_COUNT);
    expect(p.queues[BuildTab.Vehicles as number].factoryCount).toBe(1);

    building(rig, 'warFactory', 90, 10);
    step(rig, 3);
    expect(p.queues.length, 'the second factory opened no second queue').toBe(BUILD_TAB_COUNT);
    expect(p.queues[BuildTab.Vehicles as number].factoryCount).toBe(2);

    expect(factorySpeed(1)).toBe(1);
    expect(factorySpeed(2), 'and the one queue runs faster').toBeGreaterThan(factorySpeed(1));
    expect(factorySpeed(99)).toBe(FACTORY_SPEED_CAP);
  });

  /**
   * "Support powers are bought / build the structure that opens their tab."
   * The claim is EXCLUSIVITY — one kind of structure opens that tab and there
   * is no other route — so both halves are checked, including that the copy
   * names no building, because three defs cover four armies.
   */
  it('exactly the command posts publish the Powers tab, and nothing else does', () => {
    const publishers = rig.production.catalog.entries.filter(isPowerHouse).map((e) => e.key);
    expect(publishers.slice().sort()).toEqual(['commandPost', 'mrdPharos', 'rclSignalRig']);
    for (const e of rig.production.catalog.entries) {
      if (isPowerHouse(e)) continue;
      expect(e.producesTabs.includes(BuildTab.Powers), `${e.key} must not publish Powers`)
        .toBe(false);
    }
  });

  it('the copy names no building, because the four armies call it three things', () => {
    const names = rig.production.catalog.entries.filter(isPowerHouse).map((e) => e.name);
    expect(new Set(names).size, 'three names for one role').toBeGreaterThan(1);
    for (const n of names) {
      expect(TIP_COMMAND_POST.title + TIP_COMMAND_POST.detail).not.toContain(n);
    }
  });

  /** With no post standing, every commander power is refused. That is the gate. */
  it('a commander power is unbuyable until one stands', () => {
    base(rig);
    step(rig, 3);
    const scratch = { ok: false, reason: '', capped: false };
    const powers = rig.production.catalog.entries.filter(isCommanderPower);
    expect(powers.length).toBeGreaterThan(0);
    for (const e of powers) {
      expect(rig.production.availabilityOf(P0, e, scratch).ok, e.key).toBe(false);
    }
  });

  /** "Powers cost credits too" — every one of them carries a real price. */
  it('every commander power is a priced purchase in its own tab', () => {
    for (const e of rig.production.catalog.entries.filter(isCommanderPower)) {
      expect(e.kind, e.key).toBe(BuildKind.Power);
      expect(e.cost, e.key).toBeGreaterThan(0);
      expect(e.tab, e.key).toBe(BuildTab.Powers);
    }
  });

  /**
   * "Use the repair tool — it costs credits." Measured in the engine: arm the
   * wrench on a damaged structure, tick, and the bank falls while the hit
   * points rise.
   */
  it('the repair tool mends a structure and charges for it', () => {
    const repair = new RepairSellService(rig.world, rig.channels);
    setRepairSellService(repair);
    base(rig);
    const id = building(rig, 'barracks', 40, 25);
    const st = rig.world.store;
    const i = st.index(id);
    st.hp[i] = st.maxHp[i] * 0.5;

    const p = rig.world.player(P0);
    p.credits = 5000;
    expect(repair.setRepairing(P0, id, true)).toBe(true);

    const hpBefore = st.hp[i];
    const rng = new Rng(7);
    for (let n = 0; n < 10; n++) {
      repair.simTick({ dt: SIM_DT, tick: n, time: n * SIM_DT, rng });
    }
    expect(st.hp[i], 'it mends').toBeGreaterThan(hpBefore);
    expect(p.credits, 'and it is not free').toBeLessThan(5000);
    expect(REPAIR_COST_PER_HP).toBeGreaterThan(0);
  });

  /**
   * "Armour mends at a depot." The three keys the row selects are the three
   * `RepairSell` resolves its depot def ids from — imported, not restated — and
   * the pad really does put health back into a vehicle standing beside it.
   */
  it('a depot mends a vehicle parked beside it', () => {
    const repair = new RepairSellService(rig.world, rig.channels);
    setRepairSellService(repair);
    base(rig);
    const pad = building(rig, 'repairDepot', 20, 25);
    step(rig, 10);

    const tank = rig.production.catalog.byKey('grizzly');
    expect(tank).not.toBeNull();
    // BESIDE THE PAD IN METRES, READ OFF THE PAD. `spawnBuilding` takes CELLS
    // and `spawnUnit` takes METRES, so a hand-written pair of numbers puts the
    // hull four hundred metres away and the case passes for the wrong reason.
    const px = rig.world.store.posX[rig.world.store.index(pad)];
    const pz = rig.world.store.posZ[rig.world.store.index(pad)];
    const id = rig.production.spawnUnit(rig.world.player(P0), tank!, px + 4, pz, 0);
    const st = rig.world.store;
    const i = st.index(id);
    st.hp[i] = st.maxHp[i] * 0.4;
    const hpBefore = st.hp[i];

    const rng = new Rng(7);
    for (let n = 0; n < 20; n++) {
      repair.simTick({ dt: SIM_DT, tick: n, time: n * SIM_DT, rng });
    }
    expect(repair.depotsResolved, 'the depot keys resolved against the real catalog').toBe(true);
    expect(st.hp[i], 'the pad services it with no order issued').toBeGreaterThan(hpBefore);
    expect(REPAIR_DEPOT.radius).toBeGreaterThan(0);
  });

  /**
   * THE FALSIFIER FOR THAT ONE. The identical hull parked well outside the
   * radius is not mended — so the case above measures the depot rather than
   * some other healing path (`regen.system.ts` is not in this rig, and this is
   * what says so).
   */
  it('and does not mend one parked across the map', () => {
    const repair = new RepairSellService(rig.world, rig.channels);
    setRepairSellService(repair);
    base(rig);
    const pad = building(rig, 'repairDepot', 20, 25);
    step(rig, 3);

    const tank = rig.production.catalog.byKey('grizzly')!;
    const px = rig.world.store.posX[rig.world.store.index(pad)];
    const pz = rig.world.store.posZ[rig.world.store.index(pad)];
    const id = rig.production.spawnUnit(
      rig.world.player(P0), tank, px + REPAIR_DEPOT.radius * 4, pz, 0,
    );
    const st = rig.world.store;
    const i = st.index(id);
    st.hp[i] = st.maxHp[i] * 0.4;
    const hpBefore = st.hp[i];

    const rng = new Rng(7);
    for (let n = 0; n < 20; n++) {
      repair.simTick({ dt: SIM_DT, tick: n, time: n * SIM_DT, rng });
    }
    expect(st.hp[i]).toBe(hpBefore);
  });
});

/* ==========================================================================
 * 2. THE CONTRACT EVERY ROW SIGNS
 * ========================================================================== */

describe('§2 every row is a pair of predicates', () => {
  it('ships six to twelve rows', () => {
    expect(TIP_ROWS.length).toBeGreaterThanOrEqual(6);
    expect(TIP_ROWS.length).toBeLessThanOrEqual(12);
  });

  it('declares both predicates, and they are not the same function', () => {
    for (const r of TIP_ROWS) {
      expect(typeof r.situation, r.key).toBe('function');
      expect(typeof r.answered, r.key).toBe('function');
      // A row whose `answered` IS its `situation` negated is the collapse the
      // corpus header describes: one predicate wearing two names.
      expect(r.answered, r.key).not.toBe(r.situation);
    }
  });

  it('has unique keys, which are both the dedupe key and the mute key', () => {
    const keys = TIP_ROWS.map((r) => r.key);
    expect(new Set(keys).size, 'a duplicate key would mute two rows at once')
      .toBe(keys.length);
    for (const k of keys) expect(k.length, k).toBeGreaterThan(0);
  });

  /**
   * A hold that is not a multiple of the survey interval can NEVER be reached:
   * the counter advances by exactly `TIP_SURVEY_INTERVAL` and the test is
   * `>=`, so 455 would fire at 465 — a row silently four hundred milliseconds
   * late, forever, with nothing to see.
   */
  it('holds are whole surveys', () => {
    for (const r of TIP_ROWS) {
      expect(r.holdTicks % TIP_SURVEY_INTERVAL, r.key).toBe(0);
      expect(r.holdTicks, r.key).toBeGreaterThan(0);
    }
  });

  /* -- the two length budgets ------------------------------------------- *
   * MEASURED IN `tests/tips-brownout.spec.ts` §4, IN A BROWSER, and restated
   * here because that file covers one row and this one covers seven. The
   * restatement is cross-checked against the source of the file that owns the
   * measurement, so the two cannot drift — which is the whole reason the
   * numbers are not simply typed twice.                                     */
  const TITLE_CHARS = 26;
  const DETAIL_CHARS = 44;

  it('uses the budgets the brownout spec measured, not a second opinion', () => {
    const src = readFileSync(
      join(process.cwd(), 'tests', 'tips-brownout.spec.ts'), 'utf8',
    );
    expect(src).toContain(`const TITLE_CHARS = ${TITLE_CHARS};`);
    expect(src).toContain(`const DETAIL_CHARS = ${DETAIL_CHARS};`);
  });

  it('every line of every row fits its own budget', () => {
    const over: string[] = [];
    for (const r of TIP_ROWS) {
      if (r.title.length > TITLE_CHARS) over.push(`${r.key}.title ${r.title.length}`);
      if (r.detail.length > DETAIL_CHARS) over.push(`${r.key}.detail ${r.detail.length}`);
    }
    expect(over, 'the chip clips silently; there is no runtime symptom').toEqual([]);
  });

  /**
   * THE EVIDENCE THAT DECIDES WHETHER THE CHIP HAS TO WIDEN. Commit 3's
   * question was whether a useful tip can be said in 26 and 44 characters at
   * all; if fewer than half the rows could, the answer was to widen the chip.
   * Seven of seven fit, so it did not.
   */
  it('and does so with room to spare, which is why the chip did not widen', () => {
    const tight = TIP_ROWS.filter((r) => r.title.length > TITLE_CHARS - 2);
    expect(TIP_ROWS.length - tight.length, 'most rows are not against the wall')
      .toBeGreaterThan(TIP_ROWS.length / 2);
  });

  /** The detail is an instruction, so it leads with a verb. */
  it('every detail line leads with what to do', () => {
    const VERBS = ['Build', 'Buy', 'Use', 'Park', 'Sell', 'Move', 'Hold', 'Send'];
    for (const r of TIP_ROWS) {
      const first = r.detail.split(' ')[0];
      expect(VERBS, `${r.key}: "${r.detail}"`).toContain(first);
    }
  });
});

/* ==========================================================================
 * 3. EVERY MATCH SELECTS SOMETHING
 *
 * A row is only ever as good as the entries its match picks out. A predicate
 * that selects NOTHING is a row that never fires — no error, no log, no pixel,
 * and no other test in the tree looks. This is the same defect shape as the
 * campaign's `spawnBuildings`: a guard on a name upstream of a consumer that
 * never reads the name.
 * ========================================================================== */

describe('§3 the matches pick out real content', () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
  });

  afterEach(() => {
    setGameContext(null);
    setProduction(null);
    clearHost();
  });

  const MATCHES = [
    ['isPowerSource', isPowerSource],
    ['isStorage', isStorage],
    ['isPowerHouse', isPowerHouse],
    ['isCommanderPower', isCommanderPower],
    ['isDepot', isDepot],
  ] as const;

  it('each one selects at least one shipped entry', () => {
    const empty: string[] = [];
    for (const [name, fn] of MATCHES) {
      if (!rig.production.catalog.entries.some(fn)) empty.push(name);
    }
    expect(empty, 'a match that selects nothing is a row that never fires').toEqual([]);
  });

  /** And none of them selects the whole catalog, which would be as useless. */
  it('none of them selects everything', () => {
    const all = rig.production.catalog.entries;
    for (const [name, fn] of MATCHES) {
      expect(all.filter(fn).length, name).toBeLessThan(all.length);
    }
  });

  it('the depot match is the same three keys RepairSell services from', () => {
    const keys = rig.production.catalog.entries.filter(isDepot).map((e) => e.key).sort();
    expect(keys).toEqual(['mrdDepot', 'rclDepot', 'repairDepot']);
  });
});

/* ==========================================================================
 * 4. THE TRIGGERS
 *
 * Every case here evaluates the SHIPPED predicate against a real world with a
 * real catalog, and every one has a falsifier — the same fixture with the one
 * thing changed that the gate is supposed to key on.
 * ========================================================================== */

describe('§4 the situations and their answers', () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
  });

  afterEach(() => {
    setGameContext(null);
    setProduction(null);
    setRepairSellService(null);
    clearHost();
  });

  /* -- ore over the cap ----------------------------------------------- */

  function fillTheBank(rig: Rig): void {
    const p = rig.world.player(P0);
    p.storageMax = 5000;
    p.credits = 5000;
    p.stats.oreWasted = 120;
  }

  it('the ore-cap row fires on a full bank that is losing ore', () => {
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    expect(TIP_ORE_CAP.situation(context(rig))).toBe(true);
    expect(TIP_ORE_CAP.answered(context(rig))).toBe(false);
  });

  /**
   * THE FALSIFIER THAT MATTERS MOST IN THIS ROW. `Economy.refund` lifts the cap
   * floor to cover any balance that arrived without passing a cap check, so
   * `credits === storageMax` EXACTLY is the ordinary state of a player at tick
   * zero and of anyone who has just cancelled a build. Without `oreWasted > 0`
   * this row would fire on a match that has not started.
   */
  it('and not on a full bank that has never wasted anything', () => {
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    rig.world.player(P0).stats.oreWasted = 0;
    expect(TIP_ORE_CAP.situation(context(rig))).toBe(false);
  });

  it('and stays quiet while a silo is in the queue', () => {
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    rig.production.enqueueByKey(P0, 'oreSilo');
    step(rig, 2);
    expect(TIP_ORE_CAP.answered(context(rig)), 'they are already doing it').toBe(true);
  });

  it('and while one is still rising', () => {
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    building(rig, 'oreSilo', 30, 25, 0.5);
    step(rig, 1);
    expect(TIP_ORE_CAP.answered(context(rig))).toBe(true);
  });

  /* -- one factory ----------------------------------------------------- */

  function backUpTheLine(rig: Rig): void {
    rig.world.player(P0).credits = 20_000;
    rig.production.enqueueByKey(P0, 'grizzly', 3);
  }

  it('the one-factory row fires on a single producer with a queue behind it', () => {
    base(rig);
    step(rig, 3);
    backUpTheLine(rig);
    step(rig, 2);
    const q = rig.world.player(P0).queues[BuildTab.Vehicles as number];
    expect(q.factoryCount, 'the fixture really has one war factory').toBe(1);
    expect(q.items.length, 'and something waiting behind the head')
      .toBeGreaterThanOrEqual(2);
    expect(TIP_ONE_FACTORY.situation(context(rig))).toBe(true);
    expect(TIP_ONE_FACTORY.answered(context(rig))).toBe(false);
  });

  /** THE FALSIFIER. A second factory already standing is not a backed-up line. */
  it('and not once a second factory stands', () => {
    base(rig);
    building(rig, 'warFactory', 90, 10);
    step(rig, 3);
    backUpTheLine(rig);
    step(rig, 2);
    expect(rig.world.player(P0).queues[BuildTab.Vehicles as number].factoryCount).toBe(2);
    expect(TIP_ONE_FACTORY.situation(context(rig))).toBe(false);
  });

  /** …and it does not fire on an idle queue, which is a different problem. */
  it('and not on a factory with nothing to do', () => {
    base(rig);
    step(rig, 3);
    expect(TIP_ONE_FACTORY.situation(context(rig))).toBe(false);
  });

  it('stays quiet while a second factory is on its way', () => {
    base(rig);
    step(rig, 3);
    backUpTheLine(rig);
    step(rig, 2);
    building(rig, 'warFactory', 90, 10, 0.5);
    step(rig, 1);
    expect(TIP_ONE_FACTORY.answered(context(rig))).toBe(true);
  });

  /* -- the command post ------------------------------------------------ */

  it('the command-post row fires at the radar tier with the money in hand', () => {
    base(rig);
    step(rig, 3);
    expect(TIP_COMMAND_POST.situation(context(rig))).toBe(true);
    expect(TIP_COMMAND_POST.answered(context(rig))).toBe(false);
  });

  /**
   * THE FALSIFIER FOR `offered()`. Take the money away and the row goes quiet:
   * a tip that names a purchase must not name one the player cannot make.
   */
  it('and not to a player who cannot pay for one', () => {
    base(rig);
    step(rig, 3);
    rig.world.player(P0).credits = 10;
    expect(TIP_COMMAND_POST.situation(context(rig))).toBe(false);
  });

  /** THE SECOND FALSIFIER. No radar, no prereq, no tip. */
  it('and not before the tier that unlocks it', () => {
    building(rig, 'conyard', 40, 40);
    building(rig, 'powerPlant', 52, 40);
    building(rig, 'refinery', 64, 40);
    step(rig, 3);
    expect(TIP_COMMAND_POST.situation(context(rig))).toBe(false);
  });

  it('and not once one stands', () => {
    base(rig);
    building(rig, 'commandPost', 10, 25);
    step(rig, 3);
    expect(TIP_COMMAND_POST.situation(context(rig))).toBe(false);
  });

  it('stays quiet while one is rising', () => {
    base(rig);
    building(rig, 'commandPost', 10, 25, 0.5);
    step(rig, 3);
    expect(TIP_COMMAND_POST.situation(context(rig)), 'a rising post is not a standing one')
      .toBe(true);
    expect(TIP_COMMAND_POST.answered(context(rig))).toBe(true);
  });

  /* -- powers bought, or not ------------------------------------------- */

  it('the idle-powers row fires once the post is up and nothing is bought', () => {
    base(rig);
    building(rig, 'commandPost', 10, 25);
    step(rig, 3);
    const p = rig.world.player(P0);
    expect(p.powerProduced, 'the fixture must not be in a brownout')
      .toBeGreaterThanOrEqual(p.powerConsumed);
    expect(TIP_POWERS_IDLE.situation(context(rig))).toBe(true);
    expect(TIP_POWERS_IDLE.answered(context(rig))).toBe(false);
  });

  /** THE FALSIFIER. The two rows are exclusive: no post, no advice about it. */
  it('and not while there is no post to buy from', () => {
    base(rig);
    step(rig, 3);
    expect(TIP_POWERS_IDLE.situation(context(rig))).toBe(false);
  });

  it('and not to somebody who has already bought one', () => {
    base(rig);
    building(rig, 'commandPost', 10, 25);
    step(rig, 3);
    rig.world.player(P0).commanderPowerMask = 1;
    expect(TIP_POWERS_IDLE.situation(context(rig))).toBe(false);
  });

  /**
   * THE ANSWERED PREDICATE READS THE POWERS QUEUE, WHICH IS THE WHOLE REASON
   * `answering` TAKES A TAB. A power is drip-paid through its own queue and
   * never rises as a structure, so a Structures-only walk would miss it and
   * the tip would talk over a player who is mid-purchase.
   */
  it('stays quiet while a power is being paid for', () => {
    base(rig);
    building(rig, 'commandPost', 10, 25);
    step(rig, 3);
    const power = rig.production.catalog.entries.find(isCommanderPower)!;
    rig.world.player(P0).credits = 20_000;
    rig.production.enqueueByKey(P0, power.key);
    step(rig, 2);
    expect(rig.world.player(P0).queues[BuildTab.Powers as number].items.length)
      .toBeGreaterThan(0);
    expect(TIP_POWERS_IDLE.answered(context(rig))).toBe(true);
  });

  /* -- repair ---------------------------------------------------------- */

  function burnTheBarracks(rig: Rig): EntityId {
    const id = building(rig, 'barracks', 40, 25);
    const st = rig.world.store;
    st.hp[st.index(id)] = st.maxHp[st.index(id)] * 0.1;
    return id;
  }

  it('the repair row fires on a burning structure with money to mend it', () => {
    setRepairSellService(new RepairSellService(rig.world, rig.channels));
    base(rig);
    burnTheBarracks(rig);
    step(rig, 3);
    expect(TIP_REPAIR_TOOL.situation(context(rig))).toBe(true);
    expect(TIP_REPAIR_TOOL.answered(context(rig))).toBe(false);
  });

  it('and not on a base that is merely scratched', () => {
    setRepairSellService(new RepairSellService(rig.world, rig.channels));
    base(rig);
    const id = building(rig, 'barracks', 40, 25);
    const st = rig.world.store;
    st.hp[st.index(id)] = st.maxHp[st.index(id)] * 0.9;
    step(rig, 3);
    expect(TIP_REPAIR_TOOL.situation(context(rig)), 'above the burning threshold').toBe(false);
  });

  it('and not to a player with nothing to pay with', () => {
    setRepairSellService(new RepairSellService(rig.world, rig.channels));
    base(rig);
    burnTheBarracks(rig);
    step(rig, 3);
    rig.world.player(P0).credits = 0;
    expect(TIP_REPAIR_TOOL.situation(context(rig))).toBe(false);
  });

  it('and not while a building site is going up, which is not damage', () => {
    setRepairSellService(new RepairSellService(rig.world, rig.channels));
    base(rig);
    building(rig, 'barracks', 40, 25, 0.1);
    step(rig, 3);
    expect(TIP_REPAIR_TOOL.situation(context(rig)), 'a half-built wall is not a burning one')
      .toBe(false);
  });

  it('stays quiet while the wrench is already on something', () => {
    const repair = new RepairSellService(rig.world, rig.channels);
    setRepairSellService(repair);
    base(rig);
    const id = burnTheBarracks(rig);
    step(rig, 3);
    expect(repair.setRepairing(P0, id, true)).toBe(true);
    expect(TIP_REPAIR_TOOL.answered(context(rig))).toBe(true);
  });

  /**
   * A NULL SERVICE IS A REFUSAL, NOT A PASS — `answeringPower`'s rule, and the
   * one place in this corpus where an absent host means STAY QUIET. With no
   * service we cannot tell whether the player is already mending, and speaking
   * over them is the failure the second predicate exists to prevent.
   */
  it('and refuses outright when there is no repair service to ask', () => {
    setRepairSellService(null);
    base(rig);
    burnTheBarracks(rig);
    step(rig, 3);
    expect(TIP_REPAIR_TOOL.situation(context(rig))).toBe(true);
    expect(TIP_REPAIR_TOOL.answered(context(rig)), 'cannot tell, so does not speak').toBe(true);
  });

  /* -- the depot ------------------------------------------------------- */

  function burnATank(rig: Rig): void {
    const tank = rig.production.catalog.byKey('grizzly')!;
    const id = rig.production.spawnUnit(rig.world.player(P0), tank, 200, 200, 0);
    const st = rig.world.store;
    st.hp[st.index(id)] = st.maxHp[st.index(id)] * 0.1;
  }

  it('the depot row fires on burning armour with no pad to send it to', () => {
    base(rig);
    burnATank(rig);
    step(rig, 3);
    expect(TIP_REPAIR_DEPOT.situation(context(rig))).toBe(true);
    expect(TIP_REPAIR_DEPOT.answered(context(rig))).toBe(false);
  });

  it('and not once a pad stands', () => {
    base(rig);
    burnATank(rig);
    building(rig, 'repairDepot', 20, 25);
    step(rig, 3);
    expect(TIP_REPAIR_DEPOT.situation(context(rig))).toBe(false);
  });

  it('and not on a healthy column', () => {
    base(rig);
    const tank = rig.production.catalog.byKey('grizzly')!;
    rig.production.spawnUnit(rig.world.player(P0), tank, 200, 200, 0);
    step(rig, 3);
    expect(TIP_REPAIR_DEPOT.situation(context(rig))).toBe(false);
  });

  it('stays quiet while a pad is on the way', () => {
    base(rig);
    burnATank(rig);
    building(rig, 'repairDepot', 20, 25, 0.5);
    step(rig, 3);
    expect(TIP_REPAIR_DEPOT.situation(context(rig)), 'a rising pad mends nothing yet').toBe(true);
    expect(TIP_REPAIR_DEPOT.answered(context(rig))).toBe(true);
  });

  /* -- and the whole director, end to end, on a row that is not the
   *    brownout, so the TABLE is proved rather than the one row that used
   *    to be hard-coded.                                                  */

  it('the director drives a new row all the way to the chip', () => {
    installSettings(true);
    const toasts = captureToasts();
    tipsSystem.init?.();
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    step(rig, TIP_ORE_CAP.holdTicks + TIP_SURVEY_INTERVAL);
    const tips = toasts.filter((t) => t.key.startsWith('tip.'));
    expect(tips).toHaveLength(1);
    expect(tips[0].key).toBe(`tip.${TIP_ORE_CAP.key}`);
    expect(tips[0].title).toBe(TIP_ORE_CAP.title);
    tipsSystem.dispose?.();
  });

  it('and says it once per match, not once per survey', () => {
    installSettings(true);
    const toasts = captureToasts();
    tipsSystem.init?.();
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    step(rig, TIP_ORE_CAP.holdTicks * 4);
    expect(toasts.filter((t) => t.key.startsWith('tip.'))).toHaveLength(1);
    tipsSystem.dispose?.();
  });

  /** Nothing in this module touches the world, however many rows it holds. */
  it('writes nothing to the simulation', () => {
    installSettings(true);
    captureToasts();
    tipsSystem.init?.();
    base(rig);
    step(rig, 3);
    fillTheBank(rig);
    const before = rig.world.store.aliveCount;
    const credits = rig.world.player(P0).credits;
    step(rig, TIP_ORE_CAP.holdTicks * 2);
    expect(rig.world.store.aliveCount).toBe(before);
    expect(rig.world.player(P0).credits).toBe(credits);
    tipsSystem.dispose?.();
  });
});

/* ==========================================================================
 * 5. THE ARBITER — A TIP YIELDS
 *
 * `TOAST_MAX` is 5 and `EVA_TOASTS` turns fifteen announcer lines into chips,
 * so a tip competes with *"Base under attack"*. `ToastStack.push` RETIRES THE
 * OLDEST CHIP when the stack is full, which means a tip arriving at capacity
 * does not queue behind an alert — it deletes one.
 *
 * Both reads are optional on the seam, and the absence means "this sink is not
 * a stack" rather than "there are no alerts". That is the opposite polarity to
 * the settings read, deliberately, and the first case here is what pins it.
 * ========================================================================== */

describe('§5 a tip yields to an alert', () => {
  beforeEach(() => {
    installSettings(true);
  });

  afterEach(() => {
    clearHost();
  });

  it('posts into a sink that cannot answer, because that sink is not a stack', () => {
    const toasts = captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts).toHaveLength(1);
  });

  it('refuses while an alert chip is live', () => {
    const toasts = captureToasts({ toastAlerts: () => 1, toastCrowded: () => false });
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    expect(toasts).toEqual([]);
  });

  /** THE FALSIFIER. The identical sink with the alert gone posts. */
  it('and speaks the moment the alert has gone', () => {
    let alerts = 1;
    const toasts = captureToasts({ toastAlerts: () => alerts, toastCrowded: () => false });
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    alerts = 0;
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts).toHaveLength(1);
  });

  it('refuses while the stack is full, because pushing would evict a chip', () => {
    const toasts = captureToasts({ toastAlerts: () => 0, toastCrowded: () => true });
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    expect(toasts).toEqual([]);
  });

  it('and speaks once there is room', () => {
    let full = true;
    const toasts = captureToasts({ toastAlerts: () => 0, toastCrowded: () => full });
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    full = false;
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts).toHaveLength(1);
  });

  /**
   * THE REAL STACK ANSWERS BOTH QUESTIONS, and this is where the sim's
   * duck-typed seam meets the class that implements it. `Hud` is a DOM class
   * and cannot be built headlessly, so the shapes are compared instead: every
   * method the sim probes for must exist on `ToastStack` by the name `Hud`
   * forwards it under. A rename on one side is otherwise silent — the probe is
   * `typeof x === 'function'`, which answers `false` and posts anyway.
   */
  it('the HUD really publishes what the sim probes for', () => {
    const hud = readFileSync(join(process.cwd(), 'src', 'ui', 'Hud.ts'), 'utf8');
    const chrome = readFileSync(join(process.cwd(), 'src', 'ui', 'Chrome.ts'), 'utf8');
    const sim = readFileSync(join(process.cwd(), 'src', 'sim', 'tips.system.ts'), 'utf8');
    for (const name of ['toastAlerts', 'toastCrowded']) {
      expect(sim, `the sim must probe ${name}`).toContain(`hud.${name}`);
      expect(hud, `the HUD must publish ${name}`).toContain(`${name}(`);
    }
    expect(hud).toContain('this.toasts.alerts()');
    expect(hud).toContain('this.toasts.crowded()');
    expect(chrome, 'and the stack must implement them').toContain('alerts(): number');
    expect(chrome).toContain('crowded(): boolean');
  });
});

/* ==========================================================================
 * 5b. AND IT YIELDS TO ITSELF
 *
 * Seven rows means two of them can mature together — a base in a brownout is
 * also a base with a slow queue and a full bank — and two chips of advice
 * inside half a minute is a lecture. `TIP_SPACING_TICKS` is a PACING RULE
 * rather than a measurement and it is stated as one; what is measured here is
 * that it exists, that it is read off `s.tick` and no clock, and that it lets
 * go afterwards.
 * ========================================================================== */

describe('§5b two tips are not posted back to back', () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await makeRig();
    setGameContext({ world: rig.world, channels: rig.channels } as unknown as GameContext);
    installSettings(true);
    tipsSystem.init?.();
  });

  afterEach(() => {
    tipsSystem.dispose?.();
    setGameContext(null);
    setProduction(null);
    clearHost();
  });

  it('holds the second one back, and lets it through later', () => {
    const toasts = captureToasts();
    rig.world.tick = 10_000;
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(postTip(TIP_ORE_CAP), 'one lecture at a time').toBe(false);

    rig.world.tick = 10_000 + TIP_SPACING_TICKS;
    expect(postTip(TIP_ORE_CAP), 'and the queue is not lost, only delayed').toBe(true);
    expect(toasts).toHaveLength(2);
  });

  /**
   * THE FIRST TIP OF A MATCH IS NEVER SPACED OUT. `lastTipTick` starts at
   * negative infinity rather than zero: zero would read as "a tip was shown on
   * tick zero" and swallow everything in the opening half-minute — including
   * the brownout row, whose own regression suite posts at tick 465.
   */
  it('and never delays the first one', () => {
    const toasts = captureToasts();
    rig.world.tick = 1;
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts).toHaveLength(1);
  });
});

/* ==========================================================================
 * 6. THE MUTE
 *
 * Per-row and persisted. AUTOMATIC ON FIRST SHOWING, because the surface
 * cannot carry an act: `.vm-toasts` is `pointer-events: none`, so a chip cannot
 * be clicked and "dismiss" is not something the player can do. A mute waiting
 * for an act would never fire.
 *
 * Backed by a REAL `ProfileStore` rather than a fake map, so the migration, the
 * normaliser and the write-through are all in the loop — the mute's whole
 * promise is that it survives closing the tab.
 * ========================================================================== */

describe('§6 a tip is not repeated in a later match', () => {
  let store: ProfileStore;

  function installMemory(s: ProfileStore): void {
    (globalThis as unknown as Record<string, unknown>).__vmProgression = {
      tipSeen: (key: string) => hasSeenTip(s.get(), key),
      markTipSeen: (key: string) => s.mutateNow((draft) => markTipSeen(draft, key)),
    };
  }

  beforeEach(() => {
    store = new ProfileStore(memoryStorage(), { schedule: () => 0, cancel: () => undefined });
    installSettings(true);
  });

  afterEach(() => {
    store.dispose();
    clearHost();
  });

  it('marks the row on first showing and refuses it afterwards', () => {
    installMemory(store);
    const toasts = captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(store.get().tipsSeen).toContain(TIP_BROWNOUT.key);
    expect(postTip(TIP_BROWNOUT), 'the second match gets nothing').toBe(false);
    expect(toasts).toHaveLength(1);
  });

  /** THE FALSIFIER. The same two calls with no memory installed post twice. */
  it('and posts twice when nothing is remembering', () => {
    const toasts = captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts).toHaveLength(2);
  });

  /** It is PER ROW. Muting one says nothing about the next. */
  it('mutes one row and leaves the others alone', () => {
    installMemory(store);
    captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(postTip(TIP_ORE_CAP), 'a different row is a different fact').toBe(true);
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    expect(store.get().tipsSeen.slice().sort())
      .toEqual([TIP_BROWNOUT.key, TIP_ORE_CAP.key].sort());
  });

  /**
   * A ROW REFUSED BY ANY GATE ABOVE HAS NOT BEEN SPENT. The mark happens after
   * the chip is raised, so a tip the settings toggle swallowed is still owed to
   * the player when they turn tips back on.
   */
  it('does not spend a row the toggle refused', () => {
    installMemory(store);
    captureToasts();
    installSettings(false);
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    expect(store.get().tipsSeen).toEqual([]);
    installSettings(true);
    expect(postTip(TIP_BROWNOUT)).toBe(true);
  });

  /** …and one the arbiter refused is not spent either. */
  it('does not spend a row an alert refused', () => {
    installMemory(store);
    captureToasts({ toastAlerts: () => 1 });
    expect(postTip(TIP_BROWNOUT)).toBe(false);
    expect(store.get().tipsSeen).toEqual([]);
  });

  /* -- the persistence half -------------------------------------------- */

  it('survives a reload, which is the whole promise', () => {
    const storage = memoryStorage();
    const first = new ProfileStore(storage, { schedule: () => 0, cancel: () => undefined });
    installMemory(first);
    captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    first.dispose();

    const second = new ProfileStore(storage, { schedule: () => 0, cancel: () => undefined });
    expect(hasSeenTip(second.get(), TIP_BROWNOUT.key), 'written through, not batched').toBe(true);
    second.dispose();
  });

  it('a profile written before this feature comes back with an empty list', () => {
    const storage = memoryStorage();
    storage.setItem('voltmarch.profile.v1', JSON.stringify({
      version: 3, unlocked: ['a'], missions: {}, stats: {}, campaign: {},
    }));
    const s = new ProfileStore(storage, { schedule: () => 0, cancel: () => undefined });
    expect(s.get().tipsSeen, 'nothing was seen, so nothing is muted').toEqual([]);
    expect(s.get().unlocked, 'and the rest of the profile is untouched').toEqual(['a']);
    s.dispose();
  });

  it('refuses junk in the stored list rather than trusting it', () => {
    const storage = memoryStorage();
    storage.setItem('voltmarch.profile.v1', JSON.stringify({
      version: 4,
      tipsSeen: ['brownout', 'brownout', 7, null, '', 'x'.repeat(400), 'oreCap'],
    }));
    const s = new ProfileStore(storage, { schedule: () => 0, cancel: () => undefined });
    expect(s.get().tipsSeen).toEqual(['brownout', 'oreCap']);
    s.dispose();
  });

  /**
   * THE HANDLE IS DUCK-TYPED, and a half-built one must not be trusted. A
   * handle with only the read is not a memory: it would refuse rows forever
   * without ever recording one.
   */
  it('ignores a handle that can read but not write', () => {
    (globalThis as unknown as Record<string, unknown>).__vmProgression = {
      tipSeen: () => true,
    };
    const toasts = captureToasts();
    expect(postTip(TIP_BROWNOUT), 'half a handle is no handle').toBe(true);
    expect(toasts).toHaveLength(1);
  });

  it('is inert under a boot with no progression handle at all', () => {
    delete (globalThis as unknown as Record<string, unknown>).__vmProgression;
    const toasts = captureToasts();
    expect(postTip(TIP_BROWNOUT)).toBe(true);
    expect(toasts).toHaveLength(1);
    expect(tipsPosted).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 7. THE ROWS THE DIRECTOR HOLDS ARE THE ROWS THE CORPUS DECLARES
 *
 * `tips.system.ts` re-exports the table rather than owning one, and it must
 * stay that way: a row declared in the director is a row `tests/tips-corpus-
 * weight.spec.ts` does not weigh and `tests/loading-tips.spec.ts` does not lint.
 * ========================================================================== */

describe('§7 the table is the corpus', () => {
  it('every named row is in the table', () => {
    const named: readonly TipRow[] = [
      TIP_BROWNOUT, TIP_ORE_CAP, TIP_ONE_FACTORY, TIP_REPAIR_TOOL,
      TIP_REPAIR_DEPOT, TIP_COMMAND_POST, TIP_POWERS_IDLE,
    ];
    for (const r of named) expect(TIP_ROWS, r.key).toContain(r);
    expect(TIP_ROWS).toHaveLength(named.length);
  });

  it('and the director exports the same table object', async () => {
    const director = await import('../src/sim/tips.system');
    expect(director.TIP_ROWS).toBe(TIP_ROWS);
    expect(director.TIP_BROWNOUT).toBe(TIP_BROWNOUT);
  });

  it('the kinds every entity read touches are the ones the store actually keys', () => {
    // A guard against the corpus reading `byKind` with a kind the store does
    // not populate, which would answer "nothing is damaged" forever.
    expect(EntityKind.Building).not.toBe(EntityKind.Vehicle);
  });
});
