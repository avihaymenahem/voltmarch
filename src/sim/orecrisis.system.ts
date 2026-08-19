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
 * IT RUNS DURING A CAMPAIGN OPERATION TOO, DELIBERATELY, AND THAT ASYMMETRY IS
 * NOT AN OVERSIGHT. `outcome.system.ts` consults `campaignRunning()` and this
 * file does not, which reads like a missing import and was reported as one.
 * The two are asking different questions. `outcome.system.ts` must stand down
 * because an operation authors its OWN win and lose conditions and a skirmish
 * rule firing over the top of them ends the match at the wrong moment. Nothing
 * here ends anything.
 *
 * And the case for keeping it is STRONGER inside an operation than outside it.
 * Every shipped operation sets `assetLossDefeat: false`, so a stranded
 * campaign player cannot earn AND cannot lose: the skirmish version of this
 * dead end at least terminates, while the campaign version is a frozen screen
 * with no defeat and no exit — precisely the state this rule was written for,
 * in its worst form.
 *
 * The designer's control is clause (4). The grant hangs off A FINISHED
 * REFINERY STANDING, and an operation's layout decides whether the player has
 * one. An author who does not want the rescue does not hand out a refinery —
 * `soviets.02.common-standard` opens with a column and no base and can never
 * reach this rule at all. That is a real lever, in the layout, where the rest
 * of an operation's economy is already authored. **Do not "fix" this by
 * gating it on `campaignRunning()`** without first showing an operation that
 * both gives the player a refinery and wants them stranded with it.
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
  /** Optional: older HUDs (and every headless boot) simply do not have it. */
  setOreCrisis?(active: boolean): void;
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
 * clause — `byKind` is a dense list in allocation order with swap-removes,
 * identical on every client running the same command stream. "Nearest to the
 * dead harvester" would have been friendlier and would have depended on a
 * corpse's position.
 *
 * THAT PICK DECIDES WHERE THE HULL APPEARS, AND NOTHING ELSE. It used to decide
 * WHAT appeared too, and that was a bug: capture leaves `defId` alone, so a
 * Meridian Pact player holding a captured Allied refinery got whichever hauler
 * happened to sit earlier in the list — the Allied one, which is not in the
 * Pact roster and could never be replaced. `redeemBundledUnit` now resolves the
 * unit from the PLAYER's own army; see its header. So the search is left
 * deliberately wide — every owned bundler, foreign or not — because a second
 * standing refinery is a second chance at an egress spot and no longer a second
 * answer to the question.
 *
 * Clause 4 is unaffected and is checked by the caller: `survey.refineries`
 * counts only structures whose entry key is this player's OWN refinery, so a
 * captured foreign one can deliver but can never satisfy the gate.
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
      if (pi === local) {
        if (state !== OreCrisisState.None && lastState[pi] !== state) announce(w, p.id, survey);
        // The tool highlight tracks the STATE, not the edge: a chip expires
        // after a few seconds and the crisis does not, so a player who looked
        // away would come back to an instruction with nothing to point at.
        if (state !== lastState[pi]) {
          hudToast()?.setOreCrisis?.(state !== OreCrisisState.None);
        }
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
          'good', 'ore-crisis', 'Ore miner dispatched', 'Your refinery sent a replacement',
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
 * diverge, because the chip can name the number.
 *
 * THE DETAIL LINE IS SHORT ON PURPOSE, AND THIS WAS MEASURED, NOT GUESSED.
 * `.vm-toast-detail` is `white-space: nowrap` + `text-overflow: ellipsis`, so
 * the chip renders ONE line of about 45 characters and silently drops the
 * rest. The first version of this string opened with "Mining has stopped and
 * you are 1400 credits short. Use the SELL tool..." and a live capture showed
 * the player exactly "Mining has stopped and you are 1400 credits s…" — the
 * entire instruction, which is the whole point of the chip, was past the
 * ellipsis. Lead with the verb. If this text grows, screenshot it.
 */
function announce(w: World, player: PlayerId, s: OreCrisisSurvey): void {
  w.audio.eva(player, EvaLine.NoOreMiner);
  const toast = hudToast();
  if (toast === null) return;
  if (s.state === OreCrisisState.SellOut) {
    const short = Math.max(0, s.harvesterCost - s.credits);
    toast.toast('alert', 'ore-crisis', 'No ore miner', `Use the SELL tool — ${short} short`);
  } else {
    toast.toast('alert', 'ore-crisis', 'No ore miner', 'Hold your refinery — it will send one');
  }
}
