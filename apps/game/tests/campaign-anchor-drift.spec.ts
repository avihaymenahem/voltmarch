/**
 * ============================================================================
 * VOLTMARCH — tests/campaign-anchor-drift.spec.ts
 * ============================================================================
 * THE TWO ANCHORS EVERY CAMPAIGN HEADER MEASURES FROM, PINNED BY VALUE.
 *
 * Thirty-seven operations ship with thirty-seven layout headers and thirty-seven
 * operation headers, and between them they quote several hundred distances.
 * Almost every one of those is measured from one of two points: the seat's START
 * SPOT, or the CONSTRUCTION YARD that spot raises. Nothing in the tree was
 * watching either, and on 2026-08-20 commit `bb83ffb` ("Rebuild procedural bases
 * on the placement grid") moved eleven of the fourteen yards on the shipped
 * seeds by 2.83 to 6.32 m. Every gate stayed green. Roughly a hundred and fifty
 * published figures across thirty-odd files silently stopped being true, one of
 * them spoken aloud by a character, and the whole thing had to be found and
 * corrected by hand.
 *
 * ============================================================================
 * WHAT THIS FILE CAN DO, AND WHAT IT DELIBERATELY CANNOT
 * ============================================================================
 * **A GENERAL GATE OVER THE PROSE IS NOT ACHIEVABLE AND IS NOT ATTEMPTED.** The
 * headers say "a hundred and forty-two metres" in a dialogue line, "141.82 m" in
 * a table, "141.8" in a doc comment and "142" in a paragraph, all about the same
 * pair of points; they also quote surface distances, route metres on four
 * different grids, cell counts and blast arithmetic derived four steps down from
 * a coordinate. Parsing that is not a test, it is a second implementation of the
 * campaign with its own bugs.
 *
 * What IS achievable is pinning the ANCHORS the figures are derived FROM, per
 * operation, BY VALUE. Then a change to `buildBaseFor`, to `ALLIED_CORE` /
 * `SOVIET_CORE`, to `cardinalBaseFacing`, to `ScenarioBuilder.spawnBuilding`'s
 * footprint snap, to `startSpots`, to `START_SPREAD_X/_Z` or to `islandSeats`
 * arrives as a RED TEST THAT NAMES THE HEADERS, rather than as a hundred and
 * fifty numbers nobody notices. That is `tests/terrain-lod.spec.ts`'s shape —
 * pin the thing the artefact is a property of, not the artefact — and its header
 * argues the same trade for the same reason.
 *
 * So this file cannot tell you a header is WRONG. It tells you a header is
 * SUSPECT, and it tells you which one, which is the whole of what a hand sweep
 * costs. Concretely it fails on:
 *
 *   - a start spot moving (the seed table, the spread constants, the seated-slot
 *     draw, `nudgeToBuildable` finding different ground);
 *   - a Construction Yard moving relative to its spot (the base layout tables,
 *     the base facing, the footprint snap);
 *   - a yard appearing or disappearing on a seat;
 *   - the yard's def key changing for an army.
 *
 * It cannot see: a layout-authored point moving, a non-square Gaia structure
 * re-snapping, a garrison anchor moving, a wall row growing a segment, a route
 * grid changing. All five of those also happened in `bb83ffb`, and all five are
 * downstream of somebody re-reading a header — which is exactly what a failure
 * here is for.
 *
 * ============================================================================
 * SECTION 3 IS THE ONE THAT EXPLAINS A FAILURE RATHER THAN REPORTING IT
 * ============================================================================
 * `buildBaseFor` puts the yard at local `{ dx: 0, dz: -4 }` in BOTH base tables
 * (`ALLIED_CORE` and `SOVIET_CORE`), the yaw is quantised by
 * `cardinalBaseFacing` BEFORE `cos`/`sin` are taken, and the yard footprint is
 * 3x3 for all four armies — so `snapFootprintToGrid` always lands on
 * `x = z = 2 (mod 4)`. Every continental seat anchor is a multiple of 4 and the
 * rotated offset is 0 or +/-4, so `Math.round` is always handed an exact
 * `k + 0.5` and rounds toward +infinity: **the snap adds exactly (+2, +2) every
 * time**, and the whole thing collapses to four constants keyed on the cardinal
 * yaw. Section 3 asserts that, so a red section 2 comes with a diagnosis: if
 * section 3 is also red the OFFSET changed, and if section 3 is green the ANCHOR
 * did.
 *
 * **THE FOUR CONSTANTS ARE ONLY EXACT ON A LATTICE ANCHOR**, so section 3 runs
 * the real rounding rather than the shortcut: `allies.09.made-good` seats
 * through `islandSeats`, which is not lattice-aligned, and the shortcut is 1.1
 * to 2.9 m out on both of its seats. The four constants stay in the failure
 * message because they are what a reader needs; the code does the arithmetic.
 *
 * Section 3 covers 69 of the 70 shipped yards. The one it excludes is
 * `reclamation.01.held-paper`'s player Foundry, which the LAYOUT raises on a lot
 * point rather than `buildBaseFor`, and it is excluded BY NAME with its reason
 * — a silent exception list is how a gate stops gating. Its position is still
 * pinned in section 2, which is the half a header depends on.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityKind, Faction } from '../src/core/types';
import type { EntityId } from '../src/core/types';
import { CELL } from '../src/core/config';
import { DEG2RAD } from '../src/core/math';
import {
  MAP_SEAS, buildScenario, clearScenario, islandSeats, resolveDefBinding,
  setCampaignLayout, setPlannedOperation, startPointsFor, startSpots, wrapDeg,
} from '../src/game/Scenarios';
import type { DefBinding } from '../src/game/Scenarios';
import { cardinalBaseFacing } from '../src/game/scenarios/AlliedBase';
import { campaignRosterActive, setCampaignRoster } from '../src/progression/UnlockGate';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import type { OperationDef, OperationRoster } from '../src/campaign/types';

/* ==========================================================================
 * THE HARNESS — `tests/campaign-roster-ground.spec.ts`'s, with the anchors
 * sampled INSIDE the layout callback.
 *
 * BOTH HALVES OF THAT HARNESS ARE LOAD-BEARING and neither is optional here.
 * `resolveDefBinding()` is a PROMISE; unawaited, `binding.tables` is undefined,
 * every def resolves to undefined, `rosterAllows` answers TRUE for an undefined
 * def, and the build reports ZERO yards while passing green. That is trap 6 in
 * the campaign guidance wearing a new face, and section 0 below is the guard
 * against it.
 *
 * The anchors are sampled inside the callback rather than recomputed afterwards
 * for `reclamation-in-duplicate`'s stated reason: `nudgeToBuildable` scores
 * `terrain.isBuildable`, which is FALSE on a cell a structure already occupies,
 * so calling `startSpots` after the world is built can report openings that were
 * never used.
 * ========================================================================== */

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

