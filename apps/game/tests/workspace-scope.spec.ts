import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('workspace deployment scopes', () => {
  it('does not run the playable-site workflow for marketing or relay-only changes', () => {
    const workflow = read('.github/workflows/deploy.yml');
    for (const path of [
      "'apps/game/**'",
      "'packages/game-types/**'",
      "'packages/protocol/**'",
      "'package-lock.json'",
      "'turbo.json'",
    ]) {
      expect(workflow).toContain(path);
    }
    expect(workflow).not.toContain("'apps/website/**'");
    expect(workflow).not.toContain("'apps/relay/**'");
    expect(workflow).toContain('fetch-depth: 0');
  });

  it('anchors local affected checks to the remote mainline when available', () => {
    const rootPackage = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(rootPackage.scripts['check:affected']).toBe('node tools/run-affected.mjs');

    const runner = read('tools/run-affected.mjs');
    expect(runner).toContain("resolves('origin/main') ? 'origin/main' : 'main'");
    expect(runner).toContain("'--affected'");
    expect(runner).toContain("env.TURBO_SCM_HEAD = 'HEAD'");
  });

  it('documents the Pages workspace root that preserves its Functions directory', () => {
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
    expect(readme).toContain('https://play.voltmarch.com/');
    expect(readme).toContain('https://github.com/avihaymenahem/voltmarch/releases/latest');
    expect(readme).toContain('https://discord.gg/pvJGJyafU3');
    expect(readme).toContain('docs/progress/03-faction-architecture.png');
    expect(readme).toContain('docs/progress/13-atoll-crossing.png');
  });
});
