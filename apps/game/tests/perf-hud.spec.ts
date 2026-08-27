/**
 * ============================================================================
 * tests/perf-hud.spec.ts — THE PERFORMANCE OVERLAY
 * ============================================================================
 * The feature has one failure mode that matters more than all the others put
 * together, and it is the reason the file exists: a readout that certifies a
 * saturated machine as healthy because vsync pinned its frame time at 16.6 ms.
 * Two real captures from this project's own machine are pinned as fixtures —
 *
 *   baseline    med 16.6 ms  min  3.1  p95 322.7  60 fps  draws 194  SATURATED
 *   scale 1.00  med 77.9 ms  min 15.5  p95 132.6  13 fps  draws 203  GPU-BOUND
 *
 * — and the first one must never come back "fine".
 *
 * WHAT IS ASSERTED, AND HOW
 * -------------------------
 *   percentiles      against a hand-computable sample, including the wrap
 *   cadence detection 60 / 120 Hz pinned, and free-running correctly refused
 *   the verdict      every branch, with `claimsHeadroom` pinned to false for
 *                    EVERY pinned case that has no GPU timer — including the
 *                    perfectly clean one, which is the case a naive counter
 *                    would have called green
 *   allocation       a GC-count comparison between an ambient loop, one million
 *                    real `frame()` calls, and a control loop that deliberately
 *                    allocates. The control is there to prove the method can
 *                    see an allocation at all; without it the test would pass
 *                    on a blind measurement
 *   DOM work         zero nodes created and zero text writes between the 4 Hz
 *                    updates, counted by the stub
 *   pointer capture  the layer is walked, not reviewed
 *   layout           the CSS height literal against the TypeScript arithmetic
 *   the setting      defaults off, survives junk, round-trips through the store
 *
 * THE DOM IS A STUB, FOR THE REASONS tests/objectives-ux.spec.ts GIVES
 * -------------------------------------------------------------------
 * The suite is `environment: 'node'` and jsdom is not installed; changing
 * either means editing `vite.config.ts` or `package.json`, neither of which
 * this workflow owns. The surface `src/ui/Chrome.ts` and `PerfHud.ts` actually
 * use is small — element tree, classes, style, hidden, attributes and text
 * nodes — so it is implemented here honestly, with counters on the two
 * operations the allocation and DOM-work claims depend on.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { PerformanceObserver, constants, performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, it } from 'vitest';

/* ==========================================================================
 * THE DOM STUB — installed before any import that touches `document`
 * ========================================================================== */

const counts = { created: 0, textNodes: 0, textWrites: 0 };

class StubStyle {
  pointerEvents = '';
  display = '';
  private readonly props = new Map<string, string>();
  setProperty(name: string, value: string): void { this.props.set(name, value); }
  getPropertyValue(name: string): string { return this.props.get(name) ?? ''; }
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

/** A text node. `nodeValue` is counted, because "no DOM work per frame" is a claim. */
class StubText {
  parentNode: StubElement | null = null;
  private text: string;
  constructor(initial: string) {
    this.text = initial;
    counts.textNodes++;
  }
  get nodeValue(): string { return this.text; }
  set nodeValue(v: string) {
    counts.textWrites++;
    this.text = v;
  }
  get textContent(): string { return this.text; }
}

type StubNode = StubElement | StubText;

class StubElement {
  readonly childNodes: StubNode[] = [];
  parentNode: StubElement | null = null;
  readonly style = new StubStyle();
  readonly dataset: Record<string, string> = {};
  readonly classList = new StubClassList();
  hidden = false;
  id = '';

  private textValue = '';
  private readonly attrs = new Map<string, string>();

  constructor(readonly tagName: string) {
    counts.created++;
  }

  get className(): string { return this.classList.value; }
  set className(v: string) { this.classList.value = v; }

  get parentElement(): StubElement | null { return this.parentNode; }

