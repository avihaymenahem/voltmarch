/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/deploy.spec.ts
 * ============================================================================
 * The MCV mechanic, end to end and headless.
 *
 * `src/sim/Deploy.ts` is a pure function over the World plus a service that
 * counts ticks, so all of it runs under `environment: 'node'`. Nothing here
 * constructs a renderer, and nothing here reads a clock.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - the vehicle does not block its own footprint (the bug that would make
 *     EVERY deploy fail, and the reason `placementIgnoring` exists)
 *   - the build radius does not apply to a deploy (the bug that would make the
 *     FIRST deploy of a match fail, which is the whole opening of an RTS)
 *   - a refusal is a refusal: no structure, no half-state, and the EVA line the
 *     UI already listens for
 *   - the fallback deploy table agrees with `src/data/Defs.ts`, so the version
 *     used by a boot with no data module cannot drift from the real content
 *   - two identical seeded runs deploy on the identical tick at the identical
 *     position
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import {
  EntityFlag, EntityKind, EvaLine, Faction, Locomotor, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';
import { CELL, MAX_SELECTION, SIM_DT } from '../src/core/config';

import {
  DEPLOY_TICKS, DeployFault, DeployService, FALLBACK_DEPLOYS_INTO, UNDEPLOY_TICKS,
  bindDeployTables, contentKeyOf, deployTargetForKey, evaluateDeploy, isDeployable,
  isUndeployable, makeDeployReport, undeployTargetForKey,
} from '../src/sim/Deploy';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { CursorKind } from '../src/input/Input';
import {
  createCapabilities, gatherDeployable, readCapabilities, resolveContextOrder,
} from '../src/input/Commands';
import type { OrderResolution } from '../src/input/Commands';

import { DEF_TABLES } from '../src/data/Defs';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  production: ProductionService;
  deploy: DeployService;
  eva: EvaLine[];
  tick: number;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const catalog = new ProductionCatalog(EMPTY_BINDING);
  const production = new ProductionService(world, channels, catalog);
  setProduction(production);
  // No data module in a headless test: the three-row fallback is the answer,
  // and `deployTargetForKey` is what proves the two agree (see the last block).
  bindDeployTables(null);

  const eva: EvaLine[] = [];
  channels.events.on('eva:line', (p) => { eva.push(p.line); });

  return { world, channels, production, deploy: new DeployService(world, channels), eva, tick: 0 };
}

/** One sim step: rebuild the spatial index the placement rule reads, then tick. */
function step(rig: Rig, steps = 1): void {
  const rng = new Rng(1234);
  for (let n = 0; n < steps; n++) {
    rig.tick++;
    rig.world.tick = rig.tick;
    rig.world.time = rig.tick * SIM_DT;
    rig.world.spatial.rebuild();
    const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.world.time, rng };
    rig.deploy.tick(s);
  }
}

/** Spawn a unit the way a factory or a scenario would. */
function spawnUnit(rig: Rig, key: string, x: number, z: number, player = 0): EntityId {
  const entry = rig.production.catalog.byKey(key);
  expect(entry, `no catalog entry for "${key}"`).not.toBeNull();
  const p = rig.world.player(player as PlayerId);
  return rig.production.spawnUnit(p, entry!, x, z, 0);
}

/** Plant a finished structure the way a scenario would. */
function spawnBuilding(rig: Rig, key: string, cx: number, cz: number, player = 0): EntityId {
  const entry = rig.production.catalog.byKey(key)!;
  const p = rig.world.player(player as PlayerId);
  return rig.production.spawnBuilding(p, entry, cx, cz, 1);
}

/** Write the Deploy order exactly as `input/Commands.ts#write` does. */
function orderDeploy(rig: Rig, id: EntityId): void {
  const st = rig.world.store;
  const i = st.index(id);
  expect(i).toBeGreaterThanOrEqual(0);
  st.orderKind[i] = OrderKind.Deploy;
  st.orderX[i] = st.posX[i];
  st.orderZ[i] = st.posZ[i];
  st.state[i] = UnitState.Idle;
}

