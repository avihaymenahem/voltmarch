/**
 * Save/load — the snapshot format, its version gates, and the store.
 *
 * Everything here is headless. `SaveGame.ts` reads the world through the same
 * public surfaces the game does (`EntityStore.alloc`, the `IVision`/`IOreField`
 * ports, `CameraRig.setPose`), so a test can drive it with a bare `World` and a
 * handful of small fakes — no GL context, no bootstrap, no browser.
 *
 * The tests that matter most, and would each fail without the corresponding
 * part of the implementation:
 *
 *   - round trip: deep equality of every column that matters, not "it loaded";
 *   - GENERATION HANDLES: a handle minted before a load must be dead after it,
 *     and a generation-stamped side array must read as absent rather than
 *     inheriting the previous tenant's value;
 *   - a schema bump refuses instead of loading;
 *   - a truncated or bit-flipped blob refuses instead of throwing;
 *   - fog explored bits survive; queues mid-progress survive; ore depletion
 *     survives; the scatter-clear ledger survives and is replayed.
 */

import { describe, expect, it } from 'vitest';

import { World, PerEntityF32 } from '../src/core/world';
import {
  BuildTab, EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance, UnitState,
} from '../src/core/types';
import type { DefTables, EntityId, PlayerId } from '../src/core/types';
import { CELL, MAP_CELLS, MAP_CELL_COUNT, MAX_ENTITIES } from '../src/core/config';
import {
  captureSnapshot, defIndexFromTables, readSnapshotMeta, restoreSnapshot, structuralHash,
  SAVE_SCHEMA_VERSION,
  type ClearedFootprint, type DefIndex, type SnapshotHost,
} from '../src/game/SaveGame';
import {
  MemoryBackend, SaveStore, autosaveSlotId, base64ToBytes, bytesToBase64,
  nextAutosaveSlot, type IndexStorage, type SaveSlotInfo,
} from '../src/game/SaveStore';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/**
 * A def index over a tiny literal table. Deliberately NOT the real one: the
 * point of storing keys instead of indices is that the table can change, and a
 * test that pinned itself to the shipping content could not show that.
 */
function makeDefs(
  units: readonly string[] = ['grizzly', 'harvester', 'mcv'],
  buildings: readonly { key: string; w: number; h: number }[] = [
    { key: 'conyard', w: 3, h: 3 },
    { key: 'refinery', w: 3, h: 2 },
    { key: 'powerPlant', w: 2, h: 2 },
  ],
): DefIndex {
  return {
    unitKeyOf: (id) => units[id] ?? '',
    unitIdOf: (key) => units.indexOf(key),
    buildingKeyOf: (id) => buildings[id]?.key ?? '',
    buildingIdOf: (key) => buildings.findIndex((b) => b.key === key),
    buildingFootprint: (key) => {
      const b = buildings.find((x) => x.key === key);
      return b === undefined ? null : { w: b.w, h: b.h };
    },
  };
}

/** A fog-of-war stand-in with the two methods the port pair actually needs. */
class FakeVision {
  readonly grids: Uint8Array[] = [];
  constructor(players = 2) {
    for (let i = 0; i < players; i++) this.grids.push(new Uint8Array(MAP_CELL_COUNT));
  }
  gridFor(player: PlayerId): Uint8Array {
    return this.grids[player as number] ?? this.grids[0];
  }
  exploreCircle(player: PlayerId, x: number, z: number, r: number): void {
    const g = this.grids[player as number];
    if (g === undefined) return;
    const cx0 = Math.max(0, Math.floor((x - r) / CELL));
    const cx1 = Math.min(MAP_CELLS - 1, Math.floor((x + r) / CELL));
    const cz0 = Math.max(0, Math.floor((z - r) / CELL));
    const cz1 = Math.min(MAP_CELLS - 1, Math.floor((z + r) / CELL));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = (cx + 0.5) * CELL - x;
        const dz = (cz + 0.5) * CELL - z;
        if (dx * dx + dz * dz > r * r) continue;
        g[cz * MAP_CELLS + cx] |= 0b10;
      }
    }
  }
  exploredCount(player: PlayerId): number {
    const g = this.grids[player as number];
    let n = 0;
    for (let i = 0; i < g.length; i++) if ((g[i] & 0b10) !== 0) n++;
    return n;
  }
}

/** An ore field with the two port methods and a regenerate-from-capacity reset. */
class FakeOre {
  readonly amount = new Float32Array(MAP_CELL_COUNT);
  readonly capacity = new Float32Array(MAP_CELL_COUNT);
  seed(cx: number, cz: number, v: number): void {
    const i = cz * MAP_CELLS + cx;
    this.amount[i] = v;
    this.capacity[i] = v;
  }
  /** What a scenario rebuild does: every field back to full. */
  regenerate(): void {
    this.amount.set(this.capacity);
  }
  oreAt(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return 0;
    return this.amount[cz * MAP_CELLS + cx];
  }
  takeOre(cx: number, cz: number, want: number): number {
    const i = cz * MAP_CELLS + cx;
    const got = Math.min(this.amount[i], want);
    this.amount[i] -= got;
    return got;
  }
}

class FakeCamera {
  x = 0; z = 0; yaw = 0; pitch = 0.9; distance = 55;
  getPose(): { x: number; z: number; yaw: number; pitch: number; distance: number } {
    return { x: this.x, z: this.z, yaw: this.yaw, pitch: this.pitch, distance: this.distance };
  }
  setPose(p: { x?: number; z?: number; yaw?: number; distance?: number; immediate?: boolean }): void {
    if (p.x !== undefined) this.x = p.x;
    if (p.z !== undefined) this.z = p.z;
    if (p.yaw !== undefined) this.yaw = p.yaw;
    if (p.distance !== undefined) this.distance = p.distance;
  }
}

class FakeScatter {
  readonly calls: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  clearFootprint(minX: number, minZ: number, maxX: number, maxZ: number): number {
    this.calls.push({ minX, minZ, maxX, maxZ });
    return 1;
  }
}

/**
 * A scatter that ALSO carries the felled-prop mask — one bit per generated prop
 * placement, so a trail a vehicle crushed survives a load and not only the
 * building footprints.
 *
 * `FakeScatter` above deliberately stays without it. The mask surface is
 * duck-typed exactly like `SuperweaponChargeSetter`, and a host that cannot
 * supply one has to keep round-tripping through the footprint replay — that is
 * the compatibility contract, so both shapes are exercised.
 *
 * 4178 placements is the measured count on `temperate` seed 7, so the byte
 * assertions below are against a real map's size and not a round number.
 */
const MEASURED_PLACEMENTS = 4178;

class FakeMaskScatter {
  readonly calls: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  private readonly bits: Uint8Array;

