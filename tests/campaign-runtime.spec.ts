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

    const fired = tick(r, S1, 200);
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

    const fired = tick(r, S1, 300);
    expect(fired.some((e) => e.do === 'failObjective' && e.id === 'derricks')).toBe(true);

    // `t.derricksLost` is not `repeat`, so it latches. A dialogue line that
    // re-fired every tick for the rest of the operation would be the whole
    // reason the fired-set exists.
    expect(tick(r, S1, 301)).toEqual([]);
  });

  it('with a derrick down, killing the tap still wins but pays no bonus', () => {
    const r = rig();
    const st = r.world.store;
    st.markDead(r.tags.live(st, 'derrick')[0]);
    st.flushDestroyed();
    tick(r, S1, 300);
    killTag(r, 'tap');

    const fired = tick(r, S1, 400);
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
    tick(r, S1, 200);
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
