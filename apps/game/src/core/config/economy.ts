/**
 * Domain-owned config slice: ore, harvesting, power and credits.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import { BASE_STORAGE, ORE_CELL_MAX, START_CREDITS } from './gameplay';

/* ==========================================================================
 * 21. ECONOMY — ORE, HARVESTING, POWER          (appended by src/sim/**)
 *
 * Section 16 above holds the headline balance numbers (START_CREDITS,
 * HARVEST_RATE, ORE_CELL_MAX, POWER_*). Those are NOT duplicated here. What
 * follows is the machinery that turns them into a loop: how a field is shaped,
 * how a cell regrows, how a harvester decides, and how a power deficit picks
 * which structures go dark.
 *
 * The one rule that governs every number below: the loop must be LEGIBLE from
 * a screenshot. A player has to be able to look at one frame and read "that
 * patch is nearly mined out", "that harvester is full", "the tesla coils are
 * dark". Anything that only shows up in a spreadsheet is tuned for feel, not
 * for realism.
 * ========================================================================== */

/* -- ore field shape ------------------------------------------------------ */

/**
 * A cell holding less than this many ore units is rounded down to bare ground.
 * Without the floor a field never stops existing: it decays into a 200-cell
 * halo holding 0.4 units each, which renders as a full-size patch that pays
 * nothing. The visible edge of a field must be the same thing as its economic
 * edge.
 */
export const ORE_CELL_MIN = 14;
/**
 * Per-cell richness jitter, +/- this fraction. A field with a smooth radial
 * falloff reads as an airbrushed circle; real RA ore is blotchy, and the
 * blotches are what make a half-mined field look chewed rather than shrunk.
 */
export const ORE_CELL_JITTER = 0.34;
/**
 * Exponent on the radial falloff from a field's node. 1.0 is a linear cone;
 * above 1 the field holds its richness out toward the rim and then drops
 * quickly, which keeps the mineable AREA large (harvesters spread out) while
 * still giving the node a visible bright core.
 */
export const ORE_FIELD_FALLOFF = 1.55;
/** Ore units per cell at a field centre when a scenario does not say. */
export const ORE_FIELD_DEFAULT_RICHNESS = ORE_CELL_MAX * 0.85;
/**
 * Density buckets `src/world/ore.system.ts` quantises `OreField.densityAt`
 * into. Four steps is enough that a draining cell visibly steps down three
 * times before it collapses to nothing, which is what makes ore read as being
 * CONSUMED rather than fading out like a fog bug.
 *
 * IT IS NOT A BATCH COUNT. This used to end "and few enough that the crystal
 * instancer can keep one batch per step" — the renderer that was eventually
 * written draws the entire field from ONE `InstancedMesh`, one instance per
 * seeded cell, and spends the bucket on the instance's SCALE. There is no
 * per-step batch and raising this number would not add one; it would only make
 * the size ladder finer.
 */
export const ORE_DENSITY_STEPS = 4;

/* -- regrowth ------------------------------------------------------------- */

/**
 * Ticks between regrowth passes. Every field is processed on the same pass;
 * a field is only a few hundred cells, so 2 Hz costs nothing and the growth
 * still reads as continuous because ORE_REGROW_RATE is slow.
 */