/** The first live building of a key owned by `player`, or NONE. */
function findBuilding(rig: Rig, key: string, player = 0): EntityId {
  const st = rig.world.store;
  const list = st.byKind[EntityKind.Building];
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
    const i = list[a];
    if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
    if (st.owner[i] !== player) continue;
    if (contentKeyOf(rig.world, i) === key) return st.handleOf(i);
  }
  return NONE;
}

/** A terrain that refuses to be built on — a cliff, a lake, a crater field. */
function refuseBuildable(world: World): void {
  const base = world.terrain;
  const stub: ITerrain = {
    heightAt: (x, z) => base.heightAt(x, z),
    normalAt: (x, z, out) => base.normalAt(x, z, out),
    slopeAt: (x, z) => base.slopeAt(x, z),
    isPassable: (cx, cz, loco) => base.isPassable(cx, cz, loco),
    isBuildable: () => false,
    isOccupied: (cx, cz) => base.isOccupied(cx, cz),
    markOccupied: (cx, cz, w, h, id) => base.markOccupied(cx, cz, w, h, id),
    clearOccupied: (cx, cz, w, h) => base.clearOccupied(cx, cz, w, h),
    occupancyVersion: () => base.occupancyVersion(),
    isWater: (cx, cz) => base.isWater(cx, cz),
    raycastGround: (ox, oy, oz, dx, dy, dz, out) =>
      base.raycastGround(ox, oy, oz, dx, dy, dz, out),
  };
  world.terrain = stub;
}

beforeEach(() => {
  setProduction(null);
  bindDeployTables(null);
});

/* ==========================================================================
 * 1. THE CONTENT QUESTION
 * ========================================================================== */

describe('deploy targets', () => {
  it('agrees with src/data/Defs.ts, so the fallback table cannot drift', () => {
    // Every `deploysInto` in the real content must appear in the fallback map,
    // and the fallback map must claim nothing the content does not.
    const fromDefs: Record<string, string> = {};
    for (const u of DEF_TABLES.units) {
      if (u.deploysInto !== null) fromDefs[u.key] = u.deploysInto;
    }
    expect(fromDefs).toEqual(FALLBACK_DEPLOYS_INTO);
    expect(Object.keys(fromDefs).length).toBeGreaterThanOrEqual(3);
  });

  it('resolves forwards and backwards off the fallback table', () => {
    bindDeployTables(null);
    expect(deployTargetForKey('mcv')).toBe('conyard');
    expect(deployTargetForKey('mrdCarryall')).toBe('mrdConclave');
    expect(deployTargetForKey('rclCrawler')).toBe('rclFoundry');
    expect(deployTargetForKey('grizzly')).toBeNull();
    expect(undeployTargetForKey('conyard')).toBe('mcv');
    expect(undeployTargetForKey('powerPlant')).toBeNull();
  });

  it('resolves off the real def tables when a data module is bound', () => {
    bindDeployTables(DEF_TABLES);
    expect(deployTargetForKey('mcv')).toBe('conyard');
    expect(deployTargetForKey('rclCrawler')).toBe('rclFoundry');
    expect(deployTargetForKey('gi')).toBeNull();
    expect(undeployTargetForKey('mrdConclave')).toBe('mrdCarryall');
    bindDeployTables(null);
  });

  it('answers isDeployable for the vehicle and not for its escort', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const tank = spawnUnit(rig, 'grizzly', 60, 40);
    const st = rig.world.store;
    expect(isDeployable(rig.world, st.index(mcv))).toBe(true);
    expect(isDeployable(rig.world, st.index(tank))).toBe(false);
  });
});

/* ==========================================================================
 * 2. THE RULE
 * ========================================================================== */

