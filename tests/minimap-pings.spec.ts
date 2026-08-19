/**
 * ============================================================================
 * tests/minimap-pings.spec.ts — THE ALERT RING KNOWS WHICH ARMY IT IS ABOUT
 * ============================================================================
 * `Minimap.drawBlips` and `Minimap.drawTerritory` have coloured by SEAT since
 * the four-army lobby landed — `restyle` builds one colour per player and both
 * loops read it. `drawPings` did not. It took a `hostile: boolean` and painted
 * `this.accent` for a hit on you and ONE red for a hit on anybody else, so in a
 * free-for-all the ring was the only mark on the tactical map that could not
 * answer "who is being hit". Three armies brawling in a corner drew the same
 * red circle whoever was losing it.
 *
 * WHY THIS FILE DRIVES THE REAL CLASS RATHER THAN SCANNING THE SOURCE
 * ------------------------------------------------------------------
 * The defect was a colour CHOICE, and a source scan can only assert that some
 * identifier appears. So the map is constructed for real against a real
 * `World`, with `document` and the 2D context stubbed the way
 * `tests/cameo-readback.spec.ts` stubs them — `Minimap` touches the DOM inside
 * its constructor and its painters, never at import.
 *
 * `stroke()` IS THE PROBE AND IT IS UNAMBIGUOUS. In a redraw with no viewport
 * rectangle (`screenToGround` never succeeds here, so `vpInit` stays false and
 * `drawViewport` returns at its first line) the ONLY stroking painter in the
 * class is `drawPings`. Every other layer fills or blits. So one `stroke` per
 * live ping, in ping order, with the colour that was on the context when it
 * ran.
 *
 * THE ASSERTION IS AGAINST `hostileArmies()`, NOT AGAINST A COLOUR LITERAL. The
 * legend is the published form of the same `restyle` lookup the blips read, and
 * it is what the sidebar draws. Pinning the ring to `hostileColor(1)` would
 * pass just as well if the blips moved somewhere else; pinning it to the legend
 * is the actual requirement — the ring agrees with the dots underneath it.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HUD_RADAR, MAP_CELLS } from '../src/core/config';
import { Faction } from '../src/core/types';
import type { PlayerId } from '../src/core/types';
import { World } from '../src/core/world';
import { SEMANTIC, accentFor, hostileColor } from '../src/ui/Chrome';
import { Minimap } from '../src/ui/Minimap';
import type { MinimapOptions } from '../src/ui/Minimap';
import type { CameraRig } from '../src/render/camera';

/* -------------------------------------------------------------------------- */
/* A 2D context reduced to what one redraw of the tactical map touches        */
/* -------------------------------------------------------------------------- */

interface StrokeRecord {
  readonly style: string;
  readonly radius: number;
  readonly alpha: number;
}

class FakeGradient {
  addColorStop(): void { /* the glow sprite only */ }
}

class FakeCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;

  /** Every `stroke()`, with the state that was live when it happened. */
  readonly strokes: StrokeRecord[] = [];
  /** Radius of the last `arc`, so a stroke can be tied to the ring it drew. */
  private lastArcRadius = 0;

  fillRect(): void {}
  strokeRect(): void {}
  clearRect(): void {}
  drawImage(): void {}
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(_x: number, _y: number, r: number): void { this.lastArcRadius = r; }
  stroke(): void {
    this.strokes.push({
      style: this.strokeStyle,
      radius: this.lastArcRadius,
      alpha: this.globalAlpha,
    });
  }
  fill(): void {}
  createRadialGradient(): FakeGradient { return new FakeGradient(); }
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  private readonly context = new FakeCtx();
  private readonly handlers = new Map<string, number>();

  getContext(kind: string): FakeCtx | null { return kind === '2d' ? this.context : null; }
  addEventListener(type: string): void { this.handlers.set(type, (this.handlers.get(type) ?? 0) + 1); }
  removeEventListener(type: string): void { this.handlers.set(type, (this.handlers.get(type) ?? 0) - 1); }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  setPointerCapture(): void {}
  hasPointerCapture(): boolean { return false; }
  releasePointerCapture(): void {}

  get fake(): FakeCtx { return this.context; }
}

/* -------------------------------------------------------------------------- */

