/**
 * ============================================================================
 * VOLTMARCH — src/campaign/types.ts
 * ============================================================================
 * THE OPERATION SCHEMA. Types and POD constants only, no imports with runtime
 * cost, no DOM, no `three`, no `src/shell/**`, no `src/sim/**`.
 *
 * THAT CONSTRAINT IS A BUNDLE CONSTRAINT AND IT IS NOT NEGOTIABLE.
 * `src/game/Systems.ts` globs `'../**\/*.system.ts'` with `eager: true` FROM
 * THE ENTRY CHUNK, so anything statically reachable from
 * `src/game/campaign.system.ts` is downloaded by every player before first
 * paint — on the title backdrop, on every `?shot=` boot, on a machine that
 * will never open the campaign. `campaign.system.ts` imports this file and
 * `policy.ts` and NOTHING ELSE; the Director, the operation table, the layouts
 * and the prose are all behind one `await import('./campaign-install')`.
 * `tests/campaign-bundle-isolation.spec.ts` fails when that is broken.
 *
 * ============================================================================
 * WHY A DECLARATIVE TABLE AND NOT A CALLBACK
 * ============================================================================
 * An operation could have been `(world, tick) => void`. It is a data row
 * instead, evaluated by a pure director, for three reasons in ascending order
 * of importance.
 *
 *   1. **A callback cannot be validated; a row is validated once, for every
 *      row that will ever exist.** `validateCampaign` runs AT IMPORT, so a
 *      typo in an objective id is a build error rather than a mission that
 *      silently cannot be completed. This is the argument `Defs.ts` and
 *      `Missions.ts` already make for themselves.
 *   2. **The determinism ban is checkable by reading, not by trusting.** A
 *      callback may call `Math.random()`, `Date.now()`, read `localStorage` or
 *      allocate in the loop. There is a test asserting the first two are
 *      banned inside `simTick` — and it would need extending once per authored
 *      callback, 37 times, to stay meaningful. A row cannot express any of
 *      them.
 *   3. **The authoring is the part most likely to be split across agents who
 *      have not read CLAUDE.md.** Four content workstreams authoring against a
 *      vocabulary the compiler enforces is a different risk profile from four
 *      workstreams writing free functions inside the fixed timestep.
 *
 * AGAINST EXTENDING `MissionRule`, which is the other obvious answer.
 * `RULE_KINDS` is 13 counters/max/flags over `GameEvents`, evaluated OUTSIDE
 * `simTick`, over the EVENT STREAM. An operation needs state predicates over
 * the WORLD, evaluated INSIDE `simTick`. Those are two languages on opposite
 * sides of the determinism boundary, and merging them puts profile data — which
 * is loaded from localStorage and therefore DIFFERENT BETWEEN TWO PLAYERS WHO
 * PRESSED THE SAME BUTTONS — inside the fixed step. `src/shell/tutorial-steps.ts`
 * refused this exact merge first, for weaker reasons, and paid for a separate
 * director across three files rather than widen `MissionRule`. The campaign is
 * the third system to want scripted triggers and it takes the same shape.
 *
 * ============================================================================
 * THE VOCABULARY FREEZES AT THE END OF PHASE 1
 * ============================================================================
 * Adding a condition or an effect after content authoring begins is a schema
 * change across every operation file, not a convenience. Two were considered
 * and CUT, and the reasons are recorded here so nobody re-derives them:
 *
 * **`spawnBuildings` — CUT.** There is no runtime equivalent of
 * `ScenarioBuilder.spawnBuilding`; structures reach the world through
 * `Production`'s placement path, which wants a build queue, a placement legality
 * test and a player who can afford it. A `placeStructureDirect` is 1–2 days of
 * real work and NOTHING IN THE 37-OPERATION TABLE NEEDS IT: every premise that
 * looked like it did — a survey office to recover, a town's derricks to hold, a
 * yard that changes hands — is a structure that EXISTS IN THE LAYOUT and is
 * revealed, repaired or captured. Authoring it into the layout is also strictly
 * better content: the player can see the objective before it becomes one.
 *
 * **`setInvulnerable` — CUT.** The two escort operations are the only callers
 * it would ever have had, and an escort whose subject cannot die is not an
 * escort. What a designer actually wants from it — "the convoy must not die in
 * the first thirty seconds to a stray shell" — is bought by NOT SPAWNING THE
 * THREAT UNTIL THE FIRST CHECKPOINT, which `elapsed` and `unitsInArea` already
 * express, and by authoring the subject's hit points in the layout. An entity
 * flag that makes a fail condition unreachable for part of an operation is a
 * second, invisible copy of the trigger table.
 *
 * Also cut, with shorter reasons: **`setRoster` mid-operation** (the roster is
 * set at launch and changing it forces a `census`/`Production` re-derivation for
 * a premise nothing needs) and **`setAllyMask`** (checksum-visible, overlaps the
 * teams task, and belongs there or nowhere).
 *
 * ============================================================================
 * EVERY TIMER IS A TICK COUNT
 * ============================================================================
 * `minutes()` and `seconds()` live here and nobody hand-multiplies. The sim
 * runs at a fixed 30 Hz and an operation that measured time in seconds would be
 * measuring the render clock, which is the presentation-side read that makes a
 * replay diverge. `docs/RENDER_FINDINGS.md` is not the file that catches that;
 * `npm run replay-probe` is, and only in its second phase.
 * ========================================================================== */

