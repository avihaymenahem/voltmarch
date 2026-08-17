/**
 * ============================================================================
 * VOLTMARCH — src/world/PropLibrary.ts
 * ============================================================================
 * THE PROP FACTORY. 28 procedural prop archetypes with real silhouettes, built
 * once per biome, each merged into ONE geometry so the scatter system can draw
 * a whole type in a single instanced call.
 *
 * WHY THIS FILE EXISTS AT ALL — bible §14 R3, rated FATAL:
 *
 *   "Terrain is a big empty plane. Prop scatter is always the last system
 *    written and the first cut. RA3's city reference carries 106 discrete props
 *    on 1.3 hectares; a procedural remake ships 8 rocks."
 *
 * `refs/ra3steam_08.jpg` IS that city reference, and counting it by hand is the
 * spec for this file: 6 bronze statues on hedged plinths, ~14 hedge blocks
 * bordering every planted island, 3 flower beds in blocked magenta/yellow
 * bands, ~11 street lamps, 9 parked cars, 7 red cafe umbrellas, 6 crates and 3
 * barrels, ~20 cypress, ~15 autumn broadleafs, 2 iron railing runs. Every one
 * of those has an archetype below. Eight rocks is the failure mode.
 *
 * THE FOUR DECISIONS THAT MATTER
 * ------------------------------
 * 1. EVERY CONVEX EDGE IS CHAMFERED **AND THE CHAMFER IS PAINTED BRIGHTER**
 *    (scorecard #11, weight 3). Unit art gets its bevel band out of a texture
 *    atlas; props have no atlas, so the band is baked into VERTEX COLOUR at
 *    build time — base albedo +22% V, -15% S along every chamfer strip, the
 *    exact numbers in bible 5.5. Geometry alone is only half the fix: the read
 *    comes from the BAND, not from the facet.
 *
 * 2. ONE MATERIAL FOR ALL 28 TYPES. Per-vertex colour carries the paint, a
 *    per-vertex `aEmit` channel carries lamp/signal glow, and per-instance
 *    `instanceColor` carries the hue/value jitter (scorecard #39). A prop type
 *    therefore costs exactly one draw call and the roster shares one program.
 *    `createPropMaterial()` is the only place a prop material is constructed.
 *
 * 3. FOLIAGE SWAYS (bible §6.5: "near-zero cost and its absence reads instantly
 *    as static"). A per-vertex `aSway` amplitude in METRES rides a shared time
 *    uniform with a per-instance phase read straight off `instanceMatrix[3]`.
 *    The custom depth material carries the identical displacement, so a swaying
 *    canopy never casts a frozen shadow.
 *
 * 4. CYLINDERS ARE 12-16 FACETS AND SPHERES ARE FACETED TOO (scorecard #40).
 *    Every ring count below is inside that band. A smooth 32-segment tube is a
 *    different engine.
 *
 *    ...and because they are faceted AND flat shaded, foliage pays nothing for
 *    PER-FACET paint variation: `PropMesh.facetJitter` re-rolls the albedo once
 *    per triangle/quad on canopy blobs, conifer tiers and shrub lobes (+-14% V,
 *    +-6 deg H off the builder's seeded stream). That is scorecard #34 — Sobel
 *    |grad|>25 coverage, the one metric failing on all thirteen fixtures — and
 *    it is NOT the banned per-pixel noise: a canopy facet is ~2.7 m, ~80 px at
 *    gameplay zoom, bounded by a real geometric crease, and every vertex inside
 *    it carries the identical colour. See the doc comment on `facetJitter`.
 *
 * ONE GEOMETRY PER KEY. A `PropDef` bakes exactly one mesh; where two looks
 * must coexist on the same map (summer vs autumn foliage, golden vs green
 * grass, timber crates vs shipping containers) they are separate KEYS with
 * their own biome weights, because instancing cannot switch geometry per
 * instance and `geometry.groups` draws every group.
 *
 * COLOUR SPACE. `THREE.ColorManagement.enabled` is true (render/renderer.ts),
 * so vertex-colour attribute data is consumed as LINEAR. Every literal below is
 * an sRGB hex from the bible, converted exactly once through `linear()`.
 * ============================================================================
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { PROP_EMISSIVE_GAIN, PROP_MATERIAL, SCATTER_WIND } from '../core/config';
import { clamp, clamp01, Rng, srgbToLinear, TAU } from '../core/math';
import { linearColorTriple } from '../core/assets';
import { applyShroudTint } from '../render/FogOfWar';
import { SurfaceId, type BiomeName } from './Biomes';

/* ==========================================================================
 * 1. COLOUR
 * ========================================================================== */

const LINEAR_CACHE = new Map<string, readonly [number, number, number]>();

/** sRGB hex -> linear triple, memoised. Build time only, never per frame. */
function linear(hex: string): readonly [number, number, number] {
  let v = LINEAR_CACHE.get(hex);
  if (v === undefined) {
    v = linearColorTriple(hex);
    LINEAR_CACHE.set(hex, v);
  }
  return v;
}

const HSV = new Float32Array(3);

function hexToHsv(hex: string, out: Float32Array): void {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  out[0] = h; out[1] = max <= 0 ? 0 : d / max; out[2] = max;
}

/** HSV (hue in TURNS, wrapped; s/v 0..1) -> sRGB 0..1 into `out`. */
function hsvToRgb(h: number, s: number, v: number, out: Float32Array): void {
  h -= Math.floor(h);
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: break;
  }
  out[0] = clamp01(r); out[1] = clamp01(g); out[2] = clamp01(b);
}

const RGB_SCRATCH = new Float32Array(3);

