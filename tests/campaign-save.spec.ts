/**
 * ============================================================================
 * tests/campaign-save.spec.ts — an operation has to survive a save and a reload
 * ============================================================================
 * `savegame.spec.ts` proves the snapshot format. This file proves the one part
 * of it that a campaign adds, and every claim below is a failure that would
 * otherwise reach a player mid-operation with the whole suite green.
 *
 *   - **TAGS ARE `EntityId` HANDLES AND A RESTORE MOVES EVERY ONE OF THEM.**
 *     `restoreSnapshot` re-allocates every entity and bumps every generation, so
 *     a raw handle written to disk resolves, on the far side, against whatever
 *     recycled the slot. That is the `carrierId` defect CLAUDE.md documents —
 *     a squad reappearing inside a stranger's building — pointed at "destroy
 *     the tap" instead. `CHUNK_CMPN` stores save-local indices and remaps them
 *     through `handleOfLocal`, exactly as `REF_COLUMNS` does, and the tests
 *     below check that the returned handle is NOT the saved one and that the
 *     saved one is DEAD.
 *   - **TWO OPERATIONS CAN SHARE A PRESET AND A SEED.** `requireMatchingWorld`
 *     compares scenario, map and seed, so without the operation id a save from
 *     one operation restores into another's world with no refusal at all: right
 *     ground, wrong triggers, and every trigger id resolving to a different
 *     trigger.
 *   - **TRIGGER STATE IS KEYED BY STABLE STRING ID, NEVER BY ARRAY INDEX.**
 *     `TriggerDef.id`'s own doc says so. An index-keyed encoding passes every
 *     test on the day it is written and mis-restores the first time an author
 *     moves a trigger up a line, which is why the reorder is tested directly
 *     and the fixture asserts the two orders really do disagree about indices.
 *   - **`SAVE_SCHEMA_VERSION` AND `structuralHash()` DO NOT MOVE.** The chunk
 *     stream is length-prefixed and `readSections` skips ids it does not know,
 *     which is the whole reason a new chunk is additive — the CHUNK_SCATTER
 *     precedent, and it is asserted by VALUE here so a change announces itself.
 *
 * The session is a double rather than `campaign-install.ts`'s `Session`,
 * because that class needs `ctx()` and a booted engine to bind its ports. The
 * double copies the two behaviours that matter — the lazy `startTick` stamp and
 * the `paid` gate — verbatim from that file, and is the only thing here that is
 * not production code.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import {
  SAVE_SCHEMA_VERSION, captureSnapshot, readSnapshotMeta, restoreSnapshot, structuralHash,
  type CampaignAccess, type SnapshotHost,
} from '../src/game/SaveGame';
import { contextOf } from '../src/game/save.system';
import type { SaveSlotInfo } from '../src/game/SaveStore';
import { TagRegistry } from '../src/campaign/runtime';
import { newOperationState } from '../src/campaign/Director';
import {
  applyCampaignState, captureCampaignState, parseCampaignSaveState,
} from '../src/campaign/session';
import type {
  CampaignSession, ObjectiveRow, PresentationEvent,
} from '../src/campaign/session';
import type {
  Medal, ObjectiveStatus, OperationDef, OperationState, TriggerDef,
} from '../src/campaign/types';

const P0 = 0 as PlayerId;

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const TRIGGERS: readonly TriggerDef[] = [
  { id: 't.alpha', when: { on: 'elapsed', ticks: 60 }, then: [] },
  { id: 't.beta', when: { on: 'entityDead', tag: 'tap' }, then: [] },
  { id: 't.gamma', when: { on: 'elapsedSinceArmed', ticks: 900 }, then: [] },
];

/** The same three triggers, authored in a different order. Same operation. */
const TRIGGERS_REORDERED: readonly TriggerDef[] = [
  TRIGGERS[2], TRIGGERS[0], TRIGGERS[1],
];

/**
 * An operation with three triggers and three objectives, one of them a paid
 * secondary. Deliberately NOT one of the shipped rows: this file is about the
 * codec, and pinning it to content would make it fail for authoring reasons.
 */
function makeOp(id: string, triggers: readonly TriggerDef[] = TRIGGERS): OperationDef {
  return {
    id,
    chapter: 'soviets',
    faction: Faction.Soviets,
    foe: Faction.Allies,
    index: 1,
    title: 'Fixture',
    beat: 'A fixture, not a mission.',
    primaryType: 'assault',
    archetype: 'conditional',
    parSec: 600,
    requires: [],
    map: {
      preset: 'temperate-valley',
      mapSeed: 11,
      simSeed: 22,
      armies: 2,
      biome: 'temperate',
      opening: 'base',
      credits: 5000,
    },
    layout: 'fixture',
    outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },
    roster: { player: [], ai: [] },
    objectives: [
      { id: 'obj.primary', kind: 'primary', title: 'Take the yard' },
      { id: 'obj.bonus', kind: 'secondary', title: 'Hold the bridge', credits: 750 },
      { id: 'obj.cache', kind: 'secondary', title: 'Find the cache', hidden: true, credits: 400 },
    ],
    triggers,
  };
}

