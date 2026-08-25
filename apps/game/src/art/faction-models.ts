/**
 * ============================================================================
 * VOLTMARCH — src/art/faction-models.ts
 * ============================================================================
 * ONE ARMY ORDER, FOR EVERY TABLE THAT ANSWERS "WHICH MODEL DOES THIS ARMY
 * DRAW FOR A DEF THE ARMIES SHARE".
 *
 * THE DEFECT THIS FILE EXISTS TO MAKE UNREPEATABLE
 * -----------------------------------------------
 * Reported as *"the engineers among factions have all the same skin"*, and it
 * was exactly true for the two armies that share the `engineer` def: there was
 * no Soviet engineer model at all, and `src/art/units.system.ts` bound the
 * Allied one at `FACTION_ANY`, so every Soviet barracks turned out a plated
 * Allied technician.
 *
 * The interesting part is not that one key was in the wrong table. It is that
 * BOTH tables that could have caught it were built for two armies and left that
 * way through the addition of two more:
 *
 *     units.system.ts   SHARED_CONTENT_TO_MODEL : readonly [string, string]
 *     ui/Cameos.ts      ModelBinding            : string | readonly [string, string]
 *
 * A pair has no slot for a third army and no way to notice one is missing, so
 * `bindingFor` read `faction === Soviets ? [1] : [0]` — i.e. **every army that
 * is not the Soviets gets the Allied model**, silently, forever. That is the
 * shape of the bug, and it is one a fifth army would inherit unchanged.
 *
 * WHAT REPLACES IT
 * ----------------
 * `ARMY_ORDER` is the single declaration of which armies exist and in what slot
 * order, and `PerArmy<T>` is a tuple DERIVED from it — not a hand-written
 * `[T, T, T, T]`. Two things follow, and both are `npm run typecheck` failures
 * rather than wrong pictures in somebody's match:
 *
 *   1. Add an army to `ARMY_ORDER` and every four-element literal in every
 *      consumer stops compiling until somebody says what the new army draws.
 *   2. Add a member to `Faction` and FORGET `ARMY_ORDER`, and `_everyArmyIsOrdered`
 *      below fails, naming the army that was left out.
 *
 * WHY A TUPLE AND NOT A `Record<Faction, string>`
 * ----------------------------------------------
 * Because slots 0 and 1 of these tables are read positionally by a consumer
 * outside this module — `tests/anti-armour-infantry.spec.ts` walks
 * `CAMEO_UNIT_MODELS` for models that no def binds, and reads `v[0]`/`v[1]` to
 * do it. A keyed record would put the Allied model at key 1 and orphan the
 * Soviet one, which is a test failure that says nothing about the thing it
 * tests. The order is therefore load-bearing and is stated once, here, rather
 * than assumed at each site.
 *
 * `Faction.Neutral` IS NOT IN THE ORDER. It is Gaia — the crate owner, the
 * scenery owner — not an army, so it has no row and `armyIndex` returns -1 for
 * it. Every consumer answers Gaia with the Allied model, which is what shipped
 * and what `units.system.ts`'s `(kind, Neutral, -1)` defaults already do; the
 * point of routing it through `GAIA_SLOT` is that the choice is now named
 * instead of being "slot 0 of a tuple".
 * ============================================================================
 */

import { Faction } from '../core/types';

/**
 * Every army a player or an AI can be, in the slot order the per-army tables
 * use. `src/sim/Production.ts#PLAYABLE_FACTIONS` is the sim-side twin.
 *
 * `as const` is load-bearing twice over: it is what makes `PerArmy` a
 * fixed-length tuple, and it is what gives `_everyArmyIsOrdered` a union of
 * literal members to subtract from `Faction`.
 */
export const ARMY_ORDER = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
] as const;

/** An army. Everything in `Faction` except Gaia. */
export type PlayableFaction = Exclude<Faction, Faction.Neutral>;

/**
 * Rebuild a tuple's shape with a new element type.
 *
 * The generic parameter is not decoration: `{ [K in keyof Tup]: T }` is only
 * treated as a tuple mapping when `Tup` is a type PARAMETER. Written directly
 * against `typeof ARMY_ORDER` it maps `length`, `map`, `concat` and the rest of
 * the array surface as well, and the result is not assignable from any array
 * literal at all.
 */
type SameShape<Tup extends readonly unknown[], T> = { readonly [K in keyof Tup]: T };

