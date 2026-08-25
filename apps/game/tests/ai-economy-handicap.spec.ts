/**
 * ============================================================================
 * tests/ai-economy-handicap.spec.ts
 * ============================================================================
 * "Enemies are overpowered, they spawn troops faster than us, they build faster
 * than us. even on easy mode!"
 *
 * There was no per-item build-speed cheat to find, and there still is not:
 * `BuildQueue.advanceTab` computes `buildSpeedMul * factorySpeed(factoryCount)`
 * for both players out of the same two pure functions, and `buildTime` is a
 * property of the def. What the AI had was THROUGHPUT, and throughput did not
 * scale with the difficulty setting at all:
 *
 *   - `AI_DIFFICULTY[].resourceBonus` was 1.0 on Easy AND on Normal, so the
 *     bottom two rungs mined at exactly the player's rate with no handicap.
 *   - `AI_ECONOMY.maxHarvesters` (9) and `maxRefineries` (3) were single
 *     constants. An Easy AI ran the same economy as a Brutal one.
 *   - `AI_BUILD.desiredQueueDepth` (2) was a single constant, so every rung
 *     kept its queues equally full and never left a gap between units.
 *
 * Every knob that DID scale — reaction time, apm, aggression, composition,
 * creditFloor, maxDefense — governs when the AI attacks, how well it picks its
 * army, or how much concrete it pours. None of them touched the rate at which
 * credits arrive and turn into things. That is the whole report.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE LADDER IS MONOTONIC on all three new axes plus resourceBonus. A rung
 *     that mines faster than the one above it is a difficulty setting that lies.
 *   - EASY IS ACTUALLY HANDICAPPED. Strictly fewer harvesters, strictly fewer
 *     refineries, a shallower queue and a sub-1.0 mining rate — asserted as
 *     numbers, not as a ratio to something that could move with it.
 *   - THE WIRING IS LIVE. This is the case that matters, because the previous
 *     three passes over this AI all found the same defect: the field existed,
 *     `difficultyProfile()` copied it, and NOTHING READ IT. So each knob is
 *     asserted against a brain that is actually running.
 *   - THE HANDICAP IS ON HARVESTED INCOME ONLY. A refund or a sale must not be
 *     quietly shaved, or selling a building becomes a difficulty setting.
 *   - HARD AND BRUTAL ARE UNTOUCHED. This was a fix to the bottom of the
 *     ladder; a "nerf the AI" change that also nerfs Brutal is a different
 *     change that nobody asked for.
 *
 * Headless: no GL, no DOM, no `ctx()`.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, CommandKind, CreditReason, EntityFlag, EntityKind, Faction, UnitState,
} from '../src/core/types';
import type { Command, EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  AI_DIFFICULTY, AI_SKILL, BUILD_TAB_ORDER, CELL, MAX_QUEUE_DEPTH, SIM_DT, SIM_HZ,
} from '../src/core/config';
import { Rng } from '../src/core/math';
import { Economy } from '../src/sim/Economy';

import { AiBrain } from '../src/sim/AI';
import { BuildCatalog, BuildRole, difficultyProfile } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';

const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;
const RUNGS = [EASY, NORMAL, HARD, BRUTAL];

/** Turtle. Its `economy` of 1.1 keeps the harvester ratio above every cap. */
const TURTLE = 0;

