/**
 * THE ORDERS THAT NEVER HAPPENED.
 *
 * Three player reports, one shape: "sometimes when i pick multiple troops and
 * clicking a point, they do nothing, like i didnt gave them a command", "the
 * click and commands works on first click then it stops after 3-4 of them", and
 * "clicking on planes and then guiding them to attack or move, doesnt work".
 *
 * WHAT WAS MEASURED, AND WHAT WAS NOT
 * -----------------------------------
 * `tools/order-probe.mjs` drives real playwright mouse events at a real build.
 * Across 36 right-clicks in three timing regimes — sim stepped 20 ticks between
 * clicks, stepped 2, and live at wall clock — every click that landed on the
 * canvas emitted `order:issued` and moved the order point of every selected
 * unit. `CommandBus.droppedCommands` stayed 0 and `pending` never exceeded 2.
 * The bus is NOT what stops. That negative is why nothing in this file is about
 * ring capacity.
 *
 * What the probe did find is here:
 *
 *   1. AN AIRCRAFT COULD NOT BE CLICKED. `pickEntity` builds its candidate set
 *      from a circle on the GROUND PLANE around the terrain hit, and a flyer's
 *      pixels are 23-25 m from that point at the shipped camera pitch — against
 *      a query radius of 11.6 m. Measured on three Vindicators: 25.2, 23.5 and
 *      22.9 m. A left-click on the hull selected nothing, or the Power Plant
 *      that happened to sit under the far-away ground point, and selecting
 *      nothing REPLACES the selection with nothing.
 *
 *   2. AND THEN THE NEXT RIGHT-CLICK VANISHED. With no orderable unit,
 *      `executeResolved` returned without issuing anything and without saying
 *      anything. That silence is the reported symptom verbatim, and it is
 *      reachable from several directions, of which (1) is only the one a plane
 *      takes.
 *
 *   3. A HARVESTER IN THE SELECTION TURNED THE WHOLE GROUP INTO PROSPECTORS. A
 *      click on ore resolves to `OrderKind.Harvest` if ANY selected unit mines,
 *      and the command carries the group — so escorts entered `UnitState.SeekOre`,
 *      which `sim/Harvesting.ts` skips outright and nothing else ever leaves.
 */

import { describe, expect, it } from 'vitest';

import { AIR_CRUISE_ALTITUDE, CELL, PICK_SCREEN_RADIUS_PX } from '../src/core/config';
import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { CursorKind } from '../src/input/Input';
import {
  Selection, SelectMode, pickEntity, type ScreenProjector,
} from '../src/input/Selection';
import {
  CommandMode, DeadClick, OrderExecutor, createCapabilities, deadClickReason,
  deadClickText, readCapabilities, resolveContextOrder,
  type OrderResolution,
} from '../src/input/Commands';

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * AN OBLIQUE PINHOLE, and the obliqueness is the entire point of the file.
 *
 * 10 client px per world metre across and down the ground plane, and every
 * metre of ALTITUDE lifts the sprite `PX_PER_METRE_UP` px up the screen. The
 * flat projector in `input.spec.ts` ignores `y` entirely, which is exactly why
 * it could never have caught this: with height thrown away, a plane is drawn on
 * top of its own shadow and the ground query finds it every time.
 *
 * The ratio is the shipped camera's, near enough — `config.ts` records that at
 * the shipped pitch "a unit 22 m up sits about a third of a screen above its
 * own shadow".
 */
const PX_PER_METRE = 10;
const PX_PER_METRE_UP = 13;