import type { Faction } from '../core/types';

/* ==========================================================================
 * 1. CLOCKS
 * ========================================================================== */

/** Sim ticks per second. Mirrors the fixed step; never read the render clock. */
export const TICKS_PER_SECOND = 30;

/** Seconds to ticks. */
export function seconds(n: number): number {
  return Math.round(n * TICKS_PER_SECOND);
}

/** Minutes to ticks. Authored par times are the one place minutes appear. */
export function minutes(n: number): number {
  return Math.round(n * 60 * TICKS_PER_SECOND);
}

/* ==========================================================================
 * 2. WHAT AN OPERATION IS
 * ========================================================================== */

/**
 * The mechanical shape of an operation, declared on the row rather than left
 * to prose.
 *
 * IT IS A FIELD SO THAT IT CAN BE CHECKED. `validateCampaign` refuses two
 * adjacent operations in one chapter that share a `primaryType` — a chapter of
 * nine assaults is the failure mode a beat grid cannot see, and an
 * unresolvable value cannot be compared.
 */
export type PrimaryType =
  | 'assault'
  | 'defend'
  | 'capture-hold'
  | 'race'
  | 'landing'
  | 'infiltrate'
  | 'economy'
  | 'escort'
  | 'superweapon'
  | 'fixed-force'
  | 'assassination';

export const PRIMARY_TYPES: readonly PrimaryType[] = [
  'assault', 'defend', 'capture-hold', 'race', 'landing', 'infiltrate',
  'economy', 'escort', 'superweapon', 'fixed-force', 'assassination',
];

/**
 * How much of the engine an operation actually needs.
 *
 * THIS IS A CONTENT CONSTRAINT, NOT ONLY A COST MODEL. An archetype-A
 * operation's drama comes from the starting force and the ground, and that is a
 * bet that the SIMULATION is interesting — the bet this project has already won
 * everywhere else. An operation that reaches for a script because it has
 * nothing else is the one that will read as filler.
 */
export type Archetype =
  /** Posed skirmish. Fixed seeds, scripted starting force, win by annihilation. */
  | 'posed'
  /** Triggers READ ONLY. Effects are objective state and `endOperation`. */
  | 'conditional'
  /** One effect kind: `spawnUnits` + `orderTagged` at a declared tick. */
  | 'reinforced'
  /** Multiple effect kinds. Escort, convoy, multi-phase defence. */
  | 'bespoke';

/**
 * The opening. `'force'` is the campaign's own, and it is NOT added to
 * `START_CONDITIONS`.
 *
 * `START_CONDITIONS` is `['mcv','base']`, iterated by `resolveStartCondition`
 * and pinned by `tests/match-start.spec.ts`. Adding a third member puts a
 * "Fixed force" row in the SKIRMISH lobby, where nothing would ever call
 * `buildBaseFor` and the player would get an army with no way to build. Here
 * `'force'` is honoured by the layout simply not calling `buildBaseFor`, which
 * costs nothing and reaches no screen it should not.
 */
