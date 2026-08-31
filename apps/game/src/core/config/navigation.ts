/**
 * Domain-owned config slice: pathfinding, steering and movement.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 20. PATHFINDING, STEERING AND MOVEMENT   (owned by src/sim/**)
 *
 * The flow-field budget, the cost model, the boids weights and the six chassis
 * turn models. These are FEEL numbers: a critic who says "the tanks look like
 * they are on ice" or "the column shoves itself apart" is reading exactly this
 * block, and every one of them is safe to retune in isolation.
 *
 * The cost arrays are indexed by `MoveClass` (src/sim/Flowfield.ts):
 *   0 foot, 1 track, 2 wheel, 3 hover, 4 naval, 5 air.
 * ========================================================================== */

/**
 * Road-cell cost multiplier per move class. Below 1.0 makes a road ATTRACTIVE
 * to the flow field, which is the whole reason to have roads in an RTS: it is
 * what makes convoys spontaneously form up on them instead of cutting across
 * the grass. Wheels care most, infantry barely at all, hovercraft and ships
 * not at all.
 */
export const NAV_COST_ROAD = [0.88, 0.78, 0.58, 1.0, 1.0, 1.0] as const;

/**
 * Rough-ground cost multiplier per move class, applied wherever terrain
 * already classified a cell as rough (slope past ROUGH_SLOPE). Tracks shrug it
 * off; wheels are punished hard, which is what separates an IFV from a Warden
 * on a hillside.
 */
export const NAV_COST_ROUGH = [1.25, 1.45, 2.05, 1.0, 1.0, 1.0] as const;

/** Carved connectivity ramps are slightly cheap so units prefer them to a scramble. */
export const NAV_COST_RAMP = 0.92;

/**
 * Multiplier applied to any cell orthogonally adjacent to an impassable one.
 * Pure shortest paths glue themselves to obstacle corners; one cheap dilation
 * pass buys about a metre of clearance and stops a column scraping the side of
 * a Construction Yard. 1.0 disables the pass entirely.
 */
export const NAV_COST_WALL_HUG = 1.35;

/**
 * MINIMUM CORRIDOR WIDTH, IN CELLS, THAT A CLASS IS ALLOWED TO BE ROUTED DOWN.
 *
 * The cost field carves out building footprints and nothing else, so two
 * structures a single cell apart leave what the planner reads as a perfectly
 * legal corridor. One cell is 4 m. The widest ground hull in the game is the
 * harvester at `hullRadius(8.6 x 4.0)` = 3.87 m of RADIUS — 7.74 m across, very
 * nearly two cells — so that corridor is a slot the vehicle does not fit
 * through, entered at speed, with a separation force pushing off each wall.
 * Real RTS nav grids bake a clearance margin into the footprint for exactly
 * this reason; this is that margin, expressed as the narrowest free span a cell
 * may sit in and still be routable.
 *
 * 2 for everything with a vehicle-sized hull (Track, Wheel, and Hover). 1 for
 * Foot, because infantry are ~1 m across and threading a doorway is something
 * they SHOULD do; 1 for Naval, because the narrow thing on water is a strait
 * and closing straits changes maps; 1 for Air, which ignores the grid.
 *
 * Indexed by `MoveClass`. A value of 1 disables the rule for that class.
 *
 * Blocking narrow cells can never disconnect the map: `Flowfield.rebuildCost`
 * restores any narrow run that is the only join between two otherwise separate
 * regions. See its §clearance for the proof.
 */
export const NAV_MIN_CORRIDOR_CELLS = [1, 2, 2, 2, 1, 1] as const;

/** Concurrent in-flight field expansions. Each carries ~80 KB of working state. */
export const NAV_FIELD_EXPANDERS = 4;
/** Smallest per-expander share of the tick budget, so nobody starves. */
export const NAV_MIN_EXPANDER_BUDGET = 256;
/** Ring radius, in cells, for "nearest cell I can actually stand on". */
export const NAV_SNAP_SEARCH_CELLS = 14;