/** The Construction Yard key for each army. `Defs.ts`'s `conYardKey`. */
const YARD_KEYS: ReadonlySet<string> = new Set(['conyard', 'mrdConclave', 'rclFoundry']);

interface Anchor { readonly x: number; readonly z: number; readonly facingDeg: number }
interface Landed { readonly seat: number; readonly key: string | null; readonly x: number; readonly z: number }

interface Built {
  /** `startSpots(...)` as the layout was handed it. */
  spots: Anchor[];
  /** `islandSeats(spots, sea)` — identity on a continent, the SEAT on an atoll. */
  seats: Anchor[];
  /** One row per seat, in seat order. `key: null` means no yard on that seat. */
  yards: Landed[];
  rosterLive: boolean;
}

function buildOperation(op: OperationDef, binding: DefBinding, roster: OperationRoster | null): Built {
  const sea = MAP_SEAS[op.map.preset] ?? null;
  const terrain = new Terrain({
    scene: new THREE.Scene(),
    seed: op.map.mapSeed,
    biome: op.map.biome as never,
    anisotropy: 1,
    starts: startPointsFor(op.map.armies, sea, op.map.simSeed).map((p) => ({ x: p.x, z: p.z })),
    sea,
  });
  setActiveTerrain(terrain);

  const world = new World();
  world.addPlayer(FACTION_OF[op.chapter], 'Commander', true, true);
  for (let seat = 1; seat < op.map.armies; seat++) {
    world.addPlayer(op.foe, 'Opponent', false, false);
  }
  world.terrain = terrain;

  const layout = LAYOUTS.get(op.layout);
  expect(layout, `operation ${op.id} names layout '${op.layout}'`).toBeDefined();

  let spots: Anchor[] = [];
  let seats: Anchor[] = [];
  let rosterLive = false;

  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  setCampaignRoster(roster);
  setCampaignLayout((b, cx, cz, start) => {
    rosterLive = campaignRosterActive();
    const raw = startSpots(cx, cz, b.armies, b.sea, b.seed);
    spots = raw.map((p) => ({ x: p.x, z: p.z, facingDeg: p.facingDeg }));
    seats = islandSeats(raw, b.sea).map((p) => ({ x: p.x, z: p.z, facingDeg: p.facingDeg }));
    layout!.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (_name: string, _id: EntityId) => { /* tags are `campaign-maps.spec.ts`'s question */ },
      seat: (i) => b.armySlot(i),
    });
  });

  try {
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies, defs: binding });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    setCampaignRoster(null);
    clearScenario();
  }

  const st = world.store;
  const tables = binding.tables;
  const found = new Map<number, Landed>();
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.kind[i] !== EntityKind.Building) continue;
    const def = tables !== null && st.defId[i] >= 0 ? tables.buildings[st.defId[i]] : undefined;
    const key = def?.key;
    if (key === undefined || !YARD_KEYS.has(key)) continue;
    found.set(st.owner[i], { seat: st.owner[i], key, x: st.posX[i], z: st.posZ[i] });
  }
  const yards: Landed[] = [];
  for (let seat = 0; seat < op.map.armies; seat++) {
    yards.push(found.get(seat) ?? { seat, key: null, x: 0, z: 0 });
  }

  terrain.dispose?.();
  return { spots, seats, yards, rosterLive };
}

