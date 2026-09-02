/**
 * ============================================================================
 * tests/hud-wheel-target.spec.ts — THE HUD WAS A WHEEL DEAD ZONE
 * ============================================================================
 * Found while answering "Im trying to play from mac using a trackpad, and cant
 * zoom or scroll on z". It is not the cause of that report — it is
 * device-independent, and a Windows mouse player lost the same fifth of the
 * screen — but it is a real defect and it makes the report's symptom worse
 * whenever the cursor happens to be resting on a panel.
 *
 * THE MECHANISM, WHICH TOOK THREE READS TO PIN DOWN.
 *
 *   1. `#hud-root` is `pointer-events: none` (index.html), so it looks
 *      click-through.
 *   2. `.vm-hud .vm-panel { pointer-events: none }` (src/ui/hud.css) now makes
 *      the generic panel chrome click-through; actual controls opt back in.
 *   3. A wheel over a panel therefore has `e.target` outside the canvas, and
 *      `CameraRig.ownsEvent` refused it.
 *   4. `#hud-root` is a SIBLING of `#app > canvas`, not a descendant, so the
 *      canvas is not on that event's propagation path either and
 *      `InputManager`'s listener could not fire as a fallback.
 *
 * Neither handler ran. Measured live in Chromium at four MacBook-shaped
 * viewports: 25.95% of 1440x900, 23.79% of 1280x700, 21.24% of 1440x789,
 * 19.91% of 1512x850 — one pointer position in five.
 *
 * `CameraRig.ownsWheel` claims a registered surface UNLESS something on the
 * way up can genuinely scroll, which is the half that keeps `.vm-grid` (the
 * build cameo list, `overflow-y: auto`, measured at scrollHeight 640 against
 * clientHeight 425 on a full tab) and `.vm-sel-cards` (`overflow-x: auto`)
 * working.
 *
 * THIS SUITE IS `environment: 'node'` AND jsdom IS NOT INSTALLED — see
 * `tests/lobby-advanced.spec.ts`, which says so and stubs the same way. The
 * DOM below is a stub with real `Node` / `HTMLElement` classes installed on
 * `globalThis`, because `ownsEvent` and `hasScrollableAncestor` both use
 * `instanceof` and a duck-typed object would not satisfy them. The stub is
 * therefore also a check that those `instanceof` guards do what they claim.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { CameraRig } from '../src/render/camera';

/* ==========================================================================
 * A DOM small enough to reason about
 * ========================================================================== */

interface StubStyle { overflowX: string; overflowY: string }

class StubNode {
  parentElement: StubElement | null = null;
}

class StubElement extends StubNode {
  readonly children: StubElement[] = [];
  style: Record<string, string> = {};
  clientWidth = 300;
  clientHeight = 300;
  scrollWidth = 300;
  scrollHeight = 300;
  /** What the stubbed `getComputedStyle` hands back for this element. */
  computed: StubStyle = { overflowX: 'visible', overflowY: 'visible' };

  constructor(readonly name: string) { super(); }

  add(child: StubElement): StubElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(n: unknown): boolean {
    if (n === this) return true;
    let p = (n as StubNode | null)?.parentElement ?? null;
    while (p !== null) {
      if (p === this) return true;
      p = p.parentElement;
    }
    return false;
  }

  /* The handful of members `CameraRig`'s constructor touches. */
  getBoundingClientRect(): DOMRect {
    return {
      left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
  addEventListener(): void { /* the rig is built with attachInput: false */ }
  removeEventListener(): void { /* ditto */ }
}

/** The parts of a WheelEvent `ownsWheel` reads. */
function wheelAt(target: StubNode, timeStamp: number): WheelEvent {
  return {
    target, deltaX: 0, deltaY: 40, deltaZ: 0, deltaMode: 0, timeStamp,
    clientX: 800, clientY: 450,
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as WheelEvent;
}

/**
 * `ownsWheel` is private and `onWheel` is a listener, so the observable is the
 * one the listener uses: did the rig move the camera for an event with this
 * target? A rig that declines returns without touching `targetDistance`.
 */
function claims(rig: CameraRig, target: StubNode, t: number): boolean {
  const before = rig.targetDistance;
  const e = wheelAt(target, t);
  // Mirrors `onWheel`: consult ownership, then hand it to the public handler.
  const owned = (rig as unknown as { ownsWheel(ev: WheelEvent): boolean }).ownsWheel(e);
  if (owned) rig.handleWheel(e);
  return owned && rig.targetDistance !== before;
}

let canvas: StubElement;
let hudRoot: StubElement;
let panel: StubElement;
let label: StubElement;
let grid: StubElement;
let cameo: StubElement;
let menuRoot: StubElement;
let menuScreen: StubElement;

const saved: Record<string, unknown> = {};

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  saved.Node = g.Node;
  saved.HTMLElement = g.HTMLElement;
  saved.getComputedStyle = g.getComputedStyle;
  g.Node = StubNode;
  g.HTMLElement = StubElement;
  g.getComputedStyle = (el: StubElement) => el.computed;
});

afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Node = saved.Node;
  g.HTMLElement = saved.HTMLElement;
  g.getComputedStyle = saved.getComputedStyle;
});

