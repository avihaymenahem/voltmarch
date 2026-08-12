/**
 * ============================================================================
 * CRUSHING — heavy vehicles flatten soft scenery, and are stopped by hard.
 * ============================================================================
 * `docs/SPEC_DRIFT_AUDIT.md` §10 records that the crush vocabulary was authored
 * in full and read by nothing: `EntityFlag.Crusher`/`Crushable`, the
 * `crushLevel`/`crushableBy` columns, `FxKind.CrushSquish` and its VFX and
 * audio recipes all existed, and a measured probe put a harvester through a
 * tree at full speed with the tree at full HP on the far side.
 *
 * These tests pin BOTH halves of the rule that fixes it:
 *
 *   SOFT YIELDS — a `Crusher` flattens `Crushable` props it drives over, and
 *                 obeys the `crushableBy` threshold while doing it.
 *   ROCK IS NEITHER — `rock` and `boulder` are not crushable AND not solid.
 *
 * THAT SECOND HALF USED TO READ "HARD DOES NOT", and it is the rule that
 * changed. Rocks carried `EntityFlag.BlocksNav`, which made them solid in
 * `Movement.relax` alone — a physical constraint the PLANNER could not see, so
 * a rock stopped hulls while never appearing on any route it computed.
 * `config.ts` had already measured the consequence under
 * HARVESTER_NAV_GIVEUP_SECONDS: a 2 m rock sealing a one-cell corridor against
 * a 3.87 m hull, parked for 2100 consecutive ticks. Reported as "our logic is
 * screwed up, and they blocking in a weird ways", and the flag was removed.
 * `lets the hull pass through` is the inverted assertion; the tripwire beside
 * it refuses BOTH flags on every prop in the table, because `Crushable` is the
 * wrong repair — entity and scatter props share geometry and the rock FAMILY is
 * excluded from `CRUSHABLE_FAMILIES`, so a crushable entity rock would dissolve
 * beside an identical instanced one that does not.
 *
 * The load-bearing one is still `does not break an ore route with a boulder
 * sitting on it`, and it passes on both sides of the change — which is the
 * point of keeping it. A rock must never be why a harvester cannot reach ore.
 * `leaves the nav grid alone` is the other guard worth keeping: it is what
 * stands between a future "fix" and a prop that closes cells.
 *
 * Everything is headless — typed arrays and the `ITerrain` port, no GL.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, FxKind, Locomotor, UnitState } from '../src/core/types';
import type { PlayerId, SimContext } from '../src/core/types';
import { CELL, SIM_DT, SCATTER_JITTER, SCATTER_LIMITS } from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator, setMoveClass } from '../src/sim/Movement';
import { CrushResolver, CRUSH } from '../src/sim/Crush';
import { FALLBACK_PROPS, PROP_DEF_ID } from '../src/game/Scenarios';
import { Terrain } from '../src/world/Terrain';
import { Scatter, isCrushableFamily } from '../src/world/Scatter';
import { PROP_DEFS, type PropFamily } from '../src/world/PropLibrary';

const P0 = 0 as PlayerId;
/** Cell index -> the world coordinate of its centre. */
const C = (c: number): number => (c + 0.5) * CELL;

interface Rig {
  world: World;
  channels: Channels;
  nav: FlowFieldCache;
  crush: CrushResolver;
  step(n?: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);
  const crush = new CrushResolver(world, channels);
  let tick = 0;
  const rng = new Rng(1234);
  const rig: Rig = {
    world, channels, nav, crush,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        tick++;
        const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
        world.store.snapshotPrev();
        assigner.simTick(s);
        steering.simTick(s);
        movement.simTick(s);
        // Phase.Movement / 970 — after the integrator, before SpatialRebuild.
        crush.simTick(s);
        world.spatial.rebuild();
      }
    },
  };
  return rig;
}

/**
 * A Scrapjaw: the Reclaim harvester, `crushLevel: 5` and `EntityFlag.Crusher`
 * in the def table. Hull radius 3.87 m matches `tests/wedge.spec.ts`.
 */
