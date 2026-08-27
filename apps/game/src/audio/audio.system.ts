/**
 * ============================================================================
 * VOLTMARCH — src/audio/audio.system.ts
 * ============================================================================
 * THE WIRING. Builds the engine, bakes the bank, and subscribes to the event
 * bus so the rest of the game never has to know audio exists.
 *
 * SUBSCRIBE, DO NOT BE CALLED
 * ---------------------------
 * Almost everything here hangs off `channels.events` and `channels.fx`. The
 * combat module does not call the audio module; it pushes an `FxKind` into the
 * PresentationQueue and an `entity:killed` onto the bus, and audio decides what
 * that sounds like. The only direct surface is the `IAudio` port on `world`
 * plus the module-level facade in AudioEngine.ts, both of which exist for the
 * cases a bus event genuinely cannot express (a UI hover tick, a HUD-initiated
 * "insufficient funds").
 *
 * SILENT UNDER ?shot=
 * -------------------
 * The screenshot harness runs headless Chromium with no audio device and no
 * user gesture. The engine is built muted, the context is never resumed, and
 * the music scheduler never starts — so a capture run is deterministic and
 * costs nothing.
 * ============================================================================
 */

import * as THREE from 'three';

import { defineSystem } from '../core/loop';
import {
  BuildTab, EntityFlag, EntityKind, Faction, FxKind, OrderKind, RenderPhase,
  type EntityId, type IAudio, type PlayerId, type RenderContext,
} from '../core/types';
import { CreditReason } from '../core/types';
import {
  AUDIO_AMBIENCE, AUDIO_DISTANCE, AUDIO_DUCK, AUDIO_MUSIC, AUDIO_MUTE_IN_SHOT_MODE, CELL,
} from '../core/config';
import { RENDER_CONFIG } from '../render/renderer';
import { ctx } from '../game/context';
import { contentKeyOf } from '../sim/Deploy';

import {
  setAudioFacade, type AudioEngine, type AudioFacade, type BusName, type DuckHandle, type PanResolver,
} from './AudioEngine';
import { ensureApplicationAudio } from './ApplicationAudio';
import { AmbienceRig, FX_SOUND, SFX, registerSfxBank, type Theatre } from './Weapons';
import { EVA_LINE_ID, EvaAnnouncer, type EvaMode } from './Eva';
import { BarkDirector, barkClassFor, type BarkCategory, type BarkClass } from './Barks';
import type { TrackMusic } from './TrackMusic';

/* -------------------------------------------------------------------------- */
/* Boot flags                                                                 */
/* -------------------------------------------------------------------------- */

function flag(name: string): string | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(name);
  return v === null || v === '' ? null : v;
}

function shotMode(): boolean {
  return flag('shot') !== null;
}

/* -------------------------------------------------------------------------- */
/* Module state                                                               */
/* -------------------------------------------------------------------------- */

/**
 * APPLICATION-LIFETIME AUDIO.
 *
 * The title battlefield is disposable: the shell builds it in the background,
 * then replaces it when a match starts. The mixer and recorded soundtrack are
 * not. Tying those two objects to a world meant that finishing/replacing the
 * WebGPU backdrop closed the AudioContext and paused the menu's HTMLAudioElement
 * even though the title screen was still mounted.
 *
 * Keep the engine and score across registry lifetimes. EVA, barks and ambience
 * remain world-scoped because they subscribe to and describe a particular
 * battlefield. ApplicationAudio owns the one true final teardown, used only
 * when the page itself goes away (or that module is hot-replaced in dev).
 */
let engine: AudioEngine | null = null;
let eva: EvaAnnouncer | null = null;
let barks: BarkDirector | null = null;
/**
 * The recorded score. `TrackMusic` owns a `MusicDirector` internally and falls
 * back to it if a track will not load, so this stays one variable. Combat heat
 * remains wired for that fallback and for diagnostics; the original cues are
 * complete compositions and do not change with heat.
 */
let music: TrackMusic | null = null;
let ambience: AmbienceRig | null = null;
let unsubscribe: Array<() => void> = [];
let configuredEvaMode: EvaMode = 'synth';
/** SFX baking remains battlefield work, but it also happens only once. */
let battlefieldAudioPrepared = false;
let battlefieldAudioPreparation: Promise<void> | null = null;

/** Scratch for the pan resolver. Allocated once; the frame loop allocates none. */
const _v3 = new THREE.Vector3();
const _v2 = new THREE.Vector2();

/* -- combat heat inputs ---------------------------------------------------- */
/** Damage dealt+taken, in a 4 s ring of 250 ms buckets. */
const DAMAGE_BUCKETS = Math.ceil((AUDIO_MUSIC.damageWindowSec * 1000) / 250);
const damageRing = new Float32Array(DAMAGE_BUCKETS);
let damageHead = 0;
let damageBucketAt = 0;
/** Muzzle-flash FX seen in the last second, as a proxy for "own units firing". */
let firingCount = 0;
let firingDecayAt = 0;
let hostileNear = 0;
/**
 * An explicitly-pushed intensity, and when it arrived.
 *
 * Audio computes its own combat heat every frame, which would silently stomp
 * anything a caller passed to `setCombatIntensity` / `IAudio.setIntensity`.
 * An external value therefore WINS for `EXTERNAL_HEAT_HOLD_SEC`, then decays
 * back to the computed value — so a scripted cutscene or a debug slider works,
 * but a caller who sets it once and forgets does not freeze the music forever.
 */
