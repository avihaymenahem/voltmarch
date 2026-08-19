/**
 * ============================================================================
 * P4 — IN THE CLEAR
 * ============================================================================
 * The count is home. P1 took an Allied instrument off Pact crust, P2 kept a
 * Soviet blast off a Pact reading post, P3 carried four hundred years of plates
 * three hundred metres through somebody else's concession. None of that is an
 * ARGUMENT. A reading only the Pact has ever taken is a reading nobody outside
 * the Pact has ever had to believe.
 *
 * So Calvane sinks a cut. In Pact crust, at the shallowest depth in the whole
 * count, with an Allied survey mast standing on the rise beside it — their
 * instrument, their seal, their name on the number. **The chapter's argument
 * cannot be made without conceding exactly what it is about**, and this is that
 * sentence turned into ground: to be believed you open your own crust, you hand
 * the enemy the reading, and for fourteen minutes you hold your fire on the one
 * building in the match your own doctrine most wants to shoot.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * **WHERE THE LINE STANDS.** Not what to build and not which road to take —
 * both openings are fixed and there is one road. The question the file is built
 * to ask is how far FORWARD of the collar you meet each column.
 *
 * **IT IS BOUNDED AT BOTH ENDS AND NEITHER BOUND IS THE ONE THIS BLOCK USED TO
 * NAME.** Meet them too LATE and the head dies: `civOreMine` is **700 hp** of
 * `ArmorClass.Concrete` and the fourth column takes it in **4.4 seconds**. Meet
 * them too FAR OUT and you fight without your own emplacements: the two Glaive
 * Posts stand 15.6 m in front of the head with 24 m of `glaiveRepeater`, so
 * their cover ends **39.6 m** from the collar and a line beyond it gives up
 * 34.0 dps against armour and 121.5 against the infantry half of a column.
 *
 * The bound this file used to claim in that second position — *meet them too far
 * to the flank and your own gunners take the mast* — is **measured FALSE, and
 * the chord numbers a hundred lines below said so all along.** The unit vector
 * from the collar to `ROAD` dotted with the one from the collar to the mast is
 * **-0.3707, i.e. 111.76 degrees apart**, so walking the approach walks AWAY
 * from the instrument: 80.00 m standing on the collar, 84.22 at ten metres
 * forward, 89.37 at twenty, 95.28 at thirty, 116.44 at sixty — monotonic the
 * whole way, and it could not be otherwise, since the nearest point of the
 * `ROAD -> collar` chord to the mast IS the collar (80.00 m at t = 1.00).
 * The mast is a DISCIPLINE hazard on a bearing the fight never takes, not a
 * cost of the forward line — so the shape is one decision with two real bounds
 * plus one hazard that is orthogonal to it, and it was written as a decision
 * with two bounds one of which did not exist.
 *
 * Every number below is derived from the shipped `DEFAULT_WEAPONS`,
 * `MERIDIAN_WEAPONS`, `ARMOR_MATRIX`, `COMBAT_DAMAGE` and `Targeting`, or read
 * off a headless build at this operation's seeds with the def tables BOUND and
 * the roster INSTALLED. **RE-DERIVE, DO NOT RE-QUOTE**, after any weapon retune.
 *
 * ============================================================================
 * THE MAST IS A LEGAL TARGET FOR EVERY GUN YOU OWN, AND THE MARGIN IS 9.28 m
 * ============================================================================
 * `mast` is a `radar` — **the same def key `pact-shallow-road` tags `mast` and
 * this chapter's first primary destroys** — on the ALLIED seat. So
 * `Targeting.isValidTarget` says yes to it for every Meridian hull in the match,
 * and nothing in the trigger table can say otherwise. An IDLE hull acquires on
 * SURFACE distance out to
 *
 *     envelope = max(range * APPROACH_STOP_FRAC + GUARD_LEASH, range * 1.08)
 *              = range * 0.80 + 18        for every gun under 64.3 m of reach
 *
 * and a 2x2 footprint at `CELL` 4 carries `hitRadius` `hypot(4, 4)` =
 * **5.6569 m**, so the CENTRE distance at which a parked hull starts shooting
 * the mast is `range * 0.80 + 23.657`:
 *
 *                                  R     envelope   centre bar
 *     Wayfarer    pulseCarbine     20     34.00       39.66
 *     Solarch     focusLance       26     38.80       44.46   <- the binding one
 *     Sunlancer   sunLance         26     38.80       44.46
 *     Hierarch    focusLance       26     38.80       44.46
 *     Zenith      zenithBeam       33     44.40       50.06   (unit.specialist)
 *     Sunmonitor  monitorLance     40     50.00       55.66   (needs a coast)
 *
 * **THE LOT CLEARS THE BINDING BAR BY 9.28 m AND THE MEASUREMENT IS OF EVERY
 * CELL, NOT OF THE CENTRE.** That distinction is the whole reason
 * `tests/campaign-zone-safety.spec.ts` exists — `pact.01.shallow-road` measured
 * a disc's centre, left the radius out, and shipped a hidden bonus that
 * destroyed the paying one. `LOT_R` = 28 of the collar holds **156 cells whose
 * centre is inside the disc, 149 of them open — and open to Foot, Track and
 * Hover alike, all three counts 149**, so "the lot" is one number rather than
 * three. Measured over those 149:
 *
 *     tap -> mast, centre to centre                     80.00 m
 *     nearest cell of the lot to the mast               53.74 m
 *     farthest                                         107.07 m
 *     cells inside a parked Solarch's 44.46 m bar            0
 *     margin at the nearest cell                         9.28 m
 *
 * So a hull may stand anywhere on the lot it is defending and never acquire the
 * mast. To do it, it has to leave: **7.54 m past the rim of the disc** (the
 * geometric bound, 80.00 - 44.4569 = 35.54 m from the collar against a 28 m
 * radius) or **9.28 m past the nearest open cell inside it**, which is the one
 * a player actually starts from and the reason both readings are quoted. Either
 * way it is on the mast's own bearing, which is 111.76 degrees off the bearing
 * every column arrives on. That is a hazard the player can walk into and cannot
 * be handed.
 *
 * The nearest PLAYER asset at t = 0 is a Glaive Post at **70.9 m**, against an
 * emplacement's own bar of `24 * 1.08 + 5.657` = **31.58 m** (`reachOf` returns
 * 0 for something that cannot chase), so nothing in the opening is within
 * thirty-nine metres of being able to fire on it; the nearest player HULL is a
 * Solarch at **85.9 m**, 41.4 m outside its own bar.
 *
 * **THE TWO ROWS THAT WOULD BREAK IT ARE BOTH UNREACHABLE HERE, AND THAT IS A
 * ROSTER FACT PLUS A MAP FACT.** `mrdZenith` is `unit.specialist` and
 * `roster.player` is empty, so it is refused — and even granted, its 50.06 m bar
 * still clears the nearest lot cell by 3.68 m. `mrdMonitor`'s 55.66 m does NOT,
 * and it is unbuildable: a Slipway wants a real coast, `MAP_SEAS` has no `snow`
 * row, and the built world carries **27 water cells out of 16 384**, 0.16%, none
 * of it a shoreline. That is a property of the PRESET and survives a seed change.
 *
 * ============================================================================
 * THE ENEMY CANNOT HAND YOU THE LOSS, AND THAT WAS CHECKED RATHER THAN ASSUMED
 * ============================================================================
 * A primary that ends the match on an ENEMY building's death is only fair if the
 * enemy cannot kill it themselves. `Damage.applySplash` filters on Alive,
 * PendingDestroy and Garrisoned and **halves rather than refuses** an allied
 * victim (`COMBAT_DAMAGE.friendlyFireMul` 0.5) — so Allied splash really can
 * mark their own mast. Both ungated Allied blasts, against `Concrete` at
 * `globalMul` 0.80:
 *
 *                     splash   must land within   crater damage   rounds to kill
 *     lightCannon      1.6 m       7.26 m            12.10           58
 *     rocketLauncher   2.4 m       8.06 m            21.60           33
 *
 * — every one of those rounds landing inside eight metres of the mast's centre,
 * fired by the Allies at something the player has parked on the mast's own lot.
 * `artillery` (6.5 m) has **no carrier at all**, which `Defs.ts` states in as
 * many words. The player's own `focusLance` reaches 7.06 m at FULL rate and
 * needs 27 rounds. **The mast dies to deliberate fire and to nothing else**, and
 * deliberate fire is what the 9.28 m margin above is measured against.
 *
 * ============================================================================
 * THE NUMBERS THE FIGHT IS MADE OF
 * ============================================================================
 * `ARMOR_MATRIX` rows used: ArmorPiercing vs Medium 1.00 / Light 0.85 /
 * Concrete 0.55; Rocket vs Light 0.95 / Concrete 0.90; SmallArms vs Infantry
 * 1.00 / Medium 0.28 / Concrete 0.18. Everything through `globalMul` 0.80.
 *
 * Every row is `cycle = burstCount > 1 ? (burstCount-1)*burstDelay + cooldown
 * : cooldown`, `raw = burstCount * damage / cycle`, then the matrix and
 * `globalMul` — the convention `Defs.ts` already uses, and **the one this table
 * dropped on exactly one row**:
 *
 *     Solarch    focusLance      30.0 dps vs a Warden      Warden 340 hp -> 11.3 s
 *     Warden     lightCannon     24.9 dps vs a Solarch     Solarch 330 hp -> 13.2 s
 *     Javelin    rocketLauncher  20.7 dps vs a Solarch     four of them  ->  4.0 s
 *     Glaive Post glaiveRepeater 17.0 dps vs a Warden     60.8 dps vs infantry
 *     Wayfarer   pulseCarbine    37.5 dps vs infantry     10.5 vs a Warden
 *
 * **THE WAYFARER ROW READ 15.0 / 4.2 AND WAS 2.5x LOW.** `pulseCarbine` is
 * `3 x 15 / 0.96 s` = 46.88 raw, not `15 / 0.80`; the error is exactly
 * `3 / (0.96 / 0.80)`, i.e. the burst dropped. `glaiveRepeater` one line above
 * is ALSO a burst weapon (`5 x 12 / 0.79 s`) and was computed correctly, which
 * is what made the wrong row invisible — the convention was stated, applied,
 * and then not applied once. **Re-derive this table row by row after any
 * retune; do not spot-check it.**
 *
 * **THE POSTS HOLD THE MEN AND THE HULLS HOLD THE ARMOUR, AND NEITHER SWAPS.**
 * A Glaive Post is 3.57x better against a rifleman than against a tank and a
 * Wayfarer is 3.57x better the same way — the SAME ratio, because it is the
 * same `SmallArms` row of the matrix (Infantry 1.00 / Medium 0.28) under both.
 *
 * What that does NOT mean is that the screen is nothing against armour, which
 * is what the corrected row overturns. The opening lot force is three Solarchs,
 * four Wayfarers and two Glaive Posts, and against one Warden they deliver
 * **90.0 + 42.0 + 34.0 = 166.0 dps — the screen is 25% of it, not 4%**. The
 * Solarch is the only thing that answers a Warden EFFICIENTLY, and the reason
 * is the crush column rather than the damage one: `grizzly` carries
 * `crushLevel: 3` against `mrdWayfarer`'s `crushableBy: 1`, so a Warden that
 * closes deletes the screen by driving over it, and `mrdSolarch`'s
 * `crushableBy: 5` is out of its reach entirely. Each column arrives as two
 * bodies for exactly that reason — see the wave table.
 *
 * Against the 700 hp head, which is what all of it is for:
 *
 *     3 Wardens                  48.4 dps    14.5 s
 *     4 Wardens                  64.5        10.9
 *     4 Javelins                 78.6         8.9   <- Rocket 0.90 beats AP 0.55
 *     5 Wardens                  80.7         8.7
 *     wave four, all nine       159.3         4.4
 *     4 G.I.s                    30.2        23.2
 *
 * **THE JAVELIN IS THE ALLIED ANSWER TO THE HEAD, NOT THE WARDEN**, and it is
 * the slow half of the column. That is the operation's whole tempo: the armour
 * arrives first and has to be answered, and then the thing that actually breaks
 * the drill walks up twenty seconds later while you are still reloading.
 *
 * ============================================================================
 * THE ROAD IS MEASURED, AND EVERY WAVE ARRIVES IN TWO PARTS
 * ============================================================================
 * Dijkstra over the REAL `FlowFieldCache.costGridFor(MoveClass.Track)` — so
 * `rebuildCost` itself rather than a mirror of it — 8-connected, edge weight
 * `step * (cost[a] + cost[b]) / 2 / COST_UNIT`, endpoints snapped to the nearest
 * open cell because both ends are occupied by their own footprints:
 *
 *                            path      straight   detour
 *     ROAD -> the collar    110.9 m     96.0 m    +15.4%
 *     home -> the collar    159.8 m    139.3 m    +14.7%
 *     camp -> the collar    129.8 m    120.0 m     +8.2%
 *     the collar -> mast    164.7 m     80.0 m   +105.9%
 *
 * **THE FIRST THREE READ 116.3 / 166.5 / 141.0 UNTIL THEY WERE RE-RUN**, which
 * is a 5 to 11 m overstatement on every route the operation is paced by. The
 * straight-line column reproduced exactly both times; only the walk moved.
 *
 * The fourth row is the one nobody has to walk: the ground between the collar
 * and the mast drops to -7.0 m at 48 m and comes back to +0.1 at 72 m, and that
 * basin is impassable, so the mast is **164.7 m of Track path from a lot that
 * is 80.00 m from it in a straight line**. A hull sent to shoot the instrument
 * takes twenty-two seconds to get there, which is the third thing after the
 * 111.76-degree bearing and the 9.28 m margin that keeps this hazard a decision.
 *
 * **BOTH MOVE CLASSES WALK THE SAME LENGTHS HERE** — Track and Foot agree to
 * 0.1 m on all three approach rows — because a headless build has no road, and
 * the road is the only thing that separates the two cost grids on this ground.
 *
 * At the shipped speeds, from the moment a wave lands at `ROAD`:
 *
 *     Warden   6.6 m/s   16.8 s      Javelin  3.0 m/s   37.0 s
 *     G.I.     3.2 m/s   34.7 s      Solarch  7.6 m/s   21.0 s from home
 *
 * **NO HEADLESS BUILD HAS A ROAD ON IT.** `roads.system.ts` builds the network
 * in `init()`, at `Phase.Command` order 60, DURING `bootstrap()` — so
 * `getRoads()` is null inside `buildScenario` and `rebuildCost` skips its road
 * branch entirely. `NAV_COST_ROAD` is 0.88 for Foot against 1.0 for Track, so a
 * real match's carriageway shortens the INFANTRY half of each column and not the
 * armour half. The three figures above are therefore upper bounds on the men and
 * exact on the tanks, which pushes the two halves of a wave slightly closer
 * together than the table says. That is the direction that makes the operation
 * harder, so it is recorded rather than corrected.
 *
 * ============================================================================
 * THE HIDDEN SECONDARY IS THE PACT'S OWN DOCTRINE, PRICED
 * ============================================================================
 * *"The Pact main line. Outranges, never brawls."* — `mrdSolarch`'s shipped
 * blurb. `stand` pays 400 credits for making that literally true: no Allied unit
 * may enter `LOT_R` = 28 m of the collar, once the first column is on the board.
 *
 * **IT TURNS ON WHAT THE COLUMN ACQUIRES, AND BOTH ANSWERS ARE COMPUTED.**
 * `Targeting.approach` parks an attacker at `range * 0.80` of SURFACE distance
 * from whatever it is shooting:
 *
 *     a Warden that acquires the HEAD (2x2, hitRadius 5.657)
 *         parks at 19.2 + 5.657 = 24.86 m of centre -> 3.14 m INSIDE the lot
 *     a Warden that acquires a SOLARCH standing on the lot edge (radius 2.790)
 *         parks at 19.2 + 2.790 = 21.99 m beyond it -> 50.0 m out, 22 m CLEAR
 *
 * — and a Solarch on that edge engages a Warden out to `26 + 2.790` = 28.79 m of
 * centre, i.e. **56.8 m from the collar**, which is 6.8 m further out than the
 * Warden ever gets. So a line held ON the edge wins the geometry outright, and
 * the bonus is lost only by letting a column pick the structure instead of the
 * screen. It is not free: three Solarchs put 90 dps into a 1020 hp column across
 * the 4.4 s it needs to cross from 56.8 m to the lot edge, which is 1.16 Wardens
 * of the three. **The bonus is bought by meeting them further out than that**,
 * and what that costs is measured against the POSTS and the HEAD:
 *
 *   - the two Glaive Posts stand 15.6 m in front of the head with 24 m of
 *     reach, so a line met beyond **39.6 m** of the collar fights without the
 *     34.0 dps the pair contributes against armour and their 121.5 against the
 *     infantry half;
 *   - and a column that slips a hull past a line standing that far out meets
 *     700 hp of Concrete with nothing in front of it.
 *
 * **IT DOES NOT COST YOU THE MAST, AND AN EARLIER DRAFT OF THIS FILE SAID IT
 * DID.** `tap -> ROAD` and `tap -> mast` are 111.76 degrees apart, so every
 * metre forward is a metre FURTHER from the instrument (80.00 -> 84.22 at ten,
 * 116.44 at sixty). The two hazards do not interact at all; see the decision
 * block at the top of this file, which now says so.
 *
 * **IT IS GATED ON THE FIRST WAVE FOR `pact.03`'s REASON.** `t.standLost` would
 * otherwise fire on any Allied scout that wandered across the lot at minute one,
 * while `stand` was still hidden — and `Session.setObjective` refuses to
 * un-resolve, so the later reveal would be a no-op and the panel would carry a
 * failed row for a bonus nobody had mentioned. That is `pact.03`'s `t.short`
 * trap verbatim. The cost is that a wanderer at 2:59 is free, and it is stated
 * rather than hidden.
 *
 * ============================================================================
 * WHAT THE ROSTER WITHHOLDS, MEASURED IN BOTH DIRECTIONS
 * ============================================================================
 * `{ player: [], ai: [] }` is an ALLOW-LIST, so it withholds every tagged def
 * from both seats. Built twice at these seeds, rostered against an unrostered
 * control, **240 entities alive against 248** and the eight are:
 *
 *     seat 0   mrdReliquary x1   mrdHelios x1   mrdSkiff x2
 *     seat 1   battleLab    x1   prismTower x1  ifv      x2
 *
 * Three of those are load-bearing and the symmetry is the point.
 * **`prismTower` is the Refractor Tower `pact.01.shallow-road` GRANTED the
 * Allies** (`roster.ai: ['struct.defence.specialist']`, to put 34 m of reach on
 * the one gap in the cut) and this operation takes back: nothing the Allies
 * field here out-ranges the Pact's 26 m lance, which is what makes the forward
 * line above a defensible plan rather than a suicide. **`mrdHelios` is the same
 * id read from the other side** — the Pact defends this lot at the range its
 * HULLS fight at, not from behind a 33 m spire, and a spire is also the one
 * emplacement whose own bar (`33 * 1.08 + 5.657` = **41.3 m**) could be walked
 * toward the mast by a player siting it badly. And `mrdSkiff` / `ifv` is
 * `unit.raider` on both seats, refused symmetrically, which is the pair
 * `pact.03.concession` withholds for its own reason and this one inherits.
 *
 * `tests/campaign-roster-ground.spec.ts` is what makes that paragraph a
 * measurement: it builds every operation twice and requires the roster to remove
 * something.
 *
 * ============================================================================
 * WHY THE MAST DOES NOT WATCH THE LOT, WHICH IS A FINDING RATHER THAN A CHOICE
 * ============================================================================
 * `radar` carries **`sight: 44`**, and the bar at which a Pact hull opens fire
 * on a 2x2 is **44.46 m of centre distance**. Those two numbers are the same to
 * within half a metre, and they point in opposite directions: **an Allied
 * instrument close enough to watch the Pact work is inside the envelope of
 * everything the Pact parks there.** There is no radius at which it does both.
 *
 * So it is sited at 80.0 m and it watches the APPROACH rather than the collar —
 * its sight edge stops **36.0 m short of the tap**. What that buys the Allied
 * brain is real rather than decorative: `AiBrain.observe` is vision-gated on
 * `world.vision.canSee`, so anything the player moves onto the rise is recorded
 * as a remembered target. What it buys at t = 0 is nothing, and that is measured
 * — the nearest player asset to it is 70.9 m away, well outside 44.
 *
 * **THE MAST IS ALSO OFF BOTH ROADS, AND BOTH WERE MEASURED RATHER THAN
 * ASSUMED.** Its closest approach to the chord `ROAD -> collar` is **80.0 m at
 * t = 1.00** and to the chord `home -> collar` is **79.9 m at t = 0.98** — in
 * both cases the nearest point of the route is the collar itself. Neither the
 * enemy's approach nor the player's own supply road passes nearer to the mast
 * than the lot does. Everything that reaches it is a decision somebody made.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS, AND `t.tapLost` IS GUARDED
 * ============================================================================
 * `annihilationWin` would hand the player a victory for flattening the Allied
 * base at minute six while the cut had eight minutes left to run — and, worse,
 * one for a match in which the mast had already been shot, since `Viability`
 * counts assets and knows nothing about which building this operation is named
 * after. `assetLossDefeat` is off for `pact.01`'s reason: the player opens with a
 * full base and could not plausibly hit zero assets before `t.lose` reads, and a
 * rule that can only end a scripted match by accident should not be armed.
 *
 * **`t.tapLost` CARRIES `not objectiveComplete 'depth'` AND THAT IS A GUARD ON
 * THE WHOLE TRIGGER, NOT ON THE DIALOGUE.** `pact.01.shallow-road` records the
 * opposite case — its `not objectiveComplete 'bore'` exists because
 * `Session.setObjective` already refuses to un-resolve, so only the LINE needed
 * guarding. Here the effect being suppressed is `endOperation`, which no setter
 * refuses. The head matters until it reaches depth and not one tick after: a
 * rule that took the match away for losing a spent drill during the mop-up would
 * be a defeat the player had no way to act on.
 *
 * ============================================================================
 * THE PAR, AND WHY THE FLOOR IS NOT THE PAR
 * ============================================================================
 * `DRILL` is fourteen minutes and it is an absolute clock, so **840 s is a hard
 * floor** on this operation and no play makes it shorter. The win needs one more
 * thing: `LOT_R` clear of Allied units, which is why `parSec` is 960 rather than
 * 850. The fourth column lands at 13:00, its armour is on the collar at 13:16.8
 * and its infantry at 13:37.0, so **the lot is contested across the fourteenth
 * minute by construction** and the realistic finish is 14:30 to 15:30. A player
 * who has already levelled the camp gets no fourth column at all and can finish
 * at 14:00 exactly — that is what the 500 credits buy, and it is the reason the
 * secondary has teeth beyond its payout.
 *
 * The chapter runs 780 / 840 / 900 / 960, which is the ramp
 * `tests/campaign-length.spec.ts` checks for monotonicity.
 *
 * ============================================================================
 * THE WIN IS HELD OPEN WHILE THEY STAND ON THE COLLAR, AND THAT IS UNBOUNDED
 * ============================================================================
 * Drive `runDirector` over every combination of the five facts this table reads
 * — `tap` alive, `mast` alive, `camp` alive, an Allied unit inside `LOT_R`,
 * `playerBeaten` — and 30 of the 32 terminate:
 *
 *     mast dead                                    16   loss, 'reading'
 *     mast alive, tap dead                          8   loss, 'depth'
 *     mast alive, tap alive, beaten                 4   loss, 'depth'
 *     mast alive, tap alive, lot CLEAR              2   win at DRILL + 1 tick
 *     mast alive, tap alive, lot OCCUPIED           2   NOTHING
 *
 * **THE LAST ROW IS DELIBERATE AND IT IS THE OPERATION'S PREMISE**, not an
 * oversight: Aubray's own line at depth is *"stand off the lot and let me take
 * the second pass clean"*, and a win that fired anyway would be the Allies
 * reading an instrument with a Warden parked on the hole. There is no timeout in
 * either direction, and both were considered:
 *
 *   - a TIMEOUT WIN hands the match to a player who is being overrun at the one
 *     moment the operation is about — it converts a losing position into a
 *     victory on the clock, which is worse than a long tail;
 *   - a TIMEOUT LOSS takes it away from a player who is winning slowly, and
 *     `DRILL` is already an absolute clock, so the operation has no room for a
 *     second one.
 *
 * **THE STATE IS ALWAYS ACTIONABLE, WHICH IS THE PROPERTY THAT MATTERS.**
 * `Viability.isBeaten` is `!canRebuild && !canContest`, so a player for whom
 * `t.lose` has NOT fired owns either a producer or a field unit that is not a
 * harvester — i.e. a means to clear the collar — and the intruder is on their
 * own ground, in their own vision, on a lot their opening army is already
 * standing on. Two ways the tail could become unactionable were checked on the
 * built world and both are closed. **There is no ore inside the lot**: this map
 * carries three declared fields — r 30 at 418,335, r 30 at 94,177 and the
 * contested r 22 on the centroid at 256,256 — and the nearest edge of any of
 * them is **12.10 m outside the rim**, so the economy parks no enemy harvester
 * on the collar. **And nothing on the lot can be garrisoned**: the only
 * structures within 60 m of it are the head itself and the two Glaive Posts, all
 * three on seat 0, and `GarrisonService.refusalFor` answers 'hostile' for a
 * non-neutral owner that is not allied.
 *
 * The one residual is the engine-wide dead end CLAUDE.md already documents: a
 * player reduced to a lone refinery is `stranded` rather than `beaten`, can
 * build only harvesters, and can therefore neither clear the collar nor be given
 * the loss. That is `OreCrisis`'s shape and not this operation's, and the fix
 * for it is never a change to `isBeaten`.
 *
 * ============================================================================
 * NO `eva` EXCEPT ONE, AND THE OPENING IS PACED FOR READING RATHER THAN MERGING
 * ============================================================================
 * The announcer's vocabulary is 33 fixed ids and not one of them means "a
 * column has left the camp" or "the cut is at depth". `reinforcements` means the
 * PLAYER's own and would be a lie on an enemy wave; `forcesUnderAttack` is
 * spoken organically by `audio.system.ts` on any attack on player units and
 * carries a 30 s cooldown, which `pact.03.concession` measured swallowing its
 * own scripted copy. So this file scripts exactly one, on `t.mastLost`:
 * `structureLost` is literally true, it is the most consequential structure loss
 * the match can produce, and it is NOT redundant because `audio.system.ts`
 * speaks that line only for LOCAL buildings and the mast is on seat 1.
 *
 * **THE TWELVE-SECOND SPACING OF THE OPENING IS A LEGIBILITY ARGUMENT, AND AN
 * EARLIER DRAFT OF THIS FILE ARGUED IT FROM A DEFECT THAT IS FIXED.** That
 * draft said `Shell.playCampaignBeat` keys its toast `campaign-${speaker}` and
 * that `ToastStack.push` therefore COALESCES two lines from one voice inside
 * `TOAST_MERGE` = 6.0 s, destroying the first. **The shipped call keys
 * `campaign-${speaker}-${this.campaignBeatSeq}` with a monotonic counter that is
 * never reused**, under a comment saying in as many words that no two beats can
 * merge. So the hazard does not exist, `pact.03.concession` LOST its opening
 * sentence to it in the past tense and does not now, and nothing in this file
 * needs to avoid a second line from one speaker: the modal win path puts two
 * Calvane lines one tick apart (`t.depth` then `t.win`) on EVERY clean run, and
 * both chips appear.
 *
 * What survives is `TOAST_MAX` = 5, which retires the OLDEST chip when a sixth
 * arrives — a pacing problem an author can see rather than a silent deletion.
 * This operation's busiest tick pushes two lines, so it never approaches it.
 * The three opening beats are twelve seconds apart because three paragraphs
 * stacked on adjacent ticks are three paragraphs nobody reads, which is a
 * judgement about the player and is stated as one.
 *
 * ============================================================================
 * THE MEASURED POINTS, AT `mapSeed` 41 602 / `simSeed` 3 489
 * ============================================================================
 * Read off a headless build AFTER `spawnBuilding` snapped every footprint, with
 * the def tables BOUND and the roster INSTALLED — which is
 * `tests/campaign-roster-ground.spec.ts`'s build and NOT
 * `tests/campaign-maps.spec.ts`'s, whose `buildOperation` passes no `defs` and
 * never calls `setCampaignRoster`, so every refusal counted above is inert there.
 *
 *     home 404, 380      foe 108, 132      axis 386.2      seated pair [0, 3]
 *     tap  316, 272      mast 380, 224     camp 220, 200   ROAD 234, 222
 *
 *     home -> tap 139.3     foe -> tap 250.7     tap -> mast  80.00
 *     tap -> camp 120.0     foe -> camp 131.0    mast -> camp 161.8
 *     ROAD -> tap  96.0     ROAD -> camp  26.1   ROAD -> mast 146.0
 *
 * Every figure in that block re-measured to the digit on the fix pass; the
 * numbers that MOVED are the walked ones, in the road block above, and they
 * moved because they had been wrong rather than because the ground had.
 *
 * `ROAD` is the only one of these that is not a structure, and it was SEARCHED
 * rather than chosen — twenty candidates along the axis, scored on whether every
 * ring point of all four waves is open. See the `mapSeed` note.
 *
 * **RE-MEASURE IF EITHER SEED MOVES.** Nothing fails loudly if these drift: the
 * lot disc stops covering the collar, the hidden secondary becomes trivial or
 * impossible, and the operation is still winnable, so no test and no player
 * reports it. `tests/campaign-spawn-ground.spec.ts` is the one exception — it
 * re-derives every ring point of all four waves and fails by name if a drop
 * lands on ground the wave's own locomotor cannot enter.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';

/* -- the measured points -------------------------------------------------- */

