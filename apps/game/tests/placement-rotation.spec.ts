/// <reference types="vite/client" />
/**
 * ============================================================================
 * tests/placement-rotation.spec.ts
 * ============================================================================
 * TURNING A STRUCTURE WHILE YOU PLACE IT, and the one defect this feature can
 * ship with: a footprint that does not swap.
 *
 * At 90 and 270 degrees a 3x2 War Factory occupies 2x3 cells. FIVE things have
 * to agree about that or the green outline is a lie:
 *
 *   1. `evaluatePlacement`      — the rule the ghost reads and the sim enforces
 *   2. `terrain.markOccupied`   — what the next placement collides with
 *   3. `store.footprintW/H`     — the picker, the nav clamp, the save file
 *   4. `store.yaw`              — what the renderer draws
 *   5. the concrete pad         — cosmetic, but it is the promise the ghost made
 *
 * Most of what follows is one of those five checked against another. The rest
 * is the second half of the job: a finished structure must NOT arm the cursor,
 * and must survive being left alone.
 *
 * Headless, like the rest of the suite. `PlacementController` does touch THREE,
 * but only CPU-side classes — no WebGL context is created — so the ghost's own
 * state machine is testable here too.
 * ============================================================================
 */

import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { BuildTab, EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, MAP_CELLS, SIM_DT } from '../src/core/config';

import { ProductionCatalog, ProductionService } from '../src/sim/Production';
import {
  FACING_COUNT,
  PlacementController,
  evaluatePlacement,
  facedFootprintH,
  facedFootprintW,
  facingSwapsFootprint,
  facingYaw,
  makePlacementReport,
  normaliseFacing,
  yawToFacing,
} from '../src/sim/Placement';
import { PLACEMENT_ROTATE_HOTKEYS } from '../src/input/ActionCatalogue';
import { actionById } from '../src/input/ActionCatalogue';
import { clearScenario } from '../src/game/Scenarios';

const EMPTY_BINDING = { tables: null, unitId: {}, buildingId: {} };

/* ========================================================================== */
/* Fixtures                                                                   */
/* ========================================================================== */

function makeWorld(): { world: World; channels: Channels; service: ProductionService } {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();
  const service = new ProductionService(world, channels, new ProductionCatalog(EMPTY_BINDING));
  return { world, channels, service };
}

let simTick = 0;
function step(service: ProductionService, world: World, steps = 1): void {
  const rng = new Rng(7);
  for (let i = 0; i < steps; i++) {
    simTick++;
    world.tick = simTick;
    world.time = simTick * SIM_DT;
    const s: SimContext = { dt: SIM_DT, tick: simTick, time: world.time, rng };
    service.tick(s);
    world.spatial.rebuild();
  }
}

/** Plant a finished structure the way a scenario would. */
function plant(
  service: ProductionService, world: World, key: string, cx: number, cz: number, yaw = 0,
): EntityId {
  const entry = service.catalog.byKey(key)!;
  return service.spawnBuilding(world.player(0 as PlayerId), entry, cx, cz, 1, yaw);
}

/**
 * A base with everything a War Factory needs standing, and its cells clear of
 * the (44..46, 40..42) block every rotation case below is aimed at.
 */
function makeBase(): { world: World; channels: Channels; service: ProductionService } {
  const rig = makeWorld();
  plant(rig.service, rig.world, 'conyard', 38, 44);
  plant(rig.service, rig.world, 'powerPlant', 42, 47);
  plant(rig.service, rig.world, 'refinery', 38, 48);
  step(rig.service, rig.world, 2);
  rig.world.player(0 as PlayerId).credits = 100000;
  return rig;
}

/** Occupy one cell. A real id, because `isOccupied` reads `!== 0`. */
const BLOCKER = 4242 as EntityId;
function blockCell(world: World, gx: number, gz: number): void {
  world.terrain.markOccupied(gx, gz, 1, 1, BLOCKER);
}

