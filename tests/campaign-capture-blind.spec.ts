/**
 * ============================================================================
 * tests/campaign-capture-blind.spec.ts — SHAPE 1 OF THE CAPTURE HAZARD, SWEPT
 * ============================================================================
 * `TODO.md`'s CAPTURE HAZARD SWEEP describes two shapes. Shape 2 — *a capture
 * that must not happen at all* — has had a gate since `OperationDef.captureProof`
 * landed: `tests/campaign-capture-proof.spec.ts` §7 pins the declarers by name,
 * in both directions. **Shape 1 has had none.**
 *
 * Shape 1 is a trigger keyed on `entityDead` / `entityAlive` over a structure a
 * player-controllable engineer can TAKE. `Director.holds` answers `entityDead`
 * with `aliveWithTag(tag) === 0` and `entityAlive` with `> 0`, and **a captured
 * structure is still alive**, so neither condition can see a deed move. It was
 * fixed by hand in six operations when there were seventeen — `soviets.01`,
 * `soviets.03`, `pact.01`, `pact.02`, `reclamation.01` and `pact.04` — by
 * migrating to `ownerCount(foeSeat, tag, max: 0 / min: 1)` behind a settle
 * guard. There are **thirty-seven** now and nothing would catch a new one.
 *
 * ── THE PREDICATE, STATED ────────────────────────────────────────────────────
 * For every `entityDead` / `entityAlive` condition in every trigger of every
 * shipped operation, the tag it names is a HAZARD when, on the operation's own
 * REAL BUILT WORLD:
 *
 *   1. something carrying that tag is a live BUILDING — a unit tag cannot be
 *      captured at all (`Capture.simTick` walks `byKind[Infantry]` and
 *      `isCapturable` refuses a non-`Building` target);
 *   2. at least one such building is NOT friendly to seat 0 by
 *      `CaptureService.isFriendlyTarget`'s own rule — a NEUTRAL owner is never
 *      friendly (rule 1: taken outright at any health), and any other owner is
 *      friendly exactly when `world.areAllied(0, owner)`. A friendly structure
 *      takes the REPAIR branch, which consumes the engineer and **never moves
 *      the deed**, so it cannot make a liveness condition wrong;
 *   3. the tag is not vetoed by `OperationDef.captureProof` (`'all'`, or a list
 *      naming it) — a vetoed click is `refuse()`, which does not consume and
 *      does not flip;
 *   4. and the player has a ROUTE to a `canCapture` unit in that operation.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COVER ─────────────────────────────────────
 *   - **`entityHpBelow`.** Also owner-blind, and also unable to see a capture —
 *     but a capture does not change hp (`Capture.resolve` writes `st.hp` on the
 *     FRIENDLY branch and only there), so the condition means the same thing
 *     before and after. Out of scope by argument, not by oversight.
 *   - **The AI capturing the PLAYER's structures.** `src/sim/AI.ts` issues no
 *     `OrderKind.Capture` at all — CLAUDE.md's capability audit, and
 *     `soviets.08`'s and `pact.05`'s headers both re-derive it — so a
 *     player-owned tag is excluded on the ground that the only actor who could
 *     reach it does not exist. If the brain ever learns the verb, this exclusion
 *     is the first thing to delete.
 *   - **`GarrisonService.enter`.** It calls `captureBuilding()` directly and
 *     consults no `CaptureService` veto (`allies.07.fair-copy`'s finding), so a
 *     Gaia structure a rifleman garrisons changes hands with no engineer
 *     involved. That is a second route to the same world state and this file
 *     does not model it; the flagged set would only GROW if it did.
 *   - **Power.** `census` wants a prereq structure powered as well as standing;
 *     route 3 below checks standing only. At t = 0 of an `opening: 'base'`
 *     operation both hold, and an over-report is the safe direction.
 *   - **Which DIRECTION the blindness hurts.** Whether capture denies a win
 *     (`soviets.03`'s bore-head), keeps a scripted enemy wave coming
 *     (`allies.04`'s muster) or is the operation's own intent
 *     (`reclamation.10`'s exchange) is an AUTHORING question. This file demands
 *     that every pair be DECLARED — by `captureProof` or by a line in the table
 *     below carrying its reason — and does not try to grade them.
 *
 * ── BOTH DIRECTIONS ─────────────────────────────────────────────────────────
 * `DECLARED` is compared to the swept set with `toEqual`, which is the shape
 * `campaign-capture-proof.spec.ts` §7 and `tests/emplacement-band.spec.ts` both
 * use. A NEW capture-blind trigger fails because it is not in the table. An
 * entry that stops being a hazard — the operation migrates to `ownerCount`,
 * declares a `captureProof`, or loses its route to an engineer — fails because
 * the table still names it. Nobody can land half of a pair and walk away.
 *
 * ── WHY A NEW FILE ──────────────────────────────────────────────────────────
 * `campaign-capture-proof.spec.ts` drives the REAL `CaptureService` on a flat
 * synthetic world: it imports no `three`, builds no `Terrain`, and runs in
 * milliseconds. That is what lets it stand an engineer on a structure and read
 * the branch back. This file constructs 37 real `Terrain`s and 37 real worlds
 * and takes tens of seconds, for the reason `campaign-roster-ground.spec.ts`
 * gives: **which structures a layout places, and who owns them, is a fact about
 * the built world** and a regex over layout source gets it wrong. Folding the
 * second into the first would make the fast, surgical file slow. Nothing in
 * `campaign-capture-proof.spec.ts` is weakened, moved or deleted by this file.
 *
 * `buildOperation` below is `campaign-roster-ground.spec.ts`'s, minus its
 * control build. It is duplicated rather than shared for the same reason that
 * file duplicates `campaign-maps.spec.ts`'s: a spec file cannot be imported
 * without running its suites, and moving the builder into a shared module would
 * mean editing two already-gating files to reach it.
 * ========================================================================== */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityFlag, EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId, PlayerId, UnitDef } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, resolveDefBinding, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import type { DefBinding } from '../src/game/Scenarios';
