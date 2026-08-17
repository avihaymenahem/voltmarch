/**
 * Prop scatter — the anti-emptiness system (bible §14 R3, scorecard #15).
 *
 * Everything here runs headless. `PropMesh` emits plain `BufferAttribute`s and
 * `Scatter` only ever writes into `InstancedMesh.instanceMatrix`, so the whole
 * bake -> place -> validate -> cull path is testable in Node with no GL context.
 *
 * The two tests that actually matter are `the ship-blocking rule` and
 * `density`. Everything else is there so that when one of those goes red, the
 * reason is already on screen.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import { MAP_SIZE, SCATTER_COVERAGE, SCATTER_DENSITY, SCATTER_LIMITS } from '../src/core/config';
import { Terrain } from '../src/world/Terrain';
import type { BiomeName } from '../src/world/Biomes';
import {
  bevelHighlight, PropLibrary, PropMesh, PROP_DEFS, propPalette, shadeOf,
} from '../src/world/PropLibrary';
import {
  Scatter, CHUNK_COUNT, COVER_N, SCATTER_AO_MIN_RADIUS, SCATTER_SHADOW_MIN_RADIUS,
} from '../src/world/Scatter';

const BIOMES: readonly BiomeName[] = ['temperate', 'desert', 'snow', 'urban'];

/**
 * Read as TEXT, not imported: `SCATTER_SHADOW_MIN_RADIUS` is a second copy of a
 * literal that `src/render/RenderBridge.ts` does not export, and the only thing
 * that can stop the two drifting apart is an assertion that reads the other one.
 *
 * BOTH candidate homes are read, so a rehome to `config.ts` — which is what the
 * two comments ask for and what would delete the duplication — passes rather
 * than going red for having done the right thing.
 */
const ROOT = join(__dirname, '..');
const SHADOW_GATE_SRC = ['src/render/RenderBridge.ts', 'src/core/config.ts']
  .map((f) => readFileSync(join(ROOT, f), 'utf8'))
  .join('\n');

function rig(biome: BiomeName, urban: number, densityScale: number): {
  scene: THREE.Scene; terrain: Terrain; scatter: Scatter;
} {
  const scene = new THREE.Scene();
  const terrain = new Terrain({ scene, seed: 0x7e44a1, biome, anisotropy: 1 });
  const scatter = new Scatter({
    scene, terrain, biome, seed: 0x5ca77e, urban, densityScale,
    preferred: ['tree', 'bush', 'rock'],
  });
  return { scene, terrain, scatter };
}

/* ==========================================================================
 * 1. THE PROP LIBRARY
 * ========================================================================== */

