/**
 * ============================================================================
 * tests/hud-palette.spec.ts — ONE HEX, WRITTEN DOWN TWICE, CHECKED ONCE
 * ============================================================================
 * `Chrome.SEMANTIC`'s own header states the rule this file enforces: the
 * semantic colours live in TypeScript "because the canvas layers (minimap,
 * world overlay) need the same values and a duplicated hex is how two halves of
 * one interface end up disagreeing about what 'damaged' looks like".
 *
 * They are duplicated anyway, because CSS cannot import a module: `hud.css`
 * declares `--vm-ok`, `--vm-warn`, `--vm-danger`, `--vm-gold` and now
 * `--vm-ally` in `:root`. Nothing compared the two copies. Adding a fifth was
 * the moment to.
 *
 * ── AND THE ALLY COLOUR IS A SECOND, HARDER CLAIM ───────────────────────────
 * `SEMANTIC.ally` exists because `Minimap.restyle` painted every allied seat in
 * the LOCAL PLAYER'S OWN ACCENT, so in a 2v2 your tanks and your team-mate's
 * were one colour. Reported as exactly that.
 *
 * The fix is only a fix if the new colour is TELLABLE APART from everything
 * else that can share a minimap: the four faction accents, the four
 * `HOSTILE_COLORS`, and `SEMANTIC.ore`. That is not a matter of taste and it is
 * not safe to leave to whoever next retunes the palette — so the separation is
 * measured here, in hue, against the real tables rather than against a copy.
 *
 * ── WHY THE BEHAVIOUR TEST DRIVES THE REAL CLASS ────────────────────────────
 * The defect was a colour CHOICE inside a four-branch conditional, and a source
 * scan can only assert that some identifier appears. So `restyle` is exercised
 * through a real `Minimap` against a real `World`, in the harness shape
 * `tests/minimap-pings.spec.ts` established for the same reason.
 *
 * **THE DUEL CASE IS THE FALSIFIER, NOT A COURTESY.** The whole safety argument
 * for landing this is that a 1v1 cannot reach the new branch, so no `?shot=`
 * fixture and no existing match moves a pixel. If that stops being true, this
 * file has to fail before anybody photographs anything.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_CELLS } from '../src/core/config';
import { Faction } from '../src/core/types';
import type { PlayerId } from '../src/core/types';
import { World } from '../src/core/world';
import { HOSTILE_COLORS, SEMANTIC, accentFor } from '../src/ui/Chrome';
import { Minimap } from '../src/ui/Minimap';
import type { MinimapOptions } from '../src/ui/Minimap';
import type { CameraRig } from '../src/render/camera';

/* ==========================================================================
 * 1. THE TWO COPIES OF THE PALETTE AGREE
 * ========================================================================== */

/** Every `--vm-*: #hex;` declared in `hud.css`, lowercased. */
function cssVars(): Map<string, string> {
  const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'hud.css'), 'utf8');
  const out = new Map<string, string>();
  for (const m of css.matchAll(/^\s*(--vm-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/gm)) {
    out.set(m[1] ?? '', (m[2] ?? '').toLowerCase());
  }
  return out;
}

/** The pairs that are genuinely one value written in two places. */
const MIRRORED: ReadonlyArray<readonly [string, string]> = [
  ['--vm-ok', SEMANTIC.ok],
  ['--vm-danger', SEMANTIC.danger],
  ['--vm-ally', SEMANTIC.ally],
];

describe('hud.css and Chrome.SEMANTIC do not disagree', () => {
  const vars = cssVars();

  it('found the :root block at all', () => {
    // THE VACUITY GUARD. An empty map makes every `get` below undefined, which
    // would fail loudly — but a map that parsed only two of the five would let
    // the rest pass by absence, so the count is asserted rather than assumed.
    expect(vars.size, 'no --vm-* hex parsed out of hud.css — the scan is broken')
      .toBeGreaterThan(5);
  });

  it('every mirrored semantic matches its CSS variable', () => {
    for (const [name, value] of MIRRORED) {
      expect(vars.get(name), `${name} is not declared in hud.css`).toBeDefined();
      expect(vars.get(name), `${name} and its Chrome.SEMANTIC twin have drifted`)
        .toBe(value.toLowerCase());
    }
  });

  it('and the pairs that deliberately do NOT mirror are declared here', () => {
    /*
     * `--vm-gold` is #f6c445 while `SEMANTIC.ore` is #c8a83c, because they are
     * two meanings that happen to both be yellow: veterancy chrome versus ore on
     * the map. `SEMANTIC.gold` is the one `--vm-gold` mirrors.
     *
     * Written down so the next person to notice the near-miss does not "fix" it.
     */
    expect(vars.get('--vm-warn')).toBe(SEMANTIC.warn.toLowerCase());
    expect(vars.get('--vm-gold')).toBe(SEMANTIC.gold.toLowerCase());
    expect(SEMANTIC.ore).not.toBe(SEMANTIC.gold);
  });
});

