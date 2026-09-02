/**
 * Building on terrain destroys the props under it (TODO #5).
 *
 * The whole path is headless: `Scatter` only ever writes into typed arrays and
 * `InstancedMesh.instanceMatrix`, so bake -> place -> clear -> repack runs in
 * Node with no GL context, exactly like tests/scatter.spec.ts.
 *
 * The tests that matter are `leaves nothing standing inside the footprint`
 * (the reported bug) and `is local, not proportional to the map` (the reason
 * the fix is allowed to run inside simTick on a GPU-bound build). The rest are
 * there so that when one of those goes red the reason is already on screen.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { CELL, SCATTER_LIMITS } from '../src/core/config';
import { FxKind } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import { Scatter, PROP_CLEAR_MARGIN, isCrushableFamily, setActiveScatter } from '../src/world/Scatter';
import { PROP_DEFS } from '../src/world/PropLibrary';
import { PROP_WIND, PROP_WIND_PHASE_ATTRIBUTE } from '../src/world/prop-wind';
import { clearPropsUnder } from '../src/world/scatter-clear.system';

/** A generated map with props on it. Seeds are fixed, so this is repeatable. */
function rig(densityScale = 1.0, seed = 0x5ca77e): { terrain: Terrain; scatter: Scatter } {
  const scene = new THREE.Scene();
  const terrain = new Terrain({ scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1 });
  const scatter = new Scatter({
    scene, terrain, biome: 'temperate', seed, urban: 0.25, densityScale,
    preferred: ['tree', 'bush', 'rock'],
  });
  scatter.generate();
  return { terrain, scatter };
}

/** A camera that sees the entire 512 m map, so `visibleInstances` == live props. */
function wholeMapCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-400, 400, 400, -400, 1, 2000);
  cam.position.set(256, 600, 256);
  cam.lookAt(256, 0, 256);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

const POS = new Float32Array(SCATTER_LIMITS.maxProps * 4);

/**
 * The densest 4x4-cell (16 m) window on the map, as cell coordinates. Picking
 * the footprint by measurement rather than by guess is what keeps these tests
 * from silently passing on empty ground when the generator changes.
 *
 * `only` narrows the histogram to the props a caller actually cares about, and
 * the mow test is why it exists. That test asserts a trail fells something, so
 * what it needs is the densest CRUSHABLE ground — but this ranked by TOTAL prop
 * count, which on a map that is 35% grass and 14% rock is as likely to point at
 * a tuft field or a scree slope as at a copse. It had been passing on two
 * bushes out of the four props its 60 m line met; one generator change later
 * the same line met two boulders and the test went red having found nothing
 * wrong. The map carried 1847 crushable props at the time.
 */
function densestFootprint(
  scatter: Scatter, w: number, h: number, only?: (defIndex: number) => boolean,
): { cx: number; cz: number } {
  const n = scatter.positions(POS);
  let best = { cx: 40, cz: 40 };
  let bestCount = -1;
  // Coarse histogram over 16 m tiles, then take the winner's cell origin.
  const TILE = 16;
  const N = Math.ceil(512 / TILE);
  const hist = new Int32Array(N * N);
  for (let i = 0; i < n; i++) {
    if (only !== undefined && !only(POS[i * 4 + 3])) continue;
    const tx = Math.min(N - 1, (POS[i * 4] / TILE) | 0);
    const tz = Math.min(N - 1, (POS[i * 4 + 2] / TILE) | 0);
    hist[tz * N + tx]++;
  }
  for (let t = 0; t < hist.length; t++) {
    if (hist[t] <= bestCount) continue;
    const tx = t % N, tz = (t / N) | 0;
    const cx = Math.round((tx * TILE) / CELL) - ((w / 2) | 0);
    const cz = Math.round((tz * TILE) / CELL) - ((h / 2) | 0);
    if (cx < 2 || cz < 2 || cx + w > 126 || cz + h > 126) continue;
    bestCount = hist[t];
    best = { cx, cz };
  }
  expect(bestCount, 'the generator produced no props at all').toBeGreaterThan(0);
  return best;
}