  constructor(
    readonly placementCount = MEASURED_PLACEMENTS,
    public placementFingerprint = 0xa17c93d1,
  ) {
    this.bits = new Uint8Array((placementCount + 7) >> 3);
  }

  fell(...indices: number[]): this {
    for (const i of indices) this.bits[i >> 3] |= 1 << (i & 7);
    return this;
  }
  isFelled(i: number): boolean { return (this.bits[i >> 3] & (1 << (i & 7))) !== 0; }
  get felledCount(): number {
    let n = 0;
    for (let i = 0; i < this.placementCount; i++) if (this.isFelled(i)) n++;
    return n;
  }

  clearFootprint(minX: number, minZ: number, maxX: number, maxZ: number): number {
    this.calls.push({ minX, minZ, maxX, maxZ });
    return 1;
  }
  felledMask(out: Uint8Array): number {
    if (out.length < this.bits.length) return 0;
    out.set(this.bits);
    return this.bits.length;
  }
  applyFelledMask(mask: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < this.placementCount; i++) {
      if ((mask[i >> 3] & (1 << (i & 7))) === 0 || this.isFelled(i)) continue;
      this.fell(i);
      n++;
    }
    return n;
  }
}

class FakeSuperweapons {
  readonly charge = new Map<string, number>();
  private key(p: PlayerId, k: string): string { return `${p as number}|${k}`; }
  set(p: PlayerId, k: string, seconds: number): void { this.charge.set(this.key(p, k), seconds); }
  states(player: PlayerId): readonly { key: string; remaining: number; available: boolean }[] {
    const out: { key: string; remaining: number; available: boolean }[] = [];
    for (const [k, v] of this.charge) {
      const [p, key] = k.split('|');
      if (Number(p) !== (player as number)) continue;
      out.push({ key, remaining: v, available: true });
    }
    return out;
  }
  grantReady(player: PlayerId, key: string): boolean {
    this.charge.set(this.key(player, key), 0);
    return true;
  }
}

interface Fixture {
  world: World;
  vision: FakeVision;
  ore: FakeOre;
  camera: FakeCamera;
  scatter: FakeScatter;
  sw: FakeSuperweapons;
  cleared: ClearedFootprint[];
  host: SnapshotHost;
}

/** A two-player world with a couple of players and no entities yet. */
function makeFixture(overrides: Partial<SnapshotHost> = {}): Fixture {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);

  const vision = new FakeVision(2);
  const ore = new FakeOre();
  const camera = new FakeCamera();
  const scatter = new FakeScatter();
  const sw = new FakeSuperweapons();
  const cleared: ClearedFootprint[] = [];

  const host: SnapshotHost = {
    world,
    seed: 1234,
    tick: 900,
    simTimeSec: 30,
    rngState: 0xdeadbeef,
    speedIndex: 1,
    scenario: 'skirmish',
    map: 'ridgeline',
    defs: makeDefs(),
    camera,
    vision,
    ore,
    scatter,
    superweapons: sw,
    clearedFootprints: cleared,
    ...overrides,
  };

  return { world, vision, ore, camera, scatter, sw, cleared, host };
}

/** A fresh world built from the same scenario/seed — what a load boots into. */
function makeDestination(source: Fixture): Fixture {
  const dest = makeFixture();
  dest.host.seed = source.host.seed;
  dest.host.scenario = source.host.scenario;
  dest.host.map = source.host.map;
  return dest;
}

function spawnTank(world: World, owner: PlayerId, x: number, z: number, defId = 0): EntityId {
  const id = world.store.alloc(
    EntityKind.Vehicle, defId, owner,
    owner === P0 ? Faction.Allies : Faction.Soviets, x, 0, z, 0.5,
  );
  const s = world.store;
  const i = s.index(id);
  s.hp[i] = 240; s.maxHp[i] = 300;
  s.maxSpeed[i] = 9; s.accel[i] = 6; s.turnRate[i] = 2.2;
  s.locomotor[i] = Locomotor.Track;
  s.radius[i] = 2.1;
  s.sight[i] = 14;
  s.weaponIndex[i] = 3;
  s.cooldown[i] = 0.75;
  s.state[i] = UnitState.AttackMoving;
  s.orderKind[i] = OrderKind.AttackMove;
  s.orderX[i] = x + 40; s.orderZ[i] = z + 12;
  s.stance[i] = Stance.Defensive;
  s.veterancy[i] = 1;
  s.killCount[i] = 3;
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | EntityFlag.ProvidesVision;
  return id;
}

function spawnRefinery(world: World, owner: PlayerId, cx: number, cz: number): EntityId {
  const x = (cx + 1.5) * CELL;
  const z = (cz + 1) * CELL;
  const id = world.store.alloc(EntityKind.Building, 1, owner, Faction.Allies, x, 0, z, 0);
  const s = world.store;
  const i = s.index(id);
  s.footprintW[i] = 3; s.footprintH[i] = 2;
  s.hp[i] = 900; s.maxHp[i] = 1000;
  s.powerDraw[i] = -30;
  s.buildProgress[i] = 1;
  s.flags[i] |= EntityFlag.IsRefinery | EntityFlag.BlocksNav | EntityFlag.NeedsPower;
  return id;
}