const oblique: ScreenProjector = {
  project(x: number, y: number, z: number, out: Float32Array): boolean {
    out[0] = 500 + x * PX_PER_METRE;
    out[1] = 500 + z * PX_PER_METRE - y * PX_PER_METRE_UP;
    return true;
  },
  viewport(out: Float32Array): void {
    out[0] = 0; out[1] = 0; out[2] = 4000; out[3] = 4000;
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
  return { world, channels, sel: new Selection(world, channels), me, foe };
}

const AIR_RADIUS = 2.4;

/** A flyer, holding cruise altitude over flat ground. */
function aircraft(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, 31, owner, rig.world.player(owner).faction,
    x, AIR_CRUISE_ALTITUDE, z);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack;
  s.radius[i] = AIR_RADIUS;
  s.maxSpeed[i] = 11.5;
  s.locomotor[i] = Locomotor.Air;
  s.hp[i] = 240;
  s.maxHp[i] = 240;
  s.weaponIndex[i] = 0;
  rig.world.spatial.rebuild();
  return id;
}

function tank(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, 1, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack;
  s.radius[i] = 1.8;
  s.maxSpeed[i] = 8;
  s.locomotor[i] = Locomotor.Track;
  s.hp[i] = 100;
  s.maxHp[i] = 100;
  s.weaponIndex[i] = 0;
  rig.world.spatial.rebuild();
  return id;
}

function harvester(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const id = tank(rig, owner, x, z);
  const s = rig.world.store;
  s.flags[s.index(id)] |= EntityFlag.IsHarvester;
  return id;
}

function building(rig: Rig, owner: PlayerId, x: number, z: number, w = 3, h = 3): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Building, 20, owner, rig.world.player(owner).faction, x, 0, z);
  const i = s.index(id);
  s.footprintW[i] = w;
  s.footprintH[i] = h;
  s.radius[i] = Math.max(w, h) * CELL * 0.5;
  s.hp[i] = 500;
  s.maxHp[i] = 500;
  rig.world.spatial.rebuild();
  return id;
}

/**
 * The pixel a flyer at (x, z) is DRAWN at, and the world point the cursor ray
 * lands on when it passes through those pixels.
 *
 * Both come from `oblique` rather than from arithmetic repeated here, because
 * the number that matters — how far apart they are — has to be the projector's
 * answer and not the test's opinion of it. `lift` is `pickEntity`'s own
 * `radius * 0.9`, i.e. the middle of the mass, which is what a player aims at.
 */
function sightline(x: number, z: number): { px: number; py: number; gx: number; gz: number } {
  const out = new Float32Array(2);
  oblique.project(x, AIR_CRUISE_ALTITUDE + AIR_RADIUS * 0.9, z, out);
  // Invert the ground-plane branch of the same projector: y = 0 there.
  return { px: out[0], py: out[1], gx: (out[0] - 500) / PX_PER_METRE, gz: (out[1] - 500) / PX_PER_METRE };
}

const caps = createCapabilities();
const res: OrderResolution = {
  order: OrderKind.None, target: NONE, x: 0, z: 0,
  cursor: CursorKind.Default, valid: false, isRally: false, garrisonRefusal: '',
};

function resolveAt(rig: Rig, hover: EntityId, x: number, z: number, worldValid = true,
  mode = CommandMode.None): OrderResolution {
  readCapabilities(rig.world, rig.world.selection.ids, rig.world.selection.count, caps);
  return resolveContextOrder(rig.world, hover, x, z, worldValid,
    { shift: false, ctrl: false, alt: false }, mode, caps, res);
}

/* ==========================================================================
 * 1. THE GEOMETRY THAT MADE A PLANE UNCLICKABLE
 * ========================================================================== */

