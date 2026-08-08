/**
 * Economy — ore fields, the harvester FSM, the credit ledger and the power grid.
 *
 * Everything here runs headless. `World` is pure typed arrays, and the three
 * economy classes take `(world, channels)` explicitly rather than reaching for
 * `ctx()`, which is precisely so the whole loop can be driven from Node with no
 * renderer, no DOM and no system registry.
 *
 * The harvester tests drive `HarvesterController.simTick` and `.drive` by hand
 * in the same order the two registered system modules would, so what is under
 * test is the real tick order and not a convenient approximation of it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import {
  CreditReason, EntityFlag, EntityKind, Faction, Locomotor, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import {
  BASE_STORAGE, CELL, HARVESTER_CAPACITY, HARVESTER_DOCK_CLEARANCE,
  ORE_CELL_MAX, ORE_REGROW_RATE,
  POWER_BLACKOUT_MUL, POWER_FULL_MUL, REFINERY_STORAGE, SIM_DT, START_CREDITS,
  STORAGE_BASE, UNLOAD_SECONDS,
} from '../src/core/config';
import { Rng } from '../src/core/math';

import { Economy, OreField } from '../src/sim/Economy';
import {
  HarvesterController, dockApronDistance, setHarvesterDrive,
} from '../src/sim/Harvesting';
import { PowerGrid } from '../src/sim/Power';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/** Map centre, which is where every fixture in this repo is composed. */
const CX = 256;
const CZ = 256;

interface Rig {
  world: World;
  channels: Channels;
  ore: OreField;
  economy: Economy;
  power: PowerGrid;
  harvesters: HarvesterController;
  tick: number;
  step(n?: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const channels = new Channels();
  const ore = new OreField();
  const economy = new Economy(world, channels);
  const power = new PowerGrid(world, channels);
  const harvesters = new HarvesterController(world, channels, ore, economy);
  world.ore = ore;

  const rng = new Rng(1234);
  const rig: Rig = {
    world, channels, ore, economy, power, harvesters,
    tick: 0,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        world.store.snapshotPrev();
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        // Same order as the two registered modules: Economy phase, then Movement.
        power.simTick(s.time);
        economy.recomputeStorage();
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        harvesters.drive(s.dt);
      }
    },
  };
  return rig;
}

/** A refinery big enough to dock at, complete and powered. */
function spawnRefinery(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Building, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.IsRefinery | EntityFlag.NeedsPower | EntityFlag.BlocksNav;
  s.footprintW[i] = 3;
  s.footprintH[i] = 3;
  s.powerDraw[i] = -30;
  s.maxHp[i] = 1200;
  s.hp[i] = 1200;
  s.radius[i] = 6;
  s.buildProgress[i] = 1;
  rig.economy.setBuildingStorage(id, REFINERY_STORAGE);
  return id;
}

function spawnHarvester(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.IsHarvester | EntityFlag.CanMove;
  s.cargoMax[i] = HARVESTER_CAPACITY;
  s.cargo[i] = 0;
  s.maxSpeed[i] = 5;
  s.accel[i] = 6;
  s.turnRate[i] = 2.2;
  s.locomotor[i] = Locomotor.Track;
  s.radius[i] = 2.2;
  s.maxHp[i] = 1000;
  s.hp[i] = 1000;
  s.state[i] = UnitState.Idle;
  return id;
}

/** A generic structure with a fixed power draw and an optional flag set. */
function spawnStructure(
  rig: Rig, owner: PlayerId, x: number, z: number, draw: number, flags = 0,
): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Building, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= flags | (draw < 0 ? EntityFlag.NeedsPower : 0);
  s.footprintW[i] = 2;
  s.footprintH[i] = 2;
  s.powerDraw[i] = draw;
  s.buildProgress[i] = 1;
  return id;
}

/* ==========================================================================
 * ORE FIELD
 * ========================================================================== */