let externalHeat = -1;
let externalHeatAt = -1;
const EXTERNAL_HEAT_HOLD_SEC = 2;

/* -- announcer state ------------------------------------------------------- */
let brownoutSince = -1;
let fundsStalledSince = -1;
let poweredPlants = 0;
/**
 * Engine time the match began, or -1 while no match is armed.
 *
 * SET IN EXACTLY ONE PLACE: the `match:started` handler. That event had no
 * emitter until `src/game/outcome.system.ts` grew one, which is why this stayed
 * at -1 for entire sessions and the opening "Battle control online" line never
 * played once, in any match. Both this and `bootLineFired` are reported by the
 * `audio` debug hook so the arming is observable from `__VM.hooks.audio()`
 * rather than only audible.
 */
let matchStartAt = -1;
let bootLineFired = false;

/**
 * Ducks holding every non-music bus silent while no match is running.
 *
 * WHY THIS EXISTS. The title screen boots a REAL WORLD behind the menu, purely
 * so there is something moving to look at — a real base, real harvesters, a
 * real economy. Every sound that world makes came straight out of the
 * speakers: measured on the menu, `ore.dump` alone fired 123 times in a few
 * seconds, and the ambience beds ran underneath it. None of it means anything
 * to a player who is reading a menu, and some of it is actively confusing —
 * "new construction options" announced for a base that is not yours.
 *
 * A BUS DUCK RATHER THAN A GUARD AT EVERY CALL SITE. There are more than
 * thirty places that emit a sound, they are added regularly, and a rule
 * enforced at thirty sites is a rule that will be broken at the thirty-first.
 * This is one choke point, it covers sounds nobody has written yet, and it
 * cannot be bypassed by accident.
 *
 * MUSIC IS DELIBERATELY EXEMPT. A menu with a score is the point; a menu
 * narrating somebody else's harvesters is not.
 */
const menuDucks: Array<{ release: () => void }> = [];

/** Buses that go quiet outside a match. `music` is absent on purpose. */
const SILENT_OUTSIDE_MATCH: readonly BusName[] = ['sfx', 'voice', 'ui', 'ambience'];

/** -120 dB is 1e-6 of full scale: silence, without a special case for zero. */
const MENU_SILENCE_DB = -120;

/**
 * How long the world stays audible after a match ends.
 *
 * Long enough for "Mission accomplished" and the music sting to land. Shorter
 * and the verdict is cut off by its own silence.
 */
const MATCH_END_QUIET_MS = 6000;

/** A full-scale soundtrack masks authored weapons; 0.75 gain is -2.5 dB. */
export const MATCH_MUSIC_TRIM_DB = -2.5;

let matchEndQuietTimer: ReturnType<typeof setTimeout> | null = null;
let matchMusicDuck: DuckHandle | null = null;

function cancelMatchEndQuiet(): void {
  if (matchEndQuietTimer === null) return;
  clearTimeout(matchEndQuietTimer);
  matchEndQuietTimer = null;
}

function setMatchMusicTrim(on: boolean): void {
  if (on) {
    if (matchMusicDuck === null) {
      matchMusicDuck = engine?.duck('match-score', 'music', MATCH_MUSIC_TRIM_DB, 500, 500) ?? null;
    }
    return;
  }
  matchMusicDuck?.release();
  matchMusicDuck = null;
}

function applyMenuSilence(on: boolean): void {
  const e = engine;
  if (e === null) return;
  if (on) {
    if (menuDucks.length > 0) return;
    for (const bus of SILENT_OUTSIDE_MATCH) {
      menuDucks.push(e.duck('menu', bus, MENU_SILENCE_DB, 0, 0));
    }
    return;
  }
  // 220 ms rather than instant: a match starting should feel like the world
  // fading up, not like a switch being thrown.
  for (const d of menuDucks) d.release();
  menuDucks.length = 0;
  for (const bus of SILENT_OUTSIDE_MATCH) e.duck('menu', bus, 0, 220, 220).release();
}

/* -------------------------------------------------------------------------- */
/* Spatialisation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Turn a world position into `[pan, distanceMetres, zoom, verticalFrac]`.
 *
 * Pan is derived from the PLAYFIELD rect, not the window: the sidebar occupies
 * the right ~13% of the screen (VISUAL_DNA §2.1), so a unit at the true window
 * centre is actually left of the playfield centre and must pan slightly left.
 * Getting this wrong is subtle and permanent — everything sits a little to the
 * right for the whole game.
 *
 * Distance is measured from the camera's FOCUS point, not the eye. In a
 * top-down RTS the focus is where the player is looking, and a sound 40 m
 * behind the camera should be as quiet as one 40 m in front of it.
 */
