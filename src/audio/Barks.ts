/**
 * ============================================================================
 * VOLTMARCH — src/audio/Barks.ts
 * ============================================================================
 * UNIT RESPONSES. The same formant synth and radio chain as EVA, but harder
 * driven (k = 11), narrower (420 Hz – 2500 Hz) and shorter, so a bark cuts
 * through gunfire without needing extra gain (VISUAL_DNA §3.3).
 *
 * THE RULE THAT MATTERS MOST
 * --------------------------
 * **Only one bark voice ever exists.** Select twelve riflemen and exactly ONE
 * speaks — the one nearest the click, weighted against having spoken last time.
 * Twelve overlapping "GI reporting" is the single fastest way to make an RTS
 * feel amateur, and it is what every naive implementation does.
 *
 * Lines are drawn from a SHUFFLE BAG per (class, category): every line is used
 * once before any repeats, and the bag reshuffles when empty. That is strictly
 * better than random choice, which produces audible doubles, and better than
 * round-robin, which produces an audible cycle.
 *
 * All text is original. Nothing here is transcribed from a shipped game.
 * ============================================================================
 */

import { AUDIO_BARK, AUDIO_DUCK } from '../core/config';
import { EntityKind, Faction } from '../core/types';
import { AudioEngine, makeRng, normalizeBuffer, type Rng01 } from './AudioEngine';
import {
  BARK_PROFILES, renderUtterance, utteranceSeconds, type VoiceProfile,
} from './Eva';

/* ==========================================================================
 * 1. VOCABULARY
 * ========================================================================== */

export type BarkCategory =
  | 'select' | 'move' | 'attack' | 'deploy' | 'capture' | 'underFire' | 'cargoFull';

export interface BarkLine {
  readonly text: string;
  readonly phones: string;
}

/** Bark voice classes. Maps to a `VoiceProfile` through PROFILE_FOR_CLASS. */
export type BarkClass =
  | 'allied_infantry' | 'allied_infantry_f' | 'soviet_infantry'
  | 'engineer' | 'tesla_trooper'
  | 'allied_vehicle' | 'soviet_vehicle'
  | 'allied_air' | 'soviet_air'
  | 'naval' | 'harvester' | 'mcv';

const PROFILE_FOR_CLASS: Readonly<Record<BarkClass, string>> = {
  allied_infantry: 'allied_infantry',
  allied_infantry_f: 'allied_infantry_f',
  soviet_infantry: 'soviet_infantry',
  engineer: 'engineer',
  tesla_trooper: 'soviet_infantry',
  allied_vehicle: 'allied_vehicle',
  soviet_vehicle: 'soviet_vehicle',
  allied_air: 'air',
  soviet_air: 'air',
  naval: 'naval',
  harvester: 'allied_vehicle',
  mcv: 'soviet_vehicle',
};

function line(text: string, phones: string): BarkLine {
  return { text, phones };
}

/* ==========================================================================
 * 2. THE LINES  (§3.3 — original, same register)
 *
 * Phoneme alphabet is documented in Eva.ts. These are hand-authored: a
 * text-to-phoneme engine would mispronounce "Comrade" and "Kirov" forever, and
 * the whole inventory is under 4 KB.
 * ========================================================================== */

