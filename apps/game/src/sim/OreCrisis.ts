/**
 * ============================================================================
 * VOLTMARCH — src/sim/OreCrisis.ts
 * ============================================================================
 * "IF MY ORE HARVESTER BEING SMASHED AND I DONT HAVE ANY MONEY LEFT.. HOW CAN
 *  I MAKE A PROGRESS?"
 *
 * The reported state: zero harvesters, zero credits, a refinery standing. No
 * income, so the bank never moves again; nothing on the sidebar is affordable,
 * so nothing can be clicked. The match is not lost — `Viability` says the
 * player can still rebuild and may still own an army — so `outcome.system.ts`
 * correctly refuses to end it. It simply never changes again.
 *
 * `Viability` answers "can this player still PLAY". This module answers the
 * question next to it, which nothing was asking: **can this player still
 * EARN?** The two are independent, and that is the whole point — a base full
 * of producers with no way to fund them passes every viability test in the
 * game.
 *
 * THE ARITHMETIC, WHICH IS THE FINDING
 * ------------------------------------
 * Selling exists (`Production.applySell`, the sidebar's sell tool) and returns
 * `SELL_REFUND` = 0.5 of build cost. A refinery costs 2000 and hands over a
 * free harvester (`BuildEntry.shipsWith`), so "sell something, rebuild the
 * refinery" looks like the escape. Measured against the real bound catalog it
 * usually is not, because the sell/rebuild loop is lossy at exactly 50% and
 * the two routes out are BOTH self-blocking:
 *
 *   Route V — buy a replacement harvester (1000 Meridian, 1150 Reclaim,
 *             1400 Allied/Soviet). Needs the refinery AND the vehicle factory
 *             standing, because both are its prereqs. So the two most valuable
 *             things you own are the two you may not sell.
 *   Route S — build a fresh refinery for 2000 and take the free harvester.
 *             Needs a Construction Yard and a power plant standing. Selling
 *             the old refinery pays 1000 of the 2000.
 *
 * Enumerated exhaustively over every subset of eight realistic base states x
 * four factions (`tests/ore-crisis.spec.ts`), the natural early-game state
 * — Construction Yard + power + refinery, no vehicle factory yet — is
 * UNRECOVERABLE for all four armies. Everything sellable adds up to 1150
 * (Allied) against a 2000 refinery, and there is no vehicle factory to buy a
 * harvester from at any price. So does the state with a war factory but no
 * yard: 1150 raisable against a 1400 harvester.
 *
 * That is a real dead end, not a discoverability problem, and it is reachable
 * without doing anything stupid.
 *
 * WARN FIRST, RESCUE SECOND
 * -------------------------
 * Which is why this is a THREE-valued predicate and not a boolean:
 *
 *   None      has a harvester, or one on the line, or the money for one.
 *   SellOut   broke and harvesterless, but the sell tool genuinely covers it —
 *             OR a captured derrick / ore mine is already banking toward a
 *             price this player's storage cap can hold (§2b, route M).
 *             Either way the player is not stuck; they did not know the verb
 *             existed. This state gets a HUD chip and an EVA line NAMING THE
 *             SELL TOOL and nothing else. Telling someone what to click is the
 *             entire fix, and it is the fix the user asked for.
 *   Stranded  broke and harvesterless, no sequence of sells reaches the price,
 *             and nothing on the map is paying them. Nothing the player can
 *             click changes the state, so a prompt would be a lie. This is the
 *             only state that gets help.
 *
 * `raisable` is what separates them, and it is computed per route: total
 * refund value of every finished sellable structure, MINUS the cheapest one
 * that has to stay standing to satisfy each of that route's prereqs and to
 * keep a factory for the tab. Keeping the cheapest satisfier maximises what
 * can be sold, so this is an upper bound on what the player could raise — and
 * an upper bound is the correct side to err on. Over-estimating `raisable`
 * biases toward `SellOut`, i.e. toward telling the player to solve it
 * themselves rather than toward handing them something.
 *
 * DETERMINISM AND LOCKSTEP
 * ------------------------
 * Nothing here reads a clock, an RNG, a profile or the DOM, and nothing here
 * writes. It is a read over the entity store and the production catalog into a
 * caller-supplied output object, so it is legal from `simTick`, from a render
 * frame and from a headless test, and it allocates nothing per call after the
 * first. Two clients running the same tick survey identically, which is what
 * lets `orecrisis.system.ts` act on `Stranded` as a SIM rule rather than a
 * local one.
 * ============================================================================
 */

