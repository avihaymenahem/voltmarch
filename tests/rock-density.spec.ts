/**
 * ============================================================================
 * tests/rock-density.spec.ts — there are too many rocks, and they block things
 * ============================================================================
 * "reduce the number of boulders and rocks by at least 30% all around, they
 *  spawn way too much and causing other bugs."
 *
 * TWO CLAIMS, and the second is the one that matters. `rock` is a 2 m nav
 * blocker and `boulder` a 3.2 m one, and tests/start-clearance.spec.ts already
 * records what that costs: the measured share of armies whose deploy footprint
 * was fouled was arid 48%, coast 39%, snow 29%. Those are exactly the three
 * presets whose prop list LED with a rock.
 *
 * TWO SYSTEMS PLACE ROCKS AND BOTH HAD TO MOVE, or the cut would only show in
 * half the props on screen:
 *
 *   1. `MAP_PRESETS[].props` — the base scatter. `ScenarioBuilder.scatter`
 *      picks with `floor(-log2(1 - r))`, so INDEX 0 APPEARS HALF THE TIME.
 *      Ordering is the weight, and `arid` led with rock AND boulder: 75% of
 *      its props were nav blockers.
 *   2. `PROP_LIBRARY`'s per-biome weights — the world scatter, plus the clump
 *      sizes, which are what actually read as "way too much": six boulders in
 *      a twelve-metre spread is a rockfall, not scenery.
 *
 * These cases pin the ARITHMETIC of the pick rather than counting props in a
 * generated world. That is deliberate: a count depends on seed, biome, walkable
 * area and the top-up pass, so it would need a tolerance wide enough to hide
 * the very regression this is guarding. The pick weights are exact.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { MAP_PRESETS } from '../src/core/config';
import { PROP_DEFS } from '../src/world/PropLibrary';
import { BIOME_NAMES } from '../src/world/Biomes';

/**
 * Probability that `ScenarioBuilder.scatter` picks index `i` from a list of
 * `n`, transcribed from src/game/Scenarios.ts:
 *
 *     kinds[Math.min(kinds.length - 1, Math.floor(-Math.log2(1 - rng.next())))]
 *
 * `-log2(1 - U)` is exponential with p(k) = 2^-(k+1), and the `min` clamps the
 * whole tail onto the last entry — which is why the LAST slot is never as cheap
 * as the geometric series alone suggests.
 */
function pickProbability(i: number, n: number): number {
  if (i < n - 1) return 2 ** -(i + 1);
  // The last index absorbs everything from here up.
  return 2 ** -i;
}

/** Share of a preset's scatter that is a rock or a boulder. */
function rockShare(props: readonly string[]): number {
  let share = 0;
  for (let i = 0; i < props.length; i++) {
    if (props[i] === 'rock' || props[i] === 'boulder') share += pickProbability(i, props.length);
  }
  return share;
}

/* ========================================================================== */

describe('the pick model matches the code it describes', () => {
  it('sums to exactly 1 for any list length', () => {
    // If this drifts, every number below is measuring a fiction.
    for (let n = 1; n <= 6; n++) {
      let total = 0;
      for (let i = 0; i < n; i++) total += pickProbability(i, n);
      expect(total, `n=${n}`).toBeCloseTo(1, 12);
    }
  });

  it('gives index 0 half the picks', () => {
    expect(pickProbability(0, 4)).toBe(0.5);
    expect(pickProbability(1, 4)).toBe(0.25);
  });
});

/* ========================================================================== */

