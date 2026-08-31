/**
 * Domain-owned config slice: HUD layout and visual contracts.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 21. HUD — the Red Alert sidebar
 *
 * Every number here is a DESIGN pixel measured against a 168 x 768 sidebar
 * (VISUAL_DNA §2.2). Nothing in src/ui/** may hardcode a pixel; the CSS is
 * written as `calc(N * var(--ra-d))` where `--ra-d` is one design pixel at the
 * current uiScale, so the whole HUD is resolution-independent by construction.
 *
 * The vertical stack is a budget, not a suggestion: the header (cap + credits +
 * top pair + radar + arc + tabs) is 229 design px and the bottom cap is 41, so
 * the cameo grid gets whatever is left, floored to a whole 50 px row.
 * ========================================================================== */

/** Sidebar width in design px. RA2 shipped 168 and it divides cleanly by 4/8/12. */
export const HUD_DESIGN_WIDTH = 168;

/**
 * uiScale = clamp(floor(screenH / 840 * 4) / 4, 1, 4).
 * Quarter steps, integer-snapped, so a 1 design px bevel hairline never lands
 * on a fractional device pixel — a bilinear-smeared bevel is an instant fail.
 */
export const HUD_UI_SCALE_MIN = 1.0;
export const HUD_UI_SCALE_MAX = 4.0;
/**
 * Screen height that maps to uiScale 1.0.
 *
 * 840 rather than 720 is the high-resolution density correction. Scaling the
 * HUD linearly from 720 made a 1440p panel twice as wide and twice as tall —
 * four times its area — even though the extra pixels should buy more view of
 * the battlefield. The quarter-step curve now gives 1080p 1.25, 1440p 1.5 and
 * 2160p 2.5 while retaining the 1px floor for smaller windows.
 */
export const HUD_UI_SCALE_BASE_HEIGHT = 840;
/** Scale quantum. 4 = quarter steps. */
export const HUD_UI_SCALE_STEPS = 4;

/** Vertical stack, design px. Keys match the VISUAL_DNA §2.2 rows. */
export const HUD_STACK = {
  topCap: 4,
  credits: 12,
  creditsGap: 3,
  topPair: 20,
  radarBezelTop: 9,
  radar: 110,
  radarBezelBottom: 13,
  actionArc: 26,
  tabStrip: 31,
  /** Everything above the cameo grid. */
  header: 229,
  bottomBand: 7,
  bottomCap: 24,
  bottomPlinth: 10,
  /** bottomBand + bottomCap + bottomPlinth. */
  footer: 41,
} as const;

/** Cameo grid geometry, design px (VISUAL_DNA §2.8). */
export const HUD_GRID = {
  columns: 2,
  /** 5:4 art. Not square — a square cameo grid is the #2 HUD fail. */
  artW: 60,
  artH: 48,
  /** Column pitch (art 60 + 4 gap). */
  pitchX: 64,
  /** Row pitch (art 48 + 2 gap). */
  pitchY: 50,
  /** Left gutter holding the power bar. */
  gutterLeft: 21,
  /** Right gutter holding the piston-dome rail. */
  gutterRight: 23,
  /** Never let the grid dominate at 4K. */
  maxRows: 12,
  minRows: 4,
} as const;

/** Radar panel, design px (VISUAL_DNA §2.5). */
export const HUD_RADAR = {
  fieldW: 142,
  fieldH: 110,
  /** The map bitmap is fitted to HEIGHT and letterboxed — keep the letterbox. */
  ledCount: 3,
  ledSize: 5,
  /** Seconds a minimap attack ping ring lives. */
  pingSeconds: 0.4,
  /** Rings alive at once before the oldest is recycled. */
  pingPool: 8,
} as const;

/**
 * Command bar, design px (VISUAL_DNA §2.12).
 *
 * HEIGHT IS 23, NOT THE 28 OF DECISION D13. The two specs collide here and the
 * look bible wins (CLAUDE.md): §9 caps the whole HUD at 12-16% of the frame,
 * and the sidebar alone is 13.125% at every resolution from 1080 up (168
 * design px x uiScale, by §2.1's own table). That leaves 2.875% of the frame
 * for a bar spanning 86.9% of the width, i.e. at most 3.31% of screen height —
 * 23 design px, not 28. At 28 the HUD measures 16.50% and busts the ceiling at
 * every resolution; at 23 it measures 15.90%. The 20 x 16 icons still fit in
 * the 19 px field between the white and dark-red rules.
 * `tests/hud.spec.ts` asserts the resulting share at four resolutions.
 */
