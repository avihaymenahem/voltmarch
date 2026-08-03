/**
 * ============================================================================
 * RED ALERT — src/ui/Sidebar.ts
 * ============================================================================
 * THE SIDEBAR. Built once as ~180 DOM nodes and then mutated in place; the
 * frame loop touches `style.setProperty`, `nodeValue` and `classList` only.
 *
 * THE VERTICAL STACK (VISUAL_DNA §2.2), design px against a 768-tall screen:
 *
 *     0-3     outer chrome cap, specular hairline at y=1
 *     4-15    credits readout          §2.3   recessed well, tallying digits
 *     19-38   top button pair          §2.4   one downward lens strip, split
 *     39-47   chrome bezel
 *     48-157  radar / minimap          §2.5   letterboxed, 1 px viewport rect
 *     158-170 bezel + 3 status LEDs
 *     171-196 repair / sell arc        §2.6   EXACTLY two buttons
 *     197-227 tab strip                §2.7   EXACTLY four tabs
 *     229-727 cameo grid               §2.8   2 columns, 5:4 art, 50 px pitch
 *     727-767 bottom cap               §2.10  shelf, lens arc, emblem, plinth
 *
 * Header is 229 design px and the footer is 41, so the grid gets
 * `floor((designH - 270) / 50)` rows, clamped to 4..12 — capped so the grid
 * never dominates a 4K screen, floored so a 720p window still has a sidebar
 * worth the name.
 *
 * THE FIVE HUD NON-NEGOTIABLES THIS FILE OWNS
 *   #2  2-column grid, 5:4 art (60 x 48 design), never 3-column, never square
 *   #3  4 tabs, order Structures / Defence / Infantry / Vehicles
 *   #4  exactly 2 arc buttons below the radar (wrench, `$`)
 *   #5  faction recolour is full-material (see Chrome.applySkin)
 *   #6  cameos are rendered mini-dioramas, never flat symbolic icons
 *
 * CLICK TIMING: every control fires on `pointerdown`, never `click`. The ~90 ms
 * difference is perceptible and it is most of why a soft interface feels soft.
 * ============================================================================
 */

import {
  HUD_GRID,
  HUD_INTERACTION,
  HUD_POWER,
  HUD_RADAR,
  MAX_QUEUE_DEPTH,
} from '../core/config';
import { BuildTab, Faction, type HudCameo, type HudSnapshot } from '../core/types';
import {
  Tooltip,
  applySkin,
  arcPath,
  cameoRowsFor,
  el,
  factionKey,
  formatCredits,
  lensStripPath,
  makeGlyph,
  roundRectPath,
  skinFor,
  svgEl,
  tabPlatePath,
  textNode,
  type GlyphName,
} from './Chrome';

/* ==========================================================================
 * SECTION 1 — PUBLIC SURFACE
 * ========================================================================== */

/** The two modal cursor modes the arc pair arms. */
export type ArmedMode = 'none' | 'repair' | 'sell';

export type HudSoundCue = 'hover' | 'click' | 'error' | 'tab';

export interface SidebarCallbacks {
  selectTab(tab: BuildTab): void;
  /** Left click / Enter on a cameo. */
  activate(tab: BuildTab, cameo: HudCameo): void;
  /** Right click on a cameo — cancel one queued item. */
  cancel(tab: BuildTab, cameo: HudCameo): void;
  /** The arc pair toggled a modal cursor. */
  setArmed(mode: ArmedMode): void;
  diplomacy(): void;
  options(): void;
  /** Optional UI audio; the audio module wires this when it lands. */
  sound(cue: HudSoundCue): void;
}

export interface SidebarOptions {
  /**
   * The `.ra-hud` root. It is both the DOM parent AND the skin host: every
   * custom property `applySkin` writes must land here, because the shared
   * gradient `<defs>`, the command bar, the superweapon rows and the tooltip
   * are siblings of the sidebar, not children of it — and because every
   * faction rule in hud.css is written `.ra-hud[data-faction='…']`.
   */
  parent: HTMLElement;
  faction: Faction;
  callbacks: SidebarCallbacks;
  /** Bound to the cameo renderer so hover starts the turntable. */
  onCameoHover(canvas: HTMLCanvasElement, hovered: boolean): void;
}

/** Everything the sidebar needs about a cameo that is not in `HudCameo`. */
export interface CameoExtras {
  buildTimeSec: number;
  powerDelta: number;
  blurb: string;
}

