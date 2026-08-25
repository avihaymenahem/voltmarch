/** Regression coverage for the three genre-UX seams added together. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { actionById } from '../src/input/ActionCatalogue';
import { cameraBookmarkSlot } from '../src/input/input.system';
import { paintMapPreview } from '../src/shell/MapPreview';
import { MAPS } from '../src/shell/settings-store';

function source(rel: string): string {
  return readFileSync(join(import.meta.dirname, '..', '..', '..', rel), 'utf8');
}

function canvasHarness(): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = [];
  const fn = (name: string) => vi.fn(() => { calls.push(name); });
  const context = {
    fillRect: fn('fillRect'), beginPath: fn('beginPath'), moveTo: fn('moveTo'),
    lineTo: fn('lineTo'), closePath: fn('closePath'), fill: fn('fill'),
    save: fn('save'), restore: fn('restore'), stroke: fn('stroke'),
    bezierCurveTo: fn('bezierCurveTo'), arc: fn('arc'), fillText: fn('fillText'),
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    font: '', textAlign: '', textBaseline: '',
  };
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('skirmish battlefield previews', () => {
  it('renders a deterministic strategic survey for every published map', () => {
    for (const map of MAPS) {
      const a = canvasHarness();
      const b = canvasHarness();
      paintMapPreview(a.canvas, map);
      paintMapPreview(b.canvas, map);
      expect(a.canvas.width).toBe(320);
      expect(a.canvas.height).toBe(176);
      expect(a.calls).toEqual(b.calls);
      expect(a.calls.filter((call) => call === 'fillText')).toHaveLength(map.players);
      expect(a.calls).toContain('fillRect');
      expect(a.calls).toContain('arc');
    }
  });

  it('mounts the selected map survey above the battlefield list', () => {
    const setup = source('apps/game/src/shell/SkirmishSetup.ts');
    expect(setup.indexOf('maps.appendChild(mapPreview(selectedMap))'))
      .toBeLessThan(setup.indexOf("const list = el('div', 'vm-maplist')"));
  });
});

describe('RTS muscle-memory hotkeys', () => {
  it('maps exactly four function-key camera slots', () => {
    expect(['F4', 'F5', 'F6', 'F7', 'F8', 'F9'].map(cameraBookmarkSlot))
      .toEqual([-1, 0, 1, 2, 3, -1]);
    expect(actionById('cam.bookmarkStore')?.fixedChips).toEqual(['Ctrl', 'F5 – F8']);
    expect(actionById('cam.bookmarkRecall')?.fixedChips).toEqual(['F5 – F8']);
  });

  it('ships a live, rebindable idle-harvester cycle on W', () => {
    const action = actionById('sel.idleHarvester');
    expect(action?.binding).toBe('rebindable');
    expect(action?.defaultChord?.code).toBe('KeyW');
    expect(source('apps/game/src/input/input.system.ts')).toContain("case 'sel.idleHarvester':");
  });
});

describe('results replay handoff', () => {
  it('offers the recording captured before the result screen was mounted', () => {
    const end = source('apps/game/src/shell/EndScreen.ts');
    expect(end).toContain('const replay = this.shell.latestReplay()');
    expect(end).toContain("button('Watch Replay'");
    expect(end).toContain('this.shell.startReplay(replay)');

    const shell = source('apps/game/src/shell/Shell.ts');
    expect(shell.indexOf('this.captureReplay();', shell.indexOf('endMatch(')))
      .toBeLessThan(shell.indexOf('new EndScreen(this, full)'));
  });
});