/** Queue a structure and run until it is sitting ready at the head of its tab. */
function buildUntilReady(
  service: ProductionService, world: World, key: string,
): void {
  const entry = service.catalog.byKey(key)!;
  const p = world.player(0 as PlayerId);
  p.credits = 100000;
  service.enqueue(p.id, entry.index);
  step(service, world, Math.ceil(entry.buildTime / SIM_DT) + 6);
}

/**
 * The slot holding this player's structure with `key`, or -1.
 *
 * Through `entryOf`, the PUBLIC lookup — `entryForSlot` is private, and
 * `tsconfig.test.json` is the config that says so.
 */
function slotOf(service: ProductionService, world: World, key: string): number {
  const st = world.store;
  const list = st.byKind[EntityKind.Building];
  for (let a = 0; a < st.byKindCount[EntityKind.Building]; a++) {
    const slot = list[a];
    if (service.entryOf(st.handleOf(slot))?.key === key) return slot;
  }
  return -1;
}

beforeEach(() => { simTick = 0; clearScenario(); });

/* ==========================================================================
 * 1. THE VOCABULARY
 * ========================================================================== */

describe('facing arithmetic', () => {
  it('swaps the footprint at a quarter and three-quarter turn, and only there', () => {
    expect(facingSwapsFootprint(0)).toBe(false);
    expect(facingSwapsFootprint(1)).toBe(true);
    expect(facingSwapsFootprint(2)).toBe(false);
    expect(facingSwapsFootprint(3)).toBe(true);
  });

  it('turns a 3x2 into a 2x3 and back', () => {
    expect([facedFootprintW(3, 2, 0), facedFootprintH(3, 2, 0)]).toEqual([3, 2]);
    expect([facedFootprintW(3, 2, 1), facedFootprintH(3, 2, 1)]).toEqual([2, 3]);
    expect([facedFootprintW(3, 2, 2), facedFootprintH(3, 2, 2)]).toEqual([3, 2]);
    expect([facedFootprintW(3, 2, 3), facedFootprintH(3, 2, 3)]).toEqual([2, 3]);
    // A square footprint is invariant, which is exactly why the ghost needs a
    // chevron to show the facing at all.
    expect([facedFootprintW(2, 2, 1), facedFootprintH(2, 2, 1)]).toEqual([2, 2]);
  });

  it('wraps negatives, so rotating left from 0 lands on 3 rather than -1', () => {
    expect(normaliseFacing(-1)).toBe(3);
    expect(normaliseFacing(-5)).toBe(3);
    expect(normaliseFacing(4)).toBe(0);
    expect(normaliseFacing(7)).toBe(3);
  });

  it('round-trips every facing through a yaw', () => {
    for (let f = 0; f < FACING_COUNT; f++) {
      expect(yawToFacing(facingYaw(f))).toBe(f);
    }
    expect(facingYaw(1)).toBeCloseTo(Math.PI * 0.5, 10);
    expect(facingYaw(3)).toBeCloseTo(Math.PI * 1.5, 10);
  });

  it('snaps a hand-authored angle to the nearest quarter turn', () => {
    // A scenario may spawn a structure at any yaw. The footprint it was stamped
    // on is cell-aligned regardless, so the answer must be a facing, not NaN.
    expect(yawToFacing(Math.PI * 0.47)).toBe(1);
    expect(yawToFacing(-Math.PI * 0.5)).toBe(3);
    expect(yawToFacing(Math.PI * 4)).toBe(0);
  });
});

/* ==========================================================================
 * 2. THE RULE — the load-bearing case
 * ========================================================================== */

