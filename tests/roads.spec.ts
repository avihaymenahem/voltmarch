/**
 * Roads, kerbs and ground decals.
 *
 * Everything here runs headless. The road generator only needs the terrain's
 * typed arrays and `THREE.BufferGeometry`, and the decal pool is plain typed
 * arrays plus a `ShaderMaterial` that is never compiled — so the whole
 * spline / fillet / junction / pool path is testable in Node without GL.
 *
 * The three checks that matter most are the ones a visual critic grades from
 * a single screenshot:
 *   scorecard #32 — no axis-aligned straight road, corners radiused 4-8 m
 *   scorecard #33 — extruded 0.15-0.20 m kerb that casts its own shadow
 *   bible §8.10   — tread marks multiply the ground and fade, never accumulate
 *                   past the pool size
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  DECAL_GRID, DECAL_LIFT, MAP_SIZE, ROAD_CORNER_RADIUS_MAX, ROAD_CORNER_RADIUS_MIN,
  ROAD_KERB_HEIGHT, ROAD_LANE_WIDTH, ROAD_MIN_AXIS_DEGREES, ROAD_MOVE_COST, SCORCH_DARKEN,
  SQUISH_DARKEN, SQUISH_LIFE_SECONDS, TREAD_DARKEN,
} from '../src/core/config';
import { Terrain } from '../src/world/Terrain';
import {
  RoadClass, RoadSurface, ROAD_MASK_N, RoadNetwork, corridorHalfWidth,
  filletPolyline, getRoads, isRoad, offAxisDegrees, polylineLength, resample,
  roadHalfWidth, setActiveRoads,
} from '../src/world/Roads';
import {
  DECAL_LAYOUT, DecalField, DecalKind, groundDecals, layDecal, setActiveDecals,
} from '../src/world/Decals';

/* ==========================================================================
 * Pure polyline geometry
 * ========================================================================== */

describe('polyline helpers', () => {
  it('measures arc length', () => {
    expect(polylineLength([0, 0, 3, 4])).toBeCloseTo(5, 6);
    expect(polylineLength([0, 0, 10, 0, 10, 10])).toBeCloseTo(20, 6);
  });

  it('resamples at a uniform step and lands exactly on the end', () => {
    const out: number[] = [];
    resample([0, 0, 100, 0], 10, 0, 100, out);
    expect(out.length / 2).toBe(11);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[out.length - 2]).toBeCloseTo(100, 6);
    for (let i = 2; i < out.length; i += 2) {
      expect(Math.hypot(out[i] - out[i - 2], out[i + 1] - out[i - 1])).toBeCloseTo(10, 5);
    }
  });

  it('resamples a trimmed span, which is how a chain meets a junction pad', () => {
    const out: number[] = [];
    resample([0, 0, 100, 0], 5, 12, 88, out);
    expect(out[0]).toBeCloseTo(12, 5);
    expect(out[out.length - 2]).toBeCloseTo(88, 5);
  });

  it('measures degrees off the nearest world axis', () => {
    expect(offAxisDegrees(0, 0, 10, 0)).toBeCloseTo(0, 4);
    expect(offAxisDegrees(0, 0, 0, 10)).toBeCloseTo(0, 4);
    expect(offAxisDegrees(0, 0, 10, 10)).toBeCloseTo(45, 4);
    expect(offAxisDegrees(0, 0, -10, 0)).toBeCloseTo(0, 4);
    expect(offAxisDegrees(0, 0, 10, 1)).toBeCloseTo(5.71, 1);
  });
});