function makeResolver(): PanResolver {
  const { cameraRig, handle } = ctx();
  const D = AUDIO_DISTANCE;
  return (x: number, y: number, z: number, out: Float32Array): void => {
    const w = Math.max(1, handle.size.cssWidth);
    const h = Math.max(1, handle.size.cssHeight);
    // Playfield: window minus the sidebar and the bottom command bar.
    const playW = w * (1 - SIDEBAR_FRACTION);
    const playH = h * (1 - COMMANDBAR_FRACTION);
    const cx = playW * 0.5;

    _v3.set(x, y, z);
    cameraRig.worldToScreen(_v3, _v2);
    out[0] = Math.max(-D.panClamp, Math.min(D.panClamp, ((_v2.x - cx) / (playW * 0.5)) * D.panScale));

    const dx = x - cameraRig.focus.x;
    const dz = z - cameraRig.focus.z;
    out[1] = Math.sqrt(dx * dx + dz * dz);
    out[2] = cameraRig.distance / Math.max(1, RENDER_CONFIG.camera.distance);
    out[3] = 1 - Math.max(0, Math.min(1, _v2.y / playH));
  };
}

/** §2.1: 13.1% of width at every resolution above 1366. */
const SIDEBAR_FRACTION = 0.131;
/** §2.2: a 37 px command bar against 1080. */
const COMMANDBAR_FRACTION = 0.034;

/* -------------------------------------------------------------------------- */
/* Bark class resolution                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the store actually knows about a unit, turned into a voice.
 * The real content key is authoritative: faction alone cannot distinguish an
 * engineer, aircraft, transport or commander. Flags remain the fallback for
 * deliberately sparse/headless worlds with no bound content table.
 */
function classOf(id: EntityId): BarkClass | null {
  const { world } = ctx();
  const s = world.store;
  const i = s.index(id);
  if (i < 0) return null;
  const kind = s.kind[i] as EntityKind;
  if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) return null;
  const faction = s.faction[i] as Faction;
  const flags = s.flags[i];
  let hint = contentKeyOf(world, i);
  if (hint === '' && (flags & EntityFlag.IsHarvester)) hint = 'harvester';
  else if (hint === '' && (flags & EntityFlag.IsBuilder)) hint = 'mcv';
  return barkClassFor(kind, faction, hint);
}

function positionOf(id: EntityId, out: Float32Array): boolean {
  const { world } = ctx();
  const i = world.store.index(id);
  if (i < 0) return false;
  out[0] = world.store.posX[i];
  out[1] = world.store.posY[i];
  out[2] = world.store.posZ[i];
  return true;
}

const _pos = new Float32Array(3);

/**
 * Primary of the current selection — who answers an order.
 *
 * `EvOrderIssued` carries the order kind and its target but not the units that
 * received it, and threading that through the command channel to make a unit
 * say "moving out" is not worth the coupling. The last selected primary is the
 * unit the player is looking at, which is the one an RTS barks from anyway.
 * -1 until something is selected.
 */
let lastPrimary = -1;

/**
 * Order kind -> what the unit says. `Stop` and `Guard` share `deploy` because
 * the recorded line is "holding position", which is true of both.
 * Kinds absent here are deliberately silent: a harvest order is routine and a
 * unit shouting about it every few seconds is the fastest way to make a player
 * turn the voices off.
 */
export const BARK_FOR_ORDER: Readonly<Partial<Record<OrderKind, BarkCategory>>> = {
  [OrderKind.Move]: 'move',
  [OrderKind.AttackMove]: 'attackMove',
  [OrderKind.Attack]: 'attack',
  [OrderKind.ForceAttack]: 'attack',
  [OrderKind.Stop]: 'stop',
  [OrderKind.Guard]: 'guard',
  [OrderKind.Harvest]: 'harvest',
  [OrderKind.Deploy]: 'deploy',
  [OrderKind.Capture]: 'capture',
  [OrderKind.Repair]: 'repair',
  [OrderKind.Enter]: 'enterTransport',
  [OrderKind.Scatter]: 'scatter',
  [OrderKind.Patrol]: 'patrol',
  [OrderKind.UseAbility]: 'ability',
  [OrderKind.Unload]: 'unload',
};

function barkFor(id: EntityId, category: BarkCategory, signature?: string): void {
  if (barks === null) return;
  const cls = classOf(id);
  if (cls === null) return;
  const ok = positionOf(id, _pos);
  const x = ok ? _pos[0] : undefined;
  const y = ok ? _pos[1] : undefined;
  const z = ok ? _pos[2] : undefined;
  if (signature !== undefined) barks.barkSelection(cls, signature, id as number, x, y, z);
  else barks.bark(cls, category, id as number, x, y, z);
}

/* -------------------------------------------------------------------------- */
/* The system                                                                 */
/* -------------------------------------------------------------------------- */

