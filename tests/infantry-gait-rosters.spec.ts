/**
 * ============================================================================
 * tests/infantry-gait-rosters.spec.ts
 * ============================================================================
 * THE WALK CYCLE, ON EVERY ROSTER — not on the one the author happened to open.
 *
 * v1.17.0 shipped "infantry walk" and it reached `src/art/UnitDefs.ts` and
 * stopped there. `grep -c gait` read:
 *
 *     src/art/UnitDefs.ts       10
 *     src/art/Faction3Units.ts   0
 *     src/art/Faction4Units.ts   0
 *
 * Two of the game's four armies slid across the ground for four versions, and
 * nothing went red, because `tests/unit-gait.spec.ts` imports `UNIT_MASS_LISTS`
 * and only `UNIT_MASS_LISTS` — it measured the feature exactly where it worked.
 * That is the same defect shape as the air layer fixed in v1.28.0 and the same
 * one `docs/SPEC_DRIFT_AUDIT.md` catalogues: a feature that exists, works, and
 * reaches part of the game.
 *
 * SO THIS FILE DOES NOT NAME A ROSTER. It globs `src/art/`, finds every exported
 * array of `UnitMassList`, and sweeps all of them. A fifth faction dropped in
 * beside the other four is swept the day its file exists, with no edit here and
 * no chance for anyone to forget — the same "a module joins by existing" rule
 * `src/game/Systems.ts` uses for systems.
 *
 * AND IT MEASURES THE MESH, NOT THE DATA. Half of this file asserts that
 * `MassDef.gait` is present and sane; the other half BUILDS the model and
 * replays `src/render/Gait.ts`'s injected vertex arithmetic over the real
 * `aGait` and `position` attributes, because "the field is populated" and "the
 * joints move" are different claims and only the second one is the feature.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { UNIT_GAIT } from '../src/core/config';
import { RA3_UNIT_PALETTE } from '../src/core/config';
import type { UnitMassList } from '../src/art/MassList';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { unitLibrary } from '../src/art/UnitFactory';
import {
  RECLAIM_UNIT_MASS_LISTS, RECLAIM_UNIT_PALETTE, reclaimUnitLibrary,
} from '../src/art/Faction4Units';

/* ==========================================================================
 * 1. FIND THE ROSTERS. No table, on purpose — a table is a thing to forget.
 * ========================================================================== */

const ART_MODULES = import.meta.glob('../src/art/*.ts', { eager: true }) as
  Record<string, Record<string, unknown>>;

interface Roster {
  /** Module path as the glob reports it, e.g. `../src/art/Faction4Units.ts`. */
  path: string;
  /** The export the list came from, so a failure names something greppable. */
  exportName: string;
  lists: readonly UnitMassList[];
}

/** Duck-typed rather than `instanceof`: a mass list is a plain object literal. */
function looksLikeMassList(v: unknown): v is UnitMassList {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.key === 'string' && typeof o.cls === 'string' && Array.isArray(o.masses);
}

