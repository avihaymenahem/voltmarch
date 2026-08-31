/**
 * Domain-owned config slice: commander ability identity and effects.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * COMMANDERS
 *
 * One hero per army. Capped at one alive, rebuildable the moment it dies, and
 * carrying an active ability on a cooldown.
 *
 * WHY THE IDS AND THE TUNING LIVE IN CONFIG AND NOT IN `src/sim/Abilities.ts`
 * --------------------------------------------------------------------------
 * `src/data/Defs.ts` has to name an ability on a unit row, and `src/sim` may
 * not be imported from `src/data` for anything that is not already a leaf —
 * the header of Defs.ts states the no-cycle rule and `sim/Combat` is the one
 * exception it earned by being one. `Abilities.ts` will import Production,
 * which imports half the sim, so routing the enum through here is what keeps
 * the data layer a leaf. It is also simply where tunables live.
 *
 * ALL FOUR ABILITIES ARE SELF-CENTRED — no target picking, no second click.
 * That is a design decision, not a shortcut: it means one button fires any of
 * them, the AI can use the identical code path the player does, and nothing
 * needs a reticle, a staged-target state machine or an `ArmedMode`. The
 * asymmetry between the armies is in WHAT lands, not in how you aim it.
 * ========================================================================== */

/** Which ability a commander carries. `UnitDef.ability` holds one of these. */
export const enum AbilityId {
  None = 0,
  /** Allies — every friendly in radius blinks to a ring around the commander. */
  ChronoRally = 1,
  /** Soviets — friendlies in radius become untouchable for a few seconds. */
  IronWill = 2,
  /** Meridian — one focused solar burst on everything hostile in radius. */
  PrismFocus = 3,
  /** Reclamation — wrecks in radius are cashed in and friendlies patched up. */
  SalvageCall = 4,
}

export interface AbilityDef {
  readonly id: AbilityId;
  /** Stable id. The HUD button and the action catalogue key on this. */
  readonly key: string;
  readonly label: string;
  /** One line, shown on the button. Says what it does, not what it is called. */
  readonly hint: string;
  /** Effect radius in metres, measured from the commander. */
  readonly radius: number;
  /** Seconds before it can be used again. Also the full ring on the button. */
  readonly cooldownSeconds: number;
}

/**
 * Indexed by `AbilityId`, so slot 0 is the None row and exists only to keep
 * the array a direct lookup. Radii are deliberately smaller than a
 * superweapon's (26 m for the nuke): a commander ability is a squad-scale
 * verb, and one that reached across a base would make the hero the whole game.
 */
export const ABILITIES: readonly AbilityDef[] = [
  { id: AbilityId.None, key: 'none', label: '', hint: '', radius: 0, cooldownSeconds: 0 },
  {
    id: AbilityId.ChronoRally,
    key: 'chronoRally',
    label: 'Chrono Rally',
    hint: 'Teleports your nearby units to the commander.',
    radius: 34,
    cooldownSeconds: 50,
  },
  {
    id: AbilityId.IronWill,
    key: 'ironWill',
    label: 'Iron Will',
    hint: 'Nearby units cannot be harmed for a few seconds.',
    radius: 16,
    cooldownSeconds: 60,
  },
  {
    id: AbilityId.PrismFocus,
    key: 'prismFocus',
    label: 'Prism Focus',
    hint: 'Burns every enemy standing near the commander.',
    radius: 18,
    cooldownSeconds: 45,
  },
  {
    id: AbilityId.SalvageCall,
    key: 'salvageCall',
    label: 'Salvage Call',
    hint: 'Strips nearby wrecks for credits and patches your units.',
    radius: 22,
    cooldownSeconds: 40,
  },
];

/** Effect magnitudes. Separate from `ABILITIES` so balance is one small block. */
export const ABILITY_FX = {
  /**
   * Units one Chrono Rally can lift. The Displacement Ring lifts 9; a commander
   * lifts 6, and pulls them IN rather than pushing them anywhere, so it is a
   * regroup rather than a drop.
   */
  chronoMaxUnits: 6,
  /** Metres between arrival slots, matching the Displacement Ring's spiral. */
  chronoSpacing: 3.4,

  /** Seconds of invulnerability. A quarter of the Ironclad Field's 20. */
  ironWillSeconds: 5,
  /** Seconds between the shimmer sparks on a protected unit. */
  ironWillSparkSeconds: 0.6,

  /** Damage per enemy caught in the burst. */
  prismDamage: 210,
  /** Splash falloff across the radius, matching the nuke's profile. */
  prismFalloff: 0.30,

  /** Credits per wreck consumed. */
  salvagePerWreck: 120,
  /** Fraction of maxHp restored to each friendly in radius. */
  salvageHealFraction: 0.30,
  /** Wrecks one call can consume. */
  salvageMaxWrecks: 8,
} as const;
