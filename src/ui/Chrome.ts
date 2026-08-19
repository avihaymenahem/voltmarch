/**
 * ============================================================================
 * src/ui/Chrome.ts — PANEL PRIMITIVES
 * ============================================================================
 * The material vocabulary of the modern HUD, in one file, so the resource
 * strip, the minimap dock, the selection panel and the build grid cannot drift
 * apart.
 *
 * THE MATERIAL, stated once
 * -------------------------
 *   surface   `rgba(9,13,20,.86)` + `backdrop-filter: blur(14px) saturate(1.1)`
 *   edge      ONE 1 px hairline at `rgba(255,255,255,.16)`, plus a 1 px accent
 *             rule along the panel's top edge and an accent tick at the notch
 *   corner    a 10 px notch on the diagonal, cut with `clip-path`
 *   accent    the owning faction's `hudAccent`, and NOTHING ELSE is saturated
 *   type      condensed sans; labels uppercase 11px at .16em tracking; every
 *             number tabular
 *
 * THE OPACITY IS NOT A TASTE CALL. The grade puts a clipping-white, heavily
 * saturated battlefield behind these panels. At .72 the surface was a tint: a
 * white structure under the build grid dragged the composite to ~#5B6068 and
 * `--vm-dim` text on it measured 2.4:1, below every legibility floor there is.
 * At .86 the same worst case composites to ~#1D242E and the same text measures
 * 5.6:1. See section 12 of hud.css for the matched no-blur pair.
 *
 * There are no bevels, no rivets, no gradients and no drop shadows anywhere in
 * `src/ui/**`. Depth is translucency plus that single hairline — that is the
 * entire trick, and adding a second light source to fake more of it is what
 * made the previous interface look like 2003.
 *
 * ACCENT IS READ, NEVER WRITTEN
 * -----------------------------
 * `accentFor()` reads `FACTION_PALETTE[key].hudAccent`. A third faction gets
 * its accent by existing in that table, with no edit here. The semantic
 * colours — amber for resource pressure, green for health and ready, red for
 * alerts — are fixed, because a Soviet player must not read "low power" as
 * "Soviet" and an Allied player must not read "under attack" as "Allied".
 *
 * RESOLUTION INDEPENDENCE
 * -----------------------
 * `--vm-u` is one design unit at the current uiScale and every dimension in
 * hud.css is a multiple of it. Hairlines stay literal `1px` so an edge always
 * lands on exactly one device pixel.
 *
 * LEGACY SECTION
 * --------------
 * Section 9 keeps the pure helpers of the retired chrome language. They are not
 * used by anything in the modern HUD; they survive because `tests/hud.spec.ts`
 * and `tests/cameos.spec.ts` pin them and those files are owned elsewhere. They
 * should be deleted together with `src/ui/Cameos.ts` and those two specs in one
 * commit — see the note above the section.
 * ============================================================================
 */

import {
  FACTION_PALETTE,
  HUD_DESIGN_WIDTH,
  HUD_GRID,
  HUD_INTERACTION,
  HUD_STACK,
  HUD_SKIN_ALLIES,
  HUD_SKIN_SOVIETS,
  HUD_UI_SCALE_BASE_HEIGHT,
  HUD_UI_SCALE_MAX,
  HUD_UI_SCALE_MIN,
  HUD_UI_SCALE_STEPS,
  type HudFactionSkin,
} from '../core/config';
import { Faction, FACTION_PALETTE_KEYS, type FactionPaletteKey } from '../core/types';

/* ==========================================================================
 * SECTION 1 — COLOUR MATH
 * ========================================================================== */