function hsvToHex(h: number, s: number, v: number): string {
  hsvToRgb(h, s, v, RGB_SCRATCH);
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(RGB_SCRATCH[0])}${to(RGB_SCRATCH[1])}${to(RGB_SCRATCH[2])}`;
}

/**
 * HSV straight to a LINEAR triple, skipping the 8-bit hex round trip.
 *
 * `color()` goes through hex because every authored literal in this file is a
 * hex from the bible and `linear()` memoises on that string. The facet jitter
 * cannot: it produces a fresh colour per triangle, so a hex cache would only
 * grow, and quantising a +-14% value swing to 8 bits throws away the small
 * steps that are the whole point. Same transfer function either way —
 * `linearColorTriple` calls this same `srgbToLinear`.
 */
function hsvToLinear(h: number, s: number, v: number, out: Float32Array): void {
  hsvToRgb(h, s, v, out);
  out[0] = srgbToLinear(out[0]);
  out[1] = srgbToLinear(out[1]);
  out[2] = srgbToLinear(out[2]);
}

/**
 * The painted bevel highlight, bible 5.5: "base albedo +22% V, -15% S".
 * Scorecard #11 is weight 3 and this single function is what passes it — a
 * chamfered edge with no brighter band still reads as an untextured primitive.
 */
export function bevelHighlight(hex: string): string {
  hexToHsv(hex, HSV);
  return hsvToHex(
    HSV[0],
    HSV[1] * (1 - PROP_MATERIAL.bevelSaturationLoss),
    clamp01(HSV[2] * (1 + PROP_MATERIAL.bevelValueGain) + 0.02),
  );
}

/** Multiply value, keep hue and saturation. Cavity / underside darkening. */
export function shadeOf(hex: string, mul: number): string {
  hexToHsv(hex, HSV);
  return hsvToHex(HSV[0], HSV[1], clamp01(HSV[2] * mul));
}

/* ==========================================================================
 * 2. THE MESH BUILDER
 *
 * A flat accumulator with a little state (paint, sway ramp, emissive, AO ramp)
 * so a prop reads as a list of volumes instead of buffer bookkeeping.
 *
 * Every face is FLAT SHADED — vertices are never shared across faces. Props are
 * toys, and smooth normals on a 12-facet cylinder is exactly the "smooth
 * 32-segment tube" tell scorecard #40 punishes.
 * ========================================================================== */

const SCRATCH_A = new Float32Array(3);
const SCRATCH_B = new Float32Array(3);

export class PropMesh {
  private readonly posArr: number[] = [];
  private readonly nrmArr: number[] = [];
  private readonly colArr: number[] = [];
  private readonly swyArr: number[] = [];
  private readonly emtArr: number[] = [];
  private readonly glsArr: number[] = [];
  private readonly idxArr: number[] = [];

  /* The colours `vertex()` actually emits. Facet jitter overwrites these. */
  private cr = 1; private cg = 1; private cb = 1;
  private br = 1; private bg = 1; private bb = 1;
  /*
   * Pristine copies of the same two pairs, plus their HSV. The copies let
   * `noFacetJitter()` restore the AUTHORED paint bit-for-bit instead of a value
   * re-derived through HSV; the HSV is what the jitter perturbs.
   */
  private cr0 = 1; private cg0 = 1; private cb0 = 1;
  private br0 = 1; private bg0 = 1; private bb0 = 1;
  private cH = 0; private cS = 0; private cV = 1;
  private bH = 0; private bS = 0; private bV = 1;

  /* Non-null = re-roll the paint on every primitive. See `facetJitter`. */
  private jitterRng: Rng | null = null;
  private jitterValue = 0;
  private jitterHue = 0;
  private readonly facetRgb = new Float32Array(3);

  private emit = 0;
  private glossV = 0;

  private swayAmp = 0;
  private swayBase = 0;
  private swayTop = 1;

  private aoFloor = 1;
  private aoBase = 0;
  private aoTop = 1;

  triangles = 0;
  readonly min = new Float32Array([Infinity, Infinity, Infinity]);
  readonly max = new Float32Array([-Infinity, -Infinity, -Infinity]);

  /* ---- state ----------------------------------------------------------- */

  /** Set the paint. The chamfer colour is derived unless `bevel()` follows. */
  color(hex: string): this {
    const c = linear(hex);
    this.cr0 = c[0]; this.cg0 = c[1]; this.cb0 = c[2];
    hexToHsv(hex, HSV);
    this.cH = HSV[0]; this.cS = HSV[1]; this.cV = HSV[2];
    this.bevel(bevelHighlight(hex));
    this.cr = this.cr0; this.cg = this.cg0; this.cb = this.cb0;
    return this;
  }

  /** Override the chamfer-strip colour (a stone kerb lip, a painted band). */
  bevel(hex: string): this {
    const b = linear(hex);
    this.br0 = b[0]; this.bg0 = b[1]; this.bb0 = b[2];
    this.br = b[0]; this.bg = b[1]; this.bb = b[2];
    hexToHsv(hex, HSV);
    this.bH = HSV[0]; this.bS = HSV[1]; this.bV = HSV[2];
    return this;
  }

  /**
   * PER-FACET PAINT JITTER — the detail-density lever that costs nothing.
   *
   * Scorecard #34 (Sobel |grad|>25 coverage) fails on every capture fixture and
   * native-resolution crops put the deficit in bare ground and TREE CANOPIES: a
   * canopy blob is ~200 flat-shaded facets that all arrive at the framebuffer
   * within a couple of luminance levels of each other, so the Sobel operator
   * sees one silhouette and nothing inside it. Give adjacent facets a real
   * albedo step and every facet boundary becomes a measurable edge.
   *
   * WHY THIS IS NOT THE BANNED NOISE. CLAUDE.md: "if per-pixel noise is visible
   * at gameplay zoom, it is wrong. Detail comes from geometry and from crisp
   * drawn shapes." A canopy facet here is ~2.7 m on a side — about 80 px at the
   * 29.6 px/m gameplay zoom — bounded by a real geometric crease with a real
   * normal discontinuity. It IS a crisp shape. The jitter is rolled once per
   * PRIMITIVE and every vertex of that primitive gets the identical colour, so
   * there is no gradient inside a facet and nothing to alias.
   *
   * WHY IT IS FREE. Props are flat shaded — `vertex()` never shares a vertex
   * across faces (see the section header) — so a per-facet colour needs no new
   * attribute, no new draw call and no new triangle. It is the same `color`
   * buffer the paint already rides in.
   *
   * THE BAND. `value` +-0.14 and `hueDeg` +-6 for foliage. Bible §6.5 asks for
   * value +-18% / hue +-8 deg PER INSTANCE and the scatter system already does
   * that; this is deliberately tighter one level down. Note the interaction with
   * the tone-ladder rule in section 3: the temperate leaf ladder spans 1.29x
   * across its three lobes, and +-14% adds up to 1.33x facet-to-facet, so the
   * worst-case within-canopy span is ~1.71x rather than the 1.40x the ladder
   * rule quotes. That rule is about LOBE-scale alternation, which reads as
   * blotches because a lobe is a whole mass; facet-scale variation is the
   * greeble scale the bible asks for in §5.3 ("every greeble >= 3 px"). If a
   * capture ever shows canopies reading as confetti, lower the value swing —
   * do not reach for the hue.
   *
   * DETERMINISM. Draws come from the builder's own seeded stream, which is a
   * fresh `Rng` per prop def, so jittering one archetype cannot move another.
   * The roll happens BEFORE the degenerate-facet early-return in `tri`/`quad`,
   * so the draw count depends only on the call sequence, never on geometry.
   *
   * @param rng    the builder's seeded stream. Never `Math.random`.
   * @param value  fractional value swing, symmetric. 0.14 = +-14%.
   * @param hueDeg hue swing in DEGREES, symmetric. Saturation is untouched.
   */
  facetJitter(rng: Rng, value: number, hueDeg: number): this {
    this.jitterRng = rng;
    this.jitterValue = value;
    this.jitterHue = hueDeg / 360;
    return this;
  }

  /** Stop jittering and restore the authored paint exactly. */
  noFacetJitter(): this {
    this.jitterRng = null;
    this.cr = this.cr0; this.cg = this.cg0; this.cb = this.cb0;
    this.br = this.br0; this.bg = this.bg0; this.bb = this.bb0;
    return this;
  }

  /** One roll per primitive. Both the paint and its bevel band move together. */
  private rollFacet(): void {
    const r = this.jitterRng;
    if (r === null) return;
    const dh = (r.next() * 2 - 1) * this.jitterHue;
    const dv = 1 + (r.next() * 2 - 1) * this.jitterValue;
    hsvToLinear(this.cH + dh, this.cS, clamp01(this.cV * dv), this.facetRgb);
    this.cr = this.facetRgb[0]; this.cg = this.facetRgb[1]; this.cb = this.facetRgb[2];
    hsvToLinear(this.bH + dh, this.bS, clamp01(this.bV * dv), this.facetRgb);
    this.br = this.facetRgb[0]; this.bg = this.facetRgb[1]; this.bb = this.facetRgb[2];
  }

  /** 0 = lit paint, 1 = full emissive. Bible R-T5: clean discs and rounded rects. */
  emissive(e: number): this { this.emit = e; return this; }

  /**
   * Surface finish, 0 = the material's matte default, 1 = wet lacquer.
   *
   * This is the ONLY thing in the prop pipeline that varies a surface, and it
   * varies ROUGHNESS ONLY — never albedo, never a normal, never a texture. RA3
   * separates a parked car from a hedge with a specular highlight on a flat
   * colour, not with grime: `ra3-units-road.png` is large unbroken paint with a
   * glossy top face, and `ra3steam_08.jpg`'s cars are the same read at 40 px.
   *
   * Values used below: car/sign paint 0.85, glass 1.0, painted steel 0.5,
   * varnished wood 0.3, foliage / stone / concrete / soil 0.
   */
  gloss(g: number): this { this.glossV = clamp01(g); return this; }

  /**
   * Wind response. `amp` is the displacement in METRES reached at `top`,
   * ramping from zero at `base`. Bible §6.5: canopy 0.15 m, grass 0.06 m.
   */
  sway(amp: number, base: number, top: number): this {
    this.swayAmp = amp;
    this.swayBase = base;
    this.swayTop = Math.max(top, base + 1e-3);
    return this;
  }

  /**
   * Baked vertical AO — albedo x `floor` at `base` rising to x1 at `top`.
   * Bible §3.3: crease AO is baked, never screen-space, and a prop without a
   * darkened footing floats exactly the way a unit without one does.
   */
  ao(floor: number, base: number, top: number): this {
    this.aoFloor = floor;
    this.aoBase = base;
    this.aoTop = Math.max(top, base + 1e-3);
    return this;
  }

  /* ---- freeform faces -------------------------------------------------- */

  /**
   * A triangle. `ox/oy/oz` is an OUTWARD reference direction: the winding and
   * the normal are flipped to agree with it, so a builder never has to reason
   * about vertex order.
   */
  tri(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    ox: number, oy: number, oz: number,
    bevelPaint = false,
  ): void {
    this.rollFacet();
    SCRATCH_A[0] = x1 - x0; SCRATCH_A[1] = y1 - y0; SCRATCH_A[2] = z1 - z0;
    SCRATCH_B[0] = x2 - x0; SCRATCH_B[1] = y2 - y0; SCRATCH_B[2] = z2 - z0;
    let nx = SCRATCH_A[1] * SCRATCH_B[2] - SCRATCH_A[2] * SCRATCH_B[1];
    let ny = SCRATCH_A[2] * SCRATCH_B[0] - SCRATCH_A[0] * SCRATCH_B[2];
    let nz = SCRATCH_A[0] * SCRATCH_B[1] - SCRATCH_A[1] * SCRATCH_B[0];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return;
    nx /= len; ny /= len; nz /= len;
    const flip = nx * ox + ny * oy + nz * oz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const base = this.posArr.length / 3;
    this.vertex(x0, y0, z0, nx, ny, nz, bevelPaint);
    this.vertex(x1, y1, z1, nx, ny, nz, bevelPaint);
    this.vertex(x2, y2, z2, nx, ny, nz, bevelPaint);
    if (flip) this.idxArr.push(base, base + 2, base + 1);
    else this.idxArr.push(base, base + 1, base + 2);
    this.triangles++;
  }

  /** A quad, wound to face `ox/oy/oz`. Tolerates slightly non-planar corners. */
  quad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    ox: number, oy: number, oz: number,
    bevelPaint = false,
  ): void {
    this.rollFacet();
    SCRATCH_A[0] = x2 - x0; SCRATCH_A[1] = y2 - y0; SCRATCH_A[2] = z2 - z0;
    SCRATCH_B[0] = x3 - x1; SCRATCH_B[1] = y3 - y1; SCRATCH_B[2] = z3 - z1;
    let nx = SCRATCH_A[1] * SCRATCH_B[2] - SCRATCH_A[2] * SCRATCH_B[1];
    let ny = SCRATCH_A[2] * SCRATCH_B[0] - SCRATCH_A[0] * SCRATCH_B[2];
    let nz = SCRATCH_A[0] * SCRATCH_B[1] - SCRATCH_A[1] * SCRATCH_B[0];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return;
    nx /= len; ny /= len; nz /= len;
    const flip = nx * ox + ny * oy + nz * oz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const base = this.posArr.length / 3;
    this.vertex(x0, y0, z0, nx, ny, nz, bevelPaint);
    this.vertex(x1, y1, z1, nx, ny, nz, bevelPaint);
    this.vertex(x2, y2, z2, nx, ny, nz, bevelPaint);
    this.vertex(x3, y3, z3, nx, ny, nz, bevelPaint);
    if (flip) this.idxArr.push(base, base + 3, base + 2, base, base + 2, base + 1);
    else this.idxArr.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.triangles += 2;
  }

  /* ---- primitives ------------------------------------------------------ */

  /**
   * A chamfered box: 6 main faces + 12 edge strips + 8 corner triangles.
   * The strips and corners are emitted in the BEVEL colour — that band is the
   * whole point (bible 5.5, scorecard #11).
   *
   * `cx/cy/cz` is the CENTRE. `yaw` rotates about +Y.
   */
  box(
    cx: number, cy: number, cz: number,
    w: number, h: number, d: number,
    chamfer: number, yaw = 0,
  ): void {
    const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
    const c = clamp(chamfer, 0, Math.min(hx, hy, hz) * 0.92);
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    // Inset extents: the corner of a face is pulled back by the chamfer on the
    // other two axes.
    const ix = hx - c, iy = hy - c, iz = hz - c;

    const px = (x: number, z: number): number => cx + x * cs + z * sn;
    const pz = (x: number, z: number): number => cz - x * sn + z * cs;
    const dx = (x: number, z: number): number => x * cs + z * sn;
    const dz = (x: number, z: number): number => -x * sn + z * cs;

    const q = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx2: number, cy2: number, cz2: number, ex: number, ey: number, ez: number,
      ox: number, oy: number, oz: number, bevelPaint: boolean,
    ): void => {
      this.quad(
        px(ax, az), cy + ay, pz(ax, az),
        px(bx, bz), cy + by, pz(bx, bz),
        px(cx2, cz2), cy + cy2, pz(cx2, cz2),
        px(ex, ez), cy + ey, pz(ex, ez),
        dx(ox, oz), oy, dz(ox, oz), bevelPaint,
      );
    };

    /* 6 main faces */
    for (let s = -1; s <= 1; s += 2) {
      q(s * hx, -iy, -iz, s * hx, iy, -iz, s * hx, iy, iz, s * hx, -iy, iz, s, 0, 0, false);
      q(-ix, s * hy, -iz, ix, s * hy, -iz, ix, s * hy, iz, -ix, s * hy, iz, 0, s, 0, false);
      q(-ix, -iy, s * hz, ix, -iy, s * hz, ix, iy, s * hz, -ix, iy, s * hz, 0, 0, s, false);
    }
    if (c <= 1e-5) return;

    /* 12 chamfer strips, in the highlight colour */
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        // parallel to X — joins the +/-Y face to the +/-Z face
        q(-ix, sy * hy, sz * iz, ix, sy * hy, sz * iz,
          ix, sy * iy, sz * hz, -ix, sy * iy, sz * hz, 0, sy, sz, true);
      }
    }
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        // parallel to Y — joins +/-X to +/-Z
        q(sx * hx, -iy, sz * iz, sx * hx, iy, sz * iz,
          sx * ix, iy, sz * hz, sx * ix, -iy, sz * hz, sx, 0, sz, true);
      }
      for (let sy = -1; sy <= 1; sy += 2) {
        // parallel to Z — joins +/-X to +/-Y
        q(sx * hx, sy * iy, -iz, sx * hx, sy * iy, iz,
          sx * ix, sy * hy, iz, sx * ix, sy * hy, -iz, sx, sy, 0, true);
      }
    }

    /* 8 corner triangles */
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          this.tri(
            px(sx * hx, sz * iz), cy + sy * iy, pz(sx * hx, sz * iz),
            px(sx * ix, sz * iz), cy + sy * hy, pz(sx * ix, sz * iz),
            px(sx * ix, sz * hz), cy + sy * iy, pz(sx * ix, sz * hz),
            dx(sx, sz), sy, dz(sx, sz), true,
          );
        }
      }
    }
  }

  /**
   * A faceted cylinder / truncated cone standing on +Y, with chamfered rims.
   * `cy` is the BASE, not the centre. `segs` lives in the bible's 12-16 band.
   */
  cyl(
    cx: number, cy: number, cz: number,
    rBottom: number, rTop: number, h: number,
    segs: number, chamfer: number,
    capBottom = true, capTop = true, yawOffset = 0,
  ): void {
    const n = Math.max(3, Math.round(segs));
    const c = clamp(chamfer, 0, Math.min(h * 0.4, Math.min(rBottom, rTop) * 0.8));
    // [y, radius, isChamferRing]
    const ry: number[] = [];
    const rr: number[] = [];
    const rb: boolean[] = [];
    if (c > 1e-5) {
      ry.push(cy, cy + c, cy + h - c, cy + h);
      rr.push(Math.max(rBottom - c, 1e-4), rBottom, rTop, Math.max(rTop - c, 1e-4));
      rb.push(true, false, false, true);
    } else {
      ry.push(cy, cy + h);
      rr.push(rBottom, rTop);
      rb.push(false, false);
    }

    for (let i = 0; i < n; i++) {
      const a0 = yawOffset + (i / n) * TAU, a1 = yawOffset + ((i + 1) / n) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const mx = (c0 + c1) * 0.5, mz = (s0 + s1) * 0.5;
      for (let r = 0; r + 1 < ry.length; r++) {
        const isBevel = rb[r] || rb[r + 1];
        // Tilt the outward reference with the taper so a chamfer strip and a
        // cone flank both wind correctly.
        const oy = (rr[r] - rr[r + 1]) / Math.max(Math.abs(ry[r + 1] - ry[r]), 1e-4);
        this.quad(
          cx + c0 * rr[r], ry[r], cz + s0 * rr[r],
          cx + c1 * rr[r], ry[r], cz + s1 * rr[r],
          cx + c1 * rr[r + 1], ry[r + 1], cz + s1 * rr[r + 1],
          cx + c0 * rr[r + 1], ry[r + 1], cz + s0 * rr[r + 1],
          mx, oy * 0.5, mz, isBevel,
        );
      }
    }
    if (capBottom) this.disc(cx, ry[0], cz, rr[0], n, -1, yawOffset);
    const last = ry.length - 1;
    if (capTop) this.disc(cx, ry[last], cz, rr[last], n, 1, yawOffset);
  }

  /** Flat n-gon cap in the XZ plane, normal +/-Y. */
  disc(cx: number, cy: number, cz: number, r: number, segs: number, dir: number, yawOffset = 0): void {
    const n = Math.max(3, Math.round(segs));
    for (let i = 1; i + 1 < n; i++) {
      const a0 = yawOffset, a1 = yawOffset + (i / n) * TAU, a2 = yawOffset + ((i + 1) / n) * TAU;
      this.tri(
        cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r,
        cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r,
        cx + Math.cos(a2) * r, cy, cz + Math.sin(a2) * r,
        0, dir, 0, false,
      );
    }
  }

  /**
   * A faceted ellipsoid centred on (cx,cy,cz). Canopies, boulder masses,
   * flower heads. `squashBottom` (0..1) lifts the lower hemisphere so a canopy
   * blob reads as a dome sitting on a trunk rather than a floating sphere.
   */
  blob(
    cx: number, cy: number, cz: number,
    rx: number, ry: number, rz: number,
    segs: number, rings: number, squashBottom = 0,
  ): void {
    const n = Math.max(4, Math.round(segs)), m = Math.max(2, Math.round(rings));
    for (let j = 0; j < m; j++) {
      const p0 = Math.PI * (j / m), p1 = Math.PI * ((j + 1) / m);
      const y0raw = -Math.cos(p0), y1raw = -Math.cos(p1);
      const y0 = y0raw < 0 ? y0raw * (1 - squashBottom) : y0raw;
      const y1 = y1raw < 0 ? y1raw * (1 - squashBottom) : y1raw;
      const s0 = Math.sin(p0), s1 = Math.sin(p1);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        const c0 = Math.cos(a0), z0 = Math.sin(a0), c1 = Math.cos(a1), z1 = Math.sin(a1);
        const sm = (s0 + s1) * 0.5;
        const ox = (c0 + c1) * 0.5 * sm, oz = (z0 + z1) * 0.5 * sm, oy = (y0 + y1) * 0.5;
        if (j === 0) {
          this.tri(
            cx, cy + y0 * ry, cz,
            cx + c0 * s1 * rx, cy + y1 * ry, cz + z0 * s1 * rz,
            cx + c1 * s1 * rx, cy + y1 * ry, cz + z1 * s1 * rz,
            ox, oy, oz, false,
          );
        } else if (j === m - 1) {
          this.tri(
            cx + c0 * s0 * rx, cy + y0 * ry, cz + z0 * s0 * rz,
            cx + c1 * s0 * rx, cy + y0 * ry, cz + z1 * s0 * rz,
            cx, cy + y1 * ry, cz,
            ox, oy, oz, false,
          );
        } else {
          this.quad(
            cx + c0 * s0 * rx, cy + y0 * ry, cz + z0 * s0 * rz,
            cx + c1 * s0 * rx, cy + y0 * ry, cz + z1 * s0 * rz,
            cx + c1 * s1 * rx, cy + y1 * ry, cz + z1 * s1 * rz,
            cx + c0 * s1 * rx, cy + y1 * ry, cz + z0 * s1 * rz,
            ox, oy, oz, false,
          );
        }
      }
    }
  }

  /** Faceted cone standing on +Y from base `cy`. Conifer tiers, roof caps. */
  cone(cx: number, cy: number, cz: number, r: number, h: number, segs: number, capBottom = true): void {
    const n = Math.max(3, Math.round(segs));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.tri(
        cx + c0 * r, cy, cz + s0 * r,
        cx + c1 * r, cy, cz + s1 * r,
        cx, cy + h, cz,
        (c0 + c1) * 0.5, r / Math.max(h, 1e-3), (s0 + s1) * 0.5, false,
      );
    }
    if (capBottom) this.disc(cx, cy, cz, r, n, -1);
  }

  /**
   * A tapered prism running from A to B — a branch, a limb, anything that has
   * to point somewhere `cyl` cannot. `cyl` stands on +Y and takes a yaw only,
   * so every "branch" in this file used to be a vertical stub offset radially,
   * which is why a canopy could only ever be a ball sitting on a pole.
   *
   * `sides` defaults to 3 deliberately. The bible's 12-16 segment band is about
   * masses a player reads as a shape; a branch is 0.1-0.2 m thick, ~5 px at
   * gameplay zoom, and its silhouette is its LENGTH. Three sides is two
   * triangles per span and looks identical at any distance the game is played
   * from.
   *
   * `bow` lifts the mid-spans along +Y so the limb arcs instead of being a
   * dead-straight stick; it is ignored when `spans` is 1.
   *
   * No end caps: both ends are buried, the base inside the trunk and the tip
   * inside its lobe cluster.
   */
  limb(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    r0: number, r1: number,
    sides = 3, spans = 1, bow = 0,
  ): void {
    const n = Math.max(3, Math.round(sides));
    const sp = Math.max(1, Math.round(spans));
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;

    // Any unit vector not parallel to the axis gives a stable perpendicular
    // basis. The 0.9 switch keeps the cross product away from zero length.
    const upright = Math.abs(dy) >= 0.9;
    // cross(d, +Y) for a leaning limb, cross(d, +X) for a near-vertical one.
    let ux = upright ? 0 : -dz;
    let uy = upright ? dz : 0;
    let uz = upright ? -dy : dx;
    const ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-9) return;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;

    // Ring i: centre, radius, and the n corner offsets in (u, v).
    const cxs = new Array<number>(sp + 1), cys = new Array<number>(sp + 1), czs = new Array<number>(sp + 1);
    const rs = new Array<number>(sp + 1);
    for (let i = 0; i <= sp; i++) {
      const t = i / sp;
      cxs[i] = x0 + (x1 - x0) * t;
      cys[i] = y0 + (y1 - y0) * t + (sp > 1 ? bow * Math.sin(Math.PI * t) : 0);
      czs[i] = z0 + (z1 - z0) * t;
      rs[i] = r0 + (r1 - r0) * t;
    }

    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      // Outward reference: the mid-direction of the two corners, in world space.
      const mu = (c0 + c1) * 0.5, mv = (s0 + s1) * 0.5;
      const ox = ux * mu + vx * mv, oy = uy * mu + vy * mv, oz = uz * mu + vz * mv;
      for (let i = 0; i < sp; i++) {
        const ra = rs[i], rb = rs[i + 1];
        this.quad(
          cxs[i] + (ux * c0 + vx * s0) * ra, cys[i] + (uy * c0 + vy * s0) * ra, czs[i] + (uz * c0 + vz * s0) * ra,
          cxs[i] + (ux * c1 + vx * s1) * ra, cys[i] + (uy * c1 + vy * s1) * ra, czs[i] + (uz * c1 + vz * s1) * ra,
          cxs[i + 1] + (ux * c1 + vx * s1) * rb, cys[i + 1] + (uy * c1 + vy * s1) * rb, czs[i + 1] + (uz * c1 + vz * s1) * rb,
          cxs[i + 1] + (ux * c0 + vx * s0) * rb, cys[i + 1] + (uy * c0 + vy * s0) * rb, czs[i + 1] + (uz * c0 + vz * s0) * rb,
          ox, oy, oz, false,
        );
      }
    }
  }

  /**
   * A tapered blade / frond: a V-folded card arcing outward and drooping.
   * Bible §6.5 grass tufts are "a radial fan of 14-20 tapered blade cards, each
   * 0.15 m x 1.4-1.8 m, arcing outward". The fold gives the card a spine so it
   * still reads as volume from the 39-degree camera instead of vanishing
   * edge-on, without needing a double-sided material.
   *
   * `rise` may be negative (an umbrella panel falling away from its finial).
   */
  blade(
    bx: number, by: number, bz: number,
    dirX: number, dirZ: number,
    length: number, rise: number, width: number,
    droop: number, spans = 3, widenOut = false,
  ): void {
    const px = -dirZ, pz = dirX;
    const s = Math.max(2, spans | 0);
    let plx = 0, ply = 0, plz = 0, psx = 0, psy = 0, psz = 0, prx = 0, pry = 0, prz = 0;
    for (let i = 0; i <= s; i++) {
      const t = i / s;
      const reach = length * Math.pow(t, widenOut ? 1.0 : 1.55);
      const y = rise * (1 - Math.pow(1 - t, 1.7)) - droop * Math.pow(t, 3.1);
      const w = width * (widenOut ? Math.max(t, 0.06) : Math.pow(1 - t, 0.75)) * 0.5;
      const fold = w * (widenOut ? 0.22 : 0.9);
      const cxp = bx + dirX * reach, cyp = by + y, czp = bz + dirZ * reach;
      const lx = cxp + px * w, lz = czp + pz * w;
      const sx = cxp, sy = cyp + fold, sz = czp;
      const rx = cxp - px * w, rz = czp - pz * w;
      if (i > 0) {
        this.quad(plx, ply, plz, lx, cyp, lz, sx, sy, sz, psx, psy, psz, 0, 1, 0, false);
        this.quad(psx, psy, psz, sx, sy, sz, rx, cyp, rz, prx, pry, prz, 0, 1, 0, false);
      }
      plx = lx; ply = cyp; plz = lz;
      psx = sx; psy = sy; psz = sz;
      prx = rx; pry = cyp; prz = rz;
    }
  }

  /* ---- vertex emission ------------------------------------------------- */

  private vertex(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number, bevelPaint: boolean,
  ): void {
    this.posArr.push(x, y, z);
    this.nrmArr.push(nx, ny, nz);

    const ta = clamp01((y - this.aoBase) / (this.aoTop - this.aoBase));
    const aoMul = this.aoFloor + (1 - this.aoFloor) * Math.pow(ta, 0.65);
    if (bevelPaint) this.colArr.push(this.br * aoMul, this.bg * aoMul, this.bb * aoMul);
    else this.colArr.push(this.cr * aoMul, this.cg * aoMul, this.cb * aoMul);

    const ts = clamp01((y - this.swayBase) / (this.swayTop - this.swayBase));
    this.swyArr.push(this.swayAmp * Math.pow(ts, 1.4));
    this.emtArr.push(this.emit);
    this.glsArr.push(this.glossV);

    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
  }

  get vertexCount(): number { return this.posArr.length / 3; }

  toGeometry(name: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.name = name;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.posArr), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrmArr), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colArr), 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(this.swyArr), 1));
    g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(this.emtArr), 1));
    g.setAttribute('aGloss', new THREE.BufferAttribute(new Float32Array(this.glsArr), 1));
    const count = this.posArr.length / 3;
    g.setIndex(count > 65535
      ? new THREE.BufferAttribute(new Uint32Array(this.idxArr), 1)
      : new THREE.BufferAttribute(new Uint16Array(this.idxArr), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/* ==========================================================================
 * 3. THE PALETTE
 *
 * One palette per biome. Every literal is a bible §6.1 / §6.5 authored albedo;
 * where the bible gives a range I took the midpoint and let the per-instance
 * hue/value jitter (scorecard #39) cover the rest.
 *
 * THE TONE-LADDER RULE (this is what the palette pass fixed)
 * ---------------------------------------------------------
 * Props carry no texture map at all — the paint is per-vertex colour. So the
 * only place "noise" can enter a prop is the LADDER: when two adjacent masses
 * of the same object are painted tones far apart in value, the object reads as
 * blotchy, and when the alternation is per-blade or per-lobe it reads as an
 * outright noise field. That was the failure here: `grassTuft` painted every
 * third blade at 61% of the tip value, `conifer` alternated tiers at 41%
 * apart, `boulder` alternated masses at 60% apart, and every canopy spanned
 * 1.5x from its darkest to its brightest lobe.
 *
 * RA3 does the opposite (`ra3steam_08.jpg`: the plaza hedges, the cypresses,
 * the parked cars). Each object is ONE flat saturated colour; the shape is
 * read from the silhouette and from broad facet lighting. So:
 *
 *   - Every within-object ladder below spans at most ~1.30x in value. Shading
 *     inside an object is the lighting's job and the baked AO ramp's job.
 *   - Ladders that span more than that are only allowed BETWEEN parts that are
 *     obviously different objects — trunk vs canopy, tyre vs car body.
 *   - Foliage hue stays in the 74-90 degree yellow-olive band, out of the
 *     emerald 100-120 the terrain agent is steering away from.
 *   - Man-made paint is saturated. RA3's street props are toys: a red car is
 *     genuinely red, not a dusty brick.
 * ========================================================================== */

/** Roughness a fully glossy prop surface reaches. See `PropMesh.gloss`. */
export const PROP_GLOSS_ROUGHNESS = 0.24;

export interface PropPalette {
  leafA: string; leafB: string; leafC: string;
  autumnA: string; autumnB: string; autumnC: string;
  conifer: string; coniferDark: string;
  frond: string;
  shrub: string; shrubDark: string; hedge: string;
  trunk: string; trunkDark: string;
  grassGold: string; grassGoldBase: string;
  grassGreen: string; grassGreenBase: string;
  /**
   * `rockShade` is kept in the contract for callers outside this file (cliff
   * skirts, scenario dressing) but the prop builders no longer use it: a
   * boulder is now ONE stone colour with a 0.90x step between overlapping
   * masses, because a 0.60x step made every boulder read as three rocks.
   */
  rock: string; rockShade: string; rockCap: string;
  soil: string; hay: string;
  /* man-made — biome independent, bible §6.1 / §6.3 */
  concrete: string; kerb: string;
  steel: string; darkSteel: string; rust: string;
  wood: string; woodDark: string;
  paintWhite: string; paintRed: string; paintYellow: string; paintBlue: string; paintGreen: string;
  glass: string; tyre: string; bronze: string;
  lampGlow: string; signalRed: string; signalAmber: string; signalGreen: string;
  flowerA: string; flowerB: string;
  crateA: string; crateB: string; containerA: string; containerB: string;
}

/**
 * Everything a man makes looks the same in every biome.
 *
 * Saturated. `ra3steam_08.jpg` parks yellow, red and white cars on a beige
 * plaza and the read at 40 px is entirely carried by their chroma; the previous
 * values here were all dusted toward grey and the whole street furniture set
 * disappeared into the pavement.
 */
const MANMADE = {
  concrete: '#A29D92', kerb: '#C8C2B6',
  steel: '#8A867C', darkSteel: '#343A40', rust: '#8A5A2E',
  wood: '#9A7442', woodDark: '#63492C',
  paintWhite: '#E2DCD0', paintRed: '#C22E24', paintYellow: '#E8B71E',
  paintBlue: '#2C56A6', paintGreen: '#2E8A50',
  glass: '#1C2833', tyre: '#1C1C1E', bronze: '#4E5A4A',
  lampGlow: '#F0DC9A', signalRed: '#E01418', signalAmber: '#FF9612', signalGreen: '#4CE05A',
  flowerA: '#C8318F', flowerB: '#F0C82E',
  crateA: '#C0913F', crateB: '#9C7330', containerA: '#B8382A', containerB: '#D07E22',
} as const;

/**
 * THE 76-DEGREE CEILING ON EVERY GREEN.
 *
 * Scorecard #9 fails any frame where more than 2% of pixels land in the
 * 100-120 degree "amateur emerald" window at S>0.25, V>0.15, and five of the
 * twelve critique shots were failing it at 2.8-4.9%. The leak was not the leaf
 * highlights — it was the DARK members (conifer, coniferDark, hedge, shrubDark,
 * grassGreenBase) plus the terrain grass layer.
 *
 * The mechanism is the grade, not the albedo: `TONE_NOON.shadowTint` is a
 * luma-normalised blue, so a shadowed pixel loses red faster than it loses
 * blue, and a dark green rotates about +20 degrees toward emerald on its way to
 * the framebuffer. Measured on `04-units-parade`: source `#383E12` at hue 84.5
 * arrived at `23,53,17`, hue 110.
 *
 * So every green in this file is authored with a hue CEILING of 76 degrees —
 * far enough below emerald that a shadowed instance still lands under 100.
 * Saturation and value are untouched: the rotation is a pure hue move, which is
 * why the palette still reads as the same foliage.
 */
