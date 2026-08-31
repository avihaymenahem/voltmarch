/**
 * ============================================================================
 * VOLTMARCH — src/sim/combat.system.ts
 * ============================================================================
 * THE COMBAT MODULE'S WIRING LAYER.
 *
 * Combat spans five sim phases, and a `SystemModule` carries exactly one. So
 * this file default-exports the Targeting-phase module and, from its `init`,
 * registers four siblings on the registry it was handed:
 *
 *   combat.targeting    Phase.Targeting   (900)   acquisition + persistence
 *   combat.weapons      Phase.Weapons    (1000)   traverse, burst, fire
 *   combat.projectiles  Phase.Projectiles(1100)   integrate + swept hits
 *   combat.damage       Phase.Damage     (1200)   matrix, splash, veterancy
 *   combat.cleanup      Phase.Cleanup    (1400)   deaths, wrecks, flush
 *
 * `registry.add()` is documented as safe at any time and the registry rebuilds
 * its flat run lists lazily, so this costs one sort on the next tick and
 * nothing thereafter. Bootstrap.ts and Systems.ts are untouched.
 *
 * THIS IS ALSO THE ONLY FILE IN THE MODULE THAT KNOWS ABOUT CONTENT.
 * `Targeting/Projectiles/Damage/Combat.ts` are pure sim and import nothing from
 * `src/game` or `src/data`. Here — and only here — we reach for
 * `entityKeyOf()` so that a scenario spawned entirely from fallback stats,
 * with `weaponIndex === -1` on every unit, still fights with the right gun.
 * The moment a real `DefTables` lands, `setWeaponTable()` plus the real
 * `weaponIndex` take over and this table stops being consulted.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { EntityId, SimContext, SystemModule } from '../core/types';
import { ctx } from '../game/context';
import { entityKeyOf, resolveDefBinding } from '../game/Scenarios';

import { DamageSystem, setArmorMatrix } from './Damage';
import { ProjectileSystem } from './Projectiles';
import { WeaponSystem, setContentWeaponMap, setWeaponKeyResolver, setWeaponTable } from './Combat';
import { TargetingSystem } from './Targeting';
import { BomberSortieSystem } from './BomberSortie';

/* ==========================================================================
 * CONTENT KEY -> WEAPON KEY
 *
 * Left column: the content vocabulary published by src/game/Scenarios.ts and
 * (once it exists) src/data. Right column: keys in DEFAULT_WEAPONS.
 * A key that is absent means "unarmed", which is the correct answer for a
 * harvester, an MCV, an engineer or a transport.
 * ========================================================================== */
const CONTENT_WEAPON: Readonly<Record<string, string>> = {
  /* -- Allied infantry / vehicles --------------------------------------- */
  gi: 'rifle',
  rifleman: 'rifle',
  // Row 16 of the sim armoury, "Shoulder Rocket", authored long before anything
  // carried it. `flakTrooper` below has had its line here just as long.
  javelin: 'rocketLauncher',
  guardian: 'lightCannon',
  grizzly: 'lightCannon',
  ifv: 'chaingun',
  prismTank: 'prismBeam',
  prism: 'prismBeam',
  alliedAlbatross: 'albatrossBomb',
  mrdEcliptic: 'eclipticCharge',

  /* -- Soviet infantry / vehicles --------------------------------------- */
  conscript: 'conscriptRifle',
  flakTrooper: 'aaCannon',
  attackDog: 'bite',
  rhino: 'heavyCannon',
  apocalypse: 'twinCannon',
  sickle: 'chaingun',
  v4: 'artillery',
  sovietMolot: 'molotBomb',
  rclScrapvulture: 'scrapvultureCask',

  /* -- Naval ------------------------------------------------------------- */
  gunboat: 'navalGun',
  destroyer: 'navalGun',
  submarine: 'torpedo',
  dreadnought: 'shipMissile',

  /* -- Defences ---------------------------------------------------------- */
  pillbox: 'pillboxMg',
  prismTower: 'prismTowerBeam',
  teslaCoil: 'teslaBolt',
  flameTower: 'flameJet',
};