function syntheticBinding(): DefLookup {
  const catalog = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0;
  let b = 0;
  for (const e of catalog.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

/* ========================================================================== */
/* Harness                                                                    */
/* ========================================================================== */

interface Harness {
  world: World;
  brain: AiBrain;
  catalog: BuildCatalog;
  /** Unit-tab ProductionStarts the brain has issued, by build role. */
  requested: BuildRole[];
  /** Peak simultaneous occupancy of each unit tab, as the brain sees it. */
  peakDepth: number[];
  step(ticks: number): void;
}

interface Options {
  difficulty: number;
  /** Complete queued items, so the brain's base actually grows. */
  complete?: boolean;
  /** Structures to hand it pre-built, by role. */
  refineries?: number;
  /** Harvesters to hand it, already mining. */
  harvesters?: number;
}

/**
 * An AI with a Construction Yard at (400,400), unlimited power and a bank that
 * never runs down.
 *
 * NOTHING HERE IS CHARGED FOR. These cases are about the CEILINGS the brain
 * imposes on itself, and a brain that stops buying harvesters because it ran
 * out of money proves nothing about `maxHarvesters`. The one thing the bank has
 * to stay under is `storageMax`, or the silo branch in `chooseBuild` outscores
 * the refinery branch and the refinery cap is never reached.
 */
function makeHarness(options: Options): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = options.difficulty;
  ai.aiPersonality = TURTLE;
  ai.credits = 400_000;
  ai.storageMax = 1e9;
  ai.powerProduced = 1e6;
  ai.powerConsumed = 0;

  const st = world.store;

  /**
   * `defId` and `power` are not decoration. `AiBrain.roleOfBuilding` resolves a
   * structure's role through `catalog.entryForBuilding(defId)` first and only
   * falls back to guessing from flags and footprint; a stand-in that stamps -1
   * leaves every tech lab classified `Unknown`, so the brain never believes it
   * owns one and paves the map with them.
   */
  function place(
    x: number, z: number, w: number, h: number, flags: number, power = 0, defId = -1,
  ): EntityId {
    const id = st.alloc(EntityKind.Building, defId, P_AI, Faction.Soviets, x, 0, z, 0);
    const i = st.index(id);
    st.flags[i] |= flags | EntityFlag.BlocksNav;
    st.powerDraw[i] = power;
    st.footprintW[i] = w; st.footprintH[i] = h;
    st.hp[i] = 2000; st.maxHp[i] = 2000;
    st.armorClass[i] = ArmorClass.Concrete;
    st.buildProgress[i] = 1;
    world.terrain.markOccupied(
      Math.floor(x / CELL) - ((w / 2) | 0), Math.floor(z / CELL) - ((h / 2) | 0), w, h, id,
    );
    return id;
  }

  /**
   * A harvester in `Harvesting` state. The state matters: `world.ore` is an
   * `EmptyOreField` in a headless world, so an IDLE harvester finds no ore, the
   * economy layer counts it starved, and `oreStarved` then zeroes
   * `wantHarvesters` outright — which would make every cap here look honoured
   * for entirely the wrong reason.
   */
  function harvester(x: number, z: number): EntityId {
    const id = st.alloc(EntityKind.Vehicle, -1, P_AI, Faction.Soviets, x, 0, z, 0);
    const i = st.index(id);
    st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | EntityFlag.IsHarvester;
    st.hp[i] = 300; st.maxHp[i] = 300; st.maxSpeed[i] = 6;
    st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
    st.state[i] = UnitState.Harvesting;
    return id;
  }

  /*
   * A yard, a power plant, a barracks and a war factory.
   *
   * The two producers are pre-built rather than left to the opening script for
   * a reason worth writing down: `chooseBuild` advances `openingIndex` BEFORE
   * `requestProduction` checks the action budget, so a step chosen on a tick
   * when the budget is still under 1 is consumed without being ordered. At 40
   * apm the Easy brain's first two build ticks land before it can afford a
   * single action, and it drops the head of its own opening. In a real match
   * the power-deficit interrupt rebuilds the plant and the chain recovers; in a
   * rig with unlimited power there is no interrupt, the barracks step then
   * waits forever on a prerequisite that will never be built, and every case
   * below would pass against a brain that had simply stopped playing.
   *
   * That is a separate defect from the one this file is about. It is not fixed
   * here — fixing it makes the AI stronger, which is the opposite of the report
   * that prompted this pass — and the rig steps around it instead.
   */
  place(400, 400, 3, 3, EntityFlag.IsBuilder | EntityFlag.IsFactory, -20);
  place(380, 400, 2, 2, 0, 100);
  place(424, 388, 2, 2, EntityFlag.IsFactory, -20);
  place(424, 412, 3, 2, EntityFlag.IsFactory, -40);
  for (let r = 0; r < (options.refineries ?? 0); r++) {
    place(376 + r * 16, 432, 3, 2, EntityFlag.IsRefinery, -30);
  }
  for (let k = 0; k < (options.harvesters ?? 0); k++) harvester(408 + k * 4, 416);

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, 9182);
  brain.attach(channels.events);

  const rng = new Rng(7);
  let tick = 0;
  const requested: BuildRole[] = [];
  const peakDepth = [0, 0, 0, 0];

  /* -- the stand-in production module -----------------------------------
   * Deliberately capped at MAX_QUEUE_DEPTH rather than at the AI's own
   * queueDepth: a stand-in that refuses the third item would hide a brain that
   * asked for it, and hiding that is the whole bug this file is about. */
  interface Item { defId: number; isBuilding: boolean; ticks: number; ready: boolean }
  // ONE SLOT PER BUILD TAB, derived. A four-element literal threw on
  // `queues[4].length` the day `BuildTab.Powers` landed — the same hard-coded
  // four that stopped the brain buying a commander power at all.
  const queues: Item[][] = BUILD_TAB_ORDER.map(() => []);

  function onStart(tab: number, defId: number): void {
    const entry = defId < 0 ? undefined
      : tab === 0 || tab === 1 ? catalog.entryForBuilding(defId) : catalog.entryForUnit(defId);
    if (entry === undefined) return;
    if (!entry.isBuilding) requested.push(entry.role);
    if (queues[tab].length >= MAX_QUEUE_DEPTH) return;
    queues[tab].push({ defId, isBuilding: entry.isBuilding, ticks: 24, ready: false });
    ai.queues[tab].items.push({
      defId, isBuilding: entry.isBuilding, progress: 0, spent: 0,
      cost: entry.cost, ready: false, onHold: false,
    });
    if (!entry.isBuilding && queues[tab].length > peakDepth[tab]) {
      peakDepth[tab] = queues[tab].length;
    }
    channels.events.emit('production:started', {
      player: P_AI, tab, defId, isBuilding: entry.isBuilding, cost: entry.cost,
    } as never);
  }

  function onPlace(defId: number, cx: number, cz: number): void {
    for (let tab = 0; tab < 4; tab++) {
      const k = queues[tab].findIndex((q) => q.defId === defId && q.ready);
      if (k < 0) continue;
      const entry = catalog.entryForBuilding(defId);
      if (entry === undefined) return;
      const x = (cx + entry.footprintW * 0.5) * CELL;
      const z = (cz + entry.footprintH * 0.5) * CELL;
      let flags = 0;
      if (entry.role === BuildRole.Refinery) flags = EntityFlag.IsRefinery;
      else if (entry.role === BuildRole.Radar) flags = EntityFlag.IsRadar;
      else if (entry.role === BuildRole.Barracks || entry.role === BuildRole.WarFactory) {
        flags = EntityFlag.IsFactory;
      } else if (entry.role === BuildRole.Defense || entry.role === BuildRole.AntiAir) {
        flags = EntityFlag.CanAttack;
      }
      const id = place(x, z, entry.footprintW, entry.footprintH, flags, entry.power, defId);
      queues[tab].splice(k, 1);
      ai.queues[tab].items.shift();
      channels.events.emit('building:completed', { id, defId, player: P_AI, x, z } as never);
      return;
    }
  }

  function advance(): void {
    for (let tab = 0; tab < 4; tab++) {
      const head = queues[tab][0];
      if (head === undefined || head.ready) continue;
      if (--head.ticks > 0) continue;
      head.ready = true;
      const entry = head.isBuilding
        ? catalog.entryForBuilding(head.defId) : catalog.entryForUnit(head.defId);
      if (entry === undefined) continue;
      channels.events.emit('production:ready', {
        player: P_AI, tab, defId: head.defId, isBuilding: head.isBuilding,
      } as never);
      if (head.isBuilding) continue;
      if (entry.role === BuildRole.Harvester) harvester(404, 420);
      queues[tab].shift();
      ai.queues[tab].items.shift();
    }
  }

  return {
    world, brain, catalog, requested, peakDepth,
    step(ticks: number): void {
      for (let n = 0; n < ticks; n++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        // The bank is topped back up every tick; see the note above.
        ai.credits = 400_000;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.spatial.rebuild();
        brain.tick(s);
        channels.commands.drain((c: Command) => {
          if (options.complete === false) return;
          if (c.kind === CommandKind.ProductionStart) onStart(c.tab as number, c.defId);
          else if (c.kind === CommandKind.PlaceBuilding) onPlace(c.defId, c.cx, c.cz);
        });
        if (options.complete !== false) advance();
      }
    },
  };
}

