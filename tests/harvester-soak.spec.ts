/**
 * HARVESTER SOAK — the economy loop on a REAL map, for minutes, with numbers.
 *
 * `tests/economy.spec.ts` drives the harvester FSM on a flat null terrain with
 * no buildings and no nav module, which is the right shape for testing the FSM
 * and is exactly why it cannot see the reported failure: "the ore harvesters
 * keep stucking everywhere, getting me without funds mid game". A harvester
 * does not wedge against an abstraction. It wedges against the refinery it is
 * docking with, the war factory next to it, and the crowd of other harvesters
 * queued behind it — none of which exist in that rig.
 *
 * So this file builds the real thing: `buildScenario` terrain, the scenario's
 * own ore fields and base layout, the real `FlowFieldCache` / `NavAssigner` /
 * `SteeringSolver` / `MovementIntegrator` stack, and the real
 * `HarvesterController` in the same 'assist' mode `economy.system.ts` selects
 * when nav is present. Tick order matches `core/loop.ts` phases.
 *
 * It reports, per harvester: distance travelled, deliveries completed, ticks
 * spent in each FSM state, and whether it ever moved again after its last
 * delivery. A stall shows up as delivered-count flatlining while the clock runs.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, Locomotor, UnitState } from '../src/core/types';
import type { PlayerId, SimContext } from '../src/core/types';
import { SIM_DT, SIM_HZ } from '../src/core/config';
import { Rng } from '../src/core/math';

import { FlowFieldCache } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import { Economy, OreField } from '../src/sim/Economy';
import { HarvesterController, setHarvesterDrive } from '../src/sim/Harvesting';
import { buildScenario, activeScenario } from '../src/game/Scenarios';

const P0 = 0 as PlayerId;

/**
 * `UnitState` is a `const enum`, so `UnitState[n]` is a compile error under
 * `isolatedModules`. These are report labels only.
 */
const STATE_NAME: Readonly<Record<number, string>> = {
  [UnitState.Idle]: 'Idle',
  [UnitState.Moving]: 'Moving',
  [UnitState.AttackMoving]: 'AttackMoving',
  [UnitState.Attacking]: 'Attacking',
  [UnitState.Guarding]: 'Guarding',
  [UnitState.SeekOre]: 'SeekOre',
  [UnitState.Harvesting]: 'Harvesting',
  [UnitState.ReturnToRefinery]: 'ReturnToRefinery',
  [UnitState.Docked]: 'Docked',
  [UnitState.Deploying]: 'Deploying',
  [UnitState.UnderConstruction]: 'UnderConstruction',
  [UnitState.Capturing]: 'Capturing',
  [UnitState.Fleeing]: 'Fleeing',
  [UnitState.Dying]: 'Dying',
  [UnitState.Repairing]: 'Repairing',
  [UnitState.Selling]: 'Selling',
};
const stateName = (s: number): string => STATE_NAME[s] ?? `state${s}`;

interface HarvReport {
  slot: number;
  owner: number;
  distance: number;
  delivered: number;
  /** Tick of the most recent cargo delivery, -1 if never. */
  lastDeliveryTick: number;
  /** Metres travelled after the last delivery. */
  distanceSinceDelivery: number;
  states: Record<string, number>;
  finalState: string;
  finalX: number;
  finalZ: number;
}

interface SoakResult {
  ticks: number;
  harvesters: HarvReport[];
  creditsOverTime: number[];
  /** Harvesters that delivered at least once and then stopped delivering. */
  stalled: HarvReport[];
}

/**
 * Run a real skirmish economy for `seconds` and report.
 *
 * `start: 'base'` for the same reason `tests/ai.spec.ts` gives: the default
 * `mcv` opening needs whatever executes `OrderKind.Deploy`, which this file
 * does not register, so the harvesters would never get a refinery at all and
 * the measurement would be about the wrong thing.
 */