/**
 * The Pact tap, as PLACED. Every disc in this file is drawn on it.
 *
 * A `civOreMine` on the PLAYER's seat: 700 hp, `ArmorClass.Concrete`, 2x2, and
 * the same key `pact.01.shallow-road` tags `bore` on the Allied seat. Its
 * shipped blurb reads *"Pays its owner while it is held"* and that is FLAVOUR —
 * grep finds no reader of it anywhere under `src/sim/`, so it pays nothing, and
 * `FALLBACK_BUILDINGS.civilian` clears `EntityFlag.Sellable`, so the player
 * cannot dispose of the thing they are defending either.
 */
const TAP = { x: 316, z: 272 };

/**
 * Where every Allied column forms up. 96.0 m of straight line and 110.9 m of
 * real Track path from the collar, 26.1 m from the camp it comes out of.
 *
 * SEARCHED, NOT CHOSEN. `ProductionService.spawnUnit` writes the ring point
 * VERBATIM — no `connectedGround`, no egress search — so the points that have to
 * be standable are the ring points themselves. The seven `spawnUnits` effects
 * below author **28 drops across 20 distinct points** — waves B and C use the
 * same two rings, (4, 16) and (4, 24), so eight of the drops land on points
 * another wave has already used — and all 28 are open to the locomotor of the
 * unit that lands on them.
 *
 * **THIS SAID "ALL SEVENTEEN OF THEM" AND SEVENTEEN IS NEITHER NUMBER.** The
 * property was true and the count was not, which made the seed survey below
 * unauditable: nobody could reproduce a figure of 17 from the table.
 */