function spawnHarvester(rig: Rig, x: number, z: number, crusher = true): number {
  const st = rig.world.store;
  const id = st.alloc(EntityKind.Vehicle, 0, P0, Faction.Allies, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove | EntityFlag.IsHarvester;
  if (crusher) st.flags[i] |= EntityFlag.Crusher;
  st.maxSpeed[i] = 5.6;
  st.accel[i] = 6;
  st.turnRate[i] = 1.6;
  st.radius[i] = 3.87;
  st.locomotor[i] = Locomotor.Wheel;
  st.hp[i] = 850; st.maxHp[i] = 850;
  st.crushLevel[i] = crusher ? 5 : 0;
  setMoveClass(st, id, MoveClass.Wheel);
  return i;
}

/** A scenario prop, spawned exactly the way `ScenarioBuilder.spawnProp` does. */
function spawnProp(rig: Rig, key: string, x: number, z: number): number {
  const st = rig.world.store;
  const fb = FALLBACK_PROPS[key];
  const id = st.alloc(fb.kind, PROP_DEF_ID[key], P0, Faction.Neutral, x, 0, z, 0);
  const i = st.index(id);
  st.maxHp[i] = fb.maxHp; st.hp[i] = fb.maxHp;
  st.radius[i] = fb.radius;
  st.locomotor[i] = Locomotor.Static;
  st.flags[i] |= fb.flags;
  // NOTE: spawnProp really does leave `crushableBy` at 0. That is the reason
  // `CRUSH.propDefaultLevel` exists; see its comment.
  return i;
}

function orderTo(rig: Rig, i: number, x: number, z: number): void {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
}

const alive = (rig: Rig, i: number): boolean =>
  (rig.world.store.flags[i] & EntityFlag.Alive) !== 0
  && (rig.world.store.flags[i] & EntityFlag.PendingDestroy) === 0;

/** Drive `i` from its position to (x,z), stepping until it arrives or times out. */
function drive(rig: Rig, i: number, x: number, z: number, seconds = 30): void {
  orderTo(rig, i, x, z);
  rig.step(Math.round(seconds / SIM_DT));
}

/* ==========================================================================
 * 1. SOFT SCENERY YIELDS
 * ========================================================================== */

describe('a crusher flattens what it drives over', () => {
  it('fells a Crushable tree the hull passes through', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, C(40), C(50));
    const tree = spawnProp(rig, 'tree', C(50), C(50));
    rig.world.spatial.rebuild();

    expect(alive(rig, tree)).toBe(true);
    drive(rig, h, C(62), C(50));

    // The whole bug in one assertion: before the crush resolver existed the
    // harvester drove clean through and the tree finished at 120/120 HP.
    expect(alive(rig, tree)).toBe(false);
    expect(rig.crush.crushedProps).toBe(1);
  });

  it('leaves it standing for a vehicle that is not a Crusher', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, C(40), C(50), false);
    const tree = spawnProp(rig, 'tree', C(50), C(50));
    rig.world.spatial.rebuild();

    drive(rig, h, C(62), C(50));

    expect(alive(rig, tree)).toBe(true);
    expect(rig.crush.crushedProps).toBe(0);
  });

  it('crushes nothing while parked', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, C(50), C(50));
    // A tree inside the hull disc, and a hull that never gets an order.
    const tree = spawnProp(rig, 'tree', C(50) + 1.0, C(50));
    rig.world.spatial.rebuild();

    rig.step(200);

    expect(rig.world.store.speed[h]).toBeLessThan(CRUSH.minSpeed);
    expect(alive(rig, tree)).toBe(true);
  });

  it('obeys crushableBy — a hull too light leaves the prop alone', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, C(40), C(50));
    const tough = spawnProp(rig, 'tree', C(50), C(50));
    // Authored heavier than the harvester's crushLevel of 5.
    rig.world.store.crushableBy[tough] = 6;
    rig.world.spatial.rebuild();

    drive(rig, h, C(62), C(50));

    expect(alive(rig, tough)).toBe(true);
  });

  it('pushes the crunch that FxKind.CrushSquish was written for', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, C(40), C(50));
    spawnProp(rig, 'tree', C(50), C(50));
    rig.world.spatial.rebuild();

    drive(rig, h, C(62), C(50));

    let squishes = 0;
    for (let k = 0; k < rig.channels.fx.count; k++) {
      if (rig.channels.fx.kind[k] === FxKind.CrushSquish) squishes++;
    }
    expect(squishes).toBeGreaterThan(0);
  });

  it('is deterministic: one seed, two runs, identical outcome', () => {
    const run = (): string => {
      const rig = makeRig();
      const h = spawnHarvester(rig, C(40), C(50));
      const ids = ['tree', 'pine', 'bush', 'barrel'].map(
        (k, n) => spawnProp(rig, k, C(46 + n * 3), C(50)),
      );
      rig.world.spatial.rebuild();
      drive(rig, h, C(62), C(50));
      const st = rig.world.store;
      return JSON.stringify({
        x: st.posX[h], z: st.posZ[h],
        dead: ids.map((i) => alive(rig, i)),
        n: rig.crush.crushedProps,
      });
    };
    expect(run()).toBe(run());
  });
});