describe('evaluateDeploy', () => {
  it('does not let the vehicle block its own footprint', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    rig.world.spatial.rebuild();
    const out = makeDeployReport();
    evaluateDeploy(rig.world, rig.production, rig.world.store.index(mcv), out);
    expect(out.fault).toBe(DeployFault.None);
    expect(out.ok).toBe(true);
    expect(out.entry?.key).toBe('conyard');
  });

  it('ignores the build radius, so the FIRST MCV of a match can deploy', () => {
    const rig = makeRig();
    // No structures at all: `evaluatePlacement` would refuse this outright.
    expect(rig.world.store.byKindCount[EntityKind.Building]).toBe(0);
    const mcv = spawnUnit(rig, 'mcv', 200, 200);
    rig.world.spatial.rebuild();
    const out = makeDeployReport();
    evaluateDeploy(rig.world, rig.production, rig.world.store.index(mcv), out);
    expect(out.ok).toBe(true);
  });

  it('leaves the masked flag exactly as it found it', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const i = rig.world.store.index(mcv);
    const before = rig.world.store.flags[i];
    rig.world.spatial.rebuild();
    evaluateDeploy(rig.world, rig.production, i, makeDeployReport());
    expect(rig.world.store.flags[i]).toBe(before);
  });

  it('refuses ground that cannot be built on', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    refuseBuildable(rig.world);
    rig.world.spatial.rebuild();
    const out = makeDeployReport();
    evaluateDeploy(rig.world, rig.production, rig.world.store.index(mcv), out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(DeployFault.Footprint);
    expect(out.reason.length).toBeGreaterThan(0);
  });

  it('refuses a site another structure already owns', () => {
    const rig = makeRig();
    spawnBuilding(rig, 'powerPlant', 10, 10);
    // Dead centre of the power plant's cells.
    const mcv = spawnUnit(rig, 'mcv', 11 * CELL, 11 * CELL);
    rig.world.spatial.rebuild();
    const out = makeDeployReport();
    evaluateDeploy(rig.world, rig.production, rig.world.store.index(mcv), out);
    expect(out.ok).toBe(false);
    expect(out.fault).toBe(DeployFault.Footprint);
  });

  it('refuses a unit that is not a construction vehicle', () => {
    const rig = makeRig();
    const tank = spawnUnit(rig, 'grizzly', 40, 40);
    rig.world.spatial.rebuild();
    const out = makeDeployReport();
    evaluateDeploy(rig.world, rig.production, rig.world.store.index(tank), out);
    expect(out.fault).toBe(DeployFault.NotDeployable);
    expect(out.entry).toBeNull();
  });
});

/* ==========================================================================
 * 3. THE TRANSITION
 * ========================================================================== */

