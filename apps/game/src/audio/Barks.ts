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
import { SampleBank, VOICE_MANIFEST, voicePath } from './Samples';

/* ==========================================================================
 * 1. VOCABULARY
 * ========================================================================== */

export type BarkCategory =
  | 'select' | 'move' | 'attack' | 'attackMove'
  | 'stop' | 'guard' | 'patrol' | 'scatter'
  | 'deploy' | 'capture' | 'repair' | 'ability'
  | 'underFire' | 'criticalDamage' | 'veterancy'
  | 'harvest' | 'cargoFull' | 'returnToRefinery'
  | 'enterTransport' | 'load' | 'unload' | 'rareIdle';

export interface BarkLine {
  readonly text: string;
  readonly phones: string;
}

/** Bark voice classes. Maps to a `VoiceProfile` through PROFILE_FOR_CLASS. */
export type BarkClass =
  | 'allied_infantry' | 'allied_infantry_f' | 'soviet_infantry' | 'soviet_infantry_f'
  | 'meridian_infantry' | 'meridian_infantry_f' | 'reclaim_infantry' | 'reclaim_infantry_f'
  | 'allied_specialist' | 'soviet_specialist' | 'meridian_specialist' | 'reclaim_specialist'
  | 'engineer' | 'tesla_trooper'
  | 'allied_vehicle' | 'soviet_vehicle' | 'meridian_vehicle' | 'reclaim_vehicle'
  | 'allied_air' | 'soviet_air' | 'meridian_air' | 'reclaim_air'
  | 'naval' | 'allied_harvester' | 'soviet_harvester' | 'meridian_harvester'
  | 'reclaim_harvester' | 'harvester'
  | 'allied_builder' | 'soviet_builder' | 'meridian_builder'
  | 'reclaim_builder' | 'mcv'
  | 'allied_transport' | 'soviet_transport' | 'meridian_transport' | 'reclaim_transport'
  | 'transport' | 'commander';

