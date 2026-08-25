/**
 * ============================================================================
 * tests/faction-models-distinct.spec.ts — no army wears another army's kit
 * ============================================================================
 * Reported as *"some reason, the engineers among factions have all the same
 * skin"*, and it was literally true. `engineer` is ONE `Faction.Neutral` def
 * that both original armies build; `src/art/units.system.ts` listed it in
 * `CONTENT_TO_MODEL`, which registers at `FACTION_ANY`; so a Soviet barracks
 * turned out plated Allied technicians, and `src/ui/Cameos.ts` carried a second
 * copy of the same mapping so the sidebar portrait agreed with the mistake.
 * There was no `soviet_engineer` mass list to draw instead — it had never been
 * authored.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS NOT "the engineer is fixed"
 * ----------------------------------------------------------------
 * The one-key fix is a two-line diff. What made the key wrong for the life of
 * the module is that BOTH join tables were shaped `[allied, soviet]` — a
 * positional pair with no slot for a third army and no way to notice one was
 * missing — while the game grew to four. `bindingFor` read
 * `faction === Soviets ? [1] : [0]`, i.e. **every army that is not the Soviets
 * gets the Allied model**. A fifth army lands on that same line.
 *
 * So the invariants here are about the SHAPE, not the instance:
 *
 *   §1  every army resolves a DISTINCT model for every shared unit def
 *   §2  no unit model key is drawn by two different armies, anywhere
 *   §3  no `Faction.Neutral` def sits in the `FACTION_ANY` table
 *   §4  the world binding and the cameo binding agree, key for key
 *   §5  every model key named is a mass list that exists
 *   §6  the two engineers are different GEOMETRY, not one mesh in two palettes
 *
 * §2 and §3 are the ones that catch a fifth army. The compile-time half of that
 * guarantee lives in `src/art/faction-models.ts` — `PerArmy` is derived from
 * `ARMY_ORDER`, and `_everyArmyIsOrdered` ties `ARMY_ORDER` to `Faction` — so
 * an army added to the enum fails `npm run typecheck` before it ever reaches
 * this file. This is the runtime half: the compiler can count the rows but it
 * cannot tell that two of them name the same model.
 * ============================================================================
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { RA3_UNIT_PALETTE } from '../src/core/config';
import { Faction } from '../src/core/types';
import { UNITS } from '../src/data/Defs';
import { ARMY_ORDER } from '../src/art/faction-models';
import { GreebleFactory } from '../src/art/Greeble';
import type { MassStats, UnitMassList } from '../src/art/MassList';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { UnitLibrary } from '../src/art/UnitFactory';
import { MERIDIAN_UNIT_MASS_LISTS, MERIDIAN_UNIT_MODELS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS, RECLAIM_UNIT_MODELS } from '../src/art/Faction4Units';
import { CONTENT_TO_MODEL, SHARED_CONTENT_TO_MODEL } from '../src/art/units.system';
import { CAMEO_UNIT_MODELS, cameoModelKey } from '../src/ui/Cameos';

/**
 * Which model-key prefix belongs to which army, in `ARMY_ORDER`.
 *
 * The prefix is not decoration: `src/ui/Cameos.ts#LIBRARIES` dispatches on it,
 * because the Pact and the Reclamation each keep a PRIVATE library, so
 * `meridian_oculus` can only have come out of the Pact's. That makes the prefix
 * a load-bearing statement of ownership and therefore a thing worth asserting.
 */
const ARMY_PREFIX: readonly string[] = ['allied_', 'soviet_', 'meridian_', 'reclaim_'];

/** Human-readable army names, in `ARMY_ORDER`, for failure messages. */
const ARMY_NAME: readonly string[] = ['Allies', 'Soviets', 'Meridian', 'Reclamation'];

/** Every mass list key that exists, across all four armies' rosters. */
const ALL_MODEL_KEYS: ReadonlySet<string> = new Set([
  ...UNIT_MASS_LISTS.map((l) => l.key),
  ...MERIDIAN_UNIT_MASS_LISTS.map((l) => l.key),
  ...RECLAIM_UNIT_MASS_LISTS.map((l) => l.key),
]);