/** `#rrggbb` (or `#rgb`) -> [r,g,b] in 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend in sRGB. Fine for UI chrome; never used on albedo. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** `"53,200,240"` — the form a CSS custom property needs for `rgb(var(--x)/a)`. */
export function rgbTriplet(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${r},${g},${b}`;
}

/* ==========================================================================
 * SECTION 2 — THE THEME
 *
 * One faction, one accent, derived once and pushed into custom properties.
 * Every panel, icon, bar and border in the HUD reads them, so a faction change
 * is one call and zero re-layout.
 * ========================================================================== */

/** Palette key for a faction. Unlike `factionKey`, Neutral keeps its own row. */
/** The art-side name of a faction. Re-exported so `src/ui/**` has one import. */
export type PaletteKey = FactionPaletteKey;

/**
 * `FACTION_PALETTE` is declared in `Faction` order — neutral(0), allies(1),
 * soviets(2), meridian(3) — so the enum value indexes it directly. Resolving by
 * INDEX rather than by a hard-coded switch is what let the Meridian Pact get a
 * working HUD accent from a single `FactionLook` row in config.ts with no edit
 * here, and it will do the same for a fifth army.
 */
const PALETTE_ORDER: readonly string[] = Object.keys(FACTION_PALETTE);

export function paletteKeyFor(faction: Faction): PaletteKey {
  const byOrder = PALETTE_ORDER[faction as number];
  if (byOrder !== undefined) return byOrder as PaletteKey;
  return FACTION_PALETTE_KEYS[faction as number] ?? 'neutral';
}

/**
 * The faction's accent, straight out of the art tables. This is deliberately a
 * READ: a third faction gets a HUD accent by adding a `FactionLook` row, not by
 * editing `src/ui/**`. The literal is only reached if the table itself is
 * missing a row, which would already be a content bug.
 */
export function accentFor(faction: Faction): string {
  const table = FACTION_PALETTE as unknown as Record<string, { hudAccent?: string } | undefined>;
  return table[paletteKeyFor(faction)]?.hudAccent ?? '#35C8F0';
}

/** The resolved chrome colours for one faction. */
export interface HudTheme {
  /** The one saturated colour in the interface. */
  accent: string;
  /** A lifted accent for focus rings and the "READY" edge. */
  accentHi: string;
  /** A sunk accent for inactive tab rules and disabled slot borders. */
  accentLo: string;
  /** `"r,g,b"`, for alpha compositing in CSS. */
  accentRgb: string;
}

export function themeFor(faction: Faction): HudTheme {
  const accent = accentFor(faction);
  return {
    accent,
    // A fixed lift toward white rather than an HSL rotation: an accent that is
    // already near-white must not blow out, and a dark one must still brighten.
    accentHi: mixHex(accent, '#FFFFFF', 0.42),
    accentLo: mixHex(accent, '#070A10', 0.45),
    accentRgb: rgbTriplet(accent),
  };
}

/**
 * Push a theme onto the HUD root. This is the entire faction recolour: nothing
 * in hud.css names a faction colour, only `var(--vm-accent*)`.
 */
export function applyTheme(root: HTMLElement, faction: Faction): HudTheme {
  const t = themeFor(faction);
  const s = root.style;
  root.dataset.faction = paletteKeyFor(faction);
  s.setProperty('--vm-accent', t.accent);
  s.setProperty('--vm-accent-hi', t.accentHi);
  s.setProperty('--vm-accent-lo', t.accentLo);
  s.setProperty('--vm-accent-rgb', t.accentRgb);
  return t;
}

/**
 * `uiScale = clamp(floor(screenH / 720 * 4) / 4, 1, 4)`.
 *
 * Still quarter-quantized. The bevels are gone, but a hairline border is even
 * less forgiving than a bevel was: at a fractional scale a 1 px edge resolves
 * to two half-lit device pixels and the panel edge turns to fog.
 */
export function computeUiScale(screenH: number): number {
  const raw = (screenH / HUD_UI_SCALE_BASE_HEIGHT) * HUD_UI_SCALE_STEPS;
  const stepped = Math.floor(raw) / HUD_UI_SCALE_STEPS;
  return Math.min(HUD_UI_SCALE_MAX, Math.max(HUD_UI_SCALE_MIN, stepped));
}

/* ==========================================================================
 * SECTION 3 — DOM HELPERS
 *
 * No framework, no virtual DOM, no `innerHTML` with interpolated content. The
 * HUD is a few hundred nodes built once and mutated in place; the frame loop
 * touches `nodeValue`, `classList` and `style.setProperty` and nothing else.
 * ========================================================================== */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: Node,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  if (parent !== undefined) parent.appendChild(node);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  parent?: Node,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (parent !== undefined) parent.appendChild(node);
  return node;
}

/** A text node parked inside `parent`, returned so callers can poke nodeValue. */
export function textNode(parent: Node, initial = ''): Text {
  const t = document.createTextNode(initial);
  parent.appendChild(t);
  return t;
}

/** A `<span>` holding exactly one text node. The HUD's unit of readout. */
export function label(parent: Node, className: string, initial = ''): Text {
  return textNode(el('span', className, parent), initial);
}

/**
 * A glass panel: the one surface primitive.
 *
 * `notch` picks which corners are cut. `'diag'` — top-left and bottom-right —
 * is the house diagonal; everything in the HUD leans the same way so the panels
 * read as one machined set rather than four unrelated widgets. `'diag-rev'`
 * mirrors it, `'ends'` chamfers both short edges (the resource strip).
 */
export type NotchStyle = 'diag' | 'diag-rev' | 'ends' | 'none';

export function panel(
  parent: Node,
  className: string,
  notch: NotchStyle = 'diag',
): HTMLDivElement {
  const node = el('div', `vm-panel ${className}`, parent);
  node.dataset.notch = notch;
  // The accent edge. It is a real element rather than a third pseudo-element
  // because the treatment is TWO marks — a 1 px rule along the top edge and a
  // 1 px tick lying on the notch diagonal — and `::before` is already spoken
  // for by the masked hairline rim. It is inserted FIRST so it can never be
  // reordered by a caller appending content afterwards.
  el('i', 'vm-panel-edge', node);
  return node;
}

/** A button that is a real `<button>`, so focus, Enter and Space are free. */
export function button(parent: Node, className: string, ariaLabel: string): HTMLButtonElement {
  const b = el('button', className, parent);
  b.type = 'button';
  b.setAttribute('aria-label', ariaLabel);
  return b;
}

/* ==========================================================================
 * SECTION 4 — FORMATTING
 *
 * Every number in the HUD is tabular. A credits readout whose digits change
 * width is the single most obvious "this is a web page" tell left once the
 * bevels are gone.
 * ========================================================================== */

/** Credits: plain digits, no `$`, no separator, never negative. */
export function formatCredits(value: number): string {
  const v = value < 0 ? 0 : value > 99999999 ? 99999999 : Math.floor(value);
  return String(v);
}

/** Thousands-separated credits for the tooltip, where density is not at issue. */
export function formatCost(value: number): string {
  const v = Math.max(0, Math.floor(value));
  return v >= 1000 ? `${Math.floor(v / 1000)},${String(v % 1000).padStart(3, '0')}` : String(v);
}