/* ==========================================================================
 * THE PIN
 *
 * Measured 2026-08-21 on the shipped seeds, read off `store.posX/posZ` after
 * `spawnBuilding` snapped every footprint, with the def tables BOUND and each
 * operation's own roster INSTALLED.
 *
 * **A ROW HERE IS NOT A PREFERENCE. It is the anchor a header was measured
 * against.** Do not update a row to make this file green: update it in the same
 * commit as a re-read of the two files the failure names, and say in that commit
 * which figures moved.
 * ========================================================================== */

interface Pin { readonly spots: readonly Anchor[]; readonly yards: readonly Landed[] }

const PINNED: Readonly<Record<string, Pin>> = {
  'soviets.01.first-tap': {
    spots: [
      { x: 108, z: 380, facingDeg: 90 },
      { x: 404, z: 380, facingDeg: -90 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 382 },
    ],
  },
  'soviets.02.common-standard': {
    spots: [
      { x: 108, z: 380, facingDeg: 90 },
      { x: 404, z: 380, facingDeg: -90 },
    ],
    yards: [
      { seat: 0, key: null, x: 0, z: 0 },
      { seat: 1, key: 'conyard', x: 402, z: 382 },
    ],
  },
  'soviets.03.deep-sector': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 382 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'soviets.04.company-town': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: 0 },
      { x: 404, z: 380, facingDeg: -90 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 406, z: 138 },
      { seat: 2, key: 'conyard', x: 402, z: 382 },
    ],
  },
  'soviets.05.short-allocation': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'soviets.06.demolition-order': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 382 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'soviets.07.right-of-entry': {
    spots: [
      { x: 108, z: 380, facingDeg: 90 },
      { x: 404, z: 380, facingDeg: -90 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 382 },
    ],
  },
  'soviets.08.carriage-forward': {
    spots: [
      { x: 404, z: 132, facingDeg: -90 },
      { x: 108, z: 132, facingDeg: 90 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 134 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'soviets.09.nil-return': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'allies.01.sounding-line': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 382 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'allies.02.instrument-room': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'allies.03.ground-truth': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'mrdConclave', x: 402, z: 134 },
    ],
  },
  'allies.04.misclosure': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 382 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'allies.05.forced-closure': {
    spots: [
      { x: 404, z: 132, facingDeg: -90 },
      { x: 108, z: 132, facingDeg: 90 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 134 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'allies.06.machine-time': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 114, z: 382 },
      { seat: 1, key: 'rclFoundry', x: 402, z: 134 },
    ],
  },
  'allies.07.fair-copy': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: null, x: 0, z: 0 },
      { seat: 1, key: 'mrdConclave', x: 402, z: 134 },
    ],
  },
  'allies.08.standing-order': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 402, z: 382 },
      { seat: 1, key: 'rclFoundry', x: 114, z: 134 },
    ],
  },
  'allies.09.made-good': {
    spots: [
      { x: 118, z: 390, facingDeg: 134.1574757392596 },
      { x: 394, z: 122, facingDeg: -45.84252426074042 },
    ],
    yards: [
      { seat: 0, key: 'conyard', x: 102, z: 370 },
      { seat: 1, key: 'rclFoundry', x: 410, z: 142 },
    ],
  },
  'pact.01.shallow-road': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'pact.02.long-count': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'pact.03.concession': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 114, z: 382 },
      { seat: 1, key: 'rclFoundry', x: 402, z: 134 },
    ],
  },
  'pact.04.in-the-clear': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 402, z: 382 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'pact.05.open-count': {
    spots: [
      { x: 404, z: 132, facingDeg: -90 },
      { x: 108, z: 132, facingDeg: 90 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 402, z: 134 },
      { seat: 1, key: 'mrdConclave', x: 114, z: 134 },
    ],
  },
  'pact.06.common-ground': {
    spots: [
      { x: 108, z: 380, facingDeg: 90 },
      { x: 404, z: 380, facingDeg: -90 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 114, z: 382 },
      { seat: 1, key: 'rclFoundry', x: 402, z: 382 },
    ],
  },
  'pact.07.thin-place': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'mrdConclave', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'pact.08.struck-off': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: null, x: 0, z: 0 },
      { seat: 1, key: 'rclFoundry', x: 402, z: 134 },
    ],
  },
  'pact.09.vacant-possession': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: null, x: 0, z: 0 },
      { seat: 1, key: 'mrdConclave', x: 114, z: 134 },
    ],
  },
  'reclamation.01.held-paper': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 190, z: 378 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'reclamation.02.written-off': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'reclamation.03.sold-twice': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: 0 },
      { x: 404, z: 380, facingDeg: -90 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 406, z: 138 },
      { seat: 2, key: 'conyard', x: 402, z: 382 },
    ],
  },
  'reclamation.04.served-notice': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: null, x: 0, z: 0 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'reclamation.05.closing-entry': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 114, z: 382 },
      { seat: 1, key: 'mrdConclave', x: 402, z: 134 },
    ],
  },
  'reclamation.06.in-duplicate': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 402, z: 382 },
      { seat: 1, key: 'conyard', x: 114, z: 134 },
    ],
  },
  'reclamation.07.payment-in-kind': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: null, x: 0, z: 0 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'reclamation.08.contra-entry': {
    spots: [
      { x: 404, z: 380, facingDeg: -129.9575489308291 },
      { x: 108, z: 132, facingDeg: 50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 402, z: 382 },
      { seat: 1, key: 'mrdConclave', x: 114, z: 134 },
    ],
  },
  'reclamation.09.book-value': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
  'reclamation.10.without-recourse': {
    spots: [
      { x: 108, z: 380, facingDeg: 129.9575489308291 },
      { x: 404, z: 132, facingDeg: -50.042451069170916 },
    ],
    yards: [
      { seat: 0, key: 'rclFoundry', x: 114, z: 382 },
      { seat: 1, key: 'conyard', x: 402, z: 134 },
    ],
  },
};

