import { describe, expect, it } from 'vitest';

import {
  clampPanelPosition,
  clampPanelSize,
  movePanelPosition,
  parseStoredPanelPosition,
  resizePanelPosition,
} from '../src/ui/DraggablePanel';
import {
  clampPanelHeight,
  parseStoredPanelHeightRatio,
} from '../src/ui/VerticalPanelResize';
import {
  AspectPanelResize,
  clampAspectPanelWidth,
  parseStoredPanelWidthRatio,
} from '../src/ui/AspectPanelResize';

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

  it('clamps proportional instruments against both viewport axes', () => {
    expect(clampAspectPanelWidth(100, 1600, 900, 220, 0.75, 0.3, 0.72)).toBe(220);
    expect(clampAspectPanelWidth(360, 1600, 900, 220, 0.75, 0.3, 0.72)).toBe(360);
    // Width permits 480, but 72% of 900px at a 0.75 aspect permits 486.
    expect(clampAspectPanelWidth(900, 1600, 900, 220, 0.75, 0.3, 0.72)).toBe(480);
    // A neighbouring instrument and the centered command plate can provide a
    // tighter live boundary than either independent viewport percentage.
    expect(clampAspectPanelWidth(900, 1600, 900, 220, 0.75, 0.3, 0.72, 412)).toBe(412);
  });

  it('keeps sequential compact maximums outside the centered command plate', () => {
    const commandLeft = 505;
    const gap = 8;
    const selectionDefault = 220;
    const map = clampAspectPanelWidth(
      Number.POSITIVE_INFINITY, 1280, 720, 205, 1100 / 1380, 0.30, 0.60,
      commandLeft - selectionDefault - 2 * gap,
    );
    const selection = clampAspectPanelWidth(
      Number.POSITIVE_INFINITY, 1280, 720, 220, 1007 / 1324, 0.34, 0.72,
      commandLeft - map - 2 * gap,
    );
    expect(map).toBe(269);
    expect(selection).toBe(220);
    expect(map + gap + selection).toBeLessThanOrEqual(commandLeft - gap);
  });

  it('reserves enough compact selection height for formations at 1.5x text scale', () => {
    const selectionWidth = 220;
    const plateAspect = 1324 / 1007;
    const panelChrome = 60;
    const fixedBodyContent = 105;
    const availableStatsHeight = selectionWidth * plateAspect - panelChrome - fixedBodyContent;

    expect(availableStatsHeight).toBeGreaterThanOrEqual(124);
  });

  it('keeps the first desktop breakpoint outside the elastic command plate', () => {
    const viewport = 1401;
    const gap = 8;
    const mapMinimum = 220;
    const selectionMinimum = 220;
    const commandWidth = Math.min(409.5, viewport - 912);
    const commandLeft = (viewport - commandWidth) / 2;
    expect(commandWidth).toBe(409.5);
    expect(mapMinimum + gap + selectionMinimum).toBeLessThan(commandLeft - gap);
  });

  it('accepts only finite stored proportional-width ratios', () => {
    expect(parseStoredPanelWidthRatio('0.25')).toBe(0.25);
    expect(parseStoredPanelWidthRatio('0')).toBeNull();
    expect(parseStoredPanelWidthRatio('Infinity')).toBeNull();
    expect(parseStoredPanelWidthRatio(null)).toBeNull();
  });

  it('exposes an authored-size reset for the tactical map hardware', () => {
    expect(AspectPanelResize.prototype.resetToDesignSize).toBeTypeOf('function');
  });

  it('restores draggable positions safely inside the viewport', () => {
    expect(clampPanelPosition(-2)).toBe(0);
    expect(clampPanelPosition(2)).toBe(1);
    expect(parseStoredPanelPosition('{"x":0.25,"y":0.75}')).toEqual({ x: 0.25, y: 0.75 });
    expect(parseStoredPanelPosition('{"x":-1,"y":4}')).toEqual({ x: 0, y: 1 });
    expect(parseStoredPanelPosition('broken')).toBeNull();
  });

  it('restores optional performance-panel dimensions without breaking old position records', () => {
    expect(parseStoredPanelPosition('{"x":0.25,"y":0.75,"width":0.3,"height":0.5}')).toEqual({
      x: 0.25, y: 0.75, width: 0.3, height: 0.5,
    });
    expect(parseStoredPanelPosition('{"x":0.25,"y":0.75,"width":-1,"height":"bad"}')).toEqual({
      x: 0.25, y: 0.75,
    });
    expect(clampPanelSize(40, 180, 900)).toBe(180);
    expect(clampPanelSize(1200, 180, 900)).toBe(900);
    expect(clampPanelSize(420, 180, 900)).toBe(420);
  });

  it('preserves size through drag updates and position through resize updates', () => {
    const resized = resizePanelPosition({ x: 0.25, y: 0.75 }, 0.3, 0.5);
    expect(resized).toEqual({ x: 0.25, y: 0.75, width: 0.3, height: 0.5 });
    const dragged = movePanelPosition(resized, 0.8, 0.1);
    expect(dragged).toEqual({ x: 0.8, y: 0.1, width: 0.3, height: 0.5 });

    // Viewport restore applies the saved size first and then the saved move;
    // this pins that composition to retaining every field in the same record.
    const restoredSize = resizePanelPosition(dragged, dragged.width!, dragged.height!);
    const restored = movePanelPosition(restoredSize, dragged.x, dragged.y);
    expect(restored).toEqual(dragged);
  });
});
