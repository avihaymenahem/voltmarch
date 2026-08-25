/// <reference types="vite/client" />
/**
 * Rally-point overlay — the falsifiable half.
 *
 * `src/ui/Overlay.ts` draws the flag, and drawing needs a canvas. What it does
 * NOT need a canvas for is deciding which flag belongs to which factory, what
 * to do when a factory has never been given one, and what to read off the map
 * when the flag stands in shroud. All three live in two exported pure functions
 * over the World, which is exactly why they are exported — these run headless
 * like the rest of the suite.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { MAX_SELECTION } from '../src/core/config';
import {
  EntityFlag, EntityKind, Faction, VisionLevel,
  type EntityId, type IVision, type PlayerId,
} from '../src/core/types';
import {
  RALLY_EXPLORED,
  RALLY_LINK_STRIDE,
  RALLY_NONE,
  RALLY_UNEXPLORED,
  collectRallyLinks,
  rallyClickArmed,
} from '../src/ui/Overlay';

/* ========================================================================== */
/* Fixtures                                                                   */
/* ========================================================================== */

function makeWorld(): World {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  return world;
}

/** A structure that services a build queue, i.e. one that takes a rally flag. */
function addFactory(world: World, owner: PlayerId, x: number, z: number, y = 0): EntityId {
  const id = world.store.alloc(EntityKind.Building, 0, owner, Faction.Allies, x, y, z);
  world.store.flags[world.store.index(id)] |= EntityFlag.IsFactory;
  return id;
}

/** A structure that produces nothing — a power plant, a wall, a silo. */
function addPlainBuilding(world: World, owner: PlayerId, x: number, z: number): EntityId {
  return world.store.alloc(EntityKind.Building, 0, owner, Faction.Allies, x, 0, z);
}

function addVehicle(world: World, owner: PlayerId, x: number, z: number): EntityId {
  const id = world.store.alloc(EntityKind.Vehicle, 0, owner, Faction.Allies, x, 0, z);
  world.store.flags[world.store.index(id)] |= EntityFlag.CanMove;
  return id;
}

function select(world: World, ...ids: EntityId[]): void {
  for (let i = 0; i < ids.length; i++) world.selection.ids[i] = ids[i] as number;
  world.selection.count = ids.length;
}

function setRally(world: World, owner: PlayerId, id: EntityId, x: number, z: number): void {
  const p = world.players[owner as number];
  p.rallyX.set(id as number, x);
  p.rallyZ.set(id as number, z);
}

/** Nothing has ever been seen. The opposite of the default `OpenVision`. */
const BLIND: IVision = {
  isVisibleAt: () => false,
  isExplored: () => false,
  canSee: () => false,
  hasRadar: () => false,
  gridFor: () => new Uint8Array(0),
  visibilityOf: () => VisionLevel.Hidden,
};

function buf(): Float32Array {
  return new Float32Array(MAX_SELECTION * RALLY_LINK_STRIDE);
}

/** Read one link back out as a plain object, for readable assertions. */
function link(out: Float32Array, i: number): {
  fx: number; fy: number; fz: number; rx: number; ry: number; rz: number; tag: number;
} {
  const o = i * RALLY_LINK_STRIDE;
  return {
    fx: out[o], fy: out[o + 1], fz: out[o + 2],
    rx: out[o + 3], ry: out[o + 4], rz: out[o + 5], tag: out[o + 6],
  };
}

/* ========================================================================== */

