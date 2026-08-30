/**
 * ============================================================================
 * VOLTMARCH — tests/terrain-lod.spec.ts
 * ============================================================================
 * THE HALF-RESOLUTION TERRAIN INDEX, AND THE ONE FAILURE MODE IT HAS.
 *
 * `buildTerrainChunks` emits a second index over the same vertices for chunks
 * with no relief worth drawing at 1 m. The saving is real but small (see the
 * counts at the bottom of this file); the RISK is not small, and it is entirely
 * concentrated in one place.
 *
 * A T-JUNCTION CRACK. A decimated chunk beside a full-resolution one shares an
 * edge. If the coarse side runs straight between samples 2 m apart while the
 * fine side bends through the sample in the middle, the two surfaces meet at
 * the corners and part company between them — and the gap is a hole with the
 * sky behind it. It is the classic terrain-LOD failure, it is a LOCAL artefact
 * a frame-wide metric cannot see (`tools/metrics.mjs` scores luminance,
 * saturation and edge density over a whole capture; a two-pixel seam moves none
 * of them), and it therefore has to be excluded structurally rather than looked
 * for.
 *
 * So the tests below are about geometry, not about pixels:
 *
 *  - EVERY boundary edge of a coarse chunk spans exactly one grid step, which
 *    is the same polyline a fine neighbour draws, vertex for vertex. That is
 *    the crack proof, and it holds against ANY neighbour — decimated or not —
 *    which is why no neighbour-agreement pass is needed.
 *  - The triangles tile the chunk square exactly once: total plan area is the
 *    chunk area to the last bit, and no triangle is degenerate. A hole or an
 *    overlap inside the chunk would show up here.
 *  - The drawn surface is within `TERRAIN_LOD_MAX_ERROR` of the heightfield at
 *    every sample, measured by actually interpolating the mesh rather than by
 *    trusting the generator's own estimate.
 *  - A decimated chunk cannot cast a shadow, so nothing throws a shadow from
 *    triangles it no longer has.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, TERRAIN_CHUNK_METRES, TERRAIN_LOD_MAX_ERROR, TERRAIN_SEED } from '../src/core/config';
import {
  CHUNK_INDICES, CHUNK_LOD_INDICES, CHUNK_LOD_QUADS, CHUNK_N, CHUNK_QUADS,
  CHUNK_VERTS, GRID, GRID_STRIDE, INV_GRID, TERRAIN_CHUNKS, TerrainFields,
  buildTerrainChunks, chunkCastsShadow, drawnTerrainHeightAt,
  type TerrainChunkData,
} from '../src/world/terrain-gen';
import { MAP_SEAS, startPointsFor } from '../src/game/Scenarios';
import { MAPS } from '../src/shell/settings-store';

/* ==========================================================================
 * 1. FIXTURES — the real shipped battlefields, not a synthetic heightfield
 * ========================================================================== */

interface Case {
  readonly label: string;
  readonly fields: TerrainFields;
  readonly chunks: readonly TerrainChunkData[];
}

/**
 * The four maps that between them cover every shape the generator makes: a
 * landlocked temperate roll (the terrain ten of the thirteen `?shot=` fixtures
 * stand on), a high-relief snow map, a half-plane coast and the archipelago.
 * Generating all ten would triple the runtime for no new topology.
 */
const CASE_MAPS = ['temperate-valley', 'frozen-sector', 'contested-strait', 'sunder-atoll'];

let cached: Case[] | null = null;