import { campaignRosterActive, setCampaignRoster } from '../src/progression/UnlockGate';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import type { Condition, OperationDef, OperationRoster } from '../src/campaign/types';

/* ==========================================================================
 * THE HARNESS
 * ========================================================================== */

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

/** Seat 0 is the commander in every shipped operation. */
const PLAYER = 0 as PlayerId;

interface Built {
  world: World;
  /** tag -> entities the layout stamped. */
  tags: Map<string, EntityId[]>;
  /** `campaignRosterActive()` sampled INSIDE the layout callback. */
  rosterLive: boolean;
}

function buildOperation(
  op: OperationDef, binding: DefBinding, roster: OperationRoster | null,
): Built {
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

  const tags = new Map<string, EntityId[]>();
  let rosterLive = false;
  const l = LAYOUTS.get(op.layout);
  expect(l, `operation ${op.id} names layout '${op.layout}'`).toBeDefined();

  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  // ARM, THEN BOOT — `Scenarios.ts` asks `isBuildable` WHILE SPAWNING, so a
  // roster installed after the build is a roster the layout never saw.
  setCampaignRoster(roster);
  setCampaignLayout((b, cx, cz, start) => {
    rosterLive = campaignRosterActive();
    l!.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (name, id) => {
        if (id === NONE) return;
        const list = tags.get(name);
        if (list === undefined) tags.set(name, [id]);
        else list.push(id);
      },
      seat: (i) => b.armySlot(i),
    });
  });

  try {
    // `defs` is what makes the roster bite at all: `spawnBuilding` hands
    // `isBuildable` the RESOLVED def and `rosterAllows` returns true for an
    // undefined one.
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies, defs: binding });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    setCampaignRoster(null);
    clearScenario();
    terrain.dispose?.();
  }
  return { world, tags, rosterLive };
}

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);

/* -- reading the trigger table -------------------------------------------- */

interface Liveness { readonly on: 'entityAlive' | 'entityDead'; readonly tag: string }

