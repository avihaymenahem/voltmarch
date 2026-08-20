/**
 * Input, selection and command tests.
 *
 * Node environment: nothing here touches WebGL, `document` or `window`, which
 * is why the four files under test are split the way they are — `Selection.ts`
 * and `Commands.ts` are pure logic over the EntityStore, and the only piece
 * that needs a DOM (`Input.ts`'s listeners and cursor canvases) is constructed
 * lazily and is not exercised here.
 *
 * The camera is faked: `ScreenProjector` exists precisely so selection can be
 * driven by a deterministic pinhole instead of a real CameraRig.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CELL, MAX_SELECTION } from '../src/core/config';
import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  CommandKind, EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind,
  Stance, UnitState,
} from '../src/core/types';
import type { Command, EntityId, ITerrain, PlayerId } from '../src/core/types';

import { CursorKind } from '../src/input/Input';
import { CaptureService, captureService, setCaptureService } from '../src/sim/Capture';
import {
  Selection, SelectMode, isEnemyOf, pickEntity, type ScreenProjector,
} from '../src/input/Selection';
import {
  CommandMode, FeedbackKind, HEURISTIC_ROLES, OrderExecutor, createCapabilities,
  feedbackFor, issueOrder, planScatter, readCapabilities, resolveContextOrder,
  setOrderExecutionEnabled, setRoleResolver,
  type OrderResolution,
} from '../src/input/Commands';

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A flat top-down pinhole: 10 client px per world metre, origin at screen
 * (500, 500), +X right and +Z down. Height is ignored, which makes every
 * expected pixel in this file trivially checkable by hand.
 */
const projector: ScreenProjector = {
  project(x: number, _y: number, z: number, out: Float32Array): boolean {
    out[0] = 500 + x * 10;
    out[1] = 500 + z * 10;
    return true;
  },
  viewport(out: Float32Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 1000;
    out[3] = 1000;
  },
};

interface Rig {
  world: World;
  channels: Channels;
  sel: Selection;
  me: PlayerId;
  foe: PlayerId;
}

function makeRig(): Rig {
  const world = new World();
  const channels = new Channels();
  const me = world.addPlayer(Faction.Allies, 'Me', true, true);
  const foe = world.addPlayer(Faction.Soviets, 'Foe', false, false);
  const sel = new Selection(world, channels);
  /*
   * A REAL `CaptureService`, because the CURSOR now asks it.
   *
   * `resolveContextOrder`'s two capture branches call
   * `CaptureService.isCapturable` — the only query that consults `addVeto`, and
   * the one that also refuses `UnderConstruction` and `PendingDestroy`. It
   * degrades to "not capturable" with no service installed, deliberately and on
   * the same argument the garrison branch makes about itself: a world with no
   * capture system genuinely cannot capture, and a cursor promising otherwise is
   * a lie the walk cannot deliver.
   *
   * So this rig has to hold one or it is asking the resolver about a game the
   * product does not ship. `tests/civilians.spec.ts` builds one for exactly the
   * same reason.
   */
  setCaptureService(new CaptureService(world, channels));
  return { world, channels, sel, me, foe };
}

afterEach(() => { setCaptureService(null); });

/** Spawn a tank-ish vehicle. */
function tank(rig: Rig, owner: PlayerId, x: number, z: number, defId = 1): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, defId, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | EntityFlag.HasTurret;
  s.radius[i] = 1.8;
  s.maxSpeed[i] = 8;
  s.locomotor[i] = Locomotor.Track;
  s.hp[i] = 100;
  s.maxHp[i] = 100;
  s.weaponIndex[i] = 0;
  rig.world.spatial.rebuild();
  return id;
}

/** Spawn an unarmed foot unit — the heuristic engineer. */
function engineer(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Infantry, 7, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove;
  s.radius[i] = 0.5;
  s.maxSpeed[i] = 4;
  s.locomotor[i] = Locomotor.Foot;
  s.hp[i] = 25;
  s.maxHp[i] = 25;
  rig.world.spatial.rebuild();
  return id;
}

/** Spawn a structure on a w x h footprint centred at (x,z). */
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
  rig.world.spatial.rebuild();
  return id;
}

/** Drain the bus into a plain array so a test can assert on it. */
function drainCommands(rig: Rig): Command[] {
  const out: Command[] = [];
  rig.channels.commands.drain((c) => {
    out.push({
      ...c,
      entities: Int32Array.from(c.entities.subarray(0, c.entityCount)),
    });
  });
  return out;
}

