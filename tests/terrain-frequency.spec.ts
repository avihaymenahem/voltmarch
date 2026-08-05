/**
 * ============================================================================
 * tests/terrain-frequency.spec.ts — THE SANDPAPER CANNOT COME BACK
 * ============================================================================
 * `src/world/TerrainMaterial.ts` §3B-bis adds variation into the 0.32-1.25 m
 * band, which is a deliberate step back toward the thing the noise purge threw
 * out. The purge was right; what was wrong was stating its rule as "no noise"
 * instead of as a number. This file is the number.
 *
 * THE RULE, RESTATED SO IT CAN FAIL
 * ---------------------------------
 *   Every spatial frequency the terrain tiles introduce must have a shortest
 *   wavelength of at least MESO_MIN_SCREEN_PX screen pixels, at 1440p, at the
 *   closest gameplay zoom.
 *
 * The ban was never on "detail". It was on detail at or below the screen-pixel
 * scale, because that is what aliases: it crawls when the camera pans, it
 * sparkles under mipping, and it is what made the roads look like TV static.
 * A feature 30 pixels across is a shape. A feature 1 pixel across is noise.
 *
 * WHY THE ARITHMETIC LIVES HERE AND NOT IN THE SHIPPING FILE
 * ----------------------------------------------------------
 * `TerrainMaterial.ts` declares a constant with the derivation written out in
 * a comment. This file RE-DERIVES it from the live `RENDER_CONFIG.camera` and
 * refuses if the two disagree — the same arrangement `tests/shot-camera.spec.ts`
 * has with the pitch table in `tools/shoot.mjs`, and for the same reason. If
 * somebody lowers `minDistance` to let the player zoom further in, or flattens
 * `pitchAtMinDistance`, this suite goes red on the spot instead of the
 * sandpaper quietly reappearing three commits later.
 *
 * FOUR CHECKS, EACH CLOSING A DIFFERENT HOLE
 * ------------------------------------------
 *  1. THE CAMERA        — the declared metre floor really is >= the derived one.
 *  2. THE COMPONENTS    — every frequency component of every field layer of
 *                         every biome clears that floor, AT ITS HARMONIC ORDER.
 *                         A cubic shaper triples a field's bandwidth and a
 *                         product ADDS two fields' bandwidths, which is how a
 *                         "band-limited" construction stops being one.
 *  3. THE SPECTRUM      — an actual DFT of the actual generated field, asserting
 *                         zero energy above the declared cutoff. Structure
 *                         proves intent; this proves the implementation.
 *  4. THE INVARIANTS    — flat height, `r >= g`, no emerald texel. The three
 *                         properties the mesoscale term is most likely to break.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { RENDER_CONFIG } from '../src/render/renderer';
import { BIOMES, BIOME_NAMES, type SurfaceLayerDef } from '../src/world/Biomes';
import {
  MESO_FINE_METRES, MESO_FINE_WEIGHT, MESO_MIN_METRES, MESO_MIN_SCREEN_PX,
  MESO_MIN_TEXELS, MESO_PULL_MAX, MESO_WIDE_METRES, MESO_WIDE_ORDER,
  MESO_WIDE_WEIGHT, FIELD_MIN_WAVELENGTH,
  buildFieldSurface, mesoCycles, mesoField, mesoPull, mesoWaveSet,
  mesoWavelengthMetres,
} from '../src/world/TerrainMaterial';
import { TERRAIN_LAYER_TEXTURE_SIZE } from '../src/core/config';

/** The bible quotes its pixel tolerances at 1440p; so does `tools/shoot.mjs`. */
const VIEWPORT_HEIGHT_PX = 1440;

const DEG = Math.PI / 180;

/* ==========================================================================
 * 1. THE CAMERA — ground metres per screen pixel, worst case
 * ========================================================================== */

