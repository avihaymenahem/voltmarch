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
  /**
   * `unlockId -> the requirement in one line`, e.g.
   * `'struct.tech' -> 'Strip Mine: mine 70,000 credits of ore'`.
   *
   * INJECTED, NEVER IMPORTED, and that is the point. This file imports nothing
   * but its own type-only module so that `src/sim/**` can call `isBuildable`
   * without dragging the mission table — or the profile store, or
   * `localStorage` — into the simulation bundle. The reverse map is built where
   * the missions already live (`src/data/Missions.ts#UNLOCK_REQUIREMENTS`) and
   * handed in by `progression.system.ts`. Absent, every locked def falls back
   * to `LOCKED_REASON` and nothing breaks.
   */
  unlockHints?: Iterable<readonly [string, string]>;
}

/**
 * Tooltip text for a def the gate rejected when nothing better is known.
 *
 * THE FALLBACK, NOT THE ANSWER. This was the only thing a locked cameo ever
 * said: a player hovered a padlocked Battle Lab, was told to "complete a
 * mission", and had no way to find out which one — while the def carried
 * `unlockedBy: 'struct.tech'` and exactly one mission paid that id out. See
 * `lockedReasonFor`, and `UnlockGateOptions.unlockHints` for why the lookup
 * arrives as data rather than as an import.
 */
export const LOCKED_REASON = 'Locked — complete a mission';

export class UnlockGate {
  private mirrorAI: boolean;
  private unrestricted: boolean;
  private readonly known: Set<string> | null;
  private readonly hints: Map<string, string>;
  /** Ids seen on a def that no mission grants. Reported once each. */
  private readonly warned = new Set<string>();

