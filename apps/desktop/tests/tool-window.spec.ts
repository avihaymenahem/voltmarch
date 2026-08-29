import { describe, expect, it } from 'vitest';

import { DEFAULT_DISPLAY, displayForLaunch, type DisplayPrefs } from '../src/display';

describe('desktop developer-tool window policy', () => {
  const playerFullscreen: DisplayPrefs = {
    ...DEFAULT_DISPLAY,
    mode: 'fullscreen',
    width: 2560,
    height: 1440,
    displayIndex: 2,
    alwaysOnTop: true,
  };

  it('does not alter ordinary game display preferences', () => {
    expect(displayForLaunch(playerFullscreen, ['electron', '.']))
      .toBe(playerFullscreen);
  });

  it('gives developer tools a reachable native window independently of player preferences', () => {
    expect(displayForLaunch(playerFullscreen, ['electron', '.', '--vm-tool-window']))
      .toEqual(DEFAULT_DISPLAY);
    expect(playerFullscreen.mode).toBe('fullscreen');
    expect(playerFullscreen.alwaysOnTop).toBe(true);
  });
});