  /** Elements only — `perfLayerFaults` walks this and text nodes are not elements. */
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

const stubDocument = {
  createElement: (tag: string): StubElement => new StubElement(tag.toUpperCase()),
  createElementNS: (_ns: string, tag: string): StubElement => new StubElement(tag.toUpperCase()),
  createTextNode: (text: string): StubText => new StubText(text),
  getElementById: (): StubElement | null => null,
  querySelector: (): StubElement | null => null,
};

const g = globalThis as unknown as Record<string, unknown>;
g.document = stubDocument;

/* -- imports AFTER the stub. Safe under ESM hoisting because nothing below --
 * touches `document` at module scope: PerfHud builds its DOM inside the
 * constructor, exactly as the architecture requires of `init()`.            */

import {
  CADENCE_TOLERANCE,
  DRAW_BUDGET,
  FrameRing,
  HISTORY_FRAMES,
  MIN_SAMPLES,
  PERF_ROW_COUNT,
  PERF_WIDTH_UNITS,
  PerfHud,
  TRIANGLE_ADVISORY,
  UPDATE_HZ,
  classifyLoad,
  detectCadenceMs,
  emptyReadout,
  formatCount,
  formatSmallMs,
  perfFrameShareOf,
  perfLayerFaults,
  perfPanelHeightUnits,
  type LoadSample,
  type PerfReadout,
  type PerfSource,
} from '../src/ui/PerfHud';

import { chordMatches, readPerfSetting } from '../src/ui/perf.system';

import {
  SettingsStore,
  defaultSettings,
  diffSettings,
  normalizeSettings,
} from '../src/shell/settings-store';

/* ==========================================================================
 * HELPERS
 * ========================================================================== */

const VSYNC_60 = 1000 / 60;

function ringOf(values: readonly number[], capacity = values.length): FrameRing {
  const ring = new FrameRing(capacity);
  for (const v of values) ring.push(v);
  ring.snapshot();
  return ring;
}

function repeat(value: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(value);
  return out;
}

/** A pinned window with `spikes` frames of `spikeMs` in it. */
function pinnedWindow(spikes: number, spikeMs: number, n = HISTORY_FRAMES): number[] {
  const out = repeat(VSYNC_60, n - spikes);
  for (let i = 0; i < spikes; i++) out.push(spikeMs);
  return out;
}

function sampleOf(patch: Partial<LoadSample>): LoadSample {
  return {
    samples: HISTORY_FRAMES,
    frameMedianMs: VSYNC_60,
    frameP95Ms: VSYNC_60,
    cpuMedianMs: 4,
    gpuMs: null,
    cadenceMs: VSYNC_60,
    bestCadenceMs: VSYNC_60,
    missRatio: 0,
    ...patch,
  };
}

class FakeSource implements PerfSource {
  cpuCalls = 0;
  readCalls = 0;
  cpu = 4.2;
  values: PerfReadout = {
    ...emptyReadout(),
    drawCalls: 194,
    triangles: 1_750_000,
    entities: 284,
    simMs: 1.1,
    substeps: 2,
    tier: 'high',
    resolution: '2560x1440',
    pixelRatio: 1,
  };

  cpuMs(): number {
    this.cpuCalls++;
    return this.cpu;
  }

