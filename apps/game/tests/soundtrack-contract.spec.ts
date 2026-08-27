import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
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
      'Endless Warfront',
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

  it('rotates all four cues on the title instead of pinning one loop', () => {
    const track = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'TrackMusic.ts'), 'utf8');
    expect(track).toContain('this.switchTo(chooseRandomTrack(-1), true, MENU_FADE_SEC)');
    expect(track).toContain("element.addEventListener('ended'");
    expect(track).toContain('this.switchTo((Math.max(0, this.index) + 1) % SOUNDTRACK.length)');
    expect(track).toContain('this.element.loop = false');
    expect(track).not.toContain('MENU_SOUNDTRACK_INDEX');
  });

  it('allows music ducking only after a real match starts', () => {
    const system = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'audio.system.ts'), 'utf8');
    const eva = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'Eva.ts'), 'utf8');
    expect(system).toContain('canDuck: () => matchStartAt >= 0');
    expect(system).toContain('matchStartAt >= 0 && (kind === FxKind.ExplosionLarge');
    expect(eva).toContain('if (!this.canDuck()) return;');
  });

  it('exposes a synchronized pause control on the main-menu player', () => {
    const track = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'TrackMusic.ts'), 'utf8');
    const engine = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'AudioEngine.ts'), 'utf8');
    const system = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'audio.system.ts'), 'utf8');
    const application = readFileSync(
      join(import.meta.dirname, '..', 'src', 'audio', 'ApplicationAudio.ts'),
      'utf8',
    );
    const control = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'MusicControl.ts'), 'utf8');

    expect(track).toContain('togglePaused(): void');
    expect(track).toContain('this.userPaused || !this.engine.running');
    expect(track).toContain('paused: this.userPaused');
    expect(engine).toContain('toggleMusicPaused(): void;');
    expect(system).toContain('toggleMusicPaused: () => { music?.togglePaused(); }');
    expect(application).toContain('toggleMusicPaused: () => { app.music.togglePaused(); }');
    expect(control).toContain("context === 'menu'");
    expect(control).toContain("audio()?.toggleMusicPaused()");
    expect(control).toContain("track.paused ? 'play' : 'pause'");
  });

  it('keeps the mixer and title score alive when the WebGPU backdrop is replaced', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'audio.system.ts'), 'utf8');
    const application = readFileSync(
      join(import.meta.dirname, '..', 'src', 'audio', 'ApplicationAudio.ts'),
      'utf8',
    );
    const worldDispose = source.slice(
      source.indexOf('  dispose(): void {'),
      source.indexOf('/* Event subscriptions', source.indexOf('  dispose(): void {')),
    );
    const applicationDispose = application.slice(
      application.indexOf('export function disposeApplicationAudio'),
      application.indexOf('if (import.meta.hot)'),
    );

    expect(source).toContain('const firstAudioBoot = !battlefieldAudioPrepared');
    expect(source).toContain('ensureApplicationAudio(muted)');
    expect(worldDispose).not.toContain('music?.dispose()');
    expect(worldDispose).not.toContain('engine?.dispose()');
    expect(applicationDispose).toContain('app?.music.dispose()');
    expect(applicationDispose).toContain('app?.engine.dispose()');
    expect(application).toContain("window.addEventListener('pagehide', onPageHide");
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

  it('cannot let a stale match-end timer silence a rematch, and trims music only in battle', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'audio.system.ts'), 'utf8');
    const matchStart = source.slice(
      source.indexOf("bus.on('match:started'"),
      source.indexOf("bus.on('match:ended'"),
    );
    const matchEnd = source.slice(
      source.indexOf("bus.on('match:ended'"),
      source.indexOf('Selection barks go through'),
    );

    expect(source).toContain('export const MATCH_MUSIC_TRIM_DB = -2.5');
    expect(Math.pow(10, -2.5 / 20)).toBeLessThanOrEqual(0.75);
    expect(matchStart).toContain('cancelMatchEndQuiet();');
    expect(matchStart).toContain('setMatchMusicTrim(true);');
    expect(matchEnd).toContain('setMatchMusicTrim(false);');
    expect(matchEnd).toContain('matchEndQuietTimer = setTimeout');
  });

  it('does not suspend WebAudio or pause simulation merely because focus was lost', () => {
    const engine = readFileSync(join(import.meta.dirname, '..', 'src', 'audio', 'AudioEngine.ts'), 'utf8');
    const shell = readFileSync(join(import.meta.dirname, '..', 'src', 'shell', 'Shell.ts'), 'utf8');
    const visibility = shell.slice(
      shell.indexOf('private readonly onVisibility'),
      shell.indexOf('private readonly onSettingsChanged'),
    );

    expect(engine).not.toContain("window.addEventListener('blur'");
    expect(engine).not.toContain('this.ctx.suspend()');
    expect(visibility).not.toContain('setPaused(document.hidden');
    expect(visibility).toContain('progression.flushProfile()');
  });
});
