/**
 * ============================================================================
 * VOLTMARCH — src/sim/tips.system.ts
 * ============================================================================
 * SITUATIONAL TIPS: THE DIRECTOR.
 *
 * `TIPS_BUILD_SPEC.md` §6 Commit 2 built one trigger, one string and one
 * surface, to prove four things every later tip inherits: the trigger cannot
 * fire under `?shot=`, the settings toggle has a reader, the suppression set
 * is enforced where it cannot be bypassed, and a boot with no shell is silent
 * rather than default-on. Commit 3 turned the trigger into a TABLE and left
 * all four exactly where they were. The rows live in `src/sim/tip-rows.ts`;
 * read that file's header for the content rules and the pair-of-predicates
 * argument. This one is the machinery around them.
 *
 * WHY THIS IS SHAPED LIKE `orecrisis.system.ts`
 * ---------------------------------------------
 * Because that module already solved this problem. It posts a LOCAL-ONLY chip
 * from inside `simTick`, on a tick slice, writing nothing to the world. Read
 * its header. Everything below is the same shape with a smaller job.
 *
 * DETERMINISM. `s.tick` only — no wall clock, no RNG, and this module writes
 * NOTHING to the world, queues no order and touches no entity. It is invisible
 * to the AI and to a peer: two clients of a lockstep match can disagree about
 * whether a tip was shown (one player has them off, or has muted the row) and
 * the simulation is bit-identical either way. That is what makes it safe to
 * leave tips ON in PvP, which `TIPS_BUILD_SPEC.md` §4 decided deliberately
 * after two surveys assumed opposite answers in silence.
 *
 * `?shot=` CANNOT REACH THIS, AND IT IS TRUE TWICE OVER. `GameLoop.advanceFrames`
 * — the 300 frames `tools/shoot.mjs` drives — calls `renderPass` alone and never
 * `stepSim`, so `simTick` does not run at all; a `dt`-driven card would have
 * fired in all three HUD fixtures, deterministically and permanently, which is
 * trap 1 in the spec. And a fixture's `settleTicks` (120 at the most) is a
 * quarter of the SHORTEST hold in the corpus. The third guard is the settings
 * read below: a `?shot=` boot never loads the shell, so there is no store, so
 * tips are OFF.
 *
 * PHASE. `Phase.Economy` order 950 — one step behind `orecrisis.system.ts`, and
 * behind `economy.system.ts` at order 0, which is where `PowerGrid.simTick`
 * writes `powerProduced` / `powerConsumed` onto every `PlayerState`. So the
 * brownout this module reads is this tick's, not last tick's. It is also
 * behind `production.system.ts` (Phase.Production, 200), so the queues every
 * `answered` predicate walks are this tick's too.
 *
 * THE SURFACE IS STILL THE TOAST, AND THE NEXT OPTION IS COSTED
 * -------------------------------------------------------------
 * `postTip` is the seam every later surface comes through: a card replaces the
 * body of one function and the gates above it do not move. It is not a card
 * yet because `Hud.hudFrameShare()` already measures 15.83% against
 * `RA3_LOOK_BIBLE.md` §38's 12-16% ceiling, and a card is a FOURTH claimant
 * (HUD + objectives + toasts + card) on a budget with no headroom. Any card
 * lands with a frame-share number and a `tools/shot-compare.mjs` control
 * capture, and neither is cheap: no `?shot=` fixture shows a tip, because
 * `simTick` does not run under `advanceFrames`.
 *
 * **THE CHEAPER NEXT OPTION, IF 26/44 EVER PROVES TOO TIGHT, IS A WIDER CHIP
 * AND NOT A CARD.** An `is-tip` variant on `.vm-toast` letting the DETAIL wrap
 * to two or three lines fixes §2.1's actual cause — `white-space: nowrap` —
 * inside a claimant the frame-share budget has already paid for. It was NOT
 * taken now because the evidence says it is not needed: all seven rows say
 * something true and useful inside 26 and 44 characters, seven of seven, and
 * terse is the right register for something that interrupts a player
 * mid-match. Widening on a hunch would buy prose nobody has asked for and cost
 * a re-measurement of the one budget in the product that is already over.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';
import { ctx } from '../game/context';

import { campaignRunning } from '../campaign/policy';
import { playbackActive } from '../game/Playback';
import { production } from './Production';
import { TIP_BROWNOUT, TIP_ROWS } from './tip-rows';
import type { Tip, TipContext, TipRow } from './tip-rows';

export { TIP_ROWS, TIP_BROWNOUT } from './tip-rows';
export type { Tip, TipContext, TipRow } from './tip-rows';

/* ==========================================================================
 * 1. TUNING
 * ========================================================================== */

