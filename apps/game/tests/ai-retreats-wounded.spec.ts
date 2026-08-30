/**
 * ============================================================================
 * tests/ai-retreats-wounded.spec.ts — A NEARLY-DEAD HULL WALKS AWAY
 * ============================================================================
 * Reported as *"0 skills"*. The honest version was narrower than it sounded:
 * the brain retreats ARMIES (`shouldRetreat`, gated on `AI_SKILL[].discipline`)
 * and had never retreated a UNIT. A player watches an AI tank sit in the open
 * at 8% health until it dies, and no human does that.
 *
 * THE METRIC THAT MADE THIS LOOK WORSE THAN IT WAS. Two earlier reports quoted
 * `flee=0 at every sample of every rung` as evidence. That measurement was
 * VACUOUS: `UnitState.Fleeing` is declared in `core/types.ts` and assigned by
 * NOTHING in the codebase — `Steering.seeksGoal` reads it, `Commands` names it
 * in a comment, and `AiBrain.economy` tested it in a guard that could therefore
 * never be false. There was no flag to look at, and a retreat here is what the
 * harvester layer already did: a plain `OrderKind.Move`, the player's own verb,
 * through `channels.command`, costing an action from the same APM budget.
 *
 * ONE BEHAVIOUR, NOT A MICRO SUITE — deliberately. No kiting, no per-unit
 * repositioning, no target juggling. A hull that is nearly dead AND currently
 * being shot at walks to the rally point and comes back healthy; pathing, the
 * group retreat and the repair depot that may be sitting near the rally point
 * do the rest. A pile of invisible optimisations makes an AI harder without
 * making it feel human, which is the opposite of what was asked for.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   - EASY GAINS NOTHING. 0.20 discipline against `minDiscipline` 0.5, checked
 *     before the RNG roll so the rung does not even consume a draw. Verified in
 *     a real 20-minute match too: the whole trace is byte-identical with the
 *     feature disabled.
 *   - THE TAG IS RELEASED. `GROUP_WITHDRAW` makes a hull invisible to
 *     `regroupSquads`; a tag with no clearing path is a unit permanently
 *     removed from the army, and the AI would quietly shrink by one hull per
 *     bad engagement for the rest of the match.
 *   - IN THE FIGHT, NOT MERELY DAMAGED. Without `underFireSeconds` the brain
 *     walks home every hull still carrying a scratch from a raid two minutes
 *     ago, which is a retreat from nothing.
 *   - A ROUT IS CAPPED. `maxFraction` stops one bad engagement pulling the
 *     whole wave out at once.
 *
 * MEASURED, 20 sim-minutes, both brains, temperate, seed 90210, all unlocks —
 * withdrawals by rung 0 / 31 / 177 / 183, and own losses over the same matches
 * 121 / 132 / 158 / 159 before against 121 / 66 / 125 / 144 after. The loss
 * numbers are NOT a strength claim: both sides of a mirror match get the
 * change, so the exchange is close to zero-sum by construction.
 *
 * Headless: no GL, no DOM, no economy.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  ArmorClass, CommandKind, EntityFlag, EntityKind, Faction, OrderKind,
} from '../src/core/types';
import type { Command, EntityId, IRng, PlayerId, SimContext } from '../src/core/types';
import { AI_SKILL, AI_SQUAD_MAX, CELL, SIM_DT, SIM_HZ } from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import { AI_RETREAT, BuildCatalog } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';

const P_AI = 1 as PlayerId;
const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;

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
  ids: EntityId[];
  step(ticks: number): void;
  army(n: number): void;
  /** Hurt a hull and mark it as having been hit THIS instant. */
  wound(id: EntityId, hpFrac: number, underFire?: boolean): void;
  heal(id: EntityId, hpFrac: number): void;
  /**
   * Single-entity Move orders naming THIS hull.
   *
   * Filtered by entity rather than just by shape: the scout layer also issues
   * one-unit Move orders, and an unfiltered `entityCount === 1` test picks
   * those up and reads them as withdrawals.
   */
  withdrawOrdersFor(id: EntityId): Command[];
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
  const ids: EntityId[] = [];

  const h: Harness = {
    world,
    brain,
    commands,
    ids,
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
        ids.push(id);
        const i = st.index(id);
        st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | EntityFlag.CanAttack;
        st.hp[i] = 300; st.maxHp[i] = 300; st.maxSpeed[i] = 6;
        st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      }
    },
    wound(id: EntityId, hpFrac: number, underFire = true): void {
      const i = st.index(id);
      st.hp[i] = st.maxHp[i] * hpFrac;
      // `withdrawWounded` asks "was this hit recently", not "is it damaged".
      st.lastHitTime[i] = underFire ? world.time : -1e6;
    },
    heal(id: EntityId, hpFrac: number): void {
      const i = st.index(id);
      st.hp[i] = st.maxHp[i] * hpFrac;
    },
    withdrawOrdersFor(id: EntityId): Command[] {
      return commands.filter(
        (c) => c.kind === CommandKind.Order
          && c.order === (OrderKind.Move as number)
          && c.entityCount === 1
          && c.entities[0] === (id as number),
      );
    },
  };
  return h;
}

/**
 * A hull the brain has filed into the STRIKE group.
 *
 *  fills the RESERVE first, so the front of the roster is at
 * home and is not a withdrawal candidate at all — correctly, since a reserve
 * hull is already standing where a retreat would send it. The tail is what
 * ends up in the strike group.
 */
function strikeHull(h: Harness): EntityId {
  return h.ids[h.ids.length - 1];
}