export type Opening = 'mcv' | 'base' | 'force';

/** Where an operation is fought. Everything the terrain generator needs. */
export interface OperationMap {
  /** A `MAP_PRESETS` key. No new preset ships in v1. */
  readonly preset: string;
  /** `?mapseed=` — the landform roll. Validated per operation by `campaign-maps`. */
  readonly mapSeed: number;
  /** `?seed=` — the scenario layout and every draw of `s.rng`. */
  readonly simSeed: number;
  /** Seats, human included. Bounded by the map's own arithmetic, not by taste. */
  readonly armies: number;
  /** `?biome=`. */
  readonly biome: string;
  readonly opening: Opening;
  /** The local player's bank at t=0. */
  readonly credits: number;
}

/**
 * What the player and the AI may build.
 *
 * BOTH LISTS NAME `UNLOCK_TAGS` IDS AND NOTHING ELSE. An operation may
 * restrict only TAGGED content — `UNLOCK_TAGS` is 33 defs across 10 tags and
 * every other def is day-one open. Withholding an untagged Barracks would mean
 * editing the one module CLAUDE.md describes as importing nothing, plus a
 * `census`/`Production` re-derivation at launch, for a premise nothing in the
 * operation table needs. `validateCampaign` refuses an unknown id, and no
 * briefing may claim otherwise.
 *
 * The two lists differ because ASYMMETRY IS THE POINT: "the enemy has Tesla
 * Coils and you do not, go around them" is a mission, and it is expressed here
 * rather than by a difficulty number.
 */
export interface OperationRoster {
  /** Unlock ids a HUMAN seat may build beyond the ungated day-one set. */
  readonly player: readonly string[];
  /** Unlock ids a NON-HUMAN seat may build. */
  readonly ai: readonly string[];
}

/**
 * Whether the shipped annihilation rules may end this operation.
 *
 * BOTH DEFAULT FALSE FOR A CAMPAIGN, AND THAT IS THE WHOLE POINT OF THE FIELD.
 * `Shell.pollOutcome` runs at 2 Hz for every match and, after a ten-second
 * grace, declares victory when every non-Neutral non-allied player has zero
 * living assets and defeat at zero local assets. Against a scripted operation
 * that produces four reachable failures, all in shipped code:
 *
 *   - an eight-minute hold, won at minute three;
 *   - a seat whose forces arrive at t+3 min, holding zero assets at t+10 s, so
 *     the player wins instantly against an enemy who has not arrived;
 *   - a commando insertion that lands at t+30 s, so the player is defeated at
 *     t+10 s for having no base;
 *   - a defecting militia, counted hostile forever.
 *
 * `ignoreSeats` is the fourth: a seat listed here is invisible to both tests,
 * which is how a neutral-turned-ally or a scripted third party stops deciding
 * the match.
 */
export interface OutcomePolicy {
  readonly annihilationWin: boolean;
  readonly assetLossDefeat: boolean;
  readonly ignoreSeats: readonly number[];
}

/** One objective row. At most three are ever published at once. */
export interface ObjectiveDef {
  readonly id: string;
  readonly kind: 'primary' | 'secondary';
  /** Player-facing. Imperative, present tense, no key names. */
  readonly title: string;
  /**
   * Paid on completion, in-match, through `Economy.grant`.
   *
   * SECONDARIES ONLY. Paying for the primary is paying for playing, and
   * `tests/campaign-wiring.spec.ts` refuses it. `grant` rather than `deposit`
   * because a scripted reward must never evaporate at a full silo; the
   * permanent `capFloor` lift is its accepted cost, and `oreWasted` is not
   * touched because that counter moves only for `CreditReason.Harvest`.
   */
  readonly credits?: number;
  /** Hidden until a `setObjective` effect reveals it. */
  readonly hidden?: boolean;
}

/* ==========================================================================
 * 3. GEOMETRY
 *
 * A disc, and only a disc. Rectangles, polygons and paths were all considered
 * and none of them buys a beat in the operation table that a disc does not; a
 * disc costs one squared-distance compare with no `sqrt`, which matters because
 * every area condition is evaluated every tick of every trigger that names one.
 * ========================================================================== */

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface Area {
  readonly x: number;
  readonly z: number;
  /** Metres. */
  readonly r: number;
}

