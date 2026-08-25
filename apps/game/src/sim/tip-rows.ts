/**
 * ============================================================================
 * VOLTMARCH — src/sim/tip-rows.ts
 * ============================================================================
 * THE SITUATIONAL TIP CORPUS. Seven rows, each a PAIR OF PREDICATES.
 *
 * `src/sim/tips.system.ts` is the director; this file is everything it says.
 * Read that module's header first — the phase, the `?shot=` immunity, the
 * settings inversion, the suppression set and `postTip`'s gate stack all live
 * there and none of it is restated here.
 *
 * ── A ROW IS TWO PREDICATES, AND THE SECOND IS THE EXPENSIVE HALF ───────────
 * `situation` says *the player is in this state*. `answered` says *and they
 * have not already dealt with it*. Those are different questions and the
 * brownout row is why we know: a player who reacts to the very first "Low
 * power" chip is STILL HOLDING an unplaced Power Plant fifteen seconds later,
 * because `BuildQueue.advanceTab` divides `buildTime` by `buildSpeedMul` and
 * `PowerGrid` drives that toward `POWER_BLACKOUT_MUL` — the shortage that
 * caused the brownout is what slows the cure. Measured in the engine in
 * `tests/tips-brownout.spec.ts` §3.
 *
 * **A ROW WITHOUT A REAL `answered` IS NOT A ROW.** Where the cure has no
 * latency the two predicates COLLAPSE — "your harvester is parked" stops being
 * true the instant the player right-clicks ore, so `answered` would be the
 * complement of `situation` and the pair would be one predicate wearing two
 * names. Three candidates were cut on exactly that test and are named at the
 * bottom of this header so nobody re-derives them.
 *
 * Every `answered` here is therefore the same shape: SOMETHING IS ALREADY PAID
 * FOR AND ON ITS WAY. `answering()` is that walk — the tab's queue plus the
 * structures that have left the queue and are still rising — and it is one
 * function so seven rows cannot disagree about what "on its way" means.
 *
 * ── AND A THIRD TEST ON THE SITUATION: `offered()` ──────────────────────────
 * A tip that names a purchase must not name one the player cannot make. Every
 * structural row folds `offered()` into its SITUATION: at least one catalog
 * entry matching the row must be `availabilityOf().ok` AND affordable right
 * now. That is what keeps the Repair Depot row silent on a profile that has
 * not earned `struct.support`, and the Command Post row silent before the
 * radar tier — without this file knowing either fact, because
 * `availabilityOf` already owns both.
 *
 * **THE BROWNOUT ROW DELIBERATELY DOES NOT USE IT.** It shipped in Commit 2
 * and its behaviour is pinned by 33 cases; adding a gate would change it. A
 * power plant is ungated in all four armies anyway, so the check would only
 * ever refuse a player who cannot afford one — and that player still needs to
 * be told what is happening to their defences.
 *
 * ── EVERY CLAIM IS CHECKABLE AGAINST SHIPPED CODE ──────────────────────────
 * The corpus survey spot-checked six candidate tips and THREE were
 * measurably wrong about their own facts. Two mechanisms answer that. The
 * digit ban (`tests/loading-tips.spec.ts`) deletes the arithmetic class by
 * construction. `tests/tips-corpus.spec.ts` §1 re-derives the ORDERING and
 * STRUCTURE class from the live tables — `POWER_SHED_ORDER`, `factorySpeed`,
 * `producesTabs`, `BuildEntry.storage`, `DEPOT_KEYS` — so a retune fails there
 * rather than turning shipped copy into a lie.
 *
 * ── NO DIGITS, NO KEY NAMES, AND TWO UNEQUAL LENGTH BUDGETS ────────────────
 * The chip holds **26 characters of title and 44 of detail**, measured in
 * Chromium rather than derived from the CSS (`tests/tips-brownout.spec.ts`
 * §4). The title inherits `text-transform: uppercase`, weight 600 and 0.18em
 * of tracking; the detail is as authored. Reasoning from the box width alone
 * gives one number for both and ships a clipped title past a green test.
 *
 * THE DETAIL LEADS WITH A VERB. `orecrisis.system.ts` earned that instruction:
 * its first chip put the whole instruction past the ellipsis, and a live
 * capture is what found it.
 *
 * ── THE ROWS LOAD EAGERLY, AND THE GATE IS THE PRICE ───────────────────────
 * `src/game/Systems.ts` globs `*.system.ts` with `eager: true` FROM THE ENTRY
 * CHUNK, so this module is in `index-*.js` for every player who opens the main
 * menu and quits. That is a DECISION, not an oversight, and the alternative
 * was costed: `postTip` runs inside `simTick`, where a dynamic `import()`
 * cannot be awaited, so a lazily chunked corpus arrives one or more ticks
 * after the tip was decided and "the corpus had not arrived" becomes a SILENT
 * NO-TIP. Buying a silent-failure mode to save well under a kilobyte against a
 * 2.7 MB entry chunk is a bad trade.
 *
 * **`tests/tips-corpus-weight.spec.ts` IS WHAT MAKES THAT LEGAL.** It caps the
 * authored copy at 1024 bytes (this commit: 477) and this module's
 * comment-stripped code at 10 240 (this commit: 6 777), and its failure message
 * names the lazy route. Both caps bite at about fifteen rows.
 * `src/shell/tutorial-steps.ts` is the declared leak nobody wants repeated —
 * 5 511 bytes of authored prose inside 17 162 bytes of stripped code, in the
 * entry chunk today. When this corpus trips either cap, MOVE IT; do not raise
 * the number.
 *
 * ── WHAT WAS CUT, AND WHY, SO NOBODY RE-DERIVES IT ─────────────────────────
 *   - **"A stopped harvester stays stopped."** True and surprising —
 *     `OrderKind.Stop` standing in the column IS the park marker for a miner,
 *     see §ANCHOR in `sim/Harvesting.ts` — and the pair COLLAPSES. There is no
 *     in-flight cure to detect: the order changes on the click.
 *   - **"Worked ore grows back."** Same collapse, plus it overlaps
 *     `EvaLine.HarvesterIdle`, which the HUD already toasts by name.
 *   - **"You have no radar."** The situation fires DURING A BROWNOUT, because
 *     `PlayerState.hasRadar` requires a POWERED dome and `POWER_SHED_ORDER`
 *     darkens radar early — so the row would talk over the brownout row about
 *     a symptom of it. `EvaLine.RadarOffline` already exists for the real
 *     event.
 *   - **"The enemy has aircraft and you have no dedicated anti-air."** The
 *     situation is a read of ENEMY state, and answering it before the player
 *     has scouted is a map hack wearing a tip's clothes.
 * ============================================================================
 */

