/**
 * ============================================================================
 * tests/savegame-ux.spec.ts — autosave policy, the load screen, the save panel
 * ============================================================================
 * The player-facing half of the save system. Three groups of claims are pinned
 * here, and each one is a claim that would be expensive to discover was false:
 *
 *   - THE AUTOSAVE POLICY IS A CLOCK-FREE MACHINE. `Date.now()` and
 *     `performance.now()` are banned inside `simTick`, and the scheduler is
 *     written so it could be moved there tomorrow without violating that. The
 *     test does not take that on faith: it REPLACES both clocks with functions
 *     that throw and then drives a hundred thousand ticks through the machine.
 *     A scheduler that peeked at a clock would not survive one call.
 *
 *   - ROTATION NEVER REACHES A MANUAL SAVE. Autosaves and manual saves are
 *     separate id namespaces, and the test asserts the namespaces are provably
 *     disjoint rather than asserting that today's three ids happen not to
 *     collide.
 *
 *   - A FAILED WRITE IS VISIBLE. `src/game/SaveGame.ts` reports failures as
 *     VALUES (`{ok:false, reason}`), not as thrown errors. A front end that
 *     only caught rejections would print "Saved" over a save that never
 *     happened, so both conventions are exercised against the real UI.
 *
 * WHY THIS FILE BRINGS ITS OWN DOM
 * --------------------------------
 * The suite is `environment: 'node'` for every other file; switching it edits
 * `vite.config.ts`, and jsdom is not installed and adding it edits
 * `package.json` — both files other workflows are editing right now. So the
 * ~180 lines below implement exactly the surface `src/shell/Shell.ts`'s DOM kit
 * actually uses: element tree, classes, attributes, dataset, text, properties
 * and click dispatch. There is NO LAYOUT, which is why nothing here asserts a
 * position or a size; what is pinned is behaviour and state.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/* ==========================================================================
 * THE DOM STUB — installed before any module that touches `document` runs
 * ========================================================================== */

type Handler = (event: StubEvent) => void;

interface StubEvent {
  type: string;
  code?: string;
  target?: StubElement;
}

class StubClassList {
  private readonly names = new Set<string>();

  add(...list: string[]): void { for (const n of list) if (n !== '') this.names.add(n); }
  remove(...list: string[]): void { for (const n of list) this.names.delete(n); }
  contains(name: string): boolean { return this.names.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name);
    if (on) this.names.add(name);
    else this.names.delete(name);
    return on;
  }

  get value(): string { return [...this.names].join(' '); }
  set value(v: string) {
    this.names.clear();
    for (const n of v.split(/\s+/)) if (n !== '') this.names.add(n);
  }
}

class StubElement {
  readonly children: StubElement[] = [];
  readonly classList = new StubClassList();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & { cssText?: string } = {};
  parent: StubElement | null = null;

  private readonly attrs = new Map<string, string>();
  private readonly handlers = new Map<string, Handler[]>();
  private ownText = '';

  /* Properties the shell's kit and the save screens actually assign. */
  type = '';
  value = '';
  id = '';
  src = '';
  alt = '';
  width = 0;
  height = 0;
  decoding = '';
  htmlFor = '';
  maxLength = 0;
  autocomplete = '';
  spellcheck = false;
  title = '';
  hidden = false;
  isContentEditable = false;

  constructor(readonly tagName: string) {}

  get className(): string { return this.classList.value; }
  set className(v: string) { this.classList.value = v; }

  get tabIndex(): number { return Number(this.attrs.get('tabindex') ?? '-1'); }
  set tabIndex(v: number) { this.attrs.set('tabindex', String(v)); }

  get disabled(): boolean { return this.attrs.has('disabled'); }
  set disabled(v: boolean) {
    if (v) this.attrs.set('disabled', '');
    else this.attrs.delete('disabled');
  }

  get textContent(): string {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.children.length = 0;
    this.ownText = v;
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }

  appendChild<T extends StubElement>(child: T): T {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  insertBefore<T extends StubElement>(child: T, before: StubElement | null): T {
    const i = before === null ? -1 : this.children.indexOf(before);
    child.parent = this;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }

  removeChild(child: StubElement): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }

  remove(): void { this.parent?.removeChild(this); }

  replaceChildren(...next: StubElement[]): void {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
    this.ownText = '';
    for (const c of next) this.appendChild(c);
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type);
    if (list === undefined) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatch(event: StubEvent): void {
    for (const fn of [...(this.handlers.get(event.type) ?? [])]) fn({ ...event, target: this });
  }

  click(): void { this.dispatch({ type: 'click' }); }
  focus(): void { /* no focus model without layout */ }

  /** Supports `.class`, `tag` and `[attr]` — the only forms the kit uses. */
  querySelector(selector: string): StubElement | null {
    return this.queryAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): StubElement[] {
    return this.queryAll(selector);
  }