  read(out: PerfReadout): void {
    this.readCalls++;
    Object.assign(out, this.values);
  }
}

/** A panel plus the clock that drives it. */
function makeHud(options: { visible?: boolean } = {}): {
  hud: PerfHud;
  mount: StubElement;
  source: FakeSource;
  step: (frames: number, msPerFrame: number) => void;
  /** Advance without letting the 4 Hz text update fire. */
  sampleOnly: (frames: number) => void;
} {
  const mount = new StubElement('DIV');
  const source = new FakeSource();
  // NOT a captured `let`. A closure-captured double lives in a V8 context
  // slot, which is a plain tagged slot with no in-place mutation, so
  // `clock += VSYNC_60` boxes a fresh HeapNumber every iteration — ~16 MB of
  // young-generation garbage over the million frames the allocation test
  // drives. That is the HARNESS allocating, not the HUD, and it is what the
  // old tolerance of 2 was absorbing. A Float64Array element is raw storage
  // and boxes nothing; the arithmetic is bit-identical.
  //
  // MEASURED, with the counter below already fixed and the whole spec run
  // under `--max-semi-space-size=4`: restoring a boxed accessor here scores 4
  // and fails; this Float64Array scores 0 at 16, 4 and 2 MB.
  const clock = new Float64Array(1);
  const hud = new PerfHud({
    mount: mount as unknown as HTMLElement,
    source,
    now: () => clock[0],
    visible: options.visible ?? false,
  });
  return {
    hud,
    mount,
    source,
    step: (frames, msPerFrame) => {
      for (let i = 0; i < frames; i++) {
        clock[0] += msPerFrame;
        hud.frame(msPerFrame / 1000);
      }
    },
    sampleOnly: (frames) => {
      for (let i = 0; i < frames; i++) {
        clock[0] += VSYNC_60;
        hud.frame(0);
      }
    },
  };
}

/**
 * A scavenge is the only GC kind an allocating loop can force. `major`,
 * `incremental` and `weakcb` are the collector's own background schedule and
 * say nothing about `run`.
 */
const GC_MINOR = constants.NODE_PERFORMANCE_GC_MINOR;

/**
 * `PerformanceEntry` does not declare `detail` — only the gc subtype carries
 * it — so it is duck-typed off `unknown`, the way `asTimerGl` narrows a WebGL
 * context in PerfHud.ts. -1 for anything that is not a gc entry.
 */
function gcEntryKind(entry: PerformanceEntry): number {
  const detail = (entry as unknown as { detail?: unknown }).detail;
  if (typeof detail !== 'object' || detail === null) return -1;
  const kind = (detail as { kind?: unknown }).kind;
  return typeof kind === 'number' ? kind : -1;
}

/**
 * Scavenges that STARTED WHILE `run` was executing. Exactly zero for a loop
 * that allocates nothing.
 *
 * The wait is for DELIVERY, not for measurement: gc entries reach the observer
 * on a later event-loop turn and `takeRecords()` does not drain them, so the
 * 30 ms is unavoidable — but it must not be part of the window. It used to be,
 * and that charged the collector's own background schedule to whichever loop
 * happened to be running. That was half the flake; the other half was the
 * harness clock above.
 */
async function gcCount(run: () => void): Promise<number> {
  const seen: PerformanceEntry[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) seen.push(e);
  });
  obs.observe({ entryTypes: ['gc'] });
  const t0 = performance.now();
  run();
  const t1 = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 30));
  obs.disconnect();
  let n = 0;
  for (const e of seen) {
    if (e.startTime < t0 || e.startTime > t1) continue;
    if (gcEntryKind(e) !== GC_MINOR) continue;
    n++;
  }
  return n;
}

beforeEach(() => {
  counts.created = 0;
  counts.textNodes = 0;
  counts.textWrites = 0;
});

/* ==========================================================================
 * 1. PERCENTILES
 * ========================================================================== */

describe('FrameRing', () => {
  it('computes nearest-rank quantiles from a known sample', () => {
    const values: number[] = [];
    for (let i = 1; i <= 100; i++) values.push(i);
    const ring = ringOf(values);

    // Nearest rank over 100 sorted samples: index = round(q * 99).
    expect(ring.count).toBe(100);
    expect(ring.median).toBe(51);      // round(0.5 * 99) = 50 -> values[50] = 51
    expect(ring.quantile(0.95)).toBe(95); // round(0.95 * 99) = 94 -> 95
    expect(ring.quantile(0)).toBe(1);
    expect(ring.quantile(1)).toBe(100);
    expect(ring.min).toBe(1);
    expect(ring.max).toBe(100);
  });

  it('quantiles are order-independent', () => {
    const shuffled = ringOf([9, 1, 7, 3, 5]);
    expect(shuffled.median).toBe(5);
    expect(shuffled.min).toBe(1);
    expect(shuffled.max).toBe(9);
  });

  it('keeps only the last `capacity` samples', () => {
    const ring = new FrameRing(4);
    for (const v of [100, 200, 1, 2, 3, 4]) ring.push(v);
    ring.snapshot();
    expect(ring.count).toBe(4);
    expect(ring.min).toBe(1);
    expect(ring.max).toBe(4);
    expect(ring.median).toBe(3);
  });

  it('reports the share above a limit and near a centre', () => {
    const ring = ringOf([...repeat(16.7, 90), ...repeat(300, 10)]);
    expect(ring.shareAbove(25)).toBeCloseTo(0.1, 6);
    expect(ring.shareAbove(1000)).toBe(0);
    expect(ring.shareNear(16.7, CADENCE_TOLERANCE)).toBeCloseTo(0.9, 6);
    expect(ring.shareNear(8.33, CADENCE_TOLERANCE)).toBe(0);
  });

  it('is empty-safe', () => {
    const ring = new FrameRing(8);
    ring.snapshot();
    expect(ring.median).toBe(0);
    expect(ring.quantile(0.95)).toBe(0);
    expect(ring.shareAbove(1)).toBe(0);
    expect(ring.shareNear(16.7, 0.08)).toBe(0);
  });
});

