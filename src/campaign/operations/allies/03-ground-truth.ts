/**
 * ============================================================================
 * A3 — GROUND TRUTH
 * ============================================================================
 * Ilse Bramm is levelling the shore of Survey 14-090: a tide gauge at the
 * water, two change points up the strand, a benchmark at the far end, and in
 * her satchel the only complete rate series anybody has. She refused the
 * Allies in week one and she has not revised that. She is also not waiting for
 * them, because a levelling line has to be closed the day it is opened.
 *
 * ============================================================================
 * THE OBJECTIVE MOVES, AND THAT IS THE WHOLE OPERATION
 * ============================================================================
 * There are three places to meet her and each one is only there for a while:
 *
 *     the first change point     until minute 3     234 m out, 3 posts,
 *                                                   165 m from the Pact yard
 *     the second change point    minute 3 to 8      283 m out, 4 posts,
 *                                                   110 m from the Pact yard
 *     the benchmark              minute 8 to 15     336 m out, 5 posts,
 *                                                    82 m from the Pact yard
 *
 * Three units on the disc she is working, inside the window she is working it,
 * and the operation is over. Miss all three and the line closes at minute
 * fifteen and it is a loss.
 *
 * **SO THE DECISION IS MADE IN THE FIRST THIRTY SECONDS AND CANNOT BE
 * REVISITED.** The opening garrison is the only army that can reach the first
 * change point inside three minutes — 273 m of route at a Warden's 6.6 m/s is
 * 41 s of driving before anything is shot at — and sending it means sending all
 * of it, 234 m from a base with nothing left standing over it. Every later
 * window is reachable by an army the player BUILT, and every later window is
 * further into Pact ground. That is the trade, it is priced in metres and
 * seconds below, and there is no third option because the operation offers no
 * second objective to go and do instead.
 *
 * ============================================================================
 * HOW THIS DIFFERS FROM `soviets.03.deep-sector`, WHICH IS THE OTHER `race`
 * ============================================================================
 * S3 is a race against a CLOCK with two ways to beat it: take the tap, or
 * break the survey masts and the clock moves. Its own header records the
 * finding that the two do not exclude each other — doing both dominates — so
 * what its fork really sets is an order of operations under one fuse.
 *
 * A3 changes the term that S3 holds fixed. **The deadline here cannot be
 * bought, moved, or attacked; the PLACE moves instead.** Nothing the player can
 * do puts a second more on the clock, and there is no structure anywhere whose
 * death buys time. Three consequences, and they are the reasons this is a
 * different operation rather than the same one on a different map:
 *
 *   - **There is no hold.** S3's win is four units on a disc for seventy-five
 *     seconds; A3's is three units on a disc for one tick. The difficulty is
 *     entirely in the route and the clock, so a player who arrives has arrived
 *     — being pushed off afterwards costs nothing, because the operation was
 *     about being there at the time.
 *   - **Being early is the MEDAL, not a shortcut.** `medalFor` awards silver
 *     for a win with every secondary complete, and this operation's one
 *     secondary IS the first window. S3 pays its secondary in credits for
 *     killing three masts; here the secondary cannot be bought with anything
 *     except speed.
 *   - **Late is not merely slower, it is a different fight.** S3's fast route
 *     is the dangerous one — its tap sits 129 m from the Allied base — so
 *     waiting is SAFER there. Here it is the exact reverse: the benchmark is
 *     82.1 m off the Pact's Construction Yard with their nearest structure
 *     48.4 m away, so every five minutes the meeting point moves closer to
 *     everything they have built since the match began.
 *
 * ============================================================================
 * WHAT THE FIRST WINDOW COSTS, IN MEASURED METRES
 * ============================================================================
 * Every distance is 8-connected Dijkstra over the real `Terrain.passGrid` for
 * `Locomotor.Track`, on the world this operation actually builds, refusing
 * every cell a structure occupies — so these are routes an army could drive
 * rather than lines drawn across a map. Seconds are that route at the speed of
 * the hull in question and nothing else: no fighting, no formation, no target
 * acquisition.
 *
 *     first change point     273 m route (234 m straight)    41.4 s at 6.6 m/s
 *     second change point    320 m route (283 m straight)    48.5 s
 *     the benchmark          382 m route (336 m straight)    57.9 s
 *     the tide gauge         119 m route (112 m straight)    18.0 s
 *
 * A G.I. walks at 3.2 m/s, so an opening force that keeps its infantry with it
 * reaches the first change point in **85 s** rather than 41, and that is the
 * first real decision inside the first one: the armour can be there in half the
 * time and arrives without a screen. The opening garrison is measured, not
 * assumed — **4 Warden Tanks, 5 G.I.s, 1 engineer and 2 harvesters**, counted
 * on a build with the def tables bound and this operation's roster in force.
 *
 * **THE THREE POSTS ARE THE REST OF THE BUDGET AND THEY ARE ARGUED, NOT
 * MEASURED.** A Glaive Post is 480 hp behind a 22 m arc; three of them is
 * 1 440 hp to remove before anything can stand on the disc, and `glaiveRepeater`
 * is an anti-infantry repeater — 75.9 dps raw, which `ARMOR_MATRIX` cuts hard
 * against `ArmorClass.Medium` and does not cut at all against infantry. So the
 * post line kills the screen and irritates the armour, which is what makes
 * "send the tanks alone" a live answer rather than a mistake. **No harness in
 * this repo can put a number on how long that fight takes** — `campaign-maps`
 * builds the ground and does not fight on it, and `op-harness` drives a brain
 * that has never read a briefing. The three-minute window is authored with that
 * slack deliberately on the generous side: a player who commits at t=0 and
 * plays the fight competently should make it, and the failure this operation
 * must not have is a first window nobody can reach.
 *
 * ============================================================================
 * THE CHART DRUM IS PAID AND IT IS NOT AN OBJECTIVE
 * ============================================================================
 * The tide gauge at the head of the line has been recording since the Works
 * sited it. Two units inside its yard pays **700 credits, once**, through
 * `grantCredits` — and it is deliberately NOT a secondary, for a reason that
 * is mechanical rather than editorial: `medalFor` gives silver only when EVERY
 * secondary is complete, so a second secondary that competes with the first
 * window for the same three minutes would make silver unobtainable by
 * construction. Two mutually exclusive secondaries is not a hard choice, it is
 * a medal nobody can earn. `allies.02.instrument-room` reached the same answer
 * about its derrick and this is that rule applied to a clock.
 *
 * **AND THE DETOUR IS 16.4 METRES, WHICH IS THE PART WORTH SAYING OUT LOUD.**
 * The gauge sits 51.6 m off the straight line to the first change point, and
 * the route that goes via it is 16.4 m longer than the route that does not —
 * **2.5 seconds** at a Warden's 6.6 m/s — because the road hugs the strand
 * either way. So the drum does not cost a walk. It costs the two-post picket
 * standing on it and whatever that fight takes out of a 180-second window,
 * which is a price paid in the only currency this operation charges in. Anyone
 * reading "detour" and picturing a route decision has the shape of it wrong.
 *
 * The money is worth least to the player who needs it least. A win in the first
 * window ends the match with the 700 unspent; a player who is already late gets
 * a Warden out of it (700 credits, and a Warden is 700) for the second window.
 * That direction is deliberate and it is not a consolation — being late has
 * already cost the medal and moved the meeting 49 m further out and 56 m nearer
 * the Pact yard.
 *
 * ============================================================================
 * THE ROSTER IS EMPTY ON BOTH SIDES
 * ============================================================================
 * `roster` is an ALLOW-LIST over tagged content, so two empty lists withhold
 * every `UNLOCK_TAGS` def from both seats — and that is the correct shape for a
 * fifteen-minute operation whose thesis is that stopping to build is what loses
 * it. Nobody reaches a tech tier inside three minutes and an operation that
 * offers one is offering a trap.
 *
 * Two consequences worth naming rather than discovering, and both are MEASURED
 * — the same headless build with the roster cleared is the control:
 *
 *   - **the player's opening garrison ships no Sabre IFV**, because `ifv` is
 *     `unit.raider` and `Scenarios.ts` asks the gate while it spawns the
 *     starting army. The control run puts 2 of them in the muster ground along
 *     with a Proving Ground and a Refractor Tower; with the roster in force the
 *     opening is 12 units and 23 structures instead of 14 and 25. So the fast
 *     hull that would have made the first window comfortable is not in the
 *     game, and the window is measured against a Warden's 6.6 m/s and nothing
 *     quicker;
 *   - **the Pact gets no Helios Spire**, and loses its Reliquary and its 2
 *     Sandskiffs by the same rule. `struct.defence.specialist` on a benchmark
 *     that already carries five posts and sits 82 m from their yard would make
 *     the last window a wall rather than a fight, and the last window is where
 *     a player who has had a bad match ends up.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because flattening the Pact base does not meet anybody —
 * she is on the strand and the operation is about standing next to her at the
 * right minute. `assetLossDefeat` because the interesting last act here is
 * precisely a commander who spent their whole opening force on a window they
 * missed; `Shell.pollOutcome` would end that at 2 Hz for having no army left.
 * `t.rout` is the authored replacement and reads `playerBeaten`, which is
 * `Viability.isBeaten` — nothing to build with AND nothing to fight with.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';
import {
  BENCH, BENCH_HOLD, CHANGE_A, CHANGE_A_HOLD, CHANGE_B, CHANGE_B_HOLD,
  GAUGE, GAUGE_YARD, RELIEF,
} from '../../layouts/allies-ground-truth';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * A `unitsInArea` disc is static data in this file and the station under it is
 * placed by the layout, so the two files have to agree about four points. A
 * number written in both is a number that will disagree the first time either
 * is tuned, and the failure is an operation whose win condition is fifty metres
 * from its own objective — winnable, wrong, and invisible to every gate.
 * `layouts/allies-ground-truth.ts` owns the geometry; the dependency runs
 * operation -> layout and never back.
 */