/** Metres of slack beyond a unit's own radius that counts as "arrived". */
export const NAV_ARRIVE_SLACK = 1.1;
/** Metres out from the goal where a unit begins braking. */
export const NAV_SLOWDOWN_RADIUS = 7.0;
/** Floor on the arrival ramp, as a fraction of max speed. Zero would stall. */
export const NAV_MIN_APPROACH_SPEED = 0.22;

/**
 * Metres within which a unit tests for a clear straight line and, if it finds
 * one, abandons the flow field. This is string-pulling, and it is what removes
 * the last of the 8-way grid stair-stepping on open ground.
 */
export const NAV_DIRECT_RANGE = 26;
/** Ticks between direct-path probes for one unit (round-robin sliced). */
export const NAV_DIRECT_RECHECK_TICKS = 6;
/** Ticks between "is my field still alive" checks for one unit. */
export const NAV_REPATH_TICKS = 30;

/** Consecutive near-stationary ticks under a move order before we intervene. */
export const NAV_STUCK_TICKS = 24;
/*
 * `NAV_STUCK_SPEED_FRAC` USED TO LIVE HERE AND IS GONE ON PURPOSE.
 *
 * The stuck watchdog incremented only when `st.speed` read below this fraction
 * of max, with a final branch that RESET the counter otherwise. That branch
 * classified a hull grinding nose-first into a blocked cell at full throttle as
 * healthy, because its reported speed was exactly `maxSpeed`. Measured: a full
 * harvester pinned for 1800 consecutive ticks with the counter never leaving 0.
 *
 * The watchdog now measures real displacement for both the increment and the
 * reset (see `NAV_STUCK_MOVED_EPSILON`), so there is no speed threshold left to
 * tune. Re-adding one would re-open the same hole.
 */
/**
 * Metres of real displacement in one tick that proves a unit is NOT stuck,
 * whatever `st.speed` says about it.
 *
 * The stuck watchdog used to read `st.speed` alone, and `st.speed` is a column
 * `Harvesting.driveEscape` deliberately writes 0 to while physically moving the
 * hull out of a building — it must, because `MovementIntegrator` integrates
 * position FROM that column. An active rescue therefore read as a stall, the
 * watchdog spent all its nudges, parked the unit, and the park armed the
 * harvester backstop, which produced a 24-tick oscillation the player sees as
 * jitter.
 *
 * 0.01 m/tick is 0.3 m/s — an order of magnitude below the slowest unit in the
 * game and far above float noise, so it separates "being moved by something" from
 * "grinding in place" without ever calling a genuinely wedged unit healthy.
 * Extraction runs at ~0.088 m/tick, comfortably clear of it.
 */
export const NAV_STUCK_MOVED_EPSILON = 0.01;
/** Stuck this close to the goal: call it arrived rather than grind. */
export const NAV_STUCK_GIVEUP_RADIUS = 5.5;
/** Sideways shoves before a stuck unit simply gives up and parks. */
export const NAV_STUCK_MAX_NUDGES = 3;

/* -- the wedge watchdog ---------------------------------------------------
 *
 * `NAV_STUCK_*` above watches the SPEEDOMETER and the progress watchdog in
 * Steering.ts watches DISTANCE TO GOAL. Neither of them answers the question a
 * player actually asks — "has this thing physically moved at all in the last
 * ten seconds?" — and that is the failure that gets reported, because it is the
 * only one that is visible from the top of the map.
 *
 * So this ladder measures RAW DISPLACEMENT and nothing else, and it applies to
 * every mover, not just harvesters. It is a safety net: if it fires often, the
 * clearance rule above is not doing its job and THAT is the bug to fix.
 * ------------------------------------------------------------------------- */