/* ==========================================================================
 * MODULE STATE
 *
 * Held at module scope rather than on the exported object so the four sibling
 * systems can close over the same instances without any of them needing a
 * reference to the parent.
 * ========================================================================== */

let targeting: TargetingSystem | null = null;
let weapons: WeaponSystem | null = null;
let projectiles: ProjectileSystem | null = null;
let damage: DamageSystem | null = null;
let bombers: BomberSortieSystem | null = null;
/** Ids this module put on the registry, so dispose can take them off again. */
const CHILD_IDS = ['combat.weapons', 'combat.projectiles', 'combat.damage', 'combat.cleanup'];
let childrenRegistered = false;

/** Console/harness handle: `__vmCombat.stats()`. */
interface CombatProbe {
  targeting: TargetingSystem | null;
  weapons: WeaponSystem | null;
  projectiles: ProjectileSystem | null;
  damage: DamageSystem | null;
  stats(): Record<string, number>;
}

/* ==========================================================================
 * THE FOUR SIBLINGS
 * ========================================================================== */

const weaponsModule: SystemModule = defineSystem({
  id: 'combat.weapons',
  phase: Phase.Weapons,
  order: 0,
  simTick(s: SimContext): void {
    weapons?.tick(s);
    bombers?.postWeaponsTick();
  },
});

const projectilesModule: SystemModule = defineSystem({
  id: 'combat.projectiles',
  phase: Phase.Projectiles,
  order: 0,
  simTick(s: SimContext): void {
    if (projectiles === null) return;
    projectiles.tick(s);
    // The overlay reads this; it is the fastest way to spot a leaking pool.
    ctx().debug.counters.projectiles = projectiles.liveCount;
  },
});

const damageModule: SystemModule = defineSystem({
  id: 'combat.damage',
  phase: Phase.Damage,
  order: 0,
  simTick(s: SimContext): void { damage?.damageTick(s); },
});

const cleanupModule: SystemModule = defineSystem({
  id: 'combat.cleanup',
  phase: Phase.Cleanup,
  // Ahead of everything else in Cleanup: `flushDestroyed()` happens here, and a
  // system that wants to observe a corpse must run before the slot is recycled.
  order: 0,
  simTick(s: SimContext): void { damage?.cleanupTick(s); },
});

/* ==========================================================================
 * THE MODULE
 * ========================================================================== */

