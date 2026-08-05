/**
 * Fog of war — the vision grid and the shroud overlay.
 *
 * Everything here runs headless. `Vision` is pure typed-array work over an
 * `EntityStore`, and `FogOfWar` only builds `BufferGeometry` / `DataTexture` /
 * `ShaderMaterial`, none of which touch a GL context until something renders.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { devAsserts } from '../src/core/loop';
import { EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import {
  CELL, MAP_CELLS, MAP_CELL_COUNT, MAP_SIZE,
  FOG_EXPLORED_LEVEL, FOG_MESH_SAMPLES_PER_CELL, VISION_TICK_INTERVAL,
} from '../src/core/config';
import {
  Vision, VIS_EXPLORED, VIS_VISIBLE, VIS_FULL,
  VISION_REGROW_TICKS, CLOAK_SUBMERGED,
} from '../src/sim/Vision';
import { FogOfWar } from '../src/render/FogOfWar';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/** Two mutually hostile players and an empty world. */
function makeWorld(): World {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  return world;
}

/** Spawn a vision-providing unit at a world position. */
function spawnScout(world: World, owner: PlayerId, x: number, z: number, sight = 12): EntityId {
  const id = world.store.alloc(
    EntityKind.Vehicle, 0, owner, owner === P0 ? Faction.Allies : Faction.Soviets, x, 0, z,
  );
  const i = world.store.index(id);
  world.store.sight[i] = sight;
  world.store.flags[i] |= EntityFlag.ProvidesVision | EntityFlag.CanMove;
  return id;
}

function cellOf(x: number, z: number): number {
  return ((z / CELL) | 0) * MAP_CELLS + ((x / CELL) | 0);
}

/* ========================================================================== */

describe('Vision — the three states', () => {
  it('starts every cell unexplored', () => {
    const v = new Vision(makeWorld());
    const g = v.gridFor(P0);
    expect(g.length).toBe(MAP_CELL_COUNT);
    let sum = 0;
    for (let i = 0; i < g.length; i++) sum += g[i];
    expect(sum).toBe(0);
    expect(v.isVisibleAt(P0, 10, 10)).toBe(false);
    expect(v.isExplored(P0, 10, 10)).toBe(false);
  });

  it('lights a circle around a sighted unit and remembers it afterwards', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 100, 100, 12);

    v.update();
    const g = v.gridFor(P0);
    expect(g[cellOf(100, 100)]).toBe(VIS_FULL);
    // 12 m sight: a cell centre 30 m away is well outside.
    expect(g[cellOf(130, 100)]).toBe(0);

    // Kill the source and age the timers past VISION_REGROW_TICKS.
    world.store.markDead(world.store.handleOf(world.store.alive[0]));
    world.store.flushDestroyed();
    for (let n = 0; n <= VISION_REGROW_TICKS; n++) v.update();

    expect(g[cellOf(100, 100)] & VIS_VISIBLE).toBe(0);
    expect(g[cellOf(100, 100)] & VIS_EXPLORED).toBe(VIS_EXPLORED);
    expect(v.isExplored(P0, (100 / CELL) | 0, (100 / CELL) | 0)).toBe(true);
    expect(v.isVisibleAt(P0, (100 / CELL) | 0, (100 / CELL) | 0)).toBe(false);
  });

  it('honours VISION_REGROW_DELAY before a cell goes dark', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const id = spawnScout(world, P0, 200, 200, 10);
    v.update();
    world.store.markDead(id as never);
    world.store.flushDestroyed();

    // One tick after the source is gone the cell must still be lit.
    v.update();
    expect(v.gridFor(P0)[cellOf(200, 200)] & VIS_VISIBLE).toBe(VIS_VISIBLE);
    expect(VISION_REGROW_TICKS).toBeGreaterThan(1);
  });

  it('keeps a hostile player blind to the same ground', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 64, 64, 14);
    v.update();
    expect(v.gridFor(P0)[cellOf(64, 64)]).toBe(VIS_FULL);
    expect(v.gridFor(P1)[cellOf(64, 64)]).toBe(0);
  });

  it('shares vision with allies', () => {
    const world = makeWorld();
    world.players[0].allyMask |= 1 << 1;
    world.players[1].allyMask |= 1 << 0;
    const v = new Vision(world);
    spawnScout(world, P0, 300, 220, 14);
    v.update();
    expect(v.gridFor(P1)[cellOf(300, 220)]).toBe(VIS_FULL);
  });

  it('reports a changed mask only when the grid actually moved', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 128, 128, 12);
    expect(v.update()).not.toBe(0);
    // Nothing moved, so a second pass is a no-op for both players.
    expect(v.update()).toBe(0);
  });
});

