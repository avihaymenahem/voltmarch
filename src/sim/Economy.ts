/**
 * ============================================================================
 * VOLTMARCH — src/sim/Economy.ts
 * ============================================================================
 * THE ORE FIELD AND THE CREDIT LEDGER.
 *
 * Two things live here because they are the two halves of one number. Ore is
 * credits that have not been picked up yet; credits are ore that has. Splitting
 * them across files would mean two modules owning one balance sheet, and the
 * first bug would be a harvester that mined 700 units into a player who only
 * banked 640.
 *
 * ORE IS A CELL GRID, NOT ENTITIES
 * --------------------------------
 * 16 384 cells x 5 typed arrays, allocated once. A field of ore is not 200
 * crystal entities — it is 200 non-zero floats. That matters for three
 * separate reasons:
 *
 *   - MAX_ENTITIES is 4096 and three ore fields would eat a third of it.
 *   - `takeOre` has to be O(1) from a cell coordinate, because a harvester
 *     calls it 30 times a second.
 *   - The renderer wants DENSITY, not objects. `densityAt(cx,cz)` returns
 *     0..1 and `drainDirty()` hands back exactly the cells that changed since
 *     the last frame, so the crystal instancer restamps eight cells instead of
 *     rebuilding a field. Ore visibly draining is the single clearest signal
 *     this game gives that the economy is a real system and not a number that
 *     goes up.
 *
 * REGROWTH SPREADS FROM A NODE
 * ----------------------------
 * Every field has a node cell — its richest, at the centre — and every other
 * cell knows its UPSTREAM neighbour, the one step nearer the node. A cell only
 * regrows once its upstream neighbour is at least ORE_REGROW_SPREAD full. So a
 * patch mined from the near edge fills back in from the middle outward, and a
 * patch stripped to the rim takes a long time to reach the rim again. That is
 * the RA behaviour, and it is what makes "which field do I expand to" a real
 * decision instead of a lookup of who is closest.
 *
 * CLAIMS ARE TIMED, NOT REFERENCE-COUNTED
 * ---------------------------------------
 * A harvester claims a cell for ORE_CLAIM_TTL seconds and refreshes the claim
 * every tick it still wants it. Nothing has to remember to release anything: a
 * harvester that explodes mid-drive stops refreshing and its cell frees itself
 * four seconds later. A handle-based reservation would leak the first time a
 * claim-holder died inside a code path that forgot the release.
 *
 * DETERMINISM
 * -----------
 * No Math.random, no wall clock, no Set/Map iteration order in any hot path.
 * Field seeding uses `hash2f` on the cell coordinate, which is pure and stable
 * across machines, so the same scenario seed produces the identical blotch
 * pattern everywhere.
 * ============================================================================
 */

import {
  CELL, CREDITS_TICKER_RATE, CREDITS_TICKER_SNAP,
  FUNDS_EVA_COOLDOWN, INCOME_SMOOTHING, INCOME_WINDOW_TICKS,
  MAP_CELLS, MAP_CELL_COUNT, MAX_PLAYERS,
  ORE_CELL_JITTER, ORE_CELL_MAX, ORE_CELL_MIN, ORE_CLAIM_TTL,
  ORE_FIELD_DEFAULT_RICHNESS, ORE_FIELD_FALLOFF, ORE_REGROW_NODE_BONUS,
  ORE_REGROW_RATE, ORE_REGROW_SPREAD, ORE_VALUE,
  REFINERY_STORAGE, SILO_EVA_COOLDOWN, SIM_DT, STORAGE_BASE,
} from '../core/config';
import { CreditReason, EntityFlag, EntityKind, EvaLine } from '../core/types';
import type { EntityId, IOreField, PlayerId } from '../core/types';
import { PerEntityF32, type World } from '../core/world';
import type { Channels } from '../core/events';
import { cellIndex, clampCell, hash2f, isInMap, worldToCell } from '../core/math';

/* ==========================================================================
 * 1. ORE FIELD
 * ========================================================================== */

/** One seeded deposit. Handed out by `OreField.field(id)`; never mutated by callers. */
export interface OreFieldRecord {
  readonly id: number;
  /** Node cell — the field's centre and the source its regrowth spreads from. */
  readonly nodeCx: number;
  readonly nodeCz: number;
  /** World centre in metres. */
  readonly x: number;
  readonly z: number;
  /** Metres. */
  readonly radius: number;
  /** Ore units authored at the node cell. */
  readonly richness: number;
  /** Grid indices of every cell in this field, sorted by distance from the node. */
  readonly cells: Int32Array;
  /**
   * For `cells[k]`, the GRID INDEX of the neighbour one step nearer the node,
   * or -1 for the node itself. This is the whole regrowth topology.
   */
  readonly upstream: Int32Array;
  /** Sum of every cell's capacity — what the field holds when completely full. */
  readonly capacity: number;
  /** Live remaining total. Mutated by takeOre/regrow. */
  remaining: number;
  /** True once `remaining` reached zero. Cleared again if the field regrows. */
  exhausted: boolean;
}