/* ==========================================================================
 * 2. CADENCE DETECTION
 * ========================================================================== */

describe('detectCadenceMs', () => {
  it('finds 60 Hz in a pinned window', () => {
    const ms = detectCadenceMs(ringOf(pinnedWindow(12, 322.7)));
    expect(ms).not.toBeNull();
    expect(ms as number).toBeCloseTo(VSYNC_60, 3);
  });

  it('finds 120 Hz without being told the display exists', () => {
    const ms = detectCadenceMs(ringOf(repeat(1000 / 120, 200)));
    expect(ms as number).toBeCloseTo(1000 / 120, 3);
  });

  it('refuses a free-running window', () => {
    const spread: number[] = [];
    for (let i = 0; i < 200; i++) spread.push(40 + (i % 37) * 1.4);
    expect(detectCadenceMs(ringOf(spread))).toBeNull();
  });

  it('refuses to guess before it has enough samples', () => {
    expect(detectCadenceMs(ringOf(repeat(VSYNC_60, MIN_SAMPLES - 1)))).toBeNull();
  });
});

/* ==========================================================================
 * 3. THE VERDICT — the whole point of the feature
 * ========================================================================== */

describe('classifyLoad', () => {
  it('NEVER claims headroom for the real baseline capture', () => {
    // med 16.6, p95 322.7, 60 fps, draws 194 — a machine at 100% GPU load that
    // a naive counter reported as fine.
    const v = classifyLoad(sampleOf({
      frameMedianMs: 16.6,
      frameP95Ms: 322.7,
      cpuMedianMs: 4.1,
      missRatio: 0.05,
    }));
    expect(v.state).toBe('vsync-saturated');
    expect(v.claimsHeadroom).toBe(false);
    expect(v.severity).toBe('bad');
    expect(v.label).toContain('NO HEADROOM');
    expect(v.label).not.toContain('SPARE');
  });

  it('does not claim headroom on a CLEAN pinned window either, without a timer', () => {
    // The case that matters most: nothing is wrong, every frame is 16.67, and
    // there is still no evidence of spare GPU time. Amber, not green.
    const v = classifyLoad(sampleOf({}));
    expect(v.state).toBe('vsync-unknown');
    expect(v.claimsHeadroom).toBe(false);
    expect(v.severity).not.toBe('ok');
    expect(v.label).toContain('HEADROOM UNKNOWN');
  });

  it('claims headroom ONLY when a GPU timer measured it', () => {
    const v = classifyLoad(sampleOf({ gpuMs: 6.2 }));
    expect(v.state).toBe('vsync-spare');
    expect(v.claimsHeadroom).toBe(true);
    expect(v.label).toContain('SPARE');
    expect(v.reason).toContain('measured');
  });

  it('calls a pinned window saturated when the GPU timer is nearly at the cap', () => {
    const v = classifyLoad(sampleOf({ gpuMs: 15.2 }));
    expect(v.state).toBe('vsync-saturated');
    expect(v.claimsHeadroom).toBe(false);
    expect(v.reason).toContain('gpu');
  });

  it('reads a halved cadence as frame doubling, not as a 30 Hz display', () => {
    const v = classifyLoad(sampleOf({
      frameMedianMs: 33.3,
      frameP95Ms: 33.4,
      cadenceMs: 1000 / 30,
      bestCadenceMs: VSYNC_60,
    }));
    expect(v.state).toBe('vsync-saturated');
    expect(v.reason).toContain('doubling');
  });

  it('reads missed frames as saturation even with a tight p95', () => {
    const v = classifyLoad(sampleOf({ missRatio: 0.08, frameP95Ms: VSYNC_60 * 1.2 }));
    expect(v.state).toBe('vsync-saturated');
    expect(v.reason).toContain('miss');
  });

  it('calls the real GPU-bound capture GPU-bound', () => {
    // scale 1.00: med 77.9, p95 132.6, 13 fps — free-running, and the JS side
    // is nowhere near the frame time.
    const v = classifyLoad(sampleOf({
      frameMedianMs: 77.9,
      frameP95Ms: 132.6,
      cpuMedianMs: 11.4,
      cadenceMs: null,
      bestCadenceMs: null,
    }));
    expect(v.state).toBe('gpu-bound');
    expect(v.claimsHeadroom).toBe(false);
    expect(v.severity).toBe('bad');
  });

  it('separates CPU-bound from GPU-bound by the JS share of the frame', () => {
    const v = classifyLoad(sampleOf({
      frameMedianMs: 40,
      frameP95Ms: 52,
      cpuMedianMs: 36,
      cadenceMs: null,
      bestCadenceMs: null,
    }));
    expect(v.state).toBe('cpu-bound');
    expect(v.reason).toContain('36.0');
  });

  it('says it is still sampling rather than guessing', () => {
    const v = classifyLoad(sampleOf({ samples: MIN_SAMPLES - 1 }));
    expect(v.state).toBe('warmup');
    expect(v.claimsHeadroom).toBe(false);
  });

  it('never sets claimsHeadroom without a gpu measurement, over the whole space', () => {
    for (const gpuMs of [null, 2, 6.2, 12, 15.9, 30]) {
      for (const p95 of [VSYNC_60, 20, 50, 322.7]) {
        for (const missRatio of [0, 0.01, 0.2]) {
          const v = classifyLoad(sampleOf({ gpuMs, frameP95Ms: p95, missRatio }));
          if (v.claimsHeadroom) {
            expect(gpuMs).not.toBeNull();
            expect(v.state).toBe('vsync-spare');
          }
        }
      }
    }
  });
});