/** Def key -> the army that owns it, or null for a shared `Faction.Neutral` def. */
function ownerOf(key: string): Faction | null {
  const def = UNITS.find((u) => u.key === key);
  if (def === undefined) return null;
  return def.faction === Faction.Neutral ? null : (def.faction as Faction);
}

describe('the per-army tables cover every army', () => {
  it('has one prefix and one name per army in ARMY_ORDER', () => {
    // The tables above are hand-written and this file's whole argument is that
    // hand-written per-army lists rot. A fifth army fails here first, with a
    // message that says which list to extend.
    expect(ARMY_PREFIX.length, 'ARMY_PREFIX is short of ARMY_ORDER').toBe(ARMY_ORDER.length);
    expect(ARMY_NAME.length, 'ARMY_NAME is short of ARMY_ORDER').toBe(ARMY_ORDER.length);
    expect(new Set(ARMY_PREFIX).size).toBe(ARMY_PREFIX.length);
  });
});

/* ==========================================================================
 * §1 — THE INVARIANT THE REPORT ASKED FOR
 * ========================================================================== */

describe('every army draws its own model for a shared unit def', () => {
  it('resolves a distinct model per army for each Faction.Neutral unit', () => {
    const collisions: string[] = [];
    for (const key of Object.keys(SHARED_CONTENT_TO_MODEL)) {
      const claimedBy = new Map<string, string>();
      ARMY_ORDER.forEach((f, i) => {
        const model = cameoModelKey(key, f, false);
        expect(model, `${key} resolves no model for ${ARMY_NAME[i]}`).not.toBeNull();
        if (model === null) return;
        const already = claimedBy.get(model);
        if (already !== undefined) {
          collisions.push(`${key}: ${ARMY_NAME[i]} and ${already} both draw "${model}"`);
        }
        claimedBy.set(model, ARMY_NAME[i]);
      });
    }
    // Before the fix this read:
    //   engineer: Soviets and Allies both draw "allied_engineer"
    //   engineer: Meridian and Allies both draw "allied_engineer"
    //   engineer: Reclamation and Allies both draw "allied_engineer"
    expect(collisions, 'two armies share one model for a def they both build').toEqual([]);
  });

  it('covers every Faction.Neutral unit def, not just the ones somebody remembered', () => {
    // The four shared rows are `engineer`, `harvester`, `mcv` and `transport`.
    // A fifth Neutral unit def added without a row here would fall back to the
    // FACTION_ANY table — which is exactly how the engineer broke — so the
    // membership is asserted rather than assumed.
    const neutral = UNITS.filter((u) => u.faction === Faction.Neutral).map((u) => u.key).sort();
    expect(Object.keys(SHARED_CONTENT_TO_MODEL).sort()).toEqual(neutral);
  });
});

/* ==========================================================================
 * §2 — THE STRONGER FORM, WHICH IS WHAT A FIFTH ARMY TRIPS
 * ========================================================================== */

describe('no unit model key crosses an army boundary', () => {
  it('gives every army a model out of its own namespace', () => {
    const wrong: string[] = [];
    for (const def of UNITS) {
      if (CAMEO_UNIT_MODELS[def.key] === undefined) continue;
      const owner = ownerOf(def.key);
      ARMY_ORDER.forEach((f, i) => {
        // A def one army owns is only ever drawn for that army; a Neutral def
        // can be owned by any of them.
        if (owner !== null && owner !== f) return;
        const model = cameoModelKey(def.key, f, false);
        if (model === null || model.startsWith(ARMY_PREFIX[i])) return;
        wrong.push(`${def.key}@${ARMY_NAME[i]} -> "${model}" (wants ${ARMY_PREFIX[i]}*)`);
      });
    }
    expect(wrong, 'an army is wearing another army\'s kit').toEqual([]);
  });
});

/* ==========================================================================
 * §3 — THE CLASS OF BUG, NOT THE INSTANCE
 * ========================================================================== */

