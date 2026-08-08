/**
 * ============================================================================
 * tests/texture-workers.spec.ts — THE TEXTURE WORKER, AND WHAT MAKES IT SAFE
 * ============================================================================
 * Moving texture generation onto a second thread is only worth anything if two
 * claims hold, and neither is self-evident:
 *
 *   1. THE BYTES ARE THE SAME. A texture generated in a worker must be
 *      byte-identical to the one this repo has always generated inline. The
 *      generators are seeded and pure, so this SHOULD be free — but "should be
 *      free" is exactly the reasoning behind every drift `docs/SPEC_DRIFT_AUDIT.md`
 *      catalogues, and this project has already been burned once by a green
 *      build that proved nothing. So it is measured, byte for byte, for every
 *      generator and every packing.
 *
 *   2. THE GAME STILL BOOTS WHEN THE WORKER DOES NOT. There is no `Worker` in
 *      Node, none in a locked-down CSP, and none on a browser too old for
 *      module workers — and a worker that ACCEPTS a job and never answers would
 *      hold the loading curtain up forever, which is strictly worse than never
 *      having started one. Every one of those routes is exercised here and all
 *      of them must end in correct pixels.
 *
 * WHY THIS RUNS AT ALL IN `environment: 'node'`
 * ---------------------------------------------
 * The worker's whole job body is `runTextureJob` in `protocol.ts`, and the pool
 * takes its `spawn` function as an argument. So the message shape, the job
 * itself, the round-robin, the correlation, the timeout and the entire disable
 * cascade all run here against a fake worker driven by the REAL `structuredClone`.
 * The only line no Node test can reach is `new Worker(...)` in `spawn.ts`, which
 * is why that file contains nothing else.
 * ============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as THREE from 'three';

import {
  TextureFactory, materialTextureSet,
  type AnyGenParams, type Channel, type TextureKind, type TextureRequest,
} from '../src/core/assets';
import * as assetsModule from '../src/core/assets';
import * as surfacesModule from '../src/core/surfaces';
import { generateTextureBytes, placeholderBytes, textureKey } from '../src/core/surfaces';
import {
  isTextureJob, isTextureReply, replyTransfers, runTextureJob,
  type TextureJob, type TextureLayer, type TextureReply,
} from '../src/core/workers/protocol';
import { TexturePool, type WorkerLike } from '../src/core/workers/TexturePool';
import { Phase } from '../src/core/types';

/* -------------------------------------------------------------------------- */
/* The cases. One per generator, at a size the suite can afford.              */
/* -------------------------------------------------------------------------- */

const SIZE = 64;

const PBR: readonly Channel[] = ['albedo', 'normal', 'orm'];

/** Every registered generator, with params that exercise its own knobs. */
const CASES: ReadonlyArray<readonly [TextureKind, AnyGenParams]> = [
  // The clean set — these are what actually ships, and they take the
  // structural normal packer.
  ['flatPaint', { colour: '#b7bd63', sheen: 0.55, wear: 1 }],
  ['panelLines', { colour: '#b7bd63', scale: 4, lineWidth: 2, rivets: 12, layout: 'greeble' }],
  ['asphalt', { colour: '#2c2926', wear: 0.6 }],
  ['paving', { colour: '#cbc0ae', slabW: 32, slabH: 32, variation: 0.05, bond: 0.5, wear: 1 }],
  ['cobblestone', { colour: '#b8ab98', stoneSize: 16, jitter: 0.42, variation: 0.05 }],
  ['decal', { colour: '#c8202a', path: 'star5' }],
  ['decal', { colour: '#ffffff', path: 'arrowTurn', outline: 2 }],
  ['decal', { colour: '#ffffff', path: 'numeral', glyph: '317' }],
  ['brushedMetal', { colour: '#9aa0a6', direction: 'y' }],
  // Legacy set — still registered, so still covered.
  ['noise', {}], ['metal', {}], ['rust', {}], ['camo', {}], ['concrete', {}],
  ['panelMetal', {}], ['cloth', {}], ['ground', {}], ['crystal', {}],
  ['scorch', {}], ['treadPrint', {}], ['smokePuff', {}], ['blueNoise', {}],
  ['checker', {}],
];

