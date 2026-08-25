/**
 * ============================================================================
 * S4 — COMPANY TOWN
 * ============================================================================
 * The seam runs under a Continental Works company town. Five derricks, still
 * turning, still nobody's: the Ninth District and the Eleventh both hold a
 * filing that says the town is on their books, and neither will take delivery
 * from the other. So nobody moved in, and the plant has been paying a clerk in
 * two administrations at once since the Split.
 *
 * The order is to put it on the Soviet books instead. Three deeds, held for a
 * shift.
 *
 * ============================================================================
 * THREE SEATS, WHICH IS NEW, AND WHAT IT ACTUALLY BUYS
 * ============================================================================
 * Every operation before this one is two armies. `Shell.startOperation` fills
 * `opponents` with `op.map.armies - 1` entries and takes EVERY one of them from
 * `op.foe`, so **both hostile seats are the same army — there is no second
 * enemy faction and there cannot be one.** `OperationDef.foe` is a single
 * `Faction` and `applySetupToWorld` seats through `effectiveOpponents`, which
 * re-asserts the singular `aiFaction` onto entry 0; an operation that wanted
 * two different armies would need a schema change, not a different literal.
 *
 * **THAT IS A CONSTRAINT ON THE PREMISE AND THE PREMISE IS BUILT ON IT.** Two
 * Allied seats are not "the Allies, twice". They are two Allied DISTRICT
 * COMMANDS, and the fiction is the mechanism: `PlayerState.allyMask` defaults
 * to self-only, nothing in the campaign path allies two opponent seats, and so
 * the Ninth and the Eleventh are hostile to each other as well as to the
 * player. A free-for-all is the default diplomacy and needs no code —
 * `Shell.applySetupToWorld` says so about itself — which is exactly why an
 * operation can lean on it.
 *
 * The geometry agrees, and it is arithmetic rather than a roll (see the
 * layout: `seatedSlots` returns `[0, 1, 2]` for any three-army match at any
 * seed):
 *
 *     player -> Ninth       386.16 m
 *     player -> Eleventh    296.00 m
 *     Ninth  -> Eleventh    248.00 m     <- the closest pair on the map
 *     every opening -> town 193.08 m     <- exactly equal
 *
 * The opening forces, counted on a world built with the def tables BOUND and
 * `setCampaignRoster` INSTALLED, which is the only state in which the allow-list
 * below is actually in force (unbound, it reads 27 / 14 / 14 and is measuring a
 * different game):
 *
 *     seat 0  player      24 buildings   24 units   <- 11 of them this layout's
 *     seat 1  Ninth       23 buildings   12 units
 *     seat 2  Eleventh    23 buildings   12 units
 *     Gaia                 8 buildings    0 units   <- the town
 *
 * So the player opens LEVEL WITH BOTH DISTRICTS COMBINED and at two to one
 * against either of them singly, and eleven of the twenty-four are the crew and
 * its escort rather than inherited garrison. That is the thumb on the scale
 * this operation puts there on purpose, and it should be read as one.
 *
 * **WHAT IS NOT CLAIMED IS THAT THEY FIGHT EACH OTHER.** Mutual hostility is
 * structural and measurable; how two `AiBrain`s actually divide their attention
 * is neither, it has not been observed, and CLAUDE.md's standing warning about
 * reading behaviour off a symmetric setup applies. Vosk says "they are not
 * allies today", which is true of the ally mask. He does not promise they will
 * shoot each other, and neither does this file.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * **CAPTURING A DERRICK IS WHAT MAKES IT A TARGET.** Gaia is allied to
 * everybody, so while the Works holds the town no targeting scan considers it
 * an enemy and nothing shoots at it. The deed is what puts it on somebody's
 * list, 193 m from two yards at once. The player is not taking a defended
 * position; they are creating one, and then living in it.
 *
 * So the fork is not WHERE to go, it is HOW MANY and HOW SOON:
 *
 *   - **three, at once.** The crew is four engineers standing 100.65 m short of
 *     the nearest derrick at t=0 and nothing is defending it. Three deeds
 *     inside two and a half minutes pays 400 and starts the six-minute clock
 *     before either district has finished its first production cycle — and it
 *     commits the crew before anything is known about either of them.
 *   - **five, eventually.** Two more derricks are turning out there. The crew
 *     is four, so the fifth deed costs 500 credits and ten seconds out of the
 *     barracks the opening base already has, plus a walk. Five is 4500 credits
 *     a minute against three's 2700, and it is two more roofs to keep on.
 *   - **or fortify first.** A captured derrick projects `PLACEMENT`'s 20 m
 *     `adjacencyRadius` — `withinBuildRadius` reads every finished structure
 *     the player owns and asks nothing about what kind it is — so the first
 *     deed opens build space in the middle of the map. Sentry Guns are ungated
 *     and this operation's roster withholds nothing that is not already
 *     withheld. That is real and it is not scripted anywhere.
 *
 * ============================================================================
 * WHY THE PRIMARY IS A DEED AND NOT A DISC
 * ============================================================================
 * Every hold shipped so far is `unitsInArea` plus `elapsedSinceArmed` — bodies
 * standing on ground. This one is `ownerCount(0, 'building', tag: 'derrick')`
 * plus the same timer, and the difference is what a capture-hold is FOR: the
 * question is who the plant pays, not who is standing next to it. A disc would
 * let a player win by parking five harvesters on it (there is no role filter on
 * `unitsInArea`, which `soviets-deep-sector` had to move an ore field to avoid)
 * and would let them lose it by walking out of a town they still own.
 *
 * The hold restarts, and that is the whole shape of the match. `elapsedSinceArmed`
 * disarms the instant the count drops to two, so a derrick lost at minute five
 * of the six puts the clock back to zero. Vosk says so on the tick the third
 * deed lands — a rule the player can only learn by losing it is a rule badly
 * told.
 *
 * **BOTH DISTRICTS CAN NOW CONTEST A DERRICK WITH AN ENGINEER.** A disciplined
 * brain can buy one for a visible legal deed and send an escort. The separate
 * `OrderKind.Enter` route remains amphibious/garrison behavior, and
 * `GarrisonService.enter` still refuses a structure whose owner is not allied
 * to the entrant.
 *
 * What they CAN do is knock it down, and a levelled derrick is gone for the
 * rest of the match — which is why the layout puts FIVE on the ground for a
 * primary that asks for three. The player's own garrison route stays open and
 * is not a cheaper engineer: a squad's deed reverts to Gaia the moment the last
 * man leaves or dies, so it is a deed the hold timer can lose to one splash.
 *
 * **AND THE VOCABULARY CANNOT EXPRESS "FEWER THAN THREE STILL STANDING".**
 * `entityAlive` is a threshold-free `> 0`; `ownerCount` can only name a SEAT,
 * and Gaia is not one — `validateCampaign`'s `checkSeat` refuses any player
 * index outside the three this operation seats. So there is no condition that
 * detects the state in which the primary has become unreachable. That is the
 * frozen vocabulary doing its job rather than a gap to route around, and the
 * answer is the same one `soviets-deep-sector` uses: a hard deadline that ends
 * the match whatever happened to the ground.
 *
 * ============================================================================
 * THE DEADLINE IS EXACTLY `parSec`, AND THE BUDGET IS WRITTEN OUT
 * ============================================================================
 * `t.shift` closes the ledger at minute sixteen, and sixteen minutes is
 * `parSec` 960 to the second. The authored par IS the deadline rather than a
 * description of one, which is the only way that field is falsifiable from
 * inside the operation — `soviets-deep-sector` sets the same relationship at
 * 900 and this chapter's ramp is 780 / 840 / 900 / 960.
 *
 * The clock, against the ground the layout actually lays. Every distance below
 * was read off a built world; every SECOND is arithmetic on top of it:
 *
 *     crew -> nearest derrick  100.65 m,  engineer 3.4 m/s   ->  29.6 s
 *     derrick -> derrick        43.27 m (nearest pair)       ->  12.7 s each
 *     three deeds              187.19 m of walking           ->  55.1 s
 *     the secondary's bar      150 s                         <- 2.7x that
 *     six-minute hold          armed at t+1:30 wins at t+7:30
 *     slack to the deadline    8.5 min — one full restart of the hold, and
 *                              the walk back to re-arm it
 *
 * So the operation is winnable with the hold lost and retaken once, and is not
 * winnable with it lost twice late. That is the margin the deadline is chosen
 * for. **THE DISTANCES ARE MEASURED AND THE PACING IS NOT** — nothing has
 * played this, the 3.4 m/s is a def field rather than an observed rate, and the
 * pathing overhead between "55.1 s of walking" and "the third deed lands" is
 * unmeasured in both directions.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because razing two district bases is not the order, and
 * with three seats it is also the rule most likely to fire on the wrong tick:
 * `Shell.pollOutcome` declares victory when every non-allied seat holds zero
 * assets, and one district finishing the other off is a state this table has no
 * opinion about. `assetLossDefeat` because a commander whose yard is gone while
 * five derricks are still paying him 4500 a minute is the most interesting last
 * act this operation has, and `pollOutcome` would end it at 2 Hz instead. The
 * authored loss is `playerBeaten`, which is `Viability.isBeaten` — nothing to
 * build with and nothing to fight with — and that is the honest threshold.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';
import {
  ELEVENTH_ROAD, NINTH_ROAD, TOWN, TOWN_AREA,
} from '../../layouts/soviets-company-town';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The town is a point this file reveals and orders columns at, and the derricks
 * standing on it are placed by the layout. A number written in both files is a
 * number that will disagree the first time either is tuned, and the failure —
 * a reveal that frames empty ground, a column that lands somewhere nobody
 * authored — is invisible to every gate. `layouts/soviets-company-town.ts` owns
 * the geometry.
 */