import { BuildTab, EntityFlag, EntityKind, NONE } from '../core/types';
import type { DefTables, EntityId, PlayerId } from '../core/types';
import type { World } from '../core/world';
import { SELL_REFUND } from '../core/config';
/*
 * THE ONE IMPORT OUT OF `src/data`, AND IT IS DELIBERATE.
 *
 * `src/data/Defs.ts` says no file under `src/sim` imports `src/data`, and until
 * now `civilian.system.ts` was the only exception. The reason for the rule is
 * cycles, and `src/data/Civilians.ts` states in its own header that it IMPORTS
 * NOTHING precisely so that "a leaf with no imports at all cannot participate
 * in a cycle whoever picks it up". This is that case: a bare list of content
 * keys, no types, no behaviour.
 *
 * The alternative was worse in a specific way. This module can already tell a
 * captured neutral structure from an ordinary one — `prod.entryOf()` returns
 * null for anything with no `CONTENT` row — but that test does not separate
 * the two structures that PAY from the two that are firing positions, and
 * counting a captured hospital as income would deny the rescue to a player who
 * is genuinely stranded. That is the one direction this module must never err
 * in. See `countIncomeStructures`.
 */
import { CIVILIAN_INCOME_KEYS } from '../data/Civilians';

import type { BuildEntry, ProductionService } from './Production';

/* ==========================================================================
 * 1. THE VOCABULARY
 * ========================================================================== */

/** How badly this player's economy is stopped. See the header. */
export const enum OreCrisisState {
  /** Mining, or able to pay for a miner right now. Nothing to say. */
  None = 0,
  /** Broke and harvesterless, but selling covers it. Tell them the verb. */
  SellOut = 1,
  /** Broke, harvesterless, and no sequence of sells reaches the price. */
  Stranded = 2,
}

/**
 * One player's economic position, filled by `surveyOreCrisis`.
 *
 * `harvesterKey` / `refineryKey` are '' when the catalog has no such entry for
 * this army — a fallback boot with no content module is the normal way that
 * happens, and every consumer must treat it as "no opinion" rather than as a
 * crisis.
 */
export interface OreCrisisSurvey {
  player: number;
  state: OreCrisisState;
  /** Alive, not-pending-destroy harvesters. */
  harvesters: number;
  /** Harvesters already on a production line. A queued one is income coming. */
  queued: number;
  credits: number;

  /* -- route V: buy a replacement -------------------------------------- */
  harvesterKey: string;
  harvesterCost: number;
  /** Prereqs satisfied and a factory exists, i.e. money is the only blocker. */
  harvesterBuildable: boolean;
  /** Upper bound on credits reachable by selling, keeping route V's needs. */
  raisableForHarvester: number;

  /* -- route S: rebuild the refinery and take the free one -------------- */
  refineryKey: string;
  refineryCost: number;
  /** Finished refineries standing. Zero means route S needs a fresh one. */
  refineries: number;
  refineryBuildable: boolean;
  raisableForRefinery: number;

  /* -- route M: the map is already paying you --------------------------- */
  /**
   * Captured neutral structures this player holds that pay a credit trickle —
   * Oil Derricks and Ore Mines. See `countIncomeStructures`.
   */
  incomeStructures: number;
  /** Credits this player can hold at once. The reason income is not always a route. */
  storageMax: number;
}

export function makeOreCrisisSurvey(): OreCrisisSurvey {
  return {
    player: 0, state: OreCrisisState.None, harvesters: 0, queued: 0, credits: 0,
    harvesterKey: '', harvesterCost: 0, harvesterBuildable: false, raisableForHarvester: 0,
    refineryKey: '', refineryCost: 0, refineries: 0, refineryBuildable: false,
    raisableForRefinery: 0, incomeStructures: 0, storageMax: 0,
  };
}

/** What one structure pays out if sold. The same line `applySell` runs. */
export function refundOf(entry: BuildEntry): number {
  return Math.round(entry.cost * SELL_REFUND);
}

/* ==========================================================================
 * 2. THE REFINERY IS WHATEVER SHIPS A HARVESTER
 * ========================================================================== */