/* ==========================================================================
 * SECTION 2 — ONE CAMEO CELL
 *
 * Each cell caches its last-applied state so `update` is a handful of integer
 * comparisons per cell in the steady state. A sidebar that rewrites 20 DOM
 * subtrees every frame is a sidebar that causes layout thrash at 60 Hz.
 * ========================================================================== */

class CameoCell {
  readonly root: HTMLButtonElement;
  readonly art: HTMLCanvasElement;
  private readonly nameNode: Text;
  private readonly nameEl: HTMLElement;
  private readonly wipe: HTMLElement;
  private readonly hand: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly badgeNode: Text;

  /** Live payload; null for an empty slot. */
  cameo: HudCameo | null = null;
  tab: BuildTab = BuildTab.Structures;

  private lastKey = '';
  private lastName = '';
  private lastProgress = -1;
  private lastQueued = -1;
  private lastReady = false;
  private lastHold = false;
  private lastAvailable = true;
  private lastEmpty = true;

  constructor(parent: HTMLElement, index: number) {
    this.root = el('button', 'ra-cameo is-empty', parent) as HTMLButtonElement;
    this.root.type = 'button';
    this.root.tabIndex = -1;
    this.root.dataset.slot = String(index);

    this.art = el('canvas', 'ra-cameo-art', this.root) as HTMLCanvasElement;
    this.wipe = el('div', 'ra-cameo-wipe', this.root);
    this.hand = el('div', 'ra-cameo-hand', this.root);

    this.nameEl = el('div', 'ra-cameo-name', this.root);
    this.nameNode = textNode(this.nameEl);

    const ready = el('div', 'ra-cameo-ready', this.root);
    // The ONLY mixed-case string in the entire HUD. Keep it that way.
    textNode(ready, 'Ready');

    this.fill = el('div', 'ra-cameo-fill', this.root);
    this.badge = el('div', 'ra-cameo-badge', this.root);
    this.badgeNode = textNode(this.badge, '');
  }

  /** Backing-store size in device px. Called on every uiScale / DPR change. */
  resizeArt(dpr: number, uiScale: number): void {
    const w = Math.max(1, Math.round(HUD_GRID.artW * uiScale * dpr));
    const h = Math.max(1, Math.round(HUD_GRID.artH * uiScale * dpr));
    if (this.art.width === w && this.art.height === h) return;
    this.art.width = w;
    this.art.height = h;
  }

  setEmpty(): void {
    this.cameo = null;
    if (this.lastEmpty) return;
    this.lastEmpty = true;
    this.lastKey = '';
    this.root.className = 'ra-cameo is-empty';
    this.root.tabIndex = -1;
    this.root.removeAttribute('aria-label');
    this.nameNode.nodeValue = '';
    const ctx = this.art.getContext('2d');
    ctx?.clearRect(0, 0, this.art.width, this.art.height);
  }

  /** Returns true if the underlying def changed and the art must be re-bound. */
  setCameo(c: HudCameo, tab: BuildTab): boolean {
    this.cameo = c;
    this.tab = tab;

    const keyChanged = c.key !== this.lastKey;
    if (keyChanged) {
      this.lastKey = c.key;
      this.lastEmpty = false;
      this.root.tabIndex = 0;
    }

    // Long names wrap to two lines stacked UPWARD into the art ("PATRIOT /
    // MISSILES"), which is why the label is white-space: pre-line.
    const label = wrapName(c.name);
    if (label !== this.lastName) {
      this.lastName = label;
      this.nameNode.nodeValue = label;
      // Font-metric-free overflow guard: the label is 60 design px wide and the
      // condensed face is a STACK, so a machine without Arial Narrow renders a
      // much wider fallback. Measuring would force a layout read every frame;
      // a character count is deterministic and costs nothing.
      let longest = 0;
      for (const line of label.split('\n')) longest = Math.max(longest, line.length);
      this.nameEl.classList.toggle('is-long', longest > 11);
    }

    const progress = c.progress;
    if (Math.abs(progress - this.lastProgress) > 0.002) {
      this.lastProgress = progress;
      const deg = Math.max(0, Math.min(360, progress * 360));
      this.root.style.setProperty('--ra-wipe', `${deg.toFixed(1)}deg`);
      this.root.style.setProperty('--ra-fill', `${(progress * 100).toFixed(1)}%`);
    }

    if (c.queued !== this.lastQueued) {
      const punchUp = c.queued > this.lastQueued && this.lastQueued >= 0;
      this.lastQueued = c.queued;
      this.badgeNode.nodeValue = String(Math.min(MAX_QUEUE_DEPTH, c.queued));
      if (punchUp) {
        // Retrigger the 120 ms punch: remove, force reflow, re-add.
        this.badge.classList.remove('is-punch');
        void this.badge.offsetWidth;
        this.badge.classList.add('is-punch');
      }
    }

    const building = progress > 0 && progress < 1 && !c.ready;
    const cls = this.root.classList;
    cls.toggle('is-empty', false);
    cls.toggle('is-building', building);
    if (c.ready !== this.lastReady) { this.lastReady = c.ready; cls.toggle('is-ready', c.ready); }
    if (c.onHold !== this.lastHold) { this.lastHold = c.onHold; cls.toggle('is-hold', c.onHold); }
    if (c.available !== this.lastAvailable) {
      this.lastAvailable = c.available;
      cls.toggle('is-disabled', !c.available);
    }
    cls.toggle('is-queued', c.queued >= 2);

    this.root.setAttribute(
      'aria-label',
      c.available ? `${c.name}, ${c.cost} credits` : `${c.name}, unavailable: ${c.reason}`,
    );

    return keyChanged;
  }
}