/**
 * The seats that carry NO Construction Yard, and the reason.
 *
 * All six are `opening: 'force'` — the layout does not call `buildBaseFor` for
 * the player's seat at all, so there is no yard for a header to measure from and
 * every "from your yard" figure in those files is a figure about the START SPOT.
 * `reclamation.01.held-paper` is `opening: 'force'` TOO and still has a seat-0
 * yard, because its layout raises an `rclFoundry` on a lot point by hand; that
 * is the one row in the pin above whose position is authored rather than
 * derived, and it is why section 3 excludes it by name.
 */
const NO_YARD_SEATS: Readonly<Record<string, readonly number[]>> = {
  'soviets.02.common-standard': [0],
  'allies.07.fair-copy': [0],
  'pact.08.struck-off': [0],
  'pact.09.vacant-possession': [0],
  'reclamation.04.served-notice': [0],
  'reclamation.07.payment-in-kind': [0],
};

/**
 * The one operation whose Construction Yard does NOT come from `buildBaseFor`.
 *
 * `reclamation-held-paper.ts` raises the player's Foundry at a lot point with
 * `raise(player, 'rclFoundry', foundryAt, 'yard', ...)`, so the cardinal-yaw
 * offset in section 3 does not apply to it. Its POSITION is still pinned in
 * section 1, which is the part a header depends on.
 */