describe('deploying', () => {
  it('unfolds an MCV into a finished Construction Yard', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const st = rig.world.store;
    const i = st.index(mcv);

    orderDeploy(rig, mcv);
    step(rig);
    // Visibly unpacking, not teleporting: immobilised and counting down.
    expect(st.state[i]).toBe(UnitState.Deploying);
    expect(st.flags[i] & EntityFlag.Immobilized).not.toBe(0);
    expect(rig.deploy.remaining(i)).toBe(DEPLOY_TICKS - 1);
    expect(findBuilding(rig, 'conyard')).toBe(NONE);

    step(rig, DEPLOY_TICKS - 1);

    const yard = findBuilding(rig, 'conyard');
    expect(yard).not.toBe(NONE);
    const bi = st.index(yard);
    expect(st.hp[bi]).toBe(st.maxHp[bi]);
    expect(st.buildProgress[bi]).toBe(1);
    expect(st.flags[bi] & EntityFlag.Deployed).not.toBe(0);
    expect(st.flags[bi] & EntityFlag.IsBuilder).not.toBe(0);
    // The vehicle left quietly — Selling is the no-fireball, no-wreck channel.
    expect(st.state[i]).toBe(UnitState.Selling);
    expect(st.flags[i] & EntityFlag.PendingDestroy).not.toBe(0);
    expect(rig.world.player(0 as PlayerId).stats.unitsLost).toBe(0);
  });

  it('lands the yard square to the grid whatever heading the MCV stopped on', () => {
    // THE FIRST BUILDING OF A MATCH WAS THE ONLY CROOKED ONE. Deploy copied the
    // vehicle's yaw straight into the structure, and a vehicle stops on
    // whatever heading it was driving — so the yard the whole base is built
    // outward from sat at an arbitrary angle across a square footprint.
    //
    // Nothing rejected it and no test could catch it, because placement stamps
    // cell-aligned cells at ANY yaw: the footprint was always right and only
    // the mesh was turned. That is why this asserts the stored yaw rather than
    // anything about occupancy.
    const QUARTER = Math.PI / 2;
    for (const heading of [0.4, 1.1, 2.7, -0.9, Math.PI * 0.77]) {
      const rig = makeRig();
      const mcv = spawnUnit(rig, 'mcv', 40, 40);
      const st = rig.world.store;
      st.yaw[st.index(mcv)] = heading;

      orderDeploy(rig, mcv);
      step(rig, DEPLOY_TICKS);

      const yard = findBuilding(rig, 'conyard');
      expect(yard, `heading ${heading}`).not.toBe(NONE);
      const yaw = st.yaw[st.index(yard)];
      const turns = yaw / QUARTER;
      expect(
        Math.abs(turns - Math.round(turns)),
        `yard yaw ${yaw} from MCV heading ${heading} is not a quarter turn`,
      ).toBeLessThan(1e-6);
    }
  });

  it('keeps the approach direction, quantised — it rounds rather than zeroing', () => {
    // Snapping must not mean "always face north". A player who drives in from
    // the east should get a yard facing east, just squarely.
    const QUARTER = Math.PI / 2;
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const st = rig.world.store;
    // Just past the midpoint between two quarter turns, so a round lands on the
    // FURTHER one and a truncate-to-zero would be caught.
    st.yaw[st.index(mcv)] = QUARTER * 0.6;

    orderDeploy(rig, mcv);
    step(rig, DEPLOY_TICKS);

    const yard = findBuilding(rig, 'conyard');
    expect(yard).not.toBe(NONE);
    expect(st.yaw[st.index(yard)]).toBeCloseTo(QUARTER, 5);
  });

  it('carries ownership and faction across the transition', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 300, 300, 1);
    orderDeploy(rig, mcv);
    step(rig, DEPLOY_TICKS);

    const yard = findBuilding(rig, 'conyard', 1);
    expect(yard).not.toBe(NONE);
    const bi = rig.world.store.index(yard);
    expect(rig.world.store.owner[bi]).toBe(1);
    expect(rig.world.store.faction[bi]).toBe(Faction.Soviets);
    expect(findBuilding(rig, 'conyard', 0)).toBe(NONE);
  });

  it('lands the structure snapped to the grid and claims its cells', () => {
    const rig = makeRig();
    // Deliberately off-centre inside a cell: the yard must still snap.
    const mcv = spawnUnit(rig, 'mcv', 20 * CELL + 1.3, 20 * CELL - 0.7);
    const entry = rig.production.catalog.byKey('conyard')!;
    orderDeploy(rig, mcv);
    step(rig, DEPLOY_TICKS);

    const yard = findBuilding(rig, 'conyard');
    const bi = rig.world.store.index(yard);
    const w = entry.footprintW;
    const h = entry.footprintH;
    const cx = Math.round(rig.world.store.posX[bi] / CELL - w * 0.5);
    const cz = Math.round(rig.world.store.posZ[bi] / CELL - h * 0.5);
    // Centre of the footprint, to the metre.
    expect(rig.world.store.posX[bi]).toBeCloseTo((cx + w * 0.5) * CELL, 6);
    expect(rig.world.store.posZ[bi]).toBeCloseTo((cz + h * 0.5) * CELL, 6);
    expect(rig.world.store.footprintW[bi]).toBe(w);
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        expect(rig.world.terrain.isOccupied(x, z), `cell ${x},${z}`).toBe(true);
      }
    }
  });

  it('announces the building it placed, so the HUD and progression hear it', () => {
    const rig = makeRig();
    const placed: number[] = [];
    const completed: number[] = [];
    rig.channels.events.on('building:placed', (p) => { placed.push(p.defId); });
    rig.channels.events.on('building:completed', (p) => { completed.push(p.defId); });

    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    orderDeploy(rig, mcv);
    step(rig, DEPLOY_TICKS);

    const conyard = rig.production.catalog.byKey('conyard')!;
    expect(placed).toContain(conyard.publicId);
    expect(completed).toContain(conyard.publicId);
    expect(rig.eva).toContain(EvaLine.ConstructionComplete);
  });

  it('refuses a blocked site with the EVA line the UI already listens for', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    refuseBuildable(rig.world);
    orderDeploy(rig, mcv);
    step(rig, DEPLOY_TICKS + 2);

    expect(rig.eva).toContain(EvaLine.CannotDeployHere);
    expect(findBuilding(rig, 'conyard')).toBe(NONE);
    const i = rig.world.store.index(mcv);
    // No half-state: the vehicle is alive, mobile and free of the order.
    expect(rig.world.store.state[i]).toBe(UnitState.Idle);
    expect(rig.world.store.orderKind[i]).toBe(OrderKind.None);
    expect(rig.world.store.flags[i] & EntityFlag.Immobilized).toBe(0);
  });

  it('refuses quietly for a unit that was never a construction vehicle', () => {
    const rig = makeRig();
    const tank = spawnUnit(rig, 'grizzly', 40, 40);
    orderDeploy(rig, tank);
    step(rig, 2);
    // An MCV in a mixed selection means the tanks got the order too; announcing
    // "cannot deploy here" once per tank would be noise, not feedback.
    expect(rig.eva).not.toContain(EvaLine.CannotDeployHere);
    expect(rig.world.store.orderKind[rig.world.store.index(tank)]).toBe(OrderKind.None);
  });

  it('aborts when the site is taken DURING the unpack', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    orderDeploy(rig, mcv);
    step(rig, 2);
    expect(rig.world.store.state[rig.world.store.index(mcv)]).toBe(UnitState.Deploying);
    // Something parks on the site half way through.
    refuseBuildable(rig.world);
    step(rig, DEPLOY_TICKS);

    expect(findBuilding(rig, 'conyard')).toBe(NONE);
    expect(rig.eva).toContain(EvaLine.CannotDeployHere);
  });
});

