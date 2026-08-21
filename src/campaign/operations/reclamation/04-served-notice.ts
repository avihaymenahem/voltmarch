/**
 * ============================================================================
 * R4 — SERVED NOTICE
 * ============================================================================
 * Depot Four and Depot Nine compared invoices. Survey 26-511 had one name on
 * both of them, and the name was Tallow's.
 *
 * The Allied district did not answer with soldiers. It answered with a
 * REQUISITION: Tallow's Number Six breaking yard is to be taken as recovered
 * plant, at scrap value, on the district's own valuation. That is a thing an
 * administration can do to a scrap baron and there is no arguing with it — but
 * a requisition is not SERVED until the schedule of plant has been entered in
 * the district register and the counterpart has been lodged against it. Both
 * books are in two blocks at a snowbound Works freight halt on Survey 58-273,
 * inside a wire, because that is where the district keeps its paper.
 *
 * So the order is not to defend the yard. It is to make the entry unmakeable.
 *
 * ============================================================================
 * WHAT `infiltrate` MEANS HERE, AND WHY IT IS NOT A2's HEADCOUNT
 * ============================================================================
 * There is no stealth in this game — no cloak, no detection, no vision
 * predicate among the twelve conditions and no thirteenth on offer.
 * `allies.02.instrument-room` built the word out of a HEADCOUNT: five or more
 * of your units inside a 96 m cordon and the district turns its watch out. That
 * works, it is honest, and doing it again one chapter later would be one trick
 * twice.
 *
 * **THIS ONE IS A DWELL CLOCK.** Any of the player's units inside the counted
 * ground, CONTINUOUSLY, for sixty seconds, and the halt telephones the depot.
 * Step off and the clock goes back to zero. That is
 * `all: [unitsInArea(WIRE, min 1), elapsedSinceArmed(seconds(60))]`, and it is
 * the frozen vocabulary's hold timer used as a PENALTY rather than as a
 * reward — the arming pass sets the tick when the first man crosses the rim and
 * DELETES it the moment the last one leaves, which is exactly the behaviour a
 * "do not linger" rule needs and is the same mechanism `soviets.04` uses to
 * mean the opposite thing.
 *
 * The fiction is written to be the mechanic rather than to excuse it. A
 * Reclamation work party on a Works siding is unremarkable — the Reclamation IS
 * the Works' salvage arm, and half the continent has signed for their scrap
 * this month. A work party that is still on the siding a minute later is a work
 * party somebody has had time to write down. **An administration notices what
 * it has a form for**, which is the argument this whole chapter is made of.
 *
 * WHAT THAT BUYS THAT A HEADCOUNT WOULD NOT: the player may bring everything
 * they own, and the thing they are spending is TIME. So the rule prices the one
 * decision an operation with no production actually owns — how much of a finite
 * party you commit to the work, given that everything committed is not covering
 * the road, and that every man you lose lengthens the job.
 *
 * **AND IT IS A RULE THE PLAYER CAN PLAY WITH RATHER THAN ONLY OBEY.** Sixty
 * seconds is not a budget for the whole operation; it is a budget per visit,
 * and pulling everyone back over the rim buys a fresh sixty. A mauled crew that
 * cannot finish in one go can finish in two. Cregg says that out loud in the
 * brief, because a rule the player can only learn by losing it is a rule badly
 * told.
 *
 * ============================================================================
 * THE CLOCK, AGAINST THE GROUND THE LAYOUT ACTUALLY LAYS
 * ============================================================================
 * Every distance is derived arithmetic or read off a built world; every rate is
 * `WEAPONS` through `ARMOR_MATRIX` at `COMBAT_DAMAGE.globalMul` 0.80. Delivered
 * dps against `ArmorClass.Concrete`, which is what both the wire (300 hp a
 * segment) and the record blocks (800 hp each) wear:
 *
 *     slagCharge  74 / 2.70 s  HighExplosive x1.00   21.93   x4 = 87.70
 *     arcProd     26 / 1.05 s  Tesla         x0.60   11.89   x4 = 47.54
 *     grinderArc  70 / 1.90 s  Tesla         x0.60   17.68
 *     spitCoil    30 / 0.95 s  Tesla         x0.60   15.16
 *
 * so the eight foot the party opens with are 135.25 dps against concrete and
 * four Slaggers alone are 87.70. (The x4 columns read 87.71 / 47.56 and the sum
 * 135.28; those are the ROUNDED per-man figures multiplied, and the shipped
 * rows give 87.7037 and 47.5429. Nothing downstream moves — 300/135.25 is still
 * 2.2 s and 800/135.25 is still 5.9 s.) One visit, all eight foot inside, at a
 * Slagger's `maxSpeed` 3.0 m/s:
 *
 *     rim of the counted ground (52 m) to the cut stand (41.00 m)  11.0 m   3.7 s
 *     one wire segment, 300 hp                                             2.2 s
 *     cut stand to the near block's stand (32.06 m out)             8.9 m   3.0 s
 *     the near block, 800 hp                                               5.9 s
 *     on to the far block's stand (14.00 m out)                    16.0 m   5.3 s
 *     the far block, 800 hp                                                5.9 s
 *     back out to the rim                                          35.9 m  12.0 s
 *                                                                        ------
 *                                                                         38.0 s
 *
 *     four Slaggers and nothing else                                       45.6 s
 *     two Slaggers and two Pickers                                         52.0 s
 *
 * **THE TWO "STAND" FIGURES IN THAT TABLE ARE BOTH WRONG AND BOTH IN THE SAFE
 * DIRECTION.** A Slagger fires when `flat - hitRadius(target) <= 12`, and a
 * record block's `hitRadius` is its 7.21 m HALF-DIAGONAL, not the 4 m half-width
 * of its footprint. Re-derived on the built positions — which are now
 * (242, 256) and (254, 256), see the layout header — the near block can be shot
 * from 35.27 m out, not 32.06, and the far block from 19.31 m out; 14.00 m is
 * the far block's own CENTRE distance from the halt and is not a stand at all.
 * The corrected legs are 11.1 / 5.6 / 16.0 / 32.7 m, so
 * the walking is 65.4 m rather than 71.8 and the visit is **35.8 s rather than
 * 38.0**. The table is left as it stands because it is the conservative reading
 * and the conclusion — comfortably inside sixty — is the same either way.
 *
 * Against sixty that is 22.0 / 14.4 / 8.0 seconds of slack. **THE DISTANCES AND
 * THE RATES ARE MEASURED AND THE PACING IS NOT** — the pathing overhead, the
 * formation settle and any time spent shooting at things that shoot back are
 * unmeasured, all of them in the direction that makes sixty seconds tighter
 * than it reads. Nothing has played this.
 *
 * **AND THE SAME ARITHMETIC SAYS A CLEAN RUN IS OVER IN THREE AND A HALF
 * MINUTES, WHICH IS WORTH SAYING OUT LOUD RATHER THAN LETTING `parSec` IMPLY
 * OTHERWISE.** Written as four legs that do not overlap, so nothing is counted
 * twice with the table above:
 *
 *     insertion to the cut stand      174.5 m of ground        58.2 s
 *     the work, from the cut stand    2.2 + 3.0 + 5.9 + 5.3 + 5.9 = 22.3 s
 *     back out of the yard             24.9 m                   8.3 s
 *     the arc-free way home           347.4 m                 115.8 s
 *                                                             -------
 *                                                              204.6 s
 *
 * **3 min 25 s of pure movement and shooting from tick zero.** Sixteen minutes
 * is therefore a DEADLINE and not a prediction — it is the budget for the run
 * that goes wrong, for a crew that has to do the job in two visits, and for a
 * player who loses the first four Slaggers and waits for the second crew. An
 * operation whose par is nearly five times its perfect line is unusual in this
 * chapter and it is deliberate: there is no economy to fall back on, so the
 * only thing a bad minute can be paid for with is time.
 *
 * ============================================================================
 * THE ROUTE, AND EVERY CLEARANCE IS A SURFACE DISTANCE
 * ============================================================================
 * `Combat.engage` gates firing on `max(0, flat - hitRadius(target))` and
 * `Targeting` acquires at `range * COMBAT_TARGETING.acquireRangeMul` = 22 x
 * 1.08 = 23.76 m, both measured to the TARGET's hull. The target on this map is
 * a man: `rclSlagger`'s `hitRadius` is his 0.234 m radius, so a 22 m box reaches
 * a man whose CENTRE is 22.23 m away and notices one at 23.99 m. Every figure
 * below is the surface reading.
 *
 *   - **THERE IS NO WAY IN THROUGH THE GATE.** Two boxes bear on the mouth at
 *     18.87 and 21.26 m of centre distance, and the gate axis is inside a 22 m
 *     arc for 35.86 m of approach — 11.95 s of walking under 131.65 delivered
 *     dps, **about 1 520 points of damage against a foot party that carries
 *     800.** Measured by Dijkstra on the 4 m grid with every cell inside a 22 m
 *     arc removed, the arc-free route from the insertion to the gate mouth is
 *     UNREACHABLE. Not expensive: absent. (This read "35.5 m … 119.5 … 1 414":
 *     `pillboxMg` was scored with `wpn`'s DEFAULT `burstDelay` 0.08 rather than
 *     the row's own 0.06, which stretches the cycle from 0.79 s to 0.87 and
 *     drops each box from 65.82 to 59.77. The error made the gate look
 *     SURVIVABLE, and it is not.)
 *   - **THE WAY IN IS THE BACK WIRE AND IT COSTS NOTHING IN GUNS.** Insertion to
 *     the stand outside the back face is **174.5 m of ground and 174.5 m
 *     arc-free — a detour of 0.0 m** — and that stand is 57.15 m of surface from
 *     the nearest box.
 *   - **A CREW CAN STAND ON EITHER BLOCK AND TAKE NO FIRE.** The two record
 *     blocks are 35.21 and 33.77 m of surface from the nearest box, clear of the
 *     22 m firing arc by 14.54 and 11.77 m and of the 23.76 m acquisition radius
 *     by 12.78 and 10.01 m. Without that there is no quiet route and the premise
 *     collapses into an assault with extra steps.
 *   - **THE WAY OUT IS WHERE THE BOXES BITE.** The pickup is on the far side of
 *     the halt, so the withdrawal passes the yard rather than retracing it: the
 *     straight line is 179.1 m with 43.5 m of it inside the south box's arc; on
 *     the ground, with the wire standing, it is **317.1 m, and 347.4 m if you
 *     want to stay out of every arc — a 30.2 m detour, 10.1 s at 3.0 m/s.**
 *
 * **THE WIRE CATCHES THE SLAGGER'S SHELL AND NOTHING ELSE THE PARTY FIRES.**
 * `Projectiles.sweep` hits whatever it meets first and `Targeting.isValidTarget`
 * has no line-of-sight test, so a SHELL fired at a record block from outside the
 * wire detonates on the wire while the tracer looks perfectly correct. That is
 * `slagCharge` — `ProjectileKind.Shell` — and it is one of the four rows the
 * party carries.
 *
 * **THIS SAID "a round", AND THE OTHER THREE ARE NOT ROUNDS.** `arcProd`,
 * `spitCoil` and `grinderArc` are all `ProjectileKind.TeslaBolt`, and
 * `Combat.resolveTesla` pushes the damage record straight at the victim — no
 * projectile is spawned, so the fence is not in the way of anything. Measured on
 * the built world, the closest legal standing cell OUTSIDE the wall square is
 * **8.91 m of surface** from the deep block, inside all four ranges. The four
 * Pickers alone are 47.54 dps against concrete and take that block's 800 hp in
 * 16.8 s; with the two Grinders and two Arcspitters brought to bear it is
 * 113.2 dps and 7.1 s. **Either way the block goes down without the wire being
 * opened at all.** The claim that "the wire has to come
 * down whether or not anybody walks through the hole" is therefore FALSE, and
 * what survives it is the operation rather than the sentence — the second block
 * is 20.86 m of surface from the nearest outside stand against an 18 m reach, so
 * the counterpart still costs the wire or the gate, and every metre of this
 * happens inside the 52 m disc with the shift's clock running.
 *
 * The Reclamation's own answer to concrete is still one satchel infantryman,
 * which is what `rclSlagger`'s blurb has always said — 21.93 delivered dps
 * against 11.89, twice the rate of the line rifle.
 *
 * **AND THE COUNTED GROUND CANNOT BE STOOD OFF.** The bound is the block
 * FURTHEST from the halt centre, because that is the one a shooter can stand
 * furthest out to reach: measured, the two land at **14.00 m** and 2.00 m, each
 * carries a 7.21 m hull radius, and the longest reach this roster permits is
 * `grinderArc`'s 18 m — so **39.21 m** of standoff against a 52 m disc. Even
 * shooting the nearest wire segment at maximum standoff is 46.91 m and inside.
 * The only thing on the map reachable from outside the clock is a corner of the
 * fence (36.77 + 2.83 + 18 = 57.60 m), which is worth nothing.
 *
 * **THIS SAID "the deeper block is 2.00 m from the halt centre … 27.21 m of
 * standoff", AND 2.00 m IS THE SHALLOW BLOCK.** Right arithmetic, wrong block:
 * the real standoff is 39.21 m and the margin is 12.79 m rather than 24.79. The
 * rule still cannot be dodged; it has a quarter of the room it claimed.
 *
 * ============================================================================
 * THE PLAYER HAS NO BASE, AND THAT DECIDES THREE FIELDS BELOW
 * ============================================================================
 * `opening: 'force'`, and the layout calls `buildBaseFor` for the depot alone.
 * Seat 0 opens with twelve hulls, zero structures, and therefore no build
 * radius and no production: `Placement.withinBuildRadius` reads finished
 * structures the player owns and there are none, so every placement anywhere is
 * `PlacementFault.OutOfRange`. Nothing on the map is neutral, so there is
 * nothing to capture into a foothold either. **The party is the whole army for
 * the whole operation**, plus one scripted crew at minute four.
 *
 *   - **NO SECONDARY PAYS CREDITS, AND THE VALIDATOR WOULD HAVE LET IT.**
 *     `ObjectiveDef.credits` is the shipped reward for a secondary and three of
 *     the four operations in this chapter use it. A player who cannot buy
 *     anything cannot spend it: it would be a bonus that does not exist, paid
 *     into a counter that only ever goes up. The reward is the medal, which
 *     `medalFor` computes from exactly this — win, plus every secondary.
 *   - **PAYING THE MEDAL IN HULLS WAS CONSIDERED AND CUT.** A `spawnUnits` on
 *     the completing trigger would be a real reward the player could use, and it
 *     makes the quiet route ALSO the strong route: the run that needed help
 *     least would get it. The second crew arrives on a schedule instead, for
 *     everybody, which is `soviets.03`'s argument about scripted waves and the
 *     right one here.
 *   - **`credits` IS ENTIRELY THE DEPOT'S TEMPO.** `Shell.applySimPostBoot`
 *     writes `startingCredits` into every non-Neutral slot, so this one number
 *     does two jobs and one of them is inert. (Cited as
 *     `Shell.applySimPostBoot`, which is not a method of `Shell` and never
 *     was; `reclamation.01.held-paper` carries the same wrong name. The code is
 *     the last block of `applySimPostBoot`, under "PVP IGNORES THE LOCAL LOBBY
 *     AND SEEDS BY SLOT".) 2 500 is the lowest bank in the
 *     chapter on purpose: CLAUDE.md's measured block on the 10 000-credit
 *     opening has a brain putting up a seven-building base and eleven troops by
 *     t+90 s having mined nothing, and a raid conducted on foot must not be met
 *     by a war factory running before the party has finished walking.
 *
 * ============================================================================
 * NEITHER SHIPPED OUTCOME RULE MAY END THIS, AND THE t+10 s CASE IS SUBTLER
 * THAN policy.ts's WORDING
 * ============================================================================
 * `policy.ts` lists four reachable failures and the third is *"a commando
 * insertion that lands at t+30 s, so the player is defeated at t+10 s for
 * having no base"*. This operation is the commando insertion, and the literal
 * failure as worded **would not have fired here** — which is worth stating
 * precisely rather than repeating the sentence, because repeating it is how a
 * claim stops being true.
 *
 * `Shell.pollOutcome`'s defeat arm reads `countLivingAssets`, which counts
 * `EntityKind.Building`, `Vehicle` AND `Infantry`. The party is on the ground at
 * tick zero — **measured, seat 0 holds 0 buildings and 12 units** — so at the
 * ten-second poll the local count is 12 and the defeat arm is never reached. The
 * operation is one dead party away from it and not one frame closer.
 *
 * What `assetLossDefeat: false` actually buys is that `pollOutcome` RETURNS AT
 * THE POLICY CHECK, before it looks at the world at all, so the loss is the
 * authored one: `t.rout` on `playerBeaten`, which is `Viability.isBeaten` —
 * nothing to build with and nothing to fight with — and which names an objective
 * and speaks a line. The 2 Hz poll would end the same match with a generic
 * defeat on whichever half-second it happened to notice.
 *
 * It also silences the OTHER route. `outcome.system.ts` returns on
 * `scriptedRunning()` before its own `hasAssets` defeat and before
 * `isStranded`'s repeating nag — and a party that legally has no base and never
 * will is stranded by that predicate for the entire operation (measured:
 * `isStranded` is `hasAssets && !canRebuild`, and seat 0 opens with 12 units,
 * 0 producers and 0 construction vehicles), so without the campaign latch the
 * player would be told so every `OUTCOME.warnRepeatSeconds` — 15 — for
 * **sixteen** minutes. (Written "fourteen" here and twice more across the two
 * files; `parSec` is 960 and `CLOSING` is `minutes(16)`. Fourteen is when
 * `t.closing` speaks the two-minute warning.)
 *
 * `annihilationWin` is off because razing the depot is not the order, is not
 * reachable with twelve hulls and no production, and would end the match with
 * both books still standing. It is also the rule that would fire the instant
 * `Viability` decided a depot with a base and a bank had "zero living assets"
 * for some reason nobody predicted, which on a sixteen-minute scripted match is
 * a class of accident this table has no opinion about.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ============================================================================
 *   - **NO HIDDEN SECONDARY.** `allies.02.instrument-room` refuses one on the
 *     grounds that its decision is the composition of the party, locked before
 *     the player leaves home, and a bonus revealed afterwards can only be
 *     answered by walking a fifth unit in. That argument is STRICTLY STRONGER
 *     here: there is no production at all, so a bonus revealed at the halt could
 *     not be answered even in principle. A bonus the player cannot act on is a
 *     quiz, and `reclamation.01.held-paper` refuses that in as many words.
 *   - **NO `cameraMove`.** It eases rather than cuts, but it still takes the
 *     camera off whatever the player was doing — and on this operation the
 *     player is watching eight men who cannot be replaced. The beats that would
 *     have used one (the watch turning out, the books going down) are all
 *     accompanied by a `dialogue`, which puts a toast on screen without moving
 *     anybody's view. `cameraMove` began working on 2026-08-19; the right time
 *     to decide not to use it is now, in writing.
 *   - **NO CAPTURE.** R2 takes a sorting station and R3 takes six capped taps.
 *     A third operation turning on the same verb is one trick three times, and
 *     it is why the record blocks are depot-owned and get destroyed rather than
 *     neutral and taken.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';
import {
  HALT, HALT_AREA, INSERT, PICKUP, PICKUP_AREA, ROAD, SIM_SEED, WATCH_OUT, WIRE,
} from '../../layouts/reclamation-served-notice';

/**
 * How long the shift will look at a work party before somebody picks up the
 * telephone.
 *
 * SIXTY SECONDS, and it is derived from the job rather than framed. The whole
 * of it — cross the rim, open the wire, walk to the first block, put both books
 * down and get back over the rim — is 38.0 s with the eight foot the party
 * opens with, 45.6 s with the four Slaggers alone and 52.0 s with half the crew
 * dead. See the clock table in the header. Sixty is enough for a clean run and
 * not enough for a mauled one, which is the only place a number like this can
 * honestly sit.
 *
 * IT IS A HOLD TIMER POINTED BACKWARDS. `elapsedSinceArmed` measures ticks
 * since every OTHER condition on the trigger first became true and STAYED true,
 * so the arm tick is set when the first man crosses the rim and deleted the
 * moment the last one leaves. Withdrawing therefore buys a fresh sixty, which
 * is the half of the rule that makes it playable rather than merely punitive.
 *
 * **VERIFIED AGAINST `runDirector`, TICK BY TICK, BECAUSE THIS IS THE ONLY
 * `elapsedSinceArmed` IN THE CAMPAIGN POINTED AT A PENALTY AND THE TWO-PASS
 * EVALUATION WAS ARGUED FOR THE OPPOSITE CASE.** `Director.ts` runs pass 1 with
 * every `elapsedSinceArmed` forced true; if the rest of the tree fails it calls
 * `state.armedAt.delete(t.id)` and skips, and if it holds with no tick recorded
 * it calls `state.armedAt.set(t.id, tick)`. Pass 2 then tests
 * `tick - armTick >= 1800`. So:
 *
 *     tick T      first unit inside      armedAt = T
 *     T .. T+1799 at least one inside    pass 2 false, armedAt untouched
 *     T+1800      still at least one     FIRES — 60.0 s to the tick
 *     T+k, k<1800 the last one leaves    armedAt DELETED, no partial credit
 *     T'          somebody re-enters     armedAt = T', a fresh 1800
 *
 * The Director evaluates every sim tick, so ONE tick with nobody inside resets
 * it. The behaviour is exactly what the paragraph above claims; CLAUDE.md's
 * argument for the restart ("the other way round hands the player a win for
 * holding nothing") is an argument about a REWARD, and inverting the trigger
 * inverts who the restart favours. Here it favours the player, deliberately.
 *
 * **WHAT A RESET COSTS, MEASURED, BECAUSE "buys a fresh sixty" IS ONLY HALF A
 * SENTENCE WITHOUT IT.** Every unit of the player's has to be outside r = 52,
 * and the return trip is walked at 3.0 m/s:
 *
 *     from the wire-cut stand, 41.00 m out    11.0 m each way    7.3 s
 *     from the far block's stand, 19.31 m out 32.7 m each way   21.8 s
 *
 * So the escape hatch is cheapest exactly where there is least to gain from it
 * and dearest at the moment the second book is going down — 21.8 s of walking
 * against 60 s bought, which is a tax rather than a toggle. It is still an
 * exploit in the strict sense: a player who shuttles can hold the secondary open
 * indefinitely at roughly a 27% overhead. That is the author's decision (Cregg
 * says it out loud in `t.brief`) and not a defect; it is written down here so
 * nobody has to rediscover the price by playing it.
 */