export default defineSystem({
  id: 'audio',
  // After the render bridge and the VFX module, before Present: the FX queue is
  // cleared once at the end of the frame, so anything before that is fine, and
  // running late means socket positions are already resolved for this frame.
  renderPhase: RenderPhase.Vfx,
  order: 900,

  async init(): Promise<void> {
    const { world, debug } = ctx();

    const muted = (shotMode() && AUDIO_MUTE_IN_SHOT_MODE) || flag('audio') === 'off';
    const firstAudioBoot = !battlefieldAudioPrepared;
    const applicationAudio = ensureApplicationAudio(muted);
    engine = applicationAudio?.engine ?? null;
    music = applicationAudio?.music ?? null;
    if (engine === null) {
      console.info('[audio] WebAudio unavailable — running silent');
      return;
    }
    if (firstAudioBoot) {
      registerSfxBank(engine);
    }
    const liveEngine = engine;
    // `engine` is module state, so TypeScript cannot preserve the narrowing
    // across the first-boot branch even though its null arm returned above.
    if (liveEngine === null) return;

    liveEngine.setPanResolver(makeResolver());

    const evaMode = (flag('eva') as EvaMode | null) ?? 'synth';
    configuredEvaMode = evaMode;
    const subtitle = (speaker: 'EVA' | 'UNIT') => (text: string, dwellSec: number): void => {
      const h = (globalThis as unknown as {
        __vmHud?: { voiceSubtitle?: (speaker: string, text: string, dwellSec: number) => void };
      }).__vmHud;
      h?.voiceSubtitle?.(speaker, text, dwellSec);
    };
    eva = new EvaAnnouncer(liveEngine, {
      mode: muted ? 'off' : evaMode,
      onSubtitle: subtitle('EVA'),
      // The title battlefield is presentation only. Its voice bus is muted by
      // `applyMenuSilence`, and an inaudible line must not lower the soundtrack.
      canDuck: () => matchStartAt >= 0,
    });
    barks = new BarkDirector(liveEngine, {
      mode: flag('barks') === 'off' ? 'off' : flag('barks') === 'reduced' ? 'reduced' : 'on',
      onSubtitle: subtitle('UNIT'),
    });
    ambience = new AmbienceRig(liveEngine);

    /* -- the IAudio port --------------------------------------------------- */
    const port: IAudio = {
      play(kind: FxKind, x: number, z: number, volume: number): void {
        const id = FX_SOUND[kind];
        if (id !== null && id !== undefined) engine?.play(id, x, 0, z, { gain: volume });
      },
      ui(kind: FxKind): void {
        const id = FX_SOUND[kind];
        if (id !== null && id !== undefined) engine?.ui(id);
      },
      eva(player: PlayerId, line: number): void {
        // Announcer lines are for the local player only; an AI's brownout is
        // not our problem, and hearing it would leak information.
        if (player !== world.localPlayer) return;
        const lineId = EVA_LINE_ID[line];
        if (lineId !== undefined) eva?.say(lineId);
      },
      setIntensity(v: number): void {
        pushExternalHeat(v);
      },
    };
    world.audio = port;

    /* -- the module facade ------------------------------------------------- */
    const facade: AudioFacade = {
      play: (id, x, y, z, g) => { engine?.play(id, x, y, z, g === undefined ? undefined : { gain: g }); },
      ui: (id) => { engine?.ui(id); },
      eva: (line) => { eva?.say(line); },
      bark: (cls, category, x, y, z) => {
        barks?.bark(cls as BarkClass, category as BarkCategory, -1, x, y, z);
      },
      setCombatIntensity: (v) => { pushExternalHeat(v); },
      setAnnouncerEnabled: (enabled) => {
        if (eva !== null) eva.mode = enabled ? configuredEvaMode : 'off';
      },
      setBarkMode: (mode) => { if (barks !== null) barks.mode = mode; },
      playMenuMusic: () => { music?.playMenu(); },
      previousMusicTrack: () => { music?.previous(); },
      nextMusicTrack: () => { music?.next(); },
      toggleMusicPaused: () => { music?.togglePaused(); },
      get musicTrack() { return music?.snapshot ?? null; },
      get engine(): AudioEngine | null { return engine; },
    };
    setAudioFacade(facade);

    subscribe();

    /* -- bake -------------------------------------------------------------- */
    // Under ?shot= nothing will ever be heard, so skip ~400 ms of offline
    // rendering entirely and let the harness get to its frame sooner.
    if (!liveEngine.muted) {
      // ONLY the one-shot bank and the reverb block boot. Voices do not:
      // measured, the 31 EVA lines take longer to render than the entire SFX
      // bank, and `registry.init()` is awaited by Bootstrap — so awaiting them
      // here would hold the loading screen up for seconds to prepare a line
      // nobody hears until 1.2 s into the match. Both `EvaAnnouncer.say` and
      // `BarkDirector.bark` already bake on demand and play when ready.
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      const evaRef = eva;
      const barkRef = barks;
      if (firstAudioBoot && battlefieldAudioPreparation === null) {
        battlefieldAudioPreparation = (async (): Promise<void> => {
          await liveEngine.bakeAll();
          await liveEngine.initReverb('temperate');
          battlefieldAudioPrepared = true;
          const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
          console.info(
            `%c[audio]%c ${liveEngine.stats.baked} buffers, ` +
              `${(liveEngine.stats.bytes / 1048576).toFixed(1)} MB, ` +
              `${Math.round(t1 - t0)} ms in the background — EVA ${evaMode}, ` +
              `ctx ${liveEngine.ctx.sampleRate} Hz (${liveEngine.ctx.state})`,
            'color:#7fd', 'color:inherit',
          );
        })().finally(() => { battlefieldAudioPreparation = null; });
      }
      const bankReady = battlefieldAudioPreparation ?? Promise.resolve();
      void bankReady.then(async (): Promise<void> => {
        const voiceStarted = typeof performance !== 'undefined' ? performance.now() : 0;
        await evaRef.bakeAll();
        await barkRef.prebake(['allied_infantry', 'soviet_infantry', 'allied_vehicle', 'soviet_vehicle']);
        const voiceEnded = typeof performance !== 'undefined' ? performance.now() : 0;
        console.info(`[audio] voices ready (+${Math.round(voiceEnded - voiceStarted)} ms in the background)`);
      }).catch((error: unknown) => {
        console.warn('[audio] background preparation failed', error);
      });
      ambience.startWind(theatreFromFlags());
      ambience.startHum();
      // THE MENU IS SILENT EXCEPT FOR MUSIC. The loops above are started here
      // because a match may begin at any moment and a loop that has to spin up
      // arrives late; `menuSilence` is what keeps them inaudible until then.
      applyMenuSilence(true);
      music?.start();
    }

    debug.api.registerHook('audio', () => ({
      state: engine?.ctx.state ?? 'none',
      voices: engine?.stats.oneShots ?? 0,
      loops: engine?.stats.loops ?? 0,
      stolen: engine?.stats.stolen ?? 0,
      culled: engine?.stats.culled ?? 0,
      crowded: engine?.stats.crowded ?? 0,
      layer: music?.currentLayer ?? 0,
      heat: music?.intensity ?? 0,
      rawHeat: music?.rawHeat ?? 0,
      musicSteps: music?.scheduledSteps ?? -1,
      musicRunning: music?.running ?? false,
      // Which score is actually playing. Without this the overlay cannot tell
      // the recorded tracks from the sequencer fallback, and they report the
      // same shape of numbers — which cost real time to diagnose once.
      musicRecorded: music?.recorded ?? false,
      barksBaked: barks?.bakedCount ?? 0,
      // The per-match announcer reset, made checkable. `matchArmed` is false
      // until `match:started` lands; `bootLine` flips 1.2 s later.
      matchArmed: matchStartAt >= 0,
      bootLine: bootLineFired,
    }));
  },

  frame(r: RenderContext): void {
    if (engine === null) return;
    drainFx();
    updateHeat(r);
    pollAnnouncer();
    eva?.update();
    updateCounters();
  },

  dispose(): void {
    cancelMatchEndQuiet();
    setMatchMusicTrim(false);
    applyMenuSilence(true);
    for (const off of unsubscribe) off();
    unsubscribe = [];
    ambience?.dispose();
    barks?.dispose();
    eva?.dispose();
    // The world is gone; the title score is not. The application-lifetime
    // engine/music pair is deliberately retained until `pagehide` so replacing
    // the WebGPU backdrop cannot interrupt the menu soundtrack.
    eva = null; barks = null; ambience = null;
    configuredEvaMode = 'synth';
    brownoutSince = -1;
    fundsStalledSince = -1;
    matchStartAt = -1;
    bootLineFired = false;
  },
});