const LAYOUT_AUTHORED_YARDS: Readonly<Record<string, readonly number[]>> = {
  'reclamation.01.held-paper': [0],
};

/* -- the files a failure makes suspect ------------------------------------ */

function layoutFile(op: OperationDef): string {
  return `src/campaign/layouts/${op.layout}.ts`;
}

function operationFile(op: OperationDef): string {
  // `soviets.03.deep-sector` -> `src/campaign/operations/soviets/03-deep-sector.ts`
  const rest = op.id.slice(op.chapter.length + 1);
  const dot = rest.indexOf('.');
  return `src/campaign/operations/${op.chapter}/${rest.slice(0, dot)}-${rest.slice(dot + 1)}.ts`;
}

/**
 * The failure message. It has one job: turn "a number changed" into "go and
 * re-read these two headers", because the cost of this drift is entirely in the
 * prose nobody knows to re-read.
 */
function suspect(op: OperationDef, what: string): string {
  return [
    `${op.id}: ${what}`,
    '',
    'EVERY YARD- OR SPOT-ANCHORED DISTANCE IN THESE TWO HEADERS IS NOW SUSPECT:',
    `    ${layoutFile(op)}`,
    `    ${operationFile(op)}`,
    '',
    'Re-measure them and correct the prose in the same commit as this pin.',
    'A distance quoted to a BUILDING must be measured to the building; the start',
    'spot and the Construction Yard it raises are 2.83 m or 6.32 m apart and are',
    'not interchangeable. See this file\'s header for what is and is not covered.',
  ].join('\n');
}

/* -- the offset table, restated ------------------------------------------- */

/**
 * `buildBaseFor` -> `buildAlliedBase` / `buildSovietBase` -> local `{0, -4}`,
 * rotated by `cardinalBaseFacing(facingDeg + 180)`, then snapped by
 * `snapFootprintToGrid` on a 3x3 footprint. A DELIBERATE SECOND IMPLEMENTATION:
 * importing the real one would make section 3 true by construction and it would
 * measure nothing.
 *
 * **THE SNAP IS SPELLED OUT RATHER THAN COLLAPSED TO FOUR CONSTANTS, BECAUSE
 * THE FOUR CONSTANTS ARE ONLY EXACT ON A LATTICE ANCHOR.** On the 36
 * continental operations every anchor is a multiple of 4, the rotated offset is
 * 0 or +/-4, `Math.round` is handed an exact `k + 0.5`, JS rounds half toward
 * +infinity, and the whole thing reduces to
 *     yaw   0 -> (+2, -2)      yaw  90 -> (-2, +2)
 *     yaw 180 -> (+2, +6)      yaw 270 -> (+6, +2)
 * which is the table the failure message quotes. `allies.09.made-good` seats
 * through `islandSeats`, whose `clampWorld(s.x - outward.z * ISLAND_SEAT_OFFSET,
 * 4)` is NOT lattice-aligned, so the shortcut is 1.1 to 2.9 m out there and the
 * real rounding is what has to be run.
 */