describe('evaluatePlacement at a facing', () => {
  it('reports the SWAPPED footprint for a 3x2 at 90 and 270', () => {
    const { world, service } = makeBase();
    const entry = service.catalog.byKey('warFactory')!;
    expect([entry.footprintW, entry.footprintH]).toEqual([3, 2]);
    const report = makePlacementReport();

    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report);
    expect([report.w, report.h]).toEqual([3, 2]);
    expect(report.facing).toBe(0);

    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report, null, 1);
    expect([report.w, report.h], 'a 3x2 turned 90 degrees is 2x3').toEqual([2, 3]);
    expect(report.facing).toBe(1);

    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report, null, 3);
    expect([report.w, report.h]).toEqual([2, 3]);

    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report, null, 2);
    expect([report.w, report.h], 'half a turn does not swap anything').toEqual([3, 2]);
  });

  it('tests the cells the TURNED rectangle covers, not the catalog one', () => {
    const { world, service } = makeBase();
    const entry = service.catalog.byKey('warFactory')!;
    const report = makePlacementReport();

    // Origin (44,40). Unturned it covers x 44..46, z 40..41.
    //                 Turned  it covers x 44..45, z 40..42.
    // So (46,40) is in ONE of them and (44,42) is in the other, which is the
    // whole difference the swap has to produce.
    blockCell(world, 46, 40);
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report).ok,
      'unturned: (46,40) is inside the 3x2').toBe(false);
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report, null, 1).ok,
      'turned: (46,40) is OUTSIDE the 2x3 and must not refuse it').toBe(true);

    world.terrain.clearOccupied(46, 40, 1, 1);
    blockCell(world, 44, 42);
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report).ok,
      'unturned: (44,42) is outside the 3x2').toBe(true);
    expect(evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report, null, 1).ok,
      'turned: (44,42) is INSIDE the 2x3 and must refuse it').toBe(false);
  });

  it('indexes the validity carpet row-major over the SWAPPED width', () => {
    const { world, service } = makeBase();
    const entry = service.catalog.byKey('warFactory')!;
    const report = makePlacementReport();

    // One blocked cell at local (1, 2) of the turned 2x3 — world (45, 42).
    blockCell(world, 45, 42);
    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, report, null, 1);
    expect(report.blocked).toBe(1);
    // Row-major over w=2: index = z * 2 + x = 2 * 2 + 1 = 5.
    expect(report.cells[5]).toBe(0);
    for (let i = 0; i < report.w * report.h; i++) {
      if (i !== 5) expect(report.cells[i], `cell ${i}`).toBe(1);
    }
  });

  it('leaves every pre-rotation caller answering exactly as before', () => {
    const { world, service } = makeBase();
    const entry = service.catalog.byKey('warFactory')!;
    const a = makePlacementReport();
    const b = makePlacementReport();
    // The AI calls the six-argument form. It must be identical to facing 0.
    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, a);
    evaluatePlacement(world, 0 as PlayerId, entry, 44, 40, b, null, 0);
    expect([a.ok, a.w, a.h, a.blocked]).toEqual([b.ok, b.w, b.h, b.blocked]);
  });
});

/* ==========================================================================
 * 3. THE COMMIT — rule, occupancy, store and yaw all agreeing
 * ========================================================================== */