/** Every `entityAlive`/`entityDead` in a condition tree, under any combinator. */
function livenessConditions(c: Condition, out: Liveness[]): void {
  switch (c.on) {
    case 'entityAlive':
    case 'entityDead':
      out.push({ on: c.on, tag: c.tag });
      break;
    case 'all':
    case 'any':
      for (const k of c.of) livenessConditions(k, out);
      break;
    case 'not':
      livenessConditions(c.of, out);
      break;
    default:
      break;
  }
}

/** tag -> the trigger ids whose `when` reads it as a liveness condition. */
function livenessTags(op: OperationDef): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of op.triggers) {
    const found: Liveness[] = [];
    livenessConditions(t.when, found);
    for (const f of found) {
      const row = out.get(f.tag);
      const label = `${t.id}:${f.on}`;
      if (row === undefined) out.set(f.tag, [label]);
      else if (!row.includes(label)) row.push(label);
    }
  }
  return out;
}

/* -- can the player field an engineer at all? ----------------------------- */

/**
 * Every `canCapture` def a player of `faction` could be offered.
 *
 * `Faction.Neutral` is included because `engineer` IS Neutral — it is the
 * Allied AND the Soviet capture unit, and the shared def is the reason
 * `FACTION_KEY_MAP` has a row for it at all.
 */
function captureDefsFor(binding: DefBinding, faction: Faction): readonly UnitDef[] {
  return (binding.tables?.units ?? []).filter(
    (u) => u.canCapture && (u.faction === faction || u.faction === Faction.Neutral),
  );
}

interface Route { readonly ok: boolean; readonly how: string }

/**
 * Three routes to a capture, in the order a player would find them. Measured
 * off the built world, never off `op.map.opening` — `reclamation.01.held-paper`
 * opens `'force'` and still stands both of the Tinker's prereqs, and
 * `allies.07.fair-copy` opens `'force'` with an engineer already on the ground.
 */
function captureRoute(built: Built, op: OperationDef, binding: DefBinding): Route {
  const st = built.world.store;
  const units = binding.tables?.units ?? [];

  // 1. one is already standing on seat 0.
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.kind[i] !== EntityKind.Infantry) continue;
    if (st.owner[i] !== (PLAYER as number)) continue;
    const d = units[st.defId[i]];
    if (d?.canCapture === true) return { ok: true, how: `'${d.key}' stands on seat 0 at t=0` };
  }

  // 2. a scripted wave hands the player one. The key stays LITERAL through
  //    `EffectSink` — no `keyFor`, no remap — so this is a key comparison.
  for (const t of op.triggers) {
    for (const e of t.then) {
      if (e.do !== 'spawnUnits' || e.player !== (PLAYER as number)) continue;
      const id = binding.unitId[e.key];
      if (id === undefined) continue;
      if (units[id]?.canCapture === true) {
        return { ok: true, how: `${t.id} spawns '${e.key}' for seat 0` };
      }
    }
  }

  // 3. seat 0 stands every prereq of a capture def its faction can be offered,
  //    so it can build one from t = 0. The three `canCapture` defs carry no
  //    `unlockedBy` (asserted in §0), so no roster can withhold them.
  const standing = new Set<string>();
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.kind[i] !== EntityKind.Building) continue;
    if (st.owner[i] !== (PLAYER as number)) continue;
    const d = binding.tables?.buildings[st.defId[i]];
    if (d !== undefined) standing.add(d.key);
  }
  for (const d of captureDefsFor(binding, FACTION_OF[op.chapter])) {
    if (d.prereqs.every((k) => standing.has(k))) {
      return { ok: true, how: `seat 0 stands ${d.prereqs.join(' + ')}, so '${d.key}' is buildable` };
    }
  }
  return { ok: false, how: 'no engineer standing, none scripted, and no prereq set on seat 0' };
}

/* -- the classifier ------------------------------------------------------- */