/** A mid-game-ish world: a base, an army, queues, fog, ore, selection. */
function populate(fx: Fixture, tanks = 60): { tanks: EntityId[]; refinery: EntityId } {
  const { world } = fx;
  const refinery = spawnRefinery(world, P0, 20, 20);
  const list: EntityId[] = [];
  for (let i = 0; i < tanks; i++) {
    list.push(spawnTank(world, i % 3 === 0 ? P1 : P0, 100 + (i % 12) * 5, 100 + Math.floor(i / 12) * 5));
  }

  // A harvester docked at the refinery — the reference that must survive.
  const harvester = spawnTank(world, P0, 96, 92, 1);
  world.store.dockTarget[world.store.index(harvester)] = refinery as number;
  world.store.cargo[world.store.index(harvester)] = 420;

  // A live target reference between two units.
  world.store.targetId[world.store.index(list[0])] = list[1] as number;

  const p0 = world.player(P0);
  p0.credits = 4310;
  p0.powerProduced = 200;
  p0.powerConsumed = 165;
  p0.hasRadar = true;
  p0.techMask[7] = 1;
  p0.buildingCount[1] = 1;
  p0.stats.oreMined = 9100;
  p0.rallyX.set(refinery as number, 300);
  p0.rallyZ.set(refinery as number, 310);
  p0.queues[BuildTab.Vehicles].items.push(
    { defId: 0, isBuilding: false, progress: 0.42, spent: 378, cost: 900, ready: false, onHold: false },
    { defId: 1, isBuilding: false, progress: 0, spent: 0, cost: 1400, ready: false, onHold: true },
  );
  p0.queues[BuildTab.Structures].items.push(
    { defId: 2, isBuilding: true, progress: 1, spent: 600, cost: 600, ready: true, onHold: false },
  );
  p0.queues[BuildTab.Structures].awaitingPlacement = true;
  p0.queues[BuildTab.Vehicles].factoryCount = 2;

  // Selection and a control group.
  const sel = world.selection;
  sel.count = 0;
  for (let i = 0; i < 5; i++) {
    sel.ids[sel.count++] = list[i] as number;
    // input/Selection.ts owns this bit in the live game; the fixture has to set
    // it too or the round-trip comparison is measuring the fixture, not the code.
    world.store.flags[world.store.index(list[i])] |= EntityFlag.Selected;
  }
  sel.groups[2][0] = list[7] as number;
  sel.groups[2][1] = list[8] as number;
  sel.groupCounts[2] = 2;

  // Fog: a scouted corridor for each player.
  fx.vision.exploreCircle(P0, 200, 200, 60);
  fx.vision.exploreCircle(P1, 400, 120, 40);

  // Ore: a patch, half mined out.
  for (let cz = 40; cz < 50; cz++) {
    for (let cx = 40; cx < 50; cx++) fx.ore.seed(cx, cz, 100);
  }
  for (let cz = 40; cz < 45; cz++) {
    for (let cx = 40; cx < 45; cx++) fx.ore.takeOre(cx, cz, 62);
  }

  fx.camera.x = 260; fx.camera.z = 310; fx.camera.yaw = 0.7; fx.camera.distance = 78;

  fx.cleared.push({ cx: 20, cz: 20, w: 3, h: 2 }, { cx: 44, cz: 61, w: 2, h: 2 });

  world.spatial.rebuild();
  return { tanks: list, refinery };
}

/** Capture, then restore into a fresh world, returning both sides. */
function roundTrip(tanks = 60): { src: Fixture; dst: Fixture; bytes: Uint8Array } {
  const src = makeFixture();
  populate(src, tanks);
  const captured = captureSnapshot(src.host, 'test');
  if (!captured.ok) throw new Error(`capture refused: ${captured.reason}`);

  const dst = makeDestination(src);
  dst.ore.capacity.set(src.ore.capacity);
  dst.ore.regenerate();

  const restored = restoreSnapshot(captured.value.bytes, dst.host);
  if (!restored.ok) throw new Error(`restore refused: ${restored.reason}`);
  return { src, dst, bytes: captured.value.bytes };
}

/* ==========================================================================
 * ROUND TRIP
 * ========================================================================== */

describe('snapshot round trip', () => {
  it('restores every entity column that matters, not just the count', () => {
    const { src, dst } = roundTrip();
    const a = src.world.store;
    const b = dst.world.store;

    expect(b.aliveCount).toBe(a.aliveCount);

    // The store is compacted on the way in, so compare the DENSE order.
    const orderA = Array.from(a.alive.subarray(0, a.aliveCount)).sort((x, y) => x - y);
    const orderB = Array.from(b.alive.subarray(0, b.aliveCount)).sort((x, y) => x - y);
    expect(orderB.length).toBe(orderA.length);

    const columns: (keyof typeof a & string)[] = [
      'kind', 'owner', 'faction', 'defId', 'flags', 'spawnTick',
      'posX', 'posY', 'posZ', 'yaw', 'turretYaw', 'barrelPitch',
      'velX', 'velZ', 'speed', 'maxSpeed', 'accel', 'turnRate', 'locomotor', 'radius',
      'hp', 'maxHp', 'armorClass', 'sight', 'weaponIndex', 'cooldown', 'burstLeft',
      'veterancy', 'killCount', 'crushLevel', 'crushableBy',
      'state', 'orderKind', 'orderX', 'orderZ', 'stance', 'guardX', 'guardZ',
      'cargo', 'cargoMax', 'buildProgress', 'footprintW', 'footprintH', 'powerDraw',
      'animClip', 'animTime', 'emissive', 'seed',
    ];

    for (let k = 0; k < orderA.length; k++) {
      const ia = orderA[k];
      const ib = orderB[k];
      for (const c of columns) {
        const va = (a[c] as unknown as ArrayLike<number>)[ia];
        const vb = (b[c] as unknown as ArrayLike<number>)[ib];
        expect(`${c}[${k}]=${vb}`).toBe(`${c}[${k}]=${va}`);
      }
    }
  });

  it('remaps handle-valued columns onto the new entities', () => {
    const { src, dst } = roundTrip();
    const a = src.world.store;
    const b = dst.world.store;

    // Find the harvester by its cargo, on both sides, and check its dock target
    // still points at a refinery — through a DIFFERENT handle value.
    const findCargo = (s: typeof a): number => {
      for (let k = 0; k < s.aliveCount; k++) {
        const i = s.alive[k];
        if (s.cargo[i] === 420) return i;
      }
      return -1;
    };
    const ia = findCargo(a);
    const ib = findCargo(b);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);

    const dockA = a.index(a.dockTarget[ia] as EntityId);
    const dockB = b.index(b.dockTarget[ib] as EntityId);
    expect(dockA).toBeGreaterThanOrEqual(0);
    expect(dockB).toBeGreaterThanOrEqual(0);
    expect(b.kind[dockB]).toBe(EntityKind.Building);
    expect(b.footprintW[dockB]).toBe(3);
    // The handle VALUE must have changed — the generations were bumped.
    expect(b.dockTarget[ib]).not.toBe(a.dockTarget[ia]);
  });

  it('drops a handle that pointed at something already dead', () => {
    const src = makeFixture();
    const { tanks } = populate(src, 8);
    const s = src.world.store;

    const victim = tanks[1];
    s.targetId[s.index(tanks[0])] = victim as number;
    s.markDead(victim);
    s.flushDestroyed();

    const captured = captureSnapshot(src.host, 'stale');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    const restored = restoreSnapshot(captured.value.bytes, dst.host);
    expect(restored.ok).toBe(true);

    // Whatever took slot 0's place must not have inherited a target.
    const b = dst.world.store;
    for (let k = 0; k < b.aliveCount; k++) {
      const i = b.alive[k];
      const t = b.targetId[i];
      if (t === 0) continue;
      expect(b.index(t as EntityId)).toBeGreaterThanOrEqual(0);
    }
  });

  it('restores per-player state including queues mid-progress', () => {
    const { src, dst } = roundTrip(12);
    const a = src.world.player(P0);
    const b = dst.world.player(P0);

    expect(b.credits).toBe(a.credits);
    expect(b.powerProduced).toBe(a.powerProduced);
    expect(b.powerConsumed).toBe(a.powerConsumed);
    expect(b.hasRadar).toBe(a.hasRadar);
    expect(b.techMask[7]).toBe(1);
    expect(b.buildingCount[1]).toBe(1);
    expect(b.stats.oreMined).toBe(9100);

    const qa = a.queues[BuildTab.Vehicles];
    const qb = b.queues[BuildTab.Vehicles];
    expect(qb.factoryCount).toBe(qa.factoryCount);
    expect(qb.items.length).toBe(qa.items.length);
    expect(qb.items[0].progress).toBeCloseTo(0.42, 6);
    expect(qb.items[0].spent).toBe(378);
    expect(qb.items[0].cost).toBe(900);
    expect(qb.items[0].defId).toBe(0);
    expect(qb.items[1].onHold).toBe(true);

    const sb = b.queues[BuildTab.Structures];
    expect(sb.awaitingPlacement).toBe(true);
    expect(sb.items[0].ready).toBe(true);
    expect(sb.items[0].isBuilding).toBe(true);
  });

  it('restores rally points onto the new factory handle', () => {
    const { dst } = roundTrip(12);
    const p = dst.world.player(P0);
    expect(p.rallyX.size).toBe(1);
    const [handle, x] = [...p.rallyX.entries()][0];
    expect(x).toBe(300);
    expect(p.rallyZ.get(handle)).toBe(310);
    // And it must resolve to a live building.
    const i = dst.world.store.index(handle as EntityId);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(dst.world.store.kind[i]).toBe(EntityKind.Building);
  });

  it('restores selection and control groups', () => {
    const { src, dst } = roundTrip(12);
    expect(dst.world.selection.count).toBe(src.world.selection.count);
    expect(dst.world.selection.groupCounts[2]).toBe(2);
    for (let i = 0; i < dst.world.selection.count; i++) {
      const h = dst.world.selection.ids[i] as EntityId;
      expect(dst.world.store.index(h)).toBeGreaterThanOrEqual(0);
      expect(dst.world.store.flags[dst.world.store.index(h)] & EntityFlag.Selected).not.toBe(0);
    }
  });

  it('restores the camera pose', () => {
    const { src, dst } = roundTrip(6);
    expect(dst.camera.x).toBeCloseTo(src.camera.x, 4);
    expect(dst.camera.z).toBeCloseTo(src.camera.z, 4);
    expect(dst.camera.yaw).toBeCloseTo(src.camera.yaw, 4);
    expect(dst.camera.distance).toBeCloseTo(src.camera.distance, 4);
  });

  it('re-marks terrain occupancy for restored buildings', () => {
    const { dst } = roundTrip(6);
    // The refinery footprint starts at cell (20,20) and is 3x2.
    expect(dst.world.terrain.isOccupied(20, 20)).toBe(true);
    expect(dst.world.terrain.isOccupied(22, 21)).toBe(true);
    expect(dst.world.terrain.isOccupied(23, 21)).toBe(false);
  });

  it('carries the clocks back out for the caller to re-seat', () => {
    const src = makeFixture();
    populate(src, 4);
    src.host.tick = 71234;
    src.host.simTimeSec = 71234 / 30;
    src.host.rngState = 0x1234abcd;
    src.host.speedIndex = 2;

    const captured = captureSnapshot(src.host, 'clocks');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    const restored = restoreSnapshot(captured.value.bytes, dst.host);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    expect(restored.value.tick).toBe(71234);
    expect(restored.value.rngState).toBe(0x1234abcd);
    expect(restored.value.speedIndex).toBe(2);
    expect(dst.world.tick).toBe(71234);
  });
});