const SHIFT = seconds(60);

/**
 * When the district's two scheduled workings come up the lane, whatever the
 * player has done.
 *
 * UNCONDITIONAL, BOTH OF THEM. A wave that fires only when the player is
 * elsewhere reads as the map cheating; a schedule the world keeps regardless
 * reads as an opponent — `soviets.03.deep-sector` establishes that about
 * scripted waves on an AI seat and this is the same shape.
 *
 * THREE AND NINE, AND NEITHER OF THEM CAN CATCH A PERFECT LINE. A clean run is
 * at the wire at t+0:58, off the halt at t+1:29 and on the lorries at t+3:25;
 * the first column forms 119.08 m short of the halt and needs 37 s at a G.I.'s
 * 3.2 m/s to walk it, so at minute three it arrives twelve seconds after the
 * operation was already over. **That is stated rather than tuned away.** An
 * infiltration a perfect run walks out of untouched is an infiltration
 * working, and every scripted wave here exists for the run that was not
 * perfect. Three rather than six so it lands on a merely GOOD run's
 * withdrawal; nine because after the answering column at the books nothing
 * else is scheduled before the deadline, and a slow evening would otherwise
 * finish on an empty map.
 *
 * BOTH FIRE THE SAME TWO RINGS AT THE SAME POINT as the answering column in
 * `t.books`, which is what keeps the measurement honest — one check of `ROAD`
 * covers three waves, and a fourth with different radii would need its own.
 */