/**
 * Metres of ground per screen pixel at the FINEST point the player can ever
 * put on screen, derived from nothing but `RENDER_CONFIG.camera`.
 *
 * Three steps, and each one is a worst case rather than a typical case:
 *
 *  a. The projection. A vertical fov of `f` over `H` pixels puts
 *     `2*tan(f/2)/H` metres of the view plane on one pixel, per metre of slant
 *     range. This is exact for a pinhole camera and independent of pitch.
 *
 *  b. The nearest ground in frame. The camera orbits its focus at `distance`
 *     with the ground plane below, so its height is `distance * sin(pitch)`.
 *     The bottom edge of the frame looks down at `pitch + fov/2`, steeper than
 *     the centre, and therefore hits the ground CLOSER: at a slant range of
 *     `height / sin(pitch + fov/2)`. Everything else in frame is further away
 *     and so coarser per pixel.
 *
 *  c. The finer of the two screen axes. Screen-horizontal lies in the ground
 *     plane (the rig only yaws about +Y), so it is not foreshortened at all.
 *     Screen-vertical is divided by the sine of the grazing angle and is
 *     therefore always COARSER in ground metres per pixel. Horizontal binds.
 *
 * Note which way each camera knob is dangerous: a SMALLER `minDistance` and a
 * SHALLOWER `pitchAtMinDistance` both shrink this number. Steeper pitch makes
 * it larger, so the current 46 degrees is the risky end of the clamp already.
 */
function groundMetresPerPixel(): number {
  const cam = RENDER_CONFIG.camera;
  const perMetreOfRange = (2 * Math.tan((cam.fov * DEG) / 2)) / VIEWPORT_HEIGHT_PX;

  const pitch = cam.pitchAtMinDistance * DEG;
  const height = cam.minDistance * Math.sin(pitch);
  // Clamped at straight down: past vertical the nearest point is the centre.
  const bottomRay = Math.min(pitch + (cam.fov * DEG) / 2, Math.PI / 2);
  const nearestRange = height / Math.sin(bottomRay);

  return nearestRange * perMetreOfRange;
}

/** The shortest ground wavelength the screen-pixel floor permits. */
function derivedFloorMetres(): number {
  return MESO_MIN_SCREEN_PX * groundMetresPerPixel();
}

describe('the screen-pixel floor', () => {
  it('the camera derivation still produces the numbers in the file header', () => {
    // Not pinning the config — pinning the ARITHMETIC. If these drift because
    // the camera moved, check 2 below is what tells you whether it matters.
    const cam = RENDER_CONFIG.camera;
    expect(cam.fov).toBeCloseTo(36, 6);
    expect(cam.minDistance).toBeCloseTo(30, 6);
    expect(cam.pitchAtMinDistance).toBeCloseTo(46, 6);
    expect(groundMetresPerPixel()).toBeCloseTo(0.010835, 5);
    expect(derivedFloorMetres()).toBeCloseTo(0.17336, 4);
  });

  it('the declared metre floor clears the derived one', () => {
    const derived = derivedFloorMetres();
    expect(
      MESO_MIN_METRES,
      `MESO_MIN_METRES ${MESO_MIN_METRES} m is below the ${derived.toFixed(4)} m that ` +
      `${MESO_MIN_SCREEN_PX} screen px at minDistance ${RENDER_CONFIG.camera.minDistance} m / ` +
      `pitch ${RENDER_CONFIG.camera.pitchAtMinDistance} deg requires. Either raise the ` +
      'constant or put the camera back.',
    ).toBeGreaterThanOrEqual(derived);
  });

  it('the floor is not so tight that a normal zoom change breaks it', () => {
    // Guard the guard. A floor with no margin fails on any camera tweak and
    // gets "fixed" by lowering the floor, which is the failure mode this whole
    // file exists to prevent. Demand at least 25% of headroom.
    expect(MESO_MIN_METRES / derivedFloorMetres()).toBeGreaterThan(1.25);
  });

  it('8 screen px is the floor below which nobody may go', () => {
    // Below 8 px a feature is inside the SMAA kernel and inside the mip
    // transition — exactly where the original per-pixel noise lived.
    expect(MESO_MIN_SCREEN_PX).toBeGreaterThanOrEqual(8);
  });
});

/* ==========================================================================
 * 2. THE COMPONENTS — every frequency, at its harmonic order
 * ========================================================================== */

/**
 * One frequency component a field tile introduces.
 *
 * `order` is the bandwidth multiplier of whatever the component is put through
 * before it reaches the albedo. A linear term is 1. `smoothstep` and any other
 * cubic is 3, because a cubic of a sum of sinusoids contains
 * `cos(a)cos(b)cos(c)` terms whose frequencies reach `f_a + f_b + f_c`. A
 * product of two fields is the SUM of their frequencies, not the max, which is
 * why the mesoscale term is added rather than lerped.
 */
interface Component {
  readonly label: string;
  readonly wavelengthMetres: number;
  readonly order: number;
}