export const ORE_REGROW_INTERVAL = 15;
/**
 * A cell may only regrow once the cell BETWEEN it and the field's node holds
 * at least this fraction of its own capacity. That is what makes regrowth
 * spread outward from the node instead of the whole patch fading back in at
 * once — mine the near edge and it grows back first, strip the field to the
 * rim and it takes a long walk back out. That shape is deliberate and is
 * UNCHANGED by the value below; only the per-hop delay moves.
 *
 * ----------------------------------------------------------------------------
 * IT WAS 0.3, AND THAT MADE A WORKED FIELD UNRECOVERABLE.
 * ----------------------------------------------------------------------------
 * Reported as *"Ore fields should regenerate over time"* — and they already
 * did. The regrowth code was correct and enabled the whole time. What was
 * wrong is the RATIO between this number and `ORE_MIN_CLAIM`, which live 260
 * lines apart and had never been read together.
 *
 * A harvester claims any cell holding `ORE_MIN_CLAIM` (25) and mines it to
 * zero. At 0.3, the wave needed that same cell to hold `0.3 x capacity` — 138
 * to 160 ore on a node — before the cell BEHIND it could grow at all. So the
 * gate sat 5-6x above the ceiling a working harvester leaves, and on any field
 * a harvester could actually reach the wave never advanced past the first
 * cell. Measured: 19 consecutive sim-minutes pinned at 0.1% of a 22 381-ore
 * field, the source never once above 12 ore.
 *
 * THE CONSTRAINT IS ARITHMETIC, NOT TASTE: this value times the LARGEST cell
 * capacity must stay below `ORE_MIN_CLAIM`, or the stall comes back for the
 * fields that violate it. `ORE_CELL_MAX` is 900, so the bound is 25/900 =
 * 0.0278. 0.025 clears it for every field the generator can produce.
 *
 * 0.05 was the first proposal and is REJECTED: it is fine for the shipped
 * `ORE_FIELD_DEFAULT_RICHNESS` (node caps 461-535 give a gate of 23-27) but it
 * straddles 25, so the richest fields would still pin while the rest
 * recovered — the same bug, on fewer seeds, and harder to find.
 *
 * Undisturbed recovery barely moves (95% in ~14.2 min against 23.4 at 0.3),
 * so this is not a rate change wearing a disguise.
 */
export const ORE_REGROW_SPREAD = 0.025;
/**
 * The node cell itself regrows this much faster than the rest of the field.
 * The node is the only cell with no upstream neighbour, so without a bonus it
 * is the bottleneck for the entire patch.
 */
export const ORE_REGROW_NODE_BONUS = 3.0;

/* -- harvester decisions -------------------------------------------------- */

/**
 * Seconds a harvester's claim on an ore cell survives without being refreshed.
 * Long enough that a harvester crossing the map keeps its cell; short enough
 * that a claim held by a harvester that just died frees up before anyone
 * notices. The claim grid is deliberately time-based rather than handle-based
 * so it cannot leak — nothing has to remember to release it.
 */
export const ORE_CLAIM_TTL = 4.0;
/** Furthest a harvester will look for ore, in CELLS (40 * 4 m = 160 m). */
export const ORE_SEARCH_CELLS = 40;
/**
 * Metres ON TOP OF the harvester's own hull radius at which it starts scooping.
 *
 * Expressed as a slack rather than an absolute for one specific reason: the nav
 * layer parks a unit as soon as it is within `radius + NAV_ARRIVE_SLACK` of its
 * order point and then releases the flow field. If the economy's arrival test
 * were tighter than nav's, a harvester would be parked by nav three metres
 * short and would sit there forever waiting to reach a cell it was never going
 * to be driven any closer to. This slack is comfortably larger than
 * NAV_ARRIVE_SLACK, and it must stay that way.
 */
