/**
 * ============================================================================
 * RED ALERT — src/ui/Chrome.ts
 * ============================================================================
 * THE CHROME LANGUAGE. Everything in the HUD is built out of this file so the
 * sidebar, the command bar and the world overlay cannot drift apart.
 *
 * The five laws (VISUAL_DNA §2.14), enforced here rather than remembered:
 *
 *  1. ARC, ARC, ARC. Four horizontal arcs stack down the sidebar and every one
 *     bows toward the sidebar's centre. `arcPath`/`lensStripPath` are the only
 *     two shapes allowed to be an interactive surface; a plain rectangle is
 *     reserved for the credits well and the cameo keys.
 *  2. EVERY EDGE IS A 3-ZONE BEVEL: 1 px specular highlight -> 5-9 px body ramp
 *     -> 1 px black terminator. `bevelGradient()` emits exactly that ramp and
 *     `--ra-bevel-*` carries it into CSS.
 *  3. THE HIGHLIGHT IS COOL VIOLET-GREY `#BBBCD0`. Never neutral white, never
 *     warm. That violet cast is the difference between gunmetal and plastic.
 *  4. WELLS ARE BLACK AND FLAT; PLATES ARE GRADIENT AND LIT. Nothing is
 *     mid-grey flat. Credits `#10111A`, cameo keys `#080808`, radar `#000000`.
 *  5. RIVETS, SEAMS, PISTONS. The ten piston domes on the right rail, the
 *     hydraulic end cap, the Soviet radiator grille. Machinery, not UI panels.
 *
 * Faction recolour is a FULL MATERIAL SWAP (non-negotiable #5): `applySkin`
 * swaps ~30 custom properties, and the two skins share no colour at all. There
 * is no hue-rotate anywhere in src/ui/**.
 *
 * RESOLUTION INDEPENDENCE. `--ra-d` is one DESIGN pixel at the current uiScale.
 * Every dimension in hud.css is `calc(N * var(--ra-d))`; hairlines stay literal
 * `1px` so a bevel edge always lands on exactly one device pixel. Nothing here
 * ever scales a bitmap.
 * ============================================================================
 */

import {
  HUD_DESIGN_WIDTH,
  HUD_GRID,
  HUD_STACK,
  HUD_SKIN_ALLIES,
  HUD_SKIN_SOVIETS,
  HUD_UI_SCALE_BASE_HEIGHT,
  HUD_UI_SCALE_MAX,
  HUD_UI_SCALE_MIN,
  HUD_UI_SCALE_STEPS,
  type HudFactionSkin,
} from '../core/config';
import { Faction } from '../core/types';

/* ==========================================================================
 * SECTION 1 — SKINS
 * ========================================================================== */

export type HudFactionKey = 'allies' | 'soviets';

/** Neutral/Gaia has no HUD of its own; it borrows the Allied chrome. */
export function factionKey(faction: Faction): HudFactionKey {
  return faction === Faction.Soviets ? 'soviets' : 'allies';
}

export function skinFor(faction: Faction): HudFactionSkin {
  return faction === Faction.Soviets ? HUD_SKIN_SOVIETS : HUD_SKIN_ALLIES;
}

/**
 * `uiScale = clamp(floor(screenH / 720 * 4) / 4, 1, 4)`.
 *
 * Quantized to quarter steps on purpose: a continuously-scaled sidebar puts
 * bevel hairlines on fractional device pixels, and a blurred 1 px bevel is the
 * single most obvious "this is a web page" tell in the whole interface.
 */
export function computeUiScale(screenH: number): number {
  const raw = (screenH / HUD_UI_SCALE_BASE_HEIGHT) * HUD_UI_SCALE_STEPS;
  const stepped = Math.floor(raw) / HUD_UI_SCALE_STEPS;
  return Math.min(HUD_UI_SCALE_MAX, Math.max(HUD_UI_SCALE_MIN, stepped));
}