/* ==========================================================================
 * GENERATION HANDLES — the silent-corruption class
 * ========================================================================== */

describe('generation handles do not resurrect', () => {
  it('kills every handle minted before the load', () => {
    const src = makeFixture();
    const { tanks } = populate(src, 20);
    const captured = captureSnapshot(src.host, 'gen');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    // Restore back into the SAME world — the hardest case, because the slots
    // are about to be handed straight back out.
    const before: EntityId[] = tanks.slice(0, 10);
    for (const h of before) expect(src.world.store.index(h)).toBeGreaterThanOrEqual(0);

    const restored = restoreSnapshot(captured.value.bytes, src.host);
    expect(restored.ok).toBe(true);

    for (const h of before) {
      expect(src.world.store.index(h)).toBe(-1);
      expect(src.world.store.isAlive(h)).toBe(false);
    }
  });

  it('makes a generation-stamped side array read as absent after a load', () => {
    const src = makeFixture();
    const { tanks } = populate(src, 12);

    // A module's private per-entity value, exactly as `PerEntityF32` is used
    // across the codebase.
    const side = new PerEntityF32(src.world.store, -1);
    for (const h of tanks) side.set(h, 99);
    expect(side.get(tanks[0])).toBe(99);

    const captured = captureSnapshot(src.host, 'side');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(restoreSnapshot(captured.value.bytes, src.host).ok).toBe(true);

    // Every slot now carries a generation nothing has ever stamped, so every
    // slot reads the default. Without the bump, slot 0's stale 99 would be
    // inherited by whatever entity landed there.
    const s = src.world.store;
    for (let k = 0; k < s.aliveCount; k++) {
      expect(side.getAt(s.alive[k])).toBe(-1);
    }
  });

  it('advances the generation of free slots too', () => {
    const src = makeFixture();
    populate(src, 4);
    const s = src.world.store;
    const genBefore = new Uint16Array(s.gen);

    const captured = captureSnapshot(src.host, 'freegen');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(restoreSnapshot(captured.value.bytes, src.host).ok).toBe(true);

    let differing = 0;
    for (let i = 0; i < MAX_ENTITIES; i++) if (s.gen[i] !== genBefore[i]) differing++;
    expect(differing).toBe(MAX_ENTITIES);
  });

  it('leaves the store allocator consistent — a restore then a spawn works', () => {
    const { dst } = roundTrip(30);
    const s = dst.world.store;
    const before = s.aliveCount;
    const fresh = spawnTank(dst.world, P0, 12, 12);
    expect(s.index(fresh)).toBeGreaterThanOrEqual(0);
    expect(s.aliveCount).toBe(before + 1);
    // And it must NOT have been handed a slot an existing entity occupies.
    let seen = 0;
    for (let k = 0; k < s.aliveCount; k++) if (s.alive[k] === s.index(fresh)) seen++;
    expect(seen).toBe(1);
  });
});

/* ==========================================================================
 * FOG, ORE, SCATTER
 * ========================================================================== */

