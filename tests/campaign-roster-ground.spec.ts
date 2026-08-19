/**
 * ============================================================================
 * tests/campaign-roster-ground.spec.ts — every operation, built with the def
 * tables BOUND and its OWN roster INSTALLED, and checked against the ground
 * ============================================================================
 * THE GAP THIS CLOSES, AND WHY NEITHER EXISTING FILE COULD SEE IT
 * ---------------------------------------------------------------
 * A campaign `roster` is an ALLOW-LIST that `UnlockGate` consults AHEAD of the
 * PvP suppression flag and ahead of the installed gate, so tagged-and-unlisted
 * means REFUSED. `ScenarioBuilder.spawnBuilding` and `.spawnUnit` both call
 * `isBuildable` and SILENTLY RETURN `NONE` on a refusal — no throw, no log, the
 * layout simply has a gap. So a single wrong or missing id in an operation's
 * roster deletes a structure, the layout's `c.tag(...)` call is handed `NONE`
 * and ignores it, and `entityDead` on that tag reads TRUE from tick one. The
 * player fails an objective they never saw, or finishes one whose target was
 * never on the map.
 *
 * Two files look like they cover this and neither does:
 *
 *   - `tests/campaign-maps.spec.ts` builds every operation for real and checks
 *     the tag declaration in both directions — but its `buildOperation` NEVER
 *     CALLS `setCampaignRoster` and passes NO `defs`. Both halves matter, and
 *     the second is the less obvious one: `spawnBuilding` hands `isBuildable`
 *     the resolved `BuildingDef`, which is `undefined` under the empty binding,
 *     and `rosterAllows` returns TRUE for an undefined def. So that file is
 *     doubly unable to see a roster: none is armed, and nothing it builds
 *     carries an `unlockedBy` for one to read. Every structure lands and every
 *     tag stamps whatever the roster says.
 *   - `tests/campaign-roster.spec.ts` proves the GATE's semantics — precedence,
 *     two lists, snapshotting — against ONE synthetic roster, and never loops
 *     the shipped operations. Its own header says so.
 *
 * WHY A NEW FILE RATHER THAN AN EXTENSION OF `campaign-roster.spec.ts`
 * -------------------------------------------------------------------
 * That file is a pure unit spec of `UnlockGate`: it imports no `three`, builds
 * no world, and runs in milliseconds, which is what lets it check precedence by
 * COUNTING READS of a spy gate. This file constructs 34 real `Terrain`s and 34
 * real worlds and takes tens of seconds. Folding the second into the first
 * would make the fast, surgical file slow and would put its teardown discipline
 * (three module-level flags, cleared after every case) in the same worker as a
 * builder that arms a fourth. They are two questions — "does the gate resolve
 * the roster first" and "does the shipped ground survive the roster" — and they
 * fail for different reasons. Nothing in `campaign-roster.spec.ts` is weakened,
 * moved or deleted by this file.
 *
 * WHAT IS ASSERTED HERE
 * ---------------------
 *   1. every tag the layout DECLARES still lands, with the roster in force —
 *      `campaign-maps.spec.ts`'s check, run under the one condition that makes
 *      it able to fail;
 *   2. every tag a TRIGGER names is stamped by something on the real ground;
 *   3. every tag that DECIDES an objective is stamped, reported per objective;
 *   4. nothing the roster forbids is standing — with a CONTROL that proves the
 *      check can tell a rostered build from an unrostered one;
 *   5. the roster is provably armed at the moment the layout runs.
 *
 * THE DIAGNOSIS IS THE POINT, NOT THE ASSERTION
 * ---------------------------------------------
 * Every operation is built TWICE — once with its roster and once without — for
 * one reason: a failure message that says "tag missing" makes the next person
 * redo this work. When a tag is missing under the roster and present without
 * it, the control build still holds the entity, so this file can read its
 * `defId` back through the bound tables and name the def key, its `unlockedBy`,
 * the seat, and the roster list that is missing the id. And when a tag is
 * missing in BOTH builds, it says that too — that is a layout or placement
 * fault of the kind `campaign-maps.spec.ts` owns, and the roster is innocent.
 * ========================================================================== */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityKind, Faction, NONE } from '../src/core/types';
import type { BuildableDef, EntityId } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, resolveDefBinding, setCampaignLayout,
  setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import type { DefBinding } from '../src/game/Scenarios';