/* ==========================================================================
 * 4. THE PANEL
 * ========================================================================== */

describe('PerfHud', () => {
  it('is off by default and mounts hidden', () => {
    const { hud, mount } = makeHud();
    expect(hud.shown).toBe(false);
    expect(hud.root.hidden).toBe(true);
    expect(mount.classList.contains('vm-perf-on')).toBe(false);
  });

  it('keeps the body click-through and permits only its drag header to capture a pointer', () => {
    const { hud } = makeHud({ visible: true });
    expect(perfLayerFaults(hud.root as unknown as Element)).toEqual([]);
    expect(hud.root.style.pointerEvents).toBe('none');
    const head = (hud.root as unknown as StubElement).querySelectorAll('.vm-perf-head')[0];
    expect(head?.getAttribute('data-perf-drag-handle')).toBe('true');
    expect(head?.style.pointerEvents).toBe('auto');
  });

  it('builds exactly PERF_ROW_COUNT rows', () => {
    const { hud } = makeHud();
    const rows = (hud.root as unknown as StubElement).querySelectorAll('.vm-perf-row');
    expect(rows.length).toBe(PERF_ROW_COUNT);
  });

  it('does nothing at all while it is off', () => {
    const { hud, source, step } = makeHud();
    step(600, VSYNC_60);
    expect(source.cpuCalls).toBe(0);
    expect(source.readCalls).toBe(0);
    expect(hud.verdict).toBeNull();
  });

  it('moves the toast stack aside only while it is up', () => {
    const { hud, mount } = makeHud();
    hud.setVisible(true);
    expect(mount.classList.contains('vm-perf-on')).toBe(true);
    hud.setVisible(false);
    expect(mount.classList.contains('vm-perf-on')).toBe(false);
    hud.setVisible(true);
    hud.dispose();
    expect(mount.classList.contains('vm-perf-on')).toBe(false);
  });

  it('creates no DOM node and writes no text between updates', () => {
    const { hud, step } = makeHud();
    hud.setVisible(true);
    step(4, VSYNC_60); // ~67 ms: nowhere near the 250 ms update interval
    const built = counts.created;
    const written = counts.textWrites;
    expect(written).toBe(0);

    // Ten more frames, still inside the same update window.
    step(10, VSYNC_60);
    expect(counts.created).toBe(built);
    expect(counts.textWrites).toBe(0);

    // Now cross the interval: text is written, but no node is ever created.
    step(1, 300);
    expect(counts.textWrites).toBeGreaterThan(0);
    expect(counts.created).toBe(built);
  });

  it('rewrites text a few times a second, not sixty', () => {
    const { hud, source, step } = makeHud();
    hud.setVisible(true);
    step(600, VSYNC_60); // ten seconds
    // 4 Hz over ten seconds. The accumulator is zeroed rather than decremented
    // by the interval, so the period is the first whole frame past 250 ms —
    // 16 frames at 60 fps, giving 37 updates rather than 40. That is a
    // deliberate trade: after a hitch the next update is one interval away
    // instead of firing immediately on a stale window.
    // 16 frames rather than 15, because 15 * (1/60) lands a rounding error
    // below 0.25 s. 37 updates for 600 frames, and nowhere near 600.
    expect(source.readCalls).toBe(37);
    expect(source.readCalls).toBeLessThan(UPDATE_HZ * 10 + 2);
    expect(source.readCalls).toBeGreaterThan(UPDATE_HZ * 10 - 5);
  });

  it('does not claim headroom when frame times are pinned at the vsync interval', () => {
    const { hud, step } = makeHud();
    hud.setVisible(true);
    // A perfect 60 fps machine, four seconds of it, with no GPU timer.
    step(300, VSYNC_60);
    const v = hud.verdict;
    expect(v).not.toBeNull();
    expect(hud.gpuTimerAvailable).toBe(false);
    expect((v as { claimsHeadroom: boolean }).claimsHeadroom).toBe(false);
    expect((v as { state: string }).state).toBe('vsync-unknown');
  });

  it('turns a pinned window with a blown tail into a saturation verdict', () => {
    const { hud, step } = makeHud();
    hud.setVisible(true);
    step(220, VSYNC_60);
    step(20, 322.7);   // the baseline capture's tail
    step(1, 300);      // force the update
    expect((hud.verdict as { state: string }).state).toBe('vsync-saturated');
  });

  it('marks an over-budget draw count — from the COLOUR pass, not the total', () => {
    /*
     * THIS TEST USED TO ENCODE THE DEFECT. It set `drawCalls` — the frame
     * TOTAL, summed over every scene submission — and expected the budget
     * class, because that is what `PerfHud` did. `MAX_DRAW_CALLS` budgets the
     * COLOUR PASS alone, which runs 51-77 against 130, so the row sat
     * permanently red against a budget that is half empty.
     *
     * It is the same confusion CLAUDE.md records having believed for three
     * releases about `frame.drawCalls`, reproduced in the HUD. The inference
     * only runs one way: total >= colour, so a total UNDER budget proves
     * compliance, while a total OVER it proves nothing at all.
     */
    const { hud, source, step } = makeHud();
    hud.setVisible(true);
    source.values.drawCallsColour = DRAW_BUDGET + 1;
    step(60, VSYNC_60);
    const root = hud.root as unknown as StubElement;
    expect(root.classList.contains('is-draws-over')).toBe(true);
    expect(root.classList.contains('is-tris-over')).toBe(true);

    source.values.drawCallsColour = DRAW_BUDGET - 1;
    source.values.triangles = TRIANGLE_ADVISORY - 1;
    step(60, VSYNC_60);
    expect(root.classList.contains('is-draws-over')).toBe(false);
    expect(root.classList.contains('is-tris-over')).toBe(false);
  });

  it('throws the window away when it is reopened', () => {
    const { hud, step } = makeHud();
    hud.setVisible(true);
    step(300, VSYNC_60);
    hud.setVisible(false);
    hud.setVisible(true);
    step(2, VSYNC_60);
    step(1, 300);
    expect((hud.verdict as { state: string }).state).toBe('warmup');
  });

  it('measures its own cost rather than claiming it', () => {
    const { hud } = makeHud();
    hud.setVisible(true);
    // The injected clock does not advance during calibration, so the measured
    // figure is zero here — what is asserted is that the number EXISTS and is
    // finite, so the row can never print a hope. The live figure is in the
    // module report.
    expect(Number.isFinite(hud.selfSampleMs)).toBe(true);
    expect(Number.isFinite(hud.selfAmortisedMs)).toBe(true);
    expect(hud.selfSampleMs).toBeGreaterThanOrEqual(0);
  });
});