describe('no preset leads with a nav blocker', () => {
  /**
   * The mechanism behind "causing other bugs". A prop list whose index 0 is a
   * 2 m nav blocker puts one every other prop, and the deploy footprint has to
   * find a gap between them.
   */
  it('never puts rock or boulder first', () => {
    for (const [name, preset] of Object.entries(MAP_PRESETS)) {
      const first = preset.props[0];
      expect(first, `${name} leads with ${first}`).not.toBe('rock');
      expect(first, `${name} leads with ${first}`).not.toBe('boulder');
    }
  });

  it('holds every preset rock share under 40%', () => {
    // arid was 75%, coast 56%, snow 50%. The three that led with a rock are
    // exactly the three start-clearance measured as worst for fouled deploys.
    for (const [name, preset] of Object.entries(MAP_PRESETS)) {
      const share = rockShare(preset.props);
      expect(share, `${name} is ${(share * 100).toFixed(1)}% rock`).toBeLessThan(0.40);
    }
  });

  it('cuts the three worst presets by at least 30%, which is what was asked', () => {
    // Transcribed from the tables before the change, so the delta is a real
    // before/after and not a target restated as a result.
    const BEFORE: Record<string, readonly string[]> = {
      arid: ['rock', 'boulder', 'bush', 'barrel'],
      coast: ['rock', 'bush', 'tree', 'boulder'],
      snow: ['pine', 'rock', 'boulder'],
    };
    for (const [name, before] of Object.entries(BEFORE)) {
      const preset = MAP_PRESETS[name];
      expect(preset, name).toBeDefined();
      const was = rockShare(before);
      const now = rockShare(preset!.props);
      const cut = 1 - now / was;
      expect(cut, `${name}: ${(was * 100).toFixed(1)}% -> ${(now * 100).toFixed(1)}%`)
        .toBeGreaterThanOrEqual(0.30);
    }
  });

  it('leaves the presets that were already sparse alone', () => {
    // temperate and tropical sat at 12.5% and were not the complaint. Cutting
    // them too would have been scope creep dressed as thoroughness.
    expect(rockShare(MAP_PRESETS.temperate!.props)).toBeCloseTo(0.125, 6);
    expect(rockShare(MAP_PRESETS.tropical!.props)).toBeCloseTo(0.125, 6);
  });

  it('still HAS rocks — this was a cut, not a removal', () => {
    // A desert with no rocks is a different bug report.
    for (const [name, preset] of Object.entries(MAP_PRESETS)) {
      if (name === 'urban') continue;   // roads and containers, by design
      expect(rockShare(preset.props), `${name} lost its rocks entirely`)
        .toBeGreaterThan(0);
    }
  });
});

/* ========================================================================== */

describe('the world scatter came down too', () => {
  const rocks = PROP_DEFS.filter((d) => d.family === 'rock');

  it('has the two rock archetypes this is about', () => {
    expect(rocks.map((r) => r.key).sort()).toEqual(['boulder', 'rockCluster']);
  });

  it('cut every biome weight by at least 30%', () => {
    // Transcribed from the table before the change.
    const BEFORE: Record<string, Record<string, number>> = {
      boulder: { temperate: 0.70, desert: 1.00, snow: 0.85, urban: 0.30 },
      rockCluster: { temperate: 0.85, desert: 1.00, snow: 0.90, urban: 0.40 },
    };
    for (const def of rocks) {
      const before = BEFORE[def.key];
      expect(before, def.key).toBeDefined();
      for (const biome of BIOME_NAMES) {
        const was = before![biome]!;
        const now = def.biome[biome];
        expect(1 - now / was, `${def.key} on ${biome}: ${was} -> ${now}`)
          .toBeGreaterThanOrEqual(0.30);
      }
    }
  });

  it('shrank the CLUMP, which is what reads as "way too much"', () => {
    // Weight decides how often a clump lands; clumpMax decides how many rocks
    // it drops. Six boulders in a twelve-metre spread is a rockfall.
    const boulder = rocks.find((r) => r.key === 'boulder')!;
    expect(boulder.clumpMax).toBeLessThanOrEqual(4);
    expect(boulder.clumpMin).toBeGreaterThanOrEqual(1);
    expect(boulder.clumpMin).toBeLessThanOrEqual(boulder.clumpMax);
  });

  it('keeps a rock on every biome', () => {
    for (const def of rocks) {
      for (const biome of BIOME_NAMES) {
        expect(def.biome[biome], `${def.key} vanished from ${biome}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the boulder a nav blocker and the cluster not', () => {
    // The cut is about HOW MANY, not about what they do. Quietly turning off
    // `blocksNav` would "fix" the deploy fouling by removing the obstacle the
    // player can see, which is worse than the crowding.
    expect(rocks.find((r) => r.key === 'boulder')!.blocksNav).toBe(true);
    expect(rocks.find((r) => r.key === 'rockCluster')!.blocksNav).toBe(false);
  });
});