function cases(): readonly Case[] {
  if (cached !== null) return cached;
  cached = [];
  for (const id of CASE_MAPS) {
    const m = MAPS.find((x) => x.id === id);
    if (m === undefined) throw new Error(`unknown map ${id}`);
    const sea = MAP_SEAS[m.preset] ?? null;
    const fields = new TerrainFields({
      seed: m.mapSeed, biome: m.biome, sea, starts: startPointsFor(m.players, sea, DEFAULT_SEED),
    });
    fields.generate();
    cached.push({
      label: m.id,
      fields,
      chunks: buildTerrainChunks(fields.height, fields.wallUp, fields.wallTop),
    });
  }
  // Plus the default landform roll, which is what `?shot=` boots without a
  // `?mapseed=` and is therefore the terrain the look-bible grade is measured
  // on. It is NOT `temperate-valley` — that map names its own seed.
  const shotFields = new TerrainFields({ seed: TERRAIN_SEED, biome: 'temperate', sea: null });
  shotFields.generate();
  cached.push({
    label: 'shot-default',
    fields: shotFields,
    chunks: buildTerrainChunks(shotFields.height, shotFields.wallUp, shotFields.wallTop),
  });
  return cached;
}

/** Every chunk in every fixture that actually got a half-resolution index. */
function decimated(): { label: string; c: TerrainChunkData }[] {
  const out: { label: string; c: TerrainChunkData }[] = [];
  for (const k of cases()) {
    for (const c of k.chunks) if (c.lodIndex !== null) out.push({ label: k.label, c });
  }
  return out;
}

/** Chunk-local x/z of a vertex, in GRID steps. Positions are chunk-local. */
function vxOf(v: number): number { return v % (CHUNK_QUADS + 1); }
function vzOf(v: number): number { return Math.floor(v / (CHUNK_QUADS + 1)); }

/* ==========================================================================
 * 2. SHAPE
 * ========================================================================== */

describe('half-resolution terrain index — shape', () => {
  it('derives its length from CHUNK_QUADS and matches what it emits', () => {
    expect(CHUNK_QUADS % 2, 'CHUNK_QUADS must be even to halve').toBe(0);
    expect(CHUNK_LOD_QUADS).toBe(CHUNK_QUADS / 2);
    // 900 interior cells at 2 triangles, 120 edge cells at 5, 4 corners at 6.
    expect(CHUNK_LOD_INDICES).toBe(2424 * 3);
    for (const { label, c } of decimated()) {
      expect(c.lodIndex?.length, `${label} ${c.cx},${c.cz}`).toBe(CHUNK_LOD_INDICES);
    }
  });

  it('is a real saving over the full index and not a rounding of one', () => {
    // The claim the feature is sold on. 8192 -> 2424 triangles.
    expect(CHUNK_LOD_INDICES / CHUNK_INDICES).toBeCloseTo(0.2959, 4);
  });

  it('never names a vertex outside the shared vertex buffer', () => {
    for (const { label, c } of decimated()) {
      const idx = c.lodIndex as Uint16Array;
      let max = -1;
      for (let i = 0; i < idx.length; i++) if (idx[i] > max) max = idx[i];
      expect(max, `${label} ${c.cx},${c.cz}`).toBeLessThan(CHUNK_VERTS);
    }
  });

  it('is byte-identical on a second build of the same heightfield', () => {
    const m = MAPS.find((x) => x.id === 'contested-strait');
    if (m === undefined) throw new Error('missing map');
    const sea = MAP_SEAS[m.preset] ?? null;
    const opts = {
      seed: m.mapSeed, biome: m.biome, sea, starts: startPointsFor(m.players, sea, DEFAULT_SEED),
    };
    const build = (): readonly TerrainChunkData[] => {
      const f = new TerrainFields(opts);
      f.generate();
      return buildTerrainChunks(f.height, f.wallUp, f.wallTop);
    };
    const a = build();
    const b = build();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].lodError, `chunk ${i} lodError`).toBe(b[i].lodError);
      expect(a[i].lodIndex === null, `chunk ${i} lod presence`).toBe(b[i].lodIndex === null);
      if (a[i].lodIndex !== null) {
        expect(
          Buffer.from((a[i].lodIndex as Uint16Array).buffer.slice(0))
            .equals(Buffer.from((b[i].lodIndex as Uint16Array).buffer.slice(0))),
          `chunk ${i} lodIndex`,
        ).toBe(true);
      }
    }
  });
});

/* ==========================================================================
 * 3. THE CRACK PROOF
 * ========================================================================== */

