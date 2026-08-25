/**
 * ============================================================================
 * S6 — DEMOLITION ORDER
 * ============================================================================
 * S5 sent the correction back up the line and it worked: the sector went back
 * on the books. What came down in reply is not another revision. If the seam
 * cannot be allocated it will be made unallocatable — a Weather Control Device
 * on the shoulder of the workings, nine seconds of lightning, and the ground is
 * off the survey for good. The Ninth stopped arguing.
 *
 * Rakhalt's answer is the one the chapter has been building to since S1. The
 * Soviets took the yards and the plate mills at the Split; the Allies took the
 * survey office and the instruments. This is the operation where that stops
 * being a line of lore.
 *
 * ============================================================================
 * WHY `primaryType: 'superweapon'` AND NOT `assault`
 * ============================================================================
 * The shape of the primary is "level three enemy buildings", which on its own
 * is an assault. What makes it a superweapon operation is that BOTH of the
 * numbers deciding it are superweapon numbers, and neither is authored here:
 *
 *   - `SUPERWEAPONS[SuperweaponId.Nuke].radius` is **26**, and the works is
 *     authored so no two of its three buildings are inside one blast. The
 *     nearest pair is 58.31 m centre to centre. **THE SURFACE FIGURE DEPENDS ON
 *     WHICH END YOU CLICK, AND THIS LINE QUOTED ONE END AS THE PAIR'S.** It said
 *     "52.65 m of surface — more than double", which is the DEVICE-to-plant
 *     direction (58.31 minus the plant's `hitRadius` 5.657). From either plant
 *     the device is **49.82 m** of surface (58.31 minus 8.485), so the tightest
 *     number anywhere on the works is 49.82 against 26 — **1.92x, not more than
 *     double**. Nothing about the design moves: 1.92x is still nowhere near one
 *     blast. See the layout header; the arithmetic is `Damage.applySplash`'s own
 *     surface test (`sqrt(planar) - hitRadius`), not a comparison of a disc edge
 *     against a bare range.
 *   - `SUPERWEAPONS[SuperweaponId.Nuke].chargeSeconds` is **420**, so a silo
 *     that finishes at t+0:35 is ready at 7:35 and a second warhead at 14:35.
 *     Two warheads is the most an eighteen-minute deadline can hold, against
 *     three targets.
 *
 *     **THE t+0:35 AND THE LETHALITY ARE BOTH DERIVED AND NEITHER WAS WRITTEN
 *     DOWN, WHICH LEFT THE OPERATION'S WHOLE PREMISE UNMEASURED.** `nuclearSilo`
 *     is 2500 credits on `buildTime` 32 with `battleLab` standing at t=0, plus
 *     `CONSTRUCTION_RISE_SECONDS` 2.0 once it is placed — 34 s of clock and a
 *     click, and 1644 legal 3x3 sites inside `BUILD_RADIUS` of the player's yard
 *     to put it on, the nearest 10 m out. `SuperweaponService.chargeTick` skips
 *     any weapon whose `available` bit is clear ("charges only advance while the
 *     gating structure is standing and lit"), so the 420 starts when the silo
 *     FINISHES rather than at t=0 — which is what makes 7:35 and 14:35 right and
 *     puts a third warhead at 21:35, past the close. And one warhead centred on a
 *     works building delivers `SUPERWEAPON_FX.nukeDamage` 1400 x falloff 1.0 x
 *     `ARMOR_MATRIX[HighExplosive][Concrete]` 1.00 x `COMBAT_DAMAGE.globalMul`
 *     0.80 = **1120**, against 1000 / 800 / 800. So each of the three dies to
 *     exactly one warhead, with 12% of headroom on the device and no second pass
 *     needed anywhere. The premise closes: two warheads take two, the ground
 *     takes the third, and the eighteen minutes are the reason it is a decision.
 *
 * So the operation is a purchasing decision with an exact price: the silo is
 * 2500 credits out of a 4000 bank, at least one of the three is coming down on
 * the ground whatever the player does, and the interesting question is WHICH
 * one is worth 2500 credits and seven minutes. It is the device — 1000 hp
 * behind a Refractor Tower and two pillboxes, 264.97 m from the player's yard
 * and 132.42 m from the Ninth's — because a missile flies over the tower, which
 * is `AiBrain.aimAnnihilation`'s own argument for owning one.
 *
 * **THE OPERATION CANNOT CHECK THAT THE WARHEAD WAS USED, AND DOES NOT PRETEND
 * TO.** The frozen vocabulary has twelve conditions and none of them can see a
 * superweapon; the only thing a trigger can read is the hole one leaves. Nobody
 * is required to build the silo and a player who takes all three on the ground
 * has won the same operation. What the roster and the geometry do is make the
 * button the cheapest answer, and what this file does is refuse to claim more
 * than that.
 *
 * ============================================================================
 * THE ROSTER IS THE ASYMMETRY, AND IT PAYS FOR ITSELF IN POWER
 * ============================================================================
 * `player: ['struct.tech', 'struct.superweapon.strategic']`
 * `ai:     ['struct.tech', 'struct.defence.specialist', 'struct.superweapon.siege']`
 *
 * An allow-list, so tagged-and-unlisted is refused for both seats: no AA
 * Battery, no aircraft, no raider or specialist hulls, no Displacement Ring, and
 * — for the player — **no Tesla Coils**. Measured on a bound, roster-installed
 * build, the player's opening base is 25 structures at **produced 600 /
 * consumed 270, +330 of net power**, against `SovietBase.ts`'s own documented
 * +105 for the full layout. The difference is the three coils' 225, and a
 * `nuclearSilo` draws **−150**. The coil line's power IS the silo's power, with
 * 180 to spare, and the player builds no extra reactor to arm one. That is the
 * fiction and the arithmetic saying the same thing.
 *
 * The Ninth keeps `struct.defence.specialist`, which is what puts a Refractor
 * Tower on the works and another in their base. At **range 34** it is the
 * longest-reaching structure weapon either army can field under this roster —
 * `teslaCoil`'s 30 is withheld from the player and is Soviet anyway, `pillbox`
 * and `sentryGun` are 22, `flameTower` is 18, and `struct.defence.aa` is
 * unlisted for both. **"The enemy has the tower and you do not, go over
 * it"** is the mission, and `types.ts` names that as the reason
 * `OperationRoster` carries two lists at all.
 *
 * **`struct.superweapon.siege` ON THE AI IS LOAD-BEARING, NOT DECORATION.**
 * `ScenarioBuilder.spawnBuilding` runs `isBuildable` before it places anything,
 * so without that id the layout's `weatherControl` returns NONE, the `works`
 * and `device` tags land on two entities instead of three, and
 * `ownerCount(max: 0)` becomes an objective the player finishes without ever
 * touching the device.
 *
 * **THAT IS MEASURED — build it headless with the roster installed and the id
 * deleted and the device really does come back 0 — BUT THE GATE THIS LINE USED
 * TO CREDIT CANNOT SEE IT.** It read "`campaign-maps.spec.ts` checks the
 * declaration in both directions", and that file NEVER CALLS
 * `setCampaignRoster`: its `buildOperation` installs the plan and the layout and
 * nothing else, so `isBuildable` there is unrostered, the device places whatever
 * `roster.ai` says, and deleting the id leaves the whole suite green. The two
 * directions it really checks are the TAG DECLARATION (declared -> landed, and
 * trigger-named -> declared), which catches a missing device only once the build
 * has actually dropped one.
 *
 * **`tests/campaign-roster-ground.spec.ts` IS THE GATE THAT CAN SEE IT NOW**, and
 * writing it turned up a second half nobody had named. `campaign-maps.spec.ts`
 * passes no `defs` either — `spawnBuilding` hands `isBuildable` the RESOLVED
 * def, which is `undefined` under the empty binding, and `rosterAllows` answers
 * TRUE for an undefined def. So arming `setCampaignRoster` in that file alone
 * would have left the roster inert and the new gate vacuous. Both halves are
 * required, and that is pinned by a guard case: dropping the binding makes the
 * whole file report "no operation's roster removed anything from its own build".
 *
 * The falsifier is this operation. Delete `struct.superweapon.siege` from
 * `roster.ai` and three cases go red naming the def, its `unlockedBy`, the seat,
 * the roster list it is missing from, and the objective the tag decides.
 *
 * ============================================================================
 * THE NINTH'S DEVICE IS A REAL SUPERWEAPON AND IT WILL BEHAVE LIKE ONE
 * ============================================================================
 * It is owned by seat 1, finished, and powered from tick zero (their grid reads
 * produced 600 / consumed 480, nothing shed), so
 * `SuperweaponService.rescanAvailability` marks it available and `chargeTick`
 * runs. `SUPERWEAPONS[LightningStorm].chargeSeconds` is **400**, which is where
 * `t.armed` gets its 6:40 from — the engine's own constant, not an authored one.
 *
 * **WHETHER IT FIRES IS THE BRAIN'S DECISION AND THIS OPERATION DOES NOT REST
 * ON IT.** `AiBrain.fireSuperweapon` returns immediately when
 * `this.diff.maxSuperweapons <= 0`, which is Easy.
 *
 * **THAT FIELD IS NOT ON `AI_DIFFICULTY`, AND THIS FILE NAMED IT THERE TWICE.**
 * An `AI_DIFFICULTY` row carries `name`, `reactionSec`, `apmCap`, `waveSizeMul`,
 * `aggression` and `resourceBonus`, and nothing else. `maxSuperweapons` is
 * `AI_LATE_GAME[i].superweapons` in `src/sim/AIStrategy.ts`, lifted onto
 * `DifficultyProfile` by `difficultyProfile()` off the SAME clamped index, and it
 * reads **0 / 1 / 1 / 2** across the four rungs. The consequence quoted here was
 * right; the table was not, and a citation nobody can follow is how a number
 * gets carried forward after the row it came from moves.
 *
 * Campaign difficulty comes from the skirmish lobby rather than from `op` —
 * `Shell.startOperation` writes `aiFaction: keyOf(op.foe)` and
 * `difficulty: this.setup.difficulty` onto one object, which is CLAUDE.md's
 * "`aiFaction` moves with `op.foe`; `difficulty` deliberately does not". So on
 * Easy the storm never comes and on Normal upward it does, roughly every 400
 * seconds. `t.armed` says the set is ARMED, which is true on every rung — the
 * charge is `SuperweaponService`'s and no brain is consulted for it — and the
 * loss at 18:00 is the Director's own clock rather than a strike nobody can
 * promise.
 *
 * A Brutal seat (`maxSuperweapons` 2) may also BUILD a second `weatherControl`,
 * which this layout does not tag and the primary therefore does not count. That
 * is correct: the objective is the works that was pushed onto the seam, not
 * every device the Ninth will ever own.
 *
 * ============================================================================
 * THE HIDDEN SECONDARY IS AN ORDER OF OPERATIONS, NOT A CLOCK
 * ============================================================================
 * The first draft paid for taking both plants "before the device arms at seven
 * minutes", on the theory that a dark works stops charging. **THAT THEORY IS
 * MEASURED FALSE.** Killing both plants puts the Ninth at 400 produced against
 * 480 consumed — a deficit of 80 — and `shedPriority` walks
 * `POWER_SHED_ORDER.defence` (0) first: two Refractor Towers at −50 cover 100
 * and the walk stops, so the shed list never reaches the radar (1), let alone
 * the −150 device (2). The charge is untouched. Measured through a real
 * `PowerGrid.recompute` on the built world: `shedCount` 2, `shedDraw` 100,
 * `defencesOnline` false, and the two dark structures are the tower at
 * (114, 150) in their base and the one at (198, 258) on the works itself.
 *
 * What actually happens is better, and it is what `spur` pays for: the tower
 * standing 28.28 m from the device goes dark. So the reward is for taking the
 * FEED BEFORE THE EMITTER — `ownerCount` on `stack` at zero while `entityAlive`
 * still holds for `device` — which is the professional order and the one that
 * buys a dark tower over the last building standing. No arbitrary minute is
 * involved, and the objective cannot be collected retroactively by finishing the
 * plants after the device is already rubble.
 *
 * ============================================================================
 * THE SHOWN SECONDARY IS S1's DERRICKS, PICKED BACK UP
 * ============================================================================
 * A Gaia `civHospital`, 1100 hp, **38.21 m from the device**, and the Ninth
 * sited the works around it. A warhead put on the device spares it by 5.00 m of
 * aiming margin; a warhead put on the near plant clears it by **2.84 m**, which
 * is an accident of where the block landed rather than a margin. The layout
 * header has the full table —
 * and, since this was measured, the correction that spending the coincidence
 * costs the hospital 246 of 1100 rather than the hospital: the rim of a nuke is
 * `nukeSplashFalloff` 0.22, so a click that drifts off the plant hurts a
 * civilian block for nothing rather than levelling it, and levelling it would
 * take a click essentially centred on the block.
 * It is the same objective S1 wrote as "leave the town's derricks", and the
 * chapter's answer to a demolition order is not to execute one.
 *
 * ============================================================================
 * BOTH SHIPPED OUTCOME RULES ARE OFF
 * ============================================================================
 * `annihilationWin` because razing the district while a 300-credit power plant
 * still stands on the seam has not answered the order — and `Shell.pollOutcome`
 * would declare victory there. `assetLossDefeat` because a commander who has
 * lost his yard and still has a charged silo and a column on the seam is the
 * most interesting last act this operation has, and `pollOutcome` would end it
 * at 2 Hz instead. The authored ordinary loss is `playerBeaten`, which is the
 * honest threshold.
 * ========================================================================== */

