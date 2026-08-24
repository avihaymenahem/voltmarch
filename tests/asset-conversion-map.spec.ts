import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROADMAP = path.resolve('docs/ASSET_CONVERSION_MAP.md');

describe('asset conversion map', () => {
  it('maps the complete authored gameplay roster exactly once', () => {
    const markdown = fs.readFileSync(ROADMAP, 'utf8');
    const keys = [...markdown.matchAll(/^\| [SAMRN]\d \| `([^`]+)` \|/gm)].map((match) => match[1]);
    expect(keys).toHaveLength(135);
    expect(new Set(keys).size).toBe(135);
  });

  it('keeps the Meshy pilot visible as an integrated but not prematurely validated asset', () => {
    const markdown = fs.readFileSync(ROADMAP, 'utf8');
    expect(markdown).toContain('| S1 | `soviet_power` | Tesla Reactor | BLD | integrated |');
  });
});