  private queryAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const match = (n: StubElement): boolean => {
      if (selector.startsWith('.')) return n.classList.contains(selector.slice(1));
      if (selector.startsWith('[')) return n.hasAttribute(selector.slice(1, -1));
      return n.tagName === selector.toUpperCase();
    };
    const walk = (n: StubElement): void => {
      for (const c of n.children) {
        if (match(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  /** Every descendant, for assertions that do not want a selector. */
  descendants(): StubElement[] {
    const out: StubElement[] = [];
    const walk = (n: StubElement): void => {
      for (const c of n.children) { out.push(c); walk(c); }
    };
    walk(this);
    return out;
  }

  /** All visible text, whitespace-collapsed. */
  text(): string {
    return this.textContent.replace(/\s+/g, ' ').trim();
  }
}

interface TimerRecord { fn: () => void; at: number }

/** A controllable timer queue, so confirm windows are testable without waiting. */
class StubTimers {
  private next = 1;
  private nowMs = 0;
  private readonly pending = new Map<number, TimerRecord>();

  set(fn: () => void, ms: number): number {
    const id = this.next++;
    this.pending.set(id, { fn, at: this.nowMs + Math.max(0, ms) });
    return id;
  }

  clear(id: number): void { this.pending.delete(id); }

  /** Run everything due within `ms`. */
  advance(ms: number): void {
    this.nowMs += ms;
    for (;;) {
      let due: [number, TimerRecord] | null = null;
      for (const entry of this.pending) {
        if (entry[1].at <= this.nowMs && (due === null || entry[1].at < due[1].at)) due = entry;
      }
      if (due === null) return;
      this.pending.delete(due[0]);
      due[1].fn();
    }
  }
}

let timers = new StubTimers();

function installDom(): void {
  const doc = {
    createElement: (tag: string) => new StubElement(tag.toUpperCase()),
    createElementNS: (_ns: string, tag: string) => new StubElement(tag.toUpperCase()),
    body: new StubElement('BODY'),
    activeElement: null,
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
  };
  const win = {
    setTimeout: (fn: () => void, ms: number) => timers.set(fn, ms),
    clearTimeout: (id: number) => timers.clear(id),
    setInterval: (fn: () => void, ms: number) => timers.set(fn, ms),
    clearInterval: (id: number) => timers.clear(id),
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
    close: () => { /* no-op */ },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = doc;
  g.window = win;
  g.requestAnimationFrame = (cb: (t: number) => void) => timers.set(() => cb(0), 0);
  g.cancelAnimationFrame = (id: number) => timers.clear(id);
}

installDom();

/* ==========================================================================
 * THE MODULES UNDER TEST
 *
 * Imported after the DOM exists. None of them touches `document` at module
 * scope — `ctx()` throws at module top level by design and the shell obeys the
 * same rule — but installing first means a regression on that point fails here
 * rather than in a browser.
 * ========================================================================== */

import {
  AUTOSAVE_DEFER_LIMIT_TICKS,
  AUTOSAVE_GRACE_TICKS,
  AUTOSAVE_IDLE_BUDGET_MS,
  AUTOSAVE_INTERVAL_TICKS,
  AUTOSAVE_MIN_GAP_TICKS,
  AUTOSAVE_SLOTS,
  AutosaveScheduler,
  ConfirmButton,
  LoadGameScreen,
  SavePanel,
  autosaveLabel,
  autosaveSlotId,
  deferAutosaveCapture,
  errorText,
  formatBytes,
  formatCredits,
  formatWhen,
  isRefusal,
  manualSlots,
  newManualId,
  sanitizeSaveName,
  saveSlots,
  saveService,
  slotCard,
  suggestedSaveName,
  unwrap,
  type AutosaveSample,
  type SaveContext,
  type SaveRequest,
  type SaveService,
  type SaveSlotMeta,
} from '../src/shell/LoadGame';

import { loadHint, MainMenuScreen, menuBackendLabel } from '../src/shell/MainMenu';
import { MenuDecisionScreen } from '../src/shell/MenuDecision';
import { formatSlotName } from '../src/shell/Shell';
import type { Shell } from '../src/shell/Shell';
import { PROFILE_STORAGE_KEY } from '../src/progression/profile-store';
import { SIM_HZ } from '../src/core/config';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const CONTEXT: SaveContext = {
  mapId: 'temperate-valley',
  playerFaction: 'allies',
  aiFaction: 'soviets',
  difficulty: 1,
  speed: 1,
  seed: 0x1234,
  armies: 2,
};

function meta(over: Partial<SaveSlotMeta> = {}): SaveSlotMeta {
  return {
    id: 'auto.0',
    kind: 'auto',
    label: 'Autosave · 3:00',
    savedAtMs: 1_700_000_000_000,
    tick: 5400,
    simSeconds: 180,
    credits: 12480,
    bytes: 240_000,
    thumbnail: null,
    context: CONTEXT,
    ...over,
  };
}

/** An in-memory save service. `behaviour` decides how writes end. */
class FakeService implements SaveService {
  readonly rows: SaveSlotMeta[] = [];
  readonly saved: SaveRequest[] = [];
  readonly loaded: string[] = [];
  readonly removed: string[] = [];
  mode: 'ok' | 'refuse' | 'reject' = 'ok';
  available = true;

  list(): readonly SaveSlotMeta[] { return this.rows; }
  canSave(): boolean { return this.available; }

  async save(request: SaveRequest): Promise<SaveSlotMeta | { ok: false; reason: string }> {
    this.saved.push(request);
    if (this.mode === 'reject') throw new Error('The disk is full.');
    if (this.mode === 'refuse') return { ok: false, reason: 'Storage quota exceeded.' };
    const row = meta({
      id: request.slotId ?? newManualId(Date.now(), this.rows.length),
      kind: request.kind,
      label: request.label,
      context: request.context,
    });
    const i = this.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    return row;
  }

  async load(id: string): Promise<{ ok: false; reason: string } | void> {
    this.loaded.push(id);
    if (this.mode === 'reject') throw new Error('That save is corrupt.');
    if (this.mode === 'refuse') return { ok: false, reason: 'That save is corrupt.' };
  }

  async remove(id: string): Promise<{ ok: false; reason: string } | void> {
    this.removed.push(id);
    if (this.mode === 'refuse') return { ok: false, reason: 'Could not delete.' };
    const i = this.rows.findIndex((r) => r.id === id);
    if (i >= 0) this.rows.splice(i, 1);
  }
}

function publish(service: SaveService | null): void {
  const g = globalThis as { __vmSave?: SaveService };
  if (service === null) delete g.__vmSave;
  else g.__vmSave = service;
}

/** A recording storage, so "did anything touch the profile" is answerable. */
function recordingStorage(): { writes: string[]; map: Map<string, string> } {
  const map = new Map<string, string>();
  const writes: string[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); map.set(k, v); },
    removeItem: (k: string) => { writes.push(k); map.delete(k); },
  };
  return { writes, map };
}

/** The three members `SavePanel` and `LoadGameScreen` reach on the shell. */
interface ShellStub {
  settings: { get(): { gameplay: { commanderName: string } } };
  getSetup(): { map: string };
  matchSeconds(): number;
  saveGame(label: string, slotId?: string): Promise<SaveSlotMeta>;
  loadGame(slot: SaveSlotMeta): Promise<void>;
  showMenu(): void;
  openLoadGame(): void;
  canSave(): boolean;
  startTutorial(): Promise<void>;
  openQuitConfirmation(): void;
  openTutorialConfirmation(): void;
  openSetup(): void;
  openMissions(): void;
  openSettings(): void;
  openCredits(): void;
  /**
   * The title screen's Replays entry reads this for its hint. A stub that does
   * not answer throws inside `mount`, which took out five Load Game cases the
   * day the entry landed — the stub is the whole menu's contract, not just the
   * part a describe block is about.
   */
  latestReplay(): unknown;
  openReplays(): void;
}

function shellStub(over: Partial<ShellStub> = {}): Shell {
  const base: ShellStub = {
    settings: { get: () => ({ gameplay: { commanderName: 'Commander' } }) },
    getSetup: () => ({ map: 'temperate-valley' }),
    matchSeconds: () => 754,
    saveGame: async (label, slotId) => meta({ kind: 'manual', label, id: slotId ?? 'manual.new' }),
    loadGame: async () => { /* resolves */ },
    showMenu: () => { /* no-op */ },
    openLoadGame: () => { /* no-op */ },
    canSave: () => true,
    startTutorial: async () => { /* no-op */ },
    openQuitConfirmation: () => { /* no-op */ },
    openTutorialConfirmation: () => { /* no-op */ },
    openSetup: () => { /* no-op */ },
    openMissions: () => { /* no-op */ },
    openSettings: () => { /* no-op */ },
    openCredits: () => { /* no-op */ },
    latestReplay: () => null,
    openReplays: () => { /* no-op */ },
    ...over,
  };
  return base as unknown as Shell;
}

function host(): StubElement {
  return new StubElement('DIV');
}

/**
 * `SavePanel.root` is declared `HTMLElement`, which is what it genuinely is in a
 * browser. Under the stub `document` installed above it is a `StubElement`, and
 * that is the only reason these tests can read `.text()` or walk `.descendants()`
 * off it at all.
 *
 * One named crossing rather than a bare cast at each of a dozen call sites: the
 * assertion being made is "this came from our stub document", and naming it
 * keeps that claim in one place where it can be wrong once instead of twelve
 * times.
 */
function asStub(el: HTMLElement): StubElement {
  return el as unknown as StubElement;
}

/** Every button under a node, by its label text. */
function buttonsByLabel(root: StubElement): Map<string, StubElement> {
  const out = new Map<string, StubElement>();
  for (const n of root.descendants()) {
    if (n.tagName !== 'BUTTON') continue;
    const label = n.querySelector('.vm-btn-label');
    if (label !== null) out.set(label.text(), n);
  }
  return out;
}

/** Wait for the promise chains the panels start on a click. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  timers = new StubTimers();
  publish(null);
  recordingStorage();
});

afterEach(() => {
  publish(null);
});

/* ==========================================================================
 * 1. THE POLICY IS DRIVEN BY THE TICK COUNTER AND BY NOTHING ELSE
 * ========================================================================== */

/** One evaluate call, with everything nominal unless overridden. */
function sample(tick: number, over: Partial<AutosaveSample> = {}): AutosaveSample {
  return { tick, catchingUp: false, paused: false, canSave: true, objectivesComplete: 0, ...over };
}

/** Drive the machine tick by tick and collect the slot ids it committed. */
function run(
  s: AutosaveScheduler,
  fromTick: number,
  toTick: number,
  step: number,
  over: (tick: number) => Partial<AutosaveSample> = () => ({}),
): { tick: number; slotId: string }[] {
  const out: { tick: number; slotId: string }[] = [];
  for (let t = fromTick; t <= toTick; t += step) {
    const d = s.evaluate(sample(t, over(t)));
    if (d.act === 'save') {
      out.push({ tick: t, slotId: d.slotId });
      s.committed(t);
    }
  }
  return out;
}

describe('autosave — the schedule is the sim tick counter', () => {
  it('fires on the interval, in simulated ticks, not on wall time', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const fired = run(s, 0, AUTOSAVE_INTERVAL_TICKS * 4, 1);

    expect(fired.map((f) => f.tick)).toEqual([
      AUTOSAVE_INTERVAL_TICKS,
      AUTOSAVE_INTERVAL_TICKS * 2,
      AUTOSAVE_INTERVAL_TICKS * 3,
      AUTOSAVE_INTERVAL_TICKS * 4,
    ]);
  });

  it('is three simulated minutes, so the loss it bounds is bounded in GAME time', () => {
    expect(AUTOSAVE_INTERVAL_TICKS).toBe(SIM_HZ * 180);
    expect(AUTOSAVE_INTERVAL_TICKS / SIM_HZ / 60).toBe(3);
  });

  it('never reads a clock — proved by removing both of them', () => {
    const realDateNow = Date.now;
    const realPerfNow = performance.now;
    const bomb = (): number => { throw new Error('the scheduler read a clock'); };
    Date.now = bomb;
    performance.now = bomb;
    try {
      const s = new AutosaveScheduler();
      s.reset(0);
      // A hundred thousand ticks — well past thirty simulated minutes.
      const fired = run(s, 0, 100_000, 1);
      expect(fired.length).toBe(Math.floor(100_000 / AUTOSAVE_INTERVAL_TICKS));
    } finally {
      Date.now = realDateNow;
      performance.now = realPerfNow;
    }
  });

  it('does not fire again when wall time passes but the tick counter does not', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    expect(s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS)).act).toBe('save');
    s.committed(AUTOSAVE_INTERVAL_TICKS);
    // The same tick, evaluated two thousand more times: a wall-clock schedule
    // would have fired somewhere in here.
    for (let i = 0; i < 2000; i++) {
      expect(s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS)).act).toBe('idle');
    }
  });

  it('writes nothing during the opening grace window', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    for (let t = 0; t < AUTOSAVE_GRACE_TICKS; t++) {
      expect(s.evaluate(sample(t, { objectivesComplete: 3 })).act).toBe('idle');
    }
  });

  it('the FIRST autosave is a full interval in, not the instant grace ends', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const fired = run(s, 0, AUTOSAVE_INTERVAL_TICKS, 1);
    expect(fired.length).toBe(1);
    expect(fired[0].tick).toBe(AUTOSAVE_INTERVAL_TICKS);
    expect(fired[0].tick).toBeGreaterThan(AUTOSAVE_GRACE_TICKS);
  });

  it('banks nothing while paused, so unpausing does not fire a burst', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    // A paused match does not advance its tick counter. Evaluate it a thousand
    // times at a tick that is already overdue, then unpause at the same tick.
    for (let i = 0; i < 1000; i++) {
      expect(s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS, { paused: true })).act).toBe('idle');
    }
    // Still due the moment it resumes — that is correct, the match really has
    // run three minutes — but exactly ONE save, not a thousand.
    expect(s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS)).act).toBe('save');
    s.committed(AUTOSAVE_INTERVAL_TICKS);
    expect(s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS)).act).toBe('idle');
  });

  it('does nothing at all when the service refuses to save', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    for (let t = 0; t <= AUTOSAVE_INTERVAL_TICKS * 3; t += 30) {
      expect(s.evaluate(sample(t, { canSave: false })).act).toBe('idle');
    }
  });
});