describe('Vision — canSee', () => {
  it('always sees your own and your allies units', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const mine = spawnScout(world, P0, 400, 400, 10);
    expect(v.canSee(P0, mine as never)).toBe(true);
  });

  it('refuses an enemy standing in the dark and allows one in the light', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const enemy = spawnScout(world, P1, 240, 240, 10);
    v.update();
    expect(v.canSee(P0, enemy as never)).toBe(false);

    spawnScout(world, P0, 244, 240, 14);
    v.update();
    expect(v.canSee(P0, enemy as never)).toBe(true);
  });

  it('does not resurrect a stale handle', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const id = spawnScout(world, P1, 100, 300, 10);
    world.store.markDead(id as never);
    world.store.flushDestroyed();
    expect(v.canSee(P0, id as never)).toBe(false);
  });

  it('is fully permissive when disabled', () => {
    const world = makeWorld();
    const v = new Vision(world, false);
    const enemy = spawnScout(world, P1, 20, 20, 10);
    expect(v.canSee(P0, enemy as never)).toBe(true);
    expect(v.isVisibleAt(P0, 3, 3)).toBe(true);
    expect(v.gridFor(P0)[0]).toBe(VIS_FULL);
  });
});

describe('Vision — cloak and detectors', () => {
  it('hides a cloaked enemy that is standing in plain sight', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const sub = spawnScout(world, P1, 160, 160, 10);
    spawnScout(world, P0, 164, 160, 20);
    v.update();
    expect(v.canSee(P0, sub as never)).toBe(true);

    v.setCloaked(sub as never, true, CLOAK_SUBMERGED);
    expect(v.canSee(P0, sub as never)).toBe(false);
    expect(v.isCloaked(sub as never)).toBe(true);
  });

  it('exposes a cloaked entity inside a detector radius', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const sub = spawnScout(world, P1, 160, 160, 10);
    const eye = spawnScout(world, P0, 164, 160, 20);
    v.setCloaked(sub as never, true);
    v.setDetector(eye as never, 30);
    v.update();
    expect(v.isDetectedAt(P0, 160, 160)).toBe(true);
    expect(v.canSee(P0, sub as never)).toBe(true);
    // The detector belongs to P0, so P1 gains nothing from it.
    expect(v.isDetectedAt(P1, 160, 160)).toBe(false);
  });

  it('revealFor temporarily un-cloaks', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const sub = spawnScout(world, P1, 160, 160, 10);
    spawnScout(world, P0, 164, 160, 20);
    v.update();
    v.setCloaked(sub as never, true);
    expect(v.canSee(P0, sub as never)).toBe(false);
    v.revealFor(sub as never, 2);
    expect(v.canSee(P0, sub as never)).toBe(true);
    world.time = 5;
    expect(v.canSee(P0, sub as never)).toBe(false);
  });

  it('tickCloak only ever touches entities it was told about', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const a = spawnScout(world, P1, 100, 100, 10);
    const b = spawnScout(world, P1, 120, 100, 10);
    // Someone else's cloak, never registered here.
    world.store.flags[world.store.index(b as never)] |= EntityFlag.Cloaked;

    v.setCloaked(a as never, true);
    v.tickCloak();
    expect(world.store.flags[world.store.index(a as never)] & EntityFlag.Cloaked).toBeTruthy();
    expect(world.store.flags[world.store.index(b as never)] & EntityFlag.Cloaked).toBeTruthy();

    v.setCloaked(a as never, false);
    v.tickCloak();
    expect(world.store.flags[world.store.index(a as never)] & EntityFlag.Cloaked).toBeFalsy();
    expect(world.store.flags[world.store.index(b as never)] & EntityFlag.Cloaked).toBeTruthy();
  });
});

/* ==========================================================================
 * THE RENDER VISIBILITY MASK
 *
 * This block is a regression suite for a shipped bug, so it is worth saying
 * what the bug was. Fog used to hide entities by SETTING `EntityFlag.Cloaked`
 * on them at `RenderPhase.FowUpload` and putting the bit back at
 * `RenderPhase.Present`. That flag is read by four modules — the render bridge,
 * `Targeting`, `Combat` and `Selection` — so a single missed restore did not
 * hide a unit for a frame, it made a unit invisible, un-acquirable, un-shootable
 * and un-clickable for the rest of the match, because the restore was keyed on
 * a SLOT INDEX with no generation check and `tickCloak` refuses to clear a bit
 * it has no `setCloaked` reason for.
 *
 * The mask now lives in Vision's own array and touches no simulation column.
 * Every test here is one sentence of that contract.
 * ========================================================================== */
