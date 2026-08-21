/**
 * ============================================================================
 * tests/perf-hud-backend.spec.ts — THE PERFORMANCE OVERLAY, ON TWO RENDERERS
 * ============================================================================
 * `tests/perf-hud.spec.ts` owns the verdict, the ring, the allocation count and
 * the layout arithmetic. This file owns exactly one question, which that file
 * predates:
 *
 *   **WHEN THE LIVE BACKEND CANNOT MEASURE A ROW, DOES THE ROW SAY SO — OR DOES
 *   IT PRINT A ZERO?**
 *
 * A zero is a claim. `0 col / 130` reads as a colour pass that drew nothing,
 * which on the node path is not merely wrong but the most alarming reading
 * available; `n/a col / 130` reads as what is actually true, which is that this
 * renderer has no seam between its shadow pass and its colour pass to meter.
 * `src/render/debug.ts` reached that conclusion first — it prints
 * `${total} (no per-pass split)` — and §2 below pins that this file has not
 * quietly grown a SECOND answer to the same question, because two answers is
 * how a faked split gets believed.
 *
 * The second half is the regression that came with it, and it is a WEBGL bug
 * that predates WebGPU entirely: the draws row compared `renderer.info.render
 * .calls` — a sum over every scene submission, 105-157 across the capture
 * fixtures — against `DRAW_BUDGET`, which bounds the colour pass alone, 51-77.
 * The row was permanently red about a budget that was half empty. §4 pins that
 * a real WebGL frame no longer trips it and a real overrun still does.
 *
 * THE DOM IS A STUB, for the reason `tests/perf-hud.spec.ts` gives at length:
 * the suite is `environment: 'node'`, jsdom is not installed, and neither
 * `vite.config.ts` nor `package.json` belongs to this workflow. The stub here
 * is deliberately smaller than that file's — it needs to build the panel and
 * read text back out of it, and nothing else.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* ==========================================================================
 * THE DOM STUB — installed before any import that touches `document`
 * ========================================================================== */

/** Writes to `nodeValue`, so "no DOM work between updates" stays measurable. */
let textWrites = 0;

class StubStyle {
  pointerEvents = '';
  display = '';
}

class StubClassList {
  private readonly names = new Set<string>();
  add(...list: string[]): void { for (const n of list) if (n !== '') this.names.add(n); }
  remove(...list: string[]): void { for (const n of list) this.names.delete(n); }
  contains(name: string): boolean { return this.names.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const want = force === undefined ? !this.names.has(name) : force;
    if (want) this.names.add(name); else this.names.delete(name);
    return want;
  }
  get value(): string { return [...this.names].join(' '); }
  set value(v: string) {
    this.names.clear();
    for (const n of v.split(/\s+/)) if (n !== '') this.names.add(n);
  }
}

class StubText {
  parentNode: StubElement | null = null;
  private text: string;
  constructor(initial: string) { this.text = initial; }
  get nodeValue(): string { return this.text; }
  set nodeValue(v: string) { textWrites++; this.text = v; }
  get textContent(): string { return this.text; }
}

type StubNode = StubElement | StubText;

class StubElement {
  readonly childNodes: StubNode[] = [];
  parentNode: StubElement | null = null;
  readonly style = new StubStyle();
  readonly classList = new StubClassList();
  hidden = false;
  id = '';

  private textValue = '';
  private readonly attrs = new Map<string, string>();

  constructor(readonly tagName: string) {}

  get className(): string { return this.classList.value; }
  set className(v: string) { this.classList.value = v; }

  get parentElement(): StubElement | null { return this.parentNode; }

  get children(): StubElement[] {
    return this.childNodes.filter((n): n is StubElement => n instanceof StubElement);
  }

  get textContent(): string {
    if (this.childNodes.length === 0) return this.textValue;
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.childNodes.length = 0;
    this.textValue = v;
  }