const caps = createCapabilities();
const res: OrderResolution = {
  order: OrderKind.None, target: NONE, x: 0, z: 0,
  cursor: 0, valid: false, isRally: false, garrisonRefusal: '',
};

function resolveAt(rig: Rig, hover: EntityId, x: number, z: number, mods = {
  shift: false, ctrl: false, alt: false,
}, mode = CommandMode.None): OrderResolution {
  readCapabilities(rig.world, rig.world.selection.ids, rig.world.selection.count, caps);
  return resolveContextOrder(rig.world, hover, x, z, true, mods, mode, caps, res);
}

beforeEach(() => {
  setRoleResolver(null);
  setOrderExecutionEnabled(true);
});

/* ==========================================================================
 * Picking
 * ========================================================================== */

describe('pickEntity', () => {
  it('picks the entity the cursor is standing on', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 100, 100);
    expect(pickEntity(rig.world, projector, 1500, 1500, 100, 100)).toBe(a);
  });

  it('prefers a unit over the structure it is parked on', () => {
    const rig = makeRig();
    building(rig, rig.me, 100, 100);
    const t = tank(rig, rig.me, 100, 100);
    rig.world.spatial.rebuild();
    expect(pickEntity(rig.world, projector, 1500, 1500, 100, 100)).toBe(t);
  });

  it('reaches a tall structure whose footprint is off to the side', () => {
    // Ground hit 5 m away from the origin of a 3x3 (6 m half-extent) pad: the
    // world containment test carries it.
    const rig = makeRig();
    const b = building(rig, rig.me, 100, 100);
    expect(pickEntity(rig.world, projector, 1550, 1500, 105, 100)).toBe(b);
  });

  it('returns NONE over empty ground', () => {
    const rig = makeRig();
    tank(rig, rig.me, 100, 100);
    expect(pickEntity(rig.world, projector, 2000, 2000, 150, 150)).toBe(NONE);
  });

  it('never picks a NotSelectable entity', () => {
    const rig = makeRig();
    const t = tank(rig, rig.me, 100, 100);
    rig.world.store.flags[rig.world.store.index(t)] |= EntityFlag.NotSelectable;
    expect(pickEntity(rig.world, projector, 1500, 1500, 100, 100)).toBe(NONE);
  });
});

/* ==========================================================================
 * Selection
 * ========================================================================== */

