/**
 * ============================================================================
 * tests/unit-gait.spec.ts
 * ============================================================================
 * "Troops walking animation doesnt exist at all."
 *
 * They did not, and five files already described the module that would have
 * made them: `RenderPhase.UnitAnim = 40` in the enum, an `animClip`/`animTime`
 * row in core/loop.ts's write-ownership table naming "unit-art" as the owner,
 * both columns allocated in core/world.ts, `animTime` persisted at SaveGame
 * column 92, and a note in render-bridge.system.ts's header explaining that
 * anim modules write `animTime` for the next frame. Nothing wrote either
 * column and nothing registered at phase 40.
 *
 * WHAT THESE CASES PROTECT
 * ------------------------
 *   - THE PHASE ADVANCES WITH DISTANCE, NOT WITH TIME. A unit slowed by terrain
 *     or crowding must take shorter steps, not moonwalk. This is the property
 *     that makes the animation look attached to the ground.
 *   - A STOPPED UNIT REACHES *EXACTLY* NEUTRAL. Not approximately: the shader
 *     takes `sin(2*pi*phase)`, so an exact 0 or 0.5 is the only thing that
 *     makes a parked army perfectly still, and a unit frozen mid-stride with
 *     one leg out in front is the most obviously-broken thing a walk cycle can
 *     do.
 *   - THE GAIT IS BAKED ONLY WHERE IT BELONGS. Legs and arms swing in
 *     opposition, the two sides oppose each other, and the torso, helmet and
 *     backpack do not move at all.
 *   - VEHICLES PAY NOTHING. No `aGait` attribute is emitted for a model with no
 *     moving limb, so the 200-units budget is untouched by a feature none of
 *     them use.
 *   - THE PHASE IS DETERMINISTIC AND BOUNDED. It feeds an instance attribute;
 *     a NaN here is the exact route by which this repo once got a fully black
 *     frame out of one bad index.
 *
 * WHAT THIS FILE MISSED FOR ELEVEN VERSIONS, AND WHY
 * --------------------------------------------------
 * v1.17.0 shipped the walk and it reached HALF THE GAME. `grep -c gait` scored
 * `src/art/UnitDefs.ts` 10, `src/art/Faction3Units.ts` 0 and
 * `src/art/Faction4Units.ts` 0: the Meridian Pact and the Reclamation had
 * infantry that slid along the ground with their legs welded shut.
 *
 * This file could not see it. It imported `UNIT_MASS_LISTS` — the Allied and
 * Soviet roster and nothing else — and named five Allied and Soviet keys by
 * hand. Two whole armies were outside the set it measured, and a roster-shaped
 * hole in a roster-shaped test is invisible from inside it.
 *
 * So the sweep below is DRIVEN BY THE ROSTERS, not by a key list: it takes every
 * mass list in all four armies, filters to `cls === 'infantry'`, and holds every
 * one of them to the same rule. A fifth army joins the invariant by existing,
 * which is the same property `src/game/Systems.ts` gives a new system module.
 * ============================================================================
 */

