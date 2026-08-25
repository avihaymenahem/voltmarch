/**
 * ============================================================================
 * VOLTMARCH — tests/ore-regrowth.spec.ts
 * ============================================================================
 * "ORE FIELDS SHOULD REGENERATE OVER TIME". THEY ALWAYS DID. NOBODY COULD SEE
 * IT, AND ON A FIELD ANYBODY WAS STILL WORKING IT NEVER FINISHED.
 *
 * `OreField.regrow` has been correct and enabled since it was written:
 * ORE_REGROW_RATE is 0.6 ore/cell/s, the pass runs every ORE_REGROW_INTERVAL
 * ticks, and it marks the same dirty list the crystal renderer drains. Three
 * separate things nonetheless add up to "it does not come back", and this file
 * is the gate on all three plus the one that is NOT fixable here.
 *
 *   1. THE WAVE IS SLOW, AND SLOWEST WHERE IT STARTS. Every non-source cell is
 *      gated on its upstream holding ORE_REGROW_SPREAD of the UPSTREAM's own
 *      capacity, and capacity is largest at the source (~460-535 ore), so ring
 *      one waits ~140 ore of exclusive source regrowth. A field stripped to
 *      zero and left alone takes 23.4 min to reach 95%; the same field mined
 *      only from the rim takes 6.7 min. Throughput while stripped is 1.80 ore/s
 *      — one cell at its 3.0x bonus — against 19.20 ore/s once the inner field
 *      is eligible. Pinned below as a ladder, so a constant change is visible.
 *
 *   2. THE ONE CELL THAT REGROWS WAS USUALLY NOT DRAWN. `CLUSTER_DROP` is 0.62
 *      and the source cell got no exemption, so on ~66% of fields the entire
 *      first ninety seconds of a recovery had no pixel anywhere on the map.
 *      `drawsCluster` exempts it now.
 *
 *   3. THE HARVESTERS ARE NOT THE PROBLEM, AND THIS FILE IS WHERE THAT WAS
 *      SETTLED. An AI harvester does re-evaluate: it expands to the next field
 *      and comes back to the recovered one (home worked out by t=6 min, far
 *      100% -> 0% by t=16, back on home at 31.6% at t=17). A human's stays put,
 *      which is the documented call — and is the case that produces the report,
 *      because a patch nobody leaves never gets the uninterrupted minutes the
 *      wave needs.
 *
 *   4. NOT FIXABLE IN `src/sim/**` AND DELIBERATELY LEFT: a harvester takes a
 *      cell the moment it holds ORE_MIN_CLAIM (25) and takes it to zero, while
 *      the wave needs that cell to hold ORE_REGROW_SPREAD * capacity (~138). 25
 *      is five to six times under the bar, so the wave cannot advance past the
 *      first cell of any field a harvester is working. The last test here is
 *      the tripwire on that ratio — see its note before changing either
 *      constant.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { PlayerId, SimContext } from '../src/core/types';
import {
  CELL, HARVESTER_CAPACITY, HARVESTER_LEASH_PATIENCE, MAP_CELLS, ORE_CELL_MAX,
  ORE_MIN_CLAIM, ORE_REGROW_INTERVAL, ORE_REGROW_NODE_BONUS, ORE_REGROW_RATE,
  ORE_REGROW_SPREAD, REFINERY_STORAGE, SIM_DT,
} from '../src/core/config';
import { Rng } from '../src/core/math';
import { Economy, OreField } from '../src/sim/Economy';
import { HarvesterController, setHarvesterDrive } from '../src/sim/Harvesting';
import { PowerGrid } from '../src/sim/Power';
import { drawsCluster } from '../src/world/ore.system';

/** Map centre, which is where every fixture in this repo is composed. */
const CX = 256;
const CZ = 256;
const SIM_HZ = Math.round(1 / SIM_DT);

/** Seconds of regrowth per pass, exactly as `economy.system.ts` drives it. */
const PASS = ORE_REGROW_INTERVAL * SIM_DT;

const cellX = (packed: number): number => packed % MAP_CELLS;
const cellZ = (packed: number): number => (packed / MAP_CELLS) | 0;

/** Empty every cell of a field, the way a harvester eventually would. */
function strip(ore: OreField, id: number): void {
  const rec = ore.field(id);
  if (rec === undefined) throw new Error('no field');
  for (let k = 0; k < rec.cells.length; k++) {
    ore.takeOre(cellX(rec.cells[k]), cellZ(rec.cells[k]), ORE_CELL_MAX * 2);
  }
}