  appendChild<T extends StubNode>(child: T): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: StubNode): StubNode {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove(): void { this.parentNode?.removeChild(this); }

  setAttribute(name: string, value: string): void {
    if (name === 'class') { this.classList.value = value; return; }
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.classList.value;
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    if (name === 'class') return this.classList.value !== '';
    return this.attrs.has(name);
  }

  querySelectorAll(selector: string): StubElement[] {
    const want = selector.replace(/^\./, '');
    const out: StubElement[] = [];
    const walk = (n: StubElement): void => {
      if (n.classList.contains(want)) out.push(n);
      for (const c of n.children) walk(c);
    };
    walk(this);
    return out;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement: (tag: string): StubElement => new StubElement(tag.toUpperCase()),
  createElementNS: (_ns: string, tag: string): StubElement => new StubElement(tag.toUpperCase()),
  createTextNode: (text: string): StubText => new StubText(text),
  getElementById: (): StubElement | null => null,
  querySelector: (): StubElement | null => null,
};

/* -- imports AFTER the stub; nothing below touches `document` at module scope */

import {
  DRAW_BUDGET,
  PERF_ROW_COUNT,
  PerfHud,
  UNAVAILABLE,
  WebGpuTimer,
  drawsOverBudget,
  emptyReadout,
  formatBackend,
  formatDraws,
  formatGpuTime,
  shortDevice,
  type PerfReadout,
  type PerfSource,
} from '../src/ui/PerfHud';

import { colourDrawsOf } from '../src/ui/perf.system';

/* ==========================================================================
 * HELPERS
 * ========================================================================== */

const VSYNC_60 = 1000 / 60;

/**
 * The measured shapes, kept as named constants because both of them are FACTS
 * about this project rather than plausible numbers:
 *
 *   WEBGL_FRAME  `01-establishing-base` after `installAoDepthGBuffer` —
 *                53 shadow + 77 colour + 0 ao + 21 quads = 151. The total is
 *                over the 130 budget; the colour pass is comfortably under it.
 *   NODE_FRAME   what `src/render/post.ts` returns on the node path: zeros with
 *                a true total, deliberately, so that a consumer reading the
 *                buckets raw gets an impossible answer rather than a plausible
 *                wrong one.
 */
const WEBGL_FRAME = { shadow: 53, colour: 77, ao: 0, post: 21, total: 151 };
const NODE_FRAME = { shadow: 0, colour: 0, ao: 0, post: 0, total: 151 };

class FakeSource implements PerfSource {
  readCalls = 0;
  values: PerfReadout = { ...emptyReadout() };

  cpuMs(): number { return 4.2; }

  read(out: PerfReadout): void {
    this.readCalls++;
    Object.assign(out, this.values);
  }
}

function makeHud(values: Partial<PerfReadout>): {
  hud: PerfHud;
  source: FakeSource;
  root: StubElement;
  step: (frames: number, msPerFrame?: number) => void;
} {
  const mount = new StubElement('DIV');
  const source = new FakeSource();
  Object.assign(source.values, values);
  // A Float64Array rather than a captured `let`, for the reason
  // tests/perf-hud.spec.ts documents: a closure-captured double boxes a fresh
  // HeapNumber on every `+=`, which is the harness allocating.
  const clock = new Float64Array(1);
  const hud = new PerfHud({
    mount: mount as unknown as HTMLElement,
    source,
    now: () => clock[0],
    visible: true,
  });
  return {
    hud,
    source,
    root: hud.root as unknown as StubElement,
    step: (frames, msPerFrame = VSYNC_60) => {
      for (let i = 0; i < frames; i++) {
        clock[0] += msPerFrame;
        hud.frame(msPerFrame / 1000);
      }
    },
  };
}

/** The value text of every row, keyed by the row's label. */
function rowsOf(root: StubElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of root.querySelectorAll('.vm-perf-row')) {
    const key = row.querySelectorAll('.vm-perf-k')[0]?.textContent ?? '';
    const value = row.querySelectorAll('.vm-perf-v')[0]?.textContent ?? '';
    out.set(key, value);
  }
  return out;
}

function badgeOf(root: StubElement): string {
  return root.querySelectorAll('.vm-perf-backend')[0]?.textContent ?? '';
}

/* ==========================================================================
 * 1. THE DRAWS ROW — a slot that cannot be measured holds `n/a`, not `0`
 * ========================================================================== */

describe('formatDraws', () => {
  it('puts n/a exactly where the colour count would go', () => {
    expect(formatDraws(151, null)).toBe(`${UNAVAILABLE} col / ${DRAW_BUDGET} · 151 all`);
    expect(formatDraws(151, 77)).toBe(`77 col / ${DRAW_BUDGET} · 151 all`);
  });

  it('never renders the unavailable case as a zero', () => {
    const text = formatDraws(NODE_FRAME.total, null);
    // The literal failure this whole file exists to stop.
    expect(text).not.toMatch(/\b0 col\b/);
    expect(text).toContain(UNAVAILABLE);
    // And the true total is still there — it is the content fingerprint, and
    // losing it would trade one missing number for another.
    expect(text).toContain('151');
  });

  it('keeps the total and the budget figure visibly separate', () => {
    // Two numbers, two meanings. A row that showed only one of them is how the
    // budget came to be compared against the wrong quantity for three releases.
    const text = formatDraws(WEBGL_FRAME.total, WEBGL_FRAME.colour);
    expect(text).toContain('77 col');
    expect(text).toContain('151 all');
  });
});

