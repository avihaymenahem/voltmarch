import { MAX_SELECTION, NAV_FORMATION_GAP, NAV_FORMATION_MAX_OFFSET, NAV_FORMATION_MIN_SPACING } from '../core/config';
import type { EntityId } from '../core/types';
import type { EntityStore } from '../core/world';

export type FormationShape = 'line' | 'box' | 'wedge' | 'triangle';

/** Pooled destinations: x0,z0,x1,z1... Valid until the next call. */
const OUT = new Float32Array(MAX_SELECTION * 2);
const LOCAL = new Float32Array(MAX_SELECTION * 2);

/**
 * Arrange a selection around its current centroid. The result itself is what
 * crosses the command bus, so replays and lockstep peers do not need a hidden
 * client-side formation preference to reproduce the move.
 */
export function planFormation(
  store: EntityStore,
  ids: Int32Array,
  count: number,
  shape: FormationShape,
): Float32Array {
  const n = Math.min(Math.max(0, count), MAX_SELECTION);
  if (n === 0) return OUT;

  let cx = 0, cz = 0, maxRadius = 0, yaw = 0, live = 0;
  for (let i = 0; i < n; i++) {
    const slot = store.index(ids[i] as EntityId);
    if (slot < 0) continue;
    cx += store.posX[slot]; cz += store.posZ[slot];
    if (store.radius[slot] > maxRadius) maxRadius = store.radius[slot];
    if (live === 0) yaw = store.yaw[slot];
    live++;
  }
  if (live === 0) return OUT;
  cx /= live; cz /= live;
  const spacing = Math.max(NAV_FORMATION_MIN_SPACING, maxRadius * 2 + NAV_FORMATION_GAP);

  let rows = 1;
  if (shape === 'box') rows = Math.ceil(n / Math.ceil(Math.sqrt(n)));
  let triRow = 0, triStart = 0, maxD = 0;
  for (let i = 0; i < n; i++) {
    let lx = 0, lz = 0;
    if (shape === 'line') {
      lx = (i - (n - 1) * 0.5) * spacing;
    } else if (shape === 'box') {
      const cols = Math.ceil(Math.sqrt(n));
      const row = Math.floor(i / cols);
      const rowCount = Math.min(cols, n - row * cols);
      lx = (i - row * cols - (rowCount - 1) * 0.5) * spacing;
      lz = ((rows - 1) * 0.5 - row) * spacing;
    } else if (shape === 'wedge') {
      if (i > 0) {
        const rank = Math.ceil(i / 2);
        lx = (i & 1 ? -rank : rank) * spacing;
        lz = -rank * spacing;
      }
    } else {
      while (i >= triStart + triRow + 1) { triStart += ++triRow; }
      const col = i - triStart;
      lx = (col - triRow * 0.5) * spacing;
      lz = -triRow * spacing;
    }
    LOCAL[i * 2] = lx; LOCAL[i * 2 + 1] = lz;
  }

  // Centre asymmetric shapes (the V and filled delta) on the order point.
  let mx = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += LOCAL[i * 2]; mz += LOCAL[i * 2 + 1]; }
  mx /= n; mz /= n;
  for (let i = 0; i < n; i++) {
    LOCAL[i * 2] -= mx; LOCAL[i * 2 + 1] -= mz;
    const d = Math.hypot(LOCAL[i * 2], LOCAL[i * 2 + 1]);
    if (d > maxD) maxD = d;
  }
  const scale = maxD > NAV_FORMATION_MAX_OFFSET ? NAV_FORMATION_MAX_OFFSET / maxD : 1;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const lx = LOCAL[i * 2] * scale, lz = LOCAL[i * 2 + 1] * scale;
    OUT[i * 2] = cx + c * lx + s * lz;
    OUT[i * 2 + 1] = cz - s * lx + c * lz;
  }
  return OUT;
}