describe('placing a turned structure', () => {
  it('stamps the swapped rectangle into the occupancy grid', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');
    expect(service.pendingStructure(0 as PlayerId)?.key).toBe('warFactory');

    const entry = service.catalog.byKey('warFactory')!;
    service.placeBuilding(0 as PlayerId, entry.publicId, 44, 40, 1);
    step(service, world, 1);
    expect(service.pendingStructure(0 as PlayerId)).toBe(null);

    // The 2x3 the ghost promised.
    for (let z = 40; z <= 42; z++) {
      for (let x = 44; x <= 45; x++) {
        expect(world.terrain.isOccupied(x, z), `(${x},${z}) should be taken`).toBe(true);
      }
    }
    // And NOT the third column the unturned 3x2 would have taken.
    for (let z = 40; z <= 41; z++) {
      expect(world.terrain.isOccupied(46, z), `(46,${z}) must stay free`).toBe(false);
    }
  });

  it('writes the swapped footprint and the matching yaw onto the entity', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');

    const entry = service.catalog.byKey('warFactory')!;
    service.placeBuilding(0 as PlayerId, entry.publicId, 44, 40, 1);
    step(service, world, 1);

    const st = world.store;
    const slot = slotOf(service, world, 'warFactory');
    expect(slot).toBeGreaterThanOrEqual(0);

    expect([st.footprintW[slot], st.footprintH[slot]],
      'store.footprintW/H is the WORLD rectangle, already swapped').toEqual([2, 3]);
    expect(st.yaw[slot]).toBeCloseTo(Math.PI * 0.5, 6);
    // Centre of the 2x3 at origin (44,40).
    expect(st.posX[slot]).toBeCloseTo((44 + 1) * CELL, 5);
    expect(st.posZ[slot]).toBeCloseTo((40 + 1.5) * CELL, 5);
  });

  it('refuses a second structure that overlaps only the TURNED rectangle', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');
    const factory = service.catalog.byKey('warFactory')!;
    service.placeBuilding(0 as PlayerId, factory.publicId, 44, 40, 1);
    step(service, world, 1);

    const report = makePlacementReport();
    const silo = service.catalog.byKey('oreSilo')!; // 1x1
    // (44,42) is the tail of the turned 2x3 and outside the unturned 3x2.
    expect(evaluatePlacement(world, 0 as PlayerId, silo, 44, 42, report).ok).toBe(false);
    // (46,40) is the column the turn gave back.
    expect(evaluatePlacement(world, 0 as PlayerId, silo, 46, 40, report).ok).toBe(true);
  });

  it('re-checks at the facing it was asked for, and refuses when that is blocked', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');
    const entry = service.catalog.byKey('warFactory')!;

    // Legal unturned, illegal turned.
    blockCell(world, 44, 42);
    service.placeBuilding(0 as PlayerId, entry.publicId, 44, 40, 1);
    step(service, world, 1);
    expect(service.pendingStructure(0 as PlayerId)?.key,
      'the sim must refuse the TURNED footprint, not the catalog one').toBe('warFactory');

    service.placeBuilding(0 as PlayerId, entry.publicId, 44, 40, 0);
    step(service, world, 1);
    expect(service.pendingStructure(0 as PlayerId)).toBe(null);
  });

  it('defaults to facing 0, so the AI path is byte-for-byte what it was', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');
    const entry = service.catalog.byKey('warFactory')!;

    // Four arguments — the call the AI makes through `handleCommand`.
    service.placeBuilding(0 as PlayerId, entry.publicId, 44, 40);
    step(service, world, 1);

    const st = world.store;
    const slot = slotOf(service, world, 'warFactory');
    expect([st.footprintW[slot], st.footprintH[slot]]).toEqual([3, 2]);
    expect(st.yaw[slot]).toBe(0);
    expect(world.terrain.isOccupied(46, 41)).toBe(true);
  });

  it('releases the swapped rectangle when the structure dies', () => {
    // `onBuildingRemoved` derives the cells from `store.footprintW/H`. If the
    // spawn had stored the UNSWAPPED pair, a turned structure would leak
    // occupancy for the rest of the match and nothing could ever build there.
    const { world, service } = makeBase();
    const id = plant(service, world, 'warFactory', 44, 40, Math.PI * 0.5);
    expect(world.terrain.isOccupied(44, 42)).toBe(true);

    service.sell(0 as PlayerId, id);
    step(service, world, 2);
    for (let z = 40; z <= 42; z++) {
      for (let x = 44; x <= 45; x++) {
        expect(world.terrain.isOccupied(x, z), `(${x},${z}) should be released`).toBe(false);
      }
    }
  });
});

/* ==========================================================================
 * 4. THE GHOST
 * ========================================================================== */

/** A `PlacementController` with stubs for everything that needs a screen. */
function makeGhost(service: ProductionService, world: World): PlacementController {
  return new PlacementController({
    world,
    scene: new THREE.Scene(),
    // Only `screenToGround` is ever called, and only when a pointer has moved.
    rig: { screenToGround: () => false } as never,
    canvas: {} as HTMLCanvasElement,
    service,
  });
}