describe('OreField — seeding and shape', () => {
  let ore: OreField;
  beforeEach(() => { ore = new OreField(); });

  it('seeds a blotchy field with a bright node and a ragged edge', () => {
    const id = ore.seedField(CX, CZ, 30, ORE_CELL_MAX * 0.85);
    expect(id).toBe(0);
    const rec = ore.field(id)!;

    expect(rec.cells.length).toBeGreaterThan(60);
    // The node is cells[0] by construction, and the field's brightest cell.
    expect(rec.upstream[0]).toBe(-1);
    expect(ore.densityAt(rec.nodeCx, rec.nodeCz)).toBe(1);
    expect(ore.totalOre()).toBeCloseTo(rec.capacity, 3);

    // Ragged, not an airbrushed disc: cells at a similar radius differ.
    const a = ore.oreAt(rec.nodeCx + 3, rec.nodeCz);
    const b = ore.oreAt(rec.nodeCx, rec.nodeCz + 3);
    expect(a).not.toBeCloseTo(b, 2);
  });

  it('is deterministic for the same position and radius', () => {
    const other = new OreField();
    ore.seedField(CX, CZ, 26);
    other.seedField(CX, CZ, 26);
    expect(other.totalOre()).toBe(ore.totalOre());
    for (let d = 0; d < 8; d++) {
      expect(other.oreAt(CX / CELL + d, CZ / CELL)).toBe(ore.oreAt(CX / CELL + d, CZ / CELL));
    }
  });

  it('honours the per-cell accept predicate', () => {
    // Reject the western half; nothing may be seeded there.
    const nodeCx = Math.floor(CX / CELL);
    ore.seedField(CX, CZ, 30, ORE_CELL_MAX, (cx) => cx >= nodeCx);
    for (let d = 1; d < 8; d++) expect(ore.oreAt(nodeCx - d, Math.floor(CZ / CELL))).toBe(0);
    expect(ore.oreAt(nodeCx + 1, Math.floor(CZ / CELL))).toBeGreaterThan(0);
  });
});

describe('OreField — mining, claims and regrowth', () => {
  it('takeOre never goes negative and sweeps up the residue', () => {
    const ore = new OreField();
    ore.seedField(CX, CZ, 20);
    const cx = Math.floor(CX / CELL);
    const cz = Math.floor(CZ / CELL);
    const have = ore.oreAt(cx, cz);

    expect(ore.takeOre(cx, cz, have * 10)).toBeCloseTo(have, 4);
    expect(ore.oreAt(cx, cz)).toBe(0);
    expect(ore.takeOre(cx, cz, 100)).toBe(0);
    expect(ore.densityAt(cx, cz)).toBe(0);
  });

  it('fires the exhausted listener exactly once when a field runs dry', () => {
    const ore = new OreField();
    const id = ore.seedField(CX, CZ, 10);
    const rec = ore.field(id)!;
    let fired = 0;
    ore.onOreExhausted(() => { fired++; });
    for (let k = 0; k < rec.cells.length; k++) {
      const i = rec.cells[k];
      ore.takeOre(i % 128, (i / 128) | 0, ORE_CELL_MAX * 2);
    }
    expect(fired).toBe(1);
    expect(ore.totalOre()).toBeCloseTo(0, 4);
  });

  it('a claim blocks another harvester and lapses on its own', () => {
    const ore = new OreField();
    ore.seedField(CX, CZ, 20);
    const cx = Math.floor(CX / CELL);
    const cz = Math.floor(CZ / CELL);
    const a = 101 as EntityId;
    const b = 202 as EntityId;

    expect(ore.claim(cx, cz, a, 0)).toBe(true);
    expect(ore.claim(cx, cz, b, 0)).toBe(false);
    // Refreshing your own lease always works.
    expect(ore.claim(cx, cz, a, 1)).toBe(true);
    // Nobody refreshed it past the TTL, so it is free again.
    expect(ore.claim(cx, cz, b, 100)).toBe(true);
  });

  it('findFreeOre skips cells somebody else booked', () => {
    const ore = new OreField();
    ore.seedField(CX, CZ, 24);
    const out = new Int32Array(2);
    const cx = Math.floor(CX / CELL);
    const cz = Math.floor(CZ / CELL);

    expect(ore.findFreeOre(cx, cz, 40, 1 as EntityId, 1, 0, out)).toBe(true);
    const firstX = out[0];
    const firstZ = out[1];
    ore.claim(firstX, firstZ, 1 as EntityId, 0);

    expect(ore.findFreeOre(cx, cz, 40, 2 as EntityId, 1, 0, out)).toBe(true);
    expect(out[0] === firstX && out[1] === firstZ).toBe(false);
  });

  it('regrows outward from the node, not everywhere at once', () => {
    const ore = new OreField();
    const id = ore.seedField(CX, CZ, 30);
    const rec = ore.field(id)!;

    // Strip the whole field.
    for (let k = 0; k < rec.cells.length; k++) {
      const i = rec.cells[k];
      ore.takeOre(i % 128, (i / 128) | 0, ORE_CELL_MAX * 2);
    }
    expect(ore.totalOre()).toBeLessThan(0.001);

    // One short pass: only the node can have moved, because every other cell is
    // gated on an upstream neighbour that is still empty.
    ore.regrow(1);
    const nodeAfter = ore.oreAt(rec.nodeCx, rec.nodeCz);
    expect(nodeAfter).toBeGreaterThan(0);
    expect(nodeAfter).toBeCloseTo(ORE_REGROW_RATE * 3, 3);
    expect(ore.totalOre() - nodeAfter).toBeLessThan(0.001);

    // Long enough for the wave to reach the rim.
    for (let k = 0; k < 4000; k++) ore.regrow(1);
    expect(ore.totalOre()).toBeGreaterThan(rec.capacity * 0.5);
  });

  it('reports only the cells that changed through drainDirty', () => {
    const ore = new OreField();
    ore.seedField(CX, CZ, 20);
    const buf = new Int32Array(4096);
    ore.drainDirty(buf); // clear the seeding churn
    expect(ore.pendingDirty).toBe(0);

    const before = ore.version;
    ore.takeOre(Math.floor(CX / CELL), Math.floor(CZ / CELL), 10);
    expect(ore.version).toBeGreaterThan(before);
    expect(ore.drainDirty(buf)).toBe(1);
    expect(ore.drainDirty(buf)).toBe(0);
  });
});