/**
 * Ticks between displacement samples for one unit. 40 = 1.33 s at 30 Hz, so the
 * ladder's first rung lands at `40 * NAV_WEDGE_STRIKES` = 120 ticks, 4 s.
 *
 * WAS 60, AND 60 WAS TOO SLOW TO EVER FIRE. The evidence this ladder collects
 * is reset by `armWedge` whenever the unit's order point moves, and the
 * harvester FSM re-orders roughly every 230 ticks even after its own churn was
 * fixed (`Harvesting.commitDockPoint`). At 60 the ladder needed 180 consecutive
 * ticks, which left almost no margin, and before that fix it needed more than
 * the FSM ever gave it — so the rescue that exists for "it is just sitting
 * there" could not run on the units that sit there most.
 *
 * Tuned against `tests/harvester-soak.spec.ts`, total deliveries over 3 seeds:
 *
 *     60 -> 24        (the ladder rarely completes a window)
 *     40 -> 26
 *     30 -> 23        (fires on ordinary congestion and shoves units mid-detour)
 *
 * 30 is past the knee: at that rate a unit legitimately waiting its turn at a
 * dock trips the ladder, and being displaced out of a queue costs more than the
 * jam it was mistaken for. `tests/wedge.spec.ts` passes at all three; it proves
 * the ladder WORKS, not that it fires at the right time, which is what this
 * number decides.
 */
export const NAV_WEDGE_SAMPLE_TICKS = 40;
/** Metres of travel inside one sample window that still counts as moving. */
export const NAV_WEDGE_METRES = 1.0;
/** Consecutive barren windows before the ladder steps. 3 = 4 s of no movement. */
export const NAV_WEDGE_STRIKES = 3;
/** Rungs spent nudging before the unit is displaced outright. */
export const NAV_WEDGE_MAX_NUDGES = 2;
/**
 * Ring radius, in cells, for the last-resort displacement. 6 cells is 24 m —
 * far enough to clear any single structure's footprint plus its neighbour,
 * short enough that the unit visibly shuffles rather than teleporting.
 */
export const NAV_WEDGE_SEARCH_CELLS = 6;

/** Formation slot spacing, as a multiple of the group's mean unit radius. */
export const NAV_FORMATION_SPACING = 2.6;
/** Hard cap on a formation slot offset, metres. */
/**
 * Metres between neighbours in a formation: a floor, and a per-hull term.
 *
 * `NAV_FORMATION_SPACING` below is a MULTIPLE OF THE HULL and is what made
 * formations meaningless for infantry — `radius` 0.234 resolved to 0.61 m of
 * centre spacing, so six riflemen collapsed into a 1.49 m disc whatever shape
 * they were given, while tanks were untouched. Two neighbours need their two
 * hulls plus room to walk, which is a DISTANCE, so it is written as one.
 */
export const NAV_FORMATION_MIN_SPACING = 2.0;
export const NAV_FORMATION_GAP = 1.4;
export const NAV_FORMATION_MAX_OFFSET = 30;
/** Two order points closer than this (metres) count as the same group order. */
export const NAV_FORMATION_GOAL_EPS = 0.6;

/* -- what happened to NAV_FORMATION_ENGAGE_RADIUS -------------------------
 *
 * There used to be a fourth number here: "metres from the goal at which a unit
 * leaves the shared field and drives to its own slot", 22 m. It was deleted on
 * 2026-08-06 because it never described anything.
 *
 * `SteeringSolver` gated its target point on it. `NavAssigner` — the arrival
 * test, the give-up test, the progress watchdog, the direct-path probe — did
 * not, and applied the slot unconditionally. So the two halves of nav disagreed
 * about where each unit was going, permanently, by up to the slot offset. Worse,
 * NAV_FORMATION_MAX_OFFSET is 30 and the radius was 22, so a legal formation
 * slot could be FARTHER from the goal than the radius that switched it on: the
 * unit closed to 21 m, retargeted 30 m sideways, retreated past 22 m, retargeted
 * back, and hunted across the boundary until the give-up ladder parked it. That
 * was measured, not reasoned: a 28 m slot left a lone vehicle oscillating
 * between 15 m and 24 m of its order point and then parked 23.5 m short of it.
 *
 * The radius bought nothing even when it worked. Outside it, with a live flow
 * field, the target point feeds only the arrival ramp (7 m) and the near-goal
 * bearing fold-in (8 m) — both of which are inside any plausible radius — while
 * the DIRECTION comes from `nav.sample()`, which never looked at the slot at
 * all. One field per group is a property of how the field is requested (from
 * `goalX/goalZ`, never the slot), not of this gate. The gate's only real effect
 * was the disagreement it created.
 *
 * The target point is now `agentTarget()` in sim/Steering.ts, unconditional, and
 * both phases call it. There is nothing left to tune.
 * ------------------------------------------------------------------------- */