describe('Selection', () => {
  it('replaces, adds and toggles', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10);
    const b = tank(rig, rig.me, 20, 10);

    rig.sel.select(a, SelectMode.Replace);
    expect(rig.sel.count).toBe(1);
    rig.sel.select(b, SelectMode.Add);
    expect(rig.sel.count).toBe(2);
    rig.sel.select(b, SelectMode.Toggle);
    expect(rig.sel.count).toBe(1);
    expect(rig.sel.isSelected(a)).toBe(true);
    rig.sel.select(a, SelectMode.Replace);
    expect(rig.sel.count).toBe(1);
  });

  it('mirrors the EntityFlag.Selected bit and clears the old one', () => {
    const rig = makeRig();
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);
    const b = tank(rig, rig.me, 20, 10);

    rig.sel.select(a, SelectMode.Replace);
    expect(s.flags[s.index(a)] & EntityFlag.Selected).toBeTruthy();
    rig.sel.select(b, SelectMode.Replace);
    expect(s.flags[s.index(a)] & EntityFlag.Selected).toBeFalsy();
    expect(s.flags[s.index(b)] & EntityFlag.Selected).toBeTruthy();
  });

  it('emits selection:changed with the count and the primary', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10);
    let count = -1;
    let primary: EntityId = NONE;
    rig.channels.events.on('selection:changed', (p) => {
      count = p.count;
      primary = p.primary;
    });
    rig.sel.select(a, SelectMode.Replace);
    expect(count).toBe(1);
    expect(primary).toBe(a);
    rig.sel.clear();
    expect(count).toBe(0);
  });

  it('box select takes own mobile units and excludes structures', () => {
    const rig = makeRig();
    tank(rig, rig.me, 10, 10);
    tank(rig, rig.me, 12, 10);
    building(rig, rig.me, 14, 10);
    // Screen rect covering x in [5,20] m, z in [5,15] m.
    rig.sel.selectInRect(550, 550, 700, 650, projector, false);
    expect(rig.sel.count).toBe(2);
    expect(rig.sel.isBuildingSelection).toBe(false);
  });

  it('box select falls back to one structure when nothing of ours is mobile', () => {
    const rig = makeRig();
    const b = building(rig, rig.me, 14, 10);
    rig.sel.selectInRect(550, 550, 700, 650, projector, false);
    expect(rig.sel.count).toBe(1);
    expect(rig.sel.isSelected(b)).toBe(true);
    expect(rig.sel.isBuildingSelection).toBe(true);
  });

  it('box select excludes the enemy when we have units in the box', () => {
    const rig = makeRig();
    const mine = tank(rig, rig.me, 10, 10);
    tank(rig, rig.foe, 12, 10);
    rig.sel.selectInRect(550, 550, 700, 650, projector, false);
    expect(rig.sel.count).toBe(1);
    expect(rig.sel.isSelected(mine)).toBe(true);
  });

  it('double-click type-select takes only what is on screen', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10, 3);
    tank(rig, rig.me, 20, 10, 3);
    tank(rig, rig.me, 30, 10, 4);   // different def
    tank(rig, rig.me, 400, 10, 3);  // same def, off screen (x=400 -> 4500 px)
    rig.sel.selectSameTypeOnScreen(a, projector, false);
    expect(rig.sel.count).toBe(2);
  });

  it('caps at MAX_SELECTION', () => {
    const rig = makeRig();
    for (let i = 0; i < MAX_SELECTION + 20; i++) tank(rig, rig.me, i * 0.1, 0);
    rig.sel.selectAllArmy();
    expect(rig.sel.count).toBe(MAX_SELECTION);
  });

  it('prunes an entity that died out of the selection', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10);
    const b = tank(rig, rig.me, 20, 10);
    rig.sel.select(a, SelectMode.Replace);
    rig.sel.select(b, SelectMode.Add);
    rig.world.store.markDead(a);
    rig.world.store.flushDestroyed();
    expect(rig.sel.pruneDead()).toBe(true);
    expect(rig.sel.count).toBe(1);
    expect(rig.sel.isSelected(b)).toBe(true);
  });

  it('control groups recall, drop the dead, and report a centroid', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10);
    const b = tank(rig, rig.me, 30, 10);
    rig.sel.select(a, SelectMode.Replace);
    rig.sel.select(b, SelectMode.Add);
    rig.sel.setGroup(3);
    rig.sel.clear();

    expect(rig.sel.recallGroup(3, false)).toBe(true);
    expect(rig.sel.count).toBe(2);

    const c = new Float32Array(2);
    expect(rig.sel.groupCentroid(3, c)).toBe(true);
    expect(c[0]).toBeCloseTo(20, 6);

    rig.world.store.markDead(a);
    rig.world.store.flushDestroyed();
    rig.sel.clear();
    rig.sel.recallGroup(3, false);
    expect(rig.sel.count).toBe(1);
    expect(rig.world.selection.groupCounts[3]).toBe(1);
  });

  it('moves the Hovered flag and never leaves two set', () => {
    const rig = makeRig();
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);
    const b = tank(rig, rig.me, 20, 10);
    rig.sel.setHovered(a);
    rig.sel.setHovered(b);
    expect(s.flags[s.index(a)] & EntityFlag.Hovered).toBeFalsy();
    expect(s.flags[s.index(b)] & EntityFlag.Hovered).toBeTruthy();
  });

  it('adopts a selection the scenario wrote before we existed', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10);
    rig.world.selection.ids[0] = a as number;
    rig.world.selection.count = 1;
    const late = new Selection(rig.world, rig.channels);
    expect(late.isSelected(a)).toBe(true);
    expect(rig.world.store.flags[rig.world.store.index(a)] & EntityFlag.Selected).toBeTruthy();
  });
});

/* ==========================================================================
 * Order resolution
 * ========================================================================== */

