/**
 * ============================================================================
 * R9 — BOOK VALUE
 * ============================================================================
 * R8 paid the Meridian's contra entry in kind, out of the lot pen, with the only
 * four Slaghurlers this yard will ever have — and Tallow's line on that winning
 * tick is the premise of this file: *"That is the first time the book has been
 * used against us and it will not be the last, and I would sign the copy again
 * tomorrow."*
 *
 * **SHE WAS RIGHT ABOUT BOTH HALVES AND THE SECOND HALF ARRIVED IN NINE DAYS.**
 * The bond's rule is that anything lodged may be read by anybody who asks, and
 * what R8 demonstrated to every party in the book is that the Reclamation
 * HONOURS what the book says about itself. A house that pays the first claim
 * against its own account invites the rest, and the rest came: four customers,
 * four contra entries off the same counterpart, every one of them written into
 * our own book as received, valued in our own hand, and correct. The total is
 * **twenty-two thousand credits**, payable at one counter this afternoon.
 *
 * **THE FIRM CANNOT FIGHT ANY OF IT AND WILL NOT TRY**, for R8's reason restated
 * at scale: a book honoured only when the arithmetic runs your way is an
 * unchecked book with extra steps, and R8 spent four artillery pieces
 * establishing the opposite. Nor can this one be paid in kind. The lot pen is
 * empty, the entries are in cash, and the yard holds two thousand.
 *
 * The other twenty is standing on the haul road in the form of three of the
 * company's nine breaking lots. A breaking yard's answer to needing money it
 * does not have is the only answer a breaking yard has ever had, and this week
 * it is pointed at itself.
 *
 * ============================================================================
 * WHY THIS IS `economy`, AND WHAT IT HAS TO DIFFER FROM — THREE OPERATIONS, NOT
 * ONE
 * ============================================================================
 * **THE TYPE REPEATS `reclamation.02.written-off` AND THAT IS DELIBERATE.**
 * `validateCampaign` refuses only ADJACENT repeats within a chapter, so at index
 * 9 against index 2 the constraint is content rather than the validator. Salvage
 * Rights is TEN operations long against every other chapter's nine, and the
 * chapter is a firm's year: it opens with an economy operation about EARNING —
 * a field the Soviets wrote off, made to pay — and it closes but one with an
 * economy operation about REALISING. That is the difference between a house that
 * is growing and a house that is settling, and it is worth a repeat rather than
 * a fourth shape nobody needed. `reclamation.08.contra-entry` is `race` and sits
 * immediately before this one, so the validator's adjacency rule is clear with
 * room to spare.
 *
 * Three shipped operations already read a `credits` threshold, and this one has
 * to differ from all three. It does, on the axis each of them fixed:
 *
 *   - **`reclamation.02.written-off` reads a PEAK.** Its primary fires the
 *     instant 16 000 is touched and ends the match there, and it has no
 *     deadline: the pressure is a Soviet base growing across the field. This one
 *     is read at EXACTLY ONE TICK, `elapsed(minutes(21))`, so a balance touched
 *     at minute twelve is worth nothing at all.
 *   - **`reclamation.05.closing-entry` reads a BALANCE YOU MUST NOT SPEND.** Its
 *     12 000 sits 7 000 UNDER a 19 000 ceiling and its own header says the bar
 *     is set so the sell hatch stays optional. Here the ceiling is the
 *     objective's opponent rather than its backdrop, and selling is not a hatch —
 *     it is the other primary.
 *   - **`soviets.09.nil-return` reads a BANK AGAINST A STATIC CEILING.** Its
 *     30 000 sits above a 15 000 ceiling that never moves, so the answer is ten
 *     silos bought once and the lesson is a build order. **HERE THE CEILING
 *     FALLS AS THE PLAYER EXECUTES THE OBJECTIVE**, because 8 000 of the 11 000
 *     of storage this seat opens with is four `rclSorter` and three of them are
 *     what the operation orders broken up. Same constant, opposite direction,
 *     and this one is dynamic.
 *
 * ============================================================================
 * THE TWO PRIMARIES ARE ONE SENTENCE READ ON ONE TICK
 * ============================================================================
 *     `lots`    `ownerCount(0, 'building', 'lot', max: 0)`   at `elapsed(CLOSE)`
 *     `settle`  `credits(0, min: 22000)`                     at `elapsed(CLOSE)`
 *
 * Numbers Three, Five and Eight off the company's books, and twenty-two thousand
 * in hand, at four o'clock. Neither is worth anything without the other, and the
 * reason they cannot be satisfied separately is arithmetic rather than authoring:
 * **the three lots ARE six thousand of the storage that holds the money**, so
 * executing one primary takes the box down through the other one's bar.
 *
 * **AN EARLIER DRAFT OF THIS SENTENCE ALSO SAID THEY WERE THE INCOME THAT PAYS
 * THE BILL, AND THAT HALF IS MEASURABLY FALSE.** Driven for the full 1 260 s
 * through the real `HarvesterController`, the real `Economy` and `OreField.regrow`
 * on the built world, seat 0 delivers **108 510 credits — 4.9x the bill — and is
 * pinned at its 21 000 ceiling from t+178.9 s**, wasting 89 510. Selling all
 * three Sorters at t+600 s costs 25 800 of DELIVERY (108 510 -> 82 710, because
 * the outlying haulers lose their docks) and exactly ZERO of BALANCE, because the
 * box was full before and after. Nothing in this operation is ever short of money;
 * it is short of somewhere to put it. See the ceiling section, which now carries
 * that measurement and the three things that were tried against it.
 *
 * **A BURNED LOT SATISFIES `lots` EXACTLY AS A SOLD ONE DOES, AND THAT IS NOT A
 * HOLE.** `ownerCount` cannot tell a sale from a demolition — `reclamation.05`
 * records the same limitation and says it "should not" — and here the two
 * readings are the operation's own title. A lot sold is a thousand credits in
 * the box; a lot burned is nothing in the box and the same two thousand off what
 * the box will hold. **The difference between book value and what a thing
 * fetches is the whole subject**, and it is measured below rather than asserted.
 *
 * That is also `reclamation.07.payment-in-kind`'s rule, turned around and served
 * on the Reclamation: *"whole if you can manage it and as scrap if you cannot —
 * the line is discharged either way and the only difference is what we are left
 * holding."* Tallow said that to Continental Works while the Reclamation was the
 * party doing the levying. This is the week she says it about her own plant, and
 * the echo in `t.orders` is deliberate.
 *
 * ============================================================================
 * THE CEILING, MEASURED IN A REAL `Economy` RATHER THAN REASONED
 * ============================================================================
 * `Economy`'s cap is `capFloor + structural`, `capFloor` starts at
 * `STORAGE_BASE` = **10 000** for every player whatever the opening bank is, and
 * `deposit` WASTES everything over the cap. Measured on the built world with the
 * def tables bound, seat 0's structural storage at tick zero is **11 000** —
 * four `rclSorter` at `REFINERY_STORAGE` 2 000 and two `rclHeap` at
 * `SILO_STORAGE` 1 500 — so the box holds **21 000 against a 22 000 bill**. The
 * company cannot hold the money it owes before it has started, and that is what
 * Cregg opens the third beat with.
 *
 * Three of those four Sorters are the lots. Break them up and structural falls
 * to 5 000. Everything below is a real `Economy` driven through the real
 * `recomputeStorage` and `deposit`, with the sell modelled exactly as
 * `Production.applySell` performs it — a bare `p.credits += round(cost * 0.5)`
 * through `Production.grant`, which does NOT route through `Economy.refund` and
 * therefore never lifts the floor — and the entity removed:
 *
 *     mine flat out with everything standing            21 000 / cap 21 000
 *     sell the three Sorters (+3 000)                   15 000 / cap 15 000
 *                                       ...and 9 000 CONFISCATED on the rescan
 *
 * **THAT IS THE NAIVE LINE AND IT ENDS 7 000 SHORT.** `recomputeStorage` raises
 * `capFloor` only when structural did NOT shrink; a sale that removes storage
 * skips the lift, so the cap collapses to `capFloor + structural` and the balance
 * is clamped into it and marked `CreditReason.Waste`. Nothing on screen explains
 * it — but the announcer does, because `audio.system.ts` says `silosNeeded` on
 * any `Waste`, which is why no scripted `eva` in this file narrates it.
 *
 * **THERE ARE THREE ANSWERS AND ALL THREE ARE MEASURED. THE CHEAPEST IS THE ONE
 * THIS COMPANY WOULD THINK OF FIRST.**
 *
 *     ROUTE A — SELL ONE THING THAT HOLDS NOTHING, AT A FULL BOX
 *       one 240-credit `rclFurnace` sold at 21 000     21 120 / cap 32 120
 *       then the three Sorters (+3 000)                24 120 / cap 26 120
 *     Structural did not shrink, so the rescan's no-shrink branch takes the
 *     WHOLE balance as the new floor and re-adds structural on top: the ceiling
 *     jumps by 11 120 for a building that refunds 120. It costs 80 of grid
 *     against a measured opening of +300, and it PAYS.
 *
 *     ROUTE B — BUY STORAGE FIRST
 *       heaps  3 (450 cr)   after the sale   19 500
 *              4 (600 cr)                    21 000
 *              5 (750 cr)                    22 500   <- the first that clears
 *              6 (900 cr)                    24 000
 *              7 (1 050 cr)                  25 500
 *     Five `rclHeap`, 750 credits and -50 of grid. The obvious answer, and the
 *     dearer one by a factor of six.
 *
 *     ROUTE C — DO THE SECONDARY LATE
 *       the desk's 1 200 landing at a full box        22 200 / cap 33 200
 *       then the three Sorters (+3 000)               25 200 / cap 27 200
 *     `ObjectiveDef.credits` pays through `Economy.grant` -> `refund` ->
 *     `liftFloorFor`, which re-bases `capFloor` on the whole balance — so the
 *     bounty ratchets exactly as a Furnace does. **ONLY IF IT LANDS AT THE
 *     CEILING**, which for a player who clears the desk in the first five
 *     minutes it will not. That is a real timing decision on a secondary and it
 *     is stated rather than hidden: clear it early for the cash flow, or late for
 *     the ceiling.
 *
 * **THE NAIVE LINE AND ROUTE A WERE BOTH DRIVEN IN THE ENGINE, NOT ONLY ON
 * PAPER.** Same rig as above — real `HarvesterController`, real `Economy`, real
 * `recomputeStorage` every `POWER_RECOMPUTE_INTERVAL` ticks, the three Sorters
 * removed at t+600 s and paid at `SELL_REFUND` 0.5 through a bare `credits +=`:
 *
 *     naive     sell the three Sorters at a full box, nothing else
 *                 -> 15 000 / cap 15 000, 9 000 confiscated, and the balance
 *                    NEVER MOVES AGAIN: 27 600 further credits are delivered
 *                    over the remaining eleven minutes and every one is wasted.
 *                    7 000 short, permanently, with a live economy.
 *     ROUTE A   one Furnace sold at the full box first (t+178.9 s)
 *                 -> 21 120, cap 32 120 at the next rescan; the three Sorters
 *                    then land 26 120 / cap 26 120. Clears the bar by 4 120.
 *                    The paper line above shows 24 120 because it sells the
 *                    Sorters the same second; the rig lets the box refill first
 *                    and it is clamped back to the same 26 120 either way. The
 *                    CAP is the answer, not the balance.
 *
 * **THE BAR IS A FLOOR AND NOT A KNIFE EDGE, WHICH IS `reclamation.05`'s STATED
 * PRINCIPLE AND THE RIGHT ONE HERE TOO.** Any one of the three routes clears
 * 22 000; the naive line that takes none of them misses it by 7 000. What the
 * bar refuses is a player who never noticed the ceiling — and they are told the
 * number at t+4 s, told that earning it is not the problem at t+20 s, told the
 * mechanism at t+38 s, told again by the announcer the first time a credit is
 * wasted, and told a third time at minute eighteen if they are still short.
 *
 * ============================================================================
 * THE ACCOUNT IS SETTLED EARLY AND NO NUMBER IN THIS FILE CAN CHANGE THAT — THE
 * THREE OBVIOUS FIXES WERE TRIED AND MEASURED
 * ============================================================================
 * **THE SHAPE OF THIS OPERATION IS A CEILING PUZZLE SOLVED ONCE, AT ABOUT MINUTE
 * THREE, AND THE FILE SAYS SO RATHER THAN CLAIMING A LATE-GAME ECONOMY IT DOES
 * NOT HAVE.** The measurement is the one above: 108 510 credits delivered against
 * a 22 000 bill, pinned at the ceiling from t+178.9 s of 1 260. From that tick
 * credits are FREE: at the measured 86 cr/s a five-thousand-credit purchase is
 * back in the box in 58 seconds, out of income that was going on the ground
 * anyway, so nothing bought after minute three is a cost — defence included.
 *
 * Three fixes were proposed for that and all three were driven in the same rig.
 * **None of them works, and the reasons are the reusable part:**
 *
 *   - **CUT THE OPENING PLANT SO INCOME KEEPS MATTERING.** Tried in both forms
 *     the layout can express. Dropping all three lot ore fields: **77 819
 *     delivered, pinned from t+297.5 s**. Retiring the three outlying haulers
 *     as well and leaving the base's own two: **52 110 delivered, pinned from
 *     t+424.1 s**, still 2.4x the bill and still two thirds of the match spent
 *     at the ceiling. A hauler on this map is worth 17 to 21 cr/s whatever it is
 *     given to work, so bringing 86 cr/s down to the bill's order needs ONE
 *     hauler, and each lot ships its own by `shipsWith`.
 *   - **RAISE THE BAR.** `rclHeap` is **1 500 of storage for 150 credits and
 *     carries no `UNLOCK_TAGS` id at all**, so no roster can withhold it —
 *     `roster` is an allow-list over TAGGED defs (trap 32). Any bar is therefore
 *     "buy `bar / 1500` Slag Heaps", affordable in full at minute four out of a
 *     box that is already overflowing, and the answer is `soviets.09.nil-return`'s
 *     build order, which is the one shape this operation exists not to repeat.
 *   - **SHORTEN `parSec`.** The bar is cleared at minute three whatever the close
 *     is, so a shorter par shortens the decided part and the undecided part in
 *     the same proportion. It also costs the four workings their spacing.
 *
 * **WHAT IS ACTUALLY LIVE FOR THE LAST SIXTEEN MINUTES IS THE CEILING ITSELF,
 * AND IT IS LIVE BECAUSE THE WORKINGS CAN TAKE IT OFF THE ESTATE.** ROUTE B ends
 * at 22 500 against a 22 000 bar — **500 of slack, one `rclHeap`** — and ROUTE A
 * at 26 120, which is two. Every `rclHeap` the fourth working levels is 1 500 off
 * the box and every Sorter is 2 000, and at a full box the same rescan that
 * shrinks the cap confiscates the difference on the spot. That is the tension
 * this file is entitled to claim, it is about STRUCTURES rather than about money,
 * and the beats and the roster block are written to it.
 *
 * ============================================================================
 * THE ENEMY IS NOT HERE TO TAKE ANYTHING
 * ============================================================================
 * `foe: Faction.Allies`, and the motive is already written down in
 * `reclamation.06.in-duplicate`'s header: *"A counterpart lodged in a bonded
 * store is a DEBT — it converts Survey 26-511's twice-sold lot and the whole of
 * the delivery book into things the Allies owe rather than things somebody
 * alleges."* They owe more under that book than anybody. A Reclamation that
 * DEFAULTS on an account its own book produced makes the book an anecdote again
 * and every entry in it contestable — including theirs, and theirs is the
 * largest. That is worth more to them than any yard on this road, and it is why
 * they are not trying to take one.
 *
 * So the workings are not a raid and Ardle says so on the first one. **Every
 * credit of value they destroy before it can be realised is a credit the
 * settlement is short**, and the arithmetic is exact: a lot they burn costs the
 * player 1 000 of refund AND 2 000 of ceiling, and if the box is full at that
 * moment the same rescan that shrinks the cap confiscates 2 000 out of the box
 * on the spot. That is the same clamp ROUTE B measures, with the refund removed.
 *
 * Four workings off `ROAD`, at minutes four, eight, twelve and sixteen, and the
 * escalation is in the TARGET rather than in the weight:
 *
 *     minute four       gi x4, grizzly x2   -> attack-move NUMBER THREE
 *     minute eight      gi x4, grizzly x3   -> attack-move NUMBER FIVE
 *     minute twelve     gi x4, grizzly x3   -> attack-move NUMBER EIGHT
 *     minute sixteen    gi x4, grizzly x3   -> attack-move THE COMPANY YARD
 *
 * Twenty-seven hulls, **10 900 credits** (`gi` 200, `grizzly` 700), and the
 * target order is the one the GROUND puts the three lots in: nearest first from
 * the ground they form up on. Measured by Dijkstra over the real
 * `FlowFieldCache.costGridFor` on the built world from `ROAD` (347.65, 160.95),
 * each wave against its own move class:
 *
 *                          Three   Five   Eight   the yard
 *       straight line     166.66  217.78  255.47    324.68
 *       Foot   (`gi`)     185.6   225.3   278.9     346.6   -> 58.0 s .. 108.3 s
 *       Track (`grizzly`) 184.5   225.6   277.8     345.5   -> 28.0 s ..  52.3 s
 *
 * at `gi` 3.2 m/s and `grizzly` 6.6 m/s. **Those seconds are floors rather than
 * arrivals** — a wave forms up on a ring rather than at the point, and a flow
 * field is not a straight run — but they are taken over the route the engine
 * really produces, which the previous version of this block was not: it divided
 * the STRAIGHT LINES by the same speeds and published 52.1 / 101.5 for a `gi`
 * and 25.3 / 49.2 for a `grizzly`, against 58.0 / 108.3 and 28.0 / 52.3 over the
 * ground. The route to Number Three is 10.7% longer than the ruler says.
 *
 * **THE RINGS ARE CHECKED, NOT SAMPLED.** `EffectSink.spawnUnits` writes the
 * computed point VERBATIM — no `connectedGround`, no egress search — and lays a
 * wave on an exact ring at `angle = i / count * 2pi`, so a drop on closed ground
 * is a hull that starts the fight wedged. Every drop of every ring against its
 * own locomotor on the built world, clearance being the distance to the nearest
 * cell that locomotor cannot enter:
 *
 *     gi      x4  r=12  Foot     open, clearances 20 / 20 / 8 / 12 m
 *     grizzly x2  r=18  Track    open, 12 / 8
 *     grizzly x3  r=18  Track    open, 12 / 24 / 4
 *
 * — three distinct rings, nine distinct drop points, twenty-seven drops, all
 * open, worst clearance 4 m. `tests/campaign-spawn-ground.spec.ts` is the
 * standing gate and **a change to any `count` or `spread` invalidates this**,
 * because a wave of three does not stand where a wave of two does.
 *
 * The scripted workings are not the whole of the pressure. Both seats open on
 * `map.credits` and the Allies hold two `civOreMine` — 600 credits a minute, see
 * below — on top of a base with two harvesters and 46 612 credits of ore on
 * their own corner.
 *
 * ============================================================================
 * NUMBERS ONE AND FOUR, AND WHAT REFUSING THEM COSTS
 * ============================================================================
 * The secondary `held` is the operation's ethic priced in credits, and it is a
 * SECONDARY rather than a primary on purpose. A rule the player cannot break is
 * a wall; a rule they can break for a measurable gain is a decision, and this
 * chapter's whole argument is that the decision is commercial.
 *
 * Two `civOreMine` stand on the Allied compound at 256.56 and 282.84 m from the
 * company yard in a straight line, tagged `taken`, **unguarded** — measured over
 * all five armed enemy structures on the built world, the nearest gun to either
 * of them is **68.41 m of centre distance**, i.e. 62.75 m of SURFACE for a 2 x 2
 * `civOreMine` (`hitRadius` 5.657) against a `pillbox`'s acquisition envelope of
 * `22 x COMBAT_TARGETING.acquireRangeMul 1.08` = 23.76 m. They are Numbers One
 * and Four, lifted off this siding in the spring and credited against the account
 * at scrap, which is precisely why there is still twenty-two thousand to find.
 *
 *     `CIVILIAN_MINE_INCOME`  5 credits / 30 ticks, `payHolders` in
 *     `src/sim/civilian.system.ts`, to ANY holder whose faction is not Neutral
 *
 * So the two of them PAY THEIR HOLDER **600 credits a minute — 7 800 over the
 * thirteen minutes that follow a capture at minute eight, a third of the bill on
 * paper.** What the player RECEIVES for taking them is a different number.
 *
 * **THAT 7 800 IS A DENIAL AND IT IS NOT A WAGE, AND THE DIFFERENCE IS THE WHOLE
 * HONEST PRICE OF THE DECISION.** `payHolders` calls
 * `economy.deposit(owner, credits, CreditReason.Bounty)` under its own comment
 * *"`deposit`, not `grant`: this is income and it honours the storage cap"* — so
 * it lands in a capped box, exactly as a harvester load does. Seat 0 is measured
 * **pinned at its 21 000 ceiling from t+178.9 s** and stays there (see the
 * ceiling section), and at the ceiling a deposit banks NOTHING. Driven for
 * thirteen minutes in a real `Economy` on this world, two `civOreMine` on a
 * player standing at the cap bank **0**; the same thirteen minutes with an empty
 * box bank exactly **7 800**. The 7 800 is the HEADROOM figure, not the received
 * one, and an earlier version of this block published it as a player-side gain.
 *
 * What the play is actually worth, then, is what it takes OFF the other side —
 * and that half is bounded rather than pinned. Seat 1's own structural storage
 * on the built world is 5 000 (`refinery` 2 000 plus two `oreSilo` at 1 500), so
 * their box is 15 000, and **whether they have room in it is NOT measured here**:
 * this rig runs no `AiBrain`, and a seat that never spends fills any box. So the
 * honest statement of the secondary's price is that it denies the Allies UP TO
 * 600 credits a minute, pays the player nothing for as long as they stand at
 * their own ceiling, and costs the medal. That is a fair thing for a secondary
 * to be worth and a dishonest thing to advertise as cash.
 *
 * The price of the play is one right-click's worth of engineer work:
 * `Capture.resolve` flips an ENEMY structure at or below
 * `CAPTURE.captureHpFrac` 0.50, a `civOreMine` is 700 hp of
 * `ArmorClass.Concrete`, and the four `rclGrinder` this seat opens with deliver
 * `4 x 70 x ARMOR_MATRIX[Tesla][Concrete] 0.60 x COMBAT_DAMAGE.globalMul 0.80 /
 * 1.90` = 70.7 dps, i.e. 350 hp in **4.95 s**, after which one 500-credit
 * `rclTinker` walks in — and this seat opens holding one. (`Capture.resolve`
 * writes `st.hp` on its FRIENDLY branch only, so each mine arrives on the
 * player's books at or under 350 of 700 — trap 22. Nothing in this operation
 * measures a captured structure's survivability, and no threshold reads its
 * health: `held` is an ownership count on SEAT 1.)
 *
 * **SO THE COST OF BEING THE FIRM WHOSE BOOKS MEAN SOMETHING IS SIX HUNDRED
 * CREDITS A MINUTE OFF THE OTHER SIDE AND AN EASIER AFTERNOON, AND THE ONLY
 * THING THAT PAYS IT BACK IS THE MEDAL.** `medalFor` returns silver only when every secondary is
 * complete. That is the correct size for this decision and it is why the
 * threshold is `ownerCount(1, 'building', 'taken', min: 2)` rather than
 * `entityDead`: seat 1's own count catches CAPTURE and DEMOLITION with one
 * condition, and a corpse count would have caught only the second — a captured
 * structure is still alive, which is trap 9 and the reason five shipped
 * operations were migrated off `entityDead`.
 *
 * **GARRISON IS NOT A THIRD ROUTE HERE, AND IT WAS WORTH CHECKING RATHER THAN
 * ASSUMING.** `GarrisonService.enter` does call `captureBuilding()` directly and
 * consults no `CaptureService` veto — that is `allies.07.fair-copy`'s finding and
 * it is why `reclamation.06.in-duplicate` had to think about it — but both halves
 * of that path are gated on the host being NEUTRAL. `refusalFor` returns
 * `'hostile'` for a structure that is neither Neutral nor allied, and the
 * flag-raising branch inside `enter` tests `ownerPlayer.faction ===
 * Faction.Neutral` besides. These two lots are on SEAT 1, so a squad cannot walk
 * into them at all.
 *
 * `captureProof` is deliberately NOT declared. There is no protect-target here:
 * every structure the trigger table names is either the player's own or a thing
 * they are being asked to leave alone, and a veto would turn a priced decision
 * into a refusal.
 *
 * ============================================================================
 * THE VALUATION DESK
 * ============================================================================
 * `desk` is the only secondary that pays, and it pays **1 200 credits** into the
 * same bank the primary reads — a secondary that is literally part of the
 * settlement, which is as on-brand as this chapter gets.
 *
 * **THE 1 200 IS AUTHORED AND NOT DERIVED, AND SAYING SO IS THE HONEST MOVE.**
 * Nothing in the def tables prices a civilian structure — `civApartments`
 * carries no `cost` a refund could be taken from — so there is no arithmetic to
 * show, and inventing one for a number the tables cannot produce would be worse
 * than the admission. It is a shade over five percent of the bill, which is what an
 * eight-hundred-hit-point field office and two gun positions are worth to a yard
 * that breaks things up for a living.
 *
 * It is `ownerCount(1, 'building', 'desk', max: 0)`, so it counts by EITHER
 * verb — trap 9's spelling — and capturing it is a legitimate route, because the
 * desk is standing on the player's own haul road and taking possession of your
 * own road back is not a levy. It does not touch `held`: that threshold reads
 * `taken` and nothing else.
 *
 * ============================================================================
 * THE ROSTER
 * ============================================================================
 * `player: ['unit.raider']`, `ai: []`.
 *
 * The Arcspitter is carried forward from every operation in this chapter, and it
 * is also what the base's own two `ifv` resolve to through `keyFor`, so deleting
 * the id would delete two hulls from the opening as well as the cameo.
 *
 * **WHAT THE PLAYER'S LIST WITHHOLDS IS THE MILITARY ANSWER, WHICH IS THE
 * POINT.** No `struct.tech`, so no `rclCrucible` — and therefore no
 * `rclSlaghurler`, whose own blurb is *"The only thing in the army that can
 * break a base"*. No `struct.defence.specialist`, so no `rclPylon` at 1 450
 * credits and -90 of grid; the defence of this estate is `rclSpitpost` at 420
 * and `power: 0`. No `struct.support`, no `unit.air`, no `unit.commander`. A
 * player who wants to answer a bill by flattening the creditor is denied the
 * tools by the same list that leaves the wrench, the heaps and the sell button.
 *
 * **WHAT THE LIST DOES NOT DO IS MAKE DEFENCE EXPENSIVE, AND THIS BLOCK USED TO
 * CLAIM IT DID** — *"every credit of it comes off the number the player is
 * judged on"*. Measured, seat 0 is pinned at its ceiling from t+178.9 s and
 * delivers 108 510 credits over the match against a 22 000 bill, so a
 * 420-credit Spitpost bought after minute three is refilled out of income that
 * was going on the ground anyway and costs the judged number nothing whatever.
 * What the roster withholds is the ability to answer the workings by ENDING
 * them, not the money to try; and what a working can still take is the ceiling,
 * which is the one thing the player cannot buy back faster than the clock. See
 * the ceiling section.
 *
 * **THE EMPTY `ai` LIST KEEPS `prismTower` OFF THIS GROUND.** `ALLIED_DEFENCE`
 * seeds one at the Allied start; `prismTowerBeam` is 34 m and 101.2 per pull
 * against Infantry, which is more than an 85 hp `rclPicker` or `rclTinker`
 * carries. Measured on the built world with this roster installed, the armed
 * enemy structures are **`pillbox x5`** — three from the Allied opening and the
 * two beside the desk — and `pillboxMg` carries `chainCount` 0, so
 * `tests/campaign-emplacement-reach.spec.ts` §2 is satisfied by the row not
 * chaining at all rather than by distance. It also withholds `battleLab` and the
 * garrison's two `ifv`.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS
 * ============================================================================
 * `annihilationWin` because flattening an Allied establishment settles nothing —
 * the account is with the holder of the counterpart and not with the army on the
 * road, and the player is denied the one hull that could do it in any case.
 * `assetLossDefeat` because of the ending below, which is reachable and
 * deliberate.
 *
 * **A PLAYER CAN BE BEATEN AND STILL WIN, AND THIS FILE ALLOWS IT ON PURPOSE.**
 * `t.rout` is `playerBeaten(0)` conjoined with `SHORT`, so a commander who is
 * standing in a smoking hole at minute nineteen with twenty-two thousand in hand
 * and every lot already off the books is NOT ended — and at four o'clock
 * `t.win` pays the account. `Viability.isBeaten` asks whether you can still play;
 * this operation asks whether you can still pay, and they are not the same
 * question. It is the chapter's thesis at its most extreme and it is exactly
 * where R10 has to start.
 *
 * The ending is total by construction and partitions on ONE tick.
 * `elapsed(minutes(21))` is `parSec` to the second — the identification
 * `reclamation.03`, `.04`, `.05` and `.07` all make — and at that tick the three
 * arms are `SHORT`, `IN_FUNDS and no lots left`, and `IN_FUNDS and lots left`.
 * `max: 0` and `min: 1` over one count partition every world state, which is
 * `reclamation.05`'s argument and the reason the complement is spelled that way
 * rather than as a number. `SHORT` is a `not` over the win's own `credits`
 * condition for `reclamation.05`'s other reason: `PlayerState.credits` is a
 * FLOAT, so `min: 22000` and `max: 21999` are not complements and a balance of
 * 21 999.5 would satisfy neither and never end the match.
 *
 * ============================================================================
 * EVERY ENDING WAS DRIVEN THROUGH THE REAL `runDirector`, AND IT CHANGED THE
 * FILE TWICE
 * ============================================================================
 * TEN scripted worlds fed to the shipped Director at 30 Hz against a stub
 * `WorldQuery` whose objective map IS `state.objectives` — the same map
 * `CampaignSession.setObjective` writes and `objectiveComplete` reads back,
 * because a harness that keeps its own copy measures a different game
 * (`reclamation.07.payment-in-kind` records exactly that mistake). The final
 * state of all four rows, and the medal, taken off `medalFor` at difficulty 1:
 *
 *     clean         desk 240 s, lots sold 1 180-1 250 s, 23 400 at the close
 *                     -> WIN, all four complete, SILVER
 *     naive         lots sold at 600 s with no heaps and no ratchet, clamped to
 *                     15 000 -> `settle` failed, LOSS naming `settle`
 *     encumbered    24 000 in hand and Number Five still standing -> `settle`
 *                     complete, `lots` failed, LOSS naming `lots`
 *     burned        all three destroyed by minute nine -> `lots` complete,
 *                     short at the close, LOSS naming `settle`
 *     greedy        both `taken` captured at 480 s -> `held` failed there,
 *                     WIN, BRONZE
 *     collision     the last lot sold ON the closing tick -> ONE ending beat,
 *                     WIN, SILVER
 *     rout          beaten at 700 s while short -> LOSS, and all four rows
 *                     resolved on that same tick
 *     solvent rout  beaten at 700 s holding 22 000 with no lots -> NOT ENDED,
 *                     wins at 1 260 s, BRONZE
 *     desk late     desk cleared at 1 259 s -> `desk` complete and paid at
 *                     1 259, still 300 short at 1 260, LOSS
 *     taken late    a `taken` lot changes hands ON the closing tick -> the
 *                     silent arm fails `held`, WIN, BRONZE
 *
 * **EVERY ONE OF THE TEN ENDS ON EXACTLY ONE BEAT AND ONE `endOperation`**, and
 * that is what the guards are for. Trigger order decides BEAT ORDER and nothing
 * else — `runDirector` collects the effects of every trigger whose condition
 * holds and `CampaignSession.apply` runs the whole list — so every trigger that
 * carries dialogue and could be true on a deciding tick carries `not(DECIDED)`,
 * and a silent arm that resolves its objective there is what replaces it.
 *
 * **THE `rout` ROW CHANGED THE FILE.** With the silent arms guarded on `CLOSED`
 * alone it ended at t+700 s with `lots`, `desk` and `held` all reading ACTIVE —
 * three undecided rows on a defeat screen that was not going to change, one of
 * which was in fact complete. `DECIDED` is that finding; see its own block, and
 * note that the `solvent rout` row is what stops the fix from firing too early.
 *
 * **THE `greedy` ROW IS THE TERMINAL-STATE GUARD OBSERVED RATHER THAN ASSUMED.**
 * `t.heldTaken` fails `held` at 480 s and the silent `t.heldLost` names it again
 * at the close; the harness logged the second one as REFUSED, because
 * `CampaignSession.setObjective` returns early on both `complete` AND `failed`.
 * That is what makes the pair safe to write in either order.
 *
 * **THE HONEST BOUND ON A NON-ENDING TICK IS TWO BEATS FROM TWO SPEAKERS PLUS AN
 * `eva`**, and three of the ten rows produce it: the script clears the desk at
 * exactly 240 s, which is the tick the first working lands, so Ardle's arrival
 * and Cregg's *"desk is off the road"* share it. It is a coincidence of the
 * harness rather than a property of the operation — nothing schedules those two
 * together — but it is the measured worst case and it is stated rather than
 * rounded down to one.
 *
 * ============================================================================
 * WHAT WAS CONSIDERED AND CUT
 * ============================================================================
 *   - **MAKING THE SALE ITSELF THE OBJECTIVE.** `ownerCount` cannot tell a sale
 *     from a demolition, and no condition in the frozen vocabulary can. Rather
 *     than fake it with a proxy, the operation makes the DIFFERENCE the subject:
 *     both readings satisfy `lots`, and only one of them pays.
 *   - **A WINDOW INSTEAD OF A TICK** — the counter open from minute fifteen, the
 *     win the first tick inside it that both primaries hold. Read at one tick,
 *     the player must still be SOLVENT at four o'clock, which is what keeps the
 *     last working's attack on the yard a threat to a bank that is already big
 *     enough; with a window they bank once and stop playing. An earlier version
 *     of this entry also claimed the one-tick read makes running the lots into
 *     the fourth working the optimal line. **It does not, and the measurement is
 *     in the ceiling section**: selling all three at minute ten costs 25 800 of
 *     delivery and nothing at all of balance, because the box is full either way.
 *     What the one-tick read buys is the solvency requirement, not a timing game
 *     about income.
 *   - **PUTTING THE `taken` RESTRAINT ON A PRIMARY.** It would make the chapter's
 *     ethic a rule instead of a price, and the brief for this slot is that the
 *     interesting answers here are commercial. Measured, the play denies the
 *     Allies up to 7 800 credits and pays the player 0 while they stand at their
 *     own ceiling — see the `held` block — so it is a levy on the opponent and a
 *     medal on the player. A primary would say it is worth the match, which is a
 *     different and much less honest claim.
 *   - **A SCRIPTED `silosNeeded`.** `soviets.09.nil-return` scripts it because
 *     its ceiling problem exists at t = 0 and nothing will ever waste a credit
 *     until the player has already lost. Here the waste IS the event —
 *     `audio.system.ts` says the line on any `CreditReason.Waste`, and this
 *     operation manufactures one — so scripting it would narrate what the
 *     announcer is about to say anyway, which is the case `types.ts` warns
 *     against. The one scripted `eva` in this file is `forcesUnderAttack`, fired
 *     BEFORE the first working is in contact.
 *   - **FOUR LOTS RATHER THAN THREE.** Three rhymes with the three gantries R7
 *     levied off the Works, which is the point of the operation, and each extra
 *     lot is another station to sweep, another spawn target and another 2 000 of
 *     ceiling to model. The arithmetic works at four; the chapter does not.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  DESK_AREA, LOT_ONE, LOT_THREE, LOT_TWO, ROAD, SIM_SEED, TAKEN_AREA, TAKEN_ONE, YARD,
} from '../../layouts/reclamation-book-value';

/**
 * How long the layout is given to have placed the estate before a zero threshold
 * over it is believed.
 *
 * **EVERY `max:` THRESHOLD THAT CAN FIRE BEFORE THE CLOSE IS CONJOINED WITH
 * IT.** `ownerCount(..., max: 0)` reads TRUE against an empty tag registry,
 * exactly as `entityDead` does — the spelling changed and the hazard did not.
 * Unguarded, `t.deskDone` would pay 1 200 credits on the first tick the Director
 * runs and `t.heldTaken` would fail the secondary on the same one.
 *
 * **IT GUARDS A LAYOUT THAT PLACED NOTHING, NOT A TICK-ONE READ THAT HAPPENS
 * TODAY.** `scenarios.system.ts` builds the world inside `async init()` and
 * `SystemRegistry.init` awaits every module's init before a tick is taken, so
 * the registry is never empty when the Director first runs. What IS reachable is
 * a roster typo or a footprint that will not fit, which
 * `tests/campaign-roster-ground.spec.ts` and `tests/campaign-maps.spec.ts` catch
 * at their causes; this stops the symptom being instant.
 *
 * The three thresholds read at `CLOSE` need no such guard and do not carry one:
 * `elapsed(minutes(21))` is sixty-three times this.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The close of the counter. EXACTLY `parSec`, to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation —
 * `reclamation.03.sold-twice` sets the same relationship at 900,
 * `reclamation.04.served-notice` at 960, `reclamation.05.closing-entry` at 1020
 * and `reclamation.07.payment-in-kind` at 1140.
 */
