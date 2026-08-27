/**
 * ============================================================================
 * src/ui/Minimap.ts — THE TACTICAL MAP
 * ============================================================================
 * A square glass panel in the bottom-left corner. The world is square, the
 * panel is square, and the map fills it — the old letterboxed 142x110 field
 * belonged to a 168 px vertical rail that no longer exists.
 *
 * WHAT IS DRAWN, IN ORDER
 *   1. terrain, one pixel per world cell, downsampled            (baked)
 *   2. ore, blended into the same bake                           (baked)
 *   3. shroud: black over unexplored, a heavy multiply over explored-not-seen
 *   4. blips — faction-accent for yours, one colour per hostile ARMY, grey for
 *      neutral
 *   5. attack pings, a short expanding ring, in the attacked ARMY's colour
 *   6. the camera viewport rectangle: 1 px, unfilled, accent
 *
 * COST MODEL
 * ----------
 * The terrain layer is baked into a 128x128 offscreen canvas and only re-baked
 * when terrain, ore or biome changes (and at most every `REBAKE_SECONDS` while
 * ore is being mined). The live layer redraws at `MINIMAP_HZ`, never per frame.
 * At 20 Hz with 200 entities that is ~4000 canvas ops a second, which does not
 * appear in a profile.
 *
 * The viewport rect is derived by unprojecting the four playfield corners onto
 * the ground plane and then EASED toward that target: the camera's own
 * smoothing sampled at 20 Hz visibly stutters otherwise.
 *
 * COLOUR
 * ------
 * The accent comes from the faction table via `accentFor`, so the third faction
 * gets a correct map with no edit here. Grey for neutral is semantic and never
 * swaps.
 *
 * HOSTILES ARE COLOURED BY SEAT, NOT BY FACTION, and index 0 is still the same
 * red it always was. This line used to say red was the one hostile colour and
 * never swapped — right for a duel, and unreadable the moment there are three
 * opponents, because "whose tanks are those" has no answer. `Chrome.hostileColor`
 * owns the table and explains why the colours are not the faction accents (two
 * armies may pick the same side, so an accent is not a unique key for an army).
 * `restyle` builds the per-player lookup once per redraw; the blip loops read
 * it, AND SO DOES `drawPings` — an alert ring that stayed binary hostile/own
 * while the blips underneath it went per-seat was the one mark on this map that
 * could not say which army was being hit.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  HUD_MINIMAP_SHROUD,
  HUD_MINIMAP_SURFACE,
  HUD_MINIMAP_WATER,
  HUD_RADAR,
  MAP_CELLS,
  MAP_SIZE,
  MINIMAP_HZ,
} from '../core/config';
import { EntityFlag, EntityKind, Faction, VisionLevel, type PlayerId } from '../core/types';
import type { World } from '../core/world';
import type { CameraRig } from '../render/camera';
import { SEMANTIC, accentFor, hexToRgb, hostileColor, mixHex, rgba } from './Chrome';
import type { ArmyLegendEntry } from './Sidebar';

/** Seconds between forced terrain re-bakes while ore is live. */
const REBAKE_SECONDS = 2.0;
/** Exponential ease constant for the viewport rect, per second. */
const RECT_EASE = 14;
/** Hostile blips. Semantic, never faction-swapped. */
const BLIP_ENEMY = SEMANTIC.danger;
/**
 * Gaia / unowned blips.
 *
 * THIS WAS UNREACHABLE FOR EVERY BUILDING ON THE MAP until the civilian block
 * landed, and the reason is worth keeping: both blip passes chose their style
 * with `mine = ownerId === local || areAllied(local, ownerId)` and **Gaia is
 * allied to everyone in both directions** (`ScenarioBuilder.gaia` wires the
 * masks that way on purpose, so no targeting scan ever considers a tree an
 * enemy). So a neutral structure was already drawn in the local player's own
 * accent, and capturing one changed nothing on the map. `BLIP_NEUTRAL` existed,
 * was documented as "Gaia / unowned", and never once appeared.
 *
 * Both passes now let NEUTRALITY WIN OVER ALLIED-NESS for both questions that
 * matter: a neutral landmark uses the neutral colour, and Gaia's diplomatic
 * alliance does not bypass fog. The shared `Vision.visibilityOf` rule decides
 * when it has been scouted; after capture it follows the new owner's ordinary
 * army visibility and accent. That is the only ownership tell a captured
 * civilian structure has, since structure team slabs are baked per-faction
 * into the greeble atlas and do not repaint (see `src/art/BuildingDefs.ts` §4b).
 */
const BLIP_NEUTRAL = SEMANTIC.neutral;
/**
 * An ALLIED army's blips.
 *
 * `restyle` gave every seat `areAllied` answered true for the LOCAL ACCENT, so
 * in a 2v2 a player could not tell their own tanks from their team-mate's —
 * reported as exactly that. The rule is now three-valued rather than two:
 * NEUTRALITY still wins over allied-ness (see `BLIP_NEUTRAL` above), then
 * YOURS wins over allied, and only then is a seat an ally.
 *
 * A DUEL IS UNTOUCHED, and that is what makes this safe to land: with no ally
 * seated, no blip reaches this colour and no `?shot=` fixture moves.
 */
