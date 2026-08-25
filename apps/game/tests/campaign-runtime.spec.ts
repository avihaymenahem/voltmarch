/**
 * ============================================================================
 * tests/campaign-runtime.spec.ts — the Director against a REAL built world
 * ============================================================================
 * `campaign-director.spec.ts` drives the evaluator with a fake `WorldQuery`, so
 * it proves the logic and nothing about the world. `campaign-maps.spec.ts`
 * builds the world and proves the ground exists, and nothing about the logic.
 * This file is the join, and it is where the failures that survive both live:
 *
 *   - **A condition that reads zero on tick one for a reason nobody predicted.**
 *     `ownerCount` skips `UnderConstruction`, because a hold objective counting
 *     a foundation would complete before the derrick existed. If a
 *     layout-placed structure came out under construction, S1's secondary would
 *     read "fewer than three derricks" on the first tick and FAIL the player
 *     for something they had not done. That is a one-line assumption in two
 *     files and it is checked here rather than reasoned about.
 *   - **The Gate M clause that cannot be checked by reading**: wipe the enemy
 *     and do NOT win. Every shipped outcome rule wants to end that match; the
 *     operation's policy is the only thing standing in the way.
 * ========================================================================== */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityFlag, EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, setCampaignLayout, setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { newOperationState, runDirector } from '../src/campaign/Director';
import { makeWorldQuery, TagRegistry } from '../src/campaign/runtime';
import { campaignRunning, outcomePolicy, setCampaignOutcomePolicy } from '../src/campaign/policy';
import { minutes } from '../src/campaign/types';
import type { Effect, OperationDef, OperationState, WorldQuery } from '../src/campaign/types';

const S1: OperationDef = CAMPAIGNS[0].operations[0];

interface Rig {
  world: World;
  tags: TagRegistry;
  q: WorldQuery;
  state: OperationState;
}

function rig(op: OperationDef = S1): Rig {
  const sea = MAP_SEAS[op.map.preset] ?? null;
  const terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: op.map.mapSeed,
    biome: op.map.biome as never,
    anisotropy: 1,
    starts: startPointsFor(op.map.armies, sea, op.map.simSeed).map((p) => ({ x: p.x, z: p.z })),
    sea,
  });
  setActiveTerrain(terrain);

  const world = new World();
  world.addPlayer(Faction.Soviets, 'Commander', true, true);
  world.addPlayer(Faction.Allies, 'Opponent', false, false);
  world.terrain = terrain;

  const tags = new TagRegistry();
  const l = LAYOUTS.get(op.layout)!;
  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  setCampaignLayout((b, cx, cz, start) => {
    l.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (n, id) => { if (id !== NONE) tags.add(n, id); },
      seat: (i) => b.armySlot(i),
    });
  });
  buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies });
  setCampaignLayout(null);
  setPlannedOperation(null);
  clearScenario();

  return { world, tags, q: makeWorldQuery(world, tags), state: newOperationState(op, 0) };
}

/** Kill every live entity carrying `tag`, the way `Damage` does. */
function killTag(r: Rig, tag: string): number {
  const st = r.world.store;
  const doomed = [...r.tags.live(st, tag)];
  for (const id of doomed) st.markDead(id);
  return st.flushDestroyed();
}

/** Kill everything a seat owns EXCEPT what carries `keep`. */
function wipeSeatExcept(r: Rig, seat: number, keep: string): number {
  const st = r.world.store;
  const spared = new Set<number>([...r.tags.live(st, keep)].map((id) => id as number));
  const doomed: EntityId[] = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.owner[i] !== seat) continue;
    const h = st.handleOf(i);
    if (spared.has(h as number)) continue;
    doomed.push(h);
  }
  for (const id of doomed) st.markDead(id);
  return st.flushDestroyed();
}

/**
 * One tick, with the ONE piece of the sink that changes what the next tick does.
 *
 * `runDirector` does not latch the outcome — the SINK does, in
 * `campaign-install.ts#Session.end` — and that split is deliberate: the
 * evaluator stays a function of its inputs and every write lives on one side of
 * the seam. It means a test driving the Director bare would run a won operation
 * forever, which is not what a match does. Mirrored here, and nothing else is:
 * objectives, credits and presentation stay the sink's business.
 */