describe('the placement ghost', () => {
  it('ships with auto-pickup OFF, so a finished structure never grabs the cursor', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'powerPlant');
    expect(service.pendingStructure(0 as PlayerId)?.key).toBe('powerPlant');

    const ghost = makeGhost(service, world);
    expect(ghost.autoPickup).toBe(false);
    for (let i = 0; i < 30; i++) ghost.frame();
    expect(ghost.active, 'nothing may arm the cursor unasked').toBe(false);
    expect(ghost.entry).toBe(null);
    // And the structure is still there, still ready, still free to place.
    expect(service.pendingStructure(0 as PlayerId)?.key).toBe('powerPlant');
    ghost.dispose();
  });

  it('picks the structure up when the cameo asks, and only then', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'powerPlant');

    const ghost = makeGhost(service, world);
    const entry = service.catalog.byKey('powerPlant')!;
    expect(ghost.begin(entry.publicId)).toBe(true);
    expect(ghost.active).toBe(true);
    expect(ghost.entry?.key).toBe('powerPlant');
    ghost.dispose();
  });

  it('turns the ghost, swaps the report and keeps the facing between placements', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');

    const ghost = makeGhost(service, world);
    const entry = service.catalog.byKey('warFactory')!;
    ghost.begin(entry.publicId);
    expect(ghost.facing).toBe(0);
    expect([ghost.report.w, ghost.report.h]).toEqual([3, 2]);

    expect(ghost.rotate(1)).toBe(1);
    expect([ghost.report.w, ghost.report.h],
      'the report the HUD and the commit both read must swap with the key').toEqual([2, 3]);

    expect(ghost.rotate(-1)).toBe(0);
    expect([ghost.report.w, ghost.report.h]).toEqual([3, 2]);

    // Anticlockwise past zero wraps rather than going negative.
    expect(ghost.rotate(-1)).toBe(3);
    expect([ghost.report.w, ghost.report.h]).toEqual([2, 3]);

    // Sticky across a fresh pickup: a row of walls should not need re-turning.
    ghost.cancel();
    ghost.begin(entry.publicId);
    expect(ghost.facing).toBe(3);
    ghost.dispose();
  });

  it('keeps the snapped origin inside the map using the SWAPPED extents', () => {
    const { world, service } = makeBase();
    buildUntilReady(service, world, 'warFactory');

    const ghost = makeGhost(service, world);
    const entry = service.catalog.byKey('warFactory')!;
    ghost.begin(entry.publicId);
    // Drive it hard into the far corner; the clamp must leave room for a 2x3.
    ghost.rotate(1);
    ghost.setCursorWorld(1e6, 1e6);
    ghost.frame();
    expect([ghost.report.w, ghost.report.h]).toEqual([2, 3]);
    expect(ghost.cx + ghost.report.w).toBeLessThanOrEqual(MAP_CELLS);
    expect(ghost.cz + ghost.report.h).toBeLessThanOrEqual(MAP_CELLS);
    ghost.dispose();
  });
});

/* ==========================================================================
 * 5. THE PING — a finished structure waits instead of arming
 * ========================================================================== */

describe('a structure that finished', () => {
  it('announces itself once, as a building, on the tab it came from', () => {
    const { world, channels, service } = makeBase();
    const ready: string[] = [];
    channels.events.on('production:ready', (e) => {
      ready.push(`${e.tab as number}:${e.isBuilding ? 'b' : 'u'}`);
    });
    buildUntilReady(service, world, 'powerPlant');
    expect(ready).toEqual([`${BuildTab.Structures as number}:b`]);
  });

  it('stays ready indefinitely, and the queue behind it resumes once it lands', () => {
    // The refusal this guards: "the player chose not to place it immediately"
    // must not lose the structure OR wedge the queue permanently.
    const { world, service } = makeBase();
    const p = world.player(0 as PlayerId);
    const silo = service.catalog.byKey('oreSilo')!;
    service.enqueue(p.id, silo.index, 2);

    step(service, world, Math.ceil(silo.buildTime / SIM_DT) + 6);
    expect(service.pendingStructure(p.id)?.key).toBe('oreSilo');
    expect(service.queues.depth(p, BuildTab.Structures),
      'the second one is still queued behind it').toBe(2);

    // Ten seconds of the player doing nothing about it.
    step(service, world, 300);
    expect(service.pendingStructure(p.id)?.key,
      'a structure left alone must still be there').toBe('oreSilo');
    expect(service.queues.depth(p, BuildTab.Structures)).toBe(2);

    // Placeable whenever the player gets round to it, and the queue moves on.
    service.placeBuilding(p.id, silo.publicId, 42, 44);
    step(service, world, 1);
    expect(service.queues.depth(p, BuildTab.Structures)).toBe(1);
    step(service, world, Math.ceil(silo.buildTime / SIM_DT) + 6);
    expect(service.pendingStructure(p.id)?.key,
      'the one behind it built as soon as the head cleared').toBe('oreSilo');
  });
});