/** Every instance translation currently uploaded, across every prop mesh. */
function uploadedTranslations(scene: THREE.Scene): number[][] {
  const out: number[][] = [];
  scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!(m as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    if (m.userData.vmShadowOnly === true) return;
    const arr = m.instanceMatrix.array as Float32Array;
    for (let i = 0; i < m.count; i++) {
      out.push([arr[i * 16 + 12], arr[i * 16 + 13], arr[i * 16 + 14]]);
    }
  });
  return out;
}

/** Colour LOD buckets and shadow proxies must keep phase paired with matrix. */
function expectUploadedPhases(scene: THREE.Scene): void {
  let checked = 0;
  scene.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh !== true || !mesh.name.startsWith('prop.')) return;
    const phase = mesh.geometry.getAttribute(PROP_WIND_PHASE_ATTRIBUTE);
    const matrix = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < mesh.count; i++) {
      const want = matrix[i * 16 + 12] * PROP_WIND.phaseX
        + matrix[i * 16 + 14] * PROP_WIND.phaseZ;
      expect(phase.getX(i), `${mesh.name} phase ${i}`).toBeCloseTo(want, 4);
      checked++;
    }
  });
  expect(checked).toBeGreaterThan(0);
}

let live: Scatter[] = [];
function track<T extends { terrain: Terrain; scatter: Scatter }>(r: T): T {
  live.push(r.scatter);
  return r;
}
afterEach(() => {
  for (const s of live) s.dispose();
  live = [];
  setActiveScatter(null);
});

/* ==========================================================================
 * 1. THE REPORTED BUG
 * ========================================================================== */

describe('Scatter.clearFootprint — a structure fells what it lands on', () => {
  it('leaves nothing standing inside the footprint', () => {
    const { scatter } = track(rig());
    const { cx, cz } = densestFootprint(scatter, 5, 5);
    const minX = cx * CELL, minZ = cz * CELL;
    const maxX = (cx + 5) * CELL, maxZ = (cz + 5) * CELL;

    const before = scatter.countInBox(minX, minZ, maxX, maxZ);
    expect(before, 'test picked a footprint with no props under it').toBeGreaterThan(0);

    const removed = scatter.clearFootprint(minX, minZ, maxX, maxZ);
    expect(removed).toBeGreaterThanOrEqual(before);
    expect(scatter.countInBox(minX, minZ, maxX, maxZ)).toBe(0);
  });

  it('drops the live prop count by exactly what it cleared', () => {
    const { scatter } = track(rig());
    const { cx, cz } = densestFootprint(scatter, 5, 5);
    const total = scatter.propCount;
    const removed = scatter.clearFootprint(
      cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL,
    );
    expect(removed).toBeGreaterThan(0);
    expect(scatter.propCount).toBe(total - removed);
    expect(scatter.clearedProps).toBe(removed);
    // `positions()` is the public read side; it must agree, not report ghosts.
    expect(scatter.positions(POS)).toBe(total - removed);
  });

  it('spares props beyond the margin', () => {
    const { scatter } = track(rig());
    const { cx, cz } = densestFootprint(scatter, 4, 4);
    const minX = cx * CELL, minZ = cz * CELL;
    const maxX = (cx + 4) * CELL, maxZ = (cz + 4) * CELL;

    // A ring well outside the margin and outside the widest canopy on the map.
    const OUTSIDE = PROP_CLEAR_MARGIN + 12;
    const ringBefore = scatter.countInBox(
      minX - OUTSIDE - 24, minZ - OUTSIDE - 24, minX - OUTSIDE, minZ - OUTSIDE,
    );
    const farBefore = scatter.countInBox(0, 0, 120, 120);

    scatter.clearFootprint(minX, minZ, maxX, maxZ);

    expect(scatter.countInBox(
      minX - OUTSIDE - 24, minZ - OUTSIDE - 24, minX - OUTSIDE, minZ - OUTSIDE,
    )).toBe(ringBefore);
    // The far corner of the map cannot possibly be touched by a 16 m footprint.
    if (minX > 200) expect(scatter.countInBox(0, 0, 120, 120)).toBe(farBefore);
  });

  it('clears a canopy that overhangs the wall, not just a trunk inside it', () => {
    // Same footprint, cleared with zero margin and with the shipping margin.
    // The shipping margin must never fell fewer props, and on dense ground it
    // fells more — that difference IS the overhang rule.
    const a = track(rig()).scatter;
    const b = track(rig()).scatter;
    const { cx, cz } = densestFootprint(a, 5, 5);
    const box: [number, number, number, number] =
      [cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL];

    const tight = a.clearFootprint(box[0], box[1], box[2], box[3], 0);
    const loose = b.clearFootprint(box[0], box[1], box[2], box[3], PROP_CLEAR_MARGIN);
    expect(loose).toBeGreaterThanOrEqual(tight);
  });
});