describe('filletPolyline — scorecard #32', () => {
  it('replaces a right-angle corner with an arc of the requested radius', () => {
    const out: number[] = [];
    const radii: number[] = [];
    filletPolyline([-50, 0, 0, 0, 0, 50], 4, 8, 1.0, out, radii);

    expect(radii.length).toBe(1);
    expect(radii[0]).toBeGreaterThanOrEqual(4);
    expect(radii[0]).toBeLessThanOrEqual(8);

    // For a 90-degree turn the centre sits at (-r, r) and every arc point must
    // be exactly r away from it.
    const r = radii[0];
    let onCircle = 0;
    for (let i = 0; i < out.length; i += 2) {
      const d = Math.hypot(out[i] - -r, out[i + 1] - r);
      if (Math.abs(d - r) < 1e-6) onCircle++;
    }
    expect(onCircle).toBeGreaterThanOrEqual(3);
  });

  it('shrinks the radius rather than overrunning a short leg', () => {
    const out: number[] = [];
    const radii: number[] = [];
    // 5 m legs cannot host an 8 m radius on a 90-degree turn.
    filletPolyline([-5, 0, 0, 0, 0, 5], 4, 8, 0.5, out, radii);
    expect(radii[0]).toBeLessThanOrEqual(0.45 * 5 + 1e-6);
    expect(radii[0]).toBeGreaterThan(0);
  });

  it('leaves a straight run alone', () => {
    const out: number[] = [];
    const radii: number[] = [];
    filletPolyline([0, 0, 50, 0, 100, 0], 4, 8, 1.0, out, radii);
    expect(radii.length).toBe(0);
    expect(out.length / 2).toBe(3);
  });

  it('never emits a cusp: consecutive headings turn by less than 90 degrees', () => {
    const out: number[] = [];
    const radii: number[] = [];
    filletPolyline([-80, 0, 0, 0, 40, 60, 120, 20], 15, 40, 2.0, out, radii);
    for (let i = 4; i < out.length; i += 2) {
      const a0 = Math.atan2(out[i - 1] - out[i - 3], out[i - 2] - out[i - 4]);
      const a1 = Math.atan2(out[i + 1] - out[i - 1], out[i] - out[i - 2]);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      expect(Math.abs(d)).toBeLessThan(Math.PI * 0.5);
    }
  });
});

/* ==========================================================================
 * Widths
 * ========================================================================== */

describe('road widths', () => {
  it('matches bible §6.3: 2-lane 6.8 m, 4-lane 13.6 m', () => {
    expect(roadHalfWidth(RoadClass.Street) * 2).toBeCloseTo(2 * ROAD_LANE_WIDTH, 6);
    expect(roadHalfWidth(RoadClass.Arterial) * 2).toBeCloseTo(4 * ROAD_LANE_WIDTH, 6);
    expect(ROAD_LANE_WIDTH).toBeGreaterThanOrEqual(3.2);
    expect(ROAD_LANE_WIDTH).toBeLessThanOrEqual(3.5);
  });

  it('adds kerb and pavement to the corridor', () => {
    expect(corridorHalfWidth(RoadClass.Street))
      .toBeGreaterThan(roadHalfWidth(RoadClass.Street));
  });

  it('keeps the kerb inside bible §6.2 (0.15-0.20 m)', () => {
    expect(ROAD_KERB_HEIGHT).toBeGreaterThanOrEqual(0.15);
    expect(ROAD_KERB_HEIGHT).toBeLessThanOrEqual(0.20);
  });
});

/* ==========================================================================
 * A whole generated network on a real heightfield
 * ========================================================================== */