/** `MM:SS`, clamped, rounding UP so a countdown never shows 00:00 while live. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

/** The match clock, which counts UP and floors instead. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

/**
 * A per-minute rate for the income telltale. Rounded to 10 credits, because a
 * number that jitters in the ones column reads as noise rather than as a rate.
 */
export function formatRate(perMinute: number): string {
  const v = Math.max(0, Math.round(perMinute / 10) * 10);
  return `${v}`;
}

/**
 * `M:SS` for a build countdown. Distinct from `formatClock`: a build timer that
 * pads to `0:07` is easier to read at 8 px than `00:07`, and it never needs
 * hours.
 */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** One decimal, no trailing `.0`. Used by the stat row. */
export function formatStat(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ==========================================================================
 * SECTION 5 — THE ROLLING COUNTER
 *
 * Credits tick toward their target instead of snapping. This is the oldest
 * trick in the genre and it is worth every line: a number that rolls tells you
 * money is MOVING, which is the one economic fact the player needs at a glance.
 * ========================================================================== */

export class RollingCounter {
  private displayed = 0;
  private target = 0;
  private initialised = false;

  /** Read the current displayed integer. */
  get value(): number { return Math.round(this.displayed); }

  /** Jump with no roll — match start, or a faction swap. */
  reset(value: number): void {
    this.displayed = value;
    this.target = value;
    this.initialised = true;
  }

  setTarget(value: number): void {
    if (!this.initialised) { this.reset(value); return; }
    this.target = value;
  }

  /**
   * Advance one frame. Exponential toward the target with a floor, so a big
   * windfall rolls fast and the last few credits still land promptly instead of
   * asymptoting forever.
   */
  step(dt: number): boolean {
    const delta = this.target - this.displayed;
    if (delta === 0) return false;
    const mag = Math.abs(delta);
    const rate = HUD_INTERACTION.creditsTallyRate * 60;
    const move = Math.max(HUD_INTERACTION.creditsTallyMin, mag * rate * dt);
    if (move >= mag) { this.displayed = this.target; return true; }
    this.displayed += Math.sign(delta) * move;
    return true;
  }
}

/* ==========================================================================
 * SECTION 6 — TOOLTIP
 *
 * One glass chip, positioned against its anchor and flipped to stay on screen.
 * It is the same material as everything else on purpose: a tooltip in a
 * different material reads as a browser artefact rather than part of the HUD.
 * ========================================================================== */

export interface TooltipContent {
  title: string;
  /** Credits. 0 hides the row. */
  cost: number;
  /** Seconds. 0 hides the row. */
  buildTimeSec: number;
  /** Power delta. 0 hides the row. */
  powerDelta: number;
  blurb: string;
  /**
   * What this needs before it can be built, stated whether or not it is
   * satisfied — "Requires Radar Dome" is the tech tree's only documentation and
   * a player reads it BEFORE the slot unlocks, not after.
   */
  prereq: string;
  /** Shown in red. Empty when the item is available. */
  requirement: string;
  /** Keyboard hint, e.g. `Q`. Empty to hide. */
  hotkey: string;
}

/** Which side of the anchor the tip prefers. It flips when it would clip. */
export type TooltipSide = 'above' | 'left';

export class Tooltip {
  readonly root: HTMLElement;

  private readonly titleNode: Text;
  private readonly hotkeyEl: HTMLElement;
  private readonly hotkeyNode: Text;
  private readonly statsRow: HTMLElement;
  private readonly costEl: HTMLElement;
  private readonly costNode: Text;
  private readonly timeEl: HTMLElement;
  private readonly timeNode: Text;
  private readonly powerEl: HTMLElement;
  private readonly powerNode: Text;
  private readonly blurbEl: HTMLElement;
  private readonly blurbNode: Text;
  private readonly prereqEl: HTMLElement;
  private readonly prereqNode: Text;
  private readonly reqEl: HTMLElement;
  private readonly reqNode: Text;

  private timer = 0;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'vm-tip', parent);
    this.root.setAttribute('role', 'tooltip');
    this.root.hidden = true;

    const head = el('div', 'vm-tip-head', this.root);
    this.titleNode = label(head, 'vm-tip-title');
    this.hotkeyEl = el('span', 'vm-tip-key', head);
    this.hotkeyNode = textNode(this.hotkeyEl);

    this.statsRow = el('div', 'vm-tip-stats', this.root);
    this.costEl = el('span', 'vm-tip-stat is-cost', this.statsRow);
    this.costNode = textNode(this.costEl);
    this.timeEl = el('span', 'vm-tip-stat', this.statsRow);
    this.timeNode = textNode(this.timeEl);
    this.powerEl = el('span', 'vm-tip-stat', this.statsRow);
    this.powerNode = textNode(this.powerEl);

    this.blurbEl = el('div', 'vm-tip-blurb', this.root);
    this.blurbNode = textNode(this.blurbEl);

    this.prereqEl = el('div', 'vm-tip-prereq', this.root);
    this.prereqNode = textNode(this.prereqEl);

    this.reqEl = el('div', 'vm-tip-req', this.root);
    this.reqNode = textNode(this.reqEl);
  }

  /** Arm the hover delay. Calling it again with a new anchor restarts it. */
  schedule(anchor: HTMLElement, content: TooltipContent, side: TooltipSide = 'above'): void {
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.show(anchor, content, side);
    }, HUD_INTERACTION.tooltipDelayMs);
  }

  show(anchor: HTMLElement, c: TooltipContent, side: TooltipSide = 'above'): void {
    this.titleNode.nodeValue = c.title;

    this.hotkeyNode.nodeValue = c.hotkey;
    this.hotkeyEl.hidden = c.hotkey === '';

    // Every stat carries its unit. A bare "1,000  12  -50" is three numbers the
    // player has to guess the meaning of, and guessing wrong about power is how
    // a base browns out.
    this.costNode.nodeValue = c.cost > 0 ? `${formatCost(c.cost)} CR` : '';
    this.costEl.hidden = c.cost <= 0;

    this.timeNode.nodeValue = c.buildTimeSec > 0 ? `${c.buildTimeSec.toFixed(0)}s BUILD` : '';
    this.timeEl.hidden = c.buildTimeSec <= 0;

    this.powerNode.nodeValue = c.powerDelta !== 0
      ? `${c.powerDelta > 0 ? '+' : ''}${c.powerDelta} PWR` : '';
    this.powerEl.hidden = c.powerDelta === 0;
    this.powerEl.classList.toggle('is-drain', c.powerDelta < 0);

    this.blurbNode.nodeValue = c.blurb;
    this.blurbEl.hidden = c.blurb === '';

    // The prerequisite is suppressed when it is ALSO the unmet requirement, or
    // the tip says the same sentence twice in two colours.
    const showPrereq = c.prereq !== '' && c.prereq !== c.requirement;
    this.prereqNode.nodeValue = showPrereq ? c.prereq : '';
    this.prereqEl.hidden = !showPrereq;

    this.reqNode.nodeValue = c.requirement;
    this.reqEl.hidden = c.requirement === '';

    // Unhide BEFORE measuring, or offsetWidth is 0 and the clamp does nothing.
    this.root.hidden = false;
    this.visible = true;
    this.place(anchor, side);
  }

  private place(anchor: HTMLElement, side: TooltipSide): void {
    const a = anchor.getBoundingClientRect();
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    let left: number;
    let top: number;

    if (side === 'left') {
      left = a.left - w - pad;
      top = a.top + a.height * 0.5 - h * 0.5;
      // Flip to the right when there is no room on the left.
      if (left < pad) left = Math.min(vw - w - pad, a.right + pad);
    } else {
      left = a.left + a.width * 0.5 - w * 0.5;
      top = a.top - h - pad;
      // Flip below when the anchor is against the top edge.
      if (top < pad) top = Math.min(vh - h - pad, a.bottom + pad);
    }

    this.root.style.left = `${Math.round(Math.max(pad, Math.min(vw - w - pad, left)))}px`;
    this.root.style.top = `${Math.round(Math.max(pad, Math.min(vh - h - pad, top)))}px`;
  }

  cancel(): void {
    if (this.timer !== 0) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  hide(): void {
    this.cancel();
    if (!this.visible) return;
    this.visible = false;
    this.root.hidden = true;
  }

  dispose(): void {
    this.cancel();
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 7 — EVENT TOASTS
 *
 * Small glass chips in the top-left with a coloured left edge. Accent for
 * information, amber for a warning, red for an alert. They auto-expire and they
 * COALESCE: five structures finishing in one second is one chip that counts to
 * five, not five chips that push the fifth off screen.
 * ========================================================================== */

export type ToastKind = 'info' | 'warn' | 'alert' | 'good';

/** Seconds a chip lives before it starts fading. */
const TOAST_LIFE: Readonly<Record<ToastKind, number>> = {
  info: 4.0,
  good: 4.5,
  warn: 6.0,
  alert: 6.5,
};
/** Seconds of fade-out after the life expires. */
const TOAST_FADE = 0.4;
/** Chips on screen at once. Oldest is retired first. */
const TOAST_MAX = 5;
/** Seconds within which a repeat of the same key merges into the live chip. */
const TOAST_MERGE = 6.0;

interface ToastEntry {
  root: HTMLElement;
  countEl: HTMLElement;
  countNode: Text;
  titleNode: Text;
  detailEl: HTMLElement;
  detailNode: Text;
  key: string;
  /**
   * Severity of the chip currently in this slot.
   *
   * STORED RATHER THAN DERIVED FROM `root.className`, which already carries it
   * as `is-${kind}`. Reading it back out of a class string would be a second
   * spelling of the same fact, and the pool reassigns `className` wholesale on
   * every push — so the string is right by accident of ordering rather than by
   * construction. `alerts()` below is the reader.
   */
  kind: ToastKind;
  age: number;
  life: number;
  count: number;
  dying: boolean;
}

export class ToastStack {
  readonly root: HTMLElement;
  private readonly live: ToastEntry[] = [];
  private readonly pool: ToastEntry[] = [];
  private readonly iconHost: (parent: HTMLElement, kind: ToastKind) => void;

  constructor(parent: HTMLElement, iconHost: (parent: HTMLElement, kind: ToastKind) => void) {
    this.root = el('div', 'vm-toasts', parent);
    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-live', 'polite');
    this.iconHost = iconHost;
  }

  /**
   * Raise a chip. `key` is the coalescing identity — pass the event kind plus
   * whatever makes two of them "the same thing" (usually nothing).
   */
  push(kind: ToastKind, key: string, title: string, detail = ''): void {
    for (const t of this.live) {
      if (t.key !== key || t.dying || t.age > TOAST_MERGE) continue;
      t.count++;
      t.age = 0;
      t.countNode.nodeValue = `x${t.count}`;
      t.countEl.hidden = false;
      t.detailNode.nodeValue = detail;
      t.detailEl.hidden = detail === '';
      // Re-run the entry animation so a merge is visible rather than silent.
      t.root.classList.remove('is-enter');
      void t.root.offsetWidth;
      t.root.classList.add('is-enter');
      return;
    }

    while (this.live.length >= TOAST_MAX) this.retire(0);

    const entry = this.pool.pop() ?? this.build();
    entry.key = key;
    entry.kind = kind;
    entry.age = 0;
    entry.life = TOAST_LIFE[kind];
    entry.count = 1;
    entry.dying = false;
    entry.titleNode.nodeValue = title;
    entry.detailNode.nodeValue = detail;
    entry.detailEl.hidden = detail === '';
    entry.countEl.hidden = true;
    entry.root.className = `vm-toast is-${kind} is-enter`;
    entry.root.style.opacity = '';

    // Rebuild the leading icon: it is per-kind and the chip is pooled.
    const slot = entry.root.firstElementChild as HTMLElement;
    while (slot.firstChild !== null) slot.removeChild(slot.firstChild);
    this.iconHost(slot, kind);

    this.root.appendChild(entry.root);
    this.live.push(entry);
  }

  private build(): ToastEntry {
    const root = el('div', 'vm-toast');
    el('span', 'vm-toast-icon', root);
    const body = el('div', 'vm-toast-body', root);
    const titleNode = label(body, 'vm-toast-title');
    const detailEl = el('span', 'vm-toast-detail', body);
    const detailNode = textNode(detailEl);
    const countEl = el('span', 'vm-toast-count', root);
    const countNode = textNode(countEl);
    return {
      root, countEl, countNode, titleNode, detailEl, detailNode,
      key: '', kind: 'info', age: 0, life: 0, count: 1, dying: false,
    };
  }

  /* ------------------------------------------------------------------ *
   * HOW LOUD IS THE STACK?
   *
   * Two reads, for one caller that must not talk over the player:
   * `src/sim/tips.system.ts`, through `Hud.toastAlerts` / `Hud.toastCrowded`.
   * A tip is the lowest-priority thing that can appear here, and `push` above
   * RETIRES THE OLDEST CHIP when the stack is full — so a tip arriving at
   * capacity does not queue behind an alert, it deletes one.
   *
   * Deliberately two narrow questions rather than one `busy()` boolean. The
   * decision about what outranks a tip belongs to the module that owns tips;
   * this class owns the facts. Publishing a verdict here would put the same
   * rule in two places the first time a second caller wants a different one.
   * ------------------------------------------------------------------ */

  /** Live chips of kind `alert` that have not started fading out. */
  alerts(): number {
    let n = 0;
    for (const t of this.live) if (!t.dying && t.kind === 'alert') n++;
    return n;
  }

  /** True when the next push would evict a chip rather than join the stack. */
  crowded(): boolean {
    return this.live.length >= TOAST_MAX;
  }

  /** Age every chip. Called once per rendered frame. */
  frame(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.age += dt;
      if (!t.dying && t.age >= t.life) {
        t.dying = true;
        t.root.classList.add('is-exit');
      }
      if (t.dying && t.age >= t.life + TOAST_FADE) this.retire(i);
    }
  }

  private retire(i: number): void {
    const t = this.live[i];
    if (t === undefined) return;
    this.live.splice(i, 1);
    t.root.remove();
    t.root.classList.remove('is-enter', 'is-exit');
    this.pool.push(t);
  }

  clear(): void {
    while (this.live.length > 0) this.retire(0);
  }

  dispose(): void {
    this.clear();
    this.pool.length = 0;
    this.root.remove();
  }
}

/* ==========================================================================
 * SECTION 8 — SEMANTIC COLOURS
 *
 * The ONLY saturated colours in the HUD besides the accent, and each one owns
 * exactly one meaning. They live here rather than in hud.css because the canvas
 * layers (minimap, world overlay) need the same values and a duplicated hex is
 * how two halves of one interface end up disagreeing about what "damaged"
 * looks like.
 * ========================================================================== */

export const SEMANTIC = {
  /** Health, full. */
  ok: '#4FD97F',
  /** Health, hurt. Also the low-power / insufficient-funds warning. */
  warn: '#F0B429',
  /** Health, critical. Also base-under-attack. */
  danger: '#FF4D3D',
  /** Veterancy. */
  gold: '#F6C445',
  /** Ore on the minimap, and the credit floaters. */
  ore: '#C8A83C',
  /** Neutral / Gaia blips. */
  neutral: '#B9C2CC',
  /**
   * An ALLIED army's blips. Semantic, never faction-swapped.
   *
   * Same argument as `HOSTILE_COLORS` below and the same teeth: your own units
   * keep your accent, so a duel and every `?shot=` fixture are untouched — only
   * a team game makes this appear at all. Before it existed, `Minimap.restyle`
   * gave every allied seat `this.accent`, so in a 2v2 YOUR TANKS AND YOUR
   * ALLY'S WERE ONE COLOUR and the tactical map could not answer "is that mine".
   *
   * THE HUE IS DERIVED, NOT PICKED. Sweeping 0..359 against every saturated
   * colour that can share the map — the four faction accents (3 / 166 / 213 /
   * 285), the four `HOSTILE_COLORS` (5 / 27 / 173 / 274), and `ore` (46) — the
   * freest hue is **93 at 47 degrees of separation**, and its one near
   * neighbour is ore. This sits at 96 and holds ore apart on LIGHTNESS as well:
   * relative luminance 0.60 against ore's 0.41. A green nearer the conventional
   * 141 was rejected because it lands 25 degrees off the Pact accent, which is
   * exactly the seat most likely to have an ally on this map.
   */
  ally: '#7BE137',
  /** Text at full strength. */
  text: '#E6EEF6',
  /** Secondary text and inactive labels. */
  textDim: '#8A97A6',
  /** The panel body, matching `--vm-glass` in hud.css. */
  glass: 'rgba(9,13,20,0.86)',
  /** The single hairline. */
  hairline: 'rgba(255,255,255,0.16)',
  /** Backing plate behind anything drawn over the battlefield. */
  worldBacking: 'rgba(4,7,11,0.86)',
} as const;

/** Health-bar colour for a 0..1 fraction. One ramp, used by HUD and overlay. */
export function healthColor(frac: number): string {
  return frac > 0.6 ? SEMANTIC.ok : frac > 0.3 ? SEMANTIC.warn : SEMANTIC.danger;
}

/* --------------------------------------------------------------------------
 * HOSTILE ARMIES
 *
 * Every hostile was ONE red, and the comment on it said so on purpose:
 * "Semantic, never faction-swapped — the red ones are shooting at me has to be
 * true whichever army you picked." That is right, and in a four-way free-for-all
 * it is also not enough: three opponents in one shade is a tactical map that
 * cannot answer "whose tanks are those".
 *
 * SO RED KEEPS INDEX 0 AND THE RULE KEEPS ITS TEETH. In a duel there is exactly
 * one hostile, it is index 0, and it is the same `SEMANTIC.danger` it has always
 * been — the minimap of every 1v1 and every `?shot=` fixture is untouched. Only
 * a third army makes the palette do anything.
 *
 * THE COLOURS ARE NOT THE FACTION ACCENTS, deliberately. Two armies may pick the
 * same side (mirror matches are legal), so an accent is not a unique key for an
 * army; a SEAT is. These four are picked to hold apart from each other, from the
 * four faction accents, from `SEMANTIC.ore` and from `SEMANTIC.neutral` at blip
 * size over both dark grass and pale concrete.
 * -------------------------------------------------------------------------- */

export const HOSTILE_COLORS: readonly string[] = [
  SEMANTIC.danger, // red — the only one a duel ever uses
  '#FF8A2B', // orange
  '#C77DFF', // violet
  '#2BD9C4', // teal
];

/**
 * The blip colour for the n-th hostile army, counted in seat order.
 *
 * Wraps rather than clamping: `MAX_PLAYERS` is 8 and this table has four, so an
 * eight-way would repeat a colour instead of returning `undefined` — which in a
 * canvas `fillStyle` is a silently ignored assignment that paints the blip in
 * whatever the previous one was.
 */
export function hostileColor(index: number): string {
  const n = HOSTILE_COLORS.length;
  return HOSTILE_COLORS[((index % n) + n) % n];
}

/* ==========================================================================
 * SECTION 9 — LEGACY (retired chrome language)
 *
 * DO NOT FOLLOW THE OLD INSTRUCTION THAT USED TO BE HERE. It read, verbatim:
 * "TO REMOVE: delete this section, `src/ui/Cameos.ts`, `tests/hud.spec.ts` and
 * `tests/cameos.spec.ts` in one commit. Nothing in `src/**` will break." That
 * was true when it was written and became FALSE in v1.18.0, when the selection
 * dock started drawing real model cameos: `src/ui/Sidebar.ts:80` imports
 * `CameoRenderer` and `createCameoModelProvider` from `src/ui/Cameos.ts` and
 * `src/ui/Hud.ts` drives it every frame. Carrying out that instruction now
 * deletes a shipped feature.
 *
 * What IS still dead here is narrower: `factionKey` and `skinFor` below have no
 * `src/**` caller — only the two specs. They can go whenever those specs are
 * rewritten; nothing else in this section can.
 * ========================================================================== */

export type HudFactionKey = 'allies' | 'soviets';

/** Legacy two-way faction key. Prefer `paletteKeyFor`, which keeps Neutral. */
export function factionKey(faction: Faction): HudFactionKey {
  return faction === Faction.Soviets ? 'soviets' : 'allies';
}

export function skinFor(faction: Faction): HudFactionSkin {
  return faction === Faction.Soviets ? HUD_SKIN_SOVIETS : HUD_SKIN_ALLIES;
}

/** Legacy sidebar width in CSS px. The modern HUD is bottom-anchored. */
export function sidebarWidthPx(uiScale: number): number {
  return Math.round(HUD_DESIGN_WIDTH * uiScale);
}

/** Legacy cameo row count for the retired 2-column vertical grid. */
export function cameoRowsFor(screenH: number, uiScale: number): number {
  const designH = screenH / Math.max(0.01, uiScale);
  const usable = designH - HUD_STACK.header - HUD_STACK.footer;
  return Math.max(
    HUD_GRID.minRows,
    Math.min(HUD_GRID.maxRows, Math.floor(usable / HUD_GRID.pitchY)),
  );
}

export function arcPath(w: number, h: number, bow: number): string {
  return (
    `M0 ${bow} Q ${w / 2} ${-bow} ${w} ${bow}` +
    ` L${w} ${h - bow} Q ${w / 2} ${h + bow} 0 ${h - bow} Z`
  );
}

export function lensStripPath(w: number, h: number, taper: number, bow: number): string {
  return (
    `M0 0 L${w} 0 L${w - taper} ${h - bow}` +
    ` Q ${w / 2} ${h + bow} ${taper} ${h - bow} Z`
  );
}

export function tabPlatePath(w: number, h: number, lean: number, drop: number): string {
  const r = 2;
  return (
    `M${r + lean} ${drop} L${w - r + lean} ${drop}` +
    ` Q${w + lean} ${drop} ${w} ${drop + r}` +
    ` L${w} ${h} L0 ${h} L0 ${drop + r}` +
    ` Q0 ${drop} ${r + lean} ${drop} Z`
  );
}

/** Rounded-rect path. Still used by `src/ui/Cameos.ts`. */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  return (
    `M${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr}` +
    ` L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h}` +
    ` L${x + rr} ${y + h} Q${x} ${y + h} ${x} ${y + h - rr}` +
    ` L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} Z`
  );
}