function findRosters(): Roster[] {
  const out: Roster[] = [];
  for (const [path, mod] of Object.entries(ART_MODULES)) {
    for (const [exportName, value] of Object.entries(mod)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      if (!value.every(looksLikeMassList)) continue;
      out.push({ path, exportName, lists: value as readonly UnitMassList[] });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const ROSTERS = findRosters();

/**
 * ROSTERS THAT DO NOT WALK YET, and the ONLY way to be exempt from the sweep
 * below.
 *
 * `Faction3Units.ts` (the Meridian Pact) is fixed on a concurrent branch. It is
 * listed here so this file can land green rather than waiting on that branch,
 * and the case at the bottom of section 3 makes the entry SELF-DELETING: the
 * moment Meridian's infantry declare a gait, that case goes red and says so.
 *
 * IF YOU ARE READING THIS BECAUSE THAT CASE JUST WENT RED ON A MERGE: delete the
 * entry. That is the whole fix. The sweep already covers the roster properly.
 *
 * Nothing else belongs in here. An exemption that nobody is forced to remove is
 * how "infantry walk" came to mean "half the armies walk" in the first place.
 */
// EMPTY, AND IT SHOULD STAY THAT WAY. `Faction3Units.ts` was listed here while
// the Meridian walk cycle was being authored on a concurrent branch. Both
// branches landed in the same release, the self-deleting case below went red on
// the merge exactly as intended, and deleting the entry was the whole fix.
//
// All four armies walk. Anything added here is a regression wearing a note.
const GAIT_PENDING: ReadonlySet<string> = new Set([]);

const infantryOf = (r: Roster): UnitMassList[] => r.lists.filter((l) => l.cls === 'infantry');

/** The masses that ride a limb, by name. Everything else is welded. */
const RIDES_THE_LEG = new Set(['leg', 'boot', 'kneePad', 'thighBand', 'thighWrap']);
const RIDES_AN_ARM = new Set(['arm']);

/* ==========================================================================
 * 2. THE GLOB ITSELF
 *
 * A pattern that silently matches nothing is this repo's "silent registration
 * failure", and a sweep over zero rosters passes every assertion in the file.
 * ========================================================================== */

describe('the roster sweep actually finds rosters', () => {
  it('discovers the shipped roster modules without being told their names', () => {
    const paths = new Set(ROSTERS.map((r) => r.path));
    for (const known of [
      '../src/art/UnitDefs.ts', '../src/art/Faction3Units.ts', '../src/art/Faction4Units.ts',
    ]) {
      expect(paths.has(known), `${known} exports no roster the glob can see`).toBe(true);
    }
    // Four armies. If this ever reads 1 the glob has broken and every other
    // case in this file has quietly become vacuous.
    expect(ROSTERS.length).toBeGreaterThanOrEqual(3);
  });

  it('finds infantry in every roster it found', () => {
    for (const r of ROSTERS) {
      expect(infantryOf(r).length, `${r.path}#${r.exportName} has no infantry`).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * 3. THE DATA: every faction's infantry declares a real walk
 * ========================================================================== */

describe('every roster gives its infantry a walk cycle', () => {
  const swept = ROSTERS.filter((r) => !GAIT_PENDING.has(r.path));

  it('swings a leg and an arm on every soldier in the game', () => {
    for (const r of swept) {
      for (const u of infantryOf(r)) {
        const where = `${r.path}#${r.exportName} ${u.key}`;
        const legs = u.masses.filter((m) => m.gait?.limb === 'leg');
        const arms = u.masses.filter((m) => m.gait?.limb === 'arm');
        expect(legs.length, `${where} has no swinging leg`).toBeGreaterThan(0);
        expect(arms.length, `${where} has no swinging arm`).toBeGreaterThan(0);
        // Mirrored, or the declaration animates one side and the other stands
        // still — which is the failure mode that looks most like a bug in
        // motion and is completely invisible in a still.
        for (const m of [...legs, ...arms]) {
          expect(m.mirrorX, `${where}/${m.name} must mirror to get its opposed copy`).toBe(true);
        }
      }
    }
  });

  it('hangs the hip on the TOP FACE of the thigh, exactly', () => {
    // Not a taste value. The leg mass spans `anchor.y +- size.y/2`; a pivot
    // anywhere below its top face swings the top of the thigh out of the hip
    // and opens a gap under the belt at every extreme of the cycle.
    for (const r of swept) {
      for (const u of infantryOf(r)) {
        const leg = u.masses.find((m) => m.name === 'leg');
        expect(leg, `${r.path} ${u.key} has no mass named 'leg'`).toBeDefined();
        const top = leg!.anchor[1] + leg!.size[1] * 0.5;
        expect(leg!.gait!.pivotY, `${r.path} ${u.key} hip`).toBeCloseTo(top, 9);
      }
    }
  });

  it('hangs the shoulder inside the upper half of the arm, above the hip', () => {
    for (const r of swept) {
      for (const u of infantryOf(r)) {
        const where = `${r.path} ${u.key}`;
        const hip = u.masses.find((m) => m.name === 'leg')!.gait!.pivotY;
        const arm = u.masses.find((m) => m.gait?.limb === 'arm')!;
        const mid = arm.anchor[1];
        const top = arm.anchor[1] + arm.size[1] * 0.5;
        expect(arm.gait!.pivotY, `${where} shoulder is below the hip`).toBeGreaterThan(hip);
        expect(arm.gait!.pivotY, `${where} shoulder is not in the arm`).toBeGreaterThan(mid);
        expect(arm.gait!.pivotY, `${where} shoulder is off the end of the arm`)
          .toBeLessThanOrEqual(top + 1e-9);
      }
    }
  });

  it('puts everything that hangs off the leg on the SAME pivot', () => {
    // A boot or a thigh band on its own pivot shears away from the limb it is
    // painted on. It has to be the identical number, not a near one.
    for (const r of swept) {
      for (const u of infantryOf(r)) {
        const hip = u.masses.find((m) => m.name === 'leg')!.gait!.pivotY;
        for (const m of u.masses) {
          if (m.gait?.limb !== 'leg') continue;
          expect(m.gait.pivotY, `${r.path} ${u.key}/${m.name} does not share the hip`)
            .toBeCloseTo(hip, 12);
          expect(RIDES_THE_LEG.has(m.name), `${r.path} ${u.key}/${m.name} rides the leg — add it to RIDES_THE_LEG`)
            .toBe(true);
        }
      }
    }
  });

  it('leaves the torso, the helmet, the pack and the weapon welded', () => {
    for (const r of swept) {
      for (const u of infantryOf(r)) {
        for (const m of u.masses) {
          if (RIDES_THE_LEG.has(m.name) || RIDES_AN_ARM.has(m.name)) continue;
          expect(m.gait, `${r.path} ${u.key}/${m.name} must not swing`).toBeUndefined();
        }
      }
    }
  });

  it('never bakes a pivot that is NaN, infinite or underground', () => {
    // A NaN here rides an instance attribute into the shader, which is the exact
    // route by which this repo once got a fully black frame out of one bad
    // index. `toBeGreaterThan(0)` also catches the "pivot about the ground
    // plane" mistake, which sweeps the whole limb through the terrain.
    for (const r of swept) {
      for (const u of infantryOf(r)) {
        for (const m of u.masses) {
          if (m.gait === undefined) continue;
          expect(Number.isFinite(m.gait.pivotY), `${r.path} ${u.key}/${m.name}`).toBe(true);
          expect(m.gait.pivotY, `${r.path} ${u.key}/${m.name}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('does not put a gait on anything that drives, floats or flies — in ANY roster', () => {
    // Deliberately over ALL rosters including the pending ones: an exemption
    // from "must walk" is not an exemption from "must not walk while driving".
    for (const r of ROSTERS) {
      for (const u of r.lists) {
        if (u.cls === 'infantry') continue;
        for (const m of u.masses) {
          expect(m.gait, `${r.path} ${u.key}/${m.name} is not a leg`).toBeUndefined();
        }
      }
    }
  });

  it('keeps GAIT_PENDING honest — an exemption that is no longer true is a lie', () => {
    for (const path of GAIT_PENDING) {
      const rosters = ROSTERS.filter((r) => r.path === path);
      expect(rosters.length, `${path} is exempt from a sweep it is not in`).toBeGreaterThan(0);
      for (const r of rosters) {
        const walks = infantryOf(r).filter((u) => u.masses.some((m) => m.gait !== undefined));
        expect(
          walks.map((u) => u.key),
          `${path} now has walking infantry. DELETE its entry from GAIT_PENDING — `
          + 'the sweep above already covers it, and that deletion is the whole fix.',
        ).toEqual([]);
      }
    }
  });
});

/* ==========================================================================
 * 4. THE MESH: prove the joints actually move
 *
 * Everything above would pass on a roster whose `gait` fields were perfect and
 * whose factory dropped them on the floor — which is precisely how this repo's
 * shape library once rendered eleven primitives as cubes. So: build the model,
 * take the real `aGait` and `position` attributes off the real geometry, and run
 * `src/render/Gait.ts`'s vertex arithmetic over them.
 * ========================================================================== */

/** `applyGait`'s injected block, transcribed. Returns the swung [y, z]. */
function swing(y: number, z: number, sign: number, pivotY: number, phase: number): [number, number] {
  const a = Math.sin(phase * 2 * Math.PI) * UNIT_GAIT.swingRadians * sign;
  const c = Math.cos(a), s = Math.sin(a);
  const vy = y - pivotY;
  return [pivotY + c * vy - s * z, s * vy + c * z];
}

interface Attr { readonly count: number; readonly array: ArrayLike<number> }

interface Mesh { position: Attr; gait: Attr | undefined }

function meshOf(geo: { getAttribute(n: string): unknown }): Mesh {
  return {
    position: geo.getAttribute('position') as Attr,
    gait: geo.getAttribute('aGait') as Attr | undefined,
  };
}

/** Mean Z, after swinging, of the lowest vertices of one limb on one side. */
function limbTipZ(m: Mesh, pivotY: number, side: number, phase: number): number {
  const { position: P, gait: G } = m;
  if (G === undefined) return NaN;
  const on = (i: number): boolean =>
    G.array[i * 2] !== 0
    && Math.abs(G.array[i * 2 + 1] - pivotY) < 1e-6
    && Math.sign(P.array[i * 3]) === side;
  let low = Infinity;
  for (let i = 0; i < P.count; i++) if (on(i) && P.array[i * 3 + 1] < low) low = P.array[i * 3 + 1];
  let sum = 0, n = 0;
  for (let i = 0; i < P.count; i++) {
    if (!on(i) || P.array[i * 3 + 1] - low > 0.06) continue;
    sum += swing(P.array[i * 3 + 1], P.array[i * 3 + 2], G.array[i * 2], G.array[i * 2 + 1], phase)[1];
    n++;
  }
  return n === 0 ? NaN : sum / n;
}

/** Every distinct pivot the mesh carries, ascending: hip first, shoulder last. */
function pivotsOf(m: Mesh): number[] {
  if (m.gait === undefined) return [];
  const set = new Set<number>();
  for (let i = 0; i < m.position.count; i++) {
    if (m.gait.array[i * 2] !== 0) set.add(m.gait.array[i * 2 + 1]);
  }
  return [...set].sort((a, b) => a - b);
}

const RECLAIM_INFANTRY = RECLAIM_UNIT_MASS_LISTS.filter((l) => l.cls === 'infantry');

describe('the Reclamation walks — measured off the built mesh', () => {
  const built = RECLAIM_INFANTRY.map((l) => ({
    key: l.key,
    model: reclaimUnitLibrary.build(l, RECLAIM_UNIT_PALETTE, 256, 0x52_43),
  }));

  it('emits the aGait attribute at all, over every vertex', () => {
    for (const { key, model } of built) {
      const m = meshOf(model.hull);
      expect(m.gait, `${key} carries no aGait — its infantry SLIDE`).toBeDefined();
      // One (sign, pivotY) pair per vertex, no more and no fewer. A short
      // attribute is a GL error at draw time, not a visual bug.
      expect(m.gait!.count, key).toBe(m.position.count);
    }
  });

  it('carries exactly two joints: a hip and a shoulder above it', () => {
    for (const { key, model } of built) {
      const p = pivotsOf(meshOf(model.hull));
      expect(p.length, `${key} pivots ${JSON.stringify(p)}`).toBe(2);
      expect(p[1], `${key} shoulder must sit above the hip`).toBeGreaterThan(p[0]);
    }
  });

  it('moves the limbs and NOTHING else', () => {
    for (const { key, model } of built) {
      const m = meshOf(model.hull);
      const { position: P, gait: G } = m;
      let moved = 0, weldedDrift = 0, swingDrift = 0;
      for (let i = 0; i < P.count; i++) {
        const y = P.array[i * 3 + 1], z = P.array[i * 3 + 2];
        const [y1, z1] = swing(y, z, G!.array[i * 2], G!.array[i * 2 + 1], 0.25);
        const d = Math.hypot(y1 - y, z1 - z);
        if (G!.array[i * 2] === 0) weldedDrift = Math.max(weldedDrift, d);
        else { moved++; swingDrift = Math.max(swingDrift, d); }
      }
      // A welded vertex is multiplied by aGait.x = 0 and must be bit-identical.
      // Not "close to" — exactly, or a parked army shimmers.
      expect(weldedDrift, `${key}: a welded vertex moved`).toBe(0);
      // The limbs really travel. 0.42 rad on a 0.91 m thigh is ~0.37 m at the
      // foot; anything under 10 cm means the pivot is inside the limb's own
      // centroid and the swing is invisible at 57 px.
      expect(swingDrift, `${key}: the limbs barely move`).toBeGreaterThan(0.10);
      expect(swingDrift, `${key}: the limbs fly off the model`).toBeLessThan(0.60);
      // A soldier is roughly a fifth limb by vertex count. Zero would mean the
      // attribute exists and is all zeroes, which is the silent version of this
      // whole bug.
      expect(moved / P.count, key).toBeGreaterThan(0.05);
      expect(moved / P.count, key).toBeLessThan(0.45);
    }
  });

  it('stands perfectly still at both neutral phases', () => {
    // This is the property that makes the feature safe to ship: `settle()` lands
    // a stopped unit on EXACTLY 0 or EXACTLY 0.5, and at those phases the model
    // must not move.
    //
    // AT PHASE 0 THAT IS EXACT and asserted as such — `sin(0)` is +0, the limb
    // rotates by +0, and every vertex is bit-identical to the un-animated model.
    //
    // AT PHASE 0.5 IT IS NOT, and the reason is arithmetic rather than code: pi
    // is not representable, so `sin(2*pi*0.5)` is 1.2e-16 rather than zero and a
    // 0.9 m limb turns by 5e-17 m — 57 zeptometres, in a scene measured in
    // metres and rendered at float32. `unit-gait.spec.ts` bounds the same
    // residual with the same 1e-12 for the same reason. Asserting `toBe(0)`
    // here would not be strictness, it would be a claim about `Math.sin` that is
    // false on every IEEE-754 machine.
    for (const { key, model } of built) {
      const m = meshOf(model.hull);
      const driftAt = (phase: number): number => {
        let drift = 0;
        for (let i = 0; i < m.position.count; i++) {
          const y = m.position.array[i * 3 + 1], z = m.position.array[i * 3 + 2];
          const [y1, z1] = swing(y, z, m.gait!.array[i * 2], m.gait!.array[i * 2 + 1], phase);
          drift = Math.max(drift, Math.hypot(y1 - y, z1 - z));
        }
        return drift;
      };
      expect(driftAt(0), `${key} at phase 0 must be bit-identical`).toBe(0);
      expect(driftAt(0.5), `${key} at phase 0.5`).toBeLessThan(1e-12);
    }
  });

  it('takes a real step: the two feet go opposite ways', () => {
    for (const { key, model } of built) {
      const m = meshOf(model.hull);
      const [hip] = pivotsOf(m);
      const right = limbTipZ(m, hip, 1, 0.25);
      const left = limbTipZ(m, hip, -1, 0.25);
      expect(Number.isFinite(right) && Number.isFinite(left), `${key} has one-sided legs`).toBe(true);
      expect(Math.sign(right), `${key}: both feet went the same way`).not.toBe(Math.sign(left));
      // Stride between the feet at peak. UNIT_GAIT.strideMetres is 2.1 m per
      // FULL cycle, i.e. ~1.05 m per step, and the feet are apart by rather
      // less than that at the extreme because the swing is a rotation.
      const stride = Math.abs(right - left);
      expect(stride, `${key} stride ${stride.toFixed(3)}m`).toBeGreaterThan(0.4);
      expect(stride, `${key} stride ${stride.toFixed(3)}m`).toBeLessThan(UNIT_GAIT.strideMetres);
    }
  });

  it('swings the arms AGAINST the legs — the contralateral rhythm', () => {
    // Arms and legs in phase reads as a children's march. This is the one
    // property of the walk that everybody notices and nobody can name.
    for (const { key, model } of built) {
      const m = meshOf(model.hull);
      const [hip, shoulder] = pivotsOf(m);
      for (const side of [1, -1]) {
        const foot = limbTipZ(m, hip, side, 0.25);
        const hand = limbTipZ(m, shoulder, side, 0.25);
        expect(Number.isFinite(hand), `${key} side ${side} has no arm`).toBe(true);
        expect(Math.sign(hand), `${key} side ${side}: arm and leg swing together`)
          .not.toBe(Math.sign(foot));
      }
    }
  });

  it('costs the vehicles nothing', () => {
    // `MeshBuilder.toGeometry` only emits aGait when something actually swings.
    // A tank paying for two floats a vertex to store zeroes is real VRAM against
    // the 200-unit budget, for a feature no tank uses.
    for (const l of RECLAIM_UNIT_MASS_LISTS) {
      if (l.cls === 'infantry') continue;
      const model = reclaimUnitLibrary.build(l, RECLAIM_UNIT_PALETTE, 256, 0x52_43);
      expect(model.hull.getAttribute('aGait'), `${l.key} pays for a walk it never does`)
        .toBeUndefined();
    }
  });

  it('keeps the gait inside the measured infantry art budget', () => {
    // Infantry are ~57 px on screen against a tank's 2900 (task #26). The whole
    // argument for a vertex-shader gait over a skeleton is that it is free here.
    // V3 raises helmet radial resolution, so the ceiling follows the measured
    // art mesh while the gait itself continues to add no geometry.
    for (const { key, model } of built) {
      expect(model.stats.triangles, key).toBeLessThan(1800);
    }
  });
});

/* ==========================================================================
 * 5. THE SAME MEASUREMENT ON THE SHIPPED ROSTER
 *
 * Two proposed fixes were refuted in an earlier round because their authors
 * measured a metric and never the built mesh. So the Reclamation numbers above
 * are not asserted in isolation: the Peacekeeper is built and measured by the
 * identical code, and the two are required to agree. If the shader contract ever
 * changes under both of them, this is the case that says so.
 * ========================================================================== */

describe('and it matches the roster that already worked', () => {
  it('gives the Reclamation the same joint count and the same stride as the Allies', () => {
    const gi = UNIT_MASS_LISTS.find((l) => l.key === 'allied_rifle')!;
    const ref = meshOf(unitLibrary.build(gi, RA3_UNIT_PALETTE[gi.faction], 256, 0x12_34).hull);
    const picker = RECLAIM_INFANTRY.find((l) => l.key === 'reclaim_picker')!;
    const rcl = meshOf(reclaimUnitLibrary.build(picker, RECLAIM_UNIT_PALETTE, 256, 0x52_43).hull);

    const refP = pivotsOf(ref), rclP = pivotsOf(rcl);
    expect(rclP.length).toBe(refP.length);
    // The hip is the top of the thigh and both rosters use the same 2.2 m
    // ladder, so the hips must be the SAME number. The shoulders need not be:
    // the Reclamation arm is shorter and hung off a shrugged shelf, so its
    // joint sits higher — deliberately, and this pins that it is a choice.
    expect(rclP[0]).toBeCloseTo(refP[0], 9);
    expect(rclP[1]).toBeGreaterThan(refP[1]);

    const strideOf = (m: Mesh): number =>
      Math.abs(limbTipZ(m, pivotsOf(m)[0], 1, 0.25) - limbTipZ(m, pivotsOf(m)[0], -1, 0.25));
    // Same ladder, same swing, same leg length: the step lengths must agree to
    // the centimetre or one army is walking at a different scale from the other.
    expect(strideOf(rcl)).toBeCloseTo(strideOf(ref), 2);
  });
});
