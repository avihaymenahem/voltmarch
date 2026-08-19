/**
 * ============================================================================
 * S3 — DEEP SECTOR
 * ============================================================================
 * The March has surfaced four hundred metres past anything anybody has a
 * reading for, and the Allies have a survey camp on the near end of it. Once
 * their readings are filed the deep sector is on the Continental standard and
 * the argument is over — not because anyone won it, because it is written down.
 *
 * THE WHOLE OPERATION IS ONE SENTENCE: **take the tap before minute nine, or
 * bring the masts down before minute nine.** Do neither and the readings go out
 * and it is a loss. That is the fork, and the layout is what makes it a fork —
 * the camp sits 111 m off the line to the tap, so a column driving for one
 * never passes the other.
 *
 *   - **Take the tap** and it ends there, at whatever minute the hold lands.
 *     Fast, and it costs the secondary, so it is a bronze.
 *   - **Break the survey** and the filing waits: minute nine becomes minute
 *     fifteen. Slower, pays 700, and the Allies then come for the ground
 *     instead — the second act only that route produces.
 *
 * **THE TWO ARE NOT EXCLUSIVE AND NOTHING MAKES THEM SO, WHICH IS THE HONEST
 * READING OF THE FORK.** Killing three undefended masts and THEN taking the tap
 * pays 700 and a silver against the tap alone's bronze, so it dominates, and a
 * player with a base, twenty-five hulls at t=0 and a rail column at minute
 * three has time for both inside the nine. The consequence is that `t.contest`
 * — the minute-nine wave this file argues hardest for — fires only for somebody
 * who broke the survey and then FAILED to reach the tap by nine. **It is the
 * behind-schedule act, not the reward act.** What the fork really sets is an
 * ORDER OF OPERATIONS under one fuse, and the pressure is the fuse. Making it a
 * true fork needs a cost the vocabulary cannot express today — the masts alive
 * doing something to the player rather than only to the clock.
 *
 * **THE FAST ROUTE IS THE ONE YOU CANNOT SAFELY TAKE, AND THAT IS GEOMETRY.**
 * The tap is 129 m from the Allied opening. Holding it for seventy-five
 * seconds at minute four means holding it on their doorstep with the column
 * you started with and no second one coming. The camp has no army near it at
 * all — only a wall, one gate and four guns, which is a problem you can solve
 * with patience instead of with luck.
 *
 * ============================================================================
 * WHY THE HARD BACKSTOP EXISTS AND WHY IT IS EXACTLY `parSec`
 * ============================================================================
 * A deadline you can switch off is a race that evaporates for the player who
 * plays it best. Breaking the survey must BUY time, not abolish it, so the
 * front closes the sector at minute fifteen whatever happened to the masts —
 * and fifteen minutes is `parSec` 900 to the second. The authored par is the
 * deadline rather than a description of one, which is the only way this field
 * is falsifiable from inside the operation.
 *
 * ============================================================================
 * NO `orderTagged`, ANYWHERE, AND THAT IS A FINDING RATHER THAN AN OVERSIGHT
 * ============================================================================
 * Every Allied wave below is a bare `spawnUnits`. `AiBrain.regroupSquads` files
 * every untagged unit the seat owns into the strike group or the reserve on its
 * next pass, so a scripted `guard` on an AI-driven seat survives about a
 * second: the effect would read as authored intent and be overwritten before
 * anyone saw it.
 *
 * **AND SPAWNING THEM ON THE GROUND DOES NOT HOLD THEM THERE EITHER — THE SAME
 * PASS TAKES THEM.** An earlier draft of this block said the durable answer was
 * to put the force where it is meant to stand, which is the argument above
 * refuting itself one paragraph later. What `APPROACH` actually buys is that
 * these nine hulls JOIN THE ALLIED ARMY seventy-nine metres from its own base
 * rather than materialising inside a holding player's formation — a schedule
 * the opponent gets stronger on, not a garrison. Read the two waves as the
 * Allies building faster than they could, and read Wend's line as what she
 * INTENDS rather than as something the sim guarantees. A real garrison needs a
 * fifth `GROUP_*` tag in `AI.ts`, which is engine work and not an operation's
 * to do.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef } from '../../types';
import { APPROACH, CAMP, GATE_WATCH, STAGE, TAP, TAP_HOLD } from '../../layouts/soviets-deep-sector';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * A `unitsInArea` disc is static data in this file and the bore-head under it
 * is placed by the layout, so the two files have to agree about one point.
 * A number written in both is a number that will disagree the first time
 * either is tuned, and the failure is an operation whose win condition is
 * eighty metres from its own objective — winnable, wrong, and invisible to
 * every gate. `layouts/soviets-deep-sector.ts` owns the geometry.
 */

