/**
 * INPUT MUST RESPECT VISION.
 *
 * The reported bug: "sometimes im not seeing the enemies, something comes on to
 * my base, i can shoot it, but cant see it, only attack marker when i hover
 * around his area" — the input layer hit-tested raw entity positions and never
 * asked the fog of war a single question, so a shrouded enemy was fully
 * hoverable, selectable and right-clickable while the renderer drew nothing.
 *
 * Everything here runs headless against the REAL `Vision` grid — no render
 * mask, no borrowed flags, no `EntityFlag.Cloaked`. That is deliberate: the
 * render mask is only applied for the width of a render frame, and a DOM click
 * arrives outside it. A gate that depends on the mask is a gate that is open
 * exactly when the player clicks.
 *
 * The camera is the same flat pinhole `tests/input.spec.ts` uses: 10 client px
 * per world metre, origin at screen (500, 500).
 */

import { describe, expect, it } from 'vitest';

import { CELL } from '../src/core/config';
import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  CursorKind,
} from '../src/input/Input';
import {
  EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind,
} from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { Vision, VISION_REGROW_TICKS } from '../src/sim/Vision';
import {
  Selection, SelectMode, canInteractWith, pickEntity, type ScreenProjector,
} from '../src/input/Selection';
import {
  CommandMode, createCapabilities, readCapabilities, resolveContextOrder,
  type Modifiers, type OrderResolution,
} from '../src/input/Commands';

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

const projector: ScreenProjector = {
  project(x: number, _y: number, z: number, out: Float32Array): boolean {
    out[0] = 500 + x * 10;
    out[1] = 500 + z * 10;
    return true;
  },
  viewport(out: Float32Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 4000;
    out[3] = 4000;
  },
};

interface Rig {
  world: World;
  channels: Channels;
  sel: Selection;
  vision: Vision;
  me: PlayerId;
  ally: PlayerId;
  foe: PlayerId;
}

/**
 * Three players — me, my ally, and an enemy — with a live fog grid installed on
 * the port. `World` ships `OpenVision` by default, which answers "yes" to every
 * question; a test that leaves it in place is testing nothing.
 */
function makeRig(): Rig {
  const world = new World();
  const channels = new Channels();
  const me = world.addPlayer(Faction.Allies, 'Me', true, true);
  const ally = world.addPlayer(Faction.Allies, 'Ally', false, false);
  const foe = world.addPlayer(Faction.Soviets, 'Foe', false, false);
  // `allyMask` is the storage; `World.areAllied` reads it and nothing else
  // writes it outside scenario setup.
  world.player(me).allyMask |= 1 << (ally as number);
  world.player(ally).allyMask |= 1 << (me as number);
  const vision = new Vision(world, true);
  world.vision = vision;
  const sel = new Selection(world, channels);
  return { world, channels, sel, vision, me, ally, foe };
}

function tank(rig: Rig, owner: PlayerId, x: number, z: number, sight = 0): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, 1, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | EntityFlag.HasTurret;
  s.radius[i] = 1.8;
  s.maxSpeed[i] = 8;
  s.locomotor[i] = Locomotor.Track;
  s.hp[i] = 100;
  s.maxHp[i] = 100;
  s.sight[i] = sight;
  rig.world.spatial.rebuild();
  return id;
}

function building(rig: Rig, owner: PlayerId, x: number, z: number, w = 3, h = 3): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Building, 20, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.footprintW[i] = w;
  s.footprintH[i] = h;
  s.radius[i] = Math.max(w, h) * CELL * 0.5;
  s.flags[i] |= EntityFlag.IsFactory | EntityFlag.BlocksNav;
  s.hp[i] = 500;
  s.maxHp[i] = 500;
  s.sight[i] = 0;
  rig.world.spatial.rebuild();
  return id;
}

/** Screen pixel for a world point, per the pinhole above. */
function px(x: number): number {
  return 500 + x * 10;
}

/** World metres -> cell index, the same truncation `worldToCell` performs. */
function cell(x: number): number {
  return Math.floor(x / CELL);
}