/* ==========================================================================
 * 2. ROTATION, AND THE NAMESPACE THAT PROTECTS MANUAL SAVES
 * ========================================================================== */

describe('autosave — three rotating slots', () => {
  it('cycles the slots instead of overwriting one', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const fired = run(s, 0, AUTOSAVE_INTERVAL_TICKS * 7, 1);
    expect(fired.map((f) => f.slotId)).toEqual([
      'auto.0', 'auto.1', 'auto.2', 'auto.0', 'auto.1', 'auto.2', 'auto.0',
    ]);
  });

  it('never emits an id outside the autosave namespace', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const fired = run(s, 0, AUTOSAVE_INTERVAL_TICKS * 20, 1);
    expect(fired.length).toBe(20);
    for (const f of fired) expect(f.slotId).toMatch(/^auto\.[0-2]$/);
  });

  it('a manual id can never be produced by rotation', () => {
    const autoIds = new Set<string>();
    // Every id the rotation can EVER produce, not just the ones it produced.
    for (let i = -50; i < 50; i++) autoIds.add(autosaveSlotId(i));
    expect(autoIds.size).toBe(AUTOSAVE_SLOTS);

    for (let i = 0; i < 500; i++) {
      const id = newManualId(1_700_000_000_000 + i * 7919, i);
      expect(autoIds.has(id)).toBe(false);
      expect(id.startsWith('manual.')).toBe(true);
    }
  });

  it('a failed write backs off a full interval and does NOT advance the rotation', () => {
    const s = new AutosaveScheduler();
    s.reset(0);

    const first = s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS));
    expect(first).toEqual({ act: 'save', slotId: 'auto.0', trigger: 'interval' });
    s.failed(AUTOSAVE_INTERVAL_TICKS);

    // No retry storm: nothing at all until the next interval.
    for (let t = AUTOSAVE_INTERVAL_TICKS + 1; t < AUTOSAVE_INTERVAL_TICKS * 2; t++) {
      expect(s.evaluate(sample(t)).act).toBe('idle');
    }
    // And the retry claims the SAME slot — stepping past it would discard the
    // good save still sitting in `auto.0` to protect a write that failed.
    const second = s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS * 2));
    expect(second).toEqual({ act: 'save', slotId: 'auto.0', trigger: 'interval' });
  });

  it('keeps rotating across a restart, so two restarts do not reuse one slot', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    s.evaluate(sample(AUTOSAVE_INTERVAL_TICKS));
    s.committed(AUTOSAVE_INTERVAL_TICKS);
    expect(s.nextSlotId()).toBe('auto.1');
    s.reset(0);
    expect(s.nextSlotId()).toBe('auto.1');
  });
});