describe('drawsOverBudget', () => {
  it('is false for the real WebGL frame whose TOTAL is over budget', () => {
    // 151 > 130 and 77 < 130. The old row compared the first pair.
    expect(WEBGL_FRAME.total).toBeGreaterThan(DRAW_BUDGET);
    expect(drawsOverBudget(WEBGL_FRAME.colour)).toBe(false);
  });

  it('still fires on a real colour-pass overrun', () => {
    expect(drawsOverBudget(DRAW_BUDGET + 1)).toBe(true);
    expect(drawsOverBudget(DRAW_BUDGET)).toBe(false);
  });

  it('claims nothing when the split is unavailable', () => {
    // Neither verdict is available: a breach claimed off the total would fire
    // on every frame, and compliance would assert something nothing measured.
    expect(drawsOverBudget(null)).toBe(false);
  });
});

/* ==========================================================================
 * 2. THE SPLIT-AVAILABILITY TEST IS THE F3 OVERLAY'S, NOT A SECOND ONE
 * ========================================================================== */

describe('colourDrawsOf', () => {
  it('reads the node path as unavailable rather than as zero', () => {
    expect(colourDrawsOf(NODE_FRAME)).toBeNull();
  });

  it('reads a metered WebGL frame as its colour pass', () => {
    expect(colourDrawsOf(WEBGL_FRAME)).toBe(WEBGL_FRAME.colour);
  });

  it('reads a WebGL boot with no post chain as unavailable', () => {
    // `debug.ts#readDrawCallsByPass` returns zeros with a true total when there
    // is no chain to install the meters in. Same shape, same answer.
    expect(colourDrawsOf({ shadow: 0, colour: 0, total: 207 })).toBeNull();
  });

  it('reads a frame that genuinely drew nothing as zero', () => {
    // Nothing was submitted at all, so `0` is the measurement rather than the
    // absence of one. The total is what distinguishes the two cases.
    expect(colourDrawsOf({ shadow: 0, colour: 0, total: 0 })).toBe(0);
  });

  it('is still the condition src/render/debug.ts makes', () => {
    // ANTI-DRIFT. The duplication is deliberate — `perf.system.ts` says so —
    // but a duplicate nobody compares is just a second answer waiting to
    // disagree. If the F3 overlay changes how it decides the split is
    // unavailable, this fails and the two get reconciled deliberately.
    const debug = readFileSync('src/render/debug.ts', 'utf8');
    expect(debug).toContain('byPass.total > 0 && byPass.colour === 0 && byPass.shadow === 0');
  });
});

/* ==========================================================================
 * 3. THE GPU-TIME ROW — the same absence, two different reasons
 * ========================================================================== */

describe('formatGpuTime', () => {
  it('names the backend when the backend is the reason', () => {
    const text = formatGpuTime('absent', null, 'webgpu');
    expect(text).toContain(UNAVAILABLE);
    expect(text).toContain('timestamp-query');
  });

  it('names the missing extension when the browser is the reason', () => {
    expect(formatGpuTime('absent', null, 'webgl')).toBe(`${UNAVAILABLE} · no timer ext`);
    // Pre-boot: the backend is not known yet, so only the extension is claimed.
    expect(formatGpuTime('absent', null, null)).toBe(`${UNAVAILABLE} · no timer ext`);
  });

  it('never prints a measurement for an absent timer, on any backend', () => {
    for (const backend of ['webgl', 'webgpu', 'webgl2-fallback', null] as const) {
      const text = formatGpuTime('absent', null, backend);
      expect(text).toContain(UNAVAILABLE);
      // Not a millisecond figure — in particular not the `0.0 ms` that a `?? 0`
      // somewhere upstream would produce — and not a bare zero.
      expect(text).not.toMatch(/\d+(\.\d+)?\s*ms/);
      expect(text).not.toMatch(/\b0\b/);
    }
  });

  it('prints a measurement when there is one', () => {
    expect(formatGpuTime('ok', 12.34, 'webgl')).toBe('12.3 ms');
  });

  it('keeps the two transient WebGL states distinguishable', () => {
    // `disjoint` is `GPU_DISJOINT_EXT` — the window was thrown away — and
    // `waiting` is a live extension with nothing resolved yet. Reporting either
    // as `n/a` would hide a GPU that keeps being preempted.
    expect(formatGpuTime('disjoint', null, 'webgl')).toBe('disjoint');
    expect(formatGpuTime('waiting', null, 'webgl')).toBe('waiting');
  });
});

