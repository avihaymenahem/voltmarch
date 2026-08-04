/**
 * ============================================================================
 * VOLTMARCH — src/input/Input.ts
 * ============================================================================
 * THE RAW EVENT LAYER. It knows about pixels, buttons and modifier keys, and
 * about nothing else in the game.
 *
 * WHAT THIS OWNS
 * --------------
 *   - left / right / middle button press, release, click, double-click
 *   - drag detection with a dead zone (DRAG_THRESHOLD_PX) and pointer capture,
 *     so a drag that leaves the window still resolves on release
 *   - the drawn marquee (a DOM rectangle — see "WHY DOM" below)
 *   - the keyboard: a live pressed-code set, repeat suppression, and a guard
 *     that never eats a keystroke aimed at a text field
 *   - the live modifier state, refreshed from EVERY event, so the cursor
 *     changes the instant Ctrl goes down without the mouse moving a pixel
 *   - the procedural cursor set and which one is currently applied
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * -----------------------------------
 * Camera pan and zoom. `src/render/camera.ts` already ships WASD/arrows,
 * screen-edge pan, middle-drag world-grab and wheel dolly-toward-cursor, and it
 * does all four correctly and frame-rate independently. Duplicating them here
 * would give the player two pans fighting over one focus point. So:
 *
 *   - we never call preventDefault on wheel (the rig's own listener needs it),
 *   - we never pan; we only REPORT the edge state, because the cursor has to
 *     turn into a scroll arrow when the pointer sits in the edge band,
 *   - middle-button events are forwarded but not consumed.
 *
 * The one thing we do take from the rig is the ground pick: the owner passes in
 * a `GroundPicker`, which is `CameraRig.screenToGround` with the signature
 * flattened to a Float32Array so nothing in this file imports THREE.
 *
 * THE MARQUEE, AND WHO DRAWS IT
 * -----------------------------
 * A selection box is a screen-space 1-px rectangle: drawn as world geometry it
 * would be resampled by the post chain and come out soft and crawling. The HUD
 * module owns a 2D overlay canvas and publishes `overlay.setMarquee` /
 * `clearMarquee` for exactly this, so the owning system hands us that pair
 * through `setMarqueeRenderer` and one canvas draws everything.
 *
 * When no HUD is mounted we fall back to a `position: fixed` div, which is
 * pixel-exact and composited by the browser. Either way the GESTURE — the dead
 * zone, the capture, the normalised rectangle — lives here and only here.
 *
 * FRAME-RATE INDEPENDENCE
 * -----------------------
 * Nothing here integrates over frames. The only clocks are the double-click
 * window and the control-group double-tap window, and both are wall-clock
 * milliseconds — the correct unit for "did the human do that twice quickly".
 *
 * ALLOCATION
 * ----------
 * `PointerInfo`, `DragInfo` and `KeyInfo` are POOLED, module-level singletons.
 * They are valid for the duration of the callback and must never be retained —
 * the same rule the event bus uses in core/events.ts.
 * ============================================================================
 */

import {
  DOUBLE_CLICK_MS, DOUBLE_CLICK_SLOP_PX, DRAG_THRESHOLD_PX,
  MARQUEE_FILL, MARQUEE_GLOW, MARQUEE_MIN_PX, MARQUEE_STROKE,
} from '../core/config';
import { RENDER_CONFIG } from '../render/renderer';

/* ==========================================================================
 * 1. VOCABULARY
 * ========================================================================== */

export const enum MouseButton {
  Left = 0,
  Middle = 1,
  Right = 2,
}

/**
 * Every pointer shape the game can show. The ORDER cursors are centre-hotspot
 * glyphs; the pan cursors are edge arrows; Default/Select are tip-hotspot
 * arrows. Adding one here means adding one case to `paintCursor`.
 */
export const enum CursorKind {
  Default = 0,
  Select = 1,
  Move = 2,
  NoMove = 3,
  Attack = 4,
  ForceAttack = 5,
  AttackMove = 6,
  Harvest = 7,
  Repair = 8,
  Enter = 9,
  Capture = 10,
  Guard = 11,
  Rally = 12,
  Deploy = 13,
  Sell = 14,
  PanN = 15,
  PanNE = 16,
  PanE = 17,
  PanSE = 18,
  PanS = 19,
  PanSW = 20,
  PanW = 21,
  PanNW = 22,
}
export const CURSOR_COUNT = 23;