describe('PropLibrary — 28 archetypes with real silhouettes', () => {
  let lib: PropLibrary;
  beforeAll(() => { lib = new PropLibrary({ biome: 'temperate', seed: 7 }); });

  it('bakes every roster type the biome allows', () => {
    const expected = PROP_DEFS.filter((d) => d.biome.temperate > 0).length;
    expect(lib.count).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(24);
  });

  it('gives every type geometry with all five attributes and an index', () => {
    for (const pg of lib.all()) {
      const g = pg.geometry;
      expect(pg.triangles, pg.def.key).toBeGreaterThan(24);
      for (const attr of ['position', 'normal', 'color', 'aSway', 'aEmit']) {
        expect(g.getAttribute(attr), `${pg.def.key}.${attr}`).toBeTruthy();
      }
      expect(g.getIndex(), pg.def.key).toBeTruthy();
      // Every attribute must agree on vertex count or instancing silently
      // reads garbage for the trailing vertices.
      const n = g.getAttribute('position').count;
      expect(g.getAttribute('color').count, pg.def.key).toBe(n);
      expect(g.getAttribute('aSway').count, pg.def.key).toBe(n);
      expect(g.getAttribute('aEmit').count, pg.def.key).toBe(n);
    }
  });

  it('is FLAT shaded — no smooth 32-segment tubes (scorecard #40)', () => {
    for (const pg of lib.all()) {
      const idx = pg.geometry.getIndex()!;
      const nrm = pg.geometry.getAttribute('normal');
      // Sample the first 200 triangles; all three corners must share a normal.
      const tris = Math.min(200, idx.count / 3);
      for (let t = 0; t < tris; t++) {
        const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
        expect(nrm.getX(a), pg.def.key).toBeCloseTo(nrm.getX(b), 5);
        expect(nrm.getY(a), pg.def.key).toBeCloseTo(nrm.getY(c), 5);
      }
    }
  });

  it('stands every prop ON the ground, not through it', () => {
    for (const pg of lib.all()) {
      const box = pg.geometry.boundingBox!;
      // A little tolerance for root flares and kerb slabs that bed in.
      expect(box.min.y, pg.def.key).toBeGreaterThan(-0.35);
      expect(box.max.y, pg.def.key).toBeGreaterThan(0.4);
      // The declared height must be in the same world as the geometry, or the
      // chunk culling sphere is wrong.
      expect(pg.boundHeight, pg.def.key).toBeLessThan(pg.def.height * 2.2 + 2);
    }
  });

  it('keeps every geometry inside its declared footprint radius', () => {
    for (const pg of lib.all()) {
      // Foliage legitimately overhangs its trunk; the spacing figure is what
      // the placer uses, so only assert the bound is not wildly divergent.
      expect(pg.boundRadius, pg.def.key).toBeLessThan(pg.def.adorn * 2 + 4);
    }
  });

  it('measures a 3-D bounding sphere for the shadow gate', () => {
    for (const pg of lib.all()) {
      const box = pg.geometry.boundingBox!;
      const half = box.getSize(new THREE.Vector3()).length() / 2;
      // Finite, positive, and no bigger than the box's half-diagonal: a zero
      // would silently opt the type out of every radius gate, and a value over
      // the diagonal means it was measured from the origin rather than from the
      // box centre — which is the difference between `boundSphereRadius` and
      // `boundRadius`.
      expect(Number.isFinite(pg.boundSphereRadius), pg.def.key).toBe(true);
      expect(pg.boundSphereRadius, pg.def.key).toBeGreaterThan(0);
      expect(pg.boundSphereRadius, pg.def.key).toBeLessThanOrEqual(half + 1e-3);
      // The geometry keeps it too, because Scatter gates off the mesh it holds.
      expect(pg.geometry.boundingSphere, pg.def.key).not.toBeNull();
    }
  });

  it('builds in every biome without a missing palette entry', () => {
    for (const biome of BIOMES) {
      const l = new PropLibrary({ biome, seed: 3 });
      expect(l.count, biome).toBeGreaterThan(20);
      expect(l.totalTriangles, biome).toBeGreaterThan(5000);
      for (const pg of l.all()) {
        const col = pg.geometry.getAttribute('color');
        for (let i = 0; i < Math.min(col.count, 64); i++) {
          expect(Number.isFinite(col.getX(i)), `${biome}/${pg.def.key}`).toBe(true);
        }
      }
      l.dispose();
    }
  });

  it('is deterministic for a given (biome, seed)', () => {
    const a = new PropLibrary({ biome: 'temperate', seed: 4242 });
    const b = new PropLibrary({ biome: 'temperate', seed: 4242 });
    const ga = a.get('tree')!.geometry.getAttribute('position').array as Float32Array;
    const gb = b.get('tree')!.geometry.getAttribute('position').array as Float32Array;
    expect(ga.length).toBe(gb.length);
    for (let i = 0; i < ga.length; i += 97) expect(ga[i]).toBe(gb[i]);
    a.dispose(); b.dispose();
  });

  it('paints a brighter, less saturated bevel band (bible 5.5, scorecard #11)', () => {
    // Every chamfer strip is emitted in this colour; if it stops being brighter
    // than the base, every prop reverts to an untextured primitive.
    for (const hex of ['#4C6B1E', '#B03A2E', '#9A968C', '#243009']) {
      const b = bevelHighlight(hex);
      const lum = (h: string): number => {
        const n = parseInt(h.slice(1), 16);
        return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722;
      };
      expect(lum(b), hex).toBeGreaterThan(lum(hex));
    }
    expect(shadeOf('#FFFFFF', 0.5)).toBe('#808080');
  });

  it('emits emissive only where a prop actually glows', () => {
    const lamp = lib.get('streetLamp')!;
    const tree = lib.get('tree')!;
    const sum = (pg: typeof lamp): number => {
      const a = pg.geometry.getAttribute('aEmit');
      let t = 0;
      for (let i = 0; i < a.count; i++) t += a.getX(i);
      return t;
    };
    expect(sum(lamp)).toBeGreaterThan(0);
    expect(sum(tree)).toBe(0);
  });

  it('gives foliage a sway ramp and rigid props none (bible §6.5)', () => {
    const maxSway = (key: string): number => {
      const a = lib.get(key)!.geometry.getAttribute('aSway');
      let m = 0;
      for (let i = 0; i < a.count; i++) m = Math.max(m, a.getX(i));
      return m;
    };
    expect(maxSway('tree')).toBeGreaterThan(0.05);
    expect(maxSway('grassTuft')).toBeGreaterThan(0.02);
    expect(maxSway('boulder')).toBe(0);
    expect(maxSway('carSedan')).toBe(0);
  });
});