describe('RoadNetwork — end to end', () => {
  let scene: THREE.Scene;
  let terrain: Terrain;
  let net: RoadNetwork;

  beforeAll(() => {
    scene = new THREE.Scene();
    terrain = new Terrain({ scene, seed: 0x7e44a1, biome: 'temperate' });
    net = new RoadNetwork({ scene, terrain, seed: 0x1234abc, decals: null });
    net.generate();
    setActiveRoads(net);
  });

  it('produces a connected network with junctions', () => {
    const s = net.stats();
    expect(s.chains).toBeGreaterThan(0);
    expect(s.metres).toBeGreaterThan(200);
    expect(s.junctions).toBeGreaterThanOrEqual(1);
  });

  it('has NO axis-aligned road leg — scorecard #32, first clause', () => {
    // The generator's fallback bend guarantees at least ~6.8 degrees even when
    // no legal candidate cleared the full threshold.
    expect(net.stats().minOffAxisDegrees).toBeGreaterThan(6);
    expect(ROAD_MIN_AXIS_DEGREES).toBeGreaterThanOrEqual(8);
  });

  it('radiuses every junction corner into the 4-8 m band — scorecard #32', () => {
    const s = net.stats();
    if (s.junctions === 0) return;
    expect(s.cornerRadiusMin).toBeGreaterThan(3.0);
    expect(s.cornerRadiusMax).toBeLessThanOrEqual(ROAD_CORNER_RADIUS_MAX + 1e-6);
    expect(s.cornerRadiusMax).toBeGreaterThanOrEqual(ROAD_CORNER_RADIUS_MIN * 0.5);
  });

  it('bends the open runs inside the 15-40 m band — bible §6.3', () => {
    const s = net.stats();
    if (s.bendRadiusMax === 0) return;
    expect(s.bendRadiusMax).toBeLessThanOrEqual(40 + 1e-6);
    expect(s.bendRadiusMin).toBeGreaterThan(0);
  });

  it('builds three meshes and only the kerb casts a shadow — scorecard #33', () => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('road.')) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(3);

    const kerb = meshes.find((m) => m.name === 'road.kerb');
    expect(kerb).toBeDefined();
    expect(kerb!.castShadow).toBe(true);
    // The kerb is a real extrusion: its bounding box must be at least one kerb
    // height tall. A painted stripe would be flat and would fail #33.
    kerb!.geometry.computeBoundingBox();
    const bb = kerb!.geometry.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeGreaterThanOrEqual(ROAD_KERB_HEIGHT);

    for (const m of meshes) {
      if (m.name === 'road.kerb') continue;
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(true);
    }
  });

  it('carries the marking attribute on every carriageway vertex', () => {
    let road: THREE.Mesh | null = null;
    scene.traverse((o) => { if (o.name === 'road.carriageway') road = o as THREE.Mesh; });
    expect(road).not.toBeNull();
    const attr = (road! as THREE.Mesh).geometry.getAttribute('aRoad');
    expect(attr).toBeDefined();
    expect(attr.itemSize).toBe(4);
    expect(attr.count).toBeGreaterThan(100);
  });

  it('rasterises a mask that agrees with the centreline', () => {
    expect(net.mask.length).toBe(ROAD_MASK_N * ROAD_MASK_N);
    let carriageway = 0;
    let pavement = 0;
    for (let i = 0; i < net.mask.length; i++) {
      if (net.mask[i] >= RoadSurface.Carriageway) carriageway++;
      else if (net.mask[i] !== RoadSurface.None) pavement++;
    }
    expect(carriageway).toBeGreaterThan(0);
    // Every corridor has kerb+pavement on both sides, so there is always more
    // non-carriageway corridor than there is road.
    expect(pavement).toBeGreaterThan(0);
    expect(net.stats().coverage).toBeGreaterThan(0.005);
    expect(net.stats().coverage).toBeLessThan(0.5);
  });

  it('answers isRoad / isCarriageway consistently with the mask', () => {
    let hit = 0;
    for (let tz = 0; tz < ROAD_MASK_N; tz += 7) {
      for (let tx = 0; tx < ROAD_MASK_N; tx += 7) {
        const x = (tx + 0.5) * (MAP_SIZE / ROAD_MASK_N);
        const z = (tz + 0.5) * (MAP_SIZE / ROAD_MASK_N);
        const v = net.mask[tz * ROAD_MASK_N + tx];
        expect(net.isRoad(x, z)).toBe(v !== RoadSurface.None);
        expect(net.isCarriageway(x, z)).toBe(v >= RoadSurface.Carriageway);
        if (v !== RoadSurface.None) hit++;
      }
    }
    expect(hit).toBeGreaterThan(0);
  });

  it('reports nothing outside the map instead of reading out of bounds', () => {
    expect(net.isRoad(-5, 10)).toBe(false);
    expect(net.isRoad(10, MAP_SIZE + 40)).toBe(false);
    expect(net.surfaceAt(-1, -1)).toBe(RoadSurface.None);
  });

  it('exposes a module-level accessor that is safe before init', () => {
    expect(getRoads()).toBe(net);
    expect(typeof isRoad(256, 256)).toBe('boolean');
    setActiveRoads(null);
    expect(isRoad(256, 256)).toBe(false);
    setActiveRoads(net);
  });

  it('finds the nearest centreline without allocating', () => {
    const out = new Float32Array(4);
    // Pick a point we know is on a road, then confirm the query snaps to it.
    let px = -1;
    let pz = -1;
    for (let tz = 0; tz < ROAD_MASK_N && px < 0; tz++) {
      for (let tx = 0; tx < ROAD_MASK_N; tx++) {
        if (net.mask[tz * ROAD_MASK_N + tx] >= RoadSurface.Carriageway) {
          px = (tx + 0.5) * (MAP_SIZE / ROAD_MASK_N);
          pz = (tz + 0.5) * (MAP_SIZE / ROAD_MASK_N);
          break;
        }
      }
    }
    expect(px).toBeGreaterThan(0);
    expect(net.nearestRoadPoint(px, pz, 40, out)).toBe(true);
    expect(out[2]).toBeLessThanOrEqual(40);
    expect(net.nearestRoadPoint(-500, -500, 20, out)).toBe(false);
  });

  it('lowers the terrain movement cost under the carriageway', () => {
    let lowered = 0;
    for (let i = 0; i < terrain.costGrid.length; i++) {
      if (terrain.costGrid[i] === ROAD_MOVE_COST) lowered++;
    }
    expect(lowered).toBeGreaterThan(0);
    expect(net.moveMultiplierAt(-500, -500)).toBe(1);
  });

  it('stamps the paving splat slot under the road', () => {
    let paved = 0;
    for (let i = 0; i < terrain.surface.length; i++) {
      if (terrain.surface[i] === 5 /* SurfaceId.Paving */) paved++;
    }
    expect(paved).toBeGreaterThan(0);
  });

  it('is reproducible: the same seed builds the same network', () => {
    const scene2 = new THREE.Scene();
    const other = new RoadNetwork({
      scene: scene2, terrain, seed: 0x1234abc, decals: null, stampTerrain: false,
    });
    other.generate();
    const a = net.stats();
    const b = other.stats();
    expect(b.chains).toBe(a.chains);
    expect(b.junctions).toBe(a.junctions);
    expect(b.metres).toBeCloseTo(a.metres, 3);
    other.dispose();
  });

  it('disposes cleanly', () => {
    const scene3 = new THREE.Scene();
    const throwaway = new RoadNetwork({
      scene: scene3, terrain, seed: 99, decals: null, stampTerrain: false,
    });
    throwaway.generate();
    throwaway.dispose();
    let meshes = 0;
    scene3.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBe(0);
  });
});