const PALETTES: Record<BiomeName, PropPalette> = {
  temperate: {
    // leafA/B/C span 1.29x in value, all at the 76-degree ceiling. One tree.
    leafA: '#7E8A30', leafB: '#697328', leafC: '#8D9A3A',
    autumnA: '#D07C1E', autumnB: '#B25A18', autumnC: '#E0A62C',
    conifer: '#495018', coniferDark: '#383E12', frond: '#5F6A18',
    shrub: '#59602A', shrubDark: '#484E20', hedge: '#42481C',
    trunk: '#6A5238', trunkDark: '#4C3B28',
    grassGold: '#CBBA52', grassGoldBase: '#9A8A3A',
    grassGreen: '#92A038', grassGreenBase: '#6F7A28',
    rock: '#8A8270', rockShade: '#6E6857', rockCap: '#A39B88',
    soil: '#9C7B52', hay: '#CBBA52',
    ...MANMADE,
  },
  desert: {
    leafA: '#8E8A3C', leafB: '#767230', leafC: '#A09A4A',
    autumnA: '#CC8E28', autumnB: '#AE701C', autumnC: '#DEB84C',
    conifer: '#4B5220', coniferDark: '#3C4218', frond: '#687418',
    shrub: '#7A7638', shrubDark: '#635F2C', hedge: '#5F6828',
    trunk: '#7E6540', trunkDark: '#5A472E',
    grassGold: '#D8C662', grassGoldBase: '#A8964A',
    grassGreen: '#94983E', grassGreenBase: '#6E722C',
    rock: '#B0A382', rockShade: '#8E8368', rockCap: '#C8BA96',
    soil: '#C4A878', hay: '#D8C662',
    ...MANMADE,
  },
  snow: {
    leafA: '#60682A', leafB: '#535A24', leafC: '#6F7838',
    autumnA: '#9A7434', autumnB: '#7E5C26', autumnC: '#AE9450',
    conifer: '#3A4016', coniferDark: '#2D3210', frond: '#474E18',
    shrub: '#535A28', shrubDark: '#404618', hedge: '#454A22',
    trunk: '#584434', trunkDark: '#3C2E22',
    grassGold: '#B4A870', grassGoldBase: '#8A8054',
    grassGreen: '#7C844A', grassGreenBase: '#5C6234',
    rock: '#9A9A96', rockShade: '#7C7E80', rockCap: '#C6BEB6',
    soil: '#7A7066', hay: '#B4A870',
    ...MANMADE,
  },
  urban: {
    leafA: '#7E8A30', leafB: '#697328', leafC: '#8D9A3A',
    autumnA: '#D07C1E', autumnB: '#B25A18', autumnC: '#E0A62C',
    conifer: '#42481A', coniferDark: '#33380F', frond: '#5F6A18',
    shrub: '#59602A', shrubDark: '#484E20', hedge: '#42481C',
    trunk: '#6A5238', trunkDark: '#4C3B28',
    grassGold: '#C0B04E', grassGoldBase: '#8E8038',
    grassGreen: '#92A038', grassGreenBase: '#6F7A28',
    rock: '#8A857A', rockShade: '#6C6862', rockCap: '#A29C90',
    soil: '#8A7458', hay: '#C0B04E',
    ...MANMADE,
  },
};

export function propPalette(biome: BiomeName): PropPalette {
  return PALETTES[biome] ?? PALETTES.temperate;
}

/* ==========================================================================
 * 4. PLACEMENT METADATA
 *
 * The scatter system never hardcodes what a tree is; it reads these fields.
 * ========================================================================== */

export type PlacementMode =
  /** 3-9 members in a copse. Bible §6.5 clustering. */
  | 'clump'
  /** A broad low-density carpet over a whole habitat region. */
  | 'field'
  /** Regular pitch along a kerb line. Bible §6.3 street furniture. */
  | 'street'
  /** A one-off landmark, placed on its own with a wide exclusion. */
  | 'solo';

export type PropFamily = 'canopy' | 'shrub' | 'grass' | 'rock' | 'street' | 'yard' | 'civic';

/** Bitmasks over SurfaceId. */
export const SURF_SOFT = (1 << SurfaceId.Ground) | (1 << SurfaceId.Dirt) | (1 << SurfaceId.Sand);
export const SURF_HARD = (1 << SurfaceId.Concrete) | (1 << SurfaceId.Paving);
export const SURF_STONE = 1 << SurfaceId.Rock;
export const SURF_ANY = SURF_SOFT | SURF_HARD | SURF_STONE;

