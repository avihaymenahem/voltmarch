import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('profile management placement', () => {
  const settings = readFileSync(join(import.meta.dirname, '../src/shell/Settings.ts'), 'utf8');
  const missions = readFileSync(join(import.meta.dirname, '../src/shell/Missions.ts'), 'utf8');

  it('offers portable profile actions in Settings, not on the Missions board', () => {
    for (const label of ['Export Profile', 'Import Profile', 'Reset Progress']) {
      expect(settings).toContain(label);
      expect(missions).not.toContain(label);
    }
  });
});
