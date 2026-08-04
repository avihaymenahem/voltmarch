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
import { TAB_ICONS, iconForBuildable, makeIcon, setIcon, type IconName } from './icons';

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
  /** Current stance of the selection, or -1 when it is mixed. */
  stance: Stance | -1;
  /** False for a selection that cannot take a stance (structures). */
  stanceEnabled: boolean;
  /** Stat row. An empty string blanks its chip. */
  armour: string;
  damage: string;
  range: string;
  speed: string;
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
  sound(cue: HudSoundCue): void;
}

export interface SidebarOptions {
  parent: HTMLElement;
  faction: Faction;
  callbacks: SidebarCallbacks;
}

/** Columns in the build grid. Six is the approved width. */
const BUILD_COLUMNS = 6;
/** Rows built up front. The grid scrolls internally past this. */
const BUILD_ROWS = 4;
/** Cards built up front in the selection panel. */
const CARD_POOL = 14;
/** Segments in the power meter. */
const POWER_SEGMENTS = 14;

/** Tab titles, in `BuildTab` order. */
const TAB_LABELS: readonly string[] = ['Structures', 'Defence', 'Infantry', 'Vehicles'];

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
 * SECTION 3 — THE CENTRE DOCK  (selection, or status)
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

interface StatusCell {
  valueEl: HTMLElement;
  valueNode: Text;
  last: string;
}

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
  private readonly cardRow: HTMLElement;
  private readonly cards: CardCell[] = [];
  private readonly statValues: Text[] = [];
  private readonly statChips: HTMLElement[] = [];
  private readonly stanceRow: HTMLElement;
  private readonly stanceLabelNode: Text;
  private readonly stanceButtons: HTMLButtonElement[] = [];

  /** Status board: army, structures, power, income, credits. */
  private readonly statusCells: StatusCell[] = [];
  private readonly statusSubNode: Text;
  private readonly alertEl: HTMLElement;
  private readonly alertNode: Text;
  private lastAdvice = '';

  private empty = true;
  private lastTitle = '';
  private lastSubtitle = '';
  private lastCount = -1;
  private lastVet = -1;
  private lastStance = -2;
  private lastHp = '';
  private liveCards = 0;

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-dock vm-dock-selection', 'diag');
    this.root.setAttribute('aria-label', 'Selection');
    this.root.classList.add('is-empty');

    this.live = el('div', 'vm-sel-live', this.root);
    this.idle = el('div', 'vm-sel-idle', this.root);

    /* -- header -------------------------------------------------------- */
    const head = el('div', 'vm-sel-head', this.live);
    const idBlock = el('div', 'vm-sel-id', head);
    this.titleNode = label(idBlock, 'vm-sel-title');
    this.chevrons = el('span', 'vm-sel-vet', idBlock);
    for (let i = 0; i < 2; i++) {
      this.chevrons.appendChild(makeIcon('veterancy', 'vm-icon vm-sel-chevron'));
    }
    this.chevrons.hidden = true;
    this.subtitleNode = label(head, 'vm-sel-sub');

    // Aggregate health. The number that decides whether to press or retreat,
    // and the old panel simply did not have it anywhere.
    const hp = el('div', 'vm-sel-hp', head);
    const hpTrack = el('span', 'vm-sel-hp-track', hp);
    this.hpBar = el('i', '', hpTrack);
    this.hpTextNode = label(hp, 'vm-sel-hp-text vm-num', '');

    this.countEl = el('div', 'vm-sel-count vm-num', head);
    this.countNode = textNode(this.countEl, '0');
    this.countEl.hidden = true;

    /* -- cards --------------------------------------------------------- */
    this.cardRow = el('div', 'vm-sel-cards', this.live);
    this.cardRow.setAttribute('role', 'listbox');
    this.cardRow.setAttribute('aria-label', 'Selected units');
    for (let i = 0; i < CARD_POOL; i++) this.cards.push(this.buildCard());

    /* -- stats + stance ------------------------------------------------ */
    const stats = el('div', 'vm-sel-stats', this.live);
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

    this.stanceRow = el('div', 'vm-stances', stats);
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

    /* -- the idle status board ------------------------------------------ */
    const sHead = el('div', 'vm-status-head', this.idle);
    label(sHead, 'vm-status-title', 'Base status');
    this.statusSubNode = label(sHead, 'vm-status-sub', 'Select a unit or a structure to command it');

    const grid = el('div', 'vm-status-grid', this.idle);
    const STATUS_SPEC: ReadonlyArray<readonly [IconName, string]> = [
      ['army', 'Army'],
      ['base', 'Structures'],
      ['bolt', 'Power'],
      ['trend', 'Income / min'],
      ['credits', 'Credits'],
    ];
    for (const [icon, name] of STATUS_SPEC) {
      const cell = el('div', 'vm-status-cell', grid);
      cell.appendChild(makeIcon(icon, 'vm-icon'));
      const body = el('div', 'vm-status-body', cell);
      label(body, 'vm-status-label', name);
      const valueEl = el('span', 'vm-status-value vm-num', body);
      this.statusCells.push({ valueEl, valueNode: textNode(valueEl, '0'), last: '' });
    }

    this.alertEl = el('div', 'vm-status-alert', this.idle);
    this.alertEl.appendChild(makeIcon('info', 'vm-icon'));
    this.alertNode = label(this.alertEl, 'vm-status-alert-text', '');
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

  update(view: SelectionView, snap: HudSnapshot, tele: HudTelemetry): void {
    const empty = view.count === 0;
    if (empty !== this.empty) {
      this.empty = empty;
      this.root.classList.toggle('is-empty', empty);
      this.root.setAttribute('aria-label', empty ? 'Base status' : 'Selection');
    }
    if (empty) {
      for (let i = 0; i < this.liveCards; i++) this.cards[i].root.hidden = true;
      this.liveCards = 0;
      this.updateStatus(snap, tele);
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
      this.countNode.nodeValue = String(view.count);
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
  }

  /** The idle board. Same numbers as the strip, given room to be read. */
  private updateStatus(snap: HudSnapshot, tele: HudTelemetry): void {
    const state = powerStateOf(snap.powerProduced, snap.powerConsumed, snap.brownout);
    this.setStatus(0, String(tele.army), '');
    this.setStatus(1, String(tele.structures), '');
    this.setStatus(
      2,
      `${Math.max(0, Math.round(snap.powerConsumed))}/${Math.max(0, Math.round(snap.powerProduced))}`,
      state === 'ok' ? '' : state === 'tight' ? 'is-warn' : 'is-down',
    );
    this.setStatus(3, formatRate(tele.incomePerMin), tele.incomePerMin > 5 ? 'is-good' : '');
    this.setStatus(4, formatCredits(snap.credits), '');

    if (tele.advice !== this.lastAdvice) {
      this.lastAdvice = tele.advice;
      this.alertNode.nodeValue = tele.advice;
      this.alertEl.className = `vm-status-alert${tele.adviceKind === 'info' ? '' : ` is-${tele.adviceKind}`}`;
    }
  }

  private setStatus(i: number, value: string, mod: string): void {
    const cell = this.statusCells[i];
    const sig = `${value}|${mod}`;
    if (cell.last === sig) return;
    cell.last = sig;
    cell.valueNode.nodeValue = value;
    cell.valueEl.className = `vm-status-value vm-num${mod === '' ? '' : ` ${mod}`}`;
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
 * SECTION 4 — THE BUILD PANEL  (bottom right)
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

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks, tipHost: HTMLElement) {
    this.root = panel(parent, 'vm-dock vm-dock-build', 'diag');
    this.root.setAttribute('aria-label', 'Construction');
    this.tooltip = new Tooltip(tipHost);

    /* -- tab strip ----------------------------------------------------- */
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
      // Icon and key badge share one centred row. They used to be an icon in the
      // middle and a badge absolutely parked in the tab's top-right corner,
      // which put the badge almost exactly midway between its OWN icon and the
      // next tab's — 28px from one, 25px from the other, measured at 1440p. It
      // read as if `B` belonged to Defence. A key badge that names the wrong
      // control is worse than no badge, so the two are now one unit.
      const top = el('span', 'vm-tab-top', b);
      top.appendChild(makeIcon(TAB_ICONS[t], 'vm-icon vm-tab-icon'));
      label(top, 'vm-hk', TAB_HOTKEY_LABELS[t]);
      label(b, 'vm-tab-label', TAB_LABELS[t].toUpperCase());
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

    /* -- slot grid ----------------------------------------------------- */
    this.grid = el('div', 'vm-grid', this.root);
    this.grid.setAttribute('role', 'grid');
    this.grid.style.setProperty('--vm-grid-cols', String(BUILD_COLUMNS));
    for (let i = 0; i < BUILD_COLUMNS * BUILD_ROWS; i++) this.slots.push(this.buildSlot(i));
  }

  get slotCount(): number { return this.slots.length; }

  private buildSlot(index: number): BuildSlot {
    const root = button(this.grid, 'vm-slot', '');
    root.setAttribute('role', 'gridcell');
    root.hidden = true;
    root.tabIndex = -1;

    const icon = makeIcon('depot', 'vm-icon vm-slot-icon');
    root.appendChild(icon);

    const queueEl = el('span', 'vm-slot-queue vm-num', root);
    const queueNode = textNode(queueEl);
    queueEl.hidden = true;

    const costNode = label(root, 'vm-slot-cost vm-num');

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

    const flagEl = el('span', 'vm-slot-flag', root);
    flagEl.appendChild(makeIcon('lock', 'vm-icon'));
    const flagNode = textNode(flagEl);
    flagEl.hidden = true;

    const track = el('span', 'vm-slot-track', root);
    const progress = el('i', '', track);
    progress.style.transform = 'scaleX(0)';

    const slot: BuildSlot = {
      root, icon, costNode, keyEl, keyNode, queueEl, queueNode, readyEl,
      etaEl, etaNode, flagEl, flagNode, progress,
      cameo: null, sig: '', key: '', buildTime: 0,
    };

    root.addEventListener('pointerenter', () => {
      if (slot.cameo === null) return;
      this.cb.sound('hover');
      this.tooltip.schedule(root, this.tipFor(slot.cameo, index), 'above');
    });
    root.addEventListener('pointerleave', () => this.tooltip.hide());
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
      const eta = slot.buildTime > 0 && c.progress > 0 && !c.ready
        ? Math.ceil(slot.buildTime * (1 - c.progress)) : 0;
      const sig = `${c.queued}|${c.ready ? 1 : 0}|${c.onHold ? 1 : 0}|` +
        `${c.available ? 1 : 0}|${poor ? 1 : 0}|${eta}|${c.reason}|${(c.progress * 200) | 0}`;
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
    this.mapDock.setAttribute('aria-label', 'Tactical map');
    const mapHead = el('div', 'vm-dock-head', this.mapDock);
    // The two labels SWAP rather than sit side by side: the head is only ~130
    // design units wide and two tracked-out uppercase words do not fit at any
    // size a player can read.
    this.titleEl = el('span', 'vm-dock-title', mapHead);
    textNode(this.titleEl, 'TACTICAL MAP');
    this.offlineEl = el('span', 'vm-map-offline', mapHead);
    textNode(this.offlineEl, 'NO RADAR');
    this.offlineEl.hidden = true;

    const mapBody = el('div', 'vm-map-body', this.mapDock);
    this.minimapField = el('div', 'vm-map-field', mapBody);
    this.minimapCanvas = el('canvas', 'vm-map-canvas', this.minimapField);

    // The offline state now says what to DO. "NO RADAR" named the symptom and
    // left the player staring at a grey square with no idea it was a build
    // order away from working.
    this.mapHintEl = el('div', 'vm-map-hint', this.minimapField);
    // Short, because the field is only ~82 design units wide. The full sentence
    // lives on the status board's advice line, which has the room for it.
    const hintTitle = el('b', '', this.mapHintEl);
    textNode(hintTitle, 'RADAR OFFLINE');
    textNode(this.mapHintEl, 'Build a Radar Dome');
    this.mapHintEl.hidden = true;

    // The legend. Three colours and a rectangle carry the entire map, and none
    // of them was explained anywhere in the game.
    const legend = el('div', 'vm-map-legend', mapBody);
    const LEGEND: ReadonlyArray<readonly [string, string]> = [
      ['', 'Yours'],
      ['is-enemy', 'Hostile'],
      ['is-ore', 'Ore'],
      ['is-view', 'View'],
    ];
    for (const [mod, name] of LEGEND) {
      const row = el('div', `vm-legend-row${mod === '' ? '' : ` ${mod}`}`, legend);
      el('i', 'vm-legend-swatch', row);
      label(row, 'vm-legend-text', name);
    }

    /* -- bottom centre: selection / status ------------------------------ */
    this.selection = new SelectionPanel(docks, opts.callbacks);

    /* -- bottom right: build -------------------------------------------- */
    this.build = new BuildPanel(docks, opts.callbacks, this.root);

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