/* ========================================================================== */
/* 1. The table                                                               */
/* ========================================================================== */

describe('the economy handicap is a real ladder', () => {
  it('never lets a lower rung out-mine a higher one', () => {
    for (let i = 1; i < AI_DIFFICULTY.length; i++) {
      expect(
        AI_DIFFICULTY[i]!.resourceBonus,
        `${AI_DIFFICULTY[i]!.name} must not mine slower than ${AI_DIFFICULTY[i - 1]!.name}`,
      ).toBeGreaterThanOrEqual(AI_DIFFICULTY[i - 1]!.resourceBonus);
    }
  });

  it('never lets a lower rung run a bigger economy', () => {
    for (let i = 1; i < AI_SKILL.length; i++) {
      const lo = AI_SKILL[i - 1]!;
      const hi = AI_SKILL[i]!;
      expect(hi.maxHarvesters, 'harvesters').toBeGreaterThanOrEqual(lo.maxHarvesters);
      expect(hi.maxRefineries, 'refineries').toBeGreaterThanOrEqual(lo.maxRefineries);
      expect(hi.queueDepth, 'queue depth').toBeGreaterThanOrEqual(lo.queueDepth);
    }
  });

  it('handicaps Easy on every axis rather than technically sorting', () => {
    // Each of these is the difference between "the table is ordered" and "the
    // player can feel it". A ladder where Easy and Brutal differ by one
    // harvester is the flat ladder this file exists to stop coming back.
    expect(AI_DIFFICULTY[EASY]!.resourceBonus, 'Easy must mine slower than the player')
      .toBeLessThan(1);
    expect(AI_SKILL[EASY]!.maxHarvesters).toBeLessThan(AI_SKILL[BRUTAL]!.maxHarvesters - 2);
    expect(AI_SKILL[EASY]!.maxRefineries).toBeLessThan(AI_SKILL[BRUTAL]!.maxRefineries);
    expect(AI_SKILL[EASY]!.queueDepth).toBeLessThan(AI_SKILL[BRUTAL]!.queueDepth);
  });

  it('leaves Normal mining at exactly the player rate', () => {
    // The reference rung. Normal is toned down by fleet size, not by a mining
    // penalty, so "Normal" keeps meaning "no economic thumb on the scale".
    expect(AI_DIFFICULTY[NORMAL]!.resourceBonus).toBe(1.0);
  });

  it('leaves the top of the ladder exactly where it was', () => {
    // The report was about Easy. A change that also quietly nerfs Brutal is a
    // different change.
    for (const d of [HARD, BRUTAL]) {
      expect(AI_SKILL[d]!.maxHarvesters, AI_DIFFICULTY[d]!.name).toBe(9);
      expect(AI_SKILL[d]!.maxRefineries, AI_DIFFICULTY[d]!.name).toBe(3);
      expect(AI_SKILL[d]!.queueDepth, AI_DIFFICULTY[d]!.name).toBe(2);
    }
    expect(AI_DIFFICULTY[HARD]!.resourceBonus).toBe(1.15);
    expect(AI_DIFFICULTY[BRUTAL]!.resourceBonus).toBe(1.35);
  });
});