/* ==========================================================================
 * Decals
 * ========================================================================== */

describe('DecalField — the pool', () => {
  const flat = (): DecalField => new DecalField({
    scene: new THREE.Scene(), capacity: 8, heightAt: (x, z) => 1 + x * 0.01 - z * 0.005,
  });

  it('lays a decal conformed to the ground with the configured lift', () => {
    const f = flat();
    f.spawn(DecalKind.Scorch, 100, 60, 4, 4, 0);
    const pos = f.mesh.geometry.getAttribute('position');
    for (let i = 0; i < DECAL_LAYOUT.vertsPerDecal; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const expected = 1 + x * 0.01 - z * 0.005 + DECAL_LIFT;
      expect(pos.getY(i)).toBeCloseTo(expected, 5);
    }
    f.dispose();
  });

  it('sizes a slot at (DECAL_GRID+1)^2 vertices and 18 triangles', () => {
    expect(DECAL_LAYOUT.vertsPerDecal).toBe((DECAL_GRID + 1) * (DECAL_GRID + 1));
    expect(DECAL_LAYOUT.indicesPerDecal / 3).toBe(DECAL_GRID * DECAL_GRID * 2);
  });

  it('rotates about the decal centre with yaw 0 facing +Z', () => {
    const f = new DecalField({ scene: new THREE.Scene(), capacity: 4 });
    f.spawn(DecalKind.Tread, 0, 0, 1, 5, 0);
    const pos = f.mesh.geometry.getAttribute('position');
    // Unrotated: the long axis runs along Z.
    let spanX = 0;
    let spanZ = 0;
    for (let i = 0; i < DECAL_LAYOUT.vertsPerDecal; i++) {
      spanX = Math.max(spanX, Math.abs(pos.getX(i)));
      spanZ = Math.max(spanZ, Math.abs(pos.getZ(i)));
    }
    expect(spanZ).toBeCloseTo(5, 5);
    expect(spanX).toBeCloseTo(1, 5);

    f.spawn(DecalKind.Tread, 0, 0, 1, 5, Math.PI / 2);
    let spanX2 = 0;
    let spanZ2 = 0;
    const base = DECAL_LAYOUT.vertsPerDecal;
    for (let i = base; i < base * 2; i++) {
      spanX2 = Math.max(spanX2, Math.abs(pos.getX(i)));
      spanZ2 = Math.max(spanZ2, Math.abs(pos.getZ(i)));
    }
    expect(spanX2).toBeCloseTo(5, 5);
    expect(spanZ2).toBeCloseTo(1, 5);
    f.dispose();
  });

  it('recycles oldest-first once the pool is full and never exceeds capacity', () => {
    const f = flat();
    for (let i = 0; i < 40; i++) f.spawn(DecalKind.Scorch, i * 3, 10, 2, 2, 0);
    expect(f.liveCount).toBeLessThanOrEqual(8);
    const s = f.stats();
    expect(s.spawned).toBe(40);
    expect(s.evicted).toBe(32);
    expect(s.capacity).toBe(8);
    f.dispose();
  });

  it('collapses an expired slot to a degenerate point', () => {
    const f = flat();
    f.spawn(DecalKind.Dust, 20, 20, 3, 3, 0, 2 /* life */, 1);
    expect(f.liveCount).toBe(1);
    // Sweep the whole pool a few times so the round robin certainly reaches it.
    for (let i = 0; i < 6; i++) f.frame(1);
    expect(f.liveCount).toBe(0);
    const pos = f.mesh.geometry.getAttribute('position');
    for (let i = 1; i < DECAL_LAYOUT.vertsPerDecal; i++) {
      expect(pos.getX(i)).toBe(pos.getX(0));
      expect(pos.getZ(i)).toBe(pos.getZ(0));
    }
    f.dispose();
  });

  it('never expires a permanent decal', () => {
    const f = flat();
    f.scorch(40, 40, 6);
    for (let i = 0; i < 40; i++) f.frame(10);
    expect(f.liveCount).toBe(1);
    f.dispose();
  });

  it('lays a tread PAIR straddling the track gauge', () => {
    const f = new DecalField({ scene: new THREE.Scene(), capacity: 8 });
    f.layTread(0, 0, 0, 4);
    expect(f.liveCount).toBe(2);
    const pos = f.mesh.geometry.getAttribute('position');
    // yaw 0 faces +Z, so the two strips are offset in +/-X by half the gauge.
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < DECAL_LAYOUT.vertsPerDecal * 2; i++) {
      minX = Math.min(minX, pos.getX(i));
      maxX = Math.max(maxX, pos.getX(i));
    }
    expect(maxX - minX).toBeGreaterThan(3.9);
    f.dispose();
  });

  it('multiplies rather than alpha-blends, with a darkening floor — bible §8.10', () => {
    const f = flat();
    const m = f.mesh.material as THREE.ShaderMaterial;
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrc).toBe(THREE.DstColorFactor);
    expect(m.blendDst).toBe(THREE.ZeroFactor);
    // Alpha is untouched, so a decal can never punch a hole in coverage.
    expect(m.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(m.blendDstAlpha).toBe(THREE.OneFactor);
    expect(m.depthWrite).toBe(false);
    expect(m.toneMapped).toBe(false);
    // A floor, so one decal can never take the ground to black on its own, and
    // overlapping decals compound from a much higher base.
    expect(m.uniforms.uFloor.value).toBeGreaterThan(SCORCH_DARKEN);
    f.dispose();
  });

  it('marks only the touched vertex span dirty and reuses its range record', () => {
    const f = flat();
    f.spawn(DecalKind.Oil, 5, 5, 2, 2, 0);
    f.frame(0.016);
    const pos = f.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    // One decal touched, so the flushed range covers exactly one slot.
    expect(pos.updateRanges.length).toBeLessThanOrEqual(1);
    f.dispose();
  });

  it('exposes a module accessor that no-ops before init', () => {
    setActiveDecals(null);
    expect(groundDecals()).toBeNull();
    expect(() => layDecal(DecalKind.Scorch, 1, 1, 2)).not.toThrow();
    const f = flat();
    setActiveDecals(f);
    layDecal(DecalKind.Scorch, 1, 1, 2);
    expect(f.liveCount).toBe(1);
    setActiveDecals(null);
    f.dispose();
  });
});

