/**
 * ============================================================================
 * A2 — INSTRUMENT ROOM
 * ============================================================================
 * The Works kept a district office on Survey 12-206 and the Soviets kept the
 * district. The levelling drum, the theodolites and eleven years of field
 * returns are still in the building, because nobody who took the ground had a
 * use for them. Aubray wants the room, not the block it stands in.
 *
 * ============================================================================
 * WHAT `infiltrate` CAN MEAN WHEN THERE IS NO STEALTH, AND WHAT WAS CUT
 * ============================================================================
 * There is no stealth in this game — no cloak, no detection, no vision
 * predicate in the twelve conditions and no thirteenth on offer. So the word
 * has to be built out of things the vocabulary can actually say, and there are
 * exactly two:
 *
 *     unitsInArea      how many of your units are standing in that disc
 *     entityHpBelow    whether that gun has been shot at
 *
 * **THE RULE IS A HEADCOUNT.** Five or more of the player's units inside the
 * 96 m cordon, or one round into any of the five emplacements, and the district
 * turns its watch out. Four or fewer, and it does not. That is not a
 * translation of stealth into a count — it is the true thing a checkpoint can
 * know, and the fiction is written to be the mechanic rather than to excuse it:
 * a survey district has traffic through it all day and waves a work party
 * past. A column is a different noun.
 *
 * The condition counts UNITS and asks nothing about what they are for, which
 * is why the layout places all three ore fields on the far side of the lane —
 * a harvester inside the cordon is a unit inside the cordon, and failing the
 * player for an economic decision they could not connect to the rule would be
 * the worst kind of loss.
 *
 * **WHAT WAS CUT.** A thirteenth condition — call it `seenBy(player)` — is the
 * obvious ask and it was not made. It needs a vision query inside `simTick`
 * that `WorldQuery` does not have, it would be the only condition whose answer
 * depends on fog rather than on world state, and every operation in the table
 * that looked like it wanted one wants this instead: a number, said out loud in
 * the briefing, that the player can count on their own screen. Also cut: a
 * relay mast to destroy for a smaller reaction. It works, it is expressible in
 * two triggers, and it is `reclamation.01.held-paper`'s transformer wearing a
 * different noun one chapter later. One trick, once.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS, IN MEASURED METRES
 * ============================================================================
 * Every figure below is read off a world built headless at these exact seeds —
 * the same build `tests/campaign-maps.spec.ts` performs — after
 * `spawnBuilding` snapped each footprint to the placement grid.
 *
 *     player Construction Yard   (114, 382)
 *     Soviet Construction Yard   (402, 134)      380.1 m apart
 *     the office                 (332, 286)      238.2 m from the player,
 *                                                167.3 m from the Soviets
 *     the cordon, five guns      (310, 366) (302, 334) (290, 302)
 *                                (278, 274) (258, 246)
 *                                83.0 / 56.6 / 44.9 / 55.3 / 84.1 m out,
 *                                130.8 m of frontage, 22 m of reach each
 *
 * Three of those numbers are the operation:
 *
 *   - **THE OFFICE IS 44.9 m FROM THE NEAREST GUN AGAINST A 22 m ARC**, so an
 *     unarmed man can stand on the objective and take no fire at all. Without
 *     that there is no quiet route and the whole premise collapses into an
 *     assault with extra steps.
 *   - **THE DIRECT LINE RUNS OVER THE MIDDLE GUN.** The straight run from the
 *     player's yard to the office passes **2.28 m** from (290, 302), 193.3 m
 *     along a 238.2 m line — about forty-four metres of it inside a 22 m arc
 *     (the chord is 43.8 m). The other four guns are 31.8, 32.7, 64.3 and
 *     66.4 m off that line and touch it nowhere. One gun on the axis,
 *     deliberately: marching at the objective is a decision, not an accident.
 *   - **THE WAY ROUND COSTS 102 m OF ROUTE.** 8-connected octile Dijkstra on
 *     the 4 m cell grid, `Terrain.passGrid`'s Foot bit with occupancy folded
 *     in — so the district's own wall segments and every other footprint are
 *     shut — with every cell whose centre lies inside 22 m of a gun also
 *     removed. Endpoints are the nearest open cell to each centre: 6.00 m off
 *     the office, 8.00 m off the yard. The descent chain and the
 *     cheapest-predecessor chain agree on every figure here.
 *
 *         straight line, centre to centre        238.2 m
 *         shortest route, no arcs banned         248.5 m
 *         shortest route that never enters an arc  350.7 m
 *
 *     So the detour is **102.2 m of route**, about 30 s of extra walking at an
 *     engineer's 3.4 m/s. **The comparison has to be route against route** —
 *     this block used to read "316.3 m against 240.3 m direct", which set a
 *     route beside a STRAIGHT LINE and so counted the grid's own 10 m of
 *     octile overhead as part of the price of going round. The bow does not
 *     wrap — the yard side and the rear are open — and the ends stop because
 *     the streets do. On the raw terrain grid with nothing occupied the same
 *     three figures are 238.2 / 255.8 / 360.3.
 *
 * **SO THE PRICE OF THE QUIET ROUTE IS THE FOUR BODIES, NOT THE WALK**, and it
 * is worth saying that plainly rather than letting a hundred-metre detour
 * pretend to be the cost. Counted on a world built with the def tables BOUND and this
 * operation's roster IN FORCE — the only state in which either is true — the
 * two openings are **11 combat units against 11**:
 *
 *     player     4 Warden Tanks, 2 Sabre IFVs, 5 G.I.s   + 1 engineer, 2 harvesters
 *     district   5 Anvil Tanks, 6 Conscripts             + 2 harvesters
 *
 * The player is allowed to take four of those past the checkpoint, and one of
 * the four has to be the engineer, because an engineer is the only thing that
 * opens the door. The district's advantage is five emplacements and a wall,
 * which is the correct shape for an attacker's problem and the reason the
 * answer is four men rather than a fight.
 *
 * The loud route is the safe one and it is meant to be: bring the army, break
 * five emplacements, walk the engineer in behind them, and pay a watch
 * detachment and the medal for it. Neither branch is the trap.
 *
 * ============================================================================
 * THE OFFICE IS NEUTRAL, AND THAT DECIDES BOTH HALVES OF THE MATCH
 * ============================================================================
 * `Capture.ts` rule 1: a `Faction.Neutral` structure changes hands outright, at
 * any health, for one engineer. That is what makes "recover" mean recover — the
 * player never has to shoot the thing they were sent to bring home.
 *
 * It also decides who can kill it, in both directions and at different times.
 * Gaia is allied to everybody, so **before the capture the only army that can
 * destroy the office is the player's own** — splash off the cordon fight, and a
 * genuine way to lose that is instructive rather than unfair. **After the
 * capture it is an Allied building alone in a Soviet district**, and every gun
 * on the map may fire at it. One structure, two eras, one `entityDead` trigger,
 * and two different lines of dialogue for the two failures because they are not
 * the same mistake.
 *
 * The layout's header carries the arithmetic for why the alternative — a
 * Soviet-owned office softened by engineers — was refused, including the
 * correction that it costs FOUR engineers and not the three `Capture.ts`'s own
 * header claims.
 *
 * ============================================================================
 * THE HOLD RESTARTS, AND `min: 1` IS WHY IT CAN
 * ============================================================================
 * `t.win` is `structureCaptured` AND at least one unit within 26 m AND
 * `elapsedSinceArmed(210 s)`. Owning the office is not holding it: the copy has
 * to be made by somebody standing in the building, so being driven off the disc
 * disarms the trigger and the three and a half minutes start again. That is
 * `allies.01.sounding-line`'s rule and it is here for the same reason — a hold
 * that can be lost at three minutes twenty is a hold the player has to decide
 * what to spend on. Aubray says it out loud on the capture, because a rule a
 * player can only learn by losing it is a rule badly told.
 *
 * **`structureCaptured` CAN RESTART NOW.** A disciplined AI may buy an engineer
 * and retake a visible legal office; a second player capture makes the condition
 * true again. The `unitsInArea` clause remains the reason the objective is a
 * hold rather than a remote ownership check.
 *
 * Timing, against the two scripted waves:
 *
 *     capture          relief spawns 106.0 m out — Anvils 20 s, Conscripts 31 s
 *                      5 Conscripts and 3 Anvils, 3 200 credits
 *     capture + 105 s  second column 120.2 m out on the Soviets' own road
 *                      4 Conscripts and 2 Anvils, 2 200 credits
 *     capture + 210 s  the copy is out
 *
 * 5 400 credits of hull against a 3 000 opening bank, arriving in two pieces
 * over three and a half minutes rather than at once. That is more than the
 * player could have bought at t = 0 and it is meant to be: by the time the
 * office changes hands they have had four to six minutes of income, and the
 * waves are a FLOOR on the pressure rather than the whole of it — the district
 * also has a base, a bank and a brain.
 *
 * The player's own armour crosses the 238.2 m from home in 36 s at a Warden's
 * 6.6 m/s, so a crew that takes the office alone can be relieved — but only by
 * an army that started moving at the capture, which is the second half of the
 * decision the first half set up.
 *
 * ============================================================================
 * THE ROSTER IS ASYMMETRIC AND IT IS ABOUT ONE UNIT
 * ============================================================================
 * `unit.raider` resolves per army: the Sabre IFV for the Allies, the **Attack
 * Dog** for the Soviets. Granting it to the player and withholding it from the
 * district is the one roster line this operation needs, and both halves point
 * the same way:
 *
 *   - the player keeps the two IFVs their opening garrison lays down — 8.4 m/s
 *     against a Warden's 6.6 — which is the only ungated answer this army has
 *     to a problem that is mostly distance;
 *   - the district does not get the fast scout that would find a four-man crew
 *     in open ground and kill it, which is exactly the unit an infiltration
 *     must not be facing.
 *
 * Everything else is refused for both seats, which is what an empty list means:
 * the roster is an ALLOW-LIST over tagged content, so `ai: []` also takes the
 * Sledge Tank, the Tesla Coil and the Proving Ground off the Soviets, and the
 * player gets no Refractor Tower and no Proving Ground either. What is left is
 * the opening path plus one fast hull, on both sides, on a fresh profile and on
 * a finished one alike.
 *
 * ============================================================================
 * NOTHING IS HIDDEN, AND THAT IS A CHOICE
 * ============================================================================
 * `briefingObjectives` filters hidden rows out of the briefing, so a hidden
 * secondary really is a surprise, and this operation deliberately does not use
 * one. The decision it owns is the COMPOSITION OF THE PARTY, taken before the
 * player leaves their own build radius. A secondary revealed by walking into
 * the district arrives after that decision is locked and can only be answered
 * by walking a fifth unit in — which is the thing the operation is about not
 * doing. A bonus the player cannot act on is a quiz, and
 * `reclamation.01.held-paper`'s header already refuses that in as many words.
 *
 * The derrick is the substitute and it is not an objective. It stands INSIDE
 * the counted disc, 44.9 m from the office, neutral, and `civilian.system.ts`
 * pays whoever holds it for the rest of the match. Taking it costs a second
 * engineer and one of the four bodies. Exactly one trigger notices, and it only
 * says so.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because flattening the Soviet base does not copy a drum,
 * and this operation is winnable — is meant to be won — without a second
 * engagement. `assetLossDefeat` because the interesting last act here is a
 * commander who has lost their base and still owns a building 240 m away with
 * two men in it; `Shell.pollOutcome` would end that at 2 Hz. `t.rout` is the
 * authored replacement and it reads `playerBeaten`, which is
 * `Viability.isBeaten` — nothing to build with and nothing to fight with —
 * rather than "owns no buildings", which would be wrong in both directions.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { seconds } from '../../types';
import type { Area, OperationDef, Point } from '../../types';

/* ==========================================================================
 * THE MEASURED POINTS
 *
 * READ OFF A BUILT WORLD, NOT RECOMPUTED FROM THE LAYOUT'S FRACTIONS.
 * `allies-instrument-room` derives everything from the two start spots and
 * then walks each footprint outward in rings to ground `isBuildable` accepts;
 * a trigger table can see none of that and has to name world points. These are
 * `store.posX/posZ` of the tagged entities after that search, at
 * `mapSeed` 20 260 826 / `simSeed` 7 021, rounded to the metre — the search
 * moved the office 0.4 m and the derrick 1.9 m off their nominal points, so
 * the rounding is smaller than the snapping it is recording.
 *
 * **RE-MEASURE IF EITHER SEED OR THE LAYOUT'S TWO FRACTIONS MOVE.** Nothing
 * fails loudly if they drift: `unitsInArea` would simply stop counting the
 * right ground and the cordon rule would quietly become a rule about somewhere
 * else. Every radius below is wider than any placement wobble the ring search
 * can produce (24 m) for that reason.
 * ========================================================================== */

