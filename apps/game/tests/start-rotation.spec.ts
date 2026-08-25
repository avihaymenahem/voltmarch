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

  it('ACTUALLY ROTATES, and spreads evenly across the spots', () => {
    // Enabled 2026-08-05. The hold's premise — "spot 1 has never been validated
    // for a human" — was disproved by measurement: over 24 seeds x 4 biomes,
    // seeds with under 60% buildable ground inside BUILD_RADIUS were 31/96 at
    // spot0 against 34/96 at spot1, and which spot is better flips by biome.
    // Neither was validated; rotation was blamed for being the newest change.
    //
    // What landed before this flip: `nudgeToBuildable` (65/192 bad openings down
    // to 15/192) and `START_CLEAR_RADIUS` (up to 48% of armies unable to deploy
    // on `arid`, now 0%).
    //
    // A rotation that technically rotates but lands on the same answer 99% of
    // the time would not be a fix, so the distribution is asserted, not just the
    // fact that it moves.
    //
    // SEEDS ARE PASSED RAW. An earlier version of this test fed `hashU32(i)` as
    // the seed, which double-hashed and reported a perfect 50/50 while the real
    // game — which passes the seed straight through — rotated only 1 seed in 8.
    // `hashU32`'s lowest bit is badly distributed for small inputs, and the test
    // was hashing that weakness away before it could be seen. A test must
    // exercise the caller's actual input.
    let swapped = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      if (rotateStarts(['a', 'b'], i)[0] === 'b') swapped++;
    }
    expect(swapped, 'rotation is enabled — it must actually vary').toBeGreaterThan(N * 0.4);
    expect(swapped).toBeLessThan(N * 0.6);
  });

  it('varies across the SMALL, SEQUENTIAL seeds a person actually types', () => {
    // The bulk distribution above passes even when the first few dozen seeds are
    // nearly all the same — which is exactly what happened. `?seed=1` through
     // `?seed=8` gave seven identical openings.
    let swapped = 0;
    for (let i = 1; i <= 32; i++) if (rotateStarts(['a', 'b'], i)[0] === 'b') swapped++;
    expect(swapped, 'seeds 1..32 must not collapse onto one spot').toBeGreaterThanOrEqual(10);
    expect(swapped).toBeLessThanOrEqual(22);
  });

  it('a single seed still gives ONE stable answer', () => {
    // Rotation must vary ACROSS matches, never within one. A save reload, a
    // replay and the determinism soak all reconstruct the layout from the seed
    // alone, so the same seed asked twice has to agree.
    for (const seed of [1, 7, 12345, 0x5eed1234, 0xc0ffee]) {
      const first = rotateStarts(['a', 'b', 'c'], seed);
      for (let k = 0; k < 20; k++) {
        expect(rotateStarts(['a', 'b', 'c'], seed)).toEqual(first);
      }
    }
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

  it('the canonical seed is PINNED, so a hash change cannot drift silently', () => {
    // THIS TEST USED TO CLAIM SOMETHING FALSE. It asserted the canonical seed
    // yields the identity arrangement, on the stated grounds that otherwise "all
    // twelve scorecard fixtures frame a different army's base". They do not:
    // every `?shot=` fixture runs a DEDICATED plan (`allied-base`, `soviet-base`,
    // `battle`, `economy`, `placement`, `selection`, `naval`, `blob`,
    // `terrain-showcase`, `unit-parade`), and `startSpots`/`rotateStarts` are
    // reached only by `skirmish`, which is not one of them. Checked against
    // `tools/shoot.mjs`.
    //
    // The identity also stopped being true when `startOffset` moved to the high
    // bits of the hash — a deliberate change, because the low bit rotated only
    // 1 seed in 8 for small seeds.
    //
    // What is still worth pinning is that the canonical arrangement does not
    // move by ACCIDENT. So: assert the current value, whatever it is, and make a
    // future hash change announce itself here instead of in a screenshot.
    expect(rotateStarts(['allies', 'soviets'], DEFAULT_SEED)).toEqual(['soviets', 'allies']);
  });

  it('distributes evenly for more than two armies', () => {
    // `n = 4` must not favour a slot. Asserted because the offset is derived by
    // scaling a hash into [0, n) rather than by a modulo, and an off-by-one in
    // that scaling shows up as a starved or doubled bucket, not as a crash.
    const buckets = [0, 0, 0, 0];
    const N = 4000;
    for (let i = 0; i < N; i++) {
      buckets[['a', 'b', 'c', 'd'].indexOf(rotateStarts(['a', 'b', 'c', 'd'], i)[0])]++;
    }
    for (const b of buckets) {
      expect(b, `buckets ${buckets.join(',')} are not even`).toBeGreaterThan(N / 4 * 0.85);
      expect(b).toBeLessThan(N / 4 * 1.15);
    }
  });
});