/* ==========================================================================
 * 2. THE GPU BUFFERS
 * ========================================================================== */

describe('Scatter.clearFootprint — instance buffers', () => {
  it('uploads exactly the surviving instances and none of the felled ones', () => {
    const scene = new THREE.Scene();
    const terrain = new Terrain({ scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1 });
    const scatter = new Scatter({
      scene, terrain, biome: 'temperate', seed: 0x5ca77e, urban: 0.25, densityScale: 1,
      preferred: ['tree', 'bush', 'rock'],
    });
    scatter.generate();
    live.push(scatter);

    const cam = wholeMapCamera();
    scatter.update(cam, 0);
    const total = scatter.propCount;
    expect(scatter.visibleInstances).toBe(total);

    const { cx, cz } = densestFootprint(scatter, 5, 5);
    const minX = cx * CELL, minZ = cz * CELL;
    const maxX = (cx + 5) * CELL, maxZ = (cz + 5) * CELL;
    const removed = scatter.clearFootprint(minX, minZ, maxX, maxZ);
    expect(removed).toBeGreaterThan(0);

    // The camera has not moved. Without the forced repack the felled props
    // would still be on screen until the player panned — which was the whole
    // point of the `chunkVisiblePrev` reset.
    scatter.update(cam, 0.016);
    expect(scatter.visibleInstances).toBe(total - removed);

    // And nothing uploaded may stand inside the cleared rectangle.
    const inside = uploadedTranslations(scene).filter(
      (t) => t[0] >= minX && t[0] <= maxX && t[2] >= minZ && t[2] <= maxZ,
    );
    expect(inside.length).toBe(0);
  });

  it('keeps every surviving instance intact — no matrix is corrupted by a swap', () => {
    const scene = new THREE.Scene();
    const terrain = new Terrain({ scene, seed: 0x7e44a1, biome: 'temperate', anisotropy: 1 });
    const scatter = new Scatter({
      scene, terrain, biome: 'temperate', seed: 0x5ca77e, urban: 0.25, densityScale: 1,
      preferred: ['tree', 'bush', 'rock'],
    });
    scatter.generate();
    live.push(scatter);

    const cam = wholeMapCamera();
    scatter.update(cam, 0);
    const { cx, cz } = densestFootprint(scatter, 5, 5);
    scatter.clearFootprint(cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL);
    scatter.update(cam, 0.016);

    // Every uploaded translation must match a live placement exactly. A
    // swap-with-last that forgot to fix `inst` would leave a duplicate or a
    // stale matrix, and this is what catches it.
    const n = scatter.positions(POS);
    const survivors = new Set<string>();
    for (let i = 0; i < n; i++) {
      survivors.add(`${POS[i * 4].toFixed(3)}|${POS[i * 4 + 2].toFixed(3)}`);
    }
    const uploaded = uploadedTranslations(scene);
    expect(uploaded.length).toBe(n);
    for (const t of uploaded) {
      expect(
        survivors.has(`${t[0].toFixed(3)}|${t[2].toFixed(3)}`),
        `uploaded instance at ${t[0].toFixed(2)},${t[2].toFixed(2)} is not a live prop`,
      ).toBe(true);
    }
    // No duplicates: a bad swap shows up as two instances at one position.
    const seen = new Set(uploaded.map((t) => `${t[0].toFixed(3)}|${t[2].toFixed(3)}`));
    expect(seen.size).toBe(uploaded.length);
    expectUploadedPhases(scene);
  });
});