const BLIP_ALLY = SEMANTIC.ally;
/** The dark plate every blip is drawn on, so none of them relies on terrain. */
const BLIP_PLATE = 'rgba(3,6,10,0.78)';

/**
 * Per-cell terrain sampler. Injected so the HUD does not hard-depend on the
 * terrain module: without it the map paints a flat field and everything else
 * (blips, viewport, pings, input) still works.
 */
export interface TerrainSampler {
  /** SurfaceId 0..5 for a cell. */
  surface(cx: number, cz: number): number;
  /** True if the cell is water. */
  water(cx: number, cz: number): boolean;
  /** 0..1 relative height, used for a subtle relief shade. */
  height01(cx: number, cz: number): number;
}

export interface MinimapOptions {
  world: World;
  cameraRig: CameraRig;
  faction: Faction;
  /** Playfield rect in client px — the world view, NOT the window. */
  playfield: () => { x: number; y: number; w: number; h: number };
}

/**
 * One attack alert. `owner` is WHOSE THING IS BEING HIT, which is the same key
 * the blips are coloured by — see `drawPings`.
 */
interface Ping {
  x: number;
  z: number;
  age: number;
  owner: PlayerId;
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly cameraRig: CameraRig;
  private readonly playfield: MinimapOptions['playfield'];

  /** 128 x 128 terrain bake — one pixel per world cell. */
  private readonly bake: HTMLCanvasElement;
  private readonly bakeCtx: CanvasRenderingContext2D;
  private readonly bakeImage: ImageData;

  /** White radial sprite for the territory glow, plus its per-colour tints. */
  private readonly glow: HTMLCanvasElement;
  private readonly glowTints = new Map<string, HTMLCanvasElement>();

  private terrain: TerrainSampler | null = null;
  private faction: Faction;
  private accent: string;

  /**
   * Blip colour per `PlayerId`, rebuilt once per redraw.
   *
   * A LOOKUP AND NOT A BRANCH, because the alternative is asking "which hostile
   * is this, counting from the left" inside the blip loop, which is O(players)
   * per entity per redraw. This is O(players) per REDRAW — at most eight
   * iterations twenty times a second — and the loop below then costs one array
   * read, which is what it cost when the answer was a two-way branch.
   *
   * Length grows with the table; `MAX_PLAYERS` is 8 and a skirmish seats at
   * most five (four armies plus Gaia).
   */
  private readonly blipStyle: string[] = [];

  private bakeDirty = true;
  private lastBake = -1e9;
  private lastDraw = -1e9;

  /** Device-pixel size of the field. Square by layout, but never assumed. */
  private fieldW = 1;
  private fieldH = 1;
  /** The map rect inside the field, device px. */
  private mapX = 0;
  private mapY = 0;
  private mapW = 1;
  private mapH = 1;

  /** Eased viewport rect in world metres. */
  private vpMinX = 0;
  private vpMinZ = 0;
  private vpMaxX = MAP_SIZE;
  private vpMaxZ = MAP_SIZE;
  private vpInit = false;

  private readonly pings: Ping[] = [];

  private dragging = false;
  private dragPointer = -1;
  private onJump: ((x: number, z: number) => void) | null = null;
  /** Presentation-only team marker. Never enters the command bus or replay. */
  private pingRequestHandler: ((x: number, z: number) => void) | null = null;
  private orderRequestHandler: ((x: number, z: number) => boolean) | null = null;
  private readonly listeners: Array<[string, EventListener]> = [];

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: MinimapOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('[hud] 2D context unavailable for the tactical map');
    this.ctx = ctx;

    this.world = opts.world;
    this.cameraRig = opts.cameraRig;
    this.playfield = opts.playfield;
    this.faction = opts.faction;
    this.accent = accentFor(opts.faction);

    this.bake = document.createElement('canvas');
    this.bake.width = MAP_CELLS;
    this.bake.height = MAP_CELLS;
    const bctx = this.bake.getContext('2d', { alpha: false });
    if (bctx === null) throw new Error('[hud] 2D context unavailable for the map bake');
    this.bakeCtx = bctx;
    this.bakeImage = bctx.createImageData(MAP_CELLS, MAP_CELLS);

    this.glow = Minimap.buildGlowSprite();