/* ==========================================================================
 * 4. UNDEPLOY — the same mechanic, backwards
 * ========================================================================== */

describe('undeploying', () => {
  it('folds a Construction Yard back into a construction vehicle', () => {
    const rig = makeRig();
    const yard = spawnBuilding(rig, 'conyard', 20, 20);
    const st = rig.world.store;
    const bi = st.index(yard);
    expect(isUndeployable(rig.world, bi)).toBe(true);

    st.orderKind[bi] = OrderKind.Deploy;
    step(rig);
    expect(st.state[bi]).toBe(UnitState.Deploying);
    step(rig, UNDEPLOY_TICKS - 1);

    // The structure is gone quietly and a vehicle stands where it was.
    expect(st.state[bi]).toBe(UnitState.Selling);
    expect(st.flags[bi] & EntityFlag.PendingDestroy).not.toBe(0);
    let mcvs = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      if (contentKeyOf(rig.world, i) === 'mcv') mcvs++;
    }
    expect(mcvs).toBe(1);
    // The footprint was released before the vehicle appeared on it.
    expect(rig.world.terrain.isOccupied(20, 20)).toBe(false);
  });

  it('refuses to fold a half-built structure', () => {
    const rig = makeRig();
    const p = rig.world.player(0 as PlayerId);
    const entry = rig.production.catalog.byKey('conyard')!;
    const yard = rig.production.spawnBuilding(p, entry, 20, 20, 0);
    const st = rig.world.store;
    const bi = st.index(yard);
    expect(isUndeployable(rig.world, bi)).toBe(false);

    st.orderKind[bi] = OrderKind.Deploy;
    step(rig, 2);
    expect(st.state[bi]).not.toBe(UnitState.Deploying);
    expect(st.flags[bi] & EntityFlag.PendingDestroy).toBe(0);
  });

  it('refuses to fold a structure with no vehicle form', () => {
    const rig = makeRig();
    const plant = spawnBuilding(rig, 'powerPlant', 30, 30);
    const st = rig.world.store;
    const bi = st.index(plant);
    expect(isUndeployable(rig.world, bi)).toBe(false);
    st.orderKind[bi] = OrderKind.Deploy;
    step(rig, 2);
    expect(st.flags[bi] & EntityFlag.PendingDestroy).toBe(0);
  });

  it('round-trips: deploy, undeploy, deploy again', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    orderDeploy(rig, mcv);
    step(rig, DEPLOY_TICKS);

    const yard = findBuilding(rig, 'conyard');
    expect(yard).not.toBe(NONE);
    const st = rig.world.store;
    st.orderKind[st.index(yard)] = OrderKind.Deploy;
    step(rig, UNDEPLOY_TICKS);
    expect(st.index(yard) >= 0 && (st.flags[st.index(yard)] & EntityFlag.PendingDestroy) !== 0)
      .toBe(true);

    // Find the vehicle it became and send it back down again.
    let again = NONE;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if ((st.flags[i] & EntityFlag.PendingDestroy) !== 0) continue;
      if (contentKeyOf(rig.world, i) === 'mcv') { again = st.handleOf(i); break; }
    }
    expect(again).not.toBe(NONE);
    orderDeploy(rig, again);
    step(rig, DEPLOY_TICKS);
    expect(findBuilding(rig, 'conyard')).not.toBe(NONE);
  });
});