import { Faction } from '../../../core/types';
import { minutes, seconds } from '../../types';
import type { Condition, OperationDef } from '../../types';
import {
  DEVICE, MUSTER, PUSH, ROAD_A, ROAD_B, STACK_FAR_AREA, STACK_NEAR_AREA, WORKS_AREA,
} from '../../layouts/soviets-demolition-order';

/**
 * THE GEOMETRY IS IMPORTED, NOT RESTATED.
 *
 * The works is placed by the layout and the columns are ordered at it by this
 * file. A number written in both is a number that will disagree the first time
 * either is tuned, and the failure — a column attack-moving at empty ground, a
 * reveal framing nothing — is invisible to every gate.
 * `layouts/soviets-demolition-order.ts` owns the geometry.
 */

/**
 * How long the layout is given to have placed the ground before any threshold
 * over it is believed.
 *
 * **A ZERO THRESHOLD IS TRUE BEFORE THE GROUND EXISTS, IN BOTH DIRECTIONS.**
 * `ownerCount(1, 'building', 'works', max: 0)` reads TRUE for a layout that
 * placed no works, so it would WIN this operation on tick one; `entityDead:
 * 'infirmary'` reads TRUE before that tag has ever existed, so it would fail the
 * shown secondary on tick one; and `playerBeaten` reads TRUE for a seat with no
 * producer and no hull. All three are silent and all three pass every test.
 * `soviets.05.short-allocation` guards its working count the same way and for
 * the same reason.
 *
 * THE THRESHOLD IS ABOUT THE BUILD, NOT ABOUT A RACE WITH THE NINTH. The world
 * is finished before tick one, so any value above zero closes the hole; twenty
 * seconds is chosen to be unmistakably past it and unmistakably short of
 * anything being lost, since nothing hostile is ordered anywhere before minute
 * four and the works stands 264.97 m from the player's yard.
 */