/* ==========================================================================
 * 4. CONDITIONS — READ ONLY, ALWAYS
 *
 * Twelve predicates and three combinators. Nothing here may write, allocate a
 * closure, or reach outside `WorldQuery`.
 *
 * THE SIX VERBS A BRIEFING WANTS ARE ALL ALREADY HERE, and this is the merge
 * that mattered when four workstreams proposed four vocabularies:
 *
 *     reach          = unitsInArea
 *     protect        = entityDead -> failObjective
 *     holdFor        = unitsInArea + elapsedSinceArmed
 *     surviveUntil   = elapsed
 *     destroyTagged  = entityDead
 *     preserveTagged = entityHpBelow
 *
 * **No briefing may be authored against a verb that is not on this list.**
 * ========================================================================== */

/** What `ownerCount` is counting. */
export type CountRole =
  | 'any'
  | 'unit'
  | 'building'
  | 'producer'
  | 'harvester';

export const COUNT_ROLES: readonly CountRole[] = [
  'any', 'unit', 'building', 'producer', 'harvester',
];

export type Condition =
  /** Ticks since the operation began. */
  | { readonly on: 'elapsed'; readonly ticks: number }
  /**
   * Ticks since every OTHER condition on this trigger first became true, and
   * for as long as they have stayed true.
   *
   * THE HOLD TIMER, AND THE ONE CONDITION THAT IS NOT A PURE FUNCTION OF THE
   * WORLD. The director evaluates a trigger twice: once with every
   * `elapsedSinceArmed` forced true — that is the ARMING predicate, and its
   * result decides whether the trigger's arm tick is set or cleared — and then
   * once for real. So "hold three derricks for six minutes" is exactly
   * `all: [ownerCount(...), elapsedSinceArmed(minutes(6))]`, and losing a
   * derrick at minute five disarms and restarts the clock, which is what a
   * player expects and what a naive `elapsed` gets wrong.
   */
  | { readonly on: 'elapsedSinceArmed'; readonly ticks: number }
  /** At least one entity carrying `tag` is alive. */
  | { readonly on: 'entityAlive'; readonly tag: string }
  /**
   * No entity carrying `tag` is alive.
   *
   * TRUE BEFORE THE TAG EVER EXISTS, which is a real trap and the reason
   * `campaign-reachability.spec.ts` checks that every tag a condition names is
   * PRODUCED by that operation's layout. `entityDead: 'convoy'` on an operation
   * whose layout forgot the tag fails the player on tick one.
   */
  | { readonly on: 'entityDead'; readonly tag: string }
  /** The weakest live entity carrying `tag` is below `frac` of its maximum. */
  | { readonly on: 'entityHpBelow'; readonly tag: string; readonly frac: number }
  /** At least `min` of `player`'s units stand inside `area`. */
  | {
    readonly on: 'unitsInArea';
    readonly player: number;
    readonly area: Area;
    readonly min: number;
    /** Restrict the count to entities carrying this tag. */
    readonly tag?: string;
  }
  /** How much `player` owns. `min` and `max` are inclusive; give at least one. */
  | {
    readonly on: 'ownerCount';
    readonly player: number;
    readonly role: CountRole;
    readonly min?: number;
    readonly max?: number;
    readonly tag?: string;
  }
  /** The entity carrying `tag` is owned by `player` — capture, in one predicate. */
  | { readonly on: 'structureCaptured'; readonly tag: string; readonly player: number }
  | {
    readonly on: 'credits';
    readonly player: number;
    readonly min?: number;
    readonly max?: number;
  }
  /**
   * `Viability.isBeaten` for one seat: nothing to build with and nothing to
   * fight with. NOT "has no entities" — an operation that wants annihilation
   * should say `ownerCount: { role: 'any', max: 0 }` and mean it.
   */
  | { readonly on: 'playerBeaten'; readonly player: number }
  | { readonly on: 'objectiveComplete'; readonly id: string }
  | { readonly on: 'objectiveFailed'; readonly id: string }
  | { readonly on: 'all'; readonly of: readonly Condition[] }
  | { readonly on: 'any'; readonly of: readonly Condition[] }
  | { readonly on: 'not'; readonly of: Condition };