function predictYard(seat: Anchor): { x: number; z: number } {
  const yaw = cardinalBaseFacing(wrapDeg(seat.facingDeg + 180));
  const rad = yaw * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // `toWorld(cx, cz, dx, dz, cos, sin)` with the yard's local { dx: 0, dz: -4 }.
  const wx = seat.x + 0 * cos + -4 * sin;
  const wz = seat.z - 0 * sin + -4 * cos;
  // `snapFootprintToGrid(x, z, 3, 3)`.
  return {
    x: (Math.round(wx / CELL - 1.5) + 1.5) * CELL,
    z: (Math.round(wz / CELL - 1.5) + 1.5) * CELL,
  };
}

/* ========================================================================== */

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);
const BUILT = new Map<string, Built>();
let BINDING: DefBinding | null = null;

describe('campaign anchor drift', () => {
  it('0. the harness is armed — bound tables and a live roster', async () => {
    BINDING = await resolveDefBinding();
    expect(
      BINDING.tables,
      'the def tables must be BOUND. `resolveDefBinding()` is a Promise: unawaited, '
      + 'every def resolves undefined, `rosterAllows` returns true for an undefined def, '
      + 'and this whole file reports zero yards while passing green.',
    ).not.toBeNull();

    for (const op of ALL) {
      BUILT.set(op.id, buildOperation(op, BINDING, op.roster));
    }
    for (const op of ALL) {
      expect(BUILT.get(op.id)!.rosterLive, `${op.id}: roster live inside the layout`).toBe(true);
    }
  }, 600_000);

  it('1. every operation is pinned, and every pin names a real operation', () => {
    expect(Object.keys(PINNED).sort()).toEqual(ALL.map((o) => o.id).sort());
  });

  describe('2. the anchors', () => {
    for (const op of ALL) {
      it(`${op.id}`, () => {
        const built = BUILT.get(op.id);
        expect(built, `${op.id} was not built — section 0 must run first`).toBeDefined();
        const pin = PINNED[op.id];

        /* -- the start spots ---------------------------------------------- */
        expect(built!.spots.length, suspect(op, 'seat count changed')).toBe(pin.spots.length);
        for (let i = 0; i < pin.spots.length; i++) {
          const got = built!.spots[i];
          const want = pin.spots[i];
          expect(
            [got.x, got.z, Number(got.facingDeg.toFixed(10))],
            suspect(op, `START SPOT of seat ${i} moved from (${want.x}, ${want.z}) `
              + `facing ${want.facingDeg} to (${got.x}, ${got.z}) facing ${got.facingDeg}`),
          ).toEqual([want.x, want.z, Number(want.facingDeg.toFixed(10))]);
        }

        /* -- the Construction Yards --------------------------------------- */
        const absent = NO_YARD_SEATS[op.id] ?? [];
        for (let seat = 0; seat < pin.yards.length; seat++) {
          const got = built!.yards[seat];
          const want = pin.yards[seat];
          if (want.key === null) {
            expect(
              absent.includes(seat),
              `${op.id}: seat ${seat} is pinned with no Construction Yard but is not in `
              + 'NO_YARD_SEATS. A silent exception is how a gate stops gating — declare it '
              + 'with its reason.',
            ).toBe(true);
            expect(
              got.key,
              suspect(op, `seat ${seat} GREW a Construction Yard (${got.key} at `
                + `(${got.x}, ${got.z})). It had none, so every "from your yard" figure in `
                + 'those headers was a figure about the START SPOT and now has a second '
                + 'possible referent.'),
            ).toBeNull();
            continue;
          }
          expect(
            got.key,
            suspect(op, `seat ${seat}'s Construction Yard key changed from '${want.key}' `
              + `to '${got.key ?? 'NONE — the yard is gone'}'`),
          ).toBe(want.key);
          expect(
            [got.x, got.z],
            suspect(op, `seat ${seat}'s Construction Yard moved from (${want.x}, ${want.z}) `
              + `to (${got.x}, ${got.z}) — `
              + `${Math.hypot(got.x - want.x, got.z - want.z).toFixed(2)} m`),
          ).toEqual([want.x, want.z]);
        }
      });
    }
  });

  it('3. the yard sits at the cardinal-yaw offset from its seat anchor', () => {
    const misses: string[] = [];
    let checked = 0;
    for (const op of ALL) {
      const built = BUILT.get(op.id)!;
      const absent = NO_YARD_SEATS[op.id] ?? [];
      const authored = LAYOUT_AUTHORED_YARDS[op.id] ?? [];
      for (let seat = 0; seat < built.yards.length; seat++) {
        if (absent.includes(seat) || authored.includes(seat)) continue;
        const got = built.yards[seat];
        if (got.key === null) continue;
        checked++;
        const want = predictYard(built.seats[seat]);
        if (got.x !== want.x || got.z !== want.z) {
          misses.push(
            `${op.id} seat ${seat}: anchor (${built.seats[seat].x}, ${built.seats[seat].z}) `
            + `facing ${built.seats[seat].facingDeg} predicts (${want.x}, ${want.z}), `
            + `landed (${got.x}, ${got.z})`,
          );
        }
      }
    }

    // 70 yards on the shipped 37; one is layout-authored and excluded above.
    expect(checked, 'the sweep must actually reach the yards').toBe(69);
    expect(misses.join('\n') || 'none', [
      'THE YARD OFFSET FROM THE SEAT ANCHOR CHANGED.',
      '',
      '`buildBaseFor` puts the yard at local {0, -4} in both base tables, the yaw is',
      'quantised by `cardinalBaseFacing` before cos/sin, the footprint is 3x3 for all',
      'four armies, and every continental anchor is a multiple of 4 — so the snap adds',
      'exactly (+2, +2) and the offset is four constants keyed on the cardinal yaw:',
      '    yaw   0 -> (+2, -2)      yaw  90 -> (-2, +2)',
      '    yaw 180 -> (+2, +6)      yaw 270 -> (+6, +2)',
      '',
      'If section 2 is ALSO red, the OFFSET moved and every yard-anchored distance in',
      'every campaign header is stale. If section 2 is GREEN and this is red, the',
      'predictor in this file needs updating and nothing in the campaign moved.',
      '',
      'A relocation (`connectedGround`, `footprintClear`, `findClearFootprint`) would',
      'also land here, and that is deliberate: it means something about the GROUND',
      'changed under a base, which is the same class of news.',
    ].join('\n')).toBe('none');
  });

  it('4. the anchor is `islandSeats(startSpots(...))`, not the raw spot', () => {
    // Identity on all 36 continental operations, and NOT identity on the atoll.
    // Anchoring on the raw spot instead is wrong by 16-25 m on `allies.09` and
    // is how a first pass at this came to report three predictor misses.
    let continental = 0;
    let island = 0;
    for (const op of ALL) {
      const built = BUILT.get(op.id)!;
      const same = built.spots.every((s, i) =>
        s.x === built.seats[i].x && s.z === built.seats[i].z);
      if (same) continental++; else island++;
      if (op.map.preset === 'atoll') {
        expect(same, `${op.id} is an atoll: the SEAT must differ from the SPOT`).toBe(false);
      } else {
        expect(same, `${op.id} is continental: `
          + '`islandSeats` must be identity').toBe(true);
      }
    }
    expect([continental, island]).toEqual([36, 1]);
  });
});
