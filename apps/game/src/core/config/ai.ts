/**
 * Domain-owned config slice: AI brain policy and cadence.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import { AI_PRODUCTION_HZ, AI_SQUAD_HZ, AI_STRATEGY_HZ } from './gameplay';
import { SIM_HZ } from './runtime';

/* ==========================================================================
 * 20. AI BRAIN (owned by src/sim/AI.ts + src/sim/AIStrategy.ts)
 *
 * Section 17 already holds the per-difficulty and per-personality tables that
 * the whole game agrees on. Everything here is the BRAIN's own tuning: the
 * cadences its layers run at, the thresholds its decisions compare against,
 * and the sizes of its fixed memory buffers.
 *
 * A note on difficulty, because it is the one place an RTS AI is usually
 * dishonest: NOTHING in this block gives the AI information a player could not
 * have. `AI_DIFFICULTY[].resourceBonus` in section 17 is an ECONOMIC handicap
 * and is published for the economy module to honour; the brain itself never
 * writes credits and never bypasses `IVision`. What actually differs per
 * difficulty here is reaction latency, action rate, how well the AI PICKS its
 * army, and HOW BIG AN ECONOMY IT RUNS — see AI_SKILL below. Nothing anywhere
 * lets it build faster than the player per item: `buildSpeedMul` is a pure
 * function of the power supply and `factorySpeed()` a pure function of factory
 * count, and both players go through the same `BuildQueue`.
 * ========================================================================== */

/**
 * Per-difficulty knobs that only the brain cares about. Index-aligned with
 * `AI_DIFFICULTY` in section 17, so `AI_SKILL[p.aiDifficulty]` is always valid
 * for the same index that indexes the shared table.
 *
 * `composition` is the honest skill axis: at 0 the AI rolls its army from a
 * flat distribution (it builds whatever, in whatever proportion); at 1 it
 * weights every choice by how well that unit answers the threat mix it has
 * actually SEEN. Same information, better use of it.
 *
 * `creditFloor` is the reverse handicap — credits an Easy AI leaves sitting
 * idle instead of converting into army. A human beginner does exactly this.
 * It is a BUFFER, not a rate: it softens the opening and then stops mattering
 * the moment steady income clears it, which is why it was never enough on its
 * own to answer "they build faster than us".
 *
 * `maxHarvesters`, `maxRefineries` and `queueDepth` are that answer. All three
 * used to be single constants in `AI_ECONOMY`/`AI_BUILD` shared by every rung,
 * so an Easy AI ran the identical nine-harvester, three-refinery economy as a
 * Brutal one and kept its queues equally full. That is the whole of the
 * report: the ladder scaled the AI's JUDGEMENT and its CLOCK, and left its
 * THROUGHPUT flat. A beginner opponent should run a beginner's economy.
 *
 * Hard and Brutal keep the old values exactly — 9/3/2 — so this is a change to
 * the bottom of the ladder only, not a nerf to the top of it.
 *
 * `queueDepth` does not change the build RATE (`BuildQueue.advanceTab` only
 * ever advances `items[0]`); it changes whether there is a GAP between one unit
 * popping and the next one starting. At depth 1 the Easy brain has to notice
 * the empty queue on its next build tick and then win an action out of a 28 apm
 * budget it is also spending on harvesters and squads, which reads on screen as
 * a barracks that pauses between units. That is the texture of a human who is
 * not paying attention, and it is the correct one for Easy.
 *
 * `maxAntiAir` and `airReactionSec` are the newest pair and they exist for the
 * same reason. `Locomotor.Air` made the AI's anti-air doctrine reachable for
 * the first time — `AI_BUILD.airAltitudeMetres` had never once been exceeded,
 * so the interrupt in `chooseBuild` had never once fired — and a doctrine that
 * switches on is a STRENGTHENING. Left alone it would have handed every rung,
 * Easy included, a perfect, instant, four-tower answer to the first gunship it
 * ever saw, which is exactly the flat ladder the paragraphs above are about.
 *
 * So the rungs differ on both halves of the response: HOW MANY towers, and HOW
 * LONG the AI takes to believe what it saw. Eighteen seconds on Easy lets a
 * beginner's first air raid land cleanly before the opponent starts answering;
 * Brutal answers the raid that is still overhead. Note that these gate the
 * DEDICATED AA branch only:
 * `maxDefense` still caps total static defence above it, so a high `maxAntiAir`
 * can never turn into a wall of towers on its own.
 */