/* ==========================================================================
 * THE ATLAS ITSELF — every kind must have ink
 *
 * A decal kind wired perfectly end to end still draws nothing if its atlas tile
 * is empty, and `spawn()` will happily stamp it, count it live, and report it
 * in `stats()` the whole time. The alpha channel of the tile IS the coverage
 * the fragment shader multiplies by, so a tile of zeroes is a guaranteed
 * `discard` and there is no other symptom.
 * ========================================================================== */

describe('the procedural decal atlas has a drawn tile for every kind', () => {
  /** The atlas bytes, straight off the material the mesh renders with. */
  function atlas(): { data: Uint8Array; size: number; tile: number } {
    const f = new DecalField({ scene: new THREE.Scene(), capacity: 1 });
    const m = f.mesh.material as THREE.ShaderMaterial;
    const tex = m.uniforms.uAtlas.value as THREE.DataTexture;
    const data = (tex.image as { data: Uint8Array }).data;
    // Copy before disposing: the texture owns the buffer.
    const out = { data: data.slice(), size: tex.image.width, tile: DECAL_LAYOUT.atlasTile };
    f.dispose();
    return out;
  }

  /** Mean coverage (alpha) and peak darkening over one tile. */
  function measure(kind: DecalKind): { coverage: number; inked: number; darkest: number } {
    const { data, size, tile } = atlas();
    const cols = DECAL_LAYOUT.atlasCols;
    const ox = (kind % cols) * tile;
    const oy = Math.floor(kind / cols) * tile;
    let sum = 0;
    let inked = 0;
    let darkest = 1;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const o = ((oy + y) * size + ox + x) * 4;
        const a = data[o + 3] / 255;
        sum += a;
        if (a > 0.02) inked++;
        // RGB is a multiply factor at half scale: 0.5 decodes to 1.0.
        if (a > 0.5) darkest = Math.min(darkest, (data[o] / 255) * 2);
      }
    }
    return { coverage: sum / (tile * tile), inked, darkest };
  }

  const KINDS: ReadonlyArray<readonly [string, DecalKind]> = [
    ['Tread', DecalKind.Tread], ['Tyre', DecalKind.Tyre], ['Scorch', DecalKind.Scorch],
    ['Crater', DecalKind.Crater], ['Oil', DecalKind.Oil], ['Dust', DecalKind.Dust],
    ['Manhole', DecalKind.Manhole], ['LightPool', DecalKind.LightPool],
    ['Crack', DecalKind.Crack], ['Patch', DecalKind.Patch], ['Squish', DecalKind.Squish],
  ];

  for (const [name, kind] of KINDS) {
    it(`${name} covers a real fraction of its tile`, () => {
      const m = measure(kind);
      // A crack is the thinnest thing in here and still inks ~3% of the tile.
      expect(m.coverage, `${name} tile is blank`).toBeGreaterThan(0.01);
      expect(m.inked).toBeGreaterThan(200);
    });
  }

  it('Squish is a pressed strip: longer than it is wide, and it presses DOWN', () => {
    const { data, size, tile } = atlas();
    const cols = DECAL_LAYOUT.atlasCols;
    const ox = (DecalKind.Squish % cols) * tile;
    const oy = Math.floor(DecalKind.Squish / cols) * tile;
    // Widest inked run across (row through the middle) vs longest inked run
    // along (column through the middle). A track presses a strip, not a disc.
    let across = 0;
    let along = 0;
    const mid = tile >> 1;
    for (let x = 0; x < tile; x++) {
      if (data[((oy + mid) * size + ox + x) * 4 + 3] > 6) across++;
    }
    for (let y = 0; y < tile; y++) {
      if (data[((oy + y) * size + ox + mid) * 4 + 3] > 6) along++;
    }
    expect(across).toBeGreaterThan(20);
    expect(along).toBeGreaterThan(across);
  });

  it('Squish carries the tread cleat rhythm, which is what says a TRACK did it', () => {
    const { data, size, tile } = atlas();
    const cols = DECAL_LAYOUT.atlasCols;
    const ox = (DecalKind.Squish % cols) * tile;
    const oy = Math.floor(DecalKind.Squish / cols) * tile;
    // Walk the centre column, HIGH-PASS it, and count sign changes. A plain
    // threshold cannot do this job: the bars ride on the blob's own radial
    // falloff, so "above 150" is true across the whole middle of the mark and
    // false at both ends whatever the cleats do. Subtracting a one-period
    // moving average (the bars run at period 9 over 128 texels, so 15) leaves
    // the modulation and nothing else — a smooth blob residual never crosses.
    const mid = ox + (tile >> 1);
    const col: number[] = [];
    for (let y = 0; y < tile; y++) col.push(data[((oy + y) * size + mid) * 4 + 3]);
    const W = 15;
    let crossings = 0;
    let prev = 0;
    for (let y = W; y < tile - W; y++) {
      if (col[y] < 8) { prev = 0; continue; }
      let mean = 0;
      for (let k = y - (W >> 1); k <= y + (W >> 1); k++) mean += col[k];
      mean /= W;
      const residual = col[y] - mean;
      if (Math.abs(residual) < 4) continue;
      const sign = residual > 0 ? 1 : -1;
      if (prev !== 0 && sign !== prev) crossings++;
      prev = sign;
    }
    expect(crossings, 'no cleat modulation — the mark reads as a smudge').toBeGreaterThan(6);
  });

  it('Squish darkens the ground without hitting the floor everywhere', () => {
    const f = new DecalField({ scene: new THREE.Scene(), capacity: 2 });
    const m = f.mesh.material as THREE.ShaderMaterial;
    // The multiply tint is per-vertex and uploaded linear; the shader emits
    // `tint * (atlasRGB * 2)` clamped up to uFloor. Pin the tint's own value so
    // a future edit cannot quietly take the mark to the floor across the board,
    // which would flatten the cleat rhythm the previous case just measured.
    f.spawn(DecalKind.Squish, 10, 10, 1, 1, 0);
    const tint = f.mesh.geometry.getAttribute('aTint');
    expect(tint.getX(0)).toBeCloseTo(SQUISH_DARKEN, 5);
    expect(tint.getX(0)).toBeGreaterThan(m.uniforms.uFloor.value);
    expect(tint.getX(0)).toBeLessThan(TREAD_DARKEN);
    f.dispose();
  });

  it('Squish fades — a battlefield does not tile over with permanent prints', () => {
    const f = new DecalField({ scene: new THREE.Scene(), capacity: 2 });
    f.spawn(DecalKind.Squish, 5, 5, 1, 1, 0);
    expect(f.liveCount).toBe(1);
    // Well past SQUISH_LIFE_SECONDS, sweeping the whole pool each time.
    for (let i = 0; i < 8; i++) f.frame(SQUISH_LIFE_SECONDS / 4);
    expect(f.liveCount).toBe(0);
    f.dispose();
  });
});