/** The Works survey office. Neutral until an engineer walks in. */
const OFFICE: Point = { x: 332, z: 286 };

/**
 * The counted district. 96 m, which puts all five guns inside it — the
 * outermost is 84.1 m out — and leaves the Soviet base, 167.3 m away, outside.
 *
 * **THE LANE BETWEEN THE TWO OPENINGS PASSES 71.8 m FROM THE OFFICE, WHICH IS
 * INSIDE THIS DISC, AND THAT IS DELIBERATE.** A player who marches on the
 * Soviet base drives a column straight through the district, and the checkpoint
 * has no way to know it was not for them. Losing the secondary for it is the
 * rule working: this operation is about what you bring past the guns, not about
 * why you brought it.
 */
const CORDON: Area = { x: OFFICE.x, z: OFFICE.z, r: 96 };

/**
 * The ground the copy is made from. 26 m, so it covers the office's 8 x 12 m
 * footprint plus room for `Movement.relax` to separate a squad — a disc a
 * defence cannot stand inside is a hold that restarts on its own.
 */
const OFFICE_HOLD: Area = { x: OFFICE.x, z: OFFICE.z, r: 26 };

/**
 * Where the district's own watch comes out, 64.1 m behind the office on the
 * block side.
 *
 * **THE RING IS WHAT HAS TO BE PROBED, AND "8 SAMPLES" WAS NOT IT.** This said
 * "probed buildable at the point and on 7 of 8 samples of the spawn ring", and
 * the sample was of the author's own choosing rather than of the code's:
 * `EffectSink.spawnUnits` puts unit `i` of `count` at `angle = i / count * 2pi`
 * and radius `spread`, so this point is TWO rings — 4 conscripts at 16 m on
 * bearings 0/90/180/270 and one Rhino at 22 m on bearing 0 — and never eight
 * samples of anything. The 16 m ring's bearing-180 drop was on rock, because
 * `ProductionService.spawnUnit` does NO egress search and a scripted drop is
 * used verbatim. Re-measured through `ITerrain.isPassable` on the built world
 * at this point: **all five drops passable, worst clearance 12.04 m** to the
 * nearest cell that locomotor could not enter. `tests/campaign-spawn-ground.spec.ts`
 * is the gate; the distance above is prose and has none, so re-derive it if
 * this point moves.
 */