/* ==========================================================================
 * 2. THE ALLY COLOUR IS ACTUALLY DISTINGUISHABLE
 * ========================================================================== */

/** Hue in degrees, and saturation as a 0..1 fraction, from a `#rrggbb`. */
function hueSat(hex: string): { hue: number; sat: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { hue: h, sat: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) };
}

/** Shortest angular distance between two hues, in degrees. */
function hueGap(a: string, b: string): number {
  const d = Math.abs(hueSat(a).hue - hueSat(b).hue);
  return Math.min(d, 360 - d);
}

describe('SEMANTIC.ally holds apart from everything that shares a minimap', () => {
  /*
   * The playable accents, from the real palette. Gaia's is excluded on purpose:
   * it can never be the LOCAL accent, and neutral blips take `SEMANTIC.neutral`
   * rather than an accent anyway.
   */
  const ACCENTS = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim]
    .map((f) => accentFor(f));

  /** Everything saturated enough for hue to be the thing that separates it. */
  const RIVALS: ReadonlyArray<readonly [string, string]> = [
    ...ACCENTS.map((c, i) => [`accent ${i}`, c] as const),
    ...HOSTILE_COLORS.map((c, i) => [`hostile ${i}`, c] as const),
    ['ore', SEMANTIC.ore],
  ];

  it('the rival set is the real one, not a copy', () => {
    expect(ACCENTS.length, 'four playable accents').toBe(4);
    expect(new Set(ACCENTS).size, 'two factions share an accent — re-read this file').toBe(4);
    expect(HOSTILE_COLORS.length).toBeGreaterThanOrEqual(4);
  });

  it('is at least 40 degrees of hue from every one of them', () => {
    /*
     * 40 IS DERIVED, NOT ROUND. Sweeping 0..359 against this exact rival set,
     * the freest hue in the whole circle is 93 degrees, and its minimum
     * separation is 47 — so 40 leaves the shipped choice seven degrees of room
     * and still refuses anything materially worse than the best available.
     * A larger floor would be unsatisfiable by ANY colour.
     */
    const gaps = RIVALS.map(([name, c]) => [name, hueGap(SEMANTIC.ally, c)] as const);
    const tight = gaps.filter(([, g]) => g < 40);
    expect(tight.map(([n, g]) => `${n}: ${g.toFixed(1)} deg`),
      'SEMANTIC.ally has been retuned into a colour that shares a minimap with it. '
      + 'The freest hue against this rival set is 93 degrees (47 deg clear); pick near there.')
      .toEqual([]);
    // And the falsifier: the measure CAN report a small gap.
    expect(hueGap(SEMANTIC.ally, SEMANTIC.ally)).toBe(0);
    expect(Math.min(...gaps.map(([, g]) => g))).toBeLessThan(90);
  });

  it('is saturated enough to be a colour rather than a grey', () => {
    // A desaturated ally would collide with `SEMANTIC.neutral` regardless of
    // hue, and the hue test above cannot see that.
    expect(hueSat(SEMANTIC.ally).sat).toBeGreaterThan(0.5);
    expect(hueSat(SEMANTIC.neutral).sat).toBeLessThan(0.3);
  });
});

/* ==========================================================================
 * 3. THE MAP ACTUALLY PAINTS IT
 * ========================================================================== */

class FakeGradient { addColorStop(): void {} }