/**
 * A `CampaignSession` with a real `TagRegistry`.
 *
 * Two behaviours are copied VERBATIM from `campaign-install.ts#Session`,
 * because both are what the save has to survive:
 *
 *   1. `simTick` stamps `startTick` on its first call. That is right for a
 *      fresh operation and catastrophic for a restored one — hence
 *      `adoptRestoredState`, which `honourAdopt: false` disables so the test
 *      below can watch the damage happen.
 *   2. `complete` is `setObjective`'s payment path, `paid` gate and all.
 */
class FakeSession implements CampaignSession {
  readonly state: OperationState;
  readonly tags = new TagRegistry();
  /** Every `grantCredits` the payment path made. */
  readonly grants: { id: string; credits: number }[] = [];
  adopted = 0;
  private started = false;

  constructor(readonly op: OperationDef, private readonly honourAdopt = true) {
    this.state = newOperationState(op, 0);
  }

  get outcome(): 'won' | 'lost' | null { return this.state.outcome; }
  get reason(): string { return this.state.reason; }

  simTick(tick: number): void {
    if (this.started) return;
    this.started = true;
    this.state.startTick = tick;
  }

  drainPresentation(_out: PresentationEvent[]): number { return 0; }
  rows(): readonly ObjectiveRow[] { return []; }
  /*
   * `captureProof` is not what this file is about, and the fixture operations
   * below declare none — so the honest double answers what the real
   * `Session.isCaptureProof` answers for an operation with the field absent.
   * `tests/campaign-capture-proof.spec.ts` is where the predicate itself is
   * driven; this is here because the method is REQUIRED on `CampaignSession`
   * rather than optional, deliberately, so that a session which cannot answer
   * is a compile error instead of a silently granted permission.
   */
  isCaptureProof(): boolean { return false; }
  medal(_difficulty: number): Medal { return 0; }
  dispose(): void { this.tags.clear(); }

  adoptRestoredState(): void {
    this.adopted++;
    if (this.honourAdopt) this.started = true;
  }

  /** `campaign-install.ts#setObjective`, complete branch only. */
  complete(id: string): void {
    const was = this.state.objectives.get(id);
    if (was === 'complete' || was === 'failed') return;
    this.state.objectives.set(id, 'complete');
    const def = this.op.objectives.find((o) => o.id === id);
    if (def?.credits === undefined) return;
    if (this.state.paid.has(id)) return;
    this.state.paid.add(id);
    this.grants.push({ id, credits: def.credits });
  }
}

/** The adapter `save.system.ts#campaignAccessOf` builds, in miniature. */
function portFor(session: CampaignSession, world: World): CampaignAccess {
  const store = world.store;
  return {
    operationId: session.op.id,
    snapshot: (localOf) => captureCampaignState(session, store, localOf),
    restore: (data, handleOf) => { applyCampaignState(session, data, handleOf); },
  };
}

interface Side {
  world: World;
  session: FakeSession;
  host: SnapshotHost;
  ids: EntityId[];
}

function spawn(world: World, i: number): EntityId {
  const id = world.store.alloc(
    EntityKind.Vehicle, 0, P0, Faction.Soviets, 100 + i * 8, 0, 200 + i, 0,
  );
  const s = world.store;
  const k = s.index(id);
  s.hp[k] = 200;
  s.maxHp[k] = 200;
  s.flags[k] |= EntityFlag.CanMove;
  return id;
}

/**
 * A world, an armed session and a host. Every side is built on the SAME
 * scenario, map and seed, which is the point: the operation id has to be what
 * tells two of them apart.
 */
function makeSide(op: OperationDef, opts: { units?: number; honourAdopt?: boolean } = {}): Side {
  const world = new World();
  world.addPlayer(Faction.Soviets, 'Commander', true, true);
  world.addPlayer(Faction.Allies, 'Opponent', false, false);

  const ids: EntityId[] = [];
  for (let i = 0; i < (opts.units ?? 4); i++) ids.push(spawn(world, i));

  const session = new FakeSession(op, opts.honourAdopt ?? true);
  return { world, session, host: makeHost(world, portFor(session, world)), ids };
}