describe('Vision — the render visibility mask', () => {
  it('hides an unseen enemy unit and touches NO simulation flag', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const enemy = spawnScout(world, P1, 300, 300, 10);
    const mine = spawnScout(world, P0, 40, 40, 12);
    v.update();

    const ei = world.store.index(enemy as never);
    const mi = world.store.index(mine as never);
    const beforeE = world.store.flags[ei];
    const beforeM = world.store.flags[mi];

    expect(v.computeRenderMask(P0)).toBe(1);
    expect(v.isRenderHiddenAt(ei)).toBe(true);
    expect(v.isRenderHiddenAt(mi)).toBe(false);
    expect(v.isRenderHidden(enemy)).toBe(true);

    // The whole point: the flags column is byte-identical either side of it.
    expect(world.store.flags[ei]).toBe(beforeE);
    expect(world.store.flags[mi]).toBe(beforeM);
    expect(world.store.flags[ei] & EntityFlag.Cloaked).toBeFalsy();
  });

  it('never masks an entity the local player can plainly see', () => {
    const world = makeWorld();
    const v = new Vision(world);
    // A scout with a wide eye, and an enemy standing right under it.
    spawnScout(world, P0, 200, 200, 40);
    const enemy = spawnScout(world, P1, 208, 200, 10);
    v.update();

    v.computeRenderMask(P0);
    expect(v.isRenderHidden(enemy)).toBe(false);
    expect(v.canSee(P0, enemy)).toBe(true);
  });

  it('remembers an explored enemy STRUCTURE but not an enemy vehicle', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const s = world.store;

    const yard = s.alloc(EntityKind.Building, 0, P1, Faction.Soviets, 200, 0, 200);
    s.sight[s.index(yard)] = 10;
    s.flags[s.index(yard)] |= EntityFlag.ProvidesVision;
    const tank = spawnScout(world, P1, 204, 200, 10);

    // Scout it, then leave.
    const spy = spawnScout(world, P0, 208, 200, 24);
    v.update();
    expect(v.computeRenderMask(P0)).toBe(0);

    s.markDead(spy);
    s.flushDestroyed();
    for (let n = 0; n <= VISION_REGROW_TICKS; n++) v.update();

    v.computeRenderMask(P0);
    expect(v.isRenderHidden(yard)).toBe(false);
    expect(v.isRenderHidden(tank)).toBe(true);

    // AND THE TRAP THAT COMES WITH IT: the structure is DRAWN from memory but
    // `canSee` — what targeting asks — is false, because a silhouette you
    // remember is not a target you can currently acquire. Anything turning a
    // click on a drawn thing into an order has to reconcile the two itself.
    expect(v.canSee(P0, yard)).toBe(false);
    expect(v.isRemembered(P0, yard)).toBe(true);
  });

  it('restores full visibility the moment the mask is recomputed', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const scout = spawnScout(world, P0, 200, 200, 40);
    const enemy = spawnScout(world, P1, 400, 400, 10);
    v.update();
    v.computeRenderMask(P0);
    expect(v.isRenderHidden(enemy)).toBe(true);

    // Walk the scout onto the enemy and re-stamp.
    const si = world.store.index(scout);
    world.store.posX[si] = 400;
    world.store.posZ[si] = 400;
    v.update();
    v.computeRenderMask(P0);
    expect(v.isRenderHidden(enemy)).toBe(false);
  });

  it('CANNOT LATCH: two masks with no clear between them still release', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const scout = spawnScout(world, P0, 200, 200, 40);
    const enemy = spawnScout(world, P1, 400, 400, 10);
    v.update();

    // The old pair could not survive this: apply, apply, and the second one's
    // bookkeeping recorded "was already hidden" for a bit the first one set.
    v.computeRenderMask(P0);
    v.computeRenderMask(P0);
    v.computeRenderMask(P0);
    expect(v.isRenderHidden(enemy)).toBe(true);

    const si = world.store.index(scout);
    world.store.posX[si] = 400;
    world.store.posZ[si] = 400;
    v.update();
    v.computeRenderMask(P0);
    expect(v.isRenderHidden(enemy)).toBe(false);
  });

  it('CANNOT LATCH: a recycled slot never inherits the mask of its predecessor', () => {
    const world = makeWorld();
    const s = world.store;
    const v = new Vision(world);
    spawnScout(world, P0, 200, 200, 40);
    const far = spawnScout(world, P1, 900, 900, 10);
    v.update();
    v.computeRenderMask(P0);
    const slot = s.index(far);
    expect(v.isRenderHiddenAt(slot)).toBe(true);

    // The masked entity dies and something friendly takes its slot, with no
    // mask pass in between — the exact sequence that used to write a dead
    // unit's Cloaked bit onto a live one and leave it there forever.
    s.markDead(far);
    s.flushDestroyed();
    const reborn = spawnScout(world, P0, 200, 200, 10);
    expect(s.index(reborn)).toBe(slot);

    v.computeRenderMask(P0);
    expect(v.isRenderHiddenAt(slot)).toBe(false);
    expect(v.isRenderHidden(reborn)).toBe(false);
    expect(s.flags[slot] & EntityFlag.Cloaked).toBeFalsy();
  });

  it('a mask that stops being recomputed hides nothing (fails open)', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 200, 200, 12);
    const enemy = spawnScout(world, P1, 900, 900, 10);
    v.update();
    v.computeRenderMask(P0);
    expect(v.isRenderHidden(enemy)).toBe(true);

    // The fog module going away must reveal, never conceal: "you can see too
    // much for one frame" is a bug you notice, "a unit stopped existing" is not.
    v.invalidateRenderMask();
    expect(v.isRenderHidden(enemy)).toBe(false);
    v.dispose();
    expect(v.isRenderHidden(enemy)).toBe(false);
  });

  it('leaves canSee() completely unaffected, mask or no mask', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 200, 200, 40);
    const seen = spawnScout(world, P1, 208, 200, 10);
    const unseen = spawnScout(world, P1, 900, 900, 10);
    v.update();

    const before = [v.canSee(P0, seen), v.canSee(P0, unseen)];
    v.computeRenderMask(P0);
    expect([v.canSee(P0, seen), v.canSee(P0, unseen)]).toEqual(before);
    v.computeRenderMask(P0);
    expect([v.canSee(P0, seen), v.canSee(P0, unseen)]).toEqual(before);
    expect(before).toEqual([true, false]);
  });

  it('hides an undetected enemy cloak but never your own', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 200, 200, 40);
    const theirs = spawnScout(world, P1, 208, 200, 10);
    const ours = spawnScout(world, P0, 212, 200, 10);
    v.setCloaked(theirs, true, CLOAK_SUBMERGED);
    v.setCloaked(ours, true, CLOAK_SUBMERGED);
    v.update();
    v.computeRenderMask(P0);

    expect(v.isRenderHidden(theirs)).toBe(true);
    // Your own submarine is yours to see. The flag borrow used to force this
    // by clearing the bit; the mask simply never sets it.
    expect(v.isRenderHidden(ours)).toBe(false);
  });

  it('masks nothing but real cloaks while fog is disabled', () => {
    const world = makeWorld();
    const v = new Vision(world, false);
    spawnScout(world, P1, 300, 300, 10);
    expect(v.computeRenderMask(P0)).toBe(0);

    const sub = spawnScout(world, P1, 320, 300, 10);
    v.setCloaked(sub, true, CLOAK_SUBMERGED);
    expect(v.computeRenderMask(P0)).toBe(1);
    expect(v.isRenderHidden(sub)).toBe(true);
  });

  it('screams in dev the tick a stray Cloaked bit appears', () => {
    const world = makeWorld();
    const v = new Vision(world);
    const ghost = spawnScout(world, P1, 100, 100, 10);
    const gi = world.store.index(ghost);
    // Exactly the corruption the old borrow produced: the flag set on an entity
    // Vision has no cloak reason for. Nothing will ever clear it, so the only
    // useful response is to name it immediately instead of in someone's match.
    world.store.flags[gi] |= EntityFlag.Cloaked;

    const seen: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { seen.push(String(a[0])); };
    devAsserts.enabled = true;
    try {
      v.tickCloak();
    } finally {
      devAsserts.enabled = false;
      console.error = real;
    }

    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('EntityFlag.Cloaked');
    expect(seen[0]).toContain('no cloak reason');
  });

  it('setEnabled(false) reveals and setEnabled(true) keeps the memory', () => {
    const world = makeWorld();
    const v = new Vision(world);
    spawnScout(world, P0, 100, 100, 12);
    v.update();

    v.setEnabled(false);
    expect(v.gridFor(P0)[cellOf(500, 500)]).toBe(VIS_FULL);

    v.setEnabled(true);
    // Explored memory survives, live visibility does not.
    expect(v.gridFor(P0)[cellOf(500, 500)]).toBe(VIS_EXPLORED);
  });
});