class FakeCtx {
  fillStyle = '';
  strokeStyle = '';
  globalAlpha = 1;
  lineWidth = 1;
  /**
   * Every `stroke()`, in order, with the style that was live when it ran.
   *
   * THE ONLY STROKING PAINTER IN A REDRAW WITH NO VIEWPORT RECT IS `drawPings`
   * — `screenToGround` never succeeds against `NO_CAMERA`, so `vpInit` stays
   * false and `drawViewport` returns at its first line. Everything else fills or
   * blits. `tests/minimap-pings.spec.ts` establishes this and it is why a ping
   * is a usable probe for `styleOf`, which is private.
   */
  readonly strokes: string[] = [];
  imageSmoothingEnabled = true;
  font = '';
  textAlign = '';
  textBaseline = '';
  globalCompositeOperation = '';
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  rect(): void {}
  fill(): void {}
  stroke(): void { this.strokes.push(this.strokeStyle); }
  clip(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  clearRect(): void {}
  fillText(): void {}
  drawImage(): void {}
  translate(): void {}
  scale(): void {}
  setTransform(): void {}
  createLinearGradient(): FakeGradient { return new FakeGradient(); }
  createRadialGradient(): FakeGradient { return new FakeGradient(); }
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  getImageData(): { data: Uint8ClampedArray } { return { data: new Uint8ClampedArray(4) }; }
  putImageData(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  private readonly context = new FakeCtx();
  getContext(kind: string): FakeCtx | null { return kind === '2d' ? this.context : null; }
  get fake(): FakeCtx { return this.context; }
  addEventListener(): void {}
  removeEventListener(): void {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  setPointerCapture(): void {}
  hasPointerCapture(): boolean { return false; }
  releasePointerCapture(): void {}
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string): FakeCanvas => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return new FakeCanvas();
    },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

const NO_CAMERA = { screenToGround: (): boolean => false } as unknown as CameraRig;

/**
 * Seat 0 local (Allies) plus `armies - 1` opponents plus Gaia, exactly as
 * `Shell.seatOpponents` builds the table — `restyle` counts hostiles in PLAYER
 * ORDER, so a differently ordered table assigns different colours than the
 * product does.
 *
 * `allyWith` seats are made mutually allied with seat 0 by hand, because
 * `World` has no team verb — `addPlayer` writes an `allyMask` of just itself
 * and the shell ORs the bits in afterwards.
 */
interface Rig {
  readonly map: Minimap;
  /** Ping each of `owners` in turn, redraw, and hand back the ring colours. */
  ringsFor(owners: readonly number[]): string[];
}

function rig(armies: number, allyWith: readonly number[] = []): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  for (let i = 1; i < armies; i++) {
    world.addPlayer(Faction.Soviets, `Opponent AI ${i}`, false, false);
  }
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);

  for (const seat of allyWith) {
    world.players[0].allyMask |= 1 << seat;
    world.players[seat].allyMask |= 1 << 0;
  }

  const canvas = new FakeCanvas();
  const opts: MinimapOptions = {
    world,
    cameraRig: NO_CAMERA,
    faction: Faction.Allies,
    playfield: () => ({ x: 0, y: 0, w: 800, h: 600 }),
  };
  const map = new Minimap(canvas as unknown as HTMLCanvasElement, opts);
  map.resize(MAP_CELLS, MAP_CELLS, 1);

  let clock = 0;
  return {
    map,
    ringsFor(owners: readonly number[]): string[] {
      canvas.fake.strokes.length = 0;
      for (let i = 0; i < owners.length; i++) {
        map.ping(60 + i * 40, 60 + i * 40, owners[i] as PlayerId);
      }
      // One 60 Hz step: past the redraw gate (a live ping raises the rate) and
      // far short of `pingSeconds`, so nothing expires between arm and photo.
      clock += 1 / 60;
      map.frame(clock, 1 / 60);
      return [...canvas.fake.strokes];
    },
  };
}