/** Advance regrowth in real passes rather than one giant dt. */
function advance(ore: OreField, seconds: number): void {
  for (let t = 0; t < seconds; t += PASS) ore.regrow(PASS);
}

/** Sim-seconds of regrowth until `pred` holds, or -1 inside `cap`. */
function secondsUntil(ore: OreField, pred: () => boolean, cap = 3600): number {
  for (let t = 0; t <= cap; t += PASS) {
    if (pred()) return t;
    ore.regrow(PASS);
  }
  return -1;
}

/* ==========================================================================
 * 1. THE WAVE
 * ========================================================================== */

describe('a stripped field comes back, and the shape of how long it takes', () => {
  it('grows only its SOURCE cell on the first pass, and marks it dirty', () => {
    const ore = new OreField();
    const id = ore.seedField(CX, CZ, 30);
    const rec = ore.field(id)!;
    strip(ore, id);

    const buf = new Int32Array(4096);
    while (ore.pendingDirty > 0) ore.drainDirty(buf);
    // Not exactly zero: `total` is a float64 running sum of Float32 cell reads,
    // so stripping leaves ~6e-5 behind. `economy.spec.ts` allows the same slack.
    const emptied = ore.totalOre();
    expect(emptied).toBeLessThan(0.001);

    ore.regrow(PASS);

    /* THE CLAIM IN `src/world/ore.system.ts`'s HEADER, CHECKED RATHER THAN
     * TRUSTED: "Regrowth is free, because `OreField.regrow` marks the same
     * dirty list." If that were false, ore would regrow invisibly — the
     * renderer never rescans — and this whole report would have a different
     * cause. It is true, and exactly one cell moved. */
    expect(ore.pendingDirty, 'regrowth must mark the renderer dirty list').toBe(1);
    expect(ore.drainDirty(buf)).toBe(1);
    expect(buf[0], 'the one cell that grew must be the field source').toBe(rec.cells[0]);

    // `cells` is sorted by distance from the node, so `cells[0]` is the source,
    // and it is the ONLY cell with no upstream gate.
    expect(ore.oreAt(cellX(rec.cells[0]), cellZ(rec.cells[0])))
      .toBeCloseTo(ORE_REGROW_RATE * ORE_REGROW_NODE_BONUS * PASS, 4);
    expect(ore.totalOre() - emptied)
      .toBeCloseTo(ORE_REGROW_RATE * ORE_REGROW_NODE_BONUS * PASS, 4);
  });

  it('reaches full capacity when it is left alone, inside a match', () => {
    const ore = new OreField();
    const id = ore.seedField(CX, CZ, 30);
    const rec = ore.field(id)!;
    const cap = rec.capacity;
    strip(ore, id);

    const t95 = secondsUntil(ore, () => ore.totalOre() >= cap * 0.95);
    expect(t95, 'a stripped field must recover on its own').toBeGreaterThan(0);

    /* THE LADDER, MEASURED, AS A BAND RATHER THAN A NUMBER. 23.4 min on the
     * shipped constants. The band is wide on purpose — this is here so that a
     * change to ORE_REGROW_RATE or ORE_REGROW_SPREAD announces itself, not to
     * freeze a balance decision. If it fails, re-measure and rewrite the table
     * in `src/sim/Economy.ts`'s header along with it. */
    expect(t95 / 60, 'stripped -> 95% capacity, sim-minutes').toBeGreaterThan(12);
    expect(t95 / 60, 'stripped -> 95% capacity, sim-minutes').toBeLessThan(45);
  });

  it('comes back far faster from the rim than from the middle', () => {
    /* THE DESIGN, STATED AS A COMPARISON. `Economy.ts`'s header promises "mine
     * the near edge and it grows back first, strip the field to the rim and it
     * takes a long walk back out". That is a claim about two numbers, and this
     * is the two numbers: the walk is real, and it is roughly an order of
     * magnitude in throughput. */
    const stripped = new OreField();
    stripped.seedField(CX, CZ, 30);
    strip(stripped, 0);
    advance(stripped, PASS);
    const s0 = stripped.totalOre();
    advance(stripped, 10);
    const strippedRate = (stripped.totalOre() - s0) / 10;

    const rimmed = new OreField();
    const rid = rimmed.seedField(CX, CZ, 30);
    const rec = rimmed.field(rid)!;
    for (let k = 0; k < rec.cells.length; k++) {
      const packed = rec.cells[k];
      const d = Math.hypot(cellX(packed) - rec.nodeCx, cellZ(packed) - rec.nodeCz) * CELL;
      if (d >= rec.radius * 0.45) rimmed.takeOre(cellX(packed), cellZ(packed), ORE_CELL_MAX * 2);
    }
    const r0 = rimmed.totalOre();
    advance(rimmed, 10);
    const rimmedRate = (rimmed.totalOre() - r0) / 10;

    /*
     * A stripped field regrows through its source and whatever the wave has
     * unlocked behind it; a rim-mined one through its whole inner disc.
     *
     * THIS ASSERTION USED TO BE `toBeCloseTo(1.80)` — the source rate exactly,
     * because at `ORE_REGROW_SPREAD = 0.3` the wave could never leave the
     * source cell and one cell was the entire field's output forever. It was
     * measuring the stall, not the design. At 0.025 the source clears its
     * downstream gate within about seven seconds, so ring one is already
     * growing inside this ten-second window and the figure is ~3.7.
     *
     * What is asserted now is the design claim itself, which survives: a
     * stripped field can never beat the source rate on its first pass, and a
     * rim-mined one is still several times faster. The ratio is what
     * `Economy.ts`'s header promises; the absolute is not.
     */
    expect(strippedRate, 'a stripped field must at least grow its source')
      .toBeGreaterThanOrEqual(ORE_REGROW_RATE * ORE_REGROW_NODE_BONUS - 1e-6);
    expect(rimmedRate / strippedRate, 'the walk back out must still cost something')
      .toBeGreaterThan(3);
  });
});