export const AI_SKILL = [
  { composition: 0.05, creditFloor: 2000, techBias: 0.45, scoutDelayMul: 3.0, discipline: 0.20, advancedTactics: false, maxDefense: 2,  maxHarvesters: 4, maxRefineries: 2, queueDepth: 1, maxAntiAir: 1, airReactionSec: 18,  maxRepairs: 1 },
  { composition: 0.55, creditFloor: 600,  techBias: 1.0,  scoutDelayMul: 1.0, discipline: 0.65, advancedTactics: true,  maxDefense: 6,  maxHarvesters: 7, maxRefineries: 3, queueDepth: 2, maxAntiAir: 2, airReactionSec: 6,   maxRepairs: 3 },
  { composition: 0.85, creditFloor: 250,  techBias: 1.2,  scoutDelayMul: 0.7, discipline: 0.85, advancedTactics: true,  maxDefense: 8,  maxHarvesters: 9, maxRefineries: 3, queueDepth: 2, maxAntiAir: 3, airReactionSec: 2.5, maxRepairs: 5 },
  { composition: 1.00, creditFloor: 0,    techBias: 1.4,  scoutDelayMul: 0.5, discipline: 1.00, advancedTactics: true,  maxDefense: 10, maxHarvesters: 9, maxRefineries: 3, queueDepth: 2, maxAntiAir: 4, airReactionSec: 0,   maxRepairs: 8 },
] as const;

/**
 * MENDING THE BASE — the doctrine half of `AI_SKILL[].maxRepairs`.
 *
 * Reported as *"when they are being attacked, and for example their buildings
 * destroyed, they are not rebuilding, not healing"*. The healing half was
 * exactly true and it was not a tuning problem: `CommandKind.RepairToggle` had
 * NO CALLER in `src/sim/AI.ts`. The brain's entire command surface was five
 * verbs — production, placement, orders, stance and commander powers — so a
 * bombed AI base sat at whatever HP the raid left it on, permanently. Measured
 * over ten sim-minutes on a base taken to 35%: mean HP after, 0.35, unchanged
 * to four decimals, while the brain banked and spent 34 000 credits on infantry.
 *
 * THE FIX IS THE PLAYER'S OWN BUTTON, NOT A NEW RULE. `issueRepairToggle` is
 * the wrench on the sidebar; `RepairSellService` charges the same
 * `REPAIR_COST_PER_HP`, cancels the same way when the bank runs dry, and
 * refuses the same structures. So this costs the AI real money out of the same
 * account it builds from, which is what makes it a decision rather than a
 * handout — and it binds the human identically because it IS the human's path.
 *
 * `startFraction` is deliberately well below 1.0. The toggle is a toggle: the
 * service clears the flag at full HP by itself, so the AI never needs to switch
 * one off, but re-arming on a structure grazed for 2% would spend an action and
 * a trickle of credits on nothing. Three quarters is "this took a hit that
 * mattered".
 *
 * `minCredits` is NOT a duplicate of `creditFloor`. The floor is what a rung
 * refuses to spend on BUILDINGS AND UNITS; this is the much smaller reserve
 * below which starting a fresh drip is self-defeating, because
 * `RepairSell.tickRepairs` cancels a repair the moment the bank cannot pay the
 * tick — an AI that arms six repairs on 40 credits gets six cancels and a
 * wasted action budget.
 */
export const AI_REPAIR = {
  /** Mend a structure at or below this fraction of maxHp. */
  startFraction: 0.75,
  /** Bank below which starting another drip just gets cancelled. */
  minCredits: 400,
} as const;