function makeHost(world: World, campaign: CampaignAccess | null): SnapshotHost {
  return {
    world,
    seed: 4242,
    tick: 5400,
    simTimeSec: 180,
    rngState: 0x1234_5678,
    speedIndex: 1,
    scenario: 'campaign',
    map: 'temperate-valley',
    defs: null,
    camera: null,
    vision: null,
    ore: null,
    scatter: null,
    superweapons: null,
    commanderPowers: null,
    campaign,
    clearedFootprints: [],
  };
}

function capture(side: Side): Uint8Array {
  const out = captureSnapshot(side.host, 'test');
  if (!out.ok) throw new Error(`capture refused: ${out.reason}`);
  return out.value.bytes;
}

/** Mid-operation state: both timers running, a hidden objective revealed. */
function seed(session: FakeSession): void {
  const s = session.state;
  s.startTick = 1200;
  s.armedAt.set('t.gamma', 3300);
  s.armedAt.set('t.alpha', 1260);
  s.fired.add('t.alpha');
  s.objectives.set('obj.cache', 'active');
  s.objectives.set('obj.primary', 'active');
  session.complete('obj.bonus');
  s.reason = '';
}

/** Maps and sets flattened and sorted, so a deep compare means something. */
function dump(s: OperationState): unknown {
  const pairs = <V>(m: Map<string, V>): [string, V][] =>
    [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    operationId: s.operationId,
    startTick: s.startTick,
    armedAt: pairs(s.armedAt),
    fired: [...s.fired].sort(),
    objectives: pairs(s.objectives),
    paid: [...s.paid].sort(),
    outcome: s.outcome,
    reason: s.reason,
  };
}

/* -- an older file --------------------------------------------------------
 * Rewrite a blob with one chunk removed and the body length and CRC re-sealed,
 * which is precisely the file a build with no campaign chunk would have
 * written. The header offsets are `captureSnapshot`'s own — magic 0..3, schema
 * 4..5, flags 6..7, structural hash 8..11, body length 12..15, body CRC 16..19,
 * meta length 16..19+4, meta bytes from 24 padded to four — so this helper
 * fails loudly if that layout ever changes, which is worth having.
 * ----------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fourcc(s: string): number {
  return (
    (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
  ) >>> 0;
}

function bodyStartOf(view: DataView): number {
  const metaLength = view.getUint32(20, true);
  return 24 + ((metaLength + 3) & ~3);
}

/** Every chunk id in the body, in order. */
function chunkIds(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = bodyStartOf(view);
  const end = start + view.getUint32(12, true);
  const out: number[] = [];
  let off = start;
  while (off + 8 <= end) {
    out.push(view.getUint32(off, true));
    off += 8 + view.getUint32(off + 4, true);
  }
  return out;
}

function stripChunk(bytes: Uint8Array, cc: string): Uint8Array {
  const drop = fourcc(cc);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = bodyStartOf(view);
  const end = start + view.getUint32(12, true);

  const kept: Uint8Array[] = [];
  let off = start;
  let removed = 0;
  while (off + 8 <= end) {
    const total = 8 + view.getUint32(off + 4, true);
    if (view.getUint32(off, true) === drop) removed++;
    else kept.push(bytes.slice(off, off + total));
    off += total;
  }
  if (removed !== 1) throw new Error(`expected exactly one '${cc}' chunk, found ${removed}`);

  const bodyLength = kept.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(start + bodyLength);
  out.set(bytes.subarray(0, start));
  let o = start;
  for (const c of kept) { out.set(c, o); o += c.length; }

  const outView = new DataView(out.buffer);
  outView.setUint32(12, bodyLength >>> 0, true);
  outView.setUint32(16, crc32(out.subarray(start)), true);
  return out;
}

/* ==========================================================================
 * 1. THE STATE
 * ========================================================================== */

