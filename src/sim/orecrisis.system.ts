/**
 * ============================================================================
 * VOLTMARCH — src/sim/orecrisis.system.ts
 * ============================================================================
 * TELLS A BROKE, HARVESTERLESS PLAYER WHAT TO CLICK — AND, WHEN THERE IS
 * GENUINELY NOTHING TO CLICK, HONOURS THE REFINERY'S OWN PROMISE.
 *
 * `OreCrisis.ts` holds the arithmetic and the three-valued predicate; read its
 * header first. This file is the two consequences:
 *
 *   SellOut   -> a HUD chip and `EvaLine.NoOreMiner`, naming the sell tool.
 *                LOCAL PLAYER ONLY, and nothing about the world changes. An
 *                AI does not need to be told; it needs to be able to act, and
 *                it already sells nothing.
 *   Stranded  -> after `RESCUE_DELAY_TICKS`, one standing refinery redeems its
 *                `shipsWith` harvester. EVERY player, human and AI, because
 *                this one moves entities and a rule that bound only the human
 *                would be a balance change and — in a lockstep match — a
 *                desync.
 *
 * WHY THE RESCUE IS NOT FREE MONEY, STATED PLAINLY
 * ------------------------------------------------
 * It IS a free harvester, and pretending otherwise would be the dishonest
 * version of this comment. What makes it defensible is the gate, which is
 * four separate facts that must hold TOGETHER:
 *
 *   1. zero harvesters alive and zero on any production line;
 *   2. not enough credits for one;
 *   3. `raisable` says no sequence of sells reaches the price either — this is
 *      the clause that does the work, and it is measured, not assumed;
 *   4. A FINISHED REFINERY IS STANDING.
 *
 * (4) is the counter-play and the reason this does not delete harvester
 * harassment as a strategy. Killing the miner still costs the victim every
 * second of mining it would have done and every credit it was carrying; what
 * it no longer does is end the session with a frozen screen and no defeat.
 * An opponent who wants to starve someone out kills the REFINERY, which is
 * the correct economic target in every game in this genre and is exactly the
 * structure the promise hangs off.
 *
 * It cannot be farmed. To collect twice a player must return to state (1)-(3),
 * which means losing the replacement while still too poor to buy another —
 * i.e. paying the full harassment price again, twice, to receive one hull that
 * `shipsWith` would have given them for 2000 credits anyway. Every cycle is
 * strictly worse for them than not losing the miner.
 *
 * BALANCE IMPLICATION, honestly: the floor under a collapsing economy is now
 * "one miner, as long as a refinery stands" rather than zero. A player who is
 * being ground down still loses; they just lose to an attack that takes their
 * refinery, instead of to an arithmetic edge in `SELL_REFUND` that nothing in
 * the product ever explained to them.
 *
 * DETERMINISM. `s.tick` only — no clock, no RNG. The survey is a pure read
 * (see `OreCrisis.ts`), the per-player counters are plain integers advanced by
 * the tick number, and the refinery chosen for the redemption is the first
 * match in the store's dense per-kind list, which is allocation order. Two
 * clients on one seed rescue the same player from the same refinery on the
 * same tick. The HUD half is skipped entirely for non-local players and writes
 * nothing to the world, so it cannot diverge anything.
 *
 * PHASE. `Phase.Economy` order 900 — after `economy.system.ts` has settled
 * this tick's credits and after `production.system.ts` (Phase.Production, 200)
 * has drained the queues, so `credits` and the queue contents are both this
 * tick's truth rather than last tick's.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { EntityFlag, EntityKind, EvaLine, Faction, Phase } from '../core/types';
import type { PlayerId, SimContext } from '../core/types';
import type { World } from '../core/world';
import { MAX_PLAYERS } from '../core/config';
import { ctx } from '../game/context';

import { OreCrisisState, makeOreCrisisSurvey, surveyOreCrisis } from './OreCrisis';
import type { OreCrisisSurvey } from './OreCrisis';
import { production } from './Production';

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

/**
 * Ticks between surveys. 15 = twice a second at the fixed 30 Hz sim.
 *
 * The survey walks this player's buildings, so it is a scan and belongs on a
 * slice like `regen.system.ts`'s. Twice a second is far finer than the state
 * it watches can plausibly change, and the tick number driving the slice keeps
 * two clients on the same schedule.
 */
export const CRISIS_SURVEY_INTERVAL = 15;

/**
 * Ticks of CONTINUOUS `Stranded` before a refinery redeems its harvester.
 * 300 = ten seconds.
 *
 * Not a cosmetic pause. It is the window in which the chip and the EVA line
 * are on screen and the player can still solve it themselves — a rescue that
 * lands the instant the miner explodes would teach them that the game fixes
 * this, which is the opposite of the intent. It also absorbs the transient
 * where a harvester dies on the same tick a replacement is already rolling out
 * of the factory.
 */
export const RESCUE_DELAY_TICKS = 300;

/**
 * Ticks after a successful redemption before the same player can have another.
 * 900 = thirty seconds. Belt and braces: the survey already returns to `None`
 * the moment the delivered harvester exists, so the ordinary path never
 * reaches this. It bounds the pathological one — a miner shot dead in the
 * seconds after delivery, repeatedly, next to a refinery that keeps standing.
 */
export const RESCUE_COOLDOWN_TICKS = 900;

/* ==========================================================================
 * 2. STATE
 * ========================================================================== */

let world: World | null = null;

/** One reused survey object. The whole module allocates nothing per tick. */
const survey: OreCrisisSurvey = makeOreCrisisSurvey();

