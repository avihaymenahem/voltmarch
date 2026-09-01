/**
 * ============================================================================
 * A WEBGPU DEVICE DYING IS A NORMAL EVENT, AND THE PAGE MUST SURVIVE IT.
 * ============================================================================
 * Reported by a player: their driver reset, and the page died with
 *
 *     TypeError: Cannot read properties of null (reading 'getSupportedExtensions')
 *         at new WebGLExtensions
 *         at WebGLBackend.init
 *
 * The chain is three's own and it is structural, not a bug in our wiring:
 * `WebGPURenderer` installs a `getFallback` that builds a `WebGLBackend` on
 * `renderer.domElement`, `Renderer.init()` calls it on ANY throw out of
 * `WebGPUBackend.init`, and `WebGLBackend.init` then asks that same canvas for a
 * `webgl2` context. A canvas holds ONE context type for its whole life, and
 * `index.html` ships one canvas (`#gl`), so the answer is `null` and the next
 * line dereferences it. `assertBackend` — the guard written for exactly this
 * class of lie — could not fire, because it reads the object `init()` RESOLVES
 * with and here `init()` REJECTS.
 *
 * ── WHY EVERYTHING HERE IS A FAKE ───────────────────────────────────────────
 * The host machine has crashed its GPU driver twice on this path. A real device
 * loss is therefore not an available instrument, and it does not need to be: the
 * loss signal is a PROMISE (`device.lost`) and the init failure is a REJECTION,
 * and both are things a stub can produce exactly. `src/render/device-loss.ts`
 * imports nothing from three and touches the DOM only through one injected host,
 * for precisely this reason — the same shape as `backend.ts` and
 * `tests/render-backend.spec.ts`.
 *
 * **What these fakes DO NOT prove** is written at the bottom of the file, under
 * `WHAT ONLY A REAL DEVICE LOSS CAN CONFIRM`. Read it before quoting this suite
 * as evidence that recovery works on hardware.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeAdapter, normaliseAdapterInfo, type AdapterIdentity } from '../src/render/backend';
import {
  CanvasQuarantine,
  GPU_FAILURE_PANEL_CLASS,
  GpuUnavailableError,
  gpuFailureConsoleLine,
  gpuFailureReport,
  hrefForWebgl,
  isDeliberateDestroy,
  showGpuFailure,
  watchDeviceLoss,
  type FailureHost,
  type GpuFailure,
} from '../src/render/device-loss';
import {
  installNodePath,
  resetNodePathForTests,
  type NodePath,
  type NodeRendererLike,
} from '../src/render/gpu-path';
import { gpuReport, prepareRenderer, resetGpuStateForTests } from '../src/render/renderer';

/* ==========================================================================
 * 1. THE ADAPTER — which GPU it actually was
 * ========================================================================== */

describe('normaliseAdapterInfo', () => {
  it('reads a plain record', () => {
    expect(normaliseAdapterInfo({ vendor: 'nvidia', architecture: 'ampere', device: '', description: '' }))
      .toEqual({ vendor: 'nvidia', architecture: 'ampere', device: '', description: '' });
  });

  it('reads fields that live on the PROTOTYPE, where a spread finds nothing', () => {
    /*
     * `GPUAdapterInfo` is a live interface object, not a record: Chrome puts
     * vendor/architecture/device/description on the prototype as getters. So
     * `Object.keys(info)` is `[]` and `{ ...info }` copies nothing — a reader
     * written with a spread reports "the browser told us nothing" on every real
     * adapter in existence. The two assertions below pin that the fake really
     * does have that shape, so the third is not testing a plain object by
     * accident.
     */
    class FakeAdapterInfo {
      get vendor(): string { return 'amd'; }
      get architecture(): string { return 'gcn-5'; }
      get device(): string { return ''; }
      get description(): string { return 'AMD Radeon(TM) Graphics'; }
    }
    const info = new FakeAdapterInfo();
    expect(Object.keys(info)).toEqual([]);
    expect({ ...info }).toEqual({});

    expect(normaliseAdapterInfo(info)).toEqual({
      vendor: 'amd',
      architecture: 'gcn-5',
      device: '',
      description: 'AMD Radeon(TM) Graphics',
    });
  });

  it('turns a missing or non-string field into an empty string, never undefined', () => {
    // A field read as `undefined` prints the WORD "undefined" into the one crash
    // report somebody was relying on.
    expect(normaliseAdapterInfo({ vendor: 'intel', architecture: 42 })).toEqual({
      vendor: 'intel', architecture: '', device: '', description: '',
    });
  });

  it('separates "no adapter" from "an adapter that reported nothing"', () => {
    // Both are real states and they mean different things to a bug report.
    expect(normaliseAdapterInfo(null)).toBeNull();
    expect(normaliseAdapterInfo(undefined)).toBeNull();
    expect(normaliseAdapterInfo({})).toBeNull();
    expect(normaliseAdapterInfo({ vendor: '', architecture: '', device: '', description: '' })).toBeNull();
    expect(normaliseAdapterInfo({ vendor: 'apple' })).not.toBeNull();
  });
});