type Verdict =
  /** The tag reaches nothing at all. `campaign-roster-ground.spec.ts` owns that. */
  | 'no-entity'
  /** Units, not structures. `isCapturable` refuses a non-`Building` target. */
  | 'not-a-building'
  /** `isFriendlyTarget` is true for every carrier: the REPAIR branch, no deed moves. */
  | 'friendly-to-player'
  /** `OperationDef.captureProof` refuses it. `refuse()` neither consumes nor flips. */
  | 'vetoed'
  /** Capturable, but this operation gives the player no route to a capture unit. */
  | 'unreachable'
  | 'hazard';

interface Row {
  readonly op: string;
  readonly tag: string;
  readonly verdict: Verdict;
  readonly triggers: readonly string[];
  readonly detail: string;
}

/** `CaptureService.isFriendlyTarget`, restated over the built world. */
function friendlyToPlayer(built: Built, entityIndex: number): boolean {
  const owner = built.world.store.owner[entityIndex];
  const p = built.world.players[owner];
  // A NEUTRAL owner is never friendly, even though Gaia is allied to everybody
  // — that is exactly the line `isFriendlyTarget` draws, and it is what makes a
  // Gaia structure rule 1 (taken outright, at any health) rather than a repair.
  if (p === undefined || p.faction === Faction.Neutral) return false;
  return built.world.areAllied(PLAYER, owner as PlayerId);
}

function vetoes(op: OperationDef, tag: string): boolean {
  const cp = op.captureProof;
  if (cp === undefined) return false;
  return cp === 'all' || cp.includes(tag);
}

function classify(
  built: Built, op: OperationDef, binding: DefBinding, tag: string, triggers: readonly string[],
): Row {
  const st = built.world.store;
  const ids = built.tags.get(tag) ?? [];
  const row = (verdict: Verdict, detail: string): Row => (
    { op: op.id, tag, verdict, triggers, detail }
  );

  const takeable: string[] = [];
  let liveBuildings = 0;
  let anyLive = 0;
  for (const id of ids) {
    const i = st.index(id);
    if (i < 0 || (st.flags[i] & EntityFlag.Alive) === 0) continue;
    anyLive++;
    if (st.kind[i] !== EntityKind.Building) continue;
    liveBuildings++;
    if (friendlyToPlayer(built, i)) continue;
    const d = binding.tables?.buildings[st.defId[i]];
    const owner = st.owner[i];
    const p = built.world.players[owner];
    const kindOfOwner = p?.faction === Faction.Neutral ? 'GAIA' : `seat ${String(owner)}`;
    takeable.push(`'${d?.key ?? '?'}' (${kindOfOwner})`);
  }

  if (anyLive === 0) return row('no-entity', 'nothing alive carries this tag');
  if (liveBuildings === 0) return row('not-a-building', 'every carrier is a unit');
  if (takeable.length === 0) {
    return row(
      'friendly-to-player', 'every carrier is allied to seat 0: the repair branch, no deed moves',
    );
  }
  const what = takeable.join(', ');
  if (vetoes(op, tag)) return row('vetoed', `captureProof refuses it; carriers: ${what}`);
  const route = captureRoute(built, op, binding);
  if (!route.ok) return row('unreachable', `${route.how}; carriers: ${what}`);
  return row('hazard', `${what} — ${route.how}`);
}

/* ==========================================================================
 * THE DECLARED TABLE
 *
 * Every capture-blind pair the shipped campaign contains, with the reason it
 * is allowed to stay. Where the operation argues the case at its own trigger,
 * the entry cites it; where it does not, the entry SAYS SO, because a reason
 * this table invented is not the same thing as a reason the author wrote.
 * ========================================================================== */