describe('an aircraft is 20-odd metres from its own ground point', () => {
  it('the sightline offset is far outside the pick query, which is why this bug existed', () => {
    const s = sightline(100, 100);
    const offset = Math.hypot(s.gx - 100, s.gz - 100);
    // `PICK_RADIUS + 10` = 11.6 m is the whole candidate set `pickEntity` had.
    // Measured in a live match at 22.9-25.2 m; this fixture reproduces the same
    // order of magnitude, which is all the bug ever needed.
    expect(offset).toBeGreaterThan(11.6);
  });

  it('picks the aircraft the cursor is pointing at', () => {
    const rig = makeRig();
    const a = aircraft(rig, rig.me, 100, 100);
    const s = sightline(100, 100);
    expect(pickEntity(rig.world, oblique, s.px, s.py, s.gx, s.gz)).toBe(a);
  });

  it('does not hand back the building that happens to sit under the ground hit', () => {
    // The measured failure exactly: clicking a Vindicator selected a structure
    // 25 m away, because that structure genuinely CONTAINED the terrain point
    // the ray landed on and the aircraft was not even a candidate.
    const rig = makeRig();
    const s = sightline(100, 100);
    building(rig, rig.me, s.gx, s.gz);
    const a = aircraft(rig, rig.me, 100, 100);
    expect(pickEntity(rig.world, oblique, s.px, s.py, s.gx, s.gz)).toBe(a);
  });

  it('still picks the ground unit when the cursor is on the ground unit', () => {
    // The fix must not make flyers win everywhere. Pointing at a tank picks the
    // tank even with a plane in the air over the same map.
    const rig = makeRig();
    aircraft(rig, rig.me, 100, 100);
    const t = tank(rig, rig.me, 40, 40);
    const out = new Float32Array(2);
    oblique.project(40, 1.8 * 0.9, 40, out);
    expect(pickEntity(rig.world, oblique, out[0], out[1], 40, 40)).toBe(t);
  });

  it('does not pick a flyer the cursor is nowhere near', () => {
    const rig = makeRig();
    aircraft(rig, rig.me, 100, 100);
    // Half the map away, and well outside PICK_SCREEN_RADIUS_PX of the hull.
    expect(pickEntity(rig.world, oblique, 500 + 300 * PX_PER_METRE,
      500 + 300 * PX_PER_METRE, 300, 300)).toBe(NONE);
    expect(PICK_SCREEN_RADIUS_PX).toBeGreaterThan(0);
  });

  it('lets a right-click on an enemy aircraft resolve as Attack', () => {
    // The same gate is why you could not shoot one either: `pickEntity`
    // returned NONE for the hover, so the resolver was asked about bare ground
    // and answered Move.
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 40, 40), SelectMode.Replace);
    const foe = aircraft(rig, rig.foe, 100, 100);
    const s = sightline(100, 100);
    const hover = pickEntity(rig.world, oblique, s.px, s.py, s.gx, s.gz);
    expect(hover).toBe(foe);
    const r = resolveAt(rig, hover, s.gx, s.gz);
    expect(r.order).toBe(OrderKind.Attack);
    expect(r.target).toBe(foe);
  });
});

/* ==========================================================================
 * 2. A CLICK THAT ISSUES NOTHING SAYS WHY
 * ========================================================================== */

describe('deadClickReason', () => {
  it('says nothing at all when a command was issued', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60);
    expect(r.valid).toBe(true);
    expect(deadClickReason(caps, r, 1)).toBe(DeadClick.None);
  });

  it('stays silent on a right-click with nothing selected', () => {
    // The commonest gesture in an RTS is a right-click on open ground to cancel
    // whatever you were doing. A toast on every one of them would be worse than
    // the silence this whole mechanism exists to end.
    const rig = makeRig();
    const r = resolveAt(rig, NONE, 60, 60);
    expect(deadClickReason(caps, r, 0)).toBe(DeadClick.NoSelection);
    expect(deadClickText(DeadClick.NoSelection)).toBeNull();
  });

  it('names the structures-only selection', () => {
    const rig = makeRig();
    // Not a factory: a factory selection resolves as a rally move and is valid.
    rig.sel.select(building(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60);
    expect(r.valid).toBe(false);
    expect(r.cursor).toBe(CursorKind.NoMove);
    expect(deadClickReason(caps, r, 0)).toBe(DeadClick.StructuresOnly);
    expect(deadClickText(DeadClick.StructuresOnly)).not.toBeNull();
  });

  it('names a click that was not on the battlefield', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60, false);
    expect(r.valid).toBe(false);
    expect(deadClickReason(caps, r, 0)).toBe(DeadClick.OffMap);
  });

  it('names a force-fire from a selection with no gun', () => {
    const rig = makeRig();
    const s = rig.world.store;
    const t = tank(rig, rig.me, 10, 10);
    s.flags[s.index(t)] &= ~EntityFlag.CanAttack;
    rig.sel.select(t, SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60, true, CommandMode.ForceAttack);
    expect(r.valid).toBe(false);
    expect(deadClickReason(caps, r, 0)).toBe(DeadClick.Unarmed);
  });

  it('names a valid order that gathered nobody', () => {
    const rig = makeRig();
    rig.sel.select(tank(rig, rig.me, 10, 10), SelectMode.Replace);
    const r = resolveAt(rig, NONE, 60, 60);
    expect(r.valid).toBe(true);
    expect(deadClickReason(caps, r, 0)).toBe(DeadClick.Vanished);
  });

  it('gives every reported reason a sentence, and only those', () => {
    for (const reason of [DeadClick.StructuresOnly, DeadClick.OffMap,
      DeadClick.Unarmed, DeadClick.Vanished]) {
      const text = deadClickText(reason);
      expect(text).not.toBeNull();
      expect((text as readonly [string, string])[0].length).toBeGreaterThan(0);
      expect((text as readonly [string, string])[1].length).toBeGreaterThan(0);
    }
    expect(deadClickText(DeadClick.None)).toBeNull();
    expect(deadClickText(DeadClick.NoSelection)).toBeNull();
  });
});