function soak(seed: number, seconds: number): SoakResult {
  const world = new World();
  world.addPlayer(1, 'Commander', true, true);
  world.addPlayer(2, 'Opponent', false, false);
  const channels = new Channels();

  buildScenario(world, 'skirmish', seed, { start: 'base' });

  const ore = new OreField();
  const economy = new Economy(world, channels);
  world.ore = ore;

  // The scenario's own patches, filtered exactly as `economy.system.ts` does:
  // ore on water or on impassable cells is value the field can never pay out.
  const spec = activeScenario()!;
  const accept = (cx: number, cz: number): boolean =>
    !world.terrain.isWater(cx, cz) && world.terrain.isPassable(cx, cz, Locomotor.Track);
  for (const f of spec.ore) ore.seedField(f.x, f.z, f.radius, f.richness, accept);

  const harvesters = new HarvesterController(world, channels, ore, economy);
  // What `checkForRealMover()` picks the moment a nav module is in the registry.
  setHarvesterDrive('assist');

  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);

  const st = world.store;
  const slots: number[] = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if ((st.flags[i] & EntityFlag.IsHarvester) !== 0) slots.push(i);
  }

  const reports = new Map<number, HarvReport>();
  const lastX = new Map<number, number>();
  const lastZ = new Map<number, number>();
  for (const i of slots) {
    reports.set(i, {
      slot: i,
      owner: st.owner[i],
      distance: 0,
      delivered: 0,
      lastDeliveryTick: -1,
      distanceSinceDelivery: 0,
      states: {},
      finalState: '',
      finalX: 0,
      finalZ: 0,
    });
    lastX.set(i, st.posX[i]);
    lastZ.set(i, st.posZ[i]);
  }

  const rng = new Rng(seed ^ 0x5eed);
  const ticks = Math.round(seconds * SIM_HZ);
  const creditsOverTime: number[] = [];
  const bankedBefore = new Map<number, number>();
  for (const i of slots) bankedBefore.set(i, st.cargo[i]);

  for (let tick = 1; tick <= ticks; tick++) {
    world.tick = tick;
    world.time = tick * SIM_DT;
    channels.setTick(tick);
    const s: SimContext = { dt: SIM_DT, tick, time: tick * SIM_DT, rng };

    st.snapshotPrev();
    harvesters.simTick(s);          // Phase.Economy  (300)
    economy.tick(s.dt, s.time);
    assigner.simTick(s);            // Phase.PathRequest (500)
    steering.simTick(s);            // Phase.Steering (600)
    movement.simTick(s);            // Phase.Movement (700)
    harvesters.drive(s.dt);         // Phase.Movement, order 900 — the backstop
    nav.update();
    world.spatial.rebuild();        // Phase.SpatialRebuild (800)

    for (const i of slots) {
      const r = reports.get(i)!;
      const dx = st.posX[i] - lastX.get(i)!;
      const dz = st.posZ[i] - lastZ.get(i)!;
      const step = Math.sqrt(dx * dx + dz * dz);
      lastX.set(i, st.posX[i]);
      lastZ.set(i, st.posZ[i]);
      r.distance += step;
      r.distanceSinceDelivery += step;

      const name = stateName(st.state[i]);
      r.states[name] = (r.states[name] ?? 0) + 1;

      // A delivery is the cargo dropping to (near) zero from a real load.
      const before = bankedBefore.get(i)!;
      const now = st.cargo[i];
      if (before > 1 && now <= 0.001) {
        r.delivered++;
        r.lastDeliveryTick = tick;
        r.distanceSinceDelivery = 0;
      }
      bankedBefore.set(i, now);
    }

    if (tick % SIM_HZ === 0) creditsOverTime.push(Math.round(world.player(P0).credits));
  }

  for (const i of slots) {
    const r = reports.get(i)!;
    r.finalState = stateName(st.state[i]);
    r.finalX = st.posX[i];
    r.finalZ = st.posZ[i];
  }

  const all = [...reports.values()];
  // "Stalled" = has not delivered in the last third of the run despite the run
  // being long enough for several round trips.
  const cutoff = ticks - Math.round(ticks / 3);
  const stalled = all.filter((r) => r.lastDeliveryTick < cutoff);

  return { ticks, harvesters: all, creditsOverTime, stalled };
}

