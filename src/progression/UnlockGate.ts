/**
 * ============================================================================
 * VOLTMARCH — src/progression/UnlockGate.ts
 * ============================================================================
 * "What can this player build right now?"
 *
 * The gate answers exactly one question and holds no state of its own: it reads
 * a set of unlock ids and compares it against a def's `unlockedBy`. A def with
 * no `unlockedBy` is available from the very first match — that default is the
 * design's central rule, not an implementation detail. See
 * `docs/MISSIONS_DESIGN.md`: the starting army must be complete enough for a
 * genuinely good first game, and anything that would grind the player before
 * the game is fun is the failure mode this whole file is shaped around.
 *
 * IT RESOLVES PER PLAYER, NOT GLOBALLY
 * ------------------------------------
 * `allowsFor(player, def)` rather than `allows(def)`, because the AI mirrors
 * the human's tier. That is a design decision with a reason: an AI fielding a
 * unit the player has never seen — and cannot build — reads as the game
 * cheating, and it also spoils the reveal that the unlock is supposed to be.
 * So both sides resolve against the SAME profile, and difficulty stays where it
 * already lives: economy handicap, reaction time and composition quality in
 * `AIStrategy`.
 *
 * `unrestricted` lifts the whole thing, for the skirmish-setup toggle offered
 * to players who would rather have the harder game than the reveal.
 *
 * WHY IT TAKES A FUNCTION AND NOT A SET
 * -------------------------------------
 * The production catalogue is built once, at boot, and the profile changes
 * mid-session (a mission completes; a save is imported). A gate holding a
 * snapshot would hand out a stale answer for the rest of the match. It holds a
 * reader instead, and the read is an `Array.includes` over a list that is
 * bounded at a few dozen entries — cheaper than the Map lookup that produced
 * the def in the first place.
 * ============================================================================
 */

import type { Gateable, GatePlayer } from './types';

/** Anything that can answer "does the player own this unlock id?". */
export type UnlockReader = () => readonly string[];

export interface UnlockGateOptions {
  /**
   * The AI resolves against the human's unlocks. Default true; see the header.
   * Turning it off makes the AI unrestricted, NOT restricted differently.
   */
  mirrorAI?: boolean;
  /** Lift every restriction. The skirmish-setup escape hatch. */
  unrestricted?: boolean;
  /**
   * Known unlock ids, for the boot-time diagnostic. A def tagged
   * `unlockedBy: 'unit.prims'` that no mission grants is permanently
   * unbuildable and looks exactly like a balance decision, which is the most
   * expensive kind of content bug to find.
   */
  knownUnlockIds?: Iterable<string>;
}

/** Tooltip text for a def the gate rejected. Never empty. */
export const LOCKED_REASON = 'Locked — complete a mission';

export class UnlockGate {
  private mirrorAI: boolean;
  private unrestricted: boolean;
  private readonly known: Set<string> | null;
  /** Ids seen on a def that no mission grants. Reported once each. */
  private readonly warned = new Set<string>();

  constructor(
    private readonly read: UnlockReader,
    options: UnlockGateOptions = {},
  ) {
    this.mirrorAI = options.mirrorAI ?? true;
    this.unrestricted = options.unrestricted ?? false;
    this.known = options.knownUnlockIds === undefined ? null : new Set(options.knownUnlockIds);
  }

  /* -- policy ------------------------------------------------------------- */

  setMirrorAI(on: boolean): void { this.mirrorAI = on; }
  setUnrestricted(on: boolean): void { this.unrestricted = on; }
  get isUnrestricted(): boolean { return this.unrestricted; }
  get isMirroringAI(): boolean { return this.mirrorAI; }

  /* -- the question ------------------------------------------------------- */

  /** Does the profile own this unlock id? */
  isUnlocked(unlockId: string): boolean {
    if (this.unrestricted) return true;
    const owned = this.read();
    for (let i = 0; i < owned.length; i++) if (owned[i] === unlockId) return true;
    return false;
  }

  /**
   * Is this def available to the local player?
   *
   * An untagged def is always available. That is the whole gate: the content
   * that ships open outnumbers the content that does not, and inverting the
   * default would mean one forgotten tag locks a unit forever.
   */
  allows(def: Gateable | null | undefined): boolean {
    if (def === null || def === undefined) return true;
    const id = def.unlockedBy;
    if (id === undefined || id === '') return true;
    this.checkKnown(id, def.key);
    return this.isUnlocked(id);
  }