describe('PropMesh — the geometry toolkit', () => {
  it('chamfers a box into 6 faces + 12 strips + 8 corners', () => {
    const m = new PropMesh();
    m.color('#808080');
    m.box(0, 1, 0, 2, 2, 2, 0.2);
    // 6 quads + 12 quads + 8 tris = 18*2 + 8 = 44 triangles.
    expect(m.triangles).toBe(44);
  });

  it('drops the chamfer geometry when the chamfer is zero', () => {
    const m = new PropMesh();
    m.color('#808080');
    m.box(0, 1, 0, 2, 2, 2, 0);
    expect(m.triangles).toBe(12);
  });

  it('winds every face outward', () => {
    const m = new PropMesh();
    m.color('#808080');
    m.box(0, 0, 0, 2, 2, 2, 0.2);
    const g = m.toGeometry('probe');
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    // On a box centred at the origin, every vertex normal must point away
    // from the centre. A single flipped quad is a black hole in the render.
    for (let i = 0; i < pos.count; i++) {
      const d = pos.getX(i) * nrm.getX(i) + pos.getY(i) * nrm.getY(i) + pos.getZ(i) * nrm.getZ(i);
      expect(d).toBeGreaterThan(0);
    }
  });

  it('keeps cylinders inside the 12-16 facet band', () => {
    const m = new PropMesh();
    m.color('#808080');
    m.cyl(0, 0, 0, 1, 1, 2, 12, 0, true, true);
    // 12 side quads + 2 caps of 10 triangles each.
    expect(m.triangles).toBe(12 * 2 + 20);
  });

  it('tracks bounds as vertices land', () => {
    const m = new PropMesh();
    m.color('#808080');
    m.box(0, 1, 0, 2, 2, 4, 0);
    expect(m.min[0]).toBeCloseTo(-1, 5);
    expect(m.max[1]).toBeCloseTo(2, 5);
    expect(m.max[2]).toBeCloseTo(2, 5);
  });
});

/* ==========================================================================
 * 2. PLACEMENT
 * ========================================================================== */