describe('FogOfWar — the shroud overlay', () => {
  const flat = (): number => 0;

  it('drapes one grid over the whole map at CELL resolution', () => {
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: flat });

    const segments = MAP_CELLS * FOG_MESH_SAMPLES_PER_CELL;
    const pos = fog.mesh.geometry.getAttribute('position');
    expect(pos.count).toBe((segments + 1) * (segments + 1));
    expect(fog.mesh.geometry.getIndex()!.count).toBe(segments * segments * 6);

    // Corner vertices span exactly the playable area.
    const arr = pos.array as Float32Array;
    expect(arr[0]).toBe(0);
    expect(arr[(pos.count - 1) * 3]).toBeCloseTo(MAP_SIZE, 4);
    expect(arr[(pos.count - 1) * 3 + 2]).toBeCloseTo(MAP_SIZE, 4);

    // One mesh, one material, one texture — the whole shroud is one draw call.
    let meshes = 0;
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBe(1);
    expect(fog.mesh.renderOrder).toBeGreaterThan(2000);
    expect(fog.material.depthTest).toBe(false);
    expect(fog.material.depthWrite).toBe(false);

    fog.dispose();
  });

  it('samples the terrain height it is handed', () => {
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: (x, z) => (x + z) * 0.01 });
    const arr = fog.mesh.geometry.getAttribute('position').array as Float32Array;
    // Vertex 0 is (0,0); its Y is heightAt(0,0) plus the cosmetic lift.
    expect(arr[1]).toBeGreaterThanOrEqual(0);
    // A vertex deep in the map must be higher than the origin one.
    const mid = (((MAP_CELLS / 2) * (MAP_CELLS + 1)) + MAP_CELLS / 2) * 3;
    expect(arr[mid + 1]).toBeGreaterThan(arr[1]);
    fog.dispose();
  });

  it('animates toward the grid instead of popping', () => {
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: flat });
    const grid = new Uint8Array(MAP_CELL_COUNT);
    grid[0] = VIS_FULL;

    fog.update(grid, 1, 1 / 60, 0);
    const first = fog.levelAt(0, 0);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);

    for (let f = 0; f < 240; f++) fog.update(grid, 1, 1 / 60, f / 60);
    expect(fog.levelAt(0, 0)).toBe(1);
    fog.dispose();
  });

  it('parks explored-but-unseen cells at FOG_EXPLORED_LEVEL', () => {
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: flat });
    const grid = new Uint8Array(MAP_CELL_COUNT);
    grid[5] = VIS_EXPLORED;
    fog.snapTo(grid);
    expect(fog.levelAt(5, 0)).toBe(FOG_EXPLORED_LEVEL);
    expect(fog.levelAt(6, 0)).toBe(0);
    expect(fog.bytes[5]).toBe(128);
    fog.dispose();
  });

  it('stops uploading once the animation settles', () => {
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: flat });
    const grid = new Uint8Array(MAP_CELL_COUNT).fill(VIS_FULL);
    for (let f = 0; f < 300; f++) fog.update(grid, 1, 1 / 60, f / 60);
    const settledUploads = fog.uploadCount;
    for (let f = 0; f < 300; f++) fog.update(grid, 1, 1 / 60, f / 60);
    expect(fog.uploadCount).toBe(settledUploads);
    fog.dispose();
  });

  it('hides itself when disabled', () => {
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: flat });
    fog.snapTo(new Uint8Array(MAP_CELL_COUNT));
    expect(fog.mesh.visible).toBe(true);
    fog.setEnabled(false);
    expect(fog.mesh.visible).toBe(false);
    fog.dispose();
  });
});

describe('Vision — cadence', () => {
  it('stamps on the interval the whole game agrees on', () => {
    expect(VISION_TICK_INTERVAL).toBeGreaterThan(1);
    expect(VISION_REGROW_TICKS).toBeGreaterThanOrEqual(1);
    expect(VISION_REGROW_TICKS).toBeLessThanOrEqual(255);
  });
});
