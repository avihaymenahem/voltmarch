import { MAX_SELECTION, NAV_FORMATION_GAP, NAV_FORMATION_MAX_OFFSET, NAV_FORMATION_MIN_SPACING } from '../core/config';
import { assignNearestSlots } from '../core/formation-assignment';
import type { EntityId } from '../core/types';
import type { EntityStore } from '../core/world';

export type FormationShape = 'line' | 'box' | 'wedge' | 'triangle';

/** Pooled destinations: x0,z0,x1,z1... Valid until the next call. */
const OUT = new Float32Array(MAX_SELECTION * 2);
const LOCAL = new Float32Array(MAX_SELECTION * 2);
const CURRENT_X = new Float32Array(MAX_SELECTION);
const CURRENT_Z = new Float32Array(MAX_SELECTION);
const SLOT_X = new Float32Array(MAX_SELECTION);
const SLOT_Z = new Float32Array(MAX_SELECTION);
const STABLE_KEYS = new Int32Array(MAX_SELECTION);
const ASSIGNMENT = new Int32Array(MAX_SELECTION);
const ASSIGNMENT_ORDER = new Int32Array(MAX_SELECTION);
const SLOT_TAKEN = new Uint8Array(MAX_SELECTION);

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

  let cx = 0, cz = 0, maxRadius = 0, firstYaw = 0, yawSin = 0, yawCos = 0, live = 0;
  for (let i = 0; i < n; i++) {
    const slot = store.index(ids[i] as EntityId);
    if (slot < 0) continue;
    cx += store.posX[slot]; cz += store.posZ[slot];
    if (store.radius[slot] > maxRadius) maxRadius = store.radius[slot];
    if (live === 0) firstYaw = store.yaw[slot];
    yawSin += Math.sin(store.yaw[slot]);
    yawCos += Math.cos(store.yaw[slot]);
    live++;
  }
  if (live === 0) return OUT;
  cx /= live; cz /= live;
  // One outlier must not rotate the whole squad. Circular averaging also
  // handles headings straddling -PI/+PI, where arithmetic averaging flips.
  const yaw = Math.hypot(yawSin, yawCos) > live * 0.2
    ? Math.atan2(yawSin, yawCos)
    : firstYaw;
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
    SLOT_X[i] = LOCAL[i * 2] * scale;
    SLOT_Z[i] = LOCAL[i * 2 + 1] * scale;
    const slot = store.index(ids[i] as EntityId);
    const dx = slot < 0 ? 0 : store.posX[slot] - cx;
    const dz = slot < 0 ? 0 : store.posZ[slot] - cz;
    // World -> formation-local, inverse of the rotation below.
    CURRENT_X[i] = c * dx - s * dz;
    CURRENT_Z[i] = s * dx + c * dz;
    STABLE_KEYS[i] = ids[i];
  }
  assignNearestSlots(
    n, CURRENT_X, CURRENT_Z, SLOT_X, SLOT_Z, STABLE_KEYS,
    ASSIGNMENT, ASSIGNMENT_ORDER, SLOT_TAKEN,
  );
  for (let i = 0; i < n; i++) {
    const assigned = ASSIGNMENT[i];
    const lx = SLOT_X[assigned], lz = SLOT_Z[assigned];
    OUT[i * 2] = cx + c * lx + s * lz;
    OUT[i * 2 + 1] = cz - s * lx + c * lz;
  }
  return OUT;
}