export function sovietBrush(): string {
  return (
    'repeating-linear-gradient(90deg,' +
    ' rgba(255,255,255,0.045) 0,' +
    ' rgba(255,255,255,0.010) calc(2.25 * var(--ra-d)),' +
    ' rgba(0,0,0,0.045) calc(4.5 * var(--ra-d)),' +
    ' rgba(0,0,0,0.010) calc(6.75 * var(--ra-d)),' +
    ' rgba(255,255,255,0.045) calc(9 * var(--ra-d)))'
  );
}

export function boltGradient(s: HudFactionSkin): string {
  return (
    'radial-gradient(circle at 38% 32%,' +
    ` ${s.bevelHi} 0%, ${s.metalHi} 20%, ${s.metalMid} 44%,` +
    ` ${s.metalLo} 66%, ${s.bevelLo} 84%, ${s.bevelLo} 92%,` +
    ' rgba(0,0,0,0) 96%)'
  );
}

export function plateSheen(): string {
  return (
    'linear-gradient(101deg,' +
    ' rgba(255,255,255,0) 0%,' +
    ' rgba(255,255,255,0.05) 26%,' +
    ' rgba(255,255,255,0.12) 44%,' +
    ' rgba(255,255,255,0.04) 58%,' +
    ' rgba(255,255,255,0) 76%)'
  );
}