/* ==========================================================================
 * 3. IDEMPOTENCE AND COST
 * ========================================================================== */

describe('Scatter.clearFootprint — cost', () => {
  it('is a no-op the second time — building on cleared ground clears nothing', () => {
    const { scatter } = track(rig());
    const { cx, cz } = densestFootprint(scatter, 5, 5);
    const box: [number, number, number, number] =
      [cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL];

    const first = scatter.clearFootprint(box[0], box[1], box[2], box[3]);
    expect(first).toBeGreaterThan(0);
    const after = scatter.propCount;

    const second = scatter.clearFootprint(box[0], box[1], box[2], box[3]);
    expect(second).toBe(0);
    expect(scatter.propCount).toBe(after);
    expect(scatter.clearedProps).toBe(first);
  });

  it('is local, not proportional to the map', () => {
    const { scatter } = track(rig());
    const total = scatter.propCount;
    expect(total).toBeGreaterThan(1500);

    const { cx, cz } = densestFootprint(scatter, 5, 5);
    scatter.clearFootprint(cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL);

    // The scan visits the 4 m cells the grown rectangle covers plus the widest
    // canopy on the map. A 20 m footprint therefore touches well under 1500 m2
    // of a 262000 m2 map; anything approaching `total` means the cell index is
    // not being used and the clear degenerated into a full sweep.
    console.info(
      `[scatter-clear] 20x20 m footprint on a ${total}-prop map: ` +
      `${scatter.lastClearScanned} placements examined, ${scatter.lastClearCount} felled ` +
      `(${((scatter.lastClearScanned / total) * 100).toFixed(2)}% of the map)`,
    );
    expect(scatter.lastClearScanned).toBeGreaterThan(0);
    expect(scatter.lastClearScanned).toBeLessThan(total * 0.03);
    expect(scatter.lastClearCount).toBeGreaterThan(0);
    expect(scatter.lastClearCount).toBeLessThanOrEqual(scatter.lastClearScanned);
  });

  it('scans the same amount when only distant placements differ', () => {
    // The density dial has a floor and grass completion has its own target:
    // different dial values no longer guarantee different total populations.
    // Instead hold the local placements identical and remove distant entries
    // from one fixture, rebuilding its real instance buffers and cell index.
    // Compact the list rather than marking entries dead: a full-array sweep
    // must have genuinely different amounts of work in these two fixtures.
    const sparse = track(rig(2.5)).scatter;
    const dense = track(rig(2.5)).scatter;
    const fixture = sparse as unknown as {
      placements: { x: number; z: number }[];
      disposeMeshes(): void;
      buildInstances(): void;
    };
    fixture.disposeMeshes();
    fixture.placements = fixture.placements.filter((p) => (
      p.x >= 150 && p.x <= 270 && p.z >= 150 && p.z <= 270
    ));
    fixture.buildInstances();
    expect(sparse.propCount).toBeGreaterThan(0);
    expect(dense.propCount).toBeGreaterThan(sparse.propCount * 4);

    const box: [number, number, number, number] = [200, 200, 220, 220];
    sparse.clearFootprint(box[0], box[1], box[2], box[3]);
    dense.clearFootprint(box[0], box[1], box[2], box[3]);

    // Identical local content must cost exactly the same, not merely remain
    // within a loose ratio of the global population.
    expect(dense.lastClearScanned).toBe(sparse.lastClearScanned);
    expect(dense.lastClearScanned).toBeGreaterThan(0);
    expect(dense.lastClearCount).toBe(sparse.lastClearCount);
    expect(dense.lastClearScanned).toBeLessThan(400);
  });

  it('costs a fraction of a millisecond per placement', () => {
    const { scatter } = track(rig());
    const boxes: number[][] = [];
    for (let i = 0; i < 60; i++) {
      const x = 40 + (i % 10) * 40, z = 40 + ((i / 10) | 0) * 40;
      boxes.push([x, z, x + 20, z + 20]);
    }
    const t0 = performance.now();
    let cleared = 0;
    for (const b of boxes) cleared += scatter.clearFootprint(b[0], b[1], b[2], b[3]);
    const perClear = (performance.now() - t0) / boxes.length;
    console.info(
      `[scatter-clear] ${boxes.length} clears, ${cleared} props felled, ` +
      `${perClear.toFixed(4)} ms per clear, ${scatter.lastClearScanned} scanned on the last one ` +
      `(map holds ${scatter.propCount} live props)`,
    );
    expect(cleared).toBeGreaterThan(0);
    // Reported in the task write-up; the assertion is only a regression fence
    // against someone reintroducing a full rebuild, which measures in tens of ms.
    expect(perClear).toBeLessThan(2.0);
  });
});