/** Pooled. Valid only inside the callback that received it. */
export interface PointerInfo {
  /** Client-space pixels. */
  x: number;
  y: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  /** Ground-plane hit under the pointer. Only meaningful when `worldValid`. */
  worldX: number;
  worldY: number;
  worldZ: number;
  worldValid: boolean;
  /** 1 for a single click, 2 once the double-click window has been satisfied. */
  clickCount: number;
}

/** Pooled. Screen-space rectangle, always normalised so min <= max. */
export interface DragInfo {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** True once the box is big enough to be a deliberate marquee. */
  significant: boolean;
}

/** Pooled. */
export interface KeyInfo {
  code: string;
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  repeat: boolean;
}

/**
 * Ground pick. Writes [x, y, z] into `out` and returns false when the ray
 * points at or above the horizon. This is `CameraRig.screenToGround`.
 */
export type GroundPicker = (clientX: number, clientY: number, out: Float32Array) => boolean;

/**
 * Everything the consumer can react to. Returning `true` from `onKeyDown`
 * consumes the key, which suppresses the browser default — that is opt-in so we
 * never accidentally swallow F5 or Ctrl+Shift+I.
 */
export interface InputHandlers {
  onPointerMove?(p: PointerInfo): void;
  onPointerDown?(p: PointerInfo): void;
  /** Press and release inside the dead zone. Never fires after a drag. */
  onClick?(p: PointerInfo): void;
  onDoubleClick?(p: PointerInfo): void;
  onDragStart?(d: DragInfo): void;
  onDragMove?(d: DragInfo): void;
  /** Released after crossing the dead zone. */
  onDragEnd?(d: DragInfo): void;
  /** Window blur / pointercancel while dragging. Nothing is selected. */
  onDragCancel?(): void;
  onWheel?(notches: number, p: PointerInfo): void;
  onKeyDown?(k: KeyInfo): boolean | void;
  onKeyUp?(k: KeyInfo): void;
  /** Focus lost: drop every latched key and mode. */
  onBlur?(): void;
}

export interface InputOptions {
  /** The element that receives pointer events. The GL canvas. */
  element: HTMLElement;
  ground: GroundPicker;
  handlers: InputHandlers;
  /** Attach immediately. Default true. */
  attach?: boolean;
  /** Parent for the marquee element. Defaults to document.body. */
  overlayParent?: HTMLElement | null;
}

/* ==========================================================================
 * 2. POOLED PAYLOADS
 * ========================================================================== */

const POINTER: PointerInfo = {
  x: 0, y: 0, button: -1,
  shift: false, ctrl: false, alt: false, meta: false,
  worldX: 0, worldY: 0, worldZ: 0, worldValid: false,
  clickCount: 1,
};

const DRAG: DragInfo = {
  minX: 0, minY: 0, maxX: 0, maxY: 0,
  button: -1, shift: false, ctrl: false, alt: false, significant: false,
};

const KEY: KeyInfo = {
  code: '', key: '', shift: false, ctrl: false, alt: false, meta: false, repeat: false,
};

/** Scratch for the ground pick. Never escapes this module. */
const GROUND = new Float32Array(3);