describe('resolveContextOrder', () => {
  it('is Move over empty ground', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60);
    expect(r.order).toBe(OrderKind.Move);
    expect(r.valid).toBe(true);
    expect(r.x).toBe(60);
  });

  it('is Attack over an enemy', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const foe = tank(rig, rig.foe, 60, 60);
    const r = resolveAt(rig, foe, 60, 60);
    expect(r.order).toBe(OrderKind.Attack);
    expect(r.target).toBe(foe);
  });

  it('is ForceAttack with Ctrl, even on empty ground', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60, { shift: false, ctrl: true, alt: false });
    expect(r.order).toBe(OrderKind.ForceAttack);
    expect(r.valid).toBe(true);
  });

  it('is Move with Alt, even over an enemy', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const foe = tank(rig, rig.foe, 60, 60);
    const r = resolveAt(rig, foe, 60, 60, { shift: false, ctrl: false, alt: true });
    expect(r.order).toBe(OrderKind.Move);
    expect(r.target).toBe(NONE);
  });

  it('is Capture when an engineer points at an enemy structure', () => {
    const rig = makeRig();
    rig.sel.select(engineer(rig, rig.me, 10, 10), SelectMode.Replace);
    const b = building(rig, rig.foe, 60, 60);
    const r = resolveAt(rig, b, 60, 60);
    expect(r.order).toBe(OrderKind.Capture);
    expect(r.target).toBe(b);
  });

  it('offers Attack, not Capture, when a VETO forbids taking that structure', () => {
    /*
     * `CaptureService.isCapturable` is the only query that consults `addVeto`,
     * and until the cursor called it the hook was invisible to the player.
     * `Garrison.ts` installs one in the shipped game — an occupied strongpoint
     * must be emptied before it changes hands — so this was already live: the
     * glyph said Capture, the engineer walked the whole way, and `resolve`
     * refused it on arrival with nothing said in between.
     */
    const rig = makeRig();
    rig.sel.select(engineer(rig, rig.me, 10, 10), SelectMode.Replace);
    const b = building(rig, rig.foe, 60, 60);

    // The falsifier first: without the veto this same click IS a capture, so a
    // pass below cannot be the branch simply never firing.
    expect(resolveAt(rig, b, 60, 60).order).toBe(OrderKind.Capture);

    const off = captureService()!.addVeto((t) => t === b);
    try {
      const r = resolveAt(rig, b, 60, 60);
      expect(r.order, 'a vetoed structure is not a capture').not.toBe(OrderKind.Capture);
      expect(r.cursor).not.toBe(CursorKind.Capture);
      // An ENGINEER-ONLY selection cannot shoot, so the honest fall-through is
      // Move rather than Attack — `caps.canAttack` is false and the attack
      // branch is skipped. Put a gun in the selection and it IS an attack,
      // which is the pair that says the fall-through is reaching the right rule
      // rather than merely leaving the capture branch.
      expect(r.order).toBe(OrderKind.Move);
      rig.sel.select(tank(rig, rig.me, 12, 12), SelectMode.Add);
      expect(resolveAt(rig, b, 60, 60).order, 'with a gun in the group').toBe(OrderKind.Attack);
    } finally { off(); }
  });

  it('offers Attack, not Capture, on a structure still UnderConstruction', () => {
    // The other half `isCapturable` knows and the cursor did not. `resolve`
    // refuses an unfinished building outright, so the walk was always wasted.
    const rig = makeRig();
    rig.sel.select(engineer(rig, rig.me, 10, 10), SelectMode.Replace);
    const b = building(rig, rig.foe, 60, 60);
    expect(resolveAt(rig, b, 60, 60).order, 'the falsifier').toBe(OrderKind.Capture);
    rig.world.store.flags[rig.world.store.index(b)] |= EntityFlag.UnderConstruction;
    expect(resolveAt(rig, b, 60, 60).order).not.toBe(OrderKind.Capture);
  });

  it('is Repair when an engineer points at a damaged friendly structure', () => {
    const rig = makeRig();
    rig.sel.select(engineer(rig, rig.me, 10, 10), SelectMode.Replace);
    const b = building(rig, rig.me, 60, 60);
    rig.world.store.hp[rig.world.store.index(b)] = 100;
    const r = resolveAt(rig, b, 60, 60);
    expect(r.order).toBe(OrderKind.Repair);
  });

  it('does not offer Repair on a structure at full health', () => {
    const rig = makeRig();
    rig.sel.select(engineer(rig, rig.me, 10, 10), SelectMode.Replace);
    const b = building(rig, rig.me, 60, 60);
    const r = resolveAt(rig, b, 60, 60);
    expect(r.order).toBe(OrderKind.Move);
  });

  it('is SetRally when only structures are selected', () => {
    const rig = makeRig();
    rig.sel.select(building(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60);
    expect(r.order).toBe(OrderKind.SetRally);
    expect(r.isRally).toBe(true);
  });

  it('is AttackMove in the armed A mode', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60, { shift: false, ctrl: false, alt: false },
      CommandMode.AttackMove);
    expect(r.order).toBe(OrderKind.AttackMove);
  });

  it('is a plain Move in the HUD move mode, even over an enemy', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const foe = tank(rig, rig.foe, 60, 60);
    const r = resolveAt(rig, foe, 60, 60, { shift: false, ctrl: false, alt: false },
      CommandMode.Move);
    expect(r.order).toBe(OrderKind.Move);
    expect(r.target).toBe(NONE);
    expect(r.cursor).toBe(CursorKind.Move);
  });

  it('does nothing with an empty selection', () => {
    const rig = makeRig();
    const r = resolveAt(rig, NONE, 60, 60);
    expect(r.valid).toBe(false);
    expect(r.order).toBe(OrderKind.None);
  });

  it('maps orders to the right feedback colour family', () => {
    expect(feedbackFor(OrderKind.Move)).toBe(FeedbackKind.Move);
    expect(feedbackFor(OrderKind.Attack)).toBe(FeedbackKind.Attack);
    expect(feedbackFor(OrderKind.AttackMove)).toBe(FeedbackKind.Attack);
    expect(feedbackFor(OrderKind.Harvest)).toBe(FeedbackKind.Special);
  });
});