beforeEach(() => {
  // The bake canvas and the glow sprite are made inside the constructor. They
  // are never read back here; the probe is the MAIN canvas's context.
  vi.stubGlobal('document', {
    createElement: (tag: string): FakeCanvas => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return new FakeCanvas();
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A camera that never resolves a ground point, so no viewport rect is drawn. */
const NO_CAMERA = { screenToGround: (): boolean => false } as unknown as CameraRig;

interface Rig {
  readonly map: Minimap;
  readonly world: World;
  /** Redraw once and hand back the strokes that redraw produced. */
  redraw(): readonly StrokeRecord[];
}

/**
 * `armies` seats plus Gaia, seat 0 local. The seat table is deliberately built
 * the way `Shell.seatOpponents` builds it — one local human then N opponents —
 * because `restyle` counts hostiles in PLAYER ORDER and a table in a different
 * order would assign different colours than the product does.
 */
function rig(armies: number): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  for (let i = 1; i < armies; i++) {
    world.addPlayer(Faction.Soviets, `Opponent AI ${i}`, false, false);
  }
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);

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
    world,
    redraw(): readonly StrokeRecord[] {
      canvas.fake.strokes.length = 0;
      // One 60 Hz step. Long enough to pass the redraw gate (a live ping raises
      // the rate to 60 Hz) and far short of `pingSeconds`, so nothing expires
      // between arming a ping and photographing it.
      clock += 1 / 60;
      map.frame(clock, 1 / 60);
      return canvas.fake.strokes;
    },
  };
}

/* ========================================================================== */

describe('Minimap — the alert ring is coloured by seat, like everything else', () => {
  it('is the only stroking painter, so the probe means what it says', () => {
    const r = rig(4);
    expect(r.redraw()).toHaveLength(0);
    r.map.ping(100, 100, 1 as PlayerId);
    expect(r.redraw()).toHaveLength(1);
    r.map.dispose();
  });

  it('gives three opponents three different rings', () => {
    const r = rig(4);
    // One hit on each hostile base, in seat order.
    r.map.ping(60, 60, 1 as PlayerId);
    r.map.ping(180, 60, 2 as PlayerId);
    r.map.ping(60, 180, 3 as PlayerId);

    const strokes = r.redraw();
    expect(strokes).toHaveLength(3);
    const colours = strokes.map((s) => s.style);
    expect(new Set(colours).size).toBe(3);

    // AGAINST THE LEGEND, not against a literal: `hostileArmies` is the published
    // form of the same `restyle` table the blips read, so this fails if the
    // ring and the dot ever stop agreeing, whichever of the two moved.
    expect(colours).toEqual(r.map.hostileArmies().map((a) => a.color));
    r.map.dispose();
  });

  it('paints a hit on YOU in your own accent, and a duel in the old red', () => {
    const r = rig(2);
    r.map.ping(40, 40, 0 as PlayerId);
    r.map.ping(200, 200, 1 as PlayerId);

    const strokes = r.redraw();
    expect(strokes.map((s) => s.style)).toEqual([
      accentFor(Faction.Allies),
      // THE DUEL IS UNTOUCHED. The only hostile in a 1v1 is index 0, which is
      // `SEMANTIC.danger` — the exact red the binary version drew, so no
      // existing 1v1 capture or screenshot moves.
      SEMANTIC.danger,
    ]);
    expect(hostileColor(0)).toBe(SEMANTIC.danger);
    r.map.dispose();
  });

  it('follows the ally mask, because the colour is resolved at draw time', () => {
    const r = rig(3);
    r.map.ping(120, 120, 2 as PlayerId);
    expect(r.redraw()[0].style).toBe(hostileColor(1));

    // Seat 2 changes sides mid-ring. The stored ping is an id, not a colour, so
    // the ring re-resolves and lands on the ALLY colour with the blips.
    // The mask is written the way `ScenarioBuilder.gaia` writes it — there is no
    // setter, alliances are bits.
    //
    // **THIS LINE EXPECTED `accentFor(Faction.Allies)` UNTIL `SEMANTIC.ally`
    // EXISTED**, which is exactly the defect that colour was added for: a
    // newly-allied army was painted in the LOCAL PLAYER'S OWN accent, so a 2v2
    // could not tell your tanks from your team-mate's. What this test is
    // actually about — the ring re-resolves through `restyle` rather than
    // freezing a colour at ping time — is unchanged, and the falsifier above it
    // (the same ring reading `hostileColor(1)` one redraw earlier) still is too.
    r.world.player(0 as PlayerId).allyMask |= 1 << 2;
    r.world.player(2 as PlayerId).allyMask |= 1 << 0;
    expect(r.redraw()[0].style).toBe(SEMANTIC.ally);
    expect(r.redraw()[0].style, 'and it is NOT the local accent any more')
      .not.toBe(accentFor(Faction.Allies));
    r.map.dispose();
  });

  it('fades and expires exactly as it always did', () => {
    const r = rig(2);
    r.map.ping(90, 90, 1 as PlayerId);
    const first = r.redraw()[0];
    expect(first.alpha).toBeLessThan(1);
    expect(first.alpha).toBeGreaterThan(0.9);

    // Past `pingSeconds` the ring is dropped rather than drawn at zero alpha.
    r.map.frame(1000, HUD_RADAR.pingSeconds + 1);
    expect(r.redraw()).toHaveLength(0);
    r.map.dispose();
  });
});