const CLOSE = minutes(21);

const CLOSED: Condition = { on: 'elapsed', ticks: CLOSE };

/**
 * The bill.
 *
 * 22 000 against a measured opening ceiling of 21 000 and a measured opening
 * bank of 2 000. See the header: the naive liquidation lands 7 000 under it and
 * each of the three answers clears it. It is a floor rather than a knife edge,
 * which is `reclamation.05.closing-entry`'s stated principle for a bank primary.
 */
const BAR = 22_000;

const IN_FUNDS: Condition = { on: 'credits', player: 0, min: BAR };

/**
 * ITS NEGATION, SPELLED AS A `not` RATHER THAN AS `max: BAR - 1`.
 *
 * `PlayerState.credits` is a float: `Economy.deposit` adds `ore * ORE_VALUE` off
 * a harvest that accumulates in `SIM_DT` steps, and nothing anywhere pins the
 * running total to an integer — so `min: 22000` and `max: 21999` are NOT
 * complements, a balance of 21 999.5 satisfies neither, and at the close that is
 * an operation that never ends. A `not` over the same condition partitions
 * exactly, at every value, forever. `reclamation.05.closing-entry` records the
 * same reasoning for the same reason.
 */
const SHORT: Condition = { on: 'not', of: IN_FUNDS };

