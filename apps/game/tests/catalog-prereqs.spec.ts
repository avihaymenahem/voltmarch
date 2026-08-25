/**
 * THE TECH TREE THE GAME ACTUALLY RUNS ON.
 *
 * `Defs.ts` and `Production.ts`'s `CONTENT` both carry a `prereqs` array for the
 * same keys, and `resolveEntry` merges the two tables field by field. Every
 * field falls back `def?.x ?? spec.x` — except `prereqs`, which takes the spec
 * unconditionally. So an edit to a def's `prereqs` compiles, reads correctly,
 * passes review, and changes nothing.
 *
 * That is not hypothetical. The MCV rebuild fix was written **three times** —
 * `Defs.ts:677`, `:848`, `:1012`, each with its own paragraph of reasoning about
 * why gating a rebuild behind a `struct.tech` building strands a new player who
 * loses the MCV their match opened with. All three landed in the ignored table.
 * The game kept the two-prereq gate and a fresh profile could not rebuild an
 * MCV, in a game whose default start is a lone MCV.
 *
 * Three tests were green throughout, because each read a *different* table:
 * `Defs.ts:1774` computes reachability from `d.prereqs`, `match-start.spec.ts:441`
 * also reads `def.prereqs`, and `:938` builds its own catalog from
 * `AIStrategy.FALLBACK_CATALOG`. None of them read `ProductionCatalog`.
 *
 * So this file asserts against the catalog the running game consults, and
 * against nothing else. If the two tables ever disagree again, this fails and
 * names both sides.
 */

import { describe, expect, it } from 'vitest';

import { DEF_TABLES, UNITS, BUILDINGS } from '../src/data/Defs';
import { resolveDefBinding } from '../src/game/Scenarios';
import { BuildKind, ProductionCatalog } from '../src/sim/Production';

/** Every key that carries a `prereqs` list in BOTH tables, with both values. */
async function disagreements(): Promise<string[]> {
  const catalog = new ProductionCatalog(await resolveDefBinding());
  expect(catalog.bound, 'catalog must be bound to the real def tables').toBe(true);

  const out: string[] = [];
  for (const entry of catalog.entries) {
    const isBuilding = entry.kind === BuildKind.Building;
    const index = isBuilding
      ? DEF_TABLES.buildingByKey.get(entry.key)
      : DEF_TABLES.unitByKey.get(entry.key);
    if (index === undefined) continue; // content-only row, no def to disagree with

    const def = isBuilding ? BUILDINGS[index] : UNITS[index];
    const a = [...entry.prereqs].sort().join(',');
    const b = [...def.prereqs].sort().join(',');
    if (a !== b) {
      out.push(`${entry.key}: catalog [${entry.prereqs.join(', ')}] vs def [${def.prereqs.join(', ')}]`);
    }
  }
  return out;
}

describe('prereqs agree between the def tables and the catalog the game runs on', () => {
  it('has no key whose two prereqs lists disagree', async () => {
    const bad = await disagreements();
    expect(
      bad,
      'A def\'s `prereqs` edit does NOT reach the game — `resolveEntry` takes ' +
        '`prereqs` from CONTENT unconditionally. Fix the CONTENT row in ' +
        'apps/game/src/sim/Production.ts, or make the merge fall back to the def.\n  ' +
        bad.join('\n  '),
    ).toEqual([]);
  });
});

describe('the MCV a match opens with can be rebuilt from a fresh profile', () => {
  /**
   * Every faction's deployable-base unit, and the one structure that must be
   * enough to rebuild it. Each second gate that used to be here carries
   * `struct.tech` (`Defs.ts:475-477`), which `UnlockGate` withholds until a
   * profile has earned it — so naming one here locks the rebuild for exactly
   * the player least able to survive the loss.
   */
  const REBUILD: ReadonlyArray<readonly [key: string, from: string, locked: string]> = [
    ['mcv', 'warFactory', 'battleLab'],
    ['mrdCarryall', 'mrdForgeyard', 'mrdReliquary'],
    ['rclCrawler', 'rclBreakerYard', 'rclCrucible'],
  ];

  it.each(REBUILD)('%s needs only %s, never %s', async (key, from, locked) => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    const entry = catalog.byKey(key);
    expect(entry, `${key} must exist in the catalog`).not.toBeNull();

    expect(
      entry!.prereqs,
      `${key} must be rebuildable from ${from} alone — a match opens with one of these and ` +
        'losing it must not be unrecoverable',
    ).toEqual([from]);

    expect(
      entry!.prereqs,
      `${locked} carries struct.tech, which a fresh profile has not unlocked`,
    ).not.toContain(locked);
  });
});
