/**
 * ============================================================================
 * VOLTMARCH — src/sim/tips.system.ts
 * ============================================================================
 * SITUATIONAL TIPS: ONE SITUATION, END TO END.
 *
 * `TIPS_BUILD_SPEC.md` §6 Commit 2. This is the whole feature today — one
 * trigger, one string, one surface — and it exists to prove the four things
 * that every later tip inherits: the trigger cannot fire under `?shot=`, the
 * settings toggle has a reader, the suppression set is enforced where it
 * cannot be bypassed, and a boot with no shell is silent rather than
 * default-on.
 *
 * THE SITUATION: a brownout held for fifteen continuous seconds.
 * THE TIP: the shed order. Defences go dark first, and a plant brings them
 * back. Both halves are checkable against shipped code —
 * `POWER_SHED_ORDER.defence` is 0 and `.refinery` is 4, so defences are the
 * FIRST class `PowerGrid.shed` darkens and the refinery the last; and
 * `shedPriority` answers `never` for `EntityFlag.IsBuilder`, so the
 * Construction Yard cannot be darkened and the Structures tab — where the
 * plant lives — is exempt from `Production.census`'s blackout gate. The route
 * out is open by construction, which is exactly what the tip promises.
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
 * whether a tip was shown (one player has them off) and the simulation is
 * bit-identical either way. That is what makes it safe to leave tips ON in
 * PvP, which `TIPS_BUILD_SPEC.md` §4 decided deliberately after two surveys
 * assumed opposite answers in silence.
 *
 * `?shot=` CANNOT REACH THIS, AND IT IS TRUE TWICE OVER. `GameLoop.advanceFrames`
 * — the 300 frames `tools/shoot.mjs` drives — calls `renderPass` alone and never
 * `stepSim`, so `simTick` does not run at all; a `dt`-driven card would have
 * fired in all three HUD fixtures, deterministically and permanently, which is
 * trap 1 in the spec. And a fixture's `settleTicks` (120 at the most) is a
 * quarter of the hold this module needs. The third guard is the settings read
 * below: a `?shot=` boot never loads the shell, so there is no store, so tips
 * are OFF.
 *
 * PHASE. `Phase.Economy` order 950 — one step behind `orecrisis.system.ts`, and
 * behind `economy.system.ts` at order 0, which is where `PowerGrid.simTick`
 * writes `powerProduced` / `powerConsumed` onto every `PlayerState`. So the
 * brownout this module reads is this tick's, not last tick's.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { BuildTab, EntityFlag, EntityKind, Phase } from '../core/types';
import type { PlayerState, SimContext } from '../core/types';
import type { World } from '../core/world';
import { ctx } from '../game/context';

import { campaignRunning } from '../campaign/policy';
import { playbackActive } from '../game/Playback';
import { production } from './Production';
import type { ProductionService } from './Production';

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
 * Ticks of CONTINUOUS brownout before the tip is offered. 450 = fifteen
 * seconds.
 *
 * NOT the moment the brownout starts. The HUD already says that: `Hud.ts`
 * toasts *"Low power"* with the two figures on the crossing edge, and
 * `PowerGrid` fires `EvaLine.LowPower` beside it. A tip repeating the alarm
 * fifteen seconds late is noise. What this window buys is the difference
 * between a player who has been told and a player who has not ACTED — and see
 * `answeringPower` below, which is the other half of that sentence and the
 * measurement that made this module honest.
 */
export const BROWNOUT_HOLD_TICKS = 450;

