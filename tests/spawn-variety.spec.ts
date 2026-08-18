/**
 * ============================================================================
 * tests/spawn-variety.spec.ts — four spawns per map, and none of them wet
 * ============================================================================
 * Reported as *"Our spawns are weird, we always spawn few meteres away from
 * enemy, even thought maps are huge, we dont take advantage of that, also, its
 * almost always the same spawns.. we need to define at least 4 possible spawns
 * in each map"*. Three complaints, and they needed three different answers:
 *
 *   "few metres away"        -> START_SPREAD x2. 193.1 m opening -> 386.2 m.
 *   "always the same spawns" -> `seatedSlots` picks WHICH slots a match uses,
 *                               not just who sits in them. This file.
 *   "at least 4 per map"     -> the table has four, and this file walks the
 *                               whole roster proving each map can reach them.
 *
 * WHY THE ROTATION WAS NOT ALREADY THE ANSWER. `rotateStarts` has varied the
 * OWNER of each spot from the seed for a long time. With two armies on a
 * four-slot table that swaps two players between slots 0 and 1 and never
 * touches slots 2 or 3 — so the player saw the same two corners in every match
 * ever played, and the fix for "the same spawns" looked like it was already in.
 *
 * ============================================================================
 * THE TEST THIS FILE EXISTS TO BE, rather than the one that was written first
 * ============================================================================
 * The first attempt at this feature came with a spec that checked the PAIR
 * histogram. It was uniform — 106/90/110/94 over seeds 1..400 — and it was
 * measuring the wrong thing. `startPairFor` and `startOffset` (which
 * `rotateStarts` uses) both read `hashU32(seed)`, and `floor(u*4) >> 1` equals
 * `floor(u*2)` for EVERY seed, so the pair and the rotation moved in lockstep.
 * Corner occupancy of the LOCAL player over 20 000 seeds:
 *
 *     slot 0 ~5015     slot 1 = 0     slot 2 ~9975     slot 3 ~5010
 *
 * One corner unreachable and one at even money, from the feature whose entire
 * purpose is to stop the player seeing the same corner — and a green test.
 *
 * So section 2 pins THE CORNER THE PLAYER LANDS IN, which is what the report
 * was actually about. Pinning the pair pins an implementation detail that can
 * be uniform while the product is broken.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEED, TERRAIN_SEA_START_CLEARANCE, TERRAIN_START_EDGE_WOBBLE,
  TERRAIN_START_FLAT_RADIUS,
} from '../src/core/config';
import {
  MAP_SEAS, SKIRMISH_ARMIES_DEFAULT, SKIRMISH_ARMIES_MAX, SKIRMISH_START_OFFSETS,
  rotateStarts, seatedSlots, startPointsFor,
} from '../src/game/Scenarios';
import { MAPS } from '../src/shell/settings-store';

/** Enough seeds that every draw the hash can make is exercised many times. */
const SEEDS = Array.from({ length: 2000 }, (_, i) => i + 1);

function budgetFor(sea: { bandWidth: number; wavinessMetres: number }): number {
  return TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
    + sea.bandWidth + sea.wavinessMetres + TERRAIN_SEA_START_CLEARANCE;
}

describe('no map ever seats an army in the sea', () => {
  it('clears the shelf-push budget on every shipped map, at every seed', () => {
    // THE ASSERTION WHOSE ABSENCE LET A DROWNED SLOT SHIP. `naval-maps.spec.ts`
    // makes this check, but only for the ONE layout a default boot produces —
    // so a feature that varies the layout by seed walked straight past it.
    // Promoted here from "the reserved list" to "every list this map can
    // produce", over the whole roster rather than the two naval fixtures.
    let checked = 0;
    for (const m of MAPS) {
      const sea = MAP_SEAS[m.preset];
      if (sea === undefined || sea.islands !== undefined) continue;
      const budget = budgetFor(sea);
      for (const seed of SEEDS) {
        // `.slice(1)` drops the centre shelf, which is terrain bookkeeping and
        // not a place anybody spawns — see the note in archipelago.spec.ts.
        for (const p of startPointsFor(SKIRMISH_ARMIES_DEFAULT, sea, seed).slice(1)) {
          const inland = -((p.x - sea.x) * sea.normalX + (p.z - sea.z) * sea.normalZ);
          expect(inland, `${m.id} seed ${seed}: start (${p.x}, ${p.z})`).toBeGreaterThan(budget);
          checked++;
        }
      }
    }
    // A roster loop that silently matches no map is how a sweep stops sweeping.
    expect(checked, 'coastal starts measured').toBeGreaterThan(0);
  });

  it('always hands back one centre shelf plus one per seated army', () => {
    // Three separate specs were restating this by hand. Reserving a shelf per
    // TABLE ENTRY rather than per seated army is what drowned a start in the
    // first place: it levels discs at slots nobody uses, two of which are
    // across the waterline.
    for (const m of MAPS) {
      const sea = MAP_SEAS[m.preset] ?? null;
      const islands = sea?.islands;
      for (const seed of [DEFAULT_SEED, 1, 4242, 99991]) {
        for (const n of [2, 3, 4]) {
          const pts = startPointsFor(n, sea, seed);
          const want = islands !== undefined ? Math.min(n, islands.length) : n + 1;
          expect(pts.length, `${m.id} n=${n} seed=${seed}`).toBe(want);
        }
      }
    }
  });
});

