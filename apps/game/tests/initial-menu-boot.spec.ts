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
  const terrain = read('apps/game/src/world/Terrain.ts');
  const scatter = read('apps/game/src/world/Scatter.ts');
  const scatterSystem = read('apps/game/src/world/scatter.system.ts');
  const buildings = read('apps/game/src/art/buildings.system.ts');
  const units = read('apps/game/src/art/units.system.ts');
  const faction3 = read('apps/game/src/art/faction3.system.ts');
  const faction4 = read('apps/game/src/art/faction4.system.ts');
  const audio = read('apps/game/src/audio/audio.system.ts');
  const audioEngine = read('apps/game/src/audio/AudioEngine.ts');
  const audioSamples = read('apps/game/src/audio/Samples.ts');
  const worldWarm = read('apps/game/src/core/workers/world-warm.ts');
  const worldWarmSystem = read('apps/game/src/world/world-warm.system.ts');
  const textureWarmSystem = read('apps/game/src/core/workers/texture-warm.system.ts');

  it('publishes the interactive menu before scheduling its decorative battlefield', () => {
    const branchStart = shell.indexOf('if (!keepBackdrop || this.game === null) {');
    const branchEnd = shell.indexOf('this.scheduleInitialBackdrop();', branchStart);
    const imageFirst = branchStart >= 0 && branchEnd > branchStart
      ? shell.slice(branchStart, branchEnd + 'this.scheduleInitialBackdrop();'.length)
      : '';
    expect(imageFirst.length).toBeGreaterThan(0);

    const show = imageFirst.indexOf("this.show(new MainMenuScreen(this), 'menu')");
    const ready = imageFirst.indexOf('this.options.onReady?.()');
    const schedule = imageFirst.indexOf('this.scheduleInitialBackdrop()');
    expect(show).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(show);
    expect(schedule).toBeGreaterThan(ready);
    expect(imageFirst).not.toContain('await this.bootGame');
    expect(imageFirst).not.toContain('new LoadingScreen');
  });

  it('starts the streamed menu cue without importing the battlefield', () => {
    expect(shell).toContain("import('../audio/ApplicationAudio')");
    expect(shell).toContain('startApplicationAudio(false)');
    expect(html).toContain('href="/audio/music/echoes-of-the-siege.ogg"');
    expect(html).toContain('rel="preload" as="audio"');
  });

  it('cancels a not-yet-started backdrop before launching a real match', () => {
    expect(shell).toMatch(
      /await this\.finishOrCancelInitialBackdrop\(\);\s*\n\s*await this\.bootGame\(seed, false\)/,
    );
    expect(shell).toContain('window.clearTimeout(this.backdropTimer)');
    expect(shell).toContain('window.clearTimeout(this.enginePreloadTimer)');
  });

  it('never makes match boot depend on requestAnimationFrame while unfocused', () => {
    const helperAt = shell.indexOf('export function nextFrames');
    const helper = helperAt < 0 ? '' : shell.slice(helperAt, helperAt + 1_200);
    expect(helper).toContain('maxWaitMs = 250');
    expect(helper).toContain('window.setTimeout(finish');
    expect(helper).toContain('cancelAnimationFrame(frame)');
    expect(shell).toContain('game.ctx.loop.advanceFrames(5);');
    expect(shell).not.toContain('await nextFrames(6);');
  });

  it('prefetches code separately and gives fast launch clicks a real quiet window', () => {
    const schedule = /private scheduleInitialBackdrop\(\): void \{([\s\S]*?)\n\s*\}/.exec(shell)?.[1] ?? '';
    expect(schedule).toContain("import('../game/Bootstrap')");
    expect(schedule).toContain("import('../render/renderer')");
    expect(shell).toContain('}, 1_000);');
    expect(shell).toContain('}, 12_000);');
    expect(shell).not.toContain('}, 750);');
  });

  it('re-arms world workers at every real bootstrap, not during menu code prefetch', () => {
    const prepare = bootstrap.indexOf('prepareWorldWorkers();');
    const prepareTextures = bootstrap.indexOf('prepareTextureWorkers();');
    const renderer = bootstrap.indexOf('const handle = createRenderer({');
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(prepareTextures).toBeGreaterThan(prepare);
    expect(renderer).toBeGreaterThan(prepare);
    expect(renderer).toBeGreaterThan(prepareTextures);
    expect(worldWarm).toContain('export function prepareWorldWorkers(): void');
    expect(worldWarm).toContain('generation++');
    expect(worldWarmSystem).not.toContain('installWorldWorkers();');
    expect(textureWarmSystem).toContain('export function prepareTextureWorkers(): void');
  });

  it('keeps key art behind the menu until the live canvas is ready', () => {
    expect(html).toContain("url('/brand/splash-1600.webp')");
    expect(html).toContain('html.vm-menu-preparing #gl { opacity: 0; }');
    expect(html).toContain('html.vm-menu-preparing #app::before { opacity: 1; }');
    expect(html).toContain('transition: opacity 640ms');
    expect(shell).toContain("classList.add('vm-menu-preparing')");
    expect(shell).toContain("classList.remove('vm-menu-preparing')");
    expect(shell).toContain('waitForOpacityTransition(this.options.canvas)');
    expect(shell).toContain('if (outgoingGameFade !== null) await outgoingGameFade;');
  });

  it('composes scatter for the wider title camera without changing real matches', () => {
    expect(shell).toContain("query.set('backdrop', '1')");
    expect(shell).toContain('distance: backdrop ? TITLE_BACKDROP_CAMERA_DISTANCE : 72');
    expect(scatterSystem).toContain("const titleBackdrop = flag('backdrop') === '1';");
    expect(scatterSystem).toContain('visibleGround(TITLE_BACKDROP_CAMERA_DISTANCE)');
    expect(scatterSystem).toContain('focusBoost: titleBackdrop ? 0.48');
    expect(scatterSystem).toContain('TITLE_BACKDROP_SCATTER_CLEAR_RADIUS');
    expect(scatterSystem).toContain("if (plan.start === 'mcv' || titleBackdrop)");
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

  it('warms latent effect and alternate-model pipelines before revealing the battlefield', () => {
    const expose = bootstrap.indexOf('const latentObjects: Object3D[] = []');
    const compile = bootstrap.indexOf('.compile(sceneRig.scene');
    const restore = bootstrap.indexOf('latentObjects[i].visible = false');
    const reveal = bootstrap.indexOf('markBattlefieldReady();');
    expect(expose).toBeGreaterThanOrEqual(0);
    expect(compile).toBeGreaterThan(expose);
    expect(restore).toBeGreaterThan(compile);
    expect(reveal).toBeGreaterThan(restore);
  });

  it('keeps background audio work below one frame and bounds simultaneous decodes', () => {
    expect(audioEngine).toContain('async bakeAll(sliceMs = 12)');
    expect(audioSamples).toContain('const SAMPLE_DECODE_CONCURRENCY = 6');
    expect(audioSamples).toContain('mapConcurrent(jobs, SAMPLE_DECODE_CONCURRENCY');
    expect(audioSamples).not.toContain('await Promise.all(jobs)');
  });

  it('batches terrain while keeping scatter on typed instancing at runtime', () => {
    expect(terrain).toContain('new THREE.BatchedMesh(');
    expect(terrain).toContain("'terrain.batch.relief'");
    expect(terrain).toContain('batch.perObjectFrustumCulled = true');
    expect(scatter).toContain("get('scatterbatch') === 'legacy'");
    expect(scatter).toContain('if (this.batchedNodePath) this.buildNodeBatches();');
    expect(scatter).toContain('new THREE.InstancedMesh(');
  });

  it('keeps only MCV-critical authored art on the cold-start path', () => {
    for (const source of [buildings, units]) {
      expect(source).toContain("plannedScenario().start === 'mcv'");
      expect(source).toContain('scheduleBattlefieldWork');
      expect(source).toContain('registerKindMesh(');
      expect(source).not.toContain('}, 12_000);');
    }
    expect(buildings).toContain("spec.key.endsWith('_conyard')");
    expect(units).toContain("'allied_dozer'");
    expect(units).toContain("'soviet_dozer'");
    expect(units).toContain('importedSpecs.filter((spec) => MCV_IMPORT_KEYS.has(spec.key))');
    expect(units).toContain('importedSpecs.filter((spec) => !MCV_IMPORT_KEYS.has(spec.key))');
    expect(units).not.toContain('const immediateSpecs = fastMcvBoot ? [] : importedSpecs;');
    expect(faction3).toContain("new Set(['meridian_carryall'])");
    expect(faction3).toContain("new Set(['meridian_conclave'])");
    expect(faction4).toContain("new Set(['reclaim_crawler'])");
    expect(faction4).toContain("new Set(['reclaim_foundry'])");
    for (const source of [faction3, faction4]) {
      expect(source).toContain("plannedScenario().start === 'mcv'");
      expect(source).toContain('scheduleBattlefieldWork');
      expect(source).toContain('streamRemaining');
    }
    expect(bootstrap).toContain('markBattlefieldReady();');
    expect(bootstrap.indexOf('renderOnce(shotMode ? 0 : 1 / 60);')).toBeLessThan(
      bootstrap.indexOf('markBattlefieldReady();'),
    );
  });

  it('prepares the first battlefield audio bank after gameplay becomes ready', () => {
    expect(audio).toContain('battlefieldAudioPreparation = (async');
    expect(audio).toContain('const bankReady = battlefieldAudioPreparation ?? Promise.resolve();');
    expect(audio).toContain('ms in the background');
  });

  it('keeps the full engine behind a dynamic import on both product and harness paths', () => {
    expect(main).toContain("import('./game/Bootstrap')");
    expect(main).not.toMatch(/^import \{ bootstrap/m);
    expect(shell).toContain("import('../game/Bootstrap')");
    expect(shell).not.toMatch(/^import \{ bootstrap/m);
  });
});
