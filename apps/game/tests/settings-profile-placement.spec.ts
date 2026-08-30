import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTINGS_NOTE_COLLAPSE_CHARS,
  shouldCollapseSettingsNote,
} from '../src/shell/Settings';

describe('profile management placement', () => {
  const settings = readFileSync(join(import.meta.dirname, '../src/shell/Settings.ts'), 'utf8');
  const missions = readFileSync(join(import.meta.dirname, '../src/shell/Missions.ts'), 'utf8');

  it('offers portable profile actions in Settings, not on the Missions board', () => {
    for (const label of ['Export Profile', 'Import Profile', 'Reset Progress']) {
      expect(settings).toContain(label);
      expect(missions).not.toContain(label);
    }
  });

  it('keeps native game files with profile management rather than Graphics', () => {
    const display = settings.slice(
      settings.indexOf('private renderDisplay'),
      settings.indexOf('/* -- graphics'),
    );
    const profile = settings.slice(
      settings.indexOf('private renderProfileManagement'),
      settings.indexOf('private sayProfile'),
    );

    expect(display).not.toContain("'Game Files'");
    expect(profile).toContain('this.renderGameFiles(section)');
    expect(settings).toContain("'Game Files'");
    expect(settings).toContain('revealUserData()');
  });

  it('keeps short hints visible and folds long settings explanations behind Details', () => {
    expect(shouldCollapseSettingsNote('Short, useful guidance.')).toBe(false);
    expect(shouldCollapseSettingsNote('x'.repeat(SETTINGS_NOTE_COLLAPSE_CHARS))).toBe(false);
    expect(shouldCollapseSettingsNote('x'.repeat(SETTINGS_NOTE_COLLAPSE_CHARS + 1))).toBe(true);
    expect(settings).toContain("el('button', 'vm-row-details', 'Details')");
    expect(settings).toContain("details.setAttribute('aria-expanded', 'false')");
    expect(settings).toContain('noteNode.hidden = expanded');
  });
});
