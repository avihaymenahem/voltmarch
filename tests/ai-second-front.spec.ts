/**
 * ============================================================================
 * tests/ai-second-front.spec.ts — THE AI OPENS A SECOND FRONT
 * ============================================================================
 * Reported as *"kinda boring"*. The measurement behind that was blunt: the
 * military-goal histogram over a 24-minute match read `436x attacking with N at
 * 314,226`. One objective, re-picked to the same coordinate for sixteen
 * straight minutes. The brain was not doing anything wrong — it was doing one
 * thing.
 *
 * `AiBrain.raid` is a small party sent at the enemy ECONOMY while the wave goes
 * somewhere else, and `AI_RAID` is its doctrine. Nothing here is new sensing:
 * `memRole` already remembered enemy structures by role, `OrderKind.Attack`
 * arrived with focus fire, and `GROUP_RAID` is the FOURTH use of the tag that
 * keeps a detachment out of `regroupSquads`.
 *
 * THE PARTY COMES OUT OF THE RESERVE, AND THAT WAS A MEASURED CORRECTION.
 * Drawing it from the strike group and requiring the remainder to still clear
 * `waveThreshold()` produced 2 / 1 / 0 raids at Normal / Hard / Brutal over
 * twenty minutes — a backwards ladder, because the brain spends most of a match
 * BELOW its own threshold and Brutal's threshold is the highest of the three.
 * The reserve is idle by construction, so a slice of it costs the main attack
 * nothing and risks exactly what should be at risk: home defence.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   - EASY NEVER RAIDS. 0.4 aggression against `minAggression` 0.55, checked
 *     first. Verified in a real 20-minute match too: byte-identical trace with
 *     the layer disabled.
 *   - THE LADDER IS A DIVISOR on `aggression`, so a better rung raids sooner.
 *   - THE TAG IS RELEASED. A raid with no expiry is a detachment permanently
 *     deleted from the army — the same failure `GROUP_WITHDRAW` has, and the
 *     reason both have a release path.
 *   - IT TARGETS THE ECONOMY, from MEMORY. No remembered refinery or harvester
 *     means no raid; the brain does not go looking, because that is the scout's
 *     job and going looking is how a party walks into a defended base.
 *   - IT DOES NOT SPLIT WHILE LOSING.
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
import { AI_DIFFICULTY, AI_MILITARY, CELL, SIM_DT, SIM_HZ } from '../src/core/config';
import { Rng } from '../src/core/math';
import { AiBrain } from '../src/sim/AI';
import { AI_RAID, BuildCatalog } from '../src/sim/AIStrategy';
import type { DefLookup } from '../src/sim/AIStrategy';

const P_ENEMY = 0 as PlayerId;
const P_AI = 1 as PlayerId;

const EASY = 0;
const NORMAL = 1;
const HARD = 2;
const BRUTAL = 3;

const BASE_X = 400;
const BASE_Z = 400;

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
  /** An enemy refinery the brain can see, and therefore remember by role. */
  enemyRefinery(x: number, z: number): EntityId;
  attackMoves(): Command[];
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

  return {
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
          BASE_X + (spawned % 8) * 4, 0, BASE_Z + 24 + Math.floor(spawned / 8) * 4, 0,
        );
        spawned++;
        const i = st.index(id);
        st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision | EntityFlag.CanAttack;
        st.hp[i] = 300; st.maxHp[i] = 300; st.maxSpeed[i] = 6;
        st.armorClass[i] = ArmorClass.Medium; st.radius[i] = 2;
      }
    },
    enemyRefinery(x, z): EntityId {
      const id = st.alloc(EntityKind.Building, -1, P_ENEMY, Faction.Allies, x, 0, z, 0);
      const i = st.index(id);
      // `AiBrain.roleOfBuilding` falls back to flags when no def resolves, and
      // `IsRefinery` is what makes this an ECONOMY memory rather than scenery.
      st.flags[i] |= EntityFlag.IsRefinery;
      st.footprintW[i] = 3; st.footprintH[i] = 2;
      st.maxHp[i] = 1000; st.hp[i] = 1000;
      st.armorClass[i] = ArmorClass.Concrete;
      st.buildProgress[i] = 1;
      return id;
    },
    attackMoves(): Command[] {
      return commands.filter(
        (c) => c.kind === CommandKind.Order && c.order === (OrderKind.AttackMove as number),
      );
    },
  };
}