const PROFILE_FOR_CLASS: Readonly<Record<BarkClass, string>> = {
  allied_infantry: 'allied_infantry',
  allied_infantry_f: 'allied_infantry_f',
  soviet_infantry: 'soviet_infantry',
  soviet_infantry_f: 'soviet_infantry_f',
  meridian_infantry: 'engineer',
  meridian_infantry_f: 'meridian_infantry_f',
  reclaim_infantry: 'soviet_infantry',
  reclaim_infantry_f: 'reclaim_infantry_f',
  engineer: 'engineer',
  allied_specialist: 'engineer',
  soviet_specialist: 'soviet_infantry',
  meridian_specialist: 'engineer',
  reclaim_specialist: 'soviet_infantry',
  tesla_trooper: 'soviet_infantry',
  allied_vehicle: 'allied_vehicle',
  soviet_vehicle: 'soviet_vehicle',
  meridian_vehicle: 'allied_vehicle',
  reclaim_vehicle: 'soviet_vehicle',
  allied_air: 'air',
  soviet_air: 'air',
  meridian_air: 'air',
  reclaim_air: 'air',
  naval: 'naval',
  allied_harvester: 'allied_vehicle',
  soviet_harvester: 'soviet_vehicle',
  meridian_harvester: 'allied_vehicle',
  reclaim_harvester: 'soviet_vehicle',
  harvester: 'allied_vehicle',
  allied_builder: 'allied_vehicle',
  soviet_builder: 'soviet_vehicle',
  meridian_builder: 'allied_vehicle',
  reclaim_builder: 'soviet_vehicle',
  mcv: 'soviet_vehicle',
  allied_transport: 'naval',
  soviet_transport: 'naval',
  meridian_transport: 'naval',
  reclaim_transport: 'naval',
  transport: 'naval',
  commander: 'soviet_vehicle',
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
      line('G.I. reporting.', 'J i Y , r I p O r t I N'),
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
      line('Weapons free.', 'w E p @ n z , f r i'),
    ],
    deploy: [
      line('Digging in.', 'd I g I N , I n'),
      line('Sandbags up.', 's a n d b a g z , V p'),
    ],
    underFire: [
      line('Taking fire!', 't e k I N , f Y R'),
      line('We are pinned!', 'w i , A r , p I n d'),
      line('Squad under fire!', 's k w A d , V n d R , f Y R'),
    ],
  },

  allied_infantry_f: {
    select: [
      line('Squad two reporting.', 's k w A d , t u , r I p O r t I N'),
      line('Ready when you are.', 'r E d i , w E n , j u , A r'),
      line('Eyes up, standing by.', 'Y z , V p ; s t a n d I N , b Y'),
      line('Team ready to move.', 't i m , r E d i , t u , m u v'),
    ],
    move: [
      line('Moving now.', 'm u v I N , n Q'),
      line('On the route.', 'A n , D @ , r u t'),
      line('Understood.', 'V n d R s t u d'),
      line("We're on it.", 'w i R , A n , I t'),
    ],
    attack: [
      line('Contact, engaging.', 'k A n t a k t ; E n g e J I N'),
      line('Firing on target.', 'f Y R I N , A n , t A r g @ t'),
      line('Target marked.', 't A r g @ t , m A r k t'),
      line('Weapons clear.', 'w E p @ n z , k l i R'),
    ],
    underFire: [
      line('Incoming fire!', 'I n k V m I N , f Y R'),
      line("We're taking hits!", 'w i R , t e k I N , h I t s'),
      line('Need cover here!', 'n i d , k V v R , h i R'),
    ],
    deploy: [
      line('Setting the position.', 's E t I N , D @ , p @ z I S @ n'),
      line('Cover going up.', 'k V v R , g o I N , V p'),
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
      line('Forward together.', 'f O r w R d , t @ g E D R'),
    ],
    attack: [
      line('Attacking!', '@ t a k I N'),
      line('Open fire!', 'o p @ n , f Y R'),
      line('Crush their position!', 'k r V S , D e R , p @ z I S @ n'),
      line('Break their line!', 'b r e k , D e R , l Y n'),
    ],
    underFire: [
      line('We are under fire!', 'w i , A r , V n d R , f Y R'),
      line('Comrade, we need support!', 'k A m r a d ; w i , n i d , s @ p O r t'),
      line('Hold the line!', 'h o l d , D @ , l Y n'),
    ],
    deploy: [
      line('Taking position.', 't e k I N , p @ z I S @ n'),
      line('Fortify here.', 'f O r t @ f Y , h i R'),
    ],
  },

  soviet_infantry_f: {
    select: [
      line('Rifle team standing by.', 'r Y f @ l , t i m , s t a n d I N , b Y'),
      line('The line is ready.', 'D @ , l Y n , I z , r E d i'),
      line('Orders, Comrade.', 'O r d R z ; k A m r a d'),
      line('We are prepared.', 'w i , A r , p r I p e R d'),
    ],
    move: [
      line('We move together.', 'w i , m u v , t @ g E D R'),
      line('Orders received.', 'O r d R z , r I s i v d'),
      line('Taking the route.', 't e k I N , D @ , r u t'),
      line('Forward, keep pace.', 'f O r w R d ; k i p , p e s'),
    ],
    attack: [
      line('Bring fire on that position!', 'b r I N , f Y R , A n , D a t , p @ z I S @ n'),
      line('Target the front!', 't A r g @ t , D @ , f r V n t'),
      line('Weapons forward!', 'w E p @ n z , f O r w R d'),
      line('Drive them back!', 'd r Y v , D E m , b a k'),
    ],
    underFire: [
      line('The line is taking hits!', 'D @ , l Y n , I z , t e k I N , h I t s'),
      line('Support us now, Comrade!', 's @ p O r t , V s , n Y ; k A m r a d'),
      line('Keep formation!', 'k i p , f O r m e S @ n'),
    ],
    deploy: [
      line('Securing this ground.', 's I k j u R I N , D I s , g r Y n d'),
      line('Position reinforced.', 'p @ z I S @ n , r i I n f O r s t'),
    ],
  },

  meridian_infantry: {
    select: [
      line('Pact cadre ready.', 'p a k t , k a d r @ , r E d i'),
      line('Wayfarer aligned.', 'w e f e R R , @ l Y n d'),
      line('Formation observed.', 'f O r m e S @ n , @ b z R v d'),
      line('Awaiting the measure.', '@ w e t I N , D @ , m E Z R'),
    ],
    move: [
      line('Proceeding.', 'p r @ s i d I N'),
      line('Course is clear.', 'k O r s , I z , k l i R'),
      line('Advancing by interval.', '@ d v a n s I N , b Y , I n t R v @ l'),
      line('We take the marked path.', 'w i , t e k , D @ , m A r k t , p a T'),
    ],
    attack: [
      line('Mark the target.', 'm A r k , D @ , t A r g @ t'),
      line('Solution confirmed.', 's @ l u S @ n , k @ n f R m d'),
      line('Commit fire.', 'k @ m I t , f Y R'),
      line('Break their alignment.', 'b r e k , D e R , @ l Y n m @ n t'),
    ],
    underFire: [
      line('We are engaged!', 'w i , A r , E n g e J d'),
      line('Our line is compromised!', 'Y R , l Y n , I z , k A m p r @ m Y z d'),
      line('Reform on me!', 'r i f O r m , A n , m i'),
    ],
    deploy: [
      line('Establishing the line.', 'I s t a b l I S I N , D @ , l Y n'),
      line('This ground is measured.', 'D I s , g r Y n d , I z , m E Z R d'),
    ],
  },

  meridian_infantry_f: {
    select: [
      line('Second cadre attentive.', 's E k @ n d , k a d r @ , @ t E n t I v'),
      line('Interval confirmed.', 'I n t R v @ l , k @ n f R m d'),
      line('Sunlancer in order.', 's V n l a n s R , I n , O r d R'),
      line('Reading the field.', 'r i d I N , D @ , f i l d'),
    ],
    move: [
      line('Advancing on measure.', '@ d v a n s I N , A n , m E Z R'),
      line('Course accepted.', 'k O r s , a k s E p t I d'),
      line('Maintaining interval.', 'm e n t e n I N , I n t R v @ l'),
      line('Following the clear line.', 'f A l o I N , D @ , k l i R , l Y n'),
    ],
    attack: [
      line('Focus fire on the marked point!', 'f o k @ s , f Y R , A n , D @ , m A r k t , p W n t'),
      line('Range fixed.', 'r e n J , f I k s t'),
      line('Commit the array!', 'k @ m I t , D @ , @ r e'),
      line('Correct their position!', 'k R E k t , D e R , p @ z I S @ n'),
    ],
    underFire: [
      line('We are taking pressure!', 'w i , A r , t e k I N , p r E S R'),
      line('Formation is breaking!', 'f O r m e S @ n , I z , b r e k I N'),
      line('Close the formation!', 'k l o z , D @ , f O r m e S @ n'),
    ],
    deploy: [
      line('Setting the interval.', 's E t I N , D @ , I n t R v @ l'),
      line('Ground pattern secured.', 'g r Y n d , p a t R n , s I k j U R d'),
    ],
  },

  reclaim_infantry: {
    select: [
      line('Breaker ready.', 'b r e k R , r E d i'),
      line('Crew checked in.', 'k r u , C E k t , I n'),
      line('Hands ready.', 'h a n d z , r E d i'),
      line('Point us at the work.', 'p W n t , V s , a t , D @ , w R k'),
    ],
    move: [
      line('On the haul.', 'A n , D @ , h O l'),
      line('Taking the short way.', 't e k I N , D @ , S O r t , w e'),
      line('Boots moving.', 'b u t s , m u v I N'),
      line('Close the gap.', 'k l o z , D @ , g a p'),
    ],
    attack: [
      line('Take it apart.', 't e k , I t , @ p A r t'),
      line('Strip that position to frame!', 's t r I p , D a t , p @ z I S @ n , t u , f r e m'),
      line('Tools up, hit them!', 't u l z , V p ; h I t , D E m'),
      line('Break it down!', 'b r e k , I t , d Y n'),
    ],
    underFire: [
      line('Taking hits!', 't e k I N , h I t s'),
      line('Plate is coming apart!', 'p l e t , I z , k V m I N , @ p A r t'),
      line('Need welders forward!', 'n i d , w E l d R z , f O r w R d'),
    ],
    deploy: [
      line('Digging into the scrap.', 'd I g I N , I n t u , D @ , s k r a p'),
      line('Brace this ground.', 'b r e s , D I s , g r Y n d'),
    ],
  },

  reclaim_infantry_f: {
    select: [
      line('Salvage crew listening.', 's a l v I J , k r u , l I s @ n I N'),
      line('Gear is checked.', 'g i R , I z , C E k t'),
      line('Crew lead ready.', 'k r u , l i d , r E d i'),
      line("What's the next cut?", 'w V t s , D @ , n E k s t , k V t'),
    ],
    move: [
      line('Moving through the near cut.', 'm u v I N , T r u , D @ , n i R , k V t'),
      line('Taking the scrap road.', 't e k I N , D @ , s k r a p , r o d'),
      line('On our feet.', 'A n , Y R , f i t'),
      line("We'll get there.", 'w i l , g E t , D e R'),
    ],
    attack: [
      line('Pull that position to pieces!', 'p U l , D a t , p @ z I S @ n , t u , p i s I z'),
      line('Tear into it!', 't e R , I n t u , I t'),
      line('Put the tools through them!', 'p U t , D @ , t u l z , T r u , D E m'),
      line('Clear the lot!', 'k l i R , D @ , l A t'),
    ],
    underFire: [
      line('We are taking hard fire!', 'w i , A r , t e k I N , h A r d , f Y R'),
      line('Gear is buckling!', 'g i R , I z , b V k l I N'),
      line('Brace and keep working!', 'b r e s , a n d , k i p , w R k I N'),
    ],
    deploy: [
      line('Setting braces.', 's E t I N , b r e s I z'),
      line('Locking down the lot.', 'l A k I N , d Y n , D @ , l A t'),
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

  allied_specialist: {
    select: [
      line('Engineer on station.', 'E n J @ n i r , A n , s t e S @ n'),
      line('Field kit ready.', 'f i l d , k I t , r E d i'),
      line('Systems specialist here.', 's I s t @ m z , s p E S @ l I s t , h i r'),
      line('Site diagnostics online.', 's Y t , d Y @ g n A s t I k s , A n l Y n'),
    ],
    move: [
      line('Moving to inspect.', 'm u v I N , t u , I n s p E k t'),
      line('Route to site confirmed.', 'r u t , t u , s Y t , k @ n f R m d'),
      line('Engineer en route.', 'E n J @ n i r , E n , r u t'),
    ],
    stop: [
      line('Holding for instructions.', 'h o l d I N , f O r , I n s t r V k S @ n z'),
      line('Field kit standing by.', 'f i l d , k I t , s t a n d I N , b Y'),
    ],
    underFire: [
      line('Engineer taking fire!', 'E n J @ n i r , t e k I N , f Y R'),
      line('Site team under attack!', 's Y t , t i m , V n d R , @ t a k'),
      line('I need security here!', 'Y , n i d , s @ k j u r @ t i , h i r'),
    ],
    criticalDamage: [
      line('Field suit critical!', 'f i l d , s u t , k r I t I k @ l'),
      line('Engineer is going down!', 'E n J @ n i r , I z , g o I N , d Y n'),
    ],
    capture: [
      line('Securing the structure.', 's @ k j u r I N , D @ , s t r V k C R'),
      line('Taking control of the site.', 't e k I N , k @ n t r o l , V v , D @ , s Y t'),
      line('Beginning systems takeover.', 'b I g I n I N , s I s t @ m z , t e k o v R'),
    ],
    repair: [
      line('Starting field repairs.', 's t A r t I N , f i l d , r I p e R z'),
      line('Restoring the system.', 'r I s t O r I N , D @ , s I s t @ m'),
      line('Repair protocol active.', 'r I p e R , p r o t @ k A l , a k t I v'),
    ],
  },

  soviet_specialist: {
    select: [
      line('Field engineer ready.', 'f i l d , E n J @ n i r , r E d i'),
      line('Tools prepared.', 't u l z , p r I p e R d'),
      line('Technical crew standing by.', 't E k n I k @ l , k r u , s t a n d I N , b Y'),
      line('The work can begin.', 'D @ , w R k , k a n , b I g I n'),
    ],
    move: [
      line('Take me to the site.', 't e k , m i , t u , D @ , s Y t'),
      line('Engineer advancing.', 'E n J @ n i r , @ d v a n s I N'),
      line('Moving with the tools.', 'm u v I N , w I D , D @ , t u l z'),
    ],
    stop: [
      line('Holding position.', 'h o l d I N , p @ z I S @ n'),
      line('Tools remain ready.', 't u l z , r I m e n , r E d i'),
    ],
    underFire: [
      line('Engineer under fire!', 'E n J @ n i r , V n d R , f Y R'),
      line('They are hitting the technical crew!', 'D e , A r , h I t I N , D @ , t E k n I k @ l , k r u'),
      line('Protect the specialist!', 'p r @ t E k t , D @ , s p E S @ l I s t'),
    ],
    criticalDamage: [
      line('Field equipment critical!', 'f i l d , I k w I p m @ n t , k r I t I k @ l'),
      line('I will not hold much longer!', 'Y , w I l , n A t , h o l d , m V C , l A N g R'),
    ],
    capture: [
      line('Taking the structure for us.', 't e k I N , D @ , s t r V k C R , f O r , V s'),
      line('Their systems will answer to us.', 'D E r , s I s t @ m z , w I l , a n s R , t u , V s'),
      line('Beginning the takeover.', 'b I g I n I N , D @ , t e k o v R'),
    ],
    repair: [
      line('Restoring the machinery.', 'r I s t O r I N , D @ , m @ S i n R i'),
      line('Begin field repair.', 'b I g I n , f i l d , r I p e R'),
      line('The system will run again.', 'D @ , s I s t @ m , w I l , r V n , @ g E n'),
    ],
  },

  meridian_specialist: {
    select: [
      line('Artificer attentive.', 'A r t I f I s R , @ t E n t I v'),
      line('Instruments aligned.', 'I n s t r @ m @ n t s , @ l Y n d'),
      line('Restoration kit prepared.', 'r E s t @ r e S @ n , k I t , p r I p e R d'),
      line('The site can be measured.', 'D @ , s Y t , k a n , b i , m E Z R d'),
    ],
    move: [
      line('Course to the work.', 'k O r s , t u , D @ , w R k'),
      line('Approaching the site.', '@ p r o C I N , D @ , s Y t'),
      line('Instruments in motion.', 'I n s t r @ m @ n t s , I n , m o S @ n'),
    ],
    stop: [
      line('Holding the measure.', 'h o l d I N , D @ , m E Z R'),
      line('Artificer at rest.', 'A r t I f I s R , a t , r E s t'),
    ],
    underFire: [
      line('Artificer under fire!', 'A r t I f I s R , V n d R , f Y R'),
      line('The instrument team is exposed!', 'D @ , I n s t r @ m @ n t , t i m , I z , E k s p o z d'),
      line('We require a screen!', 'w i , r I k w Y R , @ , s k r i n'),
    ],
    criticalDamage: [
      line('Instrument integrity critical!', 'I n s t r @ m @ n t , I n t E g r @ t i , k r I t I k @ l'),
      line('My field rig is failing!', 'm Y , f i l d , r I g , I z , f e l I N'),
    ],
    capture: [
      line('Rewriting the site alignment.', 'r i r Y t I N , D @ , s Y t , @ l Y n m @ n t'),
      line('Bringing the structure into accord.', 'b r I N I N , D @ , s t r V k C R , I n t u , @ k O r d'),
      line('The new control pattern begins.', 'D @ , n u , k @ n t r o l , p a t R n , b I g I n z'),
    ],
    repair: [
      line('Restoring structural balance.', 'r I s t O r I N , s t r V k C R @ l , b a l @ n s'),
      line('Beginning the repair measure.', 'b I g I n I N , D @ , r I p e R , m E Z R'),
      line('The system returns to alignment.', 'D @ , s I s t @ m , r I t R n z , t u , @ l Y n m @ n t'),
    ],
  },

  reclaim_specialist: {
    select: [
      line('Tinker checked in.', 't I N k R , C E k t , I n'),
      line('Tools are live.', 't u l z , A r , l Y v'),
      line('Patch kit ready.', 'p a C , k I t , r E d i'),
      line('Show me what broke.', 'S o , m i , w V t , b r o k'),
    ],
    move: [
      line('Heading to the job.', 'h E d I N , t u , D @ , J A b'),
      line('Taking the tool road.', 't e k I N , D @ , t u l , r o d'),
      line('Tinker moving.', 't I N k R , m u v I N'),
    ],
    stop: [
      line('Setting the kit down.', 's E t I N , D @ , k I t , d Y n'),
      line('Holding for the next job.', 'h o l d I N , f O r , D @ , n E k s t , J A b'),
    ],
    underFire: [
      line('Tinker taking hits!', 't I N k R , t e k I N , h I t s'),
      line("They're shooting up the tools!", 'D E r , S u t I N , V p , D @ , t u l z'),
      line('Need cover on this job!', 'n i d , k V v R , A n , D I s , J A b'),
    ],
    criticalDamage: [
      line('Patch rig critical!', 'p a C , r I g , k r I t I k @ l'),
      line("I'm losing the whole kit!", 'Y m , l u z I N , D @ , h o l , k I t'),
    ],
    capture: [
      line('Taking their controls apart.', 't e k I N , D E r , k @ n t r o l z , @ p A r t'),
      line('This site works for us now.', 'D I s , s Y t , w R k s , f O r , V s , n Y'),
      line('Cutting into the control box.', 'k V t I N , I n t u , D @ , k @ n t r o l , b A k s'),
    ],
    repair: [
      line('Patching the frame.', 'p a C I N , D @ , f r e m'),
      line('Putting the machine back together.', 'p U t I N , D @ , m @ S i n , b a k , t @ g E D R'),
      line('Give me a moment with it.', 'g I v , m i , @ , m o m @ n t , w I D , I t'),
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
      line('Armour crew online.', 'A r m R , k r u , A n l Y n'),
      line('Armour ready.', 'A r m R , r E d i'),
      line('Systems green.', 's I s t @ m z , g r i n'),
    ],
    move: [
      line('Rolling on your mark.', 'r o l I N , A n , j O r , m A r k'),
      line('Route locked.', 'r u t , l A k t'),
      line('Armour moving.', 'A r m R , m u v I N'),
    ],
    attack: [
      line('Target solution confirmed.', 't A r g @ t , s @ l u S @ n , k @ n f R m d'),
      line('Engage the target.', 'E n g e J , D @ , t A r g @ t'),
      line('Precision fire.', 'p r I s I Z @ n , f Y R'),
    ],
    underFire: [
      line('Taking armour hits!', 't e k I N , A r m R , h I t s'),
      line('Hull breach warning!', 'h V l , b r i C , w O r n I N'),
      line('We need a screen!', 'w i , n i d , @ , s k r i n'),
    ],
  },

  soviet_vehicle: {
    select: [
      line('Heavy armour ready.', 'h E v i , A r m R , r E d i'),
      line('Steel standing by.', 's t i l , s t a n d I N , b Y'),
      line('Engines awake.', 'E n J @ n z , @ w e k'),
    ],
    move: [
      line('Advance the line.', '@ d v a n s , D @ , l Y n'),
      line('Treads forward.', 't r E d z , f O r w R d'),
      line('We move.', 'w i , m u v'),
    ],
    attack: [
      line('Load for battle.', 'l o d , f O r , b a t @ l'),
      line('Break their line.', 'b r e k , D E r , l Y n'),
      line('Weapons, fire!', 'w E p @ n z ; f Y R'),
    ],
    underFire: [
      line('Armour holding!', 'A r m R , h o l d I N'),
      line('Taking heavy fire!', 't e k I N , h E v i , f Y R'),
      line('Comrade, support the advance!', 'k A m r a d ; s @ p O r t , D @ , @ d v a n s'),
    ],
  },

  meridian_vehicle: {
    select: [
      line('Pact hull aligned.', 'p a k t , h V l , @ l Y n d'),
      line('Hull in balance.', 'h V l , I n , b a l @ n s'),
      line('Weapon array ready.', 'w E p @ n , @ r e , r E d i'),
    ],
    move: [
      line('Course accepted.', 'k O r s , @ k s E p t @ d'),
      line('Gliding to station.', 'g l Y d I N , t u , s t e S @ n'),
      line('We follow the light.', 'w i , f A l o , D @ , l Y t'),
    ],
    attack: [
      line('Mark the distant target.', 'm A r k , D @ , d I s t @ n t , t A r g @ t'),
      line('Weapon array committed.', 'w E p @ n , @ r e , k @ m I t @ d'),
      line('Solution held.', 's @ l u S @ n , h E l d'),
    ],
    underFire: [
      line('Shield skin failing!', 'S i l d , s k I n , f e l I N'),
      line('They have closed the distance!', 'D e , h a v , k l o z d , D @ , d I s t @ n s'),
      line('Reform the line!', 'r i f O r m , D @ , l Y n'),
    ],
  },

  reclaim_vehicle: {
    select: [
      line('Line rig fired up.', 'l Y n , r I g , f Y R d , V p'),
      line('Crew and weapon ready.', 'k r u , a n d , w E p @ n , r E d i'),
      line('Point us at the work.', 'p O n t , V s , a t , D @ , w R k'),
    ],
    move: [
      line('Tracks turning.', 't r a k s , t R n I N'),
      line('Taking the short way.', 't e k I N , D @ , S O r t , w e'),
      line('Closing the gap.', 'k l o z I N , D @ , g a p'),
    ],
    attack: [
      line('Break them down.', 'b r e k , D E m , d Q n'),
      line('Weapon live, face the target.', 'w E p @ n , l Y v ; f e s , D @ , t A r g @ t'),
      line('Strip it to frame.', 's t r I p , I t , t u , f r e m'),
    ],
    underFire: [
      line('Plate coming loose!', 'p l e t , k V m I N , l u s'),
      line('We are taking it hard!', 'w i , A r , t e k I N , I t , h A r d'),
      line('Welders, stand by!', 'w E l d R z ; s t a n d , b Y'),
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

  meridian_air: {
    select: [line('Pact flight ready.', 'p a k t , f l Y t , r E d i')],
    move: [line('Vector received.', 'v E k t R , r I s i v d')],
    attack: [line('Ordnance committed.', 'O r d n @ n s , k @ m I t @ d')],
  },

  reclaim_air: {
    select: [line('Rotor rig ready.', 'r o t R , r I g , r E d i')],
    move: [line('Lifting out.', 'l I f t I N , Q t')],
    attack: [line('Dropping in.', 'd r A p I N , I n')],
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

  allied_harvester: {
    select: [
      line('Allied ore crew ready.', '@ l Y d , O r , k r u , r E d i'),
      line('Collector systems green.', 'k @ l E k t R , s I s t @ m z , g r i n'),
      line('Hauler standing by.', 'h O l R , s t a n d I N , b Y'),
    ],
    move: [
      line('Rolling to the field.', 'r o l I N , t u , D @ , f i l d'),
      line('Route to ore locked.', 'r u t , t u , O r , l A k t'),
      line('Hauler moving.', 'h O l R , m u v I N'),
    ],
    stop: [
      line('Parking the rig.', 'p A r k I N , D @ , r I g'),
      line('Ore crew holding.', 'O r , k r u , h o l d I N'),
    ],
    underFire: [
      line('Hauler taking fire!', 'h O l R , t e k I N , f Y R'),
      line('Ore truck under attack!', 'O r , t r V k , V n d R , @ t a k'),
      line('We need an escort!', 'w i , n i d , @ n , E s k O r t'),
    ],
    criticalDamage: [
      line('Hopper rig critical!', 'h A p R , r I g , k r I t I k @ l'),
      line("We're losing the hauler!", 'w i r , l u z I N , D @ , h O l R'),
    ],
    harvest: [
      line('Starting extraction.', 's t A r t I N , E k s t r a k S @ n'),
      line('Ore intake active.', 'O r , I n t e k , a k t I v'),
      line('Working this deposit.', 'w R k I N , D I s , d @ p A z I t'),
    ],
    cargoFull: [
      line('Hopper full.', 'h A p R , f U l'),
      line('Cargo at capacity.', 'k A r g o , a t , k @ p a s I t i'),
      line('Full load secured.', 'f U l , l o d , s @ k U R d'),
    ],
    returnToRefinery: [
      line('Returning to refinery.', 'r I t R n I N , t u , r @ f Y n R i'),
      line('Hauling the load home.', 'h O l I N , D @ , l o d , h o m'),
      line('Route to the refinery.', 'r u t , t u , D @ , r @ f Y n R i'),
    ],
  },

  soviet_harvester: {
    select: [
      line('Ore crew standing by.', 'O r , k r u , s t a n d I N , b Y'),
      line('Hauler ready for work.', 'h O l R , r E d i , f O r , w R k'),
      line('Hopper is empty.', 'h A p R , I z , E m p t i'),
    ],
    move: [
      line('Wheels to the field.', 'w i l z , t u , D @ , f i l d'),
      line('Taking the ore road.', 't e k I N , D @ , O r , r o d'),
      line('We haul.', 'w i , h O l'),
    ],
    stop: [
      line('Brakes set.', 'b r e k s , s E t'),
      line('Holding the hauler.', 'h o l d I N , D @ , h O l R'),
    ],
    underFire: [
      line('Ore truck under fire!', 'O r , t r V k , V n d R , f Y R'),
      line('They are hitting the hauler!', 'D e , A r , h I t I N , D @ , h O l R'),
      line('Escort, close on us!', 'E s k O r t , k l o s , A n , V s'),
    ],
    criticalDamage: [
      line('Hauler is critical!', 'h O l R , I z , k r I t I k @ l'),
      line('The rig will not hold!', 'D @ , r I g , w I l , n A t , h o l d'),
    ],
    harvest: [
      line('Cutting into the seam.', 'k V t I N , I n t u , D @ , s i m'),
      line('Ore intake running.', 'O r , I n t e k , r V n I N'),
      line('Begin the load.', 'b I g I n , D @ , l o d'),
    ],
    cargoFull: [
      line('Hopper is full.', 'h A p R , I z , f U l'),
      line('Full Soviet load.', 'f U l , s o v i E t , l o d'),
      line('Cargo secured.', 'k A r g o , s @ k U R d'),
    ],
    returnToRefinery: [
      line('Returning with ore.', 'r I t R n I N , w I D , O r'),
      line('Take the load home.', 't e k , D @ , l o d , h o m'),
      line('Refinery route set.', 'r @ f Y n R i , r u t , s E t'),
    ],
  },

  meridian_harvester: {
    select: [
      line('Sun Collector aligned.', 's V n , k @ l E k t R , @ l Y n d'),
      line('Reservoir ready.', 'r E z R v w A r , r E d i'),
      line('Collection crew attentive.', 'k @ l E k S @ n , k r u , @ t E n t I v'),
    ],
    move: [
      line('Course to the seam.', 'k O r s , t u , D @ , s i m'),
      line('Collector in motion.', 'k @ l E k t R , I n , m o S @ n'),
      line('We follow the deposit.', 'w i , f A l o , D @ , d @ p A z I t'),
    ],
    stop: [
      line('Holding alignment.', 'h o l d I N , @ l Y n m @ n t'),
      line('Collector at rest.', 'k @ l E k t R , a t , r E s t'),
    ],
    underFire: [
      line('Collector under fire!', 'k @ l E k t R , V n d R , f Y R'),
      line('Our reservoir is exposed!', 'Q R , r E z R v w A r , I z , E k s p o z d'),
      line('We require a screen!', 'w i , r I k w Y R , @ , s k r i n'),
    ],
    criticalDamage: [
      line('Collector integrity critical!', 'k @ l E k t R , I n t E g r I t i , k r I t I k @ l'),
      line('The reservoir is failing!', 'D @ , r E z R v w A r , I z , f e l I N'),
    ],
    harvest: [
      line('Drawing from the seam.', 'd r O I N , f r A m , D @ , s i m'),
      line('Collection cycle active.', 'k @ l E k S @ n , s Y k @ l , a k t I v'),
      line('The deposit yields.', 'D @ , d @ p A z I t , i l d z'),
    ],
    cargoFull: [
      line('Reservoir at capacity.', 'r E z R v w A r , a t , k @ p a s I t i'),
      line('Full measure secured.', 'f U l , m E Z R , s @ k U R d'),
      line('Collection complete.', 'k @ l E k S @ n , k @ m p l i t'),
    ],
    returnToRefinery: [
      line('Returning to the receiver.', 'r I t R n I N , t u , D @ , r I s i v R'),
      line('Carrying the measure home.', 'k a r i I N , D @ , m E Z R , h o m'),
      line('Receiver course aligned.', 'r I s i v R , k O r s , @ l Y n d'),
    ],
  },

  reclaim_harvester: {
    select: [
      line('Scrapjaw crew ready.', 's k r a p J O , k r u , r E d i'),
      line('Crusher checked.', 'k r V S R , C E k t'),
      line('Empty jaw, ready to work.', 'E m p t i , J O , r E d i , t u , w R k'),
    ],
    move: [
      line('Rolling to the cut.', 'r o l I N , t u , D @ , k V t'),
      line('Taking the salvage road.', 't e k I N , D @ , s a l v I J , r o d'),
      line('Jaw on the move.', 'J O , A n , D @ , m u v'),
    ],
    stop: [
      line('Setting the brakes.', 's E t I N , D @ , b r e k s'),
      line('Holding the rig.', 'h o l d I N , D @ , r I g'),
    ],
    underFire: [
      line('Scrapjaw taking hits!', 's k r a p J O , t e k I N , h I t s'),
      line("They're punching through the rig!", 'D e r , p V n C I N , T r u , D @ , r I g'),
      line('Need cover on the hauler!', 'n i d , k V v R , A n , D @ , h O l R'),
    ],
    criticalDamage: [
      line('Crusher frame critical!', 'k r V S R , f r e m , k r I t I k @ l'),
      line("We're shedding the rig!", 'w i r , S E d I N , D @ , r I g'),
    ],
    harvest: [
      line('Biting into the seam.', 'b Y t I N , I n t u , D @ , s i m'),
      line('Crusher running.', 'k r V S R , r V n I N'),
      line('Pulling value out.', 'p U l I N , v a l U , Q t'),
    ],
    cargoFull: [
      line('Jaw is full.', 'J O , I z , f U l'),
      line('Full load strapped.', 'f U l , l o d , s t r a p t'),
      line('Hopper packed tight.', 'h A p R , p a k t , t Y t'),
    ],
    returnToRefinery: [
      line('Taking the load back.', 't e k I N , D @ , l o d , b a k'),
      line('Sorter route marked.', 's O r t R , r u t , m A r k t'),
      line('Hauling value home.', 'h O l I N , v a l U , h o m'),
    ],
  },

  allied_builder: {
    select: [
      line('Construction vehicle online.', 'k @ n s t r V k S @ n , v i @ k @ l , A n l Y n'),
      line('Site crew ready.', 's Y t , k r u , r E d i'),
      line('Survey systems green.', 's R v e , s I s t @ m z , g r i n'),
    ],
    move: [
      line('Moving to the site.', 'm u v I N , t u , D @ , s Y t'),
      line('Construction route locked.', 'k @ n s t r V k S @ n , r u t , l A k t'),
      line('Rolling on your mark.', 'r o l I N , A n , Y R , m A r k'),
    ],
    stop: [
      line('Site vehicle holding.', 's Y t , v i @ k @ l , h o l d I N'),
      line('Parking the construction rig.', 'p A r k I N , D @ , k @ n s t r V k S @ n , r I g'),
    ],
    underFire: [
      line('Construction vehicle taking fire!', 'k @ n s t r V k S @ n , v i @ k @ l , t e k I N , f Y R'),
      line('Site crew under attack!', 's Y t , k r u , V n d R , @ t a k'),
      line('We need protection!', 'w i , n i d , p r @ t E k S @ n'),
    ],
    criticalDamage: [
      line('Construction rig critical!', 'k @ n s t r V k S @ n , r I g , k r I t I k @ l'),
      line("We're losing the site vehicle!", 'w i r , l u z I N , D @ , s Y t , v i @ k @ l'),
    ],
    deploy: [
      line('Establishing construction yard.', 'E s t a b l I S I N , k @ n s t r V k S @ n , Y A r d'),
      line('Deploying the site package.', 'd I p l W I N , D @ , s Y t , p a k I J'),
      line('Building the command site.', 'b I l d I N , D @ , k @ m a n d , s Y t'),
    ],
  },

  soviet_builder: {
    select: [
      line('Construction column ready.', 'k @ n s t r V k S @ n , k A l @ m , r E d i'),
      line('Builder crew standing by.', 'b I l d R , k r u , s t a n d I N , b Y'),
      line('Heavy rig prepared.', 'h E v i , r I g , p r I p e r d'),
    ],
    move: [
      line('Take us to the site.', 't e k , V s , t u , D @ , s Y t'),
      line('Builder rolling.', 'b I l d R , r o l I N'),
      line('Advance the construction rig.', '@ d v a n s , D @ , k @ n s t r V k S @ n , r I g'),
    ],
    stop: [
      line('Brakes set.', 'b r e k s , s E t'),
      line('Builder holding.', 'b I l d R , h o l d I N'),
    ],
    underFire: [
      line('Builder under fire!', 'b I l d R , V n d R , f Y R'),
      line('They are striking the construction rig!', 'D e , A r , s t r Y k I N , D @ , k @ n s t r V k S @ n , r I g'),
      line('Protect the crew!', 'p r @ t E k t , D @ , k r u'),
    ],
    criticalDamage: [
      line('Construction rig critical!', 'k @ n s t r V k S @ n , r I g , k r I t I k @ l'),
      line('The builder will not hold!', 'D @ , b I l d R , w I l , n A t , h o l d'),
    ],
    deploy: [
      line('Raise the construction yard.', 'r e z , D @ , k @ n s t r V k S @ n , Y A r d'),
      line('Unfold the works.', 'V n f o l d , D @ , w R k s'),
      line('Establish the base.', 'E s t a b l I S , D @ , b e s'),
    ],
  },

  meridian_builder: {
    select: [
      line('Pactworks Carryall aligned.', 'p a k t w R k s , k a r i O l , @ l Y n d'),
      line('Foundation crew attentive.', 'f Q n d e S @ n , k r u , @ t E n t I v'),
      line('Site instruments ready.', 's Y t , I n s t r @ m @ n t s , r E d i'),
    ],
    move: [
      line('Course to the foundation.', 'k O r s , t u , D @ , f Q n d e S @ n'),
      line('Carryall in motion.', 'k a r i O l , I n , m o S @ n'),
      line('We approach the site.', 'w i , @ p r o C , D @ , s Y t'),
    ],
    stop: [
      line('Holding site alignment.', 'h o l d I N , s Y t , @ l Y n m @ n t'),
      line('Carryall at rest.', 'k a r i O l , a t , r E s t'),
    ],
    underFire: [
      line('Carryall under fire!', 'k a r i O l , V n d R , f Y R'),
      line('The foundation package is exposed!', 'D @ , f Q n d e S @ n , p a k I J , I z , E k s p o z d'),
      line('We require protection!', 'w i , r I k w Y R , p r @ t E k S @ n'),
    ],
    criticalDamage: [
      line('Carryall integrity critical!', 'k a r i O l , I n t E g r I t i , k r I t I k @ l'),
      line('The site package is failing!', 'D @ , s Y t , p a k I J , I z , f e l I N'),
    ],
    deploy: [
      line('Establishing the Conclave.', 'E s t a b l I S I N , D @ , k A n k l e v'),
      line('Unfold the foundation.', 'V n f o l d , D @ , f Q n d e S @ n'),
      line('The new site begins.', 'D @ , n u , s Y t , b I g I n z'),
    ],
  },

  reclaim_builder: {
    select: [
      line('Yardcrawler checked in.', 'Y A r d k r O l R , C E k t , I n'),
      line('Foundry crew ready.', 'f Q n d r i , k r u , r E d i'),
      line('Mobile yard fired up.', 'm o b @ l , Y A r d , f Y R d , V p'),
    ],
    move: [
      line('Crawling to the lot.', 'k r O l I N , t u , D @ , l A t'),
      line('Taking the yard road.', 't e k I N , D @ , Y A r d , r o d'),
      line('Hauling the works over.', 'h O l I N , D @ , w R k s , o v R'),
    ],
    stop: [
      line('Setting the crawler down.', 's E t I N , D @ , k r O l R , d Q n'),
      line('Yard rig holding.', 'Y A r d , r I g , h o l d I N'),
    ],
    underFire: [
      line('Yardcrawler taking hits!', 'Y A r d k r O l R , t e k I N , h I t s'),
      line("They're tearing into the works!", 'D e r , t e r I N , I n t u , D @ , w R k s'),
      line('Need cover on the crawler!', 'n i d , k V v R , A n , D @ , k r O l R'),
    ],
    criticalDamage: [
      line('Yard frame critical!', 'Y A r d , f r e m , k r I t I k @ l'),
      line("We're losing the crawler!", 'w i r , l u z I N , D @ , k r O l R'),
    ],
    deploy: [
      line('Setting up the Foundry.', 's E t I N , V p , D @ , f Q n d r i'),
      line('Drop the braces and build.', 'd r A p , D @ , b r e s I z , a n d , b I l d'),
      line('Turning this lot into a yard.', 't R n I N , D I s , l A t , I n t u , @ , Y A r d'),
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

  transport: {
    select: [line('Transport ready.', 't r a n s p O r t , r E d i')],
    move: [line('Carrying through.', 'k a r i I N , T r u')],
    deploy: [line('Passengers away.', 'p a s @ n J R z , @ w e')],
  },

  allied_transport: {
    select: [
      line("Lift crew online.", 'r E d i'),
      line("Transport systems green.", 'r E d i'),
      line("Passenger deck ready.", 'r E d i'),
      line("Carrier standing by.", 'r E d i'),
    ],
    move: [
      line("Plotting the crossing.", 'm u v I N'),
      line("Transport moving.", 'm u v I N'),
      line("Route to shore confirmed.", 'm u v I N'),
    ],
    attack: [
      line("Defensive weapons live.", 't A r g @ t , E n g e J d'),
      line("Engaging from the carrier.", 't A r g @ t , E n g e J d'),
      line("Covering the landing.", 't A r g @ t , E n g e J d'),
    ],
    stop: [
      line("Holding the transport.", 'h o l d I N'),
      line("Carrier stopped.", 'h o l d I N'),
    ],
    guard: [
      line("Screening the formation.", 'g A r d I N'),
      line("Guard route accepted.", 'g A r d I N'),
    ],
    patrol: [
      line("Beginning coastal patrol.", 'p @ t r o l'),
      line("Running the patrol line.", 'p @ t r o l'),
    ],
    underFire: [
      line("Transport taking fire!", 'V n d R , f Y R'),
      line("Passenger deck under attack!", 'V n d R , f Y R'),
      line("We need escort now!", 'V n d R , f Y R'),
    ],
    criticalDamage: [
      line("Carrier integrity critical!", 'k r I t I k @ l'),
      line("Transport is going down!", 'k r I t I k @ l'),
    ],
    unload: [
      line("Deploying the passengers.", 'p a s @ n J R z , @ w e'),
      line("Landing party away.", 'p a s @ n J R z , @ w e'),
      line("Clearing the passenger deck.", 'p a s @ n J R z , @ w e'),
    ],
  },

  soviet_transport: {
    select: [
      line("Transport crew ready.", 'r E d i'),
      line("The troop deck is prepared.", 'r E d i'),
      line("Carrier awaiting orders.", 'r E d i'),
      line("We carry the advance.", 'r E d i'),
    ],
    move: [
      line("Set course for the crossing.", 'm u v I N'),
      line("Transport advancing.", 'm u v I N'),
      line("Take us to the shore.", 'm u v I N'),
    ],
    attack: [
      line("Carrier guns engaging.", 't A r g @ t , E n g e J d'),
      line("Protect the troop deck.", 't A r g @ t , E n g e J d'),
      line("Fire across the landing.", 't A r g @ t , E n g e J d'),
    ],
    stop: [
      line("Holding the carrier.", 'h o l d I N'),
      line("Engines to idle.", 'h o l d I N'),
    ],
    guard: [
      line("We screen the formation.", 'g A r d I N'),
      line("Guard course set.", 'g A r d I N'),
    ],
    patrol: [
      line("Begin the water patrol.", 'p @ t r o l'),
      line("We hold the crossing lane.", 'p @ t r o l'),
    ],
    underFire: [
      line("Transport under fire!", 'V n d R , f Y R'),
      line("They are hitting the troop deck!", 'V n d R , f Y R'),
      line("Escort the carrier!", 'V n d R , f Y R'),
    ],
    criticalDamage: [
      line("Carrier hull critical!", 'k r I t I k @ l'),
      line("We will not stay afloat!", 'k r I t I k @ l'),
    ],
    unload: [
      line("Put the troops ashore.", 'p a s @ n J R z , @ w e'),
      line("Landing force away.", 'p a s @ n J R z , @ w e'),
      line("Clear the troop deck.", 'p a s @ n J R z , @ w e'),
    ],
  },

  meridian_transport: {
    select: [
      line("Passage vessel aligned.", 'r E d i'),
      line("The passenger measure is ready.", 'r E d i'),
      line("Carrier attentive.", 'r E d i'),
      line("Embarkation systems balanced.", 'r E d i'),
    ],
    move: [
      line("Course across the water.", 'm u v I N'),
      line("Carrying the formation onward.", 'm u v I N'),
      line("Approach to shore aligned.", 'm u v I N'),
    ],
    attack: [
      line("Defensive array committed.", 't A r g @ t , E n g e J d'),
      line("Screening the passage.", 't A r g @ t , E n g e J d'),
      line("Fire along the landing line.", 't A r g @ t , E n g e J d'),
    ],
    stop: [
      line("Holding the passage.", 'h o l d I N'),
      line("Carrier at rest.", 'h o l d I N'),
    ],
    guard: [
      line("Maintaining the protective course.", 'g A r d I N'),
      line("Formation screen aligned.", 'g A r d I N'),
    ],
    patrol: [
      line("Beginning the horizon circuit.", 'p @ t r o l'),
      line("Holding the patrol measure.", 'p @ t r o l'),
    ],
    underFire: [
      line("Passage vessel under fire!", 'V n d R , f Y R'),
      line("The passenger deck is exposed!", 'V n d R , f Y R'),
      line("We require an escort!", 'V n d R , f Y R'),
    ],
    criticalDamage: [
      line("Carrier balance critical!", 'k r I t I k @ l'),
      line("The passage vessel is failing!", 'k r I t I k @ l'),
    ],
    unload: [
      line("Releasing the landing group.", 'p a s @ n J R z , @ w e'),
      line("Passage complete, deploy.", 'p a s @ n J R z , @ w e'),
      line("Clearing the passenger measure.", 'p a s @ n J R z , @ w e'),
    ],
  },

  reclaim_transport: {
    select: [
      line("Hauler crew checked in.", 'r E d i'),
      line("Passenger rack ready.", 'r E d i'),
      line("The lift rig is running.", 'r E d i'),
      line("Show us the next crossing.", 'r E d i'),
    ],
    move: [
      line("Hauling for the far bank.", 'm u v I N'),
      line("Carrier moving.", 'm u v I N'),
      line("Taking the wet road.", 'm u v I N'),
    ],
    attack: [
      line("Deck gun on the job.", 't A r g @ t , E n g e J d'),
      line("Cover the unloading side.", 't A r g @ t , E n g e J d'),
      line("Firing across the beach.", 't A r g @ t , E n g e J d'),
    ],
    stop: [
      line("Parking the hauler.", 'h o l d I N'),
      line("Carrier holding.", 'h o l d I N'),
    ],
    guard: [
      line("Keeping the convoy covered.", 'g A r d I N'),
      line("Guarding the loaded rig.", 'g A r d I N'),
    ],
    patrol: [
      line("Working the water line.", 'p @ t r o l'),
      line("Running the crossing route.", 'p @ t r o l'),
    ],
    underFire: [
      line("Hauler taking hits!", 'V n d R , f Y R'),
      line("They're tearing up the passenger rack!", 'V n d R , f Y R'),
      line("Need cover on the carrier!", 'V n d R , f Y R'),
    ],
    criticalDamage: [
      line("Lift rig critical!", 'k r I t I k @ l'),
      line("We're losing the whole hauler!", 'k r I t I k @ l'),
    ],
    unload: [
      line("Get the crew off the rack.", 'p a s @ n J R z , @ w e'),
      line("Dropping the landing party.", 'p a s @ n J R z , @ w e'),
      line("Empty the carrier, now.", 'p a s @ n J R z , @ w e'),
    ],
  },
  commander: {
    select: [line('Command present.', 'k @ m a n d , p r E z @ n t')],
    move: [line('I will lead.', 'Y , w I l , l i d')],
    attack: [line('Commit the line.', 'k @ m I t , D @ , l Y n')],
    deploy: [line('Hold this ground.', 'h o l d , D I s , g r Q n d')],
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
  const meridian = faction === Faction.Meridian;
  const reclaim = faction === Faction.Reclaim;

  if (h.includes('harvest') || h.includes('miner') || h.includes('ore')
      || h.includes('collector') || h.includes('scrapper')) {
    if (soviet) return 'soviet_harvester';
    if (meridian) return 'meridian_harvester';
    if (reclaim) return 'reclaim_harvester';
    return 'allied_harvester';
  }
  if (h.includes('mcv') || h.includes('dozer') || h.includes('construction')) {
    if (soviet) return 'soviet_builder';
    if (meridian) return 'meridian_builder';
    if (reclaim) return 'reclaim_builder';
    return 'allied_builder';
  }
  if (h.includes('engineer') || h.includes('spy') || h.includes('artificer')
      || h.includes('tinker')) {
    if (soviet) return 'soviet_specialist';
    if (meridian) return 'meridian_specialist';
    if (reclaim) return 'reclaim_specialist';
    return 'allied_specialist';
  }
  if (h.includes('marshal') || h.includes('commissar') || h.includes('hierarch')
      || h.includes('baron')) return 'commander';
  if (h.includes('tesla')) return 'tesla_trooper';
  if (h.includes('transport') || h.includes('landingcraft') || h.includes('assaultbarge')
      || h.includes('lighter') || h.includes('argosy') || h.includes('hauler')) {
    if (soviet) return 'soviet_transport';
    if (meridian) return 'meridian_transport';
    if (reclaim) return 'reclaim_transport';
    return 'allied_transport';
  }
  if (h.includes('mig') || h.includes('kirov') || h.includes('vindicator')
      || h.includes('kestrel') || h.includes('hornet') || h.includes('air')
      || h.includes('heli')) {
    if (soviet) return 'soviet_air';
    if (meridian) return 'meridian_air';
    if (reclaim) return 'reclaim_air';
    return 'allied_air';
  }
  if (kind !== EntityKind.Infantry && (h.includes('destroyer') || h.includes('dreadnought') || h.includes('sub')
      || h.includes('ship') || h.includes('naval') || h.includes('gunboat')
      || h.includes('hydrofoil') || h.includes('corvette') || h.includes('monitor')
      || h.includes('cutter') || h.includes('scow') || h.includes('hulk')
      || h.includes('skimmer') || h.includes('picket'))) {
    return 'naval';
  }

  if (kind === EntityKind.Infantry) {
    // Soviet line troops keep the lower voice while specialist rifle teams
    // use the field-sergeant performer. Key routing is explicit because every
    // current Soviet infantry key happens to have odd length.
    if (soviet) {
      return h.includes('flak') || h.includes('naval')
        ? 'soviet_infantry_f'
        : 'soviet_infantry';
    }
    if (meridian) {
      return h.includes('lancer') || h.includes('tide')
        ? 'meridian_infantry_f'
        : 'meridian_infantry';
    }
    if (reclaim) {
      return h.includes('slagger') || h.includes('dredger')
        ? 'reclaim_infantry_f'
        : 'reclaim_infantry';
    }
    return (hint.length & 1) === 0 ? 'allied_infantry' : 'allied_infantry_f';
  }
  if (meridian) return 'meridian_vehicle';
  if (reclaim) return 'reclaim_vehicle';
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

/**
 * Which recorded voice a class speaks in.
 *
 * Two voices for the current class matrix, so most of the army shares one. That is the
 * honest limit of what CC0 supplies, and it is still a considerable
 * improvement on every class sharing one formant synthesiser.
 */
const VOICE_OF: Readonly<Record<BarkClass, 'm' | 'f'>> = {
  allied_infantry: 'm', allied_infantry_f: 'f', soviet_infantry: 'm', soviet_infantry_f: 'f',
  meridian_infantry: 'm', meridian_infantry_f: 'f', reclaim_infantry: 'm', reclaim_infantry_f: 'f',
  allied_specialist: 'f', soviet_specialist: 'm', meridian_specialist: 'f',
  reclaim_specialist: 'm', engineer: 'm', tesla_trooper: 'm',
  allied_vehicle: 'm', soviet_vehicle: 'm',
  meridian_vehicle: 'f', reclaim_vehicle: 'm',
  allied_air: 'f', soviet_air: 'm',
  meridian_air: 'f', reclaim_air: 'm',
  naval: 'm', allied_harvester: 'f', soviet_harvester: 'm', meridian_harvester: 'f',
  reclaim_harvester: 'm', harvester: 'f',
  allied_builder: 'm', soviet_builder: 'f', meridian_builder: 'm',
  reclaim_builder: 'f', mcv: 'm',
  allied_transport: 'f', soviet_transport: 'm', meridian_transport: 'f', reclaim_transport: 'm',
  transport: 'f', commander: 'm',
};

/** Class-specific recorded packs supersede the two generic CC0 performers. */
const CUSTOM_VOICE_OF: Readonly<Partial<Record<BarkClass, string>>> = {
  allied_infantry: 'al-inf-a',
  allied_infantry_f: 'al-inf-b',
  soviet_infantry: 'sv-inf-a',
  soviet_infantry_f: 'sv-inf-b',
  meridian_infantry: 'mr-inf-a',
  meridian_infantry_f: 'mr-inf-b',
  reclaim_infantry: 'rc-inf-a',
  reclaim_infantry_f: 'rc-inf-b',
  allied_specialist: 'al-spec',
  soviet_specialist: 'sv-spec',
  meridian_specialist: 'mr-spec',
  reclaim_specialist: 'rc-spec',
  allied_vehicle: 'al-arm',
  soviet_vehicle: 'sv-arm',
  meridian_vehicle: 'mr-arm',
  reclaim_vehicle: 'rc-arm',
  allied_harvester: 'al-harv',
  soviet_harvester: 'sv-harv',
  meridian_harvester: 'mr-harv',
  reclaim_harvester: 'rc-harv',
  allied_builder: 'al-build',
  soviet_builder: 'sv-build',
  meridian_builder: 'mr-build',
  reclaim_builder: 'rc-build',
  allied_transport: 'al-trans',
  soviet_transport: 'sv-trans',
  meridian_transport: 'mr-trans',
  reclaim_transport: 'rc-trans',
};

/** Resolve the recorded family, falling back category-by-category. */
export function recordedVoiceKeyFor(cls: BarkClass, category: BarkCategory): string {
  const custom = CUSTOM_VOICE_OF[cls];
  const customKey = custom === undefined ? '' : `${custom}.${category}`;
  if (customKey !== '' && customKey in VOICE_MANIFEST) return customKey;
  // The legacy generic take registered as `*.cargoFull` says “Reloading.”
  // That is a weapon response, not a logistics report. Keep it in the bank for
  // compatibility tests, but never let a harvester lie about what it is doing.
  // The exact scripted line synthesises until the dedicated faction pack lands.
  if (category === 'cargoFull') return '__synthetic__.cargoFull';
  return `${VOICE_OF[cls]}.${category}`;
}

/**
 * What the recorded line actually SAYS, per category.
 *
 * `BARKS` still chooses a line, because it drives the bag shuffle and the
 * cooldowns. Its `text` is now wrong for the subtitle, though: the script says
 * "Moving out." and the recording says "Go go go". A subtitle that does not
 * match the audio is worse than no subtitle — it is the one part of this that
 * a player relying on captions cannot check for themselves — so the caption
 * follows the recording.
 */
const VOICE_TEXT: Readonly<Partial<Record<BarkCategory, string>>> = {
  select: 'Ready.',
  move: 'Go, go, go!',
  attack: 'Target engaged.',
  deploy: 'Holding position.',
  capture: 'Objective achieved.',
  underFire: 'Cover me!',
  cargoFull: 'Reloading.',
};

/**
 * Semantic destinations land before their paid recordings do. Until a class
 * owns an exact response, preserve the old truthful broad acknowledgement
 * instead of going silent or pretending a generic recording says new words.
 */
export const BARK_CATEGORY_FALLBACK: Readonly<Partial<Record<BarkCategory, BarkCategory>>> = {
  attackMove: 'attack',
  stop: 'deploy',
  guard: 'deploy',
  patrol: 'move',
  scatter: 'move',
  repair: 'move',
  ability: 'attack',
  criticalDamage: 'underFire',
  veterancy: 'select',
  harvest: 'move',
  returnToRefinery: 'move',
  enterTransport: 'move',
  load: 'move',
  unload: 'deploy',
  rareIdle: 'select',
};

export class BarkDirector {
  /** Recorded unit voices. Falls back to the formant synth when unavailable. */
  private readonly voices = new SampleBank(VOICE_MANIFEST, voicePath);
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
      for (const l of set) await this.ensure(c, 'select', l);
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

    const exact = BARKS[cls]?.[category];
    const effectiveCategory = exact !== undefined && exact.length > 0
      ? category
      : (BARK_CATEGORY_FALLBACK[category] ?? category);
    const pool = BARKS[cls]?.[effectiveCategory];
    if (pool === undefined || pool.length === 0) return false;
    const chosen = pool[this.draw(`${cls}:${effectiveCategory}`, pool.length)];

    this.lastGlobal = t;
    this.lastSpeaker = entity;
    if (entity >= 0) this.unitCooldown.set(entity, t);
    this.speaking = true;
    void this.fire(cls, effectiveCategory, chosen, t, x, y, z);
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

  private async ensure(
    cls: BarkClass, cat: BarkCategory, l: BarkLine,
  ): Promise<AudioBuffer | null> {
    // RECORDED VOICE FIRST. `load` is idempotent and resolves instantly after
    // the first call, so awaiting here costs one microtask per bark and buys
    // a real voice from the very first order rather than after a warm-up.
    await this.voices.load(this.engine.ctx);
    const vk = recordedVoiceKeyFor(cls, cat);
    const takes = this.voices.count(vk);
    if (takes > 0) {
      const custom = CUSTOM_VOICE_OF[cls];
      if (custom !== undefined && vk.startsWith(`${custom}.`)) {
        // The recorded AL-ARM takes and BARKS lines share the same declared
        // order. Reuse the script draw so the subtitle, fallback and audio can
        // never describe three different acknowledgements.
        const lineIndex = BARKS[cls]?.[cat]?.indexOf(l) ?? -1;
        if (lineIndex >= 0) return this.voices.get(vk, lineIndex % takes);
      }
      // Same bag shuffle as the script lines, so a replay picks identically
      // and the same unit does not repeat itself twice running.
      return this.voices.get(vk, this.draw(`v:${vk}`, takes));
    }

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
    cls: BarkClass, cat: BarkCategory, l: BarkLine, requestedAt: number,
    x?: number, y?: number, z?: number,
  ): Promise<void> {
    const buf = await this.ensure(cls, cat, l);
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
    // Caption what was actually said, not what the script would have said.
    const recordedKey = recordedVoiceKeyFor(cls, cat);
    const custom = CUSTOM_VOICE_OF[cls];
    const exactCustomTake = custom !== undefined && recordedKey.startsWith(`${custom}.`);
    this.onSubtitle?.(
      this.voices.has(recordedKey) ? (exactCustomTake ? l.text : (VOICE_TEXT[cat] ?? l.text)) : l.text,
      1.8,
    );
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