/* ========================================================================== */
/* 2. The trip through the profile                                            */
/* ========================================================================== */

describe('difficultyProfile carries the economy knobs', () => {
  it('copies all three for every rung', () => {
    for (const d of RUNGS) {
      const p = difficultyProfile(d);
      expect(p.maxHarvesters, `${p.name} harvesters`).toBe(AI_SKILL[d]!.maxHarvesters);
      expect(p.maxRefineries, `${p.name} refineries`).toBe(AI_SKILL[d]!.maxRefineries);
      expect(p.queueDepth, `${p.name} queue depth`).toBe(AI_SKILL[d]!.queueDepth);
    }
  });

  it('clamps an out-of-range index onto a real rung rather than undefined', () => {
    for (const bad of [-5, 99]) {
      const p = difficultyProfile(bad);
      expect(Number.isFinite(p.maxHarvesters)).toBe(true);
      expect(p.queueDepth).toBeGreaterThan(0);
    }
  });
});

/* ========================================================================== */
/* 3. The brain actually reads them                                           */
/* ========================================================================== */

describe('the brain honours its own harvester cap', () => {
  it('stops buying trucks at the Easy cap even with refineries and money for more', () => {
    // Three refineries at the Turtle ratio wants round(3 * 3 * 1.1) = 10
    // harvesters. Only `maxHarvesters` can stop it short of that.
    const h = makeHarness({ difficulty: EASY, refineries: 3, harvesters: 0 });
    h.step(SIM_HZ * 240);
    const owned = h.brain.harvesterSize;
    expect(owned, 'it must have bought SOME — a zero here proves nothing')
      .toBeGreaterThan(1);
    expect(owned, 'and stopped at the Easy cap').toBeLessThanOrEqual(AI_SKILL[EASY]!.maxHarvesters);
  });

  it('lets Brutal past the number that stops Easy', () => {
    const h = makeHarness({ difficulty: BRUTAL, refineries: 3, harvesters: 0 });
    h.step(SIM_HZ * 240);
    expect(h.brain.harvesterSize, 'Brutal must out-mine Easy, or the cap is decorative')
      .toBeGreaterThan(AI_SKILL[EASY]!.maxHarvesters);
    expect(h.brain.harvesterSize).toBeLessThanOrEqual(AI_SKILL[BRUTAL]!.maxHarvesters);
  });

  it('will not ask for another truck once an Easy brain is already at the cap', () => {
    // The direct form of the same claim: hand it a full fleet on tick zero and
    // watch it decline to buy. No accumulation, no timing, no ambiguity.
    const h = makeHarness({
      difficulty: EASY, refineries: 3, harvesters: AI_SKILL[EASY]!.maxHarvesters,
    });
    h.step(SIM_HZ * 120);
    expect(h.requested.filter((r) => r === BuildRole.Harvester).length).toBe(0);
  });

  it('DOES ask when the same fleet is handed to a Brutal brain', () => {
    // The control. Without it, a brain that simply never buys harvesters in
    // this rig would pass the case above.
    const h = makeHarness({
      difficulty: BRUTAL, refineries: 3, harvesters: AI_SKILL[EASY]!.maxHarvesters,
    });
    h.step(SIM_HZ * 120);
    expect(h.requested.filter((r) => r === BuildRole.Harvester).length).toBeGreaterThan(0);
  });
});