describe('WebGpuTimer', () => {
  it('enables timestamp writes only while sampling and resolves real GPU milliseconds', async () => {
    let resolves = 0;
    const renderer = {
      info: { render: { timestamp: 0 } },
      backend: { trackTimestamp: true },
      resolveTimestampsAsync: async () => { resolves++; return 7.25; },
    };
    const timer = new WebGpuTimer(renderer);
    expect(timer.available).toBe(true);
    expect(renderer.backend.trackTimestamp).toBe(false);
    timer.setActive(true);
    expect(renderer.backend.trackTimestamp).toBe(true);
    for (let i = 0; i < 15; i++) timer.tick();
    await Promise.resolve();
    expect(resolves).toBe(1);
    expect(timer.status).toBe('ok');
    expect(timer.gpuMs).toBe(7.25);
    timer.setActive(false);
    expect(renderer.backend.trackTimestamp).toBe(false);
  });

  it('stays absent when the adapter did not expose timestamp-query', () => {
    const renderer = {
      info: { render: { timestamp: 0 } },
      backend: { trackTimestamp: false },
      resolveTimestampsAsync: async () => 0,
    };
    const timer = new WebGpuTimer(renderer);
    timer.setActive(true);
    expect(timer.available).toBe(false);
    expect(timer.status).toBe('absent');
    expect(renderer.backend.trackTimestamp).toBe(false);
  });
});

/* ==========================================================================
 * 4. NAMING THE RENDERER AND THE GPU
 * ========================================================================== */

describe('formatBackend', () => {
  it('keeps webgl2-fallback legible as its own thing', () => {
    // A third renderer — node materials over WebGL2 — and the slowest of the
    // three. `assertBackend` should refuse it at boot, which is exactly why it
    // must be readable if it ever reaches the panel.
    expect(formatBackend('webgl2-fallback')).toBe('WEBGL2 FALLBACK');
    expect(formatBackend('webgl')).toBe('WEBGL');
    expect(formatBackend('webgpu')).toBe('WEBGPU');
  });

  it('says nothing before a backend has been read', () => {
    expect(formatBackend(null)).toBe('—');
  });
});

