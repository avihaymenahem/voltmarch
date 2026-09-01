/** Proportional resizing for bottom-anchored HUD instruments. */

import { persistentStorage } from '../platform/storage';
import { computeUiScale } from './Chrome';

import './panel-resize.css';

/* The radar and inspector are one authored 1571x738 assembly. The retired
 * per-half preferences cannot be interpreted as the width of that assembly. */
export const JOINED_PANEL_SIZE_KEY = 'vm.hud.radar-selection.width-ratio.v3';

export interface AspectPanelResizeOptions {
  readonly storageKey: string;
  readonly label: string;
  readonly aspectRatio: number;
  /** Authored panel width in HUD design units; descendants scale with the frame. */
  readonly designWidthUnits: number;
  /** Minimum authored pixels at 1x; follows the root HUD scale when enabled. */
  readonly minWidthPx: number;
  readonly scaleMinimumWithUi?: boolean;
  /** Breakpoint-aware authored minimum; takes precedence over the base value. */
  readonly getMinWidthPx?: () => number;
  readonly maxViewportWidthShare: number;
  readonly maxViewportHeightShare: number;
  /** Optional live collision boundary, evaluated for every drag and reflow. */
  readonly getMaxWidthPx?: () => number;
  readonly onWidthChange?: (widthPx: number) => void;
  readonly onCommit?: () => void;
}

export function clampAspectPanelWidth(
  widthPx: number,
  viewportWidth: number,
  viewportHeight: number,
  minWidthPx: number,
  aspectRatio: number,
  maxViewportWidthShare: number,
  maxViewportHeightShare: number,
  collisionMaximumPx = Number.POSITIVE_INFINITY,
): number {
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  const aspect = Math.max(0.01, aspectRatio);
  const minimum = Math.max(1, Math.min(minWidthPx, vw));
  const widthMaximum = Math.floor(vw * maxViewportWidthShare);
  const heightMaximum = Math.floor(vh * maxViewportHeightShare * aspect);
  const collisionMaximum = Number.isFinite(collisionMaximumPx)
    ? Math.floor(collisionMaximumPx)
    : Number.POSITIVE_INFINITY;
  const maximum = Math.max(
    minimum,
    Math.min(widthMaximum, heightMaximum, collisionMaximum),
  );
  return Math.max(minimum, Math.min(maximum, widthPx));
}

export function parseStoredPanelWidthRatio(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : null;
}

function readStoredPanelWidthRatio(key: string): number | null {
  try {
    return parseStoredPanelWidthRatio(persistentStorage().getItem(key));
  } catch {
    return null;
  }
}

function writeStoredPanelWidthRatio(key: string, ratio: number): void {
  try {
    persistentStorage().setItem(key, Math.max(0, Math.min(1, ratio)).toFixed(4));
  } catch {
    // The current-session size remains useful when storage is unavailable.
  }
}

/**
 * A top-right corner handle for a bottom-left anchored panel. Width and height
 * move together, preserving the generated bitmap's live display ratio.
 */
export class AspectPanelResize {
  readonly handle: HTMLElement;

  private readonly target: HTMLElement;
  private readonly options: AspectPanelResizeOptions;
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private startWidth = 0;
  private width = 0;
  private widthRatio = 0;
  private listening = false;
  private disposed = false;