export const HARVEST_ARRIVE_RADIUS = 2.2;
/** Same, for the dock point. Also larger than NAV_ARRIVE_SLACK, and for the same reason. */
export const HARVESTER_DOCK_RADIUS = 2.6;
/**
 * Metres of DAYLIGHT between a docked harvester's hull and the refinery it is
 * unloading into. A gap, not a standoff — the hull's own radius is added by
 * `Harvesting.ts`, so this is the only part a designer tunes.
 *
 * THIS REPLACES `HARVESTER_DOCK_STANDOFF = 3.4`, WHICH WAS THE STUCK-COLLECTOR
 * BUG. That constant was described here as "half a harvester length plus a
 * little", and half a harvester is 8.60 / 2 = 4.30 m — the value was 3.4, short
 * of the half it named before you even reach the "plus a little". Since the
 * apron was `halfDepth + 3.4` and a harvester's collision radius is 3.87, every
 * harvester in the game parked with its back end ~0.5 m inside a footprint the
 * nav grid marks impassable. Reported as "the collector is stuck within its own
 * building".
 *
 * It also described a fallback "when the def table carries no explicit
 * dockOffset". There was no such branch and no such reader: `dockOffsetX/Z` was
 * filled for every building and consumed by nothing — `docs/SPEC_DRIFT_AUDIT.md`
 * finding 40, confirmed still live and now deleted rather than wired, because
 * deriving the apron from the docking hull's actual radius is strictly better
 * than an authored constant that assumes one harvester size.
 *
 * 0.6 m: close enough that the hull reads as parked ON the apron rather than
 * floating off it, clear enough that `touching()` does not fire in the normal
 * path. Keep it well under `HARVESTER_DOCK_RADIUS` (2.6) or arrival and contact
 * start fighting each other.
 */
export const HARVESTER_DOCK_CLEARANCE = 0.6;
/** Metres behind the dock a second harvester waits while the first unloads. */
export const HARVESTER_QUEUE_GAP = 9.0;
/**
 * Seconds of no measurable progress toward its destination before a harvester
 * gives up on the current plan and re-scores. Covers a cell that became
 * unreachable, a refinery walled in by its owner, and a nav field that never
 * arrives.
 */
export const HARVESTER_STUCK_SECONDS = 4.0;
/**
 * Seconds a harvester may sit at ZERO VELOCITY, short of its destination, while
 * nav still holds a flow field for it, before the backstop mover takes over.
 *
 * THE STATE THIS EXISTS FOR IS NOT HYPOTHETICAL — it is what "the ore harvesters
 * keep stucking everywhere, getting me without funds mid game" measured out to.
 * `NavAssigner`'s give-up path calls `finishOrder`, which sets `AgentFlag.Arrived`
 * and zeroes `velX/velZ`; the unit is nonetheless left holding a field, because
 * the assigner re-requests one on the same tick (the park rung reports "position
 * unchanged", so the loop does not `continue`). `Harvesting.drive` gated its
 * whole rescue on `navField < 0`, so the one state the rescue was written for
 * was the one state it could never see. This paragraph used to attribute that
 * to `finishOrder` not releasing the field, which is not what it does. Soaked over 4 minutes on
 * three seeds, 10 of 12 harvesters ended parked with a full hopper and
 * `stats().driven` read 0 for the entire match: the backstop never ran once.
 *
 * THE GRACE IS WHY THIS IS A DURATION AND NOT A PREDICATE. A harvester whose
 * field is merely NOT READY YET also reads zero velocity, for a handful of
 * ticks. Taking over instantly would have the backstop fight nav on every
 * re-path — it drives point-to-point with no flow field, so it would happily
 * aim into a concave obstacle nav was about to route around. 0.6 s is ~18
 * ticks: far longer than any field expansion, far shorter than the 4 s the
 * FSM's own progress watchdog waits, so the rescue lands before the FSM has
 * given up and re-scored.
 */
export const HARVESTER_NAV_PARK_GRACE = 0.6;
/**
 * Seconds a harvester that just gave up on a dock refuses to contend for it
 * again. LONGER THAN `HARVESTER_STUCK_SECONDS` ON PURPOSE — that is the whole
 * mechanism.
 *
 * Two haulers, one refinery, and the release path had no cooldown at all: A
 * holds the dock, fails to reach the apron, `trackProgress` fires at 4 s and
 * releases; B takes the dock and its destination jumps from the queue point to
 * the apron — `HARVESTER_QUEUE_GAP`, 9.0 m, which is fifteen times
 * `NAV_FORMATION_GOAL_EPS`; A re-picks the same refinery, finds B holding it and
 * jumps 9 m the other way. Every swap drops both flow fields, re-seats both
 * formation slots and re-arms every give-up watchdog, so NEITHER hauler ever
 * completes a 12 m approach. Traced as a destination alternating between
 * 189.1,339.5 and 182.2,345.3 for the entire match with a full hopper.
 *
 * Standing down for longer than the other hauler's own stuck window is what
 * guarantees the window is actually usable: whoever holds the dock gets a
 * clean run at it rather than being interrupted mid-path.
 */