/* -------------------------------------------------------------------------- */
/* Event subscriptions                                                        */
/* -------------------------------------------------------------------------- */

function subscribe(): void {
  const { world, channels } = ctx();
  const bus = channels.events;
  const local = (): PlayerId => world.localPlayer;

  /* -- explicit announcer requests --------------------------------------- */
  unsubscribe.push(bus.on('eva:line', (p) => {
    if (p.player !== local()) return;
    const id = EVA_LINE_ID[p.line];
    if (id !== undefined) eva?.say(id);
  }));

  /* -- construction and production ---------------------------------------- */
  unsubscribe.push(bus.on('building:placed', (p) => {
    if (p.player !== local()) return;
    engine?.ui(SFX.uiThunk);
    eva?.say('constructionComplete');
  }));

  unsubscribe.push(bus.on('building:completed', (p) => {
    engine?.play(SFX.buildRise, p.x, 0, p.z);
  }));

  unsubscribe.push(bus.on('production:ready', (p) => {
    if (p.player !== local()) return;
    engine?.ui(SFX.uiReady);
    if (p.isBuilding) return; // the structure speaks when it is PLACED
    eva?.say(p.tab === BuildTab.Infantry ? 'trainingComplete' : 'unitReady');
  }));

  unsubscribe.push(bus.on('production:started', (p) => {
    if (p.player !== local()) return;
    engine?.ui(SFX.uiClick);
    if (p.isBuilding) eva?.say('building');
  }));

  unsubscribe.push(bus.on('production:cancelled', (p) => {
    if (p.player === local()) engine?.ui(SFX.uiTab);
  }));

  unsubscribe.push(bus.on('tech:changed', (p) => {
    if (p.player !== local()) return;
    // Unlocking a tier is the one genuinely good thing that happens outside
    // combat, and it was silent apart from EVA. `ui.chime` exists for exactly
    // this and had no call site.
    engine?.ui(SFX.uiChime);
    eva?.say('newConstructionOptions');
  }));

  /* -- economy ------------------------------------------------------------- */
  unsubscribe.push(bus.on('economy:credits', (p) => {
    if (p.player !== local()) return;
    // Ore arriving at a full silo is wasted; that is what "Silos needed" means.
    if (p.reason === CreditReason.Waste) eva?.say('silosNeeded');
    // NO SOUND FOR A HARVESTER UNLOADING, and `ore.dump` is deliberately
    // back to having no call site.
    //
    // It was wired here on the reasoning that "the one moment the economy is
    // audible had no sound at all". The reasoning was right and the event was
    // wrong: `economy:credits` is a STREAM. `Harvesting.ts` empties a hopper
    // gradually over `UNLOAD_SECONDS`, depositing a slice every sim tick, so
    // one delivery fired this sixty-odd times. Measured on the menu: 123 plays
    // in a few seconds, successive calls 33 ms apart. Overlapping copies of a
    // short sample at that rate do not read as a repeat, they fuse into a
    // drone.
    //
    // An edge trigger on the gap between deliveries was written and works, and
    // it is still not wanted: with several harvesters cycling, a correct
    // once-per-delivery chime is a metronome nobody asked for. Removed on the
    // user's call rather than repaired. The spec and its recording stay
    // registered, so restoring it is one line here.

  }));

  unsubscribe.push(bus.on('economy:power', (p) => {
    if (p.player !== local()) return;
    const t = engine?.now() ?? 0;
    if (p.brownout || p.consumed > p.produced) {
      if (brownoutSince < 0) brownoutSince = t;
    } else {
      brownoutSince = -1;
    }
    // The hum sags before EVA says a word — the player feels it first.
    poweredPlants = Math.max(0, Math.round(p.produced / 100));
    ambience?.setPower(poweredPlants, p.brownout || p.consumed > p.produced);
  }));

  /* -- combat -------------------------------------------------------------- */
  unsubscribe.push(bus.on('combat:underAttack', (p) => {
    if (p.player === local()) {
      eva?.say(p.isBuilding ? 'baseUnderAttack' : 'forcesUnderAttack');
      return;
    }
    if (world.areAllied(local(), p.player)) eva?.say('allyUnderAttack');
  }));

  unsubscribe.push(bus.on('entity:damaged', (p) => {
    // Both directions feed the heat: taking a beating is as intense as dealing one.
    pushDamage(p.amount);
    if (p.player === local() && p.hpFrac < 0.999) {
      const i = ctx().world.store.index(p.id);
      if (i >= 0 && (ctx().world.store.flags[i] & EntityFlag.IsHarvester) !== 0) {
        eva?.say('oreMinerUnderAttack');
      }
      // Unit responses are PLAYER INTENT ONLY. Damage is already represented
      // by EVA, VFX and the HUD; turning every firefight into unsolicited unit
      // chatter made the response system feel random even with cooldowns.
    }
  }));

  unsubscribe.push(bus.on('entity:killed', (p) => {
    if (p.kind === EntityKind.Infantry) engine?.play(SFX.infantryDeath, p.x, 0, p.z);
    if (p.player !== local()) return;
    if (p.kind === EntityKind.Building) eva?.say('structureLost');
    else if (p.kind === EntityKind.Infantry || p.kind === EntityKind.Vehicle) eva?.say('unitLost');
  }));

  unsubscribe.push(bus.on('building:captured', (p) => {
    if (p.toPlayer === local()) {
      eva?.say('buildingCaptured');
      return;
    }
    if (p.fromPlayer === local()) eva?.say('buildingCaptured');
  }));

  unsubscribe.push(bus.on('building:sold', (p) => {
    if (p.player !== local()) return;
    engine?.ui(SFX.uiSell);
    eva?.say('structureSold');
  }));

  unsubscribe.push(bus.on('radar:changed', (p) => {
    if (p.player !== local()) return;
    // `ui.ping` is the radar sound and had no call site. Only on the way UP:
    // losing radar already has EVA plus the minimap going dark, and a cheerful
    // ping under "Radar offline" reads as a reward for a setback.
    if (p.online) engine?.ui(SFX.uiPing);
    eva?.say(p.online ? 'radarOnline' : 'radarOffline');
  }));

  /* -- player intent: the ONLY source of unit speech ---------------------- */
  unsubscribe.push(bus.on('selection:changed', (p) => {
    if (p.count === 0) return;
    engine?.ui(SFX.uiClick);
    if (p.isBuilding) return; // structures do not talk back
    lastPrimary = p.primary as number;
    // The signature is what makes re-selecting the same group silent for 2.5 s.
    barkSelectionFor(p.primary, `${p.count}:${p.primary as number}`);
  }));

  unsubscribe.push(bus.on('order:issued', (p) => {
    if (p.player !== local() || p.count === 0) return;
    engine?.ui(SFX.uiGhost);
    // ACKNOWLEDGE THE ORDER. Six of the seven bark categories were authored,
    // recorded in two voices and shipped, and nothing dispatched any of them —
    // only `select` was ever wired, so units answered when clicked and went
    // silent the moment they were told to do something.
    //
    // The speaker is the primary of the current selection: `EvOrderIssued`
    // carries the order and its target but not who received it, and barking
    // from the unit the player is looking at is what an RTS does anyway.
    const cat = BARK_FOR_ORDER[p.order];
    if (cat !== undefined && lastPrimary >= 0) barkFor(lastPrimary as EntityId, cat);
  }));

  /* -- match lifecycle ----------------------------------------------------- */
  unsubscribe.push(bus.on('match:started', () => {
    // A previous match may have scheduled its delayed menu duck. Rematch and
    // retry can start inside that six-second verdict window; if the old timer
    // survives it silences every game bus mid-match while streamed music keeps
    // playing. Cancel it before making this world audible.
    cancelMatchEndQuiet();
    matchStartAt = engine?.now() ?? 0;
    bootLineFired = false;
    eva?.resetMatch();
    barks?.resetMatch();
    // THE WORLD BECOMES AUDIBLE HERE, and only here. `outcome.system.ts` is the
    // sole emitter of this event, and the menu's backdrop world never reaches
    // it — which is precisely the distinction the duck needs and the reason it
    // keys on the match rather than on a screen name the audio layer would
    // otherwise have to learn.
    applyMenuSilence(false);
    setMatchMusicTrim(true);
    music?.startMatch();
  }));

  unsubscribe.push(bus.on('match:ended', (p) => {
    cancelMatchEndQuiet();
    setMatchMusicTrim(false);
    if (p.localWon) { eva?.say('missionAccomplished'); music?.win(); }
    else { eva?.say('missionFailed'); music?.loss(); }
    eva?.say('battleControlTerminated');
    // BACK TO SILENCE, but not until the verdict line has been heard: the duck
    // takes hold on the next tick and EVA is already queued above. Without this
    // the end screen and the menu behind it inherit a live soundscape from a
    // match that is over.
    matchEndQuietTimer = setTimeout(() => {
      matchEndQuietTimer = null;
      applyMenuSilence(true);
    }, MATCH_END_QUIET_MS);
  }));

}