/* ==========================================================================
 * 5. DETERMINISM
 * ========================================================================== */

describe('determinism', () => {
  it('two identical seeded runs deploy on the same tick at the same place', () => {
    const trace = (): string[] => {
      const rig = makeRig();
      const out: string[] = [];
      const mcv = spawnUnit(rig, 'mcv', 37.4, 51.9);
      orderDeploy(rig, mcv);
      for (let n = 0; n < DEPLOY_TICKS + 4; n++) {
        step(rig);
        const yard = findBuilding(rig, 'conyard');
        if (yard === NONE) {
          out.push(`${rig.tick}:waiting:${rig.deploy.remaining(rig.world.store.index(mcv))}`);
          continue;
        }
        const bi = rig.world.store.index(yard);
        out.push(
          `${rig.tick}:yard:${rig.world.store.posX[bi].toFixed(6)}:` +
          `${rig.world.store.posZ[bi].toFixed(6)}:${rig.world.store.hp[bi]}`,
        );
      }
      return out;
    };

    const a = trace();
    const b = trace();
    expect(a).toEqual(b);
    // And it actually got somewhere, so the comparison is not two empty logs.
    expect(a.some((line) => line.includes(':yard:'))).toBe(true);
  });

  it('reads no wall clock', () => {
    // The unpack is counted in TICKS. Passing a SimContext whose `time` runs
    // backwards must not change the outcome by a single tick.
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    orderDeploy(rig, mcv);
    const rng = new Rng(9);
    for (let n = 0; n < DEPLOY_TICKS; n++) {
      rig.world.spatial.rebuild();
      rig.deploy.tick({ dt: SIM_DT, tick: 1000 - n, time: 999 - n, rng });
    }
    expect(findBuilding(rig, 'conyard')).not.toBe(NONE);
  });
});

