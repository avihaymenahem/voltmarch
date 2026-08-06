/**
 * ============================================================================
 * src/ui/Sidebar.ts — THE BOTTOM BAR
 * ============================================================================
 * The file keeps its name so no other module's import breaks; it is no longer a
 * sidebar. The classic right-hand rail is gone and the command surface is now
 * bottom-anchored in three docks plus one strip:
 *
 *   TOP CENTRE   `ResourceStrip`   credits, power, clock, and three telltales
 *   BOTTOM LEFT  `.vm-dock-map`    the minimap's glass panel plus its legend
 *   BOTTOM CENTRE`SelectionPanel`  the selection, OR the base status board
 *   BOTTOM RIGHT `BuildPanel`      4 named tabs over a 6-column slot grid
 *
 * WHY BOTTOM-ANCHORED
 * -------------------
 * A right rail costs 13% of the frame at every resolution and it costs it in
 * the WIDEST part of a 16:9 image, which is exactly where the battlefield is.
 * Three bottom docks cost the same pixels in the least valuable band and leave
 * the horizon clean. It also puts the build grid, the selection and the minimap
 * within one short mouse travel of each other.
 *
 * WHAT THE CLARITY PASS CHANGED
 * -----------------------------
 * 1. **Everything is named.** The resource cells carry CREDITS / POWER / TIME
 *    labels, the build tabs carry words, and every readout that was a bare
 *    glyph and a number now says what the number is.
 * 2. **Every blocked state explains itself.** A locked slot carries a banner
 *    that says which of the three reasons it is — tech, funds, power — and the
 *    tooltip carries the whole sentence. "NO RADAR" tells the player to build a
 *    Radar Dome.
 * 3. **Keys are visible.** Tabs and the first ten slots of the active tab carry
 *    a key badge, and those keys are live — `Hud` owns the listener.
 * 4. **The empty centre dock does work.** With nothing selected it shows army
 *    strength, structures, power, income and one line of advice, instead of
 *    fading to an invisible slab.
 *
 * ZERO ALLOCATION IN `update`
 * ---------------------------
 * Every slot, card and segment is built once and pooled. `update` writes
 * `nodeValue`, toggles classes and sets custom properties; it never calls
 * `createElement`, never builds a template string for the DOM, and never
 * touches a layout-reading API like `getBoundingClientRect`. The few strings it
 * does build (a countdown, a health fraction) are guarded by a signature
 * comparison, so a steady frame builds none of them.
 * ============================================================================
 */

import {
  BUILD_TAB_COUNT,
  BuildTab,
  Faction,
  Stance,
  type HudCameo,
  type HudSnapshot,
} from '../core/types';
import { MAX_QUEUE_DEPTH } from '../core/config';
import type * as THREE from 'three';
import {
  BUILD_SLOT_HOTKEYS,
  BUILD_SLOT_HOTKEY_LABELS,
  BUILD_TAB_HOTKEYS,
  BUILD_TAB_HOTKEY_LABELS,
} from '../input/ActionCatalogue';

import {
  RollingCounter,
  Tooltip,
  applyTheme,
  button,
  el,
  formatCountdown,
  formatCredits,
  formatElapsed,
  formatRate,
  label,
  panel,
  textNode,
  type TooltipContent,
} from './Chrome';
import {
  CameoRenderer, createCameoModelProvider, type CameoSubject,
} from './Cameos';
import { iconForBuildable, makeIcon, setIcon, type IconName } from './icons';

/* ==========================================================================
 * SECTION 1 — THE SHARED VOCABULARY
 * ========================================================================== */

/** The sidebar's two modal tools. Read by src/input/input.system.ts. */
export type ArmedMode = 'none' | 'repair' | 'sell';

/**
 * Abstract UI sounds. The HUD refuses to invent a sound and the audio module
 * refuses to reach into the HUD; `hud.system.ts` owns the four-line mapping.
 */
export type HudSoundCue = 'hover' | 'click' | 'error' | 'tab';

/** Tooltip content the HUD can supply but `HudCameo` does not carry. */
export interface BuildExtras {
  buildTimeSec: number;
  powerDelta: number;
  blurb: string;
  /** Human sentence naming what this needs, e.g. `Requires Radar Dome`. */
  prereq: string;
}

/** One card in the selection panel. Pooled — never retained by the caller. */
export interface SelectionCard {
  /** `EntityId` as a plain number, so the panel can echo a click back. */
  id: number;
  icon: IconName;
  name: string;
  /** 0..1. */
  hpFrac: number;
  /** 0, 1 or 2. */
  veterancy: number;
  /** How many identical units this card stands for. 1 = not stacked. */
  stack: number;
  /** True for the card the stat row is describing. */
  primary: boolean;
}

/** Everything the selection panel renders. Rebuilt in place each frame. */
export interface SelectionView {
  /** Entities selected. 0 swaps the dock over to the status board. */
  count: number;
  /** Headline: the primary's name, or "MIXED FORCE". */
  title: string;
  /** Sub-line: role or the mixed-selection breakdown. */
  subtitle: string;
  /** Veterancy of the primary, 0..2. Drives the chevrons beside the title. */
  veterancy: number;
  /** Pooled cards. Only the first `cardCount` are valid. */
  cards: SelectionCard[];
  cardCount: number;
  /** Aggregate health of the WHOLE selection, 0..1. */
  hpFrac: number;
  /** `1240 / 1600` — absolute hit points across the selection. */
  hpText: string;
  /**
   * At least one selected unit is currently self-repairing (`sim.regen`).
   *
   * Drives the sweep on the health bar and the REPAIRING tag beside it. It is a
   * property of the SELECTION, not of the primary: with six units selected and
   * one of them mending, something is happening and the panel should say so.
   */
  mending: boolean;
  /** Current stance of the selection, or -1 when it is mixed. */
  stance: Stance | -1;
  /** False for a selection that cannot take a stance (structures). */
  stanceEnabled: boolean;
  /** The Relocate button. Pooled and mutated in place, never replaced. */
  relocate: RelocateAction;
  /** The commander's ability button. Pooled and mutated in place. */
  ability: AbilityAction;
  /** Stat row. An empty string blanks its chip. */
  armour: string;
  damage: string;
  range: string;
  speed: string;
}

/**
 * The Relocate action, as the selection panel needs to render it.
 *
 * WHY THIS IS A SELECTION ACTION AND NOT A THIRD `ArmedMode`
 * ---------------------------------------------------------
 * Repair and sell are modal tools: you arm the wrench, then click any building.
 * The click is a GESTURE, and gestures belong to `src/input/input.system.ts`,
 * which reads `hud.armedMode` and issues the command. Relocation has no such
 * gesture — its subject is the building you already selected, and its target is
 * chosen by the placement ghost, which owns the cursor for the duration. Adding
 * `'relocate'` to `ArmedMode` would hand input a mode it has no code for and
 * would arm a wrench-like cursor that never gets clicked.
 *
 * So it lives on the selection panel, beside the stance buttons, where every
 * other per-selection verb would go. `enabled` is false when the structure
 * cannot be moved and `hint` is then the sentence explaining why — the button
 * stays VISIBLE and greyed rather than vanishing, because a control that
 * disappears teaches nothing and a control that explains itself teaches the
 * rule (a Construction Yard travels by packing into an MCV; a garrison must get
 * out first).
 */
export interface RelocateAction {
  /** False hides the row entirely: nothing relocatable is selected. */
  visible: boolean;
  /** False greys the button. `hint` says why. */
  enabled: boolean;
  /** Fee in credits. Printed on the button so the price precedes the click. */
  cost: number;
  /** Tooltip / aria description. Never empty while `visible`. */
  hint: string;
  /** True while the ghost is already carrying this structure. */
  armed: boolean;
}

/**
 * The commander's active ability, as the selection panel needs to render it.
 *
 * WHY IT SITS BESIDE RELOCATE AND NOT IN THE BUILD PALETTE
 * --------------------------------------------------------
 * Its subject is the unit you already selected, exactly like Relocate's, and
 * exactly unlike everything in the palette — which is a catalogue of things you
 * do not own yet. Putting it in the palette would also have meant one slot per
 * faction in a grid that is already the same shape for all four.
 *
 * `cooldown` / `cooldownTotal` are SECONDS and are only ever printed. The sim
 * counts in integer ticks (see `src/sim/Abilities.ts`) precisely so that the
 * float never gets anywhere near the decision; this is the presentation end of
 * that number and nothing branches on it but the label.
 */
export interface AbilityAction {
  /** False hides the row: nothing with an ability is selected. */
  visible: boolean;
  /** False greys the button — still cooling, or not yours. */
  enabled: boolean;
  /** 'Chrono Rally'. Never empty while visible. */
  label: string;
  /** One line saying what it does. The tooltip and the aria description. */
  hint: string;
  /** Seconds left, 0 when ready. */
  cooldown: number;
  /** The full cooldown, so the button can draw a proportion. */
  cooldownTotal: number;
}

/** Severity of the status board's advice line. */
export type AdviceKind = 'info' | 'warn' | 'alert';

/**
 * The base-wide numbers. They are not in `HudSnapshot` because that structure
 * is owned by `src/sim/Production.ts`, and none of this is production's
 * business — the HUD derives all four from the world and its own event
 * subscriptions.
 */
export interface HudTelemetry {
  /** Mobile units the local player owns. */
  army: number;
  /** Completed structures the local player owns. */
  structures: number;
  /** Smoothed credit income, per minute. */
  incomePerMin: number;
  /** One sentence about the state of the base. Never empty. */
  advice: string;
  adviceKind: AdviceKind;
}

/** Everything the bottom bar hands back up. */
export interface SidebarCallbacks {
  selectTab(tab: BuildTab): void;
  /** Left click on a build slot. */
  activate(tab: BuildTab, cameo: HudCameo): void;
  /** Right click on a build slot. */
  cancel(tab: BuildTab, cameo: HudCameo): void;
  /** The repair / sell tool changed. */
  setArmed(mode: ArmedMode): void;
  /** A selection card was clicked — make it the primary, or focus it. */
  focusCard(id: number, additive: boolean): void;
  /** The stance buttons. */
  setStance(stance: Stance): void;
  /** Relocate was pressed. The HUD puts the selected structure on the cursor. */
  relocate(): void;
  /** The commander's ability button was pressed. */
  useAbility(): void;
  sound(cue: HudSoundCue): void;
}