function build(): CameraRig {
  canvas = new StubElement('canvas');
  hudRoot = new StubElement('hud-root');
  panel = hudRoot.add(new StubElement('vm-panel'));
  label = panel.add(new StubElement('vm-sel-title'));
  grid = panel.add(new StubElement('vm-grid'));
  cameo = grid.add(new StubElement('vm-cameo'));
  menuRoot = new StubElement('menu-root');
  menuScreen = menuRoot.add(new StubElement('vm-screen'));

  // The real shapes. `.vm-sel-title` is `overflow: hidden` with an ellipsis,
  // so it OVERFLOWS without scrolling — which is why a size test alone is not
  // enough and the computed overflow has to be read too.
  label.scrollWidth = 900;
  label.clientWidth = 120;
  label.computed = { overflowX: 'hidden', overflowY: 'hidden' };

  const rig = new CameraRig({
    domElement: canvas as unknown as HTMLElement,
    attachInput: false,
    focusX: 256,
    focusZ: 256,
    aspect: 16 / 9,
  });
  rig.setNavigation({ pointerDevice: 'mouse' });
  return rig;
}

/* ==========================================================================
 * 1. THE DEAD ZONE
 * ========================================================================== */

describe('the HUD is no longer a wheel dead zone', () => {
  it('ignores a HUD panel until the surface is registered — the shipped defect', () => {
    const rig = build();
    // This is the OLD behaviour, reproduced: with nothing registered,
    // `ownsWheel` is `ownsEvent` and a panel is not inside the canvas.
    expect(claims(rig, panel, 1000)).toBe(false);
    expect(claims(rig, label, 1100)).toBe(false);
  });

  it('claims a HUD panel once `ui/hud.system.ts` has registered the root', () => {
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    expect(claims(rig, panel, 1000)).toBe(true);
  });

  it('claims a readout that overflows without scrolling', () => {
    // `.vm-sel-title` ellipsis truncation. A size-only test would hand this
    // element's wheel to a scroll that cannot happen.
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    expect(claims(rig, label, 1000)).toBe(true);
  });

  it('still owns the canvas, registered surface or not', () => {
    const rig = build();
    expect(claims(rig, canvas, 1000)).toBe(true);
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    expect(claims(rig, canvas, 2000)).toBe(true);
  });

  it('never claims a menu screen, which is nobody`s registered surface', () => {
    // `#menu-root` is deliberately registered by nothing. A menu is a modal
    // surface and its wheel is its own — and in PvP the pause menu runs with
    // the camera still live on purpose (`Shell.pause`), so claiming it would
    // zoom the battlefield behind an open menu.
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    expect(claims(rig, menuScreen, 1000)).toBe(false);
  });
});

/* ==========================================================================
 * 2. THE SCROLL CONTAINERS KEEP THEIR WHEEL
 * ========================================================================== */

