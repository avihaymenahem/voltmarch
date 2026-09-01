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

  it('keeps support and the live announcement feed in the main-screen top-right corner', () => {
    const menu = source('MainMenu.ts');
    const shell = source('Shell.ts');
    const css = source('shell.css');
    expect(menu).toContain("el('nav', 'vm-menu-corner-actions')");
    expect(menu).toContain("button('Support'");
    expect(menu).toContain("button('News & Events'");
    expect(menu).toContain('https://discord.gg/pvJGJyafU3');
    expect(menu).toContain("this.shell.openSettings('menu', 'updates')");
    expect(shell).toContain("initialTab: TabId = 'graphics'");
    expect(css).toMatch(/\.vm-shell \.vm-menu-corner-actions\s*\{[^}]*position:\s*absolute;[^}]*right:/s);
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

  it('gates process Quit behind an explicit desktop-only confirmation', () => {
    const menu = source('MainMenu.ts');
    const shell = source('Shell.ts');
    const decision = source('MenuDecision.ts');
    expect(menu).toContain('const desktop = desktopBridge()');
    expect(menu).toContain('if (desktop !== null)');
    expect(menu).toContain('onClick: () => this.shell.openQuitConfirmation()');
    expect(menu).not.toContain('onClick: () => desktop.quit()');
    expect(shell).toContain('openQuitConfirmation(): void');
    expect(shell).toContain("title: 'Quit Voltmarch?'");
    expect(shell).toContain('run: () => desktop.quit()');
    expect(decision).toContain("card.setAttribute('role', 'dialog')");
    expect(decision).toContain("card.setAttribute('aria-modal', 'true')");
    expect(menu).not.toContain('window.close()');
  });

  it('asks whether training should continue, reset, or end before entering it', () => {
    const menu = source('MainMenu.ts');
    const shell = source('Shell.ts');
    expect(menu).toContain('onClick: () => this.shell.openTutorialConfirmation()');
    expect(menu).not.toContain('void this.shell.startTutorial()');
    expect(shell).toContain('openTutorialConfirmation(): void');
    expect(shell).toContain("label: 'Continue'");
    expect(shell).toContain("label: 'Reset'");
    expect(shell).toContain("label: 'End'");
    expect(shell).toContain('restoreTutorialMenuItem();');
    expect(shell).toContain('endTutorialMenuItem();');
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

  it('keeps the main-menu status rail on one vertically aligned line', () => {
    const css = source('shell.css');
    const footerMetaRules = [...css.matchAll(
      /\.vm-shell \.vm-menu-foot > \.vm-load-meta\s*\{(?<body>[^}]*)\}/g,
    )].map((match) => match.groups?.body ?? '');
    expect(footerMetaRules.some((rule) => (
      rule.includes('flex-wrap: nowrap;')
      && rule.includes('align-items: center;')
      && rule.includes('margin-top: 0;')
    ))).toBe(true);
  });

  it('keeps the campaign lead copy clear of the modal header divider', () => {
    const css = source('shell.css');
    const note = css.match(/\.vm-shell \.vm-camp-note\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    expect(note).toContain('margin: 18px;');
  });

  it('keeps leaving the match distinct from garrison evacuation', () => {
    const pause = source('PauseMenu.ts');
    expect(pause).toContain("button('Quit To Menu'");
    expect(pause).not.toContain('Evacuate To Main Menu');
    expect(pause).not.toContain('vm-pause-evacuate');
    expect(pause).toContain("next.root.classList.add('is-overlay-entering')");
    expect(pause).toContain("snapshot.classList.add('is-overlay-snapshot')");
  });

  it('does not duplicate the objective tracker inside the pause menu', () => {
    const pause = source('PauseMenu.ts');
    expect(pause).not.toContain('buildObjectives');
    expect(pause).not.toContain('vm-pause-obj');
  });

  it('lets battlefield tools consume Escape before opening the pause menu', () => {
    const shell = source('Shell.ts');
    const input = readFileSync(join(ROOT, 'apps/game/src/input/input.system.ts'), 'utf8');
    expect(shell).toContain('if (cancelBattlefieldModal()) return;');
    expect(shell.indexOf('if (cancelBattlefieldModal()) return;'))
      .toBeLessThan(shell.indexOf('this.pause();', shell.indexOf('if (cancelBattlefieldModal()) return;')));
    expect(input).toContain('cancel: cancelBattlefieldMode');
    expect(input).toContain('else if (clearArmedTool()) cancelled = true;');
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
