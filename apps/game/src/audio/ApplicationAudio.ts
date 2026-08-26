/**
 * Application-lifetime audio, available before a battlefield exists.
 *
 * The title shell is intentionally interactive before Bootstrap and its 51
 * systems are imported. Keeping the mixer and soundtrack inside audio.system
 * therefore made "menu music" wait for terrain, art, and GPU compilation.
 * This tiny seam owns only the process-lifetime objects. Battlefield audio
 * adopts them later and publishes the richer world-aware facade.
 */

import {
  AudioEngine,
  setAudioFacade,
  type AudioFacade,
} from './AudioEngine';
import { TrackMusic } from './TrackMusic';

export interface ApplicationAudio {
  readonly engine: AudioEngine;
  readonly music: TrackMusic;
}

let application: ApplicationAudio | null = null;
let teardown: (() => void) | null = null;

function shellFacade(app: ApplicationAudio): AudioFacade {
  return {
    play: () => {},
    ui: () => {},
    eva: () => {},
    bark: () => {},
    setCombatIntensity: (value) => { app.music.setCombatHeat(value); },
    setAnnouncerEnabled: () => {},
    setBarkMode: () => {},
    playMenuMusic: () => { app.music.playMenu(); },
    previousMusicTrack: () => { app.music.previous(); },
    nextMusicTrack: () => { app.music.next(); },
    get musicTrack() { return app.music.snapshot; },
    get engine() { return app.engine; },
  };
}

function installTeardown(): void {
  if (teardown !== null || typeof window === 'undefined') return;
  const onPageHide = (): void => { disposeApplicationAudio(); };
  window.addEventListener('pagehide', onPageHide, { once: true });
  teardown = () => { window.removeEventListener('pagehide', onPageHide); };
}

/** Create once, or return the mixer already retained from an earlier world. */
export function ensureApplicationAudio(muted = false): ApplicationAudio | null {
  if (application !== null) return application;
  const engine = AudioEngine.create({ muted });
  if (engine === null) return null;
  const music = new TrackMusic(engine);
  application = { engine, music };
  setAudioFacade(shellFacade(application));
  installTeardown();
  return application;
}

/** Start fetching/playing the title cue without importing the game engine. */
export function startApplicationAudio(muted = false): ApplicationAudio | null {
  const app = ensureApplicationAudio(muted);
  app?.music.start();
  app?.music.playMenu();
  return app;
}

export function disposeApplicationAudio(): void {
  const app = application;
  application = null;
  app?.music.dispose();
  app?.engine.dispose();
  setAudioFacade(null);
  teardown?.();
  teardown = null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => { disposeApplicationAudio(); });
}

