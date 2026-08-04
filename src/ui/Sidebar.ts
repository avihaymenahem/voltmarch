/**
 * ============================================================================
 * src/ui/Sidebar.ts — THE BOTTOM BAR
 * ============================================================================
 * The file keeps its name so no other module's import breaks; it is no longer a
 * sidebar. The classic right-hand rail is gone and the command surface is now
 * bottom-anchored in three docks plus one strip:
 *
 *   TOP CENTRE   `ResourceStrip`   credits (rolling), power (segmented), clock
 *   BOTTOM LEFT  `.vm-dock-map`    the minimap's glass panel (canvas host only)
 *   BOTTOM CENTRE`SelectionPanel`  name, veterancy, count, unit cards, stat row
 *   BOTTOM RIGHT `BuildPanel`      4 tabs over a 6-column slot grid
 *
 * WHY BOTTOM-ANCHORED
 * -------------------
 * A right rail costs 13% of the frame at every resolution and it costs it in
 * the WIDEST part of a 16:9 image, which is exactly where the battlefield is.
 * Three bottom docks cost the same pixels in the least valuable band and leave
 * the horizon clean. It also puts the build grid, the selection and the minimap
 * within one short mouse travel of each other.
 *
 * ZERO ALLOCATION IN `update`
 * ---------------------------
 * Every slot, card and segment is built once and pooled. `update` writes
 * `nodeValue`, toggles classes and sets custom properties; it never calls
 * `createElement`, never builds a template string for the DOM, and never
 * touches a layout-reading API like `getBoundingClientRect`.
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
  RollingCounter,
  Tooltip,
  applyTheme,
  button,
  el,
  formatCredits,
  formatElapsed,
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
  /** Entities selected. 0 collapses the panel. */
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

/** Stance buttons, in display order. */
const STANCES: ReadonlyArray<readonly [Stance, IconName, string]> = [
  [Stance.Aggressive, 'stanceAggressive', 'Aggressive'],
  [Stance.Defensive, 'stanceDefensive', 'Defensive'],
  [Stance.HoldGround, 'stanceHoldGround', 'Hold ground'],
  [Stance.HoldFire, 'stanceHoldFire', 'Hold fire'],
];

/* ==========================================================================
 * SECTION 2 — THE RESOURCE STRIP  (top centre)
 *
 * Credits roll, power is a segmented meter, the clock counts up. Notched at
 * both ends so it reads as a machined insert rather than a floating card.
 * ========================================================================== */

export class ResourceStrip {
  readonly root: HTMLElement;

  private readonly creditsNode: Text;
  private readonly deltaEl: HTMLElement;
  private readonly deltaNode: Text;
  private readonly powerEl: HTMLElement;
  private readonly powerNode: Text;
  private readonly segments: HTMLElement[] = [];
  private readonly clockNode: Text;

  private readonly counter = new RollingCounter();
  /** Seconds since the last credit flyout, or a large number when idle. */
  private deltaAge = 1e9;
  private lastLit = -1;
  private lastState = '';
  private lastClock = '';
  private lastPower = '';