describe('Scatter — placement', () => {
  it('hits the density budget on a temperate map', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const r = scatter.lastReport!;
    // Ruling #9 / bible §6.6: wilderness >= 260/ha, city >= 105/ha, and at
    // urban 0.25 the target is the lerp between them.
    const target = SCATTER_DENSITY.wildernessPerHectare
      + (SCATTER_DENSITY.cityPerHectare - SCATTER_DENSITY.wildernessPerHectare) * 0.25;
    expect(r.propsPerHectare).toBeGreaterThan(target * 0.9);
    scatter.dispose();
  });

  it('never scales below the ruling-#9 floor of 75/ha', () => {
    // MAP_PRESETS.urban asks for scatter 0.6, which would land at ~68/ha.
    const { scatter } = rig('urban', 0.95, 0.6);
    scatter.generate();
    expect(scatter.lastReport!.propsPerHectare)
      .toBeGreaterThanOrEqual(SCATTER_DENSITY.hardFloorPerHectare);
    scatter.dispose();
  });

  it('THE SHIP-BLOCKING RULE: no unadorned walkable patch over 25 m', () => {
    for (const biome of BIOMES) {
      const { scatter } = rig(biome, biome === 'urban' ? 0.95 : 0.25, 1.0);
      scatter.generate();
      const r = scatter.lastReport!;
      expect(r.emptyPatches.length, `${biome} has unadorned patches`).toBe(0);
      expect(r.passes, biome).toBe(true);
      // Bible §6.6: "target >= 55% of visible ground adorned".
      expect(r.adornedFraction, `${biome} adornment`)
        .toBeGreaterThanOrEqual(SCATTER_COVERAGE.targetAdorned);
      scatter.dispose();
    }
  });

  it('detects empty patches when there are no props at all', () => {
    // The validator has to be able to FAIL, or the gate proves nothing.
    const { scatter } = rig('temperate', 0.25, 1.0);
    const r = scatter.validateCoverage();
    expect(r.emptyPatches.length).toBeGreaterThan(10);
    expect(r.passes).toBe(false);
    for (const p of r.emptyPatches) {
      expect(p.size).toBeGreaterThan(SCATTER_COVERAGE.patchMetres);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(MAP_SIZE);
    }
    scatter.dispose();
  });

  it('reports non-overlapping patches', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    const r = scatter.validateCoverage();
    const ps = r.emptyPatches;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const overlapX = Math.abs(ps[i].x - ps[j].x) < ps[i].size * 0.999;
        const overlapZ = Math.abs(ps[i].z - ps[j].z) < ps[i].size * 0.999;
        expect(overlapX && overlapZ, `patch ${i} overlaps ${j}`).toBe(false);
      }
    }
    scatter.dispose();
  });

  it('masks water, cliffs and structure footprints', () => {
    const { terrain, scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const out = new Float32Array(scatter.propCount * 4);
    const n = scatter.positions(out);
    expect(n).toBeGreaterThan(200);
    for (let i = 0; i < n; i++) {
      const x = out[i * 4], z = out[i * 4 + 2];
      const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
      expect(terrain.isWater(cx, cz), `prop ${i} in water`).toBe(false);
      expect(terrain.isCliff(cx, cz), `prop ${i} on a cliff`).toBe(false);
      expect(terrain.isOccupied(cx, cz), `prop ${i} inside a footprint`).toBe(false);
    }
    scatter.dispose();
  });

  it('honours exclusion discs', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    scatter.addExclusion(256, 256, 40);
    scatter.generate();
    const out = new Float32Array(scatter.propCount * 4);
    const n = scatter.positions(out);
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(out[i * 4] - 256, out[i * 4 + 2] - 256);
      expect(d, `prop ${i} inside the exclusion`).toBeGreaterThan(39.9);
    }
    scatter.dispose();
  });

  it('sits every prop on the terrain surface', () => {
    const { terrain, scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const out = new Float32Array(scatter.propCount * 4);
    const n = scatter.positions(out);
    for (let i = 0; i < n; i += 37) {
      const h = terrain.heightAt(out[i * 4], out[i * 4 + 2]);
      expect(Math.abs(out[i * 4 + 1] - h)).toBeLessThan(0.01);
    }
    scatter.dispose();
  });

  it('is deterministic for a given seed', () => {
    const a = rig('temperate', 0.25, 1.0);
    const b = rig('temperate', 0.25, 1.0);
    a.scatter.generate();
    b.scatter.generate();
    expect(a.scatter.propCount).toBe(b.scatter.propCount);
    const oa = new Float32Array(a.scatter.propCount * 4);
    const ob = new Float32Array(b.scatter.propCount * 4);
    a.scatter.positions(oa);
    b.scatter.positions(ob);
    for (let i = 0; i < oa.length; i += 53) expect(oa[i]).toBe(ob[i]);
    a.scatter.dispose(); b.scatter.dispose();
  });

  it('clusters instead of spreading uniformly (bible §6.5)', () => {
    // Quadrat variance-to-mean ratio. A Poisson (uniform) point process gives
    // VMR == 1; a clustered one gives > 1. Nearest-neighbour distance is the
    // wrong statistic here — the placer enforces a hard minimum spacing, which
    // is a hard-core process and pushes NN distance ABOVE Poisson no matter
    // how clustered the pattern is.
    const { terrain, scatter } = rig('temperate', 0.1, 1.0);
    scatter.generate();
    const out = new Float32Array(scatter.propCount * 4);
    const n = scatter.positions(out);

    const Q = 24;                               // metres per quadrat
    const N = Math.round(MAP_SIZE / Q);
    const counts = new Float64Array(N * N);
    const walkCells = new Float64Array(N * N);
    for (let cz = 0; cz < 128; cz++) {
      for (let cx = 0; cx < 128; cx++) {
        if (terrain.isWater(cx, cz) || terrain.isCliff(cx, cz)) continue;
        const qx = Math.min(N - 1, Math.floor(cx * 4 / Q));
        const qz = Math.min(N - 1, Math.floor(cz * 4 / Q));
        walkCells[qz * N + qx]++;
      }
    }
    for (let i = 0; i < n; i++) {
      const qx = Math.min(N - 1, Math.floor(out[i * 4] / Q));
      const qz = Math.min(N - 1, Math.floor(out[i * 4 + 2] / Q));
      counts[qz * N + qx]++;
    }
    // Only quadrats that are almost entirely walkable, so a lake cutting
    // through one cannot masquerade as clustering.
    const cellsPerQuadrat = (Q / 4) * (Q / 4);
    let sum = 0, sumSq = 0, k = 0;
    for (let i = 0; i < N * N; i++) {
      if (walkCells[i] < cellsPerQuadrat * 0.85) continue;
      sum += counts[i]; sumSq += counts[i] * counts[i]; k++;
    }
    expect(k).toBeGreaterThan(40);
    const mean = sum / k;
    const variance = sumSq / k - mean * mean;
    expect(variance / mean).toBeGreaterThan(1.5);
    scatter.dispose();
  });

  it('respects the draw-call budget', () => {
    for (const biome of BIOMES) {
      const { scatter } = rig(biome, 0.95, 1.4);
      scatter.generate();
      expect(scatter.typeCount, biome).toBeLessThanOrEqual(SCATTER_LIMITS.maxTypes);
      scatter.dispose();
    }
  });

  it('publishes blocking props for a nav module', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const out = new Float32Array(4096 * 3);
    const n = scatter.blockers(out);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) expect(out[i * 3 + 2]).toBeGreaterThan(0);
    scatter.dispose();
  });
});