/* ==========================================================================
 * 4. DETERMINISM
 * ========================================================================== */

describe('Scatter.clearFootprint — determinism', () => {
  it('two identical worlds clear identically', () => {
    const a = track(rig()).scatter;
    const b = track(rig()).scatter;
    expect(a.propCount).toBe(b.propCount);

    const box: [number, number, number, number] = [180, 180, 204, 204];
    expect(a.clearFootprint(box[0], box[1], box[2], box[3]))
      .toBe(b.clearFootprint(box[0], box[1], box[2], box[3]));

    const pa = new Float32Array(SCATTER_LIMITS.maxProps * 4);
    const pb = new Float32Array(SCATTER_LIMITS.maxProps * 4);
    const na = a.positions(pa), nb = b.positions(pb);
    expect(na).toBe(nb);
    for (let i = 0; i < na * 4; i++) expect(pb[i]).toBe(pa[i]);
  });

  it('consumes no randomness — a fresh generate is bit-identical after a clear', () => {
    const { scatter } = track(rig());
    scatter.clearFootprint(180, 180, 204, 204);
    const after = new Float32Array(SCATTER_LIMITS.maxProps * 4);
    scatter.generate();
    const n = scatter.positions(after);

    const fresh = track(rig()).scatter;
    const ref = new Float32Array(SCATTER_LIMITS.maxProps * 4);
    expect(fresh.positions(ref)).toBe(n);
    for (let i = 0; i < n * 4; i++) expect(after[i]).toBe(ref[i]);
    expect(scatter.clearedProps).toBe(0);
  });
});

/* ==========================================================================
 * 5. THE SYSTEM — event payload in, dust out
 * ========================================================================== */

