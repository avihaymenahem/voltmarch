import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MENU_SOUNDTRACK_ID,
  MENU_SOUNDTRACK_INDEX,
  SOUNDTRACK,
  chooseRandomTrack,
  musicPath,
} from '../src/audio/TrackMusic';

const MUSIC = join(import.meta.dirname, '..', 'public', 'audio', 'music');

describe('original soundtrack delivery contract', () => {
  it('maps every named cue to a non-empty streamed Ogg and ships no superseded cue', () => {
    expect(SOUNDTRACK.map((cue) => cue.title)).toEqual([
      'Silent Horizon',
      'Disciplined Ostinato',
      'Echoes of the Siege',
    ]);

    for (const cue of SOUNDTRACK) {
      expect(musicPath(cue.file)).toBe(`audio/music/${cue.file}`);
      const file = join(MUSIC, cue.file);
      expect(existsSync(file), `missing soundtrack delivery file ${cue.file}`).toBe(true);
      expect(statSync(file).size, `${cue.file} is empty or truncated`).toBeGreaterThan(500_000);
    }

    for (const stale of ['idle.ogg', 'mid.ogg', 'combat.ogg']) {
      expect(existsSync(join(MUSIC, stale)), `${stale} belongs to the replaced score`).toBe(false);
    }
  });

  it('can choose every cue initially and never repeats a cue at match start', () => {
    expect(chooseRandomTrack(-1, () => 0)).toBe(0);
    expect(chooseRandomTrack(-1, () => 0.999999)).toBe(SOUNDTRACK.length - 1);

    for (let current = 0; current < SOUNDTRACK.length; current++) {
      expect(chooseRandomTrack(current, () => 0)).not.toBe(current);
      expect(chooseRandomTrack(current, () => 0.999999)).not.toBe(current);
    }
  });

  it('pins the title screen to Echoes of the Siege', () => {
    expect(MENU_SOUNDTRACK_ID).toBe('echoes-of-the-siege');
    expect(MENU_SOUNDTRACK_INDEX).toBeGreaterThanOrEqual(0);
    expect(SOUNDTRACK[MENU_SOUNDTRACK_INDEX]?.title).toBe('Echoes of the Siege');
  });

  it('keeps the mixer and title score alive when the WebGPU backdrop is replaced', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'audio.system.ts'), 'utf8');
    const worldDispose = source.slice(
      source.indexOf('  dispose(): void {'),
      source.indexOf('/* Event subscriptions', source.indexOf('  dispose(): void {')),
    );
    const applicationDispose = source.slice(
      source.indexOf('function disposeApplicationAudio'),
      source.indexOf('function installApplicationTeardown'),
    );

    expect(source).toContain('const firstAudioBoot = engine === null');
    expect(worldDispose).not.toContain('music?.dispose()');
    expect(worldDispose).not.toContain('engine?.dispose()');
    expect(applicationDispose).toContain('music?.dispose()');
    expect(applicationDispose).toContain('engine?.dispose()');
    expect(source).toContain("window.addEventListener('pagehide', onPageHide");
  });

  it('stages the saved mix before the title soundtrack starts', () => {
    const engine = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'AudioEngine.ts'), 'utf8');
    const settings = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'Settings.ts'), 'utf8');
    const shell = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'Shell.ts'), 'utf8');

    expect(engine).toContain('export function configureAudioMixer');
    expect(engine).toContain('applyDesiredMix(f);');
    expect(settings).toContain('configureAudioMixer(settings.audio);');
    expect(shell).toMatch(/applySettings\(this\.settings\.get\(\), null, \[\s*'audio'/);
  });
});