describe('half-resolution terrain index — cannot crack', () => {
  /**
   * THE LOAD-BEARING ASSERTION IN THIS FILE.
   *
   * A shared chunk edge is a polyline. A full-resolution chunk draws it through
   * all 65 of its samples, so a coarse chunk cracks against it unless it does
   * the same. Every triangle edge that lies ALONG a chunk boundary is checked
   * to span exactly one grid step — which is that polyline and no other — and
   * the check is over the mesh as emitted rather than over the intent.
   *
   * Note this holds regardless of what the NEIGHBOUR chose, which is the reason
   * the LOD decision is per chunk with no agreement pass: a coarse chunk's
   * boundary is the fine boundary, so coarse-beside-coarse matches too.
   */
  it('spans exactly one grid step along every chunk boundary', () => {
    const S = CHUNK_QUADS;
    for (const { label, c } of decimated()) {
      const idx = c.lodIndex as Uint16Array;
      for (let t = 0; t < idx.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const p = idx[t + e];
          const q = idx[t + (e + 1) % 3];
          const px = vxOf(p); const pz = vzOf(p);
          const qx = vxOf(q); const qz = vzOf(q);
          const onWest = px === 0 && qx === 0;
          const onEast = px === S && qx === S;
          const onSouth = pz === 0 && qz === 0;
          const onNorth = pz === S && qz === S;
          if (onWest || onEast) {
            expect(
              Math.abs(pz - qz), `${label} ${c.cx},${c.cz}: coarse edge on the x=${px} boundary`,
            ).toBe(1);
          }
          if (onSouth || onNorth) {
            expect(
              Math.abs(px - qx), `${label} ${c.cx},${c.cz}: coarse edge on the z=${pz} boundary`,
            ).toBe(1);
          }
        }
      }
    }
  });

  /**
   * The same claim from the other side: every sample on the chunk perimeter is
   * still a triangle corner. The edge-span test above would also pass a mesh
   * that simply had no triangles touching an edge at all, i.e. a hole; this one
   * would not.
   */
  it('keeps every perimeter sample as a triangle corner', () => {
    const S = CHUNK_QUADS;
    for (const { label, c } of decimated()) {
      const idx = c.lodIndex as Uint16Array;
      const used = new Uint8Array(CHUNK_VERTS);
      for (let i = 0; i < idx.length; i++) used[idx[i]] = 1;
      for (let k = 0; k <= S; k++) {
        for (const v of [
          k, // south, z = 0
          S * (S + 1) + k, // north, z = S
          k * (S + 1), // west, x = 0
          k * (S + 1) + S, // east, x = S
        ]) {
          expect(used[v], `${label} ${c.cx},${c.cz}: perimeter sample ${v} dropped`).toBe(1);
        }
      }
    }
  });

  /**
   * TILES THE SQUARE EXACTLY ONCE. Plan area sums to the chunk area, so there
   * is no hole and no overlap anywhere inside it either — the fan stitch is
   * where an off-by-one would produce both at the same time and leave the sum
   * looking plausible only if the two happened to cancel, which they do not for
   * cells of two different sizes.
   */
  it('tiles the chunk square exactly once, with no degenerate triangle', () => {
    const area = TERRAIN_CHUNK_METRES * TERRAIN_CHUNK_METRES;
    for (const { label, c } of decimated()) {
      const idx = c.lodIndex as Uint16Array;
      let sum = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]; const b = idx[t + 1]; const d = idx[t + 2];
        // Plan (x,z) cross product. Positions are chunk-local metres.
        const s = (vxOf(b) - vxOf(a)) * (vzOf(d) - vzOf(a))
          - (vxOf(d) - vxOf(a)) * (vzOf(b) - vzOf(a));
        expect(s, `${label} ${c.cx},${c.cz}: degenerate triangle at ${t}`).not.toBe(0);
        sum += Math.abs(s) * 0.5 * GRID * GRID;
      }
      expect(sum, `${label} ${c.cx},${c.cz}`).toBe(area);
    }
  });

  /**
   * FACES THE SAME WAY AS THE FULL MESH. A fan walked the wrong way round would
   * still tile the square and still keep the boundary fine; it would render as
   * a hole under back-face culling, which is the crack again by another route.
   */
  it('winds every triangle the way the full index does', () => {
    const sign = (idx: Uint16Array, t: number): number => {
      const a = idx[t]; const b = idx[t + 1]; const d = idx[t + 2];
      return Math.sign((vxOf(b) - vxOf(a)) * (vzOf(d) - vzOf(a))
        - (vxOf(d) - vxOf(a)) * (vzOf(b) - vzOf(a)));
    };
    for (const { label, c } of decimated()) {
      const want = sign(c.index, 0);
      expect(want).not.toBe(0);
      const idx = c.lodIndex as Uint16Array;
      for (let t = 0; t < idx.length; t += 3) {
        expect(sign(idx, t), `${label} ${c.cx},${c.cz}: winding at ${t}`).toBe(want);
      }
    }
  });
});

