/**
 * ============================================================================
 * VOLTMARCH — src/sim/pathing.system.ts
 * ============================================================================
 * The registration shim for pathfinding, steering and movement.
 *
 * THREE PHASES, ONE FILE
 * ----------------------
 * `SystemModule` carries exactly one `phase`, but this module owns three
 * consecutive ones (PathRequest 500 -> Steering 600 -> Movement 700) and they
 * MUST run in that order with nothing of ours in between. The clean way to
 * express that with the plugin contract is to default-export the first system
 * and have its `init()` register the other two through the public
 * `SystemRegistry.add`. They carry no `init` of their own, so registering them
 * mid-boot is safe (the registry's init loop iterates a snapshot).
 *
 * That also keeps the discovery glob honest: one file, one default export, one
 * id in the boot log per system.
 *
 * WHAT IT WIRES
 * -------------
 *  1. `world.nav` — the `INav` port. Every module that needs a path (AI,
 *     harvester logic, the HUD's move cursor) goes through it and never
 *     imports Flowfield.ts.
 *  2. `setActiveNav` — the module-level accessor for the two callers that need
 *     the MoveClass-aware surface `INav` cannot express.
 *  3. Debug counters: `nav.fields`, `nav.ready`, `nav.cells`, `move.moving`,
 *     plus the connectivity health trio `navUnreachable`, `navRescues` and
 *     `navUnreachableOrders` — all three must stay at 0 on a healthy map.
 *  4. `__VM.hooks` is untouched; the probe lives on `globalThis.__vmNav` so a
 *     screenshot harness or a console session can inspect a field without a
 *     build flag.
 *
 * ORDER 100 inside each phase leaves room for a module that must run before
 * us (a formation/waypoint layer at order 0, say) without renegotiating.
 * ============================================================================
 */

import { defineSystem, now } from '../core/loop';
import { EntityKind, Phase } from '../core/types';
import type { SystemModule } from '../core/types';
import { FLOWFIELD_BUDGET_CELLS, FLOWFIELD_CACHE_SIZE } from '../core/config';
import { ctx } from '../game/context';
import {
  FlowFieldCache, MOVE_CLASS_NAMES, MoveClass, getNav, setActiveNav,
} from './Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from './Steering';
import { MovementIntegrator } from './Movement';

let nav: FlowFieldCache | null = null;
let agents: NavAgents | null = null;
let assigner: NavAssigner | null = null;
let steering: SteeringSolver | null = null;
let movement: MovementIntegrator | null = null;

/** Phase.Steering (600): desired velocity + desired yaw. */
const steeringSystem: SystemModule = {
  id: 'sim.steering',
  phase: Phase.Steering,
  order: 100,
  simTick(s): void {
    steering?.simTick(s);
  },
};

/**
 * Phase.SpatialRebuild (800): the counting-sort rebuild of `world.spatial`.
 *
 * This phase is defined in core/types with no named owner, and the natural
 * owner is whoever moved things: it must run once per tick, AFTER the last
 * position write and BEFORE Targeting reads the hash. That is exactly here.
 * If another module ever claims `sim.spatial`, the registry skips the
 * duplicate with a warning and this one quietly stops being the owner.
 */
const spatialSystem: SystemModule = {
  id: 'sim.spatial',
  phase: Phase.SpatialRebuild,
  order: 100,
  simTick(): void {
    ctx().world.spatial.rebuild();
  },
};

/** Phase.Movement (700): integrate, conform, tilt, relax. */
const movementSystem: SystemModule = {
  id: 'sim.movement',
  phase: Phase.Movement,
  order: 100,
  simTick(s): void {
    movement?.simTick(s);
    // Counters are refreshed here rather than in a `frame()` so they reflect
    // the last SIMULATED tick, not whichever partial frame happened to render.
    const { debug } = ctx();
    const c = debug.counters;
    if (nav !== null) {
      c.navFields = nav.stats.fields;
      c.navReady = nav.stats.ready;
      c.navCells = nav.stats.cellsThisTick;
      c.navPending = nav.stats.pending;
      // Orders whose goal sat in a region the unit could not reach. Steady
      // growth here means the map is fragmenting, not that a player misclicked.
      c.navUnreachable = nav.stats.unreachable;
    }
    if (assigner !== null) {
      // Units lifted out of a pocket they could not leave. This is the
      // reported bug's last line of defence, and a non-zero value means an
      // earlier layer (terrain start guarantee, scenario placement) let one
      // through — so it belongs on screen, not only in the console.
      c.navRescues = assigner.rescues;
      c.navUnreachableOrders = assigner.unreachableOrders;
    }
    if (steering !== null) c.moving = steering.moving;
    if (movement !== null) c.relaxPushes = movement.relaxPushes;
  },
};

