/**
 * THE BANNED POST EFFECTS, ENFORCED BY A MACHINE.
 *
 * CLAUDE.md: "Things that are explicitly banned because they read as 'generic
 * engine' and lose points: fog on daylight maps, chromatic aberration, film
 * grain, depth of field, motion blur, and reflective water."
 *
 * Two of those shipped ENABLED for the entire life of the project.
 * `docs/SPEC_DRIFT_AUDIT.md` finding 8 recorded it on 2026-08-05 — "Film grain
 * and chromatic aberration ship ON, against an explicit hard ban, and the check
 * that would catch them is weight 0" — and they were still on when a player
 * reported "even with antialiasing on, this still looks bad, i can see
 * artifacts". Grain re-rolled at 24 Hz across the whole frame and chromatic
 * aberration split R from B by ~5 px at 1080p, both downstream of anything SMAA
 * could do about them.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COMMENT. The ban was already written down,
 * in the one document every agent is told to read first, and it was still
 * violated — because `core/config.ts` set both to 0 and TWO OTHER PLACES
 * overrode it. Anyone grepping the config concluded the ban was honoured. It is
 * the same reason `credits-truthful.spec.ts` exists: this project has learned
 * that a reviewer noticing is not a mechanism.
 *
 * The source scan below is deliberate and is the load-bearing half. Asserting
 * the live config only proves the default; it would not have caught the actual
 * bug, which was a pair of hard-coded literals in an `applySettings` branch that
 * ran at boot and clobbered the default.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { RENDER_CONFIG, applyQualityTier } from '../src/render/renderer';

const TIERS = ['low', 'medium', 'high', 'ultra'] as const;

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
}

/**
 * Every assignment of `key` in `text` whose value is a non-zero numeric literal.
 *
 * Matches `grain: 0.018` and `chromaticAberration: 1e-3`, and deliberately does
 * NOT match `grain: 0`, `grain: 0.0`, or an assignment from a variable — a
 * variable would be caught by the live-config assertions instead.
 */
function nonZeroLiterals(text: string, key: string): string[] {
  const re = new RegExp(`\\b${key}\\s*:\\s*([0-9][0-9_.eE+-]*)`, 'g');
  const hits: string[] = [];
  for (const m of text.matchAll(re)) {
    if (Number(m[1]) !== 0) hits.push(m[0]);
  }
  return hits;
}

describe('banned post effects stay banned', () => {
  it('film grain is zero in the shipped render config', () => {
    expect(RENDER_CONFIG.post.grade.grain).toBe(0);
  });

  it('chromatic aberration is zero in the shipped render config', () => {
    expect(RENDER_CONFIG.post.grade.chromaticAberration).toBe(0);
  });

  it('no quality tier reintroduces either of them', () => {
    // A tier preset overwrites the whole post block, so it is a live route back.
    for (const t of TIERS) {
      applyQualityTier(t);
      expect(RENDER_CONFIG.post.grade.grain, `tier ${t}`).toBe(0);
      expect(RENDER_CONFIG.post.grade.chromaticAberration, `tier ${t}`).toBe(0);
    }
  });

  /*
   * THE ONE THAT WOULD ACTUALLY HAVE CAUGHT IT.
   *
   * The bug was `grade: g.filmGrain ? { grain: 0.018, ..., chromaticAberration:
   * 0.0012 } : { ... }` in `Settings.ts#applySettings`, with `filmGrain`
   * defaulting to true and `applySettings` running with `all` at boot. Every
   * assertion above passes at module scope while that line is present — it only
   * bites once the shell applies settings, which no node test does.
   */
  it('no source file writes a non-zero grain, CA or lens-dirt literal', () => {
    const files = [
      'src/render/renderer.ts',
      'src/shell/Settings.ts',
      'src/core/config.ts',
      'src/game/ArtBridge.ts',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const text = src(f);
      /*
       * `lensDirt` joined the scan when the field was deleted. It is a third
       * instance of the same failure: `RA3_LOOK_BIBLE.md` §11 bans lens dirt by
       * name, and `lensDirt: 0.12` was nonetheless authored in TWO of these
       * four files and bridged through a third for the whole life of the
       * project — read only by a `console.info` noting that the bundled
       * `UnrealBloomPass` has no dirt uniform to feed it. Nothing was looking,
       * which is this file's entire thesis. There is now no field to set; the
       * scan is here so reintroducing one fails in CI rather than in a grade.
       */
      for (const key of ['grain', 'chromaticAberration', 'lensDirt']) {
        for (const hit of nonZeroLiterals(text, key)) offenders.push(`${f}: ${hit}`);
      }
    }
    expect(
      offenders,
      'CLAUDE.md bans film grain and chromatic aberration by name, and '
      + 'RA3_LOOK_BIBLE.md §11 bans lens dirt. If you are deliberately lifting '
      + 'one of those bans, change the document and this test in the same '
      + 'commit — do not just raise the number.',
    ).toEqual([]);
  });

  it('the scan can actually fail — it is not a vacuous regex', () => {
    // Guards the guard. A typo in the pattern would make every assertion above
    // pass forever against any source at all.
    expect(nonZeroLiterals('grade: { grain: 0.018 }', 'grain')).toHaveLength(1);
    expect(nonZeroLiterals('{ chromaticAberration: 0.0012 }', 'chromaticAberration'))
      .toHaveLength(1);
    // And the permitted forms are genuinely permitted.
    expect(nonZeroLiterals('grain: 0', 'grain')).toEqual([]);
    expect(nonZeroLiterals('grain: 0.0', 'grain')).toEqual([]);
    // `grainSize` must not be mistaken for `grain` — it is inert while grain is
    // 0 and is deliberately kept at 1.4.
    expect(nonZeroLiterals('grainSize: 1.4', 'grain')).toEqual([]);
  });
});
