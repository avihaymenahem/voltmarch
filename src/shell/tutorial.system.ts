/**
 * ============================================================================
 * src/shell/tutorial.system.ts — the tutorial's engine wiring
 * ============================================================================
 * Discovered by glob from `src/game/Systems.ts` like every other system, so it
 * is present in EVERY boot — a skirmish, the title backdrop, and a `?shot=`
 * capture. It therefore has exactly one job in the common case: find no
 * tutorial director, and do nothing at all.
 *
 * WHY IT DOES NOT IMPORT `Tutorial.ts`
 * -----------------------------------
 * `import.meta.glob('../ ** /*.system.ts', { eager: true })` puts this file in
 * the MAIN chunk. `src/shell/Tutorial.ts` is in the lazily-loaded shell chunk
 * and pulls `Shell.ts`, five screens, `shell.css` and the settings store behind
 * it. A static import here would drag all of that into the main bundle and a
 * `?shot=` boot — which is contractually never allowed to load the shell —
 * would load every byte of it.
 *
 * So the director is reached through `globalThis.__vmTutorial` and the
 * structural interface restated below, the same seam `src/ui/Objectives.ts`
 * uses for the progression handle and `src/input/input.system.ts` uses for the
 * settings store. The one thing shared by import is `./tutorial-steps`, whose
 * only import is the action catalogue and which is therefore safe in both
 * chunks.
 *
 * WHAT IT FEEDS, AND WHY THE DIRECTOR NEVER SEES A `World`
 * -------------------------------------------------------
 * Every engine read happens here and leaves as a number or a string. The
 * director gets "a structure of role `refinery` finished", not an
 * `EntityId`; "the camera focus is at (x, z) and home is at (hx, hz)", not a
 * `CameraRig`. That is what lets the director live in the shell chunk, be
 * constructed before a match exists, and survive the engine being disposed and
 * re-bootstrapped underneath it.
 *
 * THE FRAME COST WHEN NO TUTORIAL IS RUNNING
 * ------------------------------------------
 * One null check. The per-frame camera sample and the rally-map scan — the only
 * two things here that are polled rather than evented, because neither the
 * camera nor `SetRally` publishes an event — are both inside the guard.
 * ============================================================================
 */

import * as THREE from 'three';

import { defineSystem } from '../core/loop';
import { CreditReason, EntityFlag, EntityKind, RenderPhase, type RenderContext } from '../core/types';
import type { World } from '../core/world';
import { ctx } from '../game/context';
import { production } from '../sim/Production';

import { classifyStructure, type StructureRole } from './tutorial-steps';

/* ==========================================================================
 * 1. THE SEAM
 *
 * A structural restatement of `TutorialFeed` in `src/shell/Tutorial.ts`.
 * Deliberately structural: the director satisfies this by shape, this file
 * compiles and ships whether or not the shell was ever loaded, and
 * `readTutorial` below verifies every member it actually calls so there is not
 * one defensive check at the call sites.
 * ========================================================================== */

interface TutorialFeed {
  readonly wantsMatch: boolean;
  matchStarted(): void;
  matchEnded(): void;
  selectionChanged(count: number): void;
  orderIssued(order: number, count: number): void;
  structureCompleted(role: StructureRole): void;
  unitProduced(): void;
  harvestDeposit(): void;
  rallyMoved(): void;
  cameraSample(x: number, z: number, distance: number, homeX: number, homeZ: number): void;
  frame(dt: number): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmTutorial: TutorialFeed | undefined;
}

/** The live director, or null. Duck-typed, never `instanceof`-checked. */
function readTutorial(): TutorialFeed | null {
  const g = globalThis as { __vmTutorial?: unknown };
  const t = g.__vmTutorial;
  if (typeof t !== 'object' || t === null) return null;
  const v = t as Partial<TutorialFeed>;
  if (typeof v.matchStarted !== 'function') return null;
  if (typeof v.matchEnded !== 'function') return null;
  if (typeof v.frame !== 'function') return null;
  if (typeof v.cameraSample !== 'function') return null;
  if (typeof v.orderIssued !== 'function') return null;
  if (typeof v.structureCompleted !== 'function') return null;
  if (v.wantsMatch !== true) return null;
  return t as TutorialFeed;
}

/* ==========================================================================
 * 2. MODULE STATE
 * ========================================================================== */

let feed: TutorialFeed | null = null;
let unsubscribes: Array<() => void> = [];

/**
 * The last rally position seen for each factory.
 *
 * Rally points are the one lesson with no event behind it: the input module
 * writes them through `CommandBus.issueSetRally`, which is a COMMAND rather
 * than a notification, and `ProductionService` applies it straight onto
 * `PlayerState.rallyX`. So the map is polled.
 *
 * The distinction that makes the lesson correct: a factory is given a default
 * rally flag the instant it finishes (`defaultRally` in Production.ts), so an
 * INSERTION is the engine talking and only a CHANGE to a key that already
 * existed is the player. The tutorial counts the second and ignores the first.
 */
const lastRally = new Map<number, { x: number; z: number }>();
/** Metres a flag must move to count. Below this it is float noise. */
const RALLY_EPSILON = 0.5;