describe('scatter-clear.system — building:placed handling', () => {
  it('turns a footprint in CELLS into a clear in metres', () => {
    const { scatter } = track(rig());
    setActiveScatter(scatter);
    const { cx, cz } = densestFootprint(scatter, 4, 4);
    const before = scatter.countInBox(cx * CELL, cz * CELL, (cx + 4) * CELL, (cz + 4) * CELL);
    expect(before).toBeGreaterThan(0);

    const n = clearPropsUnder(cx, cz, 4, 4, () => { /* fx ignored here */ });
    expect(n).toBeGreaterThanOrEqual(before);
    expect(scatter.countInBox(cx * CELL, cz * CELL, (cx + 4) * CELL, (cz + 4) * CELL)).toBe(0);
  });

  it('raises dust, capped, and only for props big enough to see fall', () => {
    const { scatter } = track(rig());
    setActiveScatter(scatter);
    const { cx, cz } = densestFootprint(scatter, 6, 6);
    const kinds: FxKind[] = [];
    const scales: number[] = [];
    const n = clearPropsUnder(cx, cz, 6, 6, (kind, _x, _y, _z, _dx, _dy, _dz, scale) => {
      kinds.push(kind); scales.push(scale);
    });

    expect(n).toBeGreaterThan(0);
    expect(kinds.length).toBeLessThanOrEqual(10);
    for (const k of kinds) expect(k).toBe(FxKind.DustPuff);
    for (const s of scales) {
      expect(s).toBeGreaterThan(0.5);
      expect(s).toBeLessThanOrEqual(1.8);
    }
  });

  it('spends its dust on the biggest props felled, not the first ones scanned', () => {
    // The failure this guards: the cell scan reaches grass tufts long before it
    // reaches the oak in the corner, so taking the FIRST ten reported props
    // puffs ten times over flattened grass and never once where a tree fell.
    const { scatter } = track(rig());
    setActiveScatter(scatter);
    const { cx, cz } = densestFootprint(scatter, 6, 6);

    // Every prop the clear will fell, with its visual radius — measured by
    // running the same clear on an identical world with a reporting buffer.
    const mirror = track(rig()).scatter;
    const report = new Float32Array(512 * 4);
    const felled = mirror.clearFootprint(
      cx * CELL, cz * CELL, (cx + 6) * CELL, (cz + 6) * CELL, PROP_CLEAR_MARGIN, report,
    );
    expect(felled).toBeGreaterThan(0);
    const radii: number[] = [];
    for (let i = 0; i < Math.min(felled, 512); i++) radii.push(report[i * 4 + 3]);
    const big = radii.filter((r) => r >= 0.8).sort((a, b) => b - a);

    const puffed: number[] = [];
    clearPropsUnder(cx, cz, 6, 6, (_k, _x, _y, _z, _dx, _dy, _dz, scale) => {
      // Invert `scale = min(0.5 + r * 0.45, 1.8)` to recover the radius.
      puffed.push((scale - 0.5) / 0.45);
    });

    expect(puffed.length).toBe(Math.min(big.length, 10));
    if (puffed.length > 0) {
      // Largest first, and the largest puff must match the largest prop felled.
      for (let i = 1; i < puffed.length; i++) {
        expect(puffed[i]).toBeLessThanOrEqual(puffed[i - 1] + 1e-6);
      }
      const cap = (1.8 - 0.5) / 0.45;
      expect(puffed[0]).toBeCloseTo(Math.min(big[0], cap), 4);
      // Every puff must be at least as big as the 10th-biggest prop felled —
      // i.e. the selection really is the top slice, not an arbitrary one.
      const cutoff = big[Math.min(big.length, 10) - 1];
      for (const r of puffed) expect(r).toBeGreaterThanOrEqual(Math.min(cutoff, cap) - 1e-6);
    }
  });

  it('is inert with no active scatter, and silent on empty ground', () => {
    setActiveScatter(null);
    let pushes = 0;
    expect(clearPropsUnder(40, 40, 4, 4, () => { pushes++; })).toBe(0);
    expect(pushes).toBe(0);

    const { scatter } = track(rig());
    setActiveScatter(scatter);
    const { cx, cz } = densestFootprint(scatter, 4, 4);
    clearPropsUnder(cx, cz, 4, 4, () => { /* first pass fells them */ });
    pushes = 0;
    expect(clearPropsUnder(cx, cz, 4, 4, () => { pushes++; })).toBe(0);
    expect(pushes).toBe(0);
  });
});

/* ==========================================================================
 * 6. THE FELLED-PROP MASK — clearing survives a save
 *
 * The reported bug: a vehicle crush is permanent for the match, a save records
 * only the BUILDING footprints, and props are regenerated from the seed — so a
 * trail a player mowed through a wood stood again after a load. Scatter.ts
 * §3.10b is the fix and this is its contract. `tests/savegame.spec.ts` proves
 * the format carries it; these tests prove the two ends line up.
 * ========================================================================== */