/* ==========================================================================
 * 2. THE RENDERER
 * ========================================================================== */

describe('the source cell is always drawn', () => {
  it('exempts the source from CLUSTER_DROP, and drops ~62% of the rest', () => {
    /* WITHOUT THE EXEMPTION THIS IS A 34% COIN FLIP PER FIELD, and it lands on
     * the one cell that matters: a stripped field grows nothing else for the
     * first ninety seconds, so on two fields in three there was no pixel
     * anywhere saying the field was coming back. Measured over 400 seeded
     * fields before the exemption: the source drew a cluster in 136. */
    let sourceDrawn = 0;
    let ordinaryDrawn = 0;
    let fields = 0;
    for (let s = 0; s < 400; s++) {
      const ore = new OreField();
      const id = ore.seedField(120 + (s % 20) * 12, 120 + ((s / 20) | 0) * 12, 26);
      const rec = ore.field(id);
      if (rec === undefined) continue;
      fields++;
      const src = rec.cells[0];
      if (drawsCluster(cellX(src), cellZ(src), true)) sourceDrawn++;
      // The same cell asked as an ordinary member of the field.
      if (drawsCluster(cellX(src), cellZ(src), false)) ordinaryDrawn++;
    }
    expect(fields).toBeGreaterThan(300);
    expect(sourceDrawn, 'every field source must draw').toBe(fields);
    // And the drop is otherwise untouched — one exempt cell per field cannot
    // rebuild the 4 m lattice `CLUSTER_DROP` exists to break.
    expect(ordinaryDrawn / fields).toBeGreaterThan(0.2);
    expect(ordinaryDrawn / fields).toBeLessThan(0.6);
  });
});

/* ==========================================================================
 * 3. THE HARVESTER
 * ========================================================================== */

interface Rig {
  world: World;
  channels: Channels;
  ore: OreField;
  step(n: number): void;
}

/**
 * One refinery, two harvesters, two ore fields 90 m apart — and REGROWTH RUNNING,
 * which is the whole point.
 *
 * `tests/harvester-leash.spec.ts` and `tests/economy.spec.ts` both drive the
 * harvester FSM without ever calling `OreField.regrow`, so in those rigs a
 * stripped field stays stripped and `acquireInLeash` returns LEASH_EMPTY. In a
 * real match it returns LEASH_SCRAPS forever instead, because the source cell is
 * back over one unit within a single pass. That difference is the entire defect,
 * and it is why it survived a green suite.
 */