describe('a campaign operation survives a save and a reload', () => {
  it('brings back the clock, both timers, every objective, the purse and the verdict', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    seed(src.session);
    src.session.state.outcome = null;

    const dst = makeSide(op);
    const before = dump(dst.session.state);

    const restored = restoreSnapshot(capture(src), dst.host);
    expect(restored.ok).toBe(true);
    expect(dump(dst.session.state)).toEqual(dump(src.session.state));

    // The falsifier: the destination did not already agree. Without it this
    // whole assertion would pass against a `restore` that did nothing at all.
    expect(before).not.toEqual(dump(src.session.state));
  });

  it('restores a loss and the objective id that named it', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    src.session.state.outcome = 'lost';
    src.session.state.reason = 'obj.primary';

    const dst = makeSide(op);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    expect(dst.session.state.outcome).toBe('lost');
    expect(dst.session.state.reason).toBe('obj.primary');
  });

  it('overwrites a status the destination reached on its own timeline', () => {
    /*
     * NARROWER THAN IT LOOKS, AND DELIBERATELY NAMED FOR WHAT IT MEASURES.
     * `applyCampaignState` clears the objective map before refilling it, and
     * THIS TEST DOES NOT PROVE THE CLEAR — removing `s.objectives.clear()`
     * leaves it green. It cannot prove it: `newOperationState` seeds every
     * objective the operation declares and nothing ever deletes one, so both
     * sides of a save carry the identical key set and a merge overwrites
     * exactly what a replace does. The clear is only observable when the
     * OPERATION FILE itself changed between the save and the load, which is a
     * cross-version case nothing here can stage. What is proved is the part a
     * player can hit: a save's verdict wins over whatever the running session
     * had decided for the same objective.
     */
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    src.session.state.objectives.set('obj.primary', 'failed');

    const dst = makeSide(op);
    dst.session.state.objectives.set('obj.primary', 'complete');

    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    expect(dst.session.state.objectives.get('obj.primary')).toBe('failed');
  });

  it('drops state the incoming save does not carry, when a load lands on a live session', () => {
    /*
     * THE SECOND LOAD IS THE ONLY THING THAT MAKES THE FOUR `clear()` CALLS
     * LOAD-BEARING, and every other test in this file builds a fresh
     * destination — so without this one, deleting `s.armedAt.clear()`,
     * `s.fired.clear()`, `s.paid.clear()` or `TagRegistry.restore`'s
     * `byTag.clear()` leaves all 26 assertions green. A merge would leave save
     * A's armed hold timers, its fired triggers, its purse and its tag rows
     * standing inside save B's operation: a trigger that already fired can
     * never fire again, a paid secondary can never pay, and `entityDead` on a
     * tag save B never had is answered by save A's corpses.
     *
     * `restoreSnapshot` over a running match is not hypothetical — it is the
     * whole reason `requireMatchingWorld` exists: boot the world once, put a
     * snapshot over the top, and do it again.
     */
    const op = makeOp('op.alpha');

    const a = makeSide(op);
    seed(a.session);
    a.session.tags.add('convoy', a.ids[0]);
    const saveA = capture(a);

    // Save B is the same operation, EARLIER: one different timer armed, nothing
    // fired, nothing paid, and a different tag.
    const b = makeSide(op);
    b.session.state.startTick = 300;
    b.session.state.armedAt.set('t.beta', 330);
    b.session.tags.add('tap', b.ids[1]);
    const saveB = capture(b);

    const live = makeSide(op);
    expect(restoreSnapshot(saveA, live.host).ok).toBe(true);

    // The falsifier: save A really did put all four of these into the session,
    // so the four emptiness assertions below are about B replacing them rather
    // than about a session that never had anything.
    expect([...live.session.state.armedAt.keys()].sort()).toEqual(['t.alpha', 't.gamma']);
    expect([...live.session.state.fired]).toEqual(['t.alpha']);
    expect([...live.session.state.paid]).toEqual(['obj.bonus']);
    expect([...live.session.tags.tags]).toEqual(['convoy']);

    expect(restoreSnapshot(saveB, live.host).ok).toBe(true);

    const s = live.session.state;
    expect(s.startTick).toBe(300);
    expect([...s.armedAt.entries()]).toEqual([['t.beta', 330]]);
    expect([...s.fired]).toEqual([]);
    expect([...s.paid]).toEqual([]);
    expect([...live.session.tags.tags]).toEqual(['tap']);
  });
});

/* ==========================================================================
 * 2. THE TAGS — THE `carrierId` DEFECT, POINTED AT AN OBJECTIVE
 * ========================================================================== */

describe('a tag comes back pointing at the entity, not at the handle', () => {
  it('re-points every tag through a handle the save never contained', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    for (let i = 0; i < 3; i++) src.session.tags.add('derrick', src.ids[i]);
    src.session.tags.add('tap', src.ids[3]);

    const dst = makeSide(op);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);

    const live = dst.session.tags.live(dst.world.store, 'derrick');
    expect(live.length).toBe(3);
    expect(dst.session.tags.live(dst.world.store, 'tap').length).toBe(1);

    // Same entities: the three derricks stand where they stood.
    const posOf = (world: World, ids: readonly EntityId[]): number[] =>
      ids.map((h) => world.store.posX[world.store.index(h)]).sort((a, b) => a - b);
    expect(posOf(dst.world, live)).toEqual(posOf(src.world, src.ids.slice(0, 3)));

    // THE FALSIFIER, AND THE WHOLE REASON THIS CHUNK STORES INDICES. A raw
    // copy of the saved handles would have produced exactly the saved values,
    // and those values are DEAD in the restored world — the generation bump
    // saw to that. If this ever passes with the handles equal, the remap is
    // gone and a tag is addressing whatever recycled the slot.
    expect([...live]).not.toEqual(src.ids.slice(0, 3));
    for (const stale of src.ids) expect(dst.world.store.isAlive(stale)).toBe(false);
  });

  it('drops a tagged entity that did not make it into the snapshot', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    for (const id of src.ids) src.session.tags.add('convoy', id);

    // One truck is destroyed before the save. `captureSnapshot` writes only the
    // living, so a tag row that still named it would resurrect a stranger.
    src.world.store.markDead(src.ids[1]);
    src.world.store.flushDestroyed();

    const dst = makeSide(op);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    expect(dst.session.tags.live(dst.world.store, 'convoy').length).toBe(3);
  });

  it('keeps a tag that has outlived every entity carrying it', () => {
    // `entityDead: 'tap'` is TRUE before the tag exists, which is why an empty
    // tag and an absent tag have to stay distinguishable across a save.
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    src.session.tags.add('tap', src.ids[0]);
    src.world.store.markDead(src.ids[0]);
    src.world.store.flushDestroyed();

    const dst = makeSide(op);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    expect(dst.session.tags.tags).toContain('tap');
    expect(dst.session.tags.live(dst.world.store, 'tap').length).toBe(0);
  });
});