/* ==========================================================================
 * 5. ALLOCATION
 *
 * A GC-count comparison, with a deliberately allocating control so the method
 * itself is under test: if the control does not trip the collector, the
 * measurement is blind and the assertion below fails rather than passing on a
 * meaningless zero.
 * ========================================================================== */

describe('the sample path', () => {
  it('allocates nothing per frame', async () => {
    const { hud, sampleOnly } = makeHud();
    hud.setVisible(true);
    const N = 1_000_000;

    let sink = 0;
    const ambientLoop = (): void => { for (let i = 0; i < N; i++) sink += i & 7; };

    // Warm the JIT on both paths before anything is counted. The comment here
    // used to claim both and warm only one.
    sampleOnly(20_000);
    ambientLoop();

    const ambient = await gcCount(ambientLoop);
    const sampled = await gcCount(() => { sampleOnly(N); });

    const keep: object[] = new Array(256);
    let head = 0;
    const control = await gcCount(() => {
      for (let i = 0; i < N; i++) {
        keep[head] = { a: i, b: i, c: [i, i, i, i] };
        head = (head + 1) % 256;
      }
    });

    expect(sink).toBeGreaterThan(0);
    expect(keep.length).toBe(256);
    // The control proves the collector is watching.
    expect(control).toBeGreaterThan(4);
    // A million real frames must look like a million integer adds — exactly.
    // Both are zero. Neither loop allocates, and `gcCount` no longer charges
    // the collector's background schedule to whichever loop happened to be
    // running. DO NOT REINTRODUCE A TOLERANCE: a non-zero `sampled` now means
    // the sample path really did allocate.
    expect(ambient).toBe(0);
    expect(sampled).toBe(ambient);
    expect(sampled * 4).toBeLessThan(control);
  });

  it('never replaces its backing store', () => {
    const { hud, sampleOnly } = makeHud();
    hud.setVisible(true);
    const ring = new FrameRing(HISTORY_FRAMES);
    const store = ring.storage;
    for (let i = 0; i < 50_000; i++) ring.push(i % 40);
    expect(ring.storage).toBe(store);
    expect(ring.count).toBe(HISTORY_FRAMES);
    expect(ring.capacity).toBe(HISTORY_FRAMES);
    sampleOnly(1000);
  });
});