function summarise(label: string, r: SoakResult): string {
  const lines = [`\n=== ${label} — ${(r.ticks / SIM_HZ).toFixed(0)}s, ${r.harvesters.length} harvesters ===`];
  for (const h of r.harvesters) {
    const top = Object.entries(h.states).sort((a, b) => b[1] - a[1])
      .slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ');
    lines.push(
      `  p${h.owner} slot${String(h.slot).padStart(3)} ` +
      `deliv=${String(h.delivered).padStart(2)} ` +
      `dist=${h.distance.toFixed(0).padStart(5)}m ` +
      `lastDeliv=${String(h.lastDeliveryTick).padStart(5)} ` +
      `sinceDeliv=${h.distanceSinceDelivery.toFixed(0).padStart(5)}m ` +
      `final=${h.finalState}@${h.finalX.toFixed(0)},${h.finalZ.toFixed(0)}  [${top}]`);
  }
  lines.push(`  credits p0 @10s intervals: ${r.creditsOverTime.filter((_, i) => i % 10 === 9).join(' ')}`);
  lines.push(`  STALLED: ${r.stalled.length}/${r.harvesters.length}`);
  return lines.join('\n');
}

describe('harvester soak on a real map', () => {
  /**
   * A RATCHET, NOT A PASS MARK. Read the numbers below as what the economy
   * currently does, not as what it should do.
   *
   * The reported defect — "the ore harvesters keep stucking everywhere, getting
   * me without funds mid game" — reproduces here, and five separate causes have
   * been found and fixed against this harness so far (see `Harvesting.drive`,
   * `strandedOnBlockedGround`, `HARVESTER_DOCK_STANDDOWN`, `reachableDockPoint`
   * and `HARVESTER_FORCE_DRIVE_SECONDS`). Measured across these three seeds:
   *
   *              deliveries   total distance
   *   at report          14          ~1700 m
   *   after 4 fixes      13          ~1712 m
   *   after 5 fixes      22          ~2902 m
   *   after 8 fixes      26          ~2900 m
   *   after 9 fixes      33          ~4400 m
   *
   * The three most recent were all in NAV, not in the harvester FSM, and all
   * three were cases of a watchdog that could not see the failure it existed
   * for:
   *
   *   1. The stuck watchdog reset its own counter for a hull reporting full
   *      speed while displacing nothing — i.e. exactly a unit grinding into a
   *      wall. Measured: 1800 consecutive pinned ticks, counter never left 0.
   *   2. The obstacle probe sampled ONE point at `radius + lookahead` = 7.07 m
   *      with a 4 m cell, so it read the second cell along and never the one
   *      the hull was about to enter.
   *   3. The wedge ladder needed more consecutive ticks than the FSM's own
   *      destination churn ever allowed it, so the rescue for "it is just
   *      sitting there" could not run on the units that sit there most.
   *
   * The ninth was in the SEAM between the two, and it was the FSM resetting the
   * evidence nav needed. `tickSeek` used to drop its claim and idle once its
   * force-drive budget ran out; `seeksGoal(Idle)` is false, so `NavAssigner`
   * released the field and called `armWedge`, which zeroes `escalations` — and
   * two seconds later the retry re-picked the same cell and zeroed it again.
   * The wedge ladder needs 480 consecutive ticks to reach its displacement rung
   * and 600 to reach its park rung; the cycle was ~420. Measured across these
   * seeds: 87/119/57 wedge detections and ZERO park rungs in twelve minutes of
   * harvesting. The remedy that would have worked was being armed and disarmed
   * by the module asking for it, exactly as `commitDockPoint` documents from
   * the other side.
   *
   * The FSM now holds still instead, and consumes nav's give-up as a signal:
   * eight seconds in which NOTHING moved the hull — not the field, not the
   * backstop — is what finally distinguishes "cannot get there" from "did not
   * get there yet". See HARVESTER_NAV_GIVEUP_SECONDS, and note that the
   * exclusion which measured worse in an earlier attempt is back and now pays,
   * because it is keyed on that signal instead of on progress.
   *
   * Throughput is still short of what it should be: a harvester that never
   * stops completes a round trip every 30-60 s, so twelve of them over four
   * minutes should deliver on the order of 50 loads and they deliver 33.
   *
   * Note the middle row. The first four fixes are each individually correct and
   * individually evidenced, and together they moved throughput by nothing at
   * all — every one of them unblocked a harvester that then stalled on the next
   * cause along. That is why this file asserts TOTALS and not "did fix N work".
   *
   * What is asserted is the floor that has actually been measured, so the next
   * change cannot quietly make it worse while looking plausible. FROZEN is the
   * assertion that matters and it is a real zero: before the `drive()` fix,
   * harvesters sat at a single coordinate for 1200+ consecutive ticks with a
   * full hopper. Nothing may do that again.
   */
  const MIN_TOTAL_DELIVERIES = 32;
  const MIN_METRES_EACH = 20;
  /**
   * ============ THE BAR THIS CODE FINALLY CLEARS =========================
   * `MIN_METRES_EACH` is a floor against the HARD stall and nothing else: 20 m
   * in four minutes is 0.08 m/s. Every failure this file has ever been reopened
   * for cleared that bar comfortably while still being obviously broken on
   * screen — 43 m in 240 s against a 5 m/s hull is under 1% of capable, and it
   * reads as a vehicle that spends its life stuck.
   *
   * So the SOFT stall is counted too, at 150 m: below a healthy round trip
   * (the good hulls manage 440-530 m) and far above the hard floor.
   *
   * This was 6, and it was described here as "the headline outstanding defect
   * in this system". It is 1, and the measurement is 0 — no harvester on any of
   * the three seeds now covers less than 200 m. The one hull of margin is
   * because 150 m is a hard threshold on a continuous quantity: a hull at 149 m
   * and a hull at 151 m are the same hull, and CI should not turn on which side
   * of the line one of them lands.
   *
   * The cause was NOT the one recorded here: it was not that a hull re-picks an
   * unreachable cell, it was that the re-pick itself disarmed nav's unwedge
   * ladder. Both halves are fixed; see the header above.
   * ======================================================================= */
  const MIN_METRES_HEALTHY = 150;
  const MAX_CRAWLING = 1;
  /** Harvesters allowed to stop delivering in the last third, across all seeds. */
  const MAX_STALLED = 5;

  it('never freezes a harvester, and delivers no less than the measured floor', () => {
    const out: string[] = [];
    let deliveries = 0;
    let stalled = 0;
    const frozen: string[] = [];
    const crawling: string[] = [];

    for (const seed of [4242, 1337, 90210]) {
      const r = soak(seed, 240);
      out.push(summarise(`seed ${seed}`, r));
      stalled += r.stalled.length;
      for (const h of r.harvesters) {
        deliveries += h.delivered;
        const where = `seed ${seed} slot ${h.slot}: ${h.distance.toFixed(1)} m in 240 s, `
          + `final ${h.finalState} @ ${h.finalX.toFixed(0)},${h.finalZ.toFixed(0)}`;
        // Four minutes at 5 m/s is 1200 m of travel available. A hull that has
        // covered less than 20 m of it has not been "slow", it has been stopped.
        if (h.distance < MIN_METRES_EACH) frozen.push(where);
        else if (h.distance < MIN_METRES_HEALTHY) crawling.push(where);
      }
    }

    process.stdout.write(`${out.join('\n')}\n`);
    expect(frozen, 'a harvester never moved — this is the hard-stall defect').toEqual([]);
    process.stdout.write(
      `\n  CRAWLING (<${MIN_METRES_HEALTHY} m in 240 s): ${crawling.length}/12\n`
      + crawling.map((c) => `    ${c}`).join('\n') + '\n');
    expect(
      crawling.length,
      'more harvesters are crawling than the measured ceiling. These moved, so '
      + 'the hard-stall floor passes, but they covered a fraction of what their '
      + `hull can do:\n${crawling.join('\n')}`,
    ).toBeLessThanOrEqual(MAX_CRAWLING);
    expect(
      deliveries,
      `total deliveries fell below the measured floor. ${out.join('\n')}`,
    ).toBeGreaterThanOrEqual(MIN_TOTAL_DELIVERIES);
    expect(
      stalled,
      `more harvesters stopped delivering than the measured ceiling. ${out.join('\n')}`,
    ).toBeLessThanOrEqual(MAX_STALLED);
  }, 300_000);
});