/* ==========================================================================
 * 2. THE CORPUS — ONE ROW
 *
 * DELIBERATELY IN THIS FILE. `TIPS_BUILD_SPEC.md` §2.4 measured the leak that
 * a `tips.system.ts -> tips/rows.ts` edge would open: `src/game/Systems.ts`
 * globs `*.system.ts` with `eager: true` FROM THE ENTRY CHUNK, and nothing in
 * the tree catches an authored corpus arriving that way — `tutorial-steps.ts`
 * is 33 kB of prose sitting in `index-*.js` today. One row is not a corpus.
 * The moment a SECOND row lands, the bundle rule has to be written first and
 * the rows move to a lazily imported module behind it.
 *
 * TWO LINES BECAUSE THE TOAST IS TWO LINES, AND THE LENGTHS ARE MEASURED IN A
 * BROWSER RATHER THAN DERIVED FROM THE CSS. Both lines are
 * `white-space: nowrap` + `text-overflow: ellipsis` at
 * `font-size: calc(10 * var(--vm-u))` in a stack capped at `250 * var(--vm-u)`,
 * and reasoning from that gives one budget for both. IT IS TWO, AND THEY ARE
 * NOWHERE NEAR EACH OTHER:
 *
 *   .vm-toast-title    uppercase, weight 600, letter-spacing 0.18em   26 chars
 *   .vm-toast-detail   as authored, weight 400, 0.02em                44 chars
 *
 * Chromium at 1280x720, `--vm-u: 1px`, Rajdhani loaded, text box 203 px, the
 * capacity measured by growing an ordinary English sentence until
 * `scrollWidth > clientWidth`. The title inherits a caps transform and 1.8 px
 * of tracking, so it holds barely more than half what the detail does — and
 * the first draft of THIS FILE put a thirty-six-character sentence there (300
 * px against a 203 px box) with a test that agreed it fitted, because the test
 * had a reasoned budget in it instead of a measured one. The ratios are
 * scale-invariant: both the box and the type are multiples of `--vm-u`.
 *
 * The spec's single-sentence draft is seventy-one characters (337 px) and fits
 * neither line. `tests/tips-brownout.spec.ts` §4 holds both budgets. That is
 * §2.1 restated with two numbers, and it is why the toast is this slice's
 * surface and not the feature's home.
 *
 * THE DETAIL LEADS WITH THE VERB, which is the instruction
 * `orecrisis.system.ts` earned the hard way: its first chip put the whole
 * instruction past the ellipsis and a live capture is what found it.
 *
 * NO DIGIT AND NO KEY NAME. `tests/loading-tips.spec.ts` lints this row with
 * the same two rules it lints `Shell.TIPS` with; that file is the one place
 * either rule lives.
 *
 * AND THE KEY RULE IS STRICTER HERE THAN IT IS THERE. `Shell.TIPS` names keys
 * through `{action.id}` placeholders that `resolveTip` resolves against the
 * live bindings — that machinery is what fixed the three rebindable keys audit
 * #27 found. NONE OF IT EXISTS ON THIS SIDE: these strings go straight to the
 * chip, so a key written into one cannot be repaired the way those three were.
 * It can only be a lie or be deleted. A situational tip that genuinely needs
 * to name a key has to bring the placeholder machinery with it, which means a
 * fourth host seam for the live bindings.
 */