/** True for a target that owns the keyboard — a text field, a select, a slider. */
function isTextTarget(t: EventTarget | null): boolean {
  if (t === null) return false;
  const el = t as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/* ==========================================================================
 * 3. THE INPUT MANAGER
 * ========================================================================== */

export class InputManager {
  readonly element: HTMLElement;
  private readonly ground: GroundPicker;
  private readonly handlers: InputHandlers;
  private readonly overlayParent: HTMLElement | null;

  /* -- live pointer state ------------------------------------------------- */
  /** Last known client position. -1 before the pointer has ever entered. */
  pointerX = -1;
  pointerY = -1;
  pointerInside = false;

  shift = false;
  ctrl = false;
  alt = false;
  meta = false;

  /* -- drag state --------------------------------------------------------- */
  private dragButton = -1;
  private dragPointerId = -1;
  private downX = 0;
  private downY = 0;
  private dragging = false;
  /** True once the dead zone was crossed; a click must not fire afterwards. */
  private dragCommitted = false;

  /* -- click / double-click ----------------------------------------------- */
  private lastClickTime = -1e9;
  private lastClickX = 0;
  private lastClickY = 0;
  private lastClickButton = -1;

  /* -- keyboard ----------------------------------------------------------- */
  private readonly keys = new Set<string>();

  /* -- cursor ------------------------------------------------------------- */
  private readonly cursorCss: string[] = [];
  private currentCursor: CursorKind = CursorKind.Default;
  private appliedCursor = -1;

  /* -- marquee ------------------------------------------------------------ */
  private marquee: HTMLDivElement | null = null;
  private marqueeVisible = false;
  /** Installed by the owning system when the HUD's canvas overlay exists. */
  private marqueeShow: ((x0: number, y0: number, x1: number, y1: number) => void) | null = null;
  private marqueeHide: (() => void) | null = null;

  private attached = false;
  private disposed = false;

  constructor(options: InputOptions) {
    this.element = options.element;
    this.ground = options.ground;
    this.handlers = options.handlers;
    this.overlayParent = options.overlayParent ?? (typeof document !== 'undefined' ? document.body : null);

    this.buildCursors();
    if (options.attach !== false) this.attach();
  }

  /* ---------------------------------------------------------------------- */
  /* Queries                                                                */
  /* ---------------------------------------------------------------------- */

  /** True while a physical key is held. Codes are `KeyboardEvent.code`. */
  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True while a marquee is being painted. */
  get isDragging(): boolean {
    return this.dragging && this.dragCommitted;
  }

  /** Which button started the current drag, or -1. */
  get dragButtonId(): number {
    return this.dragButton;
  }

  /**
   * Ground point under the pointer, into `out` as [x, y, z].
   * False when the pointer has never entered or the ray misses the ground.
   */
  worldUnderPointer(out: Float32Array): boolean {
    if (!this.pointerInside || this.pointerX < 0) return false;
    if (!this.ground(this.pointerX, this.pointerY, GROUND)) return false;
    out[0] = GROUND[0];
    out[1] = GROUND[1];
    out[2] = GROUND[2];
    return true;
  }

  /**
   * Screen-edge state as a -1..1 pair in `out` ([right, down]).
   * Returns false when the pointer is not in the edge band. The camera rig does
   * the actual panning; this exists so the cursor can become a scroll arrow,
   * which is the affordance that tells a player edge-scrolling exists at all.
   */
  edgeDirection(out: Float32Array): boolean {
    if (!this.pointerInside || this.dragging) return false;
    // RENDER_CONFIG, not core/config: `CAMERA.edgePanPixels` is the shipping
    // DEFAULT and is 0, while the Options screen writes the LIVE value here.
    // Reading the frozen one meant a player who turned edge scrolling back on
    // got the panning but never the eight scroll-arrow cursors — the affordance
    // that tells them it is on at all.
    const band = RENDER_CONFIG.camera.edgePanPixels;
    if (band <= 0) return false;
    const r = this.element.getBoundingClientRect();
    const px = this.pointerX - r.left;
    const py = this.pointerY - r.top;
    let mx = 0;
    let my = 0;
    if (px <= band) mx = -1;
    else if (px >= r.width - band) mx = 1;
    if (py <= band) my = -1;
    else if (py >= r.height - band) my = 1;
    out[0] = mx;
    out[1] = my;
    return mx !== 0 || my !== 0;
  }

  /** The eight pan cursors, indexed by the edge direction. */
  static panCursor(dx: number, dy: number): CursorKind {
    if (dy < 0) return dx < 0 ? CursorKind.PanNW : dx > 0 ? CursorKind.PanNE : CursorKind.PanN;
    if (dy > 0) return dx < 0 ? CursorKind.PanSW : dx > 0 ? CursorKind.PanSE : CursorKind.PanS;
    return dx < 0 ? CursorKind.PanW : CursorKind.PanE;
  }

  /* ---------------------------------------------------------------------- */
  /* Cursor                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Request a cursor. The DOM is only touched when the shape actually changes. */
  setCursor(kind: CursorKind): void {
    this.currentCursor = kind;
  }

  /**
   * Push the requested cursor to the element. Called once per frame by the
   * owning system — batching it here keeps a hover that flickers between two
   * entities from writing `style.cursor` twice in one frame.
   */
  flushCursor(): void {
    if (this.disposed) return;
    if (this.appliedCursor === this.currentCursor) return;
    this.appliedCursor = this.currentCursor;
    const css = this.cursorCss[this.currentCursor];
    this.element.style.cursor = css !== undefined ? css : 'default';
  }

  /* ---------------------------------------------------------------------- */
  /* Marquee                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Hand the marquee pixels to someone else — the HUD's world overlay canvas
   * publishes exactly this pair (`overlay.setMarquee` / `overlay.clearMarquee`).
   * Once installed, our own DOM rectangle is retired: one box, one owner.
   */
  setMarqueeRenderer(
    show: (x0: number, y0: number, x1: number, y1: number) => void,
    hide: () => void,
  ): void {
    this.marqueeShow = show;
    this.marqueeHide = hide;
    if (this.marquee !== null) {
      this.marquee.remove();
      this.marquee = null;
      this.marqueeVisible = false;
    }
  }

  /** Show/position the marquee. Coordinates are client-space pixels. */
  private showMarquee(minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.marqueeShow !== null) {
      this.marqueeShow(minX, minY, maxX, maxY);
      this.marqueeVisible = true;
      return;
    }
    if (this.marquee === null) this.createMarquee();
    const el = this.marquee;
    if (el === null) return;
    const s = el.style;
    s.left = `${minX}px`;
    s.top = `${minY}px`;
    s.width = `${maxX - minX}px`;
    s.height = `${maxY - minY}px`;
    if (!this.marqueeVisible) {
      s.display = 'block';
      this.marqueeVisible = true;
    }
  }

  private hideMarquee(): void {
    if (!this.marqueeVisible) return;
    this.marqueeVisible = false;
    if (this.marqueeHide !== null) { this.marqueeHide(); return; }
    if (this.marquee !== null) this.marquee.style.display = 'none';
  }

  /* ---------------------------------------------------------------------- */
  /* Payload filling                                                        */
  /* ---------------------------------------------------------------------- */

  /** Refresh the cached modifier state from any event that carries it. */
  private readModifiers(e: MouseEvent | KeyboardEvent | PointerEvent | WheelEvent): void {
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey;
    this.alt = e.altKey;
    this.meta = e.metaKey;
  }

  /** Fill the pooled PointerInfo, including the ground pick. */
  private fillPointer(x: number, y: number, button: number, clickCount: number): PointerInfo {
    const p = POINTER;
    p.x = x;
    p.y = y;
    p.button = button;
    p.shift = this.shift;
    p.ctrl = this.ctrl;
    p.alt = this.alt;
    p.meta = this.meta;
    p.clickCount = clickCount;
    p.worldValid = this.ground(x, y, GROUND);
    p.worldX = GROUND[0];
    p.worldY = GROUND[1];
    p.worldZ = GROUND[2];
    return p;
  }

  private fillDrag(x: number, y: number): DragInfo {
    const d = DRAG;
    d.minX = Math.min(this.downX, x);
    d.maxX = Math.max(this.downX, x);
    d.minY = Math.min(this.downY, y);
    d.maxY = Math.max(this.downY, y);
    d.button = this.dragButton;
    d.shift = this.shift;
    d.ctrl = this.ctrl;
    d.alt = this.alt;
    d.significant = (d.maxX - d.minX) >= MARQUEE_MIN_PX || (d.maxY - d.minY) >= MARQUEE_MIN_PX;
    return d;
  }

  /* ---------------------------------------------------------------------- */
  /* Listeners                                                              */
  /* ---------------------------------------------------------------------- */

  private onPointerDown = (e: PointerEvent): void => {
    this.readModifiers(e);
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;

    this.handlers.onPointerDown?.(this.fillPointer(e.clientX, e.clientY, e.button, 1));

    // The middle button runs through the same drag machinery as the others —
    // it just never paints a marquee. The owning system turns it into the
    // camera's world-grab pan, because we detached the rig's own listeners.
    //
    // A second button pressed mid-drag cancels the drag rather than starting a
    // nonsense second one.
    if (this.dragging) {
      this.cancelDrag();
      return;
    }

    this.dragging = true;
    this.dragCommitted = false;
    this.dragButton = e.button;
    this.dragPointerId = e.pointerId;
    this.downX = e.clientX;
    this.downY = e.clientY;

    // Capture so a drag that leaves the window still delivers move and up.
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // Safari throws for a pointer that is already captured elsewhere. The
      // window-level pointerup fallback covers that case.
    }
    // Stop the browser starting a text/image drag out of the canvas.
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.readModifiers(e);
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerInside = true;

    if (this.dragging && e.pointerId === this.dragPointerId) {
      if (!this.dragCommitted) {
        const dx = e.clientX - this.downX;
        const dy = e.clientY - this.downY;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          this.dragCommitted = true;
          const d = this.fillDrag(e.clientX, e.clientY);
          this.handlers.onDragStart?.(d);
        }
      }
      if (this.dragCommitted) {
        const d = this.fillDrag(e.clientX, e.clientY);
        // Only the LEFT button paints a marquee; a right-drag is a scrub of the
        // order cursor, not a box.
        if (this.dragButton === MouseButton.Left) {
          this.showMarquee(d.minX, d.minY, d.maxX, d.maxY);
        }
        this.handlers.onDragMove?.(d);
        return;
      }
    }

    this.handlers.onPointerMove?.(this.fillPointer(e.clientX, e.clientY, -1, 1));
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.readModifiers(e);
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;

    if (!this.dragging || e.pointerId !== this.dragPointerId) return;

    const button = this.dragButton;
    const committed = this.dragCommitted;
    // Fill the payload BEFORE tearing the drag state down: `fillDrag` reads
    // `dragButton`, and resetting it first would hand every consumer a drag
    // with button -1, which silently matches no branch anywhere.
    const drag = committed ? this.fillDrag(e.clientX, e.clientY) : null;

    this.releaseCapture(e.pointerId);
    this.dragging = false;
    this.dragCommitted = false;
    this.dragButton = -1;
    this.dragPointerId = -1;
    this.hideMarquee();

    if (drag !== null) {
      this.handlers.onDragEnd?.(drag);
      // A drag consumed the gesture; no click, and the double-click chain
      // resets so a drag followed by a click is never read as a double.
      this.lastClickTime = -1e9;
      return;
    }

    // --- a click ---------------------------------------------------------
    const t = nowMs();
    const dx = e.clientX - this.lastClickX;
    const dy = e.clientY - this.lastClickY;
    const isDouble =
      button === this.lastClickButton &&
      t - this.lastClickTime <= DOUBLE_CLICK_MS &&
      dx * dx + dy * dy <= DOUBLE_CLICK_SLOP_PX * DOUBLE_CLICK_SLOP_PX;

    if (isDouble) {
      // Consume the chain so a triple click is not two doubles.
      this.lastClickTime = -1e9;
      this.handlers.onDoubleClick?.(this.fillPointer(e.clientX, e.clientY, button, 2));
    } else {
      this.lastClickTime = t;
      this.lastClickX = e.clientX;
      this.lastClickY = e.clientY;
      this.lastClickButton = button;
      this.handlers.onClick?.(this.fillPointer(e.clientX, e.clientY, button, 1));
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.dragging && e.pointerId === this.dragPointerId) this.cancelDrag();
  };

  private onPointerEnter = (): void => {
    this.pointerInside = true;
  };

  private onPointerLeave = (): void => {
    // A captured drag keeps receiving events outside the element, so leaving
    // mid-drag must not clear the inside flag or edge-pan would engage.
    if (!this.dragging) this.pointerInside = false;
  };

  private onWheel = (e: WheelEvent): void => {
    this.readModifiers(e);
    // We own the zoom now (the rig's listeners are detached), so the page must
    // not scroll underneath. Normalise deltaMode so a Firefox line-scroll and a
    // Chrome pixel-scroll report the same number of notches.
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= 400;
    const notches = Math.max(-3, Math.min(3, delta / 100));
    this.handlers.onWheel?.(notches, this.fillPointer(e.clientX, e.clientY, -1, 1));
  };

  private onContextMenu = (e: MouseEvent): void => {
    // Right-click is an order. The browser menu must never appear over the
    // battlefield. (The camera rig prevents this too, but only while ITS input
    // is attached — in ?shot= mode it is not.)
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTextTarget(e.target)) return;
    this.readModifiers(e);
    const repeat = this.keys.has(e.code) || e.repeat;
    this.keys.add(e.code);

    const k = KEY;
    k.code = e.code;
    k.key = e.key;
    k.shift = e.shiftKey;
    k.ctrl = e.ctrlKey;
    k.alt = e.altKey;
    k.meta = e.metaKey;
    k.repeat = repeat;

    if (this.handlers.onKeyDown?.(k) === true) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.readModifiers(e);
    this.keys.delete(e.code);
    if (isTextTarget(e.target)) return;

    const k = KEY;
    k.code = e.code;
    k.key = e.key;
    k.shift = e.shiftKey;
    k.ctrl = e.ctrlKey;
    k.alt = e.altKey;
    k.meta = e.metaKey;
    k.repeat = false;
    this.handlers.onKeyUp?.(k);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.shift = this.ctrl = this.alt = this.meta = false;
    this.pointerInside = false;
    if (this.dragging) this.cancelDrag();
    this.handlers.onBlur?.();
  };

  private cancelDrag(): void {
    if (this.dragPointerId >= 0) this.releaseCapture(this.dragPointerId);
    const wasCommitted = this.dragCommitted;
    this.dragging = false;
    this.dragCommitted = false;
    this.dragButton = -1;
    this.dragPointerId = -1;
    this.hideMarquee();
    if (wasCommitted) this.handlers.onDragCancel?.();
  }

  private releaseCapture(pointerId: number): void {
    try {
      if (this.element.hasPointerCapture?.(pointerId)) {
        this.element.releasePointerCapture(pointerId);
      }
    } catch {
      // Already released by the browser (window blur, element detached).
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  attach(): void {
    if (this.attached || this.disposed || typeof window === 'undefined') return;
    this.attached = true;
    const el = this.element;

    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove, { passive: true });
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('pointerenter', this.onPointerEnter, { passive: true });
    el.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    // Belt and braces: if capture was refused, the release still lands.
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const el = this.element;

    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('pointerenter', this.onPointerEnter);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);

    this.keys.clear();
    if (this.dragging) this.cancelDrag();
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    if (this.marquee !== null) {
      this.marquee.remove();
      this.marquee = null;
    }
    // Hand the element back exactly as we found it.
    this.element.style.cursor = '';
  }

  /* ---------------------------------------------------------------------- */
  /* DOM construction                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * The fallback marquee: a `position: fixed` 1-px rectangle. Created on first
   * use, and never created at all when a `marqueeRenderer` was installed —
   * which is the normal case once the HUD's overlay canvas exists.
   */
  private createMarquee(): void {
    if (this.marquee !== null || this.overlayParent === null || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'ra-marquee';
    const s = el.style;
    s.position = 'fixed';
    s.display = 'none';
    s.left = '0';
    s.top = '0';
    s.width = '0';
    s.height = '0';
    s.pointerEvents = 'none';
    // Above the canvas (#app z 0) and the HUD root (z 10), below menus (z 20).
    s.zIndex = '15';
    s.border = `1px solid ${MARQUEE_STROKE}`;
    s.background = MARQUEE_FILL;
    s.boxShadow = `0 0 6px ${MARQUEE_GLOW}, inset 0 0 6px ${MARQUEE_GLOW}`;
    s.willChange = 'left, top, width, height';
    this.overlayParent.appendChild(el);
    this.marquee = el;
  }

  /** Bake every cursor to a data-URL once. ~22 tiny canvases, one time. */
  private buildCursors(): void {
    if (typeof document === 'undefined') {
      for (let i = 0; i < CURSOR_COUNT; i++) this.cursorCss.push('default');
      return;
    }
    for (let i = 0; i < CURSOR_COUNT; i++) {
      this.cursorCss.push(bakeCursor(i as CursorKind));
    }
  }
}

