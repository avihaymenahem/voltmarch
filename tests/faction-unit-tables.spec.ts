/**
 * ============================================================================
 * tests/faction-unit-tables.spec.ts — NO ARMY IS HANDED ANOTHER ARMY'S TROOPS
 * ============================================================================
 *
 * THE DEFECT THIS FILE EXISTS TO MAKE UNREPEATABLE
 * -----------------------------------------------
 * Two tables name a unit key per faction, and both were authored for four
 * armies and left that way when the fifth landed in v1.25.0:
 *
 *   src/sim/Crates.ts       FREE_UNITS   — a string-keyed record with no
 *                                          `reclaim` row, read through
 *                                          `?? FREE_UNITS.neutral`
 *   src/sim/RepairSell.ts   SURVIVOR_KEY — a `readonly string[]` of FOUR
 *                                          entries against `FACTION_COUNT` 5,
 *                                          read through `?? 'gi'`
 *
 * So a Reclamation player who opened a free-unit crate got Allied G.I.s, and a
 * Reclamation player who sold a building watched Allied G.I.s walk out of it.
 * Neither read site threw and neither logged. `tsc` had nothing to say either:
 * an array type has no opinion about its own length and a `Record<string, …>`
 * cannot say "exactly one row per army", so a missing row degrades into a
 * plausible wrong answer rather than a compile error, and the `??` at each read
 * site is what turns "plausible" into "invisible".
 *
 * WHY THIS TEST IS SHAPED THE WAY IT IS
 * ------------------------------------
 * It asserts nothing about `reclaim` specifically. Pinning the instance would
 * pass forever while leaving the trap armed for a sixth army — which is the
 * whole reason the original four-entry tables survived the arrival of two new
 * factions. It instead walks `0 .. FACTION_COUNT - 1` and requires, of every
 * key the read path returns, that the def EXISTS and that it BELONGS TO THAT
 * ARMY. That catches a missing row, a stale row, a copy-pasted row and a
 * typo'd key with one rule.
 *
 * It drives the exported ACCESSORS rather than the tables, because the
 * accessor is where the `??` used to live: a table can be complete while the
 * lookup in front of it still answers with somebody else's army.
 *
 * `Faction.Neutral` IS NOT AN ARMY and is checked more weakly on purpose — it
 * is Gaia, the crate owner and the scenery owner. `CrateService.finderNear`
 * refuses a Gaia finder outright, so its row is never selected BY faction; it
 * exists because the record type is total, and it is what an out-of-range
 * faction resolves to. Its keys must still name real units, and one of them
 * (`FREE_UNITS`) deliberately mixes two armies, so "belongs to that army"
 * cannot be asked of it.
 *
 * The last block is the falsifier for the guard that was KEPT. A clamp nobody
 * can make fire is the decorative assertion this project has shipped believing
 * before now, so the out-of-range branch is exercised rather than assumed.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { BuildTab, EntityKind, FACTION_COUNT, Faction } from '../src/core/types';
import type { UnitDef } from '../src/core/types';
import { DEF_TABLES, UNITS } from '../src/data/Defs';
import { resolveDefBinding } from '../src/game/Scenarios';
import { ProductionCatalog } from '../src/sim/Production';
import { FREE_UNITS, freeUnitsFor } from '../src/sim/Crates';
import { SURVIVOR_KEY, survivorKeyFor } from '../src/sim/RepairSell';

/**
 * Readable names for the failure messages. NOT `Faction[f]` — these are
 * `const enum`s and the reverse map of one is illegal under `isolatedModules`,
 * the exact `TS2476` that took a v1.31.0 deploy down. Declared as a
 * `Record<Faction, …>` so this table cannot go stale either.
 */
const FACTION_NAME: Readonly<Record<Faction, string>> = {
  [Faction.Neutral]: 'Faction.Neutral (Gaia)',
  [Faction.Allies]: 'Faction.Allies',
  [Faction.Soviets]: 'Faction.Soviets',
  [Faction.Meridian]: 'Faction.Meridian',
  [Faction.Reclaim]: 'Faction.Reclaim',
};

/** Every faction id an index into one of these tables may legally take. */
const ALL_FACTIONS: readonly Faction[] = Array.from(
  { length: FACTION_COUNT }, (_, i) => i as Faction,
);

/** One table under test, reached the way the game reaches it. */
interface Table {
  readonly label: string;
  /** The raw table, for the row-count check. */
  readonly rows: Readonly<Record<Faction, unknown>>;
  /** Every unit key the read path hands back for this faction. */
  readonly keysFor: (f: Faction) => readonly string[];
}

const TABLES: readonly Table[] = [
  {
    label: 'Crates.FREE_UNITS',
    rows: FREE_UNITS,
    keysFor: (f) => freeUnitsFor(f),
  },
  {
    label: 'RepairSell.SURVIVOR_KEY',
    rows: SURVIVOR_KEY,
    keysFor: (f) => [survivorKeyFor(f)],
  },
];

function unitDefOf(key: string): UnitDef | null {
  const i = DEF_TABLES.unitByKey.get(key);
  return i === undefined ? null : UNITS[i];
}