export const BARKS: Readonly<Record<BarkClass, Partial<Record<BarkCategory, readonly BarkLine[]>>>> = {
  allied_infantry: {
    select: [
      line('GI reporting.', 'J i Y , r I p O r t I N'),
      line('Awaiting orders.', '@ w e t I N , O r d R z'),
      line('Standing by.', 's t a n d I N , b Y'),
      line('Ready to move out.', 'r E d i , t u , m u v , Q t'),
    ],
    move: [
      line('Moving out.', 'm u v I N , Q t'),
      line('On my way.', 'A n , m Y , w e'),
      line('Affirmative.', '@ f R m @ t I v'),
      line('Got it.', 'g A t , I t'),
    ],
    attack: [
      line('Engaging.', 'E n g e J I N'),
      line('Opening fire.', 'o p @ n I N , f Y R'),
      line('Target acquired.', 't A r g @ t , @ k w Y R d'),
    ],
    deploy: [
      line('Digging in.', 'd I g I N , I n'),
      line('Sandbags up.', 's a n d b a g z , V p'),
    ],
    underFire: [
      line('Taking fire!', 't e k I N , f Y R'),
      line('We are pinned!', 'w i , A r , p I n d'),
    ],
  },

  allied_infantry_f: {
    select: [
      line('Reporting in.', 'r I p O r t I N , I n'),
      line('Ready when you are.', 'r E d i , w E n , j u , A r'),
      line('Standing by.', 's t a n d I N , b Y'),
    ],
    move: [
      line('On my way.', 'A n , m Y , w e'),
      line('Affirmative.', '@ f R m @ t I v'),
    ],
    attack: [
      line('Engaging.', 'E n g e J I N'),
      line('Target acquired.', 't A r g @ t , @ k w Y R d'),
    ],
    underFire: [
      line('Taking fire!', 't e k I N , f Y R'),
    ],
  },

  soviet_infantry: {
    select: [
      line('Conscript reporting.', 'k A n s k r I p t , r I p O r t I N'),
      line('For the Union.', 'f O r , D @ , j u n j @ n'),
      line('Ready, Comrade.', 'r E d i ; k A m r a d'),
      line('Awaiting command.', '@ w e t I N , k @ m a n d'),
    ],
    move: [
      line('Moving, Comrade.', 'm u v I N ; k A m r a d'),
      line('As ordered.', 'a z , O r d R d'),
      line('We advance.', 'w i , @ d v a n s'),
    ],
    attack: [
      line('Attacking!', '@ t a k I N'),
      line('Open fire!', 'o p @ n , f Y R'),
      line('Crush them!', 'k r V S , D E m'),
    ],
    underFire: [
      line('We are under fire!', 'w i , A r , V n d R , f Y R'),
      line('Comrade, we need support!', 'k A m r a d ; w i , n i d , s @ p O r t'),
    ],
  },

  engineer: {
    select: [
      line('Engineer here.', 'E n J @ n i r , h i r'),
      line('Tools ready.', 't u l z , r E d i'),
    ],
    move: [
      line('Moving to secure.', 'm u v I N , t u , s @ k j u r'),
    ],
    capture: [
      line('I will get it running.', 'Y , w I l , g E t , I t , r V n I N'),
      line('Moving to secure.', 'm u v I N , t u , s @ k j u r'),
    ],
  },

  tesla_trooper: {
    select: [
      line('Charged.', 'C A r J d'),
      line('Coils hot.', 'k W l z , h A t'),
    ],
    move: [
      line('Advancing.', '@ d v a n s I N'),
    ],
    attack: [
      line('Discharging!', 'd I s C A r J I N'),
      line('Feel the current!', 'f i l , D @ , k R @ n t'),
    ],
  },

  allied_vehicle: {
    select: [
      line('Tank commander.', 't a N k , k @ m a n d R'),
      line('Armor ready.', 'A r m R , r E d i'),
      line('Engine is hot.', 'E n J @ n , I z , h A t'),
      line('Crew standing by.', 'k r u , s t a n d I N , b Y'),
    ],
    move: [
      line('Rolling out.', 'r o l I N , Q t'),
      line('Moving.', 'm u v I N'),
      line('Repositioning.', 'r i p @ z I S @ n I N'),
    ],
    attack: [
      line('Target in sights.', 't A r g @ t , I n , s Y t s'),
      line('Firing main gun.', 'f Y R I N , m e n , g V n'),
      line('Engaging armor.', 'E n g e J I N , A r m R'),
    ],
  },

  soviet_vehicle: {
    select: [
      line('Armor standing by.', 'A r m R , s t a n d I N , b Y'),
      line('Tank ready, Comrade.', 't a N k , r E d i ; k A m r a d'),
      line('Treads warm.', 't r E d z , w O r m'),
    ],
    move: [
      line('Advancing.', '@ d v a n s I N'),
      line('The line moves forward.', 'D @ , l Y n , m u v z , f O r w R d'),
    ],
    attack: [
      line('Cannon loaded.', 'k a n @ n , l o d @ d'),
      line('Nothing will stand.', 'n V T I N , w I l , s t a n d'),
      line('Firing.', 'f Y R I N'),
    ],
  },

  allied_air: {
    select: [
      line('Airborne.', 'E r b O r n'),
      line('Pilot ready.', 'p Y l @ t , r E d i'),
      line('Wings level.', 'w I N z , l E v @ l'),
    ],
    move: [
      line('Vectoring in.', 'v E k t R I N , I n'),
      line('Climbing out.', 'k l Y m I N , Q t'),
    ],
    attack: [
      line('Weapons free.', 'w E p @ n z , f r i'),
      line('Missiles away.', 'm I s @ l z , @ w e'),
      line('Rolling in hot.', 'r o l I N , I n , h A t'),
    ],
  },

  soviet_air: {
    select: [
      line('Kirov reporting.', 'k i r A v , r I p O r t I N'),
      line('Airship ready.', 'E r S I p , r E d i'),
    ],
    move: [
      line('Course laid in.', 'k O r s , l e d , I n'),
      line('Ascending.', '@ s E n d I N'),
    ],
    attack: [
      line('Bomb bay open.', 'b A m , b e , o p @ n'),
      line('Payload away.', 'p e l o d , @ w e'),
    ],
  },

  naval: {
    select: [
      line('Bridge reporting.', 'b r I J , r I p O r t I N'),
      line('Helm ready.', 'h E l m , r E d i'),
    ],
    move: [
      line('Course laid in.', 'k O r s , l e d , I n'),
      line('Ahead full.', '@ h E d , f U l'),
    ],
    attack: [
      line('Guns to bear.', 'g V n z , t u , b E r'),
      line('Batteries firing.', 'b a t R i z , f Y R I N'),
    ],
  },

  harvester: {
    select: [
      line('Ore truck ready.', 'O r , t r V k , r E d i'),
    ],
    move: [
      line('Heading to the field.', 'h E d I N , t u , D @ , f i l d'),
    ],
    cargoFull: [
      line('Cargo full, returning.', 'k A r g o , f U l ; r I t R n I N'),
    ],
  },

  mcv: {
    select: [
      line('Construction vehicle standing by.',
        'k @ n s t r V k S @ n , v i @ k @ l , s t a n d I N , b Y'),
    ],
    move: [
      line('Moving to position.', 'm u v I N , t u , p @ z I S @ n'),
    ],
    deploy: [
      line('Deploying.', 'd I p l W I N'),
    ],
  },
};