/* ==========================================================================
 * CREDIT LEDGER
 * ========================================================================== */

describe('Economy — credits, storage and overflow', () => {
  it('wastes deposits over the storage cap and fires SiloNeeded once', () => {
    const rig = makeRig();
    const p = rig.world.player(P0);
    p.storageMax = BASE_STORAGE;
    p.credits = BASE_STORAGE - 100;

    let silo = 0;
    rig.channels.events.on('eva:line', (ev) => { if (ev.player === P0) silo++; });

    expect(rig.economy.deposit(P0, 400)).toBe(100);
    expect(p.credits).toBe(BASE_STORAGE);
    expect(rig.economy.wasted(P0)).toBe(300);
    expect(silo).toBe(1);

    // Throttled: a second overflow in the same second stays quiet.
    rig.economy.deposit(P0, 400);
    expect(silo).toBe(1);
  });

  it('spend refuses when short and spendPartial takes what is there', () => {
    const rig = makeRig();
    const p = rig.world.player(P0);
    p.credits = 100;

    expect(rig.economy.spend(P0, 250)).toBe(false);
    expect(p.credits).toBe(100);
    expect(rig.economy.spend(P0, 60)).toBe(true);
    expect(p.credits).toBe(40);
    expect(rig.economy.spendPartial(P0, 500)).toBe(40);
    expect(p.credits).toBe(0);
    expect(p.stats.creditsSpent).toBe(100);
  });

  it('coalesces credit events to one dispatch per player per tick', () => {
    const rig = makeRig();
    let events = 0;
    let lastDelta = 0;
    rig.channels.events.on('economy:credits', (ev) => {
      if (ev.player !== P0) return;
      events++;
      lastDelta = ev.delta;
    });
    rig.world.player(P0).storageMax = 100000;

    for (let k = 0; k < 20; k++) rig.economy.deposit(P0, 10);
    expect(events).toBe(0);
    rig.economy.tick(SIM_DT, SIM_DT);
    expect(events).toBe(1);
    expect(lastDelta).toBe(200);
  });

  it('recomputes the storage cap from live structures and clamps credits', () => {
    const rig = makeRig();
    const ref = spawnRefinery(rig, P0, CX, CZ);
    rig.economy.recomputeStorage();
    expect(rig.economy.storageMax(P0)).toBe(STORAGE_BASE + REFINERY_STORAGE);

    rig.world.player(P0).credits = STORAGE_BASE + REFINERY_STORAGE;
    rig.world.store.markDead(ref);
    rig.world.store.flushDestroyed();
    rig.economy.recomputeStorage();

    expect(rig.economy.storageMax(P0)).toBe(STORAGE_BASE);
    expect(rig.economy.credits(P0)).toBe(STORAGE_BASE);
    expect(rig.economy.wasted(P0)).toBe(REFINERY_STORAGE);
  });

  /**
   * The regression this guards is the one the first draft actually shipped:
   * BASE_STORAGE (1000) is below START_CREDITS (10000), so a literal reading of
   * section 16 confiscates 9000 credits from every player on the first tick the
   * cap is recomputed. See the STORAGE_BASE note in config §21.
   */
  it('never confiscates the credits the match started the player with', () => {
    const rig = makeRig();
    expect(BASE_STORAGE).toBeLessThan(START_CREDITS);
    expect(rig.economy.credits(P0)).toBe(START_CREDITS);

    rig.economy.recomputeStorage();
    expect(rig.economy.storageMax(P0)).toBeGreaterThanOrEqual(START_CREDITS);
    expect(rig.economy.credits(P0)).toBe(START_CREDITS);
    expect(rig.economy.wasted(P0)).toBe(0);
  });

  it('tracks a smoothed income rate', () => {
    const rig = makeRig();
    rig.world.player(P0).storageMax = 1e6;
    // 300 credits a second for four seconds.
    for (let k = 0; k < 120; k++) {
      rig.economy.deposit(P0, 10);
      rig.economy.tick(SIM_DT, k * SIM_DT);
    }
    expect(rig.economy.incomeRate(P0)).toBeGreaterThan(180);
    expect(rig.economy.incomeRate(P0)).toBeLessThanOrEqual(300);
  });
});