/** Scratch for the home point, so the per-frame sample never allocates. */
const HOME = new THREE.Vector2();

/**
 * Where "centre on base" actually goes.
 *
 * NOT `CameraRig.getHome()`, and this cost a playthrough to find out.
 * `CameraRig.setHome` is never called anywhere in the product, so `getHome()`
 * returns (0, 0) forever — the corner of the map. The command bound to
 * `cam.home` is `centreOnHome()` in `src/input/input.system.ts`, which computes
 * the point itself: the player's first structure flagged `IsBuilder` or
 * `IsFactory`, and the centroid of everything they own when they have no
 * structures yet. A tutorial that measured "did you get home" against the rig's
 * idea of home would have measured the map origin, and the step would have been
 * impossible.
 *
 * So the rule is restated here, deliberately and with the duplication called
 * out: `src/input/**` belongs to another module and cannot be edited from here.
 * The fix that removes this copy is one line in `centreOnHome` — see the report.
 */
function homeOf(world: World, out: THREE.Vector2): THREE.Vector2 {
  const s = world.store;
  const local = world.localPlayer as number;
  const buildings = s.byKind[EntityKind.Building];
  const n = s.byKindCount[EntityKind.Building];
  for (let i = 0; i < n; i++) {
    const idx = buildings[i];
    if (s.owner[idx] !== local) continue;
    if ((s.flags[idx] & EntityFlag.IsBuilder) === 0 && (s.flags[idx] & EntityFlag.IsFactory) === 0) continue;
    return out.set(s.posX[idx], s.posZ[idx]);
  }
  let count = 0;
  let sx = 0;
  let sz = 0;
  for (let a = 0; a < s.aliveCount; a++) {
    const idx = s.alive[a];
    if (s.owner[idx] !== local) continue;
    sx += s.posX[idx];
    sz += s.posZ[idx];
    count++;
  }
  return count > 0 ? out.set(sx / count, sz / count) : out.set(0, 0);
}

/* ==========================================================================
 * 3. THE SYSTEM
 * ========================================================================== */

export default defineSystem({
  id: 'shell.tutorial',
  // After `ui.hud` (order 100) in the same phase: the spotlight measures HUD
  // elements with `getBoundingClientRect`, and measuring them before the HUD
  // has written this frame's values would ring last frame's layout.
  renderPhase: RenderPhase.Hud,
  order: 200,

  init(): void {
    feed = readTutorial();
    if (feed === null) return;

    const { channels, world } = ctx();
    const bus = channels.events;
    const local = world.localPlayer as number;
    const off: Array<() => void> = [];

    off.push(bus.on('selection:changed', (p) => {
      feed?.selectionChanged(p.count);
    }));

    off.push(bus.on('order:issued', (p) => {
      if ((p.player as number) !== local) return;
      feed?.orderIssued(p.order as number, p.count);
    }));

    off.push(bus.on('building:completed', (p) => {
      if ((p.player as number) !== local) return;
      // `entryOf` reads the catalog index stamped on the entity by
      // `spawnBuilding`, which is unambiguous — unlike the payload's `defId`,
      // whose meaning depends on whether a real def table was bound.
      const entry = production()?.entryOf(p.id) ?? null;
      if (entry === null) return;
      feed?.structureCompleted(classifyStructure(entry));
    }));

    off.push(bus.on('production:ready', (p) => {
      if ((p.player as number) !== local) return;
      if (p.isBuilding) return;
      feed?.unitProduced();
    }));

    off.push(bus.on('economy:credits', (p) => {
      if ((p.player as number) !== local) return;
      if (p.delta <= 0) return;
      if (p.reason !== (CreditReason.Harvest as number)) return;
      feed?.harvestDeposit();
    }));

    lastRally.clear();
    unsubscribes = off;
    feed.matchStarted();
    console.info('[tutorial] director attached — feeding a live match');
  },

  frame(r: RenderContext): void {
    const f = feed;
    if (f === null) return;
    if (!f.wantsMatch) return;

    const { world, cameraRig } = ctx();

    /* -- camera: no events exist, so it is sampled ---------------------- */
    const focus = cameraRig.targetFocus;
    homeOf(world, HOME);
    f.cameraSample(focus.x, focus.z, cameraRig.targetDistance, HOME.x, HOME.y);

    /* -- rally flags: a command, not an event, so also sampled ---------- */
    const player = world.players[world.localPlayer as number];
    if (player !== undefined) {
      for (const [factory, x] of player.rallyX) {
        const z = player.rallyZ.get(factory) ?? 0;
        const previous = lastRally.get(factory);
        if (previous === undefined) {
          // First sighting: the engine's own default flag. Record, do not count.
          lastRally.set(factory, { x, z });
          continue;
        }
        if (Math.abs(previous.x - x) > RALLY_EPSILON || Math.abs(previous.z - z) > RALLY_EPSILON) {
          previous.x = x;
          previous.z = z;
          f.rallyMoved();
        }
      }
    }

    f.frame(r.dt);
  },

  dispose(): void {
    for (const off of unsubscribes) off();
    unsubscribes = [];
    lastRally.clear();
    feed?.matchEnded();
    feed = null;
  },
});