export interface OreStats {
  fields: number;
  /** Cells that have ever held ore. */
  cells: number;
  /** Cells holding ore right now. */
  liveCells: number;
  remaining: number;
  capacity: number;
  claimed: number;
}

/** Fired the tick a field's last ore unit is taken. */
export type OreExhaustedListener = (fieldId: number, x: number, z: number) => void;

/** Cell amounts below this are snapped to zero so "visible" and "mineable" agree. */
const ORE_RESIDUE = 0.5;

/**
 * The `IOreField` port. One instance, published as `world.ore` by
 * `economy.system.ts`; everything on the sim side reaches ore through the port
 * and only the renderer imports this class directly (for `densityAt` and
 * `drainDirty`, which the port deliberately does not carry).
 */
export class OreField implements IOreField {
  /** Ore units remaining per cell. */
  readonly amount = new Float32Array(MAP_CELL_COUNT);
  /** Ore units this cell holds when full. Regrowth ceiling. */
  readonly capacity = new Float32Array(MAP_CELL_COUNT);
  /** Field id owning each cell, or -1. */
  readonly fieldOf = new Int16Array(MAP_CELL_COUNT);

  /** Entity handle holding a reservation on each cell, or 0. */
  private readonly claimant = new Int32Array(MAP_CELL_COUNT);
  /** Sim time the reservation lapses. */
  private readonly claimUntil = new Float32Array(MAP_CELL_COUNT);

  private readonly records: OreFieldRecord[] = [];

  /** Bumped on every cell mutation. A renderer can cheaply test "did anything move". */
  version = 0;

  /** Cells changed since the last `drainDirty`. */
  private readonly dirtyList = new Int32Array(MAP_CELL_COUNT);
  private readonly dirtyMark = new Uint8Array(MAP_CELL_COUNT);
  private dirtyCount = 0;

  private total = 0;
  private totalCapacity = 0;
  private seededCells = 0;
  private liveCells = 0;

  private readonly exhaustedListeners: OreExhaustedListener[] = [];

  /* Search scratch — instance fields rather than locals so the ring walk can be
   * split across methods without allocating a result object per call. */
  private bestIndex = -1;
  private bestDistSq = 0;
  private bestRing = -1;
  private searchMin = 0;
  private searchClaimant = -1;
  private searchTime = 0;
  private searchCx = 0;
  private searchCz = 0;
  /** Caller-supplied exclusion square; -1 disables it. See `findFreeOre`. */
  private avoidCx = -1;
  private avoidCz = -1;
  private avoidCells = 0;

  constructor() {
    this.fieldOf.fill(-1);
  }

  /* -- seeding ----------------------------------------------------------- */

  /**
   * Lay down one deposit centred on a world position.
   *
   * Shape: a radial falloff raised to ORE_FIELD_FALLOFF (so richness holds out
   * toward the rim and then drops fast, which keeps the MINEABLE AREA large)
   * multiplied by a per-cell hash jitter (so the field reads as blotchy rock
   * rather than an airbrushed disc). Cells that land under ORE_CELL_MIN are
   * dropped entirely, which is what gives a field its ragged edge.
   *
   * Overlapping an existing field tops that field's cells up instead of
   * double-booking them, so two scenario patches that touch stay one
   * bookkeeping unit each.
   *
   * @param accept optional per-cell veto, called ONCE per cell at seed time.
   *   `economy.system.ts` passes a terrain test through it so ore never lands
   *   in water or on a cliff face a harvester cannot reach. Kept as a callback
   *   rather than an import because this file must not know terrain exists.
   * @returns the new field's id, or -1 if the shape produced no cells.
   */
  seedField(
    x: number,
    z: number,
    radius: number,
    richness: number = ORE_FIELD_DEFAULT_RICHNESS,
    accept?: (cx: number, cz: number) => boolean,
  ): number {
    const nodeCx = clampCell(worldToCell(x));
    const nodeCz = clampCell(worldToCell(z));
    const id = this.records.length;
    const rCells = Math.max(1, Math.ceil(radius / CELL) + 1);
    const invRadius = 1 / Math.max(CELL * 0.5, radius);

    // Seed-time allocation only; nothing here runs during a match.
    const owned: number[] = [];

    for (let gz = nodeCz - rCells; gz <= nodeCz + rCells; gz++) {
      for (let gx = nodeCx - rCells; gx <= nodeCx + rCells; gx++) {
        if (!isInMap(gx, gz)) continue;
        if (accept !== undefined && !accept(gx, gz)) continue;
        const wx = (gx + 0.5) * CELL;
        const wz = (gz + 0.5) * CELL;
        const d = Math.sqrt((wx - x) * (wx - x) + (wz - z) * (wz - z));
        const t = 1 - d * invRadius;
        if (t <= 0) continue;

        const jitter = 1 + (hash2f(gx, gz) * 2 - 1) * ORE_CELL_JITTER;
        let v = richness * Math.pow(t, ORE_FIELD_FALLOFF) * jitter;
        if (v > ORE_CELL_MAX) v = ORE_CELL_MAX;
        if (v < ORE_CELL_MIN) continue;

        const i = cellIndex(gx, gz);
        const prevCap = this.capacity[i];
        if (prevCap > 0) {
          // Already part of an earlier field: top it up and leave ownership
          // alone, so two overlapping scenario patches stay two bookkeeping
          // units rather than double-counting the shared cells.
          if (v > prevCap) {
            const delta = v - prevCap;
            this.capacity[i] = v;
            this.amount[i] += delta;
            this.total += delta;
            this.totalCapacity += delta;
            const rec = this.records[this.fieldOf[i]] as
              | { capacity: number; remaining: number }
              | undefined;
            if (rec !== undefined) {
              rec.capacity += delta;
              rec.remaining += delta;
            }
          }
          continue;
        }

        this.capacity[i] = v;
        this.amount[i] = v;
        this.fieldOf[i] = id;
        this.total += v;
        this.totalCapacity += v;
        this.seededCells++;
        this.liveCells++;
        this.markDirty(i);
        owned.push(i);
      }
    }

    if (owned.length === 0) return -1;

    // Sort by distance from the node, grid index as the tie-break so the order
    // is identical on every machine. The node itself lands at index 0.
    owned.sort((a, b) => {
      const da = this.distSqToCell(a, nodeCx, nodeCz);
      const db = this.distSqToCell(b, nodeCx, nodeCz);
      return da - db || a - b;
    });

    const cells = Int32Array.from(owned);
    const upstream = new Int32Array(cells.length);
    let capacitySum = 0;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      capacitySum += this.capacity[i];
      upstream[k] = k === 0 ? -1 : this.pickUpstream(i, cells[0], nodeCx, nodeCz);
    }