/**
 * The player's refinery entry, chosen by `shipsWith` rather than by key.
 *
 * A thin read of `ProductionCatalog.bundlerFor`, which is where the answer and
 * the argument for it now live — the roster-not-entries trap, and why this is
 * not a `Record<Faction, string>` table. It moved because a SECOND consumer
 * needed it and could not have it: `Production.redeemBundledUnit` was
 * delivering the REDEEMING STRUCTURE'S hauler, so a Pact player holding a
 * captured Allied refinery was rescued with an Allied harvester their Forgeyard
 * can never replace. A rule with two askers and one implementation cannot drift
 * apart; two implementations already had.
 *
 * Kept as a named function rather than inlined at its one call site because
 * this module's vocabulary is "refinery" and the catalog's is "bundler", and
 * the survey reads better in its own words.
 */
export function refineryEntryFor(prod: ProductionService, player: PlayerId): BuildEntry | null {
  const p = prod.world.players[player as number];
  if (p === undefined) return null;
  return prod.catalog.bundlerFor(p.faction);
}

/* ==========================================================================
 * 2b. ROUTE M — THE MAP IS ALREADY PAYING YOU
 *
 * A DEFECT THAT PREDATES THE ORE MINES AND WAS WIDENED BY THEM.
 *
 * This module's premise, stated at the top of the file, is "no income, so the
 * bank never moves again". That premise stopped being universally true the day
 * `src/data/Civilians.ts` shipped: a captured Oil Derrick pays 15 credits a
 * SECOND, so a broke, harvesterless player holding one banks a 1400-credit
 * harvester in 94 seconds without touching anything. Nothing here was looking,
 * so `orecrisis.system.ts` handed that player a free harvester after ten —
 * i.e. the rescue fired for a player who was never stuck. The ore mines make it
 * two structures and four positions on the map, which is why it is fixed here
 * rather than left as a known edge.
 *
 * WHAT COUNTS, AND WHY IT IS BY KEY. `prod.entryOf()` already answers "this is
 * a captured neutral structure" (no `CONTENT` row, so no catalog entry), and
 * that was the tempting test because it needs no import. It is WRONG in the one
 * direction that matters: two of the four civilian structures are firing
 * positions that pay nothing, and a player down to a captured hospital would
 * have been read as earning and denied the rescue they actually need. This
 * module's own header says over-estimation must bias toward SellOut — toward
 * telling the player to solve it themselves — but that argument is about the
 * SELL arithmetic, where the player really can act. Inventing income they do
 * not have is a different error and it has no defence.
 *
 * INCOME IS NOT AUTOMATICALLY A ROUTE, AND THE STORAGE CAP IS WHY.
 * `Economy.deposit` honours `PlayerState.storageMax` and throws the overflow
 * away. `BASE_STORAGE` is 1000 with no refinery standing, against a 1400-2000
 * refinery and a 1000-1400 harvester — so a player with a mine, a Construction
 * Yard and no refinery accrues to 1000 and then stops forever, and that IS the
 * dead end this module exists for. So the clause is per route and it tests the
 * CAP rather than the rate: income is a route only where the thing being bought
 * fits in the bank. Route V is safe by construction (a harvester's prereqs
 * include the refinery, whose `REFINERY_STORAGE` lifts the cap to 3000); route
 * S is the one that bites.
 *
 * IT DOWNGRADES TO `SellOut`, NOT TO `None`. The player is genuinely without a
 * miner and the chip that names the sell tool is still true and still the
 * fastest way out — selling reaches the price in seconds where the trickle
 * takes minutes. What they must not get is the free harvester.
 *
 * THE RATE IS DELIBERATELY NOT READ. Only the COUNT is. A rate would make this
 * a question about how long the wait is, and there is no honest threshold for
 * that — the difference between 94 seconds and 280 is a balance opinion, while
 * "the bank is rising toward a price it can hold" is a fact.
 * ========================================================================== */

/**
 * Def ids of the paying structures, resolved from the catalog's own bound
 * tables and cached against their identity.
 *
 * `bindingTables` is the same `DefTables` every other consumer reads and it is
 * installed once at boot, so this is a one-time map lookup per match rather
 * than a per-survey one — and `surveyOreCrisis` runs twice a second for every
 * player. Re-resolved whenever the identity changes, which is what makes a
 * headless test that swaps catalogs behave.
 */
let boundTables: DefTables | null = null;
const incomeDefIds: number[] = [];