const DECLARED: Readonly<Record<string, string>> = {
  /* -- documented at the trigger, migration deliberately refused ---------- */

  'soviets.03.deep-sector/tap':
    "t.headBlown, `entityDead 'tap'` on the Ninth's bore-head. The trigger's own block: "
    + '"THE LAST `entityDead` IN THIS FILE, AND IT IS NOT AN OVERSIGHT... this one counts a '
    + 'corpse because its whole text is a correction to somebody who made a wreck. Migrating it '
    + 'to `ownerCount` would fire a demolition line at a player who walked an engineer in and '
    + 'has the bore-head standing in front of them."',

  'soviets.05.short-allocation/alliedTap':
    "t.tapDown, `entityDead 'alliedTap'`. The trigger's own block: the player CAN capture it "
    + 'instead, that takes the income off the Ninth exactly as levelling does, "and the objective '
    + 'still reads as unmet, because the objective is the FILING... The title says level it."',

  'soviets.07.right-of-entry/register':
    "t.burnt, `entityDead`. The trigger's own block: \"`entityDead` is the right condition rather "
    + 'than `ownerCount`: a block the player has CAPTURED is still alive and still counts, and '
    + 'only its destruction ends this."',
  'soviets.07.right-of-entry/counterpart':
    't.burnt, the second half of the same `any` and the other block of the pair. Same trigger, '
    + 'same block, same reason: capturing a block does not stop it being a block, and only its '
    + 'destruction makes the entry impossible.',

  'soviets.08.carriage-forward/tapEast':
    "t.tapsMissed, `entityDead` on a GAIA derrick the operation wants CAPTURED — the `taps` "
    + "objective is `ownerCount(0, 'building', 'taps', min: 2)` and the operation scripts three "
    + '`engineer` waves for seat 0. `entityDead` here means destroyed, which is the one fate the '
    + 'ownership count cannot express. Its header audits the capture question at length.',
  'soviets.08.carriage-forward/tapWest':
    't.tapsMissed, the other derrick of the same pair, read through the same `any`. Same '
    + 'trigger, same reason: the objective counts DEEDS and this clause counts a corpse, which '
    + 'is the one fate an ownership count cannot express.',

  'allies.02.instrument-room/office':
    "t.razed and t.levelled, `entityDead` on a GAIA block the operation exists to CAPTURE (`take` "
    + "is `structureCaptured('office', 0)`). The trigger block: \"Before the capture the office is "
    + 'neutral and no Soviet gun can target it... After the capture it is an Allied building in a '
    + 'Soviet district and losing it is the ordinary way this goes wrong."',

  'allies.05.forced-closure/hall':
    "t.intactLost, `entityDead` on the hall. Capture is one of the operation's two stated routes "
    + '("TAKE IT. `Capture.ts` rule 2..." — the header prices the four-engineer ladder 1100 -> 880 '
    + '-> 660 -> 440), and `t.win` counts DEEDS. Only destruction ends it, which is what this '
    + 'trigger asks.',

  'allies.07.fair-copy/arc':
    "t.arcLost, `entityDead` on a GAIA relay block the operation exists to CAPTURE — `t.arcTaken` "
    + "is `structureCaptured('arc', 0)`. The header derives rule 1 and the Gaia branch in full.",
  'allies.07.fair-copy/yards':
    "t.yardsLost, the second relay block, with `t.yardsTaken` as its `structureCaptured` twin. "
    + 'Same operation, same shape, same header — which also records the door this leaves open: '
    + '`GarrisonService.enter` captures a Gaia host directly and no `CaptureService` veto sees it.',

  'allies.08.standing-order/head':
    "t.headLost, `entityDead` on a GAIA block head the operation exists to CAPTURE. Its header: "
    + '"The block head is GAIA, which by `Capture.ts` rule 1 means **one engineer**", and the '
    + 'trigger block adds "The moment it is captured it is an ordinary Allied building".',

  'pact.01.shallow-road/bore':
    "t.boreLost, `entityDead 'bore'`. The trigger's own block: \"THE LAST `entityDead` IN THIS "
    + 'FILE, AND IT IS NOT AN OVERSIGHT... the pair partitions the head\'s fates between them" — '
    + "its completion half is `structureCaptured('bore', 0)` and this is the destruction half.",

  'pact.05.open-count/oculus':
    "t.hallLost, `entityDead 'oculus'`. The header states \"**`oculus` in the loss — `entityDead`, "
    + 'and here it is correct**" under a section headed EVERY TRIGGER WAS CHECKED FOR '
    + 'CAPTURE-BLINDNESS, and a separate block explains why the operation needs no `captureProof`.',

  'reclamation.10.without-recourse/exchange':
    "t.posts, t.callCounter, t.broken, t.rout and t.yardsEnd. The operation's FIRST primary is "
    + "`structureCaptured('exchange', 0)` — `exchange` is deliberately left OUT of its "
    + '`captureProof` list, which `campaign-capture-proof.spec.ts` §7 records — so `entityAlive` '
    + 'staying true through a capture is the intent, and `entityDead` is destruction.',

  /* -- NOT argued by the operation. Reported, not fixed. ------------------ */

  'allies.04.misclosure/muster':
    'REPORTED, NOT FIXED. `muster` is the SOVIET forward barracks on seat 1 and nothing in the '
    + 'file mentions capture anywhere near it. An Allied `engineer` stands on seat 0 at t=0, so '
    + 'the four-engineer ladder is available: a captured muster is alive, so t.musterDown never '
    + 'completes the 500-credit secondary, t.musterStanding FAILS it at 16:00, and t.col3 / '
    + "t.col4 keep spawning Soviet columns off `MUSTER_UP` from a barracks on the player's own "
    + 'books, with Wend saying "The muster is still forming them". Migration is an authoring '
    + 'decision — the title reads "Level the Soviet forward muster" — so it is declared here '
    + 'rather than changed under a test.',

  'pact.01.shallow-road/gun':
    'REPORTED, NOT FIXED. t.wade reads `entityAlive` over the two ENEMY emplacements at the cut, '
    + 'to mean "while the cut is still standing". A captured emplacement is still standing, so '
    + 'the reading is defensible — but the objective pays for going ROUND rather than through, '
    + 'and the file argues capture-blindness for `mast` and `bore` and not for this one.',

  'reclamation.03.sold-twice/post':
    'REPORTED, NOT FIXED. t.posts completes a 500-credit secondary on `entityDead` over two ENEMY '
    + 'pillboxes; an `rclTinker` stands on seat 0 at t=0. Capturing a post costs four Tinkers '
    + '(2000 credits) to deny yourself 500, so the play is self-punishing rather than tempting — '
    + "but the file argues the capture question only about the AI (\"`AiBrain` never issues "
    + '`OrderKind.Capture` at all"), never about the player.',
};