/* ==========================================================================
 * 6. THE INPUT SURFACE
 * ========================================================================== */

describe('input', () => {
  const IDS = new Int32Array(MAX_SELECTION);

  it('counts construction vehicles in the selection', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const tank = spawnUnit(rig, 'grizzly', 60, 40);
    const sel = new Int32Array([mcv as number, tank as number]);
    const caps = createCapabilities();
    readCapabilities(rig.world, sel, 2, caps);
    expect(caps.deployCount).toBe(1);
    expect(caps.mobileCount).toBe(2);
  });

  it('gathers only the vehicles, leaving the escort alone', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const tank = spawnUnit(rig, 'grizzly', 60, 40);
    const enemy = spawnUnit(rig, 'mcv', 300, 300, 1);
    const sel = new Int32Array([tank as number, mcv as number, enemy as number]);
    const n = gatherDeployable(rig.world, sel, 3, IDS);
    expect(n).toBe(1);
    expect(IDS[0]).toBe(mcv as number);
  });

  it('does not gather a vehicle that is already unpacking', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    orderDeploy(rig, mcv);
    step(rig);
    const sel = new Int32Array([mcv as number]);
    expect(gatherDeployable(rig.world, sel, 1, IDS)).toBe(0);
  });

  it('offers deploy under the cursor when the MCV is the one selected', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const caps = createCapabilities();
    readCapabilities(rig.world, new Int32Array([mcv as number]), 1, caps);

    const res: OrderResolution = {
      order: OrderKind.None, target: NONE, x: 0, z: 0,
      cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '',
    };
    resolveContextOrder(
      rig.world, mcv, 40, 40, true, { shift: false, ctrl: false, alt: false }, 0, caps, res,
    );
    expect(res.order).toBe(OrderKind.Deploy);
    expect(res.cursor).toBe(CursorKind.Deploy);
    expect(res.target).toBe(mcv);
    expect(res.valid).toBe(true);
  });

  it('still means MOVE on bare ground with an MCV selected', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const caps = createCapabilities();
    readCapabilities(rig.world, new Int32Array([mcv as number]), 1, caps);

    const res: OrderResolution = {
      order: OrderKind.None, target: NONE, x: 0, z: 0,
      cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '',
    };
    resolveContextOrder(
      rig.world, NONE, 120, 120, true, { shift: false, ctrl: false, alt: false }, 0, caps, res,
    );
    expect(res.order).toBe(OrderKind.Move);
  });

  it('does not offer deploy over a tank', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const tank = spawnUnit(rig, 'grizzly', 60, 40);
    const caps = createCapabilities();
    readCapabilities(rig.world, new Int32Array([mcv as number, tank as number]), 2, caps);

    const res: OrderResolution = {
      order: OrderKind.None, target: NONE, x: 0, z: 0,
      cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '',
    };
    resolveContextOrder(
      rig.world, tank, 60, 40, true, { shift: false, ctrl: false, alt: false }, 0, caps, res,
    );
    expect(res.order).not.toBe(OrderKind.Deploy);
  });
});

/* ==========================================================================
 * 7. THE STORE COLUMNS THE MECHANIC TOUCHES
 * ========================================================================== */

describe('locomotion', () => {
  it('immobilises the vehicle for exactly the unpack, and frees it on refusal', () => {
    const rig = makeRig();
    const mcv = spawnUnit(rig, 'mcv', 40, 40);
    const st = rig.world.store;
    const i = st.index(mcv);
    expect(st.locomotor[i]).not.toBe(Locomotor.Static);

    orderDeploy(rig, mcv);
    step(rig, 2);
    expect(st.flags[i] & EntityFlag.Immobilized).not.toBe(0);

    refuseBuildable(rig.world);
    step(rig, DEPLOY_TICKS);
    expect(st.flags[i] & EntityFlag.Immobilized).toBe(0);
    expect(st.state[i]).toBe(UnitState.Idle);
  });
});
