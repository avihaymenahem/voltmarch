/**
 * ============================================================================
 * S1 — FIRST TAP
 * ============================================================================
 * The March surfaces in a new place and the Allies get there first. Rakhalt's
 * orders are to take the seam and leave the town working.
 *
 * THE VERTICAL SLICE. This is the operation Gate M is measured on, so it is
 * shaped to exercise every seam rather than to be the simplest thing that
 * boots: a win condition that is NOT annihilation, a secondary that can be
 * failed by carelessness rather than by losing, a reinforcement wave on a
 * timer, and a loss path that is not "you have no buildings".
 *
 * **WIPING THE ENEMY DOES NOT WIN IT.** `outcome.annihilationWin` is false, so
 * killing every Allied unit and structure while leaving the tap in Allied hands
 * leaves the match running — which is the property the whole outcome-policy
 * mechanism exists for, and the one clause of Gate M that cannot be checked by
 * reading.
 *
 * ============================================================================
 * EVERY THRESHOLD HERE COUNTS DEEDS, AND IT USED TO COUNT CORPSES
 * ============================================================================
 * `t.win` was `entityDead 'tap'` and `t.derricksKept` conjoined the same
 * condition. **BOTH ARE FALSE FOREVER FOR A CAPTURED STRUCTURE**, and every
 * structure this operation names is enemy-owned, capturable, and worth
 * capturing — so the operation had one reachable state with no win path in it
 * at all.
 *
 * The lure is not theoretical and it is not small. Measured on the built world
 * (re-measured 2026-08-21, `mapSeed` 20260819 / `simSeed` 5101, through the same
 * headless build `tests/campaign-maps.spec.ts` does):
 *
 *   tag       def            hp    owner   from your yard   from theirs
 *   tap       civOreMine    700    seat 1      186.1 m         102.2 m
 *   derrick   civOilDerrick 900    seat 1      111.3 m         185.1 m
 *   derrick   civOilDerrick 900    seat 1      131.6 m         198.0 m
 *   derrick   civOilDerrick 900    seat 1      157.1 m         153.4 m
 *
 * **THE THREE DERRICKS ARE NEARER TO YOU THAN TO THEM — 133.3 m mean against
 * 178.8 m — AND THEY ARE PAYING THE ALLIES 45 CREDITS A SECOND.**
 * `CIVILIAN_INCOME` is 15 cr/s per derrick on a 30-tick interval and
 * `civilian.system.ts#payHolders` pays whoever holds the deed, so seat 1 banks
 * **2700 credits a minute** off this town from tick one, and the tap adds 300
 * more. Taking one derrick is the most obvious economic play on the map, the
 * cursor turns into `CursorKind.Capture` over it (`input/Commands.ts` §5, the
 * `hoverEnemy` arm), and nothing anywhere told the player it was a trap.
 *
 * Capture is not free — an ENEMY structure flips only at or below
 * `CAPTURE.captureHpFrac` (0.5), and every engineer that arrives above it is
 * spent SOFTENING.
 *
 * **THE SOFTEN IS 20% OF MAX, NOT 25%, AND THE FIRST VERSION OF THIS PARAGRAPH
 * QUOTED THE RAW CONSTANT.** `Capture.resolve` pushes `maxHp *
 * CAPTURE.softenFrac` (0.25) as a HighExplosive record, and `Damage.applyOne`
 * — the only function in the game that writes `hp` — then applies
 * `ARMOR_MATRIX[HighExplosive][Concrete]` (**1.00**) and
 * `COMBAT_DAMAGE.globalMul` (**0.80**). So 0.20 of max lands per engineer:
 *
 *     900 -> 720 -> 540 -> 360, and 360/900 = 0.40 is at last <= 0.5
 *
 * **FOUR engineers, 2000 credits** — not the three and 1500 this said, which is
 * the same arithmetic slip in both directions: it made the trap look cheaper
 * than it is AND the recovery look cheaper than it is. Or 450 damage from
 * anything with a gun, plus one engineer.
 *
 * **AND THE ENGINEER COUNT IS THE SAME FOR EVERY STRUCTURE IN THE GAME**, which
 * is worth knowing before anybody re-derives it per building: both the soften
 * and the threshold are FRACTIONS OF MAX, so `maxHp` cancels. 0.20 per arrival
 * against a 0.50 gate is four arrivals at 0.40, for a 700 hp radar and a 900 hp
 * derrick alike. Only the credits differ, and only because engineers differ. It is a priced decision, which is
 * exactly why it must not also be an invisible one.
 *
 * **SO EVERY THRESHOLD IN THIS FILE IS `ownerCount` ON SEAT 1, AND THAT
 * CHANGES WHAT TWO OBJECTIVES MEAN.** `ownerCount(1, ..., max: 0)` is
 * satisfied by capture exactly as it is by demolition, so the primary is "take
 * the tap" rather than "destroy the tap" and its title says so.
 * `soviets.06.demolition-order` made the same migration for the same reason and
 * renamed its objective for the same reason; this file is that argument applied
 * to the operation that shipped first.
 *
 * ============================================================================
 * THE SECONDARY WAS ALWAYS AN OWNERSHIP RULE AND ITS TITLE SAID OTHERWISE
 * ============================================================================
 * `t.derricksLost` has read `ownerCount(1, 'building', 'derrick', max: 2)`
 * since it was written — a DEED test — while the objective said *"with all
 * three derricks standing"* and Rakhalt said *"leave them"*. Capture one intact
 * and the objective failed with a line about a derrick that was still turning.
 *
 * **THE WORDS MOVED, NOT THE RULE, AND THE VOCABULARY IS WHY.** "Three are
 * alive whoever owns them" is not expressible: `entityAlive` is "at least one"
 * and `entityDead` is "none", `ownerCount` counts one seat's holdings, and
 * there is no combinator that adds two counts. "Seat 1 still owns three" IS
 * expressible and is what the trigger has always tested. Of the two readings
 * only one can be written down, so the title is the half that had to give.
 *
 * It is also the better rule. Rakhalt's order is *"the derricks are the town's
 * — leave them"*: taking one for the income is disobeying that order as
 * squarely as shelling it, and the operation now charges 500 credits and a
 * silver for it instead of pretending not to notice.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';

/**
 * How long the layout is given to have placed the ground before any zero
 * threshold over it is believed.
 *
 * **`ownerCount(1, 'building', 'tap', max: 0)` READS TRUE AGAINST AN EMPTY TAG
 * REGISTRY**, exactly as `entityDead` does — the condition changed and the trap
 * did not. Unguarded, `t.win` would fire on the first tick the Director runs,
 * and a win nobody played is the one failure that reaches the end screen looking
 * like a feature. `soviets.06.demolition-order`'s `SETTLE` guards its own
 * primary for the same reason and this is the same constant.
 *
 * **IT IS DEFENCE IN DEPTH RATHER THAN A MEASURED FAILURE, AND SAYING WHICH
 * MATTERS.** `scenarios.system.ts` builds the world in `init()`, so the tag
 * registry is full before tick one and the empty-registry read is not reachable
 * in the product today. What it IS reachable for is a layout that placed
 * nothing — a wrong def key, a footprint that would not fit — and there twenty
 * seconds is the difference between an operation that ends before the camera
 * settles and one that at least shows the player the ground it is lying about.
 * `tests/campaign-maps.spec.ts` is the gate that catches the cause; this is the
 * guard that stops the symptom being silent.
 *
 * Twenty seconds is unmistakably past the build and unmistakably short of
 * anything being lost: the tap is 186.1 m from the player's yard and the
 * nearest derrick 111.3 m, against a starting force that has not moved.
 */
