/** Viewport-clamped, platform-persisted dragging for diagnostic HUD panels. */

import { persistentStorage } from '../platform/storage';

export const PERFORMANCE_PANEL_POSITION_KEY = 'vm.hud.performance.position';

export interface PanelPosition {
  /** 0..1 over the horizontal room left after subtracting panel width. */
  readonly x: number;
  /** 0..1 over the vertical room left after subtracting panel height. */
  readonly y: number;
}

export function clampPanelPosition(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function parseStoredPanelPosition(value: string | null): PanelPosition | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: clampPanelPosition(parsed.x), y: clampPanelPosition(parsed.y) };
  } catch {
    return null;
  }
}

function readPosition(key: string): PanelPosition | null {
  try { return parseStoredPanelPosition(persistentStorage().getItem(key)); }
  catch { return null; }
}

function writePosition(key: string, position: PanelPosition): void {
  try {
    persistentStorage().setItem(key, JSON.stringify({
      x: Number(position.x.toFixed(4)),
      y: Number(position.y.toFixed(4)),
    }));
  } catch {
    // Dragging still works for the current session when persistence is blocked.
  }
}

export class DraggablePanel {
  private readonly target: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly storageKey: string;
  private position: PanelPosition | null;
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private startLeft = 0;
  private startTop = 0;
  private listening = false;

  constructor(target: HTMLElement, handle: HTMLElement, storageKey: string, label: string) {
    this.target = target;
    this.handle = handle;
    this.storageKey = storageKey;
    this.position = readPosition(storageKey);

    handle.setAttribute('data-perf-drag-handle', 'true');
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', label);
    handle.title = `${label} · drag to reposition`;
    handle.style.pointerEvents = 'auto';

    const events = handle as HTMLElement & {
      addEventListener?: HTMLElement['addEventListener'];
      removeEventListener?: HTMLElement['removeEventListener'];
    };
    events.addEventListener?.('pointerdown', this.onPointerDown as EventListener);
    events.addEventListener?.('keydown', this.onKeyDown as EventListener);
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', this.onViewportResize, { passive: true });
    }
  }

  /** Apply the saved position after the panel becomes measurable. */
  restore(): void {
    if (this.position !== null) this.applyRatio(this.position);
  }

  dispose(): void {
    this.stopPointerTracking();
    this.handle.removeEventListener?.('pointerdown', this.onPointerDown as EventListener);
    this.handle.removeEventListener?.('keydown', this.onKeyDown as EventListener);
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('resize', this.onViewportResize);
    }
  }

  private viewportWidth(): number { return Math.max(1, globalThis.innerWidth || 1280); }
  private viewportHeight(): number { return Math.max(1, globalThis.innerHeight || 720); }

  private rect(): DOMRect {
    return this.target.getBoundingClientRect();
  }

  private applyPixels(left: number, top: number): void {
    const rect = this.rect();
    const maxLeft = Math.max(0, this.viewportWidth() - rect.width);
    const maxTop = Math.max(0, this.viewportHeight() - rect.height);
    const safeLeft = Math.max(0, Math.min(maxLeft, left));
    const safeTop = Math.max(0, Math.min(maxTop, top));
    this.target.style.left = `${Math.round(safeLeft)}px`;
    this.target.style.top = `${Math.round(safeTop)}px`;
    this.target.style.right = 'auto';
    this.target.style.bottom = 'auto';
    this.target.style.transform = 'none';
    this.target.classList.add('has-user-position');
    this.position = {
      x: maxLeft > 0 ? safeLeft / maxLeft : 0,
      y: maxTop > 0 ? safeTop / maxTop : 0,
    };
  }

  private applyRatio(position: PanelPosition): void {
    const rect = this.rect();
    const maxLeft = Math.max(0, this.viewportWidth() - rect.width);
    const maxTop = Math.max(0, this.viewportHeight() - rect.height);
    this.applyPixels(position.x * maxLeft, position.y * maxTop);
  }

  private persist(): void {
    if (this.position !== null) writePosition(this.storageKey, this.position);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerId >= 0) return;
    event.preventDefault();
    const rect = this.rect();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startLeft = rect.left;
    this.startTop = rect.top;
    this.target.classList.add('is-dragging');
    try { this.handle.setPointerCapture(event.pointerId); } catch { /* optional */ }
    if (!this.listening) {
      globalThis.addEventListener('pointermove', this.onPointerMove);
      globalThis.addEventListener('pointerup', this.onPointerUp);
      globalThis.addEventListener('pointercancel', this.onPointerUp);
      this.listening = true;
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.applyPixels(
      this.startLeft + event.clientX - this.startX,
      this.startTop + event.clientY - this.startY,
    );
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    try { this.handle.releasePointerCapture(event.pointerId); } catch { /* optional */ }
    this.pointerId = -1;
    this.target.classList.remove('is-dragging');
    this.stopPointerTracking();
    this.persist();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const rect = this.rect();
    const step = event.shiftKey ? 40 : 12;
    let left = rect.left;
    let top = rect.top;
    if (event.key === 'ArrowLeft') left -= step;
    else if (event.key === 'ArrowRight') left += step;
    else if (event.key === 'ArrowUp') top -= step;
    else if (event.key === 'ArrowDown') top += step;
    else return;
    event.preventDefault();
    this.applyPixels(left, top);
    this.persist();
  };

  private readonly onViewportResize = (): void => {
    if (this.position !== null && !this.target.hidden) this.applyRatio(this.position);
  };

  private stopPointerTracking(): void {
    if (!this.listening) return;
    globalThis.removeEventListener('pointermove', this.onPointerMove);
    globalThis.removeEventListener('pointerup', this.onPointerUp);
    globalThis.removeEventListener('pointercancel', this.onPointerUp);
    this.listening = false;
  }
}