/**
 * Ticks between surveys. 15 = twice a second at the fixed 30 Hz sim, the same
 * slice `orecrisis.system.ts` uses and for the same reason: the survey is a
 * scan, and the tick number driving the slice keeps every client on one
 * schedule without a timer.
 */
export const TIP_SURVEY_INTERVAL = 15;

/**
 * Ticks of CONTINUOUS brownout before that tip is offered. 450 = fifteen
 * seconds. Re-exported from the row rather than declared here, because it is a
 * property of the row and `tests/tips-brownout.spec.ts` reads it by this name.
 *
 * NOT the moment the brownout starts. The HUD already says that: `Hud.ts`
 * toasts *"Low power"* with the two figures on the crossing edge, and
 * `PowerGrid` fires `EvaLine.LowPower` beside it. A tip repeating the alarm
 * fifteen seconds late is noise. What this window buys is the difference
 * between a player who has been told and a player who has not ACTED — and see
 * the row's `answered` predicate, which is the other half of that sentence and
 * the measurement that made this module honest.
 */
export const BROWNOUT_HOLD_TICKS = TIP_BROWNOUT.holdTicks;

/**
 * Minimum ticks between any two tips. 900 = thirty seconds.
 *
 * A PACING RULE, NOT A MEASUREMENT, and it is stated as one. Every row is
 * once-per-match and every hold is fifteen seconds to two minutes, so two tips
 * maturing together is uncommon rather than impossible — a base in a brownout
 * is also a base with a slow queue. Thirty seconds is about seven times the
 * `TOAST_LIFE.info` a chip actually lives, so the first tip is long gone before
 * the second arrives. Two chips of advice inside half a minute is a lecture.
 */
export const TIP_SPACING_TICKS = 900;

/* ==========================================================================
 * 2. STATE
 *
 * ONE SET OF COUNTERS, NOT ONE PER PLAYER. `orecrisis.system.ts` keeps
 * `MAX_PLAYERS` of everything because its second consequence — the redeemed
 * harvester — binds every player including the AI. Nothing here does: a tip is
 * local-only DOM. A per-player array would be four counters advanced so that
 * three of them could never be read.
 * ========================================================================== */

let world: World | null = null;

/** Consecutive ticks each row's SITUATION has held. Parallel to `TIP_ROWS`. */
const heldFor = new Int32Array(TIP_ROWS.length);
/** True once a row has actually been SHOWN this match. Parallel to `TIP_ROWS`. */
const shownThisMatch = TIP_ROWS.map(() => false);

/**
 * The tick the last tip was shown, for `TIP_SPACING_TICKS`.
 *
 * NEGATIVE INFINITY, NOT ZERO. Zero means "a tip was shown on tick zero", which
 * would swallow every tip in the first thirty seconds of every match — and the
 * brownout row's own regression suite posts at tick 465.
 */
let lastTipTick = Number.NEGATIVE_INFINITY;

/** Tips posted this match. Read by tests. */
export let tipsPosted = 0;

function reset(): void {
  heldFor.fill(0);
  shownThisMatch.fill(false);
  lastTipTick = Number.NEGATIVE_INFINITY;
  tipsPosted = 0;
}

/* ==========================================================================
 * 3. THE HOST SEAMS
 *
 * All duck-typed off `globalThis`, none imported, exactly as
 * `orecrisis.system.ts`, `src/ui/Hud.ts` and `src/input/input.system.ts` all
 * do it: the sim must not import `src/ui`, the settings store lives in the
 * lazily loaded shell chunk that a `?shot=` boot never loads at all, and the
 * progression handle is deliberately NOT published under `?shot=`.
 * ========================================================================== */

interface HudToastSink {
  toast(kind: string, key: string, title: string, detail?: string): void;
  /**
   * Live chips of kind `alert` that are not already fading out.
   *
   * OPTIONAL, AND THE ABSENCE MEANS "NO STACK" RATHER THAN "NO ALERTS". That
   * is the opposite polarity to `tipsEnabled` below, and the difference is
   * real: the settings read decides whether the player CONSENTED, so an absent
   * store must mean no. This one asks how loud a chip STACK is, and a sink
   * that cannot answer is not a stack — it has no `TOAST_MAX`, no eviction and
   * nothing to talk over. Refusing there would make the module untestable and
   * would be refusing on the grounds of seeing no competing chips.
   */
  toastAlerts?(): number;
  /** True when the stack is full, so pushing would EVICT somebody's chip. */
  toastCrowded?(): boolean;
}

function hudToast(): HudToastSink | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const h = g.__vmHud as Partial<HudToastSink> | undefined;
  if (h === undefined || h === null) return null;
  return typeof h.toast === 'function' ? (h as HudToastSink) : null;
}

interface SettingsBridge {
  get(): { gameplay?: { tips?: boolean } };
}

