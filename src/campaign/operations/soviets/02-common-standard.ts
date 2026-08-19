/**
 * ============================================================================
 * S2 — COMMON STANDARD
 * ============================================================================
 * The Split turns into shooting while an armour column is out on survey
 * escort. Eight hulls, three hundred kilometres from the nearest yard, ordered
 * onto the Works station at Survey 40 and told to stand on it.
 *
 * **THE FIRST `opening: 'force'` OPERATION, AND THE FIRST ONE WHERE THE PLAYER
 * CANNOT BUY ANYTHING.** No Construction Yard, no factory, no harvester, no
 * bank. That single fact is the whole design: a skirmish answers every problem
 * by queueing something, and this operation deletes the answer. What is left is
 * a budget of eight hulls, spent once, with the exchange rate written on the
 * ground.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS
 * ============================================================================
 * Minute three, and the column is on the road. The Works vehicle park is 157 m
 * from the opening — 52 m BEHIND the line between the two starts, so the detour
 * is backwards before it is forwards — with an Allied guard post on it, and it
 * holds two mothballed hulls the column's own crews can start — the Works wrote
 * the standard both administrations still build to, which is the title and is
 * also why a Soviet crew can start an Allied-built machine. Taking it is +140 m
 * of driving and three emplacements to break; skipping it is two fewer mistakes
 * for the rest of the operation.
 *
 * No skirmish contains that trade, because in a skirmish two more tanks is a
 * button. Here they are the only two that exist.
 *
 * **THE GUARD IS CONCRETE, NOT HULLS, AND THAT IS A FIX RATHER THAN A FLAVOUR
 * CHOICE.** It was two parked Wardens until 2026-08-19, when a headless boot
 * read their positions off the store: both were re-tasked inside the first four
 * seconds, and by t+20 s they were 117 and 129 m from the park, standing at the
 * AI's rally point. `AiBrain.census` files every AI-owned mobile hull into
 * `armyIds` and `regroupSquads` files everything in `armyIds` into a squad, and
 * there is no way for a layout to opt out — the three `GROUP_*` tags that exist
 * for exactly this reason are AI-internal. So the secondary was really "drive
 * two hulls to an empty park", the price was being paid at the pad instead
 * without anybody naming it, and `entityDead: 'guard'` resolved anyway because
 * the AI's own army eventually got them killed somewhere else. The full
 * measurement and the arithmetic behind the count are in the layout, above the
 * placement loop.
 *
 * The price is REDUCED and honestly so: three Pillboxes put ~236 damage into
 * the column against the two tanks' ~250, and a player who stops the column by
 * hand at 24 m outranges an emplacement and pays nothing at all. A tank could
 * not be outranged, because a tank closes. That discount is left in — it is a
 * skill discount on a secondary, which is the right place for one.
 *
 * **HIT POINTS ARE RENTED, HULLS ARE BOUGHT, AND ONLY ONE OF THOSE IS THE
 * BUDGET.** `sim/Regen.ts` heals an IDLE, out-of-combat unit at 2.5% of max per
 * second after an 8 s delay — so a fixed force genuinely can repair, by
 * standing still for up to forty seconds. That is not a hole in the premise,
 * it is the second currency: the operation charges for time (the Allied base
 * is producing the whole while, and both relief columns are keyed off the
 * player's own arrival), and forty seconds of stillness is a real price to pay
 * for a hull's worth of health. A first draft of this header claimed damage was
 * permanent. It is not; that was reasoning, and `Regen.ts` is measurement.
 *
 * ============================================================================
 * THE OUTCOME POLICY, AND THE CLAIM THAT DOES NOT HOLD
 * ============================================================================
 * The received wisdom about `opening: 'force'` is that `assetLossDefeat` would
 * end the match the instant the ten-second grace expired, because the player
 * has no buildings. **That is not what the shipped code does.**
 * `countLivingAssets` in `src/shell/Shell.ts` walks `EntityKind.Building`,
 * `Vehicle` AND `Infantry`, so eight Anvils standing on the ground at t=0 are
 * eight assets and `pollOutcome` returns at its `alive > 0` branch. The failure
 * the policy actually disarms is the INSERTION — a squad that arrives at
 * t+30 s and therefore owns nothing at t+10 s. This column owns everything it
 * will ever own before the first tick.
 *
 * What genuinely saves `opening: 'force'` is a different mechanism and it is
 * automatic: `campaignRunning()` is true for every armed operation regardless
 * of these two booleans, and `outcome.system.ts` ORs it into `scriptedRunning`
 * — which is what stops the Viability route nagging a column that legally has
 * no base for fourteen minutes.
 *
 * Both flags are still off, and the reason is thresholds rather than timing:
 *
 *   - **`annihilationWin` must be off.** Eight Anvils against an Allied
 *     opening with an empty bank can plausibly raze it, and razing it is not
 *     the order. With annihilation on, the match would end in victory the tick
 *     the last Allied asset died — somewhere on the road, with the pad empty
 *     and the medal awarded. This is the one shipped rule that could fire
 *     EARLIER than the authored one.
 *   - **`assetLossDefeat` may as well be off, and is.** The authored loss at
 *     four hulls is strictly tighter than "owns nothing", so the shipped rule
 *     could only ever fire later, into a match this table has already ended.
 *     A second writer that can only ever be wrong is a second writer to delete.
 *
 * ============================================================================
 * WHY THE COUNTS ARE UNTAGGED, AND WHY THE FLOOR HAS A `min`
 * ============================================================================
 * The win and both losses read `ownerCount(player 0, role: 'unit')` with NO
 * tag. Two reasons, and the second is the one that would have bitten:
 *
 *   1. Under `opening: 'force'` the player owns exactly the column, forever.
 *      There is no production that could add a unit the count did not mean, and
 *      the layout ships one hull type, so "units owned" and "hulls left" are
 *      the same number by construction rather than by bookkeeping.
 *   2. **A tag a `spawnUnits` PRODUCES stops being checked.**
 *      `campaign-maps.spec.ts` skips its "every declared tag landed on
 *      something" assertion for any tag a trigger spawns — correctly, since the
 *      layout does not place it. Tagging the column AND the two salvaged hulls
 *      alike would therefore have withdrawn the only test that proves the
 *      column exists, on the exact tag the loss condition reads.
 *
 * That is knowingly the EXPENSIVE spelling — `runtime.ts` says an untagged
 * `unitsInArea` walks the alive list rather than a tag, and the Director
 * evaluates every trigger twice for the arming pass. Four such conditions over
 * a world of a few hundred entities is a few thousand compares a tick, against
 * a correctness property that cannot drift. Worth it here; do not copy it into
 * an operation whose player can produce.
 *
 * **`t.spent` IS `min: 1, max: 4`, AND THE `min` IS THE TICK-ONE GUARD.** A
 * bare `max: 4` is TRUE of a world with no units in it at all — the
 * `entityDead`-before-the-tag trap wearing a different noun — so a layout that
 * failed to place the column would fail the player on tick one, silently, in
 * the direction nobody reports. With the `min`, an empty world does not
 * satisfy it. The cost is that the WIPE case falls out of the window, which is
 * why `t.wiped` exists directly below it: `t.spent` catches the ordinary
 * grind down to four, `t.wiped` catches five-to-zero in one splash. Neither
 * covers the other and both are needed.
 *
 * ============================================================================
 * TWO SMALLER THINGS THAT ARE DECISIONS, NOT OVERSIGHTS
 * ============================================================================
 * **The secondary pays HULLS, not credits.** `ObjectiveDef.credits` is the
 * shipped reward and it is worthless here — there is nothing to spend it on,
 * and a reward the player watches land in a bank they cannot open is worse
 * than no reward. `spawnUnits` is the payout instead, in the only currency this
 * operation has.
 *
 * **`credits: 0` binds the AI too.** `Shell.startMatch` writes
 * `setup.startingCredits` into EVERY non-Neutral slot, and CLAUDE.md's own
 * measurement names the 10 000-credit opening bank as the single cause of "the
 * AI has a ready base": seven buildings and eleven troops by t+90 s, before its
 * first refinery finished. An operation whose player cannot produce at all must
 * not be racing that. At zero the Allied base is what `buildBaseFor` placed and
 * everything after it is mined, which is the pace this needs.
 *
 * **KNOWN AND NOT FIXABLE FROM HERE:** `sim/orecrisis.system.ts` has no
 * `scriptedRunning()` guard, so a player who owns no refinery surveys as
 * `Stranded` and gets one `EvaLine.NoOreMiner` and one chip a few seconds in.
 * It cannot rescue — the rescue needs a finished refinery standing — so this is
 * one wrong sentence from the announcer and nothing else. Reported rather than
 * dodged; the dodge (hand the column a harvester so `harvesters > 0`) would put
 * an unusable vehicle in a fixed force to silence a chip.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';
import {
  DEPOT, DEPOT_DROP, PAD, PAD_POINT, RELIEF_ROAD,
} from '../../layouts/soviets-common-standard';

const op: OperationDef = {
  id: 'soviets.02.common-standard',
  chapter: 'soviets',
  faction: Faction.Soviets,
  // Named four times in the dialogue — "Allied guns are sitting on it",
  // "Allied armour on the valley road" — and both relief waves spawn literal
  // `grizzly`/`javelin`. This is the operation the missing field was most
  // visibly wrong on: a player whose last skirmish row said Reclamation
  // fought Arcspitters while Vosk called them Allied armour.
  foe: Faction.Allies,
  index: 2,
  title: 'Common Standard',
  beat: 'The Split turns into shooting, and the column is a long way from a yard.',
  primaryType: 'fixed-force',
  archetype: 'bespoke',
  parSec: 840,
  requires: ['soviets.01.first-tap'],

  map: {
    preset: 'temperate',
    mapSeed: 20_260_903,
    // THE SIM SEED IS LOAD-BEARING GEOMETRY HERE, not just a layout roll. It
    // decides which two of the four authored slots are seated, and the vehicle
    // park's quoted 157 m is derived against the pair this one draws. Change it
    // and re-derive the block above `DEPOT` in the layout.
    simSeed: 8_123,
    armies: 2,
    biome: 'temperate',
    opening: 'force',
    // Zero on both sides. See the header — this is the AI's opening bank as
    // well as the player's, and it is the number that stops a fixed force
    // racing a base that was handed 10 000 credits.
    credits: 0,
  },
  layout: 'soviets-common-standard',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // EMPTY IS A RESTRICTION, NOT AN ABSENCE. The roster is an ALLOW-LIST over
  // tagged content, so `ai: []` holds the Allies to the day-one catalogue: no
  // Refractor Tank, no Refractor Tower, no AA Battery, no aircraft. A force that
  // cannot replace a hull cannot answer a tech tier either, and the Allied
  // Javelin — ungated, and the right answer to Heavy armour — is still there.
  roster: { player: [], ai: [] },

  objectives: [
    { id: 'hold', kind: 'primary', title: 'Hold Survey 40 with five hulls' },
    {
      id: 'salvage',
      kind: 'secondary',
      title: 'Start the two Works hulls at the vehicle park',
      // No `credits`. See the header: the payout is the two hulls themselves.
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * The reveal is not decoration. The pad is 193 m away through unexplored
     * shroud and the objective text names a place the player has never seen;
     * without this they spend the first minute finding the operation.
     */
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Eight hulls. There is no yard behind you and nothing to replace them with. '
            + 'Survey 40 is where the Works publish which way the March is going — stand on '
            + 'the pad and they publish nothing.',
        },
        { do: 'revealArea', player: 0, area: PAD },
      ],
    },

    /* -- the park, named with its price ----------------------------------
     * Thirty-eight seconds, so it lands while the column is still rolling and
     * before the fork is behind them. The line quotes the guard because a
     * detour whose cost is a surprise is not a decision.
     */
    {
      id: 't.park',
      when: { on: 'elapsed', ticks: seconds(38) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Works vehicle park behind the line. Two hulls in it, mothballed, built to the '
            + 'same standard as yours — our crews can start them. Three Allied guns are sitting '
            + 'on it, dug in.',
        },
        { do: 'revealArea', player: 0, area: DEPOT },
      ],
    },

    /* -- the secondary ----------------------------------------------------
     * Both clauses are needed and they mean different things: `entityDead`
     * says the guard is beaten, `unitsInArea` says the crews are actually
     * there. Driving past at speed does not start a mothballed tank.
     *
     * **AND THE CONJUNCTION IS WHY THE GUARD HAD TO STOP BEING A HULL.** Read
     * together, these two say "beat the guard AT the park" — which is a claim
     * about a place, and a mobile AI-owned hull does not stay in one.
     * `regroupSquads` walked both of the Wardens that used to be here off the
     * park in the first four seconds, so `entityDead` went on resolving while
     * `unitsInArea` was counting hulls parked in an empty lot. Emplacements
     * cannot leave; `campaign-maps.spec.ts` pins the rule.
     *
     * ABOVE `t.win`, which is the file's own ordering rule — `runDirector`
     * returns early once an outcome is set, so a secondary written below the
     * win can never resolve on the winning tick and the medal never counts it.
     */
    {
      id: 't.salvage',
      when: {
        on: 'all',
        of: [
          { on: 'entityDead', tag: 'guard' },
          { on: 'unitsInArea', player: 0, area: DEPOT, min: 2 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'salvage' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both of them turned over. Ten hulls. Do not get used to the number.',
        },
        {
          do: 'spawnUnits',
          player: 0,
          key: 'rhino',
          count: 2,
          at: DEPOT_DROP,
          spread: 11,
          tag: 'stock',
        },
        { do: 'eva', line: 'reinforcements' },
      ],
    },

    /* -- the budget, said out loud once ------------------------------------
     * `min: 1` for the same reason `t.spent` carries one: without it this reads
     * TRUE on an empty world and the warning fires on tick one, before the
     * player has lost anything.
     */
    {
      id: 't.thin',
      when: { on: 'ownerCount', player: 0, role: 'unit', min: 1, max: 6 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Six. The order says five on the pad. You have one hull of margin left.',
        },
      ],
    },

    /* -- the answer, keyed to arrival rather than the clock ----------------
     * A wall-clock wave lands whenever it lands; this lands when the player
     * commits, so the operation's hinge is in the same place for a fast column
     * and a careful one. `min: 3` rather than 5 so scouting the pad counts as
     * committing — an operation that lets you look first and then decide is one
     * the player can be careless with.
     *
     * The relief comes up the valley road on the FAR side, not out of the
     * Allied yard: the AI's own army arrives from its base, so a second bearing
     * is the difference between a firing line and a pincer. See `RELIEF_ROAD`.
     */
    {
      id: 't.seen',
      when: { on: 'unitsInArea', player: 0, area: PAD, min: 3 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'They have seen you. Allied armour on the valley road, not out of their yard. '
            + 'Half a minute.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'grizzly',
          count: 4,
          at: RELIEF_ROAD,
          spread: 16,
          tag: 'relief',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'javelin',
          count: 4,
          at: RELIEF_ROAD,
          spread: 24,
          tag: 'relief',
        },
        { do: 'orderTagged', tag: 'relief', order: 'attackMove', at: PAD_POINT },
      ],
    },

    /* -- the second column ------------------------------------------------
     * The hold timer under a LOOSER threshold than the win: 105 s of three
     * hulls on the pad, against four minutes of five. So a player who is
     * holding comfortably gets pressed, and a player who was pushed off and had
     * to come back gets the interval reset with them — which is the arming
     * pass doing exactly what it is for.
     *
     * It re-orders the whole `relief` tag, survivors of the first wave
     * included, which is deliberate: `orderTagged` issues one command per owner
     * and a scattered first wave rejoining the second is the behaviour a human
     * commander would produce.
     */
    {
      id: 't.press',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: PAD, min: 3 },
          { on: 'elapsedSinceArmed', ticks: seconds(105) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Second column, same road. They want that pad more than they want their '
            + 'refinery.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'grizzly',
          count: 5,
          at: RELIEF_ROAD,
          spread: 18,
          tag: 'relief',
        },
        { do: 'orderTagged', tag: 'relief', order: 'attackMove', at: PAD_POINT },
      ],
    },

    /* -- the win ----------------------------------------------------------
     * Four minutes of five hulls inside a 46 m disc. The hold is what makes the
     * operation's LENGTH come from holding rather than from driving — the pad
     * is 193 m from either opening, which is under a minute — and `parSec` is
     * authored against that, not against the march.
     *
     * It cannot tie with either loss below: the win needs five units and both
     * losses need four or fewer, so no tick satisfies a win and a loss at once
     * and the file order between them decides nothing.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: PAD, min: 5 },
          { on: 'elapsedSinceArmed', ticks: minutes(4) },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Pad is held. The Works publish what we hand them now. Rakhalt will want the '
            + 'hulls counted before she wants the ground.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the column stops being a column ---------------------------------- */
    {
      id: 't.spent',
      when: { on: 'ownerCount', player: 0, role: 'unit', min: 1, max: 4 },
      then: [
        { do: 'failObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Four left. That is not a garrison, it is a casualty list. Break off.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hold' },
      ],
    },

    /* -- and the case the window above cannot see -------------------------
     * `playerBeaten` is `Viability.isBeaten`, which for a force with no
     * structures is exactly "no unit left that is not a harvester". It is not a
     * duplicate of `t.spent`: five hulls inside one splash radius go to zero
     * without ever being four, and `min: 1` deliberately excludes zero.
     */
    {
      id: 't.wiped',
      when: { on: 'playerBeaten', player: 0 },
      then: [
        { do: 'failObjective', id: 'hold' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering on the net. Survey 40 stays theirs.',
        },
        { do: 'endOperation', result: 'loss', reason: 'hold' },
      ],
    },
  ],
};

export default op;