describe('the FACTION_ANY table holds only single-army defs', () => {
  it('lists no Faction.Neutral def in CONTENT_TO_MODEL', () => {
    // `CONTENT_TO_MODEL` registers at FACTION_ANY, which resolves for EVERY
    // army — correct for a def exactly one army can build, and a guaranteed
    // shared skin for a def more than one builds. `units.system.ts` runs the
    // same check at boot (`assertNoSharedDefs`) where it can only log; this is
    // the copy that goes red in the gate.
    const neutral = new Set(
      UNITS.filter((u) => u.faction === Faction.Neutral).map((u) => u.key));
    const stray = Object.keys(CONTENT_TO_MODEL).filter((k) => neutral.has(k));
    expect(
      stray,
      'these Faction.Neutral defs register at FACTION_ANY, so every army that '
      + 'builds one draws the same model — move them to SHARED_CONTENT_TO_MODEL',
    ).toEqual([]);
  });

  it('names only real unit defs in either table', () => {
    const keys = new Set(UNITS.map((u) => u.key));
    const stray = [...Object.keys(CONTENT_TO_MODEL), ...Object.keys(SHARED_CONTENT_TO_MODEL)]
      .filter((k) => !keys.has(k));
    expect(stray, 'the art join names content that no longer exists').toEqual([]);
  });
});

/* ==========================================================================
 * §4 — THE TWO COPIES OF THE JOIN MUST AGREE
 *
 * `units.system.ts` decides what stands on the battlefield and `Cameos.ts`
 * decides what the sidebar portrait shows. They are separate tables on purpose
 * (the HUD's own header argues it at length) and they were separately wrong
 * about the engineer, which is how one fix could have shipped as half a fix.
 * ========================================================================== */

describe('the world model and the cameo portrait agree', () => {
  it('matches SHARED_CONTENT_TO_MODEL row for row', () => {
    const disagreements: string[] = [];
    for (const [key, models] of Object.entries(SHARED_CONTENT_TO_MODEL)) {
      ARMY_ORDER.forEach((f, i) => {
        const world = models[i];
        // `null` is OWN_ROSTER: the army reaches the role through its own def
        // in its own module, so `units.system.ts` binds nothing and the cameo
        // table is free to answer with that army's own equivalent.
        if (world === null) return;
        const portrait = cameoModelKey(key, f, false);
        if (portrait === world) return;
        disagreements.push(`${key}@${ARMY_NAME[i]}: world "${world}" vs cameo "${portrait}"`);
      });
    }
    expect(disagreements).toEqual([]);
  });

  it('backs every OWN_ROSTER claim with a real def in that army\'s own module', () => {
    // OWN_ROSTER asserts something checkable: that army has its own def for the
    // role, in its own art module, drawing its own model. An unbacked claim is
    // the absent row this whole file exists to outlaw, wearing a label.
    const ownModels: readonly (Readonly<Record<string, string>> | null)[] =
      [null, null, MERIDIAN_UNIT_MODELS, RECLAIM_UNIT_MODELS];
    const unbacked: string[] = [];
    for (const [key, models] of Object.entries(SHARED_CONTENT_TO_MODEL)) {
      ARMY_ORDER.forEach((f, i) => {
        if (models[i] !== null) return;
        const table = ownModels[i];
        expect(table, `${ARMY_NAME[i]} claims OWN_ROSTER with no module table`).not.toBeNull();
        if (table === null) return;
        const portrait = cameoModelKey(key, f, false);
        // The cameo answer for this army must be one of ITS OWN module's models
        // — not the Allied one it used to inherit.
        if (portrait !== null && Object.values(table).includes(portrait)) return;
        unbacked.push(`${key}@${ARMY_NAME[i]}: "${portrait}" is not in that army's model table`);
      });
    }
    expect(unbacked).toEqual([]);
  });
});

/* ==========================================================================
 * §5 — EVERY NAME RESOLVES
 * ========================================================================== */