/* ==========================================================================
 * 3. TRIGGER STATE IS KEYED BY ID
 * ========================================================================== */

describe('trigger state is keyed by stable id, never by array index', () => {
  it('restores the same triggers after the operation file reorders them', () => {
    const authored = makeOp('op.alpha', TRIGGERS);
    const reordered = makeOp('op.alpha', TRIGGERS_REORDERED);

    // The falsifier for the whole claim: the two orders genuinely disagree
    // about where every trigger sits, so an index-keyed encoding could not
    // have produced the assertions below.
    for (const t of TRIGGERS) {
      const a = authored.triggers.findIndex((x) => x.id === t.id);
      const b = reordered.triggers.findIndex((x) => x.id === t.id);
      expect(a).not.toBe(b);
    }

    const src = makeSide(authored);
    seed(src.session);

    const dst = makeSide(reordered);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);

    expect([...dst.session.state.armedAt.entries()].sort()).toEqual(
      [['t.alpha', 1260], ['t.gamma', 3300]],
    );
    expect([...dst.session.state.fired]).toEqual(['t.alpha']);
  });

  it('writes trigger ids into the chunk, not positions', () => {
    const src = makeSide(makeOp('op.alpha'));
    seed(src.session);
    const state = captureCampaignState(src.session, src.world.store, () => -1);
    expect(state.armedAt.map(([id]) => id).sort()).toEqual(['t.alpha', 't.gamma']);
    expect(state.fired).toEqual(['t.alpha']);
  });
});

/* ==========================================================================
 * 4. THE OPERATION IS PART OF THE WORLD'S IDENTITY
 * ========================================================================== */

describe('the operation id is compared, because the map and seed cannot tell two apart', () => {
  it('refuses a save from another operation on the same preset, map and seed', () => {
    const src = makeSide(makeOp('op.alpha'));
    const dst = makeSide(makeOp('op.beta'));

    // Everything `requireMatchingWorld` used to compare is identical.
    expect(dst.host.scenario).toBe(src.host.scenario);
    expect(dst.host.map).toBe(src.host.map);
    expect(dst.host.seed).toBe(src.host.seed);

    const result = restoreSnapshot(capture(src), dst.host);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('world-mismatch');
    expect(result.reason).toContain('op.alpha');
    expect(result.reason).toContain('op.beta');
  });

  it('accepts the same operation on that same ground — the falsifier', () => {
    const src = makeSide(makeOp('op.alpha'));
    const dst = makeSide(makeOp('op.alpha'));
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
  });

  it('refuses a campaign save into a skirmish, and a skirmish save into an operation', () => {
    const campaign = makeSide(makeOp('op.alpha'));
    const skirmish = makeSide(makeOp('op.alpha'));
    skirmish.host.campaign = null;

    const intoSkirmish = restoreSnapshot(capture(campaign), skirmish.host);
    expect(intoSkirmish.ok).toBe(false);
    if (!intoSkirmish.ok) expect(intoSkirmish.reason).toContain('a skirmish');

    const intoOperation = restoreSnapshot(capture(skirmish), campaign.host);
    expect(intoOperation.ok).toBe(false);
    if (!intoOperation.ok) expect(intoOperation.code).toBe('world-mismatch');
  });

  it('puts the operation id in the metadata, readable without opening the body', () => {
    const src = makeSide(makeOp('op.alpha'));
    const meta = readSnapshotMeta(capture(src));
    expect(meta.ok).toBe(true);
    if (!meta.ok) return;
    expect(meta.value.campaignOperationId).toBe('op.alpha');

    const skirmish = makeSide(makeOp('op.alpha'));
    skirmish.host.campaign = null;
    const plain = readSnapshotMeta(capture(skirmish));
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(plain.value.campaignOperationId).toBeUndefined();
  });
});