describe('shortDevice', () => {
  it('reduces an ANGLE string to the chip', () => {
    expect(
      shortDevice('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    ).toBe('NVIDIA GeForce RTX 3080 Laptop GPU');
  });

  it('passes a WebGPU adapter line through untouched', () => {
    const line = 'NVIDIA GeForce RTX 3080 Laptop GPU (nvidia ampere)';
    expect(shortDevice(line)).toBe(line);
  });

  it('never returns an empty row', () => {
    expect(shortDevice('')).toBe('—');
    expect(shortDevice('   ')).toBe('—');
    // A shape it does not recognise survives intact rather than being emptied.
    expect(shortDevice('SwiftShader Device')).toBe('SwiftShader Device');
  });
});

/* ==========================================================================
 * 5. THE PANEL, END TO END, ON EACH BACKEND
 * ========================================================================== */

describe('the panel on the node path', () => {
  it('renders every unmeasurable row as unavailable rather than as zero', () => {
    const { root, step } = makeHud({
      backend: 'webgpu',
      drawCalls: NODE_FRAME.total,
      drawCallsColour: null,
      device: 'NVIDIA GeForce RTX 3080 Laptop GPU (nvidia ampere)',
      triangles: 900_000,
      tier: 'high',
      entities: 284,
    });
    step(60);

    const rows = rowsOf(root);

    const draws = rows.get('draws') ?? '';
    expect(draws).toContain(UNAVAILABLE);
    expect(draws).not.toMatch(/\b0 col\b/);
    expect(draws).toContain('151');

    const gpu = rows.get('gpu') ?? '';
    expect(gpu).toContain(UNAVAILABLE);
    expect(gpu).toContain('timestamp-query');

    // The rows that ARE measurable on both renderers keep their numbers. An
    // alignment that blanked them would be its own kind of lie.
    expect(rows.get('tris')).toBe('900 k');
    expect(rows.get('tier')).toBe('high · 284 ents');
    expect(rows.get('device')).toBe('NVIDIA GeForce RTX 3080 Laptop GPU (nvidia ampere)');
  });

  it('cannot claim a budget breach it did not measure, and does not claim a pass', () => {
    const { root, step } = makeHud({
      backend: 'webgpu',
      drawCalls: NODE_FRAME.total,
      drawCallsColour: null,
    });
    step(60);
    expect(root.classList.contains('is-draws-over')).toBe(false);
    expect(root.classList.contains('is-draws-unknown')).toBe(true);
  });

  it('names the live renderer on the header', () => {
    const { root, step } = makeHud({ backend: 'webgpu' });
    step(60);
    expect(badgeOf(root)).toBe('WEBGPU');
  });
});

describe('the panel on the WebGL path', () => {
  it('no longer reports the frame total as a colour-pass overrun', () => {
    // THE REGRESSION. Before this, `drawCalls` 151 against a budget of 130 put
    // the row permanently in red on a frame whose colour pass was 77.
    const { root, step } = makeHud({
      backend: 'webgl',
      drawCalls: WEBGL_FRAME.total,
      drawCallsColour: WEBGL_FRAME.colour,
    });
    step(60);
    expect(rowsOf(root).get('draws')).toBe(`77 col / ${DRAW_BUDGET} · 151 all`);
    expect(root.classList.contains('is-draws-over')).toBe(false);
    expect(root.classList.contains('is-draws-unknown')).toBe(false);
  });

  it('still goes red on a real colour-pass overrun', () => {
    const { root, step } = makeHud({
      backend: 'webgl',
      drawCalls: 260,
      drawCallsColour: DRAW_BUDGET + 12,
    });
    step(60);
    expect(root.classList.contains('is-draws-over')).toBe(true);
    expect(root.classList.contains('is-draws-unknown')).toBe(false);
  });

  it('names the live renderer and the chip', () => {
    const { root, step } = makeHud({
      backend: 'webgl',
      device: shortDevice('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    });
    step(60);
    expect(badgeOf(root)).toBe('WEBGL');
    expect(rowsOf(root).get('device')).toBe('NVIDIA GeForce RTX 3080 Laptop GPU');
  });
});

/* ==========================================================================
 * 6. NONE OF IT REACHED THE HOT PATH
 *
 * `tests/perf-hud.spec.ts` owns the GC-count proof that `frame()` allocates
 * exactly zero. This is the cheap structural companion: everything added here
 * — the backend read, the split test, the device string — must live behind the
 * 4 Hz gate, so a frame inside the update window must still do nothing at all.
 * ========================================================================== */

describe('the sample path is unchanged', () => {
  it('reads nothing and writes nothing between the 4 Hz updates', () => {
    const { source, step } = makeHud({ backend: 'webgpu', drawCallsColour: null });
    textWrites = 0;
    // ~250 ms is the update interval; fourteen frames at 60 fps is 233 ms.
    step(14);
    expect(source.readCalls).toBe(0);
    expect(textWrites).toBe(0);

    // Crossing it does the work, in one place.
    step(1, 300);
    expect(source.readCalls).toBe(1);
    expect(textWrites).toBeGreaterThan(0);
  });

  it('builds every row once, up front', () => {
    const { root } = makeHud({});
    expect(root.querySelectorAll('.vm-perf-row').length).toBe(PERF_ROW_COUNT);
    expect(root.querySelectorAll('.vm-perf-backend').length).toBe(1);
  });
});

/* ==========================================================================
 * 7. THE CLASS THE PANEL SETS IS A CLASS THE STYLESHEET STYLES
 * ========================================================================== */

describe('perf.css', () => {
  const css = readFileSync('src/ui/perf.css', 'utf8');

  it('styles the unknown-budget state as its own thing', () => {
    // A dangling class is a state that renders identically to the state it was
    // added to distinguish itself from.
    expect(css).toContain('.vm-perf.is-draws-unknown');
    expect(css).toContain('.vm-perf-backend');
  });

  it('gives the value cell somewhere to put an ellipsis', () => {
    // `min-width: 0` is the whole mechanism: without it a flex item refuses to
    // shrink below its content and the device row overflows the panel instead
    // of being cut.
    const block = /\.vm-perf-v \{[\s\S]*?\}/.exec(css);
    expect(block).not.toBeNull();
    expect((block as RegExpExecArray)[0]).toContain('min-width: 0');
    expect((block as RegExpExecArray)[0]).toContain('text-overflow: ellipsis');
  });
});