/**
 * SELLING OUT OF A STOPPED ECONOMY.
 *
 * `OreCrisis` already proves when selling can buy a replacement harvester or
 * refinery, and the player gets a HUD instruction naming the Sell tool. The AI
 * used to have no caller of `CommandBus.issueSell`, so exactly that recoverable
 * state was permanent for a computer seat.
 *
 * This is deliberately slower than the ten-second stranded-economy rescue. A
 * sale is irreversible and changes the base, so the brain must remain in the
 * proven state for twelve seconds plus its difficulty reaction latency before
 * it acts. It then sells ONE structure and waits four seconds before asking
 * again. The production service applies the same 50% refund and last-builder
 * lockout as it does for a human; this block grants no credits and sees no fog.
 * Authored campaign operations opt out at the live oracle because some use
 * fixed AI-owned buildings as mission pieces whose survival is load-bearing.
 */
export const AI_RECOVERY = {
  /** Continuous seconds with a valid sale candidate before the first click. */
  sellDelaySeconds: 12,
  /** Minimum seconds between irreversible sale commands. */
  sellIntervalSeconds: 4,
} as const;

/**
 * REPLACING A LOST CONSTRUCTION YARD.
 *
 * The other half of the same report. `conyard` is what carries
 * `producesTab: BuildTab.Structures`, so a player without one cannot build any
 * structure at all. The normal route back — for a human exactly as for the AI
 * — is to buy a Construction Vehicle from a surviving war factory and unfold
 * it. If that factory is gone too, `ProductionService` exposes the same MCV as
 * a normal-price, normal-time off-map recovery requisition and delivers it
 * beside a surviving owned asset. `src/data/Defs.ts` says so in the `mcv` def's
 * own comment: "a fresh profile must be able to replace one it lost", which is
 * why that def carries no unlock tag.
 *
 * The AI never bought one. `BuildRole.Mcv` exists in the catalog and the deploy
 * layer knows how to drive and unfold one, but nothing in `AI.ts` ever called
 * `forRole(BuildRole.Mcv, ...)` — so the yard-less branch of `build()` fell
 * straight through to "spend everything on units". Measured: 196 riflemen, 28
 * tanks and 14 rocket troopers over ten minutes, zero construction vehicles,
 * zero structures, with the brain's own goal string reading "construction yard
 * lost — throwing gi at them".
 *
 * `bankFraction` is the whole difficulty of this fix. An MCV is 3000 credits
 * and the yard-less brain is ALSO the brain being told to throw everything it
 * has at the enemy, so without holding money back it can never accumulate the
 * price — it converts each 200-credit slice into a rifleman first. The reserve
 * is a fraction of the cost rather than the whole of it so that a brain saving
 * for the yard is still buying SOME defence while it saves; at zero it turtles
 * with an empty base, and at one it dies holding exactly 3000 credits.
 *
 * THERE IS DELIBERATELY NO RE-ASK TIMER HERE. The upgrade and commander-power
 * layers need one because they produce no entity and are otherwise invisible
 * to every probe; an MCV is a vehicle sitting in a queue, so `AiBrain
 * .yardOnOrder` reads the queue and `census` counts the finished vehicle. A
 * clock on top of two exact observations is a third opinion that can disagree
 * with both.
 */
export const AI_REBUILD = {
  /** Fraction of an MCV's price held back from unit spending while saving. */
  bankFraction: 0.75,
} as const;

/**
 * How many own entities one brain will track. A player fielding more than this
 * has already won; the roster simply stops growing rather than reallocating.
 */
export const AI_ROSTER_CAP = 1024;

/** Layer cadences in TICKS. Derived from the Hz knobs in section 17. */
export const AI_CADENCE = {
  /** Rebuild the owned-entity census + the visible-enemy sweep. */
  census: Math.round(SIM_HZ / AI_STRATEGY_HZ),
  /** Harvester babysitting, power projection, expansion checks. */
  economy: Math.round(SIM_HZ / AI_PRODUCTION_HZ),
  /** Queue decisions and structure placement. */
  build: Math.round(SIM_HZ / AI_PRODUCTION_HZ),
  /** Squad assembly, target selection, retreat checks. */
  squad: Math.round(SIM_HZ / AI_SQUAD_HZ),
  /** Scout dispatch and waypoint advance. */
  scout: SIM_HZ * 3,
} as const;

