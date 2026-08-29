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

class DesktopPointerLock {
  private active = false;
  private enabled = false;
  private x = 0;
  private y = 0;
  private dragTarget: Element | null = null;
  private readonly synthetic = new WeakSet<Event>();
  private readonly cursor = document.createElement('div');

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
    this.cursor.style.display = 'none';
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
      this.cursor.style.display = 'none';
      return;
    }
    this.cursor.style.display = 'block';
    this.placeCursor();
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

    const hit = this.dragTarget ?? document.elementFromPoint(this.x, this.y);
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
    if (event.type === 'pointerdown') this.dragTarget = hit;
    hit.dispatchEvent(forwarded);
    if (event.type === 'pointerup' || event.type === 'pointercancel') this.dragTarget = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private readonly onMouseEvent = (event: MouseEvent): void => {
    if (this.synthetic.has(event) || !this.locked()) return;
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
    hit.dispatchEvent(forwarded);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private placeCursor(): void {
    this.cursor.style.transform = `translate3d(${this.x}px,${this.y}px,0)`;
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