export interface PropDef {
  readonly key: string;
  readonly family: PropFamily;
  /** Footprint radius in metres — spacing and exclusion tests. */
  readonly radius: number;
  readonly height: number;
  /**
   * Metres of ground this prop counts as adorned for the 25x25 rule
   * (scorecard #15). Generous on purpose: an 11 m tree and its cast shadow
   * genuinely break up far more ground than its 2 m trunk does.
   */
  readonly adorn: number;
  /** Minimum metres between two instances of this type. */
  readonly spacing: number;
  readonly surfaces: number;
  /** Maximum ground slope, radians. */
  readonly maxSlope: number;
  readonly mode: PlacementMode;
  readonly clumpMin: number;
  readonly clumpMax: number;
  /** Radius of a clump, metres. */
  readonly clumpSpread: number;
  /** 0 = wilderness only, 1 = city only. Blended against MapPreset.urban. */
  readonly urban: number;
  /** Relative abundance per biome. 0 removes the type from that biome. */
  readonly biome: Readonly<Record<BiomeName, number>>;
  /** Would stop a tank. Advisory — scatter never writes the nav grid. */
  readonly blocksNav: boolean;
  /** Per-instance uniform scale band. Defaults to SCATTER_JITTER's. */
  readonly scaleMin?: number;
  readonly scaleMax?: number;
  /** Per-instance hue jitter multiplier. Man-made props want less than foliage. */
  readonly jitter?: number;
  readonly build: (m: PropMesh, rng: Rng, p: PropPalette) => void;
}

/* ==========================================================================
 * 5. THE BUILDERS
 *
 * Sizes are bible §6.5 (vegetation) and §6.3 (street furniture) verbatim.
 * 1 world unit = 1 metre is law, so every number below is metres.
 * ========================================================================== */

/** Bible 5.5 wants 2-4 px of bevel; at 29.6 px/m that is 0.068-0.135 m. */
function chamferFor(minDim: number): number {
  return clamp(minDim * 0.09, 0.02, 0.13);
}

/**
 * The foliage facet-jitter band. See `PropMesh.facetJitter` for why this is a
 * legitimate detail source and not the banned per-pixel noise.
 *
 * Applied to canopy blobs, conifer tiers and shrub lobes — the three places a
 * prop is a big smooth-reading mass of near-identical facets, and the two the
 * #34 crops named. Deliberately NOT applied to blade cards (grass tufts, palm
 * fronds, shrub twigs): a blade is 0.20 m wide, ~6 px on screen, and a colour
 * step across a 6 px card is the per-pixel noise the rule forbids.
 */
const FOLIAGE_FACET_VALUE = 0.14;
const FOLIAGE_FACET_HUE_DEG = 6;

/* ---- canopy -------------------------------------------------------------- */

function broadleaf(m: PropMesh, rng: Rng, p: PropPalette, autumn: boolean): void {
  const height = rng.range(9.5, 12.5);
  const canopyR = rng.range(3.6, 4.8);
  const trunkH = height * rng.range(0.34, 0.42);
  const trunkR = rng.range(0.28, 0.40);

  m.ao(0.42, 0, height * 0.55).sway(0, 0, 1).emissive(0);
  m.color(p.trunk).cyl(0, 0, 0, trunkR * 1.5, trunkR, trunkH, 12, chamferFor(trunkR * 2));
  // Root flares so the trunk is not a pipe stuck in the ground.
  m.color(p.trunkDark);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng.range(-0.4, 0.4);
    m.box(Math.cos(a) * trunkR * 0.9, 0.20, Math.sin(a) * trunkR * 0.9,
      trunkR * 0.8, 0.60, trunkR * 0.8, 0.05, a);
  }
  /*
   * CANOPY: BRANCHES CARRYING LOBE CLUSTERS, NOT FOUR BIG ELLIPSOIDS.
   *
   * What this replaced: three vertical stubs plus four `blob(r=canopyR, 10, 5)`
   * overlapping ellipsoids. Two measured defects, both structural.
   *
   *   1. A facet was 2*pi*4.2/10 = 2.64 m, which is ~85 px at fixture 01's
   *      32.2 px/m and ~170 px at 03. The chord sagitta left ~6.6 px of
   *      dead-straight edge per segment: a visibly polygonal rim.
   *   2. A union of ellipsoids is CONVEX BY CONSTRUCTION, so it cannot produce
   *      a hole. Measured on the shipped build over six seeds, the canopy
   *      silhouette filled 98.7-100% of its own convex hull with zero enclosed
   *      gaps. Sky through a canopy is most of what makes one read as organic,
   *      and this one could not have any.
   *
   * So: 6-8 limbs radiating off the trunk onto a squashed crown shell, each
   * ending in a cluster of 3-6 small `blob(r 0.6-1.1, 6, 3)` lobes. The union
   * is non-convex because the gaps BETWEEN clusters are never filled by a
   * lobe, and it shows sky because 26-32 lobes at ~0.85 m cover only a
   * fraction of a 4 m shell.
   *
   * Re-measured with the same instrument, 7 seeds x both keys:
   *
   *              hull fill      enclosed sky      triangles
   *   before     98.7-100%      0.0% on EVERY     688
   *   after      55.2-79.7%     3.1-18.8%         920-1088 (mean ~1010)
   *
   * "Enclosed sky" is empty silhouette area the border flood-fill cannot
   * reach — a hole you see the sky through, not a notch in the rim. Before,
   * there was not one on any seed, which is what convex-by-construction means.
   *
   * Lobe facets are ~2*pi*0.85/6 = 0.89 m, ~29 px at 01 — still a crisp,
   * crease-bounded shape carrying one flat colour, so `facetJitter` stays
   * legal under the "no per-pixel noise" rule and stays ON. Do NOT smooth
   * these normals: shared vertices delete the jitter and a smooth-shaded lobe
   * in one flat olive is the green balloon this replaced.
   *
   * Cost: +47% triangles on two of 31 prop types, +3.3% on the whole roster
   * (19 738 -> 20 394), and 0 extra draw calls — same InstancedMesh, same
   * material, same program. Triangles are not the constraint here; the colour
   * pass runs 51-77 draws against a budget of 130.
   */
  const cy = trunkH + canopyR * 0.62;
  const crownRy = canopyR * 0.88;
  // Bright, mid, dark — indexed by the height band below, so the crown is lit
  // on top and shaded underneath instead of speckled at random.
  const tones = autumn
    ? [p.autumnC, p.autumnA, p.autumnB]
    : [p.leafC, p.leafA, p.leafB];

  // One sway ramp and one AO ramp for the whole assembly. Both are functions of
  // Y alone, so a limb tip and the lobe sitting on it move together in wind
  // instead of the foliage sliding off its own branch.
  m.sway(SCATTER_WIND.canopyAmplitude, trunkH * 0.5, height);
  m.ao(0.60, trunkH * 0.6, height);

  /*
   * The lobe TOTAL is rolled, then dealt out across the branches — not rolled
   * per branch. `PropLibrary` bakes ONE mesh per key and instances it, so every
   * tree on the map is this tree: independent 6-8 branches x 3-5 lobes spans
   * 18..40 lobes, and the thin tail of that is a whole map of scraggly trees
   * from one unlucky seed. It was measured before it was fixed — rolling
   * per branch gave 896..1160 triangles and a 60.1% hull fill on the sparse
   * end. Dealing a 26-32 total holds the canopy mass still and lets the
   * branch count vary freely, which is the half that shows.
   */
  const branchN = rng.int(6, 8);
  const lobeTotal = rng.int(26, 32);
  for (let b = 0; b < branchN; b++) {
    // Azimuth is spread evenly and then kicked, so clusters cannot land in a
    // rosette; elevation runs from slightly drooping to 60 degrees up.
    const a = (b / branchN) * TAU + rng.range(-0.34, 0.34);
    const el = rng.range(-0.26, 1.05);
    // Deliberately reaches PAST the shell: the ellipsoid clamp below is what
    // fixes the outer envelope, so aiming the tips at it is what makes the
    // crown actually fill out to the bible's 7-10 m rather than fall short of
    // it on the seeds where the elevations happen to bunch.
    const reach = rng.range(0.78, 1.12);
    const ca = Math.cos(a), sa = Math.sin(a);
    const ce = Math.cos(el), se = Math.sin(el);
    const tipX = ca * ce * canopyR * reach;
    const tipY = cy + se * crownRy * reach;
    const tipZ = sa * ce * canopyR * reach;

    m.color(p.trunk);
    m.limb(
      ca * trunkR * 0.5, trunkH * rng.range(0.70, 0.94), sa * trunkR * 0.5,
      tipX, tipY, tipZ,
      trunkR * 0.52, trunkR * 0.16, 3, 2, canopyR * 0.09,
    );

    // The cluster. Offsets are taken along the limb axis, across it, and in Y,
    // so a cluster is an elongated mass following its branch rather than a ball.
    m.facetJitter(rng, FOLIAGE_FACET_VALUE, FOLIAGE_FACET_HUE_DEG);
    const lobeN = Math.floor((lobeTotal + b) / branchN);
    for (let k = 0; k < lobeN; k++) {
      const lr = rng.range(0.62, 1.10);
      const along = rng.range(-0.70, 1.05);
      const side = rng.range(-1.05, 1.05);
      const lift = rng.range(-0.70, 0.85);
      let lx = tipX + ca * ce * along - sa * side;
      let ly = tipY + se * along + lift;
      let lz = tipZ + sa * ce * along + ca * side;
      /*
       * Hold the crown inside the bible 6.5 broadleaf envelope — canopy 7-10 m
       * across, 9-13 m tall. Three independent offsets plus a lobe radius can
       * stack to 3 m of overhang on an unlucky roll, and `def.adorn` (7.0 m) is
       * what the scatter placer spaces clumps by, so an overhanging crown means
       * trees interpenetrating on the map.
       *
       * The clamp is OUTWARD ONLY: a lobe may sit anywhere inside the crown
       * ellipsoid and is only pulled back when it bulges past it. Every inward
       * bite survives, and the bites are the whole point.
       */
      const ex = canopyR - lr, ey = crownRy - lr;
      const q = Math.hypot(lx / ex, (ly - cy) / ey, lz / ex);
      if (q > 1) { lx /= q; ly = cy + (ly - cy) / q; lz /= q; }
      // Tone by height in the crown: a lit top, a shaded underside, one mid
      // band. Bible 6.5 asks for three colours per season and this is what they
      // are for — form, not confetti.
      const t = (ly - (cy - crownRy)) / (2 * crownRy);
      m.color(tones[t > 0.66 ? 0 : t > 0.38 ? 1 : 2]);
      m.blob(lx, ly, lz, lr, lr * rng.range(0.74, 0.98), lr, 6, 3, 0);
    }
    m.noFacetJitter();
  }
}

function buildTree(m: PropMesh, rng: Rng, p: PropPalette): void { broadleaf(m, rng, p, false); }
function buildTreeAutumn(m: PropMesh, rng: Rng, p: PropPalette): void { broadleaf(m, rng, p, true); }

function buildConifer(m: PropMesh, rng: Rng, p: PropPalette): void {
  const height = rng.range(9, 13);
  const baseR = rng.range(2.1, 2.9);
  const trunkH = height * 0.15;
  m.ao(0.40, 0, height * 0.4).sway(0, 0, 1);
  m.color(p.trunkDark).cyl(0, 0, 0, 0.34, 0.24, trunkH * 1.7, 10, 0.05);

  // 4 stacked cones, each ~0.74x the one below. The stepped silhouette is what
  // separates a conifer from a green traffic cone at RTS distance.
  m.sway(SCATTER_WIND.canopyAmplitude * 0.55, trunkH, height);
  m.ao(0.52, trunkH, height);
  // A cone is 12 tall triangles that differ only by their normal, and a conifer
  // is the darkest thing on the map — the shading spread across those 12 is
  // small enough in absolute terms that the whole tier reads as one silhouette.
  m.facetJitter(rng, FOLIAGE_FACET_VALUE, FOLIAGE_FACET_HUE_DEG);
  let y = trunkH;
  let r = baseR;
  for (let i = 0; i < 4; i++) {
    const h = (height - trunkH) * (0.38 - i * 0.035);
    m.color(i % 2 === 0 ? p.conifer : p.coniferDark);
    m.cone(0, y, 0, r, h * 2.0, 12, i === 0);
    y += h * 0.90;
    r *= 0.74;
  }
  m.noFacetJitter();
}

function buildPalm(m: PropMesh, rng: Rng, p: PropPalette): void {
  const height = rng.range(6.5, 9);
  const lean = rng.range(0.07, 0.17) * rng.sign();
  const segs = 7;
  const segH = height / segs;
  m.ao(0.45, 0, height * 0.6).sway(SCATTER_WIND.canopyAmplitude * 0.5, 0, height);
  m.color(p.trunk);
  let x = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const r = 0.30 - 0.11 * t;
    m.cyl(x, i * segH, 0, r, r * 0.94, segH * 1.03, 10, 0.035, i === 0, false);
    x += lean * segH * (0.4 + t);
  }
  // 8 fronds. Bible §6.5 palm span is 5-7 m, so each frond reaches ~3 m.
  m.color(p.frond).sway(SCATTER_WIND.canopyAmplitude * 1.4, height * 0.4, height + 1);
  m.ao(0.72, height * 0.5, height);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rng.range(-0.12, 0.12);
    m.blade(x, height, 0, Math.cos(a), Math.sin(a), rng.range(2.6, 3.4), 1.1, 0.85, 1.5, 4);
  }
  m.color(p.trunkDark).sway(SCATTER_WIND.canopyAmplitude * 0.6, height * 0.5, height);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    m.blob(x + Math.cos(a) * 0.28, height - 0.22, Math.sin(a) * 0.28, 0.22, 0.22, 0.22, 8, 4, 0);
  }
}

/* ---- shrub --------------------------------------------------------------- */

function buildBush(m: PropMesh, rng: Rng, p: PropPalette): void {
  const h = rng.range(1.2, 2.0);
  const r = rng.range(0.95, 1.45);
  m.ao(0.45, 0, h).sway(SCATTER_WIND.canopyAmplitude * 0.45, 0, h);
  m.facetJitter(rng, FOLIAGE_FACET_VALUE, FOLIAGE_FACET_HUE_DEG);
  // Lobes are deliberately UNEVEN in all three axes and offset well past their
  // own radius. A first pass used four concentric near-spheres and every bush
  // on the map read as a dark green beach ball.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.6, 0.6);
    const d = i === 0 ? 0 : r * rng.range(0.45, 0.85);
    const lr = r * (i === 0 ? 0.9 : rng.range(0.42, 0.70));
    m.color(i % 2 === 0 ? p.shrub : p.shrubDark);
    m.blob(
      Math.cos(a) * d, h * (i === 0 ? 0.46 : rng.range(0.34, 0.78)), Math.sin(a) * d,
      lr * rng.range(0.8, 1.25), h * rng.range(0.30, 0.50), lr * rng.range(0.8, 1.25),
      8, 4, 0.5,
    );
  }
  // Long twigs breaking the outline. These are what stop a shrub from reading
  // as a primitive at the 39-degree camera. Jitter OFF for them: a twig card is
  // 0.20 m wide and a colour step across ~6 px is noise, not a facet.
  m.noFacetJitter();
  m.color(p.shrubDark).sway(SCATTER_WIND.canopyAmplitude * 0.8, 0, h + 0.6);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rng.range(-0.35, 0.35);
    m.blade(
      Math.cos(a) * r * 0.2, h * rng.range(0.35, 0.62), Math.sin(a) * r * 0.2,
      Math.cos(a), Math.sin(a),
      r * rng.range(1.35, 1.85), h * rng.range(0.35, 0.62), 0.20,
      h * rng.range(0.2, 0.5), 3,
    );
  }
}