function incomeDefIdsFor(prod: ProductionService): readonly number[] {
  const tables = prod.bindingTables;
  if (tables === null) {
    boundTables = null;
    incomeDefIds.length = 0;
    return incomeDefIds;
  }
  if (tables !== boundTables) {
    boundTables = tables;
    incomeDefIds.length = 0;
    for (let k = 0; k < CIVILIAN_INCOME_KEYS.length; k++) {
      const id = tables.buildingByKey.get(CIVILIAN_INCOME_KEYS[k]!);
      if (id !== undefined) incomeDefIds.push(id);
    }
  }
  return incomeDefIds;
}

/**
 * Paying structures `player` currently holds.
 *
 * Same four rejections `civilian.system.ts#payHolders` applies, in the same
 * order — dead, pending, unfinished, not yours — because a structure this
 * counts and that one does not pay would be exactly the wrong kind of
 * disagreement. It is a pure read and allocates nothing.
 */
export function countIncomeStructures(
  world: World, prod: ProductionService, player: PlayerId,
): number {
  const ids = incomeDefIdsFor(prod);
  if (ids.length === 0) return 0;
  const st = world.store;
  const owner = player as number;
  const list = st.byKind[EntityKind.Building];
  const count = st.byKindCount[EntityKind.Building];
  let held = 0;
  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
    const defId = st.defId[i];
    for (let k = 0; k < ids.length; k++) {
      if (ids[k] === defId) { held++; break; }
    }
  }
  return held;
}

/* ==========================================================================
 * 3. THE SURVEY
 * ========================================================================== */

/**
 * Count `player`'s economic position into `out`.
 *
 * The two `raisable` figures are the interesting half. Each starts from the
 * total refund value of every FINISHED, SELLABLE structure this player owns
 * and subtracts the cheapest structure that must stay standing for that route
 * — one satisfier per prereq key, plus one factory for the tab being bought
 * from. Under construction is excluded on both sides: `applySell` refunds a
 * half-built structure against `buildProgress`, so counting it at full value
 * would over-promise, and it is not yet satisfying anybody's prereq either.
 */
export function surveyOreCrisis(
  world: World,
  prod: ProductionService,
  player: PlayerId,
  out: OreCrisisSurvey,
): OreCrisisSurvey {
  const st = world.store;
  const owner = player as number;
  const p = world.players[owner];

  out.player = owner;
  out.state = OreCrisisState.None;
  out.harvesters = 0;
  out.queued = 0;
  out.credits = p?.credits ?? 0;
  out.harvesterKey = '';
  out.harvesterCost = 0;
  out.harvesterBuildable = false;
  out.raisableForHarvester = 0;
  out.refineryKey = '';
  out.refineryCost = 0;
  out.refineries = 0;
  out.refineryBuildable = false;
  out.raisableForRefinery = 0;
  out.incomeStructures = 0;
  out.storageMax = p?.storageMax ?? 0;
  if (p === undefined) return out;

  const refinery = refineryEntryFor(prod, player);
  if (refinery === null) return out;
  const harvester = prod.catalog.byKey(refinery.shipsWith);
  if (harvester === null) return out;

  out.refineryKey = refinery.key;
  out.refineryCost = refinery.cost;
  out.harvesterKey = harvester.key;
  out.harvesterCost = harvester.cost;

  /* -- 1. is anything mining, or about to be? -------------------------- */
  const dead = EntityFlag.PendingDestroy;
  const vlist = st.byKind[EntityKind.Vehicle];
  const vcount = st.byKindCount[EntityKind.Vehicle];
  for (let a = 0; a < vcount; a++) {
    const i = vlist[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0 || (f & dead) !== 0) continue;
    if ((f & EntityFlag.IsHarvester) !== 0) out.harvesters++;
  }
  // A harvester on the line is income arriving, so it ends the crisis exactly
  // as a live one does. Checked across EVERY tab rather than just Vehicles:
  // nothing stops a future army from training its miner somewhere else, and
  // an `onHold` item still counts — it is paid for and it will finish.
  for (let t = 0; t < p.queues.length; t++) {
    const items = p.queues[t].items;
    for (let k = 0; k < items.length; k++) {
      if (!items[k].isBuilding && items[k].defId === harvester.publicId) out.queued++;
    }
  }

  /* -- 2. what could be sold, per route -------------------------------- */
  measureRaisable(world, prod, player, harvester, refinery, out);
  out.incomeStructures = countIncomeStructures(world, prod, player);

  /* -- 3. can either route be walked right now? ------------------------ */
  const canBuyNow = out.harvesterBuildable && out.credits >= harvester.cost;
  const canRefineNow = out.refineryBuildable && out.credits >= refinery.cost;
  if (out.harvesters > 0 || out.queued > 0 || canBuyNow || canRefineNow) {
    out.state = OreCrisisState.None;
    return out;
  }

  const sellOutV = out.harvesterBuildable
    && out.credits + out.raisableForHarvester >= harvester.cost;
  const sellOutS = out.refineryBuildable
    && out.credits + out.raisableForRefinery >= refinery.cost;

  /* -- route M: a captured derrick or mine is already banking for them --
   * See §2b. The cap test is the whole subtlety: money that cannot fit in the
   * bank is not a route, and `BASE_STORAGE` (1000) is under every refinery
   * price in the game. */
  const incomeIsARoute = out.incomeStructures > 0
    && ((out.harvesterBuildable && out.storageMax >= harvester.cost)
      || (out.refineryBuildable && out.storageMax >= refinery.cost));

  out.state = sellOutV || sellOutS || incomeIsARoute
    ? OreCrisisState.SellOut
    : OreCrisisState.Stranded;
  return out;
}