/**
 * Operations where no route to a `canCapture` unit exists, so no liveness
 * condition in them can be shape 1.
 *
 * Pinned by name rather than left implicit: an operation that GAINS a route
 * (a scripted engineer wave, a barracks in its opening) turns every liveness
 * condition it holds into a candidate on the same commit, and that should be a
 * failure with a name on it rather than a surprise.
 */
const NO_CAPTURE_ROUTE: readonly string[] = [
  // `opening: 'force'`, no base and no scripted engineer for seat 0.
  'reclamation.04.served-notice',
  'soviets.02.common-standard',
];

/* ==========================================================================
 * THE BUILDS
 * ========================================================================== */

let binding: DefBinding;
const BUILT = new Map<string, Built>();

beforeAll(async () => {
  binding = await resolveDefBinding();
  for (const op of ALL) BUILT.set(op.id, buildOperation(op, binding, op.roster));
}, 600_000);

afterAll(() => {
  // Belt and braces: `buildOperation` clears in its own `finally`, but a roster
  // leaked out of this file fails in whatever spec shares the worker next.
  setCampaignRoster(null);
});

const built = (op: OperationDef): Built => {
  const b = BUILT.get(op.id);
  if (b === undefined) throw new Error(`${op.id} was never built`);
  return b;
};

function sweep(): Row[] {
  const rows: Row[] = [];
  for (const op of ALL) {
    const b = built(op);
    for (const [tag, triggers] of livenessTags(op)) {
      rows.push(classify(b, op, binding, tag, triggers));
    }
  }
  return rows;
}

let ROWS: Row[] = [];
beforeAll(() => { ROWS = sweep(); });

const keyOf = (r: Row): string => `${r.op}/${r.tag}`;

