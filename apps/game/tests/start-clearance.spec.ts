/**
 * ============================================================================
 * tests/start-clearance.spec.ts — the opening must be playable on every map
 * ============================================================================
 * Reported twice. First: "You spawned me in a place i cannot build, also, the
 * tanks are on top of hill ant cant reach me." That was blamed on start-spot
 * rotation and rotation was switched off. Then, with rotation still off, a
 * screenshot: "im surrounded by rocks everywhere, i cant build at all."
 *
 * Rotation was never the cause. `ScenarioBuilder` has a reservation list
 * (`block()` / `isBlocked()`) that `scatter()` honours, and only `spawnBuilding`,
 * `spawnWreck` and scatter-against-itself ever put anything in it. `spawnUnit`
 * and `formation` reserve NOTHING — so when matches moved from opening on a
 * pre-built base (whose footprints reserved the ground as a side effect) to
 * opening on an MCV (which is a unit), `b.scatter(..., 140)` became free to drop
 * nav-blocking props onto the exact square the match cannot start without.
 *
 * WHY IT PRESENTS AS TOTAL FAILURE
 * --------------------------------
 * A refused deploy means no Construction Yard. No Construction Yard means no
 * build radius exists at all, so `evaluatePlacement` fails EVERY site with
 * `OutOfRange`. "I cant build at all" was literally accurate.
 *
 * WHY THE SWEEP, AND WHY PER MAP
 * ------------------------------
 * The defect is seed- and preset-dependent, so a single-seed test cannot see it.
 * Measured before the fix, share of armies whose deploy footprint was fouled:
 *
 *     arid 48%   coast 39%   snow 29%   urban 9%   tropical 9%   temperate 6%
 *
 * `arid` and `coast` list `rock` (a 2 m nav blocker) at index 0, and the pick in
 * `ScenarioBuilder.scatter` is weighted richest-first, so about half their props
 * block; `snow` adds `boulder` at 3.2 m. A test that only ran `temperate` — the
 * default preset — would have reported the healthiest map in the set and missed
 * the two worst entirely.
 *
 * NONE OF THE TWELVE SCORECARD FIXTURES USE THIS PATH. Every `?shot=` runs a
 * dedicated plan (`allied-base`, `battle`, `economy`, `placement`, ...); only
 * `skirmish` reaches `buildMcvStartFor`. Checked before touching it, because
 * changing scatter placement under a fixture would move the grade and look like
 * an art regression.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { EntityFlag, EntityKind, Faction } from '../src/core/types';
import { AUTO_BASE_APRON_RADIUS, CELL, MCV_START_SCATTER_CLEAR_RADIUS } from '../src/core/config';
import {
  FALLBACK_PROPS, START_CLEAR_RADIUS, START_ESCORT_CLEAR_RADIUS,
  buildScenario, clearScenario, clearDefBindingCache, resolveDefBinding,
} from '../src/game/Scenarios';
import { DEF_TABLES } from '../src/data/Defs';

/** Every preset a player can pick, not just the default one. */
const MAPS = ['temperate', 'arid', 'tropical', 'snow', 'coast', 'urban'] as const;
const SEEDS = 24;

function makeWorld(human: Faction, ai: Faction): World {
  const world = new World();
  world.addPlayer(human, 'Commander', true, true);
  world.addPlayer(ai, 'Opponent', false, false);
  return world;
}

interface Deployer { key: string; into: string; fw: number; fh: number }

/** Units marked `deploysInto`, with the footprint of what they become. */
function deployerTable(): Map<number, Deployer> {
  const out = new Map<number, Deployer>();
  DEF_TABLES.units.forEach((u, idx) => {
    const into = u.deploysInto;
    if (into === null || into === undefined) return;
    const b = DEF_TABLES.buildings.find((d) => d.key === into);
    out.set(idx, { key: u.key, into, fw: b?.footprintW ?? 0, fh: b?.footprintH ?? 0 });
  });
  return out;
}

/**
 * Largest prop radius the scenario scatter can produce, at max scale.
 *
 * EVERY PROP, not just the blocking ones. This filtered on
 * `EntityFlag.BlocksNav`, and once `rock` and `boulder` gave that flag up NO
 * prop carried it — so this returned 0 and both drift guards below passed
 * VACUOUSLY, which is worse than failing. The reservation this derives has
 * never read the flag anyway: `ScenarioBuilder.scatter` keeps every prop off
 * the opening, blocking or not, and a tree parked in the deploy square is just
 * as unwelcome as a boulder. The number is unchanged — boulder's 3.2 is still
 * the widest — which is the point: the guard keeps its margin and stops lying.
 */
function maxPropRadius(): number {
  let r = 0;
  for (const p of Object.values(FALLBACK_PROPS)) {
    if (p.radius > r) r = p.radius;
  }
  // `ScenarioBuilder.scatter` spawns with `scale: rng.range(0.8, 1.35)`.
  return r * 1.35;
}