const SETTLE = seconds(20);

/**
 * When the Ninth's device finishes charging.
 *
 * **THIS IS `SUPERWEAPONS[SuperweaponId.LightningStorm].chargeSeconds`, WHICH
 * IS 400, AND NOT A NUMBER THIS FILE CHOSE.** It is written as a literal rather
 * than imported because `src/campaign/**` may not reach into `src/sim/**` — see
 * the header of `types.ts` — so if that row is ever retuned this constant is
 * wrong and only prose will say so. It drives one trigger, which is dialogue and
 * an announcer line: nothing mechanical hangs off it.
 */
const ARM = seconds(400);

/** When the hidden secondary is disclosed. Before the first wave lands. */
const DISCLOSE = minutes(3.5);

/**
 * The deadline, and it is `parSec` 1080 to the second.
 *
 * The authored par IS the deadline rather than a description of one, which is
 * the only way that field is falsifiable from inside the operation. The
 * chapter's ramp is 780 / 840 / 900 / 960 / 1020 / 1080 and
 * `soviets.03.deep-sector`, `.04.company-town` and `.05.short-allocation` all
 * make the same identification.
 */
const CLOSE: Condition = { on: 'elapsed', ticks: minutes(18) };

/**
 * Every building of the forecast works is off the Ninth's books.
 *
 * `ownerCount` counts what SEAT 1 OWNS, so an engineer walking into a plant at
 * or below `CAPTURE.captureHpFrac` satisfies this exactly as levelling it does.
 * That is deliberate and the objective title says "take off the seam" rather
 * than "destroy" because of it.
 *
 * Defined once because two triggers must agree on it: `t.infirmaryKept` has to
 * resolve on the same tick as `t.win` and cannot be allowed to drift from it.
 */