function buildHedge(m: PropMesh, rng: Rng, p: PropPalette): void {
  // Bible §6.1: "hedge foliage #353A16, 0.15 m leaf noise, BOX silhouette".
  // Rotated to #353A16 — same value and chroma, hue 87 -> 77 (see PALETTES).
  // ra3steam_08 borders every planted island with exactly this.
  const len = 3.6, w = 1.15, h = 1.25;
  m.ao(0.42, 0, h).sway(SCATTER_WIND.canopyAmplitude * 0.25, 0, h).gloss(0);
  m.color(p.hedge).box(0, h * 0.5, 0, len, h, w, 0.14);
  // The crown lobes are LIGHTER than the box, not darker. They sit on top and
  // catch the sun; painting them in `shrubDark` put a band of shadow along the
  // lit edge of every hedge in the plaza and read as mould.
  m.color(shadeOf(p.hedge, 1.16));
  const n = Math.round(len / 0.55);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    m.blob((t - 0.5) * len, h + rng.range(-0.06, 0.10), rng.range(-w * 0.28, w * 0.28),
      rng.range(0.20, 0.34), rng.range(0.12, 0.22), rng.range(0.20, 0.32), 6, 3, 0.4);
  }
}

/* ---- grass --------------------------------------------------------------- */

function grassTuft(m: PropMesh, rng: Rng, p: PropPalette, golden: boolean): void {
  // Bible §6.5: a radial fan of 14-20 tapered blade cards, each 0.15 m x
  // 1.4-1.8 m, tuft footprint 2.0-3.5 m, height 1.5-2.5 m, and TWO SPECIES
  // MIXED 50/50 — which is why `grassTuft` and `grassTuftGreen` are two keys.
  const tip = golden ? p.grassGold : p.grassGreen;
  const base = golden ? p.grassGoldBase : p.grassGreenBase;
  const h = rng.range(1.5, 2.2);
  const spread = rng.range(1.0, 1.6);
  const blades = 14;
  // ONE tone for the whole fan. Painting every third blade in `base` made a
  // tuft a 14-cell noise field at 0.16 m per cell — the exact salt-and-pepper
  // read the surface pass exists to kill, just built out of geometry instead of
  // texels. The vertical AO ramp below already darkens the roots, which is the
  // gradient the two-tone version was reaching for.
  m.ao(0.38, 0, h).sway(SCATTER_WIND.grassAmplitude, 0, h).gloss(0);
  m.color(tip);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + rng.range(-0.18, 0.18);
    m.blade(
      Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, Math.cos(a), Math.sin(a),
      spread * rng.range(0.7, 1.15), h * rng.range(0.72, 1.0), 0.16,
      h * rng.range(0.18, 0.42), 3,
    );
  }
  // The soil clump the fan grows out of — the one place `base` belongs, because
  // it is a different object from the blades, not a variation within them.
  m.color(base).sway(0, 0, 1);
  m.blob(0, 0.10, 0, 0.34, 0.16, 0.34, 7, 3, 0.5);
}

function buildGrassGold(m: PropMesh, rng: Rng, p: PropPalette): void { grassTuft(m, rng, p, true); }
function buildGrassGreen(m: PropMesh, rng: Rng, p: PropPalette): void { grassTuft(m, rng, p, false); }

/* ---- rock ---------------------------------------------------------------- */

function buildBoulder(m: PropMesh, rng: Rng, p: PropPalette): void {
  // Chamfered angular masses, not spheres — bible §6.4 wants architectural,
  // striated rock and a smooth sphere reads as a beach ball.
  const s = rng.range(1.5, 2.5);
  m.ao(0.40, 0, s * 1.4).sway(0, 0, 1).gloss(0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng.range(-0.5, 0.5);
    const d = i === 0 ? 0 : s * rng.range(0.25, 0.5);
    const w = s * rng.range(0.85, 1.30), hh = s * rng.range(0.60, 1.00), dd = s * rng.range(0.80, 1.20);
    // One flat stone colour with a single gentle step between overlapping
    // masses. The read comes from the FACETS and the painted chamfer band, not
    // from a second colour — a boulder alternating rock/rockShade at 0.6x was
    // three different rocks jammed together.
    m.color(i % 2 === 0 ? p.rock : shadeOf(p.rock, 0.90));
    m.box(Math.cos(a) * d, hh * 0.46, Math.sin(a) * d, w, hh, dd,
      chamferFor(Math.min(w, hh, dd)) * 2.2, rng.range(0, TAU));
  }
  // A lit cap facet — bible §6.4's coping read, scaled down to a boulder.
  m.color(p.rockCap).box(0, s * 0.64, 0, s * 0.70, 0.16, s * 0.60, 0.05, rng.range(0, TAU));
}

function buildRockCluster(m: PropMesh, rng: Rng, p: PropPalette): void {
  // Bible §6.4: "base skirted with 0.5-1.5 m boulders, 3-6 per 10 m of run".
  m.ao(0.42, 0, 1.4).sway(0, 0, 1).gloss(0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.4, 0.4);
    const d = rng.range(0.3, 1.5);
    const s = rng.range(0.45, 1.05);
    m.color(i % 3 === 0 ? shadeOf(p.rock, 0.90) : p.rock);
    m.box(Math.cos(a) * d, s * 0.42, Math.sin(a) * d, s * 1.3, s * 0.85, s * 1.1,
      chamferFor(s) * 2.0, rng.range(0, TAU));
  }
}

/* ---- yard ---------------------------------------------------------------- */

function buildHaystack(m: PropMesh, rng: Rng, p: PropPalette): void {
  const h = 3.4, r = 2.0;
  m.ao(0.44, 0, h).sway(0, 0, 1);
  m.color(p.hay).cyl(0, 0, 0, r, r * 0.86, h * 0.45, 12, 0.10);
  m.color(shadeOf(p.hay, 0.88)).cone(0, h * 0.45, 0, r * 0.92, h * 0.62, 12, false);
  m.color(p.woodDark).cyl(0, h * 0.95, 0, 0.08, 0.08, 0.8, 6, 0);
  // Rectangular bales leaning against the stack — the greeble that turns a
  // cone into a farmyard.
  m.color(p.hay);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    m.box(Math.cos(a) * (r + 0.55), 0.42, Math.sin(a) * (r + 0.55), 1.4, 0.80, 0.80, 0.07, a);
  }
}

/**
 * A timber crate is FLAT TAN WITH CRISP DARK SEAMS.
 *
 * Not tan-with-a-stripe, which is what this was. The RA3 read (`ra3steam_08`,
 * bottom centre, six crates against the plaza kerb) is a single unbroken slab
 * of warm colour framed by a hard dark batten at every corner and one rail
 * across the middle — drawn lines, geometrically placed, hard edged. Exactly
 * the `panelLines` treatment the unit and building surfaces get, expressed in
 * the only medium a prop has: thin unchamfered boxes proud of the face.
 *
 * The battens carry NO chamfer. A 0.06 m batten with a bevel band would be more
 * highlight than batten and the crisp line would turn into a smear.
 */
function crate(m: PropMesh, rng: Rng, p: PropPalette, x: number, y: number, z: number, s: number): void {
  const yaw = rng.range(-0.25, 0.25);
  const body = rng.chance(0.5) ? p.crateA : p.crateB;
  const seam = p.woodDark;
  const t = Math.max(s * 0.055, 0.035);   // batten thickness
  const w = Math.max(s * 0.10, 0.06);     // batten width
  const cy = y + s * 0.5;

  m.gloss(0.25);
  m.color(body).box(x, cy, z, s, s, s, chamferFor(s) * 1.6, yaw);

  m.color(seam).gloss(0.15);
  // Four vertical corner battens, one on each upright edge.
  const e = s * 0.5 - w * 0.5;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ox = sx * e, oz = sz * e;
      m.box(x + ox * cs + oz * sn, cy, z - ox * sn + oz * cs,
        w + t, s * 0.98, w + t, 0, yaw);
    }
  }
  // One rail all the way round at mid height, and one along the top lip.
  m.box(x, cy, z, s + t, w, s + t, 0, yaw);
  m.box(x, y + s - w * 0.5, z, s + t, w, s + t, 0, yaw);
  m.gloss(0);
}

function buildCrateStack(m: PropMesh, rng: Rng, p: PropPalette): void {
  m.ao(0.45, 0, 2.6).sway(0, 0, 1);
  const spots: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 0, 1.25, 0], [1.3, 0.15, 1.10, 0], [-1.2, -0.2, 1.15, 0],
    [0.2, 1.2, 1.00, 1.22], [1.1, 1.35, 0.85, 1.22],
  ];
  for (const [x, z, s, y] of spots) crate(m, rng, p, x, y, z, s);
}

function buildContainerStack(m: PropMesh, rng: Rng, p: PropPalette): void {
  // The container pile in ra3steam_05 — two corrugated boxes, slightly askew.
  m.ao(0.45, 0, 5.4).sway(0, 0, 1).gloss(0.45);
  const cols = [p.containerA, p.containerB];
  let y = 0;
  for (let i = 0; i < 2; i++) {
    const w = 6.0, h = 2.6, d = 2.4;
    const col = cols[i % cols.length];
    const ox = rng.range(-0.45, 0.45), oz = rng.range(-0.2, 0.2), oy = rng.range(-0.05, 0.05);
    m.color(col).box(ox, y + h * 0.5, oz, w, h, d, 0.10, oy);
    // Corrugation. This IS legitimate drawn structure — nine regular ribs on a
    // 6 m flank, hard edged and geometric, the container equivalent of a panel
    // line. It only had to come down from 0.80x to 0.86x so the flank reads as
    // one painted box with ribs rather than a nine-bar zebra.
    m.color(shadeOf(col, 0.86));
    for (let k = 0; k < 9; k++) {
      const x = ox + ((k + 0.5) / 9 - 0.5) * (w - 0.6);
      m.box(x, y + h * 0.5, oz + d * 0.5, 0.14, h - 0.34, 0.09, 0.02, oy);
      m.box(x, y + h * 0.5, oz - d * 0.5, 0.14, h - 0.34, 0.09, 0.02, oy);
    }
    // Corner castings.
    m.color(p.darkSteel).gloss(0.35);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        m.box(ox + sx * (w * 0.5 - 0.18), y + 0.16, oz + sz * (d * 0.5 - 0.18),
          0.34, 0.32, 0.34, 0.04, oy);
        m.box(ox + sx * (w * 0.5 - 0.18), y + h - 0.16, oz + sz * (d * 0.5 - 0.18),
          0.34, 0.32, 0.34, 0.04, oy);
      }
    }
    m.gloss(0.45);
    y += h + 0.06;
  }
  m.gloss(0);
}

/**
 * A GROUP of 3-4 drums, not a single barrel.
 *
 * One geometry per key means a lone-barrel prop would paint every barrel on the
 * map the same colour — per-instance `instanceColor` is a multiplier and cannot
 * turn olive into rust. Baking the group with mixed bodies fixes that in the
 * only place it can be fixed, and it matches the reference anyway: ra3steam_08
 * and _05 both show drums in threes and fours against a wall, never singly.
 */
function buildBarrelGroup(m: PropMesh, rng: Rng, p: PropPalette): void {
  const r = 0.42, h = 1.05;
  const bodies = [p.rust, '#646B33', p.paintRed, '#3E5A6E'];
  rng.shuffle(bodies);
  const n = rng.int(3, 4);
  // Painted steel drum: flat saturated colour, clean rolling hoops, a lacquer
  // sheen. No grime, no streaks — bible §0's "clean painted plastic toys".
  m.ao(0.45, 0, h).gloss(0.6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.3, 0.3);
    const d = i === 0 ? 0 : rng.range(0.62, 0.95);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const tipped = i === n - 1 && rng.chance(0.35);
    const body = bodies[i % bodies.length];
    if (tipped) {
      // One drum on its side, so the group has a silhouette instead of a
      // skyline of identical cylinders.
      m.color(body).box(x, r, z, h, r * 2, r * 2, 0.10, a);
      m.color(shadeOf(body, 0.78));
      m.box(x - h * 0.26, r, z, 0.09, r * 2.05, r * 2.05, 0.02, a);
      m.box(x + h * 0.26, r, z, 0.09, r * 2.05, r * 2.05, 0.02, a);
      continue;
    }
    m.color(body).cyl(x, 0, z, r, r, h, 14, 0.06);
    // Two rolling hoops and the top chime ring. Crisp, at 0.78x the body value
    // — enough to read as a line, not enough to read as a stripe pattern.
    m.color(shadeOf(body, 0.78));
    m.cyl(x, h * 0.26, z, r * 1.05, r * 1.05, 0.08, 14, 0.02, false, false);
    m.cyl(x, h * 0.66, z, r * 1.05, r * 1.05, 0.08, 14, 0.02, false, false);
    m.color(p.darkSteel).gloss(0.5);
    m.cyl(x, h - 0.05, z, r * 1.04, r * 1.04, 0.07, 14, 0.02, false, false);
    m.gloss(0.6);
    if (i === 0) {
      // One drum in the group carries a clean painted hazard band.
      m.color(p.paintYellow);
      m.cyl(x, h * 0.44, z, r * 1.03, r * 1.03, 0.13, 14, 0.02, false, false);
    }
  }
  m.gloss(0);
}

/* ---- street furniture ---------------------------------------------------- */

function streetLamp(m: PropMesh, rng: Rng, p: PropPalette, twin: boolean): void {
  // ra3steam_08 carries a dozen of these; they are the metronome of a block.
  const h = twin ? 7.4 : 6.4;
  m.ao(0.50, 0, h).sway(0, 0, 1).gloss(0);
  m.color(p.concrete).cyl(0, 0, 0, 0.34, 0.30, 0.24, 10, 0.05);
  // Painted steel column: flat colour, real specular. RA3's lamps read as a
  // dark glossy stick with a bright head, which is a roughness contrast.
  m.gloss(0.55);
  m.color(p.darkSteel).cyl(0, 0.20, 0, 0.16, 0.10, h, 12, 0.04, false, false);
  if (twin) {
    for (const s of [-1, 1]) {
      m.color(p.darkSteel);
      m.cyl(s * 0.55, h - 0.35, 0, 0.075, 0.075, 1.05, 8, 0.02, false, false);
      m.box(s * 0.55, h + 0.44, 0, 1.15, 0.18, 0.44, 0.05);
      m.color(p.lampGlow).emissive(1).box(s * 0.55, h + 0.31, 0, 0.95, 0.10, 0.34, 0.03);
      m.emissive(0);
    }
  } else {
    m.color(p.darkSteel).box(0.44, h + 0.12, 0, 1.30, 0.22, 0.42, 0.06);
    m.color(p.lampGlow).emissive(1).box(0.54, h - 0.01, 0, 0.98, 0.10, 0.32, 0.03);
    m.emissive(0);
  }
  // Banded collar at eye height — the greeble that says "not a stick".
  m.color(p.steel).cyl(0, 1.6, 0, 0.20, 0.20, 0.22, 12, 0.04, false, false);
  m.gloss(0);
}

function buildLamp(m: PropMesh, rng: Rng, p: PropPalette): void { streetLamp(m, rng, p, false); }
function buildLampTwin(m: PropMesh, rng: Rng, p: PropPalette): void { streetLamp(m, rng, p, true); }