describe('describeAdapter', () => {
  const id = (p: Partial<AdapterIdentity>): AdapterIdentity =>
    ({ vendor: '', architecture: '', device: '', description: '', ...p });

  it('names the integrated adapter the high-performance hint did not avoid', () => {
    // The Stage A case, verbatim: powerPreference: 'high-performance' asked for
    // the RTX 3080 and the probe observed this.
    expect(describeAdapter(id({ vendor: 'amd', architecture: 'gcn-5' }))).toBe('amd gcn-5');
  });

  it('leads with the marketing name and keeps the family beside it', () => {
    expect(describeAdapter(id({ vendor: 'nvidia', architecture: 'ampere', description: 'NVIDIA GeForce RTX 3080' })))
      .toBe('NVIDIA GeForce RTX 3080 (nvidia ampere)');
  });

  it('returns null rather than the word "unknown"', () => {
    // The caller picks its own fallback; baking one in here would make
    // "the adapter said nothing" indistinguishable from "there was no adapter".
    expect(describeAdapter(null)).toBeNull();
  });
});

/* ==========================================================================
 * 2. DETECTION — device.lost is a promise that RESOLVES
 * ========================================================================== */

describe('watchDeviceLoss', () => {
  it('fires when the device resolves its lost promise', async () => {
    let resolve!: (v: { reason: string; message: string }) => void;
    const lost = new Promise<{ reason: string; message: string }>((r) => { resolve = r; });
    const seen: Array<string | null | undefined> = [];
    watchDeviceLoss({ lost }, (info) => seen.push(info.reason));

    expect(seen).toEqual([]); // pending forever on a healthy device
    resolve({ reason: 'unknown', message: 'Device was lost: DXGI_ERROR_DEVICE_RESET' });
    await lost;
    await Promise.resolve();
    expect(seen).toEqual(['unknown']);
  });

  it('IGNORES a deliberate destroy — that is teardown, not a failure', async () => {
    // `device.destroy()` resolves `lost` with reason 'destroyed'. Raising a
    // panel over it would fire on every page close. three filters the same
    // value in WebGPUBackend.init for the same reason.
    const lost = Promise.resolve({ reason: 'destroyed', message: '' });
    const fn = vi.fn();
    watchDeviceLoss({ lost }, fn);
    await lost;
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
    expect(isDeliberateDestroy({ reason: 'destroyed' })).toBe(true);
    expect(isDeliberateDestroy({ reason: 'unknown' })).toBe(false);
  });

  it('does not fire after the watch is cancelled', async () => {
    let resolve!: (v: { reason: string }) => void;
    const lost = new Promise<{ reason: string }>((r) => { resolve = r; });
    const fn = vi.fn();
    const cancel = watchDeviceLoss({ lost }, fn);
    cancel();
    resolve({ reason: 'unknown' });
    await lost;
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires at most once', async () => {
    const lost = Promise.resolve({ reason: 'unknown', message: 'x' });
    const fn = vi.fn();
    watchDeviceLoss({ lost }, fn);
    await lost;
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('survives a device with no lost promise at all', () => {
    // An older browser or a stub. A throw here would take the boot down for a
    // capability the device simply does not publish.
    const fn = vi.fn();
    expect(() => watchDeviceLoss(undefined, fn)).not.toThrow();
    expect(() => watchDeviceLoss({}, fn)).not.toThrow();
    expect(() => watchDeviceLoss({ lost: null }, fn)).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('swallows a REJECTED lost promise instead of raising a second, wronger error', async () => {
    const lost = Promise.reject(new Error('not per spec, but possible'));
    const fn = vi.fn();
    watchDeviceLoss({ lost }, fn);
    await lost.catch(() => undefined);
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });
});

/* ==========================================================================
 * 3. THE QUARANTINE — a poisoned canvas is never handed back
 * ========================================================================== */

describe('CanvasQuarantine', () => {
  it('is identity for a canvas that never met WebGPU', () => {
    // The whole WebGL path runs through this. It must cost nothing and change
    // nothing: same element in, same element out, mint never called.
    const q = new CanvasQuarantine<object>();
    const c = { name: 'gl' };
    const mint = vi.fn(() => ({ name: 'fresh' }));
    expect(q.resolve(c, mint)).toBe(c);
    expect(mint).not.toHaveBeenCalled();
  });

  it('never returns a poisoned canvas', () => {
    const q = new CanvasQuarantine<object>();
    const poisoned = { name: 'gl' };
    const fresh = { name: 'fresh' };
    q.poison(poisoned);
    expect(q.isPoisoned(poisoned)).toBe(true);
    expect(q.resolve(poisoned, () => fresh)).toBe(fresh);
  });

  it('mints ONCE and hands the same replacement back forever', () => {
    // A second mint would leave two canvases claiming #gl and a renderer drawing
    // into a detached one.
    const q = new CanvasQuarantine<object>();
    const poisoned = { name: 'gl' };
    q.poison(poisoned);
    const mint = vi.fn(() => ({ name: 'fresh' }));
    const a = q.resolve(poisoned, mint);
    const b = q.resolve(poisoned, mint);
    expect(a).toBe(b);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('follows the chain, because callers hold references taken before the swap', () => {
    /*
     * `Shell` keeps `options.canvas` for the life of the page and hands that same
     * field to `bootstrap()` on every match. Resolving a stale reference to the
     * detached element would put the renderer on a canvas that is not in the DOM.
     */
    const q = new CanvasQuarantine<object>();
    const first = { n: 1 };
    const second = { n: 2 };
    const third = { n: 3 };
    q.poison(first);
    expect(q.resolve(first, () => second)).toBe(second);
    q.poison(second);
    // Asked with the ORIGINAL, stale reference — must land on the newest.
    expect(q.resolve(first, () => third)).toBe(third);
    expect(q.resolve(first, () => ({ n: 99 }))).toBe(third);
  });

  it('is bounded — a cycle must not hang the boot', () => {
    const q = new CanvasQuarantine<object>();
    const a = { n: 'a' };
    q.poison(a);
    let next = a;
    for (let i = 0; i < 20; i++) {
      const made = { n: `c${i}` };
      q.resolve(next, () => made);
      q.poison(made);
      next = made;
    }
    // The assertion is that we got here at all, plus a non-poisoned answer.
    const out = q.resolve(a, () => ({ n: 'last' }));
    expect(q.isPoisoned(out)).toBe(false);
  });
});

/* ==========================================================================
 * 4. THE WORDS — what the human reads
 * ========================================================================== */

const ADAPTER: AdapterIdentity = {
  vendor: 'amd', architecture: 'gcn-5', device: '', description: '',
};

describe('gpuFailureReport', () => {
  const lost: GpuFailure = {
    phase: 'lost', reason: 'unknown', message: 'Device was lost: DXGI_ERROR_DEVICE_RESET',
    adapter: ADAPTER,
  };
  const init: GpuFailure = {
    phase: 'init', reason: null, message: 'THREE.WebGPUBackend: Unable to create WebGPU adapter.',
    adapter: null,
  };

  it('tells a player their driver reset, in words, and that it was not their fault', () => {
    const r = gpuFailureReport(lost);
    expect(r.title).toBe('Graphics Device Lost');
    const prose = r.lines.join(' ');
    expect(prose).toContain('driver reset');
    expect(prose).toContain('not caused by anything you did');
    // The GPU is named. This is the whole point of the adapter read.
    expect(prose).toContain('amd gcn-5');
  });

  it('names the explicit rollback when the device never existed', () => {
    const r = gpuFailureReport(init);
    expect(r.title).toBe('WebGPU Unavailable');
    expect(r.lines.join(' ')).toContain('?gpu=webgl');
  });

  it('always offers the WebGL route out', () => {
    for (const f of [lost, init]) {
      expect(gpuFailureReport(f).webglAction).toContain('WebGL');
      expect(gpuFailureReport(f).retryAction.length).toBeGreaterThan(0);
    }
  });

  it('keeps the browser text in `detail`, not in the prose', () => {
    // The raw string is rarely a sentence; mixing it into the explanation is how
    // an error panel becomes unreadable.
    const r = gpuFailureReport(lost);
    expect(r.detail).toContain('DXGI_ERROR_DEVICE_RESET');
    expect(r.lines.join(' ')).not.toContain('DXGI_ERROR_DEVICE_RESET');
  });

  it('says so plainly when the browser reported no detail', () => {
    const r = gpuFailureReport({ phase: 'lost', reason: null, message: '', adapter: null });
    expect(r.detail).toBe('no further detail reported');
    // No adapter means no " on ..." clause, not the word "null".
    expect(r.lines.join(' ')).not.toContain('null');
  });

  it('puts the adapter and the way out in the console line a bug report gets pasted from', () => {
    const line = gpuFailureConsoleLine(lost);
    expect(line).toContain('amd gcn-5');
    expect(line).toContain('?gpu=webgl');
    expect(gpuFailureConsoleLine(init)).toContain('adapter not reported');
  });
});

describe('hrefForWebgl', () => {
  it('pins WebGL and changes nothing else', () => {
    /*
     * `?seed=`, `?map=` and `?mapseed=` decide what the page IS. A "get me back
     * to a working renderer" button that quietly rerolled the map would be the
     * same substitution this design refuses, one level down.
     */
    expect(hrefForWebgl('https://x.test/?gpu=webgpu&seed=7&map=coral-shore'))
      .toBe('https://x.test/?gpu=webgl&seed=7&map=coral-shore');
  });

  it('leaves no dangling ? when the flag was the only parameter', () => {
    expect(hrefForWebgl('https://x.test/game?gpu=webgpu')).toBe('https://x.test/game?gpu=webgl');
  });

  it('is identity when there is no flag, and never throws on junk', () => {
    expect(hrefForWebgl('https://x.test/?seed=7')).toBe('https://x.test/?seed=7&gpu=webgl');
    expect(hrefForWebgl('not a url at all')).toBe('not a url at all');
  });

  it('keeps the fragment and the path', () => {
    expect(hrefForWebgl('https://x.test/a/b?gpu=webgpu&t=1#frag'))
      .toBe('https://x.test/a/b?gpu=webgl&t=1#frag');
  });
});

/* ==========================================================================
 * 5. THE PANEL
 * ========================================================================== */

interface FakeEl {
  className: string;
  textContent: string | null;
  readonly style: { cssText: string };
  readonly attrs: Record<string, string>;
  readonly children: FakeEl[];
  readonly listeners: Record<string, Array<() => void>>;
  setAttribute(name: string, value: string): void;
  appendChild(node: unknown): void;
  addEventListener(type: string, listener: () => void): void;
}

function makeEl(): FakeEl {
  const el: FakeEl = {
    className: '',
    textContent: null,
    style: { cssText: '' },
    attrs: {},
    children: [],
    listeners: {},
    setAttribute(name, value) { el.attrs[name] = value; },
    appendChild(node) { el.children.push(node as FakeEl); },
    addEventListener(type, listener) { (el.listeners[type] ??= []).push(listener); },
  };
  return el;
}

/** Every element in the tree, so the fake `querySelector` can be honest. */
function flatten(root: FakeEl, out: FakeEl[] = []): FakeEl[] {
  out.push(root);
  for (const c of root.children) flatten(c, out);
  return out;
}

function makeHost(): { host: FailureHost; body: FakeEl } {
  const body = makeEl();
  const host: FailureHost = {
    body: {
      appendChild: (n) => body.appendChild(n),
      querySelector: (sel) => {
        const want = sel.replace(/^\./, '');
        return flatten(body).find((e) => e.className === want) ?? null;
      },
    },
    createElement: () => makeEl(),
  };
  return { host, body };
}

describe('showGpuFailure', () => {
  const failure: GpuFailure = {
    phase: 'lost', reason: 'unknown', message: 'DXGI_ERROR_DEVICE_RESET', adapter: ADAPTER,
  };

  it('puts the title, the prose and both buttons on screen', () => {
    const { host, body } = makeHost();
    const report = gpuFailureReport(failure);
    expect(showGpuFailure(report, host, { onWebgl: () => {}, onRetry: () => {} })).toBe(true);

    const texts = flatten(body).map((e) => e.textContent).filter((t): t is string => t !== null);
    expect(texts).toContain(report.title);
    for (const line of report.lines) expect(texts).toContain(line);
    expect(texts).toContain(report.webglAction);
    expect(texts).toContain(report.retryAction);
    expect(body.children[0].className).toBe(GPU_FAILURE_PANEL_CLASS);
  });

  it('wires each button to its own action', () => {
    const { host, body } = makeHost();
    const onWebgl = vi.fn();
    const onRetry = vi.fn();
    showGpuFailure(gpuFailureReport(failure), host, { onWebgl, onRetry });

    const buttons = flatten(body).filter((e) => e.listeners.click !== undefined);
    expect(buttons).toHaveLength(2);
    for (const b of buttons) for (const fn of b.listeners.click) fn();
    expect(onWebgl).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not stack a second panel — the first failure has the cause in it', () => {
    const { host, body } = makeHost();
    const report = gpuFailureReport(failure);
    expect(showGpuFailure(report, host, { onWebgl: () => {}, onRetry: () => {} })).toBe(true);
    expect(showGpuFailure(report, host, { onWebgl: () => {}, onRetry: () => {} })).toBe(false);
    expect(body.children).toHaveLength(1);
  });
});

/* ==========================================================================
 * 6. THE BOOT — prepareRenderer, end to end, with a stub device
 * ========================================================================== */

/** A fake canvas that `mintCanvas` can actually replace, with no DOM. */
interface FakeCanvas {
  id: string;
  className: string;
  readonly style: { cssText: string };
  width: number;
  height: number;
  readonly parentNode: null;
  readonly ownerDocument: { createElement(tag: string): FakeCanvas };
}

function makeCanvas(id = 'gl'): FakeCanvas {
  const doc = { createElement: (): FakeCanvas => makeCanvas('') };
  return {
    id, className: '', style: { cssText: '' }, width: 300, height: 150,
    parentNode: null, ownerDocument: doc,
  };
}

/** `HTMLCanvasElement` is what the signature says; the fake is what it needs. */
function asCanvas(c: FakeCanvas): HTMLCanvasElement {
  return c as unknown as HTMLCanvasElement;
}

/**
 * `prepareRenderer` reaches exactly one member of `NodePath` — `createRenderer`.
 * Standing up the other twenty factories would be twenty fakes nothing calls.
 */
function fakeNodePath(createRenderer: NodePath['createRenderer']): NodePath {
  return { createRenderer } as unknown as NodePath;
}

/** A node renderer whose device is a stub we can lose on demand. */
function fakeNodeRenderer(device: unknown): NodeRendererLike {
  return { backend: { isWebGPUBackend: true, device } } as unknown as NodeRendererLike;
}

describe('prepareRenderer under a failing or dying device', () => {
  let errors: string[];

  beforeEach(() => {
    resetGpuStateForTests();
    resetNodePathForTests();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetGpuStateForTests();
    resetNodePathForTests();
  });

  it('leaves the WebGL path completely alone', async () => {
    // Only the explicit rollback skips the product WebGPU path.
    installNodePath(fakeNodePath(() => { throw new Error('must not be called'); }));
    await expect(prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgl')).resolves.toBe('webgl');
    await expect(prepareRenderer(asCanvas(makeCanvas()), '?seed=7&gpu=webgl')).resolves.toBe('webgl');
    expect(errors).toEqual([]);
  });

  it('THROWS GpuUnavailableError instead of letting the rejection kill the page', async () => {
    /*
     * This is the reported crash. Nothing wrapped `await path.createRenderer`,
     * so `requestAdapter()` returning null on a recovering driver became an
     * unhandled rejection — and, with three's fallback armed, not even the
     * honest one.
     */
    installNodePath(fakeNodePath(async () => {
      throw new Error('THREE.WebGPUBackend: Unable to create WebGPU adapter.');
    }));
    const canvas = makeCanvas();
    await expect(prepareRenderer(asCanvas(canvas), '?gpu=webgpu')).rejects.toBeInstanceOf(
      GpuUnavailableError,
    );
  });

  it('carries the real cause, not a downstream TypeError', async () => {
    installNodePath(fakeNodePath(async () => {
      throw new Error('THREE.WebGPUBackend: Unable to create WebGPU adapter.');
    }));
    let caught: GpuUnavailableError | null = null;
    try {
      await prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu');
    } catch (e) {
      caught = e as GpuUnavailableError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.failure.phase).toBe('init');
    expect(caught!.failure.message).toContain('Unable to create WebGPU adapter');
    // And it told somebody, in words, on the way out.
    expect(errors.join('\n')).toContain('WebGPU device unavailable');
  });

  it('QUARANTINES the canvas — a retry never gets the poisoned one back', async () => {
    /*
     * THE HEART OF THE FIX. `getContext('webgpu')` is irreversible: an element
     * that has held one can never open `webgl2`, which is why three's fallback
     * dereferences null. So whatever runs next must be handed a different
     * element, and this asserts that end to end rather than on the bookkeeping
     * class alone.
     */
    const canvas = makeCanvas();
    installNodePath(fakeNodePath(async () => {
      throw new Error('THREE.WebGPUBackend: Unable to create WebGPU adapter.');
    }));
    await expect(prepareRenderer(asCanvas(canvas), '?gpu=webgpu')).rejects.toBeInstanceOf(
      GpuUnavailableError,
    );

    // Re-arm with a device that works and ask again with the SAME reference a
    // caller would still be holding.
    resetGpuStateForTests();
    resetNodePathForTests();
    const seen: HTMLCanvasElement[] = [];
    installNodePath(fakeNodePath(async (c) => {
      seen.push(c);
      return fakeNodeRenderer({ lost: new Promise(() => {}), adapterInfo: ADAPTER });
    }));
    await expect(prepareRenderer(asCanvas(canvas), '?gpu=webgpu')).resolves.toBe('webgpu');

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(asCanvas(canvas));
    // The replacement inherited the identity that finds it again.
    expect((seen[0] as unknown as FakeCanvas).id).toBe('gl');
    expect(canvas.id).toBe('');
  });

  it('publishes the adapter the device actually came from', async () => {
    installNodePath(fakeNodePath(async () =>
      fakeNodeRenderer({ lost: new Promise(() => {}), adapterInfo: ADAPTER }),
    ));
    await prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu');
    const report = gpuReport('webgpu');
    expect(report.adapter).toEqual(ADAPTER);
    expect(report.gpu).toBe('amd gcn-5');
    expect(report.requested).toBe('webgpu'); // product default; no `location` in the node pool
    expect(report.deviceLost).toBeNull();
  });

  it('records the loss when the device dies, and says which GPU it was on', async () => {
    let die!: (info: { reason: string; message: string }) => void;
    const lost = new Promise<{ reason: string; message: string }>((r) => { die = r; });
    installNodePath(fakeNodePath(async () => fakeNodeRenderer({ lost, adapterInfo: ADAPTER })));
    await prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu');
    expect(gpuReport().deviceLost).toBeNull();

    die({ reason: 'unknown', message: 'Device was lost: DXGI_ERROR_DEVICE_RESET' });
    await lost;
    await Promise.resolve();

    const failure = gpuReport().deviceLost;
    expect(failure).not.toBeNull();
    expect(failure!.phase).toBe('lost');
    expect(failure!.reason).toBe('unknown');
    expect(failure!.adapter).toEqual(ADAPTER);
    expect(errors.join('\n')).toContain('amd gcn-5');
  });

  it('does NOT quietly hand out a second device after a loss', async () => {
    /*
     * `Shell` re-enters `prepareRenderer` on every match. Without this the
     * second match after a loss would request a fresh device and carry on
     * behind the panel the player is still reading.
     */
    let die!: (info: { reason: string }) => void;
    const lost = new Promise<{ reason: string }>((r) => { die = r; });
    installNodePath(fakeNodePath(async () => fakeNodeRenderer({ lost, adapterInfo: ADAPTER })));
    await prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu');
    die({ reason: 'unknown' });
    await lost;
    await Promise.resolve();

    await expect(prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu')).rejects.toBeInstanceOf(
      GpuUnavailableError,
    );
  });

  it('treats a deliberate device.destroy() as teardown, not a failure', async () => {
    const lost = Promise.resolve({ reason: 'destroyed', message: '' });
    installNodePath(fakeNodePath(async () => fakeNodeRenderer({ lost, adapterInfo: ADAPTER })));
    await prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu');
    await lost;
    await Promise.resolve();
    expect(gpuReport().deviceLost).toBeNull();
  });

  it('survives a device that publishes neither adapterInfo nor lost', async () => {
    installNodePath(fakeNodePath(async () => fakeNodeRenderer({})));
    await expect(prepareRenderer(asCanvas(makeCanvas()), '?gpu=webgpu')).resolves.toBe('webgpu');
    expect(gpuReport().adapter).toBeNull();
  });
});

/* ==========================================================================
 * 7. THREE'S OWN FALLBACK IS DISABLED, AND IT IS DISABLED BEFORE init()
 * ========================================================================== */

describe("three's WebGL fallback is removed before init() can fire it", () => {
  /*
   * A SOURCE ASSERTION, DELIBERATELY. `gpu-path-install.ts` is the one module
   * that may import `three/webgpu` (see `tests/webgpu-bundle-isolation.spec.ts`)
   * and importing it here to inspect a private field would drag 776 kB of node
   * system into the node pool to check a one-line write. The ORDER is the whole
   * property: nulling `_getFallback` after `await renderer.init()` would compile,
   * pass a smoke test, and leave the crash exactly where it was.
   */
  const SRC = readFileSync(
    join(__dirname, '..', 'src', 'render', 'gpu-path-install.ts'), 'utf8',
  );

  it('nulls three\'s fallback factory', () => {
    expect(SRC).toContain("const THREE_FALLBACK_FIELD = '_getFallback'");
    expect(SRC).toMatch(/\[THREE_FALLBACK_FIELD\]\s*=\s*null/);
  });

  it('does it BEFORE the await on init(), where it still matters', () => {
    const disable = SRC.indexOf('disableThreeFallback(renderer);');
    const init = SRC.indexOf('await renderer.init();');
    // Non-vacuity first: a regex that matched nothing would make any ordering
    // assertion below trivially true. That is one of the six ways this
    // migration has already shipped a green test over a broken change.
    expect(disable).toBeGreaterThanOrEqual(0);
    expect(init).toBeGreaterThanOrEqual(0);
    expect(disable).toBeLessThan(init);
  });

  it('guards the write, so a three upgrade that renames the field is visible', () => {
    // Writing a private that no longer exists would invent a field on three's
    // renderer and leave the real fallback armed, silently.
    expect(SRC).toMatch(/if \(!\(THREE_FALLBACK_FIELD in renderer\)\)/);
  });
});

/* ==========================================================================
 * WHAT ONLY A REAL DEVICE LOSS CAN CONFIRM
 * ==========================================================================
 * Every fake above reproduces a SIGNAL exactly — a rejected `init()`, a resolved
 * `device.lost`, an `adapterInfo` with fields on the prototype — and that is the
 * whole of what this module reacts to. What no fake here reproduces:
 *
 *   - that a real Chrome, on a real driver reset, resolves `device.lost` at all
 *     rather than only killing the GPU process;
 *   - that `getContext('webgl2')` really does return null on the element the
 *     quarantine is protecting against (it is specified, and it is what produced
 *     the reported stack, but it is not exercised here);
 *   - that the panel is legible, or that its buttons reload as intended;
 *   - that a browser's `GPUDevice` exposes `adapterInfo` on the configuration
 *     the reporter is running.
 *
 * The host machine for this work has crashed its GPU driver twice on this path,
 * so those four were deliberately not attempted. Do not quote this suite as
 * evidence that recovery has been observed on hardware.
 * ========================================================================== */
