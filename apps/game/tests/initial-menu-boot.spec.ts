/**
 * The title screen is the product's first interaction budget.
 *
 * A live match still decorates it, but that match must never again become a
 * prerequisite for the menu. These are wiring contracts rather than renderer
 * tests: the failure is ordering across main.ts, Shell and Bootstrap, and a
 * source-level tripwire names that ordering directly without booting 227 MB of
 * art in CI.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(__dirname, '..', '..', '..');
const read = (file: string): string => readFileSync(path.join(repo, file), 'utf8');

describe('initial title-menu boot', () => {
  const shell = read('apps/game/src/shell/Shell.ts');
  const bootstrap = read('apps/game/src/game/Bootstrap.ts');
  const main = read('apps/game/src/main.ts');
  const html = read('apps/game/index.html');

  it('publishes the interactive menu before scheduling its decorative battlefield', () => {
    const firstBoot = /if \(firstBoot && this\.game === null\) \{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] ?? '';
    expect(firstBoot.length).toBeGreaterThan(0);

    const show = firstBoot.indexOf("this.show(new MainMenuScreen(this), 'menu')");
    const ready = firstBoot.indexOf('this.options.onReady?.()');
    const schedule = firstBoot.indexOf('this.scheduleInitialBackdrop()');
    expect(show).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(show);
    expect(schedule).toBeGreaterThan(ready);
    expect(firstBoot).not.toContain('await this.bootGame');
  });

  it('cancels a not-yet-started backdrop before launching a real match', () => {
    expect(shell).toMatch(
      /await this\.finishOrCancelInitialBackdrop\(\);\s*\n\s*await this\.bootGame\(seed, false\)/,
    );
    expect(shell).toContain('window.clearTimeout(this.backdropTimer)');
    expect(shell).toContain('window.clearTimeout(this.enginePreloadTimer)');
  });

  it('prefetches code separately and gives fast launch clicks a real quiet window', () => {
    const schedule = /private scheduleInitialBackdrop\(\): void \{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] ?? '';
    expect(schedule).toContain("import('../game/Bootstrap')");
    expect(schedule).toContain("import('../render/renderer')");
    expect(shell).toContain('}, 1_000);');
    expect(shell).toContain('}, 12_000);');
    expect(shell).not.toContain('}, 750);');
  });

  it('keeps key art behind the menu until the live canvas is ready', () => {
    expect(html).toContain("url('/brand/splash-1600.webp')");
    expect(html).toContain('html.vm-menu-preparing #gl { opacity: 0; }');
    expect(shell).toContain("classList.add('vm-menu-preparing')");
    expect(shell).toContain("classList.remove('vm-menu-preparing')");
  });

  it('awaits WebGPU async pipeline compilation and reports the real phase split', () => {
    const prime = bootstrap.indexOf('registry.runFrame({');
    const compile = bootstrap.indexOf('.compile(sceneRig.scene');
    expect(prime).toBeGreaterThanOrEqual(0);
    expect(compile).toBeGreaterThan(prime);
    expect(bootstrap).toMatch(/await Promise\.resolve\([\s\S]*?\.compile\(/);
    expect(bootstrap).toContain('systemsMs = now() - bootStarted');
    expect(bootstrap).toContain('presentationMs = now() - presentationStarted');
    expect(bootstrap).toContain('compileMs = now() - compileStarted');
    expect(bootstrap).toContain("pipeline cache ${cacheBefore?.battlefieldWarm === true ? 'warm' : 'cold'}");
    expect(bootstrap).toContain('[boot] battlefield');
  });

  it('keeps the full engine behind a dynamic import on both product and harness paths', () => {
    expect(main).toContain("import('./game/Bootstrap')");
    expect(main).not.toMatch(/^import \{ bootstrap/m);
    expect(shell).toContain("import('../game/Bootstrap')");
    expect(shell).not.toMatch(/^import \{ bootstrap/m);
  });
});
