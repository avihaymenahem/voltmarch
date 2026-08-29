/** Viewport-clamped, platform-persisted dragging for diagnostic HUD panels. */

import { persistentStorage } from '../platform/storage';

export const PERFORMANCE_PANEL_POSITION_KEY = 'vm.hud.performance.position';

export interface PanelPosition {
  /** 0..1 over the horizontal room left after subtracting panel width. */
  readonly x: number;
  /** 0..1 over the vertical room left after subtracting panel height. */
  readonly y: number;
  /** Optional viewport-relative dimensions. Absent in pre-resize saved data. */
  readonly width?: number;
  readonly height?: number;
}

export function clampPanelPosition(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampPanelSize(value: number, minimum: number, maximum: number): number {
  const lo = Math.max(1, minimum);
  const hi = Math.max(lo, maximum);
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

export function movePanelPosition(
  previous: PanelPosition | null,
  x: number,
  y: number,
): PanelPosition {
  return {
    x: clampPanelPosition(x),
    y: clampPanelPosition(y),
    ...(previous?.width === undefined ? {} : { width: previous.width }),
    ...(previous?.height === undefined ? {} : { height: previous.height }),
  };
}

export function resizePanelPosition(
  previous: PanelPosition | null,
  width: number,
  height: number,
): PanelPosition {
  return {
    x: previous?.x ?? 0,
    y: previous?.y ?? 0,
    width: clampPanelPosition(width),
    height: clampPanelPosition(height),
  };
}

export function parseStoredPanelPosition(value: string | null): PanelPosition | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as {
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    const position: { x: number; y: number; width?: number; height?: number } = {
      x: clampPanelPosition(parsed.x),
      y: clampPanelPosition(parsed.y),
    };
    if (typeof parsed.width === 'number' && Number.isFinite(parsed.width) && parsed.width > 0) {
      position.width = clampPanelPosition(parsed.width);
    }
    if (typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 0) {
      position.height = clampPanelPosition(parsed.height);
    }
    return position;
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
      ...(position.width === undefined ? {} : { width: Number(position.width.toFixed(4)) }),
      ...(position.height === undefined ? {} : { height: Number(position.height.toFixed(4)) }),
    }));
  } catch {
    // Dragging still works for the current session when persistence is blocked.
  }
}

export interface DraggablePanelOptions {
  readonly resizeHandle?: HTMLElement;
  readonly resizeLabel?: string;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidthShare?: number;
  readonly maxHeightShare?: number;
}

export class DraggablePanel {
  private readonly target: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly storageKey: string;
  private readonly resizeHandle: HTMLElement | null;
  private readonly minWidth: number;
  private readonly minHeight: number;
  private readonly maxWidthShare: number;
  private readonly maxHeightShare: number;
  private position: PanelPosition | null;
  private pointerId = -1;
  private pointerMode: 'drag' | 'resize' | null = null;
  private startX = 0;
  private startY = 0;
  private startLeft = 0;
  private startTop = 0;
  private startWidth = 0;
  private startHeight = 0;
  private listening = false;