export default defineSystem({
  id: 'combat.targeting',
  phase: Phase.Targeting,
  order: 0,

  async init(): Promise<void> {
    const { world, channels, registry } = ctx();

    projectiles = new ProjectileSystem(world, channels);
    damage = new DamageSystem(world, channels);
    weapons = new WeaponSystem(world, channels, projectiles);
    targeting = new TargetingSystem(world, channels, weapons);
    bombers = new BomberSortieSystem(world);
    (globalThis as unknown as { __vmBombers?: BomberSortieSystem }).__vmBombers = bombers;

    // Content binding. Both calls are no-ops the instant a real def table
    // assigns a valid `weaponIndex` at spawn — resolution checks that first.
    setContentWeaponMap(CONTENT_WEAPON);
    setWeaponKeyResolver((id: EntityId) => entityKeyOf(id));

    /*
     * THE ARMOURY HANDOFF, and it is not optional the moment content exists.
     *
     * `UnitDef.weapons` holds INDICES, and `ScenarioBuilder.spawnUnit` copies
     * `def.weapons[0]` straight into `store.weaponIndex`. Those indices are
     * only meaningful against the array `Combat.ts` is resolving with. Publish
     * a def table whose `weapons` differs from `DEFAULT_WEAPONS` by one row and
     * every unit in the game silently fires its neighbour's gun — a bug with no
     * error message and no obvious symptom beyond "balance feels wrong".
     *
     * `src/data/Defs.ts` deliberately re-exports `DEFAULT_WEAPONS` so this is a
     * no-op today. It stays here so that stops being a coincidence.
     */
    try {
      const binding = await resolveDefBinding();
      const t = binding.tables;
      bombers?.setCompatibleHostDefs([
        binding.buildingId.alliedAirbase ?? -1,
        binding.buildingId.sovietAviationWorks ?? -1,
        binding.buildingId.mrdSolarAerodrome ?? -1,
        binding.buildingId.rclCarrionRoost ?? -1,
      ]);
      if (t !== null) {
        const sameArmoury = t.weapons.length > 0 && setWeaponTable(t.weapons);
        const sameMatrix = setArmorMatrix(t.armorMatrix);
        if (!sameArmoury) console.warn('[combat] def tables carry no usable weapon table');
        if (!sameMatrix) console.warn('[combat] def tables carry a malformed armour matrix (needs 7x6)');
      }
    } catch (err) {
      console.warn('[combat] def binding failed; keeping the built-in armoury', err);
    }

    if (!childrenRegistered) {
      registry.add(weaponsModule);
      registry.add(projectilesModule);
      registry.add(damageModule);
      registry.add(cleanupModule);
      childrenRegistered = true;
    }

    const probe: CombatProbe = {
      targeting, weapons, projectiles, damage,
      stats(): Record<string, number> {
        return {
          armed: targeting?.stats.armed ?? 0,
          engaged: targeting?.stats.engaged ?? 0,
          scans: targeting?.stats.scans ?? 0,
          acquired: targeting?.stats.acquired ?? 0,
          losRejects: targeting?.stats.losRejects ?? 0,
          firing: weapons?.stats.active ?? 0,
          shotsThisTick: weapons?.stats.shots ?? 0,
          slewing: weapons?.stats.slewing ?? 0,
          projectilesLive: projectiles?.liveCount ?? 0,
          shotsFired: projectiles?.shotsFired ?? 0,
          projectileHits: projectiles?.hits ?? 0,
          poolFailures: projectiles?.spawnFailures ?? 0,
          kills: damage?.stats.kills ?? 0,
          wrecks: damage?.stats.wrecks ?? 0,
          totalDamage: Math.round(damage?.stats.totalDamage ?? 0),
        };
      },
    };
    (globalThis as unknown as { __vmCombat?: CombatProbe }).__vmCombat = probe;

    console.info(
      '%c[combat]%c targeting/weapons/projectiles/damage/cleanup online — ' +
      `${CHILD_IDS.length + 1} systems, projectile pool ${projectiles.capacity}`,
      'color:#f97', 'color:inherit',
    );
  },

  simTick(s: SimContext): void {
    bombers?.preTick(s);
    targeting?.tick(s);
  },

  dispose(): void {
    const registered = childrenRegistered;
    childrenRegistered = false;
    if (registered) {
      // Guarded: registry.dispose() may already be walking its own snapshot.
      const reg = ctxSafeRegistry();
      if (reg !== null) for (const id of CHILD_IDS) reg.remove(id);
    }
    projectiles?.clear();
    setWeaponKeyResolver(null);
    targeting = null;
    weapons = null;
    projectiles = null;
    damage = null;
    bombers = null;
    delete (globalThis as unknown as { __vmCombat?: CombatProbe }).__vmCombat;
    delete (globalThis as unknown as { __vmBombers?: BomberSortieSystem }).__vmBombers;
  },
});

/**
 * `ctx()` throws once Bootstrap has torn the context down, and dispose runs on
 * both sides of that line. Swallowing it here is the difference between a clean
 * teardown and a stack trace on every hot reload.
 */
function ctxSafeRegistry(): ReturnType<typeof ctx>['registry'] | null {
  try {
    return ctx().registry;
  } catch {
    return null;
  }
}