/* ==========================================================================
 * 3. ONLY A HARVESTER MINES
 * ========================================================================== */

describe('a Harvest order issued to a mixed group', () => {
  function issueHarvest(rig: Rig, ids: EntityId[]): void {
    const exec = new OrderExecutor(rig.world, rig.channels);
    rig.channels.commands.issueOrder(rig.me, OrderKind.Harvest,
      Int32Array.from(ids as unknown as number[]), ids.length, 60, 60, NONE, false);
    exec.tick();
  }

  it('sends the harvester prospecting', () => {
    const rig = makeRig();
    const h = harvester(rig, rig.me, 10, 10);
    issueHarvest(rig, [h]);
    const s = rig.world.store;
    expect(s.state[s.index(h)]).toBe(UnitState.SeekOre);
    expect(s.orderKind[s.index(h)]).toBe(OrderKind.Harvest);
  });

  it('sends the escort to the same point as a plain Move', () => {
    // `UnitState.SeekOre` on a tank is a dead end: `sim/Harvesting.ts` rejects
    // anything without `EntityFlag.IsHarvester` on the first line of its loop,
    // so nothing in the game ever moves that unit on again. It arrived at the
    // ore and stayed there, holding a flow field, outside every stance
    // behaviour and outside the AI's idle sweep, for the rest of the match.
    const rig = makeRig();
    const h = harvester(rig, rig.me, 10, 10);
    const t = tank(rig, rig.me, 12, 10);
    issueHarvest(rig, [h, t]);
    const s = rig.world.store;
    expect(s.state[s.index(t)]).toBe(UnitState.Moving);
    expect(s.orderKind[s.index(t)]).toBe(OrderKind.Move);
    expect(s.orderX[s.index(t)]).toBe(60);
    expect(s.orderZ[s.index(t)]).toBe(60);
    // And the harvester in the same command is untouched by the exemption.
    expect(s.state[s.index(h)]).toBe(UnitState.SeekOre);
  });

  it('is how a drag-box over your own base ends up carrying one', () => {
    // The route in: `caps.hasHarvester` is true if ANY selected unit mines, and
    // a click on ore then resolves to Harvest for the whole group.
    const rig = makeRig();
    const h = harvester(rig, rig.me, 10, 10);
    rig.sel.select(h, SelectMode.Replace);
    rig.sel.select(tank(rig, rig.me, 12, 10), SelectMode.Add);
    readCapabilities(rig.world, rig.world.selection.ids, rig.world.selection.count, caps);
    expect(caps.hasHarvester).toBe(true);
    expect(caps.mobileCount).toBe(2);
  });
});