/* ==========================================================================
 * 3. THE EVENT TRIGGER, AND THE COOLDOWN THAT MAKES IT SAFE
 * ========================================================================== */

describe('autosave — the objective trigger', () => {
  it('fires when an objective completes, ahead of the interval', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const at = AUTOSAVE_GRACE_TICKS + 10;
    expect(s.evaluate(sample(at - 1)).act).toBe('idle');
    const d = s.evaluate(sample(at, { objectivesComplete: 1 }));
    expect(d).toEqual({ act: 'save', slotId: 'auto.0', trigger: 'objective' });
  });

  it('fires once per objective, not once per frame the objective stays complete', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const at = AUTOSAVE_GRACE_TICKS + 10;
    expect(s.evaluate(sample(at, { objectivesComplete: 1 })).act).toBe('save');
    s.committed(at);
    for (let t = at + 1; t < at + AUTOSAVE_INTERVAL_TICKS; t++) {
      expect(s.evaluate(sample(t, { objectivesComplete: 1 })).act).toBe('idle');
    }
  });

  it('a burst of objectives cannot burn all three slots inside a minute', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const at = AUTOSAVE_GRACE_TICKS + 10;
    let done = 0;
    const fired = run(s, at, at + AUTOSAVE_MIN_GAP_TICKS - 1, 1, (t) => {
      // One objective completing every ten ticks — a mission chain paying out.
      if ((t - at) % 10 === 0) done++;
      return { objectivesComplete: done };
    });
    expect(done).toBeGreaterThan(50);
    // The cooldown is what holds the rollback depth open.
    expect(fired.length).toBe(1);
  });

  it('an objective completed during the grace window never fires later', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    for (let t = 0; t < AUTOSAVE_GRACE_TICKS; t++) {
      s.evaluate(sample(t, { objectivesComplete: 2 }));
    }
    // The high-water mark absorbed it: no save at the moment grace ends.
    expect(s.evaluate(sample(AUTOSAVE_GRACE_TICKS, { objectivesComplete: 2 })).act).toBe('idle');
  });

  it('labels an objective autosave differently from an interval one', () => {
    expect(autosaveLabel('interval', 180)).toBe('Autosave · 3:00');
    expect(autosaveLabel('objective', 754)).toBe('Autosave · Objective · 12:34');
  });
});

/* ==========================================================================
 * 4. THE MATCH MUST NOT STUTTER
 * ========================================================================== */

describe('autosave — deferral off a frame that is already behind', () => {
  it('waits for a frame that is not catching up', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const due = AUTOSAVE_INTERVAL_TICKS;
    expect(s.evaluate(sample(due, { catchingUp: true }))).toEqual({ act: 'defer', trigger: 'interval' });
    expect(s.evaluate(sample(due + 5, { catchingUp: true })).act).toBe('defer');
    expect(s.evaluate(sample(due + 6, { catchingUp: false })).act).toBe('save');
  });

  it('hands a persistently slow frame to the separate browser-idle queue', () => {
    const s = new AutosaveScheduler();
    s.reset(0);
    const due = AUTOSAVE_INTERVAL_TICKS;
    for (let t = due; t < due + AUTOSAVE_DEFER_LIMIT_TICKS; t++) {
      expect(s.evaluate(sample(t, { catchingUp: true })).act).toBe('defer');
    }
    expect(s.evaluate(sample(due + AUTOSAVE_DEFER_LIMIT_TICKS, { catchingUp: true })).act).toBe('save');
  });

  it('the deferral window is short next to the interval it protects', () => {
    expect(AUTOSAVE_DEFER_LIMIT_TICKS).toBeLessThan(AUTOSAVE_INTERVAL_TICKS / 10);
  });
});

/* ==========================================================================
 * 5. THE LOAD BUTTON TELLS THE TRUTH
 * ========================================================================== */

