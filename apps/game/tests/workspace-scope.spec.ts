import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('workspace deployment scopes', () => {
  it('does not retain a public browser deployment path', () => {
    expect(existsSync('.github/workflows/deploy.yml')).toBe(false);
    expect(existsSync('apps/game/public/CNAME')).toBe(false);
  });

  it('anchors local affected checks to the remote mainline when available', () => {
    const rootPackage = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(rootPackage.scripts['check:affected']).toBe('node tools/run-affected.mjs');

    const runner = read('tools/run-affected.mjs');
    expect(runner).toContain("resolves('origin/main') ? 'origin/main' : 'main'");
    expect(runner).toContain("'--affected'");
    expect(runner).toContain("env.TURBO_SCM_HEAD = 'HEAD'");
  });

  it('documents the marketing-site workspace root that preserves its Functions directory', () => {
    const docs = read('apps/website/README.md');
    expect(docs).toContain('- Root directory: `apps/website`');
    expect(docs).toContain('- Build command: `npm run build`');
    expect(docs).toContain('- Build output: `dist`');
  });
});

describe('public README contract', () => {
  it('keeps the first read concise and free of release-note trivia', () => {
    const readme = read('README.md');
    expect(readme.split('\n').length).toBeLessThan(180);
    expect(readme).not.toContain('Interface text defaults');
    expect(readme).not.toContain('115%');
    expect(readme).not.toContain('—');
  });

  it('points the public calls to action at the live destinations', () => {
    const readme = read('README.md');
    expect(readme).toContain('https://github.com/avihaymenahem/voltmarch/releases/latest');
    expect(readme).toContain('https://discord.gg/pvJGJyafU3');
    expect(readme).toContain('docs/progress/03-faction-architecture.png');
    expect(readme).toContain('docs/progress/13-atoll-crossing.png');
  });
});