const SETTLE: Condition = { on: 'elapsed', ticks: seconds(20) };

/**
 * The Allies no longer hold the survey tap — levelled or taken, the operation
 * does not care which.
 *
 * DEFINED ONCE BECAUSE TWO TRIGGERS MUST AGREE ON IT. `t.derricksKept` has to
 * resolve on the same tick as `t.win` or the medal loses a secondary that was
 * earned, and two copies of one condition are two copies that will disagree the
 * first time either is tuned. `soviets.06`'s `WORKS_GONE` is the same shape for
 * the same reason.
 */
const TAP_TAKEN: Condition = {
  on: 'all',
  of: [
    SETTLE,
    { on: 'ownerCount', player: 1, role: 'building', tag: 'tap', max: 0 },
  ],
};

const op: OperationDef = {
  id: 'soviets.01.first-tap',
  chapter: 'soviets',
  faction: Faction.Soviets,
  // "The Allies got there first", and the primary is "Take the Allied survey
  // tap". `t.relief` spawns `grizzly` — the Allied main battle tank, literal
  // and unremapped — onto seat 1, so this was already the only army the
  // operation could mean; until now nothing said so anywhere a gate could
  // read it.
  foe: Faction.Allies,
  index: 1,
  title: 'First Tap',
  beat: 'The March surfaces in a new place. The Allies got there first.',
  primaryType: 'assault',
  archetype: 'reinforced',
  parSec: 780,
  requires: [],

  map: {
    preset: 'arid',
    // Fixed, and pinned by `tests/campaign-maps.spec.ts` as a terrain
    // fingerprint. A generator change that re-rolls this ground moves the
    // chokepoint the operation was authored around, and the fingerprint is what
    // makes that loud — it does not make it cheap.
    mapSeed: 20_260_819,
    simSeed: 5_101,
    armies: 2,
    biome: 'desert',
    opening: 'base',
    credits: 10_000,
  },
  layout: 'soviets-first-tap',

  // NEITHER SHIPPED RULE MAY END THIS. `Shell.pollOutcome` would otherwise
  // declare victory the moment the Allied base falls, with the tap untouched.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  // Nothing withheld and nothing granted. An opening operation restricting the
  // roster would be teaching the player that the sidebar lies.
  roster: { player: [], ai: [] },

  objectives: [
    // "TAKE", NOT "DESTROY", AND THE WORD IS LOAD-BEARING. `t.win` counts what
    // seat 1 still owns, so walking an engineer into the tap ends the operation
    // exactly as levelling it does. A title that said "destroy" would be an
    // instruction the rule does not enforce and a route the rule does not
    // mention.
    { id: 'sink', kind: 'primary', title: 'Take the Allied survey tap' },
    {
      id: 'derricks',
      kind: 'secondary',
      // THIS SAID "with all three derricks standing" AND THE TRIGGER HAS NEVER
      // TESTED STANDING. See the header: `t.derricksLost` counts seat 1's
      // holdings, so taking one for its 15 cr/s fails the objective while the
      // tower is still turning. The rule is the expressible one and the title
      // now names both halves of it — not broken, and not yours.
      title: 'Take the seam and leave the town its three derricks',
      credits: 500,
    },
  ],

  triggers: [
    /* -- the opening word ------------------------------------------------ */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          // "Take it off them" was already the primary's real rule and the
          // objective title used to say "destroy"; the two agree now. The
          // second sentence is blunt on purpose — the capture cursor comes up
          // over a derrick as readily as over the tap, so the one place the two
          // orders differ has to be said in words rather than implied.
          text: 'The survey says the seam runs under that town. The Allies sank a tap on it '
            + 'nine days ago. Take it off them. The derricks are the town’s — do not break '
            + 'them and do not take them.',
        },
      ],
    },

    /* -- the relief column ------------------------------------------------
     * Five minutes in, so it lands while the player is committed rather than
     * while they are still building. `spread` is a deterministic ring rather
     * than an RNG scatter: the same wave has to land in the same shape in the
     * recording, in the playback and in a designer's third run, or the
     * operation cannot be tuned at all.
     */
    {
      id: 't.relief',
      when: { on: 'elapsed', ticks: minutes(5) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Column on the west road. They are not coming for us — they are '
            + 'covering the tap.',
        },
        {
          do: 'spawnUnits',
          player: 1,
          key: 'grizzly',
          count: 4,
          at: { x: 256, z: 256 },
          spread: 14,
          tag: 'relief',
        },
        { do: 'orderTagged', tag: 'relief', order: 'attackMove', at: { x: 256, z: 256 } },
      ],
    },

    /* -- the secondary, both directions -----------------------------------
     * The FAIL is checked continuously from `SETTLE`; the COMPLETE is checked
     * on the tick the tap changes hands. Order matters and it is the file's
     * order: this trigger sits ABOVE `t.win`, so on the winning tick the
     * secondary resolves before the operation ends and the medal counts it.
     * Below `t.win` it would never fire — `runDirector` returns early once an
     * outcome is set.
     *
     * `SETTLE` IS CONJOINED HERE TOO, AND FOR THE OPPOSITE DIRECTION. An empty
     * tag registry answers `ownerCount` with 0, which is `<= 2`, so this fires
     * the FAILURE where `t.win` would fire the win — a secondary lost, in the
     * player's least favourite direction, with a line accusing them of it.
     * Same guard, same constant, both signs.
     *
     * READ THE `SETTLE` BLOCK BEFORE QUOTING THAT AS A BUG THAT HAPPENED. The
     * registry is never empty when the Director first runs: `scenarios.system`
     * builds the world in `init()` and `SystemRegistry.init` awaits every
     * module's init in sequence before a tick is taken. This is defence against
     * a layout that placed NOTHING, which is a different and reachable thing.
     */
    {
      id: 't.derricksLost',
      when: {
        on: 'all',
        of: [
          SETTLE,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'derrick', max: 2 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'derricks' },
        {
          // ONE LINE FOR TWO WAYS OF LOSING A DERRICK. It used to read "That
          // derrick fed four hundred people. Note it in the log" — a eulogy,
          // which is wrong for the half of this trigger that fires while the
          // tower is still turning under new management. The clause that
          // replaced it is true of a wreck and of a capture.
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'That derrick fed four hundred people, and it does not any more. Note it in '
            + 'the log and keep going.',
        },
      ],
    },
    {
      id: 't.derricksKept',
      when: {
        on: 'all',
        of: [
          TAP_TAKEN,
          { on: 'ownerCount', player: 1, role: 'building', tag: 'derrick', min: 3 },
        ],
      },
      then: [{ do: 'completeObjective', id: 'derricks' }],
    },

    /* -- the win ----------------------------------------------------------
     * `TAP_TAKEN`, THE SAME OBJECT `t.derricksKept` CONJOINS. Two spellings of
     * one condition are two spellings that drift, and the drift here is a
     * secondary that resolves a tick after the operation has already ended —
     * i.e. never, because `runDirector` returns early on an outcome.
     */
    {
      id: 't.win',
      when: TAP_TAKEN,
      then: [
        { do: 'completeObjective', id: 'sink' },
        {
          // "off them" rather than "down": the win no longer requires a wreck.
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'Tap is off them. Get a survey team on that seam before the Works do.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — not "you have no buildings". An operation that
     * ended on the second reading would end at t+10 s for a squad that has not
     * landed yet, which is one of the four shipped failures the outcome policy
     * exists to disarm.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'sink' }],
    },
  ],
};

export default op;