/** She strikes the first change point here. */
const WINDOW_1 = minutes(3);
/** And the second here, leaving only the benchmark. */
const WINDOW_2 = minutes(8);
/** The line closes. `parSec` 900 to the second — see the note on `parSec`. */
const CLOSES = minutes(15);

const op: OperationDef = {
  id: 'allies.03.ground-truth',
  chapter: 'allies',
  faction: Faction.Allies,
  /*
   * THE MERIDIAN PACT, AND THE PROSE IS WHERE IT COMES FROM.
   *
   * Wend's briefing line names "a Pact post on every one of them" and counts
   * their guns; Aubray's minute-eight line puts their yard eighty metres behind
   * the benchmark. Both scripted waves are literal `mrdWayfarer` and
   * `mrdSolarch`, which `validateCampaign` refuses on any seat that is not
   * Meridian.
   *
   * It is also the beat grid. `CAMPAIGN_BUILD_SPEC.md` §2.3 has Bramm refusing
   * all four and §3.3 puts "Bramm confirms it" in the Pact's own chapter at
   * week 9 — so the army with the strongest reason to reach her first, and the
   * only one whose reading of the March already agrees with her appendix, is
   * the Pact. A2 and A4 are both fought against the Soviets; putting the Pact
   * between them is the chapter's first sight of the third army rather than a
   * third Soviet operation in a row.
   */
  foe: Faction.Meridian,
  index: 3,
  title: 'Ground Truth',
  beat: 'The only complete rate series on the continent is walking up a beach, and it will not wait.',
  primaryType: 'race',
  /*
   * BESPOKE. `reinforced` is "spawnUnits at a declared tick" and this table
   * also moves objective state, reveals ground, moves the camera, pays credits
   * and reads the world to decide which of three windows is open. The label is
   * about MECHANISM: the drama is a clock and a gun line, and the gun line is
   * in the layout before tick one.
   */
  archetype: 'bespoke',
  parSec: 900,
  requires: ['allies.02.instrument-room'],

  map: {
    preset: 'tropical',
    /*
     * CHOSEN BY SURVEY RATHER THAN BY DATE, AND THE SURVEY IS THE REASON THE
     * CONVENTION BROKE.
     *
     * A1 pins 20 260 819 and A2 is that plus seven, so the week-4 date would be
     * 20 260 902. Eleven rolls were sampled at the nineteen lots this layout
     * places, scoring each on (a) whether buildable ground exists within six
     * cells of the lot, (b) whether a tracked hull can route from the player's
     * yard to each of the four discs, and (c) how much of each 24 m disc is
     * standable. 20 260 902 puts the second change point on a disc that is
     * 55 % standable; 20 260 903, 20 260 904, 20 260 907, 20 260 908 and
     * 20 260 912 put it at 35 %, 59 %, 65 %, 45 % and 21 %, and three of those
     * five drag the benchmark under 75 % with it.
     * **20 260 910 is clean on all three** — worst post walk 12.3 m, all four
     * routes finite, and the three win discs 94 %, 85 % and 90 % standable
     * (109/116, 94/110, 102/113 free Track cells) — and it is the roll this
     * operation is measured on. The station lots themselves snap 1.1–2.3 m on
     * EVERY roll, because that is footprint-grid snapping and not terrain.
     *
     * The date is a convention and not a mechanism; `allies.02.instrument-room`
     * says so in as many words. The ground is the mechanism.
     *
     * Pinned by `tests/campaign-maps.spec.ts` as a terrain fingerprint: a
     * generator change that re-rolls this coast moves every number in the
     * header above.
     */
    mapSeed: 20_260_910,
    /*
     * A2 + 7 ON THE SAME COUNTER, AND HERE THE NUMBER IS LOAD-BEARING
     * GEOMETRY.
     *
     * `seatedSlots(2, 7028, MAP_SEAS.tropical)` returns **[0, 1]** — the
     * antipodal pair, 386.16 m of opening separation, with BOTH openings
     * exactly 100 m off the waterline. On `tropical` only two pairs survive
     * `dryPairs`, and the other one ([1, 3]) puts one opening 290 m inland: the
     * coast would then run diagonally away from the lane instead of beside it,
     * and every seaward offset in the layout would mean a different distance at
     * each end of the line. Change this and re-measure; do not re-read.
     */
    simSeed: 7_028,
    armies: 2,
    /*
     * `tropical` is not a `BiomeName` — `BIOMES` has four members and the
     * generator falls back to temperate with a console warning if asked for a
     * fifth. This is the pairing `MAPS.coral-shore` ships and the one
     * `pact.01.shallow-road` records.
     */
    biome: 'temperate',
    /*
     * `base`, AND THE ARGUMENT IS THE THREE-MINUTE WINDOW.
     *
     * An `mcv` opening spends its first ninety seconds unfolding and driving,
     * which is half of the first window spent watching rather than deciding —
     * and the decision this operation owns is taken in the first thirty
     * seconds. `soviets.03.deep-sector` refused `mcv` for the same reason
     * against a nine-minute fuse; this fuse is three.
     */
    opening: 'base',
    /*
     * 4 000 AGAINST THE SKIRMISH 10 000, AND IT BINDS BOTH SEATS —
     * `Shell.applySimPostBoot` writes `setup.startingCredits` into every
     * non-Neutral slot.
     *
     * The premise is that the opening garrison is the first window and the
     * bank is the second one. 4 000 buys roughly five Wardens over the minutes
     * it takes to earn more, which is an army for the second window and not a
     * second army for the first — a bank that funded both would delete the
     * choice this operation exists to pose. It is also the lever CLAUDE.md
     * names for the opening bank that has twice been reported as a prebuilt AI
     * base: a Pact escort that has noticed nothing yet should not be raising
     * seven buildings in ninety seconds either.
     */
    credits: 4_000,
  },
  layout: 'allies-ground-truth',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // See the header. Empty on both sides, which withholds every tagged def from
  // both seats — the player's Sabre IFV included, and the Pact's Helios Spire.
  roster: { player: [], ai: [] },

  objectives: [
    { id: 'reach', kind: 'primary', title: 'Reach Bramm\'s party before the line is closed' },
    /*
     * NO `credits` ON THIS ROW, AND THAT IS DELIBERATE RATHER THAN AN
     * OMISSION. Completing it wins the operation on the same tick, so a payout
     * would be credited to a player who has no match left to spend it in —
     * a reward that exists only in a debrief screen is a reward that is not
     * one. The medal is the payment: `medalFor` gives silver for a win with
     * every secondary complete, and this is the only secondary.
     */
    {
      id: 'early',
      kind: 'secondary',
      title: 'Meet her at the first change point, inside three minutes',
    },
  ],

  triggers: [
    /* -- the brief, in three beats ----------------------------------------
     * Split across twenty-four seconds because the shell renders dialogue as
     * toasts and three at once is a stack nobody reads. The schedule is in the
     * second beat, in numbers the table below can be checked against: three
     * minutes is `WINDOW_1`, eight is `WINDOW_2`, fifteen is `CLOSES`, and the
     * gun counts are what the layout stamps.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Ilse Bramm is levelling the shore of Survey 14-090. Tide gauge at the water, '
            + 'two change points up the strand, benchmark at the far end. When the line closes '
            + 'she files it, and the only complete rate series on the continent goes with her.',
        },
        /*
         * THE WHOLE LINE, BEFORE ANY OF IT IS A PROBLEM.
         *
         * A race whose route the player has to discover is a race decided by
         * the first wrong turn. `revealArea` EXPLORES ground rather than
         * showing live units, so this hands over the shape of the decision and
         * none of the intelligence — the gun counts arrive in Wend's line
         * because a player cannot count emplacements through fog.
         */
        { do: 'revealArea', player: 0, area: { x: GAUGE.x, z: GAUGE.z, r: 54 } },
        { do: 'revealArea', player: 0, area: { x: CHANGE_A.x, z: CHANGE_A.z, r: 66 } },
        { do: 'revealArea', player: 0, area: { x: CHANGE_B.x, z: CHANGE_B.z, r: 66 } },
        { do: 'revealArea', player: 0, area: { x: BENCH.x, z: BENCH.z, r: 66 } },
      ],
    },
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'She is on the first change point now and strikes it at three minutes. Second '
            + 'change point until eight, then the benchmark. The Pact have a post on every one '
            + 'of them — three guns, then four, then five, and the last stands eighty metres '
            + 'off their own yard.',
        },
      ],
    },
    {
      id: 't.order',
      when: { on: 'elapsed', ticks: seconds(26) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'We are not chasing her. We are meeting her, and the cheapest place to do that '
            + 'is the one she is standing on. Everything we own, now.',
        },
      ],
    },
    /* -- she says why the objective moves ---------------------------------
     * The one line the operation cannot work without. A win disc that walks
     * away reads as the map cheating unless the person it belongs to has said,
     * out loud and early, that she is not going to stop.
     */
    {
      id: 't.bramm',
      when: { on: 'elapsed', ticks: seconds(38) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Bramm, on the survey net',
          text: 'Field Marshal. I have four hours of light and a line to close. Walk with me if '
            + 'you like. I am not stopping for the argument.',
        },
      ],
    },

    /* -- the chart drum ---------------------------------------------------
     * TWO UNITS, NOT ONE, and no tag: the yard holds no ore and sits 129 m
     * from the nearest field, so nothing of the player's has business standing
     * in it except a detachment sent there. `unitsInArea` counts units and
     * asks nothing about what they are for, which is a real trap on an
     * objective sited near a harvester's route and is not one here.
     *
     * ABOVE the win triggers so a column that takes the gauge on its way past
     * is paid before the operation can end underneath it.
     */
    {
      id: 't.drum',
      when: { on: 'unitsInArea', player: 0, area: GAUGE_YARD, min: 2 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Gauge house is ours. The chart drum has been running since the Works sited it '
            + '— eleven years of tide, and not one hour of it needs her permission. Seven '
            + 'hundred released against the find.',
        },
        { do: 'grantCredits', player: 0, amount: 700 },
      ],
    },

    /* -- the first window --------------------------------------------------
     * `not(elapsed)` is the upper bound and it is legal where
     * `elapsedSinceArmed` under a `not` is not: `elapsed` is a pure function of
     * the tick, so negating it is a window rather than a trigger that can never
     * arm. `elapsed` is `>=`, so at exactly three minutes this reads false and
     * the window is shut — "inside three minutes" is literal.
     *
     * ABOVE `t.struckA`, so an arrival on the closing tick wins rather than
     * failing the secondary it just earned.
     */
    {
      id: 't.win.change.a',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: CHANGE_A_HOLD, min: 3 },
          { on: 'not', of: { on: 'elapsed', ticks: WINDOW_1 } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'early' },
        { do: 'completeObjective', id: 'reach' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'That matches. Get her and the satchel off that beach before the Pact think to '
            + 'ask her the same question.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- she strikes the first change point -------------------------------
     * The wave is a bare `spawnUnits` with no `orderTagged`, and that is a
     * finding rather than an oversight: `AiBrain.regroupSquads` files every
     * untagged hull an AI seat owns into the strike group on its next pass, so
     * a scripted `guard` on the station would be overwritten before anybody
     * saw it. Read these eight as the escort closing up behind her — a
     * schedule the opponent gets stronger on, not a garrison.
     *
     * NO `eva`. There is no `EVA_LINES` id that means "the opponent's escort
     * has come up"; `validateCampaign` checks that a line EXISTS and cannot
     * check that it means what the author meant, so the honest answer is
     * silence rather than the nearest-sounding cue.
     */
    {
      id: 't.struck.a',
      when: { on: 'elapsed', ticks: WINDOW_1 },
      then: [
        { do: 'failObjective', id: 'early' },
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Gauge camp is struck and the party has moved up. She is on the second change '
            + 'point — four guns, and a hundred and ten metres from the Pact yard.',
        },
        { do: 'cameraMove', at: CHANGE_B },
        { do: 'revealArea', player: 0, area: { x: CHANGE_B.x, z: CHANGE_B.z, r: 72 } },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 4, at: RELIEF, spread: 20 },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 2, at: RELIEF, spread: 14 },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Noted. It gets dearer every time we are late.',
        },
      ],
    },

    /* -- the second window ------------------------------------------------
     * BOUNDED AT BOTH ENDS, AND THE LOWER BOUND IS THE INTERESTING ONE. Without
     * `elapsed(WINDOW_1)` a player could win at minute two by standing on a
     * change point she has not reached yet. With it, running ahead and waiting
     * for her is a legal and rather good line — 47 m more route, one more post,
     * and the certainty of being there when she arrives — which is exactly the
     * play a race against a schedule ought to reward.
     */
    {
      id: 't.win.change.b',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: CHANGE_B_HOLD, min: 3 },
          { on: 'elapsed', ticks: WINDOW_1 },
          { on: 'not', of: { on: 'elapsed', ticks: WINDOW_2 } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'reach' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'We have her. It cost a change point, which is what being late costs. Log the '
            + 'time; I want to know it next week.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    {
      id: 't.struck.b',
      when: { on: 'elapsed', ticks: WINDOW_2 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend',
          text: 'Second change point is struck. She is on the benchmark — five guns, and their '
            + 'yard eighty metres behind it.',
        },
        { do: 'cameraMove', at: BENCH },
        { do: 'revealArea', player: 0, area: { x: BENCH.x, z: BENCH.z, r: 72 } },
        { do: 'spawnUnits', player: 1, key: 'mrdWayfarer', count: 5, at: RELIEF, spread: 22 },
        { do: 'spawnUnits', player: 1, key: 'mrdSolarch', count: 3, at: RELIEF, spread: 15 },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'That is the last station. There is no fourth.',
        },
      ],
    },

    /* -- the third window, which has no upper bound of its own -------------
     * `t.closed` is the bound and it sits BELOW this one, so a column that
     * reaches the benchmark on the closing tick wins. Nothing else is needed:
     * after minute fifteen there is no operation left to arrive in.
     */
    {
      id: 't.win.bench',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: BENCH_HOLD, min: 3 },
          { on: 'elapsed', ticks: WINDOW_2 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'reach' },
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'On the benchmark, under their guns, at the last station there is. She came away '
            + 'with us. Do not write down what it cost.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the deadline, telegraphed ---------------------------------------- */
    {
      id: 't.last',
      when: { on: 'elapsed', ticks: minutes(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'One minute. After that the line is closed and filed, and we will have a model '
            + 'where she has a measurement.',
        },
      ],
    },

    /*
     * THE DEADLINE IS EXACTLY `parSec`.
     *
     * A race whose clock is a description of itself is not falsifiable from
     * inside the operation. Fifteen minutes is `CLOSES` and `parSec` is 900 to
     * the second, so the authored par IS the deadline — the same rule
     * `soviets.03.deep-sector` states about its own front closing.
     */
    {
      id: 't.closed',
      when: { on: 'elapsed', ticks: CLOSES },
      then: [
        {
          do: 'dialogue',
          speaker: 'Aubray',
          text: 'Line is closed. She has filed it. We are left with a forecast that is very '
            + 'good and a continent that will never check it against anything.',
        },
        { do: 'endOperation', result: 'loss', reason: 'reach' },
      ],
    },

    /* -- the ordinary loss -------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". This operation
     * deliberately asks a player to take their whole opening force 233 m from
     * home, and a commander with an empty base and a live column is not beaten.
     */
    {
      id: 't.rout',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'reach' }],
    },
  ],
};

export default op;