/** Split a long cameo name onto two lines, longest-word-first. */
function wrapName(name: string): string {
  const up = name.toUpperCase();
  if (up.length <= 11) return up;
  const words = up.split(' ');
  if (words.length === 1) return up;
  // Balance the two lines rather than greedily filling the first.
  let best = 1;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const score = Math.abs(a - b) + Math.max(a, b);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

/* ==========================================================================
 * SECTION 3 — THE SIDEBAR
 * ========================================================================== */

export class Sidebar {
  readonly root: HTMLElement;
  readonly radarCanvas: HTMLCanvasElement;
  readonly radarField: HTMLElement;
  readonly tooltip: Tooltip;

  /** The .ra-hud root: skin host and parent of the shared gradient defs. */
  private readonly host: HTMLElement;
  private readonly cb: SidebarCallbacks;
  private readonly onCameoHover: SidebarOptions['onCameoHover'];

  private readonly creditsNode: Text;
  private readonly creditsFly: HTMLElement;
  private readonly creditsFlyNode: Text;
  private readonly leds: HTMLElement[] = [];
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly repairBtn: HTMLButtonElement;
  private readonly sellBtn: HTMLButtonElement;
  private readonly gridEl: HTMLElement;
  private readonly powerEl: HTMLElement;
  private readonly powerFill: HTMLElement;
  private readonly cells: CameoCell[] = [];

  private faction: Faction;
  private uiScale = 1;
  private dpr = 1;
  private rows = 10;

  private activeTab: BuildTab = BuildTab.Structures;
  private armed: ArmedMode = 'none';

  /** Tallying credits display; §2.3 wants a rolling counter, not a snap. */
  private creditsShown = 0;
  private creditsTarget = 0;
  private lastCreditsWritten = -1;

  private hoveredCell: CameoCell | null = null;
  private extras: (key: string) => CameoExtras = () => ({ buildTimeSec: 0, powerDelta: 0, blurb: '' });

  private disposed = false;

  constructor(opts: SidebarOptions) {
    this.host = opts.parent;
    this.cb = opts.callbacks;
    this.onCameoHover = opts.onCameoHover;
    this.faction = opts.faction;

    ensureGradientDefs(opts.parent);

    this.root = el('aside', 'ra-sidebar', opts.parent);
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Command sidebar');

    /* -- 0-3: outer chrome cap ------------------------------------------ */
    el('div', 'ra-cap-top', this.root);

    /* -- 4-15: credits readout ------------------------------------------ */
    const credits = el('div', 'ra-credits', this.root);
    credits.setAttribute('role', 'status');
    const digits = el('span', 'ra-credits-digits', credits);
    this.creditsNode = textNode(digits, '0');
    this.creditsFly = el('div', 'ra-credit-fly', credits);
    this.creditsFlyNode = textNode(this.creditsFly, '');

    /* -- 19-38: top button pair ----------------------------------------- */
    const toppair = el('div', 'ra-toppair', this.root);
    const diplomacy = this.makeLensButton(toppair, 'diplomacy', 'Diplomacy');
    const options = this.makeLensButton(toppair, 'options', 'Options');
    bindPress(diplomacy, () => { this.cb.sound('click'); this.cb.diplomacy(); });
    bindPress(options, () => { this.cb.sound('click'); this.cb.options(); });

    /* -- 39-170: radar block -------------------------------------------- */
    const radar = el('div', 'ra-radar', this.root);
    el('div', 'ra-radar-bezel-top', radar);
    this.radarField = el('div', 'ra-radar-field', radar);
    this.radarCanvas = el('canvas', '', this.radarField) as HTMLCanvasElement;
    const offline = el('div', 'ra-radar-offline', this.radarField);
    textNode(offline, 'No Radar');
    const bezelBottom = el('div', 'ra-radar-bezel-bottom', radar);
    for (let i = 0; i < HUD_RADAR.ledCount; i++) {
      this.leds.push(el('div', 'ra-led', bezelBottom));
    }

    /* -- 171-196: repair / sell arc — exactly two ------------------------ */
    const arcpair = el('div', 'ra-arcpair', this.root);
    this.repairBtn = this.makeArcButton(arcpair, 'repair', 'Repair mode');
    this.sellBtn = this.makeArcButton(arcpair, 'sell', 'Sell mode');
    bindPress(this.repairBtn, () => this.toggleArmed('repair'));
    bindPress(this.sellBtn, () => this.toggleArmed('sell'));

    /* -- 197-227: tab strip — exactly four, in the mandated order -------- */
    const tabsEl = el('div', 'ra-tabs', this.root);
    tabsEl.setAttribute('role', 'tablist');
    const TABS: ReadonlyArray<[BuildTab, GlyphName, string]> = [
      [BuildTab.Structures, 'tabStructures', 'Structures'],
      [BuildTab.Defense, 'tabDefence', 'Defences'],
      [BuildTab.Infantry, 'tabInfantry', 'Infantry'],
      [BuildTab.Vehicles, 'tabVehicles', 'Vehicles'],
    ];
    for (let i = 0; i < TABS.length; i++) {
      const [tab, glyph, label] = TABS[i];
      const btn = this.makeTabButton(tabsEl, glyph, label, i, TABS.length);
      this.tabs.push(btn);
      bindPress(btn, () => {
        this.cb.sound('tab');
        this.cb.selectTab(tab);
      });
      btn.addEventListener('pointerenter', () => this.cb.sound('hover'));
    }

    /* -- 229-727: power bar | cameo grid | piston rail ------------------- */
    const body = el('div', 'ra-body', this.root);

    this.powerEl = el('div', 'ra-power', body);
    const well = el('div', 'ra-power-well', this.powerEl);
    this.powerFill = el('div', 'ra-power-fill', well);
    el('div', 'ra-power-hatch', well);
    this.powerEl.setAttribute('role', 'meter');

    this.gridEl = el('div', 'ra-grid', body);
    el('div', 'ra-rail', body);

    /* -- 727-767: bottom cap -------------------------------------------- */
    const cap = el('div', 'ra-cap-bottom', this.root);
    const shelf = el('div', 'ra-cap-shelf', cap);
    const emblem = makeGlyph(this.faction === Faction.Soviets ? 'star' : 'eagle', 'ra-cap-emblem');
    shelf.appendChild(emblem);
    el('div', 'ra-cap-lens', cap);
    el('div', 'ra-cap-plinth', cap);

    this.tooltip = new Tooltip(opts.parent);

    applySkin(this.host, this.faction);
    this.setRows(10);
    this.selectTabVisual(BuildTab.Structures);
  }

  /* ------------------------------------------------------------------ */
  /* construction helpers                                                */
  /* ------------------------------------------------------------------ */

  private makeLensButton(parent: HTMLElement, glyph: GlyphName, label: string): HTMLButtonElement {
    const btn = el('button', 'ra-lensbtn', parent) as HTMLButtonElement;
    btn.type = 'button';
    btn.setAttribute('aria-label', label);

    // Wide at the top, tapering to a shallow arc at the bottom. NOT a rectangle.
    const svg = svgEl('svg', btn);
    svg.setAttribute('class', 'ra-shape');
    svg.setAttribute('viewBox', '0 0 80 20');
    svg.setAttribute('preserveAspectRatio', 'none');
    const p = svgEl('path', svg);
    p.setAttribute('d', lensStripPath(80, 20, 5, 3));
    p.setAttribute('fill', 'url(#ra-grad-lens)');
    const rim = svgEl('path', svg);
    rim.setAttribute('d', lensStripPath(80, 20, 5, 3));
    rim.setAttribute('fill', 'none');
    rim.style.stroke = 'var(--ra-lens-rim-hi)';
    rim.setAttribute('stroke-width', '1');

    btn.appendChild(makeGlyph(glyph, 'ra-glyph'));
    return btn;
  }

  private makeArcButton(parent: HTMLElement, glyph: GlyphName, label: string): HTMLButtonElement {
    const btn = el('button', 'ra-arcbtn', parent) as HTMLButtonElement;
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');

    // The arc BOWS UPWARD: convex top edge, matching concave bottom.
    const svg = svgEl('svg', btn);
    svg.setAttribute('class', 'ra-shape');
    svg.setAttribute('viewBox', '0 0 63 26');
    svg.setAttribute('preserveAspectRatio', 'none');
    const p = svgEl('path', svg);
    p.setAttribute('d', arcPath(63, 26, 4));
    p.setAttribute('fill', 'url(#ra-grad-lens)');
    const rim = svgEl('path', svg);
    rim.setAttribute('d', arcPath(63, 26, 4));
    rim.setAttribute('fill', 'none');
    rim.style.stroke = 'var(--ra-lens-rim-hi)';
    rim.setAttribute('stroke-width', '1');

    btn.appendChild(makeGlyph(glyph, 'ra-glyph'));
    return btn;
  }

  private makeTabButton(
    parent: HTMLElement, glyph: GlyphName, label: string, index: number, count: number,
  ): HTMLButtonElement {
    const btn = el('button', 'ra-tab', parent) as HTMLButtonElement;
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-selected', 'false');

    // Outer tabs sit ~2 px lower and each plate keystones toward the centre, so
    // the four plates read as one shallow arc rather than four buttons.
    const t = (index + 0.5) / count - 0.5;      // -0.375 .. +0.375
    const lean = -t * 3.2;
    const drop = Math.abs(t) * 5.0;

    const svg = svgEl('svg', btn);
    svg.setAttribute('class', 'ra-shape');
    svg.setAttribute('viewBox', '0 0 30 31');
    svg.setAttribute('preserveAspectRatio', 'none');
    const plate = svgEl('path', svg);
    plate.setAttribute('class', 'ra-tab-plate');
    plate.setAttribute('d', tabPlatePath(30, 31, lean, drop));
    plate.setAttribute('fill', 'url(#ra-grad-tab)');
    const rim = svgEl('path', svg);
    rim.setAttribute('d', tabPlatePath(30, 31, lean, drop));
    rim.setAttribute('fill', 'none');
    rim.style.stroke = 'var(--ra-lens-rim-hi)';
    rim.setAttribute('stroke-width', '1');

    btn.appendChild(makeGlyph(glyph, 'ra-glyph'));
    return btn;
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Recompute the row count for the current screen and rebuild the grid if it
   * changed. `designH` is the screen height expressed in design pixels.
   */
  layout(uiScale: number, dpr: number, screenH: number): void {
    this.uiScale = uiScale;
    this.dpr = dpr;

    const rows = cameoRowsFor(screenH, uiScale);
    if (rows !== this.rows) this.setRows(rows);
    for (const cell of this.cells) cell.resizeArt(dpr, uiScale);
  }

  private setRows(rows: number): void {
    this.rows = rows;
    const want = rows * HUD_GRID.columns;
    while (this.cells.length > want) {
      const cell = this.cells.pop();
      cell?.root.remove();
    }
    while (this.cells.length < want) {
      const cell = new CameoCell(this.gridEl, this.cells.length);
      this.bindCell(cell);
      this.cells.push(cell);
    }
    for (const cell of this.cells) cell.resizeArt(this.dpr, this.uiScale);
  }

  /** Total cameo slots currently on screen. Hud pages the list against this. */
  get slotCount(): number {
    return this.cells.length;
  }

  /* ------------------------------------------------------------------ */
  /* cell wiring                                                         */
  /* ------------------------------------------------------------------ */

  private bindCell(cell: CameoCell): void {
    const root = cell.root;

    // Fires on pointerdown, never click (§2.13). Right button cancels.
    root.addEventListener('pointerdown', (ev) => {
      const c = cell.cameo;
      if (!c) return;
      ev.preventDefault();
      if (ev.button === 2) {
        this.cb.sound('click');
        this.cb.cancel(cell.tab, c);
        return;
      }
      if (ev.button !== 0) return;
      if (!c.available) {
        this.cb.sound('error');
        return;
      }
      this.cb.sound('click');
      this.cb.activate(cell.tab, c);
    });

    root.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // Keyboard parity: the cells are real buttons, so focus and Tab already
    // work; Enter/Space must do what pointerdown does, and Delete cancels.
    root.addEventListener('keydown', (ev) => {
      const c = cell.cameo;
      if (!c) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (!c.available) { this.cb.sound('error'); return; }
        this.cb.sound('click');
        this.cb.activate(cell.tab, c);
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        this.cb.sound('click');
        this.cb.cancel(cell.tab, c);
      }
    });

    const enter = (): void => {
      const c = cell.cameo;
      if (!c) return;
      this.hoveredCell = cell;
      this.cb.sound('hover');
      this.onCameoHover(cell.art, true);
      const x = this.extras(c.key);
      this.tooltip.schedule(root, {
        title: c.name,
        cost: c.cost,
        buildTimeSec: x.buildTimeSec,
        powerDelta: x.powerDelta,
        blurb: x.blurb,
        requirement: c.available ? '' : c.reason,
      }, HUD_INTERACTION.tooltipDelayMs);
    };
    const leave = (): void => {
      if (this.hoveredCell === cell) this.hoveredCell = null;
      this.onCameoHover(cell.art, false);
      this.tooltip.hide();
    };

    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('focus', enter);
    root.addEventListener('blur', leave);
  }

  /** Injected by Hud so the tooltip can show cost / time / power / role. */
  setExtrasProvider(fn: (key: string) => CameoExtras): void {
    this.extras = fn;
  }

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  setFaction(faction: Faction): void {
    if (this.faction === faction) return;
    this.faction = faction;
    applySkin(this.host, faction);
    // The emblem is a different SHAPE per faction, not a recolour of one shape.
    const shelf = this.root.querySelector('.ra-cap-shelf');
    const old = shelf?.querySelector('.ra-cap-emblem');
    if (shelf && old) {
      old.remove();
      shelf.appendChild(makeGlyph(faction === Faction.Soviets ? 'star' : 'eagle', 'ra-cap-emblem'));
    }
    // The selected-tab treatment is faction-SPECIFIC, not a colour: Allied
    // inverts the plate, Soviet leaves all four plates brushed silver and only
    // recolours the glyph (§2.7). Without this re-run, a swap to Soviet keeps
    // the Allied pale-cyan plate and the tab strip reads as the wrong army.
    this.selectTabVisual(this.activeTab);
  }

  setRadarOnline(online: boolean): void {
    this.radarField.classList.toggle('is-offline', !online);
    // Two lit, one dim when the radar is up; all dim when it is not (§2.5).
    for (let i = 0; i < this.leds.length; i++) {
      this.leds[i].classList.toggle('is-lit', online && i < this.leds.length - 1);
    }
  }

  private toggleArmed(mode: ArmedMode): void {
    const next = this.armed === mode ? 'none' : mode;
    this.cb.sound('click');
    this.setArmed(next);
    this.cb.setArmed(next);
  }

  setArmed(mode: ArmedMode): void {
    this.armed = mode;
    this.repairBtn.classList.toggle('is-armed', mode === 'repair');
    this.sellBtn.classList.toggle('is-armed', mode === 'sell');
    this.repairBtn.setAttribute('aria-pressed', String(mode === 'repair'));
    this.sellBtn.setAttribute('aria-pressed', String(mode === 'sell'));
    document.body.style.cursor = mode === 'none' ? '' : mode === 'sell' ? 'crosshair' : 'cell';
  }

  get armedMode(): ArmedMode {
    return this.armed;
  }

  private selectTabVisual(tab: BuildTab): void {
    this.activeTab = tab;
    for (let i = 0; i < this.tabs.length; i++) {
      const on = i === (tab as number);
      this.tabs[i].classList.toggle('is-selected', on);
      this.tabs[i].setAttribute('aria-selected', String(on));
      // Allied selected = PLATE INVERSION (pale cyan-white plate, dark glyph).
      // Soviet keeps all four plates brushed silver and recolours the glyph.
      const plate = this.tabs[i].querySelector('.ra-tab-plate');
      if (plate) {
        plate.setAttribute(
          'fill',
          on && factionKey(this.faction) === 'allies' ? 'url(#ra-grad-tab-on)' : 'url(#ra-grad-tab)',
        );
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* per-frame update                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * `dt` is real frame time. Everything here is O(rows) integer work plus a
   * handful of custom-property writes; there is no layout read anywhere in the
   * path, so it cannot cause a forced reflow.
   */
  update(snap: HudSnapshot, dt: number, onArtRebind: (cell: CameoCell) => void): void {
    if (this.disposed) return;

    if (snap.activeTab !== this.activeTab) this.selectTabVisual(snap.activeTab);

    this.tickCredits(snap.credits, dt);
    this.updatePower(snap.powerProduced, snap.powerConsumed, snap.brownout);
    this.setRadarOnline(snap.hasRadar);

    for (let i = 0; i < this.tabs.length; i++) {
      this.tabs[i].classList.toggle('is-alert', snap.tabAlert[i] === true);
    }

    const list = snap.cameos[snap.activeTab] ?? [];
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (i < list.length) {
        if (cell.setCameo(list[i], snap.activeTab)) onArtRebind(cell);
      } else {
        cell.setEmpty();
      }
    }
  }

  /**
   * §2.3: tally toward the true value at 12% of the remaining delta per frame,
   * minimum 3 per frame. A snapping number is the single most common way a
   * remake's credits readout gives itself away.
   */
  private tickCredits(target: number, dt: number): void {
    this.creditsTarget = target;
    const delta = this.creditsTarget - this.creditsShown;
    if (delta !== 0) {
      // Frame-rate independent: the spec's per-frame rate is quoted at 60 Hz.
      const frames = Math.max(1, Math.min(6, dt * 60));
      const step = Math.max(HUD_INTERACTION.creditsTallyMin, Math.abs(delta) * HUD_INTERACTION.creditsTallyRate) * frames;
      if (Math.abs(delta) <= step) this.creditsShown = this.creditsTarget;
      else this.creditsShown += Math.sign(delta) * step;
    }
    const shown = Math.round(this.creditsShown);
    if (shown !== this.lastCreditsWritten) {
      this.lastCreditsWritten = shown;
      this.creditsNode.nodeValue = formatCredits(shown);
    }
  }

  /** The Δ flyout: `+150` green / `−1000` red, rises 12 px over 600 ms. */
  creditFlyout(delta: number): void {
    if (delta === 0) return;
    const gain = delta > 0;
    this.creditsFlyNode.nodeValue = `${gain ? '+' : '−'}${Math.abs(Math.round(delta))}`;
    this.creditsFly.classList.remove('is-live', 'is-gain', 'is-loss');
    void this.creditsFly.offsetWidth;
    this.creditsFly.classList.add('is-live', gain ? 'is-gain' : 'is-loss');
  }

  /**
   * Bottom-anchored tri-band. Red from the bottom is the power DRAWN, green
   * above it is the surplus, and the yellow band is the moving boundary marker
   * — not a fixed element, so it vanishes when drain approaches total.
   */
  private updatePower(produced: number, consumed: number, brownout: boolean): void {
    const ceiling = Math.max(1, Math.max(produced, consumed) * HUD_POWER.headroom);
    const total = Math.min(1, Math.max(produced, consumed) / ceiling);
    const drawn = Math.min(1, consumed / ceiling);

    // Percentages are of the FILL element, which is itself `total` tall.
    const drawnPct = total > 0 ? (drawn / total) * 100 : 0;
    const band = consumed >= produced * 0.97 ? 0 : HUD_POWER.yellowBand * 100;

    this.powerFill.style.setProperty('--ra-power-total', `${(total * 100).toFixed(1)}%`);
    this.powerFill.style.setProperty('--ra-power-red', `${drawnPct.toFixed(1)}%`);
    this.powerFill.style.setProperty('--ra-power-yellow', `${Math.min(100, drawnPct + band).toFixed(1)}%`);
    this.powerEl.classList.toggle('is-brownout', brownout);
    this.powerEl.setAttribute('aria-valuenow', String(Math.round(produced - consumed)));
    this.powerEl.title = `Power ${Math.round(produced)} / ${Math.round(consumed)}`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tooltip.dispose();
    this.root.remove();
    this.cells.length = 0;
    document.body.style.cursor = '';
  }
}

export type { CameoCell };

/* ==========================================================================
 * SECTION 4 — SHARED SVG GRADIENTS
 *
 * One hidden <svg><defs> holding every plate gradient. The stops read the same
 * CSS custom properties `applySkin` writes, so a faction swap repaints every
 * plate in the sidebar without touching a single element.
 *
 * TWO NON-OBVIOUS CONSTRAINTS, both learned the hard way from a screenshot in
 * which every lens rendered as an empty outline:
 *
 *  1. `var()` DOES NOT RESOLVE IN AN SVG PRESENTATION ATTRIBUTE. Custom
 *     properties are a CSS feature; `stop-color="var(--x)"` is simply an
 *     invalid attribute value and the stop falls back to black. The stops must
 *     be set as inline STYLE, where `var()` is legal.
 *
 *  2. A gradient's stops are resolved against the gradient element's OWN
 *     position in the tree, not the position of whatever references it. So the
 *     defs must live INSIDE the element carrying the custom properties — the
 *     `.ra-hud` root — or every `var()` resolves to nothing even though the
 *     `url(#id)` reference itself works fine from anywhere in the document.
 * ========================================================================== */

function ensureGradientDefs(host: HTMLElement): void {
  const doc = host.ownerDocument ?? document;
  if (host.querySelector(':scope > #ra-hud-defs') !== null) return;

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'ra-hud-defs';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  const defs = svgEl('defs', svg);

  // The interactive lens: Allied #7ED8FC -> #3B90F7 -> #2265FB -> #050E58,
  // Soviet brushed silver. Four stops, exactly as measured.
  addGradient(defs, 'ra-grad-lens', [
    [0.0, 'var(--ra-lens-0)'],
    [0.34, 'var(--ra-lens-1)'],
    [0.68, 'var(--ra-lens-2)'],
    [1.0, 'var(--ra-lens-3)'],
  ]);

  // The unselected tab plate: darker core with a top-lit face.
  addGradient(defs, 'ra-grad-tab', [
    [0.0, 'var(--ra-lens-1)'],
    [0.45, 'var(--ra-lens-2)'],
    [1.0, 'var(--ra-lens-3)'],
  ]);

  // Allied plate inversion: pale cyan-white. Soviet never uses this one.
  addGradient(defs, 'ra-grad-tab-on', [
    [0.0, 'var(--ra-accent)'],
    [0.55, 'var(--ra-accent-hi)'],
    [1.0, 'var(--ra-accent)'],
  ]);

  // The canonical 3-zone chrome ramp for plates that are metal, not lens.
  addGradient(defs, 'ra-grad-metal', [
    [0.0, 'var(--ra-bevel-hi)'],
    [0.08, 'var(--ra-metal-hi)'],
    [0.4, 'var(--ra-metal-mid)'],
    [0.85, 'var(--ra-metal-lo)'],
    [1.0, 'var(--ra-bevel-lo)'],
  ]);

  host.appendChild(svg);
}

function addGradient(defs: SVGDefsElement, id: string, stops: ReadonlyArray<[number, string]>): void {
  const g = svgEl('linearGradient', defs);
  g.setAttribute('id', id);
  g.setAttribute('x1', '0');
  g.setAttribute('y1', '0');
  g.setAttribute('x2', '0');
  g.setAttribute('y2', '1');
  for (const [offset, color] of stops) {
    const s = svgEl('stop', g);
    s.setAttribute('offset', String(offset));
    // STYLE, not attribute — see constraint 1 above.
    s.style.stopColor = color;
  }
}

/** Every control fires on pointerdown; `click` is ~90 ms of perceptible mush. */
function bindPress(btn: HTMLElement, fn: () => void): void {
  btn.addEventListener('pointerdown', (ev) => {
    if ((ev as PointerEvent).button !== 0) return;
    ev.preventDefault();
    fn();
  });
  btn.addEventListener('keydown', (ev) => {
    const k = (ev as KeyboardEvent).key;
    if (k !== 'Enter' && k !== ' ') return;
    ev.preventDefault();
    fn();
  });
}

/** Re-exported so Hud can build a cell-shaped path without importing Chrome. */
export { roundRectPath, skinFor };