/** Every legal `Condition.on`. `validateCampaign` checks membership. */
export const CONDITION_KINDS: readonly string[] = [
  'elapsed', 'elapsedSinceArmed', 'entityAlive', 'entityDead', 'entityHpBelow',
  'unitsInArea', 'ownerCount', 'structureCaptured', 'credits', 'playerBeaten',
  'objectiveComplete', 'objectiveFailed',
  'all', 'any', 'not',
];

/* ==========================================================================
 * 5. EFFECTS — THE ONLY WRITES
 * ========================================================================== */

/** What `orderTagged` may ask for. A subset of `OrderKind`, deliberately. */
export type TaggedOrder = 'move' | 'attackMove' | 'stop' | 'guard';

export const TAGGED_ORDERS: readonly TaggedOrder[] = ['move', 'attackMove', 'stop', 'guard'];

export type Effect =
  /** Publish a hidden objective. Objectives without `hidden` start shown. */
  | { readonly do: 'setObjective'; readonly id: string }
  | { readonly do: 'completeObjective'; readonly id: string }
  | { readonly do: 'failObjective'; readonly id: string }
  /**
   * Put units on the ground. NOT through the command bus — through
   * `ProductionService.spawnUnit`, inside `simTick`, deterministically.
   *
   * **NO NEW `CommandKind`, AND `src/net/protocol.ts` IS NOT TOUCHED.**
   * `CommandKind` ends at `UsePower = 13` and holds nothing that creates an
   * entity. A wire-legal spawn command would travel to the relay, whose whole
   * contract is "stamps identity; the simulation enforces authority" — and the
   * sim has no authority test that would refuse a PvP client conjuring an army.
   *
   * `count` is a hard number and the sink COUNTS ITS FAILURES. `spawnUnit`
   * returns `NONE` on a missing `FALLBACK_UNITS` row and on an exhausted entity
   * budget, and both existing sim callers treat that as a silent `continue`.
   * A reinforcement wave that silently spawns nothing is the most plausible way
   * an operation becomes unwinnable with every test still green.
   */
  | {
    readonly do: 'spawnUnits';
    readonly player: number;
    /**
     * A `FALLBACK_UNITS` key, validated at import against the seat's faction.
     *
     * THAT SENTENCE WAS A PROMISE BEFORE IT WAS A FACT. `validateCampaign`
     * checked membership only, and the sink resolves through
     * `ProductionCatalog.byKey`, which is faction-blind — so an Allied
     * `grizzly` on seat 1 spawned an Allied hull in seat 1's colours whoever
     * seat 1 was. It is now checked against `faction` for seat 0 and `foe` for
     * every other seat; `Faction.Neutral` rows (engineer, harvester, mcv) pass
     * on any seat. The key is NOT remapped — see `runtime.ts#spawnUnits`.
     */
    readonly key: string;
    readonly count: number;
    readonly at: Point;
    /** Metres of scatter around `at`. Deterministic — drawn from `s.rng`. */
    readonly spread?: number;
    readonly facingDeg?: number;
    /** Tag every unit this spawns, so a later trigger can name them. */
    readonly tag?: string;
  }
  | {
    readonly do: 'orderTagged';
    readonly tag: string;
    readonly order: TaggedOrder;
    /** Required for `move` and `attackMove`; ignored by `stop`. */
    readonly at?: Point;
  }
  | { readonly do: 'grantCredits'; readonly player: number; readonly amount: number }
  | {
    readonly do: 'endOperation';
    readonly result: 'win' | 'loss';
    /**
     * An OBJECTIVE ID, never free prose. The end screen resolves it to that
     * objective's title so a loss says which one, and a string nobody can
     * resolve is a string nobody can translate or test.
     */
    readonly reason?: string;
  }
  | { readonly do: 'revealArea'; readonly player: number; readonly area: Area }
  /**
   * A line of in-mission dialogue.
   *
   * THE TEXT IS INLINE RATHER THAN A CORPUS KEY, and that is a deliberate
   * reversal of where the briefing prose lives. Briefings and debriefs are
   * ~450 words each and split into four lazily-imported chapter corpora;
   * in-mission dialogue is a handful of short lines per operation, so keying it
   * would buy about 8 kB and cost the import-time validator its ability to see
   * the text at all — the corpus is a DIFFERENT lazy chunk, so a missing key
   * could not be checked where every other authoring mistake is checked.
   */
  | { readonly do: 'dialogue'; readonly speaker: string; readonly text: string }
  /** An `EvaLine` id. Reuses the announcer that already exists. */
  | { readonly do: 'eva'; readonly line: string }
  | { readonly do: 'cameraMove'; readonly at: Point };