describe('roles', () => {
  it('reads an unarmed foot unit as an engineer and an armed one as not', () => {
    const rig = makeRig();
    const s = rig.world.store;
    const eng = engineer(rig, rig.me, 10, 10);
    const rifle = engineer(rig, rig.me, 12, 10);
    s.flags[s.index(rifle)] |= EntityFlag.CanAttack;
    expect(HEURISTIC_ROLES.canCapture(rig.world, s.index(eng))).toBe(true);
    expect(HEURISTIC_ROLES.canCapture(rig.world, s.index(rifle))).toBe(false);
  });

  it('reports relations from the ally mask', () => {
    const rig = makeRig();
    const s = rig.world.store;
    const foe = tank(rig, rig.foe, 10, 10);
    expect(isEnemyOf(rig.world, rig.me, s.index(foe))).toBe(true);
  });
});

/* ==========================================================================
 * The funnel and the executor
 * ========================================================================== */

describe('issueOrder', () => {
  it('puts one Order command on the bus and announces it', () => {
    const rig = makeRig();
    const a = tank(rig, rig.me, 10, 10);
    let announced = 0;
    rig.channels.events.on('order:issued', () => { announced++; });

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 60, 70);

    const cmds = drainCommands(rig);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].kind).toBe(CommandKind.Order);
    expect(cmds[0].order).toBe(OrderKind.Move);
    expect(cmds[0].x).toBe(60);
    expect(cmds[0].z).toBe(70);
    expect(announced).toBe(1);
  });

  it('refuses an empty set', () => {
    const rig = makeRig();
    expect(issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(), 0, 0, 0)).toBe(false);
  });
});

