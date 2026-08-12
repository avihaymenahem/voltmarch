/**
 * HUD — the falsifiable half.
 *
 * Everything in `src/ui/**` that does not need a DOM: the resolution-
 * independence arithmetic, the row-count budget, the glyph inventory, the arc
 * geometry, the faction skin swap — and, since the two occupancy rows were
 * lifted out of the `Hud` class as pure functions, what those rows say about a
 * selection. The tests run under `environment: 'node'` like the rest of the
 * suite, so nothing here touches `document`.
 *
 * These are the checks a HUD critic runs from VISUAL_DNA §2 and §2.17, encoded
 * so a regression is a red build rather than a screenshot argument.
 */

import { describe, expect, it } from 'vitest';

import {
  HUD_DESIGN_WIDTH,
  HUD_GRID,
  HUD_SKIN_ALLIES,
  HUD_SKIN_SOVIETS,
  HUD_STACK,
  HUD_COMMAND_BAR,
  HUD_OVERLAY,
} from '../src/core/config';
import { BUILD_TAB_COUNT, BuildTab, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { World } from '../src/core/world';
import {
  computeCargoAction,
  computeGarrisonAction,
  type GarrisonSeamRead,
  type TransportSeamRead,
} from '../src/ui/Hud';
import type { CargoAction, GarrisonAction } from '../src/ui/Sidebar';
import {
  BUILD_SLOT_HOTKEYS,
  BUILD_SLOT_HOTKEY_LABELS,
  BUILD_TAB_HOTKEYS,
  BUILD_TAB_HOTKEY_LABELS,
} from '../src/input/ActionCatalogue';
import {
  BUILD_COLUMNS, BUILD_ROWS, SLOT_HOTKEY_CODES, TAB_HOTKEY_CODES,
} from '../src/ui/Sidebar';
import { ICONS, TAB_ICONS } from '../src/ui/icons';
import { ProductionCatalog } from '../src/sim/Production';
import { resolveDefBinding } from '../src/game/Scenarios';
import {
  GLYPHS,
  arcPath,
  cameoRowsFor,
  computeUiScale,
  factionKey,
  formatClock,
  formatCredits,
  hexToRgb,
  lensStripPath,
  mixHex,
  rgbToHex,
  roundRectPath,
  sidebarWidthPx,
  skinFor,
  tabPlatePath,
  type GlyphName,
} from '../src/ui/Chrome';

/* ========================================================================== */

describe('HUD — resolution independence (§2.1, I9)', () => {
  it('quantizes uiScale to quarter steps and clamps to 1..4', () => {
    expect(computeUiScale(768)).toBe(1.0);
    expect(computeUiScale(1080)).toBe(1.5);
    expect(computeUiScale(1440)).toBe(2.0);
    expect(computeUiScale(2160)).toBe(3.0);
    // Clamped at both ends — a 400 px window still gets a usable sidebar and a
    // 6K one does not get a 6-inch-wide one.
    expect(computeUiScale(400)).toBe(1.0);
    expect(computeUiScale(8000)).toBe(4.0);
  });

  it('only ever produces multiples of 0.25', () => {
    for (let h = 300; h <= 4320; h += 7) {
      const s = computeUiScale(h);
      expect(Math.round(s * 4) % 1).toBe(0);
      expect(s * 4).toBeCloseTo(Math.round(s * 4), 10);
    }
  });

  it('holds the sidebar at 12-14% of width at every shipping resolution', () => {
    // Non-negotiable #1. The whole point of the vector rewrite (I9) is that the
    // fixed 168 px asset stops being 4.4% of a 4K screen.
    const modes: ReadonlyArray<[number, number]> = [
      [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
    ];
    for (const [w, h] of modes) {
      const share = sidebarWidthPx(computeUiScale(h)) / w;
      expect(share).toBeGreaterThanOrEqual(0.12);
      expect(share).toBeLessThanOrEqual(0.14);
    }
  });

  it('keeps the whole HUD inside the bible §9 budget of 12-16% of the frame', () => {
    // This is the assertion that forced the command bar down from D13's 28
    // design px to 23 — see the note on HUD_COMMAND_BAR. The sidebar alone is
    // 13.125% from 1080 up, so the bar has under 3% of the frame to spend.
    const modes: ReadonlyArray<[number, number]> = [
      [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
    ];
    for (const [w, h] of modes) {
      const u = computeUiScale(h);
      const sw = sidebarWidthPx(u);
      const ch = HUD_COMMAND_BAR.height * u;
      const share = (sw * h + ch * (w - sw)) / (w * h);
      expect(share, `${w}x${h}`).toBeGreaterThan(0.12);
      expect(share, `${w}x${h}`).toBeLessThan(0.16);
    }
  });

  it('leaves the command-bar icons room between the two rules', () => {
    // 2 px white rule above + 2 px dark-red rule below, border-box.
    expect(HUD_COMMAND_BAR.height - 4).toBeGreaterThanOrEqual(HUD_COMMAND_BAR.iconH);
  });

  it('renders the sidebar at an integer CSS pixel width', () => {
    for (let h = 600; h <= 2160; h += 13) {
      expect(Number.isInteger(sidebarWidthPx(computeUiScale(h)))).toBe(true);
    }
  });
});

/* ========================================================================== */

describe('HUD — cameo grid budget (§2.2, §2.8)', () => {
  it('gives 10 rows at the reference 1366x768', () => {
    // The reference sidebar is 2 x 10. `floor((768 - 229 - 41) / 50) = 9`, and
    // the spec's own table says 10 because the bottom cap overlaps the last
    // row's gutter; we take the conservative floor and clamp, so 9 or 10 both
    // pass here but neither may collapse the grid.
    const rows = cameoRowsFor(768, 1.0);
    expect(rows).toBeGreaterThanOrEqual(9);
    expect(rows).toBeLessThanOrEqual(10);
  });

  it('never exceeds 12 rows or drops below 4', () => {
    for (let h = 400; h <= 4320; h += 11) {
      const rows = cameoRowsFor(h, computeUiScale(h));
      expect(rows).toBeGreaterThanOrEqual(HUD_GRID.minRows);
      expect(rows).toBeLessThanOrEqual(HUD_GRID.maxRows);
    }
  });

  it('keeps the row count roughly constant across resolutions', () => {
    // uiScale tracks height, so a 4K screen must not suddenly show 30 rows.
    const at1080 = cameoRowsFor(1080, computeUiScale(1080));
    const at2160 = cameoRowsFor(2160, computeUiScale(2160));
    expect(Math.abs(at2160 - at1080)).toBeLessThanOrEqual(2);
  });

  it('keeps the cameo art at 5:4 and the grid at 2 columns', () => {
    // Non-negotiable #2: not 3-column, not square, not a card rail.
    expect(HUD_GRID.columns).toBe(2);
    expect(HUD_GRID.artW / HUD_GRID.artH).toBeCloseTo(1.25, 5);
    expect(HUD_GRID.pitchX).toBeGreaterThan(HUD_GRID.artW);
    expect(HUD_GRID.pitchY).toBeGreaterThan(HUD_GRID.artH);
  });

  it('fits the grid, both gutters and the column gap inside 168 design px', () => {
    const used =
      HUD_GRID.gutterLeft +
      HUD_GRID.columns * HUD_GRID.artW +
      (HUD_GRID.pitchX - HUD_GRID.artW) +
      HUD_GRID.gutterRight;
    expect(used).toBeLessThanOrEqual(HUD_DESIGN_WIDTH);
  });

  it('adds the §2.2 header rows up to the published 229 design px', () => {
    const stacked =
      HUD_STACK.topCap + HUD_STACK.credits + HUD_STACK.creditsGap + HUD_STACK.topPair +
      HUD_STACK.radarBezelTop + HUD_STACK.radar + HUD_STACK.radarBezelBottom +
      HUD_STACK.actionArc + HUD_STACK.tabStrip;
    // Within a couple of px of the published header; the slack is the 1 px
    // bevel terminators the table folds into its neighbours.
    expect(Math.abs(stacked - HUD_STACK.header)).toBeLessThanOrEqual(3);
    expect(HUD_STACK.bottomBand + HUD_STACK.bottomCap + HUD_STACK.bottomPlinth).toBe(HUD_STACK.footer);
  });
});

/* ========================================================================== */

describe('HUD — faction recolour is a full material swap (§2.15, non-negotiable #5)', () => {
  it('maps every faction to a skin, with Neutral borrowing Allied chrome', () => {
    expect(factionKey(Faction.Allies)).toBe('allies');
    expect(factionKey(Faction.Soviets)).toBe('soviets');
    expect(factionKey(Faction.Neutral)).toBe('allies');
    expect(skinFor(Faction.Soviets)).toBe(HUD_SKIN_SOVIETS);
    expect(skinFor(Faction.Allies)).toBe(HUD_SKIN_ALLIES);
  });

  it('shares no CHROME colour between the two skins', () => {
    // A hue rotate would leave most values shared. A full material swap shares
    // nothing — except the three blip colours, which are game-state semantics
    // rather than chrome: own/enemy deliberately swap between the factions and
    // neutral stays neutral for both.
    const SEMANTIC = new Set(['blipOwn', 'blipEnemy', 'blipNeutral']);
    const soviet = new Set<string>();
    for (const [k, v] of Object.entries(HUD_SKIN_SOVIETS)) {
      if (SEMANTIC.has(k)) continue;
      for (const c of ([] as string[]).concat(v)) soviet.add(c);
    }
    for (const [k, v] of Object.entries(HUD_SKIN_ALLIES)) {
      if (SEMANTIC.has(k)) continue;
      for (const c of ([] as string[]).concat(v)) {
        expect(soviet.has(c), `${k}=${c} appears in both skins`).toBe(false);
      }
    }
  });

  it('keeps the Allied chrome highlight cool violet-grey, never neutral white', () => {
    // Non-negotiable #7. `#BBBCD0`: blue must exceed red, and it must not be
    // a neutral grey.
    const [r, g, b] = hexToRgb(HUD_SKIN_ALLIES.bevelHi);
    expect(b).toBeGreaterThan(r);
    expect(b - r).toBeGreaterThanOrEqual(8);
    expect(Math.max(r, g, b)).toBeLessThan(240);
  });

  it('keeps the Soviet frame metal warm brass', () => {
    const [r, , b] = hexToRgb(HUD_SKIN_SOVIETS.bevelHi);
    expect(r).toBeGreaterThan(b);
  });

  it('keeps every well black and flat — nothing mid-grey (§2.14 law 4)', () => {
    for (const skin of [HUD_SKIN_ALLIES, HUD_SKIN_SOVIETS]) {
      for (const well of [skin.wellCredits, skin.wellCameo]) {
        const [r, g, b] = hexToRgb(well);
        expect(Math.max(r, g, b)).toBeLessThan(40);
      }
    }
  });

  it('runs the bevel ramp monotonically from specular to black terminator', () => {
    for (const skin of [HUD_SKIN_ALLIES, HUD_SKIN_SOVIETS]) {
      const ramp = [skin.bevelHi, skin.metalHi, skin.metalMid, skin.metalLo, skin.bevelLo];
      const luma = ramp.map((h) => {
        const [r, g, b] = hexToRgb(h);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      });
      for (let i = 1; i < luma.length; i++) expect(luma[i]).toBeLessThan(luma[i - 1]);
      expect(luma[luma.length - 1]).toBeLessThan(20);
    }
  });

  it('gives each faction distinct own/enemy blips', () => {
    for (const skin of [HUD_SKIN_ALLIES, HUD_SKIN_SOVIETS]) {
      expect(skin.blipOwn).not.toBe(skin.blipEnemy);
      expect(skin.blipOwn).not.toBe(skin.blipNeutral);
    }
    // The two factions swap: your own units are always the "friendly" hue for
    // whichever side you are playing.
    expect(HUD_SKIN_ALLIES.blipOwn).toBe(HUD_SKIN_SOVIETS.blipEnemy);
    expect(HUD_SKIN_ALLIES.blipEnemy).toBe(HUD_SKIN_SOVIETS.blipOwn);
  });
});

/* ========================================================================== */

describe('HUD — the glyph inventory (§2.4, §2.6, §2.7, §2.12)', () => {
  const REQUIRED: readonly GlyphName[] = [
    'diplomacy', 'options',
    'repair', 'sell',
    'tabStructures', 'tabDefence', 'tabInfantry', 'tabVehicles',
    'cmdStop', 'cmdGuardHold', 'cmdFormation', 'cmdScatter', 'cmdGuard', 'cmdWaypoint',
    'eagle', 'star',
  ];

  it('ships every glyph the spec names, and no placeholders', () => {
    for (const name of REQUIRED) {
      const def = GLYPHS[name];
      expect(def, name).toBeDefined();
      expect(def.shapes.length, name).toBeGreaterThan(0);
      for (const s of def.shapes) {
        expect(s.d.length, name).toBeGreaterThan(8);
        expect(s.d[0], name).toBe('M');
      }
    }
  });

  it('has an icon for every build tab and 6 command-bar glyphs', () => {
    const cmds = REQUIRED.filter((n) => n.startsWith('cmd'));
    // THE CLAIM IS "EVERY TAB HAS AN ICON", AND IT IS ASSERTED ON THE ARRAY
    // THAT HOLDS THEM. It used to be asserted on a NAME PREFIX — how many
    // required glyphs start with `tab` — which was the same number only for
    // as long as every tab happened to have a glyph of its own. The Powers
    // tab borrows `superweapon`, the one icon in the set that already means
    // "called down, not built", so the prefix count says four and the roster
    // is five. Reading `TAB_ICONS` says what the test was always for.
    expect(TAB_ICONS.length).toBe(BUILD_TAB_COUNT);
    for (const n of TAB_ICONS) expect(ICONS[n], `no glyph for "${n}"`).toBeDefined();
    expect(cmds.length).toBe(HUD_COMMAND_BAR.iconCount);
  });

  it('cants the wrench off vertical, as §2.6 specifies', () => {
    expect(GLYPHS.repair.rotate).toBeDefined();
    expect(Math.abs(GLYPHS.repair.rotate as number)).toBeGreaterThanOrEqual(15);
    expect(Math.abs(GLYPHS.repair.rotate as number)).toBeLessThanOrEqual(25);
  });

  it('draws the sell glyph with a DOUBLE vertical stroke', () => {
    // Two filled bars plus one stroked S. A single-bar `$` is the wrong glyph.
    const bars = GLYPHS.sell.shapes.filter((s) => s.stroke === undefined);
    expect(bars.length).toBe(2);
    expect(GLYPHS.sell.shapes.some((s) => s.stroke !== undefined)).toBe(true);
  });

  it('distinguishes the one-bar and two-bar command ellipses', () => {
    expect(GLYPHS.cmdGuardHold.shapes.length).toBe(GLYPHS.cmdStop.shapes.length + 1);
  });
});

/* ========================================================================== */

describe('HUD — the chrome shapes bow toward the sidebar centre (§2.14 law 1)', () => {
  it('bows the action arc upward at its midpoint', () => {
    // The path starts at y = bow on both ends and pulls the quadratic control
    // point to -bow, so the rendered midpoint is above the endpoints.
    const bow = 4;
    const d = arcPath(63, 26, bow);
    expect(d).toContain(`M0 ${bow}`);
    expect(d).toContain(`Q 31.5 ${-bow}`);
    // Midpoint of a quadratic is (p0 + 2c + p2)/4 -> above y = 0.
    const midY = (bow + 2 * -bow + bow) / 4;
    expect(midY).toBeLessThan(bow);
  });

  it('tapers the top lens strip so it is not a rectangle', () => {
    const d = lensStripPath(80, 20, 5, 3);
    // Wide at the top edge (full 0..80), narrower at the bottom (5..75).
    expect(d).toContain('M0 0 L80 0');
    expect(d).toContain('L75 17');
  });

  it('keystones the tab plates in opposite directions either side of centre', () => {
    const left = tabPlatePath(30, 31, +3, 0);
    const right = tabPlatePath(30, 31, -3, 0);
    expect(left).not.toBe(right);
  });

  it('emits a closed rounded-rect path for the cameo key', () => {
    const d = roundRectPath(0, 0, 60, 48, 3);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    // A radius larger than half the box must clamp, not invert the path.
    expect(() => roundRectPath(0, 0, 4, 4, 40)).not.toThrow();
    expect(roundRectPath(0, 0, 4, 4, 40)).toContain('M2 0');
  });
});

/* ========================================================================== */

describe('HUD — readouts (§2.3, §2.12, §2.16)', () => {
  it('formats credits with no $, no separator, and no negatives', () => {
    expect(formatCredits(0)).toBe('0');
    expect(formatCredits(10000)).toBe('10000');
    expect(formatCredits(1234.9)).toBe('1234');
    expect(formatCredits(-50)).toBe('0');
    expect(formatCredits(1e12).length).toBeLessThanOrEqual(8);
    for (const v of [0, 7, 999, 123456]) expect(formatCredits(v)).not.toMatch(/[$,.\s]/);
  });

  it('formats the superweapon clock as zero-padded MM:SS', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(60)).toBe('01:00');
    expect(formatClock(190)).toBe('03:10');
    expect(formatClock(-5)).toBe('00:00');
    // Rounds UP, so a countdown never shows 00:00 while it is still charging.
    expect(formatClock(0.2)).toBe('00:01');
  });
});

/* ========================================================================== */

describe('HUD — colour helpers', () => {
  it('round-trips hex through rgb', () => {
    for (const hex of ['#000000', '#ffffff', '#3b90f7', '#4a6b33']) {
      const [r, g, b] = hexToRgb(hex);
      expect(rgbToHex(r, g, b)).toBe(hex);
    }
  });

  it('expands 3-digit hex', () => {
    expect(hexToRgb('#f0a')).toEqual([255, 0, 170]);
  });

  it('mixes linearly and clamps the endpoints', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

/* ========================================================================== */

describe('HUD — world overlay geometry (§2.11)', () => {
  it('keeps the health bar at the measured 34 x 4 with a 2 px hatch', () => {
    expect(HUD_OVERLAY.barW).toBe(34);
    expect(HUD_OVERLAY.barH).toBe(4);
    expect(HUD_OVERLAY.hatchPeriod).toBe(2);
    // 1 px light rule top and bottom leaves exactly 2 px of fill.
    expect(HUD_OVERLAY.barH - 2).toBe(2);
  });

  it('keeps the control-group badge at 12 x 14 (decision D9)', () => {
    expect(HUD_OVERLAY.badgeW).toBe(12);
    expect(HUD_OVERLAY.badgeH).toBe(14);
  });

  it('keeps the selection ellipse subtle enough to stay a hint (I15)', () => {
    expect(HUD_OVERLAY.ellipseAlpha).toBeGreaterThan(0.2);
    expect(HUD_OVERLAY.ellipseAlpha).toBeLessThanOrEqual(0.4);
  });

  it('pools floaters rather than allocating them per hit', () => {
    expect(HUD_OVERLAY.floaterPool).toBeGreaterThanOrEqual(24);
  });
});

/* ========================================================================== */

describe('HUD — the build keyboard is the catalogue, not a copy', () => {
  it('re-exports the catalogue arrays by identity', () => {
    // Identity, not equality. Two arrays with the same contents is exactly the
    // state this closed: the badge the sidebar prints on a cameo and the row the
    // help screen renders have to be the same array element, or a letter can be
    // changed in one place and silently promised in the other.
    expect(TAB_HOTKEY_CODES).toBe(BUILD_TAB_HOTKEYS);
    expect(SLOT_HOTKEY_CODES).toBe(BUILD_SLOT_HOTKEYS);
  });

  it('badges as many slots as it binds', () => {
    // The eleventh cameo carries no badge because there is no eleventh letter.
    expect(BUILD_SLOT_HOTKEY_LABELS.length).toBe(SLOT_HOTKEY_CODES.length);
    expect(BUILD_TAB_HOTKEY_LABELS.length).toBe(BUILD_TAB_COUNT);
  });
});

/* ==========================================================================
 * THE BUILD GRID'S SHAPE IS SIZED AGAINST THE ROSTER, NOT GUESSED
 *
 * The palette went 6 columns -> 3 -> 2 as it moved from a bottom dock to a
 * right rail and then traded width for cameo resolution. Every one of those
 * steps risks the same silent failure: a grid with fewer slots than the tab has
 * entries simply DOES NOT DRAW the overflow. No error, no scrollbar worth
 * noticing — a unit just stops being buildable.
 *
 * So the pool is asserted against the real rosters rather than against a
 * remembered number. Adding a ninth unit to any tab fails here, at the place
 * that has to change, instead of in a match nobody is watching.
 * ========================================================================== */
describe('the build grid holds every faction’s largest tab', () => {
  it('has at least as many slots as the biggest roster', async () => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound, 'unbound catalog — rosters would be fallback content').toBe(true);

    let worst = 0;
    let worstWhere = '';
    for (const faction of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      for (const tab of [BuildTab.Structures, BuildTab.Defense, BuildTab.Infantry, BuildTab.Vehicles]) {
        const n = catalog.roster(faction, tab).length;
        if (n > worst) { worst = n; worstWhere = `faction ${faction}, tab ${tab}`; }
      }
    }

    expect(
      BUILD_COLUMNS * BUILD_ROWS,
      `${worstWhere} has ${worst} entries and the grid pools only ${BUILD_COLUMNS * BUILD_ROWS}`,
    ).toBeGreaterThanOrEqual(worst);
    // And the other direction: the pool must not drift into being enormous,
    // because every slot is a DOM subtree plus a cameo canvas built at boot.
    expect(BUILD_COLUMNS * BUILD_ROWS).toBeLessThanOrEqual(worst * 3);
  });
});

/* ==========================================================================
 * THE BRIEF HAS SOMETHING TO SAY ABOUT EVERY ENTRY
 *
 * `.vm-brief` prints the hovered — or, at rest, the first — entry's one-line
 * `blurb` at the foot of the build panel, permanently. That text was already
 * written for every def and already fed the tooltip, so nothing here is new
 * content; what IS new is that a missing or overlong blurb is now visible for
 * as long as the tab is open rather than for the second somebody hovers.
 *
 * Both failure modes are silent on screen — an empty string renders as an
 * empty box, and an overlong one is clipped by `-webkit-line-clamp` with no
 * ellipsis to announce it — so they are asserted here instead.
 * ========================================================================== */
describe('every buildable carries a brief that fits the strip', () => {
  /**
   * Two rendered lines at font-size 8u in a 240u rail, less 10u of padding.
   * Rajdhani averages well under 0.5em per character for mixed-case prose, so
   * 230u / 4u is a conservative ~57 per line. 100 is that budget with the
   * rounding thrown away — and the longest blurb in the game today is 60, so
   * this leaves room to write a better sentence without leaving room to write
   * a paragraph.
   */
  const MAX_CHARS = 100;

  it('gives every roster entry a non-empty blurb', async () => {
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound, 'unbound catalog — this would pass vacuously').toBe(true);

    const missing: string[] = [];
    const overlong: string[] = [];
    let checked = 0;

    for (const faction of [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]) {
      for (const tab of [BuildTab.Structures, BuildTab.Defense, BuildTab.Infantry, BuildTab.Vehicles]) {
        for (const entry of catalog.roster(faction, tab)) {
          checked++;
          const blurb = entry.blurb.trim();
          if (blurb === '') missing.push(`${entry.key} (${entry.name})`);
          else if (blurb.length > MAX_CHARS) {
            overlong.push(`${entry.key} ${blurb.length} chars`);
          }
        }
      }
    }

    // Guard the guard: a roster that resolved to nothing would report zero
    // failures and mean nothing.
    expect(checked, 'no roster entries were examined').toBeGreaterThan(40);
    expect(missing, 'entries whose brief would render as an empty box').toEqual([]);
    expect(overlong, `blurbs that clip past ${MAX_CHARS} chars`).toEqual([]);
  });

  it('does not let a blurb be a restatement of the name', async () => {
    // "Grenadier — Grenadier." costs the two rows and teaches nothing. This is
    // the one quality bar cheap enough to enforce mechanically.
    const catalog = new ProductionCatalog(await resolveDefBinding());
    expect(catalog.bound).toBe(true);

    for (const entry of catalog.entries) {
      if (entry.blurb === '') continue;
      expect(
        entry.blurb.trim().toLowerCase().replace(/[.\s]+$/, ''),
        `${entry.key}'s blurb only repeats its name`,
      ).not.toBe(entry.name.trim().toLowerCase());
    }
  });
});

/* ==========================================================================
 * THE TWO OCCUPANCY ROWS READ THE WHOLE SELECTION
 *
 * Reported as: "when selecting multiple vehicles that can load and unload
 * troops, add the unload button in the bottom mid HUD as well".
 *
 * The button was there. It was gated on `selection.count !== 1`, while the
 * order layer underneath it — `gatherLoadedTransports` -> `issueUnload`, and
 * `gatherOccupiedGarrisons` -> `issueEvacuate` — had walked the whole selection
 * since it shipped. So the D key emptied N transports and the button emptied
 * one, and `tests/transport.spec.ts` could not see the difference because it
 * tests the sim and the gate was in the view.
 *
 * There was no coverage of the cargo row at all before this block. These are
 * the cases the gate was hiding: a sum over several hulls, a mixed loaded/empty
 * pair, and the two ways the row should disappear.
 * ========================================================================== */

describe('the cargo row is a sum over every selected hull with seats', () => {
  const LOCAL = 0 as PlayerId;
  const ENEMY = 1 as PlayerId;

  function makeWorld(): World {
    const w = new World();
    w.addPlayer(Faction.Allies, 'Commander', true, true);
    w.addPlayer(Faction.Soviets, 'Opponent', false, false);
    return w;
  }

  function spawn(w: World, kind: EntityKind, owner: PlayerId): EntityId {
    return w.store.alloc(kind, -1, owner, Faction.Allies, 0, 0, 0);
  }

  function select(w: World, ids: readonly EntityId[]): void {
    for (let i = 0; i < ids.length; i++) w.selection.ids[i] = ids[i] as number;
    w.selection.count = ids.length;
  }

  /**
   * The transport seam, faked from a table of `[seats, aboard]`.
   *
   * Duck-typed exactly as `src/sim/features.system.ts` publishes it, which is
   * the whole point of the seam: the HUD never imports `TransportService`, so
   * a fake answering the two questions is indistinguishable from the real one.
   */
  function seats(table: ReadonlyMap<EntityId, readonly [number, number]>): TransportSeamRead {
    return {
      capacity: (h) => table.get(h)?.[0] ?? 0,
      passengerCount: (h) => table.get(h)?.[1] ?? 0,
      // The fake speaks in bodies, so one slot per passenger keeps these
      // tables readable. The real service charges a vehicle two, which is
      // covered where it belongs, in `transport.spec.ts`.
      usedSlots: (h) => table.get(h)?.[1] ?? 0,
    };
  }

  function occupants(table: ReadonlyMap<EntityId, number>): GarrisonSeamRead {
    return { occupantCount: (b) => table.get(b) ?? 0 };
  }

  /** A row in the state `buildSelectionView` finds it in: hidden and blank. */
  function cargoRow(): CargoAction {
    return { visible: false, enabled: false, count: 0, capacity: 0, hint: '' };
  }

  function garrisonRow(): GarrisonAction {
    return { visible: false, enabled: false, count: 0, hint: '' };
  }

  it('sums men and seats across two loaded transports', () => {
    const w = makeWorld();
    const a = spawn(w, EntityKind.Vehicle, LOCAL);
    const b = spawn(w, EntityKind.Vehicle, LOCAL);
    select(w, [a, b]);

    const action = cargoRow();
    computeCargoAction(action, w, seats(new Map([[a, [5, 3]], [b, [4, 2]]])));

    expect(action.visible).toBe(true);
    expect(action.enabled).toBe(true);
    expect(action.count).toBe(5);
    expect(action.capacity).toBe(9);
    // The readout is `${count} / ${capacity}` — the hint is the only place the
    // player learns the men are spread over more than one hull.
    expect(action.hint).toContain('all 5 passengers');
    expect(action.hint).toContain('all 2 hulls');
  });

  it('counts an empty hull’s seats and stays enabled for the loaded one', () => {
    // The mixed selection is the case the old gate got most wrong: it showed
    // nothing at all, so a loaded transport dragged over with an empty one
    // could not be unloaded from the panel.
    const w = makeWorld();
    const loaded = spawn(w, EntityKind.Vehicle, LOCAL);
    const empty = spawn(w, EntityKind.Vehicle, LOCAL);
    select(w, [loaded, empty]);

    const action = cargoRow();
    computeCargoAction(action, w, seats(new Map([[loaded, [5, 2]], [empty, [5, 0]]])));

    expect(action.visible).toBe(true);
    expect(action.enabled).toBe(true);
    expect(action.count).toBe(2);
    expect(action.capacity).toBe(10);
    // One hull is loaded, so the hint stays singular about where the men land
    // even though two hulls are selected.
    expect(action.hint).toContain('the hull');
    expect(action.hint).not.toContain('hulls');
  });

  it('hides the row when nothing selected has seats', () => {
    const w = makeWorld();
    const a = spawn(w, EntityKind.Vehicle, LOCAL);
    const b = spawn(w, EntityKind.Infantry, LOCAL);
    select(w, [a, b]);

    const action = cargoRow();
    action.visible = true;                       // must be actively cleared
    computeCargoAction(action, w, seats(new Map()));

    expect(action.visible).toBe(false);
  });

  it('shows 0 / N for a selection of empty transports rather than hiding', () => {
    // The ONE place this row differs from the garrison row, and it is
    // deliberate — see the block above `CargoAction` in `src/ui/Sidebar.ts`.
    // Passengers are invisible on the field, so "0 / 10" is the answer to a
    // question the player cannot ask any other way.
    const w = makeWorld();
    const a = spawn(w, EntityKind.Vehicle, LOCAL);
    const b = spawn(w, EntityKind.Vehicle, LOCAL);
    select(w, [a, b]);

    const action = cargoRow();
    computeCargoAction(action, w, seats(new Map([[a, [5, 0]], [b, [5, 0]]])));

    expect(action.visible).toBe(true);
    expect(action.enabled).toBe(false);
    expect(action.count).toBe(0);
    expect(action.capacity).toBe(10);
  });

  it('leaves an enemy hull out of the sum', () => {
    // Selection can hold entities you do not own — a marquee over a mixed
    // fight, or a click on an enemy. Their seats are not yours to empty.
    const w = makeWorld();
    const mine = spawn(w, EntityKind.Vehicle, LOCAL);
    const theirs = spawn(w, EntityKind.Vehicle, ENEMY);
    select(w, [mine, theirs]);

    const action = cargoRow();
    computeCargoAction(action, w, seats(new Map([[mine, [5, 1]], [theirs, [8, 6]]])));

    expect(action.count).toBe(1);
    expect(action.capacity).toBe(5);
  });

  it('hides the row when the transport service never landed', () => {
    // `sim.features` absent — a `?shot=` boot, or a content module that never
    // registered. The seam answers null and the row is simply not offered.
    const w = makeWorld();
    select(w, [spawn(w, EntityKind.Vehicle, LOCAL)]);
    const action = cargoRow();
    action.visible = true;
    computeCargoAction(action, w, null);
    expect(action.visible).toBe(false);
  });

  it('sums occupants across two garrisoned buildings', () => {
    const w = makeWorld();
    const a = spawn(w, EntityKind.Building, LOCAL);
    const b = spawn(w, EntityKind.Building, LOCAL);
    select(w, [a, b]);

    const action = garrisonRow();
    computeGarrisonAction(action, w, occupants(new Map([[a, 3], [b, 2]])));

    expect(action.visible).toBe(true);
    expect(action.enabled).toBe(true);
    expect(action.count).toBe(5);
    expect(action.hint).toContain('all 5 occupants');
    expect(action.hint).toContain('2 buildings');
  });

  it('hides the garrison row at zero occupants, where the cargo row would not', () => {
    // The asymmetry, asserted in one place so it cannot be "tidied" away: a
    // permanent "0 inside" on a Power Plant is noise on every structure the
    // player ever clicks, whereas "0 / 5" on a hull is information.
    const w = makeWorld();
    const a = spawn(w, EntityKind.Building, LOCAL);
    const b = spawn(w, EntityKind.Building, LOCAL);
    select(w, [a, b]);

    const action = garrisonRow();
    action.visible = true;
    computeGarrisonAction(action, w, occupants(new Map([[a, 0], [b, 0]])));
    expect(action.visible).toBe(false);
  });

  it('counts only the occupied buildings when naming them', () => {
    // Three selected, one occupied: "3 inside" over "the building", not over
    // three of them. The hint is the only thing that says how many places the
    // men come out of, so the count behind it has to be the occupied one.
    const w = makeWorld();
    const full = spawn(w, EntityKind.Building, LOCAL);
    const empty1 = spawn(w, EntityKind.Building, LOCAL);
    const empty2 = spawn(w, EntityKind.Building, LOCAL);
    select(w, [full, empty1, empty2]);

    const action = garrisonRow();
    computeGarrisonAction(action, w, occupants(new Map([[full, 3]])));

    expect(action.visible).toBe(true);
    expect(action.count).toBe(3);
    expect(action.hint).toContain('the building');
    expect(action.hint).not.toContain('buildings');
  });

  it('ignores a selected vehicle even when the garrison seam answers for it', () => {
    // `EntityKind.Building` is the gate, not the seam's answer. A transport and
    // a strongpoint are two rows, and a vehicle must never appear in this one.
    const w = makeWorld();
    const hull = spawn(w, EntityKind.Vehicle, LOCAL);
    select(w, [hull]);

    const action = garrisonRow();
    action.visible = true;
    computeGarrisonAction(action, w, occupants(new Map([[hull, 4]])));
    expect(action.visible).toBe(false);
  });
});