import { campaignRosterActive, setCampaignRoster } from '../src/progression/UnlockGate';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { tagsUsedByCondition } from '../src/campaign/validate';
import type { OperationDef, OperationRoster } from '../src/campaign/types';

/* ==========================================================================
 * THE HARNESS
 *
 * `buildOperation` is `campaign-maps.spec.ts`'s builder, arming order and all —
 * plan, then layout, then the world — plus the two things that file leaves out
 * and that this file exists for: the resolved def binding, and the operation's
 * own roster.
 * ========================================================================== */

const FACTION_OF: Readonly<Record<string, Faction>> = {
  soviets: Faction.Soviets,
  allies: Faction.Allies,
  pact: Faction.Meridian,
  reclamation: Faction.Reclaim,
};

interface Built {
  world: World;
  /** tag -> entities the layout stamped. */
  tags: Map<string, EntityId[]>;
  /**
   * `campaignRosterActive()` sampled INSIDE the layout callback.
   *
   * The whole file rests on the roster being live at the moment the world is
   * dressed, and "we called `setCampaignRoster` first" is a claim about this
   * file rather than about the build. Sampling it where `spawnBuilding` reads
   * it turns that into a measurement — and it is what makes the control build
   * below a real control rather than a second copy of the same thing.
   */
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
  // ARM, THEN BOOT. `campaign-install.ts` states the order and the reason:
  // `Scenarios.ts` asks `isBuildable` WHILE SPAWNING THE STARTING ARMY, so a
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
    // `defs` is the half `campaign-maps.spec.ts` omits, and without it the
    // roster is INERT: `spawnBuilding` resolves `def` to `undefined` under the
    // empty binding and `rosterAllows` returns true for an undefined def.
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies, defs: binding });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    // MODULE-LEVEL STATE, CLEARED ON THE FAILING PATH TOO. A roster left armed
    // does not fail here — it fails in whatever spec file shares this worker's
    // module graph next, and that failure gets blamed on the wrong file.
    setCampaignRoster(null);
    clearScenario();
    terrain.dispose?.();
  }
  return { world, tags, rosterLive };
}

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);

/* -- reading a def back off the store ------------------------------------- */

function defAt(binding: DefBinding, kind: number, defId: number): BuildableDef | undefined {
  const t = binding.tables;
  if (t === null || defId < 0) return undefined;
  return kind === EntityKind.Building ? t.buildings[defId] : t.units[defId];
}

type SeatList = 'player' | 'ai';

/** Which of the operation's two lists a seat resolves against. */
function listFor(built: Built, owner: number): SeatList {
  return built.world.player(owner as never).isHuman ? 'player' : 'ai';
}

/**
 * `rosterAllows`, restated. Deliberately a SECOND implementation rather than an
 * import: if it were the same function, "nothing the roster forbids is
 * standing" would be true by construction and would measure nothing. The
 * control build is what keeps it honest — it is the same predicate over a world
 * built WITHOUT the roster, and it must find violations there or section 4 is
 * vacuous.
 */
function refusedBy(roster: OperationRoster, def: BuildableDef | undefined, seat: SeatList): boolean {
  const id = def?.unlockedBy;
  if (id === undefined || id === '') return false;
  return !roster[seat].includes(id);
}

interface Standing {
  key: string;
  unlockedBy: string;
  seat: SeatList;
  owner: number;
}

/** Every alive entity whose def the operation's roster refuses for its owner. */
function forbiddenStanding(built: Built, op: OperationDef, binding: DefBinding): Standing[] {
  const st = built.world.store;
  const out: Standing[] = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    const k = st.kind[i];
    if (k !== EntityKind.Building && k !== EntityKind.Infantry && k !== EntityKind.Vehicle) continue;
    // Gaia's props and civilian structures are seeded by the scenario rather
    // than by a seat's build order, and they are untagged content — but the
    // faction test is here rather than left to `unlockedBy` so that a Gaia def
    // gaining a tag one day reports as a scenario question and not as a
    // campaign-authoring fault.
    if (st.faction[i] === Faction.Neutral) continue;
    const def = defAt(binding, k, st.defId[i]);
    const seat = listFor(built, st.owner[i]);
    if (!refusedBy(op.roster, def, seat)) continue;
    out.push({
      key: def?.key ?? `defId ${String(st.defId[i])}`,
      unlockedBy: def?.unlockedBy ?? '',
      seat,
      owner: st.owner[i],
    });
  }
  return out;
}