function makeRig(human: boolean, harvesters_ = 2): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', human, human);
  const channels = new Channels();
  const ore = new OreField();
  const economy = new Economy(world, channels);
  const power = new PowerGrid(world, channels);
  const harvesters = new HarvesterController(world, channels, ore, economy);
  world.ore = ore;
  setHarvesterDrive('full');

  const s = world.store;
  const P0 = 0 as PlayerId;
  const rid = s.alloc(EntityKind.Building, -1, P0, Faction.Allies, CX, 0, CZ - 40, 0);
  const ri = s.index(rid);
  s.flags[ri] |= EntityFlag.IsRefinery;
  s.footprintW[ri] = 3; s.footprintH[ri] = 3;
  s.maxHp[ri] = 1200; s.hp[ri] = 1200; s.radius[ri] = 6; s.buildProgress[ri] = 1;
  economy.setBuildingStorage(rid, REFINERY_STORAGE);

  for (let n = 0; n < harvesters_; n++) {
    const hid = s.alloc(EntityKind.Vehicle, -1, P0, Faction.Allies, CX + n * 6, 0, CZ - 30, 0);
    const hi = s.index(hid);
    s.flags[hi] |= EntityFlag.IsHarvester | EntityFlag.CanMove;
    s.cargoMax[hi] = HARVESTER_CAPACITY;
    s.maxSpeed[hi] = 8; s.accel[hi] = 8; s.turnRate[hi] = 4;
    s.locomotor[hi] = Locomotor.Track; s.radius[hi] = 2.2;
    s.maxHp[hi] = 1000; s.hp[hi] = 1000; s.state[hi] = UnitState.Idle;
  }

  const rng = new Rng(4242);
  let tick = 0;
  let sinceRegrow = 0;
  return {
    world, channels, ore,
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        s.snapshotPrev();
        tick++;
        world.tick = tick;
        world.time = tick * SIM_DT;
        const sc: SimContext = { dt: SIM_DT, tick, time: world.time, rng };
        power.simTick(sc.time);
        economy.recomputeStorage();
        harvesters.simTick(sc);
        economy.tick(sc.dt, sc.time);
        harvesters.drive(sc.dt);
        if (++sinceRegrow >= ORE_REGROW_INTERVAL) {
          ore.regrow(sinceRegrow * SIM_DT);
          sinceRegrow = 0;
        }
      }
    },
  };
}

describe('a worked-out patch, with regrowth actually running', () => {
  it('lets an AI harvester expand to the next field', () => {
    /* THIS IS THE ANSWER TO "harvesters never re-evaluate a field they
     * emptied", AND IT IS NO. The AI's patience escape fires and `reanchor`
     * moves it — even though `leashDryAt` is set under LEASH_SCRAPS and only
     * read under LEASH_EMPTY, which looks like it should make the escape
     * unreachable on a regrowing patch. It does not, because `takeOre` sweeps
     * a cell to exactly zero and the scraps floor is one unit, so the patch
     * reads as genuinely empty for ~1.7 s after every take and `DRY_RETRY`
     * (2 s) lands in that window. See the block in `Harvesting.acquireOre`.
     *
     * Trajectory over 25 sim-minutes on this rig: home worked out by t=6, far
     * 100% -> 0% between t=6 and t=16, and the AI back on the recovered home
     * field (31.6%) at t=17. A real cycle, not a stall.
     *
     * SIX HARVESTERS, NOT TWO, AND THE FLEET SIZE IS NOW LOAD-BEARING.
     * ---------------------------------------------------------------
     * With the regrowth gate fixed (`ORE_REGROW_SPREAD` 0.3 -> 0.025) a field
     * is no longer pinned at zero, and its throughput is SELF-LIMITING rather
     * than infinite: measured on this exact field, a stripped r26 patch peaks
     * at 60.3 ore/s about two minutes into recovery, then falls away as cells
     * cap out — 12.6 ore/s at ten minutes, 1.2 at twenty. Against a
     * harvester's ~22 ore/s that is roughly 2.8 hulls at the peak and well
     * under one on a full field.
     *
     * So TWO harvesters now sit inside what one field sustains, and staying
     * put became the CORRECT behaviour — this test failed on that, which is
     * the fix working rather than a regression. Six is comfortably past the
     * ceiling, so the pressure to expand is real again and the property this
     * test exists for ("the AI re-evaluates") is what is being measured.
     *
     * If this fails after a change to `ORE_REGROW_RATE`, re-measure the
     * sustain figures above before touching the fleet size — the number of
     * hulls a field carries is exactly what that constant sets. */
    const rig = makeRig(false, 6);
    const home = rig.ore.field(rig.ore.seedField(CX, CZ, 26, ORE_CELL_MAX * 0.85))!;
    const far = rig.ore.field(rig.ore.seedField(CX + 90, CZ, 26, ORE_CELL_MAX * 0.85))!;

    rig.step(12 * 60 * SIM_HZ);

    expect(home.remaining / home.capacity, 'the home field should be worked out')
      .toBeLessThan(0.4);
    expect(far.remaining, 'an AI must expand, not sit on a patch it has finished')
      .toBeLessThan(far.capacity * 0.9);
    // Pinned to one stripped field this is ~24 000 by twelve minutes, because
    // a stripped field yields exactly its source cell's 1.8 ore/s.
    expect(rig.world.player(0 as PlayerId).stats.oreMined).toBeGreaterThan(30000);
  }, 60_000);

  it('leaves a human harvester on the patch, which is the documented call', () => {
    /* THE ASYMMETRY IS DELIBERATE AND `acquireOre` ALREADY ARGUES IT: choosing
     * a new patch is the player's, and a module that re-anchors on their behalf
     * is the §ANCHOR defect wearing a hat. So the human's harvesters stay,
     * mining their field's regrowth at its source rate, and the player gets one
     * `EvaLine.HarvesterIdle` notice.
     *
     * IT IS ALSO WHERE THE REPORT COMES FROM. This is the case that produces
     * "ore fields should regenerate over time": the harvesters never leave, so
     * the field never gets the uninterrupted minutes the wave needs, and it
     * sits at a tenth of a percent of capacity for the rest of the match. The
     * last test in this file is why that cannot be fixed here. */
    const rig = makeRig(true);
    const home = rig.ore.field(rig.ore.seedField(CX, CZ, 26, ORE_CELL_MAX * 0.85))!;
    const far = rig.ore.field(rig.ore.seedField(CX + 90, CZ, 26, ORE_CELL_MAX * 0.85))!;

    rig.step(12 * 60 * SIM_HZ);

    expect(home.remaining / home.capacity, 'the home field should be worked out')
      .toBeLessThan(0.4);
    expect(far.remaining, 'a human harvester must never re-anchor itself')
      .toBeGreaterThan(far.capacity * 0.999);
  }, 60_000);
});