describe('rally overlay — pairing flags to factories', () => {
  it('gives every selected factory its OWN flag, in selection order', () => {
    const world = makeWorld();
    const local = world.localPlayer;

    const a = addFactory(world, local, 40, 40);
    const b = addFactory(world, local, 80, 40);
    const c = addFactory(world, local, 80, 90);
    setRally(world, local, a, 44, 60);
    setRally(world, local, b, 96, 52);
    setRally(world, local, c, 70, 120);

    select(world, a, b, c);
    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(3);

    // The pairing is the whole feature: three flags on screen at once are only
    // useful if each one is unambiguously attached to the right structure.
    expect(link(out, 0)).toMatchObject({ fx: 40, fz: 40, rx: 44, rz: 60, tag: RALLY_EXPLORED });
    expect(link(out, 1)).toMatchObject({ fx: 80, fz: 40, rx: 96, rz: 52, tag: RALLY_EXPLORED });
    expect(link(out, 2)).toMatchObject({ fx: 80, fz: 90, rx: 70, rz: 120, tag: RALLY_EXPLORED });
  });

  it('keeps the pairing when the selection order changes', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40);
    const b = addFactory(world, local, 80, 40);
    setRally(world, local, a, 44, 60);
    setRally(world, local, b, 96, 52);

    const out = buf();
    select(world, b, a);
    expect(collectRallyLinks(world, out)).toBe(2);
    expect(link(out, 0)).toMatchObject({ fx: 80, rx: 96, rz: 52 });
    expect(link(out, 1)).toMatchObject({ fx: 40, rx: 44, rz: 60 });
  });

  it('ignores structures that do not produce, units, and other players', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const enemy = 1 as PlayerId;

    const mine = addFactory(world, local, 40, 40);
    const plain = addPlainBuilding(world, local, 50, 40);
    const tank = addVehicle(world, local, 60, 40);
    const theirs = addFactory(world, enemy, 200, 200);
    setRally(world, local, mine, 44, 60);
    // A rally on a non-factory and on an enemy factory must still draw nothing.
    setRally(world, local, plain, 55, 60);
    setRally(world, enemy, theirs, 210, 210);

    select(world, mine, plain, tank, theirs);
    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(1);
    expect(link(out, 0)).toMatchObject({ fx: 40, rx: 44, rz: 60 });
  });

  it('drops a factory that died while selected', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40);
    const b = addFactory(world, local, 80, 40);
    setRally(world, local, a, 44, 60);
    setRally(world, local, b, 96, 52);
    select(world, a, b);

    world.store.flags[world.store.index(a)] |= EntityFlag.PendingDestroy;
    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(1);
    expect(link(out, 0)).toMatchObject({ fx: 80, rx: 96 });
  });

  it('returns nothing with an empty selection or no local player state', () => {
    const world = makeWorld();
    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(0);

    const a = addFactory(world, world.localPlayer, 40, 40);
    setRally(world, world.localPlayer, a, 44, 60);
    select(world, a);
    world.localPlayer = 99 as PlayerId;
    expect(collectRallyLinks(world, out)).toBe(0);
  });
});

/* ========================================================================== */

describe('rally overlay — the no-rally-set case', () => {
  it('tags a factory with no rally point and parks its flag on the structure', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40, 3);
    select(world, a);

    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(1);
    const l = link(out, 0);
    // RALLY_NONE is the drawing pass's instruction to draw NO flag at all. The
    // truth it is telling: with no flag set, `ProductionService.tryEgress`
    // writes no order columns, so a fresh unit simply stands on its egress spot
    // beside the door. A flag anywhere else would promise a destination that
    // does not exist.
    expect(l.tag).toBe(RALLY_NONE);
    // The anchor is still there, because the preview tethers from it.
    expect(l).toMatchObject({ fx: 40, fy: 3, fz: 40, rx: 40, ry: 3, rz: 40 });
  });

  it('mixes set and unset factories in one selection without shifting the pairing', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40);
    const b = addFactory(world, local, 80, 40);
    const c = addFactory(world, local, 120, 40);
    setRally(world, local, a, 44, 60);
    setRally(world, local, c, 128, 60);
    select(world, a, b, c);

    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(3);
    expect(link(out, 0)).toMatchObject({ fx: 40, rx: 44, tag: RALLY_EXPLORED });
    expect(link(out, 1)).toMatchObject({ fx: 80, tag: RALLY_NONE });
    expect(link(out, 2)).toMatchObject({ fx: 120, rx: 128, tag: RALLY_EXPLORED });
  });

  it('treats half a rally record as no rally at all', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40);
    world.players[local as number].rallyX.set(a as number, 44);
    select(world, a);

    const out = buf();
    expect(collectRallyLinks(world, out)).toBe(1);
    expect(link(out, 0).tag).toBe(RALLY_NONE);
  });
});

/* ========================================================================== */

