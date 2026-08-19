/**
 * ============================================================================
 * src/game/Teams.ts — WHO IS ON WHOSE SIDE
 * ============================================================================
 * `PlayerState.allyMask` has been read end to end since the day it was written
 * — targeting, vision, the minimap, damage, crush, capture, garrison, the
 * outcome poll — and until this file existed NOTHING WROTE IT except
 * `createPlayerState` (self only) and `ScenarioBuilder.gaia` (the scenery,
 * allied to everybody). So every diplomatic reader in the game was correct and
 * unreachable: a free-for-all was not the default, it was the only thing that
 * could be expressed.
 *
 * TWO FUNCTIONS, AND THEY ARE THE TWO HALVES OF ONE RULE.
 *
 * `applyTeams` is the WRITER, called once, at the one place seats are created
 * (`Shell.applySetupToWorld`). `isHostileSeat` is the READER every module that
 * decides a match now shares, because "not Gaia and not allied to me" was
 * written out inline in five places across two files, and five copies of a rule
 * nobody could exercise is exactly how the sixth copy comes to disagree.
 *
 * IT ONLY EVER SETS BITS, NEVER CLEARS THEM
 * -----------------------------------------
 * Three reasons, all of them load-bearing:
 *
 *  1. GAIA. `ScenarioBuilder.gaia` allies the scenery to everyone in BOTH
 *     directions, and it runs after this on a fresh boot but BEFORE it on a
 *     re-entered one. Assigning a computed mask would drop the Gaia bit
 *     whenever the order came out the other way, and a tree would become a
 *     legal target for every gun on the map.
 *  2. IDEMPOTENCE. `applySetupToWorld` documents itself as re-enterable on the
 *     boot retry path. Setting a bit twice is setting a bit.
 *  3. A SAVE OR A REPLAY OUTRANKS A LOBBY. `SaveGame` restores `allyMask` per
 *     player from the blob and `Shell.seatReplayPlayers` restores it from the
 *     header; both run after this and both write the mask they recorded.
 *
 * SYMMETRY IS THE INVARIANT
 * -------------------------
 * `World.areAllied(a, b)` reads `a`'s mask alone, so a one-directional write is
 * a world where one army holds fire and the other does not — no error, no log,
 * and the losing side simply gets shot in the back. Every write here is a pair.
 *
 * DETERMINISM. No clock, no RNG, and `allyMask` is hashed by
 * `Checksum.hashPlayers`: two machines that seated different teams disagree on
 * tick zero, loudly, which is the correct outcome for a mistake this size.
 * ============================================================================
 */

import { Faction } from '../core/types';
import type { PlayerId, PlayerState } from '../core/types';
import type { World } from '../core/world';

/**
 * Ally every pair of seats that share a team number.
 *
 * `teams[i]` describes `world.players[i]`, seat for seat, which is the order
 * `Shell.applySetupToWorld` fills the table in and the order `teamsOf` produces.
 * Seats past the end of the list, and any seat holding `Faction.Neutral`, are
 * left exactly as they are — Gaia's mask is not a team, it is the scenery being
 * friends with everybody, and folding it into a team would make the trees pick
 * a side.
 *
 * A free-for-all — every entry distinct — writes nothing at all, so a match set
 * up the way every match before this one was set up is bit-identical to a build
 * without this file.
 */
export function applyTeams(world: World, teams: readonly number[]): void {
  const n = Math.min(teams.length, world.players.length);
  for (let a = 0; a < n; a++) {
    const pa = world.players[a];
    if (pa === undefined || pa.faction === Faction.Neutral) continue;
    for (let b = a + 1; b < n; b++) {
      const pb = world.players[b];
      if (pb === undefined || pb.faction === Faction.Neutral) continue;
      if (teams[a] !== teams[b]) continue;
      // BOTH DIRECTIONS. See the header: `areAllied` asks one side only.
      pa.allyMask |= 1 << b;
      pb.allyMask |= 1 << a;
    }
  }
}

/**
 * Does `local` have to beat this seat to win?
 *
 * THE ONE DEFINITION OF "ENEMY" THE OUTCOME RULES SHARE. `outcome.system.ts`
 * had it three times (the victory poll, the winner search and the recomputed
 * verdict) and `Shell.ts` twice (its own poll and the end screen's opponent
 * list), each spelled out inline as `faction !== Neutral && !areAllied`. They
 * happened to agree, and they could not be told apart while the answer was
 * always "everyone else" — teams are what make the five copies falsifiable, so
 * they are one copy now.
 *
 * GAIA IS NOT AN ENEMY AND IS NOT A WIN CONDITION. It owns rocks, trees, wrecks
 * and crates, which cannot be killed off, so counting it would hang every
 * match. The `areAllied` test alone would already exclude it — `gaia` allies
 * itself to everybody — and the faction test is kept anyway, because that
 * alliance is written by the SCENARIO and a fixture that never runs one would
 * otherwise put the scenery on the victory checklist.
 */
export function isHostileSeat(world: World, local: PlayerId, p: PlayerState): boolean {
  return p.faction !== Faction.Neutral && !world.areAllied(local, p.id);
}
