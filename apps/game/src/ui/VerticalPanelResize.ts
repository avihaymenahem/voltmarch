/** Height-only HUD panel resizing with platform-native persistence. */

import { persistentStorage } from '../platform/storage';
import { computeUiScale } from './Chrome';

import './panel-resize.css';

export const OBJECTIVES_PANEL_HEIGHT_KEY = 'vm.hud.objectives.height-ratio';
export const BUILD_PANEL_HEIGHT_KEY = 'vm.hud.build.height-ratio';

export interface VerticalPanelResizeOptions {
  readonly storageKey: string;
  readonly label: string;
  /** Minimum authored HUD design units, scaled with the current viewport. */
  readonly minHeightUnits: number;
  /** Start at the resize floor when no player preference has been saved. */
  readonly defaultToMinimum?: boolean;
  readonly maxViewportShare: number;
  /** Bottom for top-anchored panels; top for panels anchored to the viewport bottom. */
  readonly edge?: 'top' | 'bottom';
}

export function clampPanelHeight(
  heightPx: number,
  viewportHeight: number,
  minHeightPx: number,
  maxViewportShare: number,
): number {
  const viewport = Math.max(1, viewportHeight);
  const minimum = Math.max(1, Math.min(minHeightPx, viewport));
  const maximum = Math.max(minimum, Math.floor(viewport * maxViewportShare));
  return Math.max(minimum, Math.min(maximum, heightPx));
}

export function parseStoredPanelHeightRatio(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : null;
}

export function readStoredPanelHeightRatio(key: string): number | null {
  try {
    return parseStoredPanelHeightRatio(persistentStorage().getItem(key));
  } catch {
    return null;
  }
}

export function writeStoredPanelHeightRatio(key: string, ratio: number): void {
  try {
    persistentStorage().setItem(key, Math.max(0, Math.min(1, ratio)).toFixed(4));
  } catch {
    // The panel remains resized for this session even if persistence is blocked.
  }
}

/**
 * A dedicated separator rather than CSS `resize`: the hit target spans the
 * panel edge, width can never change, and persistence happens once at release
 * instead of synchronously on every ResizeObserver sample.
 */
export class VerticalPanelResize {
  readonly handle: HTMLElement;

  private readonly target: HTMLElement;
  private readonly options: VerticalPanelResizeOptions;
  private pointerId = -1;
  private startY = 0;
  private startHeight = 0;
  private height = 0;
  /** Player intent, kept even while a smaller viewport temporarily clamps it. */
  private heightRatio = 0;
  private listening = false;
  private disposed = false;

  constructor(target: HTMLElement, options: VerticalPanelResizeOptions) {
    this.target = target;
    this.options = options;
    target.classList.add('vm-height-resizable');

    const handle = document.createElement('div');
    handle.className = 'vm-panel-height-handle';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', options.label);
    handle.dataset.resizeEdge = options.edge ?? 'bottom';
    handle.title = `${options.label} · drag vertically`;
    handle.addEventListener('pointerdown', this.onPointerDown);
    handle.addEventListener('keydown', this.onKeyDown);
    target.appendChild(handle);
    this.handle = handle;

    const stored = readStoredPanelHeightRatio(options.storageKey);
    if (stored !== null) {
      this.heightRatio = stored;
      this.applyHeight(stored * this.viewportHeight(), false);
    } else if (options.defaultToMinimum === true) {
      this.applyHeight(options.minHeightUnits * computeUiScale(this.viewportHeight()));
    }
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', this.onViewportResize, { passive: true });
    }
    queueMicrotask(() => {
      if (!this.disposed && this.height <= 0) {
        this.updateHandle(this.target.getBoundingClientRect().height);
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

  private viewportHeight(): number {
    return Math.max(1, globalThis.innerHeight || 720);
  }

  private applyHeight(rawHeight: number, rememberPreference = true): void {
    const minimum = this.options.minHeightUnits * computeUiScale(this.viewportHeight());
    const height = clampPanelHeight(
      rawHeight,
      this.viewportHeight(),
      minimum,
      this.options.maxViewportShare,
    );
    this.height = height;
    if (rememberPreference) this.heightRatio = height / this.viewportHeight();
    this.target.classList.add('has-user-height');
    this.target.style.setProperty('--vm-user-panel-height', `${Math.round(height)}px`);
    this.target.style.setProperty(
      '--vm-user-panel-max-height',
      `${Math.floor(this.viewportHeight() * this.options.maxViewportShare)}px`,
    );
    this.updateHandle(height);
  }

  private updateHandle(height: number): void {
    const minimum = this.options.minHeightUnits * computeUiScale(this.viewportHeight());
    this.handle.setAttribute('aria-valuenow', String(Math.round(height)));
    this.handle.setAttribute('aria-valuemin', String(Math.round(minimum)));
    this.handle.setAttribute(
      'aria-valuemax',
      String(Math.floor(this.viewportHeight() * this.options.maxViewportShare)),
    );
  }

  private persist(): void {
    if (this.heightRatio <= 0) return;
    writeStoredPanelHeightRatio(this.options.storageKey, this.heightRatio);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerId >= 0) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.startY = event.clientY;
    this.startHeight = this.target.getBoundingClientRect().height;
    this.target.classList.add('is-height-resizing');
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
    const delta = event.clientY - this.startY;
    this.applyHeight(this.startHeight + (this.options.edge === 'top' ? -delta : delta));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    try { this.handle.releasePointerCapture(event.pointerId); } catch { /* optional */ }
    this.pointerId = -1;
    this.target.classList.remove('is-height-resizing');
    this.stopPointerTracking();
    this.persist();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const bounds = this.target.getBoundingClientRect();
    const current = this.height > 0 ? this.height : bounds.height;
    const step = event.shiftKey ? 40 : 12;
    let next = current;
    if (event.key === 'ArrowUp') next += this.options.edge === 'top' ? step : -step;
    else if (event.key === 'ArrowDown') next += this.options.edge === 'top' ? -step : step;
    else if (event.key === 'Home') {
      next = this.options.minHeightUnits * computeUiScale(this.viewportHeight());
    }
    else if (event.key === 'End') next = this.viewportHeight() * this.options.maxViewportShare;
    else return;
    event.preventDefault();
    this.applyHeight(next);
    this.persist();
  };

  private readonly onViewportResize = (): void => {
    if (this.heightRatio <= 0) return;
    this.applyHeight(this.heightRatio * this.viewportHeight(), false);
  };

  private stopPointerTracking(): void {
    if (!this.listening) return;
    globalThis.removeEventListener('pointermove', this.onPointerMove);
    globalThis.removeEventListener('pointerup', this.onPointerUp);
    globalThis.removeEventListener('pointercancel', this.onPointerUp);
    this.listening = false;
  }
}