/** Every frequency component `buildFieldSurface` puts into one layer. */
function componentsOf(L: SurfaceLayerDef, size: number): Component[] {
  const metresPerTexel = L.tileMetres / size;

  // --- the three pre-existing drifts, from buildFieldSurface -----------------
  const wlFine = Math.max(FIELD_MIN_WAVELENGTH, size / 5) * metresPerTexel;
  const wlWide = Math.max(FIELD_MIN_WAVELENGTH, size / 2.2) * metresPerTexel;
  const wlPatch = Math.max(FIELD_MIN_WAVELENGTH, size / 1.6) * metresPerTexel;

  const out: Component[] = [
    { label: 'drift.fine', wavelengthMetres: wlFine, order: 1 },
    { label: 'drift.wide', wavelengthMetres: wlWide, order: 1 },
    // The patch mask goes through `smoothstep`, a cubic.
    { label: 'patch.mask', wavelengthMetres: wlPatch, order: 3 },
    // ...and the result multiplies the drifted base colour through two lerps,
    // so the product term is at the SUM of the two frequencies.
    {
      label: 'patch.mask x drift.fine',
      wavelengthMetres: 1 / (3 / wlPatch + 1 / wlFine),
      order: 1,
    },
  ];

  // --- the mesoscale band ---------------------------------------------------
  // Realised wavelengths, i.e. after BOTH the metre floor and the texel floor.
  out.push({
    label: 'meso.fine',
    wavelengthMetres: mesoWavelengthMetres(size, L.tileMetres, MESO_FINE_METRES),
    order: 1,
  });
  out.push({
    label: 'meso.wide',
    wavelengthMetres: mesoWavelengthMetres(size, L.tileMetres, MESO_WIDE_METRES),
    order: MESO_WIDE_ORDER,
  });
  // The meso term is ADDED, so it forms no product with anything above. If a
  // future edit turns that `+=` back into a `lerp`, the component below is the
  // one that has to be added here — and it would be well under the floor.
  return out;
}

describe('every frequency a field tile introduces', () => {
  const cases: ReadonlyArray<readonly [string, SurfaceLayerDef]> = BIOME_NAMES.flatMap(
    (name) => BIOMES[name].layers
      .filter((L) => L.surface === 'field')
      .map((L) => [`${name}/${L.label}`, L] as const),
  );

  it('has at least one field layer per biome to check', () => {
    expect(cases.length).toBeGreaterThanOrEqual(BIOME_NAMES.length);
  });

  it('clears the metre floor at the production texture size', () => {
    for (const [id, L] of cases) {
      for (const c of componentsOf(L, TERRAIN_LAYER_TEXTURE_SIZE)) {
        const effective = c.wavelengthMetres / c.order;
        expect(
          effective,
          `${id} ${c.label}: fundamental ${c.wavelengthMetres.toFixed(3)} m at harmonic ` +
          `order ${c.order} => ${effective.toFixed(3)} m effective, under the ` +
          `${MESO_MIN_METRES} m floor`,
        ).toBeGreaterThanOrEqual(MESO_MIN_METRES);
      }
    }
  });

  it('clears the SCREEN-PIXEL floor, which is the property that matters', () => {
    const mpp = groundMetresPerPixel();
    for (const [id, L] of cases) {
      for (const c of componentsOf(L, TERRAIN_LAYER_TEXTURE_SIZE)) {
        const px = c.wavelengthMetres / c.order / mpp;
        expect(
          px,
          `${id} ${c.label} is ${px.toFixed(1)} screen px at minimum zoom, under the ` +
          `${MESO_MIN_SCREEN_PX} px floor`,
        ).toBeGreaterThanOrEqual(MESO_MIN_SCREEN_PX);
      }
    }
  });

  it('holds at the halved texture size the other suites generate at', () => {
    // tests/terrain-surfaces.spec.ts builds at 128. The texel floor is what
    // keeps that honest: at half the texels the metre request would be twice
    // as fine, and MESO_MIN_TEXELS catches it.
    for (const [id, L] of cases) {
      for (const c of componentsOf(L, 128)) {
        expect(c.wavelengthMetres / c.order, `${id} ${c.label} at size 128`)
          .toBeGreaterThanOrEqual(MESO_MIN_METRES);
      }
    }
  });

  it('the texel floor is never weaker than half the assets.ts floor', () => {
    // MESO_MIN_TEXELS is the one place in the game that goes below
    // NOISE_BUDGET.MIN_FEATURE_TEXELS, and it does so on a screen-pixel
    // argument. Halving it again would need a new argument, not a new value.
    expect(MESO_MIN_TEXELS).toBeGreaterThanOrEqual(10);
    for (const [id, L] of cases) {
      const size = TERRAIN_LAYER_TEXTURE_SIZE;
      const texels = L.tileMetres === 0 ? 0
        : size / mesoCycles(size, L.tileMetres, MESO_FINE_METRES);
      expect(texels, `${id} finest meso octave in texels`)
        .toBeGreaterThanOrEqual(MESO_MIN_TEXELS);
    }
  });

  it('the octave weights cannot push the field outside [-1, 1]', () => {
    // The amplitude bound is what makes the colour-axis reasoning in
    // TerrainMaterial hold: `|meso| <= 1` and `pull <= MESO_PULL_MAX`.
    expect(MESO_FINE_WEIGHT + MESO_WIDE_WEIGHT).toBeCloseTo(1, 9);
    expect(MESO_PULL_MAX).toBeLessThanOrEqual(1);
    const size = 64;
    let peak = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        peak = Math.max(peak, Math.abs(mesoField(x, y, size, 8, 1101)));
      }
    }
    expect(peak).toBeLessThanOrEqual(1);
    for (const [, L] of cases) expect(mesoPull(L)).toBeLessThanOrEqual(MESO_PULL_MAX);
  });
});

