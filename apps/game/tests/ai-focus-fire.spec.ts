/**
 * ============================================================================
 * tests/ai-focus-fire.spec.ts — THE BRAIN NAMES A TARGET
 * ============================================================================
 * From a capability audit against the player's own verbs. The brain issued
 * seven order kinds and `OrderKind.Attack` was not one of them: every
 * engagement in the game's history was an `AttackMove`, which hands target
 * choice to `Targeting`'s automatic acquisition. That acquisition is per-unit
 * and range-first, so twelve hulls in a line spread their damage over
 * everything in front of them and finish nothing — which is what "0 skills"
 * and "one objective forever" both actually were.
 *
 * `AiBrain.focusFire` is the fix and `AI_FOCUS` is its doctrine. The group is
 * told what to kill; movement, stance and the existing group-level retreat do
 * the rest. There is no kiting, no per-unit repositioning and no target
 * juggling — deliberately, because micro is where an AI stops being fun.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   - EASY GAINS NOTHING. `AI_SKILL[0].discipline` is 0.20 against
 *     `minDiscipline` 0.5, and the gate is the first statement in the function,
 *     ahead of the RNG roll — so Easy does not even consume a draw. Verified in
 *     a real 20-minute match as well: the whole trace is byte-identical with
 *     the feature disabled.
 *   - THE LADDER IS `discipline`, an existing per-rung number whose declared
 *     meaning is "how well it fights". No new column in `AI_SKILL`.
 *   - THE ORDER IS THE PLAYER'S. `OrderKind.Attack` with a real target handle,
 *     through `channels.command`, counted against the APM budget.
 *   - WOUNDED FIRST. The whole value of concentration is finishing things off;
 *     damage split across two half-dead tanks kills neither.
 *   - A DEAD TARGET IS DROPPED. `Targeting` falls back to ordinary acquisition
 *     when an explicit target dies, but the unit "stops where it stands" — so a
 *     group left pointing at a corpse idles, and the re-pick is what stops that.
 *
 * MEASURED, 20 sim-minutes, both brains, temperate, seed 90210, all unlocks:
 * explicit attack orders 0 -> 69 (Normal), 0 -> 147 (Hard), 0 -> 47 (Brutal),
 * 0 -> 0 (Easy). Kill counts are NOT quoted as evidence of strength: both sides
 * of a mirror match get the change, so `kills` tracks `enemyLost` in every row
 * and the exchange is zero-sum by construction.
 *
 * Headless: no GL, no DOM, no economy. Modelled on `tests/ai-pacing.spec.ts`.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, CommandKind, EntityFlag, EntityKind, Faction, OrderKind,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import {
  AI_DIFFICULTY, AI_MILITARY, AI_SKILL, AI_SQUAD_MAX, CELL, SIM_DT, SIM_HZ,
} from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import { AI_FOCUS, BuildCatalog } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';

const P_ENEMY = 0 as PlayerId;
const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;

/** Where the AI's base and its army sit. Enemies are placed on top of them. */
const BASE_X = 400;
const BASE_Z = 400;
const ARMY_Z = 424;

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

interface Harness {
  world: World;
  brain: AiBrain;
  commands: Command[];
  step(ticks: number): void;
  army(n: number): void;
  /** An enemy unit. `hpFrac` is what makes one a better target than another. */
  enemyUnit(x: number, z: number, hpFrac?: number, flags?: number): EntityId;
  /** Run until the brain commits, then return the attack orders it issued. */
  attackOrders(): Command[];
  runToAttack(): void;
}