const WORKING = minutes(3);
const SECOND_WORKING = minutes(9);

/**
 * The week's end. EXACTLY `parSec`, to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation —
 * `soviets.03` sets the same relationship at 900, `soviets.04` at 960 and
 * `reclamation.03` at 900. Sixteen minutes against a measured perfect line of
 * **3 min 25 s** is deliberate slack and the header says why: with no economy
 * to fall back on, time is the only currency a bad minute can be paid for in.
 */
const CLOSING = minutes(16);

const op: OperationDef = {
  id: 'reclamation.04.served-notice',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * ALLIES, AND R3 NAMED THEM BEFORE THIS FILE EXISTED.
   *
   * `reclamation.03.sold-twice`'s own `foe` block says so out loud: "It is also
   * the operation that earns `reclamation.04`, whose premise is that the Allies
   * want Tallow's yard. They want it because of this week." R3 ends with two
   * Allied depots about to compare invoices and exactly one name on both; this
   * is the answer that comes back. Ardle is Depot Four's man from R3 and the
   * one who raised the shortfall.
   *
   * Every scripted key on a hostile seat is a literal Allied `gi` or `grizzly`,
   * which `validateCampaign` checks against the army of the seat it lands on.
   */
  foe: Faction.Allies,
  index: 4,
  title: 'Served Notice',
  beat: 'They are requisitioning the yard. A requisition is not served until it is filed.',
  /*
   * INFILTRATE. The chapter has not used it — R1 assault, R2 economy, R3
   * capture-hold — and `validateCampaign` refuses two adjacent operations in
   * one chapter that share a `primaryType`, so it could not have been another
   * capture-hold in any case. See the header for what the word is built out of
   * here, and for why it is deliberately not `allies.02`'s headcount.
   */
  primaryType: 'infiltrate',
  // Objectives, spawns, orders, reveals, dialogue, EVA and an outcome — the
  // definition in `types.ts` is "multiple effect kinds", and this is seven.
  archetype: 'bespoke',
  parSec: 960,
  requires: ['reclamation.03.sold-twice'],

  map: {
    /*
     * SNOW, AND THE PRESET AND THE BIOME ARE THE SAME WORD HERE.
     *
     * `MAP_PRESETS` and `BiomeName` overlap on `temperate`, `snow` and `urban`
     * and disagree on exactly one name — the preset is `arid`, the biome is
     * `desert` — and `reclamation.03.sold-twice` shipped on the wrong side of
     * that, measured every number in two headers against ground it had not
     * declared, and cost a re-swept `mapSeed` to fix. This pair cannot make
     * that mistake, which is a reason to prefer it and not an accident.
     *
     * `snow` carries `relief` 0.50, the highest in the roster, and it shows in
     * the seed sweep: 266 of 300 rolls put at least one scripted spawn drop on
     * ground its own locomotor cannot enter. The map-centre shelf is the
     * exception and the halt stands on it — not one of the 300 rolls failed
     * there, for foot or for tracks, and the shipped roll reads 1.000 open on
     * both. See the layout header.
     */
    preset: 'snow',
    /**
     * The survey designation. 58-273 is the number on the requisition, and
     * Cregg says it in the first line of the operation.
     *
     * **CHOSEN BY SWEEP.** 300 rolls from 58 000 were built headless with the
     * def tables bound and this operation's roster installed, and scored on
     * eight properties; 17 cleared them all and this is the best of the 17 — the
     * only one that is simultaneously 0 placements relocated, 1.000 open ground
     * at the pickup and 0.977 at the insertion — both measured over an r = 26
     * disc on the bare terrain, `PICKUP_AREA`'s radius and not `INSERT_CLEAR`'s
     * 30, which reads 0.971 / 0.960. Reproduced to the digit. Pinned by
     * `tests/campaign-maps.spec.ts` as a terrain fingerprint: a generator change
     * that re-rolls this ground moves the measured placements in both headers.
     */
    mapSeed: 58_273,
    /*
     * THE SEED ITSELF IS IMPORTED FROM THE LAYOUT, AND THAT — NOT THE IMPORT —
     * IS THE NEW THING.
     *
     * ELEVEN OPERATIONS ALREADY IMPORT POINTS FROM THEIR LAYOUT, including
     * `reclamation.02` and `.03`; this block read "THE ONE THING THIS OPERATION
     * DOES DIFFERENTLY FROM THE THREE BEFORE IT", which is false of importing
     * and true of the SEED: `reclamation-served-notice.ts` is the only layout in
     * the campaign that exports one. Verified structurally rather than assumed —
     * `src/game/Scenarios.ts` imports nothing from `src/campaign/`, so there is
     * no cycle to put `seatedSlots` in its temporal dead zone at the layout's
     * module-eval; both globs in `index.ts` are `eager`, so both modules are in
     * the campaign chunk either way and the edge crosses no bundle boundary
     * `campaign-bundle-isolation.spec.ts` polices; and `map.simSeed` is a plain
     * number by the time `Shell.startOperation`, the save context and the replay
     * header read it.
     *
     * Every point the trigger table below names — the halt, the counted ground,
     * the insertion, the pickup, the depot's road, the watch's gate — is
     * COMPUTED from this seed at module load, in the layout, out of
     * `seatedSlots`, `SKIRMISH_START_OFFSETS` and `MAP_SIZE`. Writing the number
     * here as well would be the same fact in two files, and the failure mode —
     * a reveal framing empty ground, a column landing where nobody authored
     * one — is invisible to every gate.
     */
    simSeed: SIM_SEED,
    armies: 2,
    biome: 'snow',
    /*
     * `force`. `buildBaseFor` is never called for seat 0 — see the layout — so
     * the player opens with twelve hulls and no structure of any kind. This is
     * the second `'force'` opening in the chapter and it is not
     * `reclamation.01.held-paper`'s: that one hands out four working lots and a
     * 1900-credit decision, and this one hands out a party.
     */
    opening: 'force',
    // 2 500, and the player cannot spend a credit of it. See the header.
    credits: 2_500,
  },
  layout: 'reclamation-served-notice',

  // NEITHER SHIPPED RULE MAY END THIS. See the header for the measured version
  // of `policy.ts`'s t+10 s case, which does not fire here and is not the reason
  // `assetLossDefeat` is off.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * ONE ID, GRANTED TO ONE SIDE AND WITHHELD FROM THE OTHER — and it is the
   * same id `allies.02.instrument-room` uses, with the armies the other way
   * round, which is `unit.raider` doing exactly what a per-army tag is for.
   *
   * The player's half is A PERMISSION THE LAYOUT NEEDS rather than a
   * restriction the player feels, and that inversion is worth stating because
   * it is peculiar to an operation with no production.
   * `ScenarioBuilder.spawnUnit` asks `isBuildable` before it places anything,
   * so without this line the two Arcspitters in the party silently would not
   * exist. Nothing else in the party is tagged: `rclSlagger`, `rclPicker` and
   * `rclGrinder` are all day-one open.
   *
   * The AI's half is an ordinary restriction and does real work. `ai: []` takes
   * every tagged def an Allied seat could field — the Sabre IFV, the Prism Tank,
   * the Vindicator, the Field Marshal, the Prism Tower, the AA Battery, the
   * Battle Lab, the repair pad and both Allied superweapons. (Ten rows of
   * `UNLOCK_TAGS`, counted 2026-08-19; this list omitted the Vindicator and the
   * Field Marshal while reading as complete.)
   *
   * Measured on the built world it is worth two structures and two hulls out of
   * the depot's opening: **81 buildings / 14 units unbound, 79 / 12 with the
   * roster in force** — and the four in the difference are, by footprint and hp,
   * the Battle Lab (2x2, 900), the Prism Tower (1x1, 600) and two Sabre IFVs
   * (220 each). BOTH HALVES ARE LOAD-BEARING, which is why all four combinations
   * were taken rather than two: bound-with-no-roster reads 81/14 and
   * UNBOUND-WITH-THE-ROSTER reads 81/14 as well, because the fallback tables
   * carry no `unlockedBy` and the allow-list waves an untagged def through. Only
   * bound-and-rostered reads 79/12. The one that matters is the IFV: 8.4 m/s of
   * fast light armour is precisely what runs a foot party down on open snow, and
   * an infiltration must not be facing one.
   */
  roster: { player: ['unit.raider'], ai: [] },

  objectives: [
    {
      id: 'books',
      kind: 'primary',
      title: 'Destroy the district register and its counterpart',
    },
    {
      id: 'out',
      kind: 'primary',
      title: 'Bring the crew back to the pickup on the far road',
    },
    {
      /*
       * NOT PAID IN CREDITS, AND NOT AN OVERSIGHT — see the header. A player
       * with no producer and no build radius cannot spend a bonus, so the
       * reward is the medal `medalFor` derives from exactly this row.
       */
      id: 'quiet',
      kind: 'secondary',
      title: 'Take both books without the halt reporting a party',
    },
  ],

  triggers: [
    /* -- the brief, in two beats ------------------------------------------
     * Split across twelve seconds because the shell renders dialogue as toasts
     * and three at once is a stack nobody reads. The premise lands first and
     * the RULE lands last and alone, in numbers, because it is the only thing
     * in the operation a player cannot work out by looking.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Survey 58-273, the district freight halt. Depot Four raised a shortfall against '
            + 'Depot Nine, both of them found the same name on both invoices, and the district '
            + 'answered by requisitioning Number Six yard as recovered plant at scrap value.',
        },
        // The whole halt, before it is a problem. `revealArea` EXPLORES ground
        // rather than showing live units, so 68 m puts the wire, the gate and
        // all four boxes on the map while the player still has the match to
        // answer them, and Cregg's second beat is what carries the count.
        { do: 'revealArea', player: 0, area: HALT_AREA },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(16) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'A requisition is not served until the schedule is entered in the district '
            + 'register and the counterpart is lodged against it. Both books are in the two '
            + 'blocks inside that wire. No entry, no notice, and the yard stays on our paper.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'You are a work party and nobody looks twice at one. Sixty seconds on that '
            + 'siding and somebody has had time to write you down — come off it and the count '
            + 'starts again. The gate road is covered end to end; go in through the back wire, '
            + 'and only the Slaggers will open it.',
        },
        // Where the lorries are. Named here rather than at the end, because the
        // pickup is on the far side of the halt and a player who learns that
        // after the books are down has learned it too late to route around the
        // boxes.
        { do: 'revealArea', player: 0, area: PICKUP_AREA },
      ],
    },

    /* -- the ground, once they are standing on it -------------------------
     * `unitsInArea` UNTAGGED IS THE EXPENSIVE SPELLING and it is the right one:
     * the question is whether ANYTHING of the player's has reached the halt,
     * and tagging would mean naming in advance which of them counts. It walks
     * `store.alive` twice a tick — once for the arming pass — until it fires,
     * and `state.fired` retires it for the rest of the match.
     *
     * IT CANNOT FIRE ON TICK ONE, AND THE BOUND IS THE NEAREST MAN RATHER THAN
     * THE INSERTION POINT. `INSERT` is 150.00 m from the halt, but the party is
     * posed in ranks either side of it and the closest of the twelve is
     * measured at **142.56 m** — so the margin against a 52 m disc is 90.56 m,
     * not 98. `reclamation.01.held-paper` records having to measure exactly this
     * for its own scouting trigger (its bound was the Rookery's crew at 104.3 m,
     * not the Rookery at 92.8), which is why it is measured here too.
     */
    {
      id: 't.arrive',
      when: { on: 'unitsInArea', player: 0, area: WIRE, min: 1 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Four concrete boxes: two on the gate and one on each long side. Twenty-two '
            + 'metres of reach apiece. Neither block is inside one — you can stand on the '
            + 'paperwork all day. It is the gate road and the way home that they are for.',
        },
      ],
    },

    /* -- the shift telephones it in ---------------------------------------
     * THE ONE MECHANIC. Sixty continuous seconds of anything of the player's
     * inside the counted ground.
     *
     * GATED ON `objectiveComplete('books')` RATHER THAN ON `entityDead`, AND THE
     * DIFFERENCE IS ONE TICK. Objective state is written when the sink APPLIES
     * the effects, after every trigger has been evaluated; `entityDead` is a
     * fact about the world and is already true on the tick the second block
     * dies. Against the objective this stays open for that tick, which is what
     * makes `t.quiet` below read the failure on the next one rather than racing
     * it. Airtight in both directions, at one frame of latency nobody can see.
     * `allies.02.instrument-room` draws the same distinction for the same
     * reason.
     *
     * `not` is legal over `objectiveComplete` and would NOT be legal over
     * `elapsedSinceArmed` — `validateCampaign` refuses the second, because it
     * reads true during the arming pass, so the negation reads false and the
     * trigger can never arm.
     */
    {
      id: 't.watch',
      when: {
        on: 'all',
        of: [
          { on: 'not', of: { on: 'objectiveComplete', id: 'books' } },
          { on: 'unitsInArea', player: 0, area: WIRE, min: 1 },
          { on: 'elapsedSinceArmed', ticks: SHIFT },
        ],
      },
      then: [
        { do: 'failObjective', id: 'quiet' },
        /*
         * BEFORE THE EVENT RATHER THAN ON IT, WHICH IS THE ONLY WAY A SCRIPTED
         * `eva` EARNS ITS PLACE. `audio.system.ts` already speaks this line on
         * any attack; nothing is attacking yet. The watch forms 48.00 m from
         * the halt on the GATE side, the crew is at the back wire 41 m out on
         * the other, and a `gi` walks at 3.2 m/s — so the line lands tens of
         * seconds ahead of any contact rather than on top of it.
         */
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'That is the shift on the telephone. Somebody has been standing on that siding '
            + 'long enough to be a line in a book, and their watch is coming out of the block '
            + 'behind the gate.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: WATCH_OUT, spread: 12, tag: 'watch',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: WATCH_OUT, spread: 16, tag: 'watch',
        },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: HALT },
      ],
    },

    /* -- the second crew ---------------------------------------------------
     * TALLOW PAYS IN PLANT, NOT IN MONEY, because on this operation money is
     * the one thing that does nothing. Two Slaggers and two Pickers is 940
     * credits of foot against a party that opened with 3 920, and they land at
     * the insertion point 150.00 m from the halt — 50.0 s of walking at 3.0 m/s,
     * which is the price of having needed them.
     *
     * `reinforcements` is the right line because no announcer EVENT corresponds
     * to a scripted wave. **IT IS NOT A LINE NOTHING ELSE SPEAKS, AND THIS SAID
     * IT WAS THE ONE SUCH LINE.** `src/sim/orecrisis.system.ts` emits
     * `EvaLine.Reinforcements` for the stranded-economy rescue, and it reaches
     * the announcer through `EVA_LINE_ID` on `audio.system.ts`'s ordinary
     * `eva:line` path — so the claim was false before this file was written, and
     * `soviets.06.demolition-order` records the same correction independently.
     * Harmless here twice over: the rescue needs a standing refinery, which a
     * party with no base can never have.
     *
     * LITERAL RECLAMATION KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against
     * the army of the seat it lands on, so an Allied key here is a build error.
     */
    {
      id: 't.crewUp',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Tallow put a second crew on the road behind you. Two satchels and two rifles, '
            + 'nine hundred and forty against a party that cost her four thousand. She has '
            + 'written it against the yard, so try to be worth it.',
        },
        {
          do: 'spawnUnits', player: 0, key: 'rclSlagger', count: 2, at: INSERT, spread: 10, tag: 'crew',
        },
        {
          do: 'spawnUnits', player: 0, key: 'rclPicker', count: 2, at: INSERT, spread: 14, tag: 'crew',
        },
      ],
    },

    /* -- the district's own working ---------------------------------------
     * Minute three, unconditional, off the depot's own gate. The wave is not
     * what makes this dangerous — it is that Depot Four's column is 74.00 m out
     * of its yard and pointed at the halt at a KNOWN minute, 119.08 m short of
     * it, which is a schedule an opponent keeps rather than an army that
     * materialises inside a working party.
     *
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these six
     * do and the brain owns them afterwards. That is the honest limit of what a
     * scripted wave buys, and `soviets.03.deep-sector` states it.
     *
     * **THE SCRIPTED WAVES ARE A FLOOR ON THE PRESSURE AND DELIBERATELY NOT THE
     * WHOLE OF IT.** The depot also has a base, a bank and a brain. What that
     * brain does with an enemy who owns no buildings at all is NOT measured
     * here and should not be assumed: `AiBrain` picks its objective off the
     * enemy's assets, and every shipped measurement of it was taken against an
     * opponent with a base to march at.
     */
    {
      id: 't.working',
      when: { on: 'elapsed', ticks: WORKING },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle, intercepted',
          text: 'Depot Four working, up the lane to the halt, on the sheet as usual. If there '
            + 'is a Reclamation party on that siding they have a docket for it, because they '
            + 'always have a docket. Check it and log the time.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HALT },
      ],
    },

    /* -- and the second one ------------------------------------------------
     * Minute nine, same gate, same two rings. This is the wave for the evening
     * that did NOT go well: a player still working at minute nine has lost men,
     * tripped the shift or gone back in for a second visit, and this is what
     * that costs. A clean run has been on the lorries for five minutes and
     * never sees it.
     *
     * It joins the `column` tag rather than taking its own, so `t.books`
     * re-points the survivors of both workings with one command —
     * `EffectSink.orderTagged` issues ONE command per owner and both are seat 1.
     */
    {
      id: 't.press',
      when: { on: 'elapsed', ticks: SECOND_WORKING },
      then: [
        {
          do: 'dialogue',
          speaker: 'Ardle, intercepted',
          text: 'Second working, and this time somebody has read the first one. There is no '
            + 'docket for a Reclamation party on that siding and there never was. Clear it.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: HALT },
      ],
    },

    /* -- both books out ----------------------------------------------------
     * `entityDead` is true only when NO entity carrying the tag is alive, so
     * this needs both blocks down, which is the point: the entry and the
     * counterpart are two documents and the district keeps them in two sheds
     * fifty feet apart and calls that a check.
     *
     * THE ANSWERING COLUMN USES THE SAME TWO RINGS AS BOTH WORKINGS, at the
     * same point, so one measurement covers all three waves — 4 infantry at
     * 12 m and 2 hulls at 18 m about `ROAD`, all six standable, worst clearance
     * 3.7 m. A fourth wave with different radii would need its own check, which
     * is why there is not one.
     *
     * The `column` tag is shared deliberately: `EffectSink.orderTagged` issues
     * ONE command per owner, both waves are seat 1, and survivors of the first
     * rejoining the second is what a human commander would produce. It re-points
     * the whole tag at the PICKUP, because the books are gone and the only thing
     * left worth catching is the crew.
     */
    {
      id: 't.books',
      when: { on: 'entityDead', tag: 'register' },
      then: [
        { do: 'completeObjective', id: 'books' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Register and counterpart, both of them off the siding. There is no entry to '
            + 'make now and nothing to lodge it against. They can write that notice as often as '
            + 'they like — it is not served until it is filed, and there is nowhere to file it.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD, spread: 12, tag: 'column',
        },
        {
          do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD, spread: 18, tag: 'column',
        },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: PICKUP },
      ],
    },

    /* -- the medal ---------------------------------------------------------
     * ONE TICK AFTER THE BOOKS, BY CONSTRUCTION. `objectiveComplete('books')`
     * cannot be true until the sink has applied `t.books`'s effects, which is
     * after `t.watch` has had its last look at the same tick. So a party that
     * loitered on the way has already failed this by the time it is evaluated,
     * and there is no ordering between the two that a later edit can get wrong.
     *
     * ABOVE `t.win`, which is this file's rule: `runDirector` returns early once
     * an outcome is set, so a secondary written below the win can never resolve
     * on the winning tick and the medal never counts it. It cannot collide here,
     * because the crew still has 150 m to walk; the ordering is kept anyway so
     * nobody has to re-derive that.
     */
    {
      id: 't.quiet',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'books' },
          { on: 'not', of: { on: 'objectiveFailed', id: 'quiet' } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'quiet' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'And nobody at that halt wrote anything down. When the district asks what '
            + 'happened to its register the only paper anybody can produce is ours.',
        },
      ],
    },

    /* -- the week closing, telegraphed ------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Two minutes. Whatever is still on that siding at sixteen is theirs, and '
            + 'whoever is still on it is a name they can put in the next notice.',
        },
      ],
    },

    /* -- the win -----------------------------------------------------------
     * BOTH HALVES, AND THE SECOND ONE IS WHY THE PICKUP IS WHERE IT IS. The
     * books are only the first primary; a crew that went in and did not come
     * out has not finished an infiltration, it has spent one.
     *
     * `tag: 'crew'` IS LOAD-BEARING. `unitsInArea` has no role filter and no
     * kind filter, so an untagged count would be satisfied by two Arcspitters
     * parked on the pickup while every man was dead in the yard. The layout
     * stamps `crew` on the eight foot it places and `t.crewUp` stamps it on the
     * four it sends, and — because there is no production — that tag covers
     * one hundred per cent of the foot the player will ever own, provably
     * rather than by convention.
     *
     * `min: 2` against twelve tagged men over the operation: the bar is that
     * somebody came home with it, not that everybody did.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'register' },
          { on: 'unitsInArea', player: 0, area: PICKUP_AREA, min: 2, tag: 'crew' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'out' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Crew is on the lorries. The district still owns everything it owned this '
            + 'morning and it cannot prove a word of it. Number Six is on our paper because '
            + 'ours is the only paper left — which is how it has been the whole time.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the two ways the week runs out ------------------------------------
     * TWO TRIGGERS ON ONE TICK COUNT, BECAUSE THEY ARE NOT THE SAME FAILURE.
     * A crew that never reached the books and a crew that took them and is
     * still walking are different evenings, and the end screen resolves
     * `reason` to that objective's title. Both sit BELOW `t.win`, so a crew
     * that reaches the pickup on the closing tick wins: the ground beats the
     * paperwork, which is the whole chapter.
     *
     * `setObjective` refuses to un-resolve a completed objective — "the first
     * answer is the one the player saw" — so `failObjective('books')` in the
     * second of these is a no-op whenever the books really did go down, and it
     * is left in rather than guarded because the guard would be a second copy
     * of a rule the session already holds.
     */
    {
      id: 't.late',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: CLOSING },
          { on: 'objectiveComplete', id: 'books' },
        ],
      },
      then: [
        { do: 'failObjective', id: 'out' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The books are gone and so is the crew that took them. The district will not be '
            + 'requisitioning anything, and it will have four men of ours to ask about it. '
            + 'That is a worse week than the one we started with.',
        },
        { do: 'endOperation', result: 'loss', reason: 'out' },
      ],
    },
    {
      id: 't.close',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: CLOSING },
          { on: 'not', of: { on: 'objectiveComplete', id: 'books' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'books' },
        { do: 'failObjective', id: 'out' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Register is intact and the schedule goes in tonight. By the morning Number Six '
            + 'is district plant at scrap valuation and there is a form saying so. Tallow will '
            + 'want to know which of us reads the forms.',
        },
        { do: 'endOperation', result: 'loss', reason: 'books' },
      ],
    },

    /* -- the party is gone -------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — and on this operation the first half is true from
     * tick one, so this reduces to "every hull is dead". It is the honest
     * threshold and it is the ONLY loss the vocabulary can express for a seat
     * with no base: `ownerCount(role: 'any', max: 0)` would say the same thing
     * one tick later and would also be true of a party riding inside a
     * transport, which is a state this operation cannot reach but a later edit
     * could.
     *
     * `reason: 'out'` in both directions. Whether or not the books went down,
     * what happened is that the crew did not come home, and that is the
     * objective the end screen should name.
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'books' },
        { do: 'failObjective', id: 'out' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing answering on the siding. They will find twelve of ours in the snow '
            + 'with no docket between them, and that is a story the district can write down '
            + 'any way it likes.',
        },
        { do: 'endOperation', result: 'loss', reason: 'out' },
      ],
    },
  ],
};

export default op;