describe('OrderExecutor', () => {
  it('writes a move order onto the entity', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 60, 70);
    ex.tick();

    const i = s.index(a);
    expect(s.orderKind[i]).toBe(OrderKind.Move);
    expect(s.orderX[i]).toBe(60);
    expect(s.orderZ[i]).toBe(70);
    expect(s.state[i]).toBe(UnitState.Moving);
  });

  it('ignores a command aimed at someone else’s unit', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const theirs = tank(rig, rig.foe, 10, 10);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(theirs as number), 1, 60, 70);
    ex.tick();

    expect(s.orderKind[s.index(theirs)]).toBe(OrderKind.None);
  });

  it('parks a unit exactly where it stands on Stop', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);
    const i = s.index(a);
    s.state[i] = UnitState.Moving;
    s.orderX[i] = 99;

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Stop,
      Int32Array.of(a as number), 1, 0, 0);
    ex.tick();

    expect(s.state[i]).toBe(UnitState.Idle);
    expect(s.orderKind[i]).toBe(OrderKind.None);
    expect(s.orderX[i]).toBe(10);
  });

  it('sets the guard point on Guard', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Guard,
      Int32Array.of(a as number), 1, 10, 10);
    ex.tick();

    const i = s.index(a);
    expect(s.state[i]).toBe(UnitState.Guarding);
    expect(s.guardX[i]).toBe(10);
    expect(s.guardZ[i]).toBe(10);
  });

  it('queues a shift order as a waypoint and pops it on arrival', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);
    const i = s.index(a);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 60, 10);
    ex.tick();
    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 90, 10, NONE, true);
    ex.tick();

    // Still heading for the first point, with one waypoint held.
    expect(s.orderX[i]).toBe(60);
    expect(ex.waypointCount(i)).toBe(1);

    // Arrive: the next tick promotes the waypoint.
    s.posX[i] = 60;
    s.posZ[i] = 10;
    ex.tick();
    expect(s.orderX[i]).toBe(90);
    expect(ex.waypointCount(i)).toBe(0);
  });

  it('an unqueued order wipes the waypoint list', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);
    const i = s.index(a);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 60, 10);
    ex.tick();
    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 90, 10, NONE, true);
    ex.tick();
    expect(ex.waypointCount(i)).toBe(1);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 20, 20);
    ex.tick();
    expect(ex.waypointCount(i)).toBe(0);
    expect(s.orderX[i]).toBe(20);
  });

  it('hands a production command back to the bus instead of eating it', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    rig.channels.commands.issueProductionStart(rig.me, 0, 4, 2);
    ex.tick();

    const cmds = drainCommands(rig);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].kind).toBe(CommandKind.ProductionStart);
    expect(cmds[0].defId).toBe(4);
    expect(cmds[0].arg).toBe(2);
  });

  it('preserves a SetStance entity list through the hand-back', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const a = tank(rig, rig.me, 10, 10);
    const b = tank(rig, rig.me, 20, 10);
    rig.channels.commands.issueSetStance(
      rig.me, Int32Array.of(a as number, b as number), 2, Stance.HoldGround,
    );
    ex.tick();

    const cmds = drainCommands(rig);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].kind).toBe(CommandKind.SetStance);
    expect(cmds[0].stance).toBe(Stance.HoldGround);
    expect(Array.from(cmds[0].entities)).toEqual([a as number, b as number]);
  });

  it('applies a rally point to the owning player', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const f = building(rig, rig.me, 40, 40);
    rig.channels.commands.issueSetRally(rig.me, f, 88, 99);
    ex.tick();
    expect(rig.world.player(rig.me).rallyX.get(f as number)).toBe(88);
    expect(rig.world.player(rig.me).rallyZ.get(f as number)).toBe(99);
  });

  it('stands down entirely once execution is disabled', () => {
    const rig = makeRig();
    const ex = new OrderExecutor(rig.world, rig.channels);
    const s = rig.world.store;
    const a = tank(rig, rig.me, 10, 10);
    setOrderExecutionEnabled(false);

    issueOrder(rig.world, rig.channels, rig.me, OrderKind.Move,
      Int32Array.of(a as number), 1, 60, 70);
    ex.tick();

    expect(s.orderKind[s.index(a)]).toBe(OrderKind.None);
    // The command is still on the bus for whoever took over.
    expect(rig.channels.commands.pending).toBe(1);
  });
});

describe('planScatter', () => {
  it('is deterministic and sends every unit somewhere different', () => {
    const rig = makeRig();
    const ids = Int32Array.of(
      tank(rig, rig.me, 100, 100) as number,
      tank(rig, rig.me, 101, 100) as number,
      tank(rig, rig.me, 102, 100) as number,
    );
    const first = Float32Array.from(planScatter(rig.world, ids, 3).subarray(0, 6));
    const second = Float32Array.from(planScatter(rig.world, ids, 3).subarray(0, 6));
    expect(Array.from(first)).toEqual(Array.from(second));

    for (let i = 0; i < 3; i++) {
      const dx = first[i * 2] - rig.world.store.posX[rig.world.store.index(ids[i] as EntityId)];
      const dz = first[i * 2 + 1] - rig.world.store.posZ[rig.world.store.index(ids[i] as EntityId)];
      const d = Math.hypot(dx, dz);
      expect(d).toBeGreaterThan(2.9);
      expect(d).toBeLessThan(7.1);
    }
    // Three different escape directions, not one shared angle.
    expect(first[0]).not.toBeCloseTo(first[2], 3);
  });
});