/** Numbers Three, Five and Eight are all off the company's books. */
const LOTS_CLEAR: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'lot', max: 0,
};

/**
 * Its exact complement.
 *
 * `min: 1` and `max: 0` over one count partition every world state, so the win,
 * the encumbered loss and the short loss cannot overlap and cannot all be false.
 * `reclamation.05.closing-entry` draws the same pair for the same reason.
 */
const LOTS_LEFT: Condition = {
  on: 'ownerCount', player: 0, role: 'building', tag: 'lot', min: 1,
};

/** Numbers One and Four are both still on the Allies' books. */
const HELD: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'taken', min: 2,
};

/**
 * Either of them is not.
 *
 * `max: 1` on SEAT 1 catches capture AND demolition with one condition, which is
 * the whole reason the threshold is not `entityDead` — a captured structure is
 * still alive, so a corpse count would see only half of it. Garrison is not a
 * third route on a seat-1 host; the header measures why.
 */
const TAKEN_GONE: Condition = {
  on: 'ownerCount', player: 1, role: 'building', tag: 'taken', max: 1,
};

/**
 * The tick this operation is decided on, whichever it turns out to be.
 *
 * `CLOSED`, or the state `t.rout` ends the match in. **IT EXISTS BECAUSE OF WHAT
 * DRIVING THE REAL `runDirector` PUT ON A DEFEAT SCREEN**: with the silent arms
 * guarded on `CLOSED` alone, a rout at minute twelve ended the operation with
 * `lots`, `desk` and `held` still reading ACTIVE — three undecided rows on a
 * screen that is not going to change, one of which was in fact complete.
 *
 * **THE `SHORT` IN THE SECOND ARM IS LOAD-BEARING AND IT IS NOT COSMETIC.**
 * `playerBeaten` alone would resolve every row the moment a solvent commander
 * lost their last hull — and that is the one state this operation deliberately
 * lets run to the close, because the money is already in the box and `t.win`
 * pays it at four o'clock. Failing `desk` there would take a secondary off a
 * player who can still clear it.
 */