const WATCH_OUT: Point = { x: 395, z: 298 };

/**
 * The relief, 95.4 m from the office on the yard road.
 *
 * OFF A DIFFERENT BEARING FROM THE SOVIET BASE, WHICH IS THE WHOLE REASON IT
 * IS A SCRIPTED WAVE. `AiBrain` sends its own army out of its own yard, which
 * is 167.3 m away on the opposite side of the office; a scripted column
 * arriving from the same place would be indistinguishable from it and would
 * buy the operation nothing. This one comes in behind the player, on the flank
 * the quiet route uses.
 *
 * Two rings again — 5 conscripts at 16 m, 3 Rhinos at 22 m — **all eight
 * passable, worst clearance 13.04 m**. It was 12 m east of here and the Rhino
 * on bearing 0 stood on rock.
 */
const RELIEF: Point = { x: 415, z: 333 };

/**
 * The second column, 120.2 m from the office and 113.7 m from the Soviet
 * Construction Yard at (402, 134) — up their own road, so the two waves are a
 * pincer rather than a queue.
 *
 * Unmoved: its two rings (4 conscripts at 16 m, 2 Rhinos at 22 m) were already
 * clean, worst clearance 7.28 m.
 */
const PRESS: Point = { x: 443, z: 240 };

/**
 * Ticks the copy takes.
 *
 * 210 s against an 840 s par, and the rest of the budget is walked, built and
 * argued over rather than waited. The relief lands at +20 s and the second
 * column at +127 s, so the last 83 s are fought with both of them on the
 * ground. Shorter and the second wave is decoration; longer and the operation
 * stops being about the approach.
 */