import { BuildTab, EntityFlag, EntityKind } from '../core/types';
import type { AvailabilityResult, PlayerState } from '../core/types';
import type { World } from '../core/world';
import { BURN_HP_THRESHOLD } from '../core/config';

import type { BuildEntry, ProductionService } from './Production';
import { DEPOT_KEYS, repairSellService } from './RepairSell';

/* ==========================================================================
 * 1. SHAPES
 * ========================================================================== */

/** What reaches the chip. Two lines because the chip is two lines. */
export interface Tip {
  /** Toast dedupe key AND persisted mute key. Prefixed `tip.` at the surface. */
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Everything a predicate may read.
 *
 * DELIBERATELY NOT THE TICK. Every row's sense of time is its `holdTicks`,
 * counted by the director, and a predicate that could read the clock would be
 * one `s.tick % n` away from being a second scheduler nobody can see. If a row
 * ever genuinely needs elapsed match time, add it here with an argument.
 */
export interface TipContext {
  readonly world: World;
  readonly prod: ProductionService;
  /** Always the LOCAL player. Nothing here ever reads another seat. */
  readonly player: PlayerState;
}

export interface TipRow extends Tip {
  /**
   * Ticks the SITUATION must hold CONTINUOUSLY before the tip is offered.
   * A multiple of `TIP_SURVEY_INTERVAL`, or the count can never reach it.
   */
  readonly holdTicks: number;
  /** Is the player in this state right now? */
  situation(c: TipContext): boolean;
  /** Have they already got the answer under way? True means STAY QUIET. */
  answered(c: TipContext): boolean;
}

/** A test over one catalog entry. The unit every helper below is written in. */
type EntryMatch = (e: BuildEntry) => boolean;

/* ==========================================================================
 * 2. THE THREE SHARED WALKS
 *
 * One definition each, because seven rows must not come to disagree about
 * what "already on its way" means.
 * ========================================================================== */

/**
 * Reused scratch for `availabilityOf`, which takes an out-parameter precisely
 * so its callers do not allocate. This module runs twice a second inside
 * `simTick`; the frame loop's zero-allocation rule is the house standard and
 * there is no reason to be the exception.
 */
const avail: AvailabilityResult = { ok: false, reason: '', capped: false };

/**
 * Is something matching `want` ALREADY PAID FOR AND ON ITS WAY?
 *
 * TWO PASSES, AND BOTH ARE NEEDED. A queued item stays in `q.items` until
 * `completeHead`, which is called when the structure is PLANTED — so "finished
 * and being dragged onto the ground" is in the first pass, which is the
 * reported failure case verbatim. The second covers `CONSTRUCTION_RISE_SECONDS`
 * of rising, during which the structure is out of the queue and not yet doing
 * its job.
 *
 * `tab` is the queue to read. It is `Structures` for every row that recommends
 * a building and `Powers` for the one that recommends a purchase, because
 * `BuildTab` indexes `PlayerState.queues` and a commander power is drip-paid
 * through its own.
 */
export function answering(c: TipContext, tab: BuildTab, want: EntryMatch): boolean {
  const q = c.player.queues[tab as number];
  if (q !== undefined) {
    for (let i = 0; i < q.items.length; i++) {
      const item = q.items[i];
      const entry = c.prod.catalog.resolve(item.defId, item.isBuilding);
      if (entry !== null && want(entry)) return true;
    }
  }
  if (tab !== BuildTab.Structures) return false;
  return walkBuildings(c, want, true);
}

/** Does a FINISHED, undamaged-by-death structure matching `want` stand? */
export function ownsFinished(c: TipContext, want: EntryMatch): boolean {
  return walkBuildings(c, want, false);
}

/**
 * One walk over this player's structures, filtered on whether they are still
 * going up. `rising: true` wants `UnderConstruction` set; `false` wants it
 * clear. Written once so the flag tests cannot drift between the two callers.
 */
function walkBuildings(c: TipContext, want: EntryMatch, rising: boolean): boolean {
  const st = c.world.store;
  const list = st.byKind[EntityKind.Building];
  const count = st.byKindCount[EntityKind.Building];
  const owner = c.player.id as number;
  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & EntityFlag.PendingDestroy) !== 0) continue;
    if (((f & EntityFlag.UnderConstruction) !== 0) !== rising) continue;
    const entry = c.prod.entryOf(st.handleOf(i));
    if (entry !== null && want(entry)) return true;
  }
  return false;
}