import { PerformanceObserver, constants, performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { UNIT_GAIT } from '../src/core/config';
import { EntityKind, Faction, RenderPhase, type PlayerId, type RenderContext } from '../src/core/types';
import { MassRole, type MassDef, type UnitMassList } from '../src/art/MassList';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';

/** Every army, by the roster it ships in. Adding a fifth adds it here only. */
const ROSTERS: readonly (readonly [string, readonly UnitMassList[]])[] = [
  ['allied/soviet', UNIT_MASS_LISTS],
  ['meridian', MERIDIAN_UNIT_MASS_LISTS],
  ['reclaim', RECLAIM_UNIT_MASS_LISTS],
];

const ALL_LISTS: readonly UnitMassList[] = ROSTERS.flatMap(([, l]) => l);

/**
 * THE ROSTER WHOSE INFANTRY STILL DO NOT WALK, NAMED RATHER THAN OMITTED.
 *
 * `src/art/Faction4Units.ts` was being edited by a parallel agent in the same
 * round the Meridian gait landed, so it was outside this change's file
 * ownership and its four soldiers still slide. That is a REAL DEFECT and it is
 * recorded here as one, because the alternative — quietly sweeping only the
 * rosters that happen to pass — is precisely how the hole this file is fixing
 * stayed open for eleven versions.
 *
 * The entry is not a licence. `the exclusion list is not a hiding place` below
 * asserts that every roster named here genuinely has NO gait at all, so the
 * moment the Reclamation gets its walk cycle this file goes red and says to
 * delete the line — and it asserts that nothing else is missing one, so a fifth
 * army cannot join the game with welded legs.
 */
const NO_GAIT_YET: ReadonlySet<string> = new Set(['reclaim']);

const WALKING_ROSTERS = ROSTERS.filter(([name]) => !NO_GAIT_YET.has(name));
const ALL_INFANTRY: readonly UnitMassList[] =
  WALKING_ROSTERS.flatMap(([, l]) => l).filter((l) => l.cls === 'infantry');

/** A mass that swings, and the pivot it swings about. */
function swinging(l: UnitMassList, limb: 'leg' | 'arm'): MassDef[] {
  return l.masses.filter((m) => m.gait?.limb === limb);
}

/* ========================================================================== */

describe('the constants are a walk and not a twitch', () => {
  it('swings far enough to read and not so far the feet leave the ground', () => {
    const deg = (UNIT_GAIT.swingRadians * 180) / Math.PI;
    expect(deg).toBeGreaterThan(15);
    expect(deg).toBeLessThanOrEqual(25);
  });

  it('takes a human stride, so the feet do not skate', () => {
    // A full cycle is TWO steps, so the step length is half of this. Under a
    // metre per step is a shuffle; over 1.5 is a lunge.
    expect(UNIT_GAIT.strideMetres / 2).toBeGreaterThan(0.8);
    expect(UNIT_GAIT.strideMetres / 2).toBeLessThan(1.5);
  });

  it('keeps the idle threshold clear of steering jitter', () => {
    // Well above zero on purpose: a "stopped" unit keeps a few cm/s of residual
    // velocity forever, and a soldier twitching his legs in place is worse than
    // one standing still.
    expect(UNIT_GAIT.idleSpeed).toBeGreaterThan(0.1);
    // ...but well under any real walking speed, or a unit crawling uphill
    // freezes instead of trudging.
    expect(UNIT_GAIT.idleSpeed).toBeLessThan(1.0);
  });

  it('settles to a stand in well under a second', () => {
    // Worst case is half a cycle away from neutral.
    expect(0.5 / UNIT_GAIT.settleRate).toBeLessThan(0.4);
  });
});

/* ========================================================================== */

/*
 * The two pure functions the system is built from, restated here rather than
 * exported: the module's `frame()` needs `ctx()` and a live world, and the only
 * things worth pinning are the arithmetic. They are transcribed from
 * `src/render/unit-anim.system.ts` and `tests/spec-drift` style drift is
 * guarded by the registration case at the bottom of this file.
 */
function cyclesPerSecond(speed: number): number {
  return speed / UNIT_GAIT.strideMetres;
}

function settle(phase: number, step: number): number {
  const target = phase < 0.25 ? 0 : phase < 0.75 ? 0.5 : 1;
  const delta = target - phase;
  if (Math.abs(delta) <= step) return target >= 1 ? 0 : target;
  return phase + Math.sign(delta) * step;
}

describe('the phase is driven by ground covered', () => {
  it('scales linearly with speed', () => {
    expect(cyclesPerSecond(0)).toBe(0);
    expect(cyclesPerSecond(6.4)).toBeCloseTo(2 * cyclesPerSecond(3.2), 10);
  });

  it('advances exactly one cycle per stride length walked', () => {
    // The whole point of dividing by a distance instead of using a fixed Hz.
    const speed = 3.2;
    const seconds = UNIT_GAIT.strideMetres / speed;
    expect(cyclesPerSecond(speed) * seconds).toBeCloseTo(1, 10);
  });

  it('gives a rifleman a plausible cadence rather than a sprint', () => {
    const hz = cyclesPerSecond(3.2);   // `gi` maxSpeed
    expect(hz).toBeGreaterThan(1.0);
    expect(hz).toBeLessThan(2.2);
  });
});

/* ========================================================================== */

describe('a stopped unit reaches exactly neutral', () => {
  it('lands on 0 or 0.5 precisely, from anywhere', () => {
    const step = UNIT_GAIT.settleRate * (1 / 60);
    for (let start = 0; start < 1; start += 0.017) {
      let p = start;
      // A second of settling is far more than `0.5 / settleRate`.
      for (let k = 0; k < 60; k++) p = settle(p, step);
      expect(p === 0 || p === 0.5, `from ${start.toFixed(3)} settled to ${p}`).toBe(true);
      // And that is a neutral stance in the shader's terms, which is the thing
      // that actually matters.
      expect(Math.abs(Math.sin(p * 2 * Math.PI))).toBeLessThan(1e-12);
    }
  });

  it('takes the SHORTER way round rather than unwinding the long way', () => {
    const step = 0.01;
    expect(settle(0.10, step)).toBeCloseTo(0.09, 10);   // down to 0
    expect(settle(0.40, step)).toBeCloseTo(0.41, 10);   // up to 0.5
    expect(settle(0.60, step)).toBeCloseTo(0.59, 10);   // down to 0.5
    expect(settle(0.90, step)).toBeCloseTo(0.91, 10);   // up to 1, i.e. 0
  });

  it('never leaves the phase outside [0, 1)', () => {
    for (let start = 0; start < 1; start += 0.013) {
      for (const step of [0.001, 0.04, 0.4, 2.0]) {
        const p = settle(start, step);
        expect(p, `start ${start} step ${step}`).toBeGreaterThanOrEqual(0);
        expect(p, `start ${start} step ${step}`).toBeLessThan(1);
        expect(Number.isFinite(p)).toBe(true);
      }
    }
  });

  it('is already done when it is already neutral', () => {
    expect(settle(0, 0.04)).toBe(0);
    expect(settle(0.5, 0.04)).toBe(0.5);
  });
});

/* ========================================================================== */

describe('the gait is baked onto the right masses and no others', () => {
  it('measures every army that has the feature, by roster and not by key', () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. Ten infantry
    // across three armies — six Allied and Soviet, four Meridian — and each
    // roster must contribute some. This file used to name five Allied and
    // Soviet keys by hand, and two whole rosters sat outside everything it
    // measured.
    expect(ALL_INFANTRY.length).toBeGreaterThanOrEqual(10);
    for (const [roster, lists] of WALKING_ROSTERS) {
      expect(lists.some((l) => l.cls === 'infantry'), `${roster} fields infantry`).toBe(true);
    }
    // The Meridian Pact specifically, by name, because it is the roster this
    // round added and a regression there would otherwise only shrink a count.
    for (const key of ['meridian_wayfarer', 'meridian_lancer', 'meridian_artificer',
      'meridian_hierarch']) {
      expect(ALL_INFANTRY.some((l) => l.key === key), key).toBe(true);
    }
  });

  it('the exclusion list is not a hiding place', () => {
    // Two directions, and both matter.
    //
    // 1. Every roster named in `NO_GAIT_YET` must genuinely have NO gait
    //    anywhere. A stale entry — one left behind after the roster was fixed —
    //    would silently exempt a working army from every case in this file.
    for (const [roster, lists] of ROSTERS) {
      if (!NO_GAIT_YET.has(roster)) continue;
      const declared = lists.flatMap((l) => l.masses.filter((m) => m.gait !== undefined));
      expect(
        declared.length,
        `${roster} has a walk cycle now — delete it from NO_GAIT_YET and let the sweep cover it`,
      ).toBe(0);
    }
    // 2. Every roster NOT named there must have one on every soldier. A fifth
    //    army cannot arrive with welded legs and pass by not being listed.
    for (const [roster, lists] of WALKING_ROSTERS) {
      for (const l of lists) {
        if (l.cls !== 'infantry') continue;
        expect(l.masses.some((m) => m.gait !== undefined), `${roster}/${l.key}`).toBe(true);
      }
    }
  });

  for (const l of ALL_INFANTRY) {
    it(`${l.key} walks`, () => {
      // Legs and arms, both mirrored. `mirrorX` is what gives each limb its two
      // opposed copies from ONE declaration, and it is the whole reason the
      // gait is expressed per MASS rather than per emitted vertex range.
      const legs = swinging(l, 'leg');
      const arms = swinging(l, 'arm');
      expect(legs.some((m) => m.name === 'leg'), 'the leg mass swings').toBe(true);
      expect(arms.some((m) => m.name === 'arm'), 'the arm mass swings').toBe(true);
      for (const m of [...legs, ...arms]) {
        expect(m.mirrorX, `${m.name} must be mirrored or only one limb moves`).toBe(true);
      }
    });

    it(`${l.key} pivots each limb at its own joint`, () => {
      // A leg rotating about y=0 sweeps the whole limb through the terrain; an
      // arm rotating about the hip detaches from the shoulder. Both look wrong
      // in ways that are obvious in motion and invisible in a still.
      const hip = l.masses.find((m) => m.name === 'leg')!.gait!.pivotY;
      const shoulder = l.masses.find((m) => m.name === 'arm')!.gait!.pivotY;
      expect(hip).toBeGreaterThan(0.5);
      expect(shoulder).toBeGreaterThan(hip);
      // ...and below the crown, or the arm swings from the soldier's hat.
      expect(shoulder).toBeLessThan(2.2);
    });

    it(`${l.key} keeps one limb rigid — every part of it shares a pivot`, () => {
      // Boots, knee pads and thigh bands ride the leg; a part on a different
      // pivot shears itself off the limb as it swings, and the boot is the far
      // end of the lever so it is the one that shows.
      for (const limb of ['leg', 'arm'] as const) {
        const parts = swinging(l, limb);
        const pivots = new Set(parts.map((m) => m.gait!.pivotY.toFixed(9)));
        expect(pivots.size, `${limb} parts [${parts.map((m) => m.name).join(', ')}] disagree on the pivot`)
          .toBe(1);
      }
      // Not just the primary: the foot must come along. Every roster hangs a
      // boot off the leg, and a walk with the boots left standing on the ground
      // is worse than no walk at all.
      const rides = new Set(swinging(l, 'leg').map((m) => m.name));
      expect(rides.has('boot'), 'the boot rides the leg').toBe(true);
      expect(rides.has('thighBand'), 'the thigh band is painted on the thigh').toBe(true);
    });

    it(`${l.key} leaves the torso, the helmet and the pack welded to the body`, () => {
      const TORSO = new Set(['torso', 'coat', 'helmet', 'crest', 'helmetAerial', 'finial',
        'belt', 'gorget', 'collar', 'webbing', 'chestPlate', 'helmBand', 'helmetBand',
        'visor', 'packLamp', 'insignia', 'vestment', 'mantle', 'mantleHigh',
        'shoulderPad', 'pauldron', 'cape']);
      for (const m of l.masses) {
        if (!TORSO.has(m.name)) continue;
        expect(m.gait, `${l.key}/${m.name} must not swing`).toBeUndefined();
      }
      // And a backpack is never a limb, whichever of the six shapes it is.
      for (const m of l.masses) {
        if (m.group !== 'pack') continue;
        expect(m.gait, `${l.key}/${m.name} is a backpack`).toBeUndefined();
      }
    });
  }

  it('does not put a gait on anything that drives, in any army', () => {
    for (const u of ALL_LISTS) {
      if (u.cls === 'infantry') continue;
      for (const m of u.masses) {
        expect(m.gait, `${u.key}/${m.name} is not a leg`).toBeUndefined();
      }
    }
  });

  it('only ever swings a mass a soldier could swing', () => {
    // A `gait` on a primary that is not a limb — a torso, a turret — would
    // rotate the model's own bulk about a joint. The two limbs are the whole
    // articulation and the whole budget.
    for (const l of ALL_INFANTRY) {
      for (const m of l.masses) {
        if (m.gait === undefined) continue;
        expect(['leg', 'arm']).toContain(m.gait.limb);
        expect(Number.isFinite(m.gait.pivotY), `${l.key}/${m.name}`).toBe(true);
        if (m.role === MassRole.Primary) {
          expect(['leg', 'arm'], `${l.key}/${m.name} is a primary mass`).toContain(m.name);
        }
      }
    }
  });
});