  constructor(
    target: HTMLElement,
    handle: HTMLElement,
    storageKey: string,
    label: string,
    options: DraggablePanelOptions = {},
  ) {
    this.target = target;
    this.handle = handle;
    this.storageKey = storageKey;
    this.resizeHandle = options.resizeHandle ?? null;
    this.minWidth = Math.max(1, options.minWidth ?? 180);
    this.minHeight = Math.max(1, options.minHeight ?? 140);
    this.maxWidthShare = clampPanelPosition(options.maxWidthShare ?? 0.72);
    this.maxHeightShare = clampPanelPosition(options.maxHeightShare ?? 0.9);
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
    const resize = this.resizeHandle;
    if (resize !== null) {
      resize.setAttribute('data-perf-resize-handle', 'true');
      resize.tabIndex = 0;
      resize.setAttribute('role', 'separator');
      resize.setAttribute('aria-label', options.resizeLabel ?? 'Resize panel');
      resize.title = `${options.resizeLabel ?? 'Resize panel'} · drag from corner`;
      resize.style.pointerEvents = 'auto';
      resize.addEventListener?.('pointerdown', this.onResizePointerDown as EventListener);
      resize.addEventListener?.('keydown', this.onResizeKeyDown as EventListener);
    }
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', this.onViewportResize, { passive: true });
    }
  }

  /** Apply the saved position after the panel becomes measurable. */
  restore(): void {
    if (this.position === null) return;
    this.applySizeRatio(this.position);
    this.applyRatio(this.position);
  }

  dispose(): void {
    this.stopPointerTracking();
    this.handle.removeEventListener?.('pointerdown', this.onPointerDown as EventListener);
    this.handle.removeEventListener?.('keydown', this.onKeyDown as EventListener);
    this.resizeHandle?.removeEventListener?.('pointerdown', this.onResizePointerDown as EventListener);
    this.resizeHandle?.removeEventListener?.('keydown', this.onResizeKeyDown as EventListener);
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
    this.position = movePanelPosition(
      this.position,
      maxLeft > 0 ? safeLeft / maxLeft : 0,
      maxTop > 0 ? safeTop / maxTop : 0,
    );
  }

  private applySizePixels(width: number, height: number): void {
    const rect = this.rect();
    const viewportWidth = this.viewportWidth();
    const viewportHeight = this.viewportHeight();
    const maxWidth = Math.min(
      Math.max(1, viewportWidth - Math.max(0, rect.left)),
      Math.max(this.minWidth, viewportWidth * this.maxWidthShare),
    );
    const maxHeight = Math.min(
      Math.max(1, viewportHeight - Math.max(0, rect.top)),
      Math.max(this.minHeight, viewportHeight * this.maxHeightShare),
    );
    const safeWidth = clampPanelSize(width, Math.min(this.minWidth, maxWidth), maxWidth);
    const safeHeight = clampPanelSize(height, Math.min(this.minHeight, maxHeight), maxHeight);
    this.target.style.width = `${Math.round(safeWidth)}px`;
    this.target.style.height = `${Math.round(safeHeight)}px`;
    this.target.classList.add('has-user-size');
    this.position = resizePanelPosition(
      this.position,
      safeWidth / viewportWidth,
      safeHeight / viewportHeight,
    );
  }

  private applySizeRatio(position: PanelPosition): void {
    if (position.width === undefined || position.height === undefined) return;
    this.applySizePixels(
      position.width * this.viewportWidth(),
      position.height * this.viewportHeight(),
    );
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
    this.pointerMode = 'drag';
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

  private readonly onResizePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerId >= 0 || this.resizeHandle === null) return;
    event.preventDefault();
    const rect = this.rect();
    this.pointerId = event.pointerId;
    this.pointerMode = 'resize';
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startWidth = rect.width;
    this.startHeight = rect.height;
    this.target.classList.add('is-resizing');
    try { this.resizeHandle.setPointerCapture(event.pointerId); } catch { /* optional */ }
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
    if (this.pointerMode === 'resize') {
      this.applySizePixels(
        this.startWidth + event.clientX - this.startX,
        this.startHeight + event.clientY - this.startY,
      );
      this.applyPixels(this.rect().left, this.rect().top);
    } else {
      this.applyPixels(
        this.startLeft + event.clientX - this.startX,
        this.startTop + event.clientY - this.startY,
      );
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const pointerHandle = this.pointerMode === 'resize' ? this.resizeHandle : this.handle;
    try { pointerHandle?.releasePointerCapture(event.pointerId); } catch { /* optional */ }
    this.pointerId = -1;
    this.pointerMode = null;
    this.target.classList.remove('is-dragging');
    this.target.classList.remove('is-resizing');
    this.stopPointerTracking();
    this.persist();
  };

  private readonly onResizeKeyDown = (event: KeyboardEvent): void => {
    const rect = this.rect();
    const step = event.shiftKey ? 40 : 12;
    let width = rect.width;
    let height = rect.height;
    if (event.key === 'ArrowLeft') width -= step;
    else if (event.key === 'ArrowRight') width += step;
    else if (event.key === 'ArrowUp') height -= step;
    else if (event.key === 'ArrowDown') height += step;
    else return;
    event.preventDefault();
    this.applySizePixels(width, height);
    this.applyPixels(rect.left, rect.top);
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
    if (this.position !== null && !this.target.hidden) {
      const position = this.position;
      this.applySizeRatio(position);
      this.applyRatio(position);
    }
  };

  private stopPointerTracking(): void {
    if (!this.listening) return;
    globalThis.removeEventListener('pointermove', this.onPointerMove);
    globalThis.removeEventListener('pointerup', this.onPointerUp);
    globalThis.removeEventListener('pointercancel', this.onPointerUp);
    this.listening = false;
  }
}