/** The shift. `types.ts` uses "hold three derricks for six minutes" as its own
 * canonical example of `elapsedSinceArmed`, written before any operation needed
 * one. This is that operation. */
const SHIFT = minutes(6);

/**
 * When "three working" stops being worth 400 credits.
 *
 * **150 s AGAINST 55.1 s OF MEASURED PURE MOVEMENT, AND THE 2.7x IS DELIBERATE
 * SLOP RATHER THAN GENEROSITY.** The nearest crewman opens 100.65 m from the
 * nearest derrick and the ring's neighbours are 43.27 m apart, so three deeds
 * is 187.19 m of walking, which an engineer covers in 55.1 s at 3.4 m/s. What
 * is NOT measured is the pathing overhead, the formation settle and the capture
 * approach — `CAPTURE.reachMetres` is 2.2 m past the footprint edge and
 * `Capture.ts` steers the man there over several ticks. A window tuned against
 * a guessed multiplier is a window tuned against nothing, so this is the
 * measured figure with room for one, and it should be re-derived from a real
 * run rather than from this comment.
 */
const PROMPT_WINDOW = seconds(150);

const op: OperationDef = {
  id: 'soviets.04.company-town',
  chapter: 'soviets',
  faction: Faction.Soviets,
  /*
   * BOTH HOSTILE SEATS ARE THIS ARMY, and the prose is written knowing it.
   * "The Ninth District and the Eleventh both filed for it" is two commands of
   * ONE administration — the only two-enemy premise `OperationDef.foe` can
   * express, and the reason this operation is about a filing rather than about
   * a coalition. `t.ninth` and `t.eleventh` both spawn literal Allied
   * `gi`/`grizzly`, which `validateCampaign` checks against the seat's army.
   */
  foe: Faction.Allies,
  index: 4,
  title: 'Company Town',
  beat: 'Five derricks the Works still runs. Two Allied districts have filed for them.',
  primaryType: 'capture-hold',
  // BESPOKE. Objectives, spawns, orders, reveals, dialogue and an outcome — the
  // definition in `types.ts` is "multiple effect kinds", and this is six.
  archetype: 'bespoke',
  parSec: 960,
  requires: ['soviets.03.deep-sector'],

  map: {
    preset: 'urban',
    /*
     * Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
     * fingerprint. `urban` is `relief` 0.14 / `cliffs` 0.10, the flattest
     * preset in the roster, which is what makes a five-structure ring on a
     * literal coordinate safe: the town has to be ground three armies can fight
     * over, not a hillside with derricks on it.
     */
    mapSeed: 20_260_904,
    /*
     * **IT DOES NOT CHOOSE THE CORNERS HERE, AND THAT IS THE ONE THING TO KNOW
     * ABOUT A THREE-SEAT OPERATION.** `seatedSlots` draws a pair out of
     * `START_PAIRS` for TWO armies only — `if (n !== 2) return [0..n-1]` — so a
     * three-army match sits in slots 0, 1 and 2 at every seed. Every distance
     * in the layout's header is therefore seed-independent, unlike
     * `02-common-standard` and `03-deep-sector`, whose headers both carry the
     * opposite warning. What this seed still buys is the draws of `s.rng`:
     * scatter, ore cells, formation jitter.
     */
    simSeed: 4_016,
    armies: 3,
    biome: 'urban',
    /*
     * `base`. The operation asks for engineers, and `engineer`'s prereqs are
     * `barracks` and `refinery` — an `mcv` opening would spend the first three
     * minutes of a sixteen-minute ledger unable to replace a single deed. The
     * fiction agrees: S1, S2 and S3 took the seam, and this is a yard already
     * standing on it.
     */
    opening: 'base',
    /*
     * 6000, AND IT BINDS ALL THREE SEATS — `Shell.startMatch` writes
     * `startingCredits` into every slot, so this is a statement about the
     * operation's tempo rather than a handicap.
     *
     * Deliberately short of the skirmish 10 000, because the town IS the
     * economy this operation is about. Three deeds pay 2700 credits a minute
     * (`CIVILIAN_INCOME` is 15/s, against a MEASURED harvester's 525/min) and
     * five pay 4500. A bank that funds a full ramp would make the derricks a
     * bonus; at 6000 they are the answer to the question the bank poses. It
     * also holds both districts to the pace CLAUDE.md names as the single cause
     * of "the AI has a ready base" — a 10 000 opening built a seven-building
     * base with eleven troops by t+90 s having mined nothing, and there are two
     * of them here.
     */
    credits: 6_000,
  },
  layout: 'soviets-company-town',

  // NEITHER SHIPPED RULE MAY END THIS. See the header — with three seats
  // `annihilationWin` is also the rule most likely to fire on somebody else's
  // war, and `assetLossDefeat` would end the operation's best last act.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * EMPTY IS A RESTRICTION, NOT AN ABSENCE. The roster is an ALLOW-LIST over
   * tagged content, so two empty lists hold every seat to the day-one
   * catalogue: no Proving Ground, no Tesla Coil, no Refractor Tower, no
   * AA Battery, no aircraft, no superweapon, in the opening bases or in
   * anybody's sidebar. That is the right shape for a town fight — what is left
   * is the opening path, which both districts get as much of as the player
   * does, and the Sentry Gun the player will want to put beside a derrick is
   * ungated and stays ungated.
   *
   * It is also SYMMETRIC and profile-independent, so the ground is the same on
   * a finished account as on a fresh one, which a deny-list could not promise.
   */
  roster: { player: [], ai: [] },

  objectives: [
    {
      id: 'town',
      kind: 'primary',
      title: 'Capture three town derricks and hold them for six minutes',
    },
    {
      id: 'prompt',
      kind: 'secondary',
      title: 'Have three derricks working inside two and a half minutes',
      credits: 400,
    },
    {
      id: 'five',
      kind: 'secondary',
      hidden: true,
      title: 'Work all five derricks at once',
      credits: 700,
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * Two beats rather than three lines at once: the shell renders dialogue as
     * toasts and a stack of three is a stack nobody reads. The reveal is not
     * decoration — the town is 193 m away through unexplored shroud and the
     * objective names a place the player has never seen.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Works company town on the seam. Five derricks, still turning, still nobody\'s '
            + '— the Ninth District and the Eleventh have both filed for it and neither will '
            + 'take delivery from the other, so neither of them has put a man in it.',
        },
        { do: 'revealArea', player: 0, area: TOWN_AREA },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Three deeds, held for a shift — six minutes — and the output is on our books. '
            + 'A civilian derrick flips at any health and it costs you the man who walks in. '
            + 'You have four engineers.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The Works close the ledger at sixteen minutes. Anything not ours by then is '
            + 'somebody else\'s, and we will be the ones trespassing.',
        },
      ],
    },

    /* -- the third deed ---------------------------------------------------
     * The one beat this operation cannot do without. `elapsedSinceArmed`
     * restarts, and `allies-sounding-line`'s header states the rule this
     * borrows: a rule the player can only learn by losing it is a rule badly
     * told. It also opens the hidden secondary at the moment it becomes a real
     * choice rather than a line in a briefing.
     */
    {
      id: 't.deeds',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick', min: 3 },
      then: [
        { do: 'eva', line: 'buildingCaptured' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Three on our books. The clock runs while you hold three and it goes back to '
            + 'zero the moment you hold two.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Neither district owns an engineer. They cannot take one off you — they can '
            + 'only knock it down. Two more are still turning out there.',
        },
        { do: 'setObjective', id: 'five' },
      ],
    },

    /* -- the secondary, both directions -----------------------------------
     * The pair `allies-sounding-line` uses for its control reading, and for the
     * same reason: an objective that expires needs a trigger that says so, or
     * the player finds out by reading a list.
     *
     * `not(elapsed)` is legal and `not(elapsedSinceArmed)` is not —
     * `validateCampaign` refuses the second because it reads true during the
     * arming pass, so the negation reads false and the trigger can never fire.
     * There is no arm timer anywhere in this tree.
     */
    {
      id: 't.prompt',
      when: {
        on: 'all',
        of: [
          { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick', min: 3 },
          { on: 'not', of: { on: 'elapsed', ticks: PROMPT_WINDOW } },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'prompt' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Logged same day. The clerk had our three on the books before either district '
            + 'got a complaint written.',
        },
      ],
    },
    {
      id: 't.late',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: PROMPT_WINDOW },
          { on: 'not', of: { on: 'objectiveComplete', id: 'prompt' } },
        ],
      },
      then: [
        { do: 'failObjective', id: 'prompt' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Same-day filing is gone. Take them anyway — late is a different word from '
            + 'never.',
        },
      ],
    },

    /* -- the crew is finite ------------------------------------------------
     * True whether they were spent or killed, which is why the line names the
     * price rather than the cause. `elapsed` is conjoined so a layout that
     * failed to place the crew cannot fire this on tick one — the shape
     * `soviets-common-standard` uses its `min: 1` for, in the one spelling that
     * works when the threshold IS zero.
     */
    {
      id: 't.crew',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: seconds(30) },
          { on: 'ownerCount', player: 0, role: 'unit', tag: 'crew', max: 0 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'That is the last of the crew. The barracks makes more — five hundred credits, '
            + 'ten seconds, and a long walk.',
        },
      ],
    },

    /* -- the Ninth ---------------------------------------------------------
     * Minute five, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps regardless
     * reads as an opponent.
     *
     * IT FORMS AT THE DISTRICT'S OWN YARD AND THE ORDER IS A HEADING, NOT A
     * LEASH. `AiBrain.regroupSquads` files every untagged hull the seat owns
     * into a squad on its next pass, so the attack-move is the first thing these
     * seven do and the brain owns them after that. What the wave really buys is
     * that the Ninth's army is 70 m from its own gate and pointed at the town at
     * a known minute — read it as the district building faster than it could,
     * which is what `soviets-deep-sector`'s header established about scripted
     * waves on an AI seat.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against
     * the army of the seat it lands on, so a Soviet key here is a build error.
     */
    {
      id: 't.ninth',
      when: { on: 'elapsed', ticks: minutes(5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Ninth District holds the filing. There are Soviet crews on our plant. Clear '
            + 'them off it and post a guard before the Eleventh finds out we let it happen.',
        },
        { do: 'revealArea', player: 0, area: { x: NINTH_ROAD.x, z: NINTH_ROAD.z, r: 40 } },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'gi',
          count: 5,
          at: NINTH_ROAD,
          spread: 20,
          tag: 'ninth',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'grizzly',
          count: 2,
          at: NINTH_ROAD,
          spread: 14,
          tag: 'ninth',
        },
        { do: 'orderTagged', tag: 'ninth', order: 'attackMove', at: TOWN },
      ],
    },

    /* -- the Eleventh ------------------------------------------------------
     * Minute nine, and one hull heavier. Two columns on one town from two
     * bearings 140.29 m apart, and the two seats are not allied — see the header
     * for what that does and does not promise.
     *
     * A SECOND TAG RATHER THAN A SHARED ONE, AND IT HAS TO BE.
     * `EffectSink.orderTagged` issues ONE command per owner and skips every
     * unit of any other owner, because `Command.player` is a single seat and
     * the simulation refuses what a seat does not own. A tag spanning both
     * districts would silently order half of it.
     */
    {
      id: 't.eleventh',
      when: { on: 'elapsed', ticks: minutes(9) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rathe, intercepted',
          text: 'The Ninth is not taking delivery of my plant and neither is anybody else. '
            + 'Everything I have, to the town.',
        },
        { do: 'revealArea', player: 0, area: { x: ELEVENTH_ROAD.x, z: ELEVENTH_ROAD.z, r: 40 } },
        {
          do: 'spawnUnits',
          player: 2,
          key: 'gi',
          count: 6,
          at: ELEVENTH_ROAD,
          spread: 22,
          tag: 'eleventh',
        },
        {
          do: 'spawnUnits',
          player: 2,
          key: 'grizzly',
          count: 3,
          at: ELEVENTH_ROAD,
          spread: 15,
          tag: 'eleventh',
        },
        { do: 'orderTagged', tag: 'eleventh', order: 'attackMove', at: TOWN },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both of them on the same ground, and they are not allies today. Keep the '
            + 'roofs on three of ours and let them work out the rest.',
        },
      ],
    },

    /* -- the ledger, telegraphed ------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Two minutes on the shift. Whatever is not on our books at sixteen goes down '
            + 'as somebody else\'s output.',
        },
      ],
    },

    /* -- the hidden secondary ----------------------------------------------
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome
     * is set, so a fifth deed that lands on the winning tick has to resolve
     * before the operation ends or the medal does not count it. Same ordering
     * rule `soviets-deep-sector` states for `t.mastsDown`.
     */
    {
      id: 't.five',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick', min: 5 },
      then: [
        { do: 'completeObjective', id: 'five' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'All five. The whole town works for us for as long as we can keep the roofs '
            + 'on it.',
        },
      ],
    },

    /* -- the win -----------------------------------------------------------
     * The arming pass is what makes this a HOLD: with `elapsedSinceArmed` forced
     * true the tree reduces to "does the player own three derricks", so the arm
     * tick is set the moment the third deed lands and DELETED the moment the
     * count falls to two. Six minutes, from zero, again.
     *
     * ABOVE `t.shift`, so a shift that completes on the tick the ledger closes
     * is a win. The ground beats the paperwork; that is the whole chapter.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick', min: 3 },
          { on: 'elapsedSinceArmed', ticks: SHIFT },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'town' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Shift is done and the output is ours. Let the Ninth and the Eleventh work out '
            + 'which of them lost a town neither of them was standing in.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the ledger closes --------------------------------------------------
     * The one loss the vocabulary can express for the state where the primary
     * has become unreachable — see the header. It is also the ordinary loss for
     * a player who never got three, and it names the primary either way.
     */
    {
      id: 't.shift',
      when: { on: 'elapsed', ticks: minutes(16) },
      then: [
        { do: 'failObjective', id: 'town' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ledger is closed. Whatever came out of that town this morning goes down under '
            + 'a filing with somebody else\'s number on it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'town' },
      ],
    },

    /* -- the ordinary loss --------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". A commander whose yard is
     * gone while three derricks are still paying him is not beaten, and this
     * operation would like that to be a position somebody can play from.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'town' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering. The town goes to whichever of them is still standing.',
        },
        { do: 'endOperation', result: 'loss', reason: 'town' },
      ],
    },
  ],
};

export default op;