describe('per-faction unit tables', () => {
  it('carries exactly one row per faction, with no gaps', () => {
    for (const t of TABLES) {
      const ids = Object.keys(t.rows).map((k) => Number(k)).sort((a, b) => a - b);
      expect(ids, `${t.label} rows`).toEqual(ALL_FACTIONS.map((f) => f as number));
    }
  });

  it('answers every faction with a unit key that resolves to a real def', () => {
    for (const t of TABLES) {
      for (const f of ALL_FACTIONS) {
        const keys = t.keysFor(f);
        const where = `${t.label}[${FACTION_NAME[f]}]`;
        expect(keys.length, `${where} is empty`).toBeGreaterThan(0);
        for (const key of keys) {
          // A missing row is `undefined` here, which is what the four-entry
          // tables produced for Faction.Reclaim before the record type made
          // the gap unrepresentable.
          expect(typeof key, `${where} names ${String(key)}`).toBe('string');
          expect(unitDefOf(key), `${where} names "${key}", which is in no UnitDef`)
            .not.toBeNull();
        }
      }
    }
  });

  it('never hands one army another army\'s unit', () => {
    for (const t of TABLES) {
      for (const f of ALL_FACTIONS) {
        // Gaia is not an army — see the header. Its keys are checked for
        // existence above and deliberately not for ownership.
        if (f === Faction.Neutral) continue;
        for (const key of t.keysFor(f)) {
          const def = unitDefOf(key);
          if (def === null) continue; // already reported by the test above
          expect(
            FACTION_NAME[def.faction],
            `${t.label}[${FACTION_NAME[f]}] names "${key}" (${def.name}), which is `
            + `${FACTION_NAME[def.faction]} content`,
          ).toBe(FACTION_NAME[f]);
        }
      }
    }
  });

  it('names only keys the production catalog can actually build', async () => {
    // The def existing is not sufficient: both read paths go through
    // `svc.catalog.byKey(key)`, and a key that is in `UNITS` but absent from
    // `Production.CONTENT` resolves to null and spawns nothing at all — the
    // silent-no-op twin of the wrong-army bug.
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound).toBe(true);
    for (const t of TABLES) {
      for (const f of ALL_FACTIONS) {
        for (const key of t.keysFor(f)) {
          const entry = catalog.byKey(key);
          expect(entry, `${t.label}[${FACTION_NAME[f]}] names "${key}", not in the catalog`)
            .not.toBeNull();
          if (entry === null || f === Faction.Neutral) continue;
          expect(
            FACTION_NAME[entry.faction],
            `catalog entry "${key}" for ${t.label}[${FACTION_NAME[f]}]`,
          ).toBe(FACTION_NAME[f]);
        }
      }
    }
  });

  it('gives every army its own LINE infantryman as sell survivors', async () => {
    // The strong form of the survivor rule, and the one that would have
    // DERIVED `rclPicker` instead of leaving a hole: a crew is the army's line
    // infantry, which is exactly the first cameo in its Infantry tab. Asserting
    // the derivation rather than the four literals is what makes a fifth army
    // fail here on the commit that adds it, rather than three releases later.
    const catalog = new ProductionCatalog(await resolveDefBinding());
    for (const f of ALL_FACTIONS) {
      if (f === Faction.Neutral) continue;
      const line = catalog.entries
        .filter((e) => e.tab === BuildTab.Infantry && e.faction === f && e.buildable)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)[0];
      expect(line, `${FACTION_NAME[f]} fields no infantry at all`).toBeDefined();
      expect(survivorKeyFor(f), `sell survivors for ${FACTION_NAME[f]}`).toBe(line.key);

      const def = unitDefOf(survivorKeyFor(f));
      expect(def?.kind, `sell survivors for ${FACTION_NAME[f]} must be infantry`)
        .toBe(EntityKind.Infantry);
    }
  });
});

describe('the out-of-range clamp in front of each table', () => {
  // KEPT DELIBERATELY, AND THEREFORE PROVED TO FIRE. `PlayerState.faction` is a
  // runtime value: `src/game/SaveGame.ts` parses the player chunk with
  // `JSON.parse(...) as PlayerSection[]` and hands it to
  // `world.addPlayer(ps.faction as Faction, …)` with no range test, so a
  // corrupt or hand-edited slot really can present a faction outside the enum.
  // (The wire cannot — `src/net/Session.ts` and `server/src/index.ts` both bound
  // a seated faction to `WIRE_LIMITS.factions` before it is relayed.)
  const OUT_OF_RANGE: readonly number[] = [-1, FACTION_COUNT, FACTION_COUNT + 4, 99];

  it('answers the Gaia row rather than undefined', () => {
    for (const bad of OUT_OF_RANGE) {
      expect(freeUnitsFor(bad as Faction), `FREE_UNITS at faction ${bad}`)
        .toBe(FREE_UNITS[Faction.Neutral]);
      expect(survivorKeyFor(bad as Faction), `SURVIVOR_KEY at faction ${bad}`)
        .toBe(SURVIVOR_KEY[Faction.Neutral]);
    }
  });

  it('is not doing the work for any faction that is in range', () => {
    // The falsifier for the falsifier: if the clamp were swallowing a real
    // faction, every row would answer Gaia and the test above would still pass.
    for (const f of ALL_FACTIONS) {
      expect(freeUnitsFor(f), `FREE_UNITS at ${FACTION_NAME[f]}`).toBe(FREE_UNITS[f]);
      expect(survivorKeyFor(f), `SURVIVOR_KEY at ${FACTION_NAME[f]}`).toBe(SURVIVOR_KEY[f]);
    }
  });
});