/**
 * Could the player buy something matching `want` RIGHT NOW?
 *
 * `availabilityOf` is the whole answer and this function adds exactly one
 * thing to it: the price. That is not tidiness — it is the difference between
 * a tip and a taunt. `availabilityOf` already resolves the faction, the
 * progression gate (`isBuildable`, against the SAME profile the AI resolves
 * against), the prereq chain, whether a producing structure is standing AND
 * LIT, and the hero cap. Every one of those is a reason a tip naming a
 * purchase would be wrong, and none of them is restated here.
 */
export function offered(c: TipContext, want: EntryMatch): boolean {
  const entries = c.prod.catalog.entries;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!want(e)) continue;
    if (e.cost > c.player.credits) continue;
    if (c.prod.availabilityOf(c.player.id, e, avail).ok) return true;
  }
  return false;
}

/* ==========================================================================
 * 3. THE MATCHES
 *
 * Named rather than inlined so `tests/tips-corpus.spec.ts` can run each one
 * over the real catalog and say WHICH entries it selects. A predicate that
 * silently selects nothing is a row that never fires, and that is the failure
 * mode this corpus cannot see from the inside.
 * ========================================================================== */

/** Generates power. The route out of a brownout. */
export const isPowerSource: EntryMatch = (e) => e.power > 0;
/** Raises the credit ceiling: a silo, and also a refinery. */
export const isStorage: EntryMatch = (e) => e.storage > 0;
/** The one structure per army that publishes `BuildTab.Powers`. */
export const isPowerHouse: EntryMatch = (e) => e.producesTabs.includes(BuildTab.Powers);
/** A commander power itself. Nothing else lives in that tab. */
export const isCommanderPower: EntryMatch = (e) => e.tab === BuildTab.Powers;
/** A Repair Depot, by the same three keys `RepairSell` services vehicles from. */
export const isDepot: EntryMatch = (e) => DEPOT_KEYS.includes(e.key);
/** Services `tab`'s queue — a second Barracks, War Factory or Naval Yard. */
function servicesTab(tab: BuildTab): EntryMatch {
  return (e) => e.producesTabs.includes(tab);
}