/* ==========================================================================
 * 6. THE BINDING IS DISCOVERABLE
 * ========================================================================== */

describe('the rotate keys', () => {
  it('are the codes the engine listens for, published on the help screen', () => {
    const left = actionById('bld.rotateLeft');
    const right = actionById('bld.rotateRight');
    expect(left?.fixedCodes).toEqual([PLACEMENT_ROTATE_HOTKEYS[0]]);
    expect(right?.fixedCodes).toEqual([PLACEMENT_ROTATE_HOTKEYS[1]]);
    expect(left?.category).toBe('building');
    expect(right?.category).toBe('building');
    expect(left?.binding).toBe('fixed');
    expect(right?.binding).toBe('fixed');
  });

  it('do not squat on anything the player is already using', () => {
    // The reason these are punctuation and not a letter. If this ever fails,
    // the rotate key is ALSO firing an order, a camera move or a build slot.
    const claimed = new Set<string>();
    for (const a of [
      'cam.panUp', 'cam.panDown', 'cam.panLeft', 'cam.panRight',
      'cam.rotateLeft', 'cam.rotateRight', 'cam.home',
      'ord.attackMove', 'ord.stop', 'ord.guard', 'ord.scatter', 'ord.deploy',
      'ord.forceAttack', 'ord.rally', 'ord.stance', 'sel.allArmy',
      'sys.menu', 'sys.perf', 'sys.speed', 'sys.screenshot',
    ]) {
      const code = actionById(a)?.defaultChord?.code;
      if (code !== undefined) claimed.add(code);
    }
    // The camera rig's own WASD fallback (src/render/camera.ts) and the build
    // keyboard, neither of which is a rebindable row.
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) claimed.add(code);
    for (const code of actionById('bld.tabKeys')?.fixedCodes ?? []) claimed.add(code);
    for (const code of actionById('bld.slotKeys')?.fixedCodes ?? []) claimed.add(code);

    for (const code of PLACEMENT_ROTATE_HOTKEYS) {
      expect(claimed.has(code), `${code} is already bound to something`).toBe(false);
    }
    expect(new Set(PLACEMENT_ROTATE_HOTKEYS).size).toBe(PLACEMENT_ROTATE_HOTKEYS.length);
  });
});

/* ==========================================================================
 * 7. RELOCATION STILL WORKS
 * ========================================================================== */

describe('relocation and facing', () => {
  it('exempts the structure\'s own cells using its WORLD footprint when turned', () => {
    // `PlacementExempt` is filled from `store.footprintW/H`. A turned structure
    // whose store held the unswapped pair would exempt the wrong rectangle and
    // refuse every short move — the exact bug the exemption exists to prevent.
    const { world, service } = makeBase();
    const id = plant(service, world, 'warFactory', 44, 40, Math.PI * 0.5);
    step(service, world, 1);

    const st = world.store;
    const i = st.index(id);
    expect([st.footprintW[i], st.footprintH[i]]).toEqual([2, 3]);

    const entry = service.catalog.byKey('warFactory')!;
    const report = makePlacementReport();
    const exempt = { cx: 44, cz: 40, w: 2, h: 3 };
    // One cell down: every overlapping cell is its own, so it must be legal.
    const saved = st.flags[i];
    st.flags[i] = saved | EntityFlag.PendingDestroy;
    evaluatePlacement(world, 0 as PlayerId, entry, 44, 41, report, exempt, 1);
    st.flags[i] = saved;
    expect(report.ok, 'a one-cell nudge of a turned structure must be legal').toBe(true);
  });
});