/* ==========================================================================
 * 4b. THE PAYLOAD CAME OFF A DISK
 *
 * `parseCampaignSaveState` is sixty lines of hand-rolled validation and NOTHING
 * ELSE IN THIS FILE EXERCISES IT — replacing its whole body with
 * `return data as CampaignSaveState` leaves every other assertion green,
 * because every payload the rest of the file feeds it was written by
 * `captureCampaignState` moments earlier. A parser nothing tests is a parser
 * that gets simplified away by the next person who reads it, and what it is
 * standing in front of is `applyCampaignState` writing half a state and then
 * throwing on a field it assumed was an array.
 *
 * The rejections are also the only place the id check inside
 * `applyCampaignState` can be reached at all: through `restoreSnapshot` the
 * `SaveMeta` gate refuses a foreign operation first, so that branch is
 * unreachable from every other test here and deleting it changes nothing.
 * ========================================================================== */

/** What the codec itself writes, through a real JSON round trip. */
function payloadOf(op: OperationDef): Record<string, unknown> {
  const src = makeSide(op);
  seed(src.session);
  src.session.tags.add('tap', src.ids[0]);
  const state = captureCampaignState(src.session, src.world.store, (h) => src.ids.indexOf(h));
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

const NO_HANDLES = (): EntityId => 0 as EntityId;

describe('a campaign payload is checked field by field before a byte of it is applied', () => {
  it('accepts what the codec wrote — the falsifier for every rejection below', () => {
    // Without this, a `parseCampaignSaveState` that returned null for
    // EVERYTHING would pass the whole table underneath.
    const parsed = parseCampaignSaveState(payloadOf(makeOp('op.alpha')));
    expect(parsed).not.toBeNull();
    expect(parsed?.operationId).toBe('op.alpha');
    expect(parsed?.fired).toEqual(['t.alpha']);
    expect(parsed?.tags).toEqual([{ tag: 'tap', ids: [0] }]);
  });

  /** Each entry breaks exactly one field of an otherwise-valid payload. */
  const BROKEN: readonly (readonly [string, (d: Record<string, unknown>) => void])[] = [
    ['operationId is missing', (d) => { delete d.operationId; }],
    ['operationId is a number', (d) => { d.operationId = 7; }],
    ['startTick is NaN', (d) => { d.startTick = Number.NaN; }],
    ['startTick is a string', (d) => { d.startTick = '1200'; }],
    ['reason is null', (d) => { d.reason = null; }],
    ['outcome is a word nothing produces', (d) => { d.outcome = 'drawn'; }],
    ['armedAt is not a list', (d) => { d.armedAt = { 't.alpha': 1260 }; }],
    ['an armedAt row is a bare string', (d) => { d.armedAt = ['t.alpha']; }],
    ['an armedAt row has three columns', (d) => { d.armedAt = [['t.alpha', 1260, 0]]; }],
    ['an armedAt tick is not a number', (d) => { d.armedAt = [['t.alpha', '1260']]; }],
    ['an objective status is not one of the four', (d) => { d.objectives = [['obj.primary', 'done']]; }],
    ['fired holds something that is not an id', (d) => { d.fired = ['t.alpha', 3]; }],
    ['paid is not a list at all', (d) => { d.paid = 'obj.bonus'; }],
    ['tags is not a list', (d) => { d.tags = { tap: [0] }; }],
    ['a tag row has no name', (d) => { d.tags = [{ ids: [0] }]; }],
    ['a tag row holds a fractional index', (d) => { d.tags = [{ tag: 'tap', ids: [0.5] }]; }],
    ['a tag row holds an index that is not a number', (d) => { d.tags = [{ tag: 'tap', ids: ['0'] }]; }],
  ];

  for (const [what, breakIt] of BROKEN) {
    it(`refuses a payload where ${what}`, () => {
      const d = payloadOf(makeOp('op.alpha'));
      breakIt(d);
      expect(parseCampaignSaveState(d)).toBeNull();
    });
  }

  it('refuses a non-object outright rather than reading fields off it', () => {
    for (const junk of [null, undefined, 42, 'CMPN', true]) {
      expect(parseCampaignSaveState(junk)).toBeNull();
    }
  });

  it('leaves the running operation untouched when the payload is unreadable', () => {
    // THE PROPERTY THE PARSER EXISTS FOR: refused, not half-applied. A codec
    // that wrote `startTick` before discovering `armedAt` was a string would
    // leave the operation running on a clock from another save.
    const dst = makeSide(makeOp('op.alpha'));
    seed(dst.session);
    const before = dump(dst.session.state);

    const wrecked = payloadOf(makeOp('op.alpha'));
    wrecked.startTick = 99;
    wrecked.armedAt = 'nope';
    expect(applyCampaignState(dst.session, wrecked, NO_HANDLES)).toBe(false);
    expect(dump(dst.session.state)).toEqual(before);
    expect(dst.session.adopted).toBe(0);
  });

  it('refuses another operation\'s state even with the world gate out of the way', () => {
    // `restoreSnapshot` refuses a foreign operation on the `SaveMeta` id, so
    // this branch is unreachable through the product path — which is exactly
    // why it needs a test of its own. What it prevents is silent and permanent:
    // operation beta's trigger ids resolving against operation alpha's table.
    const dst = makeSide(makeOp('op.alpha'));
    seed(dst.session);
    const before = dump(dst.session.state);

    expect(applyCampaignState(dst.session, payloadOf(makeOp('op.beta')), NO_HANDLES)).toBe(false);
    expect(dump(dst.session.state)).toEqual(before);
    expect(dst.session.adopted).toBe(0);

    // The falsifier: the same payload from the SAME operation IS applied, so
    // the refusal above is about the id and not about the payload's shape.
    expect(applyCampaignState(dst.session, payloadOf(makeOp('op.alpha')), NO_HANDLES)).toBe(true);
    expect(dst.session.state.startTick).toBe(1200);
    expect(dst.session.adopted).toBe(1);
  });
});

/* ==========================================================================
 * 5. A SAVE THAT PREDATES THE CHUNK
 * ========================================================================== */

describe('a save with no campaign chunk', () => {
  it('leaves the armed operation exactly as it was seeded', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    seed(src.session);
    const full = capture(src);

    // The falsifier first: with the chunk present, the state DOES move. So the
    // assertion below is about the chunk's absence and nothing else.
    const withChunk = makeSide(op);
    expect(restoreSnapshot(full, withChunk.host).ok).toBe(true);
    expect(withChunk.session.state.startTick).toBe(1200);

    const older = stripChunk(full, 'CMPN');
    const dst = makeSide(op);
    const fresh = dump(dst.session.state);
    expect(restoreSnapshot(older, dst.host).ok).toBe(true);
    expect(dump(dst.session.state)).toEqual(fresh);
  });

  it('still restores the world, so the missing chunk is not a refusal', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    const older = stripChunk(capture(src), 'CMPN');
    const dst = makeSide(op, { units: 0 });

    const result = restoreSnapshot(older, dst.host);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entityCount).toBe(4);
  });

  it('is skipped by a reader that has no campaign port at all', () => {
    // What a build predating the campaign does with this chunk: `readSections`
    // parses it, nothing consumes it, and every other section lands. The
    // identity gate is turned off here because in that build it did not exist.
    const src = makeSide(makeOp('op.alpha'));
    seed(src.session);
    const dst = makeSide(makeOp('op.alpha'), { units: 0 });
    dst.host.campaign = null;

    const result = restoreSnapshot(capture(src), dst.host, { requireMatchingWorld: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entityCount).toBe(4);
    expect(dst.session.state.startTick).toBe(0);
  });
});