/* ==========================================================================
 * 3. THE SPECTRUM — a real DFT of the real field
 * ========================================================================== */

describe('the mesoscale field spectrum', () => {
  it('has no harmonic above the declared cutoff', () => {
    // Structural: read the wave set the generator actually built and check the
    // frequency of every harmonic in it. This is the bound the amplitude
    // clamp and the wavelength floor both rest on.
    for (const cycles of [3, 7, 10, 16, 25]) {
      for (const seed of [1101, 2102, 4104]) {
        const w = mesoWaveSet(cycles, seed, 256);
        for (let k = 0; k < w.nx.length; k++) {
          const mag = Math.hypot(w.nx[k], w.ny[k]);
          expect(mag, `harmonic ${k} of ${cycles} cycles is at ${mag.toFixed(2)}`)
            .toBeLessThanOrEqual(cycles + 1e-9);
          expect(mag).toBeGreaterThan(0);
        }
        // Amplitudes normalise to exactly 1 so `|octave| <= 1` is a bound.
        let sum = 0;
        for (let k = 0; k < w.amp.length; k++) sum += w.amp[k];
        expect(sum).toBeCloseTo(1, 6);
      }
    }
  });

  it('a DFT of the generated field is empty above the cutoff', () => {
    // Empirical, and it covers the CUBIC SHAPER, which no amount of reading the
    // wave set can. `mesoShape` is degree 3, so the field is allowed energy out
    // to 3x the wide octave's fundamental and nowhere beyond it.
    const size = 48;
    const tileMetres = 8;
    const seed = 1101;

    const field = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) field[y * size + x] = mesoField(x, y, size, tileMetres, seed);
    }

    const fineCut = mesoCycles(size, tileMetres, MESO_FINE_METRES);
    const wideCut = mesoCycles(size, tileMetres, MESO_WIDE_METRES) * MESO_WIDE_ORDER;
    const cutoff = Math.max(fineCut, wideCut);

    // Frequencies run -size/2..size/2; fold and measure power inside/outside.
    let inside = 0, outside = 0, worst = 0;
    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        let re = 0, im = 0;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const a = (-2 * Math.PI * (u * x + v * y)) / size;
            const s = field[y * size + x];
            re += s * Math.cos(a);
            im += s * Math.sin(a);
          }
        }
        const power = (re * re + im * im) / (size * size * size * size);
        const fu = u > size / 2 ? u - size : u;
        const fv = v > size / 2 ? v - size : v;
        const mag = Math.hypot(fu, fv);
        if (mag <= cutoff + 1e-9) inside += power;
        else { outside += power; worst = Math.max(worst, mag); }
      }
    }

    expect(inside).toBeGreaterThan(0);
    expect(
      outside / (inside + outside),
      `${(100 * outside / (inside + outside)).toFixed(4)}% of the field's power sits above ` +
      `${cycles(cutoff)} — highest offending frequency ${worst.toFixed(1)} cycles/tile. ` +
      'Something applied a nonlinearity the harmonic-order accounting does not know about.',
    ).toBeLessThan(1e-9);
  });
});