describe('main menu — Load Game is enabled only when there is something to load', () => {
  it('opens the tutorial decision gate instead of immediately starting training', () => {
    recordingStorage();
    publish(null);
    const h = host();
    let opened = 0;
    let started = 0;
    new MainMenuScreen(shellStub({
      openTutorialConfirmation: () => { opened++; },
      startTutorial: async () => { started++; },
    })).mount(h as unknown as HTMLElement);

    buttonsByLabel(h).get('Tutorial')?.click();
    expect(opened).toBe(1);
    expect(started).toBe(0);
  });

  it('reports the requested backend before the deferred title renderer exists', () => {
    expect(menuBackendLabel(undefined, '?gpu=webgpu')).toBe('WebGPU');
    expect(menuBackendLabel(undefined, '')).toBe('WebGL2');
  });

  it('reports the live backend once the title renderer exists', () => {
    expect(menuBackendLabel('webgpu', '')).toBe('WebGPU');
    expect(menuBackendLabel('webgl2-fallback', '?gpu=webgpu')).toBe('WebGPU → WebGL2');
    expect(menuBackendLabel('webgl', '?gpu=webgpu')).toBe('WebGL2');
  });

  it('keeps the original sentence for the empty case', () => {
    expect(loadHint(0)).toBe('No saves');
    expect(loadHint(1)).toBe('1 save');
    expect(loadHint(4)).toBe('4 saves');
  });

  it('is disabled with no save service at all', () => {
    publish(null);
    const h = host();
    const screen = new MainMenuScreen(shellStub());
    screen.mount(h as unknown as HTMLElement);
    const load = buttonsByLabel(h).get('Load Game');
    expect(load).toBeDefined();
    expect(load?.disabled).toBe(true);
    expect(load?.parent?.text()).toContain('No saves');
  });

  it('is disabled when the service exists but holds zero slots', () => {
    publish(new FakeService());
    const h = host();
    new MainMenuScreen(shellStub()).mount(h as unknown as HTMLElement);
    const load = buttonsByLabel(h).get('Load Game');
    expect(load?.disabled).toBe(true);
  });

  it('enables and counts the moment one save exists', () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'auto.0' }));
    publish(svc);

    const h = host();
    let opened = 0;
    new MainMenuScreen(shellStub({ openLoadGame: () => { opened++; } }))
      .mount(h as unknown as HTMLElement);

    const load = buttonsByLabel(h).get('Load Game');
    expect(load?.disabled).toBe(false);
    expect(load?.text()).toContain('1 save');
    load?.click();
    expect(opened).toBe(1);
  });

  it('a disabled button is not clickable and not in the focus ring', () => {
    publish(null);
    const h = host();
    let opened = 0;
    new MainMenuScreen(shellStub({ openLoadGame: () => { opened++; } }))
      .mount(h as unknown as HTMLElement);
    const load = buttonsByLabel(h).get('Load Game');
    load?.click();
    expect(opened).toBe(0);
    expect(load?.hasAttribute('data-vm-focus')).toBe(false);
  });

  it('survives a service whose list() throws, rather than killing the title screen', () => {
    publish({
      list: () => { throw new Error('index unreadable'); },
      canSave: () => true,
      save: async () => meta(),
      load: async () => { /* no-op */ },
      remove: async () => { /* no-op */ },
    });
    expect(saveSlots()).toEqual([]);
    const h = host();
    new MainMenuScreen(shellStub()).mount(h as unknown as HTMLElement);
    expect(buttonsByLabel(h).get('Load Game')?.disabled).toBe(true);
  });

  it('drops index rows written by a build that wrote a different shape', () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'good' }));
    // Three rows that a stale or corrupt index could plausibly contain.
    const junk = [null, { id: 'x' }, { id: 'y', kind: 'weird', label: '', savedAtMs: 1, context: {} }];
    for (const j of junk) svc.rows.push(j as unknown as SaveSlotMeta);
    publish(svc);
    expect(saveSlots().map((s) => s.id)).toEqual(['good']);
  });
});

/* ==========================================================================
 * 6. THE LOAD SCREEN
 * ========================================================================== */

describe('load screen', () => {
  it('lists every slot newest first, with what it takes to choose between two', () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'auto.0', label: 'Older', savedAtMs: 1000 }));
    svc.rows.push(meta({ id: 'manual.a', kind: 'manual', label: 'Newer', savedAtMs: 9000 }));
    publish(svc);

    const h = host();
    new LoadGameScreen(shellStub()).mount(h as unknown as HTMLElement);

    const rows = h.querySelectorAll('.vm-save-row');
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.slotId).toBe('manual.a');
    expect(rows[1].dataset.slotId).toBe('auto.0');

    // Map, faction, clock, credits, real time and size all present on a row.
    const first = rows[0].text();
    expect(first).toContain('Temperate Valley');
    expect(first).toContain('12,480');
    expect(first).toContain('3:00');
    expect(first).toContain('Manual');
  });

  it('says so rather than showing an empty frame when the last slot is gone', () => {
    publish(new FakeService());
    const h = host();
    new LoadGameScreen(shellStub()).mount(h as unknown as HTMLElement);
    expect(h.querySelector('.vm-saves-empty')?.text()).toContain('No saved battles');
  });

  it('deleting takes two clicks and the first one deletes nothing', async () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'auto.0' }));
    publish(svc);

    const h = host();
    new LoadGameScreen(shellStub()).mount(h as unknown as HTMLElement);

    const del = buttonsByLabel(h).get('Delete');
    expect(del).toBeDefined();
    del?.click();
    await settle();
    expect(svc.removed).toEqual([]);
    expect(del?.classList.contains('is-armed')).toBe(true);

    buttonsByLabel(h).get('Confirm?')?.click();
    await settle();
    expect(svc.removed).toEqual(['auto.0']);
    expect(h.querySelector('.vm-saves-empty')).not.toBeNull();
  });

  it('disarms the confirmation on its own, so an armed delete is not a trap', () => {
    let fired = 0;
    const c = new ConfirmButton('Delete', 'Confirm?', () => { fired++; });
    c.root.click();
    expect(c.isArmed()).toBe(true);
    timers.advance(5000);
    expect(c.isArmed()).toBe(false);
    // The click that would have confirmed now only re-arms.
    c.root.click();
    expect(fired).toBe(0);
    c.root.click();
    expect(fired).toBe(1);
  });

  it('surfaces a failed restore instead of leaving the player on a dead screen', async () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'auto.0' }));
    publish(svc);

    const h = host();
    new LoadGameScreen(shellStub({
      loadGame: async () => { throw new Error('That save is corrupt.'); },
    })).mount(h as unknown as HTMLElement);

    buttonsByLabel(h).get('Load')?.click();
    await settle();

    const status = h.querySelector('.vm-saves-status');
    expect(status?.text()).toBe('That save is corrupt.');
    expect(status?.classList.contains('is-bad')).toBe(true);
    // And the other slots are still listed and still clickable.
    expect(h.querySelectorAll('.vm-save-row').length).toBe(1);
  });

  it('surfaces a failed delete too', async () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'auto.0' }));
    svc.mode = 'refuse';
    publish(svc);

    const h = host();
    new LoadGameScreen(shellStub()).mount(h as unknown as HTMLElement);
    buttonsByLabel(h).get('Delete')?.click();
    buttonsByLabel(h).get('Confirm?')?.click();
    await settle();

    expect(h.querySelector('.vm-saves-status')?.text()).toBe('Could not delete.');
    expect(h.querySelectorAll('.vm-save-row').length).toBe(1);
  });
});