/** Selection barks go through the dedicated re-select guard. */
function barkSelectionFor(id: EntityId, signature: string): void {
  barkFor(id, 'select', signature);
}

/* -------------------------------------------------------------------------- */
/* Per-frame work                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Drain the presentation queue. The queue accumulates across every sim substep
 * and is cleared once per rendered frame by the loop, so a five-step catch-up
 * frame produces ONE cannon report for one shot, not five.
 */
function drainFx(): void {
  const { channels } = ctx();
  const q = channels.fx;
  const e = engine;
  if (e === null) return;
  for (let i = 0; i < q.count; i++) {
    const kind = q.kind[i] as FxKind;
    const id = FX_SOUND[kind];
    if (id === null || id === undefined) continue;
    const x = q.x[i], y = q.y[i], z = q.z[i];
    const scale = q.scale[i];

    e.play(id, x, y, z, scale !== 1 ? { gain: scale } : undefined);

    // The mix clearing for a big boom is the single most impactful trick in the
    // whole spec, and it is three lines.
    if (matchStartAt >= 0 && (kind === FxKind.ExplosionLarge || kind === FxKind.ExplosionBuilding)) {
      const D = AUDIO_DUCK;
      e.duckFor('boom', 'sfx', D.boomSfxDb, D.boomAttackMs, D.boomHoldMs, D.boomReleaseMs);
      e.duckFor('boom', 'music', D.boomMusicDb, 20, 300, 600);
    }
    if (kind === FxKind.MuzzleFlashSmall || kind === FxKind.MuzzleFlashMedium
        || kind === FxKind.MuzzleFlashLarge) {
      firingCount++;
    }
  }
}