/** Tags a `spawnUnits` effect produces are not the layout's to place. */
function spawnedTags(op: OperationDef): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of op.triggers) {
    for (const e of t.then) if (e.do === 'spawnUnits' && e.tag !== undefined) out.add(e.tag);
  }
  return out;
}

/* -- the diagnosis -------------------------------------------------------- */

/**
 * Why is `tag` missing from the rostered build?
 *
 * Answered by reading the CONTROL build, which still holds the entity the
 * roster deleted. That is what turns "tag missing" into the def key, the seat
 * and the exact roster list that needs the id.
 */
function diagnose(
  op: OperationDef, tag: string, rosteredBuilt: Built, controlBuilt: Built, binding: DefBinding,
): string {
  const head = `${op.id}: tag '${tag}' (layout '${op.layout}') was stamped on NOTHING `
    + "with the operation's own roster installed.";

  const inControl = controlBuilt.tags.get(tag) ?? [];
  if (inControl.length === 0) {
    return `${head} The SAME build WITHOUT the roster does not stamp it either, so the roster `
      + 'is NOT the cause — this is a layout or placement fault of the kind '
      + 'tests/campaign-maps.spec.ts owns (wrong def key, footprint that will not fit, '
      + 'ground under water).';
  }

  const st = controlBuilt.world.store;
  const culprits: string[] = [];
  for (const id of inControl) {
    const i = st.index(id);
    if (i < 0) continue;
    const def = defAt(binding, st.kind[i], st.defId[i]);
    const seat = listFor(controlBuilt, st.owner[i]);
    const unlock = def?.unlockedBy ?? '';
    const key = def?.key ?? `defId ${String(st.defId[i])}`;
    if (unlock === '') {
      culprits.push(`'${key}' (seat ${String(st.owner[i])}, ${seat}) carries NO unlockedBy, `
        + 'so no roster could have refused it');
      continue;
    }
    const listed = op.roster[seat].includes(unlock);
    culprits.push(
      `'${key}' carries unlockedBy '${unlock}' and roster.${seat} is `
      + `[${op.roster[seat].join(', ')}]${listed ? ' — which DOES list it' : ` — WHICH IS MISSING '${unlock}'`}`,
    );
  }

  return `${head} The same build WITHOUT the roster stamps it on ${String(inControl.length)} `
    + `entity(ies), so THE ROSTER DELETED IT: ${culprits.join('; ')}. `
    + 'Add the id to that list in the operation file, or stop tagging that structure — '
    + '`ScenarioBuilder.spawnBuilding` returns NONE on a refusal and `LayoutContext.tag` '
    + 'ignores NONE, so the whole failure is silent at runtime and `entityDead` on this tag '
    + 'reads TRUE from tick one.';
}

/* ==========================================================================
 * THE BUILDS
 * ========================================================================== */

let binding: DefBinding;
const ROSTERED = new Map<string, Built>();
const CONTROL = new Map<string, Built>();

beforeAll(async () => {
  binding = await resolveDefBinding();
  for (const op of ALL) {
    ROSTERED.set(op.id, buildOperation(op, binding, op.roster));
    CONTROL.set(op.id, buildOperation(op, binding, null));
  }
}, 600_000);

afterAll(() => {
  // Belt and braces: `buildOperation` clears in its own `finally`, but this
  // file is the one that arms a roster at all and a leak out of it is silent.
  setCampaignRoster(null);
});

const rostered = (op: OperationDef): Built => {
  const b = ROSTERED.get(op.id);
  if (b === undefined) throw new Error(`${op.id} was never built`);
  return b;
};
const control = (op: OperationDef): Built => {
  const b = CONTROL.get(op.id);
  if (b === undefined) throw new Error(`${op.id} has no control build`);
  return b;
};

/* ==========================================================================
 * 0. THE GUARD ON THE GUARD
 *
 * Every claim below is of the form "with the roster in force, X". Three ways
 * that becomes vacuous without anybody noticing: no operations to loop, an
 * unbound def binding (which makes every `unlockedBy` `undefined` and the
 * roster inert), and a roster that is not actually armed when the layout runs.
 * ========================================================================== */