/* ==========================================================================
 * POWER
 * ========================================================================== */

describe('PowerGrid', () => {
  it('is healthy with supply to spare and reports full build speed', () => {
    const rig = makeRig();
    spawnStructure(rig, P0, CX, CZ, 200);
    const coil = spawnStructure(rig, P0, CX + 16, CZ, -60, EntityFlag.CanAttack);
    rig.power.recompute();

    const st = rig.power.state(P0);
    expect(st.produced).toBe(200);
    expect(st.consumed).toBe(60);
    expect(st.brownout).toBe(false);
    expect(st.buildSpeedMul).toBe(POWER_FULL_MUL);
    expect(rig.power.isDark(coil)).toBe(false);
    expect(rig.world.player(P0).buildSpeedMul).toBe(POWER_FULL_MUL);
  });

  it('darkens defences first, and only enough of them to cover the deficit', () => {
    const rig = makeRig();
    spawnStructure(rig, P0, CX, CZ, 100);
    const bigCoil = spawnStructure(rig, P0, CX + 8, CZ, -80, EntityFlag.CanAttack);
    const smallCoil = spawnStructure(rig, P0, CX + 16, CZ, -30, EntityFlag.CanAttack);
    const radar = spawnStructure(rig, P0, CX + 24, CZ, -40, EntityFlag.IsRadar);
    rig.power.recompute();

    const st = rig.power.state(P0);
    expect(st.consumed).toBe(150);
    expect(st.brownout).toBe(true);
    // Deficit is 50. The biggest defence alone covers it, so nothing else goes
    // dark — and critically, `consumed` is unchanged by the shed.
    expect(rig.power.isDark(bigCoil)).toBe(true);
    expect(rig.power.isDark(smallCoil)).toBe(false);
    expect(rig.power.isDark(radar)).toBe(false);
    expect(st.consumed).toBe(150);
    expect(st.defencesOnline).toBe(false);
  });

  it('sheds the radar once every defence is already dark', () => {
    const rig = makeRig();
    spawnStructure(rig, P0, CX, CZ, 20);
    spawnStructure(rig, P0, CX + 8, CZ, -60, EntityFlag.CanAttack);
    const radar = spawnStructure(rig, P0, CX + 24, CZ, -40, EntityFlag.IsRadar);
    rig.power.recompute();

    expect(rig.power.isDark(radar)).toBe(true);
    expect(rig.power.state(P0).radarOnline).toBe(false);
    expect(rig.world.player(P0).hasRadar).toBe(false);
  });

  it('never sheds the Construction Yard and never stops production dead', () => {
    const rig = makeRig();
    const yard = spawnStructure(rig, P0, CX, CZ, -20, EntityFlag.IsBuilder | EntityFlag.IsFactory);
    rig.power.recompute();

    const st = rig.power.state(P0);
    expect(st.produced).toBe(0);
    expect(rig.power.isDark(yard)).toBe(false);
    expect(st.buildSpeedMul).toBe(POWER_BLACKOUT_MUL);
    expect(st.buildSpeedMul).toBeGreaterThan(0);
  });

  it('ignores structures still under construction', () => {
    const rig = makeRig();
    const plant = spawnStructure(rig, P0, CX, CZ, 200);
    const i = rig.world.store.index(plant);
    rig.world.store.flags[i] |= EntityFlag.UnderConstruction;
    rig.world.store.buildProgress[i] = 0.4;
    rig.power.recompute();
    expect(rig.power.state(P0).produced).toBe(0);
  });

  it('keeps each player on their own grid', () => {
    const rig = makeRig();
    spawnStructure(rig, P0, CX, CZ, 300);
    spawnStructure(rig, P1, CX + 60, CZ, -100);
    rig.power.recompute();
    expect(rig.power.state(P0).brownout).toBe(false);
    expect(rig.power.state(P1).brownout).toBe(true);
  });
});