/* ==========================================================================
 * 4. SMALL WORLD READS
 * ========================================================================== */

/**
 * Does this player own a live thing of `kind` under the burning threshold?
 *
 * `BURN_HP_THRESHOLD` IS BORROWED RATHER THAN INVENTED, and that is the point.
 * The simulation has already decided what "in trouble" means: `Damage.applyOne`
 * sets `EntityFlag.Burning` at or below this fraction. Picking a second number
 * here would be a private opinion about damage sitting beside the engine's
 * public one, and the two would drift.
 */
function ownsHurt(c: TipContext, kind: EntityKind, includeRising: boolean): boolean {
  const st = c.world.store;
  const list = st.byKind[kind];
  const count = st.byKindCount[kind];
  const owner = c.player.id as number;
  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & EntityFlag.PendingDestroy) !== 0) continue;
    // A half-built structure is BELOW the threshold by construction —
    // `spawnBuilding` starts it at `PRODUCTION.buildingStartHpFrac` — so a
    // building site would read as a base in flames. Nothing else in the game
    // carries this flag, which is why the vehicle caller passes `true`.
    if (!includeRising && (f & EntityFlag.UnderConstruction) !== 0) continue;
    const max = st.maxHp[i];
    if (max > 0 && st.hp[i] / max <= BURN_HP_THRESHOLD) return true;
  }
  return false;
}

/** Is anything this player owns being mended by the wrench right now? */
function mending(c: TipContext): boolean {
  const svc = repairSellService();
  // A NULL SERVICE IS A REFUSAL, NOT A PASS — `answeringPower`'s rule, kept.
  // With no service we cannot tell whether the player is already answering,
  // and speaking over them is the failure the second predicate exists to
  // prevent. `true` here means STAY QUIET.
  if (svc === null) return true;
  const st = c.world.store;
  const list = st.byKind[EntityKind.Building];
  const count = st.byKindCount[EntityKind.Building];
  const owner = c.player.id as number;
  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner) continue;
    if ((st.flags[i] & EntityFlag.Alive) === 0) continue;
    if (svc.isRepairing(st.handleOf(i))) return true;
  }
  return false;
}

/* ==========================================================================
 * 5. THE CORPUS
 *
 * Seven rows. `holdTicks` is a multiple of `TIP_SURVEY_INTERVAL` (15) and the
 * value is an editorial judgement about NAGGING, not a measurement: fifteen
 * seconds for a state the player is losing something to every second of, two
 * minutes for one they have simply never got round to.
 * ========================================================================== */

/** Fifteen seconds. */
const SOON = 450;
/** Thirty seconds. */
const SETTLED = 900;
/** One minute. */
const PATIENT = 1800;
/** Two minutes. A nudge, not an alarm. */
const STRATEGIC = 3600;

/**
 * THE BROWNOUT. Shipped in Commit 2 and pinned by 33 cases in
 * `tests/tips-brownout.spec.ts`; its behaviour is unchanged by this file's
 * existence and must stay that way.
 *
 * Both halves check out. `POWER_SHED_ORDER.defence` is 0 and `.refinery` is 4,
 * so defences are the FIRST class `PowerGrid.shed` darkens. And `shedPriority`
 * answers `never` for `EntityFlag.IsBuilder`, so the Construction Yard cannot
 * be darkened and `Production.census` exempts the Structures tab from the
 * blackout gate — the route out is open by construction, however deep the
 * hole, which is exactly what the detail line promises.
 */
export const TIP_BROWNOUT: TipRow = {
  key: 'brownout',
  title: 'Defences go dark first',
  detail: 'Build a power plant to bring them back',
  holdTicks: SOON,
  // The identical expression `Production.ts` writes into `HudSnapshot.brownout`,
  // read off the same `PlayerState` fields `PowerGrid` wrote this tick.
  situation: (c) => c.player.powerConsumed > c.player.powerProduced,
  answered: (c) => answering(c, BuildTab.Structures, isPowerSource),
};