/** Settle so `regroupSquads` has tagged the army, then forget the traffic. */
function settle(h: Harness): void {
  h.step(SIM_HZ * 5);
  h.commands.length = 0;
}

/* ========================================================================== */

describe('the doctrine cannot oscillate and cannot rout', () => {
  it('rejoins well above the threshold it left at', () => {
    // Equal thresholds give a hull that ping-pongs between the rally point and
    // the front on every graze, which reads as broken rather than cautious.
    expect(AI_RETREAT.rejoinHpFraction).toBeGreaterThan(AI_RETREAT.hpFraction);
  });

  it('excludes exactly Easy', () => {
    expect(AI_SKILL[EASY].discipline).toBeLessThan(AI_RETREAT.minDiscipline);
    for (const rung of [NORMAL, HARD, BRUTAL]) {
      expect(AI_SKILL[rung].discipline).toBeGreaterThanOrEqual(AI_RETREAT.minDiscipline);
    }
  });

  it('never lets most of the group leave at once', () => {
    expect(AI_RETREAT.maxFraction).toBeGreaterThan(0);
    expect(AI_RETREAT.maxFraction).toBeLessThan(0.5);
  });
});

describe('a hull that is nearly dead and being shot at walks away', () => {
  it('gets a Move order of its own, and is counted', () => {
    const h = makeHarness(BRUTAL);
    h.army(12);
    settle(h);
    const hull = strikeHull(h);
    h.wound(hull, 0.1);
    h.step(SIM_HZ * 3);

    expect(h.brain.withdrawalCount, 'nothing was pulled out').toBeGreaterThan(0);
    expect(h.withdrawOrdersFor(hull).length).toBeGreaterThan(0);
  });

  it('leaves a hull that is hurt but out of contact', () => {
    const h = makeHarness(BRUTAL);
    h.army(12);
    settle(h);
    h.wound(strikeHull(h), 0.1, false);   // damaged, but not hit for a long time
    h.step(SIM_HZ * 3);

    expect(h.brain.withdrawalCount).toBe(0);
  });

  it('leaves a healthy hull under fire alone', () => {
    const h = makeHarness(BRUTAL);
    h.army(12);
    settle(h);
    h.wound(strikeHull(h), 0.9);
    h.step(SIM_HZ * 3);

    expect(h.brain.withdrawalCount).toBe(0);
  });

  it('takes the worst-hurt one first', () => {
    const h = makeHarness(BRUTAL);
    h.army(12);
    settle(h);
    const mild = h.ids[h.ids.length - 2];
    const dire = h.ids[h.ids.length - 1];
    h.wound(mild, 0.25);
    h.wound(dire, 0.05);
    h.step(SIM_HZ * 1);

    // ORDER, not exclusivity: one hull leaves per pass, so over a second the
    // mild one may follow. What must hold is which went FIRST.
    const firstOf = (id: EntityId): number => h.commands.findIndex(
      (c) => c.kind === CommandKind.Order
        && c.order === (OrderKind.Move as number)
        && c.entityCount === 1
        && c.entities[0] === (id as number),
    );
    const direAt = firstOf(dire);
    const mildAt = firstOf(mild);
    expect(direAt, 'the worst-hurt hull was never pulled out').toBeGreaterThanOrEqual(0);
    if (mildAt >= 0) {
      expect(direAt, 'it saved the healthier one first').toBeLessThan(mildAt);
    }
  });

  it('is invisible to the strike group while it withdraws, and comes back healed', () => {
    const h = makeHarness(BRUTAL);
    h.army(12);
    settle(h);
    const before = h.brain.intent().strike + h.brain.intent().reserve;

    const hull = strikeHull(h);
    h.wound(hull, 0.1);
    h.step(SIM_HZ * 2);
    expect(h.brain.withdrawalCount).toBeGreaterThan(0);
    const during = h.brain.intent().strike + h.brain.intent().reserve;
    expect(during, 'the withdrawing hull is still being filed into a squad')
      .toBeLessThan(before);

    // A tag with no release is a unit deleted from the army for the rest of
    // the match — the failure this half exists to prevent.
    h.heal(hull, 1.0);
    h.step(SIM_HZ * 3);
    // AGAINST `during`, NOT `before`. The scout layer tags a hull `GROUP_SCOUT`
    // partway through and `regroupSquads` skips that one too, so the absolute
    // total legitimately ends one short of where it started. What must hold is
    // that the withdrawn hull came BACK.
    expect(h.brain.intent().strike + h.brain.intent().reserve, 'it never rejoined')
      .toBeGreaterThan(during);
  });

  it('caps the exodus when the whole group is hurt', () => {
    const h = makeHarness(BRUTAL);
    h.army(12);
    settle(h);
    for (const id of h.ids) h.wound(id, 0.1);
    h.step(SIM_HZ * 10);

    // One per pass with a hard ceiling on how many may be out at once, so a bad
    // fight cannot evaporate the wave.
    expect(h.brain.withdrawalCount).toBeGreaterThan(0);
    expect(h.brain.intent().strike, 'the whole wave left at once').toBeGreaterThan(0);
  });
});

describe('Easy gains nothing', () => {
  it('never withdraws, however nearly dead the hull is', () => {
    const h = makeHarness(EASY);
    h.army(12);
    settle(h);
    for (const id of h.ids) h.wound(id, 0.02);
    h.step(SIM_HZ * 30);

    // The counter is incremented in `withdrawWounded` and nowhere else, so it
    // is the exact question. A raw one-unit-Move scan is not: the scout layer
    // issues those too, on every rung.
    expect(h.brain.withdrawalCount).toBe(0);
  });
});