/* ==========================================================================
 * THE HARVESTER LOOP
 * ========================================================================== */

describe('Harvesting — the full round trip', () => {
  beforeEach(() => { setHarvesterDrive(true); });

  it('drives to ore, fills up, hauls home and banks credits', () => {
    const rig = makeRig();
    spawnStructure(rig, P0, CX, CZ - 30, 300);
    spawnRefinery(rig, P0, CX, CZ);
    rig.ore.seedField(CX + 40, CZ, 20);
    const h = spawnHarvester(rig, P0, CX, CZ + 10);
    const i = rig.world.store.index(h);
    rig.world.player(P0).credits = 0;
    rig.power.recompute();
    rig.economy.recomputeStorage();

    const seen = new Set<number>();
    for (let k = 0; k < 900; k++) {
      rig.step();
      seen.add(rig.world.store.state[i]);
      if (rig.world.player(P0).credits > 0 && rig.world.store.state[i] === UnitState.SeekOre) break;
    }

    expect(seen.has(UnitState.SeekOre)).toBe(true);
    expect(seen.has(UnitState.Harvesting)).toBe(true);
    expect(seen.has(UnitState.ReturnToRefinery)).toBe(true);
    expect(seen.has(UnitState.Docked)).toBe(true);
    expect(rig.world.player(P0).credits).toBeGreaterThan(0);
    expect(rig.world.player(P0).stats.oreMined).toBeGreaterThan(0);
    expect(rig.ore.totalOre()).toBeLessThan(rig.ore.stats().capacity);
  });

  it('unloads over UNLOAD_SECONDS rather than all at once', () => {
    const rig = makeRig();
    const ref = spawnRefinery(rig, P0, CX, CZ);
    const h = spawnHarvester(rig, P0, CX, CZ + 8);
    const i = rig.world.store.index(h);
    const s = rig.world.store;
    s.cargo[i] = HARVESTER_CAPACITY;
    s.dockTarget[i] = ref as number;
    s.state[i] = UnitState.Docked;
    rig.world.player(P0).storageMax = 1e6;
    rig.world.player(P0).credits = 0;

    // Half the unload time must bank roughly half the load.
    const halfTicks = Math.round((UNLOAD_SECONDS * 0.5) / SIM_DT);
    rig.step(halfTicks);
    const mid = rig.world.player(P0).credits;
    expect(mid).toBeGreaterThan(HARVESTER_CAPACITY * 0.35);
    expect(mid).toBeLessThan(HARVESTER_CAPACITY * 0.65);

    rig.step(halfTicks + 4);
    expect(rig.world.player(P0).credits).toBeCloseTo(HARVESTER_CAPACITY, 1);
    expect(s.cargo[i]).toBe(0);
    expect(s.state[i]).not.toBe(UnitState.Docked);
  });

  it('two harvesters never claim the same ore cell', () => {
    const rig = makeRig();
    spawnRefinery(rig, P0, CX, CZ);
    rig.ore.seedField(CX + 40, CZ, 18);
    const a = rig.world.store.index(spawnHarvester(rig, P0, CX + 20, CZ - 2));
    const b = rig.world.store.index(spawnHarvester(rig, P0, CX + 20, CZ + 2));

    for (let k = 0; k < 240; k++) {
      rig.step();
      const s = rig.world.store;
      if (s.state[a] === UnitState.Harvesting && s.state[b] === UnitState.Harvesting) {
        const dx = s.posX[a] - s.posX[b];
        const dz = s.posZ[a] - s.posZ[b];
        expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(CELL * 0.5);
      }
    }
    // Both did real work rather than one starving.
    expect(rig.world.store.cargo[a] + rig.world.store.cargo[b]).toBeGreaterThan(0);
  });

  it('re-targets when the refinery it was hauling to is destroyed', () => {
    const rig = makeRig();
    const near = spawnRefinery(rig, P0, CX, CZ);
    spawnRefinery(rig, P0, CX - 60, CZ);
    const h = spawnHarvester(rig, P0, CX + 10, CZ);
    const s = rig.world.store;
    const i = s.index(h);
    s.cargo[i] = HARVESTER_CAPACITY;
    s.state[i] = UnitState.Idle;

    rig.step(3);
    expect(s.state[i]).toBe(UnitState.ReturnToRefinery);
    expect(s.dockTarget[i]).toBe(near as number);

    s.markDead(near);
    s.flushDestroyed();
    rig.step(2);

    expect(s.state[i]).toBe(UnitState.ReturnToRefinery);
    expect(s.dockTarget[i]).not.toBe(near as number);
    expect(s.dockTarget[i]).not.toBe(0);
  });

  it('goes idle, keeps its load and does not spin when there is no refinery', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, P0, CX, CZ);
    const s = rig.world.store;
    const i = s.index(h);
    s.cargo[i] = HARVESTER_CAPACITY;

    rig.step(60);
    expect(s.state[i]).toBe(UnitState.Idle);
    expect(s.cargo[i]).toBe(HARVESTER_CAPACITY);
    expect(s.speed[i]).toBe(0);
  });

  it('hops to the next cell when the one it is on runs out', () => {
    const rig = makeRig();
    spawnRefinery(rig, P0, CX - 40, CZ);
    const fieldId = rig.ore.seedField(CX, CZ, 16);
    const rec = rig.ore.field(fieldId)!;
    const before = new Float32Array(rec.cells.length);
    for (let k = 0; k < rec.cells.length; k++) before[k] = rig.ore.amount[rec.cells[k]];

    const h = spawnHarvester(rig, P0, CX, CZ);
    const s = rig.world.store;
    const i = s.index(h);

    // One full load is 700 units against a per-cell max of 900, so a harvester
    // that only ever drained one cell would still fill up — the point of the
    // test is that a DRY cell is abandoned for the next one rather than being
    // sat on.
    for (let k = 0; k < 900; k++) {
      rig.step();
      if (s.cargo[i] >= s.cargoMax[i]) break;
    }
    expect(s.cargo[i]).toBe(s.cargoMax[i]);

    let drained = 0;
    let emptied = 0;
    for (let k = 0; k < rec.cells.length; k++) {
      const now = rig.ore.amount[rec.cells[k]];
      if (now < before[k] - 0.001) drained++;
      if (before[k] > 0 && now === 0) emptied++;
    }
    expect(emptied).toBeGreaterThan(0);
    expect(drained).toBeGreaterThan(emptied);
  });

  it('announces a harvester under attack', () => {
    const rig = makeRig();
    const h = spawnHarvester(rig, P0, CX, CZ);
    let attacks = 0;
    rig.channels.events.on('combat:underAttack', (ev) => {
      if (!ev.isBuilding) attacks++;
    });
    rig.channels.events.emit('entity:damaged', {
      id: h, player: P0, attacker: 0 as EntityId, attackerPlayer: P1,
      amount: 50, hpAfter: 950, hpFrac: 0.95, warhead: 0,
      x: CX, z: CZ,
    });
    expect(attacks).toBe(1);
  });

  it('hands the unit over the moment a real nav field claims it', () => {
    const rig = makeRig();
    spawnRefinery(rig, P0, CX, CZ);
    rig.ore.seedField(CX + 40, CZ, 18);
    const h = spawnHarvester(rig, P0, CX, CZ + 10);
    const s = rig.world.store;
    const i = s.index(h);

    rig.step(10);
    expect(s.posX[i] !== CX || s.posZ[i] !== CZ + 10).toBe(true);

    // nav-movement writes navField. From here the fallback mover is silent.
    s.navField[i] = 7;
    const x = s.posX[i];
    const z = s.posZ[i];
    rig.step(30);
    expect(s.posX[i]).toBe(x);
    expect(s.posZ[i]).toBe(z);
    expect(rig.harvesters.stats().driven).toBe(0);
  });

  /**
   * Assist mode is the contract with nav: nav owns locomotion, but a harvester
   * nav has given up on (field released AND Steering asking for zero velocity)
   * must still finish its haul, because the economy is the one loop that is
   * not allowed to stop.
   */
  it('assist mode only rescues harvesters nav has parked', () => {
    const rig = makeRig();
    spawnRefinery(rig, P0, CX, CZ);
    rig.ore.seedField(CX + 40, CZ, 18);
    const h = spawnHarvester(rig, P0, CX, CZ + 10);
    const s = rig.world.store;
    const i = s.index(h);
    setHarvesterDrive('assist');

    // Nav is actively steering it: non-zero desired velocity, no field yet.
    rig.step(1);
    s.velX[i] = 1;
    s.velZ[i] = 0;
    let x = s.posX[i];
    let z = s.posZ[i];
    rig.step(1);
    expect(s.posX[i]).toBe(x);
    expect(s.posZ[i]).toBe(z);
    expect(rig.harvesters.stats().driven).toBe(0);

    // Nav holds a field for it: also hands off.
    s.velX[i] = 0;
    s.velZ[i] = 0;
    s.navField[i] = 3;
    rig.step(1);
    expect(s.posX[i]).toBe(x);
    expect(s.posZ[i]).toBe(z);

    // Nav released the field and is asking for no velocity: it gave up. Ours.
    s.navField[i] = -1;
    x = s.posX[i];
    z = s.posZ[i];
    rig.step(20);
    expect(s.posX[i] !== x || s.posZ[i] !== z).toBe(true);
    expect(rig.harvesters.stats().driven).toBe(1);
    // And it never reports a speed back to nav's columns while assisting.
    expect(s.speed[i]).toBe(0);
    expect(s.velX[i]).toBe(0);

    setHarvesterDrive('full');
  });

  it('setHarvesterDrive(false) stops the fallback mover entirely', () => {
    const rig = makeRig();
    rig.ore.seedField(CX + 40, CZ, 18);
    spawnRefinery(rig, P0, CX, CZ);
    const h = spawnHarvester(rig, P0, CX, CZ + 10);
    const s = rig.world.store;
    const i = s.index(h);
    setHarvesterDrive(false);

    rig.step(30);
    expect(s.posX[i]).toBe(CX);
    expect(s.posZ[i]).toBe(CZ + 10);
    // The FSM still ran and still made a plan.
    expect(s.state[i]).toBe(UnitState.SeekOre);
    setHarvesterDrive(true);
  });

  it('reports the harvest through economy:credits with reason Harvest', () => {
    const rig = makeRig();
    const ref = spawnRefinery(rig, P0, CX, CZ);
    const h = spawnHarvester(rig, P0, CX, CZ + 8);
    const s = rig.world.store;
    const i = s.index(h);
    s.cargo[i] = 200;
    s.dockTarget[i] = ref as number;
    s.state[i] = UnitState.Docked;
    // Room to bank into: `step()` recomputes the cap every tick, so setting
    // storageMax directly would be overwritten.
    rig.world.player(P0).credits = 0;

    let reason = -1;
    rig.channels.events.on('economy:credits', (ev) => { if (ev.player === P0) reason = ev.reason; });
    rig.step(4);
    expect(reason).toBe(CreditReason.Harvest);
  });
});