describe('a genuinely scrollable ancestor keeps its wheel', () => {
  it('declines the build cameo list when it actually overflows', () => {
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    grid.computed = { overflowX: 'hidden', overflowY: 'auto' };
    grid.scrollHeight = 640;
    grid.clientHeight = 425;
    expect(claims(rig, cameo, 1000), 'the cameo grid must still scroll').toBe(false);
    expect(claims(rig, grid, 1100)).toBe(false);
  });

  it('claims the same list when it fits, because then nothing scrolls', () => {
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    grid.computed = { overflowX: 'hidden', overflowY: 'auto' };
    grid.scrollHeight = 425;
    grid.clientHeight = 425;
    expect(claims(rig, cameo, 1000)).toBe(true);
  });

  it('declines a horizontal strip too — `.vm-sel-cards` is `overflow-x: auto`', () => {
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    grid.computed = { overflowX: 'auto', overflowY: 'hidden' };
    grid.scrollWidth = 900;
    grid.clientWidth = 300;
    expect(claims(rig, cameo, 1000)).toBe(false);
  });

  it('hands the surface back on `removeWheelSurface`', () => {
    const rig = build();
    const root = hudRoot as unknown as HTMLElement;
    rig.addWheelSurface(root);
    expect(claims(rig, panel, 1000)).toBe(true);
    rig.removeWheelSurface(root);
    expect(claims(rig, panel, 2000)).toBe(false);
  });

  it('re-reads scrollability when the target changes inside the memo window', () => {
    // The memo is keyed on (target, timeStamp) so a gesture pays for one pair
    // of layout reads, not one per event at 120 Hz. A DIFFERENT target inside
    // the window must not inherit the previous verdict.
    const rig = build();
    rig.addWheelSurface(hudRoot as unknown as HTMLElement);
    grid.computed = { overflowX: 'hidden', overflowY: 'auto' };
    grid.scrollHeight = 640;
    grid.clientHeight = 425;
    expect(claims(rig, cameo, 1000)).toBe(false);
    expect(claims(rig, panel, 1008)).toBe(true);
    expect(claims(rig, cameo, 1016)).toBe(false);
  });
});

/* ==========================================================================
 * 3. THE CSS THE PREDICATE IS SOLVING FOR
 *
 * Panels are visual chrome, so their empty surfaces must be click-through.
 * Actual controls and scroll surfaces opt back in; otherwise a panel would
 * steal both the world's command cursor and its pointer events.
 * ========================================================================== */

describe('the CSS that keeps HUD chrome click-through', () => {
  const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('makes panel chrome transparent to battlefield pointer input', () => {
    expect(css).toMatch(/\.vm-hud \.vm-panel\s*\{[^}]*pointer-events:\s*none/);
  });

  it('restores pointer input only for controls and instrument surfaces', () => {
    expect(css).toMatch(/\.vm-hud \.vm-panel :where\([\s\S]*?button,[\s\S]*?canvas,[\s\S]*?\)\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.vm-hud \.vm-super-row\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.vm-hud \.vm-dock-powers\s*\{[^}]*pointer-events:\s*none/);
  });

  it('still mounts the HUD as a SIBLING of the canvas, not inside it', () => {
    // This is the half that stops `InputManager`'s canvas listener acting as a
    // fallback. If the roots are ever nested, re-read the whole file header.
    const app = html.indexOf('<div id="app">');
    const hud = html.indexOf('<div id="hud-root">');
    expect(app).toBeGreaterThan(0);
    expect(hud).toBeGreaterThan(app);
    expect(html.slice(app, hud)).toContain('</div>');
  });

  it('still has a scrollable cameo grid for the predicate to protect', () => {
    expect(css).toMatch(/\.vm-hud \.vm-grid\s*\{[^}]*overflow-y:\s*auto/);
  });
});

/* ==========================================================================
 * 4. THE WIRING
 *
 * Sections 1 and 2 drive `ownsWheel` directly, which proves the PREDICATE and
 * proves nothing about whether anything calls it. Two seams could each be
 * silently reverted with every test above still green — the listener choosing
 * `ownsEvent` again, and `ui/hud.system.ts` never registering the root — so
 * both are read from the source.
 *
 * That is the `Shell.playCampaignBeat` lesson: a value authored, validated,
 * buffered and dropped on one line, with a correct and well-tested producing
 * half. COMMENTS ARE STRIPPED FIRST, because `// this.ownsWheel(e)` contains
 * the token being matched.
 * ========================================================================== */

describe('the wiring, read from the source', () => {
  function stripped(rel: string): string {
    return readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*/gm, '$1');
  }

  it('has the wheel listener consult `ownsWheel`, not `ownsEvent`', () => {
    const src = stripped('../src/render/camera.ts');
    const listener = src.slice(src.indexOf('private onWheel'));
    const body = listener.slice(0, listener.indexOf('};'));
    expect(body).toContain('this.ownsWheel(e)');
    expect(body, 'the listener fell back to the canvas-only filter').not.toContain('ownsEvent');
  });

  it('has the HUD register and unregister its own root', () => {
    const src = stripped('../src/ui/hud.system.ts');
    expect(src).toContain('addWheelSurface');
    expect(src, 'a rig outliving the HUD would claim events for a dead root')
      .toContain('removeWheelSurface');
  });
});