function makeHarness(difficulty: number, seed = 4242): Harness {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const ai = world.player(P_AI);
  ai.aiDifficulty = difficulty;
  ai.aiPersonality = 0;
  ai.powerProduced = 400;
  ai.powerConsumed = 20;

  const st = world.store;
  const conyard = st.alloc(EntityKind.Building, -1, P_AI, Faction.Soviets, BASE_X, 0, BASE_Z, 0);
  const ci = st.index(conyard);
  st.flags[ci] |= EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.BlocksNav;
  st.footprintW[ci] = 3; st.footprintH[ci] = 3;
  st.hp[ci] = 2000; st.maxHp[ci] = 2000;
  st.armorClass[ci] = ArmorClass.Concrete;
  st.buildProgress[ci] = 1;
  world.terrain.markOccupied(
    Math.floor(BASE_X / CELL) - 1, Math.floor(BASE_Z / CELL) - 1, 3, 3, conyard,
  );

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const brain = new AiBrain(world, channels.commands, catalog, P_AI, seed);
  brain.attach(channels.events);

  const commands: Command[] = [];
  channels.commands.observe((c) => {
    commands.push({ ...c, entities: c.entities.slice() } as Command);
  });

  const rng: IRng = new Rng(7);
  let tick = 0;
  let spawned = 0;

  const h: Harness = {
    world,
    brain,
    commands,
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        channels.setTick(tick);
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.spatial.rebuild();
        brain.tick(s);
        channels.commands.drain(() => {});
      }
    },
    army(n: number): void {
      for (let k = 0; k < n; k++) {
        const id = st.alloc(
          EntityKind.Vehicle, -1, P_AI, Faction.Soviets,
          BASE_X + (spawned % 8) * 4, 0, ARMY_Z + Math.floor(spawned / 8) * 4, 0,
        );
        spawned++;
        const i = st.index(id);
        st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | EntityFlag.CanAttack;
        st.hp[i] = 300; st.maxHp[i] = 300; st.maxSpeed[i] = 6;
        st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      }
    },
    enemyUnit(x, z, hpFrac = 1, flags = 0): EntityId {
      const id = st.alloc(EntityKind.Vehicle, -1, P_ENEMY, Faction.Allies, x, 0, z, 0);
      const i = st.index(id);
      st.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | flags;
      st.maxHp[i] = 300; st.hp[i] = 300 * hpFrac;
      st.maxSpeed[i] = 6; st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      return id;
    },
    attackOrders(): Command[] {
      return commands.filter(
        (c) => c.kind === CommandKind.Order && c.order === (OrderKind.Attack as number),
      );
    },
    /**
     * Past the opening grace gate and into `pressAttack`.
     *
     * `AI_MILITARY.firstStrikeSeconds / aggression` is over six minutes on
     * Easy, so this walks the clock rather than guessing — the same thing
     * `tests/ai-pacing.spec.ts` does, and the reason these cases hand the brain
     * a full army on tick zero.
     */
    runToAttack(): void {
      const firstStrike = Math.ceil(
        SIM_HZ * AI_MILITARY.firstStrikeSeconds
          / Math.max(0.1, AI_DIFFICULTY[difficulty]!.aggression),
      );
      for (let k = 0; k < firstStrike + SIM_HZ; k++) {
        this.step(1);
        if (brain.intent().posture === 'attacking') break;
      }
    },
  };
  return h;
}

/* ========================================================================== */

describe('the doctrine ladders on a number that already means this', () => {
  it('excludes exactly Easy', () => {
    expect(AI_SKILL[EASY].discipline).toBeLessThan(AI_FOCUS.minDiscipline);
    for (const rung of [NORMAL, HARD, BRUTAL]) {
      expect(AI_SKILL[rung].discipline,
        `rung ${rung} must be allowed to concentrate`).toBeGreaterThanOrEqual(AI_FOCUS.minDiscipline);
    }
  });

  it('rises with the rung, so a better brain concentrates more often', () => {
    for (const rung of [HARD, BRUTAL]) {
      expect(AI_SKILL[rung].discipline).toBeGreaterThan(AI_SKILL[rung - 1].discipline);
    }
  });

  it('prefers a wounded target hard enough to overcome a class step', () => {
    // The whole point of concentration. A nearly-dead ordinary unit must beat a
    // healthy producer, or the group walks past the kill it already paid for.
    const woundedUnit = AI_FOCUS.weightUnit * (1 + AI_FOCUS.woundBonus * (1 - 0.1));
    expect(woundedUnit).toBeGreaterThan(AI_FOCUS.weightProducer);
  });

  it('keeps the search short enough that focus is not a chase', () => {
    // An explicit attack order drives the unit to its target, so a generous
    // radius would pull the wave off its objective.
    expect(AI_FOCUS.radiusM).toBeLessThanOrEqual(40);
  });
});