  constructor(parent: HTMLElement) {
    this.root = panel(parent, 'vm-resources', 'ends');
    this.root.setAttribute('role', 'status');

    /* -- credits ------------------------------------------------------- */
    const credits = el('div', 'vm-res vm-res-credits', this.root);
    credits.appendChild(makeIcon('credits', 'vm-icon vm-res-icon'));
    this.creditsNode = label(credits, 'vm-res-value vm-num', '0');
    this.deltaEl = el('span', 'vm-res-delta vm-num', credits);
    this.deltaNode = textNode(this.deltaEl);
    this.deltaEl.hidden = true;

    el('span', 'vm-res-rule', this.root);

    /* -- power --------------------------------------------------------- */
    const power = el('div', 'vm-res vm-res-power', this.root);
    power.appendChild(makeIcon('bolt', 'vm-icon vm-res-icon'));
    const meter = el('div', 'vm-power', power);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', 'Power');
    for (let i = 0; i < POWER_SEGMENTS; i++) {
      this.segments.push(el('i', 'vm-power-seg', meter));
    }
    this.powerEl = el('span', 'vm-res-value vm-num vm-power-value', power);
    this.powerNode = textNode(this.powerEl, '0');

    el('span', 'vm-res-rule', this.root);

    /* -- clock --------------------------------------------------------- */
    const clock = el('div', 'vm-res vm-res-clock', this.root);
    clock.appendChild(makeIcon('clock', 'vm-icon vm-res-icon'));
    this.clockNode = label(clock, 'vm-res-value vm-num', '00:00');
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

  update(snap: HudSnapshot, dt: number): void {
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
    const produced = Math.max(0, snap.powerProduced);
    const consumed = Math.max(0, snap.powerConsumed);
    const surplus = Math.round(produced - consumed);
    // The meter shows DRAW against SUPPLY. A full bar means the next structure
    // browns you out — which is precisely the moment the player must notice.
    const load = produced <= 0 ? (consumed > 0 ? 1 : 0) : Math.min(1, consumed / produced);
    const lit = Math.min(POWER_SEGMENTS, Math.round(load * POWER_SEGMENTS));
    const state = snap.brownout ? 'is-down' : load > 0.86 ? 'is-tight' : '';

    if (lit !== this.lastLit || state !== this.lastState) {
      this.lastLit = lit;
      this.lastState = state;
      for (let i = 0; i < POWER_SEGMENTS; i++) {
        this.segments[i].classList.toggle('is-lit', i < lit);
      }
      this.powerEl.className = `vm-res-value vm-num vm-power-value ${state}`;
      this.root.classList.toggle('is-brownout', snap.brownout);
    }
    const powerText = `${surplus >= 0 ? '+' : ''}${surplus}`;
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
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 3 — THE SELECTION PANEL  (bottom centre)
 * ========================================================================== */

interface CardCell {
  root: HTMLButtonElement;
  icon: SVGSVGElement;
  bar: HTMLElement;
  stackEl: HTMLElement;
  stackNode: Text;
  vetEl: HTMLElement;
  id: number;
  sig: string;
}

class SelectionPanel {
  readonly root: HTMLElement;

  private readonly titleNode: Text;
  private readonly subtitleNode: Text;
  private readonly countEl: HTMLElement;
  private readonly countNode: Text;
  private readonly chevrons: HTMLElement;
  private readonly cardRow: HTMLElement;
  private readonly cards: CardCell[] = [];
  private readonly statValues: Text[] = [];
  private readonly statChips: HTMLElement[] = [];
  private readonly stanceRow: HTMLElement;
  private readonly stanceButtons: HTMLButtonElement[] = [];

  private empty = true;
  private lastTitle = '';
  private lastSubtitle = '';
  private lastCount = -1;
  private lastVet = -1;
  private lastStance = -2;
  private liveCards = 0;

  constructor(parent: HTMLElement, private readonly cb: SidebarCallbacks) {
    this.root = panel(parent, 'vm-dock vm-dock-selection', 'diag');
    this.root.setAttribute('aria-label', 'Selection');
    this.root.classList.add('is-empty');

    /* -- header -------------------------------------------------------- */
    const head = el('div', 'vm-sel-head', this.root);
    const idBlock = el('div', 'vm-sel-id', head);
    this.titleNode = label(idBlock, 'vm-sel-title');
    this.chevrons = el('span', 'vm-sel-vet', idBlock);
    for (let i = 0; i < 2; i++) {
      this.chevrons.appendChild(makeIcon('veterancy', 'vm-icon vm-sel-chevron'));
    }
    this.chevrons.hidden = true;
    this.subtitleNode = label(head, 'vm-sel-sub');

    this.countEl = el('div', 'vm-sel-count vm-num', head);
    this.countNode = textNode(this.countEl, '0');
    this.countEl.hidden = true;

    /* -- cards --------------------------------------------------------- */
    this.cardRow = el('div', 'vm-sel-cards', this.root);
    this.cardRow.setAttribute('role', 'listbox');
    this.cardRow.setAttribute('aria-label', 'Selected units');
    for (let i = 0; i < CARD_POOL; i++) this.cards.push(this.buildCard());

    /* -- stats + stance ------------------------------------------------ */
    const stats = el('div', 'vm-sel-stats', this.root);
    const STAT_SPEC: ReadonlyArray<readonly [IconName, string]> = [
      ['armour', 'Armour'],
      ['damage', 'Damage'],
      ['range', 'Range'],
      ['speed', 'Speed'],
    ];
    for (const [icon, name] of STAT_SPEC) {
      const chip = el('div', 'vm-stat', stats);
      chip.title = name;
      chip.appendChild(makeIcon(icon, 'vm-icon vm-stat-icon'));
      this.statValues.push(label(chip, 'vm-stat-value vm-num', '—'));
      this.statChips.push(chip);
    }

    this.stanceRow = el('div', 'vm-stances', stats);
    this.stanceRow.setAttribute('role', 'radiogroup');
    this.stanceRow.setAttribute('aria-label', 'Stance');
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
  }

  private buildCard(): CardCell {
    const root = button(this.cardRow, 'vm-card', 'Unit');
    root.setAttribute('role', 'option');
    root.setAttribute('aria-selected', 'false');
    root.hidden = true;

    const icon = makeIcon('tank', 'vm-icon vm-card-icon');
    root.appendChild(icon);

    const stackEl = el('span', 'vm-card-stack vm-num', root);
    const stackNode = textNode(stackEl);
    stackEl.hidden = true;

    const vetEl = el('span', 'vm-card-vet', root);
    vetEl.hidden = true;

    const barTrack = el('span', 'vm-card-bar', root);
    const bar = el('i', 'is-ok', barTrack);

    const cell: CardCell = { root, icon, bar, stackEl, stackNode, vetEl, id: 0, sig: '' };

    root.addEventListener('pointerenter', () => this.cb.sound('hover'));
    root.addEventListener('click', (ev) => {
      this.cb.sound('click');
      this.cb.focusCard(cell.id, ev.shiftKey || ev.ctrlKey);
    });
    return cell;
  }

  update(view: SelectionView): void {
    const empty = view.count === 0;
    if (empty !== this.empty) {
      this.empty = empty;
      this.root.classList.toggle('is-empty', empty);
    }
    if (empty) {
      for (let i = 0; i < this.liveCards; i++) this.cards[i].root.hidden = true;
      this.liveCards = 0;
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
      for (let i = 0; i < this.stanceButtons.length; i++) {
        const on = (STANCES[i][0] as number) === stance;
        this.stanceButtons[i].classList.toggle('is-active', on);
        this.stanceButtons[i].setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
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

interface BuildSlot {
  root: HTMLButtonElement;
  icon: SVGSVGElement;
  costNode: Text;
  queueEl: HTMLElement;
  queueNode: Text;
  readyEl: HTMLElement;
  progress: HTMLElement;
  /** The live cameo this slot renders, or null when the slot is empty. */
  cameo: HudCameo | null;
  /** Cached state, so a steady slot performs no DOM writes at all. */
  sig: string;
  key: string;
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
      b.appendChild(makeIcon(TAB_ICONS[t], 'vm-icon vm-tab-icon'));
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
      ['repair', 'repair', 'Repair structure'],
      ['sell', 'sell', 'Sell structure'],
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

    const readyEl = el('span', 'vm-slot-ready', root);
    textNode(readyEl, 'READY');
    readyEl.hidden = true;

    const track = el('span', 'vm-slot-track', root);
    const progress = el('i', '', track);
    progress.style.transform = 'scaleX(0)';

    const slot: BuildSlot = {
      root, icon, costNode, queueEl, queueNode, readyEl, progress,
      cameo: null, sig: '', key: '',
    };

    root.addEventListener('pointerenter', () => {
      if (slot.cameo === null) return;
      this.cb.sound('hover');
      this.tooltip.schedule(root, this.tipFor(slot.cameo), 'above');
    });
    root.addEventListener('pointerleave', () => this.tooltip.hide());
    root.addEventListener('focus', () => {
      if (slot.cameo !== null) this.tooltip.show(root, this.tipFor(slot.cameo), 'above');
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

  /* -- state ----------------------------------------------------------- */

  setExtrasProvider(fn: (key: string) => BuildExtras): void {
    this.extras = fn;
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

  private tipFor(c: HudCameo): TooltipContent {
    const extra = this.extras?.(c.key) ?? { buildTimeSec: 0, powerDelta: 0, blurb: '' };
    return {
      title: c.name,
      cost: c.cost,
      buildTimeSec: extra.buildTimeSec,
      powerDelta: extra.powerDelta,
      blurb: extra.blurb,
      requirement: c.available ? '' : c.reason,
      hotkey: '',
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

    for (let i = 0; i < n; i++) {
      const slot = this.slots[i];
      const c = list[i];
      slot.cameo = c;

      if (slot.key !== c.key) {
        slot.key = c.key;
        slot.root.hidden = false;
        slot.root.setAttribute('aria-label', c.name);
        slot.root.tabIndex = 0;
        setIcon(slot.icon, iconForBuildable(c.key, c.name, this.activeTab, c.isBuilding));
        slot.costNode.nodeValue = String(c.cost);
      }

      // One string comparison replaces eight DOM writes for a slot that has not
      // changed — which is nearly every slot, nearly every frame. The progress
      // term is quantized to half a percent so a build does not thrash the DOM
      // at 60 Hz for sub-pixel motion.
      const sig = `${c.queued}|${c.ready ? 1 : 0}|${c.onHold ? 1 : 0}|` +
        `${c.available ? 1 : 0}|${(c.progress * 200) | 0}`;
      if (sig === slot.sig) continue;
      slot.sig = sig;

      if (c.queued > 0) {
        slot.queueNode.nodeValue = String(Math.min(c.queued, MAX_QUEUE_DEPTH));
        slot.queueEl.hidden = false;
      } else if (!slot.queueEl.hidden) {
        slot.queueEl.hidden = true;
      }

      slot.readyEl.hidden = !c.ready;
      slot.root.classList.toggle('is-ready', c.ready);
      slot.root.classList.toggle('is-held', c.onHold);
      // A locked slot is DIMMED, never disabled: it must stay hoverable so the
      // tooltip can explain what unlocks it. That reason is the tech tree's
      // only tutorial.
      slot.root.classList.toggle('is-locked', !c.available);

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
    // The two labels SWAP rather than sit side by side: the dock is only ~106
    // design units wide and two tracked-out uppercase words do not fit at any
    // size a player can read.
    this.titleEl = el('span', 'vm-dock-title', mapHead);
    textNode(this.titleEl, 'TACTICAL');
    this.offlineEl = el('span', 'vm-map-offline', mapHead);
    textNode(this.offlineEl, 'NO RADAR');
    this.offlineEl.hidden = true;
    this.minimapField = el('div', 'vm-map-field', this.mapDock);
    this.minimapCanvas = el('canvas', 'vm-map-canvas', this.minimapField);

    /* -- bottom centre: selection --------------------------------------- */
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

  /** Radar dome online? Drives the map dock's "NO RADAR" state. */
  setRadarOnline(online: boolean): void {
    if (online === this.radarOnline) return;
    this.radarOnline = online;
    this.mapDock.classList.toggle('is-offline', !online);
    this.offlineEl.hidden = online;
    this.titleEl.hidden = !online;
  }

  /** The repair / sell tool. Also called by input on Escape and right-click. */
  setArmed(mode: ArmedMode): void {
    this.build.setArmed(mode);
    this.root.dataset.armed = mode;
  }

  get armedMode(): ArmedMode { return this.build.armedMode; }

  /** Build slots the grid can show at once. Diagnostics only. */
  get slotCount(): number { return this.build.slotCount; }

  /* -- frame ------------------------------------------------------------ */

  update(snap: HudSnapshot, view: SelectionView, dt: number): void {
    this.resources.update(snap, dt);
    this.selection.update(view);
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