/* ==========================================================================
 * 2. HARD SCENERY DOES NOT
 * ========================================================================== */

describe('a rock is neither crushed nor solid', () => {
  it('survives a harvester at full speed', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, C(40), C(50));
    const boulder = spawnProp(rig, 'boulder', C(50), C(50));
    rig.world.spatial.rebuild();

    drive(rig, h, C(62), C(50));

    expect(alive(rig, boulder)).toBe(true);
  });

  /**
   * INVERTED, DELIBERATELY. This asserted the opposite — that `Movement.relax`
   * held the hull out of the boulder's disc — and it was the single test that
   * had to change when rocks stopped blocking.
   *
   * Reported as "our logic is screwed up, and they blocking in a weird ways".
   * The old constraint was physical only, and the planner could not see it, so
   * a rock stopped hulls while never appearing on any route: `config.ts` under
   * HARVESTER_NAV_GIVEUP_SECONDS records a 2 m rock sealing a one-cell corridor
   * and parking a hull for 2100 consecutive ticks. Keeping the assertion would
   * have pinned that behaviour in place.
   *
   * So the claim now is that NO prop is solid, which is the invariant the next
   * person needs — re-adding the flag to any prop fails here.
   */
  it('lets the hull pass through — no prop is solid', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const h = spawnHarvester(rig, C(40), C(50));
    const boulder = spawnProp(rig, 'boulder', C(50), C(50));
    rig.world.spatial.rebuild();

    orderTo(rig, h, C(62), C(50));
    let worst = Infinity;
    for (let k = 0; k < 900; k++) {
      rig.step(1);
      const d = Math.hypot(st.posX[h] - st.posX[boulder], st.posZ[h] - st.posZ[boulder]);
      if (d < worst) worst = d;
    }

    // Measured 1.68 m against a hull radius of 2.2 — the centre is inside its
    // own radius of the boulder's centre, so it drove over the spot rather than
    // being held off it. Steering's separation still nudges it, which is why
    // this is not zero.
    expect(worst, 'a hard constraint has come back').toBeLessThan(st.radius[h]);
  });

  it('carries neither BlocksNav nor Crushable, for rock and boulder alike', () => {
    // The rule in one place. `Crushable` is refused as well as `BlocksNav`:
    // entity props and scatter props share geometry, and `CRUSHABLE_FAMILIES`
    // excludes the rock family — so a crushable entity rock would dissolve
    // beside an identical instanced one that does not.
    for (const key of ['rock', 'boulder'] as const) {
      const fb = FALLBACK_PROPS[key];
      expect(fb.flags & EntityFlag.BlocksNav, `${key} must not block nav`).toBe(0);
      expect(fb.flags & EntityFlag.Crushable, `${key} must not be crushable`).toBe(0);
    }
    // And nothing else in the table has quietly picked the flag up.
    for (const [key, fb] of Object.entries(FALLBACK_PROPS)) {
      if (fb.kind !== EntityKind.Prop) continue;
      expect(fb.flags & EntityFlag.BlocksNav, `${key} must not block nav`).toBe(0);
    }
  });

  /**
   * THE ONE THAT MATTERS, and it passed before this change as well as after —
   * which is the point. A rock must never be the reason a harvester cannot
   * reach ore, whether it is solid or not.
   */
  it('does not break an ore route with a boulder sitting on it', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const h = spawnHarvester(rig, C(40), C(50));
    // Squarely on the straight line between the harvester and its destination.
    spawnProp(rig, 'boulder', C(51), C(50));
    rig.world.spatial.rebuild();

    // Out to the ore and back to the refinery, twice — a full economic loop.
    for (let lap = 0; lap < 2; lap++) {
      drive(rig, h, C(62), C(50));
      expect(Math.hypot(st.posX[h] - C(62), st.posZ[h] - C(50)),
        `lap ${lap}: never reached the ore`).toBeLessThan(6);
      drive(rig, h, C(40), C(50));
      expect(Math.hypot(st.posX[h] - C(40), st.posZ[h] - C(50)),
        `lap ${lap}: never got back to the refinery`).toBeLessThan(6);
    }
  });

  it('leaves the nav grid alone — the planner still routes over the cell', () => {
    const rig = makeRig();
    spawnProp(rig, 'boulder', C(50), C(50));
    rig.world.spatial.rebuild();
    // If this ever goes false, a prop has started closing cells and an ore
    // field behind a rock garden can become unreachable.
    expect(rig.nav.isPassableClass(50, 50, MoveClass.Wheel)).toBe(true);
    expect(rig.nav.isStandable(50, 50, MoveClass.Wheel)).toBe(true);
  });
});