/**
 * ORE OVER THE CAP IS LOST. `Economy.deposit` WASTES the overflow rather than
 * clamping it — the loss is counted into `stats.oreWasted`, `CreditReason.Waste`
 * goes on the wire and `EvaLine.SiloNeeded` fires. A silo raises `storageMax`;
 * so does a refinery, which is why the match is `storage > 0` and not a key.
 *
 * `oreWasted > 0` IS LOAD-BEARING AND IS NOT DECORATION ON `credits >=
 * storageMax`. `Economy.refund` lifts the cap floor to cover any balance that
 * arrived without passing a cap check — the opening bank, a bounty, a
 * cancelled build — so `credits === storageMax` EXACTLY is the ordinary state
 * of a player who has just cancelled something, and of every player at tick
 * zero. Without this clause the row would fire on a match that has not started.
 */
export const TIP_ORE_CAP: TipRow = {
  key: 'oreCap',
  title: 'Ore over the cap is lost',
  detail: 'Build a silo to raise your storage',
  holdTicks: SOON,
  situation: (c) => c.player.stats.oreWasted > 0
    && c.player.credits >= c.player.storageMax
    && offered(c, isStorage),
  answered: (c) => answering(c, BuildTab.Structures, isStorage),
};

/**
 * TWO FACTORIES, ONE QUEUE. `BuildTab` indexes `PlayerState.queues`, so an army
 * has ONE vehicle queue however many War Factories it owns; what a second one
 * buys is `factorySpeed(2)`, which is `1 + FACTORY_SPEED_BONUS` against a
 * `FACTORY_SPEED_CAP`. That is genuinely wrong-guessable — the shape every
 * other game in the genre uses is one queue per building.
 *
 * `factoryCount === 1` EXACTLY, not `<= 1`. Zero is a different situation with
 * a different answer ("you have no War Factory"), and `availabilityOf` already
 * refuses that case with "Requires a production structure" on the cameo the
 * player is looking at.
 */
export const TIP_ONE_FACTORY: TipRow = {
  key: 'oneFactory',
  title: 'Two factories, one queue',
  detail: 'Build a second one to speed the line',
  holdTicks: SETTLED,
  situation: (c) => backedUpTab(c) >= 0,
  answered: (c) => {
    const tab = backedUpTab(c);
    return tab < 0 || answering(c, BuildTab.Structures, servicesTab(tab as BuildTab));
  },
};

/**
 * The unit tab that is backed up behind a single producer and could have a
 * second one, or -1 when there is none.
 *
 * TWO TABS ONLY. `Structures` and `Defense` are both published by the
 * Construction Yard, and a second Yard is not a thing a player builds to go
 * faster. `Powers` has its own row.
 */
function backedUpTab(c: TipContext): number {
  const tabs: readonly BuildTab[] = [BuildTab.Infantry, BuildTab.Vehicles];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const q = c.player.queues[tab as number];
    if (q === undefined || q.factoryCount !== 1) continue;
    // Something waiting BEHIND the head. One item is a queue doing its job.
    if (q.items.length < 2) continue;
    if (!offered(c, servicesTab(tab))) continue;
    return tab as number;
  }
  return -1;
}

/**
 * SUPPORT POWERS ARE BOUGHT. The Command Post / Pharos / Signal Rig is the
 * ONLY thing in the game that declares `producesTabs: [BuildTab.Powers]`, and
 * that tab is the only route to a commander power — `availabilityOf` refuses
 * every power with "Requires a production structure" while none stands. It is
 * a real decision at -80 power, the third-heaviest draw in the game.
 *
 * THE COPY NAMES NO BUILDING, DELIBERATELY. Three defs cover four armies and
 * two of them are not called a Post. `orecrisis.system.ts` can say "the SELL
 * tool" because there is one; there is no one name for this.
 *
 * TWO MINUTES, THE LONGEST HOLD IN THE CORPUS. Everything else here is
 * something going wrong; this is something never started. A player who has had
 * the radar tier and the money for two minutes and has not opened the tab has
 * not overlooked it for a moment — they do not know it exists.
 */
export const TIP_COMMAND_POST: TipRow = {
  key: 'commandPost',
  title: 'Support powers are bought',
  detail: 'Build the structure that opens their tab',
  holdTicks: STRATEGIC,
  situation: (c) => c.player.commanderPowerMask === 0
    && !ownsFinished(c, isPowerHouse)
    && offered(c, isPowerHouse),
  answered: (c) => answering(c, BuildTab.Structures, isPowerHouse),
};