const DECIDED: Condition = {
  on: 'any',
  of: [CLOSED, { on: 'all', of: [{ on: 'playerBeaten', player: 0 }, SHORT] }],
};

const op: OperationDef = {
  id: 'reclamation.09.book-value',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * THE ALLIES, AND THE MOTIVE IS ALREADY IN THE CHAPTER IN WRITING.
   *
   * `reclamation.06.in-duplicate`'s header derives it: a counterpart in a bonded
   * store converts the twice-sold lot and the whole delivery book into things
   * the Allies OWE rather than things somebody alleges. A Reclamation that
   * defaults on the first account its own book produces against itself makes
   * every entry contestable again, and they are the party with the largest
   * balance under it. They are not here for a yard.
   *
   * It is the chapter's fourth operation against them — R3, R4, R6 and this —
   * against three Soviet and one Meridian, and it is the only one in which they
   * want the player to LOSE MONEY rather than lose ground.
   *
   * Every scripted key on seat 1 is a literal Allied `gi` or `grizzly`, which
   * `validateCampaign` checks against the army of the seat it lands on.
   */
  foe: Faction.Allies,
  index: 9,
  title: 'Book Value',
  beat: 'The account is twenty-two thousand and the yard is worth it on paper. The counter does '
    + 'not take paper.',
  /*
   * ECONOMY, AND IT IS THE CHAPTER'S SECOND. See the header for the argument:
   * `validateCampaign` refuses only ADJACENT repeats, Salvage Rights runs to ten
   * against everybody else's nine, and R2 earning against R9 realising is the
   * difference the repeat is for.
   */
  primaryType: 'economy',
  /*
   * BESPOKE. Objective state in all three directions, four spawn waves with
   * orders, two reveals, a camera move, dialogue, EVA and an outcome — the
   * definition in `types.ts` is "multiple effect kinds", and this is TEN of the
   * eleven. Only `grantCredits` is unused, and deliberately: the one payment in
   * this operation goes through `ObjectiveDef.credits`, which is the same
   * `Economy.grant` on a rail `state.paid` keeps from paying twice across a
   * reload.
   */
  archetype: 'bespoke',
  parSec: 1260,
  requires: ['reclamation.08.contra-entry'],

  map: {
    /*
     * TEMPERATE ON BOTH LINES, WHICH IS THE ONE PAIRING THAT CANNOT MAKE R3's
     * MISTAKE. `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and
     * `urban` and disagree on exactly one name — the preset is `arid`, the biome
     * is `desert` — and `reclamation.03.sold-twice` shipped on the wrong side of
     * that and measured two headers' worth of numbers against ground it had not
     * declared. This pair is the same word twice.
     *
     * `urban` was the first choice — the flattest ground in the roster, and its
     * preset name is *Industrial Grid*, which is what a works district is — and
     * it lost on the sweep. Seven specific points have to be buildable and
     * standable here, and a whole-map buildable fraction is not that question.
     * See the layout's header for the forty-eight rolls and for the one column
     * `place()` cannot fix afterwards. It also keeps this operation off
     * `reclamation.08.contra-entry`'s preset, which is the one immediately
     * before it.
     */
    preset: 'temperate',
    /**
     * The survey designation. 12-808 is the number in the briefing and it is the
     * seed the layout swept for: of forty-eight rolls across two presets, scored
     * against the seven stations this composition needs, it is the one with the
     * lowest total ring search whose stations all sit inside the wheeled region
     * and whose forming-up point needs no search at all. See the layout's header
     * for the table.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this ground moves every measured placement
     * in both headers.
     */
    mapSeed: 12_808,
    /*
     * IMPORTED FROM THE LAYOUT, WHICH OWNS IT.
     *
     * `simSeed` decides which two corners the match is played in, and every
     * point the trigger table below names is computed from exactly that in
     * `reclamation-book-value.ts` — out of `seatedSlots`,
     * `SKIRMISH_START_OFFSETS` and `MAP_SIZE`, at module load, arithmetic rather
     * than measurement. Writing the number here as well would be the same fact
     * in two files, and the failure mode — a working forming up where nobody
     * authored one, a lot standing off the road it is supposed to be on — is
     * invisible to every gate.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'temperate',
    /*
     * `base`. The objective IS the bank, so the player needs the thing that
     * mines and the thing that spends, and the three outlying lots the primary
     * is written over are structures rather than a starting force.
     */
    opening: 'base',
    /*
     * 2 000, AND IT IS THE FIRST NUMBER IN THE BRIEFING FOR A REASON.
     *
     * The bill is 22 000 and the box holds 21 000. Two thousand in hand against
     * both of those is the gap the operation is made of, and it is deliberately
     * a tenth of the bill rather than a token: it buys five `rclHeap` and a
     * `rclSpitpost` with change, which is exactly the opening decision.
     *
     * `Shell.applySimPostBoot` writes `startingCredits` into every non-Neutral
     * slot, so the number binds the Allies too — a fifth of the skirmish default
     * for CLAUDE.md's measured reason: a brain with a 10 000 opening puts up a
     * seven-building base and eleven troops by t+90 s having mined nothing. What
     * it does NOT do is starve them, because two `civOreMine` on their books pay
     * 600 credits a minute from the first tick, on top of two harvesters and
     * 46 612 credits of ore on their own corner.
     */
    credits: 2_000,
  },
  layout: 'reclamation-book-value',

  // NEITHER SHIPPED RULE MAY END THIS. See the header — `assetLossDefeat` in
  // particular, because "beaten and still solvent" is an ending this operation
  // deliberately lets stand to the close.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    player: ['unit.raider'],
    ai: [],
  },

  /*
   * FOUR OBJECTIVES, ONE HIDDEN, AND THE PANEL SHOWS THREE.
   *
   * `MAX_VISIBLE_OBJECTIVES` in `ui/Objectives.ts` is 3, so from the moment
   * `t.terms` reveals `held` at t+56 s the fourth row is counted into the
   * "+N more" line until the player expands the panel. `pact.02.long-count`
   * declares four for the same reason and `types.ts` records that the cap is
   * authoring guidance rather than a rule. The two primaries and the paid
   * secondary are the three that matter minute to minute; `held` is a rule about
   * not doing something, which is the right row to have to expand for.
   */
  objectives: [
    {
      id: 'settle',
      kind: 'primary',
      /*
       * "BE HOLDING", NOT "RAISE". `WorldQuery.creditsOf` reads
       * `world.players[p].credits` — what is in hand at that instant — and the
       * read happens at exactly one tick, so every credit spent before four
       * o'clock is gone from the answer and a peak touched at minute twelve is
       * worth nothing. A title saying "raise" would describe
       * `reclamation.02.written-off`'s rule instead of this one.
       *
       * NO `credits` FIELD, AND IT COULD NOT HAVE ONE — this is a primary and
       * `validateCampaign` refuses a paid primary at import. Worth stating
       * anyway, because a reward paid on THIS objective would be paid into the
       * very balance it reads.
       */
      title: 'Be holding twenty-two thousand credits when the counter shuts',
    },
    {
      id: 'lots',
      kind: 'primary',
      /*
       * "OFF OUR BOOKS", NOT "SELL". `t.lotsDone` counts what seat 0 still owns,
       * and `ownerCount` cannot tell a sale from a demolition — so a title
       * saying "sell" would name a route the rule does not require and would be
       * a lie in the case the Allies are working towards. What selling buys is
       * the other primary, and the briefing says so.
       */
      title: 'Clear the three outlying lots off our books by the close',
    },
    {
      id: 'desk',
      kind: 'secondary',
      /*
       * "CLEAR … OFF", so the title covers both verbs the rule accepts —
       * `ownerCount(1, ..., max: 0)` is satisfied by breaking the desk up and by
       * taking it, and taking it is legitimate here because the desk is standing
       * on the player's own haul road.
       */
      title: 'Clear their valuation desk off our haul road',
      /*
       * THE ONLY PAYMENT IN THE OPERATION, AND IT LANDS IN THE BANK THE PRIMARY
       * READS. `ObjectiveDef.credits` pays through `Economy.grant` -> `refund`
       * -> `liftFloorFor`, so at a full box it also RATCHETS the ceiling by the
       * whole balance plus structural — which makes clearing the desk late a
       * different move from clearing it early. See the header's ROUTE C.
       */
      credits: 1_200,
    },
    {
      id: 'held',
      kind: 'secondary',
      hidden: true,
      /*
       * "ON THEIR OWN BOOKS" IS AN OWNERSHIP CLAIM AND THE RULE IS AN OWNERSHIP
       * COUNT, which is the pairing trap 23 exists for: the title is the only
       * sentence `ObjectiveRow` gives the player, and this one has to cover both
       * capture and demolition without naming a mechanism. It does, because
       * either one stops the lot being on their books.
       *
       * NO `credits` FIELD. The row is a refusal, and paying a player for not
       * doing something they were never told to do would make the medal the
       * reward twice over. What it pays is the medal: `medalFor` gives silver
       * only when every secondary is complete.
       */
      title: 'Leave the two lots they took on their own books',
    },
  ],

  triggers: [
    /* -- the account, in two beats ----------------------------------------
     * Split across sixteen seconds because the shell renders dialogue as toasts
     * and four at once is a stack nobody reads — and because two speakers inside
     * six seconds is exactly the case `Shell.campaignBeatSeq` was written for,
     * so both halves of each beat really do arrive.
     *
     * Tallow opens because it is her account and this is the first one in the
     * chapter that is against her. Cregg carries the ground, as he has for eight
     * operations.
     *
     * **NOTHING IN THIS FILE CAN OUTRUN AN OPENING BEAT**, which is the one
     * pacing problem `reclamation.07.payment-in-kind` had to fix in place: its
     * win was reachable in a measured 53.1 s and a beat at ninety seconds was a
     * beat some endings never reached. Here the only ending before the close is
     * `t.rout`, and being routed inside seventy seconds is not a state the
     * opening can produce.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Somebody walked into the bonded store last week, asked for the counterpart, and '
            + 'read eleven months of our own liftings back to us. Every line of it is in our '
            + 'hand, in our ink, and correct. The account against this company is twenty-two '
            + 'thousand, payable at the counter this afternoon.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'And we are not going to dispute a word of it. We spent a year telling this '
            + 'continent that a book two parties can check is worth more than a yard. The first '
            + 'time that book is turned round and pointed at us is exactly when we find out '
            + 'whether we meant it.',
        },
      ],
    },

    /* -- the orders, and the desk at the head of the road --------------------
     * The reveal is over the DESK and not over the lots. The three lots are the
     * player's own structures with `sight` 22 apiece and are already on screen;
     * a `revealArea` over ground the player holds shows nothing and reads as the
     * briefing padding itself. `revealArea` EXPLORES ground rather than showing
     * live units, so what this draws is the map and not an intelligence report.
     *
     * **CREGG'S LINE SAYS WHAT IS NOT THE PROBLEM AND HANDS THE MECHANISM TO
     * `t.boxes` EIGHTEEN SECONDS LATER**, which is the order the operation is
     * paced in. It used to say *"run them as long as you can hold them"* — a
     * statement about income, on an estate measured delivering 108 510 credits
     * against a 22 000 bill and pinned at its ceiling from t+178.9 s. That is
     * the one kind of wrong a briefing line must not be: advice, in the only
     * sentence a player gets, about a resource they are never short of.
     */
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(20) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'There is two thousand in hand and four customers at the counter, so we sell. '
            + 'Numbers Three, Five and Eight come off the company books today — whole if you can '
            + 'manage it and as scrap if you cannot, and the only difference is what we are left '
            + 'holding. I said that to the Works when we were the ones with the notes. It is '
            + 'our turn on the other end of it.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The road pays better than the account does, all afternoon — earning it is not '
            + 'our problem today and it will not be our problem at four o\'clock. And there is an '
            + 'Allied clerk at the head of our own haul road with a desk and two gun positions, '
            + 'pricing what comes past him. He is not here to buy anything.',
        },
        { do: 'revealArea', player: 0, area: DESK_AREA },
      ],
    },

    /* -- the ceiling --------------------------------------------------------
     * UNCONDITIONAL, AT THIRTY-EIGHT SECONDS, AND IT IS THE ONE MECHANISM IN THE
     * OPERATION A PLAYER CANNOT SEE.
     *
     * `ObjectiveRow` is `{ id, title, kind, status }` — no description, no
     * tooltip — so a bar that is not in a title is a bar nobody was told about,
     * and "the box shrinks when you sell the thing that was holding it" is not a
     * bar that fits in a title. Trap 23, answered the way that trap says to
     * answer it: on an unconditional trigger, early, in the two sentences that
     * name both routes out.
     *
     * The numbers are the measured ones — 21 000 of ceiling against 22 000 of
     * bill, 11 000 of it structural and 8 000 of THAT in four Sorters — and they
     * are stated as round figures because the chip is a toast and not a table.
     */
    {
      id: 't.boxes',
      when: { on: 'elapsed', ticks: seconds(38) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'One thing before you start, because nothing warns you until it has already '
            + 'happened. The box holds twenty-one thousand with every shed standing, and six '
            + 'thousand of that IS the three lots. Sell them and the box shrinks with them, and '
            + 'whatever is above the line at that moment goes straight back on the ground.',
        },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'So put up heaps before you need them, or break up something that holds nothing '
            + 'at all — a furnace does it, and the line comes up with the money instead of down. '
            + 'I would rather pay for somewhere to keep twenty-two thousand than pay the account '
            + 'twice.',
        },
      ],
    },

    /* -- Numbers One and Four -----------------------------------------------
     * THE ONE `cameraMove` IN THE OPERATION, AND IT IS HERE BECAUSE THIS IS THE
     * ONE THING ON THE MAP THE PLAYER WOULD OTHERWISE NEVER LOOK AT. `types.ts`
     * says the camera is for an arrival, a loss or a reveal and not for
     * punctuation; a secondary about not taking two buildings two hundred and
     * fifty metres away is unreadable unless the player has seen them once.
     *
     * `setObjective('held')` is the only thing in this file that reveals that
     * row, and nothing can outrun it: the earliest ending is `t.rout` and the
     * win is a single tick at `parSec`.
     */
    {
      id: 't.terms',
      when: { on: 'elapsed', ticks: seconds(56) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'One more thing and then the road is yours. Numbers One and Four are standing on '
            + 'their compound at the far end of it. They lifted them off this siding in the '
            + 'spring and credited them to the account at scrap value, which is the entire '
            + 'reason there is still twenty-two thousand to find.',
        },
        { do: 'revealArea', player: 0, area: TAKEN_AREA },
        { do: 'cameraMove', at: TAKEN_ONE },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'They have not put a man on either of them. You know exactly why. Take them back '
            + 'and it is six hundred a minute off the people burning our plant — and we spend the '
            + 'rest of the year explaining to every customer in that book why it applies to them '
            + 'and not to us.',
        },
        { do: 'setObjective', id: 'held' },
      ],
    },

    /* -- the first working --------------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps regardless
     * reads as an opponent, which is `soviets.03.deep-sector`'s argument about
     * scripted waves on an AI seat.
     *
     * Pointed at NUMBER THREE, which is the FIRST of the three a column coming
     * down this road meets — 184.5 m of Track walking against Number Five's
     * 225.6 and Number Eight's 277.8. It is NOT the furthest from the yard;
     * measured over the same grid that is Number Five, at 210.8 m against Number
     * Three's 178.1, and the layout's header carries the reversal and the
     * exclusion control behind it.
     *
     * `AiBrain.regroupSquads` files every untagged hull the seat
     * owns into a squad on its next pass, so the attack-move is the first thing
     * these six do and the brain owns them afterwards — the honest limit of what
     * a scripted wave buys.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Reclamation key here is a build error.
     *
     * The `eva` lands BEFORE the event rather than on it, which is the only way
     * a scripted one earns its place: `audio.system.ts` already speaks
     * `forcesUnderAttack` on any attack, and this column is 184.5 m of Track
     * walking and at least 28 seconds from touching anything.
     */
    {
      id: 't.first',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Ardle',
          text: 'The Reclamation is breaking up three of its own lots this afternoon to settle '
            + 'an account out of a book we can read as easily as they can. We are not going '
            + 'down there to '
            + 'take anything. We are going down there to make sure that what is standing on that '
            + 'road at four o\'clock is scrap instead of money. Working one, the far lot.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: LOT_THREE },
      ],
    },

    /* -- the second ---------------------------------------------------------
     * It joins the `column` tag rather than taking its own, so one `orderTagged`
     * re-points the survivors of both — `EffectSink.orderTagged` issues ONE
     * command per owner and every one of them is seat 1.
     */
    {
      id: 't.second',
      when: { on: 'elapsed', ticks: minutes(8) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle',
          text: 'Second working, the middle lot. A sorter standing is a thousand credits to them '
            + 'and a sorter burned is nothing at all, and I would like this afternoon\'s '
            + 'arithmetic to be nothing at all three times over.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: LOT_TWO },
      ],
    },

    /* -- the third ---------------------------------------------------------- */
    {
      id: 't.third',
      when: { on: 'elapsed', ticks: minutes(12) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle',
          text: 'Third, the near lot. If they cannot hold the road they cannot pay the account, '
            + 'and if they cannot pay the account there is no account — and a book that failed '
            + 'the first time anybody pointed it at its own author is a book every customer on '
            + 'this continent stops answering.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: LOT_ONE },
      ],
    },

    /* -- the fourth ---------------------------------------------------------
     * BEHIND THEM, at the company yard itself, five minutes before the counter
     * shuts — which is the window a player who has run the lots to the last hour
     * has to break them up in. The escalation in this operation is in the target
     * rather than in the weight, and this is the target that makes the timing a
     * decision instead of a formality.
     */
    {
      id: 't.fourth',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle',
          text: 'Fourth, and take the yard this time rather than the plant. It was never the '
            + 'sheds I wanted off their books at four o\'clock. It was the box.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: YARD },
      ],
    },

    /* -- the first lot goes -------------------------------------------------
     * `max: 2` is "at least one of the three is off the books", and it fires
     * whether the player sold it or the Allies burned it. **THE LINE HAS TO READ
     * CORRECTLY IN BOTH CASES AND IT IS WRITTEN TO** — `ownerCount` cannot tell a
     * sale from a demolition and, for this operation, should not;
     * `reclamation.05.closing-entry` records the same limitation and the same
     * answer. What is true either way is the two thousand of ceiling, which is
     * the thing the player most needs told at the moment it happens.
     *
     * `not(DECIDED)` is trap 26: without it, a player whose last lot goes ON the
     * tick that ends the operation gets this under the ending beat. `DECIDED`
     * rather than `CLOSED` because the rout is an ending too — see its own
     * block.
     */
    {
      id: 't.lotGone',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'ownerCount', player: 0, role: 'building', tag: 'lot', max: 2 },
          { on: 'not', of: DECIDED },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'That is one lot off the books. However it went, the box just got two thousand '
            + 'smaller — count the heaps before the next one goes, because the meter will not '
            + 'warn you until the money is already on the ground.',
        },
      ],
    },

    /* -- the desk -----------------------------------------------------------
     * `not(DECIDED)` for the same reason as `t.lotGone`, and it does more work
     * here: `t.deskMissed` below is the silent arm that resolves this row on the
     * deciding tick, so the pair partitions exactly and neither can put a beat
     * under the ending.
     */
    {
      id: 't.deskDone',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'desk', max: 0 },
          { on: 'not', of: DECIDED },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'desk' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Desk is off the road and the two guns with it. Twelve hundred against the '
            + 'account for the metal, and nobody standing at the top of our own haul road '
            + 'writing down what we have got left.',
        },
      ],
    },

    /* -- Numbers One and Four change hands ---------------------------------- */
    {
      id: 't.heldTaken',
      when: { on: 'all', of: [SETTLE, TAKEN_GONE, { on: 'not', of: DECIDED }] },
      then: [
        { do: 'failObjective', id: 'held' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'One of theirs is on our books. It was ours in the spring and it is a levy we '
            + 'have no entry for this afternoon, which is the exact word the Works used about us '
            + 'for eleven months and could not make stick. They will be able to make it stick '
            + 'now. Pay the account anyway — it is the only half of this we can still get right.',
        },
      ],
    },

    /* -- the live reading ---------------------------------------------------
     * THREE MINUTES ON THE COUNTER, AND IT IS THE FAIRNESS MECHANISM A BANK
     * PRIMARY NEEDS. `reclamation.05.closing-entry` states the rule: a player who
     * finishes two hundred credits short of a single-tick threshold must not
     * discover it AT the threshold. This is the same trigger, at the same three
     * minutes out.
     *
     * **THE ADVICE IS TRUE IN EVERY STATE THIS CAN FIRE IN, WHICH IS WHAT MAKES
     * IT ADVICE.** It fires only under 22 000, and both structures it names carry
     * NO storage — so neither sale can ever invert (`reclamation.05` measured
     * that a Sorter sold near the ceiling costs 2 000 instead of paying 1 000,
     * and it is the reason this line does not name one). At a full box the
     * furnace also ratchets the ceiling; at a box that is not full the breaker
     * yard is simply the largest thing on the lot the player has no further use
     * for. `sellWouldStrand` refuses only the last thing that can build, which is
     * the Foundry and not either of these.
     *
     * `not(DECIDED)` keeps it off a rout, where `t.rout` is already speaking and
     * the advice would be about a yard that no longer exists.
     *
     * There is deliberately NO "you are clear" twin, and it is not an omission:
     * `t.win` cannot fire before the close, so a player who is in funds at minute
     * eighteen is still playing, and telling them to stop spending would be
     * telling them to stop defending the thing they still have to sell.
     */
    {
      id: 't.call',
      when: {
        on: 'all',
        of: [{ on: 'elapsed', ticks: minutes(18) }, SHORT, { on: 'not', of: DECIDED }],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three minutes on the counter and we are short. If the box is full, break up a '
            + 'furnace — it holds nothing, so the line comes up instead of down. If it is not, '
            + 'the breaker yard is nineteen hundred on the books and nine-fifty in the hand, and '
            + 'we are not building another hull today.',
        },
      ],
    },

    /* -- the party is gone --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with.
     *
     * **CONJOINED WITH `SHORT`, AND THAT IS THE OPERATION'S THESIS AS A
     * CONDITION.** A commander standing in a smoking hole at minute nineteen with
     * twenty-two thousand in hand and every lot already off the books has done
     * the thing this operation asked for, and `t.win` pays them at four o'clock.
     * `isBeaten` asks whether you can still play; `settle` asks whether you can
     * still pay. See the header.
     *
     * `not(CLOSED)` keeps it off the closing tick, where the three-way partition
     * already covers every state and a second `endOperation` would be swallowed
     * by the outcome latch after putting a second beat on screen. The five silent
     * arms below share this trigger's condition through `DECIDED`, so the rows
     * the player was still working are resolved rather than left ACTIVE on the
     * defeat screen.
     */
    {
      id: 't.rout',
      when: {
        on: 'all',
        of: [{ on: 'playerBeaten', player: 0 }, SHORT, { on: 'not', of: CLOSED }],
      },
      then: [
        { do: 'failObjective', id: 'settle' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing answering on the road and nothing in the box. The account goes down '
            + 'unpaid with our own signature under every line of it, which is the one document '
            + 'on this continent nobody will need to argue about.',
        },
        { do: 'endOperation', result: 'loss', reason: 'settle' },
      ],
    },

    /* -- the tick the operation is decided on: the silent arms ---------------
     * Five triggers that write objective state and say nothing, so that whichever
     * tick ends the operation carries exactly ONE beat. `elapsed(minutes(21))` is
     * sixty-three times `SETTLE`, so none of these needs a settle guard and none
     * carries one.
     *
     * **THEY FIRE ON `DECIDED` RATHER THAN ON `CLOSED`, AND THE ROUT IS WHY.**
     * Driven through the real Director, the `rout` world ended at t+700 s with
     * `lots`, `desk` and `held` all still ACTIVE — three rows on a defeat screen
     * that the operation had in fact decided, and one of them (`lots`) could have
     * been genuinely complete. Widening the guard to the rout's own condition
     * resolves all three truthfully and silently on the tick `t.rout` ends it.
     * It cannot fire on a SOLVENT rout, which is the state
     * `playerBeaten and not SHORT` that this operation deliberately lets run to
     * the close — `DECIDED`'s second arm carries `SHORT` for exactly that reason.
     */
    {
      id: 't.lotsDone',
      when: { on: 'all', of: [DECIDED, LOTS_CLEAR] },
      then: [{ do: 'completeObjective', id: 'lots' }],
    },
    {
      id: 't.lotsLeft',
      when: { on: 'all', of: [DECIDED, LOTS_LEFT] },
      then: [{ do: 'failObjective', id: 'lots' }],
    },
    {
      id: 't.heldKept',
      when: { on: 'all', of: [DECIDED, HELD] },
      then: [{ do: 'completeObjective', id: 'held' }],
    },
    /*
     * `t.heldTaken` above has usually resolved this already and
     * `CampaignSession.setObjective` refuses to un-resolve either way — both
     * 'complete' and 'failed' return early — so this is the arm for the one case
     * that trigger's `not(DECIDED)` guard leaves: a lot that changes hands ON the
     * tick the operation is decided.
     */
    {
      id: 't.heldLost',
      when: { on: 'all', of: [DECIDED, TAKEN_GONE] },
      then: [{ do: 'failObjective', id: 'held' }],
    },
    {
      id: 't.deskMissed',
      when: {
        on: 'all',
        of: [DECIDED, { on: 'not', of: { on: 'objectiveComplete', id: 'desk' } }],
      },
      then: [{ do: 'failObjective', id: 'desk' }],
    },

    /* -- the closing tick: the three endings ---------------------------------
     * EXACTLY ONE OF THESE FIRES, AND THE PARTITION IS ARITHMETIC RATHER THAN
     * TRIGGER ORDER. `SHORT` is the exact complement of `IN_FUNDS` (a `not`, for
     * the float reason above) and `LOTS_CLEAR`/`LOTS_LEFT` are `max: 0` and
     * `min: 1` over one count, so the three cover every world state at `CLOSE`
     * and no two of them overlap. `runDirector` collects the effects of EVERY
     * matching trigger before `CampaignSession.apply` runs any of them, so
     * ordering would not have made them exclusive — this is why they are
     * conditions rather than an order.
     */
    {
      id: 't.win',
      when: { on: 'all', of: [CLOSED, IN_FUNDS, LOTS_CLEAR] },
      then: [
        { do: 'completeObjective', id: 'settle' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Paid at the counter, in full, on the day, out of three of our own yards. Copy '
            + 'the discharge to every customer in that book, including the ones who will read it '
            + 'and work out that the nine breaking yards this company is named for are four. '
            + 'There are five entries against us in the account now and every one of them is '
            + 'marked settled. That is what I have got left to sell.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
    {
      id: 't.encumbered',
      when: { on: 'all', of: [CLOSED, IN_FUNDS, LOTS_LEFT] },
      then: [
        { do: 'completeObjective', id: 'settle' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Money on the table and a lot still on our books, so the sale did not complete '
            + 'and the counter will not take a part payment against a schedule that is short. We '
            + 'are holding twenty-two thousand and an account that says we did not pay it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'lots' },
      ],
    },
    {
      id: 't.short',
      when: { on: 'all', of: [CLOSED, SHORT] },
      then: [
        { do: 'failObjective', id: 'settle' },
        {
          do: 'dialogue',
          speaker: 'Tallow',
          text: 'Counter shut and we are short. Whatever we broke up this afternoon we broke up '
            + 'for nothing, and by the end of the week every house on this continent will know '
            + 'that we honoured the Meridian entry nine days ago and could not honour four of '
            + 'them today. They will be right, and it will be our handwriting.',
        },
        { do: 'endOperation', result: 'loss', reason: 'settle' },
      ],
    },
  ],
};

export default op;