/**
 * Pick one structure whose sale advances a real route out of `SellOut`.
 *
 * This is the command-side companion to `surveyOreCrisis`: the survey proves
 * that some sequence of sales can buy either a harvester (route V) or a new
 * refinery (route S), while this function names ONE safe next click. It never
 * sells a prerequisite or the factory the chosen route needs, and it asks for
 * only one structure so the caller must observe the resulting world before it
 * decides again. That is what prevents a queued burst of sales from destroying
 * a route that the first refund had already made affordable.
 *
 * The choice is intentionally conservative. Non-producing tech/defence is
 * spent before a refinery, and a refinery before a factory; within that least
 * damaging tier, use the smallest refund that closes the gap or otherwise the
 * largest refund that advances it. An income-only `SellOut` returns NONE — the
 * bank is already rising, so selling a base would be needless.
 *
 * The caller supplies `out` and this module reuses the same route sets as the
 * survey. No allocation, RNG, profile or local-player information is involved.
 */
export function oreCrisisSaleCandidate(
  world: World,
  prod: ProductionService,
  player: PlayerId,
  out: OreCrisisSurvey,
): EntityId {
  surveyOreCrisis(world, prod, player, out);
  if (out.state !== OreCrisisState.SellOut) return NONE;

  const canV = out.harvesterBuildable
    && out.credits + out.raisableForHarvester >= out.harvesterCost;
  const canS = out.refineryBuildable
    && out.credits + out.raisableForRefinery >= out.refineryCost;
  // Route M (captured-structure income) can produce SellOut by itself. Waiting
  // is already a complete recovery plan and costs no structure.
  if (!canV && !canS) return NONE;

  const needV = canV ? Math.max(0, out.harvesterCost - out.credits) : Number.POSITIVE_INFINITY;
  const needS = canS ? Math.max(0, out.refineryCost - out.credits) : Number.POSITIVE_INFINITY;
  const keep = needV <= needS ? keepV : keepS;
  const need = Math.min(needV, needS);
  if (!Number.isFinite(need) || need <= 0) return NONE;

  const st = world.store;
  const owner = player as number;
  const list = st.byKind[EntityKind.Building];
  const count = st.byKindCount[EntityKind.Building];
  let covering = NONE;
  let coveringRefund = Number.POSITIVE_INFINITY;
  let progress = NONE;
  let progressRefund = 0;
  let bestTier = Number.POSITIVE_INFINITY;

  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner || keep.has(i)) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
    if ((f & EntityFlag.Sellable) === 0) continue;
    const entry = prod.entryOf(st.handleOf(i));
    if (entry === null) continue;
    const refund = refundOf(entry);
    if (refund <= 0) continue;

    // Preserve production capacity whenever any non-producing structure can
    // advance the route. A refinery is the middle tier because losing one is
    // painful but still leaves the chosen route intact; a tab producer is the
    // last resort. This is content truth (`shipsWith` / `producesTabs`), not a
    // parallel AI role table.
    const tier = entry.producesTabs.length > 0 ? 2 : entry.shipsWith !== '' ? 1 : 0;
    if (tier > bestTier) continue;
    if (tier < bestTier) {
      bestTier = tier;
      covering = NONE;
      coveringRefund = Number.POSITIVE_INFINITY;
      progress = NONE;
      progressRefund = 0;
    }

    if (refund >= need) {
      if (refund < coveringRefund) {
        covering = st.handleOf(i);
        coveringRefund = refund;
      }
    } else if (covering === NONE && refund > progressRefund) {
      progress = st.handleOf(i);
      progressRefund = refund;
    }
  }

  return covering !== NONE ? covering : progress;
}