function requestFor(kind: TextureKind, params: AnyGenParams, seed = 7): TextureRequest {
  return { kind, size: SIZE, seed, ...params };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The bytes a DataTexture is actually holding.
 *
 * THREE types `image.data` as nullable, so this narrows rather than casting —
 * a texture with no byte data is a real failure and should read as one.
 */
function bytesOf(tex: THREE.DataTexture): Uint8Array {
  const data: unknown = tex.image.data;
  if (!(data instanceof Uint8Array)) throw new Error(`texture ${tex.name} holds no bytes`);
  return data;
}

/** A factory that has never heard of workers — the path that always existed. */
function syncFactory(): TextureFactory {
  return new TextureFactory();
}

/* -------------------------------------------------------------------------- */
/* The fake worker                                                            */
/* -------------------------------------------------------------------------- */

/** What a fake worker should do when a job arrives. */
type Behaviour =
  /** Run the job for real and reply. The normal case. */
  | { mode: 'work' }
  /** Reply that the job failed, as a worker whose generator threw would. */
  | { mode: 'reject' }
  /** Accept the job and never answer. The hang. */
  | { mode: 'silent' }
  /** Raise a worker-level error, as a script that failed to load does. */
  | { mode: 'error'; reason: string }
  /** Answer with something that is not a reply at all. */
  | { mode: 'garbage' };

interface FakeWorker extends WorkerLike {
  readonly seen: TextureJob[];
  readonly terminated: () => boolean;
}

/**
 * A worker that is fake in exactly one respect: it runs on this thread.
 *
 * Everything else is real. Messages cross `structuredClone` in BOTH directions,
 * which is the actual algorithm a real `postMessage` uses — so a request that
 * would not survive the trip fails here too, and the main thread never sees a
 * buffer the "worker" still holds a reference to. The job itself is
 * `runTextureJob`, unmocked; the reply is delivered asynchronously, because a
 * synchronous reply would hide every ordering bug the real thing can have.
 */
function makeFakeWorker(behaviour: Behaviour): FakeWorker {
  let onMessage: (data: unknown) => void = () => {};
  let onError: (reason: string) => void = () => {};
  let dead = false;
  const seen: TextureJob[] = [];

  return {
    seen,
    terminated: () => dead,
    setHandlers(m, e) { onMessage = m; onError = e; },
    terminate() { dead = true; },
    postMessage(message: unknown): void {
      // Real structured clone, so an unclonable request fails here exactly as
      // it would across a real thread boundary.
      const delivered: unknown = structuredClone(message);
      queueMicrotask(() => {
        if (dead) return;
        if (behaviour.mode === 'silent') return;
        if (behaviour.mode === 'error') { onError(behaviour.reason); return; }
        if (behaviour.mode === 'garbage') { onMessage({ kind: 'texture:done' }); return; }
        if (!isTextureJob(delivered)) { onError('malformed job'); return; }
        seen.push(delivered);
        const reply: TextureReply = behaviour.mode === 'reject'
          ? { kind: 'texture:failed', id: delivered.id, reason: 'generator exploded' }
          : runTextureJob(delivered);
        // Clone on the way back too: the main thread must own its bytes.
        onMessage(structuredClone(reply));
      });
    },
  };
}

/** A factory wired to a fake worker pool, plus the workers it created. */
function workerFactory(behaviour: Behaviour, timeoutMs = 50): {
  factory: TextureFactory; workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const factory = new TextureFactory();
  factory.useWorkers(() => {
    const w = makeFakeWorker(behaviour);
    workers.push(w);
    return w;
  }, { size: 2, timeoutMs });
  return { factory, workers };
}

/* ==========================================================================
 * 1. THE HEADLINE: THE BYTES ARE THE SAME
 * ========================================================================== */

describe('worker and main thread produce identical bytes', () => {
  it('agrees byte for byte on every generator and every packing', () => {
    for (const [kind, params] of CASES) {
      const req = requestFor(kind, params);
      // The worker's job body, run as the worker runs it: one generator pass,
      // three packings off the one surface.
      const reply = runTextureJob({ id: 1, request: req, channels: PBR });
      expect(reply.kind, `${kind} failed in the worker`).toBe('texture:done');
      if (reply.kind !== 'texture:done') continue;

      for (const layer of reply.layers) {
        // The main thread's path, through the public factory API.
        const inline = generateTextureBytes({ ...req, channel: layer.channel });
        expect(layer.size).toBe(inline.size);
        expect(layer.srgb).toBe(inline.srgb);
        expect(
          Buffer.from(layer.data).equals(Buffer.from(inline.data)),
          `${kind}/${layer.channel} differs between the worker and the main thread`,
        ).toBe(true);
      }
    }
  });

  it('respects structuralNormal identically on both paths', () => {
    // A legacy kind forced onto the clean packer, and a clean kind forced off
    // it: the flag is a pixel-affecting decision, so both threads must read it
    // from the same place.
    for (const structuralNormal of [true, false]) {
      for (const kind of ['metal', 'panelLines'] as const) {
        const req: TextureRequest = { kind, size: SIZE, seed: 3, structuralNormal };
        const reply = runTextureJob({ id: 1, request: req, channels: ['normal'] });
        expect(reply.kind).toBe('texture:done');
        if (reply.kind !== 'texture:done') continue;
        const inline = generateTextureBytes({ ...req, channel: 'normal' });
        expect(
          Buffer.from(reply.layers[0].data).equals(Buffer.from(inline.data)),
          `${kind} structuralNormal=${structuralNormal} differs`,
        ).toBe(true);
      }
    }
  });

  it('does not depend on module cache warmth or on job order', async () => {
    // THE REAL RISK. `surfaces.ts` memoises wave sets in a module-level Map and
    // reuses module-level scratch arrays. A real worker starts with all of that
    // cold and generates in whatever order jobs arrive; the main thread may
    // have been generating for a second by then. If any of that state leaked
    // into the output, the two threads would disagree and nothing else in this
    // file would catch it.
    const forward = CASES.map(([kind, params], i) =>
      runTextureJob({ id: i, request: requestFor(kind, params), channels: PBR }));

    // A genuinely fresh module graph: new wave cache, new scratch buffers.
    vi.resetModules();
    const fresh = await import('../src/core/workers/protocol');
    const reversed = [...CASES].reverse().map(([kind, params], i) =>
      fresh.runTextureJob({ id: i, request: requestFor(kind, params), channels: PBR }));
    reversed.reverse();

    for (let i = 0; i < CASES.length; i++) {
      const a = forward[i], b = reversed[i];
      expect(a.kind).toBe('texture:done');
      expect(b.kind).toBe('texture:done');
      if (a.kind !== 'texture:done' || b.kind !== 'texture:done') continue;
      for (let c = 0; c < a.layers.length; c++) {
        expect(
          Buffer.from(a.layers[c].data).equals(Buffer.from(b.layers[c].data)),
          `${CASES[i][0]}/${a.layers[c].channel} changed with cache warmth or order`,
        ).toBe(true);
      }
    }
  });

  it('produces the same textures end to end, through a real pool', async () => {
    // The whole machine: factory -> pool -> structured clone -> runTextureJob ->
    // structured clone -> adopt. Compared against a factory that has no pool at
    // all, which is the code that shipped before any of this.
    const control = syncFactory();
    const { factory, workers } = workerFactory({ mode: 'work' });

    const expected = new Map<string, Uint8Array>();
    for (const [kind, params] of CASES) {
      const req = requestFor(kind, params);
      const viaWorker = factory.textureSet(req, PBR);
      const viaMain = control.textureSet(req, PBR);
      for (let i = 0; i < PBR.length; i++) {
        expected.set(textureKey({ ...req, channel: PBR[i] }), bytesOf(viaMain[i]));
        // Before the reply lands these hold the placeholder, so the comparison
        // below is only meaningful AFTER settleWorkers().
        expect(viaWorker[i].image.width).toBe(SIZE);
      }
    }

    await factory.settleWorkers();

    for (const [kind, params] of CASES) {
      const req = requestFor(kind, params);
      const got = factory.textureSet(req, PBR);
      for (let i = 0; i < PBR.length; i++) {
        const key = textureKey({ ...req, channel: PBR[i] });
        expect(
          Buffer.from(bytesOf(got[i])).equals(Buffer.from(expected.get(key) as Uint8Array)),
          `${kind}/${PBR[i]} came back from the worker wrong`,
        ).toBe(true);
      }
    }

    const stats = factory.workerStats();
    expect(stats.adopted).toBe(CASES.length * PBR.length);
    expect(stats.fellBack).toBe(0);
    expect(workers.length).toBe(2);
  });

  it('leaves no texture holding placeholder bytes after settling', async () => {
    const { factory } = workerFactory({ mode: 'work' });
    const req = requestFor('paving', { colour: '#cbc0ae', slabW: 32, slabH: 32 });
    const [albedo] = factory.textureSet(req, ['albedo']);

    // Up front it IS the placeholder — a flat fill of the base colour.
    const placeholder = placeholderBytes({ ...req, channel: 'albedo' });
    expect(Buffer.from(bytesOf(albedo)).equals(Buffer.from(placeholder.data))).toBe(true);

    await factory.settleWorkers();

    const real = generateTextureBytes({ ...req, channel: 'albedo' });
    expect(Buffer.from(bytesOf(albedo)).equals(Buffer.from(real.data))).toBe(true);
    expect(Buffer.from(bytesOf(albedo)).equals(Buffer.from(placeholder.data))).toBe(false);
  });

  it('keeps the texture object identity across the swap', async () => {
    // Materials hold references from the moment `get` returns. If the reply
    // replaced the texture instead of its pixels, the material would keep
    // sampling the placeholder forever.
    const { factory } = workerFactory({ mode: 'work' });
    const req = requestFor('asphalt', { colour: '#2c2926' });
    const before = factory.get(req);
    await factory.settleWorkers();
    expect(factory.get(req)).toBe(before);
  });
});

/* ==========================================================================
 * 2. THE SYNCHRONOUS PATH IS STILL THE DEFAULT
 * ========================================================================== */

describe('the synchronous path', () => {
  it('is what a factory with no pool uses, and it finishes before it returns', () => {
    const factory = syncFactory();
    for (const [kind, params] of CASES) {
      const req = requestFor(kind, params);
      const [albedo] = factory.textureSet(req, ['albedo']);
      const expected = generateTextureBytes({ ...req, channel: 'albedo' });
      expect(
        Buffer.from(bytesOf(albedo)).equals(Buffer.from(expected.data)),
        `${kind} inline albedo is wrong`,
      ).toBe(true);
    }
    expect(factory.workerStats().enabled).toBe(false);
    expect(factory.workerStats().dispatched).toBe(0);
  });

  it('still caches, still shares one generator run across channels', () => {
    const factory = syncFactory();
    const req = requestFor('panelLines', { colour: '#b7bd63', rivets: 8 });
    const set = materialTextureSet(factory, req);
    expect(set.map.name).toContain('albedo');
    expect(set.normalMap.name).toContain('normal');
    expect(set.ormMap.name).toContain('orm');

    const before = factory.stats();
    materialTextureSet(factory, req);
    const after = factory.stats();
    expect(after.generated).toBe(before.generated);   // all three were cached
    expect(after.hits).toBe(before.hits + 3);
  });

  it('is what the factory returns to after settling, so nothing pops in mid-match', async () => {
    const { factory } = workerFactory({ mode: 'work' });
    factory.textureSet(requestFor('flatPaint', { colour: '#b7bd63' }), ['albedo']);
    await factory.settleWorkers();
    expect(factory.workerStats().enabled).toBe(false);

    // A texture asked for after boot is finished the moment it is handed over.
    const req = requestFor('cobblestone', { colour: '#b8ab98', stoneSize: 16 });
    const [tex] = factory.textureSet(req, ['albedo']);
    const expected = generateTextureBytes({ ...req, channel: 'albedo' });
    expect(Buffer.from(bytesOf(tex)).equals(Buffer.from(expected.data))).toBe(true);
  });
});

/* ==========================================================================
 * 3. EVERY WAY THE WORKER CAN FAIL ENDS IN CORRECT PIXELS
 * ========================================================================== */

describe('fallback', () => {
  /** Assert a factory ends up with the right bytes however the pool behaved. */
  async function expectCorrectAfterSettle(factory: TextureFactory): Promise<void> {
    const reqs = CASES.slice(0, 6).map(([kind, params]) => requestFor(kind, params));
    const sets = reqs.map((req) => factory.textureSet(req, PBR));
    await factory.settleWorkers();
    for (let r = 0; r < reqs.length; r++) {
      for (let c = 0; c < PBR.length; c++) {
        const expected = generateTextureBytes({ ...reqs[r], channel: PBR[c] });
        expect(
          Buffer.from(bytesOf(sets[r][c])).equals(Buffer.from(expected.data)),
          `${reqs[r].kind}/${PBR[c]} is wrong after the fallback`,
        ).toBe(true);
      }
    }
  }

  it('generates inline when the platform has no Worker at all', async () => {
    const factory = new TextureFactory();
    factory.useWorkers(() => null);           // exactly what spawn.ts returns then
    await expectCorrectAfterSettle(factory);
    expect(factory.workerStats().enabled).toBe(false);
    expect(factory.workerStats().fellBack).toBeGreaterThan(0);
    expect(factory.workerStats().reason).toContain('no worker available');
  });

  it('generates inline when spawning throws', async () => {
    const factory = new TextureFactory();
    factory.useWorkers(() => { throw new Error('SecurityError: blocked by CSP'); });
    await expectCorrectAfterSettle(factory);
    expect(factory.workerStats().reason).toContain('blocked by CSP');
  });

  it('generates inline when the worker script fails to load', async () => {
    const { factory } = workerFactory({ mode: 'error', reason: 'failed to fetch worker' });
    await expectCorrectAfterSettle(factory);
    expect(factory.workerStats().adopted).toBe(0);
    expect(factory.workerStats().reason).toContain('failed to fetch');
  });

  it('generates inline when a generator throws inside the worker', async () => {
    const { factory } = workerFactory({ mode: 'reject' });
    await expectCorrectAfterSettle(factory);
    expect(factory.workerStats().adopted).toBe(0);
    expect(factory.workerStats().fellBack).toBeGreaterThan(0);
  });

  it('generates inline when the worker answers with nonsense', async () => {
    const { factory } = workerFactory({ mode: 'garbage' });
    await expectCorrectAfterSettle(factory);
    expect(factory.workerStats().reason).toContain('does not understand');
  });

  it('does not hang when the worker accepts a job and never replies', async () => {
    // THE ONE THAT MATTERS MOST. A worker that errors costs a millisecond; a
    // worker that goes quiet would hold the loading curtain up forever, which
    // is strictly worse than never starting one. The deadline turns that into
    // a bounded delay and a fallback.
    const { factory, workers } = workerFactory({ mode: 'silent' }, 20);
    await expectCorrectAfterSettle(factory);
    expect(factory.workerStats().reason).toContain('exceeded 20 ms');
    for (const w of workers) expect(w.terminated()).toBe(true);
  });

  it('stays off once it has given up', async () => {
    const { factory, workers } = workerFactory({ mode: 'error', reason: 'boom' });
    factory.textureSet(requestFor('flatPaint', { colour: '#111111' }), ['albedo']);
    await factory.settleWorkers();
    const spawnedOnce = workers.length;

    const factory2 = new TextureFactory();
    factory2.useWorkers(() => null);
    factory2.textureSet(requestFor('flatPaint', { colour: '#222222' }), ['albedo']);
    factory2.textureSet(requestFor('flatPaint', { colour: '#333333' }), ['albedo']);
    await factory2.settleWorkers();
    expect(factory2.workerStats().dispatched).toBe(1);   // the second never tried
    expect(workers.length).toBe(spawnedOnce);
  });

  it('ignores a second useWorkers call rather than leaking a pool', async () => {
    const { factory, workers } = workerFactory({ mode: 'work' });
    factory.useWorkers(() => { throw new Error('should never be called'); });
    factory.textureSet(requestFor('asphalt', { colour: '#2c2926' }), ['albedo']);
    await factory.settleWorkers();
    expect(factory.workerStats().adopted).toBe(1);
    expect(workers.length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 4. THE POOL ITSELF
 * ========================================================================== */

describe('TexturePool', () => {
  it('starts no workers until the first job', () => {
    let spawns = 0;
    const pool = new TexturePool({ spawn: () => { spawns++; return makeFakeWorker({ mode: 'work' }); } });
    expect(spawns).toBe(0);
    expect(pool.workerCount).toBe(0);
    pool.dispose();
  });

  it('spreads jobs across its workers round-robin', async () => {
    const workers: FakeWorker[] = [];
    const pool = new TexturePool({
      spawn: () => { const w = makeFakeWorker({ mode: 'work' }); workers.push(w); return w; },
      size: 3,
    });
    const jobs = Array.from({ length: 6 }, (_, i) =>
      pool.submit(requestFor('flatPaint', { colour: '#101010' }, i), ['albedo']));
    await Promise.all(jobs);
    expect(workers.length).toBe(3);
    for (const w of workers) expect(w.seen.length).toBe(2);
    pool.dispose();
  });

  it('resolves settle() only once the queue is empty', async () => {
    /*
     * ORDERING, not a synchronous flag.
     *
     * This test used to do `const settle = pool.settle().then(() => settled = true)`
     * and then assert `expect(settled).toBe(false)` on the very next line. That
     * assertion cannot fail: a `.then` callback has not run yet at that point no
     * matter WHAT settle() returned, so `settle = () => Promise.resolve()` — a
     * settle that ignores the queue completely — passed the whole test verbatim.
     *
     * Draining microtasks before asserting does not rescue it either: the fake
     * worker replies via `queueMicrotask`, so a flush completes the job and the
     * premise evaporates.
     *
     * What does discriminate is the ORDER the two promises resolve in. A settle()
     * that waits for the queue must resolve after the job it is waiting on; one
     * that returns an already-resolved promise wins the race instead, because
     * the job still has to wait for the worker's reply.
     */
    const pool = new TexturePool({ spawn: () => makeFakeWorker({ mode: 'work' }), size: 1 });
    const order: string[] = [];
    const job = pool.submit(requestFor('asphalt', { colour: '#2c2926' }), PBR)
      .then(() => { order.push('job'); });
    expect(pool.inFlight).toBe(1);
    const settle = pool.settle().then(() => { order.push('settle'); });
    await Promise.all([job, settle]);
    expect(order).toEqual(['job', 'settle']);
    expect(pool.inFlight).toBe(0);
    pool.dispose();
  });

  it('resolves outstanding jobs with null when disposed mid-flight', async () => {
    const pool = new TexturePool({ spawn: () => makeFakeWorker({ mode: 'silent' }), size: 1 });
    const job = pool.submit(requestFor('asphalt', { colour: '#2c2926' }), ['albedo']);
    pool.dispose();
    expect(await job).toBeNull();
    expect(pool.enabled).toBe(false);
    await pool.settle();     // must not hang
  });

  it('returns null rather than throwing for an empty channel list', async () => {
    const pool = new TexturePool({ spawn: () => makeFakeWorker({ mode: 'work' }) });
    expect(await pool.submit(requestFor('noise', {}), [])).toBeNull();
    pool.dispose();
  });
});

/* ==========================================================================
 * 5. THE WIRE FORMAT
 * ========================================================================== */

describe('the worker protocol', () => {
  it('accepts a real job and rejects malformed ones', () => {
    const good: TextureJob = { id: 1, request: { kind: 'asphalt' }, channels: ['albedo'] };
    expect(isTextureJob(good)).toBe(true);
    expect(isTextureJob(structuredClone(good))).toBe(true);

    expect(isTextureJob(null)).toBe(false);
    expect(isTextureJob('asphalt')).toBe(false);
    expect(isTextureJob({ id: 1, request: { kind: 'asphalt' }, channels: [] })).toBe(false);
    expect(isTextureJob({ id: 1, request: {}, channels: ['albedo'] })).toBe(false);
    expect(isTextureJob({ id: '1', request: { kind: 'asphalt' }, channels: ['albedo'] })).toBe(false);
    expect(isTextureJob({ id: 1, request: { kind: 'asphalt' }, channels: ['glitter'] })).toBe(false);
  });

  it('accepts a real reply and rejects malformed ones', () => {
    const reply = runTextureJob({ id: 4, request: { kind: 'checker', size: 8 }, channels: ['albedo'] });
    expect(isTextureReply(reply)).toBe(true);
    expect(isTextureReply(structuredClone(reply))).toBe(true);
    expect(isTextureReply({ kind: 'texture:failed', id: 4, reason: 'nope' })).toBe(true);

    expect(isTextureReply(undefined)).toBe(false);
    expect(isTextureReply({ kind: 'texture:done', id: 4 })).toBe(false);
    expect(isTextureReply({ kind: 'texture:failed', id: 4 })).toBe(false);
    expect(isTextureReply({ kind: 'other', id: 4, layers: [] })).toBe(false);
    expect(isTextureReply({
      kind: 'texture:done', id: 4,
      layers: [{ channel: 'albedo', size: 8, srgb: true, data: [1, 2, 3] }],
    })).toBe(false);
  });

  it('never throws — a broken generator comes back as a failed reply', () => {
    // `kind` is validated at the type level, so the way this actually happens
    // in the wild is a request that reaches a generator it cannot satisfy.
    // Whatever the cause, the worker must survive it.
    const reply = runTextureJob({
      id: 9,
      request: { kind: 'paving', size: -4 },   // a nonsense size
      channels: ['albedo'],
    });
    expect(reply.id).toBe(9);
    expect(['texture:done', 'texture:failed']).toContain(reply.kind);
    if (reply.kind === 'texture:failed') expect(typeof reply.reason).toBe('string');
  });

  it('falls back to the checker generator for an unknown kind, on both threads', () => {
    // `GENERATORS[kind] ?? GENERATORS.checker` is the existing behaviour and
    // the worker must not diverge from it.
    const req = { kind: 'no-such-generator', size: SIZE } as unknown as TextureRequest;
    const reply = runTextureJob({ id: 1, request: req, channels: ['albedo'] });
    expect(reply.kind).toBe('texture:done');
    if (reply.kind !== 'texture:done') return;
    const inline = generateTextureBytes({ ...req, channel: 'albedo' });
    expect(Buffer.from(reply.layers[0].data).equals(Buffer.from(inline.data))).toBe(true);
  });

  it('carries a polygon decal path across structured clone intact', () => {
    // The one request field that is not a primitive. If it did not clone, the
    // worker would silently draw a five-point star instead.
    const path = [[0.1, 0.1, 0.9, 0.2, 0.5, 0.9], [0.3, 0.3, 0.7, 0.3, 0.5, 0.7]];
    const req: TextureRequest = { kind: 'decal', size: SIZE, path, colour: '#ff8800' };
    const job: TextureJob = { id: 2, request: req, channels: ['mask'] };
    const cloned: unknown = structuredClone(job);
    expect(isTextureJob(cloned)).toBe(true);
    if (!isTextureJob(cloned)) return;

    const reply = runTextureJob(cloned);
    expect(reply.kind).toBe('texture:done');
    if (reply.kind !== 'texture:done') return;
    const inline = generateTextureBytes({ ...req, channel: 'mask' });
    expect(Buffer.from(reply.layers[0].data).equals(Buffer.from(inline.data))).toBe(true);
  });

  it('lists each reply buffer exactly once for transfer', () => {
    const reply = runTextureJob({
      id: 3, request: { kind: 'flatPaint', size: 16 }, channels: PBR,
    });
    expect(reply.kind).toBe('texture:done');
    if (reply.kind !== 'texture:done') return;
    const transfers = replyTransfers(reply);
    expect(transfers.length).toBe(3);
    expect(new Set(transfers).size).toBe(3);
    for (const layer of reply.layers) expect(transfers).toContain(layer.data.buffer);
  });

  it('lists nothing to transfer for a failed reply', () => {
    const failed: TextureReply = { kind: 'texture:failed', id: 1, reason: 'no' };
    expect(replyTransfers(failed)).toEqual([]);
  });

  it('runs the generator once for a whole material, not once per channel', () => {
    // Three separate single-channel jobs would be three generator passes. This
    // is the reason a job carries a channel LIST.
    const req = requestFor('brushedMetal', { colour: '#9aa0a6' });
    const reply = runTextureJob({ id: 1, request: req, channels: PBR });
    expect(reply.kind).toBe('texture:done');
    if (reply.kind !== 'texture:done') return;
    expect(reply.layers.map((l: TextureLayer) => l.channel)).toEqual([...PBR]);
    // Distinct buffers, so transferring one cannot detach another.
    expect(new Set(reply.layers.map((l: TextureLayer) => l.data.buffer)).size).toBe(3);
  });
});

/* ==========================================================================
 * 6. THE SPLIT ITSELF
 *
 * `surfaces.ts` was cut out of `assets.ts` so the worker chunk would not carry
 * Three.js. Both halves of that claim are gated here, because both are the kind
 * of thing an ordinary-looking import can silently undo.
 * ========================================================================== */

const SRC = resolve(__dirname, '..', 'src');

/**
 * Comments out. These files talk ABOUT their imports at length — the header of
 * `surfaces.ts` names `./math` and `from './core/assets'` in prose — and a
 * scanner that cannot tell an import from a sentence would chase
 * `src/core/core/assets.ts` and fail for the wrong reason.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * The three shapes a module specifier can appear in. Each requires the quote to
 * be reached through `from`, a bare `import`, or `import(` — never just by
 * being the first string after the word `export`, which would drag in every
 * union member of `export type Channel = 'albedo' | ...` and send the walk
 * chasing files called `albedo.ts`.
 *
 * `[^;]` keeps a match inside one statement, so a lazy quantifier cannot run
 * from one declaration into the next declaration's import.
 */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,   // import/export ... from 'x'
  /^\s*import\s+['"]([^'"]+)['"]/gm,                            // import 'x'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,                     // import('x')
];

/**
 * Every bare (non-relative) specifier reachable from `entry` through static
 * relative imports, as `file -> specifier` strings.
 */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const bare: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of SPECIFIER_PATTERNS) {
      const rx = new RegExp(pattern.source, pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = rx.exec(src)) !== null) {
        const spec = m[1];
        if (!spec.startsWith('.')) { bare.push(`${file} -> ${spec}`); continue; }
        const base = resolve(dirname(file), spec);
        queue.push(base.endsWith('.ts') ? base : `${base}.ts`);
      }
    }
  }
  return bare;
}

describe('the worker import graph', () => {
  it('reaches no bare dependency at all — no THREE, nothing', () => {
    // A worker chunk carrying Three.js would be ~700 kB downloaded to render
    // nothing, which is more than the generation it was started to overlap.
    // This is the whole reason `surfaces.ts` exists as a separate file.
    const bare = importGraph(join(SRC, 'core', 'workers', 'textureWorker.ts'));
    expect(bare).toEqual([]);
  });

  it('holds for surfaces.ts on its own too', () => {
    expect(importGraph(join(SRC, 'core', 'surfaces.ts'))).toEqual([]);
  });

  it('does not hold for assets.ts, which is the point of the split', () => {
    // A guard against the split being "tidied" back together: if assets.ts ever
    // stops importing THREE, somebody has moved the factory somewhere else and
    // the graph test above needs re-checking.
    expect(importGraph(join(SRC, 'core', 'assets.ts'))).toContain(
      `${join(SRC, 'core', 'assets.ts')} -> three`,
    );
  });

  it('re-exports every runtime export of surfaces.ts from assets.ts', () => {
    // The split must not have quietly dropped part of the public API. Every
    // consumer in the repo imports from `core/assets`.
    const missing = Object.keys(surfacesModule).filter((k) => !(k in assetsModule));
    expect(missing).toEqual([]);
  });
});

/* ==========================================================================
 * 7. THE BROWSER EDGE
 *
 * `spawn.ts` and `texture-warm.system.ts` are the two files that only do
 * anything in a browser. Node cannot exercise what they do there — but it CAN
 * check that importing them is harmless and that the platform guard fires,
 * which is the failure that would otherwise take the whole boot down.
 * ========================================================================== */

describe('the browser edge', () => {
  it('returns null instead of throwing where there is no Worker', async () => {
    expect(typeof Worker).toBe('undefined');   // the premise, stated out loud
    const { spawnTextureWorker } = await import('../src/core/workers/spawn');
    expect(spawnTextureWorker()).toBeNull();
  });

  it('registers a warm system that sorts last and installs the pool on import', async () => {
    // Importing it is the whole mechanism: discovery is an eager glob, so this
    // module's side effect lands before any system's `init` runs. If importing
    // it threw, the game would not boot at all.
    const mod = await import('../src/core/workers/texture-warm.system');
    expect(mod.default.id).toBe('core.textureWarm');
    // `SystemRegistry.init` awaits modules in (phase, order, seq) order, so a
    // top phase and a top order is what makes "after every other init" true.
    expect(mod.default.phase).toBe(Phase.Cleanup);
    expect(mod.default.order).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof mod.default.init).toBe('function');
    // And its init must resolve in Node, where the pool can never start.
    await mod.default.init?.();
  });
});

/* ==========================================================================
 * 8. THE PLACEHOLDER
 * ========================================================================== */

describe('placeholder bytes', () => {
  it('are the right length and opaque for every channel', () => {
    for (const channel of [...PBR, 'mask'] as Channel[]) {
      const p = placeholderBytes({ kind: 'flatPaint', size: 32, colour: '#4488cc', channel });
      expect(p.size).toBe(32);
      expect(p.data.length).toBe(32 * 32 * 4);
      expect(p.srgb).toBe(channel === 'albedo' || channel === 'mask');
    }
  });

  it('carry the request colour, so a stray frame shows paint and not black', () => {
    const p = placeholderBytes({ kind: 'flatPaint', size: 4, colour: '#4488cc', channel: 'albedo' });
    expect([p.data[0], p.data[1], p.data[2], p.data[3]]).toEqual([0x44, 0x88, 0xcc, 255]);
  });

  it('are flat-facing for the normal channel', () => {
    const p = placeholderBytes({ kind: 'flatPaint', size: 4, channel: 'normal' });
    expect([p.data[0], p.data[1]]).toEqual([128, 128]);
    expect(p.srgb).toBe(false);
  });
});