/* ==========================================================================
 * 4. PROCEDURAL CURSORS
 *
 * All art in this game is generated from code, cursors included. Every glyph is
 * drawn with a heavy near-black outline first and the bright fill on top, which
 * is the only way a 2-px green chevron stays readable over both a sunlit
 * concrete pad and a black tank shadow.
 *
 * 32x32 with the hotspot in image pixels. Order cursors aim from the centre;
 * the two arrows aim from their tip.
 * ========================================================================== */

const CUR = 32;
const OUTLINE = '#0A0D0F';
const WHITE = '#E8F2F0';
const GREEN = '#38F08A';
const RED = '#FF3B24';
const AMBER = '#FFC64A';
const CYAN = '#7FD8C0';

/** Wall clock in ms. Render-side only — never called from a sim tick. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Stroke the current path twice: fat dark outline, then the bright core. */
function ink(c: CanvasRenderingContext2D, color: string, width: number): void {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = OUTLINE;
  c.lineWidth = width + 2.6;
  c.stroke();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

/** Fill the current path with a dark halo behind it. */
function inkFill(c: CanvasRenderingContext2D, color: string): void {
  c.lineJoin = 'round';
  c.strokeStyle = OUTLINE;
  c.lineWidth = 2.6;
  c.stroke();
  c.fillStyle = color;
  c.fill();
}

/** A filled triangle pointing along (dx,dy) from (x,y). */
function triangle(
  c: CanvasRenderingContext2D,
  x: number, y: number, dx: number, dy: number, size: number, color: string,
): void {
  const px = -dy;
  const py = dx;
  c.beginPath();
  c.moveTo(x + dx * size, y + dy * size);
  c.lineTo(x + px * size * 0.62 - dx * size * 0.35, y + py * size * 0.62 - dy * size * 0.35);
  c.lineTo(x - px * size * 0.62 - dx * size * 0.35, y - py * size * 0.62 - dy * size * 0.35);
  c.closePath();
  inkFill(c, color);
}

/** The classic pointer arrow, tip at (1,1). */
function arrow(c: CanvasRenderingContext2D, color: string): void {
  c.beginPath();
  c.moveTo(1.5, 1.5);
  c.lineTo(1.5, 20.5);
  c.lineTo(6.6, 15.6);
  c.lineTo(9.9, 23.4);
  c.lineTo(13.4, 21.8);
  c.lineTo(10.2, 14.2);
  c.lineTo(17.2, 13.6);
  c.closePath();
  inkFill(c, color);
}

/** Four chevrons radiating from the centre — the "go there" glyph. */
function radialChevrons(c: CanvasRenderingContext2D, color: string, inner: number, outer: number): void {
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI * 0.5;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy;
    const py = dx;
    c.beginPath();
    c.moveTo(16 + dx * inner + px * 4.2, 16 + dy * inner + py * 4.2);
    c.lineTo(16 + dx * outer, 16 + dy * outer);
    c.lineTo(16 + dx * inner - px * 4.2, 16 + dy * inner - py * 4.2);
    ink(c, color, 2.2);
  }
}