  constructor(
    private readonly read: UnlockReader,
    options: UnlockGateOptions = {},
  ) {
    this.mirrorAI = options.mirrorAI ?? true;
    this.unrestricted = options.unrestricted ?? false;
    this.known = options.knownUnlockIds === undefined ? null : new Set(options.knownUnlockIds);
    this.hints = new Map(options.unlockHints ?? []);
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

  /**
   * `Locked — Strip Mine: mine 70,000 credits of ore`, for one unlock id.
   *
   * Falls back to `LOCKED_REASON` when no hint table was injected or when the
   * id is one nothing grants — a def gated behind an unpayable id is a content
   * bug (`checkKnown` warns about it separately) and inventing a mission name
   * for it would hide the bug behind a plausible sentence.
   */
  lockedReasonFor(unlockId: string): string {
    const hint = this.hints.get(unlockId);
    return hint === undefined || hint === '' ? LOCKED_REASON : `Locked — ${hint}`;
  }

  /** Tooltip for a rejected def. Empty string when the def is available. */
  reasonFor(def: Gateable | null | undefined): string {
    if (this.allows(def)) return '';
    const id = def?.unlockedBy;
    return id === undefined || id === '' ? LOCKED_REASON : this.lockedReasonFor(id);
  }

  /** True when a hint table was injected, i.e. `reasonFor` can name a mission. */
  get hasUnlockHints(): boolean { return this.hints.size > 0; }

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
/**
 * When set, every gate question answers "yes" regardless of what is installed.
 *
 * FOR MULTIPLAYER, AND IT HAD TO BE A FLAG RATHER THAN `setUnlockGate(null)`.
 * The gate is consulted while the world is being BUILT — `Scenarios.ts` calls
 * `isBuildable` when spawning the starting army — and it answers from the LOCAL
 * profile, so two players with different unlocks build different armies and
 * diverge before either of them moves.
 *
 * Clearing it before the boot does not work: `progression.system`'s `init()`
 * runs during that same boot and installs a gate built from this browser's
 * profile, silently undoing the clear. A suppression flag is honoured no matter
 * what is installed or when, which is the only version of this that survives
 * the boot order.
 */
let suppressed = false;

/** Turn gating off entirely (PvP), or back on. */
export function suppressUnlockGate(on: boolean): void {
  suppressed = on;
}

export function unlockGateSuppressed(): boolean {
  return suppressed;
}

/* -- the campaign's roster ------------------------------------------------
 *
 * A CAMPAIGN OPERATION AUTHORS WHAT EACH SIDE MAY BUILD, AND THE TWO LISTS ARE
 * DIFFERENT ON PURPOSE. "The enemy has Tesla Coils and you do not, go around
 * them" is a mission; expressing it as a difficulty number instead is what
 * makes scripted content read as a skirmish with a story pasted on.
 *
 * WHY NOT `suppressUnlockGate(true)`. Because it authors nothing: `isBuildable`
 * short-circuits on it, so operation one would open both superweapons to a
 * Brutal AI. It is the PvP hammer and the campaign is not PvP.
 *
 * WHY A SECOND MODULE-LEVEL FLAG RATHER THAN `setUnlockGate(campaignGate)`.
 * The boot-order reason this file already documents for `suppressed`, verbatim:
 * `progression.system.ts`'s `init()` runs during the same boot and installs a
 * gate built from this browser's profile, silently undoing anything installed
 * earlier. A flag is honoured whatever is installed and whenever.
 *
 * IT IS CONSULTED AHEAD OF `suppressed`, WHICH IS THE ONE ORDERING DECISION
 * HERE. The operation's authored intent outranks a hammer left set by an
 * earlier PvP match — and `suppressUnlockGate` has leaked exactly once already,
 * so "that cannot happen" is not an argument this file gets to make.
 *
 * ONLY TAGGED CONTENT CAN BE RESTRICTED. `UNLOCK_TAGS` is 33 defs across 10
 * tags; a def with no `unlockedBy` is day-one open and stays open. That is a
 * real limit rather than an oversight — withholding an ungated Barracks would
 * mean a `census`/`Production` re-derivation at launch for a premise nothing in
 * the operation table needs — and `validateCampaign` refuses a roster that
 * names an untagged def rather than letting it silently grant everything.
 *
 * THE ROSTER IS AN ALLOW-LIST, SO IT INVERTS THIS FILE'S OWN CENTRAL DEFAULT,
 * AND THAT IS A REAL HAZARD RATHER THAN A CLEVER READING. The header above
 * says a missing tag must mean OPEN, because "inverting the default would mean
 * one forgotten tag locks a unit forever". Here, tagged-and-unlisted means
 * REFUSED — which is the only way an operation can express "you do not have
 * Tesla Coils yet" without a deny-list. The cost is that **adding an
 * `UNLOCK_TAGS` entry to a def that did not have one retroactively withdraws it
 * from BOTH SIDES OF EVERY SHIPPED OPERATION, silently**: no roster names it,
 * so no roster allows it, and the gate's own `checkKnown` warning never fires
 * because this branch returns before the gate is consulted.
 *
 * That is not fixable by changing the default without deleting the feature, so
 * it is caught instead: `tests/campaign-data.spec.ts` pins the `UNLOCK_TAGS` id
 * set BY VALUE, in the `OVER_BAND` shape this repo already uses. A new tag
 * therefore fails one test whose message says what just happened and which
 * operations need reviewing — once, loudly, at the moment the tag lands.
 *
 * THREE THINGS THE ROSTER DELIBERATELY DISCARDS, each of which is the gate's
 * behaviour and not the operation's:
 *
 *   - **`unrestricted`.** `?unlockall` and the `?shot=` harness both build the
 *     gate with it set, and both are inert while an operation is armed. An
 *     operation's roster IS its authored content — a debugging flag that
 *     silently widened it would make the thing on screen not the thing that
 *     shipped.
 *   - **`mirrorAI`.** The lobby's "AI mirrors your unlocks" toggle has no
 *     effect here, because the operation states the AI's list outright. That is
 *     the point of there being two lists.
 *   - **Liveness.** The gate reads the profile through a closure on every
 *     question; this is a SNAPSHOT taken at `setCampaignRoster`. Correct,
 *     because mid-operation roster changes were cut on purpose — but two
 *     opposite freshness semantics sit ten lines apart in this file, so it is
 *     said out loud and pinned by `tests/campaign-roster.spec.ts`.
 */
interface CampaignRoster {
  readonly player: ReadonlySet<string>;
  readonly ai: ReadonlySet<string>;
}

let campaignRoster: CampaignRoster | null = null;

/** Arm an operation's roster, or clear it. Cleared on EVERY exit from one. */
export function setCampaignRoster(
  roster: { readonly player: readonly string[]; readonly ai: readonly string[] } | null,
): void {
  campaignRoster = roster === null
    ? null
    : { player: new Set(roster.player), ai: new Set(roster.ai) };
}

/** True while an operation's roster is in force. */
export function campaignRosterActive(): boolean {
  return campaignRoster !== null;
}

/**
 * `player === undefined` means the caller had no seat in hand — a cameo grid
 * rebuild, a HUD query. It resolves against the HUMAN list, because that is
 * whose sidebar is being drawn.
 */
function rosterAllows(def: Gateable | null | undefined, isHuman: boolean): boolean {
  const r = campaignRoster;
  if (r === null || def === null || def === undefined) return true;
  const id = def.unlockedBy;
  if (id === undefined || id === '') return true;
  return (isHuman ? r.player : r.ai).has(id);
}

export function isBuildable(
  def: Gateable | null | undefined,
  player?: GatePlayer | null,
): boolean {
  if (campaignRoster !== null) return rosterAllows(def, player?.isHuman ?? true);
  if (suppressed || active === null) return true;
  return player === undefined ? active.allows(def) : active.allowsFor(player, def);
}

/** Array form of `isBuildable`, for a roster rebuild. */
export function filterBuildable<T extends Gateable>(
  defs: readonly T[],
  player?: GatePlayer | null,
  out?: T[],
): T[] {
  if (campaignRoster !== null) {
    const human = player?.isHuman ?? true;
    const dst = out ?? [];
    dst.length = 0;
    for (let i = 0; i < defs.length; i++) if (rosterAllows(defs[i], human)) dst.push(defs[i]);
    return dst;
  }
  if (suppressed || active === null) {
    const dst = out ?? [];
    dst.length = 0;
    for (let i = 0; i < defs.length; i++) dst.push(defs[i]);
    return dst;
  }
  return player === undefined ? active.filter(defs, out) : active.filterFor(player, defs, out);
}