describe('world state that is not entities', () => {
  it('restores the explored fog grid per player', () => {
    const src = makeFixture();
    populate(src, 6);
    const explored0 = src.vision.exploredCount(P0);
    const explored1 = src.vision.exploredCount(P1);
    expect(explored0).toBeGreaterThan(100);
    expect(explored1).toBeGreaterThan(20);
    expect(explored0).not.toBe(explored1);

    const captured = captureSnapshot(src.host, 'fog');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    expect(dst.vision.exploredCount(P0)).toBe(0);
    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);

    expect(dst.vision.exploredCount(P0)).toBe(explored0);
    expect(dst.vision.exploredCount(P1)).toBe(explored1);
    // Cell by cell, not just by count.
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      expect(dst.vision.grids[0][i] & 0b10).toBe(src.vision.grids[0][i] & 0b10);
    }
  });

  it('re-depletes regenerated ore back to the saved amounts', () => {
    const src = makeFixture();
    populate(src, 6);
    const minedCell = src.ore.oreAt(42, 42);
    const fullCell = src.ore.oreAt(47, 47);
    expect(minedCell).toBeCloseTo(38, 4);
    expect(fullCell).toBeCloseTo(100, 4);

    const captured = captureSnapshot(src.host, 'ore');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    dst.ore.capacity.set(src.ore.capacity);
    dst.ore.regenerate();
    expect(dst.ore.oreAt(42, 42)).toBeCloseTo(100, 4);

    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);
    expect(dst.ore.oreAt(42, 42)).toBeCloseTo(38, 3);
    expect(dst.ore.oreAt(47, 47)).toBeCloseTo(100, 3);
  });

  it('drains a cell the save says is empty', () => {
    const src = makeFixture();
    populate(src, 4);
    // Mine one cell to nothing. It falls out of the sparse list entirely, so
    // this is the case a naive "apply the list" restore gets wrong.
    src.ore.takeOre(46, 46, 1000);
    expect(src.ore.oreAt(46, 46)).toBe(0);

    const captured = captureSnapshot(src.host, 'empty-ore');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    dst.ore.capacity.set(src.ore.capacity);
    dst.ore.regenerate();
    expect(dst.ore.oreAt(46, 46)).toBeCloseTo(100, 4);

    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);
    expect(dst.ore.oreAt(46, 46)).toBeCloseTo(0, 4);
  });

  it('replays every cleared footprint, including ones whose building is gone', () => {
    const src = makeFixture();
    const { refinery } = populate(src, 6);

    // A barracks that was built and then destroyed. Its ground stays cleared —
    // re-deriving the clear from standing buildings would grow that copse back.
    src.cleared.push({ cx: 70, cz: 70, w: 2, h: 2 });
    src.world.store.markDead(refinery);
    src.world.store.flushDestroyed();

    const captured = captureSnapshot(src.host, 'scatter');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);

    expect(dst.scatter.calls.length).toBe(3);
    const demolished = dst.scatter.calls.find((c) => c.minX === 70 * CELL);
    expect(demolished).toBeDefined();
    expect(demolished?.maxX).toBe(72 * CELL);
    // And the ledger comes back out so the session keeps accumulating.
    const restored = restoreSnapshot(captured.value.bytes, makeDestination(src).host);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.clearedFootprints.length).toBe(3);
  });

  /* ------------------------------------------------------------------ *
   * THE FELLED-PROP MASK
   *
   * The reported bug: clearing is permanent for the match, but only the
   * BUILDING footprints were in the file, so vegetation a vehicle crushed
   * stood again after a load. `Scatter.ts` §3.10b carries the reasoning and
   * the measurements; these tests are the format's half of the contract.
   * ------------------------------------------------------------------ */

  /** A fixture whose scatter can hand out and take back a felled-prop mask. */
  function maskFixture(scatter: FakeMaskScatter): Fixture {
    const f = makeFixture();
    f.host.scatter = scatter;
    return f;
  }

  it('THE REPORTED BUG: crushed vegetation stays crushed across a save', () => {
    // A trail: a run of consecutive placements, the shape a hull leaves —
    // plus the very last placement, which is the bit a byte-length off-by-one
    // in the mask round trip would drop.
    const src = new FakeMaskScatter().fell(11, 12, 13, 14, 1500, MEASURED_PLACEMENTS - 1);
    const f = maskFixture(src);
    populate(f, 4);

    const captured = captureSnapshot(f.host, 'crushed');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    // The reload: the same world regenerated, every prop standing again.
    const dstScatter = new FakeMaskScatter();
    expect(dstScatter.felledCount).toBe(0);
    const dst = maskFixture(dstScatter);
    dst.host.seed = f.host.seed;
    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);

    expect(dstScatter.felledCount).toBe(6);
    for (const i of [11, 12, 13, 14, 1500, MEASURED_PLACEMENTS - 1]) {
      expect(dstScatter.isFelled(i)).toBe(true);
    }
    expect(dstScatter.isFelled(10)).toBe(false);
    expect(dstScatter.isFelled(15)).toBe(false);
    // The mask already covers every building footprint, so the replay is
    // skipped rather than re-scanning ground that is already bare.
    expect(dstScatter.calls.length).toBe(0);
  });

  it('falls back to the footprint replay when the scatter generated differently', () => {
    // A different faction's starting base moves `scatter.system.ts`'s exclusion
    // discs, and every prop placed after a moved exclusion shifts. Applying the
    // mask then would fell whichever trees happen to sit at those indices.
    const src = new FakeMaskScatter(MEASURED_PLACEMENTS, 0x11111111).fell(11, 12, 900);
    const f = maskFixture(src);
    populate(f, 4);
    f.cleared.push({ cx: 70, cz: 70, w: 2, h: 2 });

    const captured = captureSnapshot(f.host, 'drifted');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dstScatter = new FakeMaskScatter(MEASURED_PLACEMENTS, 0x22222222);
    const dst = maskFixture(dstScatter);
    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);

    // Nothing felled by index, and the footprints replayed instead. Scenery
    // comes back; it is never felled wrongly.
    expect(dstScatter.felledCount).toBe(0);
    expect(dstScatter.calls.length).toBe(f.cleared.length);
  });

  it('refuses a mask whose placement count no longer matches', () => {
    const f = maskFixture(new FakeMaskScatter(MEASURED_PLACEMENTS).fell(7));
    populate(f, 4);
    const captured = captureSnapshot(f.host, 'resized');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dstScatter = new FakeMaskScatter(MEASURED_PLACEMENTS + 8);
    const dst = maskFixture(dstScatter);
    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);
    expect(dstScatter.felledCount).toBe(0);
  });

  it('a save with no mask still loads, and a mask still loads without one', () => {
    // Both directions of the compatibility contract, and neither needed a
    // schema bump: the chunk stream skips ids it does not know.
    const oldStyle = makeFixture();
    populate(oldStyle, 4);
    oldStyle.cleared.push({ cx: 70, cz: 70, w: 2, h: 2 });
    const oldSave = captureSnapshot(oldStyle.host, 'no-mask');
    expect(oldSave.ok).toBe(true);
    if (!oldSave.ok) return;

    // A save from before the mask existed, read by a build that has one.
    const newScatter = new FakeMaskScatter();
    const intoNew = maskFixture(newScatter);
    expect(restoreSnapshot(oldSave.value.bytes, intoNew.host).ok).toBe(true);
    expect(newScatter.felledCount).toBe(0);
    expect(newScatter.calls.length).toBe(oldStyle.cleared.length);

    // A save carrying the mask, read into a scatter that cannot take one — the
    // same thing an older build's skip-unknown-chunk does.
    const withMask = maskFixture(new FakeMaskScatter().fell(3, 4, 5));
    populate(withMask, 4);
    withMask.cleared.push({ cx: 70, cz: 70, w: 2, h: 2 });
    const newSave = captureSnapshot(withMask.host, 'mask');
    expect(newSave.ok).toBe(true);
    if (!newSave.ok) return;

    const plain = makeFixture();
    expect(restoreSnapshot(newSave.value.bytes, plain.host).ok).toBe(true);
    expect(plain.scatter.calls.length).toBe(withMask.cleared.length);
    expect(plain.scatter.calls.length).toBeGreaterThan(0);
  });

  it('costs a BOUNDED handful of bytes, and almost none when nothing is felled', () => {
    const bare = makeFixture();
    populate(bare, 30);
    const noMask = captureSnapshot(bare.host, 'size');
    expect(noMask.ok).toBe(true);
    if (!noMask.ok) return;

    // Nothing felled: an all-zero bitmask, run-encoded to a few dozen bytes.
    const quiet = maskFixture(new FakeMaskScatter());
    populate(quiet, 30);
    const quietSave = captureSnapshot(quiet.host, 'size');
    expect(quietSave.ok).toBe(true);
    if (!quietSave.ok) return;
    expect(quietSave.value.bytes.length - noMask.value.bytes.length).toBeLessThan(80);

    // The RLE's worst case — a felled prop every other byte — must still be
    // bounded by the raw mask, because the encoder is only used when it wins.
    const worstScatter = new FakeMaskScatter();
    for (let i = 0; i < MEASURED_PLACEMENTS; i += 9) worstScatter.fell(i);
    const worst = maskFixture(worstScatter);
    populate(worst, 30);
    const worstSave = captureSnapshot(worst.host, 'size');
    expect(worstSave.ok).toBe(true);
    if (!worstSave.ok) return;
    const delta = worstSave.value.bytes.length - noMask.value.bytes.length;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(((MEASURED_PLACEMENTS + 7) >> 3) + 32);
  });

  it('restores a ready superweapon and leaves a partial charge conservative', () => {
    const src = makeFixture();
    populate(src, 4);
    src.sw.set(P0, 'nuke', 0);
    src.sw.set(P0, 'ironCurtain', 44.5);

    const captured = captureSnapshot(src.host, 'sw');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    dst.sw.set(P0, 'nuke', 300);
    dst.sw.set(P0, 'ironCurtain', 300);
    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);

    expect(dst.sw.charge.get('0|nuke')).toBe(0);
    // No `setRemaining` on this fake, so the partial charge restarts from full.
    // Conservative on purpose: it can never hand out an unearned superweapon.
    expect(dst.sw.charge.get('0|ironCurtain')).toBe(300);
  });

  it('uses setRemaining for a partial charge when the service offers one', () => {
    const src = makeFixture();
    populate(src, 4);
    src.sw.set(P0, 'ironCurtain', 44.5);

    const captured = captureSnapshot(src.host, 'sw2');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    const withSetter = Object.assign(dst.sw, {
      setRemaining(player: PlayerId, key: string, seconds: number): boolean {
        dst.sw.set(player, key, seconds);
        return true;
      },
    });
    dst.host.superweapons = withSetter;
    dst.sw.set(P0, 'ironCurtain', 300);

    expect(restoreSnapshot(captured.value.bytes, dst.host).ok).toBe(true);
    expect(dst.sw.charge.get('0|ironCurtain')).toBeCloseTo(44.5, 4);
  });
});