/* ========================================================================== */

describe('the declaration reaches the built mesh', () => {
  /**
   * The mass list is data; `aGait` is what the GPU actually reads. The two are
   * connected by `UnitFactory`'s MeshBuilder and by exactly one line —
   * `if (this.gait.some((v) => v !== 0))` — so a model can carry a perfectly
   * good `MassDef.gait` and still ship with no attribute at all.
   */
  it('emits a signed, mirrored aGait on every Meridian soldier', async () => {
    const { MERIDIAN_UNIT_PALETTE, meridianUnitLibrary } = await import('../src/art/Faction3Units');
    for (const l of MERIDIAN_UNIT_MASS_LISTS) {
      const model = meridianUnitLibrary.build(l, MERIDIAN_UNIT_PALETTE, 256, 0x4d52);
      const attr = model.hull.getAttribute('aGait') as { array: ArrayLike<number> } | undefined;

      if (l.cls !== 'infantry') {
        // VEHICLES PAY NOTHING: no attribute, no upload, no per-vertex cost for
        // a feature none of them use.
        expect(attr, `${l.key} must not carry a gait attribute`).toBeUndefined();
        continue;
      }

      expect(attr, `${l.key} declares a gait but ships no aGait attribute`).toBeDefined();
      const a = attr!.array;
      let pos = 0, neg = 0, welded = 0;
      const pivots = new Set<number>();
      for (let i = 0; i < a.length; i += 2) {
        if (a[i] > 0) pos++; else if (a[i] < 0) neg++; else welded++;
        expect(Number.isFinite(a[i]) && Number.isFinite(a[i + 1]), `${l.key} vertex ${i / 2}`).toBe(true);
        if (a[i] !== 0) pivots.add(a[i + 1]);
      }
      // The two sides are exact mirrors, so the signed counts must match to the
      // vertex. An imbalance means one copy of a mirrored limb lost its sign.
      expect(pos, `${l.key} swings ${pos} vertices one way and ${neg} the other`).toBe(neg);
      expect(pos).toBeGreaterThan(0);
      // The overwhelming majority is welded — that is the argument for a
      // multiply instead of a branch in the vertex stage.
      expect(welded).toBeGreaterThan(pos + neg);
      // Exactly two joints: one hip, one shoulder.
      expect(pivots.size, `${l.key} pivots at ${[...pivots].join(', ')}`).toBe(2);
    }
  });
});

