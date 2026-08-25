import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultSettings, normalizeSettings } from '../src/shell/settings-store';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('interface accessibility settings', () => {
  it('ships a more readable default and defensively normalises persisted values', () => {
    expect(defaultSettings().gameplay.textScale).toBe(1.15);
    expect(defaultSettings().gameplay.highContrast).toBe(false);
    expect(defaultSettings().gameplay.reducedMotion).toBe(false);

    expect(normalizeSettings({ gameplay: { textScale: 8 } }).gameplay.textScale).toBe(1.5);
    expect(normalizeSettings({ gameplay: { textScale: 0 } }).gameplay.textScale).toBe(0.9);
    expect(normalizeSettings({ gameplay: {
      textScale: 1.25, highContrast: true, reducedMotion: true,
    } }).gameplay).toMatchObject({
      textScale: 1.25, highContrast: true, reducedMotion: true,
    });
  });

  it('wires the preference into every interface family instead of one screen', () => {
    const settings = read('apps/game/src/shell/Settings.ts');
    const shell = read('apps/game/src/shell/shell.css');
    const hud = read('apps/game/src/ui/hud.css');
    const tutorial = read('apps/game/src/shell/tutorial.css');
    const updater = read('apps/game/src/shell/desktop-update.css');

    expect(settings).toContain("html.style.setProperty('--vm-text-scale'");
    expect(settings).toContain("root.classList.toggle('vm-high-contrast'");
    expect(settings).toContain("root.classList.toggle('vm-reduced-motion'");
    for (const css of [shell, hud, tutorial, updater]) {
      expect(css).toContain('var(--vm-text-scale, 1)');
    }
    expect(shell).toContain('.vm-shell.vm-high-contrast');
    expect(hud).toContain('.vm-hud.vm-high-contrast');
  });
});
