/**
 * ============================================================================
 * R2 — WRITTEN OFF
 * ============================================================================
 * The Soviets worked Survey 39-114 for nine days in week two, wrote the field
 * off, and pulled the crews. They left the sorting station standing with two
 * crushers on it, which is how Cregg knows it was an accounting decision rather
 * than a geological one. Tallow's second yard is here to lift what two
 * administrations agreed was not there and put it in the bank.
 *
 * ============================================================================
 * "MINE SOME ORE" IS A CHORE. THIS IS NOT THAT, AND HERE IS THE DIFFERENCE
 * ============================================================================
 * The primary is `credits: { player: 0, min: 16000 }` — the bank, at one
 * instant. Not ore mined, not ore delivered: **held**. `WorldQuery.creditsOf`
 * reads `PlayerState.credits`, which every purchase takes straight back out, so
 * the objective and the build queue are the same number counted twice.
 *
 * That single reading is what turns an economy into a decision, because it
 * prices every other verb in the game against the win condition:
 *
 *     a Scrap Picker             90   0.6% — the cheapest thing that shoots
 *     a Slag Heap               150   0.9% — +1500 of ceiling, and see below
 *     a Spitpost                420   2.6% — power-free, and it cannot chase
 *     a Tinker                  500   3.1% — one deed, or one capture
 *     a Grinder                 600   3.8% — the line
 *     a Scrapjaw               1150   7.2% — another hauler on a 415.9 m round trip
 *     an Ore Sorter            2000  12.5% — a dock on the field itself
 *
 * There is no timer on the primary and there is deliberately none. The pressure
 * is a Soviet base growing across the field for fourteen minutes, plus two
 * columns keyed to what the PLAYER has done rather than to the clock — the
 * shape `soviets.02.common-standard` uses for its relief, and for the same
 * reason: the hinge belongs in the same place for a fast player and a careful
 * one.
 *
 * ============================================================================
 * THE DECISION THIS OPERATION OWNS: WHERE THE ORE IS SOLD
 * ============================================================================
 * Both openings are **193.08 m** from the field. That is arithmetic rather than
 * a measurement — every authored slot sits at (+/-148, +/-124) from the map
 * centre and `hypot(148, 124)` is 193.0803 for all four — and it is why the
 * layout anchors the field on the centre.
 *
 * A Scrapjaw carries 600 at `ORE_VALUE` 1.0, fills at `HARVEST_RATE` 140/s,
 * unloads in `UNLOAD_SECONDS` 2.2 and moves at 5.6 m/s. Centre to centre, per
 * load:
 *
 *     home dock      415.9 m round trip   74.3 s driving   80.7 s cycle    446 cr/min
 *     the station    105.0 m round trip    18.7 s driving   25.2 s cycle   1427 cr/min
 *
 * The first row is measured off the built world rather than off the opening:
 * the player's own Ore Sorter lands at **(112, 406)**, **207.93 m** from the
 * field, which is the 193.08 m opening plus where `ALLIED_CORE` puts a refinery
 * inside its own base. It read (122, 396) and 193.8 m until `bb83ffb` rebuilt
 * the procedural bases on the placement grid: the refinery slot's local offset
 * went from (20, -2) to (24, -4), the base facing is cardinalised now, and
 * `spawnBuilding` snaps on the FACED footprint — three changes, one structure,
 * 17.2 m of movement. Both round trips are exactly twice the centre-to-centre
 * figure, which is the convention this table has always used.
 *
 * **QUOTE THE FIRST FIGURE AND TREAT THE SECOND AS A CEILING.** The measured
 * band for a real harvester is 429-700 credits/min — `src/data/Civilians.ts`
 * prices the derrick against it, off twelve harvesters over three seeds in
 * `tests/harvester-soak.spec.ts` — which brackets the long-haul figure and
 * confirms the model's floor. The short-haul figure ignores ore acquisition,
 * dock queueing and claim contention, all of which bite harder once the drive
 * stops hiding them.
 *
 * Against that, three ways to sell a load, all priced, none free — and they are
 * a SEQUENCE rather than a menu, because of one shipped rule:
 *
 *   - **Haul it home.** Costs nothing, and every load spends 69 seconds on a
 *     road the Soviet columns use.
 *   - **Build a Sorter on the field, 2000 — WHICH YOU CANNOT DO UNTIL YOU OWN
 *     SOMETHING THERE.** `Placement.withinBuildRadius` gives a Construction
 *     Yard `BUILD_RADIUS` 56 m and every OTHER finished structure
 *     `PLACEMENT.adjacencyRadius` 20 m plus its own radius, so 193 m of open
 *     ground is `PlacementFault.OutOfRange` and nothing else. A captured mine
 *     head is a 2x2, whose `store.radius` is 4 m, so holding one turns the
 *     field into **24 m of build space** — and that is the whole route.
 *     **The deed is not just income; it is the only thing that makes the field
 *     a place you can build.** The Sorter then ships a free Scrapjaw
 *     (`shipsWith`) and lifts the ceiling 2000, for 12.5% of the objective
 *     standing in the open. `startPointsFor` reserves the centre shelf first on
 *     every continent, so the ground itself accepts one by construction; the
 *     only thing in the way is ownership.
 *   - **Take theirs, 500.** `Capture.ts` rule 2: an ENEMY structure flips at or
 *     below `captureHpFrac` 0.5, and above it the engineer is spent knocking
 *     `softenFrac` 0.25 off and dying. The station is 1200 hp, so it is one
 *     Tinker plus 600 points of damage, or three Tinkers and no fight. Taking
 *     it does to their economy exactly what it does for yours: their two
 *     crushers drive home from that moment — 140.6 m to their opening —
 *     because `isUsableRefinery` requires an ally.
 *
 *     **AND SOFTEN-THEN-COME-BACK-LATER LOSES TO THE BRAIN, WHICH IS THE
 *     INTERESTING PART.** `AiBrain.repairBase` walks every building the seat
 *     owns with no proximity filter, takes the worst below `AI_REPAIR
 *     .startFraction` 0.75, and mends it out of the same bank a player's
 *     wrench uses. A station shot to 45% and left alone is a station being
 *     repaired past 50% while the Tinker walks. The Tinker travels WITH the
 *     attack or it is 500 credits of nothing — and nothing in this file
 *     enforces that, because the brain already does.
 *
 * The three mine heads are the fourth income and the only one that is not ore.
 * 5 credits/s each, so 900 a minute for the set — 1.7 harvesters' worth, by
 * `Civilians.ts`'s own derivation — and one Tinker takes one outright at any
 * health because they are Gaia's. **A deed pays back its Tinker in 100
 * seconds and makes a building of yours a target on the middle of the map.**
 *
 * ============================================================================
 * THE CEILING IS A WALL, AND THE OPENING BASE CANNOT REACH THE ORDER
 * ============================================================================
 * `Economy.deposit` clamps a harvest into `storageMax - credits` and WASTES the
 * rest. `capFloor` starts at `STORAGE_BASE` = `max(BASE_STORAGE 1000,
 * START_CREDITS 10000)` = **10 000 for every player whatever the opening bank
 * is** (this operation's is 3000, written into every non-Neutral slot by
 * `Shell.applySimPostBoot`), and structures add on top: `REFINERY_STORAGE`
 * 2000 each, `SILO_STORAGE` 1500 each.
 *
 * Measured off the built world: the opening base is one Ore Sorter and **two
 * Slag Heaps** (`ALLIED_CORE` carries two `oreSilo`, which `keyFor` turns into
 * `rclHeap`). So the ceiling is 10 000 + 2000 + 3000 = **15 000 against an
 * order of 16 000**. The operation cannot be finished with the base it hands
 * you, and the fix costs 150 credits or one capture. `t.ceiling` says the rule
 * as arithmetic rather than as an answer, so it stays true for a player who has
 * already taken the station and is sitting at 17 000.
 *
 * ============================================================================
 * WHY THE LOSS IS `playerBeaten` AND NOTHING ELSE
 * ============================================================================
 * Three economic defeats were considered and every one is refused BY THE
 * SIMULATION rather than by taste:
 *
 *   - **"No crushers left."** `orecrisis.system.ts` hands a stranded player a
 *     free harvester ten seconds later, provided a finished refinery is
 *     standing — and this layout hands the player one. That module's header
 *     names the layout as the designer's lever and says an operation that does
 *     not want the rescue should not hand out a refinery. This one wants it.
 *   - **"No refinery left."** The Foundry rebuilds it for 2000, and a player
 *     holding deeds has income while they do.
 *   - **"The Soviets take the field back."** This is now a real counterplay:
 *     a disciplined AI may buy an engineer for a visible legal deed and escort
 *     it there. It can also destroy a head, which costs income and the secondary
 *     but is not a defeat.
 *
 * `Viability.isBeaten` — nothing to build with and nothing to fight with — is
 * the honest floor, and it is reachable: a mine head is a building but not a
 * producer, so three deeds do not keep a razed player alive.
 *
 * **NEITHER SHIPPED OUTCOME RULE MAY END THIS.** `annihilationWin` is off
 * because razing the Soviet yard is not the order and would end the match with
 * the bank half full. The player also cannot do it: `roster.player` withholds
 * `struct.tech` and `unit.specialist`, which is a double lock on the
 * Slaghurler — the roster refuses the hull, and `rclCrucible` is its prereq and
 * carries `struct.tech`, so the tech structure is refused too. That hull's own
 * blurb is "The only thing in the army that can break a base."
 * `assetLossDefeat` is strictly looser than the authored loss, so it could only
 * ever fire into a match this table has already ended.
 *
 * ============================================================================
 * THE ONE MEASURED CONSTANT, AND EVERYTHING THE BUILD ACTUALLY PUT DOWN
 * ============================================================================
 * `FIELD` and `FIELD_POINT` are imported from the layout and are absolute — the
 * map centre, 193.08 m from every authored slot by construction. `RAID` cannot
 * be: it is on the SOVIET side of the field, and which corner that is depends
 * on the pair `seatedSlots` draws from `simSeed`. It is read off a built world,
 * the same headless build `tests/campaign-maps.spec.ts` performs, at these
 * exact seeds.
 *
 * At `mapSeed` 39 114 / `simSeed` 9 311 the seed draws the DIAGONAL pair, so
 * the player opens at (108, 380) and the Soviets at (404, 132), 386.16 m apart
 * with the field exactly between them. The composition lands at:
 *
 *     mine head A  224, 280   40.0 m from the field   153.2 m from the player
 *     mine head B  304, 284   55.6 m                  218.2 m
 *     mine head C  236, 204   55.7 m                  217.6 m
 *     station      296, 222   52.5 m                  245.6 m   140.6 m from the Soviets
 *     RAID         360, 169  135.6 m                            57.5 m from the Soviets
 *
 * `auditConnectivity` on that build: one passable region holding 100% of the
 * walkable map, **0 placements relocated, 0 entities stranded, 0 structures on
 * ground `isBuildable` refuses**.
 *
 * **RE-MEASURE `RAID` IF `mapSeed`, `simSeed` OR THE LAYOUT'S OFFSETS MOVE**,
 * and re-check it against the SPREADS below rather than against its centre.
 * `EffectSink.spawnUnits` does NOT call `connectedGround` — that is
 * `soviets-common-standard`'s `DEPOT_DROP` lesson — so a drop ring that walks
 * onto a ridge is a column standing on a ridge, permanently, with every test
 * still green. All 17 spawn points of the two columns below (6 at 14 m and 2 at
 * 26 m, then 4 at 14 m and 5 at 26 m) were checked passable for their own
 * locomotor at this point: Foot for the conscripts, Track for the Anvils.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { OperationDef, Point } from '../../types';
import { FIELD, FIELD_POINT } from '../../layouts/reclamation-written-off';

/**
 * Where the Soviet columns come down onto the field. MEASURED — see the header.
 *
 * 135.6 m from the field and 57.5 m from the Soviet opening, so a column
 * arrives out of their own yard and drives the length of the road rather than
 * materialising on top of the crushers it has come for. About 25 seconds at an
 * Anvil's 5.4 m/s, which is what makes the warning line worth saying.
 */