/* ==========================================================================
 * 3. CLASS RESOLUTION
 * ========================================================================== */

/**
 * Pick a bark class from what the sim actually knows about an entity.
 *
 * `hints` is a free-text content key (`'grizzly'`, `'harvester'`, `'mig'`) —
 * `Scenarios.entityKeyOf` produces exactly these, and the data module's def
 * keys use the same vocabulary. Matching on substrings rather than an exact
 * table means a new unit gets a plausible voice the day it lands instead of
 * silence, which is the failure mode that actually hurts.
 */
export function barkClassFor(kind: EntityKind, faction: Faction, hint = ''): BarkClass {
  const h = hint.toLowerCase();
  const soviet = faction === Faction.Soviets;

  if (h.includes('harvest') || h.includes('miner') || h.includes('ore')) return 'harvester';
  if (h.includes('mcv') || h.includes('dozer') || h.includes('construction')) return 'mcv';
  if (h.includes('engineer') || h.includes('spy')) return 'engineer';
  if (h.includes('tesla')) return 'tesla_trooper';
  if (h.includes('mig') || h.includes('kirov') || h.includes('vindicator')
      || h.includes('air') || h.includes('heli')) {
    return soviet ? 'soviet_air' : 'allied_air';
  }
  if (h.includes('destroyer') || h.includes('dreadnought') || h.includes('sub')
      || h.includes('ship') || h.includes('naval')) {
    return 'naval';
  }

  if (kind === EntityKind.Infantry) {
    if (soviet) return 'soviet_infantry';
    // Allied infantry alternates two voices so a squad is not one cloned man.
    return (hint.length & 1) === 0 ? 'allied_infantry' : 'allied_infantry_f';
  }
  return soviet ? 'soviet_vehicle' : 'allied_vehicle';
}

/* ==========================================================================
 * 4. THE DIRECTOR
 * ========================================================================== */

/** Peak level of a normalised bark. Slightly under EVA: barks never win. */
export const BARK_PEAK_DB = -8;

/**
 * The finished voice profile for a class: the class timbre with the bark band,
 * drive and pre-roll stamped on top. Exported so the measurement harness renders
 * exactly what the game plays rather than an approximation of it.
 */