/** Every legal `Effect.do`. */
export const EFFECT_KINDS: readonly string[] = [
  'setObjective', 'completeObjective', 'failObjective', 'spawnUnits', 'orderTagged',
  'grantCredits', 'endOperation', 'revealArea', 'dialogue', 'eva', 'cameraMove',
];

/* ==========================================================================
 * 6. TRIGGERS
 * ========================================================================== */

export interface TriggerDef {
  /**
   * Stable within the operation. **SAVE STATE IS KEYED BY THIS STRING, NEVER
   * BY ARRAY INDEX** — reordering the triggers in an operation file must not
   * change what a save restores.
   */
  readonly id: string;
  readonly when: Condition;
  readonly then: readonly Effect[];
  /** Fire on every tick the condition holds, rather than once. Default false. */
  readonly repeat?: boolean;
}

/* ==========================================================================
 * 7. AN OPERATION, AND A CHAPTER OF THEM
 * ========================================================================== */

export interface OperationDef {
  /** `chapter.NN.slug`. Unique across the whole campaign. */
  readonly id: string;
  readonly chapter: string;
  readonly faction: Faction;
  /**
   * The army every NON-PLAYER seat is fought against. `faction`'s twin.
   *
   * **REQUIRED, WITH NO DEFAULT, AND THE DEFAULT IT REPLACES WAS THE SKIRMISH
   * LOBBY'S.** `Shell.startOperation` used to fill `opponents` from
   * `this.setup.aiFaction`, so `soviets.02.common-standard` — whose dialogue
   * says "Allied armour on the valley road" — was fought against the
   * Reclamation whenever that was the last row the player touched on the
   * skirmish screen. The player's army was authored; the enemy's was whatever
   * happened to be lying around.
   *
   * It is a FIELD rather than a convention for the same reason `primaryType`
   * is: an unresolvable value cannot be checked. `validateCampaign` refuses a
   * `spawnUnits` naming a hull that belongs to a different army than the seat
   * it spawns on, and that rule is only expressible because the seat's army is
   * declared. Without it, `t.dig`'s Allied `gi`/`grizzly` in `03-deep-sector`
   * and `t.plate`'s Soviet `conscript`/`rhino` in `01-sounding-line` are
   * assertions no gate can read.
   *
   * **NO DEFAULT, ON PURPOSE**, and this is the argument CLAUDE.md already
   * makes about `startPointsFor`'s seed parameter: a default silently
   * relabels every existing row from one meaning to another and only the row
   * that happens to break reports it. Every default available here is wrong
   * for three of the four armies, and a wrong-but-quiet foe is precisely the
   * defect this field exists to delete. Required means `tsc` names all five
   * operation files, and all 37 when they exist.
   *
   * A mirror match (`foe === faction`) is legal — the lobby offers one — and
   * `Faction.Neutral` is not: seat 1 would be Gaia, allied to everybody.
   */
  readonly foe: Faction;
  /** 1-based position within the chapter. */
  readonly index: number;
  readonly title: string;
  /** One line for the operation list. Not the briefing. */
  readonly beat: string;
  readonly primaryType: PrimaryType;
  readonly archetype: Archetype;
  /**
   * Authored par, in SECONDS of match time.
   *
   * `tests/campaign-length.spec.ts` asserts the sum clears the ten-hour claim.
   * This is the number that makes that claim falsifiable rather than
   * decorative, and it is authored BEFORE the operation is playable on purpose:
   * a par written afterwards is a description, not a target.
   */
  readonly parSec: number;
  /**
   * Operation ids that must be complete first. A graph edge, validated at
   * import for resolution, acyclicity and no forward reference.
   *
   * **THIS IS THE PRIMARY REWARD OF AN OPERATION AND IT IS NOT A `Reward`.**
   * The next operation unlocking has no `claimFor` branch and zero exposure to
   * `tests/reward-wiring.spec.ts` — which is exactly why it works, where
   * `credits` and `cosmetic` are both declared gaps in that file today.
   */
  readonly requires: readonly string[];
  readonly map: OperationMap;
  /** A key into `layouts/`. One module per operation. */
  readonly layout: string;
  readonly outcome: OutcomePolicy;
  readonly roster: OperationRoster;
  readonly objectives: readonly ObjectiveDef[];
  readonly triggers: readonly TriggerDef[];
}

