/**
 * Panel-blur wiring — the seam between three modules that were built apart.
 *
 * `src/render/renderer.ts` owns the POLICY (which is tested in
 * `compositing.spec.ts`). This file tests the WIRING: that a persisted choice
 * survives the store, that `applySettings` pushes it into the policy, and that
 * `?blur=` still wins over a persisted choice — which is the one property that
 * cannot be recovered later, because the URL flag is the only way to A/B the
 * macOS artefact on the affected machine.
 *
 * Node environment. `setPanelBlurMode` records the mode and skips the DOM stamp
 * when there is no `document`, so the routing is observable without a browser.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getPanelBlurMode,
  panelBlurUrlOverride,
  setPanelBlurMode,
} from '../src/render/renderer';

import {
  PANEL_BLUR_CHOICES,
  defaultSettings,
  diffSettings,
  normalizeSettings,
  type PanelBlurChoice,
} from '../src/shell/settings-store';

const ROOT = join(__dirname, '..');

describe('panel blur — store', () => {
  it('defaults to auto', () => {
    expect(defaultSettings().graphics.panelBlur).toBe('auto');
  });

  it('round-trips every legal choice', () => {
    for (const choice of PANEL_BLUR_CHOICES) {
      const s = normalizeSettings({ graphics: { panelBlur: choice } });
      expect(s.graphics.panelBlur).toBe(choice);
    }
  });

  it('falls back to the default for junk, not to a crash', () => {
    for (const junk of [null, 42, 'yes', true, {}, ['off']]) {
      expect(normalizeSettings({ graphics: { panelBlur: junk } }).graphics.panelBlur).toBe('auto');
    }
  });

  it('survives a settings blob written by a build that predates the field', () => {
    // The exact reason SETTINGS_VERSION was not bumped: absence must degrade.
    const old = defaultSettings() as unknown as { graphics: Record<string, unknown> };
    delete old.graphics.panelBlur;
    expect(normalizeSettings(old).graphics.panelBlur).toBe('auto');
  });

  it('reports as a changed path so applySettings can see it', () => {
    const a = defaultSettings();
    const b = normalizeSettings({ ...a, graphics: { ...a.graphics, panelBlur: 'off' } });
    expect(diffSettings(a, b)).toContain('graphics.panelBlur');
  });
});

describe('panel blur — apply', () => {
  it('routes the setting into the renderer policy', async () => {
    const { applySettings } = await import('../src/shell/Settings');
    const before = getPanelBlurMode();

    for (const choice of ['off', 'on', 'auto'] as PanelBlurChoice[]) {
      const s = defaultSettings();
      s.graphics.panelBlur = choice;
      applySettings(s, null, ['graphics.panelBlur']);
      expect(getPanelBlurMode()).toBe(choice);
    }

    setPanelBlurMode(before);
  });

  it('applies with no game handle — the title screen has no renderer', async () => {
    const { applySettings } = await import('../src/shell/Settings');
    const before = getPanelBlurMode();
    const s = defaultSettings();
    s.graphics.panelBlur = 'off';
    // A throw here is the bug the `game !== null` guard would have introduced.
    expect(() => applySettings(s, null, ['graphics.panelBlur'])).not.toThrow();
    expect(getPanelBlurMode()).toBe('off');
    setPanelBlurMode(before);
  });

  it('ignores the setting when it is not in the changed list', async () => {
    const { applySettings } = await import('../src/shell/Settings');
    setPanelBlurMode('on');
    const s = defaultSettings();
    s.graphics.panelBlur = 'off';
    applySettings(s, null, ['audio.master']);
    expect(getPanelBlurMode()).toBe('on');
    setPanelBlurMode('auto');
  });

  it('has no URL override under node, so the branch is live here', () => {
    expect(panelBlurUrlOverride()).toBeNull();
  });
});

describe('panel blur — the ?blur= override cannot be disarmed', () => {
  /**
   * `panelBlurUrlOverride()` is a module-private latch set at boot, so there is
   * no way to fake a URL from node. Assert the guard exists in the source
   * instead — an accidental deletion is exactly the failure this protects
   * against, and it is silent everywhere except the one Mac that needs it.
   */
  it('applySettings guards the push on panelBlurUrlOverride()', () => {
    const src = readFileSync(join(ROOT, 'src/shell/Settings.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const call = /setPanelBlurMode\s*\(/.exec(src);
    expect(call).not.toBeNull();
    const guard = /if\s*\([^{}]*panelBlurUrlOverride\(\)\s*===\s*null[^{}]*\)\s*\{/.exec(src);
    expect(guard).not.toBeNull();
    // The guard must precede the only call, i.e. actually gate it.
    expect(guard!.index).toBeLessThan(call!.index);
  });

  it('the shell applies blur and accessibility at construction, not only at match launch', () => {
    const src = readFileSync(join(ROOT, 'src/shell/Shell.ts'), 'utf8');
    const initial = /applySettings\(\s*this\.settings\.get\(\),\s*null,\s*\[([\s\S]*?)\]\s*\)/.exec(src);
    expect(initial).not.toBeNull();
    expect(initial![1]).toContain("'graphics.panelBlur'");
    expect(initial![1]).toContain("'gameplay.textScale'");
    expect(initial![1]).toContain("'gameplay.highContrast'");
    expect(initial![1]).toContain("'gameplay.reducedMotion'");
  });
});