export const HARVESTER_DOCK_STANDDOWN = 6.0;
/**
 * Failed apron approaches before a harvester stops aiming at the apron and
 * aims at the refinery ITSELF, docking on contact from whichever face it can
 * actually reach.
 *
 * The apron is a nicety — it exists so haulers queue tidily on one side instead
 * of converging from all directions. A base layout can put it in a pocket:
 * measured on the stock skirmish layout, a refinery at yaw -0.87 faces its dock
 * INTO a cluster of three other structures. `tickReturn` already docks on
 * `touching()` for exactly this reason ("a harvester can end up overlapping the
 * structure ... touching counts"); this makes that the deliberate second
 * attempt rather than an accident. Tidiness is worth two tries. It is not worth
 * the economy.
 */
export const HARVESTER_DOCK_FALLBACK_TRIES = 2;
/**
 * Seconds the backstop mover drives a harvester outright — ignoring the flow
 * field entirely — after the FSM's progress watchdog finds it going nowhere.
 *
 * THE CASE: a harvester wedged on the corner of its OWN refinery's footprint,
 * six metres from the building it just undocked from. Traced at millimetre
 * resolution: nav held a live field, commanded `speed 1.50` (0.050 m per tick)
 * and the hull advanced 0.003 — because the steering vector oscillated between
 * (1.47, -0.28) and (1.41, +0.52) across the footprint's corner discontinuity,
 * and `Movement` drives a TRACKED hull along its own FACING, not along the
 * steering vector. So the chassis rocked between two headings, never committed
 * to either, and covered 33 m in four minutes.
 *
 * Nothing in the nav stack is going to fix that from inside: a flow field has a
 * genuine discontinuity at a blocked corner and no amount of watchdog escalation
 * invents a gradient. The module that owns the economy owns the guarantee (see
 * this file's header), and it owns a point-to-point mover with sidestep probing
 * that does not consult a field at all. This is the window in which that mover
 * takes over.
 *
 * 5 s at 5 m/s is 25 m — several cells clear of any corner that could have
 * caused it. `HARVESTER_FORCE_DRIVE_TRIES` bounds it so a genuinely unreachable
 * cell still ends in the honest answer (drop the claim, re-plan) rather than a
 * harvester bulldozing at a wall forever.
 */