export function barkProfileFor(cls: BarkClass): VoiceProfile {
  const base = BARK_PROFILES[PROFILE_FOR_CLASS[cls]] ?? BARK_PROFILES.allied_infantry;
  return {
    ...base,
    highpassHz: AUDIO_BARK.highpassHz,
    lowpassHz: base.lowpassHz,
    drive: AUDIO_BARK.drive,
    preRollMs: AUDIO_BARK.preRollMs,
    allowDropout: true,
  };
}

interface Bag { pool: number[]; next: number }

export interface BarkOptions {
  /** 'on' | 'reduced' (selection only) | 'off' — §3.7 accessibility. */
  mode?: 'on' | 'reduced' | 'off';
  onSubtitle?: (text: string, dwellSec: number) => void;
}

export class BarkDirector {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly baking = new Set<string>();
  private readonly bags = new Map<string, Bag>();
  private readonly rng: Rng01 = makeRng(0xba2c_5eed);

  /** Per-entity cooldown, keyed by EntityId as a plain number. */
  private readonly unitCooldown = new Map<number, number>();
  private lastGlobal = -Infinity;
  private lastEnd = -Infinity;
  private lastSpeaker = -1;
  private lastSelectionSignature = '';
  private lastSelectionAt = -Infinity;

  private speaking = false;
  private ducks: Array<{ release(): void }> = [];

  mode: 'on' | 'reduced' | 'off';
  private readonly onSubtitle: ((text: string, dwellSec: number) => void) | null;

  constructor(private readonly engine: AudioEngine, options: BarkOptions = {}) {
    this.mode = options.mode ?? 'on';
    this.onSubtitle = options.onSubtitle ?? null;
  }

  /**
   * Warm the select lines of the classes a match will actually use. Everything
   * else bakes on first demand — baking all 60 lines up front would double the
   * boot budget for voices most matches never hear.
   */
  async prebake(classes: readonly BarkClass[]): Promise<void> {
    if (this.mode === 'off') return;
    for (const c of classes) {
      const set = BARKS[c]?.select;
      if (set === undefined) continue;
      for (const l of set) await this.ensure(c, l);
    }
  }

  /**
   * Speak one line. Returns false whenever the bark was suppressed, which is
   * the common case and is not an error.
   *
   * @param entity  EntityId as a number, for the per-unit cooldown and the
   *                "do not let the same soldier answer twice" weighting.
   */
  bark(
    cls: BarkClass, category: BarkCategory, entity = -1,
    x?: number, y?: number, z?: number,
  ): boolean {
    if (this.mode === 'off') return false;
    if (this.mode === 'reduced' && category !== 'select') return false;
    if (this.speaking) return false;

    const t = this.engine.now();
    if (t - this.lastGlobal < AUDIO_BARK.globalCooldownSec) return false;
    if (t - this.lastEnd < 0.12) return false;
    if (entity >= 0) {
      const last = this.unitCooldown.get(entity);
      if (last !== undefined && t - last < AUDIO_BARK.unitCooldownSec) return false;
      // A unit that just spoke should not be the one picked again.
      if (entity === this.lastSpeaker && t - this.lastGlobal < AUDIO_BARK.reselectCooldownSec) {
        return false;
      }
    }

    const pool = BARKS[cls]?.[category];
    if (pool === undefined || pool.length === 0) return false;
    const chosen = pool[this.draw(`${cls}:${category}`, pool.length)];

    this.lastGlobal = t;
    this.lastSpeaker = entity;
    if (entity >= 0) this.unitCooldown.set(entity, t);
    this.speaking = true;
    void this.fire(cls, chosen, t, x, y, z);
    return true;
  }

  /**
   * Selection barks have one extra rule: re-selecting a group the player
   * already had selected re-barks at most every 2.5 s, so drag-selecting the
   * same army three times does not produce three "Standing by".
   */
  barkSelection(
    cls: BarkClass, signature: string, entity = -1, x?: number, y?: number, z?: number,
  ): boolean {
    const t = this.engine.now();
    if (signature === this.lastSelectionSignature
        && t - this.lastSelectionAt < AUDIO_BARK.reselectCooldownSec) {
      return false;
    }
    this.lastSelectionSignature = signature;
    this.lastSelectionAt = t;
    return this.bark(cls, 'select', entity, x, y, z);
  }