/** Every live prop as a comparable key, sorted. Two lists or two worlds. */
function propKeys(scatter: Scatter): string[] {
  const buf = new Float32Array(SCATTER_LIMITS.maxProps * 4);
  const n = scatter.positions(buf);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${buf[i * 4].toFixed(3)},${buf[i * 4 + 2].toFixed(3)},${buf[i * 4 + 3]}`);
  }
  return out.sort();
}

/** True for a `positions()` defIndex whose family a hull may flatten. */
const isCrushableIndex = (defIndex: number): boolean =>
  isCrushableFamily(PROP_DEFS[defIndex].family);

/**
 * Mow a trail with the same call a hull makes. Runs the disc along a line
 * through the densest CRUSHABLE ground so it actually meets trees; returns the
 * count. See `densestFootprint` for why the filter is not optional here.
 */
function mowTrail(scatter: Scatter, cx: number, cz: number): number {
  let felled = 0;
  /*
   * THROUGH the window's centre, not along its top-left corner.
   *
   * `densestFootprint` returns the ORIGIN of a w x h window CENTRED on the
   * densest 16 m tile — `tileX * 16 / CELL - w / 2` — so `cx * CELL, cz * CELL`
   * is 8 m outside the tile the histogram just measured, on both axes. The
   * trail was therefore sweeping ground that had never been ranked for density
   * at all, and passing or failing on whatever happened to be lying there.
   * Two cells in on each axis puts it back on the tile it was aimed at.
   */
  const z = (cz + 2) * CELL;
  const x0 = (cx + 2) * CELL - 30;
  for (let step = 0; step < 24; step++) {
    felled += scatter.crushDisc(x0 + step * 2.5, z, 2.7);
  }
  return felled;
}

describe('Scatter — the felled-prop mask', () => {
  it('fingerprints the placement list, and two identical worlds agree', () => {
    const a = track(rig()).scatter;
    const b = track(rig()).scatter;
    expect(a.placementCount).toBeGreaterThan(0);
    expect(a.placementCount).toBe(b.placementCount);
    expect(a.placementFingerprint).not.toBe(0);
    expect(a.placementFingerprint).toBe(b.placementFingerprint);
  });

  it('a differently generated world reports a different fingerprint', () => {
    // The failure this is the gate against: applying a mask taken from one
    // placement list to a different one fells whichever trees happen to sit at
    // those indices. `scatter.system.ts` seeds exclusions from the spawned base,
    // so a different faction or opening is exactly this case.
    const a = track(rig()).scatter;
    const b = track(rig(1.0, 0x5ca77f)).scatter;
    expect(b.placementFingerprint).not.toBe(a.placementFingerprint);
  });

  it('felling does not move the fingerprint — a tombstone is not a removal', () => {
    const { scatter } = track(rig());
    const before = scatter.placementFingerprint;
    const { cx, cz } = densestFootprint(scatter, 4, 4);
    expect(scatter.clearFootprint(cx * CELL, cz * CELL, (cx + 4) * CELL, (cz + 4) * CELL))
      .toBeGreaterThan(0);
    expect(scatter.placementFingerprint).toBe(before);
    expect(scatter.placementCount).toBeGreaterThan(scatter.propCount);
  });

  it('THE REPORTED BUG: a mowed trail is still gone on the regenerated world', () => {
    const src = track(rig()).scatter;
    const { cx, cz } = densestFootprint(src, 4, 4, isCrushableIndex);
    const crushed = mowTrail(src, cx, cz);
    expect(crushed, 'the trail met no crushable vegetation').toBeGreaterThan(0);
    const survivors = propKeys(src);

    // The reload: the same world, generated again from the same seed. Without
    // the mask this is where the trail grows back.
    const dst = track(rig()).scatter;
    expect(dst.propCount).toBe(src.propCount + crushed);
    expect(dst.placementFingerprint).toBe(src.placementFingerprint);

    const mask = new Uint8Array(src.felledMaskBytes);
    expect(src.felledMask(mask)).toBe(mask.length);
    expect(dst.applyFelledMask(mask)).toBe(crushed);

    expect(dst.propCount).toBe(src.propCount);
    // Not just the same COUNT — the same props.
    expect(propKeys(dst)).toEqual(survivors);
  });

  it('carries a building footprint clear in the same bits', () => {
    const src = track(rig()).scatter;
    const { cx, cz } = densestFootprint(src, 5, 5);
    const built = src.clearFootprint(cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL);
    // The trail is aimed AFTER the clear, at whatever crushable ground is still
    // standing — `positions()` already excludes what the footprint took. It used
    // to be `cx + 8, cz + 8`, an unmeasured guess 32 m diagonally away, which
    // asserts `mowed > 0` about ground nothing had looked at.
    const trail = densestFootprint(src, 4, 4, isCrushableIndex);
    const mowed = mowTrail(src, trail.cx, trail.cz);
    expect(built).toBeGreaterThan(0);
    expect(mowed).toBeGreaterThan(0);

    const mask = new Uint8Array(src.felledMaskBytes);
    src.felledMask(mask);
    const dst = track(rig()).scatter;
    expect(dst.applyFelledMask(mask)).toBe(built + mowed);
    expect(propKeys(dst)).toEqual(propKeys(src));
  });

  it('is idempotent, so a footprint already cleared at boot costs nothing', () => {
    const src = track(rig()).scatter;
    const { cx, cz } = densestFootprint(src, 5, 5);
    const built = src.clearFootprint(cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL);
    const mask = new Uint8Array(src.felledMaskBytes);
    src.felledMask(mask);

    // The destination has already had the same footprint cleared by its own
    // `building:placed` during the boot, which is what really happens.
    const dst = track(rig()).scatter;
    expect(dst.clearFootprint(cx * CELL, cz * CELL, (cx + 5) * CELL, (cz + 5) * CELL)).toBe(built);
    expect(dst.applyFelledMask(mask)).toBe(0);
    expect(dst.applyFelledMask(mask)).toBe(0);
    expect(propKeys(dst)).toEqual(propKeys(src));
  });

  it('leaves the cell index honest, so a later clear still finds its props', () => {
    // `applyFelledMask` rebuilds the 4 m buckets rather than unlinking per prop.
    // If it forgot to, the next clear would walk chains full of tombstones and —
    // worse — a swapped instance would be reachable twice.
    const src = track(rig()).scatter;
    const { cx, cz } = densestFootprint(src, 5, 5);
    mowTrail(src, cx, cz);
    const mask = new Uint8Array(src.felledMaskBytes);
    src.felledMask(mask);

    const dst = track(rig()).scatter;
    dst.applyFelledMask(mask);
    const box: [number, number, number, number] =
      [(cx + 6) * CELL, (cz + 6) * CELL, (cx + 11) * CELL, (cz + 11) * CELL];
    const inBox = dst.countInBox(box[0], box[1], box[2], box[3]);
    expect(dst.clearFootprint(box[0], box[1], box[2], box[3])).toBeGreaterThanOrEqual(inBox);
    expect(dst.countInBox(box[0], box[1], box[2], box[3])).toBe(0);
  });

  it('refuses a short buffer instead of writing half a mask', () => {
    const { scatter } = track(rig());
    const short = new Uint8Array(scatter.felledMaskBytes - 1).fill(0xff);
    expect(scatter.felledMask(short)).toBe(0);
    // Untouched: a partial mask would fell the wrong props on the way back in.
    for (const b of short) expect(b).toBe(0xff);
    expect(scatter.applyFelledMask(short)).toBe(0);
    expect(scatter.propCount).toBe(scatter.placementCount);
  });

  it('is BOUNDED by the map prop ceiling, whatever the match does', () => {
    // The whole reason this is a bitmask and not a list of crush discs.
    const { scatter } = track(rig());
    const ceiling = (SCATTER_LIMITS.maxProps + 7) >> 3;
    expect(scatter.felledMaskBytes).toBeLessThanOrEqual(ceiling);
    expect(ceiling).toBeLessThanOrEqual(1125);
    for (let lap = 0; lap < 40; lap++) mowTrail(scatter, 10 + lap * 2, 20 + lap);
    expect(scatter.felledMaskBytes).toBeLessThanOrEqual(ceiling);
  });
});