export interface SidebarOptions {
  parent: HTMLElement;
  faction: Faction;
  callbacks: SidebarCallbacks;
  /**
   * The main WebGL renderer, so build slots can show the ACTUAL MODEL instead
   * of a flat glyph.
   *
   * Optional, and the flat glyph stays underneath as the fallback: a headless
   * test, a context-lost frame, and any def whose model does not resolve all
   * have to keep producing a usable sidebar. `CameoRenderer` renders each
   * cameo once into a cached render target and then never again, so an idle
   * sidebar costs zero GPU — see the header of `Cameos.ts`.
   */
  renderer?: THREE.WebGLRenderer | null;
}

/**
 * Columns in the build grid. TWO, which is what RA2 itself used.
 *
 * The history is worth keeping because each step was measured. SIX was right
 * while this was a 332u-wide dock across the bottom. THREE was right the moment
 * it became a 240u vertical rail — six would have given a 36u cell. TWO is
 * right now for a reason neither of those had: the LARGEST roster any faction
 * has in any tab is EIGHT (measured off `catalog.roster` for all four armies
 * and all four tabs), so a third column was never buying capacity — it was
 * spending a third of the rail's width on air, and taking it out of the cameo.
 *
 * Two columns take the cell from ~73x56u to ~111x84u, which is 2.3x the pixel
 * area in the cameo's backing store. That is real resolution, not an upscale:
 * `bindCameo` sizes the canvas from the cell's own box.
 */
export const BUILD_COLUMNS = 2;
/**
 * Rows built up front. The grid scrolls internally past this.
 *
 * EIGHT is the largest roster, so 2x6 = 12 slots covers every tab of every
 * faction with four to spare. Sized against the measurement rather than
 * guessed: the old 10 rows existed to survive scrolling that, at these roster
 * sizes, cannot happen.
 */
export const BUILD_ROWS = 6;
/** Cards built up front in the selection panel. */
const CARD_POOL = 14;
/** Segments in the power meter. */
const POWER_SEGMENTS = 14;

/** Tab titles, in `BuildTab` order. */
const TAB_LABELS: readonly string[] = ['Structures', 'Defence', 'Infantry', 'Vehicles'];
/**
 * What the tab STRIP shows, as opposed to what the tab IS.
 *
 * The full words fitted a 332u dock across the bottom. In a 240u rail four of
 * them get about 55u each and the browser truncated them to "STR..", "DEF..",
 * "INF..", "VE.." — an ellipsis is not a label. These are the same words at a
 * length that fits, and `TAB_LABELS` is still what the tooltip and the
 * `aria-label` say, so nothing that has to be read aloud got shortened.
 */
const TAB_SHORT: readonly string[] = ['BLD', 'DEF', 'INF', 'VEH'];

/**
 * The build keyboard.
 *
 * NOT DECLARED HERE. Both the codes and the badge letters come from
 * `src/input/ActionCatalogue.ts`, which is also what the help screen renders —
 * so the letter printed on a cameo and the letter the help screen promises are
 * the same array element, and there is no second list to drift. The reasoning
 * behind the fourteen letters, and what happens when a rebind takes one, is in
 * that file's section 2.
 *
 * Re-exported under the old names because `src/ui/Hud.ts` matches keystrokes
 * against them and a HUD-local alias keeps that import off the shell chunk.
 */
export {
  BUILD_TAB_HOTKEYS as TAB_HOTKEY_CODES,
  BUILD_SLOT_HOTKEYS as SLOT_HOTKEY_CODES,
};

const TAB_HOTKEY_LABELS: readonly string[] = BUILD_TAB_HOTKEY_LABELS;
const SLOT_HOTKEY_LABELS: readonly string[] = BUILD_SLOT_HOTKEY_LABELS;

/**
 * The three fields a build countdown needs to remember between frames.
 * `BuildSlot` satisfies this structurally; a test can pass a plain object.
 */
export interface EtaSampler {
  /** `progress` at the previous sample, or -1 when there is none. */
  lastProgress: number;
  /** Milliseconds reading of that sample. */
  lastAt: number;
  /** Smoothed progress-per-second. 0 until two samples exist. */
  rate: number;
}

/** How much of each new instantaneous rate reading folds into the average. */
const ETA_SMOOTHING = 0.12;
/** A gap longer than this means frames were dropped; the sample is unusable. */
const ETA_MAX_SAMPLE_GAP_SEC = 2;
/** Beyond this the number stops informing and starts looking broken. */
const ETA_MAX_SECONDS = 600;
/**
 * How long progress must sit still before it counts as stalled.
 *
 * Not zero, and that is the important part: the HUD samples at frame rate while
 * the sim ticks at 30 Hz, so during a perfectly healthy build most samples show
 * no change. Treating those as zero-rate readings would halve the measured rate
 * and make the countdown read roughly double — the very bug being fixed.
 */
const ETA_STALL_SEC = 1.5;

/** `rate` sentinel: nothing measured yet, so fall back to the nominal time. */
const RATE_NO_SAMPLE = 0;
/** `rate` sentinel: measured, and the build is not moving. Show nothing. */
const RATE_STALLED = -1;

/**
 * Seconds left on a build, derived from how fast it is ACTUALLY progressing.
 *
 * Returns 0 for "show nothing": not building, already ready, or moving so
 * slowly that any figure would be a lie. A stalled build already announces
 * itself through the ON HOLD flag and EVA — a countdown reading 9999 beside it
 * would be noise, and one reading 5s while nothing moves is the bug this
 * replaces.
 *
 * WHY MEASURED AND NOT CALCULATED
 * -------------------------------
 * The old formula was `buildTime * (1 - progress)`: the time a build takes at
 * its NOMINAL rate. Three things move the real rate and it knew none of them.
 *
 *   - `player.buildSpeedMul` — a continuous function of the power supply ratio
 *     (`src/sim/Power.ts`), so a brownout stretches every build.
 *   - `factorySpeed(factoryCount)` — more factories build FASTER.
 *   - Affordability. `src/sim/BuildQueue.ts` charges per tick and advances only
 *     the slice it managed to pay for: "a poor player does not stop - they
 *     crawl. A tick that can only afford 40% of its increment advances 40% of
 *     its increment." Deliberate, and invisible to a nominal countdown.
 *
 * Two of the three make a build take LONGER than advertised, which is the
 * report: the timer says 5s and it takes twice that. Mirroring the sim's rate
 * arithmetic up here would be a second copy of a formula that drifts the first
 * time either side changes — the same defect class `docs/SPEC_DRIFT_AUDIT.md`
 * catalogues. Measuring the observed rate is correct for all three causes at
 * once, and for any cause added later.
 *
 * The estimate assumes current conditions hold, which is what every ETA
 * assumes. Power returning or a harvester cashing in will beat it, and early is
 * the right direction to be wrong in.
 */
export function estimateBuildEta(
  s: EtaSampler,
  progress: number,
  ready: boolean,
  buildTime: number,
  nowMs: number,
): number {
  if (ready || progress <= 0 || progress >= 1) {
    s.lastProgress = -1;
    s.rate = 0;
    return 0;
  }

  const prev = s.lastProgress;
  const dt = (nowMs - s.lastAt) / 1000;

  if (prev < 0 || progress < prev) {
    // A new item or a restart. `progress` going DOWN means the head of the
    // queue changed, so any retained rate describes a different build.
    s.lastProgress = progress;
    s.lastAt = nowMs;
    s.rate = RATE_NO_SAMPLE;
  } else if (progress > prev) {
    // Only measure across a plausible gap. A dropped frame or a tab switch
    // produces a delta over a long interval that is not a rate.
    if (dt > 0 && dt <= ETA_MAX_SAMPLE_GAP_SEC) {
      const inst = (progress - prev) / dt;
      // Heavily smoothed on purpose: production is charged per sim tick against
      // a credit balance that jumps every time a harvester docks, so the
      // instantaneous rate is spiky and a raw countdown would swing by seconds
      // between frames.
      s.rate = s.rate > 0 ? s.rate + (inst - s.rate) * ETA_SMOOTHING : inst;
    }
    s.lastProgress = progress;
    s.lastAt = nowMs;
  } else if (dt > ETA_STALL_SEC) {
    // Progress has not moved for long enough that this is a genuine stall
    // rather than a render frame that simply outran the 30 Hz sim tick.
    //
    // The distinction matters: the HUD samples at frame rate, so during a
    // perfectly healthy build most samples show no change at all. Folding those
    // in as zero would halve the measured rate and the countdown would read
    // roughly double. Hence a dwell rather than an immediate decay.
    s.rate = RATE_STALLED;
  }

  const remaining = 1 - progress;
  if (s.rate > 1e-5) {
    const secs = remaining / s.rate;
    return secs > ETA_MAX_SECONDS ? 0 : Math.ceil(secs);
  }
  // Stalled: show nothing. ON HOLD and EVA already say so, and a countdown
  // frozen at "5s" while nothing happens is the reported bug.
  if (s.rate === RATE_STALLED) return 0;

  // No usable sample yet. The nominal time is the best guess available, and it
  // is right whenever nothing is throttling the build — the common case in the
  // first frames after queueing.
  return buildTime > 0 ? Math.ceil(buildTime * remaining) : 0;
}

/** Stance buttons, in display order. */
const STANCES: ReadonlyArray<readonly [Stance, IconName, string]> = [
  [Stance.Aggressive, 'stanceAggressive', 'Aggressive'],
  [Stance.Defensive, 'stanceDefensive', 'Defensive'],
  [Stance.HoldGround, 'stanceHoldGround', 'Hold ground'],
  [Stance.HoldFire, 'stanceHoldFire', 'Hold fire'],
];

/** Power pressure, derived once and used by the strip and the status board. */
export type PowerState = 'ok' | 'tight' | 'down';

export function powerStateOf(produced: number, consumed: number, brownout: boolean): PowerState {
  if (brownout || consumed > produced) return 'down';
  if (produced > 0 && consumed / produced > 0.86) return 'tight';
  return 'ok';
}

const POWER_WORDS: Readonly<Record<PowerState, string>> = {
  ok: 'Optimal',
  tight: 'Strained',
  down: 'Brownout',
};

