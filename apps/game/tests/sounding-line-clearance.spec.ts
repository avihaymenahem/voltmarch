/**
 * ============================================================================
 * tests/sounding-line-clearance.spec.ts — A CLEARANCE NUMBER NOBODY MEASURES
 * ============================================================================
 * `allies.01.sounding-line` gives the player THREE `engineer`s tagged `party`
 * and loses the operation when they are gone (`t.lost`, `entityDead party`,
 * `endOperation: 'loss', reason: 'party'`). Every neutral structure in this game
 * is captured OUTRIGHT AT ANY HEALTH and the capture CONSUMES the engineer
 * (`src/sim/Capture.ts#resolve` — the neutral branch has no health gate and
 * every non-refused outcome calls `consume`). So three loose right-clicks are a
 * stated defeat, with a build-complete burst and a colour change as the only
 * feedback.
 *
 * `allies-sounding-line.ts` knows this and defends against it geometrically: it
 * refuses `addCivilians` outright, and it argues that the two Works masts it
 * DOES place sit far enough outside the reading discs that "the natural click
 * target inside the reading ground is bare earth".
 *
 * ── THE ARGUMENT WAS SOUND AND THE NUMBER WAS WRONG ─────────────────────────
 * It claimed "34 m out from their head, 14 m clear of the disc", in two places.
 * Both are the NOMINAL offset and the paper arithmetic `34 - 20`. `place()`
 * runs `findClearFootprint`, and the deep-head mast is snapped from a nominal
 * (307.84, 317.06) to (304, 312) — **27.66 m out, 7.66 m clear**, half the
 * claimed margin, on the head that decides the win.
 *
 * The same file quotes its two PILLBOXES at "19.2 m and 21.9 m out from the head
 * after `findClearFootprint` snapped them", and those reproduce to the digit.
 * So the habit existed and was applied to the guns and not to the masts — which
 * is exactly why a number that is checked beats a number that is careful.
 *
 * ── WHAT THIS FILE IS AND IS NOT ────────────────────────────────────────────
 * It was NOT a claim that the geometry is sufficient. It is not: 7.66 m of open
 * ground is a mitigation, and the real answer to "a right-click deletes a unit
 * the operation counts" is refusing the capture. This paragraph named the hook —
 * `CaptureService.addVeto`, consulted inside `resolve()` before the neutral
 * branch, with `refuse()` not consuming the engineer — and ended **"That work is
 * not done."**
 *
 * **IT IS DONE.** `OperationDef.captureProof` is the campaign-side installer;
 * `allies.01.sounding-line` declares `'all'`, because its hazards are UNTAGGED
 * (this layout stamps `party` and `sortie`, neither of which is a building), and
 * `game/campaign.system.ts` turns that into one veto at `init()` and removes it
 * at `dispose()`. §5 below pins the declaration, and
 * `tests/campaign-capture-proof.spec.ts` drives the veto itself through a real
 * `CaptureService`.
 *
 * **THE MEASUREMENT DOES NOT RETIRE WITH THE HAZARD IT MITIGATED**, and that is
 * the reason this file is edited rather than deleted. A structure inside a
 * reading disc is still a structure three men have to walk around; the veto
 * refuses a CLICK, not a footprint. Every number in the layout's header about a
 * distance from a reading head is still re-derived here from the built world.
 *
 * **IT IS ONE OPERATION ON PURPOSE.** The general form — "no capturable
 * structure within N metres of an area a scripted unit must occupy" — wants a
 * layout-level declaration next to `tags`, and inventing one to serve a single
 * caller is how a schema grows a field nobody else ever uses. Generalise it when
 * a second operation needs it, and the audit that produced this file names the
 * candidates.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { World } from '../src/core/world';
import { EntityFlag, EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId } from '../src/core/types';
import {
  MAP_SEAS, buildScenario, clearScenario, setCampaignLayout, setPlannedOperation, startPointsFor,
} from '../src/game/Scenarios';
import { CAMPAIGNS, LAYOUTS } from '../src/campaign/index';
import { CONTROL_HEAD, DEEP_HEAD } from '../src/campaign/layouts/allies-sounding-line';
import type { ChapterDef, OperationDef } from '../src/campaign/types';

const OP_ID = 'allies.01.sounding-line';
/**
 * The seat `ScenarioBuilder.gaia` occupies in this two-army build.
 *
 * Seated third — `Commander`, `Opponent`, then Gaia — so it is index 2. Read as
 * a named constant rather than a literal because the classification below turns
 * on it: a NEUTRAL structure is captured outright at any health, an ENEMY one
 * softens first, and the two are different hazards with different costs.
 */