    this.attachInput();
  }

  /* ------------------------------------------------------------------ *
   * THE TERRITORY GLOW
   *
   * docs/TARGET_LOOK.md §A.2: "territory as soft colour glows". One white
   * radial sprite is painted at construction and then tinted once per colour
   * into a tiny cache — three entries in practice, because there are three
   * blip colours. Drawing is `drawImage`, so the per-frame path allocates
   * nothing, which a `createRadialGradient` per building per redraw very much
   * would.
   * ------------------------------------------------------------------ */

  private static buildGlowSprite(): HTMLCanvasElement {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (g === null) return c;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Falls off fast. A linear ramp reads as a disc with a soft edge; this
    // reads as a light, which is what the reference has.
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /** The glow sprite in `colour`. Built once per colour, then reused. */
  private tintedGlow(colour: string): HTMLCanvasElement {
    const hit = this.glowTints.get(colour);
    if (hit !== undefined) return hit;
    const c = document.createElement('canvas');
    c.width = this.glow.width;
    c.height = this.glow.height;
    const g = c.getContext('2d');
    if (g !== null) {
      g.drawImage(this.glow, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = colour;
      g.fillRect(0, 0, c.width, c.height);
    }
    this.glowTints.set(colour, c);
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* configuration                                                       */
  /* ------------------------------------------------------------------ */

  setFaction(f: Faction): void {
    this.faction = f;
    this.accent = accentFor(f);
    // The coastline in the bake is drawn in the accent, so a faction swap has
    // to re-bake and not merely redraw.
    this.bakeDirty = true;
    this.lastDraw = -1e9;
  }

  setTerrain(sampler: TerrainSampler | null): void {
    this.terrain = sampler;
    this.bakeDirty = true;
  }

  /** Call after a footprint stamp, a biome change or an ore field edit. */
  invalidateTerrain(): void {
    this.bakeDirty = true;
  }

  /**
   * Fired by the HUD on `combat:underAttack`. `owner` is `EvUnderAttack.player`
   * — the VICTIM, which is the army whose colour the ring takes.
   *
   * The id is stored and resolved at DRAW time rather than resolved here,
   * because `restyle` runs once per redraw and an ally mask can change while a
   * ring is still on screen. A ping never disagrees with the blip underneath it.
   */
  ping(x: number, z: number, owner: PlayerId): void {
    if (this.pings.length >= HUD_RADAR.pingPool) this.pings.shift();
    this.pings.push({ x, z, age: 0, owner });
  }

  onJumpRequest(fn: (x: number, z: number) => void): void {
    this.onJump = fn;
  }

  /** Right-click callback installed only for a live multiplayer team match. */
  onPingRequest(fn: ((x: number, z: number) => void) | null): void {
    this.pingRequestHandler = fn;
    this.canvas.classList.toggle('can-ally-ping', fn !== null);
    this.canvas.title = fn === null
      ? 'Left-click to move camera'
      : 'Left-click to move camera · Right-click to ping allies';
  }

  /** Route a right-click through the battlefield contextual-order rules. */
  onOrderRequest(fn: ((x: number, z: number) => boolean) | null): void {
    this.orderRequestHandler = fn;
  }

  /** Resize the backing store to device pixels. Cheap; call on every resize. */
  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.fieldW = w;
    this.fieldH = h;

    // The panel is square by CSS, so the square world fills it. If a layout
    // ever hands us a non-square field the map stays square and centres rather
    // than stretching — a stretched map lies about distances.
    const side = Math.min(w, h);
    this.mapW = side;
    this.mapH = side;
    this.mapX = Math.round((w - side) * 0.5);
    this.mapY = Math.round((h - side) * 0.5);
    this.lastDraw = -1e9;
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  frame(time: number, dt: number): void {
    if (this.disposed) return;

    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].age += dt;
      if (this.pings[i].age > HUD_RADAR.pingSeconds) this.pings.splice(i, 1);
    }

    this.easeViewport(dt);

    // Redraw at MINIMAP_HZ, not every frame. A live ping forces the rate up so
    // its short ring animates smoothly instead of in three steps.
    const period = this.pings.length > 0 ? 1 / 60 : 1 / MINIMAP_HZ;
    if (time - this.lastDraw < period) return;
    this.lastDraw = time;

    if (this.bakeDirty || time - this.lastBake > REBAKE_SECONDS) {
      this.bakeTerrain();
      this.bakeDirty = false;
      this.lastBake = time;
    }

    this.draw();
  }

  /* ------------------------------------------------------------------ */
  /* terrain bake                                                        */
  /* ------------------------------------------------------------------ */

  private bakeTerrain(): void {
    const data = this.bakeImage.data;
    const t = this.terrain;
    const ore = this.world.ore;

    // Pre-resolve the palette once per bake; `parseInt` per cell would be 16k
    // string parses at 0.5 Hz for nothing. The surfaces are darkened toward the
    // panel glass so the map reads as part of the chrome rather than a
    // brightly-lit sticker on top of it.
    const surf: Array<[number, number, number]> = [];
    for (const hex of HUD_MINIMAP_SURFACE) surf.push(hexToRgb(mixHex(hex, '#0A0E14', 0.28)));
    // WATER IS PUSHED WAY DOWN, and that is the point.
    //
    // docs/TARGET_LOOK.md §A.2: the reference draws the map as its ACTUAL
    // IRREGULAR SHAPE rather than as a rectangle. Our maps are a square grid,
    // so the only honest silhouette available is the LAND — and at 0.2 toward
    // the panel dark the water was bright enough to be figure rather than
    // ground, which made every map read as a rectangle whatever its coastline
    // did. At 0.66 the land is the shape and the water is the surround.
    const water = hexToRgb(mixHex(HUD_MINIMAP_WATER, '#0A0E14', 0.66));
    const oreRgb = hexToRgb(mixHex(SEMANTIC.ore, '#FFFFFF', 0.22));
    // The coastline: the accent, laid on the land side of the boundary, so the
    // silhouette is a LIT edge rather than a change of fill. Same idea as the
    // panel bevel, four hundred times smaller.
    const coast = hexToRgb(mixHex(this.accent, '#FFFFFF', 0.15));

    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = (cz * MAP_CELLS + cx) * 4;

        let r: number;
        let g: number;
        let b: number;

        if (t === null) {
          [r, g, b] = surf[0];
        } else if (t.water(cx, cz)) {
          [r, g, b] = water;
        } else {
          const id = t.surface(cx, cz);
          [r, g, b] = surf[id >= 0 && id < surf.length ? id : 0];
          // A gentle relief shade so cliffs and ramps read at 1 px per cell.
          // Deliberately shallow: this is a map, not a render.
          const shade = 0.82 + 0.3 * t.height01(cx, cz);
          r *= shade;
          g *= shade;
          b *= shade;

          // Four-neighbour test, clamped at the border so the frame edge is
          // never mistaken for a shore.
          const shore =
            (cx > 0 && t.water(cx - 1, cz)) ||
            (cx < MAP_CELLS - 1 && t.water(cx + 1, cz)) ||
            (cz > 0 && t.water(cx, cz - 1)) ||
            (cz < MAP_CELLS - 1 && t.water(cx, cz + 1));
          if (shore) {
            r += (coast[0] - r) * 0.55;
            g += (coast[1] - g) * 0.55;
            b += (coast[2] - b) * 0.55;
          }
        }

        // Ore is the one thing on this map allowed to be bright, and it was
        // not bright enough: at 0.85 of a 400-unit ramp a half-mined field
        // blended into the dirt surface it sits on, so the economy — the single
        // most important thing a tactical map has to show — was invisible on
        // THIS PANEL until it was untouched. The ramp now saturates at 200 and
        // lands on a lifted gold, which makes an ore field read as a shape at
        // 1 px per cell.
        //
        // "Invisible" was once true of the whole product, not just this panel:
        // ore had no world-space representation at all, and the minimap was the
        // only place it was drawn. `src/world/ore.system.ts` ended that, so
        // this bake is now the tactical ABSTRACTION of something the player can
        // also see on the ground. It is not redundant — 1 px per cell is what
        // shows a field's SHAPE and where the next expansion is, which the
        // camera cannot at 32-72 m — but it is no longer load-bearing on its
        // own, and a change here should not be argued as the last line of
        // defence for finding ore.
        const oreAmount = ore.oreAt(cx, cz);
        if (oreAmount > 0) {
          const k = 0.45 + Math.min(1, oreAmount / 200) * 0.55;
          r += (oreRgb[0] - r) * k;
          g += (oreRgb[1] - g) * k;
          b += (oreRgb[2] - b) * k;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    this.bakeCtx.putImageData(this.bakeImage, 0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* live draw                                                           */
  /* ------------------------------------------------------------------ */

  private draw(): void {
    const ctx = this.ctx;

    // The field under the map is the panel's own darkness, not a grey wash.
    ctx.fillStyle = '#070A10';
    ctx.fillRect(0, 0, this.fieldW, this.fieldH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bake, 0, 0, MAP_CELLS, MAP_CELLS, this.mapX, this.mapY, this.mapW, this.mapH);

    this.restyle();
    this.drawShroud();
    this.drawTerritory();
    this.drawBlips();
    this.drawPings();
    this.drawViewport();
  }

  /**
   * One colour per player, for this redraw.
   *
   * THE ORDER OF THE FOUR TESTS IS THE WHOLE RULE:
   *
   *   1. NEUTRALITY BEATS EVERYTHING. Gaia is allied to everyone in both
   *      directions on purpose (`ScenarioBuilder.gaia`), so without this a
   *      civilian block would be painted in the player's own accent and
   *      capturing one would change nothing on the map. See `BLIP_NEUTRAL`.
   *   2. YOURS BEATS ALLIED, and `areAllied(local, local)` is TRUE, so this
   *      test has to sit ahead of the next one or it never fires.
   *   3. AN ALLY IS ITS OWN COLOUR. **RULE 2 USED TO READ "ALLIED-NESS BEATS
   *      SEAT — yours and a future ally's read as one force, because that is
   *      what they are to the player reading the map."** That argument is right
   *      about FRIEND-OR-FOE and wrong about the question a player actually
   *      asks a tactical map, and it shipped a 2v2 in which your tanks and your
   *      team-mate's were indistinguishable. Reported as exactly that.
   *   4. EVERYONE ELSE GETS THEIR SEAT'S COLOUR, counted in player order among
   *      the hostiles. In a duel that is one hostile at index 0, which is
   *      `SEMANTIC.danger` — the exact red this has always drawn.
   *
   * A DUEL CANNOT REACH RULE 3, which is why this change moves no `?shot=`
   * fixture and no 1v1 pixel.
   *
   * Note that the DEFEATED are not special-cased. A wiped army has no entities
   * to blip, so its colour simply stops appearing, which is the readable answer
   * without a second piece of state to keep in step.
   */
  private restyle(): void {
    const world = this.world;
    const local = world.localPlayer;
    const players = world.players;
    this.blipStyle.length = players.length;
    let hostiles = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.faction === Faction.Neutral) {
        this.blipStyle[i] = BLIP_NEUTRAL;
      } else if (p.id === local) {
        // YOURS, and this test has to come before the ally test rather than
        // after it: `areAllied` is true of the local player against itself.
        this.blipStyle[i] = this.accent;
      } else if (world.areAllied(local, p.id)) {
        this.blipStyle[i] = BLIP_ALLY;
      } else {
        this.blipStyle[i] = hostileColor(hostiles++);
      }
    }
  }

  /** The blip colour for an owner, with a defined fallback for a stale id. */
  private styleOf(owner: PlayerId): string {
    return this.blipStyle[owner as number] ?? BLIP_ENEMY;
  }

  /**
   * The opposing armies, in the seat order their blips are coloured by.
   *
   * PUBLISHED FROM HERE SO THE LEGEND CANNOT DISAGREE WITH THE MAP. The Sidebar
   * draws the key; it must not be allowed to work out the colours a second time,
   * because the rule ("neutral, then allied, then seat index") lives in
   * `restyle` and two copies of it would eventually be one copy and one bug.
   *
   * ALLOCATES, so it is not a frame-loop call — `Hud` refreshes it only when the
   * player table changes size, which is boot, a save restore, and nothing else.
   */
  hostileArmies(): ArmyLegendEntry[] {
    this.restyle();
    const world = this.world;
    const out: ArmyLegendEntry[] = [];
    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i];
      if (p.faction === Faction.Neutral) continue;
      if (world.areAllied(world.localPlayer, p.id)) continue;
      out.push({ color: this.blipStyle[i] ?? BLIP_ENEMY, label: p.name });
    }
    return out;
  }

  /**
   * The ALLIED armies, excluding the local player and excluding Gaia.
   *
   * A SEPARATE METHOD RATHER THAN A `kind` FIELD ON THE ONE ABOVE, because
   * `hostileArmies` has a second consumer — `tests/minimap-pings.spec.ts` reads
   * it as the published answer to "what colour is army N", and widening it to
   * include allies would silently change what that assertion compares. Two
   * methods with honest names beat one method with a discriminator that a
   * caller can forget to filter on.
   *
   * Both call `restyle` first, so both are keyed off the SAME per-redraw table
   * the blips are drawn from and neither can disagree with the map.
   *
   * ALLOCATES; see the note on `hostileArmies`. Same call site, same gate.
   */
  alliedArmies(): ArmyLegendEntry[] {
    this.restyle();
    const world = this.world;
    const local = world.localPlayer;
    const out: ArmyLegendEntry[] = [];
    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i];
      if (p.faction === Faction.Neutral) continue;
      if (p.id === local) continue;
      if (!world.areAllied(local, p.id)) continue;
      out.push({ color: this.blipStyle[i] ?? BLIP_ALLY, label: p.name });
    }
    return out;
  }

  /**
   * Territory, as soft colour glows under the blips.
   *
   * The reference's minimap does not show WHERE THINGS ARE so much as WHOSE
   * THE GROUND IS, and that is a genuinely different read: at a glance you see
   * three coloured regions, not eighty dots. One glow per completed structure,
   * additively composited, so a dense base blooms and a lone outpost does not.
   *
   * Under the same radar and shroud gate as the blips — a glow that leaked
   * through the fog would be a map hack with a soft edge. Drawn AFTER the
   * shroud for exactly that reason: the shroud must not be able to darken a
   * glow the player has earned, and the gate here is what keeps one they have
   * not off the map entirely.
   */
  private drawTerritory(): void {
    const ctx = this.ctx;
    const store = this.world.store;
    const local = this.world.localPlayer;
    const scale = this.mapW / MAP_SIZE;
    const hasRadar = this.world.vision.hasRadar(local);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34;

    const list = store.byKind[EntityKind.Building];
    const count = store.byKindCount[EntityKind.Building];
    for (let i = 0; i < count; i++) {
      const e = list[i];
      const flags = store.flags[e];
      if ((flags & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;

      const ownerId = store.owner[e] as PlayerId;
      const mine = ownerId === local
        || (store.faction[e] !== Faction.Neutral && this.world.areAllied(local, ownerId));
      if (!mine) {
        if (!hasRadar) continue;
        if (this.world.vision.visibilityOf(local, store.handleOf(e)) < VisionLevel.Remembered) continue;
      }

      // `mine` is left alone above because it is the VISIBILITY gate; the
      // COLOUR is the seat's, from `restyle`.
      const style = this.styleOf(ownerId);

      // Sized off the footprint so a Construction Yard owns more ground than a
      // silo, with a floor so the smallest structure still reads.
      const radius = Math.max(6, store.footprintW[e] * scale * 3.4);
      const px = this.mapX + store.posX[e] * scale;
      const py = this.mapY + store.posZ[e] * scale;
      ctx.drawImage(this.tintedGlow(style), px - radius, py - radius, radius * 2, radius * 2);
    }

    ctx.restore();
  }

  /** Black over unexplored; a heavy multiply over explored-not-visible. */
  private drawShroud(): void {
    const grid = this.world.vision.gridFor(this.world.localPlayer);
    if (grid.length !== MAP_CELLS * MAP_CELLS) return;

    const ctx = this.ctx;
    const px = this.mapW / MAP_CELLS;

    // Two passes so each fillStyle is set once instead of 16k times, and runs
    // are coalesced so a fully-shrouded row is one rect rather than 128.
    ctx.fillStyle = HUD_MINIMAP_SHROUD;
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      let run = -1;
      for (let cx = 0; cx <= MAP_CELLS; cx++) {
        const dark = cx < MAP_CELLS && (grid[cz * MAP_CELLS + cx] & 0b01) === 0;
        if (dark && run < 0) run = cx;
        else if (!dark && run >= 0) {
          ctx.fillRect(this.mapX + run * px, this.mapY + cz * px, (cx - run) * px + 1, px + 1);
          run = -1;
        }
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      let run = -1;
      for (let cx = 0; cx <= MAP_CELLS; cx++) {
        const v = cx < MAP_CELLS ? grid[cz * MAP_CELLS + cx] : 0;
        const dim = cx < MAP_CELLS && (v & 0b01) !== 0 && (v & 0b10) === 0;
        if (dim && run < 0) run = cx;
        else if (!dim && run >= 0) {
          ctx.fillRect(this.mapX + run * px, this.mapY + cz * px, (cx - run) * px + 1, px + 1);
          run = -1;
        }
      }
    }
  }

  /**
   * Blips. Units are a small square; structures get a square scaled by
   * footprint with a 1 px hole punched out of it, so a base reads as a cluster
   * of outlined pads rather than one solid blob.
   *
   * EVERY blip is drawn on a dark plate one pixel larger than itself. Without
   * it, a friendly cyan unit standing on concrete and a hostile red one on a
   * dirt road both dissolve into their background — the map only worked over
   * dark grass, which is not where the fighting happens.
   */
  private drawBlips(): void {
    const ctx = this.ctx;
    const store = this.world.store;
    const local = this.world.localPlayer;
    const scale = this.mapW / MAP_SIZE;
    const unit = Math.max(2, Math.round(this.mapW / MAP_CELLS) + 1);

    const hasRadar = this.world.vision.hasRadar(local);

    let currentStyle = '';
    for (let i = 0; i < store.aliveCount; i++) {
      const e = store.alive[i];
      const kind = store.kind[e];
      if (kind === EntityKind.Prop || kind === EntityKind.Crate || kind === EntityKind.Wreck) continue;
      const flags = store.flags[e];
      if ((flags & (EntityFlag.PendingDestroy | EntityFlag.Garrisoned)) !== 0) continue;

      const ownerId = store.owner[e] as PlayerId;
      const mine = ownerId === local
        || (store.faction[e] !== Faction.Neutral && this.world.areAllied(local, ownerId));

      if (!mine) {
        // Hostile blips are gated on radar AND on the shroud, exactly like the
        // original: a radar dome is what turns the map from your base into the
        // battlefield.
        //
        // THE SHROUD TEST IS THE PORT, not the raw grid. Testing the grid's
        // EXPLORED bit here was a map hack: it blipped an enemy tank on any
        // cell you had ever walked past, whether or not you could see it now.
        // It read as correct only because this pass runs at `RenderPhase.Hud`
        // (80), which used to be inside the window where the render mask had
        // borrowed `EntityFlag.Cloaked` — so the flag test above was silently
        // doing the real work. The mask no longer borrows that bit, so the
        // gate has to be the real question, asked the way everything else asks
        // it. `>= Remembered` is the same threshold the renderer draws at: a
        // scouted structure keeps its blip, a tank that drove off does not.
        if (!hasRadar) continue;
        if (this.world.vision.visibilityOf(local, store.handleOf(e)) < VisionLevel.Remembered) continue;
      }

      // `mine` is left alone above because it is the VISIBILITY gate; the
      // COLOUR is the seat's, from `restyle`.
      const style = this.styleOf(ownerId);

      const px = this.mapX + store.posX[e] * scale;
      const py = this.mapY + store.posZ[e] * scale;

      const s = kind === EntityKind.Building
        ? unit * Math.max(1.5, Math.min(3.2, store.footprintW[e]))
        : unit;
      const h = s * 0.5;

      // The plate first, then the blip. Two fills instead of one; at 20 Hz with
      // 200 entities that is 8000 rects a second, which does not appear in a
      // profile and buys a map that reads over concrete.
      if (currentStyle !== BLIP_PLATE) {
        ctx.fillStyle = BLIP_PLATE;
        currentStyle = BLIP_PLATE;
      }
      ctx.fillRect(px - h - 1, py - h - 1, s + 2, s + 2);

      if (style !== currentStyle) {
        ctx.fillStyle = style;
        currentStyle = style;
      }

      if (kind === EntityKind.Building) {
        const rim = Math.max(1, Math.round(s * 0.28));
        ctx.fillRect(px - h, py - h, s, rim);
        ctx.fillRect(px - h, py + h - rim, s, rim);
        ctx.fillRect(px - h, py - h, rim, s);
        ctx.fillRect(px + h - rim, py - h, rim, s);
      } else {
        ctx.fillRect(px - h, py - h, s, s);
      }
    }
  }

  /**
   * A short expanding ring on attack alerts, IN THE SEAT'S OWN COLOUR.
   *
   * This was binary — your accent for a hit on you, one red for a hit on
   * anybody else — while the blips underneath it had already gone per-seat.
   * With three opponents that made the ring the one mark on the map that could
   * not answer "who is fighting whom": three armies brawling in a corner drew
   * the same red ring whoever was losing.
   *
   * `styleOf` is the SAME lookup `drawBlips` and `drawTerritory` use, so the
   * three cannot drift apart, and the duel case is untouched: a hit on you is
   * still your accent (`restyle` gives every allied seat the accent, and you
   * are allied to yourself), and the only hostile in a duel is index 0, which
   * is `SEMANTIC.danger` — the exact red this always drew.
   */
  private drawPings(): void {
    if (this.pings.length === 0) return;
    const ctx = this.ctx;
    const scale = this.mapW / MAP_SIZE;
    const unitScale = this.mapW / 110;
    ctx.save();
    ctx.lineWidth = Math.max(1, unitScale);
    for (const p of this.pings) {
      const t = p.age / HUD_RADAR.pingSeconds;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = this.styleOf(p.owner);
      ctx.beginPath();
      ctx.arc(this.mapX + p.x * scale, this.mapY + p.z * scale, (2 + t * 14) * unitScale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The camera rectangle: a dark rim, then the accent rim inside it, then four
   * corner ticks. The dark rim is not decoration — a 1 px cyan line over the
   * bright sand surface was the one element of this map that could vanish
   * completely, and it is the element that says where you are looking.
   */
  private drawViewport(): void {
    if (!this.vpInit) return;
    const ctx = this.ctx;
    const scale = this.mapW / MAP_SIZE;
    const x0 = Math.round(this.mapX + this.vpMinX * scale);
    const y0 = Math.round(this.mapY + this.vpMinZ * scale);
    const w = Math.round((this.vpMaxX - this.vpMinX) * scale);
    const h = Math.round((this.vpMaxZ - this.vpMinZ) * scale);
    if (w <= 0 || h <= 0) return;

    ctx.fillStyle = rgba(this.accent, 0.08);
    ctx.fillRect(x0, y0, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    // Half-pixel offset so a 1 px stroke lands on one device pixel, not two.
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, w + 2, h + 2);
    ctx.strokeStyle = this.accent;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);

    // Corner ticks, clamped so they never meet on a tiny rectangle.
    const t = Math.max(2, Math.min(Math.round(this.mapW * 0.045), Math.min(w, h) * 0.3));
    ctx.lineWidth = Math.max(1, Math.round(this.mapW / 110));
    ctx.beginPath();
    ctx.moveTo(x0, y0 + t); ctx.lineTo(x0, y0); ctx.lineTo(x0 + t, y0);
    ctx.moveTo(x0 + w - t, y0); ctx.lineTo(x0 + w, y0); ctx.lineTo(x0 + w, y0 + t);
    ctx.moveTo(x0 + w, y0 + h - t); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0 + w - t, y0 + h);
    ctx.moveTo(x0 + t, y0 + h); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0, y0 + h - t);
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /* viewport tracking                                                   */
  /* ------------------------------------------------------------------ */

  /** Scratch for the corner unprojection. Never allocate in the frame loop. */
  private readonly corner = new THREE.Vector3();

  private easeViewport(dt: number): void {
    const pf = this.playfield();
    if (pf.w <= 0 || pf.h <= 0) return;

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let hits = 0;

    // The four playfield corners. A corner above the horizon is dropped and the
    // remaining ones still bound the visible ground correctly.
    for (let i = 0; i < 4; i++) {
      const cx = pf.x + ((i & 1) !== 0 ? pf.w : 0);
      const cy = pf.y + ((i & 2) !== 0 ? pf.h : 0);
      if (!this.cameraRig.screenToGround(cx, cy, this.corner)) continue;
      hits++;
      if (this.corner.x < minX) minX = this.corner.x;
      if (this.corner.x > maxX) maxX = this.corner.x;
      if (this.corner.z < minZ) minZ = this.corner.z;
      if (this.corner.z > maxZ) maxZ = this.corner.z;
    }
    if (hits < 2) return;

    minX = Math.max(0, minX);
    minZ = Math.max(0, minZ);
    maxX = Math.min(MAP_SIZE, maxX);
    maxZ = Math.min(MAP_SIZE, maxZ);

    if (!this.vpInit) {
      this.vpMinX = minX; this.vpMinZ = minZ; this.vpMaxX = maxX; this.vpMaxZ = maxZ;
      this.vpInit = true;
      return;
    }
    const k = 1 - Math.exp(-RECT_EASE * dt);
    this.vpMinX += (minX - this.vpMinX) * k;
    this.vpMinZ += (minZ - this.vpMinZ) * k;
    this.vpMaxX += (maxX - this.vpMaxX) * k;
    this.vpMaxZ += (maxZ - this.vpMaxZ) * k;
  }

  /* ------------------------------------------------------------------ */
  /* input: click-to-jump, drag-to-pan                                   */
  /* ------------------------------------------------------------------ */

  private attachInput(): void {
    const down = (ev: Event): void => {
      const e = ev as PointerEvent;
      if (e.button === 2) {
        e.preventDefault();
        const point = this.worldAt(e.clientX, e.clientY);
        if (point !== null) {
          const ordered = this.orderRequestHandler?.(point.x, point.z) ?? false;
          if (!ordered) this.pingRequestHandler?.(point.x, point.z);
        }
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      this.dragging = true;
      this.dragPointer = e.pointerId;
      // Capture keeps a scrub alive once the cursor leaves the 80 px map, but it
      // is an ENHANCEMENT, never a correctness requirement — `up` also fires on
      // `pointercancel` and does not depend on the capture having been granted.
      // `setPointerCapture` throws NotFoundError for a pointer the browser no
      // longer considers active, and an uncaught throw in a pointerdown handler
      // takes the whole app to the BOOT FAILURE screen over a dropped scrub.
      // `Input.ts` already guards its own call for the same reason.
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* No capture: the drag still tracks while the pointer is over the map. */
      }
      this.jumpTo(e.clientX, e.clientY);
    };
    const move = (ev: Event): void => {
      const e = ev as PointerEvent;
      if (!this.dragging || e.pointerId !== this.dragPointer) return;
      e.preventDefault();
      this.jumpTo(e.clientX, e.clientY);
    };
    const up = (ev: Event): void => {
      const e = ev as PointerEvent;
      if (e.pointerId !== this.dragPointer) return;
      this.dragging = false;
      this.dragPointer = -1;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    // A context menu on the map would eat the right-click the game wants.
    const ctxMenu = (ev: Event): void => ev.preventDefault();

    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('contextmenu', ctxMenu);
    this.listeners.push(
      ['pointerdown', down], ['pointermove', move], ['pointerup', up],
      ['pointercancel', up], ['contextmenu', ctxMenu],
    );
  }

  /** Client px -> world metres, clamped to the map. */
  private jumpTo(clientX: number, clientY: number): void {
    const point = this.worldAt(clientX, clientY);
    if (point === null) return;
    if (this.onJump !== null) this.onJump(point.x, point.z);
    else this.cameraRig.setFocus(point.x, point.z, false);
  }

  /** Client px -> world metres, shared by camera jumps and ally pings. */
  private worldAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // The canvas backing store is device px; the map rect was computed there.
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    const px = (clientX - rect.left) * sx;
    const py = (clientY - rect.top) * sy;

    const u = (px - this.mapX) / this.mapW;
    const v = (py - this.mapY) / this.mapH;
    // A sloppy click just outside the map still pans there rather than doing
    // nothing, which is what the clamp is for.
    const x = Math.min(MAP_SIZE, Math.max(0, u * MAP_SIZE));
    const z = Math.min(MAP_SIZE, Math.max(0, v * MAP_SIZE));

    return { x, z };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.pings.length = 0;
    this.onJump = null;
    this.pingRequestHandler = null;
  }
}