describe('rally overlay — fog of war', () => {
  it('does not sample terrain height under an unexplored flag', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    // A structure standing well above the flat null terrain, so a sampled
    // height (0) and an unsampled one (3.5) cannot be confused.
    const a = addFactory(world, local, 40, 40, 3.5);
    setRally(world, local, a, 90, 90);
    select(world, a);

    const out = buf();
    world.vision = BLIND;
    expect(collectRallyLinks(world, out)).toBe(1);
    const dark = link(out, 0);
    expect(dark.tag).toBe(RALLY_UNEXPLORED);
    // The elevation of ground the player has never seen is not ours to read
    // back: the flag stands at the STRUCTURE's height instead.
    expect(dark.ry).toBe(3.5);
    // The position itself is unchanged — it is the player's own click.
    expect(dark).toMatchObject({ rx: 90, rz: 90 });
  });

  it('samples terrain once the cell is explored', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40, 3.5);
    setRally(world, local, a, 90, 90);
    select(world, a);

    const out = buf();
    // The default vision object has everything explored.
    expect(collectRallyLinks(world, out)).toBe(1);
    expect(link(out, 0).tag).toBe(RALLY_EXPLORED);
    expect(link(out, 0).ry).toBe(world.terrain.heightAt(90, 90));
  });
});

/* ========================================================================== */

describe('rally overlay — allocation discipline', () => {
  it('writes into a caller-supplied buffer and returns a count, never an object', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const a = addFactory(world, local, 40, 40);
    setRally(world, local, a, 44, 60);
    select(world, a);

    const out = buf();
    const before = out.buffer;
    // Ten thousand frames' worth. The contract is that the same buffer comes
    // back with the same bytes and nothing new is minted along the way — the
    // whole reason the result is a flat Float32Array and not an array of links.
    for (let i = 0; i < 10_000; i++) {
      expect(typeof collectRallyLinks(world, out)).toBe('number');
    }
    expect(out.buffer).toBe(before);
    expect(link(out, 0)).toMatchObject({ fx: 40, rx: 44, rz: 60 });
  });

  it('never writes past the end of a short buffer', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const ids: EntityId[] = [];
    for (let i = 0; i < 5; i++) {
      const id = addFactory(world, local, 40 + i * 10, 40);
      setRally(world, local, id, 44 + i * 10, 60);
      ids.push(id);
    }
    select(world, ...ids);

    // Room for two links and one float of slack, which must stay untouched.
    const small = new Float32Array(RALLY_LINK_STRIDE * 2 + 1);
    small[small.length - 1] = -777;
    expect(collectRallyLinks(world, small)).toBe(2);
    expect(small[small.length - 1]).toBe(-777);
    expect(link(small, 1)).toMatchObject({ fx: 50, rx: 54 });
  });

  it('sizes the overlay pool for a full selection of factories', () => {
    // A pool that could overflow would silently drop flags off the end of a
    // large selection, which is the failure mode nobody notices.
    const world = makeWorld();
    const local = world.localPlayer;
    const ids: EntityId[] = [];
    for (let i = 0; i < MAX_SELECTION; i++) {
      const id = addFactory(world, local, 20 + (i % 40) * 2, 20 + Math.floor(i / 40) * 2);
      setRally(world, local, id, 60, 60);
      ids.push(id);
    }
    select(world, ...ids);
    expect(collectRallyLinks(world, buf())).toBe(MAX_SELECTION);
  });
});

/* ========================================================================== */

describe('rally overlay — when a click would move the flag', () => {
  it('arms on an all-structure selection containing a factory', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const f = addFactory(world, local, 40, 40);
    const plain = addPlainBuilding(world, local, 50, 40);
    select(world, f, plain);
    expect(rallyClickArmed(world)).toBe(true);
  });

  it('stands down the moment a mobile unit is in the selection', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    const f = addFactory(world, local, 40, 40);
    const tank = addVehicle(world, local, 60, 40);
    select(world, f, tank);
    // This mirrors `resolveContextOrder` case 4 in src/input/Commands.ts: with
    // a unit selected the right-click is a move order, and a ghost flag under
    // the cursor would be a lie about what the click is about to do.
    expect(rallyClickArmed(world)).toBe(false);
  });

  it('stays down for an empty selection, and for structures that build nothing', () => {
    const world = makeWorld();
    const local = world.localPlayer;
    expect(rallyClickArmed(world)).toBe(false);

    select(world, addPlainBuilding(world, local, 50, 40));
    expect(rallyClickArmed(world)).toBe(false);
  });

  it('ignores an enemy factory the player happens to have selected', () => {
    const world = makeWorld();
    const enemy = 1 as PlayerId;
    select(world, addFactory(world, enemy, 200, 200));
    expect(rallyClickArmed(world)).toBe(false);
  });
});