/* ==========================================================================
 * 6. THE ANTI-SAVE-SCUM RULE
 * ========================================================================== */

describe('a paid secondary is not paid a second time after a reload', () => {
  it('carries the `paid` set, which is the only latch left once a status is re-published', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    src.session.complete('obj.bonus');
    expect(src.session.grants).toEqual([{ id: 'obj.bonus', credits: 750 }]);

    const dst = makeSide(op);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    expect([...dst.session.state.paid]).toEqual(['obj.bonus']);

    // Push the status back to `active`, which is what a trigger that
    // re-publishes an objective leaves behind. Completion is now no help and
    // `paid` is the only thing between the player and a printing press.
    dst.session.state.objectives.set('obj.bonus', 'active');
    dst.session.complete('obj.bonus');
    expect(dst.session.grants).toEqual([]);
  });

  it('pays once when the purse did NOT come back — the falsifier', () => {
    const op = makeOp('op.alpha');
    const dst = makeSide(op);
    dst.session.state.objectives.set('obj.bonus', 'active');
    dst.session.complete('obj.bonus');
    expect(dst.session.grants).toEqual([{ id: 'obj.bonus', credits: 750 }]);
  });
});

/* ==========================================================================
 * 7. THE LAZY `startTick` STAMP
 * ========================================================================== */