/** Sidebar width in CSS px for a given scale. Always an integer. */
export function sidebarWidthPx(uiScale: number): number {
  return Math.round(HUD_DESIGN_WIDTH * uiScale);
}

/**
 * Cameo rows that fit: `floor((designH - header - footer) / 50)`, clamped.
 *
 * Capped at 12 so the grid never dominates a 4K screen (§2.2), floored at 4 so
 * a short window still has a sidebar worth the name. Pure, so the row-count
 * arithmetic is testable without a DOM.
 */
export function cameoRowsFor(screenH: number, uiScale: number): number {
  const designH = screenH / Math.max(0.01, uiScale);
  const usable = designH - HUD_STACK.header - HUD_STACK.footer;
  return Math.max(HUD_GRID.minRows, Math.min(HUD_GRID.maxRows, Math.floor(usable / HUD_GRID.pitchY)));
}

/**
 * Push a skin into CSS custom properties on `root`. This is the entire faction
 * recolour: swap these and every panel, lens, glyph, blip and numeral follows.
 */
export function applySkin(root: HTMLElement, faction: Faction): void {
  const s = skinFor(faction);
  const k = factionKey(faction);
  const v = root.style;

  root.dataset.faction = k;

  v.setProperty('--ra-bevel-hi', s.bevelHi);
  v.setProperty('--ra-metal-hi', s.metalHi);
  v.setProperty('--ra-metal-mid', s.metalMid);
  v.setProperty('--ra-metal-lo', s.metalLo);
  v.setProperty('--ra-bevel-lo', s.bevelLo);

  v.setProperty('--ra-lens-0', s.lens[0]);
  v.setProperty('--ra-lens-1', s.lens[1]);
  v.setProperty('--ra-lens-2', s.lens[2]);
  v.setProperty('--ra-lens-3', s.lens[3]);
  v.setProperty('--ra-lens-rim-hi', s.lensRimHi);
  v.setProperty('--ra-lens-rim-lo', s.lensRimLo);

  v.setProperty('--ra-glyph', s.glyph);
  v.setProperty('--ra-glyph-hi', s.glyphHi);
  v.setProperty('--ra-accent', s.accent);
  v.setProperty('--ra-accent-hi', s.accentHi);
  v.setProperty('--ra-numerals', s.numerals);
  v.setProperty('--ra-radar-frame', s.radarFrame);

  v.setProperty('--ra-well-credits', s.wellCredits);
  v.setProperty('--ra-well-cameo', s.wellCameo);

  v.setProperty('--ra-power-hi', s.powerHi);
  v.setProperty('--ra-power-mid', s.powerMid);
  v.setProperty('--ra-power-lo', s.powerLo);

  v.setProperty('--ra-ready-fill', s.readyFill);
  v.setProperty('--ra-ready-text', s.readyText);

  v.setProperty('--ra-cmd-icon', s.commandIcon);
  v.setProperty('--ra-cmd-icon-hi', s.commandIconHi);
  v.setProperty('--ra-emblem', s.emblem);

  // Law 2, expressed once: the canonical 3-zone body ramp every plate uses.
  v.setProperty('--ra-bevel-ramp', bevelGradient(s, 180));
  // Soviet chrome is brushed, not polished: a horizontal micro-stripe on top of
  // the ramp. Allied stays a clean lacquered ramp.
  v.setProperty('--ra-brush', k === 'soviets' ? sovietBrush() : 'none');
}

/**
 * Law 2 as a CSS gradient string: specular hairline, 5-9 px body ramp, black
 * terminator. `angleDeg` 180 = lit from above (the only value the sidebar uses;
 * a plate lit from below reads as a hole).
 */
export function bevelGradient(s: HudFactionSkin, angleDeg: number): string {
  return (
    `linear-gradient(${angleDeg}deg,` +
    ` ${s.bevelHi} 0%, ${s.metalHi} 6%, ${s.metalMid} 34%,` +
    ` ${s.metalLo} 78%, ${s.bevelLo} 100%)`
  );
}