  /**
   * Is this def available to `player`?
   *
   * Humans resolve against their own profile. The AI resolves against the same
   * profile while `mirrorAI` holds, and against nothing at all when it does not
   * — an unmirrored AI is UNRESTRICTED, because the only reason to turn the
   * mirror off is to let the AI field the things the player has not earned yet.
   */
  allowsFor(player: GatePlayer | null | undefined, def: Gateable | null | undefined): boolean {
    if (def === null || def === undefined) return true;
    if (player === null || player === undefined) return this.allows(def);
    if (!player.isHuman && !this.mirrorAI) return true;
    return this.allows(def);
  }

  /** Tooltip for a rejected def. Empty string when the def is available. */
  reasonFor(def: Gateable | null | undefined): string {
    return this.allows(def) ? '' : LOCKED_REASON;
  }

  /* -- the filter the production catalogue calls -------------------------- */

  /**
   * Everything in `defs` the local player may build.
   *
   * `out` is caller-supplied so a sidebar rebuild allocates nothing; the array
   * is cleared and refilled. Omit it and you get a fresh array, which is what
   * the once-per-match callers want.
   */
  filter<T extends Gateable>(defs: readonly T[], out?: T[]): T[] {
    const dst = out ?? [];
    dst.length = 0;
    for (let i = 0; i < defs.length; i++) if (this.allows(defs[i])) dst.push(defs[i]);
    return dst;
  }

  /** The same filter, resolved for one player. See `allowsFor`. */
  filterFor<T extends Gateable>(
    player: GatePlayer | null | undefined,
    defs: readonly T[],
    out?: T[],
  ): T[] {
    const dst = out ?? [];
    dst.length = 0;
    for (let i = 0; i < defs.length; i++) if (this.allowsFor(player, defs[i])) dst.push(defs[i]);
    return dst;
  }

  /** Unlock ids referenced by these defs that no mission grants. */
  auditTags(defs: readonly Gateable[]): string[] {
    if (this.known === null) return [];
    const bad: string[] = [];
    for (const d of defs) {
      const id = d.unlockedBy;
      if (id === undefined || id === '' || this.known.has(id)) continue;
      if (!bad.includes(id)) bad.push(id);
    }
    return bad;
  }

  private checkKnown(id: string, key: string | undefined): void {
    if (this.known === null || this.known.has(id) || this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(
      `[progression] "${key ?? '?'}" is gated behind unknown unlock "${id}" — `
      + 'no mission grants it, so it can never be built.',
    );
  }
}

/* ==========================================================================
 * THE MODULE-LEVEL HANDLE
 *
 * `ProductionCatalog` is constructed deep inside `src/sim/**` and must not
 * import a store, a profile or localStorage. It imports these two functions
 * instead: one call site, no state, and a null gate means "everything is
 * available", so the sim keeps working with the progression system absent —
 * which is exactly what happens under the `?shot=` harness.
 * ========================================================================== */

let active: UnlockGate | null = null;

/** Published by `progression.system.ts` at init; cleared on dispose. */
export function setUnlockGate(gate: UnlockGate | null): void {
  active = gate;
}

/** The live gate, or null when progression is not running. */
export function unlockGate(): UnlockGate | null {
  return active;
}

/**
 * THE ONE-LINE CALL SITE.
 *
 * `if (!isBuildable(entry, player)) continue;`
 *
 * True when no gate is installed, when the def carries no `unlockedBy`, or when
 * the player owns the unlock. Never throws, never allocates.
 */
export function isBuildable(
  def: Gateable | null | undefined,
  player?: GatePlayer | null,
): boolean {
  if (active === null) return true;
  return player === undefined ? active.allows(def) : active.allowsFor(player, def);
}

/** Array form of `isBuildable`, for a roster rebuild. */
export function filterBuildable<T extends Gateable>(
  defs: readonly T[],
  player?: GatePlayer | null,
  out?: T[],
): T[] {
  if (active === null) {
    const dst = out ?? [];
    dst.length = 0;
    for (let i = 0; i < defs.length; i++) dst.push(defs[i]);
    return dst;
  }
  return player === undefined ? active.filter(defs, out) : active.filterFor(player, defs, out);
}