describe('the brain names a target once it is in contact', () => {
  it('issues an explicit Attack, addressed to the strike group on Brutal', () => {
    const h = makeHarness(BRUTAL);
    h.army(AI_SQUAD_MAX * 6);
    h.enemyUnit(BASE_X + 6, ARMY_Z + 6);
    h.runToAttack();
    h.step(SIM_HZ * 4);

    const orders = h.attackOrders();
    expect(orders.length, 'the brain never named a target').toBeGreaterThan(0);
    const first = orders[0];
    expect(first.target).not.toBe(-1);
    expect(first.entityCount, 'a focus order is for the whole group').toBeGreaterThan(1);
    expect(h.brain.focusOrderCount).toBeGreaterThan(0);
  });

  it('limits Normal concentration to one human-sized fireteam', () => {
    const h = makeHarness(NORMAL, 8188);
    h.army(AI_SQUAD_MAX * 6);
    h.enemyUnit(BASE_X + 6, ARMY_Z + 6, 0.2);
    h.runToAttack();
    h.step(SIM_HZ * 12);

    const orders = h.attackOrders();
    expect(orders.length, 'Normal never named a target').toBeGreaterThan(0);
    for (const order of orders) {
      expect(order.entityCount).toBeLessThanOrEqual(AI_FOCUS.normalFireteamSize);
    }
    expect(orders[0].entityCount).toBe(AI_FOCUS.normalFireteamSize);
  });

  it('picks the nearly-dead one over the healthy one', () => {
    const h = makeHarness(BRUTAL);
    h.army(AI_SQUAD_MAX * 6);
    const healthy = h.enemyUnit(BASE_X + 4, ARMY_Z + 4, 1.0);
    const wounded = h.enemyUnit(BASE_X + 8, ARMY_Z + 8, 0.15);
    h.runToAttack();
    h.step(SIM_HZ * 4);

    const orders = h.attackOrders();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].target, 'it walked past the kill it had already paid for')
      .toBe(wounded as number);
    expect(orders[0].target).not.toBe(healthy as number);
  });

  it('picks a harvester over an ordinary hull at equal health', () => {
    const h = makeHarness(BRUTAL);
    h.army(AI_SQUAD_MAX * 6);
    const tank = h.enemyUnit(BASE_X + 4, ARMY_Z + 4, 1.0);
    const truck = h.enemyUnit(BASE_X + 8, ARMY_Z + 8, 1.0, EntityFlag.IsHarvester);
    h.runToAttack();
    h.step(SIM_HZ * 4);

    const orders = h.attackOrders();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].target).toBe(truck as number);
    expect(orders[0].target).not.toBe(tank as number);
  });

  it('drops a dead target instead of standing over the corpse', () => {
    const h = makeHarness(BRUTAL);
    h.army(AI_SQUAD_MAX * 6);
    const first = h.enemyUnit(BASE_X + 4, ARMY_Z + 4, 0.2);
    h.runToAttack();
    h.step(SIM_HZ * 4);
    const before = h.attackOrders();
    expect(before.length).toBeGreaterThan(0);
    expect(before[before.length - 1].target).toBe(first as number);

    // Kill it and offer a replacement.
    const st = h.world.store;
    st.flags[st.index(first)] |= EntityFlag.PendingDestroy;
    const second = h.enemyUnit(BASE_X + 6, ARMY_Z + 6, 0.2);
    h.step(SIM_HZ * 4);

    const after = h.attackOrders();
    expect(after.length, 'no re-pick after the target died').toBeGreaterThan(before.length);
    expect(after[after.length - 1].target).toBe(second as number);
  });

  it('names nothing when there is nothing near the group', () => {
    const h = makeHarness(BRUTAL);
    h.army(AI_SQUAD_MAX * 6);
    // Well outside `AI_FOCUS.radiusM` of the army's centroid.
    h.enemyUnit(BASE_X + AI_FOCUS.radiusM * 6, ARMY_Z + AI_FOCUS.radiusM * 6);
    h.runToAttack();
    h.step(SIM_HZ * 4);

    expect(h.attackOrders()).toEqual([]);
    expect(h.brain.focusOrderCount).toBe(0);
  });
});

describe('Easy gains nothing', () => {
  it('never issues an explicit attack, however good the target is', () => {
    const h = makeHarness(EASY);
    h.army(AI_SQUAD_MAX * 3);
    h.enemyUnit(BASE_X + 4, ARMY_Z + 4, 0.1);
    h.enemyUnit(BASE_X + 8, ARMY_Z + 8, 0.1, EntityFlag.IsHarvester);
    h.runToAttack();
    h.step(SIM_HZ * 30);

    expect(h.attackOrders()).toEqual([]);
    expect(h.brain.focusOrderCount).toBe(0);
  });

  it('still attacks — the wave is untouched, only the targeting is', () => {
    const h = makeHarness(EASY);
    h.army(AI_SQUAD_MAX * 3);
    h.enemyUnit(BASE_X + 4, ARMY_Z + 4, 0.1);
    h.runToAttack();
    // Easy's 28 APM budget may be empty on the exact posture-transition tick;
    // it still sends the wave as soon as the next action accrues.
    h.step(SIM_HZ);

    expect(h.brain.intent().posture).toBe('attacking');
    const moves = h.commands.filter(
      (c) => c.kind === CommandKind.Order && c.order === (OrderKind.AttackMove as number),
    );
    expect(moves.length, 'Easy must still press its attack').toBeGreaterThan(0);
  });
});