/** Horizontal brush noise for the Soviet brushed-silver plates. */
function sovietBrush(): string {
  return (
    'repeating-linear-gradient(90deg,' +
    ' rgba(255,255,255,0.055) 0 1px,' +
    ' rgba(0,0,0,0.055) 1px 2px,' +
    ' rgba(255,255,255,0.02) 2px 4px)'
  );
}

/* ==========================================================================
 * SECTION 2 — DOM HELPERS
 *
 * No framework, no virtual DOM, no innerHTML with interpolated content. The
 * HUD is ~180 nodes built once and mutated in place; the frame loop touches
 * `style.setProperty`, `nodeValue` and `classList` only, never `createElement`.
 * ========================================================================== */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: Node,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  parent?: Node,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (parent) parent.appendChild(node);
  return node;
}

/** A text node parked inside `parent`, returned so callers can poke nodeValue. */
export function textNode(parent: Node, initial = ''): Text {
  const t = document.createTextNode(initial);
  parent.appendChild(t);
  return t;
}

/* ==========================================================================
 * SECTION 3 — SHAPES (law 1: arc, arc, arc)
 * ========================================================================== */

/**
 * The repair/sell arc: convex top edge, matching concave bottom, so the plate
 * bows UP toward the sidebar's centre. `bow` is the sagitta in the same units
 * as `w`/`h`.
 */
export function arcPath(w: number, h: number, bow: number): string {
  return (
    `M0 ${bow} Q ${w / 2} ${-bow} ${w} ${bow}` +
    ` L${w} ${h - bow} Q ${w / 2} ${h + bow} 0 ${h - bow} Z`
  );
}

/**
 * The top button pair: wide at the top edge, tapering to a shallow arc at the
 * bottom. Deliberately NOT a rectangle — see §2.4.
 */
export function lensStripPath(w: number, h: number, taper: number, bow: number): string {
  return (
    `M0 0 L${w} 0 L${w - taper} ${h - bow}` +
    ` Q ${w / 2} ${h + bow} ${taper} ${h - bow} Z`
  );
}

/**
 * A tab plate, keystoned toward the sidebar centre. `lean` is positive for
 * plates left of centre and negative for plates right of it, which is what
 * makes the four-tab strip read as a shallow arc rather than four buttons.
 */
export function tabPlatePath(w: number, h: number, lean: number, drop: number): string {
  const r = 2;
  return (
    `M${r + lean} ${drop} L${w - r + lean} ${drop}` +
    ` Q${w + lean} ${drop} ${w} ${drop + r}` +
    ` L${w} ${h} L0 ${h} L0 ${drop + r}` +
    ` Q0 ${drop} ${r + lean} ${drop} Z`
  );
}

/** Rounded-rect path for the cameo key and the tooltip well. */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  return (
    `M${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr}` +
    ` L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h}` +
    ` L${x + rr} ${y + h} Q${x} ${y + h} ${x} ${y + h - rr}` +
    ` L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} Z`
  );
}