/** Damage in the last 4 s, as a ring of 250 ms buckets. */
function pushDamage(amount: number): void {
  const t = engine?.now() ?? 0;
  if (t - damageBucketAt >= 0.25) {
    const advance = Math.min(DAMAGE_BUCKETS, Math.floor((t - damageBucketAt) / 0.25));
    for (let i = 0; i < advance; i++) {
      damageHead = (damageHead + 1) % DAMAGE_BUCKETS;
      damageRing[damageHead] = 0;
    }
    damageBucketAt = t;
  }
  damageRing[damageHead] += amount;
}

/**
 * H = 0.55 * (damage in 4 s / 900)
 *   + 0.30 * (hostile units within 30 tiles of the camera / 12)
 *   + 0.15 * (own units firing / 10)
 *
 * The unit scan is sliced across frames: it is a linear walk of the alive list,
 * cheap at 200 entities, but there is no reason to pay for it 60 times a second
 * when the procedural music fallback only re-evaluates every 250 ms. The
 * streamed score ignores heat, but retaining the input makes a missing-file
 * fallback immediate rather than restarting at idle intensity.
 */
function updateHeat(r: RenderContext): void {
  const e = engine;
  if (e === null || music === null) return;
  const t = e.now();

  if (t - firingDecayAt > 1) { firingDecayAt = t; firingCount = 0; }

  if ((r.frame & 15) === 0) {
    const { world, cameraRig } = ctx();
    const s = world.store;
    const localP = world.localPlayer;
    const radius = AUDIO_MUSIC.nearUnitTiles * CELL;
    const r2 = radius * radius;
    const fx = cameraRig.focus.x, fz = cameraRig.focus.z;
    let near = 0;
    for (let n = 0; n < s.aliveCount; n++) {
      const i = s.alive[n];
      const kind = s.kind[i];
      if (kind !== EntityKind.Infantry && kind !== EntityKind.Vehicle) continue;
      const dx = s.posX[i] - fx, dz = s.posZ[i] - fz;
      if (dx * dx + dz * dz > r2) continue;
      if (s.owner[i] !== (localP as number) && !world.areAllied(s.owner[i] as PlayerId, localP)) near++;
    }
    hostileNear = near;

    // Fade the hum out when the camera leaves the base entirely.
    ambience?.setHumAudible(poweredPlants > 0 && nearOwnedStructure(fx, fz));
  }

  let damage = 0;
  for (let i = 0; i < DAMAGE_BUCKETS; i++) damage += damageRing[i];

  const W = AUDIO_MUSIC.weights;
  let h =
    W[0] * Math.min(1, damage / AUDIO_MUSIC.damageRef) +
    W[1] * Math.min(1, hostileNear / AUDIO_MUSIC.nearUnitRef) +
    W[2] * Math.min(1, firingCount / AUDIO_MUSIC.firingRef);

  // An explicit push outranks the computed value while it is fresh.
  if (externalHeat >= 0 && t - externalHeatAt < EXTERNAL_HEAT_HOLD_SEC) h = externalHeat;
  else if (externalHeat >= 0) externalHeat = -1;

  music.setCombatHeat(Math.min(1, h));
}

