/**
 * Deterministic nearest-slot matching shared by explicit and automatic
 * formations. All storage belongs to the caller so issuing an order never
 * allocates inside the simulation.
 */
export function assignNearestSlots(
  count: number,
  unitX: Float32Array,
  unitZ: Float32Array,
  slotX: Float32Array,
  slotZ: Float32Array,
  stableKey: Int32Array,
  assignment: Int32Array,
  order: Int32Array,
  taken: Uint8Array,
): void {
  for (let i = 0; i < count; i++) {
    order[i] = i;
    taken[i] = 0;
    assignment[i] = -1;
  }

  // Edge units choose first. If centre units claim an edge slot first, a
  // later edge unit is forced through the formation and the whole group knots.
  // Insertion sort is deterministic and count is bounded by the command cap.
  for (let i = 1; i < count; i++) {
    const unit = order[i];
    const d2 = unitX[unit] * unitX[unit] + unitZ[unit] * unitZ[unit];
    const key = stableKey[unit];
    let j = i - 1;
    while (j >= 0) {
      const other = order[j];
      const otherD2 = unitX[other] * unitX[other] + unitZ[other] * unitZ[other];
      if (otherD2 > d2 || (otherD2 === d2 && stableKey[other] <= key)) break;
      order[j + 1] = other;
      j--;
    }
    order[j + 1] = unit;
  }

  for (let rank = 0; rank < count; rank++) {
    const unit = order[rank];
    let best = -1;
    let bestD2 = Infinity;
    for (let slot = 0; slot < count; slot++) {
      if (taken[slot] !== 0) continue;
      const dx = unitX[unit] - slotX[slot];
      const dz = unitZ[unit] - slotZ[slot];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2 || (d2 === bestD2 && slot < best)) {
        bestD2 = d2;
        best = slot;
      }
    }
    assignment[unit] = best;
    taken[best] = 1;
  }
}