describe('the brain honours its own refinery cap', () => {
  it('plateaus an Easy base below a Brutal one', () => {
    const easy = makeHarness({ difficulty: EASY, harvesters: 1 });
    const brutal = makeHarness({ difficulty: BRUTAL, harvesters: 1 });
    easy.step(SIM_HZ * 300);
    brutal.step(SIM_HZ * 300);

    expect(easy.brain.refineryCount, 'Easy must still build an economy')
      .toBeGreaterThan(0);
    expect(easy.brain.refineryCount, 'but not past its cap')
      .toBeLessThanOrEqual(AI_SKILL[EASY]!.maxRefineries);
    expect(brutal.brain.refineryCount, 'and Brutal must out-build it')
      .toBeGreaterThan(easy.brain.refineryCount);
  });
});

describe('the brain honours its own queue depth', () => {
  it('keeps an Easy unit queue one deep and a Normal one two deep', () => {
    const easy = makeHarness({ difficulty: EASY, refineries: 2, harvesters: 3 });
    const normal = makeHarness({ difficulty: NORMAL, refineries: 2, harvesters: 3 });
    easy.step(SIM_HZ * 300);
    normal.step(SIM_HZ * 300);

    const deepest = (h: Harness): number => Math.max(...h.peakDepth);
    expect(deepest(easy), 'Easy must have queued something at all').toBeGreaterThan(0);
    expect(deepest(easy), 'and never stacked past its depth')
      .toBeLessThanOrEqual(AI_SKILL[EASY]!.queueDepth);
    expect(deepest(normal), 'Normal must stack deeper than Easy')
      .toBeGreaterThan(AI_SKILL[EASY]!.queueDepth);
  });
});