/** Record an explicit intensity push. See EXTERNAL_HEAT_HOLD_SEC. */
function pushExternalHeat(v: number): void {
  externalHeat = v < 0 ? 0 : v > 1 ? 1 : v;
  externalHeatAt = engine?.now() ?? 0;
  music?.setCombatHeat(externalHeat);
}

/** True when any owned structure is within the hum's audible radius. */
function nearOwnedStructure(x: number, z: number): boolean {
  const { world } = ctx();
  const s = world.store;
  const localP = world.localPlayer as number;
  const r = AUDIO_AMBIENCE.humRangeMetres;
  const r2 = r * r;
  for (let n = 0; n < s.aliveCount; n++) {
    const i = s.alive[n];
    if (s.kind[i] !== EntityKind.Building) continue;
    if (s.owner[i] !== localP) continue;
    const dx = s.posX[i] - x, dz = s.posZ[i] - z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/**
 * The two announcer conditions that are STATES rather than events: a sustained
 * brownout, and a production queue that has been stalled on money. Both need a
 * dwell time, which an event cannot express.
 */
function pollAnnouncer(): void {
  const e = engine;
  if (e === null || eva === null) return;
  const t = e.now();

  if (matchStartAt >= 0 && !bootLineFired && t - matchStartAt > 1.2) {
    bootLineFired = true;
    eva.say('battleControlOnline');
  }

  if (brownoutSince >= 0 && t - brownoutSince >= 1.5) {
    eva.say('lowPower');
    // The line's own 45 s cooldown handles repetition; re-arm the dwell so a
    // brownout that persists does not re-trigger the instant the cooldown ends.
    brownoutSince = t;
  }

  const { world } = ctx();
  const p = world.players[world.localPlayer as number];
  if (p === undefined) return;
  let stalled = false;
  for (const q of p.queues) {
    const head = q.items[0];
    if (head !== undefined && head.onHold && p.credits < head.cost - head.spent) { stalled = true; break; }
  }
  if (stalled) {
    if (fundsStalledSince < 0) fundsStalledSince = t;
    else if (t - fundsStalledSince > 0.5) { eva.say('insufficientFunds'); fundsStalledSince = t; }
  } else {
    fundsStalledSince = -1;
  }
}

function updateCounters(): void {
  const { debug } = ctx();
  const e = engine;
  if (e === null) return;
  debug.setCounter('audioVoices', e.stats.oneShots);
  debug.setCounter('audioLoops', e.stats.loops);
  debug.setCounter('musicLayer', music?.currentLayer ?? 0);
  debug.setCounter('combatHeat', Math.round((music?.intensity ?? 0) * 100));
}

/** `?map=` / `?biome=` decide the wind bed and the reverb environment. */
function theatreFromFlags(): Theatre {
  const raw = (flag('biome') ?? flag('map') ?? 'temperate').toLowerCase();
  if (raw.includes('desert') || raw.includes('arid')) return 'desert';
  if (raw.includes('snow') || raw.includes('arctic')) return 'snow';
  if (raw.includes('urban') || raw.includes('city')) return 'urban';
  return 'temperate';
}

/* -------------------------------------------------------------------------- */
/* Console handle                                                             */
/* -------------------------------------------------------------------------- */

declare global {
  // eslint-disable-next-line no-var
  var __vmAudio: {
    engine: () => AudioEngine | null;
    eva: (line: string) => void;
    play: (id: string, x?: number, y?: number, z?: number) => void;
    heat: (v: number) => void;
    theatre: (t: Theatre) => void;
    volume: (bus: string, percent: number) => void;
  } | undefined;
}

if (typeof globalThis !== 'undefined') {
  globalThis.__vmAudio = {
    engine: () => engine,
    eva: (line: string) => { eva?.say(line); },
    play: (id: string, x?: number, y?: number, z?: number) => { engine?.play(id, x, y, z); },
    heat: (v: number) => { pushExternalHeat(v); },
    theatre: (t: Theatre) => {
      void engine?.setTheatre(t === 'temperate' ? 'temperate' : t);
      ambience?.startWind(t);
    },
    volume: (bus: string, percent: number) => {
      if (bus === 'master') engine?.setMasterVolume(percent);
      else engine?.setBusVolume(bus as 'music' | 'sfx' | 'voice' | 'ui' | 'ambience', percent);
    },
  };
}