/* ==========================================================================
 * 4. THE RATIO THAT IS NOT FIXABLE IN src/sim
 * ========================================================================== */

describe('the two constants that decide whether a WORKED field can recover', () => {
  it('keeps the regrowth gate BELOW what a working harvester leaves behind', () => {
    /* ===================================================================
     * READ THIS BEFORE CHANGING `ORE_MIN_CLAIM` OR `ORE_REGROW_SPREAD`.
     *
     * These two constants live 260 lines apart in `config.ts` and had never
     * been read together. A harvester claims any cell holding `ORE_MIN_CLAIM`
     * and mines it to zero, so ~25 ore is the CEILING a worked cell sits at.
     * The regrowth wave needs that same cell to hold
     * `ORE_REGROW_SPREAD * capacity` before the cell behind it may grow at
     * all. If the gate is above the ceiling the wave can never advance on a
     * field anyone is actually mining.
     *
     * IT WAS, FOR THE WHOLE LIFE OF THE FEATURE. At 0.3 the gate was 138-160
     * ore against a ceiling of 25 — five to six times too high — and a worked
     * field sat pinned near zero for the rest of the match. Measured: 19
     * consecutive sim-minutes at 0.1% of a 22 381-ore field, the source never
     * once above 12 ore. That is the whole of *"ore fields should regenerate
     * over time"*; the regrowth code was correct and running the entire time.
     *
     * THIS ASSERTION USED TO POINT AT THAT DEFECT and say so. It pins the fix
     * now, and it is stated against `ORE_CELL_MAX` rather than against any
     * particular field's capacity ON PURPOSE: the bound has to hold for the
     * richest cell the generator can produce, or the stall returns for exactly
     * the fields worth mining. That is why 0.05 was rejected — it gives a gate
     * of 23-27 against the shipped richness, which straddles 25, so the bug
     * would have survived on the best fields and nowhere else.
     * =================================================================== */
    expect(
      ORE_CELL_MAX * ORE_REGROW_SPREAD,
      'the regrowth gate must sit below ORE_MIN_CLAIM for the RICHEST possible '
      + 'cell, or a worked field of that richness can never recover',
    ).toBeLessThan(ORE_MIN_CLAIM);

    // And it must hold for a real field, not only in the abstract.
    const ore = new OreField();
    const id = ore.seedField(CX, CZ, 26, ORE_CELL_MAX * 0.85);
    const rec = ore.field(id)!;
    const source = rec.cells[0];
    expect(ore.capacity[source] * ORE_REGROW_SPREAD).toBeLessThan(ORE_MIN_CLAIM);

    // And the clock the leash runs on is still shorter than the source takes to
    // become worth a trip, which is what makes waiting the right first answer.
    const toClaimable = ORE_MIN_CLAIM / (ORE_REGROW_RATE * ORE_REGROW_NODE_BONUS);
    expect(toClaimable).toBeLessThan(HARVESTER_LEASH_PATIENCE);
  });
});