/* ========================================================================== */
/* 4. The economy spends the number the brain publishes                       */
/* ========================================================================== */

describe('the mining handicap reaches the credits column', () => {
  function rig(): { world: World; econ: Economy } {
    const world = new World();
    const channels = new Channels();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const p = world.player(P_AI);
    p.credits = 0;
    p.storageMax = 1e9;
    return { world, econ: new Economy(world, channels) };
  }

  it('publishes the table value out of the brain, unmodified', () => {
    // `ai.system.ts` hands `brain.resourceBonus` straight to
    // `Economy.setResourceBonus`. If the getter drifts from the table the whole
    // handicap silently reverts to 1.0.
    for (const d of RUNGS) {
      const world = new World();
      const channels = new Channels();
      world.addPlayer(Faction.Allies, 'Commander', true, true);
      world.addPlayer(Faction.Soviets, 'Opponent', false, false);
      world.player(P_AI).aiDifficulty = d;
      const brain = new AiBrain(world, channels.commands, new BuildCatalog(), P_AI, 1);
      expect(brain.resourceBonus, AI_DIFFICULTY[d]!.name).toBe(AI_DIFFICULTY[d]!.resourceBonus);
    }
  });

  it('banks less than was mined for an Easy AI', () => {
    const { world, econ } = rig();
    econ.setResourceBonus(P_AI, AI_DIFFICULTY[EASY]!.resourceBonus);
    econ.deposit(P_AI, 1000, CreditReason.Harvest);
    expect(world.player(P_AI).credits).toBeCloseTo(1000 * AI_DIFFICULTY[EASY]!.resourceBonus, 6);
  });

  it('survives the clamp — the Easy multiplier is inside the legal range', () => {
    // `setResourceBonus` clamps to [0.25, 4]. A table value outside that would
    // be silently rewritten and the test above would pass against the clamp
    // rather than against the table.
    const { econ } = rig();
    econ.setResourceBonus(P_AI, AI_DIFFICULTY[EASY]!.resourceBonus);
    expect(econ.resourceBonusOf(P_AI)).toBe(AI_DIFFICULTY[EASY]!.resourceBonus);
  });

  it('does not shave a refund or a sale', () => {
    // Selling a building must return the same fraction on every difficulty.
    // Scaling it would make the Easy AI's own buildings worth less than the
    // player's, which is not a difficulty setting, it is a bug.
    const { world, econ } = rig();
    econ.setResourceBonus(P_AI, AI_DIFFICULTY[EASY]!.resourceBonus);
    econ.deposit(P_AI, 1000, CreditReason.Sell);
    econ.deposit(P_AI, 500, CreditReason.Refund);
    expect(world.player(P_AI).credits).toBe(1500);
  });

  it('leaves an untouched player at 1.0', () => {
    const { world, econ } = rig();
    econ.deposit(P_AI, 1000, CreditReason.Harvest);
    expect(world.player(P_AI).credits).toBe(1000);
  });
});