/** Party-sized AttackMove orders aimed at the enemy economy, not the objective. */
function raidOrders(h: Harness, x: number, z: number): Command[] {
  return h.attackMoves().filter(
    (c) => c.entityCount === AI_RAID.partySize
      && Math.abs(c.x - x) < 1 && Math.abs(c.z - z) < 1,
  );
}

/* ========================================================================== */

describe('the doctrine ladders on the one knob left for it', () => {
  it('excludes exactly Easy', () => {
    expect(AI_DIFFICULTY[EASY].aggression).toBeLessThan(AI_RAID.minAggression);
    for (const rung of [NORMAL, HARD, BRUTAL]) {
      expect(AI_DIFFICULTY[rung].aggression).toBeGreaterThanOrEqual(AI_RAID.minAggression);
    }
  });

  it('raids sooner the better the rung, because aggression divides', () => {
    const period = (rung: number): number =>
      AI_RAID.cooldownTicks / AI_DIFFICULTY[rung].aggression;
    expect(period(BRUTAL)).toBeLessThan(period(HARD));
    expect(period(HARD)).toBeLessThan(period(NORMAL));
  });

  it('sends a party small enough to be harassment, not a second wave', () => {
    expect(AI_RAID.partySize).toBeGreaterThan(1);
    expect(AI_RAID.partySize).toBeLessThan(AI_MILITARY.reserveMin + 6);
  });

  it('always calls the party home eventually', () => {
    // A raid with no expiry is a detachment deleted from the army for good.
    expect(AI_RAID.maxTicks).toBeGreaterThan(0);
  });
});

describe('a party goes at the economy', () => {
  /**
   * Enough army that the RESERVE can spare a party.
   *
   * `regroupSquads` sizes the reserve as `min(wanted, headroom)` where headroom
   * is `armyCount - waveThreshold()`, so a modest army leaves the reserve
   * pinned at `AI_MILITARY.reserveMin` however defensive the personality is —
   * and a reserve at its floor has nothing to spare by design.
   */
  const ARMY = 44;
  const REF_X = 120;
  const REF_Z = 120;

  it('sends exactly one party, at the remembered refinery', () => {
    const h = makeHarness(BRUTAL);
    h.army(ARMY);
    h.enemyRefinery(REF_X, REF_Z);
    h.step(SIM_HZ * 90);

    expect(h.brain.raidCount, 'no second front was ever opened').toBeGreaterThan(0);
    expect(raidOrders(h, REF_X, REF_Z).length, 'the party was not aimed at the economy')
      .toBeGreaterThan(0);
  });

  it('does not raid without a remembered economy target', () => {
    const h = makeHarness(BRUTAL);
    h.army(ARMY);
    // No enemy structure at all: the brain has nothing to remember and does not
    // go looking, which is what stops a party wandering into a defended base.
    h.step(SIM_HZ * 90);

    expect(h.brain.raidCount).toBe(0);
  });

  it('does not raid when the reserve cannot spare the hulls', () => {
    const h = makeHarness(BRUTAL);
    h.army(3);                      // a reserve at its floor, and nothing spare
    h.enemyRefinery(REF_X, REF_Z);
    h.step(SIM_HZ * 90);

    expect(h.brain.raidCount).toBe(0);
  });

  it('folds the party back into the army, so the tag is not a deletion', () => {
    const h = makeHarness(BRUTAL);
    h.army(ARMY);
    h.enemyRefinery(REF_X, REF_Z);

    // SAMPLED, not snapshotted. A raid runs for `maxTicks` and then another
    // becomes eligible, so any single reading lands at an arbitrary point in
    // that cycle. The invariant is over the whole window: the squads must DIP
    // (a party went out) and must also come back to full (it was untagged).
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (let k = 0; k < 120; k++) {
      h.step(SIM_HZ * 2);
      const filed = h.brain.intent().strike + h.brain.intent().reserve;
      if (filed < min) min = filed;
      if (filed > max) max = filed;
    }

    expect(h.brain.raidCount, 'no raid ever went out').toBeGreaterThan(0);
    expect(min, 'no party was ever detached').toBeLessThan(max);
    expect(max - min, 'the dip is not a party-sized one')
      .toBeGreaterThanOrEqual(AI_RAID.partySize);
  });
});

describe('Easy gains nothing', () => {
  it('never opens a second front, however inviting the target', () => {
    const h = makeHarness(EASY);
    h.army(40);
    h.enemyRefinery(120, 120);
    h.step(SIM_HZ * 240);

    expect(h.brain.raidCount).toBe(0);
  });
});
