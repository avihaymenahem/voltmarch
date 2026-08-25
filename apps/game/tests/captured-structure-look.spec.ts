/**
 * ============================================================================
 * tests/captured-structure-look.spec.ts — a captured building keeps its own kit
 * ============================================================================
 * Reported as a Construction Yard that, once a Pact engineer took it, redrew on
 * the battlefield as a MERIDIAN CHAPTERHOUSE while its sidebar portrait went on
 * showing an Allied Construction Yard.
 *
 * THE CAUSE WAS ONE DECISION LIVING IN TWO TABLES, ONE OF WHICH GOT WIDENED.
 * `resolve()` is keyed on (kind, FACTION, defId). `src/ui/Cameos.ts` grew a
 * four-slot `builtBy` helper during the engineer-skins fix; `SHARED_KEYS` in
 * `src/art/buildings.system.ts` stayed a two-element `[allied, soviet]` pair.
 * So a Pact-owned conyard missed (Building, Meridian, defId), missed
 * (Building, ANY, defId), and fell through to (Building, Meridian, -1) — which
 * `Faction3Buildings.ts` binds to `meridian_chapterhouse` as its last-resort
 * default. The portrait was right and the world was wrong.
 *
 * IT CAN ONLY EVER BE A CAPTURE, WHICH IS WHY NOBODY SAW IT IN NORMAL PLAY. The
 * Pact builds `mrdConclave` and the Reclamation `rclFoundry`; neither army has
 * the shared `conyard` def on any build tab. Every route to a Pact-owned shared
 * structure runs through `Capture.captureBuilding`, which writes
 * `st.faction[t] = to.faction` — and that write is what re-resolves the model.
 *
 * THE RULE THIS FILE PINS IS THE OPPOSITE OF `faction-models-distinct.spec.ts`,
 * AND BOTH ARE RIGHT. For a UNIT the pair means the army that CREWS it, so no
 * two armies may share a model. For a STRUCTURE it means ARCHITECTURE, and
 * capturing a building does not rebuild it — a captured Allied Refinery is
 * still an Allied Refinery. So here the two newer armies deliberately DO share
 * the Allied model, and §3 exists to make that a decision somebody has to
 * change on purpose rather than a gap somebody can fall into.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { ARMY_ORDER, GAIA_SLOT, builtBy } from '../src/art/faction-models';
import { SHARED_KEYS, FACTION_KEYS } from '../src/art/buildings.system';
import { CAMEO_BUILDING_MODELS } from '../src/ui/Cameos';
import { STRUCTURE_MASS_LISTS } from '../src/art/BuildingDefs';
import { MERIDIAN_STRUCTURE_MODELS } from '../src/art/Faction3Buildings';
import { RECLAIM_STRUCTURE_MODELS } from '../src/art/Faction4Buildings';

const ALLIED_SOVIET_KEYS = new Set(STRUCTURE_MASS_LISTS.map((l) => l.key));

describe('§1 every shared structure answers for every army', () => {
  it('has one model per ARMY_ORDER slot, with no holes', () => {
    for (const [key, models] of Object.entries(SHARED_KEYS)) {
      // `PerArmy` makes a short literal a compile error, so this is the runtime
      // half: it catches a row filled in with an empty string to shut tsc up.
      expect(models.length, `${key} has ${models.length} slots`).toBe(ARMY_ORDER.length);
      for (let i = 0; i < models.length; i++) {
        expect(models[i], `${key}[${i}] is empty`).toBeTruthy();
      }
    }
  });

  it('names only models that were actually authored', () => {
    for (const [key, models] of Object.entries(SHARED_KEYS)) {
      for (const m of models) {
        expect(ALLIED_SOVIET_KEYS.has(m), `${key} names ${m}, which is not a mass list`).toBe(true);
      }
    }
  });
});

describe('§2 the world and the portrait cannot disagree again', () => {
  it('binds every shared key identically in both tables', () => {
    // THE ACTUAL DEFECT, as one assertion. These two tables encode one decision
    // and they drifted, so the ground and the sidebar described different
    // buildings. Compared whole rather than key-by-key so a row present in one
    // table and missing from the other fails here too.
    const fromWorld: Record<string, readonly string[]> = {};
    const fromCameo: Record<string, readonly string[]> = {};
    for (const [key, models] of Object.entries(SHARED_KEYS)) {
      fromWorld[key] = [...models];
      const c = CAMEO_BUILDING_MODELS[key];
      expect(c, `${key} is in SHARED_KEYS but has no cameo binding`).toBeDefined();
      expect(Array.isArray(c), `${key} is a per-army row in the world and a single model in the sidebar`).toBe(true);
      fromCameo[key] = [...(c as readonly string[])];
    }
    expect(fromCameo).toEqual(fromWorld);
  });

  it('binds every single-army key identically in both tables', () => {
    for (const [key, model] of Object.entries(FACTION_KEYS)) {
      const c = CAMEO_BUILDING_MODELS[key];
      expect(c, `${key} is in FACTION_KEYS but has no cameo binding`).toBeDefined();
      expect(c, `${key}: world draws ${model}, sidebar draws ${String(c)}`).toBe(model);
    }
  });
});

describe('§3 the capture decision is deliberate, not a gap', () => {
  it('gives both newer armies the ALLIED architecture, not their own', () => {
    // Deliberate, and the argument is at `builtBy`. Capturing a building does
    // not rebuild it, so the model belongs to the architecture rather than to
    // whoever holds the deed. If this is ever reversed — so that a captured
    // yard redraws as a Conclave — this test must be rewritten with the reason,
    // and `CAMEO_BUILDING_MODELS` has to move in the same commit or §2 fails.
    for (const [key, models] of Object.entries(SHARED_KEYS)) {
      const allied = models[GAIA_SLOT];
      for (let i = 2; i < models.length; i++) {
        expect(models[i], `${key}[${i}] should be the Allied twin`).toBe(allied);
      }
    }
  });

  it('is produced by the shared helper, not by hand-written four-tuples', () => {
    // The helper is the single place a fifth army answers this question. A row
    // written out longhand would still pass §1 and §3 and would silently NOT
    // grow, which is exactly how the two-element pair survived two new armies.
    for (const [key, models] of Object.entries(SHARED_KEYS)) {
      expect([...models], `${key} is not shaped like builtBy()`)
        .toEqual([...builtBy(models[0], models[1])]);
    }
  });

  it('never collides with a def the newer armies build themselves', () => {
    // A shared key that also appeared in a per-army table would be registered
    // twice for one defId — once per faction here, once at FACTION_ANY there —
    // and which one wins is registration order, i.e. luck.
    for (const key of Object.keys(SHARED_KEYS)) {
      expect(MERIDIAN_STRUCTURE_MODELS[key], `${key} is in both SHARED_KEYS and the Pact table`).toBeUndefined();
      expect(RECLAIM_STRUCTURE_MODELS[key], `${key} is in both SHARED_KEYS and the Reclamation table`).toBeUndefined();
    }
  });
});