/* -- the retired glyph set ------------------------------------------------
 * Superseded by `src/ui/icons.ts`. Pinned by tests/hud.spec.ts.
 * ------------------------------------------------------------------------ */

export interface GlyphShape {
  readonly d: string;
  /** Stroke width in 32-box units. Omitted = filled. */
  readonly stroke?: number;
  readonly round?: boolean;
}

export interface GlyphDef {
  readonly shapes: readonly GlyphShape[];
  /** Degrees, about the box centre. */
  readonly rotate?: number;
}

export type GlyphName =
  | 'diplomacy' | 'options'
  | 'repair' | 'sell'
  | 'tabStructures' | 'tabDefence' | 'tabInfantry' | 'tabVehicles'
  | 'cmdStop' | 'cmdGuardHold' | 'cmdFormation' | 'cmdScatter' | 'cmdGuard' | 'cmdWaypoint'
  | 'eagle' | 'star';

export const GLYPHS: Readonly<Record<GlyphName, GlyphDef>> = {
  diplomacy: {
    shapes: [
      { d: 'M6 20 a7 7 0 0 1 10-9 a7 7 0 0 1 10 9', stroke: 3.2, round: true },
      { d: 'M4 15 L6.5 21 L11.5 18 Z' },
      { d: 'M28 15 L25.5 21 L20.5 18 Z' },
      { d: 'M12 24 h8 v3 h-8 z' },
    ],
  },

  options: {
    shapes: [
      { d: 'M3 14.5 h8 v3 h-8 z' },
      { d: 'M21 14.5 h8 v3 h-8 z' },
      { d: 'M16 11.5 a4.5 4.5 0 1 1 0 9 a4.5 4.5 0 1 1 0-9' },
    ],
  },

  repair: {
    rotate: -20,
    shapes: [
      { d: 'M11 3 h3.2 v4.4 h3.6 V3 h3.2 v7.2 a4.4 4.4 0 0 1 -4.4 4.4 h-1.2 a4.4 4.4 0 0 1 -4.4 -4.4 z' },
      { d: 'M13.8 15 h4.4 l0.9 14.6 h-6.2 z' },
    ],
  },

  sell: {
    shapes: [
      { d: 'M13.6 1.5 h1.7 v29 h-1.7 z' },
      { d: 'M16.7 1.5 h1.7 v29 h-1.7 z' },
      {
        d: 'M24 9.5 C24 5.4 20.2 4 16 4 C11.8 4 8 5.4 8 9.5 C8 13.6 11.8 15 16 16 ' +
           'C20.2 17 24 18.4 24 22.5 C24 26.6 20.2 28 16 28 C11.8 28 8 26.6 8 22.5',
        stroke: 3.0,
      },
    ],
  },

  tabStructures: {
    shapes: [
      { d: 'M16 4 L30 16 L26.5 16 L26.5 28 L5.5 28 L5.5 16 L2 16 Z' },
      { d: 'M13 19 h6 v9 h-6 z' },
    ],
  },

  tabDefence: {
    shapes: [
      { d: 'M16 2.5 L29 7.5 V16.5 C29 23.5 22.6 28.6 16 30.5 C9.4 28.6 3 23.5 3 16.5 V7.5 Z' },
    ],
  },

  tabInfantry: {
    shapes: [
      { d: 'M16 2.5 a3.6 3.6 0 1 1 0 7.2 a3.6 3.6 0 1 1 0-7.2' },
      {
        d: 'M12 10.6 h8 l3 9.2 -3 1 -2-5.6 v4.4 l2.4 10.2 -3.3 0.7 -2.1-9 ' +
           '-2.1 9 -3.3-0.7 2.4-10.2 v-4.4 l-2 5.6 -3-1 z',
      },
    ],
  },

  tabVehicles: {
    shapes: [
      { d: 'M1.5 12 h5 v13 h-5 z' },
      { d: 'M25.5 12 h5 v13 h-5 z' },
      { d: 'M8 14 h16 a2.5 2.5 0 0 1 2.5 2.5 v6 a2.5 2.5 0 0 1 -2.5 2.5 h-16 a2.5 2.5 0 0 1 -2.5 -2.5 v-6 a2.5 2.5 0 0 1 2.5 -2.5 z' },
      { d: 'M13 7 h6 v7 h-6 z' },
      { d: 'M19 9 h11 v2.4 h-11 z' },
    ],
  },

  cmdStop: {
    shapes: [
      { d: 'M16 6.5 a12.5 9.5 0 1 1 0 19 a12.5 9.5 0 1 1 0-19', stroke: 2.2 },
      { d: 'M14.8 11 h2.4 v10 h-2.4 z' },
    ],
  },

  cmdGuardHold: {
    shapes: [
      { d: 'M16 6.5 a12.5 9.5 0 1 1 0 19 a12.5 9.5 0 1 1 0-19', stroke: 2.2 },
      { d: 'M12.2 11 h2.4 v10 h-2.4 z' },
      { d: 'M17.4 11 h2.4 v10 h-2.4 z' },
    ],
  },

  cmdFormation: {
    shapes: [
      { d: 'M9 5 C5.5 5 7.5 14 4 16 C7.5 18 5.5 27 9 27', stroke: 2.2, round: true },
      { d: 'M13 9 h2.6 v2.6 h-2.6 z' }, { d: 'M19 9 h2.6 v2.6 h-2.6 z' }, { d: 'M25 9 h2.6 v2.6 h-2.6 z' },
      { d: 'M13 14.7 h2.6 v2.6 h-2.6 z' }, { d: 'M19 14.7 h2.6 v2.6 h-2.6 z' }, { d: 'M25 14.7 h2.6 v2.6 h-2.6 z' },
      { d: 'M13 20.4 h2.6 v2.6 h-2.6 z' }, { d: 'M19 20.4 h2.6 v2.6 h-2.6 z' }, { d: 'M25 20.4 h2.6 v2.6 h-2.6 z' },
    ],
  },

  cmdScatter: {
    shapes: [
      { d: 'M16 1.5 L21 9 L11 9 Z' },
      { d: 'M16 30.5 L11 23 L21 23 Z' },
      { d: 'M1.5 16 L9 11 L9 21 Z' },
      { d: 'M30.5 16 L23 21 L23 11 Z' },
      { d: 'M14.4 13 h3.2 v6 h-3.2 z' },
    ],
  },

  cmdGuard: {
    shapes: [
      { d: 'M16 3 L28 7.5 V16 C28 22.4 22.2 27 16 29 C9.8 27 4 22.4 4 16 V7.5 Z', stroke: 2.2 },
    ],
  },

  cmdWaypoint: {
    shapes: [
      { d: 'M4 25 L13 25 L20 13 L27 13', stroke: 2.0, round: true },
      { d: 'M2.4 23.4 h3.6 v3.6 h-3.6 z' },
      { d: 'M11.4 23.4 h3.6 v3.6 h-3.6 z' },
      { d: 'M25.4 4 h1.8 v10 h-1.8 z' },
      { d: 'M27.2 4.4 L31.5 6.6 L27.2 8.8 Z' },
    ],
  },

  eagle: {
    shapes: [
      { d: 'M16 8 L19 11 L24 9.5 L28.5 13 L22 14 L20 17 L16 18.5 L12 17 L10 14 L3.5 13 L8 9.5 L13 11 Z' },
      { d: 'M14.6 17.5 h2.8 l-1.4 7 z' },
      { d: 'M16 4.5 a2.2 2.2 0 1 1 0 4.4 a2.2 2.2 0 1 1 0-4.4' },
    ],
  },

  star: {
    shapes: [
      { d: 'M16 2.5 L19.9 13.1 L31 13.6 L22.2 20.4 L25.3 31 L16 24.8 L6.7 31 L9.8 20.4 L1 13.6 L12.1 13.1 Z' },
    ],
  },
};