describe('the harness is in the state the rest of this file claims', () => {
  it('there are operations to build', () => {
    expect(ALL.length).toBeGreaterThan(0);
  });

  it('the def tables are BOUND, or the roster reads `undefined` and allows everything', () => {
    // This is the half `campaign-maps.spec.ts` omits, and it is not cosmetic:
    // `spawnBuilding` passes the RESOLVED def to `isBuildable`, and
    // `rosterAllows` returns true for `undefined`. An unbound binding turns
    // every assertion in this file green for the wrong reason.
    expect(binding.tables, 'resolveDefBinding() found no DefTables under src/data/**').not.toBeNull();
    expect(Object.keys(binding.buildingId).length).toBeGreaterThan(0);
  });

  it('some def in the bound tables actually carries an unlockedBy', () => {
    const tagged = [...(binding.tables?.buildings ?? []), ...(binding.tables?.units ?? [])]
      .filter((d) => typeof d.unlockedBy === 'string' && d.unlockedBy !== '');
    expect(tagged.length, 'nothing is tagged, so no roster can restrict anything').toBeGreaterThan(0);
  });

  for (const op of ALL) {
    it(`${op.id}: the roster is live at the moment its layout runs`, () => {
      expect(
        rostered(op).rosterLive,
        'campaignRosterActive() was false inside the layout callback — the roster was armed '
        + 'after the build, which is exactly the ordering `campaign-install.ts` refuses',
      ).toBe(true);
      // ...and the control really is a control.
      expect(control(op).rosterLive, 'the control build must NOT have a roster armed').toBe(false);
    });
  }
});

/* ==========================================================================
 * 1. THE GROUND, UNDER THE ROSTER
 * ========================================================================== */

describe('every operation builds a world its triggers can read, WITH its own roster', () => {
  for (const op of ALL) {
    describe(op.id, () => {
      it('every declared tag landed on something', () => {
        const l = LAYOUTS.get(op.layout);
        const spawned = spawnedTags(op);
        const b = rostered(op);
        for (const tag of l?.tags ?? []) {
          if (spawned.has(tag)) continue;
          expect(
            (b.tags.get(tag)?.length ?? 0) > 0,
            diagnose(op, tag, b, control(op), binding),
          ).toBe(true);
        }
      });

      it('every tag a trigger names was stamped or is spawned', () => {
        const named = new Set<string>();
        for (const t of op.triggers) {
          tagsUsedByCondition(t.when, named);
          for (const e of t.then) if (e.do === 'orderTagged') named.add(e.tag);
        }
        const spawned = spawnedTags(op);
        const b = rostered(op);
        for (const tag of named) {
          if (spawned.has(tag)) continue;
          expect(b.tags.has(tag), diagnose(op, tag, b, control(op), binding)).toBe(true);
        }
      });

      /*
       * THE OBJECTIVE-SCOPED VIEW OF THE SAME GROUND.
       *
       * The two checks above are stated in the layout's and the trigger table's
       * vocabulary. This one is stated in the PLAYER's: an objective is a line
       * of text on the HUD, and the question is whether the thing it is about
       * exists. A missing tag under an objective is the failure that reads as
       * "I won without doing anything" or "I lost at tick one"; naming the
       * objective in the message is what connects the two.
       */
      it('every tag that decides an objective is on the ground', () => {
        const b = rostered(op);
        const spawned = spawnedTags(op);
        for (const obj of op.objectives) {
          const deciding = op.triggers.filter((t) => t.then.some(
            (e) => (e.do === 'completeObjective' || e.do === 'failObjective') && e.id === obj.id,
          ));
          const named = new Set<string>();
          for (const t of deciding) tagsUsedByCondition(t.when, named);
          for (const tag of named) {
            if (spawned.has(tag)) continue;
            expect(
              b.tags.has(tag),
              `${op.id}: objective '${obj.id}' ("${obj.title}") is decided by tag '${tag}', `
              + `and ${diagnose(op, tag, b, control(op), binding)}`,
            ).toBe(true);
          }
        }
      });

      it('every seated army still opens with at least one asset under the roster', () => {
        // The roster restricts BOTH seats, and an over-tight `player` list is
        // just as shippable as an over-tight `ai` one. Nothing untagged can be
        // refused, so a seat with nothing at all means the roster reached
        // something structural.
        const st = rostered(op).world.store;
        const owned = new Map<number, number>();
        for (let a = 0; a < st.aliveCount; a++) {
          const i = st.alive[a];
          const k = st.kind[i];
          if (k !== EntityKind.Building && k !== EntityKind.Infantry && k !== EntityKind.Vehicle) {
            continue;
          }
          owned.set(st.owner[i], (owned.get(st.owner[i]) ?? 0) + 1);
        }
        for (let seat = 0; seat < op.map.armies; seat++) {
          expect(
            owned.get(seat) ?? 0,
            `seat ${String(seat)} of ${op.id} opens with nothing once its roster is applied`,
          ).toBeGreaterThan(0);
        }
      });
    });
  }
});