const GAIA_SEAT = 2;
const LAYOUT_SRC = join(__dirname, '..', 'src', 'campaign', 'layouts', 'allies-sounding-line.ts');

/**
 * Build the operation the way `campaign-install.ts` arms it: plan, then layout,
 * then the world. Deliberately UNROSTERED, which matches
 * `tests/campaign-maps.spec.ts` — every structure this file measures is either
 * Gaia or an ungated `pillbox` role key, so the roster cannot move any of them.
 */
function build(op: OperationDef): World {
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
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  for (let seat = 1; seat < op.map.armies; seat++) {
    world.addPlayer(op.foe, 'Opponent', false, false);
  }
  world.terrain = terrain;

  const l = LAYOUTS.get(op.layout);
  expect(l, `operation ${op.id} names layout '${op.layout}'`).toBeDefined();
  setPlannedOperation({
    id: op.id, preset: op.map.preset, armies: op.map.armies, opening: op.map.opening,
  });
  setCampaignLayout((b, cx, cz, start) => {
    l!.build(b, cx, cz, start, {
      op,
      opening: op.map.opening,
      tag: (_name: string, _id: EntityId) => { if (_id === NONE) return; },
      seat: (i: number) => b.armySlot(i),
    });
  });
  try {
    buildScenario(world, 'campaign', op.map.simSeed, { armies: op.map.armies });
  } finally {
    setCampaignLayout(null);
    setPlannedOperation(null);
    clearScenario();
    terrain.dispose?.();
  }
  return world;
}

interface Near {
  readonly x: number;
  readonly z: number;
  readonly owner: number;
  readonly maxHp: number;
  readonly dist: number;
}