const COPY = seconds(210);

/** When the second column leaves. Timed so it arrives with 83 s left to run. */
const PRESS_AT = seconds(105);

const op: OperationDef = {
  id: 'allies.02.instrument-room',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * SOVIETS, AND THE PROSE IS WHERE IT COMES FROM.
   *
   * Aubray's opening line says "the Soviets took the district in week one" and
   * Wend's names their checkpoint; both waves are literal `conscript` and
   * `rhino`, which `validateCampaign` refuses on any seat that is not Soviet.
   * It is also the beat grid: `docs/campaign/CAMPAIGN_BUILD_SPEC.md` §2.1 divides the Works
   * at the Split — "The Allies took the survey office and the instruments; the
   * Soviets took the yards and the plate mills" — and this operation is the
   * one office that sentence did not cover.
   */
  foe: Faction.Soviets,
  index: 2,
  title: 'Instrument Room',
  beat: 'The instruments are still in the building. Nobody has thought to move them.',
  primaryType: 'infiltrate',
  // Objective state, spawns, orders, dialogue and a reveal — multiple effect
  // kinds, so 'bespoke' by the definition in `types.ts`. The label is about
  // MECHANISM: the drama is a headcount and a gun line, both of which are in
  // the layout before tick one.
  archetype: 'bespoke',
  parSec: 840,
  requires: ['allies.01.sounding-line'],

  map: {
    preset: 'urban',
    /*
     * THE DATE, ONE WEEK AFTER A1's.
     *
     * `allies.01.sounding-line` pins `mapSeed` 20 260 819 and A2 is week 3 to
     * its week 2, so this is that date plus seven and `simSeed` is 7 014 plus
     * seven on the same counter. That is a convention and not a mechanism —
     * what the numbers actually have to do is produce the ground the header
     * measures, and `tests/campaign-maps.spec.ts` builds it on every run.
     *
     * **`simSeed` IS LOAD-BEARING GEOMETRY.** `seatedSlots(2, 7021, null)`
     * returns [0, 1] — an ANTIPODAL pair, 386.16 m of start separation — and
     * every distance in this file is derived against it. The edge pairs [0, 2]
     * and [1, 3] are 296.00 m apart and would put the office 60 m closer to
     * both openings at once. Change this and re-measure; do not re-read.
     */
    mapSeed: 20_260_826,
    simSeed: 7_021,
    armies: 2,
    biome: 'urban',
    opening: 'base',
    /*
     * NOT THE SKIRMISH 10 000, AND NOT A1's 2 500 EITHER.
     *
     * The purchase this operation is priced around is ENGINEERS. The opening
     * garrison ships exactly one; the office needs one and the derrick needs a
     * second, and an engineer that dies on the way costs 500 and the walk back.
     * 3 000 buys two spares and still leaves a production decision, which is
     * the number that makes the quiet route affordable to attempt twice rather
     * than a single-shot gamble.
     *
     * It binds the Soviet seat identically — `Shell.applySimPostBoot` writes
     * `setup.startingCredits` into every non-Neutral slot, skipping Gaia by
     * FACTION rather than by index — and that is
     * the lever CLAUDE.md names for the opening bank that has been reported as
     * a prebuilt AI base twice. A district that has not noticed anything should
     * not be putting up seven buildings in ninety seconds.
     */
    credits: 3_000,
  },
  layout: 'allies-instrument-room',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // See the header. One id, granted to the player and withheld from the
  // district, and it is the same unit on both sides of that sentence.
  roster: { player: ['unit.raider'], ai: [] },

  objectives: [
    { id: 'take', kind: 'primary', title: 'Take the Works survey office' },
    { id: 'hold', kind: 'primary', title: 'Hold the office while the record is copied' },
    {
      id: 'crew',
      kind: 'secondary',
      title: 'Take the office with four units or fewer inside the cordon',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the brief, in two beats ------------------------------------------
     * Split across eleven seconds because the shell renders dialogue as toasts
     * and three at once is a stack nobody reads. The rule is in the second
     * beat, in numbers, and it lands last and alone.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Survey 12-206. The Works kept a district office here — a levelling drum, four '
            + 'theodolites and eleven years of field returns, all of it still in the building. '
            + 'The Soviets took the district in week one and have not been inside.',
        },
        // The whole cordon, before it is a problem. 104 m covers the outermost
        // gun at 84.1 and the derrick at 44.9, so the player is looking at the
        // real shape of the decision while they still have the match to answer
        // it. `revealArea` EXPLORES ground rather than showing live units, so
        // Wend's line below is what actually carries the count.
        { do: 'revealArea', player: 0, area: { x: OFFICE.x, z: OFFICE.z, r: 104 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Five guns on the two streets they think anybody would come down. Twenty-two '
            + 'metres of reach each. The nearest one is forty-five metres off the office and '
            + 'cannot see it, and the yard side has nothing on it at all.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Send a work party. Four bodies inside the district and the checkpoint waves '
            + 'them through — five is a column and they turn out. Do not fire on the guns. '
            + 'An engineer opens the door.',
        },
      ],
    },

    /* -- the checkpoint counts --------------------------------------------
     * THE ONE MECHANIC. `unitsInArea` is untagged deliberately: the question is
     * how many of the player's units are standing in the district and the
     * answer must not depend on which ones an author remembered to name. That
     * is the expensive spelling — `runtime.ts` walks the alive list twice a
     * tick for it, once for the arming pass — and it is bought back by
     * `state.fired` retiring the trigger the moment it goes off.
     *
     * `entityHpBelow` at 0.99 on the whole cordon is the second half and it is
     * what makes the fiction honest. A count alone would let the player shell
     * the gun line from outside the disc and still be waved through, and no
     * checkpoint in the world works that way. 0.99 is the cheapest available
     * reading of "somebody has taken a shot"; the vocabulary has no damage
     * event and does not need one. It reads the WEAKEST live carrier, so it
     * cannot be satisfied by a gun that no longer exists.
     *
     * **GATED ON `objectiveComplete('take')` RATHER THAN ON
     * `structureCaptured`, AND THE DIFFERENCE IS ONE TICK.** Objective state is
     * written when the sink APPLIES the effects, after every trigger has been
     * evaluated; the world is written by `Capture.simTick` at Phase.Cleanup,
     * before the Director runs at order 9000. So `structureCaptured` is already
     * true on the capture tick and this trigger would be shut on the exact tick
     * a column arrived and took the office in one motion. Against the objective
     * it stays open for that tick and `t.crew` — which waits for the same
     * objective — reads the failure on the next one. Airtight in both
     * directions, and it costs one frame of latency nobody can see.
     *
     * After the capture it is off for good, which is correct: the district has
     * nothing left to notice, and the player is meant to flood in.
     */
    {
      id: 't.seen',
      when: {
        on: 'all',
        of: [
          { on: 'not', of: { on: 'objectiveComplete', id: 'take' } },
          {
            on: 'any',
            of: [
              { on: 'unitsInArea', player: 0, area: CORDON, min: 5 },
              { on: 'entityHpBelow', tag: 'cordon', frac: 0.99 },
            ],
          },
        ],
      },
      then: [
        { do: 'failObjective', id: 'crew' },
        { do: 'eva', line: 'forcesUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Checkpoint has us. Their watch is coming out of the block behind the office.',
        },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Then it is a raid and not a survey. Take the office anyway.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'conscript',
          count: 4,
          at: WATCH_OUT,
          spread: 16,
          tag: 'watch',
        },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 1, at: WATCH_OUT, spread: 22, tag: 'watch' },
        { do: 'orderTagged', tag: 'watch', order: 'attackMove', at: OFFICE },
      ],
    },

    /* -- the derrick, which no objective names ---------------------------- */
    {
      id: 't.derrick',
      when: { on: 'structureCaptured', tag: 'derrick', player: 0 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'District derrick is on our meter. It pays whether the office does or not.',
        },
      ],
    },

    /* -- the door opens ---------------------------------------------------
     * Everything the player is owed arrives here: the rule that the copy
     * restarts if they are pushed off the building, and the bearing the relief
     * is coming from. Aubray quotes the interval because she quotes intervals.
     */
    {
      id: 't.take',
      when: { on: 'structureCaptured', tag: 'office', player: 0 },
      then: [
        { do: 'completeObjective', id: 'take' },
        { do: 'eva', line: 'buildingCaptured' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Door is open. Three and a half minutes to copy the drum and somebody has to be '
            + 'standing in the building for all of it. Pushed off, and it starts again from the '
            + 'beginning.',
        },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Relief on the yard road behind you, a hundred metres out. Twenty seconds for '
            + 'the armour.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'conscript',
          count: 5,
          at: RELIEF,
          spread: 16,
          tag: 'column',
        },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 3, at: RELIEF, spread: 22, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: OFFICE },
      ],
    },

    /* -- the medal --------------------------------------------------------
     * ONE TICK AFTER THE CAPTURE, BY CONSTRUCTION. `objectiveComplete('take')`
     * cannot be true until the sink has applied `t.take`'s effects, which is
     * after `t.seen` has had its last look at the same tick. So a party that
     * became a column on the way in has already failed this by the time it is
     * evaluated, and there is no ordering between the two that can be got
     * wrong by a later edit.
     *
     * ABOVE `t.win`, which is this file's own rule — `runDirector` returns
     * early once an outcome is set, so a secondary written below the win can
     * never resolve on the winning tick and the medal never counts it. It
     * cannot actually collide here, because the win is 210 s later, and the
     * ordering is kept anyway so nobody has to re-derive that.
     */
    {
      id: 't.crew',
      when: {
        on: 'all',
        of: [
          { on: 'objectiveComplete', id: 'take' },
          { on: 'not', of: { on: 'objectiveFailed', id: 'crew' } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'crew' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Four in. Nobody at that checkpoint will write anything down. That matches.',
        },
      ],
    },

    /* -- the second column ------------------------------------------------
     * The hold timer under a condition the win does not share: the win needs a
     * unit on the building, this needs only the deed. So a player who has been
     * shoved off the disc and is fighting to get back still gets pressed on
     * schedule, which is the direction that makes a bad minute worse rather
     * than quietly forgiving it.
     *
     * It re-orders the whole `column` tag, survivors of the first wave
     * included. That is deliberate and it is `soviets.02`'s reading:
     * `orderTagged` issues one command per owner, and a scattered first wave
     * rejoining the second is what a human commander would produce.
     */
    {
      id: 't.press',
      when: {
        on: 'all',
        of: [
          { on: 'structureCaptured', tag: 'office', player: 0 },
          { on: 'elapsedSinceArmed', ticks: PRESS_AT },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second column, off their own road this time. They have decided the building is '
            + 'worth it.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'conscript',
          count: 4,
          at: PRESS,
          spread: 16,
          tag: 'column',
        },
        { do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: PRESS, spread: 22, tag: 'column' },
        { do: 'orderTagged', tag: 'column', order: 'attackMove', at: OFFICE },
      ],
    },

    /* -- the building takes fire ------------------------------------------
     * `entityHpBelow` answers -1 when nothing alive carries the tag, so this
     * cannot fire on a rubble field — which is the whole reason it is a
     * different condition from `entityDead`. Before the capture the office is
     * Gaia's and no Soviet gun will fire at it, so in practice this is a line
     * about the second half of the match.
     */
    {
      id: 't.hurt',
      when: { on: 'entityHpBelow', tag: 'office', frac: 0.4 },
      then: [
        { do: 'eva', line: 'baseUnderAttack' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'They are shooting the office. Sixty per cent of it is gone and the drum is '
            + 'inside.',
        },
      ],
    },

    /* -- the two ways to lose the building --------------------------------
     * ONE EVENT, TWO TRIGGERS, BECAUSE THEY ARE NOT THE SAME MISTAKE. Before
     * the capture the office is neutral and no Soviet gun can target it, so the
     * only army that can level it is the player's own — splash off the cordon
     * fight, and the operation says so. After the capture it is an Allied
     * building in a Soviet district and losing it is the ordinary way this
     * goes wrong.
     *
     * BOTH ABOVE THE WIN, which is the file's rule: trigger order decides which
     * of two outcomes on one tick the end screen reports, and the author is
     * meant to mean it.
     */
    {
      id: 't.razed',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'office' },
          { on: 'not', of: { on: 'objectiveComplete', id: 'take' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'take' },
        { do: 'failObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'That was ours. Eleven years of returns and a levelling drum, and we put it '
            + 'through the wall ourselves. There is nothing left to recover.',
        },
        { do: 'endOperation', result: 'loss', reason: 'take' },
      ],
    },
    /*
     * AND THE GUARD IS WHAT MAKES THEM TWO CASES RATHER THAN ONE FOLLOWED BY
     * THE OTHER. `runDirector` evaluates every trigger before the sink applies
     * anything, so an UNGUARDED `entityDead` here fires on the SAME TICK as
     * `t.razed` — the first `endOperation` wins (`Session.end` returns early on
     * a set outcome) but the dialogue and the EVA do not, so a player who
     * splashed the neutral office got both losses read out back to back and the
     * second one told them the Soviets had levelled a building they never held.
     */
    {
      id: 't.levelled',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'office' },
          { on: 'objectiveComplete', id: 'take' },
        ],
      },
      then: [
        { do: 'failObjective', id: 'hold' },
        { do: 'eva', line: 'structureLost' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'They levelled it rather than lose it. We hold a plot of rubble and half a '
            + 'reading.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hold' },
      ],
    },

    /* -- and the case neither of those can see ----------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with. Not "owns no buildings", which is wrong in both
     * directions on this operation: the player may legitimately hold nothing
     * but a captured office and two riflemen, and a commander whose base is
     * gone but whose crew is still standing in the district can still finish.
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Nothing answering anywhere. The district keeps its office and its paperwork.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hold' },
      ],
    },

    /* -- the copy ---------------------------------------------------------- */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'structureCaptured', tag: 'office', player: 0 },
          { on: 'unitsInArea', player: 0, area: OFFICE_HOLD, min: 1 },
          { on: 'elapsedSinceArmed', ticks: COPY },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Copy is out. Twelve-two-oh-six is back on the schedule and the whole eastern '
            + 'arc keys off it — we can say by how much now, and to the millimetre. Bring them '
            + 'home.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },
  ],
};

export default op;
