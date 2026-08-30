/**
 * Desktop-only pointer confinement for live gameplay.
 *
 * Electron exposes Chromium's Pointer Lock API, not Win32 ClipCursor. Pointer
 * lock reports relative motion and hides the OS cursor, so this adapter keeps a
 * bounded virtual pointer and redispatches input at the element beneath it.
 * That preserves the RTS's absolute-pointer contract: edge pan, marquee,
 * right-click orders and HUD controls continue to receive client coordinates.
 *
 * The module is inert in browsers. It is armed only through a matching desktop
 * bridge, and releases immediately when a screen covers gameplay, the document
 * becomes hidden, or the window loses focus.
 */

import { desktopBridge } from './desktop';

export interface LockedPointerPoint { readonly x: number; readonly y: number }

export interface LockedCursorVisual {
  readonly image: string;
  readonly hotspotX: number;
  readonly hotspotY: number;
}

export function advanceLockedPointer(
  point: LockedPointerPoint,
  movementX: number,
  movementY: number,
  width: number,
  height: number,
): LockedPointerPoint {
  return {
    x: Math.max(0, Math.min(Math.max(0, width - 1), point.x + movementX)),
    y: Math.max(0, Math.min(Math.max(0, height - 1), point.y + movementY)),
  };
}

/**
 * Read the image and hotspot back out of a CSS cursor declaration. The input
 * layer bakes every contextual order cursor into exactly this standard form;
 * pointer lock hides Chromium's cursor, so the desktop adapter has to paint
 * that same image at the virtual pointer rather than replacing it with one
 * permanent arrow.
 */
export function lockedCursorVisual(css: string): LockedCursorVisual | null {
  const m = css.match(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/,
  );
  if (m === null) return null;
  const image = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  if (image === '') return null;
  return {
    image,
    hotspotX: Number(m[4]),
    hotspotY: Number(m[5]),
  };
}

/** Convert a DOM wheel delta to CSS pixels, matching Chromium's defaults. */
export function lockedWheelPixels(delta: number, mode: number, viewportPixels: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * viewportPixels;
  return delta;
}

export type LockedMouseEventDisposition = 'forward' | 'consume' | 'passthrough';

export interface LockedHoverChanges<T> {
  /** Deepest-first, matching the order a pointer leaves nested elements. */
  readonly leave: readonly T[];
  /** Outermost-first, matching the order a pointer enters nested elements. */
  readonly enter: readonly T[];
}

/**
 * Diff two element paths, both stored leaf-to-root.
 *
 * Pointer lock never moves Chromium's native hit-test cursor, so the browser
 * cannot produce boundary events or CSS :hover for the virtual pointer. This
 * small pure half makes that lifecycle deterministic and independently tested.
 */
export function lockedHoverChanges<T>(
  previous: readonly T[],
  next: readonly T[],
): LockedHoverChanges<T> {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    leave: previous.filter((item) => !nextSet.has(item)),
    enter: [...next].reverse().filter((item) => !previousSet.has(item)),
  };
}

/**
 * Preserve native button semantics while pointer lock reroutes absolute input.
 * Chromium may still emit `click` after a non-primary locked sequence; sending
 * that to an HTML button activates its ordinary left-click handler.
 */
export function lockedMouseEventDisposition(
  type: string,
  button: number,
  lastReleasedButton: number,
  detail: number,
): LockedMouseEventDisposition {
  // Keyboard activation is already targeted at the focused control. Moving it
  // under the virtual cursor would break Enter/Space accessibility.
  if ((type === 'click' || type === 'dblclick') && detail === 0) return 'passthrough';
  if (type === 'contextmenu') return 'forward';
  if (type === 'click' || type === 'dblclick') {
    return button === 0 && lastReleasedButton === 0 ? 'forward' : 'consume';
  }
  return 'consume';
}