function cycles(n: number): string {
  return `${n} cycles/tile`;
}

/* ==========================================================================
 * 4. THE INVARIANTS THE MESOSCALE TERM COULD BREAK
 * ========================================================================== */

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

describe('the mesoscale term keeps the ground safe', () => {
  const SIZE = 128;
  const cases: ReadonlyArray<readonly [string, SurfaceLayerDef]> = BIOME_NAMES.flatMap(
    (name) => BIOMES[name].layers
      .filter((L) => L.surface === 'field')
      .map((L) => [`${name}/${L.label}`, L] as const),
  );

  it('still writes height EXACTLY 0.5 — no normal map can be packed from this', () => {
    for (const [id, L] of cases) {
      const s = buildFieldSurface(L, SIZE);
      for (let i = 0; i < SIZE * SIZE; i++) expect(s.height[i], `${id} @ ${i}`).toBe(0.5);
    }
  });

  it('never turns a red-over-green layer green-dominant', () => {
    // The property from the Biomes.ts header that survives the blue hemisphere
    // fill and the blue-grey fog lerp. Chroma and luma scaling are monotone
    // per channel and cannot break it; the hue tilt can, and is budgeted
    // against each layer's own r-g margin precisely so that it does not.
    for (const [id, L] of cases) {
      const hex = parseInt(L.albedo.replace('#', ''), 16);
      if (((hex >> 16) & 0xff) < ((hex >> 8) & 0xff)) continue; // authored cool
      const s = buildFieldSurface(L, SIZE);
      let bad = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (s.albedo[i * 3 + 1] > s.albedo[i * 3]) bad++;
      }
      expect(bad, `${id} produced ${bad} green-dominant texels`).toBe(0);
    }
  });

  it('never lands a texel in the emerald window', () => {
    for (const [id, L] of cases) {
      const s = buildFieldSurface(L, SIZE);
      let leaked = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const [h, sat, v] = rgbToHsv(s.albedo[i * 3], s.albedo[i * 3 + 1], s.albedo[i * 3 + 2]);
        if (h >= 100 && h <= 120 && sat > 0.25 && v > 0.15) leaked++;
      }
      expect(leaked, `${id} leaked ${leaked} texels`).toBe(0);
    }
  });

  it('moves colour far more than it moves brightness', () => {
    // The whole point. Uniform luminance jitter is what reads as dirt on the
    // lens — it is what the banned full-screen film grain was already doing.
    // On the layers that carry real hue (grass), the saturation range must be
    // several times the luminance range.
    for (const [id, L] of cases) {
      if (!id.endsWith('/grass')) continue;
      const s = buildFieldSurface(L, SIZE);
      let sMin = 9, sMax = -9, lMin = 9, lMax = -9;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const r = s.albedo[i * 3], g = s.albedo[i * 3 + 1], b = s.albedo[i * 3 + 2];
        const [, sat] = rgbToHsv(r, g, b);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (sat < sMin) sMin = sat; if (sat > sMax) sMax = sat;
        if (lum < lMin) lMin = lum; if (lum > lMax) lMax = lum;
      }
      const satSpread = (sMax - sMin) / ((sMax + sMin) / 2);
      const lumSpread = (lMax - lMin) / ((lMax + lMin) / 2);
      expect(satSpread, `${id} saturation spread`).toBeGreaterThan(0.10);
      expect(satSpread / lumSpread, `${id} chroma-over-luma ratio`).toBeGreaterThan(1.5);
    }
  });

  it('leaves slab and cobble layers completely alone', () => {
    // Paving is flat faces with crisp drawn joints by design. Mottling concrete
    // is how you get back to static, so nothing here may reach it — and the
    // structural guarantee is that `buildFieldSurface` is the only caller of
    // the mesoscale code and it only runs for `surface === 'field'`.
    for (const name of BIOME_NAMES) {
      for (const L of BIOMES[name].layers) {
        if (L.surface === 'field') continue;
        expect(['slab', 'cobble']).toContain(L.surface);
      }
    }
  });

  it('is deterministic', () => {
    const L = BIOMES.temperate.layers[0];
    const a = buildFieldSurface({ ...L, seed: 55501 }, 64);
    const b = buildFieldSurface({ ...L, seed: 55501 }, 64);
    expect(Array.from(a.albedo)).toEqual(Array.from(b.albedo));
  });
});