/* ==========================================================================
 * 2. THE ROSTER IS VISIBLY IN FORCE
 *
 * Section 1 asks whether the ground survived the roster. This asks the
 * opposite question — whether the roster did anything at all — because a
 * harness that silently failed to install one would pass every check above.
 *
 * The assertion and its falsifier are the same predicate over two builds. The
 * rostered world must hold nothing the roster refuses; the CONTROL world must
 * hold something it refuses, or the first claim is satisfiable by an empty
 * roster, an inert binding or a broken `isBuildable`.
 * ========================================================================== */

describe('the roster reaches the world it is installed for', () => {
  for (const op of ALL) {
    it(`${op.id}: nothing the roster refuses is standing`, () => {
      const standing = forbiddenStanding(rostered(op), op, binding);
      expect(
        standing.map((s) => `${s.key} (unlockedBy '${s.unlockedBy}', seat ${String(s.owner)}, `
          + `resolved against roster.${s.seat})`),
        `${op.id}: these stood up despite the roster refusing them. Either the roster was not `
        + 'installed for this build, or `isBuildable` stopped resolving it first — the '
        + 'precedence `tests/campaign-roster.spec.ts` pins.',
      ).toEqual([]);
    });
  }

  /*
   * THE FALSIFIER FOR THE WHOLE SECTION, AND THE EXCEPTIONS ARE DECLARED
   * RATHER THAN ABSORBED.
   *
   * "Nothing the roster refuses is standing" is satisfied by an empty roster,
   * an inert binding and a broken `isBuildable` alike. The only thing that
   * separates those from a roster genuinely in force is the same predicate over
   * the UNROSTERED build coming back NON-EMPTY. Measured 2026-08-19, 16 of the
   * 17 shipped operations remove something from their own build — between 4 and
   * 15 entities each, and the withheld def keys are named in the message below.
   *
   * The seventeenth is real and legitimate, so it is NAMED rather than covered
   * by a loose bound. `reclamation.01.held-paper` opens `'force'` — no base is
   * built at all — and everything its layout does place is either untagged or
   * on its own two-id roster, so there is nothing for the allow-list to
   * withhold. That is the "empty roster" case the check cannot distinguish from
   * a broken harness, and the honest thing is to write down which operation it
   * is: a NEW operation landing in this list means its roster is not measurably
   * doing anything, and whoever authored it should say why here.
   */
  const REMOVES_NOTHING: ReadonlySet<string> = new Set([
    // `opening: 'force'`, so no base is seeded and nothing tagged is placed
    // that the two-id roster does not already list.
    'reclamation.01.held-paper',
  ]);

  it('and the SAME builds without it are visibly different', () => {
    const removes: string[] = [];
    const removesNothing: string[] = [];
    for (const op of ALL) {
      const inControl = forbiddenStanding(control(op), op, binding);
      if (inControl.length > 0) {
        const keys = [...new Set(inControl.map((s) => s.key))].sort();
        removes.push(`${op.id}: -${String(inControl.length)} (${keys.join(', ')})`);
      } else {
        removesNothing.push(op.id);
      }
    }

    // The mechanism bites at all. Without this the per-operation assertions
    // above are satisfiable by a harness that never installed a roster.
    expect(
      removes.length,
      "no operation's roster removed anything from its own build, so every check above is "
      + 'vacuous — the roster is not reaching `isBuildable`, the def binding is not bound, '
      + 'or nothing any layout places carries an `unlockedBy`.',
    ).toBeGreaterThan(0);

    // ...and it bites everywhere it is expected to. Filtered against the live
    // table so retiring an operation does not fail this on a stale name; a NEW
    // permissive operation, or one of these gaining teeth, does.
    const expected = [...REMOVES_NOTHING].filter((id) => ALL.some((o) => o.id === id)).sort();
    expect(
      removesNothing.sort(),
      'an operation whose roster withholds nothing from its own build has an allow-list that '
      + 'is not measurably in force. If that is intended, add it to REMOVES_NOTHING above with '
      + 'the reason; if an operation listed there now DOES withhold something, delete its line.\n'
      + `rosters that withhold, for reference:\n  ${removes.join('\n  ')}`,
    ).toEqual(expected);
  });
});