/**
 * The first tick at which S1's ownership thresholds are believed.
 *
 * `soviets.01.first-tap` guards every `ownerCount` with `SETTLE` — twenty
 * seconds, 600 ticks at 30 Hz — because a threshold over an EMPTY tag registry
 * is true in both directions: `max: 0` would win the operation and `max: 2`
 * would fail the derrick secondary. (It is defence against a layout that placed
 * nothing, not against a tick-one read that happens today; `scenarios.system`
 * builds the world inside `async init()` and the registry is never empty when
 * the Director first runs. The operation's own header carries the argument.)
 *
 * **FOUR TESTS IN THIS FILE USED TO DRIVE TO TICK 200-400 AND ASSERT A WIN.**
 * They were written against `entityDead 'tap'`, which had no guard, and they
 * broke on the migration to `ownerCount` — correctly, because the behaviour
 * really did change. They drive past the guard now, and the pair below pins the
 * guard itself so the next change to it fails here by name rather than by four
 * unexplained assertions.
 *
 * Note this delays nothing a player can reach: `SETTLE` is measured from the
 * START of the operation, not from the kill, so an objective met at any point
 * after the first twenty seconds resolves on the tick it is met.
 */
const SETTLE_TICK = 600;

const tick = (r: Rig, op: OperationDef, at: number): readonly Effect[] => {
  const out: Effect[] = [];
  runDirector(op, r.state, r.q, at, out);
  for (const e of out) {
    if (e.do !== 'endOperation' || r.state.outcome !== null) continue;
    r.state.outcome = e.result === 'win' ? 'won' : 'lost';
    r.state.reason = e.reason ?? '';
  }
  return out;
};

afterEach(() => { setCampaignOutcomePolicy(null); });

/* ==========================================================================
 * 1. THE WORLD READS THE WAY THE TRIGGERS ASSUME
 * ========================================================================== */

describe('S1 — what the conditions see on the first tick', () => {
  it('counts three standing derricks, NOT zero', () => {
    const r = rig();
    // The assumption under test: `ownerCount` skips `UnderConstruction`, and a
    // layout-placed structure is finished. If either half were false, S1's
    // secondary reads `max: 2` as TRUE on tick one and fails the player for
    // nothing — a bug that would reach a play session and read as a design
    // decision rather than as a defect.
    expect(r.q.ownerCount(1, 'building', 'derrick')).toBe(3);
  });

  it('and REALLY skips a foundation — the tagged branch did not, until today', () => {
    /*
     * THE TEST ABOVE NAMED THE PROPERTY AND MEASURED THE BRANCH THAT LACKED IT.
     *
     * `ownerCount` has two branches. The untagged one refuses an
     * `UnderConstruction` entity under a comment giving exactly this reason;
     * the TAGGED one did not, and the tagged one is the spelling this file's
     * own authoring guidance pushes people towards. `TagRegistry.live` drops
     * dead and `PendingDestroy` entities, so the tagged branch looked complete
     * — but it knows nothing about construction.
     *
     * Unreachable in the shipped table, because a layout places its structures
     * finished, which is exactly why asserting `toBe(3)` passed either way. It
     * arms the moment an operation counts something a trigger builds, captures
     * or rebuilds. Flipping the bit by hand is the only way to reach it, and it
     * is what makes the assertion above a measurement rather than a hope.
     */
    const r = rig();
    const st = r.world.store;
    const doomed = [...r.tags.live(st, 'derrick')][0];
    expect(doomed, 'no derrick carries the tag — the rig changed').not.toBeUndefined();
    st.flags[st.index(doomed)] |= EntityFlag.UnderConstruction;
    expect(r.q.ownerCount(1, 'building', 'derrick'),
      'a foundation was counted as a standing derrick').toBe(2);
  });

  it('sees exactly one tap, alive', () => {
    const r = rig();
    expect(r.q.aliveWithTag('tap')).toBe(1);
    expect(r.q.ownerOfTag('tap')).toBe(1);
    expect(r.q.weakestHpFrac('tap')).toBeCloseTo(1, 3);
  });

  it('fires nothing but the opening line in the first four seconds', () => {
    const r = rig();
    expect(tick(r, S1, 0)).toEqual([]);
    const opened = tick(r, S1, 120);
    expect(opened).toHaveLength(1);
    expect(opened[0].do).toBe('dialogue');
  });

  it('neither seat is beaten at the start', () => {
    const r = rig();
    expect(r.q.isBeaten(0)).toBe(false);
    expect(r.q.isBeaten(1)).toBe(false);
  });
});