const caps = createCapabilities();
const res: OrderResolution = {
  order: OrderKind.None, target: NONE, x: 0, z: 0,
  cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '',
};
const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };

function resolveAt(
  rig: Rig, hover: EntityId, x: number, z: number,
  mods: Modifiers = NO_MODS, mode = CommandMode.None,
): OrderResolution {
  readCapabilities(rig.world, rig.world.selection.ids, rig.world.selection.count, caps);
  return resolveContextOrder(rig.world, hover, x, z, true, mods, mode, caps, res);
}

/**
 * Light the cells around a point for one player and then let the light die,
 * leaving the ground EXPLORED but not VISIBLE — the remembered state.
 */
function scoutAndForget(rig: Rig, owner: PlayerId, x: number, z: number): void {
  const s = rig.world.store;
  const scout = s.alloc(EntityKind.Infantry, 3, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(scout);
  s.sight[i] = 20;
  s.flags[i] |= EntityFlag.ProvidesVision;
  rig.vision.update();
  s.markDead(scout);
  s.flushDestroyed();
  for (let n = 0; n <= VISION_REGROW_TICKS; n++) rig.vision.update();
  rig.world.spatial.rebuild();
}

/* ==========================================================================
 * 1. THE REPRODUCTION — a fogged enemy is not a target
 * ========================================================================== */

describe('a shrouded enemy is invisible to input', () => {
  it('is not picked by a hit-test, even standing on the cursor', () => {
    const rig = makeRig();
    tank(rig, rig.me, 40, 40, 12);
    const ghost = tank(rig, rig.foe, 300, 300);
    rig.vision.update();

    // The grid agrees it cannot be seen...
    expect(rig.vision.canSee(rig.me, ghost)).toBe(false);
    // ...and so does the cursor. This is the bug verbatim: it used to return
    // `ghost` and the attack cursor came up over blank shroud.
    expect(pickEntity(rig.world, projector, px(300), px(300), 300, 300)).toBe(NONE);
  });

  it('cannot be selected by a direct click', () => {
    const rig = makeRig();
    tank(rig, rig.me, 40, 40, 12);
    const ghost = tank(rig, rig.foe, 300, 300);
    rig.vision.update();

    expect(rig.sel.select(ghost, SelectMode.Replace)).toBe(false);
    expect(rig.sel.count).toBe(0);
  });

  it('right-clicking it resolves to a MOVE, not an attack', () => {
    const rig = makeRig();
    const mine = tank(rig, rig.me, 40, 40, 12);
    const ghost = tank(rig, rig.foe, 300, 300);
    rig.vision.update();
    rig.sel.select(mine, SelectMode.Replace);

    // Even handed the entity directly — the resolver does not trust its caller.
    const r = resolveAt(rig, ghost, 300, 300);
    expect(r.order).toBe(OrderKind.Move);
    expect(r.target).toBe(NONE);
    expect(r.cursor).toBe(CursorKind.Move);
    // The order goes to the GROUND POINT the player clicked, not to the unit's
    // position, which would leak where it is standing.
    expect(r.x).toBe(300);
    expect(r.z).toBe(300);
  });

  it('is excluded from a marquee that covers it', () => {
    const rig = makeRig();
    tank(rig, rig.me, 40, 40, 12);
    tank(rig, rig.foe, 300, 300);
    rig.vision.update();

    // A box over the shrouded corner selects nothing at all.
    rig.sel.selectInRect(px(280), px(280), px(320), px(320), projector, false);
    expect(rig.sel.count).toBe(0);
  });

  it('leaves the selection the moment it walks into the shroud', () => {
    const rig = makeRig();
    const s = rig.world.store;
    const scout = tank(rig, rig.me, 300, 300, 20);
    const foe = tank(rig, rig.foe, 306, 300);
    rig.vision.update();

    expect(rig.sel.select(foe, SelectMode.Replace)).toBe(true);
    expect(rig.sel.count).toBe(1);

    // The scout dies; the light ages out; the enemy is now a memory.
    s.markDead(scout);
    s.flushDestroyed();
    for (let n = 0; n <= VISION_REGROW_TICKS; n++) rig.vision.update();

    expect(rig.sel.pruneDead()).toBe(true);
    expect(rig.sel.count).toBe(0);
  });
});

/* ==========================================================================
 * 2. REMEMBERED STRUCTURES — the documented exception
 * ========================================================================== */

describe('an explored-but-unlit enemy STRUCTURE stays clickable', () => {
  it('is picked, selected and attacked, because it is still on screen', () => {
    const rig = makeRig();
    const mine = tank(rig, rig.me, 40, 40, 12);
    const hq = building(rig, rig.foe, 300, 300);
    scoutAndForget(rig, rig.me, 300, 300);

    // Remembered, not visible: exactly the state `applyRenderMask` still draws.
    expect(rig.vision.canSee(rig.me, hq)).toBe(false);
    expect(rig.vision.isRemembered(rig.me, hq)).toBe(true);
    expect(rig.vision.isExplored(rig.me, cell(300), cell(300))).toBe(true);
    expect(rig.vision.isVisibleAt(rig.me, cell(300), cell(300))).toBe(false);

    expect(pickEntity(rig.world, projector, px(300), px(300), 300, 300)).toBe(hq);
    expect(rig.sel.select(hq, SelectMode.Replace)).toBe(true);

    rig.sel.select(mine, SelectMode.Replace);
    const r = resolveAt(rig, hq, 300, 300);
    expect(r.order).toBe(OrderKind.Attack);
    expect(r.target).toBe(hq);
    expect(r.cursor).toBe(CursorKind.Attack);
  });

  it('does NOT extend to a mobile enemy standing on the same explored ground', () => {
    const rig = makeRig();
    tank(rig, rig.me, 40, 40, 12);
    building(rig, rig.foe, 300, 300);
    const guard = tank(rig, rig.foe, 316, 300);
    scoutAndForget(rig, rig.me, 300, 300);

    expect(rig.vision.isExplored(rig.me, cell(316), cell(300))).toBe(true);
    // A tank you saw two minutes ago is not there any more.
    expect(canInteractWith(rig.world, rig.me, rig.world.store.index(guard))).toBe(false);
    expect(pickEntity(rig.world, projector, px(316), px(300), 316, 300)).toBe(NONE);
  });

  it('goes dark again on ground that was never explored', () => {
    const rig = makeRig();
    tank(rig, rig.me, 40, 40, 12);
    const hq = building(rig, rig.foe, 300, 300);
    rig.vision.update();

    expect(rig.vision.isRemembered(rig.me, hq)).toBe(false);
    expect(pickEntity(rig.world, projector, px(300), px(300), 300, 300)).toBe(NONE);
  });
});

/* ==========================================================================
 * 3. THE EXCEPTIONS THAT MUST KEEP WORKING
 * ========================================================================== */

describe('what vision must NOT break', () => {
  it('force-fire still targets ground inside the shroud', () => {
    const rig = makeRig();
    const mine = tank(rig, rig.me, 40, 40, 12);
    const ghost = tank(rig, rig.foe, 300, 300);
    rig.vision.update();
    rig.sel.select(mine, SelectMode.Replace);

    // Ctrl held: the shot is aimed at the POINT, so the shroud is irrelevant.
    const ctrl = resolveAt(rig, ghost, 300, 300, { shift: false, ctrl: true, alt: false });
    expect(ctrl.order).toBe(OrderKind.ForceAttack);
    expect(ctrl.valid).toBe(true);
    expect(ctrl.cursor).toBe(CursorKind.ForceAttack);
    // No target handle: you are shelling a map coordinate, not a unit you can
    // see. Leaking the handle here would let the projectile track it.
    expect(ctrl.target).toBe(NONE);
    expect(ctrl.x).toBe(300);
    expect(ctrl.z).toBe(300);

    // And the armed F mode behaves identically.
    const armed = resolveAt(rig, ghost, 300, 300, NO_MODS, CommandMode.ForceAttack);
    expect(armed.order).toBe(OrderKind.ForceAttack);
    expect(armed.valid).toBe(true);
    expect(armed.target).toBe(NONE);
  });

  it('attack-move into unexplored ground is still an attack-move', () => {
    const rig = makeRig();
    const mine = tank(rig, rig.me, 40, 40, 12);
    rig.vision.update();
    rig.sel.select(mine, SelectMode.Replace);

    const r = resolveAt(rig, NONE, 300, 300, NO_MODS, CommandMode.AttackMove);
    expect(r.order).toBe(OrderKind.AttackMove);
    expect(r.valid).toBe(true);
    expect(r.x).toBe(300);
  });

  it('own and allied units are always visible, wherever they stand', () => {
    const rig = makeRig();
    const s = rig.world.store;
    // Nothing of mine is anywhere near (300,300) and the cell is pitch black.
    tank(rig, rig.me, 40, 40, 12);
    const far = tank(rig, rig.me, 300, 300);
    const friend = tank(rig, rig.ally, 306, 300);
    rig.vision.update();

    expect(rig.vision.isVisibleAt(rig.me, cell(300), cell(300))).toBe(true);
    expect(canInteractWith(rig.world, rig.me, s.index(far))).toBe(true);
    expect(canInteractWith(rig.world, rig.me, s.index(friend))).toBe(true);
    expect(pickEntity(rig.world, projector, px(300), px(300), 300, 300)).toBe(far);
    expect(rig.sel.select(friend, SelectMode.Replace)).toBe(true);
  });

  it('a friendly CLOAKED unit is still selectable by its owner', () => {
    const rig = makeRig();
    const sub = tank(rig, rig.me, 40, 40, 12);
    rig.vision.setCloaked(sub, true);
    rig.vision.tickCloak();
    rig.vision.update();

    // The sim has it flagged and the renderer force-unhides it for us; input
    // must agree with the renderer, not with the flag.
    expect(rig.world.store.flags[rig.world.store.index(sub)] & EntityFlag.Cloaked)
      .toBeTruthy();
    expect(rig.sel.select(sub, SelectMode.Replace)).toBe(true);
    expect(pickEntity(rig.world, projector, px(40), px(40), 40, 40)).toBe(sub);
  });

  it('an undetected enemy cloaked unit standing in full daylight is not a target', () => {
    const rig = makeRig();
    tank(rig, rig.me, 300, 300, 30);
    const sub = tank(rig, rig.foe, 306, 300);
    rig.vision.setCloaked(sub, true);
    rig.vision.tickCloak();
    rig.vision.update();

    expect(rig.vision.isVisibleAt(rig.me, cell(306), cell(300))).toBe(true);
    expect(rig.vision.canSee(rig.me, sub)).toBe(false);
    expect(pickEntity(rig.world, projector, px(306), px(300), 306, 300)).toBe(NONE);
  });

  it('...and becomes one the moment a detector covers it', () => {
    const rig = makeRig();
    const eye = tank(rig, rig.me, 300, 300, 30);
    const sub = tank(rig, rig.foe, 306, 300);
    rig.vision.setCloaked(sub, true);
    rig.vision.setDetector(eye, 40);
    rig.vision.tickCloak();
    rig.vision.update();

    expect(rig.vision.canSee(rig.me, sub)).toBe(true);
    expect(pickEntity(rig.world, projector, px(306), px(300), 306, 300)).toBe(sub);
  });

  it('fog switched off restores every pre-fog behaviour', () => {
    const rig = makeRig();
    const mine = tank(rig, rig.me, 40, 40, 12);
    const foe = tank(rig, rig.foe, 300, 300);
    rig.vision.setEnabled(false);
    rig.sel.select(mine, SelectMode.Replace);

    expect(pickEntity(rig.world, projector, px(300), px(300), 300, 300)).toBe(foe);
    const r = resolveAt(rig, foe, 300, 300);
    expect(r.order).toBe(OrderKind.Attack);
    expect(r.target).toBe(foe);
  });
});