/**
 * Economy layer.
 *
 * The fleet SIZE caps that used to live here — `maxHarvesters` and
 * `maxRefineries` — are per-difficulty now and live in `AI_SKILL`. They are not
 * duplicated here: a constant that only one of two readers honours is how the
 * ladder ends up flat again.
 */
export const AI_ECONOMY = {
  /**
   * Harvesters the AI wants per completed refinery. Doctrine, not skill — a
   * beginner who owns two refineries still wants three trucks on each; what a
   * beginner does NOT do is own nine trucks. That is `AI_SKILL.maxHarvesters`.
   */
  harvestersPerRefinery: 3,
  /** Cells outward that a harvester searches for ore before it is "starved". */
  oreSearchCells: 42,
  /** Cells outward the EXPANSION check searches, to find a second field. */
  expandSearchCells: 110,
  /** Power surplus the AI tries to stay above, in power units. */
  powerHeadroom: 40,
  /** Below this surplus a power plant pre-empts everything except a refinery. */
  powerPanic: 5,
  /** Seconds since last hit under which a harvester is considered under fire. */
  harvesterThreatSec: 3.0,
  /** HP fraction below which a harvester runs home instead of finishing its load. */
  harvesterFleeHp: 0.55,
  /** Credits above which a silo is worth building (fraction of storage cap). */
  siloFillFraction: 0.85,
} as const;

/**
 * Build layer.
 *
 * `desiredQueueDepth` moved to `AI_SKILL.queueDepth` — see the note there.
 * Deeper never built faster; it only ever hid money in the queue and closed the
 * gap between items, which is exactly the thing that should differ by rung.
 */
export const AI_BUILD = {
  /**
   * Ticks after which an unacknowledged ProductionStart is assumed lost and may
   * be re-issued. Without this the AI deadlocks forever against a production
   * module that is not present yet (the boot state of this repo).
   */
  requestTimeoutTicks: 300,
  /** Rings of cells the placement search sweeps outward from its anchor. */
  placementRings: 16,
  /** Cells of clear ground required around a new structure's footprint. */
  placementGapCells: 1,
  /** Ticks with no incoming damage before the AI considers teching up "safe". */
  techSafeTicks: 450,
  /**
   * Ceiling on `AI_SKILL[].maxAntiAir`. The per-rung caps are the live numbers;
   * this is the top of the ladder, kept so the two can never silently disagree
   * (`tests/air-layer.spec.ts` asserts no rung exceeds it).
   */
  maxAntiAir: 4,
  /**
   * Metres above the terrain surface at which an entity is classified as
   * AIRBORNE.
   *
   * `Locomotor.Air` exists now, so this is no longer the only signal available
   * — but it is still the RIGHT one HERE, and the two answer different
   * questions. `sim/Combat.isAirborne` reads the locomotor, because "may this
   * gun shoot that thing" must be exact. This reads ALTITUDE, because the
   * question is "is there an air threat in this match", and the honest answer
   * to that is what the AI can see happening in the world rather than a column
   * it would be reaching into. Anything genuinely holding station 6 m up needs
   * an answer the AI does not have on the ground, whatever the def table calls
   * it.
   *
   * THE MARGIN IS LOAD-BEARING. `AIR_CRUISE_ALTITUDE` is 22 m, so a flyer sits
   * 3.7x over this line and clears it about 0.2 s after it spawns. Move either
   * number toward the other and the AI stops seeing aircraft at all — silently,
   * because nothing else in the game reads either constant. `tests/
   * air-layer.spec.ts` pins the relationship with a required margin rather than
   * trusting a reviewer to notice.
   */
  airAltitudeMetres: 6.0,
} as const;

