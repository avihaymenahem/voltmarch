/**
 * ============================================================================
 * src/game/Checksum.ts — a fingerprint of the whole simulation, per tick
 * ============================================================================
 * THE INSTRUMENT, BUILT FIRST AND ON PURPOSE.
 *
 * Deterministic replay is worth having and impossible to debug without this.
 * "The replay diverged somewhere" is a week of bisecting by eye; "the replay
 * diverged at tick 4,812, in the entity block, and the player block still
 * agreed" is an afternoon. Everything else in the replay work — the recorder,
 * the playback loop, the bus routing — is verifiable only because this exists,
 * so it is the first thing written rather than the last.
 *
 * It pays for itself immediately and independently: `npm run soak` currently
 * runs the sim twice and compares nothing in particular. With a per-tick hash
 * it becomes a real desync detector, and the same hash turns three defects
 * already in this repo's history (#47, #40, #21) into one-line reproductions.
 *
 * WHAT IS HASHED, AND WHY IT IS A SHORT LIST
 * ------------------------------------------
 * ONLY STATE THE SIMULATION OWNS AND WRITES. Not `prevX` (a render
 * interpolation snapshot), not `animTime` (render-owned, wall-clock driven —
 * see `src/render/unit-anim.system.ts`), not `recoil` decay, not anything in
 * `src/vfx/**` or `src/render/**`. Hashing a render-owned column would make the
 * checksum disagree between two machines at different frame rates while the
 * SIMULATION was in perfect lockstep, which is worse than no checksum at all:
 * it would train everyone to ignore it.
 *
 * FLOATS ARE QUANTISED BEFORE HASHING, and this is the load-bearing decision.
 * `src/core/loop.ts`'s write-ownership table and the determinism grep keep the
 * sim free of `Math.random`/`Date.now`, but 59 transcendental call sites remain
 * across 14 sim files — `Math.sin`, `cos`, `atan2`, `exp`, per mobile unit per
 * tick in Movement.ts. **None of those is specified to bit precision by
 * ECMA-262**, so a Chrome/Windows run and a Safari/macOS run can legitimately
 * differ in the last ulp of a position and be the same simulation in every
 * sense a player cares about. A raw bit hash would scream desync on frame one.
 * Quantising to `QUANT` (1e-3, a millimetre) hashes what the game means rather
 * than what the FPU did.
 *
 * That is a trade and it is stated rather than hidden: a divergence smaller
 * than a millimetre is invisible to this hash on the tick it happens. It is not
 * invisible for long — real desyncs compound, and a unit that takes a different
 * turn is metres out within a second.
 *
 * ORDER INDEPENDENCE. The entity block SUMS per-entity hashes rather than
 * folding them in sequence, because `alive[]` is a dense list whose order
 * follows the free list, and a slot recycled in a different order is the same
 * world. A sequential fold would report a desync for a difference that is not
 * one. The per-entity hash still includes the entity's own HANDLE, so two
 * entities cannot swap identities unnoticed.
 * ============================================================================
 */

import { EntityFlag } from '../core/types';
import type { World } from '../core/world';

/**
 * Quantisation step for every float, in world units (metres, radians, hit
 * points). 1e-3 is a millimetre of position and a thousandth of a hit point —
 * far below anything the game reasons about, and far above the ulp noise a
 * different `Math.sin` implementation produces.
 */
export const QUANT = 1e-3;

/** One 32-bit block of the fingerprint, and its label for a divergence report. */
export interface ChecksumBlock {
  readonly name: string;
  readonly hash: number;
}

/** A whole-sim fingerprint at one tick. */
export interface SimChecksum {
  readonly tick: number;
  /** All blocks folded together. This is the number a replay compares. */
  readonly hash: number;
  /** Per-block, so a mismatch says WHERE rather than only THAT. */
  readonly blocks: readonly ChecksumBlock[];
  /** Live entity count, carried because it explains most divergences instantly. */
  readonly entities: number;
}

/* ==========================================================================
 * 1. THE MIXER
 *
 * FNV-1a over 32-bit words. Chosen over anything stronger for one reason: this
 * runs over every live entity every N ticks inside the sim loop, so it must be
 * integer-only, allocation-free and fast. Collision resistance is irrelevant —
 * nothing adversarial is being defended against, and two DIFFERENT simulations
 * colliding on 32 bits at the same tick is not a failure mode worth a slower
 * hash.
 * ========================================================================== */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/** Fold one 32-bit word into a running hash. Returns an unsigned 32-bit int. */
export function mix(h: number, word: number): number {
  let x = (h ^ (word | 0)) >>> 0;
  // `Math.imul`, not `*`: the product overflows 2^53 and a plain multiply would
  // silently lose the low bits that carry all the entropy.
  x = Math.imul(x, FNV_PRIME) >>> 0;
  return x;
}