/**
 * Fill the two `raisable` figures and the two `buildable` flags.
 *
 * ONE PASS over the player's structures, accumulating three things at once:
 * the total refund pot, the cheapest structure standing against each prereq
 * key of each route, and the cheapest factory servicing each route's tab. The
 * kept set is then subtracted from the pot.
 *
 * A structure can be the cheapest satisfier of a prereq AND the cheapest
 * factory for the tab — a Construction Yard is both, for route S — so the
 * subtraction is over a DEDUPLICATED set of slots, not a sum of minima.
 * Subtracting the same yard twice would under-report `raisable` by 1500 and
 * push a recoverable player into `Stranded`, which is the direction that hands
 * out free harvesters.
 */
function measureRaisable(
  world: World,
  prod: ProductionService,
  player: PlayerId,
  harvester: BuildEntry,
  refinery: BuildEntry,
  out: OreCrisisSurvey,
): void {
  const st = world.store;
  const owner = player as number;

  let pot = 0;
  keepV.clear();
  keepS.clear();
  cheapest.clear();

  const blist = st.byKind[EntityKind.Building];
  const bcount = st.byKindCount[EntityKind.Building];
  let factoryV = -1, factoryVCost = 0;
  let factoryS = -1, factorySCost = 0;

  for (let a = 0; a < bcount; a++) {
    const i = blist[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
    const entry = prod.entryOf(st.handleOf(i));
    if (entry === null) continue;

    if (entry.key === refinery.key) out.refineries++;

    const value = (f & EntityFlag.Sellable) !== 0 ? refundOf(entry) : 0;
    pot += value;

    // Cheapest standing satisfier per content key. `applySell` charges the
    // same refund whatever the key, so "cheapest" is genuinely the one to
    // keep: it is the one whose loss from the pot costs least.
    const prev = cheapest.get(entry.key);
    if (prev === undefined || value < prev.value) cheapest.set(entry.key, { slot: i, value });

    if (entry.producesTabs.includes(harvester.tab)
      && (factoryV < 0 || value < factoryVCost)) { factoryV = i; factoryVCost = value; }
    if (entry.producesTabs.includes(BuildTab.Structures)
      && (factoryS < 0 || value < factorySCost)) { factoryS = i; factorySCost = value; }
  }

  /* -- route V: keep every harvester prereq, plus a vehicle factory ----- */
  let okV = factoryV >= 0;
  if (okV) keepV.add(factoryV);
  for (let k = 0; k < harvester.prereqs.length && okV; k++) {
    const hit = cheapest.get(harvester.prereqs[k]);
    if (hit === undefined) okV = false; else keepV.add(hit.slot);
  }
  out.harvesterBuildable = okV;
  out.raisableForHarvester = okV ? pot - keptValue(world, prod, keepV) : 0;

  /* -- route S: keep every refinery prereq, plus a structures factory --- */
  let okS = factoryS >= 0;
  if (okS) keepS.add(factoryS);
  for (let k = 0; k < refinery.prereqs.length && okS; k++) {
    const hit = cheapest.get(refinery.prereqs[k]);
    if (hit === undefined) okS = false; else keepS.add(hit.slot);
  }
  out.refineryBuildable = okS;
  out.raisableForRefinery = okS ? pot - keptValue(world, prod, keepS) : 0;
}

/** Refund value of a deduplicated set of slots. */
function keptValue(world: World, prod: ProductionService, slots: Set<number>): number {
  const st = world.store;
  let sum = 0;
  for (const slot of slots) {
    if ((st.flags[slot] & EntityFlag.Sellable) === 0) continue;
    const entry = prod.entryOf(st.handleOf(slot));
    if (entry !== null) sum += refundOf(entry);
  }
  return sum;
}

/* --------------------------------------------------------------------------
 * Module scratch. `surveyOreCrisis` runs a few times a second for every
 * player, so the working sets are hoisted and cleared rather than allocated —
 * the same rule every query path in `src/sim` follows. Not reentrant, which is
 * fine: nothing here yields and the sim is single-threaded.
 * ------------------------------------------------------------------------ */
const keepV = new Set<number>();
const keepS = new Set<number>();
const cheapest = new Map<string, { slot: number; value: number }>();