describe('the reserved radius is derived, not guessed', () => {
  it('covers the largest deployer footprint plus the largest blocking prop', () => {
    const deployers = deployerTable();
    expect(deployers.size, 'no unit declares deploysInto — the table moved').toBeGreaterThan(0);

    let worstHalfDiagonal = 0;
    for (const d of deployers.values()) {
      expect(d.fw, `${d.key} deploys into unknown "${d.into}"`).toBeGreaterThan(0);
      // The deploy square is axis-aligned; its worst case against a circular
      // reservation is the corner, so the half-DIAGONAL is what must fit.
      const half = Math.hypot(d.fw * CELL, d.fh * CELL) / 2;
      if (half > worstHalfDiagonal) worstHalfDiagonal = half;
    }

    // THIS IS THE DRIFT GUARD. A faction that later fields a bigger yard, or a
    // bigger blocking prop, fails here rather than silently reintroducing an
    // unplayable opening.
    expect(
      START_CLEAR_RADIUS,
      `a ${worstHalfDiagonal.toFixed(2)} m half-diagonal plus a `
      + `${maxPropRadius().toFixed(2)} m prop no longer fits in ${START_CLEAR_RADIUS} m`,
    ).toBeGreaterThanOrEqual(worstHalfDiagonal + maxPropRadius());
  });

  it('reserves the escort lane too, and less than the deploy pad', () => {
    // The escort needs room but not a deploy footprint, so a smaller circle is
    // correct; equal or larger would mean one of the two numbers is unconsidered.
    expect(START_ESCORT_CLEAR_RADIUS).toBeGreaterThan(maxPropRadius());
    expect(START_ESCORT_CLEAR_RADIUS).toBeLessThan(START_CLEAR_RADIUS);
  });

  it('dresses an MCV opening without crowding its deploy core', () => {
    // The instanced layer is visual-only and is felled when a structure lands,
    // so it needs a readable buffer rather than the whole procedural-base
    // compound. Guard both sides: enough room for the hard entity-prop safety
    // radius, but decisively smaller than the 52 m base apron that caused the
    // sterile opening.
    expect(MCV_START_SCATTER_CLEAR_RADIUS).toBeGreaterThan(START_CLEAR_RADIUS);
    expect(MCV_START_SCATTER_CLEAR_RADIUS).toBeLessThan(AUTO_BASE_APRON_RADIUS * 0.5);
  });
});

describe('every army can deploy where it spawns', () => {
  it('lands no nav-blocking prop in any deploy footprint, on any map', async () => {
    clearDefBindingCache();
    const defs = await resolveDefBinding();
    const deployers = deployerTable();

    const failures: string[] = [];
    let starts = 0;

    for (const map of MAPS) {
      for (let s = 0; s < SEEDS; s++) {
        const seed = 1000 + s * 37;
        const world = makeWorld(Faction.Allies, Faction.Soviets);
        try {
          buildScenario(world, 'skirmish', seed, { start: 'mcv', defs, map });
          const st = world.store;

          const subjects: number[] = [];
          const blockers: number[] = [];
          for (let a = 0; a < st.aliveCount; a++) {
            const i = st.alive[a];
            // EVERY PROP. This asked for `EntityFlag.BlocksNav`, and no prop
            // carries it since rock and boulder gave it up — so `blockers` came
            // back empty, `failures` was unconditionally `[]`, and the whole
            // 576-start sweep passed without testing anything. It is the
            // regression guard for "im surrounded by rocks everywhere, i cant
            // build at all", and it would have become a 300-second no-op.
            //
            // The runtime reservation never read the flag either — `scatter`
            // honours the reserved discs for every prop it places — so pointing
            // this at all props tests what the code actually promises.
            if (st.kind[i] === EntityKind.Vehicle && deployers.has(st.defId[i])) subjects.push(i);
            else if (st.kind[i] === EntityKind.Prop) blockers.push(i);
          }

          expect(subjects.length, `${map}/${seed} spawned no deployer at all`).toBe(2);

          for (const m of subjects) {
            starts++;
            const d = deployers.get(st.defId[m]) as Deployer;
            const halfW = (d.fw * CELL) / 2;
            const halfH = (d.fh * CELL) / 2;
            const mx = st.posX[m];
            const mz = st.posZ[m];
            for (const p of blockers) {
              const r = st.radius[p];
              if (Math.abs(st.posX[p] - mx) < halfW + r
                && Math.abs(st.posZ[p] - mz) < halfH + r) {
                failures.push(
                  `${map} seed ${seed}: ${d.key} at (${mx.toFixed(0)},${mz.toFixed(0)}) `
                  + `has a blocking prop r=${r.toFixed(1)} in its ${d.fw}x${d.fh} footprint`,
                );
                break;
              }
            }
          }
        } finally {
          clearScenario();
        }
      }
    }

    expect(starts).toBe(MAPS.length * SEEDS * 2);
    expect(failures, failures.slice(0, 8).join('\n')).toEqual([]);
  }, 300_000);

  it('does not buy the clearance by emptying the map', async () => {
    // A "fix" that simply scattered fewer props would pass the test above and
    // strip the battlefield. `scatter` uses bounded rejection sampling, so the
    // reservation should RELOCATE props, not lose them.
    clearDefBindingCache();
    const defs = await resolveDefBinding();

    for (const map of MAPS) {
      const world = makeWorld(Faction.Allies, Faction.Soviets);
      try {
        buildScenario(world, 'skirmish', 4242, { start: 'mcv', defs, map });
        const st = world.store;
        let props = 0;
        for (let a = 0; a < st.aliveCount; a++) {
          const kind = st.kind[st.alive[a]];
          // Scatter's crate archetype is intentionally interactive and
          // therefore allocates as EntityKind.Crate. It is still visible map
          // dressing and must count for this anti-empty-map guard; excluding
          // it made sparse roadside composition look like lost decoration.
          if (kind === EntityKind.Prop || kind === EntityKind.Crate) props++;
        }
        // The skirmish plan asks for 140 visible scatter entities. Urban can
        // still place fewer after clearance and road reservations, but it may
        // not buy safe starts by emptying the battlefield.
        expect(props, `${map} placed only ${props} props`).toBeGreaterThan(100);
      } finally {
        clearScenario();
      }
    }
  }, 120_000);
});