/**
 * Quantise a float to a 32-bit integer for hashing.
 *
 * `Math.round` and not `| 0`: truncation makes -0.4 and +0.4 land on the same
 * side of zero only by accident, and a value oscillating across an integer
 * boundary would flip the hash on alternate ticks for no reason.
 *
 * NaN and Infinity map to fixed sentinels rather than propagating. A NaN in the
 * store is a real bug and the checksum SHOULD change when one appears — but it
 * must change to a stable value, or two runs with the same NaN would disagree
 * (NaN !== NaN, and `Math.round(NaN) | 0` is 0, which would silently equal a
 * legitimate zero).
 */
export function q(v: number): number {
  if (Number.isNaN(v)) return 0x7f5ada15;
  if (!Number.isFinite(v)) return v > 0 ? 0x7f1f1f1f : 0x7f0e0e0e;
  return Math.round(v / QUANT) | 0;
}

/* ==========================================================================
 * 2. THE BLOCKS
 * ========================================================================== */

/**
 * Every entity the simulation owns, order-independent.
 *
 * `PendingDestroy` entities are INCLUDED. They are still in `alive[]`, still
 * take damage and still occupy a slot until Phase.Cleanup runs, so excluding
 * them would make the hash disagree with itself across the one phase boundary
 * where a divergence is most likely to appear.
 */
function hashEntities(world: World): number {
  const s = world.store;
  const n = s.aliveCount;
  let sum = 0;
  for (let a = 0; a < n; a++) {
    const i = s.alive[a];
    let h = FNV_OFFSET;
    // Identity first, so two entities cannot swap slots unnoticed.
    h = mix(h, s.handleOf(i) as number);
    h = mix(h, s.flags[i]);
    h = mix(h, s.kind[i] | (s.owner[i] << 8) | (s.faction[i] << 16));
    h = mix(h, s.defId[i]);
    h = mix(h, q(s.posX[i]));
    h = mix(h, q(s.posY[i]));
    h = mix(h, q(s.posZ[i]));
    h = mix(h, q(s.yaw[i]));
    h = mix(h, q(s.turretYaw[i]));
    h = mix(h, q(s.hp[i]));
    h = mix(h, q(s.velX[i]));
    h = mix(h, q(s.velZ[i]));
    h = mix(h, q(s.cooldown[i]));
    h = mix(h, s.targetId[i]);
    // STANCE RIDES IN THE SPARE BYTE of the word that already carries `state`
    // and `orderKind`, so it costs no extra `mix`. It has to be here: since
    // v2.3.0 the stance decides whether a unit leaves its post at all, and two
    // clients disagreeing about one unit's stance is a divergence that would
    // otherwise stay invisible until the unit had driven somewhere the other
    // one did not.
    h = mix(h, s.state[i] | (s.orderKind[i] << 8) | (s.stance[i] << 16));
    h = mix(h, q(s.orderX[i]));
    h = mix(h, q(s.orderZ[i]));
    // THE POST. `guardX/guardZ` was written by six modules and read by none,
    // which is why it was not hashed. It is now the return goal for every
    // stance excursion and for `OrderKind.Guard` — real simulation state that
    // no other column derives, exactly like `upgradeMask` in the player block.
    h = mix(h, q(s.guardX[i]));
    h = mix(h, q(s.guardZ[i]));
    h = mix(h, q(s.cargo[i]));
    h = mix(h, q(s.buildProgress[i]));
    // WHICH HULL A PASSENGER IS INSIDE. `flags` already carries `Garrisoned`,
    // so two clients always agreed about whether a man was aboard SOMETHING —
    // and, while this lived in a service-private side array, never about which.
    // A divergence there was caught only indirectly one tick later, via the
    // position `TransportService.carry` copies off the host, and only if the
    // two hulls had drifted far enough apart to survive `q`'s quantisation.
    h = mix(h, s.carrierId[i]);
    // SUMMED, not folded. See the header: `alive[]` order follows the free
    // list, and a slot recycled in a different order is the same world.
    sum = (sum + h) >>> 0;
  }
  return sum;
}