/* ==========================================================================
 * THE UNLOAD APRON MUST BE OUTSIDE THE REFINERY
 *
 * Reported as "the collector is stuck within its own building", with a
 * screenshot of a Sun Collector sunk into the side of its own refinery.
 *
 * It was not a steering failure. It was where the harvester was TOLD to park.
 * The apron was `halfDepth + HARVESTER_DOCK_STANDOFF`, a constant of 3.4 whose
 * own comment called it "half a harvester length plus a little" — half a
 * harvester is 8.60 / 2 = 4.30 m, so the constant was 0.9 m short of the half it
 * named. Against a 3.87 m collision radius that parked every harvester in the
 * game with its back end inside an impassable footprint, by construction.
 *
 * Nothing asserted the one relationship that matters, which is why it survived
 * from the first implementation. It is asserted here, over the real roster
 * dimensions rather than a hand-picked pair.
 * ========================================================================== */

describe('the harvester unload apron clears the refinery footprint', () => {
  const CELL_M = 4;
  /** Every refinery-ish footprint in the game, in cells: [w, h]. */
  const FOOTPRINTS: ReadonlyArray<readonly [number, number]> = [
    [3, 2], [2, 2], [3, 3], [4, 3], [2, 3],
  ];
  /** Real harvester collision radii: max(w,l) * 0.45 over the authored dims. */
  const RADII = [3.87, 2.5, 4.5, 1.8];

  /** Facing directions, including the diagonals a free yaw actually produces. */
  const FACINGS: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 0], [0, -1], [-1, 0],
    [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  ];

  it('parks the whole hull outside the footprint, at every facing and size', () => {
    for (const [fw, fh] of FOOTPRINTS) {
      const halfW = fw * CELL_M * 0.5;
      const halfH = fh * CELL_M * 0.5;
      for (const [fx, fz] of FACINGS) {
        for (const r of RADII) {
          const reach = dockApronDistance(halfW, halfH, fx, fz, r);
          const edge = Math.abs(fx) * halfW + Math.abs(fz) * halfH;
          const rear = reach - r;
          expect(
            rear,
            `footprint ${fw}x${fh} facing (${fx.toFixed(2)},${fz.toFixed(2)}) radius ${r}: `
            + `hull rear at ${rear.toFixed(2)} m against a footprint edge at ${edge.toFixed(2)} m`,
          ).toBeGreaterThan(edge);
        }
      }
    }
  });

  it('leaves exactly the configured daylight, not more', () => {
    // A gap that grows with hull size would park big harvesters in a field.
    for (const r of [1.8, 3.87, 6.0]) {
      const reach = dockApronDistance(6, 4, 0, 1, r);
      expect(reach - r - 4).toBeCloseTo(HARVESTER_DOCK_CLEARANCE, 9);
    }
  });

  it('scales with the DOCKING hull, not with a constant', () => {
    // The heart of the fix: a bigger harvester must be given a bigger apron.
    // The old code returned the same distance for every hull in the game.
    const small = dockApronDistance(6, 4, 0, 1, 2.0);
    const large = dockApronDistance(6, 4, 0, 1, 5.0);
    expect(large - small).toBeCloseTo(3.0, 9);
  });

  it('presents the WIDTH when the refinery faces along X', () => {
    // The rotated case was five times worse than the unrotated one, because
    // the old line always used footprintH regardless of which way the building
    // pointed. A 3x2 refinery turned 90 degrees put the hull 2.47 m inside.
    const facingZ = dockApronDistance(6, 4, 0, 1, 3.87);
    const facingX = dockApronDistance(6, 4, 1, 0, 3.87);
    expect(facingX - facingZ).toBeCloseTo(2.0, 9);  // halfW 6 vs halfH 4
  });

  it('reproduces the reported case exactly', () => {
    // Meridian refinery 3x2, Sun Collector radius 3.87.
    const reach = dockApronDistance(6, 4, 0, 1, 3.87);
    expect(reach).toBeCloseTo(8.47, 2);
    expect(reach - 3.87).toBeCloseTo(4.60, 2);   // rear edge, was 3.53 (inside 4.0)
  });
});