/* ==========================================================================
 * VERSIONING AND REFUSALS
 * ========================================================================== */

describe('refusals', () => {
  it('refuses a schema version it does not read, instead of loading', () => {
    const { bytes } = roundTrip(4);
    const tampered = bytes.slice();
    new DataView(tampered.buffer).setUint16(4, SAVE_SCHEMA_VERSION + 1, true);

    const meta = readSnapshotMeta(tampered);
    expect(meta.ok).toBe(false);
    if (meta.ok) return;
    expect(meta.code).toBe('schema-mismatch');
    expect(meta.reason).toContain('save format');
  });

  it('refuses a structural hash from a different build', () => {
    const { bytes } = roundTrip(4);
    const tampered = bytes.slice();
    new DataView(tampered.buffer).setUint32(8, structuralHash() ^ 0x1, true);

    const meta = readSnapshotMeta(tampered);
    expect(meta.ok).toBe(false);
    if (meta.ok) return;
    expect(meta.code).toBe('build-mismatch');
  });

  it('refuses a truncated blob instead of throwing', () => {
    const { bytes } = roundTrip(20);
    for (const cut of [0, 4, 12, 40, bytes.length >> 1, bytes.length - 1]) {
      const short = bytes.slice(0, cut);
      const meta = readSnapshotMeta(short);
      expect(meta.ok).toBe(false);
      if (!meta.ok) expect(['truncated', 'not-a-save', 'corrupt']).toContain(meta.code);
    }
  });

  it('refuses a bit-flipped blob instead of loading garbage', () => {
    const { bytes } = roundTrip(20);
    const corrupt = bytes.slice();
    // Somewhere well inside the body.
    corrupt[corrupt.length - 200] ^= 0xff;
    const meta = readSnapshotMeta(corrupt);
    expect(meta.ok).toBe(false);
    if (meta.ok) return;
    expect(meta.code).toBe('corrupt');
  });

  it('refuses something that is not a save at all', () => {
    const meta = readSnapshotMeta(new TextEncoder().encode('not a save, just some text'));
    expect(meta.ok).toBe(false);
    if (!meta.ok) expect(meta.code).toBe('not-a-save');
  });

  it('refuses when the running world was built from a different seed', () => {
    const src = makeFixture();
    populate(src, 6);
    const captured = captureSnapshot(src.host, 'seed');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    dst.host.seed = src.host.seed + 1;
    const restored = restoreSnapshot(captured.value.bytes, dst.host);
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.code).toBe('world-mismatch');
    expect(restored.reason).toContain('seed');
    // And nothing was touched.
    expect(dst.world.store.aliveCount).toBe(0);
  });

  it('refuses a save whose content key no longer exists, and names it', () => {
    const src = makeFixture();
    populate(src, 6);
    const captured = captureSnapshot(src.host, 'content');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    // The build that reads it has lost the harvester.
    dst.host.defs = makeDefs(['grizzly', 'mcv']);
    const restored = restoreSnapshot(captured.value.bytes, dst.host);
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.code).toBe('content-missing');
    expect(restored.reason).toContain('harvester');
  });

  it('refuses when a building def changed footprint, and names it', () => {
    const src = makeFixture();
    populate(src, 6);
    const captured = captureSnapshot(src.host, 'footprint');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const dst = makeDestination(src);
    dst.host.defs = makeDefs(undefined, [
      { key: 'conyard', w: 3, h: 3 },
      { key: 'refinery', w: 4, h: 3 },
      { key: 'powerPlant', w: 2, h: 2 },
    ]);
    const restored = restoreSnapshot(captured.value.bytes, dst.host);
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.code).toBe('content-changed');
    expect(restored.reason).toContain('refinery');
  });

  it('survives a def table that GREW — the common case', () => {
    const src = makeFixture();
    populate(src, 6);
    const captured = captureSnapshot(src.host, 'growth');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    // A new unit is inserted BEFORE the ones the save used, which is exactly
    // what would corrupt an index-based save.
    const dst = makeDestination(src);
    dst.host.defs = makeDefs(['newTank', 'grizzly', 'harvester', 'mcv'], [
      { key: 'newSilo', w: 1, h: 1 },
      { key: 'conyard', w: 3, h: 3 },
      { key: 'refinery', w: 3, h: 2 },
      { key: 'powerPlant', w: 2, h: 2 },
    ]);

    const restored = restoreSnapshot(captured.value.bytes, dst.host);
    expect(restored.ok).toBe(true);

    // Every restored tank must now carry defId 1 ('grizzly' in the new table),
    // not the 0 it was saved as.
    const b = dst.world.store;
    let grizzlies = 0;
    let refineries = 0;
    for (let k = 0; k < b.aliveCount; k++) {
      const i = b.alive[k];
      if (b.kind[i] === EntityKind.Vehicle && b.defId[i] === 1) grizzlies++;
      if (b.kind[i] === EntityKind.Building && b.defId[i] === 2) refineries++;
    }
    expect(grizzlies).toBe(6);
    expect(refineries).toBe(1);

    // The queue's mid-progress Grizzly must have followed the key too.
    expect(dst.world.player(P0).queues[BuildTab.Vehicles].items[0].defId).toBe(1);
  });

  it('refuses to capture a world with no players', () => {
    const host = makeFixture().host;
    host.world.reset();
    const captured = captureSnapshot(host, 'empty');
    expect(captured.ok).toBe(false);
    if (!captured.ok) expect(captured.code).toBe('no-match');
  });
});