/* ==========================================================================
 * 3. THE SCATTER CARPET
 *
 * 98% of the props on screen are instanced scatter, not entities, and both
 * populations are drawn from the same geometry on purpose. Crushing only the
 * entity 2% would mean two visually identical trees behaving differently.
 * ========================================================================== */

describe('Scatter.crushDisc', () => {
  const POS = new Float32Array(SCATTER_LIMITS.maxProps * 4);

  function scatterRig(): Scatter {
    const scene = new THREE.Scene();
    const terrain = new Terrain({ scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1 });
    const scatter = new Scatter({
      scene, terrain, biome: 'temperate', seed: 0x5ca77e, urban: 0.25, densityScale: 1,
      preferred: ['tree', 'bush', 'boulder'],
    });
    scatter.generate();
    return scatter;
  }

  /** Live props whose family satisfies `pick`. */
  function countFamily(scatter: Scatter, pick: (f: PropFamily) => boolean): number {
    const n = scatter.positions(POS);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const def = PROP_DEFS[POS[i * 4 + 3]];
      if (def !== undefined && pick(def.family)) hits++;
    }
    return hits;
  }

  it('only ever considers canopy and shrub soft', () => {
    // The rule itself, so a future roster edit cannot quietly make boulders
    // crushable by giving them a new family name.
    expect(isCrushableFamily('canopy')).toBe(true);
    expect(isCrushableFamily('shrub')).toBe(true);
    for (const f of ['grass', 'rock', 'street', 'yard', 'civic'] as const) {
      expect(isCrushableFamily(f), f).toBe(false);
    }
  });

  it('fells vegetation under the disc and nothing else', () => {
    const scatter = scatterRig();
    const before = scatter.propCount;
    const softBefore = countFamily(scatter, isCrushableFamily);
    const hardBefore = countFamily(scatter, (f) => !isCrushableFamily(f));
    expect(softBefore, 'the generator produced no crushable props').toBeGreaterThan(0);

    // Sweep a hull-sized disc along a line across the map, the way a harvester
    // on a haul route does.
    let felled = 0;
    for (let t = 0; t < 120; t++) felled += scatter.crushDisc(60 + t * 3, 256, 2.7);

    expect(felled, 'a 360 m sweep felled nothing').toBeGreaterThan(0);
    expect(scatter.propCount).toBe(before - felled);
    // Every casualty was soft; not one hard prop moved.
    expect(countFamily(scatter, isCrushableFamily)).toBe(softBefore - felled);
    expect(countFamily(scatter, (f) => !isCrushableFamily(f))).toBe(hardBefore);
  });

  it('uses the footprint radius, not the canopy — no felling at range', () => {
    const scatter = scatterRig();
    const n = scatter.positions(POS);
    const PROBE = 0.2;
    // `positions()` reports no per-instance scale, so bound it: every footprint
    // is tested at the largest scale the jitter can produce. Conservative in
    // both directions, which is what keeps this test measuring the RULE.
    const fatRadius = (defIndex: number): number => {
      const d = PROP_DEFS[defIndex];
      return d === undefined ? 0 : d.radius * (d.scaleMax ?? SCATTER_JITTER.scaleMax);
    };

    /** True if a `PROBE`-radius disc here overlaps NO crushable footprint. */
    const clearOfEverything = (x: number, z: number): boolean => {
      for (let k = 0; k < n; k++) {
        const d = PROP_DEFS[POS[k * 4 + 3]];
        if (d === undefined || !isCrushableFamily(d.family)) continue;
        const want = PROBE + fatRadius(POS[k * 4 + 3]);
        const dx = POS[k * 4] - x, dz = POS[k * 4 + 2] - z;
        if (dx * dx + dz * dz < want * want) return false;
      }
      return true;
    };

    // A canopy prop with at least one bearing on which a probe placed just
    // OUTSIDE its footprint is clear of every other crushable prop too. Trees
    // are clumped at 4.5 m spacing, so probing blind beside an arbitrary one
    // lands inside its neighbour and the test would measure the neighbour.
    let tx = -1, tz = 0, ox = 0, oz = 0;
    for (let i = 0; i < n && tx < 0; i++) {
      const def = PROP_DEFS[POS[i * 4 + 3]];
      if (def === undefined || def.family !== 'canopy') continue;
      const x = POS[i * 4], z = POS[i * 4 + 2];
      // Well outside the 2.2 m footprint at any scale, and still well inside
      // the ~4.5 m crown the canopy test in `clearFootprint` would have used.
      const reach = fatRadius(POS[i * 4 + 3]) + 0.6;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const qx = x + Math.cos(ang) * reach;
        const qz = z + Math.sin(ang) * reach;
        if (!clearOfEverything(qx, qz)) continue;
        tx = x; tz = z; ox = qx; oz = qz;
        break;
      }
    }
    expect(tx, 'no canopy prop with a clear flank on the map').toBeGreaterThanOrEqual(0);

    const before = scatter.propCount;
    // Outside the FOOTPRINT disc but inside the crown: misses.
    expect(scatter.crushDisc(ox, oz, PROBE)).toBe(0);
    expect(scatter.propCount).toBe(before);
    // On the trunk: does not.
    expect(scatter.crushDisc(tx, tz, PROBE)).toBeGreaterThan(0);
    expect(scatter.propCount).toBeLessThan(before);
  });

  it('reports the felled props so the caller can raise dust', () => {
    const scatter = scatterRig();
    const out = new Float32Array(8 * 4);
    let reported = 0;
    for (let t = 0; t < 200 && reported === 0; t++) {
      const n = scatter.crushDisc(40 + t * 2, 200, 3.0, out);
      if (n > 0) { reported = Math.min(n, 8); }
    }
    expect(reported).toBeGreaterThan(0);
    for (let q = 0; q < reported; q++) {
      expect(out[q * 4 + 3], 'reported radius').toBeGreaterThan(0);
      expect(Number.isFinite(out[q * 4]), 'reported x').toBe(true);
    }
  });
});