/* ==========================================================================
 * 6. LAYOUT — the stylesheet against the arithmetic
 * ========================================================================== */

describe('layout', () => {
  const css = readFileSync('apps/game/src/ui/perf.css', 'utf8');

  it('the panel width in perf.css is the width in PerfHud.ts', () => {
    const block = /\.vm-perf \{[\s\S]*?\}/.exec(css);
    expect(block).not.toBeNull();
    const width = /width: calc\((\d+) \* var\(--vm-u/.exec((block as RegExpExecArray)[0]);
    expect(width).not.toBeNull();
    expect(Number((width as RegExpExecArray)[1])).toBe(PERF_WIDTH_UNITS);
  });

  it('the toast offset clears the panel by exactly its modelled height', () => {
    const rule = /\.vm-hud\.vm-perf-on \.vm-toasts \{\s*top: calc\(\((\d+) \+ (\d+) \+ (\d+)\)/.exec(css);
    expect(rule).not.toBeNull();
    const [, top, height] = rule as RegExpExecArray;
    expect(Number(top)).toBe(10);              // hud.css puts the toasts at 10u
    expect(Number(height)).toBe(perfPanelHeightUnits());
  });

  it('reports its own frame share', () => {
    // 150u x 142u against 1280x720.
    expect(perfFrameShareOf(1280, 720)).toBeCloseTo(
      (PERF_WIDTH_UNITS * perfPanelHeightUnits()) / (1280 * 720),
      9,
    );
    expect(perfFrameShareOf(0, 0)).toBe(0);
  });
});

/* ==========================================================================
 * 7. FORMATTING
 * ========================================================================== */

describe('formatting', () => {
  it('abbreviates counts the way a reader wants them', () => {
    expect(formatCount(1_750_000)).toBe('1.75 M');
    expect(formatCount(284_000)).toBe('284 k');
    expect(formatCount(912)).toBe('912');
    expect(formatCount(-5)).toBe('0');
  });

  it('prints sub-millisecond costs as microseconds', () => {
    expect(formatSmallMs(0.0004)).toBe('0 µs');
    expect(formatSmallMs(0.42)).toBe('420 µs');
    expect(formatSmallMs(1.5)).toBe('1.50 ms');
    expect(formatSmallMs(0)).toBe('0 µs');
  });
});

/* ==========================================================================
 * 8. THE SETTING
 * ========================================================================== */

describe('the perfOverlay setting', () => {
  it('defaults to off', () => {
    expect(defaultSettings().graphics.perfOverlay).toBe(false);
  });

  it('survives a settings blob written by any build', () => {
    for (const junk of [null, undefined, 7, 'yes', [], { graphics: 'nope' }]) {
      expect(normalizeSettings(junk).graphics.perfOverlay).toBe(false);
    }
    expect(normalizeSettings({ graphics: { perfOverlay: 'true' } }).graphics.perfOverlay).toBe(false);
    expect(normalizeSettings({ graphics: { perfOverlay: true } }).graphics.perfOverlay).toBe(true);
  });

  it('persists, notifies and round-trips', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string): string | null => backing.get(k) ?? null,
      setItem: (k: string, v: string): void => { backing.set(k, v); },
    };
    const store = new SettingsStore(storage);
    expect(store.get().graphics.perfOverlay).toBe(false);

    let seen: readonly string[] = [];
    store.subscribe((_s, changed) => { seen = changed; });
    store.patch({ graphics: { perfOverlay: true } });
    expect(seen).toEqual(['graphics.perfOverlay']);
    expect(store.get().graphics.perfOverlay).toBe(true);

    // A fresh store over the same storage finds it on.
    expect(new SettingsStore(storage).get().graphics.perfOverlay).toBe(true);

    // And Restore Defaults puts it back.
    store.reset('graphics');
    expect(store.get().graphics.perfOverlay).toBe(false);
  });

  it('appears in the change diff under its own path', () => {
    const a = defaultSettings();
    const b = defaultSettings();
    b.graphics.perfOverlay = true;
    expect(diffSettings(a, b)).toEqual(['graphics.perfOverlay']);
  });
});

/* ==========================================================================
 * 9. THE SYSTEM'S SEAMS
 * ========================================================================== */

describe('perf.system seams', () => {
  it('reads the setting defensively', () => {
    expect(readPerfSetting(null)).toBe(false);
    expect(readPerfSetting({
      get: () => ({}),
      patch: () => undefined,
      subscribe: () => () => undefined,
    })).toBe(false);
    expect(readPerfSetting({
      get: () => ({ graphics: { perfOverlay: true } }),
      patch: () => undefined,
      subscribe: () => () => undefined,
    })).toBe(true);
    expect(readPerfSetting({
      get: () => { throw new Error('store is mid-rebuild'); },
      patch: () => undefined,
      subscribe: () => () => undefined,
    })).toBe(false);
  });

  it('binds no key at all while the catalogue has no row for it', () => {
    // The shortcut is resolved from `src/input/ActionCatalogue.ts`, which this
    // workflow may not edit — see the header of perf.system.ts for the entry it
    // needs. Until that lands `liveChordFor` returns null, and a null chord must
    // match nothing rather than swallowing every keystroke.
    const event = { code: 'F4', ctrlKey: false, shiftKey: false, altKey: false };
    expect(chordMatches(null, event as unknown as KeyboardEvent)).toBe(false);
  });

  it('matches a chord exactly, modifiers included', () => {
    const chord = { code: 'F4', ctrl: false, shift: false, alt: false };
    const press = (patch: Record<string, unknown>): KeyboardEvent =>
      ({ code: 'F4', ctrlKey: false, shiftKey: false, altKey: false, ...patch }) as unknown as KeyboardEvent;
    expect(chordMatches(chord, press({}))).toBe(true);
    expect(chordMatches(chord, press({ code: 'F3' }))).toBe(false);
    expect(chordMatches(chord, press({ shiftKey: true }))).toBe(false);
    expect(chordMatches({ code: '', ctrl: false, shift: false, alt: false }, press({ code: '' }))).toBe(false);
  });
});