/* ==========================================================================
 * 4. THE SURFACE IT ACTUALLY DRAWS
 * ========================================================================== */

/**
 * Interpolate the LOD mesh at a chunk-local plan position by finding the
 * triangle that contains it. Brute force over 2424 triangles — this is a test,
 * and reimplementing the generator's cell lookup here would only prove that two
 * copies of one mistake agree.
 */
function meshHeightAt(c: TerrainChunkData, x: number, z: number): number {
  const idx = c.lodIndex ?? c.index;
  const pos = c.position;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]; const b = idx[t + 1]; const d = idx[t + 2];
    const ax = pos[a * 3]; const az = pos[a * 3 + 2];
    const bx = pos[b * 3]; const bz = pos[b * 3 + 2];
    const dx = pos[d * 3]; const dz = pos[d * 3 + 2];
    const den = (bz - dz) * (ax - dx) + (dx - bx) * (az - dz);
    if (den === 0) continue;
    const w0 = ((bz - dz) * (x - dx) + (dx - bx) * (z - dz)) / den;
    const w1 = ((dz - az) * (x - dx) + (ax - dx) * (z - dz)) / den;
    const w2 = 1 - w0 - w1;
    const eps = -1e-9;
    if (w0 < eps || w1 < eps || w2 < eps) continue;
    return w0 * pos[a * 3 + 1] + w1 * pos[b * 3 + 1] + w2 * pos[d * 3 + 1];
  }
  return Number.NaN;
}