/* ==========================================================================
 * SECTION 4 — GLYPHS
 *
 * Vector, authored in a 32x32 box, so they stay crisp at uiScale 4. Filled
 * shapes use currentColor; stroked shapes carry their own width in design px
 * of the 32-box, which the CSS scales uniformly.
 *
 * These are the exact glyphs VISUAL_DNA names, in the order it names them.
 * Substituting a generic icon set here is a fail — the wrench, the double-
 * stroke `$` and the four tab pictograms are franchise recognition points.
 * ========================================================================== */

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
  /* --- top button pair (§2.4) ------------------------------------------ */

  /** Two arrows curling into each other — diplomacy. */
  diplomacy: {
    shapes: [
      { d: 'M6 20 a7 7 0 0 1 10-9 a7 7 0 0 1 10 9', stroke: 3.2, round: true },
      { d: 'M4 15 L6.5 21 L11.5 18 Z' },
      { d: 'M28 15 L25.5 21 L20.5 18 Z' },
      { d: 'M12 24 h8 v3 h-8 z' },
    ],
  },

  /** A slider knob between two track segments. */
  options: {
    shapes: [
      { d: 'M3 14.5 h8 v3 h-8 z' },
      { d: 'M21 14.5 h8 v3 h-8 z' },
      { d: 'M16 11.5 a4.5 4.5 0 1 1 0 9 a4.5 4.5 0 1 1 0-9' },
    ],
  },

  /* --- repair / sell arc (§2.6) ----------------------------------------- */

  /** Open-end wrench, head up, canted ~20 degrees from vertical. */
  repair: {
    rotate: -20,
    shapes: [
      { d: 'M11 3 h3.2 v4.4 h3.6 V3 h3.2 v7.2 a4.4 4.4 0 0 1 -4.4 4.4 h-1.2 a4.4 4.4 0 0 1 -4.4 -4.4 z' },
      { d: 'M13.8 15 h4.4 l0.9 14.6 h-6.2 z' },
    ],
  },

  /** `$` with a DOUBLE vertical stroke — the classic sell glyph. */
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

  /* --- tab strip (§2.7), in the mandated order -------------------------- */

  /** (1) House with a pitched roof = Structures. */
  tabStructures: {
    shapes: [
      { d: 'M16 4 L30 16 L26.5 16 L26.5 28 L5.5 28 L5.5 16 L2 16 Z' },
      { d: 'M13 19 h6 v9 h-6 z' },
    ],
  },

  /** (2) Shield = Defence. */
  tabDefence: {
    shapes: [
      { d: 'M16 2.5 L29 7.5 V16.5 C29 23.5 22.6 28.6 16 30.5 C9.4 28.6 3 23.5 3 16.5 V7.5 Z' },
    ],
  },

  /** (3) Standing figure = Infantry. */
  tabInfantry: {
    shapes: [
      { d: 'M16 2.5 a3.6 3.6 0 1 1 0 7.2 a3.6 3.6 0 1 1 0-7.2' },
      {
        d: 'M12 10.6 h8 l3 9.2 -3 1 -2-5.6 v4.4 l2.4 10.2 -3.3 0.7 -2.1-9 ' +
           '-2.1 9 -3.3-0.7 2.4-10.2 v-4.4 l-2 5.6 -3-1 z',
      },
    ],
  },

  /** (4) Rounded chassis with two flanking treads = Vehicles. */
  tabVehicles: {
    shapes: [
      { d: 'M1.5 12 h5 v13 h-5 z' },
      { d: 'M25.5 12 h5 v13 h-5 z' },
      { d: 'M8 14 h16 a2.5 2.5 0 0 1 2.5 2.5 v6 a2.5 2.5 0 0 1 -2.5 2.5 h-16 a2.5 2.5 0 0 1 -2.5 -2.5 v-6 a2.5 2.5 0 0 1 2.5 -2.5 z' },
      { d: 'M13 7 h6 v7 h-6 z' },
      { d: 'M19 9 h11 v2.4 h-11 z' },
    ],
  },

  /* --- command bar (§2.12), soft-glow line art on black ----------------- */

  /** (1) Ellipse containing one vertical bar. */
  cmdStop: {
    shapes: [
      { d: 'M16 6.5 a12.5 9.5 0 1 1 0 19 a12.5 9.5 0 1 1 0-19', stroke: 2.2 },
      { d: 'M14.8 11 h2.4 v10 h-2.4 z' },
    ],
  },

  /** (2) Ellipse containing two vertical bars. */
  cmdGuardHold: {
    shapes: [
      { d: 'M16 6.5 a12.5 9.5 0 1 1 0 19 a12.5 9.5 0 1 1 0-19', stroke: 2.2 },
      { d: 'M12.2 11 h2.4 v10 h-2.4 z' },
      { d: 'M17.4 11 h2.4 v10 h-2.4 z' },
    ],
  },

  /** (3) A brace followed by a 3x3 grid of dots = formation move. */
  cmdFormation: {
    shapes: [
      { d: 'M9 5 C5.5 5 7.5 14 4 16 C7.5 18 5.5 27 9 27', stroke: 2.2, round: true },
      { d: 'M13 9 h2.6 v2.6 h-2.6 z' }, { d: 'M19 9 h2.6 v2.6 h-2.6 z' }, { d: 'M25 9 h2.6 v2.6 h-2.6 z' },
      { d: 'M13 14.7 h2.6 v2.6 h-2.6 z' }, { d: 'M19 14.7 h2.6 v2.6 h-2.6 z' }, { d: 'M25 14.7 h2.6 v2.6 h-2.6 z' },
      { d: 'M13 20.4 h2.6 v2.6 h-2.6 z' }, { d: 'M19 20.4 h2.6 v2.6 h-2.6 z' }, { d: 'M25 20.4 h2.6 v2.6 h-2.6 z' },
    ],
  },

  /** (4) Four triangular arrows radiating outward = scatter. */
  cmdScatter: {
    shapes: [
      { d: 'M16 1.5 L21 9 L11 9 Z' },
      { d: 'M16 30.5 L11 23 L21 23 Z' },
      { d: 'M1.5 16 L9 11 L9 21 Z' },
      { d: 'M30.5 16 L23 21 L23 11 Z' },
      { d: 'M14.4 13 h3.2 v6 h-3.2 z' },
    ],
  },

  /** (5) Shield = guard. */
  cmdGuard: {
    shapes: [
      { d: 'M16 3 L28 7.5 V16 C28 22.4 22.2 27 16 29 C9.8 27 4 22.4 4 16 V7.5 Z', stroke: 2.2 },
    ],
  },

  /** (6) A dotted Z-path with a flag at the end node = waypoint. */
  cmdWaypoint: {
    shapes: [
      { d: 'M4 25 L13 25 L20 13 L27 13', stroke: 2.0, round: true },
      { d: 'M2.4 23.4 h3.6 v3.6 h-3.6 z' },
      { d: 'M11.4 23.4 h3.6 v3.6 h-3.6 z' },
      { d: 'M25.4 4 h1.8 v10 h-1.8 z' },
      { d: 'M27.2 4.4 L31.5 6.6 L27.2 8.8 Z' },
    ],
  },

  /* --- bottom-cap emblems (§2.10) --------------------------------------- */

  /** Allied silver eagle, ~28x18 design px on the chrome shelf. */
  eagle: {
    shapes: [
      { d: 'M16 8 L19 11 L24 9.5 L28.5 13 L22 14 L20 17 L16 18.5 L12 17 L10 14 L3.5 13 L8 9.5 L13 11 Z' },
      { d: 'M14.6 17.5 h2.8 l-1.4 7 z' },
      { d: 'M16 4.5 a2.2 2.2 0 1 1 0 4.4 a2.2 2.2 0 1 1 0-4.4' },
    ],
  },

  /** Soviet star, used on the radiator grille and the Soviet bottom cap. */
  star: {
    shapes: [
      { d: 'M16 2.5 L19.9 13.1 L31 13.6 L22.2 20.4 L25.3 31 L16 24.8 L6.7 31 L9.8 20.4 L1 13.6 L12.1 13.1 Z' },
    ],
  },
};