    this.records.push({
      id, nodeCx, nodeCz, x, z, radius, richness,
      cells, upstream,
      capacity: capacitySum,
      remaining: capacitySum,
      exhausted: false,
    });
    return id;
  }

  /** Squared cell-space distance from grid index `i` to a cell. */
  private distSqToCell(i: number, cx: number, cz: number): number {
    const gx = i % MAP_CELLS;
    const gz = (i / MAP_CELLS) | 0;
    const dx = gx - cx;
    const dz = gz - cz;
    return dx * dx + dz * dz;
  }

  /**
   * The neighbour one step nearer the node — the cell that must be full before
   * this one may regrow. Falls back to the node itself for a cell that the
   * jitter isolated, so no cell is ever permanently unable to regrow.
   */
  private pickUpstream(i: number, nodeIndex: number, nodeCx: number, nodeCz: number): number {
    const gx = i % MAP_CELLS;
    const gz = (i / MAP_CELLS) | 0;
    const own = this.distSqToCell(i, nodeCx, nodeCz);
    let best = -1;
    let bestD = own;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = gx + dx;
        const nz = gz + dz;
        if (!isInMap(nx, nz)) continue;
        const n = cellIndex(nx, nz);
        if (this.capacity[n] <= 0) continue;
        const d = this.distSqToCell(n, nodeCx, nodeCz);
        if (d < bestD || (d === bestD && best >= 0 && n < best)) {
          bestD = d;
          best = n;
        }
      }
    }
    return best >= 0 ? best : nodeIndex;
  }

  /* -- IOreField --------------------------------------------------------- */

  oreAt(cx: number, cz: number): number {
    return isInMap(cx, cz) ? this.amount[cellIndex(cx, cz)] : 0;
  }

  /**
   * Remove up to `amount` from a cell, returning what was actually taken. A
   * residue under half a unit is swept up with it, so "the cell renders empty"
   * and "the cell pays nothing" are never one tick apart.
   */
  takeOre(cx: number, cz: number, amount: number): number {
    if (amount <= 0 || !isInMap(cx, cz)) return 0;
    const i = cellIndex(cx, cz);
    const have = this.amount[i];
    if (have <= 0) return 0;

    let taken = have < amount ? have : amount;
    let left = have - taken;
    if (left < ORE_RESIDUE) {
      taken = have;
      left = 0;
    }

    this.amount[i] = left;
    this.total -= taken;
    if (left === 0) this.liveCells--;
    this.markDirty(i);

    const f = this.fieldOf[i];
    if (f >= 0) {
      const rec = this.records[f];
      rec.remaining -= taken;
      if (rec.remaining <= 0) {
        rec.remaining = 0;
        if (!rec.exhausted) {
          rec.exhausted = true;
          for (let k = 0; k < this.exhaustedListeners.length; k++) {
            this.exhaustedListeners[k](rec.id, rec.x, rec.z);
          }
        }
      }
    }
    return taken;
  }

  oreValue(_cx: number, _cz: number): number {
    return ORE_VALUE;
  }

  /** Nearest cell holding any ore. Claims are ignored — see `findFreeOre`. */
  findOre(cx: number, cz: number, maxCells: number, out: Int32Array): boolean {
    return this.searchRings(cx, cz, maxCells, ORE_RESIDUE, -1, 0, out);
  }

  totalOre(): number {
    return this.total;
  }

  /* -- extras the port does not carry ------------------------------------ */

  /**
   * Nearest cell holding at least `minAmount` that is not reserved by anybody
   * other than `claimant`. This is the call the harvester FSM makes; the plain
   * `findOre` above exists for the AI's "is there anything left over there"
   * question, which does not care who booked what.
   *
   * @param avoidCx,avoidCz  centre of a square of cells this caller will not
   *   accept, or -1 for none. `avoidCells` is its Chebyshev half-width.
   *   Per-CALL rather than per-field state: the exclusion belongs to one
   *   harvester that has proved it cannot reach that ground, not to the map,
   *   and the very next caller must not inherit it. See
   *   HARVESTER_UNREACHABLE_BAN_CELLS.
   */
  findFreeOre(
    cx: number, cz: number, maxCells: number,
    claimant: EntityId, minAmount: number, time: number,
    out: Int32Array,
    avoidCx = -1, avoidCz = -1, avoidCells = 0,
  ): boolean {
    this.avoidCx = avoidCx;
    this.avoidCz = avoidCz;
    this.avoidCells = avoidCells;
    const ok = this.searchRings(cx, cz, maxCells, minAmount, claimant as number, time, out);
    this.avoidCx = -1;
    return ok;
  }

  /**
   * Expanding-ring nearest search. Rings are square, so a hit at ring r may be
   * beaten by a closer cell at r+1 — the walk therefore continues one ring past
   * the first hit and picks the true minimum. Bails immediately when the map
   * holds no ore at all, which is the common case on a fixture with no fields.
   */
  private searchRings(
    cx: number, cz: number, maxCells: number,
    minAmount: number, claimant: number, time: number,
    out: Int32Array,
  ): boolean {
    if (this.total <= 0) return false;

    this.bestIndex = -1;
    this.bestDistSq = 0;
    this.bestRing = -1;
    this.searchMin = minAmount;
    this.searchClaimant = claimant;
    this.searchTime = time;
    this.searchCx = cx;
    this.searchCz = cz;

    for (let r = 0; r <= maxCells; r++) {
      if (this.bestIndex >= 0 && r > this.bestRing + 1) break;
      if (r === 0) {
        this.consider(cx, cz, 0);
      } else {
        const x0 = cx - r, x1 = cx + r;
        const z0 = cz - r, z1 = cz + r;
        for (let gx = x0; gx <= x1; gx++) {
          this.consider(gx, z0, r);
          this.consider(gx, z1, r);
        }
        for (let gz = z0 + 1; gz <= z1 - 1; gz++) {
          this.consider(x0, gz, r);
          this.consider(x1, gz, r);
        }
      }
    }

    if (this.bestIndex < 0) return false;
    out[0] = this.bestIndex % MAP_CELLS;
    out[1] = (this.bestIndex / MAP_CELLS) | 0;
    return true;
  }

  /** One candidate cell in the ring walk. Allocation-free by construction. */
  private consider(gx: number, gz: number, ring: number): void {
    if (!isInMap(gx, gz)) return;
    const i = cellIndex(gx, gz);
    if (this.amount[i] < this.searchMin) return;
    if (this.avoidCx >= 0) {
      const ax = gx > this.avoidCx ? gx - this.avoidCx : this.avoidCx - gx;
      const az = gz > this.avoidCz ? gz - this.avoidCz : this.avoidCz - gz;
      // Chebyshev, so the exclusion is the square the ring walk itself uses.
      if ((ax > az ? ax : az) <= this.avoidCells) return;
    }
    if (this.searchClaimant >= 0) {
      const c = this.claimant[i];
      if (c !== 0 && c !== this.searchClaimant && this.claimUntil[i] > this.searchTime) return;
    }
    const dx = gx - this.searchCx;
    const dz = gz - this.searchCz;
    const d2 = dx * dx + dz * dz;
    if (this.bestIndex >= 0 && (d2 > this.bestDistSq || (d2 === this.bestDistSq && i > this.bestIndex))) {
      return;
    }
    this.bestIndex = i;
    this.bestDistSq = d2;
    this.bestRing = ring;
  }

  /**
   * 0..1 fill fraction of a cell, for the crystal renderer. A cell that never
   * held ore returns 0 rather than NaN, which matters because the renderer
   * samples the whole map and not just the seeded footprint.
   */
  densityAt(cx: number, cz: number): number {
    if (!isInMap(cx, cz)) return 0;
    const i = cellIndex(cx, cz);
    const cap = this.capacity[i];
    return cap > 0 ? this.amount[i] / cap : 0;
  }

  /** Same, from world metres. */
  densityAtWorld(x: number, z: number): number {
    return this.densityAt(worldToCell(x), worldToCell(z));
  }

  /**
   * Hand back the cells whose amount changed since the last call and clear the
   * queue. The crystal instancer calls this once per frame and restamps only
   * what moved; a full-map rescan of 16 384 cells every frame would cost more
   * than the crystals do.
   *
   * @returns how many indices were written into `out`.
   */
  drainDirty(out: Int32Array, max = out.length): number {
    const n = this.dirtyCount < max ? this.dirtyCount : max;
    for (let k = 0; k < n; k++) {
      const i = this.dirtyList[k];
      out[k] = i;
      this.dirtyMark[i] = 0;
    }
    const rest = this.dirtyCount - n;
    for (let k = 0; k < rest; k++) this.dirtyList[k] = this.dirtyList[n + k];
    this.dirtyCount = rest;
    return n;
  }

  /** Pending dirty cells, so a renderer can size its drain buffer. */
  get pendingDirty(): number {
    return this.dirtyCount;
  }

  private markDirty(i: number): void {
    this.version++;
    if (this.dirtyMark[i] !== 0) return;
    this.dirtyMark[i] = 1;
    this.dirtyList[this.dirtyCount++] = i;
  }

  /* -- claims ------------------------------------------------------------ */

  /**
   * Reserve a cell for `claimant` until `time + ORE_CLAIM_TTL`. Re-claiming a
   * cell you already hold just refreshes the lease, which is what a harvester
   * does every tick it is still driving toward it.
   */
  claim(cx: number, cz: number, claimant: EntityId, time: number): boolean {
    if (!isInMap(cx, cz)) return false;
    const i = cellIndex(cx, cz);
    const c = this.claimant[i];
    if (c !== 0 && c !== (claimant as number) && this.claimUntil[i] > time) return false;
    this.claimant[i] = claimant as number;
    this.claimUntil[i] = time + ORE_CLAIM_TTL;
    return true;
  }

  /** Drop a reservation. A no-op if somebody else holds the cell. */
  release(cx: number, cz: number, claimant: EntityId): void {
    if (!isInMap(cx, cz)) return;
    const i = cellIndex(cx, cz);
    if (this.claimant[i] !== (claimant as number)) return;
    this.claimant[i] = 0;
    this.claimUntil[i] = 0;
  }

  /** Who holds the cell right now, or 0. */
  claimedBy(cx: number, cz: number, time: number): number {
    if (!isInMap(cx, cz)) return 0;
    const i = cellIndex(cx, cz);
    return this.claimUntil[i] > time ? this.claimant[i] : 0;
  }

  /* -- regrowth ---------------------------------------------------------- */

  /**
   * Advance regrowth by `dt` seconds. Called on a slow interval with the
   * elapsed time since the previous pass, not every tick — the growth rate is
   * measured in ore units per second either way.
   */
  regrow(dt: number): void {
    if (ORE_REGROW_RATE <= 0 || dt <= 0) return;
    for (let f = 0; f < this.records.length; f++) {
      const rec = this.records[f];
      if (rec.remaining >= rec.capacity) continue;
      const cells = rec.cells;
      const upstream = rec.upstream;
      let grew = 0;

      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const cap = this.capacity[i];
        const cur = this.amount[i];
        if (cur >= cap) continue;

        let rate = ORE_REGROW_RATE;
        const u = upstream[k];
        if (u < 0) {
          // The node has no upstream neighbour, so it is the only cell that can
          // seed the field. It regrows faster or the whole patch stalls on it.
          rate *= ORE_REGROW_NODE_BONUS;
        } else {
          const ucap = this.capacity[u];
          if (ucap <= 0 || this.amount[u] < ucap * ORE_REGROW_SPREAD) continue;
        }

        let next = cur + rate * dt;
        if (next > cap) next = cap;
        if (next === cur) continue;
        if (cur === 0) this.liveCells++;
        this.amount[i] = next;
        grew += next - cur;
        this.markDirty(i);
      }

      if (grew > 0) {
        rec.remaining += grew;
        this.total += grew;
        if (rec.exhausted) rec.exhausted = false;
      }
    }
  }

  /* -- queries ----------------------------------------------------------- */

  get fieldCount(): number {
    return this.records.length;
  }

  field(id: number): OreFieldRecord | undefined {
    return this.records[id];
  }

  /**
   * The nearest field that still holds ore, or -1. The AI's "should I expand"
   * question and the harvester's long-range fallback both ask this before
   * paying for a full ring search.
   */
  nearestField(x: number, z: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let f = 0; f < this.records.length; f++) {
      const rec = this.records[f];
      if (rec.remaining <= 0) continue;
      const dx = rec.x - x;
      const dz = rec.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /** Subscribe to "a field just ran dry". Returns an unsubscribe. */
  onOreExhausted(fn: OreExhaustedListener): () => void {
    this.exhaustedListeners.push(fn);
    return () => {
      const i = this.exhaustedListeners.indexOf(fn);
      if (i >= 0) this.exhaustedListeners.splice(i, 1);
    };
  }

  stats(out?: OreStats): OreStats {
    const s = out ?? { fields: 0, cells: 0, liveCells: 0, remaining: 0, capacity: 0, claimed: 0 };
    s.fields = this.records.length;
    s.cells = this.seededCells;
    s.liveCells = this.liveCells;
    s.remaining = this.total;
    s.capacity = this.totalCapacity;
    let claimed = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) if (this.claimant[i] !== 0) claimed++;
    s.claimed = claimed;
    return s;
  }

  /** Wipe every field. Between matches only. */
  clear(): void {
    this.amount.fill(0);
    this.capacity.fill(0);
    this.fieldOf.fill(-1);
    this.claimant.fill(0);
    this.claimUntil.fill(0);
    this.dirtyMark.fill(0);
    this.dirtyCount = 0;
    this.records.length = 0;
    this.exhaustedListeners.length = 0;
    this.total = 0;
    this.totalCapacity = 0;
    this.seededCells = 0;
    this.liveCells = 0;
    this.version++;
  }
}