const ROAD = { x: 234, z: 222 };

/**
 * The Allied survey mast, as PLACED. Nothing counts units near it and no disc
 * is drawn on it — it is here so `t.open` can reveal the rise it stands on, and
 * so that the one number this operation turns on has a name.
 *
 * 80.00 m from the collar, 79.9 m off the player's own supply road at its
 * nearest, 80.0 m off the enemy's approach at its nearest, and in both cases
 * the nearest point of the route is the collar itself.
 */
const MAST = { x: 380, z: 224 };

/**
 * The lot: the disc no Allied hull may enter for the hidden secondary, and the
 * disc that has to be clear before the Allies will read the instrument.
 *
 * ONE RADIUS DOING TWO JOBS, AND THAT IS DELIBERATE. The bonus and the win are
 * the same question at two moments — is the enemy standing on the hole — so a
 * second number would be a second thing to keep in step. 28 m is set by the
 * geometry in the header: it contains a Warden that parks on the head (24.86 m)
 * and excludes one that parks on a Solarch holding its edge (50.0 m).
 *
 * **IT IS ALSO PAIRED WITH `TAP_OFFSET` = 26 IN `pact-in-the-clear.ts`, AND THE
 * TWO CONSTANTS LIVE IN DIFFERENT FILES.** The layout stands the collar 26 m off
 * the opening-to-opening axis, so 28 > 26 and the axis cuts the disc across a
 * chord of `2 * sqrt(28^2 - 26^2)` = **20.78 m**: anything walking the straight
 * line between the two bases is inside the lot, and the hidden secondary cannot
 * be won by standing aside and letting them through. Move either number and the
 * chord closes — at `TAP_OFFSET` >= 28 the axis misses the disc entirely and
 * `stand` stops asking anything. The layout header states the same pair from its
 * side; if you change one, change both notes.
 */