/* ==========================================================================
 * THE PER-FRAME COST OF GIVING TWO MORE ARMIES A WALK
 *
 * Zero, and that is a claim worth measuring rather than asserting. The whole
 * design exists so that it can be zero: the swing is a vertex-shader rotation
 * over a baked attribute, so the only per-frame work is `unit-anim.system.ts`
 * advancing one scalar per living infantryman into `EntityStore.animTime`, a
 * pre-allocated Float32Array column. Meridian soldiers were ALREADY in that
 * loop — they are `EntityKind.Infantry` and always have been — and the loop was
 * already writing them a phase. What changed is that there are now vertices for
 * the phase to move.
 *
 * The method is `tests/perf-hud.spec.ts`'s, including its two hard-won fixes:
 * count only `NODE_PERFORMANCE_GC_MINOR` (major and incremental collections are
 * the collector's own background schedule), and keep the 30 ms delivery wait
 * OUTSIDE the measured window. The CONTROL LOOP is not optional — without it a
 * green result could just mean the observer never saw anything.
 *
 * MUTATION-VERIFIED, and the shape of the result is worth writing down.
 * Adding `SINK.push({ i, speed })` to `render.unitAnim`'s walker branch scores
 * 89 scavenges against this test's `toBe(0)`. Adding a LOCAL object that never
 * escapes the loop body scores 0 — V8 scalar-replaces it and no allocation ever
 * happens. That is not a hole: this test measures heap traffic, which is what
 * the frame budget is spent on, not source-level `new`.
 * ========================================================================== */