/** Military layer. */
export const AI_MILITARY = {
  /** Fraction of the army held back to answer base attacks. */
  reserveFraction: 0.3,
  /** Reserve floor — a base with nothing at home dies to two scouts. */
  reserveMin: 2,
  /** Ticks the AI regroups after a beating before it will attack again. */
  regroupTicks: 300,
  /**
   * WHEN THE AI IS FIRST ALLOWED TO ATTACK, and how often after that. Both are
   * quoted at `aggression` 1.0 (Normal) and DIVIDED by the difficulty's own
   * aggression, so the table below is what the player actually experiences:
   *
   *                 aggression   first push     gap between waves
   *      Easy          0.3         6:40               2:40
   *      Normal        0.7         2:51               1:09
   *      Hard          1.0         2:00               0:48
   *      Brutal        1.3         1:32               0:37
   *
   * "Even on eassy, enemies spawns too early and attack too harsh." Nothing
   * gated an attack on TIME at all: the brain committed the instant
   * `strikeCount >= waveThreshold()`, and on Easy against a Rusher personality
   * that threshold is `AI_SQUAD_MIN * 0.6 / 1.6 = 2.25`, clamped up to the
   * floor of 2. Two conscripts out of the barracks and the wave rolled.
   *
   * `aggression` was ALREADY the knob for this — `DifficultyProfile.aggression`
   * is documented as "0..1.3, how readily it commits to an attack" — and it was
   * read by nothing at all. Both fields existed; only the wiring was missing.
   *
   * SIZE IS NOT TIMING, which is why these are separate from `waveSizeMul`.
   * A smaller wave arriving immediately is not an easier game, and lowering
   * `waveSizeMul` further would only have made the AI attack SOONER, because
   * that number is a divisor on the threshold the brain waits to reach.
   */
  firstStrikeSeconds: 120,
  rearmSeconds: 48,
  /**
   * The grace period is a HEAD START, not a truce. Base pressure above this
   * cancels it outright: an AI that lets you demolish it unopposed for five
   * minutes because the clock said so is not "easy", it is broken, and the
   * first thing any player does to test a new build is rush the enemy base.
   * Defence was never gated — `defendBase` returns long before the offensive
   * branch — but the counter-attack was.
   */
  gracePressureCancel: 0.5,
  /** Strike group is beaten once it has lost this fraction of its start size. */
  retreatLossFrac: 0.45,
  /** ...or once its mean HP falls below this. */
  retreatHpFrac: 0.4,
  /** Ticks between re-issuing the attack-move so the group re-converges. */
  reissueTicks: 45,
  /** Metres from the objective at which the group counts as "arrived". */
  arriveRadius: 16,
  /** Metres around a base structure that count as "the base" for defence. */
  defendRadius: 64,
  /** Threat units decayed per second in the coarse threat grid. */
  threatDecayPerSec: 0.5,
  /**
   * "My base is being hit" decays far slower than the threat grid, because it
   * is a MEMORY, not an observation: one raid should keep the AI defensive for
   * about as long as `UNDER_ATTACK_COOLDOWN`. It must also outlast the slowest
   * reaction time in AI_DIFFICULTY (2.4 s), or an Easy AI can never respond to
   * an attack at all — its evidence expires before it is allowed to act on it.
   */
  pressureDecayPerSec: 0.06,
  /** Ticks a remembered enemy structure survives without being re-sighted. */
  memoryTicks: 3600,
  /**
   * Wave threshold grows by this much each time a wave is wiped out.
   *
   * The CEILING on that growth is `AI_SQUAD_MAX * waveSizeMul`, not a flat
   * `AI_SQUAD_MAX`: a flat cap let an Easy AI that had lost four waves mass 17
   * units — larger than any wave a Brutal AI opens with — purely because the
   * player kept beating it. Losing should not be how the difficulty setting
   * gets undone.
   */
  waveEscalation: 2,
  /** Metres ahead of the base, toward the enemy, that the strike group masses. */
  rallyOffset: 34,
} as const;

/** Scouting layer. */
export const AI_SCOUT = {
  /** Ticks before the first scout is dispatched (scaled by AI_SKILL.scoutDelayMul). */
  firstScoutTick: 240,
  /** Ticks between scouting sweeps once the first one is done. */
  repeatTicks: 1200,
  /** Metres from a waypoint at which the scout advances to the next one. */
  arriveRadius: 20,
} as const;

/** Fixed memory sizes. Allocated once per brain, never grown. */
export const AI_MEMORY = {
  /** Remembered enemy structures. Beyond this the oldest is evicted. */
  structureSlots: 96,
  /** Coarse threat grid resolution — MAP_CELLS must divide by this. */
  threatDiv: 8,
} as const;

/** Threat classes the composition scorer reasons about. */
export const AI_THREAT_CLASS_COUNT = 5;