describe('half-resolution terrain index — the surface', () => {
  it('reports the exact fine and decimated surface used by the colour renderer', () => {
    const points = [0.25, 0.75, 1.25, 1.75, 2.25, 31.25, 32.75, 61.25, 62.75, 63.75];
    const decimatedProbe = decimated().slice(0, 3);
    const fineProbe = cases().flatMap((entry) => entry.chunks
      .filter((chunk) => chunk.lodIndex === null)
      .map((chunk) => ({ label: entry.label, chunk }))).slice(0, 1);
    expect(decimatedProbe.length).toBe(3);
    expect(fineProbe.length).toBe(1);

    for (const { label, c } of decimatedProbe) {
      for (const z of points) for (const x of points) {
        const want = meshHeightAt(c, x, z);
        const got = drawnTerrainHeightAt(
          cases().find((entry) => entry.label === label)!.fields.height,
          c.cx * CHUNK_QUADS * GRID + x,
          c.cz * CHUNK_QUADS * GRID + z,
          true,
        );
        expect(got, `${label} lod ${c.cx},${c.cz} at ${x},${z}`).toBeCloseTo(want, 5);
      }
    }

    for (const { label, chunk: c } of fineProbe) {
      const fields = cases().find((entry) => entry.label === label)!.fields;
      for (const z of points) for (const x of points) {
        const want = meshHeightAt(c, x, z);
        const got = drawnTerrainHeightAt(
          fields.height,
          c.cx * CHUNK_QUADS * GRID + x,
          c.cz * CHUNK_QUADS * GRID + z,
          false,
        );
        expect(got, `${label} fine ${c.cx},${c.cz} at ${x},${z}`).toBeCloseTo(want, 5);
      }
    }
  });

  /**
   * `lodError` is the generator's own claim about how far the coarse surface
   * can be from the heightfield. This measures it against the mesh that is
   * actually emitted, at every sample, so the number in the field set is a
   * measurement rather than an assertion. Three chunks, because the brute-force
   * containment search is 4225 x 2424 per chunk.
   */
  it('stays within its reported error at every heightfield sample', () => {
    const S = CHUNK_QUADS;
    const probe = decimated().slice(0, 3);
    expect(probe.length, 'no chunk decimated — the fixtures cannot prove anything').toBe(3);
    for (const { label, c } of probe) {
      let worst = 0;
      for (let vz = 0; vz <= S; vz++) {
        for (let vx = 0; vx <= S; vx++) {
          const want = c.position[(vz * (S + 1) + vx) * 3 + 1];
          const got = meshHeightAt(c, vx * GRID, vz * GRID);
          expect(Number.isNaN(got), `${label} ${c.cx},${c.cz}: no triangle over ${vx},${vz}`)
            .toBe(false);
          const e = Math.abs(got - want);
          if (e > worst) worst = e;
        }
      }
      // Float32 positions against a Float64 barycentric interpolation, so a
      // few ulps of slack rather than an exact compare.
      expect(worst, `${label} ${c.cx},${c.cz} worst error`)
        .toBeLessThanOrEqual(c.lodError + 1e-5);
      expect(worst, `${label} ${c.cx},${c.cz} vs the budget`)
        .toBeLessThanOrEqual(TERRAIN_LOD_MAX_ERROR + 1e-5);
    }
  });

  it('leaves the chunk boundary at the exact heightfield sample', () => {
    // Implied by the two crack tests, measured here in metres so a regression
    // reads as "the ground moved" rather than as "an index changed".
    const S = CHUNK_QUADS;
    for (const { label, c } of decimated()) {
      for (let k = 0; k <= S; k++) {
        for (const [x, z] of [[k, 0], [k, S], [0, k], [S, k]] as const) {
          const want = c.position[(z * (S + 1) + x) * 3 + 1];
          const got = meshHeightAt(c, x * GRID, z * GRID);
          expect(got, `${label} ${c.cx},${c.cz} at ${x},${z}`).toBeCloseTo(want, 5);
        }
      }
    }
  });
});

/* ==========================================================================
 * 5. THE GATE, AND ITS ONE INTERACTION WITH THE REST OF THE RENDERER
 * ========================================================================== */