/** Crosshair with four corner brackets — the "shoot that" glyph. */
function crosshair(c: CanvasRenderingContext2D, color: string, gap: number, reach: number): void {
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI * 0.5;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    c.beginPath();
    c.moveTo(16 + dx * gap, 16 + dy * gap);
    c.lineTo(16 + dx * reach, 16 + dy * reach);
    ink(c, color, 2.2);
  }
  // Corner brackets sit on the diagonals so they never overlap the arms.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI * 0.5 + Math.PI * 0.25;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const r = reach * 0.92;
    const px = -dy;
    const py = dx;
    c.beginPath();
    c.moveTo(16 + dx * r + px * 3.4, 16 + dy * r + py * 3.4);
    c.lineTo(16 + dx * r, 16 + dy * r);
    c.lineTo(16 + dx * r - px * 3.4, 16 + dy * r - py * 3.4);
    ink(c, color, 2.0);
  }
}

/** Draw one cursor and return the full CSS `cursor` declaration. */
function bakeCursor(kind: CursorKind): string {
  const canvas = document.createElement('canvas');
  canvas.width = CUR;
  canvas.height = CUR;
  const c = canvas.getContext('2d');
  if (c === null) return 'default';
  c.clearRect(0, 0, CUR, CUR);

  // Hotspot in image pixels. Centre for every aimed glyph.
  let hx = 16;
  let hy = 16;

  switch (kind) {
    case CursorKind.Default:
      arrow(c, WHITE);
      hx = 1; hy = 1;
      break;

    case CursorKind.Select:
      arrow(c, CYAN);
      hx = 1; hy = 1;
      break;

    case CursorKind.Move:
      radialChevrons(c, GREEN, 6.5, 13.5);
      c.beginPath();
      c.arc(16, 16, 2.4, 0, Math.PI * 2);
      inkFill(c, GREEN);
      break;

    case CursorKind.NoMove: {
      c.beginPath();
      c.arc(16, 16, 10.5, 0, Math.PI * 2);
      ink(c, RED, 2.6);
      c.beginPath();
      c.moveTo(9, 9);
      c.lineTo(23, 23);
      ink(c, RED, 2.6);
      break;
    }

    case CursorKind.Attack:
      crosshair(c, RED, 5, 13);
      break;

    case CursorKind.ForceAttack:
      crosshair(c, RED, 5, 13);
      c.beginPath();
      c.arc(16, 16, 3.2, 0, Math.PI * 2);
      inkFill(c, RED);
      break;

    case CursorKind.AttackMove:
      crosshair(c, RED, 6, 13);
      // A green chevron riding the crosshair: "walk there, shooting".
      c.beginPath();
      c.moveTo(20.5, 24.5);
      c.lineTo(26, 19);
      c.lineTo(20.5, 13.5);
      ink(c, GREEN, 2.4);
      break;

    case CursorKind.Harvest: {
      // Three ore shards in a cluster.
      const shard = (x: number, y: number, s: number): void => {
        c.beginPath();
        c.moveTo(x, y - s);
        c.lineTo(x + s * 0.72, y);
        c.lineTo(x, y + s);
        c.lineTo(x - s * 0.72, y);
        c.closePath();
        inkFill(c, AMBER);
      };
      shard(16, 14, 8);
      shard(9.5, 20, 5);
      shard(22.5, 20, 5);
      break;
    }

    case CursorKind.Repair:
      // A fat cross. Reads as "mend" at 32 px where a wrench does not.
      c.beginPath();
      c.moveTo(13, 6);
      c.lineTo(19, 6);
      c.lineTo(19, 13);
      c.lineTo(26, 13);
      c.lineTo(26, 19);
      c.lineTo(19, 19);
      c.lineTo(19, 26);
      c.lineTo(13, 26);
      c.lineTo(13, 19);
      c.lineTo(6, 19);
      c.lineTo(6, 13);
      c.lineTo(13, 13);
      c.closePath();
      inkFill(c, GREEN);
      break;

    case CursorKind.Enter:
      // Arrow entering an open bracket.
      c.beginPath();
      c.moveTo(26, 7);
      c.lineTo(21, 7);
      c.lineTo(21, 25);
      c.lineTo(26, 25);
      ink(c, WHITE, 2.4);
      c.beginPath();
      c.moveTo(6, 16);
      c.lineTo(17, 16);
      ink(c, GREEN, 2.4);
      triangle(c, 17, 16, 1, 0, 5.4, GREEN);
      break;

    case CursorKind.Capture:
      // Same bracket, but the arrow carries a flag: "this becomes mine".
      c.beginPath();
      c.moveTo(26, 7);
      c.lineTo(21, 7);
      c.lineTo(21, 25);
      c.lineTo(26, 25);
      ink(c, WHITE, 2.4);
      c.beginPath();
      c.moveTo(8, 25);
      c.lineTo(8, 7);
      ink(c, CYAN, 2.4);
      c.beginPath();
      c.moveTo(8.8, 8);
      c.lineTo(17, 11.5);
      c.lineTo(8.8, 15);
      c.closePath();
      inkFill(c, CYAN);
      break;

    case CursorKind.Guard: {
      // Octagonal ward.
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI * 0.25 + Math.PI * 0.125;
        const x = 16 + Math.cos(a) * 11;
        const y = 16 + Math.sin(a) * 11;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      ink(c, AMBER, 2.4);
      c.beginPath();
      c.arc(16, 16, 3, 0, Math.PI * 2);
      inkFill(c, AMBER);
      break;
    }

    case CursorKind.Rally:
      // Pennant on a pole; hotspot at the pole's foot.
      c.beginPath();
      c.moveTo(9, 30);
      c.lineTo(9, 3);
      ink(c, WHITE, 2.4);
      c.beginPath();
      c.moveTo(10, 4);
      c.lineTo(25, 9);
      c.lineTo(10, 14);
      c.closePath();
      inkFill(c, AMBER);
      hx = 9; hy = 30;
      break;

    case CursorKind.Sell: {
      // Amber plate with a currency glyph. The one cursor where a letterform
      // beats a shape: nothing else reads as "money" at 32 px.
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI * 0.25 + Math.PI * 0.125;
        const x = 16 + Math.cos(a) * 12;
        const y = 16 + Math.sin(a) * 12;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      inkFill(c, AMBER);
      c.font = 'bold 19px "Arial Narrow", "Helvetica Neue", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = OUTLINE;
      c.fillText('$', 16, 17);
      break;
    }

    case CursorKind.Deploy:
      // Four corners folding outward from a core.
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI * 0.5 + Math.PI * 0.25;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const px = -dy;
        const py = dx;
        c.beginPath();
        c.moveTo(16 + dx * 13 + px * 4, 16 + dy * 13 + py * 4);
        c.lineTo(16 + dx * 13, 16 + dy * 13);
        c.lineTo(16 + dx * 13 - px * 4, 16 + dy * 13 - py * 4);
        ink(c, CYAN, 2.2);
      }
      c.beginPath();
      c.rect(12, 12, 8, 8);
      inkFill(c, CYAN);
      break;

    default: {
      // The eight pan arrows. `kind - PanN` walks clockwise from north.
      const step = (kind as number) - (CursorKind.PanN as number);
      const a = -Math.PI * 0.5 + step * Math.PI * 0.25;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      triangle(c, 16 + dx * 4, 16 + dy * 4, dx, dy, 10, WHITE);
      c.beginPath();
      c.moveTo(16 - dx * 11, 16 - dy * 11);
      c.lineTo(16 - dx * 3, 16 - dy * 3);
      ink(c, WHITE, 2.4);
      break;
    }
  }

  return `url(${canvas.toDataURL('image/png')}) ${hx} ${hy}, ${kind === CursorKind.Default ? 'default' : 'crosshair'}`;
}