describe("Minimap tells your army from your ally's", () => {
  it('a duel reaches neither the ally branch nor the ally colour', () => {
    // THE SAFETY CLAIM, ASSERTED. Every `?shot=` fixture and every 1v1 rests on
    // this, and it is the assertion that fails if somebody widens the branch.
    const r = rig(2);
    const map = r.map;
    expect(map.alliedArmies(), 'a duel has no ally to name').toEqual([]);
    expect(map.hostileArmies().map((a) => a.color), 'the duel red is untouched')
      .toEqual([HOSTILE_COLORS[0]]);
    map.dispose();
  });

  it('a 2v2 gives you, your ally and both opponents four different colours', () => {
    // Seats: 0 you, 1 ally, 2 and 3 hostile.
    const r = rig(4, [1]);
    const map = r.map;

    const allies = map.alliedArmies();
    expect(allies.map((a) => a.label), 'exactly the team-mate').toEqual(['Opponent AI 1']);
    expect(allies[0].color, "the ally is NOT painted in the local player's accent")
      .toBe(SEMANTIC.ally);
    expect(allies[0].color, 'and the regression this file exists for')
      .not.toBe(accentFor(Faction.Allies));

    const hostiles = map.hostileArmies();
    expect(hostiles.map((h) => h.label)).toEqual(['Opponent AI 2', 'Opponent AI 3']);

    // FOUR DISTINCT MARKS, which is the player-facing requirement in one line.
    const all = [accentFor(Faction.Allies), ...allies.map((a) => a.color),
      ...hostiles.map((h) => h.color)];
    expect(new Set(all).size, `${all.join(', ')} — two of these are the same colour`).toBe(4);
    map.dispose();
  });

  it('the hostile colours are unchanged by an ally being present', () => {
    /*
     * `restyle` counts hostiles with a running index, so an ally sitting at seat
     * 1 must NOT consume a hostile slot — otherwise seats 2 and 3 would take
     * `hostileColor(1)` and `(2)` in a team game and `(0)` and `(1)` in a
     * free-for-all, and the legend of a 2v2 would disagree with every other
     * match. That is a real hazard of the branch this file added.
     */
    const ffa = rig(4).map;
    const team = rig(4, [1]).map;
    expect(team.hostileArmies().map((h) => h.color))
      .toEqual([HOSTILE_COLORS[0], HOSTILE_COLORS[1]]);
    expect(ffa.hostileArmies().map((h) => h.color))
      .toEqual([HOSTILE_COLORS[0], HOSTILE_COLORS[1], HOSTILE_COLORS[2]]);
    ffa.dispose();
    team.dispose();
  });

  it('Gaia is grey in a team game, not the ally colour', () => {
    // NEUTRALITY STILL BEATS ALLIED-NESS, and it has to be checked HERE because
    // the new branch sits between the two tests that used to be adjacent. Gaia
    // is allied to everyone in both directions on purpose.
    const r = rig(4, [1]);
    const map = r.map;
    expect(map.alliedArmies().some((a) => a.label === 'Gaia'),
      'Gaia is allied to everyone and must still not be named as an ally').toBe(false);
    expect(map.hostileArmies().some((h) => h.label === 'Gaia')).toBe(false);
    map.dispose();
  });

  it('paints YOU in your accent, your ally in the ally colour, and them in theirs', () => {
    /*
     * THE ASSERTION THE LEGEND METHODS CANNOT MAKE, and it is not redundant:
     * `alliedArmies` filters the local player out by hand, so a `restyle` that
     * dropped its `p.id === local` branch entirely — handing YOUR OWN blips the
     * ally colour — passes every other test in this file. That mutation was
     * tried and it did. This is the one that catches it.
     *
     * A ping's ring is drawn through the same `styleOf` lookup the blips use,
     * and it is the only publicly reachable probe of a private table.
     */
    const r = rig(4, [1]);
    const rings = r.ringsFor([0, 1, 2, 3]);
    expect(rings, 'four pings, four rings — the probe is not seeing them').toHaveLength(4);
    expect(rings[0], 'yours is your accent').toBe(accentFor(Faction.Allies));
    expect(rings[1], 'your ally is the ally colour').toBe(SEMANTIC.ally);
    expect(rings[2]).toBe(HOSTILE_COLORS[0]);
    expect(rings[3]).toBe(HOSTILE_COLORS[1]);
    expect(new Set(rings).size, 'all four read differently').toBe(4);
    r.map.dispose();
  });

  it('you are never listed as your own ally', () => {
    // `areAllied(local, local)` is TRUE, which is exactly why the `p.id ===
    // local` test has to come FIRST inside `restyle`.
    const r = rig(3, [1]);
    const map = r.map;
    expect(map.alliedArmies().map((a) => a.label)).not.toContain('Commander');
    expect(map.alliedArmies()).toHaveLength(1);
    map.dispose();
  });
});