describe('a restore stands down the lazy startTick stamp', () => {
  it('keeps the saved clock when the first tick lands after the load', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    seed(src.session);

    const dst = makeSide(op);
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    expect(dst.session.adopted).toBe(1);

    // The engine's very next tick. `Session.simTick` opens by stamping
    // `startTick` when it has never run, and the restored operation must not
    // be re-zeroed by it.
    dst.session.simTick(5400);
    expect(dst.session.state.startTick).toBe(1200);
  });

  it('loses the clock without the hook, which is the damage it exists to prevent', () => {
    const op = makeOp('op.alpha');
    const src = makeSide(op);
    seed(src.session);

    const dst = makeSide(op, { honourAdopt: false });
    expect(restoreSnapshot(capture(src), dst.host).ok).toBe(true);
    dst.session.simTick(5400);
    // Four minutes and twenty seconds of operation clock, silently gone, and
    // with it the arming pass on that tick.
    expect(dst.session.state.startTick).toBe(5400);
  });
});

/* ==========================================================================
 * 8. THE INDEX ROW
 *
 * The load screen paints from `SaveSlotInfo` and never opens the blob, so the
 * operation has to reach it through the index. `contextOf` is the per-field
 * fallback that lets `ServiceContext` grow without invalidating rows already on
 * disk — the property `save-army-count.spec.ts` established for `armies`, and
 * the reason this field could be added at all.
 * ========================================================================== */

const slotInfo = (extra: unknown, operationId?: string): SaveSlotInfo => ({
  slot: 'manual.abc.1',
  meta: {
    schemaVersion: 1, structuralHash: 0, label: 'x', savedAtMs: 1, tick: 0,
    simTimeSec: 0, scenario: 'campaign', map: 'temperate-valley', seed: 4242,
    localPlayerName: 'p', localFaction: 1, credits: 0, entityCount: 0, byteLength: 0,
    ...(operationId === undefined ? {} : { campaignOperationId: operationId }),
  },
  extra,
});

describe('the load screen learns which operation to arm without opening the blob', () => {
  it('reads the operation off the blob header when the index row predates the field', () => {
    // The row was written by a shell that does not send it; the header was
    // written by `captureSnapshot`, which always does.
    const legacy = { mapId: 'temperate-valley', seed: 4242, armies: 2 };
    expect(contextOf(legacy, slotInfo(legacy, 'op.alpha')).campaignOperationId).toBe('op.alpha');
  });

  it('believes the row over the header when both speak', () => {
    const row = { campaignOperationId: 'op.beta' };
    expect(contextOf(row, slotInfo(row, 'op.alpha')).campaignOperationId).toBe('op.beta');
  });

  it('leaves a skirmish row absent rather than empty, so one rule covers both hops', () => {
    expect(contextOf({ campaignOperationId: '' }, slotInfo(null)).campaignOperationId)
      .toBeUndefined();
    expect(contextOf(undefined, slotInfo(null)).campaignOperationId).toBeUndefined();
  });

  it('does not blank the fields a legacy row did carry — the per-field falsifier', () => {
    const legacy = { mapId: 'coral-shore', playerFaction: 'allies', seed: 99, armies: 4 };
    const c = contextOf(legacy, slotInfo(legacy, 'op.alpha'));
    expect([c.mapId, c.playerFaction, c.seed, c.armies]).toEqual(['coral-shore', 'allies', 99, 4]);
  });
});

/* ==========================================================================
 * 9. THE FORMAT GATES
 * ========================================================================== */

describe('CHUNK_CMPN is additive', () => {
  it('moves neither the schema version nor the structural hash', () => {
    // Pinned BY VALUE. The chunk stream is length-prefixed and `readSections`
    // skips unknown ids, so a new chunk needs no bump — the CHUNK_SCATTER
    // precedent. Anything that changes these two refuses every save on disk,
    // and it should have to say so here first.
    expect(SAVE_SCHEMA_VERSION).toBe(1);
    expect(structuralHash()).toBe(3656281552);
  });

  it('writes the chunk only for a campaign, and writes it exactly once', () => {
    const cmpn = fourcc('CMPN');
    const campaign = makeSide(makeOp('op.alpha'));
    expect(chunkIds(capture(campaign)).filter((id) => id === cmpn).length).toBe(1);

    const skirmish = makeSide(makeOp('op.alpha'));
    skirmish.host.campaign = null;
    expect(chunkIds(capture(skirmish))).not.toContain(cmpn);
  });

  it('costs a handful of bytes against a skirmish save of the same world', () => {
    const campaign = makeSide(makeOp('op.alpha'));
    seed(campaign.session);
    for (let i = 0; i < 3; i++) campaign.session.tags.add('derrick', campaign.ids[i]);

    const skirmish = makeSide(makeOp('op.alpha'));
    skirmish.host.campaign = null;

    const delta = capture(campaign).length - capture(skirmish).length;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(1024);
  });
});