const GC_MINOR = constants.NODE_PERFORMANCE_GC_MINOR;

function gcEntryKind(entry: PerformanceEntry): number {
  const detail = (entry as unknown as { detail?: unknown }).detail;
  if (typeof detail !== 'object' || detail === null) return -1;
  const kind = (detail as { kind?: unknown }).kind;
  return typeof kind === 'number' ? kind : -1;
}

/** Scavenges that STARTED WHILE `run` was executing. */
async function gcCount(run: () => void): Promise<number> {
  const seen: PerformanceEntry[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) seen.push(e);
  });
  obs.observe({ entryTypes: ['gc'] });
  const t0 = performance.now();
  run();
  const t1 = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 30));
  obs.disconnect();
  let n = 0;
  for (const e of seen) {
    if (e.startTime < t0 || e.startTime > t1) continue;
    if (gcEntryKind(e) !== GC_MINOR) continue;
    n++;
  }
  return n;
}

describe('the walk costs nothing per frame', () => {
  /**
   * A real `World`, a real store, and the real module — not a transcription.
   * The frame context is built ONCE and reused, because allocating a fresh
   * `RenderContext` object per iteration is the harness allocating, which is
   * exactly the mistake that made the PerfHud allocation test flake.
   */
  async function rig(walkers: number): Promise<{ run: (frames: number) => void; teardown: () => void }> {
    const { World } = await import('../src/core/world');
    const { setGameContext } = await import('../src/game/context');
    const system = (await import('../src/render/unit-anim.system')).default;
    const world = new World();
    world.addPlayer(Faction.Meridian ?? (3 as Faction), 'Pact', false, true);

    for (let i = 0; i < walkers; i++) {
      const h = world.store.alloc(
        EntityKind.Infantry, -1, 0 as PlayerId, 3 as Faction,
        10 + (i % 16) * 2, 0, 10 + Math.floor(i / 16) * 2,
      );
      const idx = world.store.index(h);
      // Half walking, half parked: both branches of `frame()` run every frame,
      // including the `settle` path that unwinds a stopped soldier to neutral.
      world.store.speed[idx] = i % 2 === 0 ? 3.2 : 0;
      world.store.animTime[idx] = (i * 0.017) % 1;
    }

    const counters: Record<string, number> = {};
    setGameContext({ world, debug: { counters } } as never);

    const frame: RenderContext = {
      dt: 1 / 60, time: 0, alpha: 0, frame: 0, quality: 0 as RenderContext['quality'],
    };
    return {
      run: (frames: number) => { for (let i = 0; i < frames; i++) system.frame!(frame); },
      teardown: () => { setGameContext(null); },
    };
  }

  it('advances 200 soldiers for 200,000 frames without allocating', async () => {
    // 40 million per-entity updates — an hour of a full army walking at 60 fps,
    // and enough young-generation pressure that a single boxed double per
    // iteration would force dozens of scavenges. The control below proves it.
    const { run, teardown } = await rig(200);
    try {
      // Warm the module and let V8 settle on a shape before the window opens.
      run(2_000);
      const ambient = await gcCount(() => { /* nothing */ });
      const measured = await gcCount(() => { run(200_000); });

      // The control. A loop that allocates one small object per iteration MUST
      // score above zero, or the measurement above proves nothing at all.
      const sink: object[] = [];
      const control = await gcCount(() => {
        for (let i = 0; i < 1_000_000; i++) {
          sink.push({ i });
          if (sink.length > 64) sink.length = 0;
        }
      });

      expect(ambient, 'the observer sees the idle machine as quiet').toBe(0);
      expect(control, 'the method cannot see an allocation at all').toBeGreaterThan(0);
      expect(
        measured,
        'render.unitAnim allocated. It writes one float per infantryman into a ' +
        'pre-allocated store column and must not build anything — check for a ' +
        'closure, a destructure of a fresh object, or a boxed accumulator.',
      ).toBe(0);
    } finally {
      teardown();
    }
  });

  it('counts the walkers it moved, so the loop is provably reached', async () => {
    // A frame() that returned early would also allocate nothing. This is the
    // other half of the claim.
    const { World } = await import('../src/core/world');
    const { setGameContext } = await import('../src/game/context');
    const system = (await import('../src/render/unit-anim.system')).default;
    const world = new World();
    world.addPlayer(3 as Faction, 'Pact', false, true);
    for (let i = 0; i < 10; i++) {
      const h = world.store.alloc(EntityKind.Infantry, -1, 0 as PlayerId, 3 as Faction, i, 0, 0);
      world.store.speed[world.store.index(h)] = i < 6 ? 3.2 : 0;
    }
    const counters: Record<string, number> = {};
    setGameContext({ world, debug: { counters } } as never);
    try {
      const frame: RenderContext = {
        dt: 1 / 60, time: 0, alpha: 0, frame: 0, quality: 0 as RenderContext['quality'],
      };
      // `byKind` holds STORE INDICES, not handles — no `index()` call here.
      const i0 = world.store.byKind[EntityKind.Infantry][0];
      const before = world.store.animTime[i0];
      system.frame!(frame);
      expect(counters.walking).toBe(6);
      // ...and the phase it advanced is the one the shader reads: bounded,
      // finite, and moved by exactly `speed / strideMetres * dt`.
      const after = world.store.animTime[i0];
      expect(after).toBeCloseTo(before + (3.2 / UNIT_GAIT.strideMetres) * (1 / 60), 6);
      for (let a = 0; a < world.store.byKindCount[EntityKind.Infantry]; a++) {
        const p = world.store.animTime[world.store.byKind[EntityKind.Infantry][a]];
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    } finally {
      setGameContext(null);
    }
  });
});

/* ========================================================================== */

describe('the phase that was declared and never written', () => {
  it('registers a module at RenderPhase.UnitAnim', async () => {
    // The whole report in one assertion. `UnitAnim = 40` sat in the enum with
    // no registrations while `animClip`/`animTime` had an owner in the
    // write-ownership table, columns in the store and a save-game slot.
    const mod = (await import('../src/render/unit-anim.system')).default;
    expect(mod.renderPhase).toBe(RenderPhase.UnitAnim);
    expect(mod.id).toBe('render.unitAnim');
    expect(typeof mod.frame).toBe('function');
  });

  it('is discovered by the glob, not by an edit to Systems.ts', async () => {
    // `src/game/Systems.ts` finds modules by globbing `*.system.ts`. A file
    // named anything else registers nothing and logs nothing, which is the
    // "silent registration failure" CLAUDE.md lists among the things that have
    // gone wrong before.
    const mods = import.meta.glob('../src/render/*.system.ts');
    expect(Object.keys(mods)).toContain('../src/render/unit-anim.system.ts');
  });
});