/** Consecutive ticks each player has been `Stranded`. */
const strandedFor = new Int32Array(MAX_PLAYERS);
/** Tick of each player's last successful redemption, or a large negative. */
const lastRescue = new Int32Array(MAX_PLAYERS);
/** Last state each player was surveyed in, so the chip fires on the EDGE. */
const lastState = new Int32Array(MAX_PLAYERS);

/** Redemptions granted this match. Read by tests and the F3 overlay. */
export let rescuesGranted = 0;
/** The local player's last surveyed state. Read by tests and the HUD. */
export let localCrisis: OreCrisisState = OreCrisisState.None;

function reset(): void {
  strandedFor.fill(0);
  lastRescue.fill(-1 << 30);
  lastState.fill(OreCrisisState.None);
  rescuesGranted = 0;
  localCrisis = OreCrisisState.None;
}

/* ==========================================================================
 * 3. THE HUD SEAM
 *
 * Structural, exactly as `Production.ts`'s own `hudToast` is: the sim must not
 * import `src/ui`, and a missing HUD (headless test, the `?shot=` harness, a
 * dedicated server) has to be silence rather than a crash.
 * ========================================================================== */

interface HudToastSink {
  toast(kind: string, key: string, title: string, detail?: string): void;
}

function hudToast(): HudToastSink | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const h = g.__vmHud as Partial<HudToastSink> | undefined;
  if (h === undefined || h === null) return null;
  return typeof h.toast === 'function' ? (h as HudToastSink) : null;
}

/* ==========================================================================
 * 4. THE TICK
 * ========================================================================== */

/**
 * Find the refinery that will honour the promise: this player's first
 * finished, live structure carrying a `shipsWith`.
 *
 * FIRST IN STORE ORDER, not nearest or newest, and that is the determinism
 * clause — `byKind` is a dense list in allocation order, identical on every
 * client running the same command stream. "Nearest to the dead harvester"
 * would have been friendlier and would have depended on a corpse's position.
 */
function redeemFrom(w: World, player: PlayerId): boolean {
  const prod = production();
  if (prod === null) return false;
  const st = w.store;
  const owner = player as number;
  const list = st.byKind[EntityKind.Building];
  const count = st.byKindCount[EntityKind.Building];
  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;
    const entry = prod.entryOf(st.handleOf(i));
    if (entry === null || entry.shipsWith === '') continue;
    if (prod.redeemBundledUnit(player, st.handleOf(i))) return true;
    // A refinery with no egress spot is not the end of the search: the player
    // may own a second one that is not walled in.
  }
  return false;
}

export default defineSystem({
  id: 'sim.orecrisis',
  phase: Phase.Economy,
  order: 900,

  init(): void {
    world = ctx().world;
    reset();
  },

  simTick(s: SimContext): void {
    const w = world;
    if (w === null) return;
    if (s.tick % CRISIS_SURVEY_INTERVAL !== 0) return;
    const prod = production();
    if (prod === null) return;

    const local = w.localPlayer as number;
    for (let pi = 0; pi < w.players.length; pi++) {
      const p = w.players[pi];
      if (p === undefined || p.defeated) continue;
      // Gaia / neutral owns no economy and has no refinery to redeem from.
      if (p.faction === Faction.Neutral) continue;

      surveyOreCrisis(w, prod, p.id, survey);
      const state = survey.state;
      if (pi === local) localCrisis = state;

      /* -- the chip, on the edge, for the local player only -------------- */
      if (pi === local && state !== OreCrisisState.None && lastState[pi] !== state) {
        announce(w, p.id, survey);
      }
      lastState[pi] = state;

      /* -- the rescue, for everyone -------------------------------------- */
      if (state !== OreCrisisState.Stranded) { strandedFor[pi] = 0; continue; }
      strandedFor[pi] += CRISIS_SURVEY_INTERVAL;
      if (strandedFor[pi] < RESCUE_DELAY_TICKS) continue;
      if (s.tick - lastRescue[pi] < RESCUE_COOLDOWN_TICKS) continue;
      if (survey.refineries <= 0) continue;

      if (!redeemFrom(w, p.id)) continue;
      lastRescue[pi] = s.tick;
      strandedFor[pi] = 0;
      rescuesGranted++;
      w.audio.eva(p.id, EvaLine.Reinforcements);
      if (pi === local) {
        hudToast()?.toast(
          'good', 'ore-crisis', 'Ore miner dispatched',
          'Your refinery sent a replacement because nothing you own could be '
          + 'sold to pay for one.',
        );
      }
    }
  },

  dispose(): void {
    world = null;
    reset();
  },
});

/**
 * Say it, once per entry into the state.
 *
 * The EVA line is the same for both states because there is one recorded take
 * and it is the right sentence for both — "sell a structure to rebuild" is
 * literally what a `SellOut` player must do, and a `Stranded` one is about to
 * watch the game do the equivalent for them. The CHIP is where the two
 * diverge, because the chip has room to name the number.
 */
function announce(w: World, player: PlayerId, s: OreCrisisSurvey): void {
  w.audio.eva(player, EvaLine.NoOreMiner);
  const toast = hudToast();
  if (toast === null) return;
  if (s.state === OreCrisisState.SellOut) {
    const short = Math.max(0, s.harvesterCost - s.credits);
    toast.toast(
      'alert', 'ore-crisis', 'No ore miner',
      `Mining has stopped and you are ${short} credits short. Use the SELL tool `
      + 'in the sidebar to cash in a structure for half its cost, then rebuild.',
    );
  } else {
    toast.toast(
      'alert', 'ore-crisis', 'No ore miner',
      'Mining has stopped and selling cannot cover a replacement. Hold your '
      + 'refinery — it will dispatch one.',
    );
  }
}