function buildBench(m: PropMesh, rng: Rng, p: PropPalette): void {
  const len = 2.1;
  m.ao(0.50, 0, 0.9).sway(0, 0, 1);
  m.color(p.darkSteel).gloss(0.55);
  for (const s of [-1, 1]) {
    m.box(s * (len * 0.42), 0.22, 0, 0.10, 0.44, 0.62, 0.03);
    m.box(s * (len * 0.42), 0.64, -0.26, 0.10, 0.52, 0.10, 0.03);
  }
  // Varnished slats — a little sheen, one flat colour, the gaps between them
  // are the only "detail" a bench needs and they are real geometry.
  m.color(p.wood).gloss(0.3);
  for (let i = 0; i < 3; i++) m.box(0, 0.46, -0.20 + i * 0.20, len, 0.07, 0.16, 0.025);
  for (let i = 0; i < 2; i++) m.box(0, 0.68 + i * 0.20, -0.30, len, 0.16, 0.07, 0.025);
  m.gloss(0);
}

type CarShape = 'sedan' | 'van' | 'pickup';

function car(m: PropMesh, rng: Rng, p: PropPalette, shape: CarShape): void {
  // RA3's parked cars are saturated toys: ONE flat paint over the whole shell,
  // ONE continuous dark glass band round the greenhouse, ONE crisp crease down
  // the flank, and a lacquer highlight on the upper faces. No grime, no second
  // tone, no marbling (scorecard #22 applies to everything painted).
  const bodies = [p.paintYellow, p.paintRed, p.paintBlue, p.paintWhite, p.paintGreen];
  const body = rng.pick(bodies);
  const len = shape === 'van' ? 5.2 : shape === 'pickup' ? 5.0 : 4.3;
  const wid = shape === 'van' ? 2.1 : 1.9;
  m.ao(0.45, 0, 1.9).sway(0, 0, 1).gloss(0.85);

  m.color(body).box(0, 0.62, 0, len, 0.62, wid, chamferFor(0.62) * 2.4);
  if (shape === 'van') {
    m.box(0, 1.44, -len * 0.05, len * 0.86, 1.10, wid * 0.96, 0.10);
    m.color(p.glass).gloss(1);
    // One band, not three panes: the RA3 read at 40 px is a dark ribbon.
    m.box(-len * 0.06, 1.60, -len * 0.05, len * 0.74, 0.52, wid * 1.00, 0.03);
    m.color(body).gloss(0.85);
  } else if (shape === 'pickup') {
    m.box(-len * 0.16, 1.30, 0, len * 0.36, 0.72, wid * 0.94, 0.09);
    m.color(p.glass).gloss(1);
    m.box(-len * 0.16, 1.44, 0, len * 0.32, 0.42, wid * 1.00, 0.03);
    m.color(body).gloss(0.85);
    m.box(len * 0.24, 0.98, 0, len * 0.46, 0.42, wid * 0.94, 0.06);
    m.color(p.darkSteel).gloss(0.3);
    m.box(len * 0.24, 1.02, 0, len * 0.40, 0.06, wid * 0.80, 0.02);
    m.color(body).gloss(0.85);
  } else {
    m.box(0, 1.22, -len * 0.02, len * 0.56, 0.60, wid * 0.90, 0.11);
    m.color(p.glass).gloss(1);
    m.box(0, 1.28, -len * 0.02, len * 0.50, 0.40, wid * 0.96, 0.03);
    m.color(body).gloss(0.85);
  }
  // The one crease. A single hard dark line along the sill, drawn — not a
  // second paint tone smeared over the flank.
  m.color(shadeOf(body, 0.42)).gloss(0.7);
  m.box(0, 0.42, 0, len * 0.98, 0.05, wid + 0.02, 0);
  m.color(p.paintWhite).emissive(0.30).gloss(1);
  m.box(-len * 0.49, 0.72, wid * 0.30, 0.10, 0.18, 0.36, 0.03);
  m.box(-len * 0.49, 0.72, -wid * 0.30, 0.10, 0.18, 0.36, 0.03);
  m.color(p.signalRed).emissive(0.30);
  m.box(len * 0.49, 0.76, wid * 0.32, 0.09, 0.16, 0.30, 0.03);
  m.box(len * 0.49, 0.76, -wid * 0.32, 0.09, 0.16, 0.30, 0.03);
  m.emissive(0).gloss(0);
  m.color(p.tyre);
  const ax = len * 0.32;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Wheels lie in the XZ plane here (a disc on its side would need a full
      // rotation the builder does not carry); at RTS distance the read is the
      // dark arch under the sill, which this gives.
      m.box(sx * ax, 0.32, sz * (wid * 0.5 - 0.03), 0.72, 0.64, 0.26, 0.16);
    }
  }
}

function buildCarSedan(m: PropMesh, rng: Rng, p: PropPalette): void { car(m, rng, p, 'sedan'); }
function buildCarVan(m: PropMesh, rng: Rng, p: PropPalette): void { car(m, rng, p, 'van'); }
function buildCarPickup(m: PropMesh, rng: Rng, p: PropPalette): void { car(m, rng, p, 'pickup'); }

function buildTrafficLight(m: PropMesh, rng: Rng, p: PropPalette): void {
  const h = 5.4;
  m.ao(0.50, 0, h).sway(0, 0, 1).gloss(0);
  m.color(p.concrete).cyl(0, 0, 0, 0.30, 0.26, 0.20, 10, 0.05);
  m.gloss(0.55);
  m.color(p.darkSteel).cyl(0, 0.18, 0, 0.13, 0.10, h, 12, 0.03, false, false);
  const arm = 3.2;
  m.box(arm * 0.5, h - 0.15, 0, arm, 0.16, 0.16, 0.04);
  m.box(arm, h - 0.85, 0, 0.34, 1.24, 0.30, 0.05);
  m.color(p.signalRed).emissive(1).blob(arm, h - 0.44, 0.18, 0.10, 0.10, 0.05, 8, 3, 0);
  m.color(p.signalAmber).emissive(1).blob(arm, h - 0.85, 0.18, 0.10, 0.10, 0.05, 8, 3, 0);
  m.color(p.signalGreen).emissive(1).blob(arm, h - 1.26, 0.18, 0.10, 0.10, 0.05, 8, 3, 0);
  m.emissive(0);
  // Pole-mounted repeater head.
  m.color(p.darkSteel).box(0, h * 0.60, 0.24, 0.32, 1.14, 0.28, 0.05);
  m.color(p.signalRed).emissive(1).blob(0, h * 0.60 + 0.36, 0.40, 0.09, 0.09, 0.05, 8, 3, 0);
  m.color(p.signalAmber).emissive(1).blob(0, h * 0.60, 0.40, 0.09, 0.09, 0.05, 8, 3, 0);
  m.color(p.signalGreen).emissive(1).blob(0, h * 0.60 - 0.36, 0.40, 0.09, 0.09, 0.05, 8, 3, 0);
  m.emissive(0).gloss(0);
}

function fence(m: PropMesh, rng: Rng, p: PropPalette, iron: boolean): void {
  const len = 4.0;
  m.ao(0.48, 0, 1.6).sway(0, 0, 1);
  if (iron) {
    // Ornamental railing, as around the roundabout in ra3steam_08.
    m.color(p.darkSteel).gloss(0.55);
    m.box(0, 0.14, 0, len, 0.28, 0.26, 0.05);
    m.box(0, 1.32, 0, len, 0.10, 0.12, 0.03);
    m.box(0, 0.72, 0, len, 0.08, 0.10, 0.03);
    for (let i = 0; i < 9; i++) {
      const x = ((i + 0.5) / 9 - 0.5) * len;
      m.box(x, 0.78, 0, 0.06, 1.10, 0.06, 0.015);
      m.box(x, 1.42, 0, 0.09, 0.14, 0.09, 0.02);
    }
    for (const s of [-1, 1]) m.box(s * len * 0.5, 0.84, 0, 0.17, 1.62, 0.17, 0.035);
    m.gloss(0);
    return;
  }
  m.color(p.woodDark).gloss(0.15);
  for (const s of [-1, 1]) m.box(s * len * 0.5, 0.68, 0, 0.16, 1.36, 0.16, 0.035);
  m.color(p.wood);
  m.box(0, 1.14, 0, len, 0.14, 0.08, 0.025);
  m.box(0, 0.66, 0, len, 0.14, 0.08, 0.025);
  m.gloss(0);
}

function buildFenceWood(m: PropMesh, rng: Rng, p: PropPalette): void { fence(m, rng, p, false); }
function buildFenceIron(m: PropMesh, rng: Rng, p: PropPalette): void { fence(m, rng, p, true); }

function buildTelegraphPole(m: PropMesh, rng: Rng, p: PropPalette): void {
  const h = 9.5;
  m.ao(0.45, 0, h).sway(0, 0, 1);
  m.color(p.woodDark).gloss(0.15).cyl(0, 0, 0, 0.24, 0.17, h, 12, 0.04);
  for (let i = 0; i < 2; i++) {
    const y = h - 0.6 - i * 0.9;
    m.color(p.wood).box(0, y, 0, 2.4, 0.14, 0.14, 0.035);
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      m.color(p.glass).gloss(1).box(k * 0.5, y + 0.20, 0, 0.10, 0.24, 0.10, 0.02);
      m.gloss(0.15);
    }
  }
  m.color(p.darkSteel).gloss(0.55).box(0.55, h - 1.35, 0, 1.35, 0.08, 0.08, 0.02);
  m.gloss(0);
}

function roadSign(m: PropMesh, rng: Rng, p: PropPalette, rect: boolean): void {
  const h = 2.4;
  m.ao(0.50, 0, h + 0.8).sway(0, 0, 1);
  m.color(p.darkSteel).gloss(0.55).cyl(0, 0, 0, 0.09, 0.075, h, 10, 0.02);
  // A road sign IS a decal: two flat saturated colours with a hard boundary.
  // Retro-reflective sheeting is the glossiest thing on the street.
  m.gloss(0.9);
  if (rect) {
    m.color(p.paintWhite).box(0, h + 0.35, 0, 1.4, 0.70, 0.07, 0.03);
    m.color(p.paintBlue).box(0, h + 0.35, 0.05, 1.18, 0.48, 0.02, 0.01);
  } else {
    m.color(p.paintRed).cyl(0, h + 0.05, 0.036, 0.52, 0.52, 0.07, 12, 0.02);
    m.color(p.paintWhite).cyl(0, h + 0.05, 0.076, 0.36, 0.36, 0.03, 12, 0.01, false, true);
  }
  m.gloss(0);
}

function buildSignRect(m: PropMesh, rng: Rng, p: PropPalette): void { roadSign(m, rng, p, true); }
function buildSignDisc(m: PropMesh, rng: Rng, p: PropPalette): void { roadSign(m, rng, p, false); }

/* ---- civic --------------------------------------------------------------- */

function buildCafeUmbrella(m: PropMesh, rng: Rng, p: PropPalette): void {
  // The red cafe umbrellas are one of the most recognisable things in
  // ra3steam_08's plaza. Segmented canopy, alternating panels, a table under.
  const h = 2.45, r = 1.7;
  const accent = rng.chance(0.7) ? p.paintRed : p.paintBlue;
  m.ao(0.55, 0, h + 0.5).sway(SCATTER_WIND.canopyAmplitude * 0.30, 0.9, h + 0.6);
  m.color(p.steel).gloss(0.55).cyl(0, 0, 0, 0.32, 0.28, 0.14, 10, 0.03);
  m.color(p.paintWhite).gloss(0.7).cyl(0, 0.12, 0, 0.055, 0.05, h, 8, 0.015, false, false);
  // Canvas, not paint: matte, and the alternating panels are the detail. Eight
  // crisp wedges of two flat colours is exactly how RA3 draws these.
  m.gloss(0.2);

  // 8 sail panels from the finial down to the rim, alternating colour.
  const segs = 8;
  const apexY = h + 0.44, rimY = h - 0.28;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const am = (a0 + a1) * 0.5;
    m.color(i % 2 === 0 ? accent : p.paintWhite);
    // A scalloped rim: the mid point hangs 0.10 m lower and 6% further out.
    m.tri(0, apexY, 0, c0 * r, rimY, s0 * r, Math.cos(am) * r * 1.06, rimY - 0.10, Math.sin(am) * r * 1.06,
      Math.cos(am) * 0.3, 1, Math.sin(am) * 0.3);
    m.tri(0, apexY, 0, Math.cos(am) * r * 1.06, rimY - 0.10, Math.sin(am) * r * 1.06, c1 * r, rimY, s1 * r,
      Math.cos(am) * 0.3, 1, Math.sin(am) * 0.3);
    // Underside, so the canopy is not a one-sided sheet from a low angle.
    m.color(shadeOf(i % 2 === 0 ? accent : p.paintWhite, 0.64));
    m.tri(0, apexY - 0.05, 0, c0 * r, rimY - 0.05, s0 * r,
      Math.cos(am) * r * 1.06, rimY - 0.15, Math.sin(am) * r * 1.06, 0, -1, 0);
    m.tri(0, apexY - 0.05, 0, Math.cos(am) * r * 1.06, rimY - 0.15, Math.sin(am) * r * 1.06,
      c1 * r, rimY - 0.05, s1 * r, 0, -1, 0);
  }
  m.gloss(0.7);
  m.color(p.paintWhite).cyl(0, apexY, 0, 0.07, 0.03, 0.26, 6, 0);
  // Table + two chairs. An umbrella with no table reads as a mushroom.
  m.color(p.paintWhite).cyl(0, 0.70, 0, 0.72, 0.72, 0.08, 12, 0.03);
  m.color(p.steel).gloss(0.55).cyl(0, 0.14, 0, 0.09, 0.09, 0.56, 8, 0.02, false, false);
  for (const s of [-1, 1]) {
    m.color(p.paintWhite).gloss(0.7).box(s * 1.05, 0.44, 0, 0.46, 0.06, 0.46, 0.02);
    m.box(s * 1.05, 0.72, s * 0.20, 0.44, 0.50, 0.06, 0.02);
    m.color(p.steel).gloss(0.55);
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        m.box(s * 1.05 + dx * 0.18, 0.21, dz * 0.18, 0.05, 0.42, 0.05, 0.01);
      }
    }
  }
  m.gloss(0);
}

