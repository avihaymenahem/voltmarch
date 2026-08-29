import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(process.cwd(), 'apps/game/src/dev/CheatEngine.ts'),
  'utf8',
);

describe('Cheat Engine window controls', () => {
  it('closes completely and reopens through Ctrl+Shift+C without a mini launcher', () => {
    expect(source).toContain("event.code !== 'KeyC' || !event.ctrlKey || !event.shiftKey");
    expect(source).toContain("close.addEventListener('click', () => setOpen(false))");
    expect(source).not.toContain('vm-cheat-launcher');
  });

  it('uses header double-click only for collapse and restore', () => {
    expect(source).toContain("headElement.addEventListener('dblclick', toggleCollapsed)");
  });
});