const LOT_R = 28;

/** Fourteen minutes of cutting. An absolute clock and the operation's floor. */
const DRILL = minutes(14);

/**
 * The four columns.
 *
 * Three minutes of quiet first — long enough to walk the base garrison the
 * 159.8 m up to the collar (21.0 s for a Solarch, 42.1 s for a Wayfarer) and to
 * put a producer or a pair of posts on the lot out of the opening bank — then
 * gaps of 3:30, 3:30 and 3:00. The last one lands sixty seconds before depth on
 * purpose; see the par block in the header.
 */
const WAVE_A = minutes(3);
const WAVE_B = seconds(390);
const WAVE_C = minutes(10);
const WAVE_D = minutes(13);

/**
 * How long the layout is given to have placed the ground before any ownership
 * threshold over it is believed.
 *
 * `ownerCount(1, 'building', 'camp', max: 0)` READS TRUE AGAINST AN EMPTY TAG
 * REGISTRY, exactly as `entityDead` does — the spelling changes and the trap
 * does not. `soviets.06.demolition-order` guards its own primary the same way
 * and this is its constant.
 *
 * **IT IS DEFENCE AGAINST A LAYOUT THAT PLACED NOTHING, NOT AGAINST A TICK-ONE
 * READ THAT HAPPENS TODAY.** `scenarios.system.ts` builds the world inside
 * `async init()` and `SystemRegistry.init` awaits every module's init in
 * sequence before a tick is taken, so the registry is never empty when the
 * Director first runs. What IS reachable is a wrong def key or a footprint that
 * will not fit, and there twenty seconds is the difference between a secondary
 * that resolves before the camera settles and one that at least lets the player
 * see the ground it is lying about. `tests/campaign-roster-ground.spec.ts` is
 * the gate that catches the cause.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The forward camp is off the Allies' books — levelled or taken.
 *
 * **`entityDead` COULD NOT SEE A CAPTURE AND THAT WAS TWO WRONG ANSWERS AT
 * ONCE.** `camp` is an ALLIED `barracks` and the player opens with an
 * `mrdArtificer` and both its prereqs standing, so taking it is a real play —
 * four Artificers at two thousand credits, since an engineer arriving above
 * `CAPTURE.captureHpFrac` is spent SOFTENING and the soften lands 20% of max
 * (`maxHp * softenFrac` 0.25 through `ARMOR_MATRIX[HighExplosive][Concrete]`
 * 1.00 and `COMBAT_DAMAGE.globalMul` 0.80). A captured barracks is still ALIVE,
 * so before this pair:
 *
 *   - `t.camp` never completed, and the five-hundred-credit secondary was lost
 *     for taking the camp off them more thoroughly than levelling it does;
 *   - `t.fourth` still fired at minute thirteen and **spawned nine Allied hulls
 *     off a building the player owned**.
 *
 * The second is the one that makes this a defect rather than a wording problem.
 * `soviets.06` made the same migration for the same reason, and
 * `pact.02.long-count`'s `staging` is this defect's twin down to the wave.
 *
 * Defined as ONE object each because the two triggers must partition every
 * world state between them; two copies of a threshold is how two triggers come
 * to disagree about one world.
 */