/* ==========================================================================
 * The move cursor, against terrain the selection cannot cross
 *
 * `passableForSelection` was named for the selection and ignored it: it asked
 * whether Track, Foot or Hover could stand on the cell, full stop. That was a
 * complete answer for as long as those were the only ways to travel.
 * `Locomotor.Air` ended it — aircraft ignore the grid, so a flight of gunships
 * got the "no move" cursor over every cliff and every stretch of open water,
 * which is exactly where you send them.
 *
 * The order always issued, so nothing was unreachable. But the cursor is how a
 * player learns what a unit can do, and this one was teaching the opposite.
 * ========================================================================== */

/** A terrain nothing on the ground can cross: a cliff face, or open water. */
function refuseGround(world: World): void {
  const base = world.terrain;
  const stub: ITerrain = {
    heightAt: (x, z) => base.heightAt(x, z),
    normalAt: (x, z, out) => base.normalAt(x, z, out),
    slopeAt: (x, z) => base.slopeAt(x, z),
    isPassable: () => false,
    isBuildable: (cx, cz) => base.isBuildable(cx, cz),
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

/** Spawn an aircraft — `Locomotor.Air`, the class that ignores the grid. */
function gunship(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, 9, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack;
  s.radius[i] = 1.6;
  s.maxSpeed[i] = 12;
  s.locomotor[i] = Locomotor.Air;
  s.hp[i] = 210;
  s.maxHp[i] = 210;
  rig.world.spatial.rebuild();
  return id;
}

describe('move cursor over impassable ground', () => {
  it('still warns a ground selection off it', () => {
    // The control. If this ever goes green-by-default the rest of this block
    // proves nothing, because `refuseGround` would not be refusing anything.
    const rig = makeRig();
    refuseGround(rig.world);
    rig.sel.select(tank(rig, rig.me, 100, 100), SelectMode.Replace);
    expect(resolveAt(rig, NONE, 200, 200).cursor).toBe(CursorKind.NoMove);
  });

  it('does not warn a selection that is entirely aircraft', () => {
    const rig = makeRig();
    refuseGround(rig.world);
    rig.sel.select(gunship(rig, rig.me, 100, 100), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 200, 200);
    expect(r.cursor).toBe(CursorKind.Move);
    // The order was always issued; it is the cursor that used to disagree.
    expect(r.order).toBe(OrderKind.Move);
    expect(r.valid).toBe(true);
  });

  it('warns again as soon as one grounded unit joins the flight', () => {
    // The escort rule. A gunship leading four tanks is not an air selection —
    // four fifths of it cannot follow, and that is the case worth warning about.
    const rig = makeRig();
    refuseGround(rig.world);
    rig.sel.select(gunship(rig, rig.me, 100, 100), SelectMode.Replace);
    rig.sel.select(tank(rig, rig.me, 102, 100), SelectMode.Add);
    expect(resolveAt(rig, NONE, 200, 200).cursor).toBe(CursorKind.NoMove);
  });

  it('does not let a selection with nothing mobile in it read as a flight', () => {
    // `mobileCount > 0` guards the shortcut, and this is the case it guards
    // against: with nothing mobile selected, airCount === mobileCount === 0, and
    // a bare equality check would read 0 === 0 as "everything here flies" and
    // suppress the warning for a selection that cannot move at all.
    //
    // IsFactory is cleared deliberately. A factory turns a ground right-click
    // into a rally-point placement (CursorKind.Rally) and returns long before
    // the plain-ground branch, so it cannot reach the code under test.
    const rig = makeRig();
    refuseGround(rig.world);
    const b = building(rig, rig.me, 100, 100);
    const s = rig.world.store;
    s.flags[s.index(b)] &= ~EntityFlag.IsFactory;
    rig.sel.select(b, SelectMode.Replace);
    expect(resolveAt(rig, NONE, 200, 200).cursor).toBe(CursorKind.NoMove);
  });

  it('reports airCount separately from mobileCount', () => {
    const rig = makeRig();
    rig.sel.select(gunship(rig, rig.me, 100, 100), SelectMode.Replace);
    rig.sel.select(tank(rig, rig.me, 104, 100), SelectMode.Add);
    const c = createCapabilities();
    readCapabilities(rig.world, rig.world.selection.ids, rig.world.selection.count, c);
    expect(c.mobileCount).toBe(2);
    expect(c.airCount).toBe(1);
  });
});