/* ==========================================================================
 * 2. THE WIN, AND THE ONE THAT IS NOT A WIN
 * ========================================================================== */

describe('S1 ends when the tap dies and not before', () => {
  it('killing the tap wins it, and the secondary resolves on the same tick', () => {
    const r = rig();
    tick(r, S1, 120);
    expect(killTag(r, 'tap')).toBeGreaterThan(0);
    expect(r.q.aliveWithTag('tap')).toBe(0);

    // NOT BEFORE THE GUARD, which is the half that would otherwise be silent:
    // a win that fired at tick 200 would mean `SETTLE` had been dropped.
    expect(tick(r, S1, SETTLE_TICK - 1), 'nothing resolves inside the settle').toEqual([]);

    const fired = tick(r, S1, SETTLE_TICK);
    const kinds = fired.map((e) => e.do);
    // ORDER IS THE FILE'S ORDER, and it is load-bearing: `t.derricksKept` sits
    // above `t.win`, so the secondary completes before the operation ends.
    // Below it, `runDirector` returns early on the next tick and the medal
    // silently loses a rung.
    expect(kinds).toContain('completeObjective');
    expect(kinds[kinds.length - 1]).toBe('endOperation');
    expect(fired.filter((e) => e.do === 'completeObjective')).toHaveLength(2);
  });

  it('THE GATE M CLAUSE: wipe the enemy, leave the tap, and it is NOT won', () => {
    const r = rig();
    tick(r, S1, 120);
    const killed = wipeSeatExcept(r, 1, 'tap');
    expect(killed, 'the enemy really was wiped').toBeGreaterThan(10);

    // Every shipped rule wants to call this a victory. `Viability.isBeaten`
    // agrees the seat is finished — and the operation still refuses to end,
    // because the tap is standing and the tap is the objective.
    expect(r.q.isBeaten(1), 'the enemy is beaten by the shipped survey').toBe(true);
    expect(r.q.aliveWithTag('tap'), 'and the tap survived the wipe').toBe(1);

    const fired = tick(r, S1, 400);
    expect(
      fired.filter((e) => e.do === 'endOperation'),
      'an annihilation win here is the four-shipped-failures bug, on the frame it matters',
    ).toEqual([]);
    expect(r.state.outcome).toBeNull();
  });

  it('and the policy that disarms the shipped rules says so out loud', () => {
    expect(campaignRunning()).toBe(false);
    expect(outcomePolicy().annihilationWin, 'a skirmish is unchanged').toBe(true);

    setCampaignOutcomePolicy(S1.outcome);
    expect(campaignRunning()).toBe(true);
    expect(outcomePolicy().annihilationWin).toBe(false);
    expect(outcomePolicy().assetLossDefeat).toBe(false);
  });
});

/* ==========================================================================
 * 3. THE SECONDARY, WHICH CAN BE LOST BY CARELESSNESS
 * ========================================================================== */

describe('S1 — the derricks', () => {
  it('breaking one fails the secondary, and it does not un-fail', () => {
    const r = rig();
    const st = r.world.store;
    const one = r.tags.live(st, 'derrick')[0];
    st.markDead(one);
    st.flushDestroyed();
    expect(r.q.ownerCount(1, 'building', 'derrick')).toBe(2);

    // The guard binds in THIS direction too, and it is the direction that
    // matters more: an empty registry answers `ownerCount` with 0, which is
    // `<= 2`, so an unguarded `t.derricksLost` fails the secondary rather than
    // winning the match — the player's least favourite direction, with a line
    // accusing them of it.
    // Narrowed to the FAILURE rather than to an empty set: this test does not
    // drive the opening beats first, so `t.open` (an `elapsed` of 120) is
    // still outstanding and fires its dialogue on this very tick.
    expect(tick(r, S1, SETTLE_TICK - 1).filter((e) => e.do === 'failObjective'),
      'no failure inside the settle either').toEqual([]);
    const fired = tick(r, S1, SETTLE_TICK);
    expect(fired.some((e) => e.do === 'failObjective' && e.id === 'derricks')).toBe(true);

    // `t.derricksLost` is not `repeat`, so it latches. A dialogue line that
    // re-fired every tick for the rest of the operation would be the whole
    // reason the fired-set exists.
    expect(tick(r, S1, SETTLE_TICK + 1)).toEqual([]);
  });

  it('with a derrick down, killing the tap still wins but pays no bonus', () => {
    const r = rig();
    const st = r.world.store;
    st.markDead(r.tags.live(st, 'derrick')[0]);
    st.flushDestroyed();
    tick(r, S1, SETTLE_TICK);
    killTag(r, 'tap');

    const fired = tick(r, S1, SETTLE_TICK + 100);
    expect(fired.some((e) => e.do === 'endOperation' && e.result === 'win')).toBe(true);
    expect(
      fired.filter((e) => e.do === 'completeObjective' && e.id === 'derricks'),
      'the secondary already failed; completing it now would pay for a broken town',
    ).toEqual([]);
  });
});