/* ==========================================================================
 * 2. CREDIT LEDGER
 *
 * `PlayerState.credits` stays the single source of truth — the HUD, the AI and
 * production all read it directly and none of them should have to know this
 * class exists. What lives here is everything AROUND that number: the storage
 * cap, the overflow that gets thrown away when you have no silos, the smoothed
 * income rate the sidebar shows, and the throttled EVA lines.
 *
 * EVENTS ARE COALESCED PER TICK. A docked harvester deposits 30 times a second
 * and four of them at once would be 120 `economy:credits` dispatches per second
 * for what is, to a listener, one number moving. Mutation is immediate (so
 * `canAfford` never lies); notification is once per player per tick.
 * ========================================================================== */

export class Economy {
  /** Per-entity storage contribution, gen-stamped so a recycled slot reads 0. */
  private readonly storageOf: PerEntityF32;

  private readonly incomeAccum = new Float64Array(MAX_PLAYERS);
  private readonly incomeRateArr = new Float64Array(MAX_PLAYERS);
  private readonly spendAccum = new Float64Array(MAX_PLAYERS);
  private readonly spendRateArr = new Float64Array(MAX_PLAYERS);
  private readonly wastedTotalArr = new Float64Array(MAX_PLAYERS);
  private readonly displayArr = new Float64Array(MAX_PLAYERS);