export interface Tip {
  /** Toast dedupe key. Prefixed `tip.` so nothing else can collide with it. */
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

export const TIP_BROWNOUT: Tip = {
  key: 'brownout',
  title: 'Defences go dark first',
  detail: 'Build a power plant to bring them back',
};

/* ==========================================================================
 * 3. STATE
 *
 * ONE COUNTER, NOT ONE PER PLAYER. `orecrisis.system.ts` keeps `MAX_PLAYERS`
 * of everything because its second consequence — the redeemed harvester —
 * binds every player including the AI. Nothing here does: a tip is local-only
 * DOM. A per-player array would be four counters advanced so that three of
 * them could never be read.
 * ========================================================================== */

let world: World | null = null;

/** Consecutive ticks the LOCAL player has been in brownout. */
let brownoutFor = 0;
/** True once the brownout tip has actually been shown this match. */
let brownoutShown = false;

/** Tips posted this match. Read by tests. */
export let tipsPosted = 0;

function reset(): void {
  brownoutFor = 0;
  brownoutShown = false;
  tipsPosted = 0;
}

/* ==========================================================================
 * 4. THE THREE HOST SEAMS
 *
 * All duck-typed off `globalThis`, none imported, exactly as
 * `orecrisis.system.ts`, `src/ui/Hud.ts` and `src/input/input.system.ts` all
 * do it: the sim must not import `src/ui`, and the settings store lives in the
 * lazily loaded shell chunk that a `?shot=` boot never loads at all.
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
 * Returns whether the tip was actually SHOWN, so a caller's once-per-match
 * latch records what the player saw rather than what the module attempted. A
 * tip suppressed by the campaign has not been spent.
 */
export function postTip(tip: Tip): boolean {
  if (!tipsEnabled()) return false;
  if (suppressed()) return false;
  const hud = hudToast();
  if (hud === null) return false;
  hud.toast('info', `tip.${tip.key}`, tip.title, tip.detail);
  tipsPosted++;
  return true;
}

/* ==========================================================================
 * 5. THE TRIGGER
 * ========================================================================== */

/**
 * Is this player ALREADY answering the brownout?
 *
 * ============================ THE MEASUREMENT ============================
 * `TIPS_BUILD_SPEC.md` §6 ends: *"If that tip fires while the player is already
 * dragging a Power Plant onto the ground, the feature has failed for nothing."*
 * It does, and the arithmetic is not close.
 *
 * `powerPlant` is `buildTime: 8` (7 for the Reclamation's Furnace), and
 * `BuildQueue.advanceTab` divides that by `player.buildSpeedMul`, which
 * `PowerGrid` clamps to `POWER_BLACKOUT_MUL` 0.25 at the bottom. So the drip
 * alone is 8 s in a shallow deficit and up to 32 s in a deep one — the deficit
 * that caused the brownout is what slows the cure. Then the player places it,
 * and `CONSTRUCTION_RISE_SECONDS` is another 2. A player who reacts to the very
 * first *"Low power"* chip is still mid-answer at fifteen seconds in every
 * brownout deep enough to matter, and `tests/tips-brownout.spec.ts` §3 measures
 * exactly that in the engine rather than from these numbers.
 *
 * So the hold timer is necessary and not sufficient, and this is the other
 * half. A queued item stays in `q.items` until `completeHead` — which is called
 * when the structure is PLANTED — so "ready and being dragged onto the ground"
 * is in this walk, which is the reported failure case verbatim.
 *
 * Two passes, and both are needed: the queue covers the plant that is paid for
 * and not yet standing, and the construction walk covers the two seconds it is
 * rising, during which it is out of the queue and not yet making power.
 *
 * A NULL CATALOGUE IS A REFUSAL, NOT A PASS. If the production service is
 * missing we cannot tell whether the player is already answering, and speaking
 * over them is the failure this whole function exists to prevent.
 */
function answeringPower(w: World, prod: ProductionService, p: PlayerState): boolean {
  const q = p.queues[BuildTab.Structures as number];
  if (q !== undefined) {
    for (let i = 0; i < q.items.length; i++) {
      const item = q.items[i];
      const entry = prod.catalog.resolve(item.defId, item.isBuilding);
      if (entry !== null && entry.power > 0) return true;
    }
  }

  const st = w.store;
  const list = st.byKind[EntityKind.Building];
  const count = st.byKindCount[EntityKind.Building];
  const owner = p.id as number;
  for (let a = 0; a < count; a++) {
    const i = list[a];
    if (st.owner[i] !== owner) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & EntityFlag.UnderConstruction) === 0) continue;
    if ((f & EntityFlag.PendingDestroy) !== 0) continue;
    const entry = prod.entryOf(st.handleOf(i));
    if (entry !== null && entry.power > 0) return true;
  }
  return false;
}

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
    if (brownoutShown) return;

    const p = w.players[w.localPlayer as number];
    if (p === undefined || p.defeated) { brownoutFor = 0; return; }

    // The identical expression `Production.ts` writes into
    // `HudSnapshot.brownout`, read off the same `PlayerState` fields
    // `PowerGrid` wrote this tick. The snapshot itself is not reachable from
    // here and would be the wrong thing to reach for anyway — it is a
    // presentation object rebuilt for the local player only.
    if (p.powerConsumed <= p.powerProduced) { brownoutFor = 0; return; }

    brownoutFor += TIP_SURVEY_INTERVAL;
    if (brownoutFor < BROWNOUT_HOLD_TICKS) return;

    const prod = production();
    if (prod === null) return;
    // DELIBERATELY DOES NOT RESET THE TIMER. The hold is a fact about the
    // brownout; this is a fact about the moment of speaking. A player who
    // queues a plant at second ten and cancels it at second twenty has been in
    // trouble for twenty seconds and has just abandoned the answer, which is
    // precisely when the tip is worth saying.
    if (answeringPower(w, prod, p)) return;

    if (postTip(TIP_BROWNOUT)) brownoutShown = true;
  },

  dispose(): void {
    world = null;
    reset();
  },
});