/* ==========================================================================
 * SECTION 2 — THE RESOURCE STRIP  (top centre)
 *
 * Six labelled cells. The three on the left are the ones a decision depends on
 * — money, power headroom, elapsed time — and the three on the right are
 * telltales: how big is my army, how big is my base, how fast is money coming
 * in. Each carries a word, because the previous strip was a coin, a bolt and a
 * clock, and nothing told a new player which number was which.
 * ========================================================================== */

export class ResourceStrip {
  readonly root: HTMLElement;

  private readonly creditsNode: Text;
  private readonly deltaEl: HTMLElement;
  private readonly deltaNode: Text;
  private readonly powerEl: HTMLElement;
  private readonly powerNode: Text;
  private readonly stateEl: HTMLElement;
  private readonly stateNode: Text;
  private readonly segments: HTMLElement[] = [];
  private readonly clockNode: Text;
  private readonly armyNode: Text;
  private readonly baseNode: Text;
  private readonly incomeEl: HTMLElement;
  private readonly incomeNode: Text;

  private readonly counter = new RollingCounter();
  /** Seconds since the last credit flyout, or a large number when idle. */
  private deltaAge = 1e9;
  private lastLit = -1;
  private lastState: PowerState | '' = '';
  private lastClock = '';
  private lastPower = '';
  private lastArmy = -1;
  private lastBase = -1;
  private lastIncome = '';

  constructor(parent: HTMLElement) {
    this.root = panel(parent, 'vm-resources', 'ends');
    this.root.setAttribute('role', 'status');

    /* -- the crest ------------------------------------------------------ *
     * The reference anchors its top strip with a faction crest, and it is the
     * one piece of the whole interface whose job is identity rather than
     * information. It is drawn from `icons.ts` like everything else and takes
     * its colour from `--vm-accent-hi`, so a faction swap recolours it and
     * nothing here knows a faction exists. */
    this.root.appendChild(makeIcon('crest', 'vm-icon vm-res-crest'));
    el('span', 'vm-res-rule', this.root);

    /* -- credits ------------------------------------------------------- */
    const credits = el('div', 'vm-res vm-res-credits', this.root);
    credits.appendChild(makeIcon('credits', 'vm-icon vm-res-icon'));
    const cBody = el('div', 'vm-res-body', credits);
    label(cBody, 'vm-res-label', 'Credits');
    this.creditsNode = label(cBody, 'vm-res-value vm-num', '0');
    this.deltaEl = el('span', 'vm-res-delta vm-num', credits);
    this.deltaNode = textNode(this.deltaEl);
    this.deltaEl.hidden = true;

    el('span', 'vm-res-rule', this.root);

    /* -- power ---------------------------------------------------------
     * DRAW / SUPPLY, a segmented load meter and a state word. `+0` was
     * technically the surplus and told the player nothing: it does not say how
     * much headroom there is, and it never said that a deficit is what is
     * quietly halving every build time in the base.
     * ------------------------------------------------------------------ */
    const power = el('div', 'vm-res vm-res-power', this.root);
    power.appendChild(makeIcon('bolt', 'vm-icon vm-res-icon'));
    const pBody = el('div', 'vm-res-body', power);
    label(pBody, 'vm-res-label', 'Power  draw / supply');
    const pLine = el('div', 'vm-power-line', pBody);
    const meter = el('div', 'vm-power', pLine);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', 'Power load');
    for (let i = 0; i < POWER_SEGMENTS; i++) {
      this.segments.push(el('i', 'vm-power-seg', meter));
    }
    this.powerEl = el('span', 'vm-res-value vm-num vm-power-value', pLine);
    this.powerNode = textNode(this.powerEl, '0/0');
    this.stateEl = el('span', 'vm-power-state', pLine);
    this.stateNode = textNode(this.stateEl, POWER_WORDS.ok);

    el('span', 'vm-res-rule', this.root);

    /* -- clock --------------------------------------------------------- */
    const clock = el('div', 'vm-res vm-res-clock', this.root);
    clock.appendChild(makeIcon('clock', 'vm-icon vm-res-icon'));
    const tBody = el('div', 'vm-res-body', clock);
    label(tBody, 'vm-res-label', 'Time');
    this.clockNode = label(tBody, 'vm-res-value vm-num', '00:00');

    el('span', 'vm-res-rule is-tell', this.root);

    /* -- telltales ------------------------------------------------------ */
    this.armyNode = textNode(this.buildTell('army', 'Army'), '0');
    this.baseNode = textNode(this.buildTell('base', 'Base'), '0');
    this.incomeEl = this.buildTell('trend', 'Income / min');
    this.incomeNode = textNode(this.incomeEl, '0');
  }

  /** One telltale cell. Returns its value span so the caller can restyle it. */
  private buildTell(icon: IconName, name: string): HTMLElement {
    const cell = el('div', `vm-res vm-res-tell vm-res-${icon}`, this.root);
    cell.appendChild(makeIcon(icon, 'vm-icon vm-res-icon'));
    const body = el('div', 'vm-res-body', cell);
    label(body, 'vm-res-label', name);
    return el('span', 'vm-res-value vm-num', body);
  }

  /** Jump the counter — match start, or a faction swap. */
  reset(credits: number): void {
    this.counter.reset(credits);
    this.creditsNode.nodeValue = formatCredits(credits);
  }

  /** Raise the +/- flyout above the credits readout. */
  flyout(delta: number): void {
    const rounded = Math.round(delta);
    if (rounded === 0) return;
    this.deltaNode.nodeValue = `${rounded > 0 ? '+' : ''}${rounded}`;
    this.deltaEl.classList.toggle('is-gain', rounded > 0);
    this.deltaEl.hidden = false;
    // Restart the animation even when one is already running.
    this.deltaEl.classList.remove('is-live');
    void this.deltaEl.offsetWidth;
    this.deltaEl.classList.add('is-live');
    this.deltaAge = 0;
  }

  update(snap: HudSnapshot, tele: HudTelemetry, dt: number): void {
    /* -- credits ------------------------------------------------------- */
    this.counter.setTarget(snap.credits);
    if (this.counter.step(dt)) {
      this.creditsNode.nodeValue = formatCredits(this.counter.value);
    }
    if (this.deltaAge < 1e8) {
      this.deltaAge += dt;
      if (this.deltaAge > 0.8) {
        this.deltaAge = 1e9;
        this.deltaEl.hidden = true;
        this.deltaEl.classList.remove('is-live');
      }
    }

    /* -- power --------------------------------------------------------- */
    const produced = Math.max(0, Math.round(snap.powerProduced));
    const consumed = Math.max(0, Math.round(snap.powerConsumed));
    // The meter shows DRAW against SUPPLY. A full bar means the next structure
    // browns you out — which is precisely the moment the player must notice.
    const load = produced <= 0 ? (consumed > 0 ? 1 : 0) : Math.min(1, consumed / produced);
    const lit = Math.min(POWER_SEGMENTS, Math.round(load * POWER_SEGMENTS));
    const state = powerStateOf(produced, consumed, snap.brownout);

    if (lit !== this.lastLit || state !== this.lastState) {
      this.lastLit = lit;
      for (let i = 0; i < POWER_SEGMENTS; i++) {
        this.segments[i].classList.toggle('is-lit', i < lit);
      }
    }
    if (state !== this.lastState) {
      this.lastState = state;
      const mod = state === 'ok' ? '' : state === 'tight' ? 'is-tight' : 'is-down';
      this.powerEl.className = `vm-res-value vm-num vm-power-value ${mod}`;
      this.stateEl.className = `vm-power-state ${mod}`;
      this.stateNode.nodeValue = POWER_WORDS[state];
      this.root.classList.toggle('is-brownout', state === 'down');
    }
    const powerText = `${consumed}/${produced}`;
    if (powerText !== this.lastPower) {
      this.lastPower = powerText;
      this.powerNode.nodeValue = powerText;
    }

    /* -- clock --------------------------------------------------------- */
    const clock = formatElapsed(snap.gameTimeSec);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clockNode.nodeValue = clock;
    }