/* ==========================================================================
 * 7. THE MANUAL SAVE PANEL
 * ========================================================================== */

describe('save panel', () => {
  it('offers only MANUAL slots to overwrite — an autosave is unreachable from here', () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'auto.0', kind: 'auto', label: 'Autosave · 3:00' }));
    svc.rows.push(meta({ id: 'auto.1', kind: 'auto', label: 'Autosave · 6:00' }));
    svc.rows.push(meta({ id: 'manual.a', kind: 'manual', label: 'Before the push' }));
    publish(svc);

    expect(manualSlots().map((s) => s.id)).toEqual(['manual.a']);

    const p = new SavePanel({ shell: shellStub(), onClose: () => { /* no-op */ } });
    const ids = asStub(p.root).querySelectorAll('.vm-save-row').map((r) => r.dataset.slotId);
    expect(ids).toEqual(['manual.a']);
  });

  it('creates a new slot in one click when nothing is being overwritten', async () => {
    const svc = new FakeService();
    publish(svc);
    const calls: Array<{ label: string; slotId?: string }> = [];

    const p = new SavePanel({
      shell: shellStub({
        saveGame: async (label, slotId) => { calls.push({ label, slotId }); return meta(); },
      }),
      onClose: () => { /* no-op */ },
    });

    buttonsByLabel(asStub(p.root)).get('Save')?.click();
    await settle();

    expect(calls.length).toBe(1);
    expect(calls[0].slotId).toBeUndefined();
    expect(calls[0].label).toBe(suggestedSaveName('temperate-valley', 754));
  });

  it('refuses to overwrite a slot without a second, explicit click', async () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'manual.a', kind: 'manual', label: 'Before the push' }));
    publish(svc);
    const calls: string[] = [];

    const p = new SavePanel({
      shell: shellStub({
        saveGame: async (_label, slotId) => { calls.push(slotId ?? '(new)'); return meta(); },
      }),
      onClose: () => { /* no-op */ },
    });

    buttonsByLabel(asStub(p.root)).get('Select')?.click();
    buttonsByLabel(asStub(p.root)).get('Overwrite')?.click();
    await settle();
    expect(calls).toEqual([]);
    expect(asStub(p.root).text()).toContain('This replaces');

    buttonsByLabel(asStub(p.root)).get('Confirm Overwrite')?.click();
    await settle();
    expect(calls).toEqual(['manual.a']);
  });

  it('typing the name of an existing save arms the same overwrite gate', async () => {
    const svc = new FakeService();
    svc.rows.push(meta({ id: 'manual.a', kind: 'manual', label: 'Before the push' }));
    publish(svc);
    const calls: string[] = [];

    const p = new SavePanel({
      shell: shellStub({
        saveGame: async (_label, slotId) => { calls.push(slotId ?? '(new)'); return meta(); },
      }),
      onClose: () => { /* no-op */ },
    });

    const input = asStub(p.root).querySelector('.vm-save-name-input');
    expect(input).not.toBeNull();
    input!.value = '  Before   the push ';
    input!.dispatch({ type: 'input' });

    // A single click can no longer write: the name collides, so it is an
    // overwrite and it takes the confirmation.
    buttonsByLabel(asStub(p.root)).get('Overwrite')?.click();
    await settle();
    expect(calls).toEqual([]);
    buttonsByLabel(asStub(p.root)).get('Confirm Overwrite')?.click();
    await settle();
    expect(calls).toEqual(['manual.a']);
  });

  it('shows a refusal returned as a VALUE, not just a rejected promise', async () => {
    const svc = new FakeService();
    svc.mode = 'refuse';
    publish(svc);

    const p = new SavePanel({
      // The real `Shell.saveGame` runs the service result through `unwrap`.
      // The type argument is explicit because `svc.save` returns
      // `SaveSlotMeta | SaveRefusalLike`, and inference picks `T` as that WHOLE
      // union — `unwrap` throws on the refusal arm, so naming the success type
      // is what tells the compiler which arm survives.
      shell: shellStub({ saveGame: async () => unwrap<SaveSlotMeta>(await svc.save({
        kind: 'manual', label: 'x', context: CONTEXT,
      })) }),
      onClose: () => { /* no-op */ },
    });

    buttonsByLabel(asStub(p.root)).get('Save')?.click();
    await settle();

    const status = asStub(p.root).querySelector('.vm-saves-status');
    expect(status?.text()).toBe('Storage quota exceeded.');
    expect(status?.classList.contains('is-bad')).toBe(true);
  });

  it('shows a rejected promise too', async () => {
    publish(new FakeService());
    const p = new SavePanel({
      shell: shellStub({ saveGame: async () => { throw new Error('The disk is full.'); } }),
      onClose: () => { /* no-op */ },
    });
    buttonsByLabel(asStub(p.root)).get('Save')?.click();
    await settle();
    expect(asStub(p.root).querySelector('.vm-saves-status')?.text()).toBe('The disk is full.');
  });

  it('never claims a key the name field needs, so typing still works', () => {
    publish(new FakeService());
    const p = new SavePanel({ shell: shellStub(), onClose: () => { /* no-op */ } });
    for (const code of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'KeyA', 'Backspace', 'Space']) {
      expect(p.onKeyDown({ code } as KeyboardEvent)).toBe(false);
    }
    // Enter is the one key it does claim.
    expect(p.onKeyDown({ code: 'Enter' } as KeyboardEvent)).toBe(true);
  });
});

/* ==========================================================================
 * 8. A SAVE IS NOT PROGRESSION
 * ========================================================================== */