export default defineSystem({
  id: 'sim.pathing',
  phase: Phase.PathRequest,
  order: 100,

  init(): void {
    const { world, channels, registry, debug } = ctx();
    const t0 = now();

    nav = new FlowFieldCache(world.terrain);
    setActiveNav(nav);
    world.nav = nav;

    agents = new NavAgents();
    assigner = new NavAssigner(world, nav, agents);
    steering = new SteeringSolver(world, nav, agents);
    movement = new MovementIntegrator(world, nav, channels);

    registry.add(steeringSystem);
    registry.add(movementSystem);
    registry.add(spatialSystem);

    // Buildings placed after boot must invalidate every cached field. The
    // occupancy version check in `nav.update()` already catches this, but
    // reacting to the event as well means the very next tick after a
    // Construction Yard lands is already pathing around it instead of
    // discovering it one tick later.
    channels.events.on('building:placed', (e) => {
      nav?.invalidate(e.cx, e.cz, e.w, e.h);
    });
    channels.events.on('entity:killed', (e) => {
      // ONLY structures. A unit death changes nothing about the grid, and
      // invalidating on every kill re-derives six cost grids and re-expands
      // every live field in the middle of a battle — measured at ~13 full
      // rebuilds in six seconds of combat before this guard.
      if (e.kind === EntityKind.Building) nav?.invalidateAll();
    });

    debug.counters.navFields = 0;
    debug.counters.navReady = 0;
    debug.counters.navCells = 0;
    debug.counters.navPending = 0;
    debug.counters.navUnreachable = 0;
    debug.counters.navRescues = 0;
    debug.counters.navUnreachableOrders = 0;
    debug.counters.moving = 0;
    debug.counters.relaxPushes = 0;

    // `MoveClass` is a const enum and has no runtime object, so the console
    // handle publishes the NAMES and takes plain integers.
    (globalThis as Record<string, unknown>).__vmNav = {
      nav,
      agents,
      classNames: MOVE_CLASS_NAMES,
      /** Cost grid for a class index (0 foot .. 5 air), for a debug overlay. */
      cost: (cls: number) => nav?.costGridFor(cls as MoveClass),
      /** Flow direction at a world position for a live field handle. */
      sample: (field: number, x: number, z: number) => {
        const out = new Float32Array(2);
        return nav?.sample(field, x, z, out) === true ? [out[0], out[1]] : null;
      },
      stats: () => nav?.stats,
    };

    console.info(
      `%c[pathing]%c flow fields ready — ${FLOWFIELD_CACHE_SIZE} field slots, ` +
        `${FLOWFIELD_BUDGET_CELLS} cells/tick budget, ` +
        `${MOVE_CLASS_NAMES.length} move classes (${MOVE_CLASS_NAMES.join(', ')}) ` +
        `in ${(now() - t0) | 0} ms`,
      'color:#7fd', 'color:inherit',
    );
  },

  simTick(s): void {
    assigner?.simTick(s);
  },

  dispose(): void {
    assigner?.releaseAll();
    movement?.reset();
    // Take the two sub-systems down with us. Safe during
    // `SystemRegistry.dispose()` — that iterates a snapshot, so splicing here
    // cannot skip anybody.
    try {
      const { registry } = ctx();
      registry.remove(steeringSystem.id);
      registry.remove(movementSystem.id);
      registry.remove(spatialSystem.id);
    } catch {
      // Context already torn down; the registry is being cleared wholesale.
    }
    if (nav !== null) {
      nav.dispose();
      if (getNav() === nav) setActiveNav(null);
    }
    nav = null;
    agents = null;
    assigner = null;
    steering = null;
    movement = null;
    delete (globalThis as Record<string, unknown>).__vmNav;
  },
});