export interface ChapterDef {
  /** `soviets`, `allies`, `pact`, `reclamation`. */
  readonly id: string;
  readonly faction: Faction;
  /** The campaign's own title — "Hold the Seam". */
  readonly title: string;
  readonly blurb: string;
  readonly operations: readonly OperationDef[];
}

/* ==========================================================================
 * 8. RUNTIME STATE
 *
 * Everything here is saved in `CHUNK_CMPN` and every map is keyed by a stable
 * string id.
 * ========================================================================== */

export type ObjectiveStatus = 'hidden' | 'active' | 'complete' | 'failed';

export interface OperationState {
  readonly operationId: string;
  /** Sim tick the operation began. Every `elapsed` is measured from here. */
  startTick: number;
  /** Trigger id to the tick its arming predicate first held. Absent = disarmed. */
  readonly armedAt: Map<string, number>;
  /** Trigger ids that have fired and are not `repeat`. */
  readonly fired: Set<string>;
  readonly objectives: Map<string, ObjectiveStatus>;
  /**
   * Objective ids whose `credits` have already been paid.
   *
   * SEPARATE FROM `complete`, AND THE SEPARATION IS THE ANTI-SAVE-SCUM RULE.
   * Completion is restored from the save; so is this. Reloading a save taken
   * before a paid secondary and completing it again must not pay twice.
   */
  readonly paid: Set<string>;
  outcome: 'won' | 'lost' | null;
  /** The objective id a loss names, or an empty string. */
  reason: string;
}

/** Bronze 1, silver 2, gold 3. Stored as the BEST ever earned, never lowered. */
export type Medal = 0 | 1 | 2 | 3;

/* ==========================================================================
 * 9. THE PORTS
 *
 * The Director is `(state, WorldQuery, tick, rng) -> Effect[]` and touches the
 * world through nothing but these two interfaces. That is what makes it
 * testable without an engine, and what makes "the Director read something
 * presentation-side" a compile error rather than a replay divergence found by
 * a probe two phases late.
 * ========================================================================== */

export interface WorldQuery {
  /** Live entities carrying `tag`. */
  aliveWithTag(tag: string): number;
  /** Lowest hp fraction among live entities carrying `tag`, or -1 if none. */
  weakestHpFrac(tag: string): number;
  /** Owner of the first live entity carrying `tag`, or -1. */
  ownerOfTag(tag: string): number;
  /** `player`'s units standing inside `area`, optionally restricted to `tag`. */
  unitsInArea(player: number, area: Area, tag: string | null): number;
  ownerCount(player: number, role: CountRole, tag: string | null): number;
  creditsOf(player: number): number;
  /** `Viability.isBeaten` for one seat. */
  isBeaten(player: number): boolean;
}

export interface SpawnReport {
  readonly asked: number;
  readonly placed: number;
}

export interface EffectSink {
  setObjective(id: string): void;
  completeObjective(id: string): void;
  failObjective(id: string): void;
  /** Returns what it actually managed to place. The caller MUST look. */
  spawnUnits(
    player: number, key: string, count: number, at: Point,
    spread: number, facingDeg: number, tag: string,
  ): SpawnReport;
  orderTagged(tag: string, order: TaggedOrder, at: Point | null): void;
  grantCredits(player: number, amount: number): void;
  endOperation(result: 'win' | 'loss', reason: string): void;
  revealArea(player: number, area: Area): void;
  dialogue(speaker: string, text: string): void;
  eva(line: string): void;
  cameraMove(at: Point): void;
}