/**
 * Is the player asking for tips?
 *
 * THIS IS THE EXPLICIT INVERSION OF THE `?? default` IDIOM AND THE INVERSION IS
 * THE POINT. `src/ui/Hud.ts` and `src/input/input.system.ts` both read this same
 * global and FALL BACK TO THE DEFAULT when it is absent, which is right for
 * them — a missing store means "no rebinds exist", and the stock scheme is the
 * truthful answer. It is wrong here. `gameplay.tips` defaults to `true`, so the
 * same idiom would make a shell-less boot — the `?shot=` harness, a headless
 * test, a dedicated server — DEFAULT TO SHOWING TIPS, which is trap 2 in
 * `TIPS_BUILD_SPEC.md` §3.
 *
 * So: no store is not "the default", it is OFF. `=== true` rather than `?? true`
 * on the field for the same reason, one level down — a store that exists but has
 * no `gameplay.tips` (a settings blob written by a build that predates this
 * commit, before `normalizeSettings` has been through it) is also not a request
 * for tips.
 */
function tipsEnabled(): boolean {
  const g = globalThis as unknown as { __vmSettings?: SettingsBridge };
  const s = g.__vmSettings;
  if (s === undefined || typeof s.get !== 'function') return false;
  try {
    return s.get().gameplay?.tips === true;
  } catch {
    return false;
  }
}

/**
 * The persisted per-row mute, on `globalThis.__vmProgression`.
 *
 * A HANDLE THAT IS NOT THERE IS NOT A MEMORY THAT SAYS NO. Absence here means
 * nothing has been remembered — a `?shot=` boot (where the handle is
 * deliberately never published), a headless test, the menu before the first
 * match — and "nothing remembered" is honestly "not muted". The consent gate
 * above is the one that has to fail closed; this one is a diary.
 *
 * NOT WRAPPED IN `try`, unlike `tipsEnabled`. The settings store belongs to the
 * SHELL and can be torn down under a live match, which is a real state that was
 * hit. `progression.system.ts` deletes the whole global in `dispose`, so this
 * probe answers null rather than throwing.
 */
interface TipMemory {
  tipSeen(key: string): boolean;
  markTipSeen(key: string): boolean;
}

function tipMemory(): TipMemory | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const p = g.__vmProgression as Partial<TipMemory> | undefined;
  if (p === undefined || p === null) return null;
  if (typeof p.tipSeen !== 'function' || typeof p.markTipSeen !== 'function') return null;
  return p as TipMemory;
}

/**
 * True while scripted content owns the session, and tips must stand down.
 *
 * THREE PREDICATES, NOT FOUR. Campaign, replay and tutorial — each suppresses
 * for a reason a PvP skirmish does not share: an operation authors its own
 * guidance, a replay is not the viewer's match to advise on, and the tutorial
 * is already saying something. A match against a person is none of those, and
 * `TIPS_BUILD_SPEC.md` §4 decided deliberately that tips stay ON there rather
 * than letting the third survey's silent assumption win.
 *
 * `scriptedRunning()` in `outcome.system.ts` is the same OR of the first and
 * third and is NOT imported: it lives in a system module, and a
 * system-to-system import is a new edge shape for no gain. `campaignRunning()`
 * is a module-level boolean in a file that imports only a type, and the
 * tutorial half is a duck-typed global because its two halves straddle
 * `src/shell/**` and `src/game/**`.
 */
function suppressed(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  const tutorial = g.__vmTutorial !== undefined && g.__vmTutorial !== null;
  return tutorial || campaignRunning() || playbackActive();
}

/**
 * Show a tip, or decide not to. THE ONLY WAY A TIP REACHES A PLAYER.
 *
 * EVERY GATE LIVES INSIDE THIS FUNCTION AND NONE AT A CALL SITE. That is not
 * tidiness: `CLAUDE.md`'s `beginMatch` section is nine lines of a shell
 * carve-out that did nothing because a second caller reached the same code one
 * frame later — *"a guard that lives at a call site cannot see a second call
 * site"*. There is one caller today and there will be a dozen, and the answer
 * to "is this player being shown tips" must not depend on which one asked.
 *
 * SIX GATES, IN THIS ORDER, AND THE ORDER IS THE ARGUMENT:
 *
 *   1. CONSENT      `gameplay.tips`. Nothing else is worth asking if the
 *                   player has turned the feature off.
 *   2. SCRIPTED     campaign / replay / tutorial. See `suppressed`.
 *   3. MUTED        this row has been shown, and dismissed, in an earlier
 *                   match. See `TipMemory`.
 *   4. SPACING      a tip was shown within `TIP_SPACING_TICKS`.
 *   5. HOST         there is a chip stack to post into at all.
 *   6. ARBITER      the stack is holding something the player needs more.
 *
 * **GATE 6 IS THE ONE `TIPS_BUILD_SPEC.md` §7 ASKED FOR AND DID NOT HAVE.**
 * `TOAST_MAX` is 5 and `EVA_TOASTS` turns fifteen announcer lines into chips,
 * so a tip competes with *"Base under attack"* — and `ToastStack.push` retires
 * the OLDEST chip when the stack is full, so a tip arriving at capacity does
 * not merely queue behind an alert, it DELETES one. Two facts are read and
 * both are refusals: a live alert, and a full stack. Neither is a guess about
 * priority; an alert is `EVA_TOASTS`' own classification of the line, and a
 * full stack is arithmetic.
 *
 * `hud.toast` has always been called here unguarded, so the two arbiter reads
 * are too. A HUD that throws inside `simTick` is a defect in the HUD and
 * swallowing it here would hide it.
 *
 * Returns whether the tip was actually SHOWN, so a caller's once-per-match
 * latch records what the player saw rather than what the module attempted. A
 * tip suppressed by the campaign has not been spent.
 */