/** Weight of the flow-field term in the steering blend. The baseline is 1.0. */
export const STEER_FLOW_WEIGHT = 1.0;
/** Weight of the summed separation push. */
export const STEER_SEPARATION_WEIGHT = 1.15;
/** Neighbour search radius, as a multiple of the steering unit's own radius. */
export const STEER_SEPARATION_RANGE_MUL = 2.4;
/** Extra push away from a neighbour that is stopped — go around, do not shove. */
export const STEER_STATIC_PUSH_MUL = 1.8;

/** Weight of the obstacle-avoidance sidestep. */
export const STEER_AVOID_WEIGHT = 1.4;
/** Metres ahead of the hull the avoidance probe looks. */
export const STEER_AVOID_LOOKAHEAD = 3.2;
/** Metres out to each side the flank probes sit. */
export const STEER_AVOID_SIDE = 2.4;

/**
 * cos of the half-angle of the "directly ahead of me" cone used by the queue
 * brake. cos(38 degrees). Wider and units brake for traffic beside them.
 */
export const STEER_QUEUE_COS = 0.788;
/** Queue-brake trigger distance, as a multiple of the summed radii. */
export const STEER_QUEUE_RANGE_MUL = 2.2;
/** How hard the gap to the unit ahead converts into speed. m/s per metre. */
export const STEER_QUEUE_BRAKE = 1.6;

/* -- the head-on deadlock, and the two numbers that end it -----------------
 *
 * THE BUG, MEASURED. Order two vehicles past each other on open ground and
 * they meet nose to nose, decay to a dead stop over about four seconds, and
 * never move again. Reproduced in `tests/clash.spec.ts` at 12 seeds out of 12
 * before the fix; the trace is an exponential speed decay with the gap pinned
 * at exactly `radius(a) + radius(b)`.
 *
 * TWO FAULTS COMPOUND, AND NEITHER IS SUFFICIENT ON ITS OWN:
 *
 *   1. THE QUEUE BRAKE HAD NO FLOOR. It sets my desired speed to the speed of
 *      whoever is in front of me, plus `(gap - contact) * STEER_QUEUE_BRAKE`.
 *      Relaxation holds the gap a hair BELOW contact, so that term is
 *      negative, and for two units facing each other the recurrence is
 *      `v <- v' - eps` on both sides at once. That is a contraction with the
 *      fixed point 0. Both stop. Forever.
 *
 *   2. NOTHING PRODUCED A LATERAL COMPONENT. Head-on, the separation push is
 *      exactly anti-parallel to the travel direction, so the blend stays on
 *      one axis and neither unit ever tries to go AROUND. Obstacle avoidance
 *      cannot help — it probes the terrain grid, and another unit is not in it.
 *
 * Fixing only the floor gives two units grinding at a crawl forever; fixing
 * only the sidestep gives two units sidestepping at zero speed, which is the
 * same picture. Both, together, make them pass.
 * ------------------------------------------------------------------------- */

/**
 * Floor on what the queue brake may ask for, as a fraction of max speed.
 *
 * A brake that can command zero is a brake that can deadlock: a stopped unit
 * has no velocity to steer, so it cannot use the sidestep below to get out of
 * its own jam. This floor never overrides ARRIVAL damping (which legitimately
 * goes to NAV_MIN_APPROACH_SPEED and then parks) — only the brake.
 */