const CAMP_OFF: Condition = {
  on: 'all',
  of: [SETTLE, { on: 'ownerCount', player: 1, role: 'building', tag: 'camp', max: 0 }],
};

/** The Allies still hold the forward camp. The exact complement of `CAMP_OFF`. */
const CAMP_HELD: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'camp', min: 1,
};

const op: OperationDef = {
  id: 'pact.04.in-the-clear',
  chapter: 'pact',
  faction: Faction.Meridian,
  /*
   * THE ALLIES, AND THE CHAPTER HAS BEEN POINTING AT THEM SINCE P1.
   *
   * `pact.01.shallow-road`'s own foe block says it out loud: of the four armies
   * the Allies are *"the only one that would change its mind if shown the
   * numbers"*, and that is why P1 fought them rather than anybody else. P2 fought
   * the army that WORKS this ground and P3 the army that BUYS it; neither can be
   * argued with. This is the return, and it is the only foe for whom the premise
   * — hand them the instrument and let them take the reading themselves — is a
   * plot rather than a suicide.
   *
   * It is also the army whose own chapter is called "The Timetable", which is
   * the thing a shallow reading breaks. Aubray sends the mast; her line command
   * sends the columns; both are Allied, and the operation is what happens when
   * one army disagrees with itself.
   *
   * MECHANICALLY IT PINS THREE THINGS. All four waves spawn `grizzly`, `gi` and
   * `javelin` — authored ALLIED hulls, literal and unremapped, which
   * `validateCampaign` checks against this field. The layout's `radar` resolves
   * to the Radar Dome whose 700 hp and 44 m of sight the header is written
   * about; on a Meridian seat the same key is an Oculus and on a Reclamation
   * seat a Spotter. And `pillbox` resolves to the Allied Pillbox, 22 m of
   * `pillboxMg` with no splash, which is what keeps the camp answerable by the
   * 26 m lance the roster leaves the player.
   */
  foe: Faction.Allies,
  index: 4,
  title: 'In the Clear',
  beat: 'A cut in Pact crust, sunk by the Pact, and an Allied instrument standing over it to '
    + 'say so.',
  primaryType: 'defend',
  // Objective state, two reveals, a camera move, four waves and four orders — so
  // 'bespoke' by the definition in `types.ts`. The label is about MECHANISM:
  // what makes this operation what it is is 80.00 m of ground between a hole and
  // a witness, and that ground exists before tick one.
  archetype: 'bespoke',
  parSec: 960,
  requires: ['pact.03.concession'],

  map: {
    preset: 'snow',
    /*
     * Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
     * fingerprint. CHOSEN BY SURVEY: nine rolls were built headless at this
     * `simSeed` and read against four criteria — the placed tap-to-mast gap
     * inside the [74, 88] m band the acquisition arithmetic sets, a `ROAD`
     * point around 95 m from the collar with EVERY ring point of all four waves
     * open on both move classes, the lot as nearly fully open as the terrace
     * faces allow, and one Foot region containing all five composition points.
     *
     * `lot cells` counts cells whose CENTRE falls inside `LOT_R` = 28 of the
     * placed collar; the disc holds 156 of them on this roll, and the open count
     * is the same 149 for Foot, Track and Hover.
     *
     *     seed    tapMast   lot cells   clean ROAD at 0.60 along
     *     41 602    80.00      149 / 156        YES
     *     41 603    80.00      134             no
     *     12 907    84.44      113             no
     *     33 511    81.02      133             no
     *     51 040    81.02      149             no
     *     20 118    80.00      132             no
     *     60 223    79.40      139             no
     *      7 741    77.72      125             no
     *     27 016    91.35      131             outside the band anyway
     *
     * 41 602 is the only roll where the drop point lands **all 28 drops, at 20
     * distinct ring points**, on open ground, and it ties for the most open lot.
     * It wins on every criterion rather than on one, which is the only kind of
     * survey worth writing down. (This read "all seventeen ring points" and
     * "149 / 154", against a real 28 / 20 / 156. The criterion the survey turned
     * on was right; two of the three numbers describing it were not.)
     */
    mapSeed: 41_602,
    /*
     * The PAIR is chosen by this seed and not by the map roll. `seatedSlots`
     * filters `START_PAIRS` against the water, and `snow` has no `MAP_SEAS` row,
     * so all four survive; 3 489 draws the DIAGONAL at **386.2 m** — the longest
     * opening this game produces — where 3 487, 3 501 and 3 512 all draw a
     * 296.0 m edge pair. The diagonal is what puts the lot 139.3 m in front of
     * the player and 250.7 m in front of the Allies: far enough forward that
     * defending it is a decision, far enough from the enemy that the columns are
     * an event rather than a constant.
     */
    simSeed: 3_489,
    armies: 2,
    /*
     * `snow` IS THE ONE NAME THAT MEANS THE SAME THING IN BOTH VOCABULARIES.
     *
     * `MAP_PRESETS` is keyed `temperate | arid | tropical | snow | coast | urban
     * | archipelago` and `BiomeName` is `temperate | desert | snow | urban`; they
     * overlap on three and disagree on exactly one, and the one they disagree on
     * is `arid`/`desert` — which `reclamation.03.sold-twice` shipped wrong, with
     * every number in its headers taken on ground it did not declare. This pair
     * is safe and it is still spelled out here, because the safety is an
     * accident of which word this preset uses and not a property anybody can
     * rely on for the next operation.
     *
     * Measured on the ground this pair actually builds: 12 018 of 16 384 cells
     * are foot-passable (73.4%), 4 366 are closed (26.6%), 27 are water (0.16%),
     * and 12 018 + 4 366 = 16 384 — a census whose rows do not sum to
     * `MAP_CELL_COUNT` is wrong on its face, which `pact-concession.ts` records
     * paying for. 306 cells are hover-passable and not foot-passable.
     */
    biome: 'snow',
    opening: 'base',
    /*
     * BOTH SEATS. `Shell.applySimPostBoot` writes `setup.startingCredits` into
     * every non-Neutral slot, so this is one number doing two jobs.
     *
     * It buys the player six Solarchs with change (800 each), or four of them
     * and four more Glaive Posts (450 each) to exactly 5 000, which is the real
     * decision the bank asks — armour that can meet a column at 56.8 m, or posts
     * that hold the lot while the armour is somewhere else. And it slows the
     * Allied opening for the reason CLAUDE.md's measured block gives: a brain
     * with a 10 000 bank raises a seven-building base and eleven troops before it
     * has mined a single ore.
     *
     * IT IS A PLATEAU AND NOT A RISE. The chapter runs 4 000 / 5 000 / 5 000 /
     * 5 000; what escalates here is the clock and the columns, not the purse.
     */
    credits: 5_000,
  },
  layout: 'pact-in-the-clear',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY ON BOTH SIDES. The header's roster block has the measurement — eight
   * entities removed, 240 against 248, and the two that matter are the Refractor
   * Tower `pact.01.shallow-road` granted the Allies and the Helios Spire the
   * player would otherwise open with. Both lists being empty is SYMMETRIC and
   * profile-independent: the ground is the same on a finished account as on a
   * fresh one, which a deny-list could not promise.
   */
  roster: { player: [], ai: [] },

  /*
   * THE MAST CANNOT BE WALKED INTO. See `t.mastLost`, whose comment used to end
   * "Documented, not closed."
   *
   * ONE TAG, NOT `'all'`, AND THE OMISSION IS DELIBERATE IN BOTH DIRECTIONS.
   * `camp` must stay capturable: `CAMP_OFF` is an `ownerCount` threshold, so an
   * Artificer answers the secondary exactly as a shell does. `tap` is the
   * player's own `civOreMine` and no veto reaches it anyway — `resolve` takes
   * the FRIENDLY branch for an allied structure, ahead of the veto list.
   */
  captureProof: ['mast'],

  objectives: [
    {
      id: 'depth',
      kind: 'primary',
      title: 'Hold the cut until it reaches the depth the count names',
    },
    {
      /*
       * THE TITLE CARRIES THE PROHIBITION, BECAUSE THE CHAPTER SPENT AN
       * OPERATION TRAINING THE OPPOSITE HABIT.
       *
       * This read *"Let the Allies take the reading off their own instrument"*,
       * which states neither what completes the row (`t.win`) nor what fails it
       * (`t.mastLost`, an instant loss). And two operations earlier
       * `pact.01.shallow-road` carries `{ id: 'mast', … title: 'Destroy the
       * Allied instrument mast' }` — the SAME `radar` key, the SAME `mast` tag,
       * on the SAME Allied seat. So the player has already been paid for
       * killing this building once.
       *
       * The cost of the wrong right-click is measured. The mast is 700 hp of
       * `ArmorClass.Concrete`; `focusLance` delivers 16.5 dps into that and
       * `pulseCarbine` 6.75, so the seven hulls standing on the lot at t = 0
       * (three Solarchs, four Wayfarers) kill it in **9.2 s of fire** and the
       * whole opening army in **4.0 s**. What buys the player a moment to
       * reconsider is the ground rather than the armour: the mast is 164.7 m of
       * Track path from the collar, so the order is a twenty-two-second drive
       * before the first round. Nael's brief at sixteen seconds now names the
       * consequence too, but a line that scrolls is not a standing order — the
       * panel is. `pact.02.long-count`'s "Leave the reading post standing" and
       * `allies.04.misclosure`'s "Keep the reduction office standing…" are the
       * shape this follows.
       */
      id: 'reading',
      kind: 'primary',
      title: 'Leave the Allied instrument standing and let them take the reading',
    },
    {
      id: 'camp',
      kind: 'secondary',
      // "Take off them" rather than "Level", because `CAMP_OFF` counts a
      // capture exactly as it counts a demolition and the title has to mean
      // what the trigger tests. `soviets.06.demolition-order` renamed its own
      // objective for the same reason on the same migration.
      title: 'Take the Allied forward camp off them',
      credits: 500,
    },
    {
      /*
       * NO DIGITS, AND THE RADIUS IS `LOT_R`'s TO OWN.
       *
       * `tests/build-descriptions.spec.ts` §4 bans numerals in
       * `BUILD_DESCRIPTIONS` and does NOT reach objective titles, so nothing in
       * the suite would fail if one were written here. The convention is
       * honoured anyway: a second copy of a measured number in prose is exactly
       * the drift this file spends four hundred lines refusing.
       */
      id: 'stand',
      kind: 'secondary',
      hidden: true,
      title: 'Break every column short of the lot',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the opening word -------------------------------------------------
     * THREE BEATS, ONE SPEAKER EACH, TWELVE SECONDS APART, AND THE SPACING IS
     * FOR READING RATHER THAN AGAINST A MERGE. See the toast block in the
     * header: `Shell.campaignBeatSeq` gives every beat its own key, so nothing
     * here would be destroyed by landing on one tick — three paragraphs on
     * adjacent ticks would simply be three paragraphs nobody reads. Calvane
     * states why the hole exists, Nael states the ground, the discipline and
     * what happens if the mast is shot, Aubray states who is on the other end
     * and why there are columns coming from an army that sent the instrument.
     *
     * The two reveals are `allies.01.sounding-line`'s shape: the whole problem
     * before any of it is a problem. 56 m on the collar covers both Glaive Posts
     * (22.1 m each) and the lot; 40 m on the mast covers the rise it stands on.
     * `revealArea` EXPLORES ground rather than showing live units — `Vision
     * .levelAt` returns `Remembered` for `isStaticKind` only — so it shows the
     * mast and the posts and none of the Allied infantry.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Survey 41-602. Four hundred years of readings and not one of them taken by '
            + 'anybody but us, which is exactly why nobody has ever had to believe them. So '
            + 'today we cut our own crust, at the shallowest depth in the whole count, and we '
            + 'let somebody else hold the instrument.',
        },
        { do: 'revealArea', player: 0, area: { x: TAP.x, z: TAP.z, r: 56 } },
        { do: 'revealArea', player: 0, area: { x: MAST.x, z: MAST.z, r: 40 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Two posts on the lot and their mast eighty metres out on the rise. Our lance '
            + 'reaches twenty-six and our gunners take a standing thing at forty-four, so the '
            + 'lot is safe and the ground between is not. And nobody fires on that mast. Put '
            + 'one round in it and the count dies with it and we go home — break them short of '
            + 'the collar and the line never drifts that far.',
        },
      ],
    },
    {
      id: 't.flag',
      when: { on: 'elapsed', ticks: seconds(28) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray, on an open channel',
          text: 'Aubray, Continental Works. Open channel, because a reading nobody else can '
            + 'hear is not a reading. My instrument, my seal, and my name on whatever number '
            + 'your hole gives me. I am also told a column left our line an hour ago, and it '
            + 'was not sent by me.',
        },
      ],
    },

    /* -- the four columns -------------------------------------------------
     * ONE TAG FOR ALL FOUR, WHICH IS A CHOICE AND NOT A SHORTCUT. `orderTagged`
     * re-points the survivors of every earlier wave as well, which is what a
     * commander does and what the Allied brain would do anyway — and it is the
     * honest spelling, because the order does NOT survive the first brain pass:
     * `AI_CADENCE.squad` is `round(30 / 5)` = 6 ticks and `AiBrain.regroupSquads`
     * re-files every ungrouped hull into the strike group and attack-moves it at
     * the brain's OWN objective. `pact.03.concession`'s header records that rule
     * and it binds a `spawnUnits` wave exactly as hard. The waves still tend to
     * arrive, because the brain's standing objective is the player's base and
     * the collar is on the road there. **Do not build a timing argument on an
     * order an AI seat holds.**
     *
     * The camera move is the one in this file and it is spent on the FIRST
     * column, because the `camp` secondary is unreadable until the player has
     * seen where the columns form. It costs nothing at three minutes — nothing
     * is happening at the collar yet — and it pays for the whole rest of the
     * operation. The reveal beside it, 56 m on `ROAD`, covers the camp at 26.1 m
     * and the widest drop ring at 26 m.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: WAVE_A },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Column off their forward camp, and it is not going for the mast. It is going '
            + 'for the hole.',
        },
        { do: 'cameraMove', at: ROAD },
        { do: 'revealArea', player: 0, area: { x: ROAD.x, z: ROAD.z, r: 56 } },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD, spread: 14, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: TAP },
        { do: 'setObjective', id: 'stand' },
      ],
    },
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: WAVE_B },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray, on an open channel',
          text: 'I did not send that one either. My line is being told the schedule does not '
            + 'survive your number, and they have decided that is an argument about the hole.',
        },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 4, at: ROAD, spread: 16, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 24, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: TAP },
      ],
    },
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: WAVE_C },
      then: [
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Launchers walking behind the armour this time. The tanks are what you have to '
            + 'answer and the men are what takes the head off — they are twenty seconds '
            + 'apart, and the second twenty is the one that matters.',
        },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 4, at: ROAD, spread: 16, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'javelin', count: 4, at: ROAD, spread: 24, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: TAP },
      ],
    },
    {
      /*
       * GATED ON THE CAMP STILL STANDING, which is what gives the 500-credit
       * secondary teeth beyond its payout: levelling it deletes nine hulls and
       * hands the player the last minute of the drill. It cannot collide with
       * `t.camp` below — that trigger fires on `entityDead 'camp'` and this one
       * requires `entityAlive`, so the two are disjoint on every tick. That is a
       * statement about the WAVE, not about the chips: two Calvane lines on one
       * tick would both be drawn now, because `Shell.campaignBeatSeq` keys every
       * beat separately.
       */
      id: 't.fourth',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: WAVE_D },
          // `CAMP_HELD`, not `entityAlive` — a barracks the player has CAPTURED
          // must not go on producing the enemy's reinforcements. See the block
          // above `CAMP_OFF`.
          CAMP_HELD,
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Everything that camp had left, one minute short of depth. They know the '
            + 'number as well as we do — they have simply decided it is cheaper to stop the '
            + 'hole than to answer it.',
        },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 5, at: ROAD, spread: 18, tag: 'column' },
        { do: 'spawnUnits', player: 1, key: 'javelin', count: 4, at: ROAD, spread: 26, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: TAP },
      ],
    },

    /* -- the two secondaries, both resolved above the win ------------------
     * `runDirector` returns immediately once an outcome is set, so a completion
     * written below `t.win` never fires and the medal never counts it —
     * `medalFor` gives silver only when EVERY secondary is complete.
     */
    {
      id: 't.camp',
      when: CAMP_OFF,
      then: [
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The camp is off them. Nothing forms up on that road now, and whatever they '
            + 'send next has to come the whole way from their own line.',
        },
        { do: 'completeObjective', id: 'camp' },
      ],
    },
    {
      /*
       * AN UNTAGGED `unitsInArea` ON SEAT 1, WHICH IS THE EXPENSIVE SPELLING AND
       * THE RIGHT ONE. The question is whether ANY Allied unit is standing on
       * the lot — the scripted columns, the brain's own army, a stray harvester
       * — and tagging would mean naming in advance which of them counted. It
       * walks `store.alive` twice a tick, the arming pass and the real pass,
       * until it fires; `state.fired` then retires it for the rest of the match.
       *
       * GATED ON THE FIRST COLUMN. See the hidden-secondary block in the header:
       * without it a wanderer at minute one fails a bonus that is still hidden,
       * `Session.setObjective` refuses to un-resolve, and the reveal at three
       * minutes becomes a no-op that puts a red row on the panel for something
       * nobody mentioned. `t.first` is declared above this trigger, so on the
       * one tick both could hold the reveal is written first.
       */
      id: 't.standLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: WAVE_A },
          { on: 'unitsInArea', player: 1, area: { x: TAP.x, z: TAP.z, r: LOT_R }, min: 1 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'stand' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'They are on the collar. That is the first time all day something of theirs '
            + 'has been close enough to see what we are actually doing down there.',
        },
      ],
    },

    /* -- depth -------------------------------------------------------------
     * TWO SPEAKERS ON ONE TICK, WHICH IS TWO CHIPS — as any two beats now are;
     * see the header. Aubray's line has to sit here rather than on a delay
     * below, because `runDirector` evaluates nothing once an outcome is set and
     * the win can land on the very next tick when the lot is already clear. A
     * beat written under the win is a beat nobody ever hears — which is also
     * what makes the modal run put two CALVANE lines one tick apart, `t.depth`
     * at DRILL and `t.win` at DRILL + 1, on every clean finish.
     */
    {
      id: 't.depth',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: DRILL },
          { on: 'entityAlive', tag: 'tap' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'depth' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Depth. That is the number the count has been carrying since before the Works '
            + 'had a name, and it is the first time anyone but us has watched it come up.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray, on an open channel',
          text: 'Nine metres shallower than our model, and I am reading it off my own '
            + 'instrument, so I cannot say your people wrote it. Stand off the lot and let me '
            + 'take the second pass clean.',
        },
      ],
    },
    {
      /*
       * IT CARRIES THE WIN'S OWN LOT CLAUSE, AND THAT IS THE DIFFERENCE BETWEEN
       * SCORING THE DRILL AND SCORING THE OPERATION.
       *
       * A version of this trigger conditioned on `objectiveComplete 'depth'`
       * alone fires one tick after the fourteenth minute and therefore cannot be
       * failed by anything that happens during the mop-up — which is most of the
       * fighting the fourth column produces. Repeating `not unitsInArea` here
       * makes it resolve on the SAME TICK as `t.win`, so every second the collar
       * is contested is a second the bonus is still live. The two triggers then
       * fire together, Nael above Calvane, which is two chips: the toast key
       * carries `campaignBeatSeq` and no two beats can coalesce.
       *
       * `not objectiveFailed` is still the load-bearing half — the failure is
       * what `t.standLost` writes — and `Session.setObjective`'s refusal to
       * un-resolve is a third layer under it rather than a substitute.
       */
      id: 't.stand',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'depth' },
          { on: 'not', of: { on: 'objectiveFailed', id: 'stand' } },
          {
            on: 'not',
            of: { on: 'unitsInArea', player: 1, area: { x: TAP.x, z: TAP.z, r: LOT_R }, min: 1 },
          },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'stand' },
        {
          do: 'dialogue',
          speaker: 'Nael',
          text: 'Four columns and not one of them got a look at the collar. That is the whole '
            + 'doctrine, written down in one afternoon by people who will never read it.',
        },
      ],
    },

    /* -- the loss this operation is named after ----------------------------
     * ABOVE `t.win`, and disjoint from it by construction rather than by
     * ordering — `t.win` requires `entityAlive 'mast'` and this requires
     * `entityDead`, so no tick can satisfy both. The ordering still matters for
     * the reader: an author is meant to mean which of two outcomes a coinciding
     * tick reports, and stating it is cheaper than re-deriving it.
     *
     * **`entityDead` IS CORRECT HERE AND `ownerCount` WOULD BE WRONG, WHICH IS
     * THE OPPOSITE CALL FROM `CAMP_OFF` TWENTY LINES UP.** The objective is that
     * the instrument STANDS, not that the Allies keep it, so aliveness really is
     * the question. A player who captures the mast satisfies `t.win` exactly as
     * one who leaves it alone does, and that is the right answer.
     *
     * **CAPTURING IT WAS A TRAP, AND THE VOCABULARY STILL CANNOT CLOSE IT — A
     * FIELD DOES.** `Targeting.isValidTarget` refuses only ALLIES, so a mast the
     * player owns becomes a legal Allied target standing in the middle of the
     * Allied line — and this trigger does not care who fired. So the player took
     * it, the Allies shelled it, `reading` failed, and nothing anywhere
     * connected the two. Softening it is free of side effects (no
     * `entityHpBelow` reads `mast`), so there was not even a warning on the way
     * in.
     *
     * The twelve conditions are all READS; no trigger can refuse a capture.
     * This comment ended *"it has no campaign-side installer yet … Documented,
     * not closed."* It has one: **`OperationDef.captureProof`**, set to
     * `['mast']` at the top of this file. It installs the
     * `CaptureService.addVeto` this paragraph already named — consulted inside
     * `resolve()` ahead of both the neutral and the enemy branch, with
     * `refuse()` NOT consuming the engineer, so a vetoed click costs a walk and
     * nothing else, and `isCapturable` refuses at the cursor so the walk never
     * starts. `pact.02.long-count`'s `count` is the same case and took the same
     * fix.
     */
    {
      id: 't.mastLost',
      when: { on: 'entityDead', tag: 'mast' },
      then: [
        { do: 'eva', line: 'structureLost' },
        { do: 'failObjective', id: 'reading' },
        {
          do: 'dialogue',
          speaker: 'Aubray, on an open channel',
          text: 'That was our instrument, and it was the only reason any of this counted. '
            + 'Whatever comes out of that hole now is a Pact number taken by the Pact. I '
            + 'cannot sign it and I will not be asked to.',
        },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'Then we are exactly where we were four hundred years ago, and we have shot '
            + 'our own way back to it. Cap the hole.',
        },
        { do: 'endOperation', result: 'loss', reason: 'reading' },
      ],
    },
    {
      /*
       * THE GUARD IS ON THE WHOLE TRIGGER, NOT ON THE DIALOGUE, and the
       * difference from `pact.01.shallow-road`'s superficially identical clause
       * is the effect being suppressed. There the setter already refused to
       * un-resolve a completed objective and only the LINE needed guarding;
       * here the line is `endOperation`, which nothing refuses. See the header.
       */
      id: 't.tapLost',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'tap' },
          { on: 'not', of: { on: 'objectiveComplete', id: 'depth' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'depth' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'The head is gone and the shaft is closing on itself. There is nothing on that '
            + 'shelf for anyone to read now, ours or theirs. Log the attempt and the hour.',
        },
        { do: 'endOperation', result: 'loss', reason: 'depth' },
      ],
    },

    /* -- the win -----------------------------------------------------------
     * THE LOT HAS TO BE CLEAR, AND THAT IS WHAT MAKES `parSec` HONEST. `DRILL`
     * is an absolute clock and would otherwise put every run at exactly fourteen
     * minutes; `not unitsInArea(player 1, …)` is the second half, and the fourth
     * column lands its armour on the collar at 13:16.8 precisely so that the
     * fourteenth minute is contested. `unitsInArea` counts Infantry and Vehicles
     * only, so no Allied STRUCTURE can hold the win open.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'depth' },
          { on: 'entityAlive', tag: 'mast' },
          {
            on: 'not',
            of: { on: 'unitsInArea', player: 1, area: { x: TAP.x, z: TAP.z, r: LOT_R }, min: 1 },
          },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'reading' },
        {
          do: 'dialogue',
          speaker: 'Calvane',
          text: 'It is in the open now, and so is the seam. Every yard on this coast just '
            + 'heard the depth at which our crust stops being crust — which is the same number '
            + 'as where a cut works best. Four hundred years keeping it quiet, one afternoon '
            + 'giving it away, and it was the only way anyone was ever going to be told.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the other loss ----------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". The player opens with a full
     * base here, so the two readings agree for most of the match; they stop
     * agreeing at exactly the moment it matters, which is a commander down to
     * one Chapterhouse and a Glaive Post who can still run the clock out.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'depth' }],
    },
  ],
};

export default op;