/**
 * Build an `<svg>` for a glyph. `size` is in CSS px; the glyph is authored in a
 * 32-box so it scales exactly. Filled shapes take `currentColor`, which is how
 * the tab strip flips its glyph from light-on-plate to dark-on-plate with one
 * class change instead of two icon sets.
 */
export function makeGlyph(name: GlyphName, className = 'ra-glyph'): SVGSVGElement {
  const def = GLYPHS[name];
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const g = svgEl('g', svg);
  if (def.rotate) g.setAttribute('transform', `rotate(${def.rotate} 16 16)`);

  for (const shape of def.shapes) {
    const p = svgEl('path', g);
    p.setAttribute('d', shape.d);
    if (shape.stroke !== undefined) {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', String(shape.stroke));
      if (shape.round) {
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
      }
    } else {
      p.setAttribute('fill', 'currentColor');
    }
  }
  return svg;
}

/* ==========================================================================
 * SECTION 5 — COLOUR MATH
 * ========================================================================== */

/** `#rrggbb` -> packed 0xRRGGBB. Accepts `#rgb`. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend in sRGB. Good enough for chrome ramps; never used on albedo. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ==========================================================================
 * SECTION 6 — FORMATTING
 *
 * Credits are tabular, 8 digits wide, no `$` and no thousands separator (§2.3).
 * Anything else and the readout stops reading as an unlit LCD.
 * ========================================================================== */