  /** Coalesced per-tick notification state. */
  private readonly pendingDelta = new Float64Array(MAX_PLAYERS);
  private readonly pendingReason = new Int32Array(MAX_PLAYERS);
  private readonly pendingDirty = new Uint8Array(MAX_PLAYERS);

  private readonly lastSiloEva = new Float64Array(MAX_PLAYERS);
  private readonly lastFundsEva = new Float64Array(MAX_PLAYERS);

  /** Per-player multiplier on HARVESTED income. 1 = no handicap. */
  private readonly resourceBonus = new Float64Array(MAX_PLAYERS);

  private windowTicks = 0;
  private time = 0;

  constructor(private readonly world: World, private readonly channels: Channels) {
    this.storageOf = new PerEntityF32(world.store, 0);
    this.lastSiloEva.fill(-1e9);
    this.lastFundsEva.fill(-1e9);
    this.resourceBonus.fill(1);
    for (let p = 0; p < world.players.length; p++) {
      this.displayArr[p] = world.players[p].credits;
    }
  }

  /**
   * Set a player's difficulty handicap on harvested income.
   *
   * The AI computes this (`AiBrain.resourceBonus`, from
   * `AI_DIFFICULTY[].resourceBonus`) but must not apply it — writing `credits`
   * from Phase.AI violates the write-ownership table in core/loop.ts. So it
   * hands the number here and Economy, which owns the column, spends it.
   * Clamped: a negative or absurd multiplier is a content bug, not a balance
   * decision, and a silent one would look like a broken harvester.
   */
  setResourceBonus(player: PlayerId, multiplier: number): void {
    const i = player as number;
    if (i < 0 || i >= MAX_PLAYERS) return;
    this.resourceBonus[i] = Number.isFinite(multiplier) ? Math.min(4, Math.max(0.25, multiplier)) : 1;
  }