export const HARVESTER_FORCE_DRIVE_SECONDS = 5.0;
/** Force-drive windows allowed per claim before the destination is abandoned. */
export const HARVESTER_FORCE_DRIVE_TRIES = 2;
/**
 * Seconds in which NOTHING moved a hauling harvester — not the flow field, not
 * the backstop mover — before its FSM concludes that nav has given up and picks
 * a different destination.
 *
 * ============ THE SIGNAL THE OLD EXCLUSION SHOULD HAVE USED ================
 * `Harvesting.tickSeek` records a measured failure: remembering an ore cell the
 * progress watchdog gave up on and refusing to re-pick it cost 3 deliveries and
 * took stalls from 6/12 to 9/12. The diagnosis in that note is the right one —
 * `HARVESTER_STUCK_SECONDS` of no progress is far more often transient
 * congestion than unreachability, so the exclusion mostly banished cells that
 * were fine a second later — and it ends with the condition an exclusion would
 * have to meet: "the signal has to distinguish 'cannot get there' from 'did not
 * get there yet', and progress alone cannot."
 *
 * THIS is that signal, and it is not progress. It counts only the ticks in which
 * every mover in the game declined to move this hull: nav holds a field and is
 * commanding zero velocity (which is what `AgentFlag.Arrived` makes it do, and
 * the wedge ladder's park rung is how a hull that never arrived gets that flag),
 * AND `drive()` — which needs no field, no gradient and no clearance — put it
 * down within a millimetre of where it picked it up. Congestion does not look
 * like that: a hull queued behind another one still gets a non-zero velocity
 * between shuffles, and one shuffle resets this to zero.
 *
 * Measured on seed 4242 slot 43: parked at 177,304 with `aflags` = Arrived |
 * HasSlot | Displaced, the wedge ladder spent at rung 3, 36 m from its claimed
 * ore cell, for 2100 consecutive ticks. The cell was unreachable — a 2 m
 * `BlocksNav` rock at 182,298 that the PLANNER could not see sealed a corridor
 * one cell wide against a 3.87 m hull — and the FSM re-published the same cell
 * every tick for the rest of the match.
 *
 * THAT EXACT CAUSE IS HISTORICAL NOW. Props carry no `BlocksNav`, the relax
 * branch that made them solid is deleted, and this trace is kept because it is
 * the measurement the constant was sized from — not because a rock can still do
 * it. What the watchdog catches TODAY is the same shape from the causes that
 * remain: ground the planner routes over which the hull cannot traverse —
 * a building footprint corner, a cliff lip, a pruned region — where
 * `driveOne`'s slide zeroes speed on both axes and the hull covers nothing.
 *
 * 8 s rather than 2: the backstop is allowed to be slow, and a hull creeping
 * out of a jam at 12 cm/s must not be re-planned out of its own escape. Swept
 * on the three soak seeds with everything else fixed — 6 s: 30 deliveries,
 * 1 crawling, 7 stalled; 8 s: 33/0/4; 10 s: 34/3/5; 12 s: 30/2/6. Well under
 * `HARVESTER_UNREACHABLE_BAN_SECONDS`, so the ban a give-up sets always
 * outlives the give-up that set it.
 * ========================================================================== */
export const HARVESTER_NAV_GIVEUP_SECONDS = 8.0;
/**
 * Metres of RAW displacement inside that window that counts as the hull still
 * being moved by somebody.
 *
 * Raw displacement against an anchor, and not per-tick displacement, because
 * per-tick displacement cannot see this class of failure at all: a hull can be
 * moved every tick and be undone every tick, so sampled per tick it reports
 * 1.5 m/s while over six seconds it has covered 0.0 m. Same reasoning, and the
 * same remedy, as `NavAgents.anchorX`.
 *
 * THE ORIGINAL PRODUCER OF THAT PATTERN IS GONE. It was `Movement.relax`
 * pushing a hull out of a `BlocksNav` prop every tick, and props are not solid
 * any more — relax skips everything without `CanMove`, so no building or prop
 * enters it. The anchor design is kept because the pattern is not unique to
 * rocks: the surviving measured case is in this same file above, a hull that
 * advanced 0.003 m against a commanded 0.050 and covered 33 m in four minutes,
 * which a per-tick test would read as healthy.
 *
 * 1 m over 6 s is 0.17 m/s against a 5 m/s hull — three per cent of capable.
 */
export const HARVESTER_NAV_GIVEUP_METRES = 1.0;
/**
 * Seconds a harvester refuses to re-claim ore around a cell nav gave up on.
 *
 * Per HARVESTER, not global: the cell is unreachable FROM WHERE THIS HULL IS
 * STANDING, and a second harvester on the other side of the same rock may well
 * drive straight to it. A global exclusion would be a claim about the map; this
 * is a claim about one vehicle's afternoon.
 */
