import { describe, expect, it } from 'vitest';

import {
  clampPanelPosition,
  parseStoredPanelPosition,
} from '../src/ui/DraggablePanel';
import {
  clampPanelHeight,
  parseStoredPanelHeightRatio,
} from '../src/ui/VerticalPanelResize';

describe('persisted HUD panel geometry', () => {
  it('clamps vertical resizing to the configured viewport band', () => {
    expect(clampPanelHeight(20, 1000, 84, 0.54)).toBe(84);
    expect(clampPanelHeight(320, 1000, 84, 0.54)).toBe(320);
    expect(clampPanelHeight(900, 1000, 84, 0.54)).toBe(540);
  });

  it('accepts only finite stored height ratios', () => {
    expect(parseStoredPanelHeightRatio('0.42')).toBe(0.42);
    expect(parseStoredPanelHeightRatio('0')).toBeNull();
    expect(parseStoredPanelHeightRatio('NaN')).toBeNull();
    expect(parseStoredPanelHeightRatio(null)).toBeNull();
  });

  it('restores draggable positions safely inside the viewport', () => {
    expect(clampPanelPosition(-2)).toBe(0);
    expect(clampPanelPosition(2)).toBe(1);
    expect(parseStoredPanelPosition('{"x":0.25,"y":0.75}')).toEqual({ x: 0.25, y: 0.75 });
    expect(parseStoredPanelPosition('{"x":-1,"y":4}')).toEqual({ x: 0, y: 1 });
    expect(parseStoredPanelPosition('broken')).toBeNull();
  });
});