describe('every model key named by the art join exists', () => {
  it('resolves every value in both units.system tables', () => {
    const missing: string[] = [];
    for (const [key, model] of Object.entries(CONTENT_TO_MODEL)) {
      if (!ALL_MODEL_KEYS.has(model)) missing.push(`${key} -> ${model}`);
    }
    for (const [key, models] of Object.entries(SHARED_CONTENT_TO_MODEL)) {
      models.forEach((model, i) => {
        if (model === null || ALL_MODEL_KEYS.has(model)) return;
        missing.push(`${key}@${ARMY_NAME[i]} -> ${model}`);
      });
    }
    expect(missing, 'a mass list with this key was never authored').toEqual([]);
  });

  it('resolves every value in CAMEO_UNIT_MODELS', () => {
    const missing: string[] = [];
    for (const [key, binding] of Object.entries(CAMEO_UNIT_MODELS)) {
      const values = typeof binding === 'string' ? [binding] : binding;
      for (const model of values) {
        if (!ALL_MODEL_KEYS.has(model)) missing.push(`${key} -> ${model}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/* ==========================================================================
 * §6 — DIFFERENT MESHES, NOT ONE MESH IN TWO PALETTES
 *
 * R12's failure and the one this repo has shipped before: `allied_rifle` and
 * `soviet_conscript` were once the same 1206 triangles under two hues.
 * `src/art/UnitDefs.ts` §3 says so in its own header. A `soviet_engineer` that
 * is the Allied engineer with the coat swapped on would satisfy every table
 * above and still be the reported defect.
 * ========================================================================== */

describe('the engineers are different soldiers', () => {
  // A PRIVATE library on a PRIVATE factory, for the reason
  // `tests/unit-silhouette.spec.ts` gives: `UnitLibrary.build` caches by
  // `list.key`, so building into the shared singleton would make this file's
  // results depend on which spec ran first.
  const library = new UnitLibrary(new GreebleFactory());
  const ATLAS_SEED: Readonly<Record<UnitMassList['faction'], number>> = {
    allies: 0x41_11, soviets: 0x50_77, neutral: 0x4e_11,
  };
  const stats = new Map<string, MassStats>();

  beforeAll(() => {
    for (const l of UNIT_MASS_LISTS) {
      if (l.cls !== 'infantry') continue;
      stats.set(l.key, library.build(
        l, RA3_UNIT_PALETTE[l.faction], 256, ATLAS_SEED[l.faction]).stats);
    }
  });

  it('builds both engineers', () => {
    expect(stats.has('allied_engineer')).toBe(true);
    expect(stats.has('soviet_engineer')).toBe(true);
  });

  it('gives them different geometry', () => {
    const a = stats.get('allied_engineer');
    const s = stats.get('soviet_engineer');
    expect(a).toBeDefined();
    expect(s).toBeDefined();
    if (a === undefined || s === undefined) return;
    // Triangle count and bounding box are the two cheapest facts that cannot
    // both match between two genuinely different silhouettes. A recolour would
    // match both exactly, which is the state this case exists to refuse.
    expect(s.triangles, 'same triangle count as the Allied engineer').not.toBe(a.triangles);
    expect(s.bounds).not.toEqual(a.bounds);
    expect(s.dominantName, 'the Soviet family is a greatcoat revolve').toBe('coat');
    expect(a.dominantName, 'the Allied family is a plated chest hull').toBe('torso');
  });

  it('reads as a different soldier from its own army\'s rifleman', () => {
    // The other half of R12: two units in ONE army that differ only by tint.
    const eng = stats.get('soviet_engineer');
    const con = stats.get('soviet_conscript');
    expect(eng).toBeDefined();
    expect(con).toBeDefined();
    if (eng === undefined || con === undefined) return;
    expect(eng.triangles).not.toBe(con.triangles);
    expect(eng.bounds).not.toEqual(con.bounds);
  });

  it('passes the shipped silhouette gates', () => {
    const s = stats.get('soviet_engineer');
    expect(s).toBeDefined();
    if (s === undefined) return;
    // `validateUnit` already threw if any of these were errors — `build`
    // rejects — so these restate the bands the boot scorecard prints, which is
    // what CLAUDE.md asks an author to read rather than assume.
    expect(s.errors).toEqual([]);
    expect(s.warnings).toEqual([]);
    // "Boxes are a bug": no flat, world-axis-aligned vertical flank anywhere.
    // Every infantryman in all four armies measures exactly 0.000.
    expect(s.boxiness.axisFraction).toBe(0);
    // R8's dominant-mass floor, and R-T1's 20-28% team colour for infantry.
    expect(s.dominantFraction).toBeGreaterThan(0.35);
    expect(s.teamFraction).toBeGreaterThanOrEqual(0.20);
    expect(s.teamFraction).toBeLessThanOrEqual(0.28);
  });
});