/* ==========================================================================
 * 3. CULLING
 * ========================================================================== */

describe('Scatter — chunk culling', () => {
  it('uploads only the visible chunks', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const total = scatter.propCount;

    // The RA3 rig: 34 degree vFOV, 39 degrees below horizontal, 50 m up.
    const cam = new THREE.PerspectiveCamera(34, 16 / 9, 1, 600);
    cam.position.set(256 - 43.7, 50, 256 - 43.7);
    cam.lookAt(256, 0, 256);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    scatter.update(cam, 0);

    expect(scatter.visibleInstances).toBeGreaterThan(0);
    expect(scatter.visibleInstances).toBeLessThan(total);
    expect(scatter.visibleChunks).toBeGreaterThan(0);
    expect(scatter.visibleChunks).toBeLessThan(CHUNK_COUNT);
    scatter.dispose();
  });

  it('does no work when the visible chunk set is unchanged', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const cam = new THREE.PerspectiveCamera(34, 16 / 9, 1, 600);
    cam.position.set(212, 50, 212);
    cam.lookAt(256, 0, 256);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();

    scatter.update(cam, 0);
    const first = scatter.visibleInstances;
    // A second identical update must be a no-op; the counter is only written
    // on a repack, so an unchanged value proves the early-out fired.
    scatter.update(cam, 0.016);
    expect(scatter.visibleInstances).toBe(first);
    scatter.dispose();
  });

  it('uploads the drawn prefix, not the whole allocation', () => {
    /* The buffers are allocated at the type's FULL population, so a bare
     * `needsUpdate = true` makes three `bufferSubData` the entire array — on
     * this seed that is 4131 props x 76 B = 307 kB re-sent to change the 538
     * instances an RTS camera at 40 m can see. The repack cursor writes a
     * contiguous prefix from index 0, so [0, count) is exactly what changed and
     * is the only span that may be uploaded. */
    const { scene, scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const meshes: THREE.InstancedMesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if ((m as { isInstancedMesh?: boolean }).isInstancedMesh && m.name.startsWith('prop.')) {
        meshes.push(m);
      }
    });
    expect(meshes.length).toBeGreaterThan(0);

    // A tight view, so the drawn prefix is a small fraction of the capacity.
    const cam = new THREE.PerspectiveCamera(34, 16 / 9, 1, 600);
    cam.position.set(212, 40, 212);
    cam.lookAt(256, 0, 256);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    scatter.update(cam, 0);

    let shortened = 0;
    for (const m of meshes) {
      const col = m.instanceColor!;
      if (m.count === 0) {
        expect(m.instanceMatrix.updateRanges.length, m.name).toBe(0);
        continue;
      }
      expect(m.instanceMatrix.updateRanges, m.name).toEqual([{ start: 0, count: m.count * 16 }]);
      expect(col.updateRanges, m.name).toEqual([{ start: 0, count: m.count * 3 }]);
      if (m.count < m.instanceMatrix.count) shortened++;
    }
    expect(shortened, 'no mesh drew less than its capacity — the view was too wide')
      .toBeGreaterThan(0);

    // The range object is owned by the ScatterType and re-pointed in place:
    // `addUpdateRange` would allocate one per attribute per repack, and this
    // path runs on a camera pan under the file's "zero allocation" contract.
    const probe = meshes.find((m) => m.count > 0)!;
    const identity = probe.instanceMatrix.updateRanges[0];
    for (const m of meshes) {
      m.instanceMatrix.clearUpdateRanges();
      m.instanceColor!.clearUpdateRanges();
    }
    const wide = new THREE.PerspectiveCamera(34, 16 / 9, 1, 900);
    wide.position.set(256, 400, 256);
    wide.lookAt(256, 0, 256);
    wide.updateMatrixWorld(); wide.updateProjectionMatrix();
    scatter.update(wide, 0.016);
    expect(probe.instanceMatrix.updateRanges[0]).toBe(identity);
    expect(probe.instanceMatrix.updateRanges[0].count).toBe(probe.count * 16);
    scatter.dispose();
  });

  it('applies the prop shadow-radius gate per type', () => {
    /* The gate RenderBridge's own comment asks for: "src/world/Scatter.ts ...
     * should apply the same gate there". It is per TYPE because an
     * InstancedMesh is one submission — the shadow pass gets all 735 grass
     * tufts or none of them. Measured 2026-08-17 the whole roster clears 0.70 m
     * (the smallest is `bench` at 1.18 m), so this asserts the RULE and not the
     * current roster: a small prop added tomorrow must lose its shadow, and
     * nothing here should go red when it does. */
    const { scene, scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    let checked = 0;
    scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!(m as { isInstancedMesh?: boolean }).isInstancedMesh) return;
      if (!m.name.startsWith('prop.')) return;
      const bs = m.geometry.boundingSphere;
      expect(bs, `${m.name} has no bounding sphere to gate on`).not.toBeNull();
      expect(m.castShadow, m.name).toBe(bs!.radius >= SCATTER_SHADOW_MIN_RADIUS);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    scatter.dispose();

    // The threshold is a SECOND COPY of the entity-prop gate's, because that
    // one is not exported and a world module must not import the render bridge.
    // Two copies that silently drift apart are worse than one, so every
    // declaration of it anywhere must still read the same number as this one.
    const decls = [...SHADOW_GATE_SRC.matchAll(/PROP_SHADOW_MIN_RADIUS\s*=\s*([\d.]+)/g)];
    expect(decls.length, 'the entity-prop gate vanished; delete this copy or restore it')
      .toBeGreaterThan(0);
    for (const d of decls) {
      expect(Number(d[1]), 'the entity-prop gate moved; SCATTER_SHADOW_MIN_RADIUS must follow')
        .toBe(SCATTER_SHADOW_MIN_RADIUS);
    }
  });

  it('applies the prop AO-radius gate per type, and only as an opt-out', () => {
    /* The GTAO G-buffer twin of the shadow gate above, and per TYPE for the same
     * reason: one InstancedMesh is one submission to the normal prepass.
     *
     * TWO THINGS ARE PINNED AND THEY ARE DIFFERENT CLAIMS.
     *
     * The first is the gate itself — every mesh agrees with
     * `SCATTER_AO_MIN_RADIUS`, whatever that constant is set to. The graded A/B
     * on this branch says it should stay at `Infinity`'s opposite (i.e. that the
     * exclusion should not ship), but a test that hard-codes the verdict would
     * have to be edited by whoever changes their mind, which is how a decision
     * stops being reviewable. So this asserts the RULE and passes at any value.
     *
     * The second is the one that would rot silently: `render/post.ts#aoOccluder`
     * reads `userData.vmAoOccluder === false`, STRICTLY. Writing `true` for an
     * occluding type would be harmless today and a live bug the moment that
     * reader is ever relaxed to truthiness — and an `=== false` reader paired
     * with a producer that writes both values is exactly the cross-file rot
     * `tests/ao-occluder-filter.spec.ts` was written about. Only the opt-out is
     * ever stamped; an occluder's `userData` stays untouched. */
    const { scene, scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    let checked = 0;
    scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!(m as { isInstancedMesh?: boolean }).isInstancedMesh) return;
      if (!m.name.startsWith('prop.')) return;
      const bs = m.geometry.boundingSphere;
      expect(bs, `${m.name} has no bounding sphere to gate on`).not.toBeNull();
      const occludes = bs!.radius >= SCATTER_AO_MIN_RADIUS;
      expect(m.userData.vmAoOccluder, m.name).toBe(occludes ? undefined : false);
      expect(m.userData.vmAoOccluder, `${m.name} must never be stamped true`).not.toBe(true);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    scatter.dispose();
  });

  it('shows more of the map from higher up', () => {
    const { scatter } = rig('temperate', 0.25, 1.0);
    scatter.generate();
    const near = new THREE.PerspectiveCamera(34, 16 / 9, 1, 600);
    near.position.set(228, 32, 228);
    near.lookAt(256, 0, 256);
    near.updateMatrixWorld(); near.updateProjectionMatrix();
    scatter.update(near, 0);
    const low = scatter.visibleInstances;

    const far = new THREE.PerspectiveCamera(34, 16 / 9, 1, 600);
    far.position.set(193, 72, 193);
    far.lookAt(256, 0, 256);
    far.updateMatrixWorld(); far.updateProjectionMatrix();
    scatter.update(far, 0);
    expect(scatter.visibleInstances).toBeGreaterThan(low);
    scatter.dispose();
  });
});

/* ==========================================================================
 * 4. CONFIG SANITY
 * ========================================================================== */

describe('scatter config', () => {
  it('rasterises coverage finely enough to see a 25 m rule', () => {
    expect(COVER_N).toBe(MAP_SIZE / SCATTER_COVERAGE.gridMetres);
    expect(SCATTER_COVERAGE.gridMetres).toBeLessThan(SCATTER_COVERAGE.patchMetres / 8);
  });

  it('keeps the bible targets', () => {
    expect(SCATTER_DENSITY.wildernessPerHectare).toBeGreaterThanOrEqual(260);
    expect(SCATTER_DENSITY.cityPerHectare).toBeGreaterThanOrEqual(105);
    expect(SCATTER_COVERAGE.patchMetres).toBe(25);
    expect(SCATTER_COVERAGE.targetAdorned).toBeGreaterThanOrEqual(0.55);
  });

  it('has a palette entry for every biome', () => {
    for (const biome of BIOMES) {
      const p = propPalette(biome);
      for (const [k, v] of Object.entries(p)) {
        expect(typeof v, `${biome}.${k}`).toBe('string');
        expect(v, `${biome}.${k}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