  /** The multiplier currently applied to `player`'s harvested income. */
  resourceBonusOf(player: PlayerId): number {
    const i = player as number;
    return i >= 0 && i < MAX_PLAYERS ? this.resourceBonus[i] : 1;
  }

  /* -- balances ---------------------------------------------------------- */

  credits(player: PlayerId): number {
    const p = this.world.players[player as number];
    return p === undefined ? 0 : p.credits;
  }

  storageMax(player: PlayerId): number {
    const p = this.world.players[player as number];
    return p === undefined ? 0 : p.storageMax;
  }

  /** Room left before deposits start being thrown away. */
  headroom(player: PlayerId): number {
    const p = this.world.players[player as number];
    if (p === undefined) return 0;
    const room = p.storageMax - p.credits;
    return room > 0 ? room : 0;
  }

  canAfford(player: PlayerId, amount: number): boolean {
    const p = this.world.players[player as number];
    return p !== undefined && p.credits >= amount;
  }

  /**
   * Take `amount` if the player has it. Returns false and fires a throttled
   * "insufficient funds" line otherwise — production calls this every tick for
   * its drip payment, so the throttle is what stops EVA screaming.
   */
  spend(player: PlayerId, amount: number, reason: CreditReason = CreditReason.Build): boolean {
    if (amount <= 0) return true;
    const p = this.world.players[player as number];
    if (p === undefined) return false;
    if (p.credits < amount) {
      this.evaInsufficientFunds(player);
      return false;
    }
    p.credits -= amount;
    p.stats.creditsSpent += amount;
    this.spendAccum[player as number] += amount;
    this.mark(player, -amount, reason);
    return true;
  }