const RAID: Point = { x: 360, z: 169 };

const op: OperationDef = {
  id: 'reclamation.02.written-off',
  chapter: 'reclamation',
  faction: Faction.Reclaim,
  /*
   * SOVIETS, AND THIS OPERATION IS WHY R1's GUESS WAS RIGHT.
   *
   * `reclamation.01.held-paper` had to decide its foe with no line of dialogue
   * to read it off, and took the Soviets from the chapter grid — §3.4 puts
   * "Pull the field the Soviets left in week 2" at R2 and "The Allies want your
   * yard" at R4, so R1's garrison had to be the army R2 names. This file names
   * them out loud: the station on the field is theirs, the two crushers working
   * it are theirs, and both columns are literal `conscript`/`rhino`.
   *
   * So the argument R1's header flags as overturnable by a briefing author is
   * load-bearing in the other direction now. Overturning it costs this
   * operation its premise, not just a label.
   */
  foe: Faction.Soviets,
  index: 2,
  title: 'Written Off',
  beat: 'The Soviets wrote this field off in week two. Cregg has read the same survey.',
  primaryType: 'economy',
  archetype: 'bespoke',
  parSec: 840,
  requires: ['reclamation.01.held-paper'],

  map: {
    preset: 'temperate',
    /** The survey designation. 39-114 is the number in the briefing. */
    mapSeed: 39_114,
    /*
     * THE SIM SEED IS GEOMETRY HERE, not just a layout roll: it decides which
     * two of the four authored slots are seated, and therefore which corner
     * `RAID` points at. This one draws the DIAGONAL pair, which is why the
     * field sits exactly between the two openings rather than off to one side —
     * an edge pair's midpoint is 124 m off the centre, as
     * `soviets-common-standard` records. `FIELD` does not move either way.
     */
    simSeed: 9_311,
    armies: 2,
    biome: 'temperate',
    // A real base on both sides: this operation is about RUNNING an economy, so
    // the player needs the thing that builds one. `garrison: true` in the layout
    // is also what hands them their one free Tinker.
    opening: 'base',
    /*
     * 3000, AND IT BINDS BOTH SEATS. `Shell.startOperation` writes this into
     * `MatchSetup.startingCredits` and `applySimPostBoot` writes that into
     * every non-Neutral slot, so it is one number doing two jobs. It is a
     * fifth of the order, so the opening bank is a real down payment rather
     * than a rounding error — and it holds the Soviet brain to the pace
     * CLAUDE.md measured, where a 10 000 opening buys a seven-building base and
     * eleven troops before a single ore is mined.
     */
    credits: 3_000,
  },
  layout: 'reclamation-written-off',

  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  roster: {
    /*
     * THE ARCSPITTER, AND NOTHING ELSE. 420 credits of fast light hull is the
     * right answer to a crusher in the open and the wrong answer to anything
     * dug in, which is the shape this operation wants.
     *
     * `struct.tech` and `unit.specialist` are withheld deliberately — see the
     * outcome block in the header; between them they are a double lock on the
     * only Reclamation hull that can break a base. `struct.defence.specialist`
     * is withheld too, so the player's own line is Spitposts: 420 credits,
     * `power: 0`, and they cannot chase. Measured on the built world, the
     * opening base ships three of them.
     */
    player: ['unit.raider'],
    /*
     * Tesla Coils in the Soviet yard — three, on the built world — which is the
     * other half of the same statement: their base is not a shortcut. It does
     * NOT reach the field. The station's two guns are untagged `pillbox`-role
     * emplacements, so no roster can withhold them and no roster is needed to
     * keep them; and withholding `struct.tech` from the AI as well keeps both
     * sides at a week-three tech tier, which is where R2 sits in the chapter.
     */
    ai: ['struct.defence.specialist'],
  },

  objectives: [
    { id: 'take', kind: 'primary', title: 'Bank 16,000 credits' },
    {
      id: 'heads',
      kind: 'secondary',
      title: 'Take all three mine heads',
      /*
       * 600 IS FOUR FIFTHS OF ONE TINKER'S WAGE, and it is paid the moment the
       * third deed lands rather than at the end, so it goes back into the run
       * that earned it. Cregg refunds; he does not tip.
       *
       * NOTHING FAILS THIS ONE, DELIBERATELY. A razed head is gone — the
       * structure is not rebuildable by anybody — so a player who takes one and
       * loses it can never reach three, and the objective simply never
       * completes. `ownerCount` cannot tell "not taken yet" from "taken and
       * lost" (both read zero), so an authored `failObjective` would have to
       * guess, and guessing wrong fails a player who has done nothing wrong.
       * The same honest reading `reclamation.01.held-paper` takes for `dark`.
       */
      credits: 600,
    },
    {
      id: 'station',
      kind: 'secondary',
      hidden: true,
      title: 'Take the Soviet sorting station intact',
      /*
       * NO CREDITS. The payout is the station: a 105.0 m round trip instead of
       * 415.9, 2000 of ceiling, and their two crushers sent home.
       * `soviets.02.common-standard` pays its secondary in hulls for the same
       * reason — a reward the operation can hand over in kind should not be
       * handed over in cash.
       */
    },
  ],

  triggers: [
    /* -- the brief --------------------------------------------------------
     * Two lines, four seconds in: the premise, then the price. A player who
     * reads only the second one still knows what the operation is.
     *
     * The reveal is not decoration. The field is 193 m away under unexplored
     * shroud and every objective in the file is on it; without this the player
     * spends the first minute finding the operation.
     */
    {
      id: 't.open',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Survey 39-114. The Soviets worked it nine days in week two, wrote the field '
            + 'off and pulled the crews — and left the station standing with two crushers on '
            + 'it. That is an accounting decision, not a geological one.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Sixteen thousand in the bank and we are finished. Not sixteen thousand '
            + 'earned. Held. Everything you spend is something you did not deliver.',
        },
        { do: 'revealArea', player: 0, area: FIELD },
      ],
    },

    /* -- the mechanisms, named on arrival ---------------------------------
     * R1's rule: a hidden objective whose method the player has to guess is a
     * quiz, and the medal is for USING the mechanism rather than for knowing
     * it. Both lines are shipped rules verbatim — `Capture.ts` rule 1 for the
     * heads, rule 2 for the station — and both are checkable against that file.
     *
     * 68 m IS BOUNDED BY THE OPENING AT 193.08 m, so this cannot read true on
     * tick one. Measured on the built world, the closest unit the player owns at
     * t=0 is **156.5 m** from the field's centre, 88 m outside the disc. An
     * untagged `unitsInArea` is the expensive spelling and the right
     * one here: the question is whether ANYTHING of the player's has reached
     * the field, and tagging would mean naming in advance which unit counts. It
     * walks `store.alive` twice a tick until it fires, and `state.fired`
     * retires it for the rest of the match.
     */
    {
      id: 't.field',
      when: { on: 'unitsInArea', player: 0, area: FIELD, min: 1 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three capped heads out there and they belong to nobody, so a Tinker takes '
            + 'the deed outright at any health — a squad in the doorway rents one instead. '
            + 'Five a second either way, and a head you hold is twenty metres of build space '
            + 'on ground that is otherwise out of range.',
        },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'The station is theirs and it is a working dock. Take it to half its health '
            + 'and one Tinker turns it over. Send the Tinker in above half and it is spent '
            + 'knocking a quarter off the wall — five hundred credits, no station.',
        },
        { do: 'setObjective', id: 'station' },
      ],
    },

    /* -- the first deed, and the answer to it -----------------------------
     * THE PLAYER'S OWN SUCCESS ARMS THE ENEMY, which is the operation's hinge
     * and the reason it is not on a clock. A head is Gaia's until somebody
     * takes it — allied to everyone, targeted by nobody — and the tick it
     * becomes the player's it is a player-owned building in the middle of the
     * map with somewhere for the Soviets to go.
     *
     * The five-minute ceiling exists so a player who never takes one still
     * meets the column. Without it the arming predicate would never hold on a
     * pure-harvest run and this would be dead content, which is the failure
     * `reclamation.01.held-paper`'s alarm carries a ceiling to avoid.
     */
    {
      id: 't.answered',
      when: {
        on: 'any',
        of: [
          { on: 'ownerCount', player: 0, role: 'building', tag: 'mine', min: 1 },
          { on: 'elapsed', ticks: minutes(5) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Their yard cannot read a survey but it can read a meter. Column on the '
            + 'field road. Anything of ours standing on that ore is what they are coming '
            + 'for, and the crushers are worth more than the ground.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 6, at: RAID, spread: 14, tag: 'raid',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 2, at: RAID, spread: 26, tag: 'raid',
        },
        { do: 'orderTagged', tag: 'raid', order: 'attackMove', at: FIELD_POINT },
      ],
    },

    /* -- the ceiling ------------------------------------------------------
     * The RULE, not the answer, and stated as arithmetic so it survives a
     * player who has already taken the station and is sitting at 17 000.
     * `Economy.deposit` clamps into `storageMax - credits` and wastes the
     * remainder; the announcer's own `silosNeeded` fires when that starts
     * happening, and this fires four thousand credits before it does.
     */
    {
      id: 't.ceiling',
      when: { on: 'credits', player: 0, min: 11_000 },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Your ceiling is ten thousand, plus two thousand a sorter and fifteen '
            + 'hundred a heap. The yard you were given tops out at fifteen and the order is '
            + 'sixteen. A Slag Heap is a hundred and fifty. Stop lifting ore onto the ground.',
        },
      ],
    },

    /* -- the second column ------------------------------------------------
     * Keyed to the bank OR to nine minutes, whichever comes first. The bank is
     * the honest trigger — a yard lifting this much off a field somebody else
     * wrote off is visible from the other side of it — and the clock is there
     * so a slow run is not REWARDED with a quieter operation, which is what a
     * bare `credits` threshold would have done.
     *
     * It re-orders the whole `raid` tag, survivors of the first column
     * included: `orderTagged` issues one command per owner, and a scattered
     * first wave rejoining the second is what a human commander would produce.
     */
    {
      id: 't.pressed',
      when: {
        on: 'any',
        of: [
          { on: 'credits', player: 0, min: 12_000 },
          { on: 'elapsed', ticks: minutes(9) },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Second column, same road, and this one is armour. They are about to spend '
            + 'more taking this field back than they ever lifted out of it. Tallow would find '
            + 'that funny. Bill them for it instead.',
        },
        {
          do: 'spawnUnits', player: 1, key: 'rhino', count: 4, at: RAID, spread: 14, tag: 'raid',
        },
        {
          do: 'spawnUnits', player: 1, key: 'conscript', count: 5, at: RAID, spread: 26, tag: 'raid',
        },
        { do: 'orderTagged', tag: 'raid', order: 'attackMove', at: FIELD_POINT },
      ],
    },

    /* -- the crusherless case ---------------------------------------------
     * BOTH CLAUSES ARE THE GUARD. `ownerCount(harvester, max: 0)` alone reads
     * TRUE of a world with no units in it at all — the `entityDead`-before-the-
     * tag trap wearing a different noun — so a layout that failed to place the
     * opening crushers would fire this on tick one. The credits clause closes
     * that (the player opens with 3000) and it is also what makes the line
     * TRUE: a player who can afford a Scrapjaw is not stranded and
     * `orecrisis.system.ts` will not rescue them. 1150 is `rclScrapper`'s cost,
     * so `max: 1149` is exactly "cannot buy one".
     */
    {
      id: 't.stalled',
      when: {
        on: 'all',
        of: [
          { on: 'ownerCount', player: 0, role: 'harvester', max: 0 },
          { on: 'credits', player: 0, max: 1_149 },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Nothing lifting and nothing to buy a crusher with. The Sorter will send you '
            + 'one if it is still standing. Nothing sends you a Sorter.',
        },
      ],
    },

    /* -- the two secondaries, resolved before the win ---------------------
     * BOTH SIT ABOVE `t.win` AND THAT IS LOAD-BEARING. `runDirector` returns
     * immediately once an outcome is set, so a completion written below the win
     * trigger never fires and the medal never counts it.
     */
    {
      id: 't.heads',
      when: { on: 'ownerCount', player: 0, role: 'building', tag: 'mine', min: 3 },
      then: [
        { do: 'eva', line: 'buildingCaptured' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Three deeds. Nine hundred a minute for as long as they stand — and they are '
            + 'ours now, which means they are targets now. Six hundred back against what the '
            + 'Tinkers cost you.',
        },
        { do: 'completeObjective', id: 'heads' },
      ],
    },
    {
      id: 't.station',
      when: { on: 'structureCaptured', tag: 'station', player: 0 },
      then: [
        { do: 'eva', line: 'buildingCaptured' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Their dock is our dock. Fifty metres of haul instead of two hundred '
            + 'and eight, two thousand of ceiling, and their crushers drive home from '
            + 'here. '
            + 'Tallow would call that three favours. It was one purchase.',
        },
        { do: 'completeObjective', id: 'station' },
      ],
    },

    /* -- the win ---------------------------------------------------------- */
    {
      id: 't.win',
      when: { on: 'credits', player: 0, min: 16_000 },
      then: [
        { do: 'completeObjective', id: 'take' },
        {
          do: 'dialogue',
          speaker: 'Cregg',
          text: 'Sixteen thousand, off ground two administrations agreed was empty. File it '
            + 'as a recovery and send them the survey with it. They will spend a year arguing '
            + 'about which of them wrote it off.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the loss ---------------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and
     * nothing to fight with — and the header sets out why every economic defeat
     * that reads better than it is refused by the simulation itself.
     */
    {
      id: 't.lose',
      when: { on: 'playerBeaten', player: 0 },
      then: [{ do: 'endOperation', result: 'loss', reason: 'take' }],
    },
  ],
};

export default op;