/* ==========================================================================
 * 0. THE GUARD ON THE GUARD
 *
 * Every claim below is of the form "on the real built world, X". Four ways it
 * becomes vacuous: nothing to sweep, an unbound def binding (every `canCapture`
 * reads `undefined`, so route 1 and route 3 both answer no and everything is
 * `unreachable`), a roster that was not armed when the layout ran, and a
 * capture unit that a roster could withhold after all.
 * ========================================================================== */

describe('the harness is in the state the rest of this file claims', () => {
  it('there are operations, and every one of them built', () => {
    expect(ALL.length).toBeGreaterThan(0);
    expect(BUILT.size).toBe(ALL.length);
  });

  it('the def tables are BOUND, or nothing can be read back off the store', () => {
    expect(binding.tables, 'resolveDefBinding() found no DefTables under src/data/**').not.toBeNull();
    expect(Object.keys(binding.unitId).length).toBeGreaterThan(0);
  });

  it('the roster was live inside every layout callback', () => {
    const cold = ALL.filter((op) => !built(op).rosterLive).map((o) => o.id);
    expect(
      cold,
      'the roster was armed after the build for these, which is the ordering '
      + '`campaign-install.ts` refuses — and a build without it stands structures the real '
      + 'operation does not have',
    ).toEqual([]);
  });

  it('every playable army has a canCapture def and NO roster can withhold one', () => {
    /*
     * THE PREMISE OF THE WHOLE FILE, MEASURED RATHER THAN QUOTED FROM `TODO.md`.
     * If any of the three carried an `unlockedBy`, an operation could withhold
     * it through `roster.player` and route 3 would be wrong for that operation.
     */
    const caps = (binding.tables?.units ?? []).filter((u) => u.canCapture);
    expect(caps.map((u) => u.key).sort()).toEqual(['engineer', 'mrdArtificer', 'rclTinker']);
    expect(
      caps.filter((u) => u.unlockedBy !== undefined && u.unlockedBy !== '').map((u) => u.key),
      'a canCapture def gained an `unlockedBy`, so `OperationRoster` can now withhold it and '
      + 'route 3 of `captureRoute` is no longer sound — teach it the roster',
    ).toEqual([]);
    for (const f of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      expect(captureDefsFor(binding, f).length, `faction ${String(f)} has no capture unit`)
        .toBeGreaterThan(0);
    }
  });

  it('the sweep read something, and read it from more than one operation', () => {
    expect(ROWS.length).toBeGreaterThan(0);
    expect(new Set(ROWS.map((r) => r.op)).size).toBeGreaterThan(1);
  });
});

/* ==========================================================================
 * 1. THE CLASSIFIER IS NOT A CONSTANT
 *
 * `toEqual` against a table is satisfied by a classifier that answers `hazard`
 * for exactly the listed pairs FOR THE WRONG REASON — including one that has
 * stopped being able to say anything else. Each exclusion is therefore required
 * to be REACHED by the shipped campaign, which is the same argument
 * `campaign-roster-ground.spec.ts` makes for its control build.
 * ========================================================================== */