/* ==========================================================================
 * FORMAT PROPERTIES
 * ========================================================================== */

describe('format', () => {
  it('reads its own metadata without touching the body', () => {
    const src = makeFixture();
    populate(src, 10);
    const captured = captureSnapshot(src.host, 'Before the push');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const meta = readSnapshotMeta(captured.value.bytes);
    expect(meta.ok).toBe(true);
    if (!meta.ok) return;
    expect(meta.value.label).toBe('Before the push');
    expect(meta.value.scenario).toBe('skirmish');
    expect(meta.value.map).toBe('ridgeline');
    expect(meta.value.seed).toBe(1234);
    expect(meta.value.tick).toBe(900);
    expect(meta.value.credits).toBe(4310);
    expect(meta.value.localPlayerName).toBe('Commander');
    expect(meta.value.entityCount).toBe(12);
    expect(meta.value.byteLength).toBe(captured.value.bytes.length);
    expect(meta.value.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('skips a chunk it does not recognise instead of failing', () => {
    // Forge a save with an extra trailing chunk, exactly as a later build would
    // write. The body length and crc are recomputed, so this is a VALID file
    // that this build has simply never seen all of.
    const src = makeFixture();
    populate(src, 6);
    const captured = captureSnapshot(src.host, 'future');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const bytes = captured.value.bytes;

    const view = new DataView(bytes.buffer);
    const bodyLength = view.getUint32(12, true);
    const metaLength = view.getUint32(20, true);
    const bodyStart = 24 + metaLength + ((4 - (metaLength & 3)) & 3);

    const extraPayload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Uint8Array(bytes.length + 8 + extraPayload.length);
    out.set(bytes, 0);
    const ov = new DataView(out.buffer);
    let at = bodyStart + bodyLength;
    ov.setUint32(at, 0x5a5a5a5a, true); at += 4;
    ov.setUint32(at, extraPayload.length, true); at += 4;
    out.set(extraPayload, at);

    const newBodyLength = bodyLength + 8 + extraPayload.length;
    ov.setUint32(12, newBodyLength, true);
    // Recompute the crc the way the writer does.
    ov.setUint32(16, crc32(out.subarray(bodyStart, bodyStart + newBodyLength)), true);

    const dst = makeDestination(src);
    const restored = restoreSnapshot(out, dst.host);
    expect(restored.ok).toBe(true);
    expect(dst.world.store.aliveCount).toBe(src.world.store.aliveCount);
  });

  it('is small enough to argue about, and is measured', () => {
    const src = makeFixture();
    populate(src, 200);
    const captured = captureSnapshot(src.host, 'size');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const bytes = captured.value.bytes.length;
    // A regression guard, not a wish: 202 entities plus a fog grid, an ore
    // field and two players. If this jumps by an order of magnitude something
    // started storing the world instead of regenerating it.
    expect(bytes).toBeLessThan(400_000);
    expect(bytes).toBeGreaterThan(1_000);
    // Reported, so the number lands in the test output where the decision
    // between localStorage and IndexedDB was made.
    console.info(
      `[savegame] 202 entities -> ${bytes} bytes ` +
      `(${(bytes / 1024).toFixed(1)} kB), capture ${captured.value.captureMs.toFixed(2)} ms`,
    );
  });

  it('captures a full-capacity world without hitching', () => {
    const src = makeFixture();
    const world = src.world;
    for (let i = 0; i < 1000; i++) {
      spawnTank(world, i % 2 === 0 ? P0 : P1, (i % 100) * 4, Math.floor(i / 100) * 4);
    }
    src.vision.exploreCircle(P0, 256, 256, 200);
    for (let cz = 30; cz < 70; cz++) for (let cx = 30; cx < 70; cx++) src.ore.seed(cx, cz, 90);

    const captured = captureSnapshot(src.host, 'big');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    console.info(
      `[savegame] 1000 entities -> ${captured.value.bytes.length} bytes, ` +
      `capture ${captured.value.captureMs.toFixed(2)} ms`,
    );
    // Two frames at 60 fps is the bar the brief set. Generous headroom for a
    // loaded CI box, but it would catch an accidental O(n^2).
    expect(captured.value.captureMs).toBeLessThan(120);
  });
});

/* ==========================================================================
 * THE STORE
 * ========================================================================== */

class FakeIndex implements IndexStorage {
  readonly name = 'memory' as const;
  json: string | null = null;
  load(): string | null { return this.json; }
  store(json: string): void { this.json = json; }
}

function fakeMeta(label: string, savedAtMs: number): SaveSlotInfo['meta'] {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    structuralHash: structuralHash(),
    label,
    savedAtMs,
    tick: 100,
    simTimeSec: 3.3,
    scenario: 'skirmish',
    map: 'ridgeline',
    seed: 7,
    localPlayerName: 'Commander',
    localFaction: 1,
    credits: 1000,
    entityCount: 3,
    byteLength: 0,
  };
}

describe('SaveStore', () => {
  it('round-trips bytes and renders its index synchronously', async () => {
    const index = new FakeIndex();
    const store = new SaveStore(new MemoryBackend(), index);
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    const written = await store.write('manual-1', bytes, fakeMeta('First', 1000));
    expect(written.ok).toBe(true);
    expect(store.list().length).toBe(1);
    expect(store.peek('manual-1')?.label).toBe('First');
    expect(store.peek('manual-1')?.byteLength).toBe(5);

    const read = await store.read('manual-1');
    expect(read.ok).toBe(true);
    if (read.ok) expect(Array.from(read.value)).toEqual([1, 2, 3, 4, 5]);

    // A fresh store over the same index sees the same list with no await.
    const reopened = new SaveStore(new MemoryBackend(), index);
    expect(reopened.list().length).toBe(1);
    expect(reopened.list()[0].meta.label).toBe('First');
  });

  it('hands the opaque index payload back verbatim', async () => {
    const index = new FakeIndex();
    const store = new SaveStore(new MemoryBackend(), index);
    const extra = {
      kind: 'manual',
      thumbnail: 'data:image/jpeg;base64,AAA',
      context: { mapId: 'ridgeline', playerFaction: 'allies', difficulty: 2, seed: 7 },
    };
    await store.write('manual-1', new Uint8Array(3), fakeMeta('x', 1), extra);
    expect(store.list()[0].extra).toEqual(extra);

    // And it survives the JSON round trip through the index.
    const reopened = new SaveStore(new MemoryBackend(), index);
    expect(reopened.list()[0].extra).toEqual(extra);
  });

  it('defaults the index payload to null rather than undefined', async () => {
    const store = new SaveStore(new MemoryBackend(), new FakeIndex());
    await store.write('manual-1', new Uint8Array(1), fakeMeta('x', 1));
    expect(store.list()[0].extra).toBeNull();
  });

  it('lists newest first', async () => {
    const store = new SaveStore(new MemoryBackend(), new FakeIndex());
    await store.write('a', new Uint8Array(1), fakeMeta('old', 100));
    await store.write('b', new Uint8Array(1), fakeMeta('new', 900));
    expect(store.list().map((e) => e.slot)).toEqual(['b', 'a']);
  });

  it('repairs the index when a blob has gone missing', async () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(backend, new FakeIndex());
    await store.write('gone', new Uint8Array(2), fakeMeta('gone', 1));
    await backend.remove('gone');

    const read = await store.read('gone');
    expect(read.ok).toBe(false);
    expect(store.list().length).toBe(0);
  });

  it('survives a corrupt index without losing the blobs', async () => {
    const index = new FakeIndex();
    const backend = new MemoryBackend();
    const store = new SaveStore(backend, index);
    await store.write('manual-1', new Uint8Array([9]), fakeMeta('x', 1));

    index.json = '{ this is not json';
    const reopened = new SaveStore(backend, index);
    expect(reopened.list().length).toBe(0);
    // The bytes are still there under their slot key.
    const raw = await backend.read('manual-1');
    expect(raw).not.toBeNull();
  });

  it('reports a quota failure in words a player can act on', async () => {
    class FullBackend extends MemoryBackend {
      override async write(): Promise<void> {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
    }
    const store = new SaveStore(new FullBackend(), new FakeIndex());
    const result = await store.write('x', new Uint8Array(1), fakeMeta('x', 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('storage');
      expect(result.reason).toContain('Delete a save');
    }
    // A failed write must not leave a phantom row in the list.
    expect(store.list().length).toBe(0);
  });

  it('rotates the autosave ring: empty slots first, then the oldest', () => {
    const infos: SaveSlotInfo[] = [];
    expect(nextAutosaveSlot(infos)).toBe(autosaveSlotId(0));

    // `extra` is the shell's opaque payload; the rotation reads only `savedAtMs`,
    // so null here asserts that the ring never depends on it.
    infos.push({ slot: autosaveSlotId(0), meta: fakeMeta('a', 300), extra: null });
    expect(nextAutosaveSlot(infos)).toBe(autosaveSlotId(1));

    infos.push({ slot: autosaveSlotId(1), meta: fakeMeta('b', 400), extra: null });
    infos.push({ slot: autosaveSlotId(2), meta: fakeMeta('c', 500), extra: null });
    expect(nextAutosaveSlot(infos)).toBe(autosaveSlotId(0));

    infos[0].meta.savedAtMs = 900;
    expect(nextAutosaveSlot(infos)).toBe(autosaveSlotId(1));
  });

  it('base64 round-trips every byte value and every length remainder', () => {
    for (const len of [0, 1, 2, 3, 255, 256, 257, 1000]) {
      const src = new Uint8Array(len);
      for (let i = 0; i < len; i++) src[i] = (i * 37 + 11) & 0xff;
      const back = base64ToBytes(bytesToBase64(src));
      expect(Array.from(back)).toEqual(Array.from(src));
    }
  });
});

/* ==========================================================================
 * DEF INDEX
 * ========================================================================== */

describe('defIndexFromTables', () => {
  it('maps both directions and reports footprints', () => {
    const tables = {
      units: [{ key: 'grizzly' }, { key: 'rhino' }],
      buildings: [{ key: 'conyard', footprintW: 3, footprintH: 3 }],
      weapons: [],
      factions: [],
      armorMatrix: [],
      unitByKey: new Map([['grizzly', 0], ['rhino', 1]]),
      buildingByKey: new Map([['conyard', 0]]),
    } as unknown as DefTables;

    const idx = defIndexFromTables(tables);
    expect(idx.unitKeyOf(1)).toBe('rhino');
    expect(idx.unitIdOf('rhino')).toBe(1);
    expect(idx.unitIdOf('nope')).toBe(-1);
    expect(idx.unitKeyOf(99)).toBe('');
    expect(idx.buildingKeyOf(0)).toBe('conyard');
    expect(idx.buildingFootprint('conyard')).toEqual({ w: 3, h: 3 });
    expect(idx.buildingFootprint('nope')).toBeNull();
  });
});

/* -- a local copy of the writer's crc, so the forged-chunk test is honest --- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