class DesktopPointerLock {
  private active = false;
  private enabled = false;
  private x = 0;
  private y = 0;
  private dragTarget: Element | null = null;
  private lastReleasedButton = -1;
  private rightContextMenuForwarded = false;
  private cursorSource: Element | null = null;
  private cursorCss = '';
  private cursorHotspotX = 0;
  private cursorHotspotY = 0;
  /** elementFromPoint leaf through its ancestors, while pointer lock is active. */
  private hoverPath: Element[] = [];
  private readonly synthetic = new WeakSet<Event>();
  private readonly cursor = document.createElement('div');
  private readonly cursorObserver = new MutationObserver(() => this.syncCursorVisual(true));

  constructor() {
    this.cursor.dataset.vmDesktopPointer = 'cursor';
    this.cursor.setAttribute('aria-hidden', 'true');
    this.cursor.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:17px', 'height:23px',
      'pointer-events:none', 'z-index:2147483646', 'display:none',
      'background:#f5f8ff', 'clip-path:polygon(0 0,0 82%,25% 62%,42% 100%,55% 94%,39% 57%,72% 57%)',
      'filter:drop-shadow(0 0 1px #000) drop-shadow(0 1px 2px #000)',
    ].join(';');
    document.documentElement.appendChild(this.cursor);

    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerEvent, true);
    window.addEventListener('pointerup', this.onPointerEvent, true);
    window.addEventListener('pointercancel', this.onPointerEvent, true);
    window.addEventListener('click', this.onMouseEvent, true);
    window.addEventListener('dblclick', this.onMouseEvent, true);
    window.addEventListener('contextmenu', this.onMouseEvent, true);
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    window.addEventListener('blur', this.release);
    window.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  setActive(active: boolean, enabled: boolean): void {
    this.active = active;
    this.enabled = enabled;
    if (!active || !enabled) this.release();
  }

  private locked(): boolean {
    return document.pointerLockElement === document.documentElement;
  }

  private readonly release = (): void => {
    this.dragTarget = null;
    this.lastReleasedButton = -1;
    this.rightContextMenuForwarded = false;
    this.cursorObserver.disconnect();
    this.cursorSource = null;
    this.cursorCss = '';
    this.cursor.style.display = 'none';
    this.updateVirtualHover(null);
    if (this.locked()) document.exitPointerLock();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.release();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Do not consume Escape: the shell still needs it to open the pause menu.
    // Releasing here makes that same key transition restore the OS cursor.
    if (event.key === 'Escape') this.release();
  };

  private readonly onLockChange = (): void => {
    if (!this.locked()) {
      this.dragTarget = null;
      this.lastReleasedButton = -1;
      this.rightContextMenuForwarded = false;
      this.cursorObserver.disconnect();
      this.cursorSource = null;
      this.cursorCss = '';
      this.cursor.style.display = 'none';
      this.updateVirtualHover(null);
      return;
    }
    this.cursor.style.display = 'block';
    this.syncCursorVisual();
    this.placeCursor();
    this.updateVirtualHover(document.elementFromPoint(this.x, this.y));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.synthetic.has(event)) return;
    if (!this.locked()) {
      if (!this.active || !this.enabled || document.hidden || !document.hasFocus()) return;
      this.x = event.clientX;
      this.y = event.clientY;
      void Promise.resolve(document.documentElement.requestPointerLock()).catch(() => undefined);
      return;
    }
    this.routePointer(event);
  };

  private readonly onPointerEvent = (event: PointerEvent): void => {
    if (this.synthetic.has(event) || !this.locked()) return;
    this.routePointer(event);
  };

  private routePointer(event: PointerEvent): void {
    if (event.type === 'pointermove') {
      const next = advanceLockedPointer(
        { x: this.x, y: this.y }, event.movementX, event.movementY,
        window.innerWidth, window.innerHeight,
      );
      this.x = next.x;
      this.y = next.y;
      this.placeCursor();
    }

    const pointed = document.elementFromPoint(this.x, this.y);
    if (event.type === 'pointermove') this.updateVirtualHover(pointed, event);
    const hit = this.dragTarget ?? pointed;
    if (hit === null) return;
    const forwarded = new PointerEvent(event.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      button: event.button,
      buttons: event.buttons,
      clientX: this.x,
      clientY: this.y,
      movementX: event.movementX,
      movementY: event.movementY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    this.synthetic.add(forwarded);
    if (event.type === 'pointerdown') {
      this.dragTarget = hit;
      if (event.button === 2) this.rightContextMenuForwarded = false;
    }
    hit.dispatchEvent(forwarded);
    if (event.type === 'pointermove') this.syncCursorVisual();
    if (event.type === 'pointerup') {
      this.lastReleasedButton = event.button;
      // `contextmenu` is not guaranteed under Chromium pointer lock. HUD build
      // slots use it for cancel, so complete the right-button sequence here.
      if (event.button === 2 && !this.rightContextMenuForwarded) {
        this.forwardContextMenu(hit, event);
      }
    }
    else if (event.type === 'pointercancel') this.lastReleasedButton = -1;
    if (event.type === 'pointerup' || event.type === 'pointercancel') this.dragTarget = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /**
   * Recreate the boundary half of browser hit testing for the virtual cursor.
   *
   * `pointerenter` drives build-tooltips, hover audio and cameo turntables.
   * `.vm-pointer-hover` is the CSS counterpart because untrusted events cannot
   * force Chromium's native `:hover` pseudo-class. The class is placed on the
   * whole ancestry, exactly the set native `:hover` would match.
   */
  private updateVirtualHover(hit: Element | null, source?: PointerEvent): void {
    const next: Element[] = [];
    for (let element = hit; element !== null; element = element.parentElement) next.push(element);
    const changes = lockedHoverChanges(this.hoverPath, next);
    const relatedForLeave = hit;
    const relatedForEnter = this.hoverPath[0] ?? null;

    for (const element of changes.leave) {
      element.classList.remove('vm-pointer-hover');
      element.dispatchEvent(this.pointerBoundaryEvent('pointerleave', relatedForLeave, source));
    }
    for (const element of changes.enter) {
      element.classList.add('vm-pointer-hover');
      element.dispatchEvent(this.pointerBoundaryEvent('pointerenter', relatedForEnter, source));
    }
    this.hoverPath = next;
  }

  private pointerBoundaryEvent(
    type: 'pointerenter' | 'pointerleave',
    relatedTarget: EventTarget | null,
    source?: PointerEvent,
  ): PointerEvent {
    return new PointerEvent(type, {
      bubbles: false,
      cancelable: false,
      composed: true,
      pointerId: source?.pointerId ?? 1,
      pointerType: source?.pointerType ?? 'mouse',
      isPrimary: source?.isPrimary ?? true,
      buttons: source?.buttons ?? 0,
      clientX: this.x,
      clientY: this.y,
      ctrlKey: source?.ctrlKey ?? false,
      shiftKey: source?.shiftKey ?? false,
      altKey: source?.altKey ?? false,
      metaKey: source?.metaKey ?? false,
      relatedTarget,
    });
  }

  private readonly onMouseEvent = (event: MouseEvent): void => {
    if (this.synthetic.has(event) || !this.locked()) return;
    // A native contextmenu sometimes follows the one completed on pointerup.
    // Forwarding both would remove two production items for one right-click.
    if (event.type === 'contextmenu' && event.button === 2 && this.lastReleasedButton === 2
      && this.rightContextMenuForwarded) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const disposition = lockedMouseEventDisposition(
      event.type, event.button, this.lastReleasedButton, event.detail,
    );
    if (disposition === 'passthrough') return;
    if (disposition === 'consume') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const hit = document.elementFromPoint(this.x, this.y);
    if (hit === null) return;
    const forwarded = new MouseEvent(event.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: event.button,
      buttons: event.buttons,
      clientX: this.x,
      clientY: this.y,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    this.synthetic.add(forwarded);
    hit.dispatchEvent(forwarded);
    if (event.type === 'contextmenu' && event.button === 2) {
      this.rightContextMenuForwarded = true;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.synthetic.has(event) || !this.locked()) return;
    const hit = document.elementFromPoint(this.x, this.y);
    if (hit === null) return;
    const forwarded = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      composed: true,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: this.x,
      clientY: this.y,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    this.synthetic.add(forwarded);
    // Untrusted/synthetic wheel events never invoke the browser's scrolling
    // default. If no listener claimed the event (the camera claims the world),
    // reproduce that default for the nearest overflowing HUD surface.
    if (hit.dispatchEvent(forwarded)) this.scrollWheelTarget(hit, event);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private forwardContextMenu(hit: Element, source: PointerEvent): void {
    const forwarded = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 2,
      buttons: 0,
      clientX: this.x,
      clientY: this.y,
      ctrlKey: source.ctrlKey,
      shiftKey: source.shiftKey,
      altKey: source.altKey,
      metaKey: source.metaKey,
    });
    this.synthetic.add(forwarded);
    this.rightContextMenuForwarded = true;
    hit.dispatchEvent(forwarded);
  }

  private scrollWheelTarget(hit: Element, event: WheelEvent): void {
    let dx = lockedWheelPixels(event.deltaX, event.deltaMode, window.innerWidth);
    let dy = lockedWheelPixels(event.deltaY, event.deltaMode, window.innerHeight);
    if (event.shiftKey && dx === 0) { dx = dy; dy = 0; }

    let el: HTMLElement | null = hit instanceof HTMLElement ? hit : hit.parentElement;
    while (el !== null) {
      const style = getComputedStyle(el);
      const scrolls = (overflow: string): boolean => (
        overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
      );
      if (dy !== 0 && scrolls(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        const before = el.scrollTop;
        el.scrollTop += dy;
        if (el.scrollTop !== before) return;
      }
      if (dx !== 0 && scrolls(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        const before = el.scrollLeft;
        el.scrollLeft += dx;
        if (el.scrollLeft !== before) return;
      }
      el = el.parentElement;
    }
  }

  private syncCursorVisual(force = false): void {
    const hit = document.elementFromPoint(this.x, this.y);
    if (hit === null) return;
    if (hit !== this.cursorSource) {
      this.cursorObserver.disconnect();
      this.cursorObserver.observe(hit, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    const inline = hit instanceof HTMLElement ? hit.style.cursor.trim() : '';
    let css = inline;
    if (css === '') {
      if (!force && hit === this.cursorSource) return;
      css = getComputedStyle(hit).cursor;
    }
    if (hit === this.cursorSource && css === this.cursorCss) return;
    this.cursorSource = hit;
    this.cursorCss = css;

    const visual = lockedCursorVisual(css);
    if (visual === null) {
      this.cursorHotspotX = 0;
      this.cursorHotspotY = 0;
      this.cursor.style.width = '17px';
      this.cursor.style.height = '23px';
      this.cursor.style.background = '#f5f8ff';
      this.cursor.style.clipPath = 'polygon(0 0,0 82%,25% 62%,42% 100%,55% 94%,39% 57%,72% 57%)';
      this.cursor.style.filter = 'drop-shadow(0 0 1px #000) drop-shadow(0 1px 2px #000)';
    } else {
      this.cursorHotspotX = visual.hotspotX;
      this.cursorHotspotY = visual.hotspotY;
      this.cursor.style.width = '32px';
      this.cursor.style.height = '32px';
      this.cursor.style.background = `url("${visual.image.replaceAll('"', '\\"')}") center / 32px 32px no-repeat`;
      this.cursor.style.clipPath = 'none';
      this.cursor.style.filter = 'none';
    }
    this.placeCursor();
  }

  private placeCursor(): void {
    this.cursor.style.transform = `translate3d(${this.x - this.cursorHotspotX}px,${this.y - this.cursorHotspotY}px,0)`;
  }
}

const controller = typeof document !== 'undefined' && desktopBridge() !== null
  ? new DesktopPointerLock()
  : null;
let activationRevision = 0;

/** Arm/disarm confinement as the shell enters or leaves unobstructed gameplay. */
export function setDesktopPointerLockActive(active: boolean): void {
  const revision = ++activationRevision;
  if (controller === null) return;
  if (!active) {
    controller.setActive(false, false);
    return;
  }
  const bridge = desktopBridge();
  if (bridge === null) return;
  void bridge.displayState().then((state) => {
    if (revision !== activationRevision) return;
    controller.setActive(true, state.lockPointer);
  }).catch(() => controller.setActive(false, false));
}