export function postTip(tip: Tip): boolean {
  if (!tipsEnabled()) return false;
  if (suppressed()) return false;

  const memory = tipMemory();
  if (memory !== null && memory.tipSeen(tip.key)) return false;

  // NO CLOCK, NO SPACING. `world` is null when this is called outside a live
  // match — the only caller that does is a test asking one question about one
  // string — and a spacing rule with nothing to measure against is not a gate,
  // it is a coin toss.
  const w = world;
  if (w !== null && w.tick - lastTipTick < TIP_SPACING_TICKS) return false;

  const hud = hudToast();
  if (hud === null) return false;
  if (typeof hud.toastAlerts === 'function' && hud.toastAlerts() > 0) return false;
  if (typeof hud.toastCrowded === 'function' && hud.toastCrowded()) return false;

  hud.toast('info', `tip.${tip.key}`, tip.title, tip.detail);
  // THE MUTE IS AUTOMATIC ON FIRST SHOWING, AND THE SURFACE IS WHY. There is no
  // click affordance on a chip — `.vm-toasts` is `pointer-events: none` — so
  // "dismiss" is not an act the player can perform, and a mute that waited for
  // one would never fire. Marked HERE rather than at the decision above,
  // because a row refused by any gate above has not been spent.
  memory?.markTipSeen(tip.key);
  if (w !== null) lastTipTick = w.tick;
  tipsPosted++;
  return true;
}

/* ==========================================================================
 * 4. THE DIRECTOR
 * ========================================================================== */

export default defineSystem({
  id: 'sim.tips',
  phase: Phase.Economy,
  order: 950,

  init(): void {
    world = ctx().world;
    reset();
  },

  simTick(s: SimContext): void {
    const w = world;
    if (w === null) return;
    if (s.tick % TIP_SURVEY_INTERVAL !== 0) return;

    const p = w.players[w.localPlayer as number];
    if (p === undefined || p.defeated) { heldFor.fill(0); return; }

    const prod = production();
    // A NULL CATALOGUE IS A REFUSAL, NOT A PASS, and it holds every clock where
    // it is. With no catalogue no `answered` predicate can resolve an entry, so
    // every row would look unanswered — which is precisely the state that
    // speaks over a player who is already fixing it.
    if (prod === null) return;

    // ONE OBJECT PER SURVEY, WHICH IS TWO A SECOND, AND THAT IS NOT THE
    // ALLOCATION RULE'S SUBJECT. The house rule is zero allocation in the FRAME
    // loop; a reused mutable scratch here would buy back two small objects a
    // second at the price of making `TipContext` writable, and a context a row
    // could write to is a row that can talk to the next row.
    const c: TipContext = { world: w, prod, player: p };

    for (let i = 0; i < TIP_ROWS.length; i++) {
      if (shownThisMatch[i]) continue;
      const row: TipRow = TIP_ROWS[i];

      if (!row.situation(c)) { heldFor[i] = 0; continue; }
      heldFor[i] += TIP_SURVEY_INTERVAL;
      if (heldFor[i] < row.holdTicks) continue;

      // DELIBERATELY DOES NOT RESET THE TIMER. The hold is a fact about the
      // situation; this is a fact about the moment of speaking. A player who
      // queues a plant at second ten and cancels it at second twenty has been
      // in trouble for twenty seconds and has just abandoned the answer, which
      // is precisely when the tip is worth saying.
      if (row.answered(c)) continue;

      // AT MOST ONE TIP PER SURVEY, and the loop stops on the first one SHOWN
      // rather than the first one considered — a row refused by `postTip` has
      // not spoken, so the next row is still entitled to.
      if (postTip(row)) { shownThisMatch[i] = true; return; }
    }
  },

  dispose(): void {
    world = null;
    reset();
  },
});