/**
 * One `T` per army, in `ARMY_ORDER`. A tuple of exactly `ARMY_ORDER.length`
 * elements, so a literal that is short by one is a compile error naming the
 * arity rather than a runtime `undefined`.
 */
export type PerArmy<T> = SameShape<typeof ARMY_ORDER, T>;

/**
 * THE EXHAUSTIVENESS ASSERTION, and the half of this file that catches the
 * mistake nobody would make deliberately.
 *
 * `PerArmy` grows when `ARMY_ORDER` grows. Nothing so far makes `ARMY_ORDER`
 * grow when `Faction` does — and a new army landing in the enum while this list
 * stays at four is precisely how the two-army tables survived two new armies.
 * So: subtract Gaia and everything already ordered from `Faction`, and require
 * the remainder to be empty. It is not empty, the declared type IS the missing
 * member, and the error reads
 *
 *     Type 'true' is not assignable to type 'Faction.<TheNewArmy>'.
 *
 * The `[..] extends [never]` wrapper stops the conditional distributing over
 * the union, which would make a two-army omission resolve to `true` and pass.
 */
type ArmiesNotOrdered = Exclude<Faction, Faction.Neutral | (typeof ARMY_ORDER)[number]>;
const _everyArmyIsOrdered: [ArmiesNotOrdered] extends [never] ? true : ArmiesNotOrdered = true;
void _everyArmyIsOrdered;

/**
 * Slot in `ARMY_ORDER`, or -1 for Gaia and for anything outside the enum.
 *
 * `findIndex` rather than `indexOf` because `ARMY_ORDER` is a tuple of literal
 * members and `indexOf` would only accept one of those four literals — which is
 * the argument this function exists to NOT require its callers to have.
 */
export function armyIndex(faction: Faction): number {
  return ARMY_ORDER.findIndex((f) => (f as Faction) === faction);
}

/**
 * The slot a Gaia-owned entity reads.
 *
 * Scenery, crate contents and unclaimed scenario hardware are owned by
 * `Faction.Neutral`, which is not an army and has no row. The Allied model is
 * the answer, because it is what shipped and what `units.system.ts` registers
 * for `(kind, Faction.Neutral, -1)`; keeping the two consistent matters more
 * than the choice itself, and a named constant is the only way to say that the
 * choice was made rather than fallen into.
 */
export const GAIA_SLOT = 0;

/**
 * The entry an army reads out of a `PerArmy` table, Gaia included.
 *
 * Deliberately total — every caller here has a picture to draw and no useful
 * behaviour for "no answer" beyond the caller's own fallback, which the element
 * type expresses (`string | null`) when a table genuinely has holes.
 */
export function forArmy<T>(models: PerArmy<T>, faction: Faction): T {
  const i = armyIndex(faction);
  return (models as readonly T[])[i < 0 ? GAIA_SLOT : i];
}

/**
 * THE ARCHITECTURE PAIR — a two-army model pair widened to four, for STRUCTURES.
 *
 * The Pact and the Reclamation never BUILD any of the shared structures; they
 * run the Conclave/Foundry line all the way down. But they can CAPTURE one, and
 * a captured Allied Refinery is still an Allied Refinery — capturing a building
 * does not rebuild it. So both of their slots take the Allied model, which is
 * also exactly what the old two-army pair resolved to, making this a widening
 * rather than a change of behaviour.
 *
 * THIS IS FOR STRUCTURES ONLY. For a UNIT the pair means the army that operates
 * it, and a Pact hull must not wear Allied paint — `src/art/Faction3Units.ts`
 * is the authority there.
 *
 * THE HONEST LIMIT, and it is the same one in every consumer: resolution is
 * keyed on the entity's CURRENT faction, never on who built it, so a Pact player
 * who takes a SOVIET refinery gets its Allied twin. Closing that needs the
 * builder recorded on the entity — a real saved, hashed column, with all the
 * cost `store.carrierId` documents — not a fifth slot here. `gate` is the row
 * where it shows most, since neither newer army has one at all.
 *
 * Written as a helper rather than as repeated model keys so that a fifth army
 * answers the question ONCE, here, instead of twelve times in silence — in BOTH
 * consumers. It lived privately in `src/ui/Cameos.ts` first, and while it did,
 * `buildings.system.ts` went on registering the two-army pair, so the portrait
 * and the model on the ground disagreed about what a captured Construction Yard
 * looks like. That is why it is here and not there.
 */
export function builtBy(allied: string, soviet: string): PerArmy<string> {
  return [allied, soviet, allied, allied];
}