describe('saving and loading leaves the profile alone', () => {
  it('writes nothing under the progression profile key during a full UI cycle', async () => {
    const store = recordingStorage();
    store.map.set(PROFILE_STORAGE_KEY, '{"unlocks":["unit.prism"],"missions":{}}');
    const before = store.map.get(PROFILE_STORAGE_KEY);
    store.writes.length = 0;

    const svc = new FakeService();
    svc.rows.push(meta({ id: 'manual.a', kind: 'manual', label: 'Before the push' }));
    publish(svc);

    // Save, list, render the load screen, delete.
    const p = new SavePanel({ shell: shellStub(), onClose: () => { /* no-op */ } });
    buttonsByLabel(asStub(p.root)).get('Save')?.click();
    await settle();

    const h = host();
    new LoadGameScreen(shellStub()).mount(h as unknown as HTMLElement);
    buttonsByLabel(h).get('Delete')?.click();
    buttonsByLabel(h).get('Confirm?')?.click();
    await settle();

    expect(store.writes).not.toContain(PROFILE_STORAGE_KEY);
    expect(store.writes.filter((k) => k.startsWith('voltmarch.profile'))).toEqual([]);
    expect(store.map.get(PROFILE_STORAGE_KEY)).toBe(before);
  });

  it('the context a save carries has no unlock, mission or profile field in it', () => {
    // Everything the shell hands the store, enumerated. A future field that
    // smuggled profile state into a match save would fail here.
    //
    // `armies` joined this list when a four-way save was found to restore onto
    // ground levelled for two. It is a fact about the WORLD the save was taken
    // in — the same category as `mapId` and `seed`, and the same category the
    // rule above is protecting: this list must stay free of unlocks, mission
    // rows and anything else that lives on the profile.
    expect(Object.keys(CONTEXT).sort()).toEqual([
      'aiFaction', 'armies', 'difficulty', 'mapId', 'playerFaction', 'seed', 'speed',
    ]);
  });

  it('Shell.loadGame does not touch the progression module', () => {
    const src = readFileSync(join(ROOT, 'apps/game/src/shell/Shell.ts'), 'utf8');
    const start = src.indexOf('async loadGame(');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('\n  saveCost(', start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    // `startMatch` legitimately BEGINS tracking a match. Nothing in the restore
    // path may reset, rewind or otherwise write the profile.
    expect(body).not.toMatch(/progression\./);
  });

  it('the save index is not stored in the settings store', () => {
    // `src/shell/settings-store.ts` and `src/shell/Settings.ts` belong to
    // another workflow. The index lives in the save store, and the proof is
    // that the settings store declares no storage key for it and normalises no
    // field named for one.
    const src = readFileSync(join(ROOT, 'apps/game/src/shell/settings-store.ts'), 'utf8');
    const keys = [...src.matchAll(/STORAGE_KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).not.toMatch(/save/i);
    expect(src).not.toMatch(/\bSaveSlotMeta\b|\bSaveContext\b|__vmSave/);
  });
});

/* ==========================================================================
 * 9. THE SMALL PURE PIECES
 * ========================================================================== */

describe('formatting', () => {
  it('reports a size a player can compare against a quota', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(640)).toBe('640 B');
    expect(formatBytes(8_120)).toBe('8.1 kB');
    expect(formatBytes(812_000)).toBe('812 kB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });

  it('says how long ago without needing the real clock', () => {
    const t = 1_700_000_000_000;
    expect(formatWhen(t, t)).toBe('just now');
    expect(formatWhen(t, t + 30_000)).toBe('just now');
    expect(formatWhen(t, t + 5 * 60_000)).toBe('5 min ago');
    expect(formatWhen(t, t + 3 * 3_600_000)).toBe('3 h ago');
    expect(formatWhen(t, t + 30 * 3_600_000)).toBe('yesterday');
    expect(formatWhen(t, t + 4 * 86_400_000)).toBe('4 days ago');
    expect(formatWhen(t, t + 400 * 86_400_000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('groups a bank so six digits are readable', () => {
    expect(formatCredits(0)).toBe('0');
    expect(formatCredits(999)).toBe('999');
    expect(formatCredits(12480)).toBe('12,480');
    expect(formatCredits(1234567)).toBe('1,234,567');
    expect(formatCredits(Number.NaN)).toBe('0');
  });

  it('collapses and caps a typed save name', () => {
    expect(sanitizeSaveName('  Before   the push  ')).toBe('Before the push');
    expect(sanitizeSaveName('')).toBe('');
    expect(sanitizeSaveName('x'.repeat(200)).length).toBe(48);
  });

  it('names the rotating slot in a way a player can read', () => {
    expect(formatSlotName('auto.0')).toBe('Slot 1');
    expect(formatSlotName('auto.2')).toBe('Slot 3');
    expect(formatSlotName('manual.abc')).toBe('manual.abc');
  });

  it('turns anything a rejection can carry into a sentence', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('boom')).toBe('boom');
    expect(errorText(new Error(''))).toContain('unknown');
    expect(errorText(undefined)).toContain('unknown');
  });
});

describe('the refusal seam', () => {
  it('recognises the shape src/game/SaveGame.ts already returns', () => {
    expect(isRefusal({ ok: false, code: 'storage', reason: 'Quota exceeded.' })).toBe(true);
    expect(isRefusal({ ok: true, value: 1 })).toBe(false);
    expect(isRefusal(null)).toBe(false);
    expect(isRefusal(meta())).toBe(false);
  });

  it('turns a refusal VALUE into a throw, so it cannot be read as success', () => {
    expect(() => unwrap({ ok: false, reason: 'Quota exceeded.' })).toThrow('Quota exceeded.');
    expect(() => unwrap({ ok: false, reason: '' })).toThrow(/refused/);
    expect(unwrap(meta()).id).toBe('auto.0');
    expect(unwrap(undefined)).toBeUndefined();
  });

  it('a partially published service is treated as no service at all', () => {
    publish({ list: () => [], canSave: () => true } as unknown as SaveService);
    expect(saveService()).toBeNull();
    expect(saveSlots()).toEqual([]);
  });
});

/* ==========================================================================
 * 10. THE SEAM BETWEEN THE TWO HALVES
 *
 * `src/shell/LoadGame.ts` (this workflow) and `src/game/save.system.ts` (the
 * other one) agree by STRUCTURE, not by a shared import — the shell has to
 * compile and boot with `src/game/save.system.ts` deleted, and the `?shot=`
 * harness must never load the shell. Structural agreement with nothing pinning
 * it is exactly how two halves drift apart in silence, so it is pinned here.
 * ========================================================================== */

describe('the front end and the save system agree on the contract', () => {
  const src = readFileSync(join(ROOT, 'apps/game/src/game/save.system.ts'), 'utf8');

  it('the save system publishes the global the shell probes for', () => {
    expect(src).toMatch(/__vmSave\s*=\s*buildFrontEndService\(\)/);
    // And withdraws it, or a disposed match would leave the title screen
    // offering a Save button backed by a dead world.
    expect(src).toMatch(/delete\s*\(globalThis as \{ __vmSave\?: unknown \}\)\.__vmSave/);
  });

  it('publishes every member the probe requires before it will use the service', () => {
    // The five `saveService()` checks, in the object literal that is published.
    for (const member of ['list(', 'canSave(', 'async save(', 'async load(', 'async remove(']) {
      expect(src).toContain(member);
    }
  });

  it('produces every field the load screen renders', () => {
    const fields = Object.keys(meta());
    const start = src.indexOf('function toServiceMeta(');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, start + 900);
    for (const f of fields) expect(block).toMatch(new RegExp(`\\b${f}:`));
  });

  it('reads back every field the shell puts in a save request', () => {
    for (const f of ['request.kind', 'request.label', 'request.context', 'request.slotId', 'request.thumbnail']) {
      expect(src).toContain(f);
    }
  });

  it('honours the slot id the autosave scheduler chose', () => {
    // If the store ignored `slotId` and always picked its own, the shell's
    // rotation — and its promise never to clobber a manual save — would be
    // decoration.
    expect(src).toMatch(/request\.slotId\s*\?\?/);
  });

  it('captures a thumbnail only when the request asks for one', () => {
    // The shell asks only for manual saves, from the pause menu, where the sim
    // is already frozen. An unconditional capture here would put a GPU readback
    // in the middle of every autosave.
    expect(src).toMatch(/request\.thumbnail === true \? await captureThumbnail\(\) : null/);
  });
});

describe('a slot card', () => {
  it('draws a generated plate when no frame was captured, not a grey box', () => {
    const card = slotCard({ slot: meta({ thumbnail: null }), nowMs: 1_700_000_000_000 });
    const thumb = card.querySelector('.vm-save-thumb') as unknown as StubElement;
    expect(thumb.classList.contains('is-generated')).toBe(true);
    expect(thumb.text()).toContain('3:00');
    expect(thumb.text()).toContain('Temperate Valley');
    expect(card.querySelector('img')).toBeNull();
  });

  it('uses a captured frame when there is one', () => {
    const card = slotCard({
      slot: meta({ kind: 'manual', thumbnail: 'data:image/png;base64,AAAA' }),
      nowMs: 1_700_000_000_000,
    });
    const img = card.querySelector('img') as unknown as StubElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toBe('data:image/png;base64,AAAA');
  });

  it('suggests the operation name during a campaign and the map name otherwise', () => {
    expect(suggestedSaveName('temperate-valley', 754))
      .toBe('Temperate Valley · 12:34');
    expect(suggestedSaveName('temperate-valley', 754, 'allies.01.sounding-line'))
      .toBe('Sounding Line · 12:34');
    expect(suggestedSaveName('temperate-valley', 754, 'allies.99.deleted-operation'))
      .toBe('Temperate Valley · 12:34');
  });

  it('identifies a campaign save by chapter and operation instead of only its shared map', () => {
    const card = slotCard({
      slot: meta({
        context: { ...CONTEXT, campaignOperationId: 'allies.01.sounding-line' },
      }),
      nowMs: 1_700_000_000_000,
    }) as unknown as StubElement;

    expect(card.classList.contains('has-campaign')).toBe(true);
    expect(card.classList.contains('is-allies')).toBe(true);
    expect(card.text()).toContain('The Timetable');
    expect(card.text()).toContain('Sounding Line');
    expect(card.text()).toContain('Temperate Valley');
  });
});

describe('title-screen decision modal', () => {
  it('exposes only its declared choices and routes Back through cancel', () => {
    const h = host();
    const ran: string[] = [];
    let cancelled = 0;
    const screen = new MenuDecisionScreen({
      eyebrow: 'Training record',
      title: 'Tutorial',
      body: 'Choose how to proceed.',
      actions: [
        { label: 'Continue', iconName: 'play', run: () => { ran.push('continue'); } },
        { label: 'Reset', iconName: 'restart_alt', run: () => { ran.push('reset'); } },
        { label: 'End', iconName: 'stop_circle', variant: 'danger', run: () => { ran.push('end'); } },
      ],
      cancel: () => { cancelled++; },
    });

    screen.mount(h as unknown as HTMLElement);
    expect([...buttonsByLabel(h).keys()]).toEqual(['Continue', 'Reset', 'End']);
    buttonsByLabel(h).get('Reset')?.click();
    expect(ran).toEqual(['reset']);
    expect(screen.onBack()).toBe(true);
    expect(cancelled).toBe(1);
    expect(h.querySelector('.vm-menu-decision-panel')?.getAttribute('role')).toBe('dialog');
    expect(h.querySelector('.vm-menu-decision-panel')?.getAttribute('aria-modal')).toBe('true');
  });
});

describe('autosave — atomic capture waits behind paint and input', () => {
  it('re-arms a timed-out idle callback instead of forcing a known hitch', () => {
    const callbacks = new Map<number, IdleRequestCallback>();
    let next = 1;
    const w = window as Window & typeof globalThis;
    w.requestIdleCallback = (callback): number => {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    };
    w.cancelIdleCallback = (id): void => { callbacks.delete(id); };
    const work = vi.fn();

    const cancel = deferAutosaveCapture(work);
    const first = callbacks.get(1) as IdleRequestCallback;
    callbacks.delete(1);
    first({ didTimeout: true, timeRemaining: () => 0 });
    expect(work).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(1);

    const second = callbacks.values().next().value as IdleRequestCallback;
    second({ didTimeout: false, timeRemaining: () => AUTOSAVE_IDLE_BUDGET_MS });
    expect(work).toHaveBeenCalledOnce();
    cancel(); // settled cancellation is harmless
    delete (w as Partial<Window>).requestIdleCallback;
    delete (w as Partial<Window>).cancelIdleCallback;
  });

  it('cancels a queued capture when its match goes away', () => {
    const callbacks = new Map<number, IdleRequestCallback>();
    const w = window as Window & typeof globalThis;
    w.requestIdleCallback = (callback): number => { callbacks.set(7, callback); return 7; };
    w.cancelIdleCallback = (id): void => { callbacks.delete(id); };
    const work = vi.fn();

    deferAutosaveCapture(work)();
    expect(callbacks.size).toBe(0);
    expect(work).not.toHaveBeenCalled();
    delete (w as Partial<Window>).requestIdleCallback;
    delete (w as Partial<Window>).cancelIdleCallback;
  });

  it('the live shell queues autosaves but keeps paused manual saves immediate', () => {
    const src = readFileSync(join(ROOT, 'apps/game/src/shell/Shell.ts'), 'utf8');
    const autoStart = src.indexOf('private pollAutosave(');
    const autoEnd = src.indexOf('\n  private cancelQueuedAutosave(', autoStart);
    const auto = src.slice(autoStart, autoEnd);
    expect(auto.indexOf('deferAutosaveCapture(')).toBeGreaterThan(-1);
    expect(auto.indexOf('svc.save({')).toBeGreaterThan(auto.indexOf('deferAutosaveCapture('));

    const manualStart = src.indexOf('async saveGame(');
    const manualEnd = src.indexOf('\n  /**\n   * Restore a slot', manualStart);
    const manual = src.slice(manualStart, manualEnd);
    expect(manual).toContain("kind: 'manual'");
    expect(manual).not.toContain('deferAutosaveCapture(');
  });
});
