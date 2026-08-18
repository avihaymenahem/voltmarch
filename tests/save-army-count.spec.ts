/**
 * ============================================================================
 * tests/save-army-count.spec.ts — a save remembers how many seats the ground
 * was levelled for
 * ============================================================================
 * THE DEFECT
 * ----------
 * Terrain, roads and scatter are REGENERATED on load, never stored, and
 * `Shell.bootGame` calls `setPlannedArmies(armyCount(this.setup))` — so the
 * generator reserves one levelled shelf per army in the setup that BOOTED.
 * `Shell.loadGame` deliberately booted with a one-entry `opponents` list, on
 * the argument that `restoreSnapshot` re-seats the whole player table anyway.
 *
 * That argument is sound for the PLAYER TABLE and unsound for the GROUND. A
 * three- or four-way save came back with its bases on a heightfield levelled
 * for two, and `requireMatchingWorld` cannot catch it — it compares scenario,
 * map and seed, and all three match. It was masked until the army-count wire
 * landed, because before that every boot planned two and the capture and the
 * restore agreed by accident.
 *
 * THE PART THAT IS ACTUALLY EASY TO GET WRONG
 * -------------------------------------------
 * `extraOf` was described — in CLAUDE.md, no less — as falling back "field by
 * field". That is true of `kind` and `thumbnail` and was FALSE of `context`,
 * which was one `??` over the whole object. A row already on disk HAS a context
 * object, so the `??` never fires for it: a newly-required field would read
 * `undefined` at runtime on every existing save while typechecking as present,
 * and `armies - 1` on `undefined` is `NaN` seats. The fallback is per-field
 * now, and the first two cases below are about that rather than about armies.
 * ========================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { contextOf } from '../src/game/save.system';
import type { SaveSlotInfo } from '../src/game/SaveStore';

const ROOT = join(__dirname, '..');

/** A `SaveMeta` with only the fields the fallback reads off it. */
const infoFor = (map: string, seed: number, extra: unknown): SaveSlotInfo => ({
  slot: 'manual.abc.1',
  meta: {
    schemaVersion: 1, structuralHash: 0, label: 'x', savedAtMs: 1, tick: 0,
    simTimeSec: 0, scenario: 'skirmish', map, seed, localPlayerName: 'p',
    localFaction: 1, credits: 0, entityCount: 0, byteLength: 0,
  },
  extra,
});

const LEGACY = {
  mapId: 'coral-shore', playerFaction: 'allies', aiFaction: 'soviets',
  difficulty: 2, speed: 1, seed: 99,
};

describe('the context fallback is per-field, which is what lets it grow', () => {
  it('a row written before `armies` existed keeps every field it did have', () => {
    const c = contextOf(LEGACY, infoFor('temperate', 7, { context: LEGACY }));
    expect(
      { ...c, armies: undefined },
      'a whole-object `??` would have been skipped here — the row HAS a context — '
      + 'so this asserts the per-field path did not quietly blank anything.',
    ).toEqual({ ...LEGACY, armies: undefined });
  });

  it('and reads 2 for the seat count, because that is what it already booted as', () => {
    const c = contextOf(LEGACY, infoFor('temperate', 7, { context: LEGACY }));
    // `SaveMeta` carries no seat count and the blob is not open yet, so there
    // is genuinely nothing better to infer. 2 is not a guess at the truth; it
    // is the behaviour that row already had, chosen so nothing regresses.
    expect(c.armies).toBe(2);
  });

  it('a row that carries the seat count is believed', () => {
    expect(contextOf({ ...LEGACY, armies: 4 }, infoFor('atoll', 1, null)).armies).toBe(4);
  });

  it('a corrupt seat count cannot plan a world for NaN or for one seat', () => {
    for (const bad of [undefined, null, 'four', NaN, Infinity, 0, 1, -3]) {
      const c = contextOf({ ...LEGACY, armies: bad }, infoFor('temperate', 7, null));
      expect(Number.isInteger(c.armies), `armies=${String(bad)} produced ${c.armies}`).toBe(true);
      expect(c.armies).toBeGreaterThanOrEqual(2);
    }
  });

  it('a missing context entirely still recovers map and seed from the blob header', () => {
    const c = contextOf(undefined, infoFor('frozen-sector', 4321, null));
    expect([c.mapId, c.seed, c.armies]).toEqual(['frozen-sector', 4321, 2]);
  });
});

describe('the shell writes it and reads it back', () => {
  const src = readFileSync(join(ROOT, 'src/shell/Shell.ts'), 'utf8');

  const methodBody = (signature: string): string => {
    const at = src.indexOf(signature);
    expect(at, `Shell.ts no longer has \`${signature}\``).toBeGreaterThan(0);
    let parens = 0;
    let i = src.indexOf('(', at);
    for (; i < src.length; i++) {
      if (src[i] === '(') parens++;
      else if (src[i] === ')' && --parens === 0) break;
    }
    let depth = 0;
    for (i = src.indexOf('{', i); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
    }
    throw new Error(`\`${signature}\` never closes`);
  };

  it('`saveContext` records the number `bootGame` planned with', () => {
    // `armyCount(this.setup)` is the same expression `bootGame` hands
    // `setPlannedArmies`. Anything else here — `world.players.length`, a
    // literal — is a second definition of "how many armies" and they will
    // disagree, because the player table seats Neutral.
    expect(methodBody('saveContext(')).toContain('armies: armyCount(this.setup)');
  });

  it('`loadGame` rebuilds the opponent list from it, not from a literal', () => {
    const body = methodBody('async loadGame(');
    expect(body).toContain('c.armies');
    expect(
      body,
      'the one-entry literal is the defect: it plans two shelves for a four-way save',
    ).not.toMatch(/opponents:\s*\[\s*\{\s*faction:/);
  });

  it('`startReplay` still does the same thing the other way, and is the model', () => {
    // Named here because `loadGame`'s fix is a copy of it. If this stops being
    // true the two paths have diverged and one of them is planning the wrong
    // ground again.
    expect(methodBody('async startReplay(')).toContain('header.players');
  });
});