export const HUD_COMMAND_BAR = {
  height: 23,
  iconW: 20,
  iconH: 16,
  /** Left-aligned; the right two thirds stay empty black. */
  firstIconCx: 104,
  iconPitch: 52,
  iconCount: 6,
  endCapW: 48,
} as const;

/** In-world overlay, design px unless noted (VISUAL_DNA §2.11). */
export const HUD_OVERLAY = {
  /** Health bar for a vehicle. Buildings scale with footprint. */
  barW: 34,
  barH: 4,
  /** Design px above the entity's projected top edge. */
  barLift: 10,
  /** 1-on/1-off vertical hatch period. */
  hatchPeriod: 2,
  /** Control-group badge plate. */
  badgeW: 12,
  badgeH: 14,
  /** Veterancy chevron (NEW — flagged as our addition, VISUAL_DNA D10). */
  chevronW: 8,
  chevronH: 10,
  /** Ground selection ellipse opacity. Never a filled disc, never a bracket. */
  ellipseAlpha: 0.35,
  /**
   * Above this selection size, healthy-unit bars are suppressed and the
   * ground ellipses switch to their compact group treatment. Damage and hover
   * still reveal an individual bar immediately.
   */
  groupDetailLimit: 6,
  /** Seconds a health bar stays up after the last damage tick. */
  damageBarSeconds: 4.0,
  /** Seconds a floating damage/credit number lives. */
  floaterSeconds: 1.1,
  /** Hits on one entity inside this window roll into one tactical readout. */
  floaterMergeSeconds: 0.28,
  /** Design px a floater rises over its life. */
  floaterRise: 26,
  /** Simultaneous floaters. Pooled; never allocated in the frame loop. */
  floaterPool: 48,
} as const;

/** Interaction timings in milliseconds (VISUAL_DNA §2.13). */
export const HUD_INTERACTION = {
  hoverFadeMs: 80,
  pressMs: 40,
  tooltipDelayMs: 220,
  tooltipMaxPx: 280,
  /** Queue badge punch-in. */
  badgePunchMs: 120,
  /** Credits tally: 12% of the remaining delta per frame, min 3. */
  creditsTallyRate: 0.12,
  creditsTallyMin: 3,
  /** Delta flyout above the credits readout. */
  creditsFlyoutMs: 600,
} as const;

/** Live cameo render budget (VISUAL_DNA §2.8 / I10). */
export const HUD_CAMEO = {
  /** Cameos re-rendered per frame at most. Everything else is cached. */
  perFrameBudget: 2,
  /** Hover turntable, degrees per second. */
  turntableDegPerSec: 12,
  /** Hover re-render rate. */
  hoverHz: 30,
  /** Supersample factor for the offscreen render target. */
  supersample: 2,
  /**
   * Subject fills this fraction of the BINDING axis (spec says 70-85%).
   * Measured against the footprint diagonal, not the bounding sphere — see the
   * fitting note in Cameos.ts.
   */
  subjectFill: 0.86,
  /** Three-quarter view: yaw/pitch of the cameo camera in degrees. */
  yawDeg: -34,
  pitchDeg: 24,
} as const;

/** Superweapon countdown rows (VISUAL_DNA §2.12). */
export const HUD_SUPERWEAPON = {
  rowH: 18,
  rowGap: 2,
  /** Design px of clearance between the box and the sidebar. */
  sidebarClearance: 3,
  /** Ready-state flash rate in Hz. */
  flashHz: 1.0,
  maxRows: 4,
} as const;

/**
 * Faction HUD material sets. This is a FULL MATERIAL SWAP, never a hue rotate
 * (VISUAL_DNA §2.15, non-negotiable #5). Allied is cool violet-grey chrome over
 * a blue lens; Soviet is brass over brushed silver with red glyphs.
 *
 * The chrome highlight is `#BBBCD0` — cool violet-grey. Neutral white reads as
 * plastic and warm reads as gold; that violet cast is what makes it gunmetal.
 */