/** Per-player economy and standing. Ordered — the player list never permutes. */
function hashPlayers(world: World): number {
  let h = FNV_OFFSET;
  for (const p of world.players) {
    if (p === undefined) continue;
    h = mix(h, p.id as number);
    h = mix(h, q(p.credits));
    h = mix(h, q(p.powerProduced));
    h = mix(h, q(p.powerConsumed));
    h = mix(h, q(p.storageMax));
    h = mix(h, p.defeated ? 1 : 0);
    h = mix(h, p.allyMask);
    // IN-MATCH UPGRADES. The mask only — `upgradeMul` is a pure function of it
    // and hashing both would just be hashing the same fact twice, in floats.
    //
    // It has to be here, and it is the only per-player availability state that
    // is: `techMask`, `buildingCount` and `hasRadar` are all recomputed every
    // tick from the entities, which the entity block already covers, so a
    // divergence in them is caught there. This one is not derived from anything
    // the other two blocks can see. Without this line two clients could
    // disagree about who owns Uranium Shells and the desync detector would stay
    // silent until the damage difference had compounded into a dead tank.
    h = mix(h, p.upgradeMask);
    // COMMANDER POWERS BOUGHT, for exactly the reasons the paragraph above
    // gives for the upgrade mask, and one more that is specific to this one:
    // until v2.6.0 ownership of a power lived in localStorage and the
    // simulation was FORBIDDEN from reading it, precisely because two clients
    // could disagree and nothing would notice. This line is what makes reading
    // it safe — a disagreement about who owns Chronoshift is now a checksum
    // fault at the tick it appears, not a mystery when somebody presses the
    // button four minutes later.
    h = mix(h, p.commanderPowerMask);
    // Production queues are sim state and a desync here is a classic one: two
    // runs that agree on every unit on the field but disagree about what is
    // being built diverge visibly a few seconds later.
    for (const queue of p.queues) {
      h = mix(h, queue.tab as number);
      h = mix(h, queue.factoryCount);
      h = mix(h, queue.awaitingPlacement ? 1 : 0);
      h = mix(h, queue.items.length);
      for (const item of queue.items) {
        h = mix(h, item.defId | (item.isBuilding ? 0x10000 : 0));
        h = mix(h, q(item.progress));
        h = mix(h, q(item.spent));
        h = mix(h, (item.ready ? 1 : 0) | (item.onHold ? 2 : 0));
      }
    }
  }
  return h;
}

/**
 * The clock and the live-entity census.
 *
 * Cheap, and it catches the loudest class of divergence — one run having more
 * units than the other — before the entity block's summed hash has to be
 * interpreted at all.
 */
function hashCensus(world: World): number {
  const s = world.store;
  let alive = 0;
  let dying = 0;
  for (let a = 0; a < s.aliveCount; a++) {
    const i = s.alive[a];
    if ((s.flags[i] & EntityFlag.PendingDestroy) !== 0) dying++;
    else alive++;
  }
  let h = FNV_OFFSET;
  h = mix(h, world.tick);
  h = mix(h, alive);
  h = mix(h, dying);
  return h;
}

/* ==========================================================================
 * 3. THE ENTRY POINT
 * ========================================================================== */

/**
 * Fingerprint the simulation as it stands.
 *
 * ALLOCATES: one result object and its block array, once per call. That is
 * deliberate and it is why this is NOT called every tick by default — the
 * frame loop's zero-allocation rule applies to the RENDER path, and a hash
 * taken every 30th tick costs nothing measurable. `hashOnly` exists for the
 * hot path.
 */
export function checksum(world: World): SimChecksum {
  const blocks: ChecksumBlock[] = [
    { name: 'census', hash: hashCensus(world) },
    { name: 'entities', hash: hashEntities(world) },
    { name: 'players', hash: hashPlayers(world) },
  ];
  let h = FNV_OFFSET;
  for (const b of blocks) h = mix(h, b.hash);
  let live = 0;
  for (let a = 0; a < world.store.aliveCount; a++) {
    if ((world.store.flags[world.store.alive[a]] & EntityFlag.PendingDestroy) === 0) live++;
  }
  return { tick: world.tick, hash: h, blocks, entities: live };
}

/** The folded hash alone, with no result object. For a per-tick hot path. */
export function hashOnly(world: World): number {
  let h = FNV_OFFSET;
  h = mix(h, hashCensus(world));
  h = mix(h, hashEntities(world));
  h = mix(h, hashPlayers(world));
  return h;
}

/**
 * Compare two fingerprints and say what differs, in one line.
 *
 * Empty string when they agree. This is the whole point of the per-block split:
 * "entities" alone means a unit is somewhere different; "players" alone means
 * the economy diverged with the field still identical, which is almost always a
 * production or a harvest bug; "census" means one run has units the other does
 * not, which is almost always a spawn or a death.
 */
export function describeDivergence(a: SimChecksum, b: SimChecksum): string {
  if (a.hash === b.hash) return '';
  const parts: string[] = [];
  if (a.tick !== b.tick) parts.push(`tick ${a.tick} vs ${b.tick}`);
  if (a.entities !== b.entities) parts.push(`${a.entities} entities vs ${b.entities}`);
  for (let i = 0; i < a.blocks.length && i < b.blocks.length; i++) {
    const x = a.blocks[i]!;
    const y = b.blocks[i]!;
    if (x.hash !== y.hash) parts.push(`${x.name} differs`);
  }
  return `desync at tick ${a.tick}: ${parts.length === 0 ? 'folded hash only' : parts.join(', ')}`;
}