export function formatCredits(value: number): string {
  const v = value < 0 ? 0 : value > 99999999 ? 99999999 : Math.floor(value);
  return String(v);
}

/** `MM:SS`, clamped, for the superweapon rows. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

/* ==========================================================================
 * SECTION 7 — TOOLTIP
 *
 * 220 ms delay, appears LEFT of the sidebar and never overlaps it, max 280
 * logical px. Panel is a black well with a 1 px chrome bevel — the same
 * material as the credits readout, because a tooltip in a different material
 * reads as a browser artefact (§2.13).
 * ========================================================================== */

export interface TooltipContent {
  title: string;
  cost: number;
  buildTimeSec: number;
  powerDelta: number;
  blurb: string;
  /** Shown in red. Empty when the item is available. */
  requirement: string;
}

export class Tooltip {
  readonly root: HTMLElement;
  private readonly titleNode: Text;
  private readonly statsRow: HTMLElement;
  private readonly costNode: Text;
  private readonly timeNode: Text;
  private readonly powerNode: Text;
  private readonly blurbNode: Text;
  private readonly reqEl: HTMLElement;
  private readonly reqNode: Text;
  private timer = 0;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ra-tooltip', parent);
    this.root.setAttribute('role', 'tooltip');
    this.root.hidden = true;

    const title = el('div', 'ra-tt-title', this.root);
    this.titleNode = textNode(title);

    this.statsRow = el('div', 'ra-tt-stats', this.root);
    const cost = el('span', 'ra-tt-cost', this.statsRow);
    this.costNode = textNode(cost);
    const time = el('span', 'ra-tt-time', this.statsRow);
    this.timeNode = textNode(time);
    const power = el('span', 'ra-tt-power', this.statsRow);
    this.powerNode = textNode(power);

    const blurb = el('div', 'ra-tt-blurb', this.root);
    this.blurbNode = textNode(blurb);

    this.reqEl = el('div', 'ra-tt-req', this.root);
    this.reqNode = textNode(this.reqEl);
  }

  /** Arm the 220 ms delay. Calling it again with a new anchor restarts it. */
  schedule(anchor: HTMLElement, content: TooltipContent, delayMs: number): void {
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.show(anchor, content);
    }, delayMs);
  }

  show(anchor: HTMLElement, c: TooltipContent): void {
    this.titleNode.nodeValue = c.title;
    this.costNode.nodeValue = c.cost > 0 ? `${c.cost}` : '';
    this.timeNode.nodeValue = c.buildTimeSec > 0 ? `${c.buildTimeSec.toFixed(0)}s` : '';
    this.powerNode.nodeValue = c.powerDelta !== 0 ? `${c.powerDelta > 0 ? '+' : ''}${c.powerDelta}` : '';
    this.blurbNode.nodeValue = c.blurb;
    this.reqNode.nodeValue = c.requirement;
    this.reqEl.hidden = c.requirement === '';

    this.root.hidden = false;
    this.visible = true;

    // Position AFTER unhiding so offsetHeight is real. Right-anchored to the
    // sidebar's left edge, vertically clamped into the viewport.
    const a = anchor.getBoundingClientRect();
    const h = this.root.offsetHeight;
    const top = Math.max(4, Math.min(window.innerHeight - h - 4, a.top + a.height * 0.5 - h * 0.5));
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.right = `${Math.round(window.innerWidth - a.left + 6)}px`;
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