export interface HudFactionSkin {
  /** 3-zone bevel: specular -> body ramp -> black terminator. */
  bevelHi: string;
  metalHi: string;
  metalMid: string;
  metalLo: string;
  bevelLo: string;
  /** Interactive lens/plate gradient, top to bottom. */
  lens: readonly [string, string, string, string];
  lensRimHi: string;
  lensRimLo: string;
  /** Glyph colour cut into the lens. */
  glyph: string;
  glyphHi: string;
  /** Selected-tab plate and accents. */
  accent: string;
  accentHi: string;
  /** Credits digits and other numerals. */
  numerals: string;
  /** Radar frame + viewport rect. */
  radarFrame: string;
  /** Own / enemy / neutral minimap blips. */
  blipOwn: string;
  blipEnemy: string;
  blipNeutral: string;
  /** Wells are black and flat; nothing is mid-grey flat. */
  wellCredits: string;
  wellCameo: string;
  /** Power bar greens. */
  powerHi: string;
  powerMid: string;
  powerLo: string;
  /** "Ready" overlay. */
  readyFill: string;
  readyText: string;
  /** Command-bar glow-line icons. */
  commandIcon: string;
  commandIconHi: string;
  /** Bottom-cap emblem tint. */
  emblem: string;
}

export const HUD_SKIN_ALLIES: HudFactionSkin = {
  bevelHi: '#BBBCD0',
  metalHi: '#AAACBE',
  metalMid: '#6B6977',
  metalLo: '#3B3A43',
  bevelLo: '#07060B',
  lens: ['#7ED8FC', '#3B90F7', '#2265FB', '#050E58'],
  lensRimHi: '#95EDFF',
  lensRimLo: '#00001C',
  glyph: '#0D20A7',
  glyphHi: '#89E5FF',
  accent: '#8DFAFF',
  accentHi: '#C8FFFF',
  numerals: '#B0CCEA',
  radarFrame: '#C2C9BD',
  blipOwn: '#5A8FD0',
  blipEnemy: '#E8534F',
  blipNeutral: '#E8E8E8',
  wellCredits: '#10111A',
  wellCameo: '#080808',
  powerHi: '#B8FBB2',
  powerMid: '#4CA84C',
  powerLo: '#276316',
  readyFill: '#052A44',
  readyText: '#A9CFED',
  commandIcon: '#85CDF9',
  commandIconHi: '#DFFFFF',
  emblem: '#D0CEDF',
};

export const HUD_SKIN_SOVIETS: HudFactionSkin = {
  bevelHi: '#F0E39A',
  metalHi: '#CDCADB',
  metalMid: '#8A8B92',
  metalLo: '#4A4438',
  bevelLo: '#0B0906',
  lens: ['#CDCADB', '#B7B0BD', '#8A8B92', '#2A2620'],
  lensRimHi: '#F2DDA9',
  lensRimLo: '#1A1408',
  glyph: '#B31B18',
  glyphHi: '#E08A70',
  accent: '#FCEB1F',
  accentHi: '#FFF7A8',
  numerals: '#F1DB75',
  radarFrame: '#FDFAB9',
  blipOwn: '#E8534F',
  blipEnemy: '#5A8FD0',
  blipNeutral: '#E8E8E8',
  wellCredits: '#181818',
  wellCameo: '#0A0A0A',
  powerHi: '#6CE36E',
  powerMid: '#3D993B',
  powerLo: '#0B4A08',
  readyFill: '#1A1602',
  readyText: '#E9ED63',
  commandIcon: '#E7C86E',
  commandIconHi: '#FFF0C4',
  emblem: '#DED48F',
};

/** Minimap terrain colours by SurfaceId, heavily downsampled (VISUAL_DNA §2.5). */
export const HUD_MINIMAP_SURFACE = [
  '#4F5622', // Ground
  '#6A5A38', // Dirt
  '#8E7A4C', // Sand
  '#5E5A52', // Rock
  '#4A4A4A', // Concrete
  '#3E3E42', // Paving
] as const;
/** Water on the radar. */
export const HUD_MINIMAP_WATER = '#16304A';
/** Unexplored shroud on the radar is pure black — never a grey wash. */
export const HUD_MINIMAP_SHROUD = '#000000';