export const HARVESTER_UNREACHABLE_BAN_SECONDS = 30.0;
/**
 * Chebyshev cells around a banned cell that are banned with it.
 *
 * Banning one cell is worth nothing, and this is the constant that decides
 * whether the whole exclusion helps or hurts. Ore comes in patches,
 * `findFreeOre` ranks by distance, and the next-nearest cell to an unreachable
 * one is its neighbour — behind the same rock, in the same sealed corridor. So
 * the ban has to be big enough that the re-plan lands on a DIFFERENT PATCH, not
 * one cell to the left of the thing that stopped it.
 *
 * Swept on the three soak seeds, everything else fixed, as deliveries/crawling/
 * stalled: 3 cells 24/4/7, 6 cells 24/3/8, 10 cells 27/2/6, 14 cells 33/2/5,
 * 20 cells 34/3/5, 28 cells 32/3/5. Below about ten cells it is measurably
 * WORSE than no ban at all — which is the same result the first attempt at an
 * exclusion got, and one of the two reasons it got it.
 *
 * 20 cells is 80 m. That sounds enormous for an exclusion and it is exactly the
 * point: the claim being made is "not that patch", and it is bounded by
 * `ORE_SEARCH_CELLS` (40) so a harvester can always still find ore beyond it.
 */
export const HARVESTER_UNREACHABLE_BAN_CELLS = 20;
/** Ticks between OreSparkle FX pushes from one scooping harvester. */
export const HARVEST_FX_INTERVAL = 6;
/**
 * Ore units below which a cell is not worth claiming as a destination. A
 * harvester that drives 90 m for 3 units of ore looks broken.
 */
export const ORE_MIN_CLAIM = 25;

/* --------------------------------------------------------------------------
 * THE HARVESTER LEASH — how far from its ANCHOR a harvester will work.
 *
 * THE DEFECT. `rescoreOre` and `acquireOre` scored the whole map: nearest
 * unclaimed cell within ORE_SEARCH_CELLS (40 cells = 160 m) of WHERE THE HULL
 * IS STANDING, with a `nearestField` fallback that re-centres the search on any
 * field anywhere. There was no notion of a home patch, so the choice was a
 * memoryless random walk with a 160 m step — mine the contested patch, rescore
 * from there, and the enemy's home field is now the nearest thing. Measured on
 * the stock skirmish map, seed 1337: a harvester that started at 167,284 ended
 * 148 m from its start and spent 574 ticks (19 s) within 70 m of the ENEMY base
 * centre, on a map whose two bases are 182 m apart. That is the reported
 * "sometimes they just suicide and going to enemy camp".
 *
 * THE RADIUS IS BOUNDED ON BOTH SIDES BY MEASURED FIELD GEOMETRY, not chosen.
 * Every number below is from `OreField.seedField` run against the real
 * heightfield on the stock skirmish layout (identical on seeds 4242/1337/90210):
 *
 *   home field      declared r30, LIVE radius 27.8-28.0 m, 140-143 cells
 *   contested patch declared r22, LIVE radius 20.6 m, 81 cells
 *   field centres   90 m apart (home->contested); 180 m home->home
 *   home field to its owner's nearest building   21 m
 *   home field to the ENEMY's nearest building  156 m
 *
 * LOWER BOUND — the leash must never shrink the patch it is anchored on. The
 * anchor is snapped to the field's node cell (see `anchorOnField`), so the
 * furthest cell it has to cover is the live radius: 28 m.
 *
 * UPPER BOUND — the leash must not reach the NEXT patch, or "bound to this
 * field" means nothing. Centres are 90 m apart and the nearest cell of a
 * neighbouring home field is therefore 90 - 28 = 62 m from this node.
 *
 * So the window is [28, 62] and 48 leaves 20 m of headroom under the first and
 * 14 m under the second. The headroom under the lower bound is real rather than
 * decorative: Sunder Atoll's home fields are r30 on ground with an 8 m coastal
 * wander, so their live radius runs to the declared figure.
 *
 * WHAT THIS IS NOT MEASURED AGAINST, deliberately: the haul. A full hopper must
 * always be able to reach a dock, so `ReturnToRefinery` is never leashed — only
 * the two sites that CHOOSE an ore cell are. That decoupling is why the radius
 * can be sized by the field alone.
 * ------------------------------------------------------------------------ */

/** Metres from its anchor a harvester will accept an ore cell. */
export const HARVESTER_LEASH_METRES = 48;