describe('every branch of the classifier is exercised by the shipped campaign', () => {
  const reached = (v: Verdict): Row[] => ROWS.filter((r) => r.verdict === v);
  const names = (v: Verdict): string[] => reached(v).map(keyOf).sort();

  it('some liveness tag is a unit, so `not-a-building` is a real answer', () => {
    // `allies.01`'s three surveyors and `pact.03`'s four bearers. A structure
    // test that had rotted into "always true" would show up here.
    expect(names('not-a-building').length, JSON.stringify(names('not-a-building'))).toBeGreaterThan(0);
  });

  it("some liveness tag is the player's OWN structure, so the friendly branch is reached", () => {
    expect(names('friendly-to-player').length, JSON.stringify(names('friendly-to-player')))
      .toBeGreaterThan(0);
  });

  it('some liveness tag is refused by captureProof, so the two gates really do interlock', () => {
    /*
     * The interlock with `campaign-capture-proof.spec.ts` §7, and it is the
     * reason this file does not re-derive the veto: an operation that DROPS its
     * `captureProof` fails there by roster AND appears here as a new hazard.
     */
    expect(names('vetoed').length, JSON.stringify(names('vetoed'))).toBeGreaterThan(0);
  });

  it('some capturable tag is unreachable, so route detection is not stuck on `true`', () => {
    expect(names('unreachable').length, JSON.stringify(names('unreachable'))).toBeGreaterThan(0);
  });

  it('and no tag was stamped on nothing, which is a different file\'s failure', () => {
    // `campaign-roster-ground.spec.ts` owns this and says so much better. It is
    // asserted here only because a `no-entity` row would silently take a pair
    // out of the sweep, so the table below would go green for a bad reason.
    expect(
      names('no-entity'),
      'a liveness condition names a tag nothing carries. That is a layout/roster fault — see '
      + 'tests/campaign-roster-ground.spec.ts — and until it is fixed this file cannot classify '
      + 'the pair at all.',
    ).toEqual([]);
  });

  it('and the operations with no route to an engineer are the ones we think they are', () => {
    const noRoute = ALL
      .filter((op) => !captureRoute(built(op), op, binding).ok)
      .map((o) => o.id)
      .sort();
    expect(
      noRoute,
      'an operation gained or lost its route to a `canCapture` unit. Gaining one turns every '
      + '`entityDead`/`entityAlive` it holds into a shape-1 candidate; losing one retires the '
      + 'entries this file declares for it. Either way, re-read the table below.',
    ).toEqual([...NO_CAPTURE_ROUTE].sort());
  });
});

/* ==========================================================================
 * 2. THE SWEEP — every capture-blind pair in the shipped campaign, declared
 * ========================================================================== */

describe('every capture-blind liveness condition is declared', () => {
  it('the swept set is exactly the declared set', () => {
    const hazards = ROWS.filter((r) => r.verdict === 'hazard');
    const found = hazards.map(keyOf).sort();
    const declared = Object.keys(DECLARED).sort();

    const detail = hazards
      .map((r) => `  ${keyOf(r)}  [${r.triggers.join(', ')}]  ${r.detail}`)
      .sort()
      .join('\n');

    expect(
      found,
      'A trigger reads `entityDead`/`entityAlive` over a structure a player-controllable '
      + 'engineer can TAKE, and `Director.holds` answers both by counting LIVE entities — so the '
      + 'condition cannot see a deed move.\n\n'
      + 'A pair here and NOT in DECLARED is a new capture-blind trigger. Either migrate it to '
      + '`ownerCount(foeSeat, tag, max: 0 / min: 1)` behind a settle guard (the '
      + '`soviets.06.demolition-order` pattern — it CHANGES WHAT THE OBJECTIVE MEANS, so the '
      + 'title usually needs rewording), or declare `OperationDef.captureProof` if the capture '
      + 'must not happen at all, or add a line to DECLARED saying why the blindness is correct.\n'
      + 'A pair in DECLARED and NOT here has stopped being a hazard — delete its line.\n\n'
      + `the ${String(hazards.length)} capture-blind pairs on the built worlds:\n${detail}`,
    ).toEqual(declared);
  });

  it('and every declared pair carries a reason somebody wrote', () => {
    for (const [key, why] of Object.entries(DECLARED)) {
      expect(why.length, `${key} is declared with no reason`).toBeGreaterThan(80);
    }
  });

  it('the three not argued by their own operation are named, and only those three', () => {
    /*
     * THE HALF THAT KEEPS THE TABLE HONEST. Fourteen of the seventeen entries quote
     * the operation's own block; three quote nothing, because the operation says
     * nothing. Splitting them out means a future reader can tell "reviewed and
     * correct" from "reviewed and left alone", and adding a fourth silent one
     * costs an edit here rather than a sentence nobody checks.
     */
    const undeclared = Object.entries(DECLARED)
      .filter(([, why]) => why.startsWith('REPORTED, NOT FIXED'))
      .map(([k]) => k)
      .sort();
    expect(undeclared).toEqual([
      'allies.04.misclosure/muster',
      'pact.01.shallow-road/gun',
      'reclamation.03.sold-twice/post',
    ]);
  });
});
