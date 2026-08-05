/**
 * Which army gets which start spot.
 *
 * Reported: "why every game i start looks exactly the same? why the game dont
 * drop me in random locations?"
 *
 * Three causes were found; this file covers the one that was fixed. `startSpots`
 * hands terrain shelves out in index order and the geometric fallback pins slot
 * 0 outright, so the human always opened in the same corner. Rotating which
 * OWNER sits in each unchanged spot varies the match without disturbing the
 * authored geometry — each spot keeps its ore field, its facing and its place on
 * the map's diagonal.
 *
 * The load-bearing test here is the LAST one. The twelve scorecard fixtures pose
 * a camera at a corner and expect a particular army's base to be standing in it.
 * If the canonical `?shot=` seed ever started rotating, every fixture would frame
 * the wrong base, the grade would move, and it would be blamed on an art change.
 */

import { describe, expect, it } from 'vitest';

import { rotateStarts } from '../src/game/Scenarios';
import { DEFAULT_SEED } from '../src/core/config';
import { hashU32 } from '../src/core/math';

describe('start spot rotation', () => {
  it('returns the same members, only reordered', () => {
    for (let seed = 0; seed < 200; seed++) {
      const out = rotateStarts(['a', 'b'], seed);
      expect(out).toHaveLength(2);
      expect([...out].sort()).toEqual(['a', 'b']);
    }
  });

  it('is deterministic: the same seed always gives the same arrangement', () => {
    // A replay, a save reload and the soak test all depend on this.
    for (const seed of [1, 7, 12345, 0x5eed1234, 0xc0ffee]) {
      expect(rotateStarts(['a', 'b'], seed)).toEqual(rotateStarts(['a', 'b'], seed));
    }
  });

  it('IS CURRENTLY HELD OFF — every seed gives the identity', () => {
    // Rotation shipped and the reporter's next match was unplayable: "You
    // spawned me in a place i cannot build, also, the tanks are on top of hill
    // ant cant reach me."
    //
    // Spot 1 was the AI's for the project's whole life and was never validated
    // for a human — `buildMcvStartFor` checks neither buildable area nor that
    // the escort lands in the same reachable region as the MCV. Rotation did
    // not create that; it made it reachable. So `START_ROTATION_ENABLED` is
    // false until a start-spot validator lands.
    //
    // This test exists so the hold is deliberate and visible. When the
    // validator ships, flip the constant and swap this for the variety
    // assertion below it.
    let swapped = 0;
    for (let i = 0; i < 2000; i++) {
      if (rotateStarts(['a', 'b'], hashU32(i))[0] === 'b') swapped++;
    }
    expect(swapped, 'rotation must stay off until start spots are validated').toBe(0);
  });

  it('the underlying permutation would vary evenly once re-enabled', () => {
    // The maths is tested independently of the gate, so re-enabling is a
    // one-line change with its distribution already proven rather than an
    // unknown. A "fix" that technically rotates but lands on the same answer
    // 99% of the time would not be one.
    let odd = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (hashU32(hashU32(i)) % 2 === 1) odd++;
    expect(odd).toBeGreaterThan(N * 0.4);
    expect(odd).toBeLessThan(N * 0.6);
  });

  it('handles more than two armies as a rotation', () => {
    const four = ['a', 'b', 'c', 'd'];
    for (let seed = 0; seed < 50; seed++) {
      const out = rotateStarts(four, seed);
      const at = four.indexOf(out[0]);
      // Every entry must be the same distance round the table from its origin.
      for (let i = 0; i < four.length; i++) {
        expect(out[i]).toBe(four[(i + at) % four.length]);
      }
    }
  });

  it('leaves a one-army or empty layout untouched', () => {
    expect(rotateStarts(['solo'], 999)).toEqual(['solo']);
    expect(rotateStarts([], 999)).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const owners = ['a', 'b'];
    rotateStarts(owners, 3);
    expect(owners).toEqual(['a', 'b']);
  });

  it('THE FIXTURE GUARD: the canonical shot seed yields the identity', () => {
    // `?shot=` runs at DEFAULT_SEED. If this ever rotates, all twelve scorecard
    // fixtures frame a different army's base than they were authored against,
    // the 89.0% moves, and the cause looks like an art regression rather than a
    // seed change. Asserted rather than left to luck.
    expect(hashU32(DEFAULT_SEED) % 2).toBe(0);
    expect(rotateStarts(['allies', 'soviets'], DEFAULT_SEED)).toEqual(['allies', 'soviets']);
  });
});