export const STEER_QUEUE_MIN_FRAC = 0.30;

/**
 * How anti-parallel two headings must be before the neighbour counts as
 * ONCOMING rather than as traffic to queue behind. cos(110 degrees) ~ -0.34,
 * so the test is `heading . myDirection < -0.34`.
 */
export const STEER_PASS_COS = 0.34;

/**
 * A neighbour slower than this fraction of MY max speed is standing in the
 * way, not leading a queue. Drive around it rather than inheriting its speed.
 */
export const STEER_PASS_STALL_FRAC = 0.25;

/**
 * Weight of the sidestep that resolves a head-on meeting.
 *
 * The direction is always the steering unit's OWN right, and that is the whole
 * trick: two units facing each other have opposite right-hand vectors, so
 * "both keep right" is a tie-break that needs no shared state, no RNG and no
 * id comparison — and it is the one rule that cannot mirror. (An id-parity
 * tie-break WOULD mirror: `i` steps to its right and `j` to its left, which
 * for opposed headings is the same world direction, and they stay locked.)
 */
export const STEER_PASS_WEIGHT = 1.25;

/* -- the unwedge shove, and why it is a steering term and not a goal offset -
 *
 * Both "shove a stuck unit sideways" remedies — the speed watchdog's nudge and
 * rungs 1..N of the wedge ladder — used to work by ADDING METRES TO THE
 * FORMATION SLOT. Two things were wrong with that, and the second one is fatal
 * to the idea rather than to the implementation:
 *
 *   1. `SteeringSolver` only applied the slot inside NAV_FORMATION_ENGAGE_RADIUS
 *      (see the note where that constant used to live), so the shove did
 *      nothing at all to a unit more than 22 m from its order point. Measured
 *      by perturbing `slotZ` by SIXTY METRES on a unit 237 m out with a live
 *      field: the commanded yaw and velocity came back bit-identical.
 *
 *   2. Even with that fixed, a goal offset cannot shove anything. Moving the
 *      target point 5 m sideways at 60 m of range turns the unit by 4.8
 *      degrees, and at 120 m by 2.4. The shove has to clear a 7.7 m hull. An
 *      offset applied at the far end of a long lever is not a shove, it is a
 *      rounding error — and while a flow field is being followed the direction
 *      comes from `nav.sample()` and ignores the target point entirely, so at
 *      range it is not even that.
 *
 * So the shove is now what it always described itself as: a LATERAL STEERING
 * TERM, blended in beside separation, avoidance and the head-on sidestep, in
 * every branch and at every distance, held for as long as the detector that
 * asked for it takes to look again. The slot went back to meaning only what its
 * name says.
 *
 * NAV_NUDGE_METRES (2.6) and NAV_WEDGE_NUDGE_METRES (5.0) were deleted with the
 * mechanism they parameterised. Metres are not a parameter of a steering term,
 * and both numbers had only ever been measured against a shove that did nothing.
 */

/**
 * Weight of the unwedge shove in the steering blend.
 *
 * Sized against the terms it has to beat, not picked. The blend it joins is a
 * unit-length travel direction plus separation at 1.15 and avoidance at 1.4, and
 * a wedged unit is by definition one where those already sum to something that
 * is not working. 1.9 makes the shove the single largest term, so the resulting
 * direction is dominated by it while it lasts, without erasing the flow field —
 * a unit shoved perpendicular to a wall it is grinding on still drifts along the
 * wall rather than straight off it, which is what walks it out of an alcove
 * instead of pinning it in the corner.
 */
export const STEER_NUDGE_WEIGHT = 1.9;

/** Braking is this much stronger than acceleration. Tanks stop faster than they start. */
export const MOVE_DECEL_MUL = 1.9;