const op: OperationDef = {
  id: 'soviets.03.deep-sector',
  chapter: 'soviets',
  faction: Faction.Soviets,
  // "The Allies have a survey camp on the near end of it", "the tap out past
  // it with the Allies sitting on it", and Wend is intercepted on their net.
  // `t.dig` and `t.contest` both spawn literal `gi`/`grizzly` onto seat 1.
  foe: Faction.Allies,
  index: 3,
  title: 'Deep Sector',
  beat: 'The March runs past the last reading anybody has. The Allies are taking one.',
  primaryType: 'race',
  // BESPOKE RATHER THAN REINFORCED. `reinforced` is "spawnUnits at a declared
  // tick"; the minute-nine trigger reads the world to decide which of two
  // things happens, and the win is a hold timer rather than an event.
  archetype: 'bespoke',
  parSec: 900,
  requires: ['soviets.02.common-standard'],

  map: {
    preset: 'snow',
    // Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
    // fingerprint. A generator change that re-rolls this ground moves the
    // ridges the flank route runs between.
    mapSeed: 20_260_903,
    /*
     * NOT AN ARBITRARY NUMBER. `seatedSlots` derives the two authored slots a
     * two-army match occupies from `startPairFor(seed)`, and 5309 draws the
     * pair [2, 3] — the 386.2 m diagonal, player at (404, 380) and Allies at
     * (108, 132). Every distance in the layout's header is measured against
     * that. Change this and the operation is on different ground.
     */
    simSeed: 5_309,
    armies: 2,
    biome: 'snow',
    /*
     * `base`, AND THE ARGUMENT IS THE CLOCK.
     *
     * An `mcv` opening spends ninety seconds unfolding and driving before it
     * can produce anything, which on a nine-minute fuse is a sixth of the
     * operation spent watching rather than deciding. The fiction agrees: S1 and
     * S2 took the seam, and this is a push out of a position that already
     * exists.
     */
    opening: 'base',
    /*
     * 8000 AGAINST THE STANDARD 10 000, AND IT BINDS BOTH SEATS —
     * `MatchSetup.startingCredits` is written into every slot, so this is a
     * statement about the operation's tempo rather than a handicap.
     *
     * The premise is that there is no time for a full ramp. A bank that funds
     * one is the operation arguing with itself: 8000 buys a refinery, a
     * factory and armour, or it buys a tech tier, and it does not buy both
     * before minute nine.
     */
    credits: 8_000,
  },
  layout: 'soviets-deep-sector',

  // NEITHER SHIPPED RULE MAY END THIS. Flattening the Allied base wins nothing
  // — the operation is about ground nobody's base is standing on — and
  // `assetLossDefeat` would fire on a column that has out-run its own yard.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // Nothing withheld. The roster is an ALLOW-LIST, so naming anything here
  // would silently withdraw everything else tagged — and the fork this
  // operation is made of is about where you send an army, never about what it
  // is allowed to contain.
  roster: { player: [], ai: [] },

  objectives: [
    { id: 'tap', kind: 'primary', title: 'Put four units on the deep tap and hold it' },
    {
      id: 'masts',
      kind: 'secondary',
      title: 'Bring down all three survey masts before the readings are filed',
      credits: 700,
    },
  ],

  triggers: [
    /* -- the two clocks, said out loud -----------------------------------
     * Both numbers in this briefing are numbers the table below can be
     * checked against: nine minutes is `t.filed`, fifteen is `t.frontClose`,
     * three masts is what the layout stamps and three minutes is `t.rail`.
     * No distance is quoted, because the openings move with the start pair
     * and a metre count in dialogue would be the one claim nothing gates.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Deep sector holds two things. A survey camp on the near seam — three masts, '
            + 'walled — and the tap out past it with the Allies sitting on it. Their readings '
            + 'file in nine minutes.',
        },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Take the tap before then, or put the masts down and the filing waits. The '
            + 'front closes the sector at fifteen either way. Your column is at the staging '
            + 'post; the yards have a second on the rail, three minutes out. That is all of it.',
        },
        // The fork has to be KNOWN in minute three or it is not a decision.
        // Revealing both ends of it with the briefing is the cheapest way to
        // make the player's first order an argument with themselves.
        { do: 'revealArea', player: 0, area: { x: CAMP.x, z: CAMP.z, r: 82 } },
        { do: 'revealArea', player: 0, area: { x: TAP.x, z: TAP.z, r: 74 } },
      ],
    },

    /* -- the wall, explained by walking up to it -------------------------- */
    {
      id: 't.gate',
      when: { on: 'unitsInArea', player: 0, area: GATE_WATCH, min: 1 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Gate is the only opening in that wall. Anything else means stopping to make '
            + 'one, in front of those guns.',
        },
      ],
    },

    /* -- the rail column --------------------------------------------------
     * Minute three, at the STAGING POST rather than at the yard, and that is
     * the operation's thesis in one effect: everything is pointed forward and
     * going home is going backwards. Announced in the briefing so that waiting
     * for it is an informed choice costing a third of the fuse, which is the
     * decision this operation exists to pose.
     *
     * LITERAL SOVIET KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`, which runs every key through `keyFor`.
     * That is still true and is now SAFE rather than merely survivable:
     * `validateCampaign` checks every `spawnUnits` key against the army of
     * the seat it lands on, seat 0 being `faction` and every other seat
     * `foe`, so a literal key on the wrong seat is a build error instead of a
     * Anvil in Allied paint.
     */
    {
      id: 't.rail',
      when: { on: 'elapsed', ticks: minutes(3) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Rail column is down at the staging post. Nothing else is coming.',
        },
        { do: 'spawnUnits', player: 0, key: 'rhino', count: 4, at: STAGE, spread: 16 },
        { do: 'spawnUnits', player: 0, key: 'conscript', count: 5, at: STAGE, spread: 26 },
      ],
    },

    /* -- the Allies read us correctly ------------------------------------
     * Minute five, unconditional. A rubber band that fires only when the
     * player is elsewhere reads as the map cheating; a schedule the world
     * keeps regardless reads as an opponent. It punishes a slow rush and
     * rewards an immediate one, which is the pressure a race wants.
     */
    {
      id: 't.dig',
      when: { on: 'elapsed', ticks: minutes(5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Eight in ten that the objective is the tap and not the camp. Reinforcing the tap.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: APPROACH, spread: 22 },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: APPROACH, spread: 14 },
      ],
    },

    /* -- the bore-head is a building and a player will shoot it -----------
     * The win is the GROUND, not the structure, and nothing on screen says so.
     * A player who levels the tap and then waits for a victory that is not
     * coming has been failed by the operation rather than by their own play.
     */
    {
      id: 't.headBlown',
      when: { on: 'entityDead', tag: 'tap' },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Bore-head is down. The ground under it has not moved. Hold it anyway.',
        },
      ],
    },

    /* -- the column is the whole margin -----------------------------------
     * `column` IS THE STARTING FORCE ONLY, AND `t.rail` DELIBERATELY DOES NOT
     * STAMP IT. Tagging the rail wave would make this line strictly truer — it
     * can fire today with nine rail hulls standing at the staging post — and it
     * would cost the check that catches the failure that actually matters:
     * `campaign-maps.spec.ts` skips "every declared tag landed on something"
     * for any tag a `spawnUnits` produces, so a layout that stopped stamping
     * `column` would go unnoticed. A slightly overstated line beats a silent
     * hole in the ground check. Read it as: the force you were given is gone.
     */
    {
      id: 't.columnGone',
      when: { on: 'ownerCount', player: 0, role: 'unit', tag: 'column', max: 0 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Column is gone. Anything you send now walks from the yard.',
        },
      ],
    },

    /* -- the secondary, and it can only resolve one way -------------------
     * `entityDead` is TRUE before a tag exists, so this fires on tick one if
     * the layout failed to stamp a single mast — which would also disarm
     * `t.filed` and leave an operation with no fuse. That is the exact
     * failure `campaign-maps.spec.ts` builds every layout to catch.
     *
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome
     * is set, so a last mast that dies on the winning tick has to resolve
     * before the operation ends or the medal does not count it. No time bound
     * is needed — after minute nine there is no operation left to complete it
     * in.
     */
    {
      id: 't.mastsDown',
      when: { on: 'entityDead', tag: 'mast' },
      then: [
        { do: 'completeObjective', id: 'masts' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Masts are down. What they had is in a notebook in a tent now, and a notebook '
            + 'is not a filing. Take the tap properly.',
        },
      ],
    },

    /* -- minute nine, the half of the fork you earned ---------------------
     * The exact complement of `t.filed` below. At nine the survey is either
     * filed and this is over, or it is broken and the Allies stop arguing on
     * paper — which is what stops "break the masts" from turning the last six
     * minutes into a walk.
     */
    {
      id: 't.contest',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: minutes(9) },
          { on: 'entityDead', tag: 'mast' },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'They have lost the paper argument. They are coming for the ground instead.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 6, at: APPROACH, spread: 24 },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: APPROACH, spread: 15 },
      ],
    },

    /* -- the backstop, telegraphed ---------------------------------------- */
    {
      id: 't.front',
      when: { on: 'elapsed', ticks: minutes(13) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Front is two minutes out. After that nothing moves in the deep sector for a week.',
        },
      ],
    },

    /* -- the win -----------------------------------------------------------
     * `elapsedSinceArmed` is a HOLD, and the restart is the point: pushed off
     * the disc at sixty seconds, the clock goes back to zero. A plain `elapsed`
     * here would hand the operation to a player who stood on the tap once.
     *
     * ABOVE `t.filed`, so a hold that completes on the same tick as the filing
     * wins. The ground beats the paperwork; that is the whole chapter.
     */
    {
      id: 't.win',
      when: {
        on: 'all',
        of: [
          { on: 'unitsInArea', player: 0, area: TAP_HOLD, min: 4 },
          { on: 'elapsedSinceArmed', ticks: seconds(75) },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'tap' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Tap is ours. Get our own reading on the record before the Works print theirs.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- minute nine, the other half -------------------------------------- */
    {
      id: 't.filed',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: minutes(9) },
          { on: 'entityAlive', tag: 'mast' },
        ],
      },
      then: [
        { do: 'failObjective', id: 'masts' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Readings are filed. The deep sector goes onto the standard tonight and we '
            + 'will be asking permission to dig on it.',
        },
        // The loss is always the same loss — the tap was not taken. Naming the
        // secondary here would say a secondary can lose you an operation.
        { do: 'endOperation', result: 'loss', reason: 'tap' },
      ],
    },

    {
      id: 't.frontClose',
      when: { on: 'elapsed', ticks: minutes(15) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Front is on us. Pull back what is left — nothing crosses that sector now.',
        },
        { do: 'endOperation', result: 'loss', reason: 'tap' },
      ],
    },

    /* -- the ordinary loss -------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". A column that is
     * two hundred metres from its own yard is not beaten, and this operation
     * asks for exactly that.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'tap' }],
    },
  ],
};

export default op;