/** Every Alive Building within `within` metres of a point, nearest first. */
function buildingsNear(world: World, x: number, z: number, within: number): Near[] {
  const s = world.store;
  const out: Near[] = [];
  for (let i = 0; i < s.posX.length; i++) {
    if ((s.flags[i] & EntityFlag.Alive) === 0) continue;
    if (s.kind[i] !== EntityKind.Building) continue;
    const d = Math.hypot(s.posX[i] - x, s.posZ[i] - z);
    if (d <= within) {
      out.push({ x: s.posX[i], z: s.posZ[i], owner: s.owner[i], maxHp: s.maxHp[i], dist: d });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

const OP = CAMPAIGNS.flatMap((c: ChapterDef) => c.operations)
  .find((o: OperationDef) => o.id === OP_ID);

describe('allies.01.sounding-line — the reading heads are clear of capturable ground', () => {
  it('the operation and its two heads still exist', () => {
    // THE VACUITY GUARD. Every measurement below is over a set that would be
    // EMPTY if the operation were renamed or the layout stopped exporting its
    // areas — and an empty set makes a "nothing is too close" assertion pass
    // for the one reason that is not the layout being right.
    expect(OP, `${OP_ID} is no longer a shipped operation`).toBeDefined();
    expect(CONTROL_HEAD.r, 'the control head is still a 20 m disc').toBe(20);
    expect(DEEP_HEAD.r, 'the deep head is still a 20 m disc').toBe(20);
  });

  const world = build(OP as OperationDef);
  const control = buildingsNear(world, CONTROL_HEAD.x, CONTROL_HEAD.z, 60);
  const deep = buildingsNear(world, DEEP_HEAD.x, DEEP_HEAD.z, 60);

  it('found buildings near both heads at all', () => {
    // The other half of the guard: a build that placed nothing would make every
    // distance assertion below vacuous in the safe-looking direction.
    expect(control.length, 'nothing was built within 60 m of the control head')
      .toBeGreaterThan(0);
    expect(deep.length, 'nothing was built within 60 m of the deep head').toBeGreaterThan(0);
  });

  it('pins the two Works masts where they ACTUALLY land, not where they are aimed', () => {
    /*
     * BY VALUE, because the whole failure was a number that was computed rather
     * than read. The masts are the two 700 hp Gaia `civOreMine`s; the 480 hp
     * entries near the control head are the picket's guns, which belong to the
     * foe and are not capturable-on-a-stray-click in the same way.
     */
    const mastControl = control.find((b) => b.maxHp === 700);
    const mastDeep = deep.find((b) => b.maxHp === 700);
    expect(mastControl, 'no 700 hp structure near the control head').toBeDefined();
    expect(mastDeep, 'no 700 hp structure near the deep head').toBeDefined();

    expect(mastControl!.dist, 'control-head mast, snapped').toBeCloseTo(38.95, 2);
    expect(mastDeep!.dist, 'deep-head mast, snapped').toBeCloseTo(27.66, 2);

    // AND THE NOMINAL, so the gap between aim and landing is the thing on
    // record rather than an inference. Both are aimed at exactly 34 m.
    expect(mastDeep!.dist, 'the deep mast is snapped TOWARD its head — that is the defect')
      .toBeLessThan(34);
    expect(mastControl!.dist, 'the control mast is snapped AWAY from its head')
      .toBeGreaterThan(34);
  });

  it('no NEUTRAL structure stands inside either reading disc', () => {
    /*
     * A neutral structure is the sharpest form of the hazard: captured OUTRIGHT
     * at any health, one click, one surveyor gone, no warning. Nothing may stand
     * inside a disc a surveyor has to occupy.
     */
    for (const [name, head, near] of [
      ['control', CONTROL_HEAD, control], ['deep', DEEP_HEAD, deep],
    ] as const) {
      const inside = near.filter((b) => b.dist <= head.r && b.owner === GAIA_SEAT);
      expect(inside.map((b) => `(${b.x.toFixed(1)}, ${b.z.toFixed(1)}) d=${b.dist.toFixed(2)}`),
        `a neutral structure stands inside the ${name} reading disc — one click there consumes `
        + 'a surveyor outright, and three of those is a stated loss')
        .toEqual([]);
    }
  });

  it('and the ONE enemy structure inside a disc is the declared picket gun', () => {
    /*
     * ── FOUND BY WRITING THIS FILE, AND IT WAS THE SHARPER HALF ─────────────
     * An ENEMY structure above `CAPTURE.captureHpFrac` (0.5) does not flip — it
     * SOFTENS, and `resolve` consumes the engineer on that branch too. So the
     * picket gun the layout deliberately dug in at 19.21 m, INSIDE the 20 m
     * control disc, was worth more surveyors than the mast:
     *
     *   `pillbox` maxHp 480, soften = 480 x 0.25 x ARMOR[HE][Concrete] 1.00
     *   x globalMul 0.80 = 96 delivered.
     *   one surveyor  -> 384/480 = 80%, still above 50%, surveyor dead
     *   two           -> 288/480 = 60%, still above 50%, `gradient` unreachable
     *   three         -> 192/480 = 40%, NOW capturable, and `t.lost` has fired
     *
     * Three right-clicks on the gun that is shooting at them and the player had
     * lost the operation to a verb nothing told them they had. It was worse in
     * combination with `src/input/Commands.ts`: `caps.canCapture` is true if ANY
     * selected unit can capture, so a select-all right-click on that gun issued
     * `OrderKind.Capture` to the WHOLE selection — the escort stopped shooting
     * and the surveyors walked in.
     *
     * ── THE DECLARED EXCEPTION IS GONE, AND THE COUNT IS NOT ────────────────
     * This carried an `OVER_BAND`-shaped exception whose own text said it stood
     * "until the veto exists". It exists: `captureProof: 'all'`, asserted by §5
     * below, so the whole soften ladder above is unreachable — `refuse()` hands
     * the surveyor back and `isCapturable` never offers the cursor.
     *
     * WHAT IS ASSERTED HERE IS NO LONGER AN EXCEPTION BUT A COVERAGE FACT. The
     * layout's whole design argument is that the picket is TWO guns and exactly
     * one of them stands inside the control disc, leaving "two lobes of reading
     * ground outside both guns: 193.1 m2, 15.4% of the disc". That number is
     * worth pinning in both directions whatever the capture rules are — a second
     * gun inside a disc changes what the secondary is worth, and this one
     * leaving changes it back — so the assertion stays and only its reason
     * moved.
     */
    const inside = [
      ...control.filter((b) => b.dist <= CONTROL_HEAD.r && b.owner !== GAIA_SEAT),
      ...deep.filter((b) => b.dist <= DEEP_HEAD.r && b.owner !== GAIA_SEAT),
    ];
    expect(inside.length, 'the set of enemy structures inside a reading disc has changed — '
      + "if one was ADDED it eats into the layout's 193.1 m2 of open reading ground; if the "
      + 'picket gun LEFT, the coverage argument in the layout has to be re-measured').toBe(1);
    expect(inside[0].maxHp, 'the exception is the 480 hp picket gun').toBe(480);
    expect(inside[0].dist, 'at the distance the layout already quotes').toBeCloseTo(19.21, 1);
  });

  it('and the layout writes down the measured clearance rather than the aimed one', () => {
    /*
     * THE PROSE HALF, and it is the one that failed. The layout said "14 m clear
     * of the disc" in two places for its whole life.
     *
     * THIS ASSERTS THE REAL FIGURES ARE PRESENT, NOT THAT THE OLD STRING IS
     * ABSENT — the correction QUOTES what the file used to say, which is the
     * house style and the right thing to do, so a `not.toContain` on the old
     * sentence fails against a correct file. Reverting the correction deletes
     * `7.66` and `27.66`, which is what these two catch.
     */
    const src = readFileSync(LAYOUT_SRC, 'utf8');
    expect(src, 'the measured deep-head clearance must be written down').toContain('7.66');
    expect(src, 'and the distance it was measured from').toContain('27.66');
  });

  it('the picket guns are where the layout says, which is the control on this method', () => {
    /*
     * THE FALSIFIER FOR THE INSTRUMENT ITSELF. The layout quotes its two guns at
     * "19.2 m and 21.9 m out from the head after `findClearFootprint` snapped
     * them". If this harness disagreed with a figure the layout got RIGHT, the
     * harness would be what is broken — so a passing mast assertion above would
     * mean nothing.
     */
    const guns = control.filter((b) => b.maxHp === 480).map((b) => b.dist).sort((a, b) => a - b);
    expect(guns.length, 'the picket is two guns').toBe(2);
    expect(guns[0], "the layout's own 19.2").toBeCloseTo(19.21, 1);
    expect(guns[1], "the layout's own 21.9").toBeCloseTo(21.93, 1);
  });
});

/* ==========================================================================
 * 5. THE DEFENCE THE CLEARANCE IS NO LONGER STANDING IN FOR
 *
 * The exception in §4 stood "until the veto exists". This is the assertion that
 * makes deleting the veto fail HERE, in the file whose whole premise was that
 * the geometry was a stand-in for it — rather than only in the capture spec,
 * which somebody removing a field from an operation has no reason to run.
 * ========================================================================== */

describe('and the geometry is a mitigation on top of a real refusal', () => {
  it("declares captureProof 'all', so a right-click cannot spend a surveyor", () => {
    /*
     * `'all'` RATHER THAN A LIST, AND THE ASSERTION IS ON THE VALUE.
     * This layout stamps two tags, `party` and `sortie`, and NEITHER IS A
     * BUILDING — so a tag list is not a weaker form of this protection, it is
     * an empty one. The second expectation is what would catch somebody
     * "tidying" the blanket into a list.
     */
    expect(OP!.captureProof, 'the hazard this file measures is closed by a refusal, not by '
      + 'clearance — see the layout header').toBe('all');
  });

  it('and takes nothing away, because no objective here is satisfied by a capture', () => {
    /*
     * THE FALSIFIER FOR THE BLANKET. `'all'` is the right answer only while
     * nothing in this operation WANTS a deed: `pact.02`, `pact.04` and
     * `soviets.06` all take a tag list precisely because each has one. A
     * `structureCaptured` or an `ownerCount` appearing here means the blanket
     * has started refusing the player their own objective.
     */
    const src = JSON.stringify(OP!.triggers);
    expect(src, "a trigger now reads a deed, and `captureProof: 'all'` refuses every one")
      .not.toContain('structureCaptured');
    expect(src, 'same, for a seat-owner threshold').not.toContain('ownerCount');
  });
});