/**
 * Heading error (radians) past which a TRACKED chassis stops and rotates on
 * the spot. 40 degrees. This one number is most of what makes a tracked
 * vehicle read as tracked rather than as a hovering box.
 */
export const MOVE_TURN_IN_PLACE_ANGLE = 0.70;
/** Fraction of speed a tracked chassis loses at the in-place threshold. */
export const MOVE_TRACK_CORNER_BRAKE = 0.55;

/** Floor on a wheeled chassis' steering authority at a standstill. */
export const MOVE_WHEEL_MIN_TURN_FRAC = 0.18;
/** Fraction of speed a wheeled chassis loses in a full reversal. */
export const MOVE_WHEEL_CORNER_BRAKE = 0.45;

/** Infantry turn this much faster than their nominal rate — a free pivot. */
export const MOVE_FOOT_TURN_MUL = 2.8;

/** Hovercraft turn briskly... */
export const MOVE_HOVER_TURN_MUL = 1.5;
/** ...and slide: 0 = travels strictly along the hull, 1 = pure strafing. */
export const MOVE_HOVER_DRIFT = 0.55;

/** Ships turn slowly. */
export const MOVE_NAVAL_TURN_MUL = 0.55;
/** Radians a ship heels out of a hard turn. */
export const MOVE_NAVAL_HEEL = 0.09;
/** Radians of idle bob amplitude, and its frequency in Hz. */
export const MOVE_NAVAL_BOB = 0.028;
export const MOVE_NAVAL_BOB_HZ = 0.21;

/** Aircraft turn rate multiplier and the bank angle at a full-rate turn. */
export const MOVE_AIR_TURN_MUL = 0.9;
export const MOVE_AIR_BANK = 0.55;

/** Exponential approach rate for body pitch/roll. Higher = snappier. */
export const MOVE_TILT_LAMBDA = 9.0;
/**
 * Hard cap on body pitch/roll, radians. 26 degrees. Terrain can legally reach
 * CLIFF_SLOPE (35.5 degrees) and a hull tilted that far intersects the ground
 * at its corners.
 */
export const MOVE_MAX_TILT = 0.46;

/** Metres of travel between tread-mark decal stamps. */
export const MOVE_TREAD_SPACING = 1.6;
/** Metres of travel between dust puffs. */
export const MOVE_DUST_METRES = 1.1;
/** Metres of travel between wake segments. */
export const MOVE_WAKE_METRES = 2.2;
/** Below this speed (m/s) a unit emits no ground FX at all. */
export const MOVE_MIN_FX_SPEED = 0.35;
/** Track gauge as a fraction of the unit radius (per side). */
export const MOVE_TREAD_GAUGE_FRAC = 0.72;

/**
 * Metres an aircraft cruises above the heightfield.
 *
 * COUPLED TO `AI_BUILD.airAltitudeMetres` (6.0), which is the height at which
 * the AI decides it is looking at an aircraft. This must stay comfortably above
 * it or the AI never registers an air threat, never fires its anti-air
 * interrupt, and the whole air layer silently does nothing while looking
 * completely correct on screen. 22 against 6 is 3.7x; `tests/air-layer.spec.ts`
 * asserts the ratio, because there is no other consumer of either number to
 * catch a change to one of them.
 *
 * It is also the reason the fixed camera still reads: at the shipped pitch a
 * unit 22 m up sits about a third of a screen above its own shadow, which is
 * enough to say "that is flying" and not so much that it leaves the frame its
 * ground target is in.
 */
export const AIR_CRUISE_ALTITUDE = 22;
/**
 * Exponential approach rate for that altitude when the ground changes.
 *
 * Also the SPAWN climb: a gunship is spawned at ground level by
 * `Production.spawnUnit` (which has no business knowing about altitude) and
 * flies itself up from there. At 1.6/s it clears `airAltitudeMetres` in about
 * 0.2 s — six sim ticks — so there is no window in which a fresh aircraft reads
 * as a ground unit to anything that matters.
 */
export const AIR_CLIMB_LAMBDA = 1.6;
