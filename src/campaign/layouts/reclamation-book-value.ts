/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/reclamation-book-value.ts
 * ============================================================================
 * R9 — THE GROUND. Survey 12-808, the Reclamation's own works district: the
 * company yard on the near corner, three outlying breaking lots strung down the
 * haul road, an Allied valuation desk parked at the head of that road, and two
 * lots the Allies already carried off standing on their compound at the far end.
 *
 * `reclamation.09.book-value` is the day the firm breaks up three of its own
 * nine yards to settle an account it cannot dispute. Every structure this file
 * places is either a thing the player must sell, a thing that stops them selling
 * it, or a thing they must leave alone.
 *
 * ============================================================================
 * EVERY EXPORTED POINT IS ARITHMETIC, AND THE ONE MEASUREMENT THAT MAKES THAT
 * SAFE IS AT THE TOP OF `build`
 * ============================================================================
 * `reclamation-served-notice`, `reclamation-closing-entry` and
 * `reclamation-payment-in-kind` are the precedents and they carry the argument:
 * `SIM_SEED` lives HERE, `09-book-value.ts` imports it into `map.simSeed` rather
 * than restating it, and every point below is computed from it at module load
 * out of `seatedSlots`, `SKIRMISH_START_OFFSETS` and `MAP_SIZE`. A number
 * written in two files is a number that will disagree the first time either is
 * tuned, and the failure — a lot standing where nobody authored one, a working
 * forming up on open ground — is invisible to every gate.
 *
 * `seatedSlots(2, 30912, null)` draws **[0, 1]**, the diagonal pair, so the two
 * openings are `hypot(296, 248)` = **386.16 m** apart rather than an edge pair's
 * 296.00. Three outlying lots, a desk and two compound lots do not sit at
 * legible spacing on 296 m. Every point below is `lane(along, off)`: a fraction
 * of that line from the player's corner, plus metres along its left-hand
 * perpendicular.
 *
 * **THE RAW CORNER AND THE BUILT CORNER ARE NOT THE SAME QUANTITY, AND IT IS
 * MEASURED RATHER THAN ASSUMED.** `startSpots` runs `nudgeToBuildable` over the
 * authored offsets, so what the layout is handed can differ from
 * `CENTRE + SKIRMISH_START_OFFSETS[slot]` — and every point in this file is
 * derived from the RAW corner. Measured INSIDE the build, before a single
 * footprint is marked, at this operation's seeds:
 *
 *     startSpots  (108.00, 380.00)      (404.00, 132.00)
 *     raw slots   (108, 380)            (404, 132)
 *
 * — identical, to two decimals, on both corners. `build` re-checks it every
 * time and `console.error`s if it ever stops being true, because the alternative
 * is a silent offset between the estate and the ground it was authored against.
 * Taken INSIDE the build for `reclamation-sold-twice`'s reason:
 * `nudgeToBuildable` scores `terrain.isBuildable`, which is FALSE on a cell a
 * structure already occupies, so calling `startSpots` after the world is built
 * reports openings that were never used.
 *
 * ============================================================================
 * THE SEEDS WERE SWEPT FOR GROUND, NOT CHOSEN FOR THE FICTION
 * ============================================================================
 * This operation needs SEVEN stations at once — three outlying lots, a desk, two
 * lots on the far compound and the ground the workings form up on — plus an
 * unbroken corridor for a wheeled hull from one opening to the other, because a
 * hauler works the whole road and four scripted workings drive down it.
 *
 * Twenty-four rolls were scored on EACH of `temperate` and `urban` at the fixed
 * `simSeed` 30 912 — forty-eight in all — each station by the Chebyshev ring
 * distance at which a 3x3 `isBuildable` block that is also `Foot`- and
 * `Track`-passable first appears (ring 0 = the authored point itself), and the
 * corridor by an 8-connected flood fill of the real `Locomotor.Wheel` pass grid
 * from one opening:
 *
 *     biome      seed    sum of rings   ROAD's ring   every station's own cell
 *                                                       inside the corridor
 *     temperate  12 808        3             0          yes
 *     temperate  19 205        4             1          yes
 *     temperate  33 140        4             1          no  (TAKEN_TWO)
 *     temperate  24 617        4             1          no  (TAKEN_ONE)
 *     urban      71 402        2             0          no  (TAKEN_ONE)
 *     urban      33 140        5             0          yes
 *     urban      81 267        5             0          no  (LOT_ONE)
 *     urban      48 733        6             3          no  (TAKEN_TWO)
 *     ...forty more at sum 5 to 15
 *
 * **`ROAD`'s COLUMN IS THE ONE THAT CANNOT BE FIXED LATER, AND IT IS WHY 71 402
 * LOSES DESPITE THE BEST TOTAL.** Every other station is placed through
 * `place()`, which ring-searches for a legal footprint; the forming-up point is
 * not placed at all — `EffectSink.spawnUnits` writes its computed ring points
 * VERBATIM. A station at ring 3 is a structure two metres from where it was
 * authored; a `ROAD` at ring 3 is a wave that starts the fight wedged.
 *
 * **12 808 IS THE BEST ROLL IN THE FORTY-EIGHT**: the lowest total ring search
 * of any roll whose seven stations are all inside the wheeled region, with the
 * forming-up point on its own authored cell. The survey number in the briefing
 * is that seed; the fiction was fitted to the ground rather than the other way
 * round, which is the only order that does not end in a re-sweep.
 *
 * **`temperate` RATHER THAN `urban`, AND THE BIOME IS THE SAME WORD.**
 * `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and `urban` and
 * disagree on exactly one name — the preset is `arid`, the biome is `desert` —
 * and `reclamation.03.sold-twice` shipped on the wrong side of that and measured
 * two headers' worth of numbers against ground it had not declared. This pair is
 * the same word twice.
 *
 * **AND `urban` WAS THE FIRST CHOICE, ON AN ARGUMENT THAT MEASURED THE WRONG
 * THING.** It is the flattest ground in the roster — 66-73% of cells buildable
 * across those rolls against `temperate`'s 62-67% — and its `MAP_PRESETS` name
 * is *Industrial Grid*, which is what a works district is. A whole-map buildable
 * fraction is not the question this layout asks, though: seven specific points
 * are, and on those seven `temperate` produced a strictly better roll. The
 * preset was changed once the sweep above existed, and this operation was built,
 * measured and re-measured on the answer rather than on the intuition. It also
 * breaks a run: `reclamation.05.closing-entry`, `.06.in-duplicate` and
 * `.08.contra-entry` are all `urban`, and R8 is the operation immediately before
 * this one.
 *
 * ============================================================================
 * THE THREE OUTLYING LOTS ARE THE OPERATION, AND THEY ARE THE PLAYER'S OWN
 * ============================================================================
 * Each lot is an `rclSorter` tagged `lot`, an `rclFurnace` beside it, one
 * `rclScrapper` on the apron and a field of ore for it to work. That is the
 * smallest thing that is simultaneously a piece of plant with a price, a working
 * lot that delivers, and a piece of the storage ceiling — and the operation needs
 * all three from the same object, because the whole design is that they are the
 * same object.
 *
 * **THE THIRD OF THOSE IS THE ONE THE OPERATION IS ACTUALLY ABOUT.** The ore
 * section below measures what the estate delivers (108 510 credits over the
 * match against a 22 000 bill) and what the player can hold (21 000, falling to
 * 15 000 as they execute the primary), and only the second of those is ever
 * short. A lot is 2 000 of ceiling first and a delivery rate second.
 *
 *     `rclSorter`    2 000 credits, `REFINERY_STORAGE` 2 000, -30 power
 *     `rclFurnace`     240 credits, no storage,               +80 power
 *     `rclScrapper`  1 150 credits, `cargoMax` 600
 *
 * **THE TAG IS ON THE SORTER AND NOWHERE ELSE.** `ownerCount(0, 'building',
 * 'lot')` has to answer "how many of the three lots are still on our books" and
 * nothing else, so the Furnace and the hauler are untagged. The Furnace matters
 * to the operation anyway — see the ratchet in the operation's header, where
 * selling ONE of them is the cheapest answer to the whole ceiling problem — but
 * it matters as a number, not as a name.
 *
 * **THEY ARE SELLABLE AND THE ENEMY'S PLANT IS NOT.** `Scenarios.ts` composes
 * the civilian flag set as `STRUCTURE & ~EntityFlag.Sellable`, so the two
 * `civOreMine` on the far compound and the `civApartments` desk cannot be sold
 * by anybody; a normal def keeps the bit. The plant the player is told to break
 * up is exactly the plant the game will let them break up, which is not a
 * coincidence — it is why the objective is authored over structures of the
 * player's OWN army rather than over civilian silhouettes.
 *
 * ============================================================================
 * WHERE THE LOTS SIT, AND THE ORDER IS THE PATHFINDER'S RATHER THAN THE RULER'S
 * ============================================================================
 * `lane(0.20, 48)`, `lane(0.28, -44)` and `lane(0.42, 26)`, landing on the built
 * world at (198, 368), (164, 278) and (250, 296) — **90.80, 116.36 and 164.98 m
 * from the company yard IN A STRAIGHT LINE**, with the third of them 40% of the
 * way to the Allied compound and 96.21, 87.86 and 88.81 m apart from one another.
 *
 * **A STRAIGHT LINE IS NOT A ROUTE, AND ON THIS GROUND IT REVERSES THE MIDDLE
 * TWO.** Measured by Dijkstra over the real `FlowFieldCache.costGridFor` on the
 * BUILT world with the engine's own relaxation — 8-connected, destination-cell
 * weight, diagonals at `(nc * DIAG) | 0`, corner cut refused — from the nearest
 * open cell of the source to the nearest open cell of each landed Sorter:
 *
 *                             Eight (198,368)  Five (164,278)  Three (250,296)
 *     from the yard anchor (108, 380)
 *       straight line               90.80          116.36          164.98
 *       Foot                       101.6           212.0           179.8
 *       Track                       99.9           210.8           178.1
 *     from `ROAD` (347.65, 160.95), where the four workings form up
 *       straight line              255.47          217.78          166.66
 *       Foot                       278.9           225.3           185.6
 *       Track                      277.8           225.6           184.5
 *
 * **NUMBER FIVE IS THE FURTHEST OF THE THREE TO REACH FROM THE COMPANY YARD, BY
 * 32.7 m OVER NUMBER THREE, ON GROUND WHOSE RULER HAS IT 48.6 m NEARER.**
 * 210.8 m of Track walking against 116.36 m of straight line is **1.81x** —
 * 1.82x for Foot. An earlier draft of this block published the straight lines as
 * "m down the road" and rested the whole exposure argument on their order; they
 * are the one measurement on this map that a ruler gets backwards.
 *
 * **IT IS NOT AN ARTEFACT OF THE SOURCE CELL (traps 20 and 27).** Re-run from
 * every one of the 41 seat-0 entities standing within 60 m of the opening — the
 * Foundry, the Breaker Yard, the Rookery, the Barricades, the four Grinders and
 * the eight Pickers — Number Five is further than Number Three in **41 of 41**,
 * by 32.2 to 39.2 m on the Foot grid (32.2 m from the anchor itself).
 *
 * **AND IT IS THE GROUND, NOT THE ESTATE, WHICH IS AN EXCLUSION CONTROL RATHER
 * THAN AN ASSERTION (trap 18).** `Terrain.isPassable` refuses an OCCUPIED cell,
 * so 166 cells of standing structure are already closed to every route above.
 * The control is the same fill run twice at a flat `COST_UNIT`, once through
 * `isPassable` and once against `terrain.passGrid` alone with every footprint on
 * the map OPEN:
 *
 *                                Eight    Five   Three
 *       occupancy closed          99.3   207.2   177.5
 *       every footprint open      92.9   206.4   174.4
 *
 * Taking every building on the map off the grid buys **0.8 m of a 207.2 m walk**
 * to Number Five, and Number Five is still 32.0 m further than Number Three. The
 * detour is relief, and no arrangement of this estate's own footprints causes it
 * or can fix it.
 *
 * **SO THE EXPOSURE ORDER IS THE ONE THE WORKINGS SEE, AND NUMBER FIVE IS THE
 * AWKWARD ONE RATHER THAN THE MIDDLE ONE.** Down the road from `ROAD` a column
 * meets Three (184.5), then Five (225.6), then Eight (277.8), which is exactly
 * the order the trigger table points the four workings at. Back up the road from
 * the yard a relief walks Eight (99.9), then Three (178.1), then Five (210.8).
 * Number Five is therefore **second on the workings' road and last on the
 * company's** — the lot that is hardest to hold — and a player deciding which to
 * break up first is deciding which one they think they cannot keep.
 *
 * The offsets alternate sides so that no two lots share a field and no working
 * can attack-move through two of them on one bearing.
 *
 * ============================================================================
 * THE ALLIED VALUATION DESK
 * ============================================================================
 * `civApartments` — 800 hp, `ArmorClass.Concrete`, 8 x 12 m — owned by SEAT 1
 * and tagged `desk`, with two `pillbox` beside it tagged `guard`. `op.foe` is
 * Allied, so `keyFor` resolves that role key to ITSELF: `pillboxMg`, 22 m,
 * `chainCount` 0, which is why `tests/campaign-emplacement-reach.spec.ts` §2 is
 * satisfied by the row not chaining at all rather than by distance. The desk is
 * the one tagged thing on this map an Allied gun stands next to.
 *
 * It sits at `lane(0.47, -6)` — at the head of the player's own haul road,
 * PAST all three lots rather than between them. That is the fiction and the
 * geometry agreeing: a valuation desk prices what comes past it, and a player
 * who clears it is clearing the top of their own road rather than raiding.
 *
 * **AND NO ALLIED GUN ON THIS MAP COVERS A LOT OF THE PLAYER'S — MEASURED AS
 * SURFACE DISTANCE AGAINST THE ACQUISITION ENVELOPE, WHICH IS NOT THE SAME
 * QUESTION AS A CENTRE DISTANCE AGAINST A RANGE (trap 28).**
 * `Targeting.isValidTarget` tests `hypot(dx, dz) - hitRadius(...)` against
 * `max(reachOf(i, w), w.range * COMBAT_TARGETING.acquireRangeMul)`, and `reachOf`
 * returns 0 for a structure because `canDrive` is false — so a `pillbox`'s
 * envelope is **22 x 1.08 = 23.76 m of SURFACE**, and the surface it is measured
 * to is the TARGET's. An `rclSorter` is a 3 x 2 footprint, so its `hitRadius` is
 * the half-diagonal `sqrt(6^2 + 4^2)` = **7.211 m**. Measured over all FIVE armed
 * enemy structures against all three landed Sorters:
 *
 *     pillbox@(262,266) -> Number Three (250,296)   32.31 centre   25.10 surface
 *     pillbox@(242,242) -> Number Five  (164,278)   85.91          78.70
 *     pillbox@(262,266) -> Number Eight (198,368)  120.42         113.20
 *
 * So the nearest lot clears acquisition by **1.34 m — one third of a cell**, not
 * by the 10.31 m a centre-against-range reading implies, and an earlier draft of
 * this block published exactly that reading. It still clears, and `Targeting`
 * really would take the shot if it did not: `acquire` scores `EntityKind.Building`
 * through `COMBAT_TARGETING.softBuilding` and `isValidTarget` refuses only ALLIES.
 * **ANYBODY MOVING `LOT_THREE`'s OFFSET IS SPENDING A THIRD OF A CELL AGAINST A
 * `place()` RING STEP OF 6 m**, so re-measure this pair rather than the ruler.
 *
 * The same correction on the ore: that post's nearest seeded ore cell is 32.00 m
 * of centre distance, and a hauler is a UNIT, so `hitRadius` returns its RADIUS
 * (`footprintW` is 0) — **3.870 m for `rclScrapper`, not a 5.657 m footprint
 * half-diagonal** — giving 28.13 m of surface against 23.76 and **zero cells of
 * either lot field inside the envelope**.
 *
 * The posts cover the desk they stand beside — 18.00 and 20.88 m of centre,
 * 10.79 and 13.67 m of surface against the same 23.76 — and nothing else, which
 * is what puts them in that spec's §2 scope and what makes them pass it. (§2's
 * own test is a centre distance against the raw range, and it early-returns on
 * `chainCount <= 0` before reaching it, so `pillboxMg` never gets that far.)
 *
 * ============================================================================
 * THE TWO LOTS THEY ALREADY TOOK
 * ============================================================================
 * Two `civOreMine` on SEAT 1 at `lane(0.66, 40)` and `lane(0.74, -30)`, tagged
 * `taken`, landing at (328, 248) and (308, 180) — **256.56 and 282.84 m from the
 * company yard in a straight line**, and 68.41 and 81.04 m of centre distance
 * from the nearest gun the Allies own, which for a 2 x 2 `civOreMine`
 * (`hitRadius` 5.657) is 62.75 and 75.39 m of SURFACE against a `pillbox`'s
 * 23.76 m envelope. They are Numbers One and Four of the company's nine, lifted
 * off this siding in the spring and credited against the account at scrap, which
 * is why there is still an account.
 *
 * **THEY PAY THEIR HOLDER 600 CREDITS A MINUTE INTO A CAPPED BOX, AND THE CAP IS
 * WHAT MAKES THE SECONDARY A DENIAL RATHER THAN A WAGE.** `civOreMine` is
 * `CIVILIAN_MINE_INCOME` in `src/data/Civilians.ts` — 5 credits every 30 ticks —
 * paid by `payHolders` in `src/sim/civilian.system.ts` to ANY owner whose faction
 * is not `Faction.Neutral`, and that module is a `*.system.ts` under `src/sim/`,
 * so `Systems.ts` registers it in a campaign boot exactly as in a skirmish. Two
 * of them is **10 cr/s = 600 cr/min = 12 600 credits over `parSec` 1260** —
 * but the call is `economy.deposit(owner, credits, Bounty)` under its own comment
 * *"`deposit`, not `grant`: this is income and it honours the storage cap"*, so
 * a holder standing at their ceiling banks NONE of it. Seat 1's structural
 * storage on the built world is **5 000** (one `refinery` at `REFINERY_STORAGE`
 * 2 000 and two `oreSilo` at `SILO_STORAGE` 1 500), i.e. a box of 15 000; seat 0
 * is measured pinned at its own 21 000 from t+178.9 s. The operation forbids the
 * player nothing — taking them is one right-click's worth of engineer work and
 * costs a medal — and what it buys is measured in the operation's `held` block,
 * where the honest half is what it takes OFF the Allies rather than what it
 * pays in.
 *
 * **THEY ARE UNGUARDED, DELIBERATELY.** Not one emplacement stands near them,
 * which is why they do not appear in that spec's §1 roster beside the desk's
 * two. A temptation with a wall in front of it is a wall; a temptation with
 * nothing in front of it is a decision.
 *
 * ============================================================================
 * WHERE THE WORKINGS FORM UP
 * ============================================================================
 * `ROAD` = `lane(0.84, -14)`, landing at (347.65, 160.95) — **63.35 m out of the
 * Allied gate**, past `BUILD_RADIUS` 56, and 166.66 m from Number Three and
 * 324.68 m from the company yard IN A STRAIGHT LINE. By Track over the real
 * `costGridFor` grid it is **184.5 m to Number Three, 225.6 to Number Five,
 * 277.8 to Number Eight and 345.5 to the yard**, which is the order the trigger
 * table sends the four workings in and the reason the escalation reads as
 * working down the road rather than as four waves at one target.
 *
 * **`EffectSink.spawnUnits` DOES NOT SEARCH FOR STANDABLE GROUND**, and it lays
 * a wave on an exact RING of radius `spread` rather than scattering inside one:
 * unit `i` of `count` lands at `angle = i / count * 2pi` and
 * `ProductionService.spawnUnit` writes the point VERBATIM — no
 * `connectedGround`, no egress search. So every drop of every wave is checked
 * against `ITerrain.isPassable` for that wave's own move class on the built
 * world. Three distinct rings and **nine distinct drop points** carry all
 * twenty-seven drops of the four workings; the measurements are in the
 * operation's header and `tests/campaign-spawn-ground.spec.ts` is the standing
 * gate. **A change to any `count` or `spread` invalidates the check**, because a
 * wave of three does not stand where a wave of two does.
 *
 * `lane(0.86, -20)` was the first offset here and it cleared the Allied gate by
 * **1.64 m** — 57.64 against `BUILD_RADIUS` 56 — which is a margin no reader
 * would have known was thin. -14 at 0.84 clears it by 7.35 m and moved the worst
 * ring bearing from BLOCKED to standable at the same time.
 *
 * ============================================================================
 * ORE, AND WHY `addStartOre` IS NOT CALLED
 * ============================================================================
 * `addStartOre` lays its contested patch on the CENTROID of the openings, which
 * for two armies is the map centre — and on this pair the map centre is
 * `lane(0.50, 0)` EXACTLY, i.e. the middle of the haul road four scripted
 * workings drive down. A radius-22 field there would put haulers of both armies
 * on the line of march and nothing else. Every field here is laid by hand
 * instead, exactly as `reclamation-served-notice` and `reclamation-payment-in-kind`
 * do: one on the company yard's own bearing, one beside each outlying lot, and
 * two for the Allies on their corner's bearing.
 *
 * The geometry of the two home-corner fields is `addStartOre`'s own — 18 m along
 * the line to the centre, 44 m across it, radius 30 — taken as a normalised
 * difference rather than off `facingDeg` through `Math.sin`/`Math.cos`, which
 * lands in the same place for the same reason a start faces the middle of the
 * map and is exact under IEEE-754.
 *
 * ============================================================================
 * NO TRIGONOMETRY, NO `rotateStarts`
 * ============================================================================
 * Every offset here is an authored number and the one bearing that is not — the
 * lane's unit vector — is a difference over a `Math.sqrt`. ECMA-262 pins
 * `+ - * /` and `Math.sqrt` and pins neither `sin` nor `cos`; a layout runs
 * independently on both machines of a lockstep match, so a table rotated by an
 * angle is a tick-zero desync waiting for two engines to disagree in the last
 * mantissa bit. `Math.atan2` appears once, in `yawTo`, and its result is the
 * rotation of a model that nothing reads back.
 *
 * `rotateStarts` is not called, for `reclamation-held-paper`'s reason: an
 * operation pins its seed, so the rotation is a moving part with exactly one
 * value. Seat `i` takes slot `i`.
 *
 * ============================================================================
 * WHAT THE BUILD ACTUALLY PRODUCES
 * ============================================================================
 * Built headless at `mapSeed` 12 808 / `simSeed` 30 912 on `biome: 'temperate'` with
 * the def tables BOUND and this operation's roster INSTALLED — the same build
 * `tests/campaign-roster-ground.spec.ts` performs, and both halves are load
 * bearing: `spawnBuilding` hands `isBuildable` the RESOLVED def, and
 * `rosterAllows` answers TRUE for an undefined one, so a build without the
 * binding measures a different game in a way that looks like a pass.
 *
 *     seat 0   30 buildings   20 units      seat 1   29 buildings   12 units
 *
 *     seat 0   rclFoundry 1, rclBreakerYard 1, rclSorter 4, rclHeap 2,
 *              rclFurnace 7, rclRookery 1, rclSpotter 1, rclSpitpost 3,
 *              rclBarricade 10
 *              structural storage 11 000      net power +300
 *     seat 1   conyard, warFactory, refinery, barracks, radar, oreSilo 2,
 *              powerPlant 4, wall 10, pillbox 5, civApartments 1, civOreMine 2
 *
 * **THE 11 000 IS THE OPERATION.** `STORAGE_BASE` is 10 000, so seat 0's
 * `storageMax` at tick zero is **21 000** — and 8 000 of the 11 000 is four
 * `rclSorter`, three of which the primary requires the player to break up. The
 * operation's whole arithmetic falls out of that one measured number and it is
 * derived in the operation's header rather than here.
 *
 * `auditConnectivity`: **1 passable region for a tracked hull holding 12 031 of
 * 12 031 cells (100.0%); 0 placements relocated; 0 entities stranded; 0
 * structures on ground `isBuildable` refuses.**
 *
 * Ore, seeded through the real `OreField.seedField` with `economy.system.ts`'s
 * own accept function: **6 fields, 660 cells, 135 398 credits on the ground**.
 *
 *     the company yard's own field   (150, 402) r30   28 061
 *     Number Eight's field           (217, 390) r26   19 209
 *     Number Five's field            (143, 254) r26   18 991
 *     Number Three's field           (268, 319) r26   22 525
 *     the Allied corner              (362, 110) r30   27 856
 *     their second field             (385, 200) r24   18 756
 *
 * **88 786 OF THAT IS PRIVATE TO THE PLAYER**, against an authored bank
 * threshold of 22 000 — and with regrowth the ground pays far more than it
 * holds. Driven for the full 1 260 s through the real `HarvesterController`, the
 * real `Economy` and `OreField.regrow` on exactly this composition, with nothing
 * spent and nothing attacking, seat 0 delivers **108 510 credits, 4.9x the bill,
 * and is pinned at its 21 000 ceiling from t+178.9 s**, throwing 89 510 of it
 * away as `CreditReason.Waste`.
 *
 * So the ground is emphatically NOT the constraint here, the CLOCK is not either,
 * and the operation must not pretend otherwise. What binds is the ceiling alone,
 * and the operation's header derives it — including the two measurements that
 * show it cannot be turned into an income problem by anything this file could
 * author: dropping all three lot fields still delivers 77 819, and retiring the
 * three outlying haulers on top of that still delivers 52 110 and still pins the
 * player from t+424.1 s.
 *
 * **THE LOT FIELDS ARE STILL WORTH LAYING, AND THE REASON IS GROSS RATHER THAN
 * NET.** Each Sorter's nearest seeded cell is 7.21, 10.77 and 7.21 m away, which
 * is a haul of nothing, and the three of them carry 25 800 credits of the 108 510
 * — measured by selling the three Sorters at t+600 s in the same rig, where
 * delivery falls to 82 710 because the outlying haulers lose their docks. That is
 * a real difference in what the estate DELIVERS and no difference at all to what
 * the player HOLDS, because the box is full either way. The three fields are here
 * so that a lot reads as a working lot; they are not the operation's economy.
 *
 * ============================================================================
 * TAGS
 * ============================================================================
 * `lot`    — the three outlying `rclSorter`, on SEAT 0. Read as
 *   `ownerCount(0, 'building', 'lot', max: 0)` for the second primary and
 *   `min: 1` for its complement. NEVER as `entityDead`: the player sells these,
 *   and a sold structure and a burned one are the same reading — which for this
 *   operation is correct and is the whole of what `book value` means.
 * `desk`   — the Allied valuation desk, on SEAT 1. Read as
 *   `ownerCount(1, 'building', 'desk', max: 0)`, so clearing it counts by either
 *   verb — trap 9's spelling, and here the capture route is a real one because
 *   the desk stands on the player's own road.
 * `taken`  — Numbers One and Four, on SEAT 1. Read as
 *   `ownerCount(1, 'building', 'taken', min: 2)`; the secondary fails the moment
 *   either stops being theirs, by capture or by demolition. Garrison is not a
 *   third route and the operation's header measures why — `refusalFor` answers
 *   `'hostile'` for a host that is neither Neutral nor allied.
 * `guard`  — the two posts beside the desk. Named by no trigger; declared so
 *   that `tests/campaign-maps.spec.ts` verifies they actually landed, which is
 *   the only automatic check the desk's approach has.
 * `column` — produced by `spawnUnits` in the trigger table, never by this file,
 *   and declared anyway so a reader asking where the pressure comes from finds
 *   the answer in the file that owns the ground.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning, and that answers from the LOCAL profile unless the operation's
 * roster is installed first. `campaign-install.ts` installs it BEFORE the boot,
 * so this gets the same world on every machine by construction.
 * ========================================================================== */

import { MAP_SIZE } from '../../core/config';
import { NONE, Stance } from '../../core/types';
import {
  SKIRMISH_START_OFFSETS, buildBaseFor, seatedSlots, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { EntityId, PlayerId } from '../../core/types';
import type { Area, Point } from '../types';
import { layout } from '../layout';

/* ==========================================================================
 * 1. THE SEED, AND EVERYTHING ARITHMETIC THAT FALLS OUT OF IT
 * ========================================================================== */

/**
 * `?seed=` — the scenario layout roll, and the ONE input every exported point
 * below is computed from. `09-book-value.ts` imports it into `map.simSeed`
 * rather than restating it.
 *
 * Chosen for the LAYOUT it draws rather than for the number: with two armies and
 * no sea, `seatedSlots` picks one of four pairs off `startPairFor(seed)`, and
 * 30 912 draws **[0, 1]** — the diagonal, 386.16 m of lane instead of an edge
 * pair's 296.00. Six stations plus a forming-up point do not sit at legible
 * spacing on 296 m.
 */
export const SIM_SEED = 30_912;

/** The map centre. Every authored slot is an offset from it. */
const CENTRE = MAP_SIZE * 0.5;

/** An authored slot as a world point. `?? { dx: 0, dz: 0 }` is unreachable. */
function slotPoint(slot: number): Point {
  const o = SKIRMISH_START_OFFSETS[slot] ?? { dx: 0, dz: 0 };
  return { x: CENTRE + o.dx, z: CENTRE + o.dz };
}

const SLOTS = seatedSlots(2, SIM_SEED, null);
/** The company yard's corner. (108, 380) on the shipped pair. */
const HOME = slotPoint(SLOTS[0] ?? 0);
/** The Allied compound. (404, 132), 386.16 m up the lane. */
const FOE = slotPoint(SLOTS[1] ?? 1);

/** Unit vector down the lane, and its left-hand perpendicular. */
const LANE = (() => {
  const dx = FOE.x - HOME.x;
  const dz = FOE.z - HOME.z;
  const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
  const nx = dx / len;
  const nz = dz / len;
  return { nx, nz, px: -nz, pz: nx, len };
})();

/** A point on the lane: `along` is a fraction of it, `off` is metres across. */
function lane(along: number, off: number): Point {
  return {
    x: HOME.x + LANE.nx * LANE.len * along + LANE.px * off,
    z: HOME.z + LANE.nz * LANE.len * along + LANE.pz * off,
  };
}

/**
 * The company yard, as the trigger table's fourth working needs to name it.
 *
 * The RAW corner rather than the built one, for the reason the header gives: the
 * two are measured equal at these seeds and `build` re-checks it, and every
 * other point in this file is derived from the raw corner, so mixing the two
 * would be the one inconsistency nothing downstream could see.
 */
export const YARD: Point = { x: HOME.x, z: HOME.z };

/**
 * Number Eight, nearest the yard on both measures. Authored (198.03, 367.19),
 * landed **(198, 368)** — 0.81 m of snap, 90.80 m from the yard in a straight
 * line and **99.9 m of Track walking** over the real `costGridFor` grid.
 */
export const LOT_ONE: Point = lane(0.20, 48);
/**
 * Number Five, and it is the FURTHEST of the three to reach rather than the
 * middle one. Authored (162.62, 276.83), landed **(164, 278)** — 1.81 m of snap,
 * 116.36 m from the yard in a straight line and **210.8 m of Track walking**,
 * 1.81x the ruler and 32.7 m further than Number Three. See the header for the
 * exclusion control that puts that on the ground rather than on the estate.
 *
 * `lane(0.28, ...)` RATHER THAN 0.31, AND THE DIFFERENCE IS 15 m OF RING SEARCH.
 * `place()` walks its rings [0, 6, 12, ...] and takes the first legal footprint,
 * so a refused point does not move a little — it moves to the next ring that has
 * one. Swept along the lane at a fixed -44 of offset and measured on the built
 * world, the snap is **1.81 m at 0.28, 5.59 at 0.29, 7.63 at 0.30, 17.07 at 0.31
 * and 15.24 at 0.32**. Trap 33: an authored coordinate is a request, and the only
 * way to know what was granted is to build it.
 */
export const LOT_TWO: Point = lane(0.28, -44);
/**
 * Number Three, the first of the three a working meets. Authored
 * (249.02, 295.77), landed **(250, 296)** — 1.01 m of snap; 164.98 m from the
 * yard and 166.66 m from the ground the workings form up on in a straight line,
 * **178.1 and 184.5 m of Track walking**. Nearest the enemy by the pathfinder
 * and SECOND-furthest from the company by it, which is why the trigger table
 * points the first working here.
 *
 * It is also the one lot that stands anywhere near an Allied gun: 25.10 m of
 * SURFACE from `pillbox@(262,266)` against a 23.76 m acquisition envelope, i.e.
 * a third of a cell of clearance. The header derives both figures; moving this
 * offset spends that clearance against a `place()` ring step of 6 m.
 */
export const LOT_THREE: Point = lane(0.42, 26);

/**
 * The Allied valuation desk, at the head of the player's own haul road.
 *
 * `lane(0.47, -6)`, which is PAST all three lots on both measures that matter:
 * 0.47 of the lane against their 0.20, 0.28 and 0.42, and 179.88 m from the yard
 * in a straight line against their 90.80, 116.36 and 164.98. A desk that prices
 * what comes past it has to be at the end of the road rather than in the middle
 * of it, and a player who clears it is clearing the top of their own road rather
 * than raiding. (The lane fraction is the measure that carries this claim, not
 * the ruler: by the pathfinder Number Five is 210.8 m from the yard and the desk
 * is on the far side of Number Three from it either way.)
 *
 * Authored (243.27, 258.84), landed **(242, 260)** — 1.72 m of snap. 36.88 m
 * from Number Three, 80.05 m from Number Five and 116.62 m from Number Eight,
 * all straight lines.
 */
export const DESK: Point = lane(0.47, -6);

/**
 * The desk as a disc, for the briefing's first `revealArea`.
 *
 * 26 m, because the two posts land 18.00 and 20.88 m from the building on the
 * built world, so one reveal frames the desk, both guns and the ground a party
 * would form up on to clear them. `revealArea` EXPLORES ground rather than
 * showing live units, so this is the map being drawn and not an intelligence
 * report.
 *
 * **THERE IS NO SECOND DISC OVER THE THREE LOTS AND THERE MUST NOT BE.** They
 * are the PLAYER'S OWN structures with `sight` 22 apiece; a reveal over ground
 * the player already holds shows nothing and reads as the briefing padding
 * itself. The two reveals in this operation are the only two things on the map
 * that seat 0 cannot already see.
 */
export const DESK_AREA: Area = { x: DESK.x, z: DESK.z, r: 26 };

/** Number One, on the Allied compound. Authored (329.05, 246.98), landed (328, 248). */
export const TAKEN_ONE: Point = lane(0.66, 40);
/**
 * Number Four, deeper in. Authored (307.77, 173.48), landed **(308, 180)**.
 *
 * 6.52 m of `place()` ring search, which is the worst snap in this file by a
 * factor of four — and it is recorded rather than tuned away because NOTHING in
 * either file measures from this point. Every figure the operation publishes
 * about Numbers One and Four is a count (`ownerCount(1, 'building', 'taken')`)
 * or an income rate; the geometry the trigger table reads is ownership, not
 * distance. `reclamation-payment-in-kind`'s `OFFICE` block is the opposite case
 * and is worth reading beside this one: there a 2.83 m snap could point AT the
 * disc a primary rested on, so the offset had to be swept.
 */
export const TAKEN_TWO: Point = lane(0.74, -30);

/**
 * The two of them as one disc, for the briefing's second reveal and its camera
 * move.
 *
 * Centred on `lane(0.70, 5)` and 62 m, because the two land 38.97 and 31.98 m
 * from that point on the built world — so one reveal frames both and neither the
 * Allied gate nor the ground the workings form up on.
 */
export const TAKEN_AREA: Area = (() => {
  const c = lane(0.70, 5);
  return { x: c.x, z: c.z, r: 62 };
})();

/**
 * Where the Allied workings form up: **63.35 m out of their own gate**, past
 * `BUILD_RADIUS` 56; 166.66 m from Number Three and 324.68 m from the company
 * yard in a straight line, **184.5 and 345.5 m of Track walking**.
 *
 * All nine distinct drop points of the three rings fired here are standable,
 * worst clearance 4 m. See the operation's header for the sweep and for why a
 * change to any `count` or `spread` invalidates the check.
 */
export const ROAD: Point = lane(0.84, -14);

/* ==========================================================================
 * 2. THE COMPOSITION
 * ========================================================================== */

/**
 * Metres searched outward for a legal footprint. Nearest first, integer rings.
 *
 * `findClearFootprint` ALONE IS NOT ENOUGH: it asks `footprintClear` (is
 * anything already there) and `connectedGround` (can an army reach it) and
 * NOTHING about grade, so `spawnBuilding` will plant a structure on a slope
 * `isBuildable` refuses and report success. Both questions are asked here and
 * the shipped search is only the fallback — the same helper
 * `reclamation-closing-entry`, `reclamation-sold-twice`,
 * `reclamation-held-paper` and `reclamation-payment-in-kind` all carry, for the
 * same reason.
 */
const PLACE_RINGS: readonly number[] = [0, 6, 12, 18, 26, 34];
/** Eight exact bearings. Integers only, so every candidate is bit-identical. */
const PLACE_BEARINGS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Ring zero is the nominal spot itself; the bearings would test it eight times. */
const ORIGIN_ONLY: readonly (readonly [number, number])[] = [[0, 0]];

/** Metres reserved around an outlying lot, so its apron and dock stay walkable. */
const LOT_CLEAR = 30;
/** Metres reserved around the valuation desk. */
const DESK_CLEAR = 26;
/** Metres reserved around a lot the Allies already hold. */
const TAKEN_CLEAR = 22;
/** Radius of the ore field beside each outlying lot. */
const LOT_ORE = 26;
/** Metres from a lot to its own field, along the perpendicular. */
const LOT_ORE_OUT = 30;

export default layout({
  id: 'reclamation-book-value',
  tags: ['lot', 'desk', 'taken', 'guard', 'column'],

  build(b, cx, cz, start, c) {
    /*
     * THE EXPORTED POINTS ARE ABSOLUTE AND THIS BUILD IS SHELF-ANCHORED, SO THE
     * TWO HAVE TO AGREE. `buildScenario` passes `startShelf()`, which is
     * `startLocations()[0]`, which `startPointsFor` puts at the map centre on
     * every continent. If that ever stops being true the trigger table is naming
     * ground this file never dressed — and it would be invisible, because every
     * tag would still land and every test would still pass.
     */
    if (Math.abs(cx - CENTRE) > 1 || Math.abs(cz - CENTRE) > 1) {
      console.error(
        `[campaign] reclamation-book-value built on (${cx}, ${cz}), not the map centre `
        + `(${CENTRE}, ${CENTRE}) — every lot is authored in absolute coordinates and will not `
        + 'line up with the ground this build lays down.',
      );
    }

    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const home = spots[0];
    const foeSpot = spots[1] ?? spots[0];
    const us: PlayerId = c.seat(0);
    const them: PlayerId = c.seat(1);

    /*
     * THE ONE MEASUREMENT THE DERIVED POINTS REST ON, RE-CHECKED EVERY BUILD.
     *
     * `startSpots` runs `nudgeToBuildable`, so the corner it hands back is not
     * the raw slot in general — and every exported point above is computed from
     * the RAW slot. Measured at these seeds the two agree to 0.00 m on both
     * corners; a generator change that moves either one silently offsets the
     * whole estate from the compound it was authored against, and nothing
     * downstream would notice.
     */
    if (Math.abs(home.x - HOME.x) > 2 || Math.abs(home.z - HOME.z) > 2
      || Math.abs(foeSpot.x - FOE.x) > 2 || Math.abs(foeSpot.z - FOE.z) > 2) {
      console.error(
        `[campaign] reclamation-book-value: startSpots gave (${home.x}, ${home.z}) and `
        + `(${foeSpot.x}, ${foeSpot.z}) against the raw corners (${HOME.x}, ${HOME.z}) and `
        + `(${FOE.x}, ${FOE.z}) — every exported point is derived from the RAW corners, so the `
        + 'estate and the compound are no longer on the same map.',
      );
    }

    /* -- placement helper ------------------------------------------------- */
    const scratch = new Float32Array(2);
    const place = (owner: PlayerId, key: string, p: Point): Point => {
      const f = b.footprintOf(b.keyFor(owner, key));
      for (const r of PLACE_RINGS) {
        for (const [ox, oz] of r === 0 ? ORIGIN_ONLY : PLACE_BEARINGS) {
          const px = p.x + ox * r;
          const pz = p.z + oz * r;
          if (b.footprintBuildable(px, pz, f.w, f.h) && b.footprintClear(px, pz, f.w, f.h)) {
            return { x: px, z: pz };
          }
        }
      }
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    /**
     * Bearing from one point toward another, for the yaw of a model.
     *
     * The one `Math.atan2` in the file and it is cosmetic — nothing reads it
     * back, and no offset in this layout is derived from an angle. See the
     * header.
     */
    const yawTo = (from: Point, to: Point): number => wrapDeg(
      Math.atan2(to.x - from.x, to.z - from.z) * (180 / Math.PI),
    );

    /* ==================================================================
     * 1. THE TWO BASES
     *
     * `opening: 'base'` on both seats, garrison included. The player needs
     * the thing that spends and the thing that mines — the objective IS the
     * bank — and a twenty-one minute operation against an opponent that never
     * mines is a backdrop rather than a threat.
     * ================================================================== */
    buildBaseFor(b, us, home.x, home.z, { facingDeg: wrapDeg(home.facingDeg + 180) });
    buildBaseFor(b, them, foeSpot.x, foeSpot.z, {
      facingDeg: wrapDeg(foeSpot.facingDeg + 180),
    });

    /* ==================================================================
     * 2. THE THREE OUTLYING LOTS
     *
     * PLACED FIRST of this file's own structures, because they are the
     * operation and everything else gives way to them. Sorter, Furnace,
     * hauler and a field, three times; the `lot` tag goes on the SORTER
     * alone, so `ownerCount(0, 'building', 'lot')` answers "how many are
     * still on our books" and nothing else.
     *
     * `refinery` and `powerPlant` are ROLE keys, so `keyFor` gives this army
     * its own; neither `rclSorter` nor `rclFurnace` carries an `UNLOCK_TAGS`
     * id, so the roster cannot refuse one — which matters more here than
     * anywhere else in the file, because a refused `spawnBuilding` returns
     * `NONE`, `c.tag` ignores `NONE`, and the second primary would then be
     * satisfied by a lot that was never on the ground.
     * ================================================================== */
    const lots: readonly { at: Point; oreSide: number }[] = [
      { at: LOT_ONE, oreSide: 1 },
      { at: LOT_TWO, oreSide: -1 },
      { at: LOT_THREE, oreSide: 1 },
    ];
    for (const lot of lots) {
      const sorterAt = place(us, 'refinery', lot.at);
      const yaw = yawTo(sorterAt, FOE);
      const id: EntityId = b.spawnBuilding('refinery', us, sorterAt.x, sorterAt.z, { yawDeg: yaw });
      c.tag('lot', id);
      if (id === NONE) continue;
      b.block(sorterAt.x, sorterAt.z, LOT_CLEAR);

      // Its own power. +80 against the Sorter's -30 is +50 of net grid per
      // lot — and selling ONE of these three Furnaces at a full box is the
      // cheapest answer to the whole ceiling problem. See the operation's
      // header, where that is measured rather than asserted.
      const furnaceAt = place(us, 'powerPlant', {
        x: sorterAt.x - LANE.nx * 18 + LANE.px * 14,
        z: sorterAt.z - LANE.nz * 18 + LANE.pz * 14,
      });
      b.spawnBuilding('powerPlant', us, furnaceAt.x, furnaceAt.z, { yawDeg: yaw });

      // `shipsWith` pays a free hauler when a refinery FINISHES BUILDING, and a
      // scenario-placed structure arrives complete — so without this the lot is
      // a dock with nothing to dock at it. Cargo part full, because a lot that
      // has been running all morning has a hauler in the middle of a haul.
      b.spawnUnit('harvester', us, sorterAt.x + LANE.px * 16, sorterAt.z + LANE.pz * 16, {
        yawDeg: yaw, cargoFrac: 0.3,
      });

      b.addOre(
        sorterAt.x + LANE.px * lot.oreSide * LOT_ORE_OUT,
        sorterAt.z + LANE.pz * lot.oreSide * LOT_ORE_OUT,
        LOT_ORE,
      );
    }

    /* ==================================================================
     * 3. THE VALUATION DESK
     *
     * `civApartments` on SEAT 1 — the same def `reclamation.04.served-notice`
     * puts the district's record blocks in, `reclamation.05.closing-entry`
     * uses for the counting house and `reclamation.07.payment-in-kind` for
     * the Works' receiving office. Here it is somebody else's clerk sitting
     * at the top of our road writing down what we still have.
     *
     * Owned by the Allies, so `Targeting.isValidTarget` — which refuses only
     * ALLIES — accepts it as a target for the player's own guns. That is the
     * point: the secondary is that it goes, by either verb.
     * ================================================================== */
    const deskAt = place(them, 'civApartments', DESK);
    const deskId = b.spawnBuilding('civApartments', them, deskAt.x, deskAt.z, {
      yawDeg: yawTo(deskAt, HOME),
    });
    c.tag('desk', deskId);
    if (deskId !== NONE) b.block(deskAt.x, deskAt.z, DESK_CLEAR);

    /*
     * The two posts. `pillbox` is a ROLE key, so a change of `op.foe` still
     * gets that army's cheap emplacement — on an Allied seat `keyFor` hands the
     * key straight back, and that def's weapon is `pillboxMg`, 22 m with
     * `chainCount` 0, which is why
     * `tests/campaign-emplacement-reach.spec.ts` §2 is satisfied by the row
     * not chaining rather than by distance. They are in that spec's scope on
     * purpose: they cover the `desk` tag they stand beside, and covering the
     * objective is what an emplacement is for.
     *
     * An emplacement rather than a hull because `AiBrain.census` files every
     * AI-owned mobile hull into `armyIds` and `regroupSquads` marches it to
     * the rally point inside four seconds. A layout cannot opt out of that.
     * Concrete can.
     */
    for (const side of [-1, 1]) {
      const g = place(them, 'pillbox', {
        x: deskAt.x + LANE.px * side * 16 + LANE.nx * 10,
        z: deskAt.z + LANE.pz * side * 16 + LANE.nz * 10,
      });
      const gid = b.spawnBuilding('pillbox', them, g.x, g.z, { yawDeg: yawTo(g, HOME) });
      c.tag('guard', gid);
      if (gid !== NONE) b.block(g.x, g.z, 10);
    }

    /* ==================================================================
     * 4. NUMBERS ONE AND FOUR, ON SOMEBODY ELSE'S COMPOUND
     *
     * `civOreMine` — 700 hp, Concrete, 2x2, `Faction.Neutral` in the def
     * table and therefore carrying no `unlockedBy`, so no roster can refuse
     * one and `keyFor` does not remap it. Owned by SEAT 1, which is the whole
     * of what makes them a temptation: `Capture.resolve` takes a NEUTRAL
     * structure outright at any health for one engineer, and an ENEMY one
     * only at or below `CAPTURE.captureHpFrac` 0.50.
     *
     * UNGUARDED. See the header.
     * ================================================================== */
    for (const at of [TAKEN_ONE, TAKEN_TWO]) {
      const p = place(them, 'civOreMine', at);
      const id = b.spawnBuilding('civOreMine', them, p.x, p.z, { yawDeg: yawTo(p, HOME) });
      c.tag('taken', id);
      if (id !== NONE) b.block(p.x, p.z, TAKEN_CLEAR);
    }

    /* ==================================================================
     * 5. THE CLERKS ON THE COMPANY YARD
     *
     * Three Scrap Pickers on the near lot facing the road, so the yard reads
     * as staffed rather than as a shed with a marker over it.
     * `Stance.Defensive` is the only stance that means "on post" — fire at
     * anything in range, never leave position to start a fight — and they are
     * UNTAGGED, because the trigger table's only questions about this seat are
     * how much money is in the box and how many lots are still on the books.
     * ================================================================== */
    b.formation('rclPicker', us, home.x + LANE.nx * 26, home.z + LANE.nz * 26, 3, {
      yawDeg: yawTo(home, FOE), spacing: 4.5, columns: 3, stance: Stance.Defensive,
    });

    /* ==================================================================
     * 6. ORE, DRESSING AND THE OPENING FRAME
     *
     * NOT `addStartOre`. See the header: on this pair the map centre is
     * `lane(0.50, 0)` exactly, so its contested patch would sit in the middle
     * of the road four workings drive down. Both corner fields use
     * `addStartOre`'s own geometry, taken as a normalised difference rather
     * than off `facingDeg` through `Math.sin`/`Math.cos`.
     * ================================================================== */
    for (const s of [home, foeSpot]) {
      const dx = cx - s.x;
      const dz = cz - s.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(s.x + nx * 18 - nz * 44, s.z + nz * 18 + nx * 44, 30);
    }
    // A second field for the Allies, so their compound is not the only thing
    // between them and a stalled economy over twenty-one minutes.
    {
      const dx = cx - foeSpot.x;
      const dz = cz - foeSpot.z;
      const l = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
      const nx = dx / l;
      const nz = dz / l;
      b.addOre(foeSpot.x + nx * 58 + nz * 40, foeSpot.z + nz * 58 - nx * 40, 24);
    }

    // The opening frame: the company yard with the haul road and the first two
    // lots beyond it, so the first thing on screen is the estate the operation
    // is about to break up. `Shell.applyCameraPostBoot` re-poses on `findHome`,
    // which finds the Foundry; this is what the headless and `?shot=` paths
    // read.
    b.setCameraFocus(
      home.x + (LOT_TWO.x - home.x) * 0.35,
      home.z + (LOT_TWO.z - home.z) * 0.35,
    );
    b.scatter({ minX: cx - 180, minZ: cz - 180, maxX: cx + 180, maxZ: cz + 180 }, 150);
    void start;
  },
});