function statue(m: PropMesh, rng: Rng, p: PropPalette, equestrian: boolean): void {
  // ra3steam_08 has SIX of these. Plinth + hedged kerb + a bronze figure whose
  // silhouette only has to read at ~60 px.
  m.ao(0.42, 0, 5).sway(0, 0, 1);
  m.color(p.concrete).box(0, 0.18, 0, 4.6, 0.36, 3.4, 0.10);
  m.color(p.kerb).box(0, 0.46, 0, 3.8, 0.30, 2.8, 0.08);
  m.color(p.hedge);
  for (const s of [-1, 1]) {
    m.box(s * 2.10, 0.56, 0, 0.50, 0.74, 3.20, 0.10);
    m.box(0, 0.56, s * 1.50, 4.40, 0.74, 0.50, 0.10);
  }
  m.color(shadeOf(p.concrete, 1.08)).box(0, 1.12, 0, 1.9, 1.02, 1.5, 0.09);
  m.color(p.concrete).box(0, 1.74, 0, 1.6, 0.26, 1.25, 0.06);

  // Patinated bronze: one flat colour over the whole figure, with a genuine
  // specular so the silhouette catches the sun. `ra3steam_08`'s six statues are
  // read entirely from shape — there is no surface variation on them at all.
  m.color(p.bronze).gloss(0.5);
  if (equestrian) {
    m.box(0, 2.60, 0, 2.4, 0.88, 0.76, 0.12, 0.18);        // barrel
    m.box(-1.02, 3.20, 0, 0.56, 1.16, 0.56, 0.09, 0.18);   // neck
    m.box(-1.34, 3.84, 0, 0.86, 0.46, 0.42, 0.07, 0.18);   // head
    m.box(0.94, 2.12, 0.22, 0.30, 1.08, 0.30, 0.06);       // hind leg
    m.box(0.94, 2.12, -0.22, 0.30, 1.08, 0.30, 0.06);
    m.box(-0.52, 3.06, 0.30, 0.28, 1.10, 0.28, 0.05, 0.55); // raised foreleg
    m.box(-0.52, 3.06, -0.30, 0.28, 1.10, 0.28, 0.05, 0.55);
    m.box(0.72, 3.28, 0, 0.24, 0.90, 0.24, 0.05, -0.5);    // tail
    m.box(0.06, 3.42, 0, 0.62, 1.20, 0.56, 0.09);          // rider
    m.box(0.06, 4.18, 0, 0.44, 0.44, 0.42, 0.06);          // rider head
    m.box(-0.42, 3.90, 0, 0.62, 0.20, 0.20, 0.04, 0.3);    // outstretched arm
  } else {
    m.box(0, 2.48, 0, 1.14, 1.46, 0.88, 0.12);             // greatcoat
    m.box(0, 3.40, 0, 0.88, 0.56, 0.72, 0.10);             // shoulders
    m.box(0, 3.86, 0, 0.46, 0.46, 0.44, 0.07);             // head
    m.box(0.66, 3.62, 0, 0.26, 1.34, 0.26, 0.05);          // raised arm
    m.box(-0.56, 3.08, 0, 0.24, 1.02, 0.24, 0.05);         // lowered arm
    m.box(0, 1.92, 0.30, 1.30, 0.60, 0.30, 0.07, 0.15);    // flared hem
  }
  m.gloss(0);
}

function buildStatue(m: PropMesh, rng: Rng, p: PropPalette): void { statue(m, rng, p, false); }
function buildStatueRider(m: PropMesh, rng: Rng, p: PropPalette): void { statue(m, rng, p, true); }

function buildFlowerBed(m: PropMesh, rng: Rng, p: PropPalette): void {
  // Straight off ra3steam_08: a hedged rectangle of tilled soil packed with
  // magenta and yellow blooms in BLOCKED BANDS, not salt-and-pepper.
  const lx = 4.2, lz = 2.4;
  m.ao(0.55, 0, 0.7).sway(0, 0, 1);
  m.color(p.soil).box(0, 0.14, 0, lx, 0.28, lz, 0.06);
  m.color(p.hedge);
  m.box(0, 0.32, -lz * 0.5, lx, 0.64, 0.30, 0.07);
  m.box(0, 0.32, lz * 0.5, lx, 0.64, 0.30, 0.07);
  m.box(-lx * 0.5, 0.32, 0, 0.30, 0.64, lz, 0.07);
  m.box(lx * 0.5, 0.32, 0, 0.30, 0.64, lz, 0.07);
  m.sway(SCATTER_WIND.grassAmplitude * 0.7, 0.26, 0.80);
  const rows = 6, cols = 12;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols - 0.5) * (lx - 0.8);
      const z = ((r + 0.5) / rows - 0.5) * (lz - 0.8);
      // Bands of FOUR, not three. Wider bands mean fewer, larger colour
      // masses, which is what the reference shows — a magenta block and a
      // yellow block, not a chequerboard.
      m.color(Math.floor(c / 4) % 2 === 0 ? p.flowerA : p.flowerB);
      m.blob(x + rng.range(-0.05, 0.05), 0.38, z + rng.range(-0.05, 0.05),
        0.15, 0.13, 0.15, 6, 3, 0.3);
    }
  }
}

function buildWaterTower(m: PropMesh, rng: Rng, p: PropPalette): void {
  const legH = 7.0, tankH = 4.2, tankR = 2.4;
  m.ao(0.42, 0, legH + tankH).sway(0, 0, 1);
  m.color(p.darkSteel).gloss(0.45);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const x0 = Math.cos(a) * tankR * 0.85, z0 = Math.sin(a) * tankR * 0.85;
    // Splayed legs built as 3 stacked boxes so the lean is real geometry.
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      const s = 1 + 0.32 * (1 - t);
      m.box(x0 * s, legH * (t + 1 / 6), z0 * s, 0.26, legH / 3 + 0.06, 0.26, 0.04, a);
    }
    // X-brace — bible 5.7's exposed lattice, on a civilian scale.
    m.box(x0 * 1.10, legH * 0.50, z0 * 1.10, 0.14, 0.14, tankR * 1.6, 0.03, a + Math.PI / 4);
  }
  m.color(rng.chance(0.4) ? p.rust : p.steel);
  m.cyl(0, legH, 0, tankR, tankR, tankH, 14, 0.20);
  m.color(p.paintRed);
  m.cyl(0, legH + tankH * 0.60, 0, tankR * 1.01, tankR * 1.01, 0.44, 14, 0.03, false, false);
  m.color(p.darkSteel);
  m.cone(0, legH + tankH, 0, tankR * 0.98, 1.15, 14, false);
  m.cyl(0, legH + tankH + 1.0, 0, 0.18, 0.14, 0.9, 8, 0.03);
  // Railed catwalk (bible 5.7 #5).
  m.cyl(0, legH + tankH * 0.96, 0, tankR * 1.30, tankR * 1.30, 0.10, 14, 0.02);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    m.box(Math.cos(a) * tankR * 1.28, legH + tankH * 0.96 + 0.46, Math.sin(a) * tankR * 1.28,
      0.07, 0.86, 0.07, 0.02);
  }
  m.cyl(0, legH + tankH * 0.96 + 0.86, 0, tankR * 1.31, tankR * 1.31, 0.07, 14, 0.02, false, false);
  m.gloss(0);
}

/* ==========================================================================
 * 6. THE ROSTER
 * ========================================================================== */

const B = (t: number, d: number, s: number, u: number): Record<BiomeName, number> =>
  ({ temperate: t, desert: d, snow: s, urban: u });

export const PROP_DEFS: readonly PropDef[] = [
  /* --- canopy ---------------------------------------------------------- */
  { key: 'tree', family: 'canopy', radius: 2.2, height: 12, adorn: 7.0, spacing: 4.5,
    surfaces: SURF_SOFT, maxSlope: 0.38, mode: 'clump', clumpMin: 3, clumpMax: 9,
    clumpSpread: 11, urban: 0.35, biome: B(1.00, 0.10, 0.15, 0.55), blocksNav: true,
    build: buildTree },
  // The off-season 30% of bible §6.5's "season mixing". A separate key because
  // instancing cannot swap geometry and a hue multiply cannot turn green orange.
  { key: 'treeAutumn', family: 'canopy', radius: 2.2, height: 12, adorn: 7.0, spacing: 4.5,
    surfaces: SURF_SOFT, maxSlope: 0.38, mode: 'clump', clumpMin: 2, clumpMax: 6,
    clumpSpread: 11, urban: 0.45, biome: B(0.42, 0.06, 0.05, 0.36), blocksNav: true,
    build: buildTreeAutumn },
  { key: 'conifer', family: 'canopy', radius: 1.9, height: 12, adorn: 6.0, spacing: 4.0,
    surfaces: SURF_SOFT, maxSlope: 0.46, mode: 'clump', clumpMin: 4, clumpMax: 9,
    clumpSpread: 12, urban: 0.25, biome: B(0.70, 0.05, 1.00, 0.40), blocksNav: true,
    build: buildConifer },
  { key: 'palm', family: 'canopy', radius: 1.6, height: 8.5, adorn: 6.0, spacing: 5.0,
    surfaces: SURF_SOFT, maxSlope: 0.30, mode: 'clump', clumpMin: 2, clumpMax: 5,
    clumpSpread: 9, urban: 0.30, biome: B(0.10, 0.85, 0.00, 0.18), blocksNav: true,
    build: buildPalm },

  /* --- shrub ----------------------------------------------------------- */
  { key: 'bush', family: 'shrub', radius: 1.1, height: 1.8, adorn: 3.4, spacing: 2.0,
    surfaces: SURF_SOFT, maxSlope: 0.55, mode: 'clump', clumpMin: 4, clumpMax: 11,
    clumpSpread: 8, urban: 0.30, biome: B(1.00, 0.85, 0.55, 0.60), blocksNav: false,
    build: buildBush },
  { key: 'hedge', family: 'shrub', radius: 1.9, height: 1.3, adorn: 4.2, spacing: 3.5,
    surfaces: SURF_ANY, maxSlope: 0.16, mode: 'street', clumpMin: 3, clumpMax: 8,
    clumpSpread: 14, urban: 0.90, biome: B(0.55, 0.35, 0.30, 1.00), blocksNav: false,
    jitter: 0.5, build: buildHedge },

  /* --- grass (the density workhorse) ------------------------------------ */
  { key: 'grassTuft', family: 'grass', radius: 1.3, height: 2.1, adorn: 3.0, spacing: 1.9,
    surfaces: (1 << SurfaceId.Ground) | (1 << SurfaceId.Dirt), maxSlope: 0.60,
    mode: 'field', clumpMin: 5, clumpMax: 16, clumpSpread: 9,
    urban: 0.10, biome: B(1.00, 0.95, 0.45, 0.45), blocksNav: false, build: buildGrassGold },
  { key: 'grassTuftGreen', family: 'grass', radius: 1.3, height: 2.1, adorn: 3.0, spacing: 1.9,
    surfaces: (1 << SurfaceId.Ground) | (1 << SurfaceId.Dirt), maxSlope: 0.60,
    mode: 'field', clumpMin: 5, clumpMax: 16, clumpSpread: 9,
    urban: 0.10, biome: B(1.00, 0.55, 0.40, 0.45), blocksNav: false, build: buildGrassGreen },

  /* --- rock --------------------------------------------------------------
   * BIOME WEIGHTS CUT 35%, and the clump sizes with them.
   *
   * "reduce the number of boulders and rocks by at least 30% all around, they
   * spawn way too much and causing other bugs." The weight is the per-biome
   * share this type claims of the scatter budget, so a 35% cut here is a 35%
   * cut in rocks on the ground — clearing the 30% bar with margin rather than
   * landing exactly on it and needing a second pass.
   *
   * THE CLUMP RANGE IS THE OTHER HALF. Weight decides how often a clump is
   * placed; `clumpMin/Max` decides how many rocks each one drops. A boulder
   * clump of 2-6 at weight 1.0 and a clump of 2-4 at weight 0.65 differ by far
   * more than the weight alone suggests, and it is the CLUMP that reads as "way
   * too much" — six boulders in a twelve-metre spread is a rockfall, not
   * scenery.
   *
   * `boulder` carries `blocksNav: true` at a 2.0 m radius, so this is also the
   * "causing other bugs" half: see the deploy-fouling measurement in
   * `MAP_PRESETS` and in tests/start-clearance.spec.ts.
   * ---------------------------------------------------------------------- */
  { key: 'boulder', family: 'rock', radius: 2.0, height: 2.8, adorn: 5.0, spacing: 3.6,
    surfaces: SURF_SOFT | SURF_STONE, maxSlope: 0.75, mode: 'clump',
    clumpMin: 2, clumpMax: 4, clumpSpread: 12,
    urban: 0.10, biome: B(0.46, 0.65, 0.55, 0.20), blocksNav: true, build: buildBoulder },
  { key: 'rockCluster', family: 'rock', radius: 1.7, height: 1.2, adorn: 4.2, spacing: 2.8,
    surfaces: SURF_SOFT | SURF_STONE, maxSlope: 0.85, mode: 'field',
    clumpMin: 2, clumpMax: 6, clumpSpread: 10,
    urban: 0.13, biome: B(0.55, 0.65, 0.59, 0.26), blocksNav: false, build: buildRockCluster },

  /* --- yard ------------------------------------------------------------ */
  { key: 'haystack', family: 'yard', radius: 2.4, height: 3.4, adorn: 5.0, spacing: 5.5,
    surfaces: SURF_SOFT, maxSlope: 0.14, mode: 'clump', clumpMin: 2, clumpMax: 4,
    clumpSpread: 10, urban: 0.25, biome: B(0.70, 0.45, 0.30, 0.25), blocksNav: true,
    build: buildHaystack },
  { key: 'crateStack', family: 'yard', radius: 2.2, height: 2.3, adorn: 4.6, spacing: 4.0,
    surfaces: SURF_ANY, maxSlope: 0.12, mode: 'clump', clumpMin: 1, clumpMax: 4,
    clumpSpread: 9, urban: 0.85, biome: B(0.55, 0.80, 0.50, 1.00), blocksNav: true,
    jitter: 0.6, build: buildCrateStack },
  { key: 'containerStack', family: 'yard', radius: 3.4, height: 5.3, adorn: 7.0, spacing: 8.0,
    surfaces: SURF_HARD | (1 << SurfaceId.Dirt), maxSlope: 0.08, mode: 'clump',
    clumpMin: 1, clumpMax: 3, clumpSpread: 12,
    urban: 1.00, biome: B(0.35, 0.60, 0.35, 1.00), blocksNav: true,
    scaleMin: 0.96, scaleMax: 1.05, jitter: 0.5, build: buildContainerStack },
  // A group of 3-4 drums. Share deliberately low: barrels are punctuation, and
  // a first pass of this roster carpeted an urban map in red cylinders.
  { key: 'barrel', family: 'yard', radius: 1.2, height: 1.1, adorn: 3.0, spacing: 4.5,
    surfaces: SURF_ANY, maxSlope: 0.16, mode: 'clump', clumpMin: 1, clumpMax: 3,
    clumpSpread: 5.0, urban: 0.75, biome: B(0.22, 0.34, 0.20, 0.40), blocksNav: false,
    jitter: 0.6, build: buildBarrelGroup },

  /* --- street ---------------------------------------------------------- */
  { key: 'streetLamp', family: 'street', radius: 0.5, height: 7.0, adorn: 6.5, spacing: 7.0,
    surfaces: SURF_ANY, maxSlope: 0.18, mode: 'street', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 1.00, biome: B(0.75, 0.75, 0.75, 1.00), blocksNav: false,
    scaleMin: 0.95, scaleMax: 1.08, jitter: 0.25, build: buildLamp },
  { key: 'streetLampTwin', family: 'street', radius: 0.5, height: 8.0, adorn: 7.0, spacing: 9.0,
    surfaces: SURF_ANY, maxSlope: 0.18, mode: 'street', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 1.00, biome: B(0.35, 0.35, 0.35, 0.70), blocksNav: false,
    scaleMin: 0.95, scaleMax: 1.06, jitter: 0.25, build: buildLampTwin },
  { key: 'bench', family: 'street', radius: 1.2, height: 0.9, adorn: 3.2, spacing: 4.0,
    surfaces: SURF_HARD, maxSlope: 0.12, mode: 'street', clumpMin: 1, clumpMax: 2,
    clumpSpread: 6, urban: 1.00, biome: B(0.60, 0.60, 0.60, 1.00), blocksNav: false,
    scaleMin: 0.95, scaleMax: 1.05, jitter: 0.5, build: buildBench },
  { key: 'carSedan', family: 'street', radius: 2.4, height: 1.6, adorn: 4.4, spacing: 3.2,
    surfaces: SURF_HARD, maxSlope: 0.10, mode: 'street', clumpMin: 2, clumpMax: 6,
    clumpSpread: 14, urban: 1.00, biome: B(0.70, 0.70, 0.70, 1.00), blocksNav: true,
    scaleMin: 0.96, scaleMax: 1.06, jitter: 0.4, build: buildCarSedan },
  { key: 'carVan', family: 'street', radius: 2.8, height: 2.6, adorn: 4.8, spacing: 3.6,
    surfaces: SURF_HARD, maxSlope: 0.10, mode: 'street', clumpMin: 1, clumpMax: 3,
    clumpSpread: 14, urban: 1.00, biome: B(0.55, 0.55, 0.55, 1.00), blocksNav: true,
    scaleMin: 0.96, scaleMax: 1.06, jitter: 0.4, build: buildCarVan },
  { key: 'carPickup', family: 'street', radius: 2.6, height: 2.0, adorn: 4.6, spacing: 3.4,
    surfaces: SURF_HARD, maxSlope: 0.10, mode: 'street', clumpMin: 1, clumpMax: 3,
    clumpSpread: 14, urban: 0.90, biome: B(0.70, 0.80, 0.60, 1.00), blocksNav: true,
    scaleMin: 0.96, scaleMax: 1.06, jitter: 0.4, build: buildCarPickup },
  { key: 'trafficLight', family: 'street', radius: 0.5, height: 5.4, adorn: 5.5, spacing: 22,
    surfaces: SURF_ANY, maxSlope: 0.16, mode: 'street', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 1.00, biome: B(0.45, 0.45, 0.45, 1.00), blocksNav: false,
    scaleMin: 0.97, scaleMax: 1.05, jitter: 0.2, build: buildTrafficLight },
  { key: 'fence', family: 'street', radius: 2.1, height: 1.5, adorn: 4.0, spacing: 3.9,
    surfaces: SURF_ANY, maxSlope: 0.22, mode: 'street', clumpMin: 3, clumpMax: 9,
    clumpSpread: 20, urban: 0.55, biome: B(0.85, 0.75, 0.65, 0.55), blocksNav: false,
    scaleMin: 0.98, scaleMax: 1.04, jitter: 0.5, build: buildFenceWood },
  { key: 'railing', family: 'street', radius: 2.1, height: 1.7, adorn: 4.0, spacing: 3.9,
    surfaces: SURF_HARD, maxSlope: 0.18, mode: 'street', clumpMin: 4, clumpMax: 12,
    clumpSpread: 24, urban: 1.00, biome: B(0.35, 0.35, 0.35, 1.00), blocksNav: false,
    scaleMin: 0.99, scaleMax: 1.02, jitter: 0.25, build: buildFenceIron },
  { key: 'telegraphPole', family: 'street', radius: 0.5, height: 9.5, adorn: 7.0, spacing: 30,
    surfaces: SURF_ANY, maxSlope: 0.28, mode: 'street', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 0.60, biome: B(0.85, 0.85, 0.75, 0.90), blocksNav: false,
    scaleMin: 0.95, scaleMax: 1.08, jitter: 0.35, build: buildTelegraphPole },
  { key: 'roadSign', family: 'street', radius: 0.4, height: 3.2, adorn: 3.4, spacing: 16,
    surfaces: SURF_ANY, maxSlope: 0.20, mode: 'street', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 0.95, biome: B(0.60, 0.60, 0.60, 1.00), blocksNav: false,
    scaleMin: 0.95, scaleMax: 1.05, jitter: 0.3, build: buildSignRect },
  { key: 'roadSignDisc', family: 'street', radius: 0.4, height: 3.0, adorn: 3.2, spacing: 16,
    surfaces: SURF_ANY, maxSlope: 0.20, mode: 'street', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 0.95, biome: B(0.50, 0.50, 0.50, 0.90), blocksNav: false,
    scaleMin: 0.95, scaleMax: 1.05, jitter: 0.3, build: buildSignDisc },

  /* --- civic ----------------------------------------------------------- */
  { key: 'cafeUmbrella', family: 'civic', radius: 1.8, height: 2.9, adorn: 4.0, spacing: 3.4,
    surfaces: SURF_HARD, maxSlope: 0.08, mode: 'clump', clumpMin: 3, clumpMax: 7,
    clumpSpread: 7, urban: 1.00, biome: B(0.55, 0.55, 0.20, 1.00), blocksNav: false,
    scaleMin: 0.92, scaleMax: 1.10, jitter: 0.45, build: buildCafeUmbrella },
  { key: 'flowerBed', family: 'civic', radius: 2.4, height: 0.8, adorn: 5.0, spacing: 6.0,
    surfaces: SURF_ANY, maxSlope: 0.12, mode: 'solo', clumpMin: 1, clumpMax: 2,
    clumpSpread: 8, urban: 0.95, biome: B(0.60, 0.30, 0.20, 1.00), blocksNav: false,
    scaleMin: 0.90, scaleMax: 1.15, jitter: 0.6, build: buildFlowerBed },
  { key: 'statue', family: 'civic', radius: 2.6, height: 4.6, adorn: 8.0, spacing: 26,
    surfaces: SURF_ANY, maxSlope: 0.08, mode: 'solo', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 1.00, biome: B(0.40, 0.40, 0.35, 1.00), blocksNav: true,
    scaleMin: 0.94, scaleMax: 1.12, jitter: 0.3, build: buildStatue },
  { key: 'statueRider', family: 'civic', radius: 2.6, height: 4.9, adorn: 8.0, spacing: 26,
    surfaces: SURF_ANY, maxSlope: 0.08, mode: 'solo', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 1.00, biome: B(0.30, 0.30, 0.25, 0.85), blocksNav: true,
    scaleMin: 0.94, scaleMax: 1.12, jitter: 0.3, build: buildStatueRider },
  { key: 'waterTower', family: 'civic', radius: 3.2, height: 12.3, adorn: 9.0, spacing: 70,
    surfaces: SURF_ANY, maxSlope: 0.12, mode: 'solo', clumpMin: 1, clumpMax: 1,
    clumpSpread: 0, urban: 0.65, biome: B(0.80, 0.90, 0.70, 0.90), blocksNav: true,
    scaleMin: 0.92, scaleMax: 1.08, jitter: 0.3, build: buildWaterTower },
];