    /* -- telltales ------------------------------------------------------ */
    if (tele.army !== this.lastArmy) {
      this.lastArmy = tele.army;
      this.armyNode.nodeValue = String(tele.army);
    }
    if (tele.structures !== this.lastBase) {
      this.lastBase = tele.structures;
      this.baseNode.nodeValue = String(tele.structures);
    }
    const income = formatRate(tele.incomePerMin);
    if (income !== this.lastIncome) {
      this.lastIncome = income;
      this.incomeNode.nodeValue = income;
      this.incomeEl.classList.toggle('is-live', tele.incomePerMin > 5);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 3 — THE SELECTION CARD  (bottom centre)
 *
 * Laid out the way docs/refs/target-hud.png lays it out: the NAME in caps with
 * a rule running right from it, the cameo on the left, the description on the
 * right, and a full-width health bar along the bottom with the absolute hit
 * points laid over it.
 *
 * WHAT THE BASE STATUS BOARD WAS, AND WHY IT IS GONE
 * -------------------------------------------------
 * With nothing selected this dock used to fill the whole 106-unit band with a
 * board reading ARMY / STRUCTURES / POWER / INCOME / CREDITS plus one line of
 * advice. Every one of those five numbers is already in the resource strip at
 * the top of the frame, and the board measured ~47% empty — it was the single
 * largest redundant area in the interface, in the widest dock of the band.
 *
 * All that survives is the advice, because that IS new information: it is
 * derived in `Hud.buildTelemetry` from the world and from the HUD's own event
 * subscriptions, and nothing else in the frame says "your power is tight" in a
 * sentence. It is now one 13-unit line, and the dock shrinks to fit it.
 * ========================================================================== */

interface CardCell {
  root: HTMLButtonElement;
  icon: SVGSVGElement;
  bar: HTMLElement;
  nameNode: Text;
  stackEl: HTMLElement;
  stackNode: Text;
  vetEl: HTMLElement;
  id: number;
  sig: string;
}

/** Shown in place of the advice when the base is nominal. */
const IDLE_HINT = 'Select a unit or a structure to command it';

class SelectionPanel {
  readonly root: HTMLElement;

  private readonly live: HTMLElement;
  private readonly idle: HTMLElement;

  private readonly titleNode: Text;
  private readonly subtitleNode: Text;
  private readonly countEl: HTMLElement;
  private readonly countNode: Text;
  private readonly chevrons: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly hpTextNode: Text;
  /** The bar's wrapper, so the self-repair sweep can be toggled on it rather
   *  than on the inner fill — the fill carries a `scaleX`, which would squash
   *  a sweeping highlight into whatever the current health fraction is. */
  private readonly hpRoot: HTMLElement;
  private readonly mendTag: HTMLElement;
  private readonly cardRow: HTMLElement;
  private readonly cards: CardCell[] = [];
  private readonly statValues: Text[] = [];
  private readonly statChips: HTMLElement[] = [];
  private readonly stanceRow: HTMLElement;
  private readonly stanceLabelNode: Text;
  private readonly stanceButtons: HTMLButtonElement[] = [];
  private readonly relocateRow: HTMLElement;
  private readonly relocateButton: HTMLButtonElement;
  private readonly relocateCostNode: Text;
  private readonly abilityRow: HTMLElement;
  private readonly abilityButton: HTMLButtonElement;
  private readonly abilityLabelNode: Text;
  private readonly abilityNameNode: Text;

  /** The idle advisory line — all that is left of the status board. */
  private readonly adviceNode: Text;
  private lastAdvice = '';

  private empty = true;
  private lastTitle = '';
  private lastSubtitle = '';
  private lastCount = -1;
  private lastVet = -1;
  private lastStance = -2;
  private lastHp = '';
  private lastMending = false;
  private liveCards = 0;
  private lastRelocate = '';
  private lastAbility = '';

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-dock vm-dock-selection', 'diag');
    this.root.dataset.brackets = 'on';
    this.root.setAttribute('aria-label', 'Selection');
    this.root.classList.add('is-empty');

    this.live = el('div', 'vm-sel-live', this.root);
    this.idle = el('div', 'vm-sel-idle', this.root);

    /* -- the name row -------------------------------------------------- *
     * Name, veterancy, then a rule running right to the count and the verbs.
     * The rule is the reference's one consistent header device and it is what
     * ties this panel to the objectives panel and the build palette. */
    const head = el('div', 'vm-sel-head', this.live);
    const idBlock = el('div', 'vm-sel-id', head);
    this.titleNode = label(idBlock, 'vm-sel-title');
    this.chevrons = el('span', 'vm-sel-vet', idBlock);
    for (let i = 0; i < 2; i++) {
      this.chevrons.appendChild(makeIcon('veterancy', 'vm-icon vm-sel-chevron'));
    }
    this.chevrons.hidden = true;

    el('i', 'vm-sel-rule', head);

    this.countEl = el('div', 'vm-sel-count vm-num', head);
    this.countNode = textNode(this.countEl, '0');
    this.countEl.hidden = true;

    /* -- the verbs, in the head's right end ---------------------------- *
     * Stance and Relocate are mutually exclusive in practice — the stance row
     * is hidden for a selection that cannot move, which is exactly the
     * selection Relocate applies to — so they share the slot and whichever is
     * relevant is the one that is there.
     *
     * The classes are `vm-stances` / `vm-stance-label` / `vm-stance` on
     * purpose: the relocate row IS the stance row's layout and needs no
     * stylesheet of its own. */
    this.stanceRow = el('div', 'vm-stances', head);
    this.stanceRow.setAttribute('role', 'radiogroup');
    this.stanceRow.setAttribute('aria-label', 'Stance');
    this.stanceLabelNode = label(this.stanceRow, 'vm-stance-label', 'Stance');
    for (const [stance, icon, name] of STANCES) {
      const b = button(this.stanceRow, 'vm-stance', name);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.title = name;
      b.appendChild(makeIcon(icon, 'vm-icon'));
      b.addEventListener('pointerenter', () => this.cb.sound('hover'));
      b.addEventListener('click', () => {
        this.cb.sound('click');
        this.cb.setStance(stance);
      });
      this.stanceButtons.push(b);
    }

    this.relocateRow = el('div', 'vm-stances', head);
    // "Relocate", not "Move": every other surface — the tooltip, the toast, the
    // refusal sentences — uses that word, and a control whose label disagrees
    // with its own tooltip is a control the player has to read twice.
    label(this.relocateRow, 'vm-stance-label', 'Relocate');
    this.relocateButton = button(this.relocateRow, 'vm-stance', 'Relocate structure');
    this.relocateButton.style.width = 'auto';
    this.relocateButton.style.gap = 'calc(3 * var(--vm-u))';
    this.relocateButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.relocateButton.appendChild(makeIcon('deploy', 'vm-icon'));
    this.relocateCostNode = label(this.relocateButton, 'vm-num', '0');
    this.relocateRow.hidden = true;
    this.relocateButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.relocateButton.addEventListener('click', () => {
      // Dimmed, never `disabled` — the same rule the locked build slot follows.
      // A control that goes unhoverable cannot explain itself, and "why can I
      // not move my Construction Yard" is the whole question the hint answers.
      if (this.relocateButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.relocate();
    });

    /* -- the commander's ability --------------------------------------- *
     * A third occupant of the same slot. It is NOT mutually exclusive with the
     * stance row the way Relocate is — a commander is a mobile unit and takes a
     * stance like any other — so this row sits under it rather than instead of
     * it, and is hidden for the 43 units out of 44 that have no ability.
     *
     * The label carries the ability's NAME rather than a generic "Ability",
     * because the four are genuinely different verbs and a player switching
     * armies has to learn which one they now have. When it is cooling the same
     * node prints the seconds instead — one node, two states, no layout shift. */
    this.abilityRow = el('div', 'vm-stances vm-ability-row', head);
    this.abilityLabelNode = label(this.abilityRow, 'vm-stance-label', 'Ability');
    this.abilityButton = button(this.abilityRow, 'vm-stance vm-ability', 'Use ability');
    this.abilityButton.style.width = 'auto';
    this.abilityButton.style.gap = 'calc(3 * var(--vm-u))';
    this.abilityButton.style.padding = '0 calc(4 * var(--vm-u))';
    this.abilityButton.appendChild(makeIcon('veterancy', 'vm-icon'));
    this.abilityNameNode = label(this.abilityButton, '', '');
    this.abilityRow.hidden = true;
    this.abilityButton.addEventListener('pointerenter', () => this.cb.sound('hover'));
    this.abilityButton.addEventListener('click', () => {
      // Dimmed, never `disabled`, for the reason spelled out on Relocate above.
      if (this.abilityButton.getAttribute('aria-disabled') === 'true') {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.useAbility();
    });

    /* -- the body: cameo left, description right ----------------------- */
    const body = el('div', 'vm-sel-body', this.live);

    this.cardRow = el('div', 'vm-sel-cards', body);
    this.cardRow.setAttribute('role', 'listbox');
    this.cardRow.setAttribute('aria-label', 'Selected units');
    for (let i = 0; i < CARD_POOL; i++) this.cards.push(this.buildCard());

    const info = el('div', 'vm-sel-info', body);
    this.subtitleNode = label(info, 'vm-sel-sub');

    const stats = el('div', 'vm-sel-stats', info);
    const STAT_SPEC: ReadonlyArray<readonly [IconName, string, string]> = [
      ['armour', 'Armour', 'Arm'],
      ['damage', 'Damage per second', 'Dps'],
      ['range', 'Weapon range', 'Rng'],
      ['speed', 'Movement speed', 'Spd'],
    ];
    for (const [icon, title, key] of STAT_SPEC) {
      const chip = el('div', 'vm-stat', stats);
      chip.title = title;
      chip.appendChild(makeIcon(icon, 'vm-icon vm-stat-icon'));
      label(chip, 'vm-stat-key', key);
      this.statValues.push(label(chip, 'vm-stat-value vm-num', '—'));
      this.statChips.push(chip);
    }

    /* -- the health bar ------------------------------------------------ *
     * Full width along the bottom with the absolute hit points laid over it,
     * exactly as the reference draws it. The old panel put a 54-unit stub and
     * a right-aligned number in the header, where it competed with the name
     * for the eye and lost. Absolute points, not an average of fractions:
     * twelve conscripts and one Apocalypse at 60% are not the same army, and
     * how much punishment the GROUP can still take is the question. */
    const hp = el('div', 'vm-sel-hp', this.live);
    this.hpRoot = hp;
    const hpTrack = el('span', 'vm-sel-hp-track', hp);
    this.hpBar = el('i', '', hpTrack);
    this.hpTextNode = label(hp, 'vm-sel-hp-text vm-num', '');
    /* SELF-REPAIR, said in a word.
     *
     * The player reported idle healing as invisible. `src/ui/Overlay.ts` marks
     * it on the world bar for every unit; this is the same fact on the panel the
     * player is already looking at when they have the unit selected. The sweep
     * animation on `.vm-sel-hp.is-regen` carries it at a glance and this tag is
     * what makes it unambiguous — a moving highlight alone could be read as a
     * loading state. */
    this.mendTag = el('span', 'vm-sel-hp-mend', hp);
    this.mendTag.textContent = 'Repairing';
    this.mendTag.hidden = true;

    /* -- the idle advisory --------------------------------------------- */
    this.idle.appendChild(makeIcon('info', 'vm-icon'));
    this.adviceNode = label(this.idle, 'vm-sel-advice', IDLE_HINT);
  }

  private buildCard(): CardCell {
    const root = button(this.cardRow, 'vm-card', 'Unit');
    root.setAttribute('role', 'option');
    root.setAttribute('aria-selected', 'false');
    root.hidden = true;

    const icon = makeIcon('tank', 'vm-icon vm-card-icon');
    root.appendChild(icon);

    const nameNode = label(root, 'vm-card-name', '');

    const stackEl = el('span', 'vm-card-stack vm-num', root);
    const stackNode = textNode(stackEl);
    stackEl.hidden = true;

    const vetEl = el('span', 'vm-card-vet', root);
    vetEl.hidden = true;

    const barTrack = el('span', 'vm-card-bar', root);
    const bar = el('i', 'is-ok', barTrack);

    const cell: CardCell = { root, icon, bar, nameNode, stackEl, stackNode, vetEl, id: 0, sig: '' };

    root.addEventListener('pointerenter', () => this.cb.sound('hover'));
    root.addEventListener('click', (ev) => {
      this.cb.sound('click');
      this.cb.focusCard(cell.id, ev.shiftKey || ev.ctrlKey);
    });
    return cell;
  }

  update(view: SelectionView, _snap: HudSnapshot, tele: HudTelemetry): void {
    const empty = view.count === 0;
    if (empty !== this.empty) {
      this.empty = empty;
      this.root.classList.toggle('is-empty', empty);
      this.root.setAttribute('aria-label', empty ? 'Base advisory' : 'Selection');
    }
    if (empty) {
      for (let i = 0; i < this.liveCards; i++) this.cards[i].root.hidden = true;
      this.liveCards = 0;
      // The whole live half is display:none while empty, but the row is left in
      // a clean state so re-selecting the same structure cannot flash a stale
      // price for one frame.
      if (!this.relocateRow.hidden) {
        this.relocateRow.hidden = true;
        this.lastRelocate = '';
      }
      if (!this.abilityRow.hidden) {
        this.abilityRow.hidden = true;
        this.lastAbility = '';
      }
      this.updateAdvice(tele);
      return;
    }

    if (view.title !== this.lastTitle) {
      this.lastTitle = view.title;
      this.titleNode.nodeValue = view.title;
    }
    if (view.subtitle !== this.lastSubtitle) {
      this.lastSubtitle = view.subtitle;
      this.subtitleNode.nodeValue = view.subtitle;
    }
    if (view.count !== this.lastCount) {
      this.lastCount = view.count;
      this.countNode.nodeValue = `x${view.count}`;
      this.countEl.hidden = view.count < 2;
    }
    if (view.veterancy !== this.lastVet) {
      this.lastVet = view.veterancy;
      const kids = this.chevrons.children;
      for (let i = 0; i < kids.length; i++) {
        (kids[i] as HTMLElement).hidden = i >= view.veterancy;
      }
      this.chevrons.hidden = view.veterancy <= 0;
    }

    /* -- aggregate health ---------------------------------------------- */
    if (view.hpText !== this.lastHp) {
      this.lastHp = view.hpText;
      this.hpTextNode.nodeValue = view.hpText;
      const f = Math.max(0, Math.min(1, view.hpFrac));
      this.hpBar.style.transform = `scaleX(${f.toFixed(3)})`;
      this.hpBar.className = f > 0.6 ? '' : f > 0.3 ? 'is-hurt' : 'is-critical';
    }
    // Guarded separately from `hpText`: at 2.5%/s the hit-point STRING can go
    // several frames without changing, and the tag has to appear on the tick
    // the healing starts rather than on the next whole point of hp.
    if (view.mending !== this.lastMending) {
      this.lastMending = view.mending;
      this.hpRoot.classList.toggle('is-regen', view.mending);
      this.mendTag.hidden = !view.mending;
    }

    /* -- cards --------------------------------------------------------- */
    const n = Math.min(view.cardCount, CARD_POOL);
    for (let i = 0; i < n; i++) {
      const cell = this.cards[i];
      const data = view.cards[i];
      cell.id = data.id;

      const pct = Math.max(0, Math.min(1, data.hpFrac));
      const sig = `${data.icon}|${data.name}|${(pct * 100) | 0}|${data.stack}|` +
        `${data.veterancy}|${data.primary ? 1 : 0}`;
      if (sig === cell.sig && !cell.root.hidden) continue;
      cell.sig = sig;

      cell.root.hidden = false;
      cell.root.setAttribute('aria-label', data.name);
      cell.root.setAttribute('aria-selected', data.primary ? 'true' : 'false');
      cell.root.classList.toggle('is-primary', data.primary);
      setIcon(cell.icon, data.icon);
      cell.nameNode.nodeValue = data.name;

      cell.bar.style.transform = `scaleX(${pct.toFixed(3)})`;
      cell.bar.className = pct > 0.6 ? 'is-ok' : pct > 0.3 ? 'is-hurt' : 'is-critical';

      if (data.stack > 1) {
        cell.stackNode.nodeValue = `x${data.stack}`;
        cell.stackEl.hidden = false;
      } else {
        cell.stackEl.hidden = true;
      }

      cell.vetEl.hidden = data.veterancy <= 0;
      if (data.veterancy > 0) cell.vetEl.dataset.rank = String(data.veterancy);
    }
    for (let i = n; i < this.liveCards; i++) {
      this.cards[i].root.hidden = true;
      this.cards[i].sig = '';
    }
    this.liveCards = n;

    /* -- stats --------------------------------------------------------- */
    this.setStat(0, view.armour);
    this.setStat(1, view.damage);
    this.setStat(2, view.range);
    this.setStat(3, view.speed);

    /* -- stance -------------------------------------------------------- */
    const stance = view.stanceEnabled ? (view.stance as number) : -1;
    if (stance !== this.lastStance) {
      this.lastStance = stance;
      this.stanceRow.hidden = !view.stanceEnabled;
      let name = 'Mixed';
      for (let i = 0; i < this.stanceButtons.length; i++) {
        const on = (STANCES[i][0] as number) === stance;
        if (on) name = STANCES[i][2];
        this.stanceButtons[i].classList.toggle('is-active', on);
        this.stanceButtons[i].setAttribute('aria-checked', on ? 'true' : 'false');
      }
      this.stanceLabelNode.nodeValue = stance < 0 ? 'Stance' : name;
    }

    this.updateRelocate(view.relocate);
    this.updateAbility(view.ability);
  }

  /**
   * The commander's ability button.
   *
   * Signature-gated like every other row here, and the signature deliberately
   * quantises the cooldown to WHOLE SECONDS. The raw value changes every frame,
   * so a signature carrying it would defeat the gate entirely and rewrite three
   * DOM nodes 60 times a second for a label that only ever shows integers.
   */
  private updateAbility(action: AbilityAction): void {
    const secs = Math.ceil(action.cooldown);
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.label}|${secs}|${action.hint}`
      : '';
    if (sig === this.lastAbility) return;
    this.lastAbility = sig;

    this.abilityRow.hidden = !action.visible;
    if (!action.visible) return;

    const cooling = secs > 0;
    this.abilityLabelNode.nodeValue = cooling ? 'Cooling' : 'Ability';
    this.abilityNameNode.nodeValue = cooling ? `${secs}s` : action.label;
    this.abilityButton.title = action.hint;
    this.abilityButton.setAttribute('aria-label', `${action.label} — ${action.hint}`);
    this.abilityButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.abilityButton.classList.toggle('is-cooling', cooling);
    this.abilityButton.style.opacity = action.enabled ? '1' : '0.4';
  }

  /**
   * The Relocate button.
   *
   * Signature-gated like every other row in this panel: a steady selection
   * performs no DOM writes at all, which matters because this runs every frame
   * and the price it prints is recomputed from the sim every frame.
   */
  private updateRelocate(action: RelocateAction): void {
    const sig = action.visible
      ? `${action.enabled ? 1 : 0}|${action.cost}|${action.hint}|${action.armed ? 1 : 0}`
      : '';
    if (sig === this.lastRelocate) return;
    this.lastRelocate = sig;

    this.relocateRow.hidden = !action.visible;
    if (!action.visible) return;

    this.relocateCostNode.nodeValue = formatCredits(action.cost);
    this.relocateButton.title = action.hint;
    this.relocateButton.setAttribute('aria-label', action.hint);
    this.relocateButton.setAttribute('aria-disabled', action.enabled ? 'false' : 'true');
    this.relocateButton.classList.toggle('is-active', action.armed);
    this.relocateButton.style.opacity = action.enabled ? '1' : '0.4';
  }

  /**
   * The one line the status board left behind.
   *
   * A nominal base has nothing to report, so it gets the hint instead — a
   * sentence that teaches the panel rather than one that says "everything is
   * fine" in a slot the player has already learned to ignore.
   */
  private updateAdvice(tele: HudTelemetry): void {
    const nominal = tele.adviceKind === 'info';
    const text = nominal ? IDLE_HINT : tele.advice;
    const sig = `${text}|${tele.adviceKind}`;
    if (sig === this.lastAdvice) return;
    this.lastAdvice = sig;
    this.adviceNode.nodeValue = text;
    this.idle.className = `vm-sel-idle${nominal ? '' : ` is-${tele.adviceKind}`}`;
  }

  private setStat(i: number, value: string): void {
    const node = this.statValues[i];
    const next = value === '' ? '—' : value;
    if (node.nodeValue === next) return;
    node.nodeValue = next;
    this.statChips[i].classList.toggle('is-blank', value === '');
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 4 — THE BUILD PALETTE  (bottom right)
 *
 * The reference's tab strip RISES ABOVE the panel body: the notched tabs sit
 * on top of the palette rather than inside it. That cannot be done from inside
 * one clipped box, so `.vm-dock-build` is a bare container holding the strip
 * and then `.vm-build-body`, which is the panel. Both class names are
 * unchanged, which matters — `src/shell/tutorial-steps.ts` spotlights
 * `.vm-dock-build` and `.vm-dock-build .vm-grid`.
 * ========================================================================== */

/** Why a slot cannot be clicked right now. Drives the banner and its colour. */
type BlockKind = '' | 'tech' | 'funds' | 'power';

/**
 * Classify a production `reason` string into one of three banners.
 *
 * The strings come from `src/sim/Production.ts`, which is not ours and is free
 * to reword them, so this is deliberately keyword matching with a safe default
 * rather than an equality table: an unrecognised sentence still shows LOCKED and
 * still puts the full text in the tooltip.
 */
function blockKindOf(reason: string): BlockKind {
  if (reason === '') return '';
  const r = reason.toLowerCase();
  // TECH IS TESTED FIRST, and specifically before `power`. "Requires Power
  // Plant" is a missing prerequisite, not a power shortage — matching on the
  // bare word "power" labelled half the Allied structure tab POWER in amber
  // when the player's grid was at 280 of 400 and perfectly healthy.
  if (r.includes('require') || r.includes('need') || r.includes('build ')) return 'tech';
  if (r.includes('fund') || r.includes('credit') || r.includes('afford')) return 'funds';
  if (r.includes('power') || r.includes('brownout')) return 'power';
  return 'tech';
}

const BLOCK_WORDS: Readonly<Record<Exclude<BlockKind, ''>, string>> = {
  tech: 'Locked',
  funds: 'Funds',
  power: 'Power',
};

interface BuildSlot {
  root: HTMLButtonElement;
  icon: SVGSVGElement;
  costNode: Text;
  keyEl: HTMLElement;
  keyNode: Text;
  queueEl: HTMLElement;
  queueNode: Text;
  readyEl: HTMLElement;
  etaEl: HTMLElement;
  etaNode: Text;
  /** The 3D cameo surface. Hidden until a model actually binds to it. */
  cameoCanvas: HTMLCanvasElement;
  /** "how many of these do I already have" — see `vm-slot-owned`. */
  ownedEl: HTMLElement;
  ownedNode: Text;
  flagEl: HTMLElement;
  flagNode: Text;
  progress: HTMLElement;
  /** The live cameo this slot renders, or null when the slot is empty. */
  cameo: HudCameo | null;
  /** Cached state, so a steady slot performs no DOM writes at all. */
  sig: string;
  key: string;
  /** Build time in seconds for `key`, resolved once per content change. */
  buildTime: number;

  /* -- observed build rate, for an honest countdown -------------------------
   * The countdown used to be `buildTime * (1 - progress)`, which is the time a
   * build takes at its NOMINAL rate. Three things move the real rate and the
   * formula knew about none of them:
   *
   *   - `player.buildSpeedMul`, a continuous function of the power supply ratio
   *     (`src/sim/Power.ts`), so a brownout stretches every build;
   *   - `factorySpeed(factoryCount)`, which makes builds FASTER with more
   *     factories;
   *   - affordability. `BuildQueue` charges per tick and advances only the
   *     slice it managed to pay for: "a poor player does not stop - they crawl.
   *     A tick that can only afford 40% of its increment advances 40% of its
   *     increment." Deliberate, and invisible to a nominal countdown.
   *
   * Two of those three make a build take LONGER than advertised, which is the
   * report: "the timer shows 5s but takes twice and more". Rather than mirror
   * the sim's rate arithmetic up here — a second copy of a formula that would
   * drift the first time either changes — the slot MEASURES how fast progress
   * is actually moving and extrapolates. That is correct for every cause at
   * once, including causes added later.
   * ---------------------------------------------------------------------- */
  /** `progress` at the previous sample, or -1 when there is no sample yet. */
  lastProgress: number;
  /** `performance.now()` of that sample. Render-side only; never the sim. */
  lastAt: number;
  /** Smoothed progress-per-second. 0 until two samples exist. */
  rate: number;
}

class BuildPanel {
  readonly root: HTMLElement;

  private readonly tabs: HTMLButtonElement[] = [];
  private readonly tabAlerts: HTMLElement[] = [];
  private readonly grid: HTMLElement;
  private readonly slots: BuildSlot[] = [];
  private readonly tools: HTMLButtonElement[] = [];
  private readonly tooltip: Tooltip;

  private activeTab: BuildTab = BuildTab.Structures;
  private armed: ArmedMode = 'none';
  private extras: ((key: string) => BuildExtras) | null = null;
  private liveSlots = 0;

  /**
   * Renders each slot's ACTUAL MODEL into its canvas. Null in any build with no
   * GL context; the flat glyph underneath is the fallback and must keep working.
   */
  private cameos: CameoRenderer | null = null;
  /** Whose colours the cameos wear. Kept in step by `setFaction`. */
  private faction: Faction;

  constructor(
    parent: HTMLElement,
    private readonly cb: SidebarCallbacks,
    tipHost: HTMLElement,
    faction: Faction = Faction.Allies,
    renderer: THREE.WebGLRenderer | null = null,
  ) {
    this.faction = faction;
    if (renderer !== null) {
      try {
        this.cameos = new CameoRenderer(renderer);
        this.cameos.setModelProvider(createCameoModelProvider());
      } catch (err) {
        console.warn('[hud] cameo renderer unavailable; slots keep their glyphs', err);
        this.cameos = null;
      }
    }
    this.root = el('div', 'vm-dock vm-dock-build', parent);
    this.root.setAttribute('aria-label', 'Construction');
    this.tooltip = new Tooltip(tipHost);

    /* -- tab strip, above the body ------------------------------------- */
    const strip = el('div', 'vm-tabs', this.root);
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Build categories');

    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const tab = t as BuildTab;
      const b = button(strip, `vm-tab${t === 0 ? ' is-active' : ''}`, TAB_LABELS[t]);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t === 0 ? 'true' : 'false');
      b.tabIndex = t === 0 ? 0 : -1;
      b.title = `${TAB_LABELS[t]}  (${TAB_HOTKEY_LABELS[t]})`;
      // The word and the key badge, one line, no icon. The icon-over-label
      // stack cost 22 design units of band height to draw a picture that the
      // word beside it already said — and the band is the thing this redesign
      // had to give back. The badge stays paired with the word for the reason
      // it was paired with the icon: a badge floating in the gutter between two
      // tabs is owned by neither.
      label(b, 'vm-hk', TAB_HOTKEY_LABELS[t]);
      label(b, 'vm-tab-label', TAB_SHORT[t]);
      const alert = el('span', 'vm-tab-alert', b);
      alert.hidden = true;
      this.tabAlerts.push(alert);

      b.addEventListener('pointerenter', () => this.cb.sound('hover'));
      b.addEventListener('click', () => {
        this.cb.sound('tab');
        this.cb.selectTab(tab);
      });
      b.addEventListener('keydown', (ev) => this.onTabKey(ev, t));
      this.tabs.push(b);
    }

    /* -- tools (repair / sell) ----------------------------------------- */
    const toolRow = el('div', 'vm-tools', strip);
    const TOOLS: ReadonlyArray<readonly [ArmedMode, IconName, string]> = [
      ['repair', 'repair', 'Repair structure — click a damaged building'],
      ['sell', 'sell', 'Sell structure — click a building to refund it'],
    ];
    for (const [mode, icon, name] of TOOLS) {
      const b = button(toolRow, 'vm-tool', name);
      b.title = name;
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(makeIcon(icon, 'vm-icon'));
      b.addEventListener('pointerenter', () => this.cb.sound('hover'));
      b.addEventListener('click', () => {
        this.cb.sound('click');
        const next: ArmedMode = this.armed === mode ? 'none' : mode;
        this.setArmed(next);
        this.cb.setArmed(next);
      });
      this.tools.push(b);
    }

    /* -- the panel body, under the strip -------------------------------- */
    const body = panel(this.root, 'vm-build-body', 'diag');
    body.dataset.brackets = 'on';

    /* -- slot grid ----------------------------------------------------- */
    this.grid = el('div', 'vm-grid', body);
    this.grid.setAttribute('role', 'grid');
    this.grid.style.setProperty('--vm-grid-cols', String(BUILD_COLUMNS));
    for (let i = 0; i < BUILD_COLUMNS * BUILD_ROWS; i++) this.slots.push(this.buildSlot(i));
  }

  get slotCount(): number { return this.slots.length; }

  /**
   * Point a slot's canvas at the model for the content it now holds.
   *
   * Called only when a slot's CONTENT changes — a tab switch or a roster
   * rebuild — never per frame. `CameoRenderer` renders a bound cameo once and
   * then never again unless it is hovered or invalidated.
   *
   * The canvas is revealed only on a successful bind, so a def whose model does
   * not resolve leaves it hidden and the flat glyph showing. That is the right
   * answer for the placeholder and for anything the art libraries have not
   * registered — and it is why this cannot make the sidebar worse than it was.
   */
  private bindCameo(slot: BuildSlot, c: HudCameo): void {
    const cameos = this.cameos;
    if (cameos === null) return;
    const subject: CameoSubject = {
      key: c.key,
      name: c.name,
      faction: this.faction,
      tab: this.activeTab,
      isBuilding: c.isBuilding,
      footprintW: 0,
      footprintH: 0,
    };
    try {
      // SIZE THE BACKING STORE TO THE CELL. `CameoRenderer.bind` renders into
      // whatever the canvas already is, and a fresh canvas is the HTML default
      // 300x150 — so every cameo was rendering at 2:1 and being squashed into a
      // ~3.3:1 cell, at the wrong resolution in both directions. Match the cell
      // and the device pixel ratio instead, capped so a 4x display does not
      // quietly quadruple the render cost of sixty cells.
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const cw = Math.max(16, Math.round(slot.root.clientWidth * dpr));
      const ch = Math.max(16, Math.round(slot.root.clientHeight * dpr));
      if (slot.cameoCanvas.width !== cw) slot.cameoCanvas.width = cw;
      if (slot.cameoCanvas.height !== ch) slot.cameoCanvas.height = ch;
      cameos.bind(slot.cameoCanvas, subject);
      slot.cameoCanvas.hidden = false;
    } catch (err) {
      console.warn(`[hud] cameo bind failed for "${c.key}"`, err);
      slot.cameoCanvas.hidden = true;
    }
  }

  /**
   * Pump the cameo render queue. Driven from the HUD's render frame.
   *
   * Cheap by construction: the queue is empty unless something was marked
   * dirty, so an idle sidebar does no GPU work at all.
   */
  frameCameos(time: number, dt: number): void {
    this.cameos?.frame(time, dt);
  }

  /** Re-render every bound cameo — e.g. once the art libraries finish loading. */
  invalidateCameos(): void {
    this.cameos?.invalidateAll();
  }

  /**
   * Hand the cameo scene the world's environment map.
   *
   * NOT OPTIONAL POLISH — without it the cameos render as BLACK SILHOUETTES.
   * Unit and structure materials are `MeshPhysicalMaterial` driven by an ORM
   * map whose metalness runs to 0.82 on bare metal, and a metal surface with no
   * IBL has nothing to reflect, so it resolves to near-black no matter how many
   * direct lights the scene carries. `UnitFactory` asserts this in DEV for the
   * world renderer — "envMapIntensity is 0, units go matte and the silhouette
   * rim dies" — and the cameo scene is subject to exactly the same physics.
   *
   * Measured before the fix: mean luminance 17.5/255 with the three most common
   * colours all within a whisker of black.
   *
   * Re-applied whenever the texture identity changes, because the PMREM bake
   * finishes after the HUD mounts and a mood change re-bakes it.
   */
  setCameoEnvironment(env: THREE.Texture | null): void {
    if (env === this.cameoEnv) return;
    this.cameoEnv = env;
    this.cameos?.setEnvironment(env);
    this.cameos?.invalidateAll();
  }

  private cameoEnv: THREE.Texture | null = null;

  private buildSlot(index: number): BuildSlot {
    const root = button(this.grid, 'vm-slot', '');
    root.setAttribute('role', 'gridcell');
    root.hidden = true;
    root.tabIndex = -1;

    const icon = makeIcon('depot', 'vm-icon vm-slot-icon');
    root.appendChild(icon);

    // THE MODEL. Sits over the glyph, and stays `hidden` until a cameo has
    // actually been bound to it — so a slot whose model does not resolve keeps
    // showing the glyph rather than a blank rectangle.
    const cameoCanvas = document.createElement('canvas');
    cameoCanvas.className = 'vm-slot-cameo';
    cameoCanvas.hidden = true;
    root.appendChild(cameoCanvas);

    const queueEl = el('span', 'vm-slot-queue vm-num', root);
    const queueNode = textNode(queueEl);
    queueEl.hidden = true;

    // The cost badge, bottom-left with its credit glyph — the reference's
    // placement. A bare number bottom-right read as a quantity, not a price.
    const costEl = el('span', 'vm-slot-cost vm-num', root);
    costEl.appendChild(makeIcon('credits', 'vm-icon'));
    const costNode = textNode(costEl);

    const keyEl = el('span', 'vm-hk vm-slot-key', root);
    const keyNode = textNode(keyEl, SLOT_HOTKEY_LABELS[index] ?? '');
    keyEl.hidden = index >= SLOT_HOTKEY_LABELS.length;

    const readyEl = el('span', 'vm-slot-ready', root);
    textNode(readyEl, 'READY');
    readyEl.hidden = true;

    const etaEl = el('span', 'vm-slot-eta vm-num', root);
    etaEl.appendChild(makeIcon('timer', 'vm-icon'));
    const etaNode = textNode(etaEl);
    etaEl.hidden = true;

    // HOW MANY YOU ALREADY OWN. Shares the bottom-right corner with the build
    // countdown and yields to it: while something is on the line, "how long"
    // is the live question and the inventory can wait the few seconds out.
    const ownedEl = el('span', 'vm-slot-owned vm-num', root);
    const ownedNode = textNode(ownedEl);
    ownedEl.hidden = true;

    const flagEl = el('span', 'vm-slot-flag', root);
    flagEl.appendChild(makeIcon('lock', 'vm-icon'));
    const flagNode = textNode(flagEl);
    flagEl.hidden = true;

    const track = el('span', 'vm-slot-track', root);
    const progress = el('i', '', track);
    progress.style.transform = 'scaleX(0)';

    const slot: BuildSlot = {
      root, icon, costNode, keyEl, keyNode, queueEl, queueNode, readyEl,
      etaEl, etaNode, cameoCanvas, ownedEl, ownedNode, flagEl, flagNode, progress,
      cameo: null, sig: '', key: '', buildTime: 0,
      lastProgress: -1, lastAt: 0, rate: 0,
    };

    root.addEventListener('pointerenter', () => {
      if (slot.cameo === null) return;
      this.cb.sound('hover');
      // The turntable only spins while hovered — see `Job.hovered` in Cameos.
      this.cameos?.setHovered(cameoCanvas, true);
      this.tooltip.schedule(root, this.tipFor(slot.cameo, index), 'above');
    });
    root.addEventListener('pointerleave', () => {
      this.cameos?.setHovered(cameoCanvas, false);
      this.tooltip.hide();
    });
    root.addEventListener('focus', () => {
      if (slot.cameo !== null) this.tooltip.show(root, this.tipFor(slot.cameo, index), 'above');
    });
    root.addEventListener('blur', () => this.tooltip.hide());

    root.addEventListener('click', (ev) => {
      if (slot.cameo === null) return;
      ev.preventDefault();
      this.cb.sound('click');
      this.cb.activate(this.activeTab, slot.cameo);
    });
    // Right-click cancels one queued item. `contextmenu` is the event that
    // fires reliably for button 2 on a focusable element, and preventing it is
    // also what keeps the OS menu off the build grid.
    root.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (slot.cameo === null) return;
      this.cb.sound('click');
      this.cb.cancel(this.activeTab, slot.cameo);
    });
    root.addEventListener('keydown', (ev) => this.onSlotKey(ev, index));

    return slot;
  }

  /* -- keyboard -------------------------------------------------------- */

  private onTabKey(ev: KeyboardEvent, index: number): void {
    let next = -1;
    if (ev.key === 'ArrowRight') next = (index + 1) % BUILD_TAB_COUNT;
    else if (ev.key === 'ArrowLeft') next = (index + BUILD_TAB_COUNT - 1) % BUILD_TAB_COUNT;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = BUILD_TAB_COUNT - 1;
    else if (ev.key === 'ArrowDown') {
      if (this.liveSlots > 0) { ev.preventDefault(); this.slots[0].root.focus(); }
      return;
    }
    if (next < 0) return;
    ev.preventDefault();
    this.cb.sound('tab');
    this.cb.selectTab(next as BuildTab);
    this.tabs[next].focus();
  }

  private onSlotKey(ev: KeyboardEvent, index: number): void {
    if (this.liveSlots === 0) return;
    let next = -1;
    switch (ev.key) {
      case 'ArrowRight': next = index + 1; break;
      case 'ArrowLeft': next = index - 1; break;
      case 'ArrowDown': next = index + BUILD_COLUMNS; break;
      case 'ArrowUp':
        next = index - BUILD_COLUMNS;
        if (next < 0) {
          ev.preventDefault();
          this.tabs[this.activeTab as number].focus();
          return;
        }
        break;
      case 'Delete':
      case 'Backspace': {
        const slot = this.slots[index];
        if (slot !== undefined && slot.cameo !== null) {
          ev.preventDefault();
          this.cb.cancel(this.activeTab, slot.cameo);
        }
        return;
      }
      default: return;
    }
    if (next < 0 || next >= this.liveSlots) return;
    ev.preventDefault();
    this.slots[next].root.focus();
  }

  /**
   * Fire the slot a global hotkey names. Returns false when that cell is empty,
   * so the caller can leave the keystroke for someone else rather than
   * swallowing it.
   */
  activateSlotByIndex(index: number): boolean {
    const slot = this.slots[index];
    if (slot === undefined || slot.cameo === null || slot.root.hidden) return false;
    this.cb.sound('click');
    this.cb.activate(this.activeTab, slot.cameo);
    return true;
  }

  /* -- state ----------------------------------------------------------- */

  setExtrasProvider(fn: (key: string) => BuildExtras): void {
    this.extras = fn;
    // A provider that arrives after the first paint must be allowed to fill in
    // the build times, so drop the per-slot cache rather than waiting for the
    // content of every cell to change.
    for (const slot of this.slots) { slot.key = ''; slot.sig = ''; }
  }

  setArmed(mode: ArmedMode): void {
    if (this.armed === mode) return;
    this.armed = mode;
    for (let i = 0; i < this.tools.length; i++) {
      const on = (i === 0 && mode === 'repair') || (i === 1 && mode === 'sell');
      this.tools[i].classList.toggle('is-active', on);
      this.tools[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  get armedMode(): ArmedMode { return this.armed; }

  /**
   * Seconds left on this build, from the rate it is ACTUALLY moving at.
   *
   * Returns 0 for "show nothing" — not building, already ready, or moving so
   * slowly that any figure would be a lie. A stalled build is already announced
   * by the ON HOLD flag and EVA; a countdown reading 9999 next to it would be
   * noise, and one reading 5s while nothing happens is the bug this replaces.
   *
   * The estimate assumes current conditions hold, which is what every ETA
   * assumes. Power coming back or a refinery cashing in will beat it, and that
   * is the right direction to be wrong in.
   */
  private estimateEta(slot: BuildSlot, c: HudCameo): number {
    return estimateBuildEta(slot, c.progress, c.ready, slot.buildTime, performance.now());
  }

  private tipFor(c: HudCameo, index: number): TooltipContent {
    const extra = this.extras?.(c.key)
      ?? { buildTimeSec: 0, powerDelta: 0, blurb: '', prereq: '' };
    return {
      title: c.name,
      cost: c.cost,
      buildTimeSec: extra.buildTimeSec,
      powerDelta: extra.powerDelta,
      blurb: extra.blurb,
      prereq: extra.prereq,
      requirement: c.available ? '' : c.reason,
      hotkey: SLOT_HOTKEY_LABELS[index] ?? '',
    };
  }

  update(snap: HudSnapshot): void {
    /* -- tabs ---------------------------------------------------------- */
    if (snap.activeTab !== this.activeTab) {
      this.activeTab = snap.activeTab;
      for (let t = 0; t < BUILD_TAB_COUNT; t++) {
        const on = t === (this.activeTab as number);
        this.tabs[t].classList.toggle('is-active', on);
        this.tabs[t].setAttribute('aria-selected', on ? 'true' : 'false');
        this.tabs[t].tabIndex = on ? 0 : -1;
      }
      // A tab swap re-points every slot; invalidate so `key` comparison fires.
      for (const slot of this.slots) { slot.key = ''; slot.sig = ''; }
    }
    for (let t = 0; t < BUILD_TAB_COUNT; t++) {
      const alert = this.tabAlerts[t];
      const on = snap.tabAlert[t] === true;
      if (alert.hidden === on) alert.hidden = !on;
    }

    /* -- slots --------------------------------------------------------- */
    const list = snap.cameos[this.activeTab as number] ?? [];
    const n = Math.min(list.length, this.slots.length);
    const credits = snap.credits;

    for (let i = 0; i < n; i++) {
      const slot = this.slots[i];
      const c = list[i];
      slot.cameo = c;

      if (slot.key !== c.key) {
        slot.key = c.key;
        slot.root.hidden = false;
        slot.root.setAttribute(
          'aria-label',
          `${c.name}, ${c.cost} credits${i < SLOT_HOTKEY_LABELS.length ? `, key ${SLOT_HOTKEY_LABELS[i]}` : ''}`,
        );
        slot.root.tabIndex = 0;
        setIcon(slot.icon, iconForBuildable(c.key, c.name, this.activeTab, c.isBuilding));
        this.bindCameo(slot, c);
        slot.costNode.nodeValue = String(c.cost);
        slot.buildTime = this.extras?.(c.key).buildTimeSec ?? 0;
        slot.keyNode.nodeValue = SLOT_HOTKEY_LABELS[i] ?? '';
        slot.keyEl.hidden = i >= SLOT_HOTKEY_LABELS.length;
      }

      // One string comparison replaces a dozen DOM writes for a slot that has
      // not changed — which is nearly every slot, nearly every frame. The
      // progress term is quantized to half a percent so a build does not thrash
      // the DOM at 60 Hz for sub-pixel motion; the countdown is quantized to a
      // whole second for the same reason.
      const poor = credits < c.cost;
      const eta = this.estimateEta(slot, c);
      const sig = `${c.queued}|${c.ready ? 1 : 0}|${c.onHold ? 1 : 0}|` +
        `${c.available ? 1 : 0}|${poor ? 1 : 0}|${eta}|${c.reason}|${(c.progress * 200) | 0}` +
        `|${c.owned}`;
      if (sig === slot.sig) continue;
      slot.sig = sig;

      if (c.queued > 0) {
        slot.queueNode.nodeValue = String(Math.min(c.queued, MAX_QUEUE_DEPTH));
        slot.queueEl.hidden = false;
      } else if (!slot.queueEl.hidden) {
        slot.queueEl.hidden = true;
      }

      // The countdown owns the top-right while a build runs. "How long" is the
      // only open question once an item is on the line.
      if (eta > 0) {
        slot.etaNode.nodeValue = formatCountdown(eta);
        slot.etaEl.hidden = false;
      } else if (!slot.etaEl.hidden) {
        slot.etaEl.hidden = true;
      }

      // Inventory. Hidden at zero rather than showing "0": sixty cells each
      // announcing a nought is noise, and "no badge" already reads as none.
      // Yields the corner to the countdown while a build is running.
      const showOwned = c.owned > 0 && eta <= 0;
      if (showOwned) {
        slot.ownedNode.nodeValue = c.owned > 999 ? '999+' : String(c.owned);
        slot.ownedEl.hidden = false;
      } else if (!slot.ownedEl.hidden) {
        slot.ownedEl.hidden = true;
      }

      slot.readyEl.hidden = !c.ready;
      slot.root.classList.toggle('is-ready', c.ready);
      slot.root.classList.toggle('is-held', c.onHold);
      // A locked slot is DIMMED, never disabled: it must stay hoverable so the
      // tooltip can explain what unlocks it. That reason is the tech tree's
      // only tutorial — and the banner below is its one-word summary, so the
      // player does not have to hover twenty cells to find the one live one.
      slot.root.classList.toggle('is-locked', !c.available);
      slot.root.classList.toggle('is-poor', poor && c.available && !c.ready);

      const block: BlockKind = !c.available
        ? blockKindOf(c.reason) || 'tech'
        : poor && !c.ready ? 'funds' : '';
      if (block === '') {
        slot.flagEl.hidden = true;
      } else {
        slot.flagNode.nodeValue = BLOCK_WORDS[block];
        slot.flagEl.className = `vm-slot-flag is-${block}`;
        slot.flagEl.hidden = c.ready || c.progress > 0;
      }

      const p = c.ready ? 1 : Math.max(0, Math.min(1, c.progress));
      slot.progress.style.transform = `scaleX(${p.toFixed(3)})`;
      slot.root.classList.toggle('is-building', p > 0 && !c.ready);
    }

    for (let i = n; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.root.hidden) continue;
      slot.root.hidden = true;
      slot.root.tabIndex = -1;
      // Release the cameo job with the slot. Leaving it bound would keep a
      // render target alive for a cell nobody can see, and every tab switch
      // would add another.
      this.cameos?.unbind(slot.cameoCanvas);
      slot.cameoCanvas.hidden = true;
      slot.cameo = null;
      slot.key = '';
      slot.sig = '';
    }
    this.liveSlots = n;
  }

  dispose(): void {
    this.tooltip.dispose();
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 5 — THE BOTTOM BAR
 * ========================================================================== */

export class Sidebar {
  readonly root: HTMLElement;
  /** The minimap's glass panel. `Minimap` draws into `minimapCanvas`. */
  readonly mapDock: HTMLElement;
  readonly minimapField: HTMLElement;
  readonly minimapCanvas: HTMLCanvasElement;
  readonly resources: ResourceStrip;

  private readonly selection: SelectionPanel;
  private readonly build: BuildPanel;
  private readonly titleEl: HTMLElement;
  private readonly offlineEl: HTMLElement;
  private readonly mapHintEl: HTMLElement;
  private faction: Faction;
  private radarOnline = true;

  constructor(opts: SidebarOptions) {
    this.faction = opts.faction;

    this.root = el('div', 'vm-bar', opts.parent);

    // The strip is top-centre and the docks are bottom; they share one root so
    // `__VM.setUiVisible(false)` hides the whole interface with one toggle.
    this.resources = new ResourceStrip(this.root);

    const docks = el('div', 'vm-docks', this.root);

    /* -- bottom left: the minimap dock ---------------------------------- */
    this.mapDock = panel(docks, 'vm-dock vm-dock-map', 'diag');
    this.mapDock.dataset.brackets = 'on';
    this.mapDock.setAttribute('aria-label', 'Tactical map');
    const mapHead = el('div', 'vm-dock-head', this.mapDock);
    // The two labels SWAP rather than sit side by side: the head is 67 design
    // units wide and two tracked-out uppercase words do not fit at any size a
    // player can read. One word, not two — "TACTICAL MAP" measured 84u at the
    // house label's tracking and clipped mid-word against the legend. The
    // dock's `aria-label` still says what it is.
    this.titleEl = el('span', 'vm-dock-title', mapHead);
    textNode(this.titleEl, 'MAP');
    this.offlineEl = el('span', 'vm-map-offline', mapHead);
    textNode(this.offlineEl, 'NO RADAR');
    this.offlineEl.hidden = true;

    // The legend used to be a 52-unit rail beside the map, which is a great
    // deal of width for four colours — width the selection card's stat row was
    // overflowing for want of. Four swatches fit in the head; the WORDS moved
    // onto its tooltip, where a player who does not already know what red means
    // will look and a player who does will never have to see them again.
    const legend = el('div', 'vm-map-legend', mapHead);
    const LEGEND: ReadonlyArray<readonly [string, string]> = [
      ['', 'Yours'],
      ['is-enemy', 'Hostile'],
      ['is-ore', 'Ore'],
      ['is-view', 'View'],
    ];
    let legendTip = '';
    for (const [mod, name] of LEGEND) {
      const row = el('div', `vm-legend-row${mod === '' ? '' : ` ${mod}`}`, legend);
      el('i', 'vm-legend-swatch', row);
      label(row, 'vm-legend-text', name);
      legendTip += `${legendTip === '' ? '' : '   '}${name}`;
    }
    legend.title = `Map key:  ${legendTip}`;

    const mapBody = el('div', 'vm-map-body', this.mapDock);
    this.minimapField = el('div', 'vm-map-field', mapBody);
    this.minimapCanvas = el('canvas', 'vm-map-canvas', this.minimapField);

    // The offline state now says what to DO. "NO RADAR" named the symptom and
    // left the player staring at a grey square with no idea it was a build
    // order away from working.
    this.mapHintEl = el('div', 'vm-map-hint', this.minimapField);
    // Short, because the field is only ~67 design units wide. The full sentence
    // lives on the selection dock's advisory line, which has the room for it.
    const hintTitle = el('b', '', this.mapHintEl);
    textNode(hintTitle, 'RADAR OFFLINE');
    textNode(this.mapHintEl, 'Build a Radar Dome');
    this.mapHintEl.hidden = true;

    /* -- bottom centre: selection / status ------------------------------ */
    this.selection = new SelectionPanel(docks, opts.callbacks);

    /* -- bottom right: build -------------------------------------------- */
    // MOUNTED ON THE ROOT, NOT IN `docks`. The build palette is the right rail
    // now, and it positions itself absolutely against the HUD root. Left inside
    // `.vm-docks` — which is itself absolutely positioned as a thin strip along
    // the bottom — its `top` would resolve against that strip and put the rail
    // off the bottom of the screen. It is a peer of the docks, not one of them.
    this.build = new BuildPanel(
      this.root, opts.callbacks, this.root, opts.faction, opts.renderer ?? null,
    );

    applyTheme(this.root, this.faction);
  }

  /* -- configuration --------------------------------------------------- */

  setFaction(faction: Faction): void {
    if (this.faction === faction) return;
    this.faction = faction;
    applyTheme(this.root, faction);
  }

  setExtrasProvider(fn: (key: string) => BuildExtras): void {
    this.build.setExtrasProvider(fn);
  }

  /** Radar dome online? Drives the map dock's offline state and its hint. */
  setRadarOnline(online: boolean): void {
    if (online === this.radarOnline) return;
    this.radarOnline = online;
    this.mapDock.classList.toggle('is-offline', !online);
    this.offlineEl.hidden = online;
    this.titleEl.hidden = !online;
    this.mapHintEl.hidden = online;
  }

  /** The repair / sell tool. Also called by input on Escape and right-click. */
  setArmed(mode: ArmedMode): void {
    this.build.setArmed(mode);
    this.root.dataset.armed = mode;
  }

  get armedMode(): ArmedMode { return this.build.armedMode; }

  /** Build slots the grid can show at once. Diagnostics only. */
  get slotCount(): number { return this.build.slotCount; }

  /** Pump the build slots' cameo render queue. Driven from the HUD frame. */
  frameCameos(time: number, dt: number): void { this.build.frameCameos(time, dt); }

  /** Force every bound cameo to repaint — e.g. once the art libraries land. */
  invalidateCameos(): void { this.build.invalidateCameos(); }

  /** See `BuildPanel.setCameoEnvironment` — without this the cameos are black. */
  setCameoEnvironment(env: THREE.Texture | null): void {
    this.build.setCameoEnvironment(env);
  }

  /** Fire the slot a global hotkey names. False when that cell is empty. */
  activateSlotByIndex(index: number): boolean {
    return this.build.activateSlotByIndex(index);
  }

  /* -- frame ------------------------------------------------------------ */

  update(snap: HudSnapshot, view: SelectionView, tele: HudTelemetry, dt: number): void {
    this.resources.update(snap, tele, dt);
    this.selection.update(view, snap, tele);
    this.build.update(snap);
  }

  /** Raise the credits flyout. Driven by `economy:credits`. */
  creditFlyout(delta: number): void {
    this.resources.flyout(delta);
  }

  /** Jump the credits counter — match start, or a faction swap. */
  resetCredits(credits: number): void {
    this.resources.reset(credits);
  }

  dispose(): void {
    this.build.dispose();
    this.selection.dispose();
    this.resources.dispose();
    this.root.remove();
  }
}