/* ==========================================================================
 * 4. THE REINFORCEMENT WAVE
 * ========================================================================== */

describe('S1 — the relief column', () => {
  it('arrives at minute five and not before, and is ordered in the same breath', () => {
    const r = rig();
    tick(r, S1, 120);
    expect(tick(r, S1, minutes(5) - 1).some((e) => e.do === 'spawnUnits')).toBe(false);

    const fired = tick(r, S1, minutes(5));
    const spawn = fired.find((e) => e.do === 'spawnUnits');
    expect(spawn).toBeDefined();
    // The order must be in the SAME trigger. A wave that spawns and then waits
    // for a second trigger to move it stands on its drop zone until something
    // wanders into range, which reads as the AI being broken.
    expect(fired.some((e) => e.do === 'orderTagged' && e.tag === 'relief')).toBe(true);
  });

  it('does not arrive at all once the operation has ended', () => {
    const r = rig();
    tick(r, S1, 120);
    killTag(r, 'tap');
    tick(r, S1, SETTLE_TICK);
    expect(r.state.outcome).toBe('won');
    expect(
      tick(r, S1, minutes(5)),
      'a repeat wave into a world the shell is tearing down',
    ).toEqual([]);
  });
});

/* ==========================================================================
 * 5. THE TAG REGISTRY AGAINST A REAL STORE
 * ========================================================================== */

describe('a tag handle cannot resolve against whatever recycled the slot', () => {
  it('a dead entity leaves the tag, and the generation bump is why', () => {
    const r = rig();
    const st = r.world.store;
    const before = r.tags.live(st, 'derrick').length;
    const victim = r.tags.live(st, 'derrick')[0];
    const slot = st.index(victim);
    st.markDead(victim);
    st.flushDestroyed();

    expect(r.tags.live(st, 'derrick').length).toBe(before - 1);
    // The slot is back on the free list and its generation moved, so the old
    // handle is dead even if something else takes the slot — which is the
    // `carrierId` defect avoided by construction rather than by scanning.
    expect(st.isAlive(victim)).toBe(false);
    expect(st.index(victim)).not.toBe(slot);
  });

  it('a PendingDestroy entity is already gone to a condition', () => {
    const r = rig();
    const st = r.world.store;
    const victim = r.tags.live(st, 'derrick')[0];
    st.markDead(victim);
    // NOT flushed. `campaign.system.ts` runs at Cleanup 9000, after the flush
    // at order 0 — but a condition must never count something marked dead
    // earlier in the same tick either.
    expect((st.flags[st.index(victim)] & EntityFlag.PendingDestroy) !== 0).toBe(true);
    expect(r.q.ownerCount(1, 'building', 'derrick')).toBe(2);
  });
});

/* ==========================================================================
 * 6. THE WORLD ITSELF
 * ========================================================================== */

describe('the built world is the one the operation describes', () => {
  it('seats the player as the chapter faction, in seat 0', () => {
    const r = rig();
    expect(r.world.players[0].faction).toBe(Faction.Soviets);
    expect(r.world.players[0].isHuman).toBe(true);
    expect(r.world.players[1].faction).toBe(Faction.Allies);
  });

  it('gives both sides a base to fight from', () => {
    const r = rig();
    const st = r.world.store;
    const buildings = [0, 1].map((seat) => {
      let n = 0;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] === seat && st.kind[i] === EntityKind.Building) n++;
      }
      return n;
    });
    expect(buildings[0], 'the player opens with a base').toBeGreaterThan(3);
    expect(buildings[1], 'so does the enemy').toBeGreaterThan(3);
  });
});