/**
 * Seconds a leashed harvester will wait beside a patch that has nothing left
 * before it re-anchors on another one.
 *
 * ORE REGROWS, so "dry" is usually temporary: `ORE_REGROW_RATE` is 0.6/s and
 * `ORE_REGROW_NODE_BONUS` is 3.0, so a stripped node is back over
 * `ORE_MIN_CLAIM` (25) in about 14 s. Anything shorter than that would send a
 * harvester away from a patch that was about to feed it again.
 *
 * The ceiling is the round trip. `tests/harvester-soak.spec.ts` measures a
 * healthy harvester completing one every 30-60 s, so a harvester that has
 * waited 30 s has spent exactly one trip's worth of income finding out that the
 * patch is finished — and waiting longer costs more than moving.
 */
export const HARVESTER_LEASH_PATIENCE = 30;

/* -- power ---------------------------------------------------------------- */

/**
 * Ticks between full power recomputes. The scan is also forced immediately on
 * any building completing, dying, being sold or changing hands, so this
 * interval only covers construction progress crossing 1.0.
 */
export const POWER_RECOMPUTE_INTERVAL = 5;
/**
 * Shed priority classes, lowest goes dark first. A deficit darkens structures
 * whose combined draw covers the shortfall — it never reduces the draw itself,
 * because a grid that heals by switching things off removes the entire reason
 * to build another power plant.
 */
export const POWER_SHED_ORDER = {
  defence: 0,
  radar: 1,
  tech: 2,
  factory: 3,
  refinery: 4,
  /** Never shed. A Construction Yard going dark is an unrecoverable state. */
  never: 99,
} as const;
/** Minimum seconds between "low power" EVA lines for one player. */
export const POWER_EVA_COOLDOWN = 25;

/* -- credits -------------------------------------------------------------- */

/**
 * The real base storage cap, and a deliberate correction to section 16.
 *
 * BASE_STORAGE is 1000 and START_CREDITS is 10000. Those two numbers were
 * authored independently and they collide head-on: taken literally, every
 * player begins the match nine thousand credits OVER their cap, so the very
 * first harvester load is 100% wasted, EVA calls for silos in the first ninety
 * seconds, and a Construction Yard that is destroyed and rebuilt vaporises the
 * player's bank. That is not a balance choice anybody made; it is two constants
 * that never met.
 *
 * Resolved in the only direction that cannot produce a bug report: the cap may
 * never be lower than the money the game hands you at the start. Silos and
 * refineries still matter — they raise the ceiling above 10 000, which is
 * exactly the point at which a player is rich enough for storage to be a real
 * decision — but nothing you were GIVEN can ever be confiscated by a cap.
 *
 * If the balance pass later wants overflow pressure earlier, the lever is
 * START_CREDITS in section 16, not this line.
 */
export const STORAGE_BASE = BASE_STORAGE > START_CREDITS ? BASE_STORAGE : START_CREDITS;

/** Minimum seconds between "silos needed" EVA lines for one player. */
export const SILO_EVA_COOLDOWN = 20;
/** Minimum seconds between "insufficient funds" EVA lines for one player. */
export const FUNDS_EVA_COOLDOWN = 4;
/** Ticks in the income-rate measurement window (30 ticks = 1 second). */
export const INCOME_WINDOW_TICKS = 30;
/**
 * EMA weight applied to each new income sample. 0.35 settles in about three
 * seconds — fast enough that killing a harvester shows on the HUD, slow enough
 * that the number does not flicker between unload pulses.
 */
export const INCOME_SMOOTHING = 0.35;
/**
 * Credits per second the HUD's rolling counter travels toward the true
 * balance. A big deposit should visibly SPIN rather than snap; RA's ticking
 * credit counter is half the reason banking a load feels good.
 */
export const CREDITS_TICKER_RATE = 1400;
/** Below this many credits the ticker snaps instead of rolling. */
export const CREDITS_TICKER_SNAP = 2;