const WORKS_GONE: Condition = {
  on: 'all',
  of: [
    { on: 'elapsed', ticks: SETTLE },
    { on: 'ownerCount', player: 1, role: 'building', tag: 'works', max: 0 },
  ],
};

const op: OperationDef = {
  id: 'soviets.06.demolition-order',
  chapter: 'soviets',
  faction: Faction.Soviets,
  /*
   * THE NINTH DISTRICT AGAIN — the administration whose revision S5 corrected
   * and whose filing S4 contested. `t.wave*` spawns literal Allied `gi` and
   * `grizzly`, which `validateCampaign` checks against the army of the seat they
   * land on, and the layout puts an Allied `weatherControl` and `prismTower` on
   * seat 1. Two seats, so `op.foe` fills exactly one of them.
   */
  foe: Faction.Allies,
  index: 6,
  title: 'Demolition Order',
  beat: 'The revision failed, so the Ninth stopped arguing and filed to level the ground.',
  primaryType: 'superweapon',
  /*
   * BESPOKE. Objectives, spawns, orders, reveals, dialogue, a camera move, an
   * announcer line and an outcome — `types.ts` defines the archetype as
   * "multiple effect kinds", and this is TEN of the eleven. The one it does not
   * use is `grantCredits`: both secondaries pay through `ObjectiveDef.credits`,
   * which is the same `Economy.grant` on a rail that `paid` keeps from paying
   * twice across a reload.
   */
  archetype: 'bespoke',
  parSec: 1080,
  requires: ['soviets.05.short-allocation'],

  map: {
    /*
     * `snow` carries the HIGHEST `relief` of any preset in `MAP_PRESETS` at
     * **0.50**, against `cliffs` 0.40 — and it is not the steepest overall,
     * because `arid` carries `cliffs` **0.55** on `relief` 0.28. (That
     * superlative is the one `soviets.05.short-allocation` records getting
     * wrong twice, so it is stated as the two numbers instead.) Either way it is
     * a real constraint on the layout rather than a palette: every structure
     * goes down through a `footprintBuildable` + `footprintClear` ring search
     * and the headers' distances are read off where they actually landed.
     * `soviets.03.deep-sector` is the chapter's other snow operation; S5 was
     * temperate, so this is also a change of ground.
     *
     * `biome` is `'snow'` and so is the preset — they agree here, which they do
     * NOT for `arid`/`desert`. See `OperationMap.biome`: `getBiome` answers an
     * unknown name with a warning and TEMPERATE, so a mismatch ships a different
     * map in silence, and `reclamation.03.sold-twice` has already paid for that.
     */
    preset: 'snow',
    biome: 'snow',
    /*
     * CHOSEN ON A MEASURED SWEEP OF TEN, not picked. At 20260918, 92.3% of an
     * 80 m-wide corridor along the opening-to-opening line is open to a tracked
     * hull (78.6-91.4% for the other nine) and 75.2% of the whole map is
     * track-passable. `tests/campaign-maps.spec.ts` builds this operation on
     * this seed and checks that every declared tag landed, so a generator change
     * that re-rolls this ground fails there rather than in a player's match —
     * which makes it loud, not cheap: every distance the two headers quote is a
     * distance on THIS roll.
     */
    mapSeed: 20_260_918,
    /*
     * **IT CHOOSES THE CORNERS.** `seatedSlots` draws a PAIR out of
     * `START_PAIRS` for a two-army match, and 6614 draws **[2, 3]** — the other
     * 386.16 m diagonal, the one `soviets.05.short-allocation`'s [0, 1] does not
     * use. The layout is handed spots (404, 380) and (108, 132); the CONSTRUCTION
     * YARDS land at (402, 382) and (114, 134), 380.06 m apart, and every distance
     * in this file and in the layout is measured against those yards rather than
     * against the spots. **Change this and they are all different distances.**
     */
    simSeed: 6_614,
    armies: 2,
    /*
     * `base`. The player needs a Proving Ground standing at t=0 for the silo to
     * be a purchase rather than a tech race, and the fiction agrees: S1 through
     * S5 took this seam and this is the yard that has been working it.
     */
    opening: 'base',
    /*
     * 4000, AND IT BINDS BOTH SEATS — `Shell.startMatch` writes `startingCredits`
     * into every slot, so this is a statement about the operation's economy
     * rather than a handicap.
     *
     * The silo is 2500 of it. That is the decision the bank exists to pose: the
     * opening bank is a warhead or it is an army, and it is not both. It also
     * holds the Ninth to the pace CLAUDE.md names as the single cause of "the AI
     * has a ready base" — a 10 000 opening built a seven-building base with
     * eleven troops by t+90 s having mined nothing.
     */
    credits: 4_000,
  },
  layout: 'soviets-demolition-order',

  // NEITHER SHIPPED RULE MAY END THIS. See the header: annihilation would
  // declare a win with a plant still standing on the seam, and `assetLossDefeat`
  // would end this operation's best last act at 2 Hz.
  outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },

  /*
   * AN ALLOW-LIST, SO TAGGED-AND-UNLISTED IS REFUSED FOR BOTH SEATS. The full
   * argument is in the header; the two things to know before editing it are that
   * `struct.superweapon.siege` on the AI is what lets the layout PLACE the device
   * at all (`spawnBuilding` runs `isBuildable`), and that withholding
   * `struct.defence.specialist` from the player is what pays for the silo's 150
   * of power out of the coil line's 225.
   *
   * PROFILE-INDEPENDENT, so the ground is the same on a finished account as on a
   * fresh one — which a deny-list could not promise, and which matters more here
   * than anywhere else because superweapons are progression-gated and
   * `UnlockGate.mirrorAI` would otherwise resolve the AI against the human's
   * profile. `setCampaignRoster` is consulted AHEAD of both the PvP suppression
   * flag and the installed gate.
   */
  roster: {
    player: ['struct.tech', 'struct.superweapon.strategic'],
    ai: ['struct.tech', 'struct.defence.specialist', 'struct.superweapon.siege'],
  },

  /*
   * THE INFIRMARY CANNOT BE WALKED INTO, AND `works` DELIBERATELY CAN.
   *
   * **A GARRISON IS A LOAN AND A CAPTURE IS A SALE, AND THE HOSPITAL IS THE ONE
   * PLACE THAT DIFFERENCE ENDS AN OBJECTIVE.** The layout's own comment says a
   * squad inside "holds it while it stands there and hands it back the moment
   * the last man leaves — see `src/data/Civilians.ts` — so it is a firing
   * position rather than a possession". An ENGINEER is the other verb, and it
   * has no such reversion: `CaptureService.captureBuilding` writes `owner` and
   * `faction` once, `GarrisonService.releaseEmptied` is the only thing that
   * writes them BACK, and it only ever runs for a host it took itself. So one
   * click permanently strips Gaia's universal alliance from a building standing
   * 38.21 m from the device, `Targeting.isValidTarget` refuses only ALLIES, and
   * every Allied gun on the works acquires the thing the shown secondary is
   * about — which `t.infirmaryLost` then fails, whoever fired.
   *
   * `works`, `stack` and `device` are NOT listed and must not be. The primary is
   * `ownerCount(1, 'building', 'works', max: 0)`, whose whole point is that an
   * engineer into a plant at or below `CAPTURE.captureHpFrac` answers it exactly
   * as levelling it does — the objective title says "take off the seam" because
   * of it, and `t.spurTaken` reads `stack` the same way. A blanket `'all'` here
   * would delete the primary's second route and make the title a lie.
   */
  captureProof: ['infirmary'],

  objectives: [
    {
      id: 'order',
      kind: 'primary',
      title: 'Take the forecast works off the seam: the device and both plants',
    },
    {
      id: 'infirmary',
      kind: 'secondary',
      title: 'Finish with the district infirmary standing',
      credits: 500,
    },
    {
      id: 'spur',
      kind: 'secondary',
      hidden: true,
      title: 'Take both feeder plants before the device itself',
      credits: 400,
    },
  ],

  triggers: [
    /* -- the orders -------------------------------------------------------
     * Two beats rather than four lines at once: the shell renders dialogue as
     * toasts and a stack of four is a stack nobody reads.
     *
     * THE CAMERA MOVE IS THE REVEAL AND IT IS THE ONLY ONE IN THIS FILE.
     * `cameraMove` takes the camera off whatever the player was doing, so
     * `types.ts` reserves it for an arrival, a loss or a reveal and forbids it as
     * punctuation. This is the reveal: the thing the operation is about, shown
     * once, at four seconds, before the player has begun anything.
     */
    {
      id: 't.brief',
      when: { on: 'elapsed', ticks: seconds(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The correction went up the line and came back as something else. The revision is '
            + 'withdrawn. In its place the Ninth has filed a demolition order on the sector.',
        },
        { do: 'revealArea', player: 0, area: WORKS_AREA },
        { do: 'cameraMove', at: DEVICE },
      ],
    },
    {
      id: 't.orders',
      when: { on: 'elapsed', ticks: seconds(18) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'A weather set on the shoulder of the workings. Nine seconds of lightning and the '
            + 'seam is not short of allocation any more, it is off the survey. Take the works off '
            + 'the ground before the shift closes at eighteen minutes.',
        },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The mills sent a silo instead of a coil line. That is the whole answer we have, '
            + 'and it is sitting in your bank rather than on your ground. Put it up, and put the '
            + 'warhead where the yard cannot reach.',
        },
      ],
    },

    /* -- the feed, disclosed -----------------------------------------------
     * Minute three and a half, before the first wave lands. `hidden` objectives
     * are filtered out of the briefing (`briefingObjectives`), so this really is
     * a surprise — and it arrives at the moment it becomes a decision rather than
     * a line the player read before the match started.
     *
     * THE REVEAL IS NOT A NO-OP, WHICH IS WHY `WORKS_AREA` IS r=46. That disc
     * stops 12.31 m short of either plant, and `revealArea` is
     * `Vision.exploreCircle`, which is PERMANENT — a disc that had already
     * covered them would make this beat a reveal of ground the player has been
     * looking at since four seconds. `soviets-short-allocation` records the same
     * trap for its third wave.
     */
    {
      id: 't.disclose',
      when: { on: 'elapsed', ticks: DISCLOSE },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Signals has the load. The set is not on their yard grid — it runs off two plants '
            + 'on a spur, one back toward their gate and one out on the seam.',
        },
        { do: 'revealArea', player: 0, area: STACK_NEAR_AREA },
        { do: 'revealArea', player: 0, area: STACK_FAR_AREA },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both plants are on the order with the set. Take them FIRST and the tower standing '
            + 'over it goes dark with them; take them afterwards and you have only tidied up.',
        },
        { do: 'setObjective', id: 'spur' },
      ],
    },

    /* -- the screen --------------------------------------------------------
     * Minute four, unconditional. A wave that fires only when the player is
     * elsewhere reads as the map cheating; a schedule the world keeps whatever
     * the player is doing reads as an opponent.
     *
     * IT FORMS AT THE SPUR ROAD AND THE ORDER IS A HEADING, NOT A LEASH.
     * `AiBrain.regroupSquads` files every untagged hull the seat owns into a
     * squad on its next pass, so the attack-move is the first thing these six do
     * and the brain owns them after that. What the wave buys is that the
     * district's army is 64.90 m from its own gate and 68.96 m from the works at
     * a known minute — read it as the Ninth screening faster than it could
     * build, which is what `soviets-deep-sector` established about scripted waves
     * on an AI seat.
     *
     * LITERAL ALLIED KEYS. `EffectSink.spawnUnits` resolves through
     * `ProductionCatalog.byKey` and remaps nothing, unlike the layout's
     * `ScenarioBuilder.spawnUnit`; `validateCampaign` checks each key against the
     * army of the seat it lands on, so a Soviet key here is a build error.
     */
    {
      id: 't.waveA',
      when: { on: 'elapsed', ticks: minutes(4) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Screen the spur road. The set is on a schedule and I am not the one explaining a '
            + 'delay to the branch.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_A.x, z: ROAD_A.z, r: 42 } },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_A, spread: 20, tag: 'waveA' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 2, at: ROAD_A, spread: 14, tag: 'waveA' },
        { do: 'orderTagged', tag: 'waveA', order: 'attackMove', at: DEVICE },
      ],
    },

    /* -- the set arms -------------------------------------------------------
     * Minute six and forty, which is `SUPERWEAPONS[LightningStorm].chargeSeconds`
     * exactly. DIALOGUE AND AN ANNOUNCER LINE, AND NOTHING MECHANICAL.
     *
     * **`incomingMissile` HAS NO OTHER CALLER, AND THAT WAS GREPPED RATHER THAN
     * ASSUMED** — CLAUDE.md's fifth verification trap is a header that claimed
     * an EVA line had none and was wrong. `audio.system.ts` reaches a line two
     * ways, `EVA_LINE_ID[EvaLine.*]` and a bare `eva?.say('<literal>')`, so
     * checking the enum map alone proves nothing: fourteen of the thirty-three
     * `EVA_LINES` keys have no `EvaLine` member and several of those —
     * `forcesUnderAttack`, `structureSold`, `battleControlOnline`,
     * `trainingComplete` — are spoken by the literal route. Grepped across
     * `src`, `tests`, `tools`, `wiki`, `server` and `desktop/src`, the ONLY
     * references to `incomingMissile` anywhere are its own row in `EVA_LINES`,
     * the variant count in `audio/Samples.ts` and the sweep list in
     * `tools/audio-measure.mjs`. Nothing says it. So it is a recorded, mastered
     * take no sim code can reach — exactly the position `reinforcements` was in
     * before the ore-crisis rescue became its first caller, and exactly the case
     * `types.ts` says a scripted `eva` is FOR: a beat the game has no event for.
     *
     * It fires at the moment the charge completes, which is true on every
     * difficulty. Whether the storm actually comes is
     * `AI_LATE_GAME[i].superweapons` — surfaced as
     * `DifficultyProfile.maxSuperweapons`, 0 / 1 / 1 / 2, and NOT a field on
     * `AI_DIFFICULTY`, which is what this said — and therefore the lobby's, so
     * the line says the set is ARMED and nothing here claims a strike.
     */
    {
      id: 't.armed',
      when: { on: 'elapsed', ticks: ARM },
      then: [
        { do: 'eva', line: 'incomingMissile' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The set has finished charging. It recharges after it fires and it fires again, '
            + 'and there is no version of this where we outlast it.',
        },
      ],
    },

    /* -- the yards send what was on the ramp -------------------------------
     * The one thing the player is given, at minute nine, in the middle of the
     * operation rather than at the end of it. `MUSTER` is 88.84 m from the
     * player's yard with a 28 m clear radius against an 18 m ring, so the column
     * forms up behind the base and walks.
     *
     * `reinforcements` IS THE SCRIPTED EVA LINE `types.ts` NAMES AS EARNING ITS
     * PLACE, because no announcer event corresponds to a scripted wave.
     *
     * **IT IS NO LONGER TRUE THAT "NOTHING IN `audio.system.ts` EVER SAYS IT",
     * WHICH IS WHAT THIS SAID AND WHAT `types.ts` STILL SAYS.** `EvaLine`
     * gained a `Reinforcements` member and `orecrisis.system.ts` emits it for
     * the stranded-economy rescue, which reaches the announcer through
     * `EVA_LINE_ID` on `audio.system.ts`'s ordinary `eva:line` path — the same
     * caller this file's own `t.armed` note cites thirty lines above. So the
     * line can be spoken twice in one match here, once by the rescue and once by
     * this trigger. That is harmless (`EVA_LINES.reinforcements` carries a 10 s
     * cooldown and the two moments are minutes apart) and it is still the right
     * line for a wave the announcer has no event for; it is recorded because the
     * shorter claim is the sort that stops being true without anybody noticing.
     */
    {
      id: 't.column',
      when: { on: 'elapsed', ticks: minutes(9) },
      then: [
        { do: 'eva', line: 'reinforcements' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'The yards emptied the ramp. It is not a relief column, it is what happened to be '
            + 'standing in the yard when the order came down.',
        },
        { do: 'spawnUnits', player: 0, key: 'conscript', count: 4, at: MUSTER, spread: 18, tag: 'column' },
        { do: 'spawnUnits', player: 0, key: 'rhino', count: 2, at: MUSTER, spread: 12, tag: 'column' },
      ],
    },

    /* -- the middle wave ----------------------------------------------------
     * Minute ten, and it is the only wave aimed AT THE PLAYER rather than at the
     * works. `PUSH` is the contested patch `addStartOre` lays on the midpoint of
     * the two openings, which is the ground a player pushing at the works has to
     * cross and then leave behind. It forms at `ROAD_B`, 66.48 m from the Ninth's
     * gate on the far side from the works, so it is a second bearing rather than
     * a second helping of the first.
     */
    {
      id: 't.waveB',
      when: { on: 'elapsed', ticks: minutes(10) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Second troop, off the west road, straight down the middle. If they are standing '
            + 'on the works they are not standing on anything else.',
        },
        { do: 'revealArea', player: 0, area: { x: ROAD_B.x, z: ROAD_B.z, r: 42 } },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 5, at: ROAD_B, spread: 20, tag: 'waveB' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 3, at: ROAD_B, spread: 14, tag: 'waveB' },
        { do: 'orderTagged', tag: 'waveB', order: 'attackMove', at: PUSH },
      ],
    },

    /* -- the last screen ----------------------------------------------------
     * Minute fourteen, at the works, four minutes from the close. Long enough to
     * matter, short enough that a player who has not started on the works has
     * already lost.
     */
    {
      id: 't.waveC',
      when: { on: 'elapsed', ticks: minutes(14) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Wend, intercepted',
          text: 'Everything the district has, onto the works. Four minutes and the order executes '
            + 'itself.',
        },
        { do: 'spawnUnits', player: 1, key: 'gi', count: 4, at: ROAD_A, spread: 20, tag: 'waveC' },
        { do: 'spawnUnits', player: 1, key: 'grizzly', count: 4, at: ROAD_A, spread: 14, tag: 'waveC' },
        { do: 'orderTagged', tag: 'waveC', order: 'attackMove', at: DEVICE },
      ],
    },

    /* -- the infirmary goes -------------------------------------------------
     * FAILS AT THE MOMENT IT BECOMES UNREACHABLE, rather than at the close. A
     * REBUILT STRUCTURE CARRIES NO TAG — `c.tag` runs once, inside the layout —
     * so nothing any player can do restores this objective once the tagged
     * entity is gone, whatever the sidebar does or does not offer. "Standing at
     * the finish" is therefore over the instant it is not, and an objective that
     * stays lit after it is impossible is a lie the player plays against for
     * another ten minutes.
     *
     * NO SCRIPTED `eva`. `audio.system.ts` says `structureLost` on
     * `entity:killed` for a building the LOCAL player owned — this one is Gaia's,
     * so the announcer says nothing, and there is no line in `EVA_LINES` about a
     * civilian block. The dialogue is the whole notice, which is the right weight
     * for it.
     *
     * **AND `entityDead` IS SAFE FROM THE ENGINEER NOW, WHICH IT WAS NOT.** A
     * capture does not fire this trigger by itself — a captured hospital is
     * alive — but it removes the only thing keeping the Ninth's guns off it, and
     * then this trigger fires on their round. `captureProof: ['infirmary']` at
     * the top of this file refuses the click; the argument is beside the field.
     */
    {
      id: 't.infirmaryLost',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'entityDead', tag: 'infirmary' },
        ],
      },
      then: [
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The infirmary is down. That is what the order was for, and we saved them the '
            + 'trouble. Note it in the log and keep going.',
        },
        { do: 'failObjective', id: 'infirmary' },
      ],
    },

    /* -- the feed comes down first ------------------------------------------
     * CONJOINED WITH THE DISCLOSURE, AND NOT FOR TIDINESS. `ownerCount(max: 0)`
     * reads TRUE for a layout that placed no plants, so a build that failed would
     * COMPLETE this hidden secondary on tick one — and `t.disclose` would then
     * `setObjective` it back to active at three and a half minutes, so the
     * objective would complete, un-complete and finally fail. Sharing one clock
     * with its own disclosure makes the objective's existence and its completion
     * the same event, and it costs an impossibly fast player nothing but the
     * wait. `soviets.05.short-allocation` guards its hidden secondary the same
     * way.
     *
     * `entityAlive: 'device'` is the ORDER-OF-OPERATIONS half. See the header:
     * taking the plants does not stop the charge, it darkens the Refractor Tower
     * standing 28.28 m from the device, and that is only worth something while
     * the device is still there to be shot at.
     *
     * **AND `entityAlive` CANNOT EXPRESS THAT, BECAUSE A CAPTURED DEVICE IS
     * STILL ALIVE. FLAGGED, NOT FIXED.** `Director.holds` answers `entityAlive`
     * with `q.aliveWithTag(tag) > 0` and asks nothing about ownership, so a
     * player who beats the device to `CAPTURE.captureHpFrac` (0.5) and walks an
     * engineer into it — `engineer` carries no `UNLOCK_TAGS` row, so this
     * roster's allow-list leaves it open, and its `barracks` + `refinery`
     * prereqs both stand at t=0 — has TAKEN the emitter, and can then take both
     * plants at leisure and still collect a 400-credit bounty whose title is
     * "Take both feeder plants before the device itself". The same capture also
     * makes `t.spurMissed` unreachable (`entityDead` is likewise false for a
     * live captured device), so `spur` hangs lit for the rest of the match —
     * which is exactly the failure `t.infirmaryLost` argues against one screen
     * up. The vocabulary already holds the predicate that means what this one
     * was reaching for: `{ on: 'ownerCount', player: 1, role: 'building', tag:
     * 'device', min: 1 }` for the arm and `max: 0` for the miss, since
     * `ownerCount` is what the PRIMARY already uses precisely because capture
     * counts. Left alone here because it is a behaviour change to a shipped
     * predicate and this pass is comment-only.
     */
    {
      id: 't.spurTaken',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: DISCLOSE },
          { on: 'ownerCount', player: 1, role: 'building', tag: 'stack', max: 0 },
          /*
           * `ownerCount ... min: 1`, NOT `entityAlive`, AND THE DIFFERENCE IS
           * CAPTURE.
           *
           * `Director.holds` answers `entityAlive` with
           * `q.aliveWithTag(tag) > 0` and asks NOTHING about ownership, and a
           * captured device is still alive. `engineer` carries no
           * `UNLOCK_TAGS` row so this roster leaves it open, and the player's
           * `barracks` and `refinery` both stand at t=0 — so beating the
           * device down to `CAPTURE.captureHpFrac` and walking an engineer in
           * TAKES THE EMITTER, after which the player collects both plants at
           * leisure and is paid a bounty whose title reads "Take both feeder
           * plants BEFORE the device itself".
           *
           * Worse in the other direction: the same capture makes
           * `t.spurMissed` unreachable, because `entityDead` is false for a
           * captured structure too. The hidden row would hang lit for the rest
           * of the match — the exact failure `t.infirmaryLost` argues against
           * one screen up.
           *
           * The primary already uses `ownerCount` for precisely this reason.
           * These two now agree with it.
           */
          { on: 'ownerCount', player: 1, role: 'building', tag: 'device', min: 1 },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'spur' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Both plants off the spur. Their line is eighty short and the tower over the set '
            + 'is dark — take it now, not in a minute.',
        },
      ],
    },
    /*
     * AND IT IS OVER THE MOMENT THE DEVICE IS. `entityDead` reads TRUE before a
     * tag exists, so this carries the same settle as every other threshold in the
     * file; without it the hidden objective would fail on tick one and
     * `t.disclose` would reveal an already-failed row at minute three and a half.
     */
    {
      id: 't.spurMissed',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          /*
           * THE MIRROR OF `t.spurTaken`'s FIX, AND IT CLOSES THE HANG.
           *
           * This was `entityDead 'device'`, which is FALSE for a captured
           * structure — so a player who took the emitter with an engineer left
           * this trigger permanently unreachable and the hidden `spur` row lit
           * for the rest of the match. `ownerCount ... max: 0` is true when the
           * Ninth no longer OWNS it, which covers destroyed and captured alike
           * and is the same predicate the primary uses.
           *
           * `SETTLE` still guards it for the original reason: a count of zero
           * reads true before the layout has stamped the tag, exactly as
           * `entityDead` did, so the hidden row would otherwise fail on tick
           * one and `t.disclose` would reveal an already-failed objective at
           * minute three and a half.
           */
          { on: 'ownerCount', player: 1, role: 'building', tag: 'device', max: 0 },
          { on: 'not', of: { on: 'objectiveComplete', id: 'spur' } },
        ],
      },
      then: [{ do: 'failObjective', id: 'spur' }],
    },

    /* -- the close, telegraphed --------------------------------------------- */
    {
      id: 't.closing',
      when: { on: 'elapsed', ticks: minutes(16.5) },
      then: [
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Ninety seconds. Anything of theirs still standing on that seam at eighteen '
            + 'minutes is what the order gets to point at.',
        },
      ],
    },

    /* -- the secondary resolves FIRST ---------------------------------------
     * ABOVE `t.win`, deliberately: `runDirector` returns early once an outcome is
     * set, so anything that resolves at the close has to resolve before the
     * operation ends or the medal does not count it. Same ordering rule
     * `soviets-deep-sector` states for `t.mastsDown` and `05-short-allocation`
     * for `t.all`. `t.spurMissed` sits above `t.win` for the same reason and
     * fires on the same tick the device dies.
     */
    {
      id: 't.infirmaryKept',
      when: {
        on: 'all',
        of: [
          WORKS_GONE,
          { on: 'entityAlive', tag: 'infirmary' },
        ],
      },
      then: [
        { do: 'completeObjective', id: 'infirmary' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Works down, infirmary standing. The district can file that as well.',
        },
      ],
    },

    /* -- the order is answered ---------------------------------------------- */
    {
      id: 't.win',
      when: WORKS_GONE,
      then: [
        { do: 'completeObjective', id: 'order' },
        {
          do: 'dialogue',
          speaker: 'Rakhalt',
          text: 'The set and both plants are off the seam. The branch can withdraw this one as '
            + 'well — there is nothing left of it to execute.',
        },
        { do: 'endOperation', result: 'win' },
      ],
    },

    /* -- the shift closes with the works standing ---------------------------
     * The hard deadline, at `parSec` to the second. There is deliberately NO
     * early-out arm on it: `Viability.isBeaten` is "nothing to build with and
     * nothing to fight with", and a power plant is neither — so the Ninth can be
     * beaten with the works intact, and an authored early-out would end the
     * operation in a WIN with the objective unmet. In that state the player
     * simply walks up and finishes it, which is the correct amount of work for a
     * district that has already been destroyed.
     */
    {
      id: 't.deadline',
      when: CLOSE,
      then: [
        { do: 'failObjective', id: 'order' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Eighteen minutes. The set is theirs and the seam is a hole in a survey — and the '
            + 'schedule was right the whole time.',
        },
        { do: 'endOperation', result: 'loss', reason: 'order' },
      ],
    },

    /* -- the ordinary loss ---------------------------------------------------
     * `playerBeaten` is `Viability.isBeaten` — nothing to build with and nothing
     * to fight with — not "you have no buildings". A commander whose yard is gone
     * while a charged silo and a column are still on the seam is not beaten, and
     * this operation would like that to be a position somebody can play from.
     */
    {
      id: 't.beaten',
      when: {
        on: 'all',
        of: [
          { on: 'elapsed', ticks: SETTLE },
          { on: 'playerBeaten', player: 0 },
        ],
      },
      then: [
        { do: 'failObjective', id: 'order' },
        {
          do: 'dialogue',
          speaker: 'Vosk',
          text: 'Nothing answering from the sector. They will not even have to fire it.',
        },
        { do: 'endOperation', result: 'loss', reason: 'order' },
      ],
    },
  ],
};

export default op;