export const PROP_KEYS: readonly string[] = PROP_DEFS.map((d) => d.key);

const DEF_BY_KEY = new Map<string, PropDef>(PROP_DEFS.map((d) => [d.key, d]));

export function propDef(key: string): PropDef | undefined { return DEF_BY_KEY.get(key); }

/* ==========================================================================
 * 7. THE MATERIAL
 *
 * ONE MeshPhysicalMaterial for the whole roster. Four onBeforeCompile
 * injections:
 *
 *   aSway  -> wind displacement, per-instance phase read off instanceMatrix
 *   aEmit  -> additive emissive, so lamp heads and signal lenses glow without
 *             a second material and therefore without a second draw call
 *   aGloss -> per-vertex ROUGHNESS ONLY, so a parked car can be wet lacquer and
 *             the hedge beside it can be matte leaf without a second material.
 *             This is the whole surface-variation budget for props: RA3 splits
 *             a car from a hedge with a specular highlight over flat paint, and
 *             a roughness lerp is the entire cost of reproducing that. Nothing
 *             here touches albedo or normals, so no amount of it can become
 *             per-pixel noise.
 *   depth  -> the identical wind, so a swaying canopy never casts a frozen
 *             shadow
 *
 * Foliage gets only a whisper of clearcoat: bible §5.4 reserves the 0.30 coat
 * for painted armour, and a waxy leaf reads as plastic. `envMapIntensity` is
 * never 0 — zeroing it kills the silhouette rim scorecard #23 checks.
 * ========================================================================== */

export interface PropMaterialSet {
  readonly material: THREE.MeshPhysicalMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  /** Advance the wind clock. Called once per frame by the scatter system. */
  setTime(t: number): void;
  dispose(): void;
}

const WIND_PARS = /* glsl */`
attribute float aSway;
uniform float uWindTime;
uniform float uWindFreq;
`;

const WIND_BODY = /* glsl */`
{
  #ifdef USE_INSTANCING
    float swayPhase = instanceMatrix[3].x * 0.113 + instanceMatrix[3].z * 0.171;
  #else
    float swayPhase = 0.0;
  #endif
  float w = uWindTime * uWindFreq + swayPhase;
  // Two harmonics so the motion never reads as one clean sine.
  float sx = sin(w) * 0.78 + sin(w * 2.37 + swayPhase * 0.7) * 0.22;
  float sz = cos(w * 0.83 + swayPhase * 1.31) * 0.78 + cos(w * 2.11) * 0.22;
  transformed.x += sx * aSway;
  transformed.z += sz * aSway * 0.72;
}
`;

export function createPropMaterial(): PropMaterialSet {
  const uTime = { value: 0 };
  const uFreq = { value: SCATTER_WIND.hz * TAU };
  const uGain = { value: PROP_EMISSIVE_GAIN };
  const uGlossRough = { value: PROP_GLOSS_ROUGHNESS };

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: PROP_MATERIAL.roughness,
    metalness: PROP_MATERIAL.metalness,
    clearcoat: PROP_MATERIAL.clearcoat,
    clearcoatRoughness: PROP_MATERIAL.clearcoatRoughness,
    envMapIntensity: PROP_MATERIAL.envMapIntensity,
    emissive: 0x000000,
  });
  material.name = 'PropMaterial';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uTime;
    shader.uniforms.uWindFreq = uFreq;
    shader.uniforms.uEmitGain = uGain;
    shader.uniforms.uGlossRough = uGlossRough;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `#include <common>\n${WIND_PARS}\nattribute float aEmit;\nvarying float vEmit;`
        + '\nattribute float aGloss;\nvarying float vGloss;')
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>\nvEmit = aEmit;\nvGloss = aGloss;${WIND_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying float vEmit;\nuniform float uEmitGain;'
        + '\nvarying float vGloss;\nuniform float uGlossRough;')
      // Straight after roughness is resolved and before it reaches the BRDF.
      // A lerp, so vGloss = 0 leaves the matte default bit-for-bit untouched.
      .replace('#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, uGlossRough, vGloss);')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vEmit * uEmitGain;');

    // Scatter instances these as TALL, depth-writing meshes standing on the
    // terrain. Required by the depth-tested fog carpet: without it a forest
    // inside never-explored black would stay fully lit.
    // NB the injector reads `transformed` at <project_vertex>, i.e. AFTER the
    // wind displacement above, so a swaying tree samples where it actually is.
    applyShroudTint(shader);
  };
  // v3: the shroud self-tint changed the generated program.
  material.customProgramCacheKey = (): string => 'ra-prop-v3';

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.name = 'PropDepth';
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uTime;
    shader.uniforms.uWindFreq = uFreq;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${WIND_BODY}`);
  };
  depthMaterial.customProgramCacheKey = (): string => 'ra-prop-depth-v1';

  return {
    material,
    depthMaterial,
    setTime(t: number): void { uTime.value = t; },
    dispose(): void { material.dispose(); depthMaterial.dispose(); },
  };
}

/* ==========================================================================
 * 8. THE LIBRARY
 * ========================================================================== */

export interface PropGeometry {
  readonly def: PropDef;
  readonly geometry: THREE.BufferGeometry;
  readonly triangles: number;
  /** XZ bounding radius in metres — drives the instance culling sphere. */
  readonly boundRadius: number;
  readonly boundHeight: number;
  /**
   * FULL 3-D bounding-sphere radius in metres, unscaled.
   *
   * Deliberately not `boundRadius`: that one is the XZ half-extent, which is
   * the right measure for a culling disc and the WRONG one for "would this
   * thing's shadow read". A telegraph pole is 1.25 m across and 9.5 m tall, and
   * at the bible's 33-degree sun it throws a 14 m line that is plainly visible;
   * gating on the XZ figure would delete it. This is the same measure
   * `PROP_SHADOW_MIN_RADIUS` is tested against in src/render/RenderBridge.ts,
   * so the entity-prop gate and `SCATTER_SHADOW_MIN_RADIUS` in
   * src/world/Scatter.ts compare like with like.
   */
  readonly boundSphereRadius: number;
}

export interface PropLibraryOptions {
  readonly biome: BiomeName;
  readonly seed: number;
  /** Restrict the build to these keys. Omit to build everything the biome allows. */
  readonly keys?: readonly string[];
}

export class PropLibrary {
  readonly palette: PropPalette;
  readonly biome: BiomeName;
  private readonly built = new Map<string, PropGeometry>();
  totalTriangles = 0;
  buildMs = 0;

  constructor(options: PropLibraryOptions) {
    this.biome = options.biome;
    this.palette = propPalette(options.biome);
    const seed = options.seed >>> 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const wanted = options.keys && options.keys.length > 0 ? new Set(options.keys) : null;
    for (let i = 0; i < PROP_DEFS.length; i++) {
      const def = PROP_DEFS[i];
      if (wanted !== null && !wanted.has(def.key)) continue;
      if (def.biome[this.biome] <= 0) continue;
      // Each type gets its own stream so adding a type never reshuffles the
      // others — a map's props must not all move because a key was added.
      const rng = new Rng((seed ^ (i * 0x9e3779b1)) >>> 0);
      const mesh = new PropMesh();
      def.build(mesh, rng, this.palette);
      const geo = mesh.toGeometry(`prop.${def.key}`);
      this.totalTriangles += mesh.triangles;
      const bx = Math.max(Math.abs(mesh.min[0]), Math.abs(mesh.max[0]));
      const bz = Math.max(Math.abs(mesh.min[2]), Math.abs(mesh.max[2]));
      // Once per type per library build, never per instance and never per
      // frame. It also leaves `geo.boundingSphere` populated, which costs
      // nothing here: every consumer of these geometries sets
      // `frustumCulled = false` and culls by 32 m chunk instead.
      geo.computeBoundingSphere();
      this.built.set(def.key, {
        def,
        geometry: geo,
        triangles: mesh.triangles,
        boundRadius: Math.hypot(bx, bz),
        boundHeight: Math.max(mesh.max[1], 0.5),
        // Fall back to the XZ radius rather than 0 if the sphere could not be
        // computed — a 0 would silently opt the type out of every radius gate.
        boundSphereRadius: geo.boundingSphere !== null
          ? geo.boundingSphere.radius
          : Math.hypot(bx, bz),
      });
    }
    this.buildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }

  get(key: string): PropGeometry | undefined { return this.built.get(key); }
  has(key: string): boolean { return this.built.has(key); }
  keys(): string[] { return [...this.built.keys()]; }
  all(): PropGeometry[] { return [...this.built.values()]; }
  get count(): number { return this.built.size; }

  dispose(): void {
    for (const g of this.built.values()) g.geometry.dispose();
    this.built.clear();
    this.totalTriangles = 0;
  }
}

/**
 * Merge several prop geometries into one. Kept because a future pass may want
 * a single batch of the tiniest props; `mergeGeometries` needs identical
 * attribute sets, which every `PropMesh` output satisfies by construction.
 */
export function mergePropGeometries(
  parts: readonly THREE.BufferGeometry[],
  name: string,
): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts as THREE.BufferGeometry[], false);
  if (merged === null) return null;
  merged.name = name;
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}
