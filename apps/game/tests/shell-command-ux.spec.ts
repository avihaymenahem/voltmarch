/** Focused contracts for the unified command shell and its new player exits. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CREDITS } from '../src/shell/MainMenu';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const source = (name: string): string => readFileSync(join(ROOT, 'apps/game/src/shell', name), 'utf8');

describe('command shell navigation contracts', () => {
  it('keeps play routes in a cinematic spine and system routes in one quiet strip', () => {
    const menu = source('MainMenu.ts');
    expect(menu).toContain("el('header', 'vm-cinematic-topbar')");
    expect(menu).toContain("el('main', 'vm-cinematic-play')");
    expect(menu).toContain("el('nav', 'vm-menu-nav vm-cinematic-modes')");
    expect(menu).toContain("el('div', 'vm-cinematic-secondary')");
    expect(menu).toContain("control.classList.add('vm-cinematic-mode'");
    expect(menu).toContain("control.classList.add('vm-cinematic-top-action')");
    expect(menu).not.toContain("el('section', 'vm-command-deck')");
  });

  it('gives every shared page a simple back-and-title header without fake telemetry', () => {
    const shell = source('Shell.ts');
    expect(shell).toContain("el('div', 'vm-page-title-block')");
    expect(shell).toContain("back.classList.add('is-page-back')");
    expect(shell).not.toContain('COMMAND INTERFACE // SECURE');
    expect(shell).not.toContain('SYSTEM READY');
  });

  it('uses route archetypes instead of presenting every internal page as one generic frame', () => {
    expect(source('Settings.ts')).toContain("frame.root.classList.add('vm-settings-panel')");
    expect(source('Profile.ts')).toContain("frame.root.classList.add('vm-profile-panel')");
    expect(source('SkirmishSetup.ts')).toContain("'vm-operation-panel', 'vm-skirmish-panel'");
    expect(source('MultiplayerSetup.ts')).toContain("'vm-operation-panel', 'vm-mp-panel'");
    expect(source('LoadGame.ts')).toContain("'vm-operation-panel', 'vm-archive-panel', 'vm-saves-panel'");
    expect(source('Replays.ts')).toContain("'vm-operation-panel', 'vm-archive-panel', 'vm-replays-panel'");
  });

  it('runs real route and settings-content transitions with reduced-motion escape hatches', () => {
    const shell = source('Shell.ts');
    const settings = source('Settings.ts');
    const css = source('shell.css');
    expect(shell).toContain("snapshot.classList.add('is-exit-snapshot')");
    expect(shell).toContain("layer.classList.add('is-entering')");
    expect(shell).toContain("previous.unmount();");
    expect(shell).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(shell).toContain("typeof window.matchMedia === 'function'");
    expect(settings).toContain("body.classList.add('is-tab-entering')");
    expect(css).toContain('.vm-shell .vm-screen.is-entering');
    expect(css).toContain('.vm-shell .vm-screen.is-out');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('offers process Quit only through the validated desktop bridge', () => {
    const menu = source('MainMenu.ts');
    expect(menu).toContain('const desktop = desktopBridge()');
    expect(menu).toContain('if (desktop !== null)');
    expect(menu).toContain('onClick: () => desktop.quit()');
    expect(menu).not.toContain('window.close()');
  });

  it('keeps the main-menu utility actions readable instead of squeezing them into tiny cells', () => {
    const css = source('shell.css');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('font-size: calc(11px * var(--vm-text-scale, 1))');
    expect(css).toContain('.vm-cinematic-top-action:disabled');
  });

  it('centres each main-menu label and hint as one aligned text block', () => {
    const css = source('shell.css');
    expect(css).toContain('grid-template-rows: auto auto;');
    expect(css).toContain('align-content: center;');
    expect(css).toContain('row-gap: 2px;');
  });

  it('keeps leaving the match distinct from garrison evacuation', () => {
    const pause = source('PauseMenu.ts');
    expect(pause).toContain("button('Quit To Menu'");
    expect(pause).not.toContain('Evacuate To Main Menu');
    expect(pause).not.toContain('vm-pause-evacuate');
    expect(pause).toContain("next.root.classList.add('is-overlay-entering')");
    expect(pause).toContain("snapshot.classList.add('is-overlay-snapshot')");
  });
});

describe('commander identity is one persisted profile field', () => {
  it('reads and writes the same settings field used by multiplayer', () => {
    const profile = source('Profile.ts');
    const multiplayer = source('MultiplayerSetup.ts');
    for (const text of [profile, multiplayer]) {
      expect(text).toContain('gameplay.commanderName');
      expect(text).toContain('gameplay: { commanderName:');
      expect(text).toContain('normalizeCommanderName');
    }
    expect(profile).toContain("role', 'status'");
    expect(profile).toContain("aria-live', 'polite'");
    expect(profile).not.toContain('localStorage');
  });
});

describe('production ledger credits', () => {
  it('gives every truthful credit group a human-readable summary', () => {
    expect(CREDITS.length).toBeGreaterThanOrEqual(6);
    for (const group of CREDITS) {
      expect(group.summary.trim().length, group.title).toBeGreaterThan(20);
      expect(group.lines.length, group.title).toBeGreaterThan(0);
    }
  });

  it('renders the ledger with semantic headers and list content', () => {
    const settings = source('Settings.ts');
    expect(settings).toContain("el('header', 'vm-credits-intro')");
    expect(settings).toContain("el('article', 'vm-credits-group')");
    expect(settings).toContain("el('ul', 'vm-credits-list')");
  });
});