  /**
   * Take as much of `amount` as the player can actually pay, and report it.
   * This is the correct primitive for a drip-paid production queue: a player
   * who runs dry mid-item should slow to a crawl, not have the item cancelled.
   */
  spendPartial(player: PlayerId, amount: number, reason: CreditReason = CreditReason.Build): number {
    if (amount <= 0) return 0;
    const p = this.world.players[player as number];
    if (p === undefined) return 0;
    const paid = p.credits < amount ? p.credits : amount;
    if (paid <= 0) {
      this.evaInsufficientFunds(player);
      return 0;
    }
    p.credits -= paid;
    p.stats.creditsSpent += paid;
    this.spendAccum[player as number] += paid;
    this.mark(player, -paid, reason);
    return paid;
  }

  /**
   * Bank credits, honouring the storage cap. Anything over the cap is WASTED,
   * not clamped silently — the loss is counted, the EVA line fires, and the
   * `economy:credits` event carries CreditReason.Waste so the HUD can flash the
   * number red. Overflow you cannot see is overflow that feels like a bug.
   *
   * @returns credits actually banked.
   */
  deposit(player: PlayerId, amount: number, reason: CreditReason = CreditReason.Harvest): number {
    if (amount <= 0) return 0;
    const p = this.world.players[player as number];
    if (p === undefined) return 0;

    // Difficulty handicap. `AI_DIFFICULTY[].resourceBonus` exists in config and
    // `AiBrain.resourceBonus` publishes it, but the AI is forbidden from writing
    // `credits` (it runs at Phase.AI; the column belongs to Economy), so it had
    // no way to spend it and the entire difficulty ladder was economically
    // flat. Applied HERE, on harvested income only: a Brutal AI mines faster,
    // it does not conjure credits, and a refund or a sale is never inflated.
    if (reason === CreditReason.Harvest) {
      const mul = this.resourceBonus[player as number];
      if (mul !== undefined && mul !== 1) amount *= mul;
    }

    const room = p.storageMax - p.credits;
    let banked = amount;
    let lost = 0;
    if (banked > room) {
      lost = banked - (room > 0 ? room : 0);
      banked = room > 0 ? room : 0;
    }

    if (banked > 0) {
      p.credits += banked;
      this.incomeAccum[player as number] += banked;
      this.mark(player, banked, reason);
    }
    if (reason === CreditReason.Harvest) {
      p.stats.oreMined += amount;
    }
    if (lost > 0) {
      this.wastedTotalArr[player as number] += lost;
      this.mark(player, 0, CreditReason.Waste);
      this.evaSiloNeeded(player);
    }
    return banked;
  }

  /** Credits back with no cap check — cancelling production must never lose money. */
  refund(player: PlayerId, amount: number, reason: CreditReason = CreditReason.Refund): void {
    if (amount <= 0) return;
    const p = this.world.players[player as number];
    if (p === undefined) return;
    p.credits += amount;
    this.mark(player, amount, reason);
  }

  /** Unconditional grant (match start, crates, cheats). Ignores the cap. */
  grant(player: PlayerId, amount: number, reason: CreditReason = CreditReason.Init): void {
    this.refund(player, amount, reason);
  }

  /* -- storage ----------------------------------------------------------- */

  /**
   * Declare how many credits of storage a structure contributes. Production
   * calls this when a silo or refinery completes; without it the default below
   * gives every `IsRefinery` structure REFINERY_STORAGE and everything else
   * nothing, which covers the common case but cannot know a silo from a lab.
   */
  setBuildingStorage(id: EntityId, credits: number): void {
    this.storageOf.set(id, credits);
  }

  /**
   * Recompute every player's storage cap from their live structures, then clamp
   * credits into it. Called on the same trigger as the power rescan: a
   * destroyed refinery has to shrink the cap, or a player keeps banking into a
   * silo that is a smoking hole.
   */
  recomputeStorage(): void {
    const w = this.world;
    const s = w.store;
    const n = w.players.length;
    // STORAGE_BASE, not BASE_STORAGE — see the long note in config §21. The
    // cap may never sit below the credits the match handed the player.
    for (let p = 0; p < n; p++) w.players[p].storageMax = STORAGE_BASE;

    const list = s.byKind[EntityKind.Building];
    const count = s.byKindCount[EntityKind.Building];
    for (let k = 0; k < count; k++) {
      const i = list[k];
      const f = s.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if ((f & EntityFlag.UnderConstruction) !== 0) continue;
      let add = this.storageOf.getAt(i);
      if (add <= 0) add = (f & EntityFlag.IsRefinery) !== 0 ? REFINERY_STORAGE : 0;
      if (add <= 0) continue;
      const owner = s.owner[i];
      if (owner < n) w.players[owner].storageMax += add;
    }

    for (let p = 0; p < n; p++) {
      const pl = w.players[p];
      if (pl.credits > pl.storageMax) {
        const lost = pl.credits - pl.storageMax;
        pl.credits = pl.storageMax;
        this.wastedTotalArr[p] += lost;
        this.mark(p as PlayerId, -lost, CreditReason.Waste);
      }
    }
  }

  /* -- rates and presentation -------------------------------------------- */