  constructor(target: HTMLElement, options: AspectPanelResizeOptions) {
    this.target = target;
    this.options = options;
    target.classList.add('vm-aspect-resizable');

    const handle = document.createElement('div');
    handle.className = 'vm-panel-corner-handle';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', options.label);
    handle.title = `${options.label} · drag diagonally`;
    handle.addEventListener('pointerdown', this.onPointerDown);
    handle.addEventListener('keydown', this.onKeyDown);
    target.appendChild(handle);
    this.handle = handle;

    const stored = readStoredPanelWidthRatio(options.storageKey);
    if (stored !== null) {
      this.widthRatio = stored;
      this.applyWidth(stored * this.viewportWidth(), false);
    }
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', this.onViewportResize, { passive: true });
    }
    queueMicrotask(() => {
      if (!this.disposed && this.width <= 0) {
        this.updateHandle(this.target.getBoundingClientRect().width);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopPointerTracking();
    this.handle.removeEventListener('pointerdown', this.onPointerDown);
    this.handle.removeEventListener('keydown', this.onKeyDown);
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('resize', this.onViewportResize);
    }
    this.handle.remove();
  }

  private viewportWidth(): number {
    return Math.max(1, globalThis.innerWidth || 1280);
  }

  private viewportHeight(): number {
    return Math.max(1, globalThis.innerHeight || 720);
  }

  private minimumWidth(): number {
    const liveMinimum = this.options.getMinWidthPx?.();
    if (liveMinimum !== undefined && Number.isFinite(liveMinimum) && liveMinimum > 0) {
      return liveMinimum;
    }
    const scale = this.options.scaleMinimumWithUi
      ? computeUiScale(this.viewportHeight())
      : 1;
    return this.options.minWidthPx * scale;
  }

  private applyWidth(rawWidth: number, rememberPreference = true): void {
    const minimum = this.minimumWidth();
    const width = clampAspectPanelWidth(
      rawWidth,
      this.viewportWidth(),
      this.viewportHeight(),
      minimum,
      this.options.aspectRatio,
      this.options.maxViewportWidthShare,
      this.options.maxViewportHeightShare,
      this.options.getMaxWidthPx?.() ?? Number.POSITIVE_INFINITY,
    );
    const height = width / this.options.aspectRatio;
    this.width = width;
    if (rememberPreference) this.widthRatio = width / this.viewportWidth();
    this.target.classList.add('has-user-size');
    this.target.style.setProperty('--vm-user-panel-width', `${Math.round(width)}px`);
    this.target.style.setProperty('--vm-user-panel-height', `${Math.round(height)}px`);
    this.target.style.setProperty(
      '--vm-user-panel-unit',
      `${width / this.options.designWidthUnits}px`,
    );
    this.target.style.setProperty(
      '--vm-user-content-unit',
      `${Math.max(width / this.options.designWidthUnits, computeUiScale(this.viewportHeight()))}px`,
    );
    this.options.onWidthChange?.(width);
    this.updateHandle(width);
  }

  private updateHandle(width: number): void {
    const minimum = this.minimumWidth();
    this.handle.setAttribute('aria-valuenow', String(Math.round(width)));
    this.handle.setAttribute('aria-valuemin', String(Math.round(minimum)));
    this.handle.setAttribute('aria-valuemax', String(Math.round(clampAspectPanelWidth(
      Number.POSITIVE_INFINITY,
      this.viewportWidth(),
      this.viewportHeight(),
      minimum,
      this.options.aspectRatio,
      this.options.maxViewportWidthShare,
      this.options.maxViewportHeightShare,
      this.options.getMaxWidthPx?.() ?? Number.POSITIVE_INFINITY,
    ))));
  }

  /** Reapply the preferred ratio after a viewport or neighbouring-panel move. */
  reflow(): void {
    if (this.widthRatio <= 0) {
      const current = this.target.getBoundingClientRect().width;
      if (current <= 0) return;
      this.widthRatio = current / this.viewportWidth();
    }
    this.applyWidth(this.widthRatio * this.viewportWidth(), false);
  }

  /** Restore the authored size without distorting the panel's fixed aspect. */
  resetToDesignSize(): void {
    this.applyWidth(
      this.options.designWidthUnits * computeUiScale(this.viewportHeight()),
    );
    this.persist();
  }

  private persist(notify = true): void {
    if (this.width <= 0) return;
    writeStoredPanelWidthRatio(this.options.storageKey, this.widthRatio);
    if (notify) this.options.onCommit?.();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerId >= 0) return;
    event.preventDefault();
    const bounds = this.target.getBoundingClientRect();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startWidth = bounds.width;
    this.target.classList.add('is-size-resizing');
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
    const fromX = this.startWidth + event.clientX - this.startX;
    const fromY = this.startWidth + (this.startY - event.clientY) * this.options.aspectRatio;
    const xDelta = Math.abs(fromX - this.startWidth);
    const yDelta = Math.abs(fromY - this.startWidth);
    this.applyWidth(xDelta >= yDelta ? fromX : fromY);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    try { this.handle.releasePointerCapture(event.pointerId); } catch { /* optional */ }
    this.pointerId = -1;
    this.target.classList.remove('is-size-resizing');
    this.stopPointerTracking();
    this.persist();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const bounds = this.target.getBoundingClientRect();
    const current = this.width > 0 ? this.width : bounds.width;
    const step = event.shiftKey ? 40 : 12;
    let next = current;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step;
    else if (event.key === 'Home') next = this.minimumWidth();
    else if (event.key === 'End') next = Number.POSITIVE_INFINITY;
    else return;
    event.preventDefault();
    this.applyWidth(next);
    this.persist();
  };

  private readonly onViewportResize = (): void => {
    this.reflow();
  };

  private stopPointerTracking(): void {
    if (!this.listening) return;
    globalThis.removeEventListener('pointermove', this.onPointerMove);
    globalThis.removeEventListener('pointerup', this.onPointerUp);
    globalThis.removeEventListener('pointercancel', this.onPointerUp);
    this.listening = false;
  }
}