describe('half-resolution terrain index — the gate', () => {
  /**
   * A chunk that draws 2424 triangles must not be submitted to the shadow map
   * on the strength of 8192. The two decisions read the same `cliffTris`, and
   * `chunkCastsShadow` is a shared predicate rather than a repeated literal for
   * exactly this reason — but sharing a number is not the same as the numbers
   * being compatible, so the implication is measured on real terrain.
   */
  it('never decimates a chunk that casts a shadow', () => {
    for (const k of cases()) {
      for (const c of k.chunks) {
        if (c.lodIndex === null) continue;
        expect(c.cliffTris, `${k.label} ${c.cx},${c.cz}`).toBe(0);
        expect(chunkCastsShadow(c.cliffTris), `${k.label} ${c.cx},${c.cz}`).toBe(false);
      }
    }
  });

  it('refuses every chunk over the error budget', () => {
    for (const k of cases()) {
      for (const c of k.chunks) {
        expect(c.lodError, `${k.label} ${c.cx},${c.cz}`).toBeGreaterThanOrEqual(0);
        if (c.lodError > TERRAIN_LOD_MAX_ERROR) {
          expect(c.lodIndex, `${k.label} ${c.cx},${c.cz} over budget`).toBeNull();
        }
      }
    }
  });

  /**
   * THE HONEST NUMBER, PINNED.
   *
   * The point of this test is not that the counts are good — on the landlocked
   * roll ten of the thirteen capture fixtures stand on, FOUR of the sixty-four
   * chunks qualify, which is a 1.5% saving on the terrain and less than that on
   * a frame. It is that the counts are a fact about the shipped seeds and will
   * announce themselves if a change to the generator moves them, in either
   * direction. A future pass that makes the map flatter makes this feature
   * matter more, and this is where that would show up.
   *
   * IT ANNOUNCED ITSELF ON THE FIRST TRY, AND THE WAY IT FAILED IS THE USEFUL
   * PART. Merging this branch into a main that had since widened the start
   * spread (START_SPREAD 74/62 -> 148/124) moved three of the five counts:
   *
   *     temperate-valley   7 -> 4        starts from SKIRMISH_START_OFFSETS
   *     frozen-sector      5 -> 3        starts from SKIRMISH_START_OFFSETS
   *     contested-strait  16 -> 14       starts from SKIRMISH_START_OFFSETS
   *     sunder-atoll       6 -> 6        starts from the ARCHIPELAGO island layout
   *     shot-default       4 -> 4        passes NO `starts` at all
   *
   * The two that did not move are the two the widening cannot reach, and that
   * is what makes this a re-baseline rather than a regression waved through: a
   * generator that had actually broken in the merge would have moved all five.
   * Do not accept a new set of numbers here without that discriminator.
   *
   * The direction is mechanistic too. Four shelves 124 m apart at an effective
   * radius of 72 m OVERLAP, fusing into one broad flat blob near the map
   * centre, and a broad blob fills whole chunks. Pulled 248 m apart they stop
   * touching and each one straddles chunk boundaries instead, so fewer chunks
   * are wholly flat. Spreading the armies out costs this feature chunks. If a
   * later pass wants them back, the lever is chunk size, not the spread.
   *
   * IT FIRED A SECOND TIME, on the same day, for the seed-picked start pair —
   * and the second reading is a better demonstration of the discriminator than
   * the first, because only ONE number moved:
   *
   *     frozen-sector      3 -> 4     landlocked: seats [0,2] now, not [0,1]
   *     temperate-valley   4 -> 4     landlocked, but the count happens to tie
   *     contested-strait  14 -> 14    coastal: `dryPairs` leaves it two options
   *                                   and DEFAULT_SEED still lands on [0,1]
   *     sunder-atoll       6 -> 6     island layout, unreachable as before
   *     shot-default       4 -> 4     no `starts`, unreachable as before
   *
   * A change that had actually broken the generator could not have left the
   * atoll and the default roll alone twice running.
   */
  it('qualifies the number of chunks it qualified when this was measured', () => {
    const want: Record<string, number> = {
      'temperate-valley': 4,
      'frozen-sector': 4,
      'contested-strait': 14,
      'sunder-atoll': 6,
      'shot-default': 4,
    };
    const got: Record<string, number> = {};
    for (const k of cases()) {
      expect(k.chunks.length).toBe(TERRAIN_CHUNKS);
      got[k.label] = k.chunks.filter((c) => c.lodIndex !== null).length;
    }
    // Reported TOGETHER rather than one map at a time: the first version failed
    // on whichever map `cases()` happened to yield first, so a generator change
    // that moved all five looked like a change that moved one.
    expect(got).toEqual(want);
  });

  it('places its chunks by the same cx/cz the full set uses', () => {
    for (const k of cases()) {
      for (let i = 0; i < k.chunks.length; i++) {
        const c = k.chunks[i];
        expect(c.cx).toBe(i % CHUNK_N);
        expect(c.cz).toBe(Math.floor(i / CHUNK_N));
        // The chunk-local origin the error measure indexes from.
        expect(Math.round(c.cx * TERRAIN_CHUNK_METRES * INV_GRID) + CHUNK_QUADS)
          .toBeLessThan(GRID_STRIDE);
      }
    }
  });
});