describe('the player does not keep landing in the same corner', () => {
  it('reaches all four corners on a landlocked map, none of them rare', () => {
    // THE MEASUREMENT THAT MATTERS, and the one a pair histogram cannot make.
    // `rotateStarts` decides which seated slot the LOCAL player (owner 0) gets,
    // so the corner is a function of BOTH draws and only their joint behaviour
    // says what a player experiences.
    const corner = new Array<number>(SKIRMISH_ARMIES_MAX).fill(0);
    for (const seed of SEEDS) {
      const slots = seatedSlots(SKIRMISH_ARMIES_DEFAULT, seed, null);
      corner[rotateStarts([...slots], seed)[0]!]!++;
    }
    const expected = SEEDS.length / SKIRMISH_ARMIES_MAX;
    for (let i = 0; i < corner.length; i++) {
      // A wide band: this is a hash, not a shuffle, and the assertion is
      // "reachable and not rare", not "perfectly uniform". Unsalted, slot 1
      // scored 0 and slot 2 scored double — both are far outside this.
      expect(corner[i], `corner ${i} drawn ${corner[i]} times of ${SEEDS.length}`)
        .toBeGreaterThan(expected * 0.5);
      expect(corner[i]).toBeLessThan(expected * 1.5);
    }
  });

  it('does not let the pair track the owner rotation', () => {
    // The root cause, asserted directly rather than through its symptom. Both
    // draws used to come off `hashU32(seed)` with no salt, which made them the
    // same random variable wearing two names.
    let agree = 0;
    for (const seed of SEEDS) {
      const pairIsHigh = seatedSlots(SKIRMISH_ARMIES_DEFAULT, seed, null)[0]! >= 2 ? 1 : 0;
      if (pairIsHigh === rotateStarts([0, 1], seed)[0]!) agree++;
    }
    const rate = agree / SEEDS.length;
    expect(rate, `pair and rotation agreed ${(rate * 100).toFixed(1)}% of the time`)
      .toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.65);
  });

  it('offers every map at least two layouts, and a landlocked map all four', () => {
    // The user asked for "at least 4 possible spawns in each map". A landlocked
    // map gets all four pairings of the four corners that are not adjacent. A
    // coastal map gets fewer, and the reason is physical rather than a choice:
    // one of slots 2/3 is out to sea on any given coast, because slots 0 and 1
    // DEFINE the shoreline normal. Pushing the sea far enough out to dry both
    // would cost the naval game its dock sites — see `dryPairs`.
    for (const m of MAPS) {
      const sea = MAP_SEAS[m.preset] ?? null;
      if (sea?.islands !== undefined) continue;   // islands are their own table
      const seen = new Set<string>();
      for (const seed of SEEDS) seen.add(seatedSlots(SKIRMISH_ARMIES_DEFAULT, seed, sea).join(','));
      const want = sea === null ? 4 : 2;
      expect(seen.size, `${m.id} offers ${[...seen].join(' | ')}`).toBe(want);
    }
  });

  it('never seats two armies on an adjacent corner pair', () => {
    // "Spawns far apart rather than adjacent" is the other half of the report,
    // and it is encoded as a RULE rather than a literal: of the six ways to
    // pick 2 of 4, the two shortest are excluded. Re-derived from the offsets
    // so that authoring a different table cannot silently keep the old list
    // while meaning something else.
    const dist = (i: number, j: number): number => {
      const a = SKIRMISH_START_OFFSETS[i]!;
      const b = SKIRMISH_START_OFFSETS[j]!;
      return Math.hypot(a.dx - b.dx, a.dz - b.dz);
    };
    const all: number[] = [];
    for (let i = 0; i < SKIRMISH_ARMIES_MAX; i++) {
      for (let j = i + 1; j < SKIRMISH_ARMIES_MAX; j++) all.push(dist(i, j));
    }
    all.sort((a, b) => a - b);
    const shortest = all[0]!;
    for (const seed of SEEDS) {
      const [i, j] = seatedSlots(SKIRMISH_ARMIES_DEFAULT, seed, null);
      expect(dist(i!, j!), `seed ${seed} seated an adjacent pair`).toBeGreaterThan(shortest + 1);
    }
  });
});