  /** Shuffle-bag draw: every line is used once before any repeats. */
  private draw(key: string, n: number): number {
    let bag = this.bags.get(key);
    if (bag === undefined || bag.next >= bag.pool.length || bag.pool.length !== n) {
      const pool: number[] = [];
      for (let i = 0; i < n; i++) pool.push(i);
      // Fisher-Yates on a seeded stream, so a replay barks identically.
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      bag = { pool, next: 0 };
      this.bags.set(key, bag);
    }
    return bag.pool[bag.next++];
  }

  private key(cls: BarkClass, l: BarkLine): string {
    return `${cls}|${l.phones}`;
  }

  private async ensure(cls: BarkClass, l: BarkLine): Promise<AudioBuffer | null> {
    const k = this.key(cls, l);
    const have = this.buffers.get(k);
    if (have !== undefined) return have;
    if (this.baking.has(k)) return null;
    const OC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null;
    if (OC === null) return null;
    this.baking.add(k);
    const profile = this.profile(cls);
    const rate = this.engine.ctx.sampleRate;
    const seconds = utteranceSeconds(l.phones, profile) + 0.4;
    try {
      const oc = new OC(1, Math.ceil(seconds * rate), rate);
      renderUtterance(oc, l.phones, profile, makeRng(hash(k)), true);
      const buf = await oc.startRendering();
      normalizeBuffer(buf);
      this.buffers.set(k, buf);
      return buf;
    } catch (err) {
      console.warn(`[barks] bake failed for ${k}`, err);
      return null;
    } finally {
      this.baking.delete(k);
    }
  }

  /** §3.3 profile, with the bark overrides applied on top of the class voice. */
  private profile(cls: BarkClass): VoiceProfile {
    return barkProfileFor(cls);
  }

  private async fire(
    cls: BarkClass, l: BarkLine, requestedAt: number,
    x?: number, y?: number, z?: number,
  ): Promise<void> {
    const buf = await this.ensure(cls, l);
    // A bake that took longer than half a second is stale: the order it was
    // acknowledging has already been carried out.
    if (buf === null || this.engine.now() - requestedAt > 0.5) { this.done(); return; }

    // Barks pan with the unit but do NOT attenuate with distance the way a
    // gunshot does — a report from a unit you just ordered has to be audible.
    let through: AudioNode | null = null;
    if (x !== undefined) {
      const s = this.engine.spatial(x, y ?? 0, z ?? 0);
      const p = this.engine.ctx.createStereoPanner();
      p.pan.value = s.pan * 0.7;
      p.connect(this.engine.busInput('voice'));
      through = p;
    }

    const played = this.engine.playBuffer(buf, 'voice', 'voice', BARK_PEAK_DB, through);
    if (played === null) { this.done(); return; }
    this.onSubtitle?.(l.text, 1.8);
    this.applyDucks();
    played.source.onended = () => {
      if (through !== null) { try { through.disconnect(); } catch { /* gone */ } }
      this.done();
    };
  }

  private applyDucks(): void {
    this.releaseDucks();
    const D = AUDIO_DUCK;
    this.ducks = [
      this.engine.duck('bark', 'music', D.barkMusicDb, D.barkAttackMs, D.barkReleaseMs),
      this.engine.duck('bark', 'sfx', D.barkSfxDb, D.barkAttackMs, 200),
    ];
  }

  private releaseDucks(): void {
    for (const d of this.ducks) d.release();
    this.ducks.length = 0;
  }

  private done(): void {
    this.speaking = false;
    this.lastEnd = this.engine.now();
    this.releaseDucks();
  }

  /** True while the single bark voice is occupied. */
  get busy(): boolean { return this.speaking; }

  /** Diagnostics: how many distinct utterances have been rendered. */
  get bakedCount(): number { return this.buffers.size; }

  resetMatch(): void {
    this.unitCooldown.clear();
    this.bags.clear();
    this.lastSpeaker = -1;
    this.lastSelectionSignature = '';
  }

  dispose(): void {
    this.releaseDucks();
    this.buffers.clear();
    this.bags.clear();
    this.unitCooldown.clear();
  }
}

/** Distinct from Eva's hash only in that it is local; same FNV-1a. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