/**
 * POWERS COST CREDITS TOO. The structure opens the tab and buys nothing: each
 * power is a `BuildKind.Power` entry with its own `cost`, drip-paid through
 * `PlayerState.queues[BuildTab.Powers]` and leaving a bit in
 * `commanderPowerMask`.
 *
 * NOT A HYPOTHETICAL FAILURE. `CLAUDE.md` records the AI doing exactly this:
 * Normal paid 1500 credits and 80 power for a Post and then bought nothing for
 * sixteen minutes.
 *
 * The answered predicate reads the POWERS queue, not the Structures one —
 * that is the whole reason `answering` takes a tab.
 */
export const TIP_POWERS_IDLE: TipRow = {
  key: 'powersIdle',
  title: 'Powers cost credits too',
  detail: 'Buy one from the Powers tab',
  holdTicks: PATIENT,
  situation: (c) => c.player.commanderPowerMask === 0
    && ownsFinished(c, isPowerHouse)
    && offered(c, isCommanderPower),
  answered: (c) => answering(c, BuildTab.Powers, isCommanderPower),
};

/**
 * BUILDINGS CAN BE MENDED, AND IT IS NOT FREE. `RepairSell` drips
 * `REPAIR_RATE` hp a second and charges `REPAIR_COST_PER_HP` for every point,
 * cancelling itself when the owner goes broke. "It costs credits" is the half
 * a player guesses wrong, and it is why the situation requires a bank at all:
 * telling somebody with nothing to arm the wrench is telling them to watch it
 * switch itself off.
 *
 * THE ANSWERED PREDICATE IS THE WRENCH ITSELF, not a queue. `isRepairing` is
 * the flag `RepairSell.tickRepairs` clears at full health and on going broke,
 * so it is true for exactly as long as the answer is under way.
 */
export const TIP_REPAIR_TOOL: TipRow = {
  key: 'repairTool',
  title: 'Buildings can be mended',
  detail: 'Use the repair tool — it costs credits',
  holdTicks: SETTLED,
  situation: (c) => c.player.credits > 0 && ownsHurt(c, EntityKind.Building, false),
  answered: (c) => mending(c),
};

/**
 * ARMOUR MENDS AT A DEPOT. A different mechanism from the wrench and worth its
 * own row for that reason: the depot services vehicles automatically inside
 * `REPAIR_DEPOT.radius` of its centre, up to `maxConcurrent` at once, and it
 * stops when the pad is dark. Nothing repairs a hull without one.
 *
 * `DEPOT_KEYS` IS IMPORTED, NOT RESTATED. It is the same three keys
 * `RepairSell` resolves its depot def ids from, so a fourth army's depot
 * cannot arrive on one side of this and not the other. The three-for-four
 * shape is the `Faction.Neutral` one: `repairDepot` covers the two original
 * armies.
 *
 * `offered()` IS DOING REAL WORK HERE. All three depots sit behind
 * `struct.support`, so on a fresh profile this row is silent — without the
 * check it would tell a player to build something their sidebar shows as
 * "Locked".
 */
export const TIP_REPAIR_DEPOT: TipRow = {
  key: 'repairDepot',
  title: 'Armour mends at a depot',
  detail: 'Build one and park hulls beside it',
  holdTicks: SETTLED,
  situation: (c) => ownsHurt(c, EntityKind.Vehicle, true)
    && !ownsFinished(c, isDepot)
    && offered(c, isDepot),
  answered: (c) => answering(c, BuildTab.Structures, isDepot),
};

/**
 * THE TABLE. Order is evaluation order, and the director shows AT MOST ONE tip
 * per survey, so a row early in this list wins a genuine tie. Ordered by how
 * much the player is losing per second while the state holds: power, then ore,
 * then throughput, then hardware they are not using, then damage that is
 * merely expensive.
 */
export const TIP_ROWS: readonly TipRow[] = [
  TIP_BROWNOUT,
  TIP_ORE_CAP,
  TIP_ONE_FACTORY,
  TIP_REPAIR_TOOL,
  TIP_REPAIR_DEPOT,
  TIP_COMMAND_POST,
  TIP_POWERS_IDLE,
];