  /** Smoothed credits per second earned. Drives the HUD's income readout. */
  incomeRate(player: PlayerId): number {
    return this.incomeRateArr[player as number];
  }

  /** Smoothed credits per second spent. */
  spendRate(player: PlayerId): number {
    return this.spendRateArr[player as number];
  }

  /** Lifetime credits thrown away for want of storage. */
  wasted(player: PlayerId): number {
    return this.wastedTotalArr[player as number];
  }

  /**
   * The rolling number the sidebar shows, easing toward the true balance at
   * CREDITS_TICKER_RATE. Deterministic (fixed dt), so it is safe to advance
   * inside the sim rather than in a render hook.
   */
  creditsDisplay(player: PlayerId): number {
    return this.displayArr[player as number];
  }

  /* -- per-tick ---------------------------------------------------------- */

  tick(dt: number, time: number): void {
    this.time = time;
    const n = this.world.players.length;

    // 1. Flush coalesced credit notifications.
    for (let p = 0; p < n; p++) {
      if (this.pendingDirty[p] === 0) continue;
      this.pendingDirty[p] = 0;
      const pl = this.world.players[p];
      const ev = this.channels.events.payload('economy:credits');
      ev.player = p as PlayerId;
      ev.credits = pl.credits;
      ev.delta = this.pendingDelta[p];
      ev.storage = pl.credits;
      ev.storageMax = pl.storageMax;
      ev.reason = this.pendingReason[p];
      this.pendingDelta[p] = 0;
      this.pendingReason[p] = CreditReason.Init;
      this.channels.events.emitPooled('economy:credits');
    }

    // 2. Income / spend rate window.
    this.windowTicks++;
    if (this.windowTicks >= INCOME_WINDOW_TICKS) {
      const seconds = this.windowTicks * SIM_DT;
      for (let p = 0; p < MAX_PLAYERS; p++) {
        const inc = this.incomeAccum[p] / seconds;
        const spd = this.spendAccum[p] / seconds;
        this.incomeRateArr[p] += (inc - this.incomeRateArr[p]) * INCOME_SMOOTHING;
        this.spendRateArr[p] += (spd - this.spendRateArr[p]) * INCOME_SMOOTHING;
        this.incomeAccum[p] = 0;
        this.spendAccum[p] = 0;
      }
      this.windowTicks = 0;
    }

    // 3. Roll the display counter.
    const step = CREDITS_TICKER_RATE * dt;
    for (let p = 0; p < n; p++) {
      const target = this.world.players[p].credits;
      const cur = this.displayArr[p];
      const diff = target - cur;
      if (diff > -CREDITS_TICKER_SNAP && diff < CREDITS_TICKER_SNAP) {
        this.displayArr[p] = target;
      } else if (diff > 0) {
        this.displayArr[p] = diff < step ? target : cur + step;
      } else {
        this.displayArr[p] = -diff < step ? target : cur - step;
      }
    }
  }

  /* -- internals --------------------------------------------------------- */

  /**
   * Record a balance change for this tick's notification. A Waste or a Build
   * beats a Harvest when several reasons land in one tick, because the
   * exceptional cause is the one the HUD should show.
   */
  private mark(player: PlayerId, delta: number, reason: CreditReason): void {
    const p = player as number;
    if (p >= MAX_PLAYERS) return;
    this.pendingDelta[p] += delta;
    if (this.pendingDirty[p] === 0 || reason !== CreditReason.Harvest) {
      this.pendingReason[p] = reason;
    }
    this.pendingDirty[p] = 1;
  }

  private evaSiloNeeded(player: PlayerId): void {
    const p = player as number;
    if (this.time - this.lastSiloEva[p] < SILO_EVA_COOLDOWN) return;
    this.lastSiloEva[p] = this.time;
    const ev = this.channels.events.payload('eva:line');
    ev.player = player;
    ev.line = EvaLine.SiloNeeded;
    this.channels.events.emitPooled('eva:line');
  }

  private evaInsufficientFunds(player: PlayerId): void {
    const p = player as number;
    if (this.time - this.lastFundsEva[p] < FUNDS_EVA_COOLDOWN) return;
    this.lastFundsEva[p] = this.time;
    const ev = this.channels.events.payload('eva:line');
    ev.player = player;
    ev.line = EvaLine.InsufficientFunds;
    this.channels.events.emitPooled('eva:line');
  }
}

/* ==========================================================================
 * 3. MODULE ACCESSORS
 *
 * `world.ore` is the sanctioned way to reach ore from the sim. These exist for
 * the render-side crystal instancer and the debug console, which need the
 * concrete class (densityAt / drainDirty / stats) rather than the port.
 * ========================================================================== */

let activeOre: OreField | null = null;
let activeEconomy: Economy | null = null;

export function setActiveOreField(f: OreField | null): void {
  activeOre = f;
}

/** The live ore field, or null before `economy.system.ts` has initialised. */
export function getOreField(): OreField | null {
  return activeOre;
}

export function setActiveEconomy(e: Economy | null): void {
  activeEconomy = e;
}

/** The live credit ledger, or null before `economy.system.ts` has initialised. */
export function getEconomy(): Economy | null {
  return activeEconomy;
}
