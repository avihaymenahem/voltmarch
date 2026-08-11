/**
 * ============================================================================
 * VOLTMARCH — src/sim/economy.system.ts
 * ============================================================================
 * The registration shim for the economic loop. All of the work is in
 * Economy.ts, Harvesting.ts and Power.ts; this file builds one of each, wires
 * them to the world, and runs them in the right order at Phase.Economy.
 *
 * WHAT IT WIRES
 * -------------
 *  1. `world.ore` — the `IOreField` port. Every other sim module reaches ore
 *     through this and never imports Economy.ts.
 *  2. `setActiveOreField` / `setActiveEconomy` — module accessors for the
 *     handful of callers that need the concrete classes: the crystal renderer
 *     (densityAt / drainDirty), production (spend / refund / buildSpeedMul)
 *     and the HUD (incomeRate / creditsDisplay).
 *  3. A SECOND system module at Phase.Movement — the harvester mover. See the
 *     header of Harvesting.ts for why it exists and how it hands over.
 *
 * ORDER INSIDE THE TICK
 * ---------------------
 *   power -> storage -> harvesters -> ledger -> regrowth
 *
 * Power first because `buildSpeedMul` and the Powered bits it writes are read
 * by production, which runs one phase earlier NEXT tick and would otherwise be
 * a frame behind. Storage before harvesters so a refinery that completed this
 * tick raises the cap before anything deposits into it. The ledger last so its
 * coalesced `economy:credits` event carries the whole tick's movement in one
 * dispatch instead of one per harvester.
 *
 * WHY ORE IS SEEDED FROM simTick AND NOT FROM init
 * ------------------------------------------------
 * `activeScenario()` is only populated once `game.scenario` has run, and that
 * system deliberately initialises LAST (Phase.Cleanup, order 10000) because it
 * needs terrain, defs and models to already exist. This module initialises at
 * Phase.Economy, which is much earlier. So the ore fields are seeded on the
 * first tick that finds a scenario, which is inside the scenario system's own
 * `loop.runHeadless(settleTicks)` call — early enough that a settled fixture
 * shot already has harvesters mid-run.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import type { SystemRegistry } from '../core/loop';
import { Locomotor, Phase } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';
import {
  ORE_REGROW_INTERVAL, POWER_RECOMPUTE_INTERVAL, SIM_DT,
} from '../core/config';
import { ctx, hasGameContext } from '../game/context';
import { activeScenario } from '../game/Scenarios';

import { Economy, OreField, setActiveEconomy, setActiveOreField } from './Economy';
import { HarvesterController, harvesterDriveMode, setHarvesterDrive } from './Harvesting';
import { PowerGrid } from './Power';
import { production } from './Production';

/**
 * How much storage the structure in slot `i` is worth — `Economy`'s window onto
 * the content catalog, which is the only table in the build that knows an Ore
 * Silo from a Battle Lab.
 *
 * THIS REPLACES A TWO-ROW LOOKUP THAT DID NOT WORK. There used to be a
 * `STORAGE_BY_KEY` here with rows for `refinery` and `oreSilo`, swept over the
 * living entities ONCE, on the first tick a scenario existed. It failed three
 * ways at the same time: the Meridian `mrdVault` and the Reclamation `rclHeap`
 * had no row, nothing built DURING a match was ever swept, and every one of
 * those misses read as a plain zero because `recomputeStorage` overwrites
 * `storageMax` outright — so the silo's own `p.storageMax +=` survived five
 * ticks and was then erased. Measured live before the change: an Allied base
 * sat at a 15 000 cap, a fourth silo was built and finished, and the cap was
 * still 15 000 twelve seconds later.
 *
 * Resolved lazily on every call rather than captured at init, because
 * `production()` is null during teardown and between matches, and a captured
 * reference to a disposed service is a worse failure than a zero.
 */
function storageForSlot(i: number): number {
  return production()?.storageForSlot(i) ?? 0;
}

let ore: OreField | null = null;
let economy: Economy | null = null;
let power: PowerGrid | null = null;
let harvesters: HarvesterController | null = null;
/**
 * Held from init so `dispose()` never has to call `ctx()`. Bootstrap clears the
 * game context BEFORE it calls `registry.dispose()`, so a teardown path that
 * reaches for `ctx()` throws on the way out of every match.
 */
let world: World | null = null;
let registry: SystemRegistry | null = null;

/** True once the scenario's ore fields have been laid into the grid. */
let seeded = false;
/** True once we have decided whether the real mover is present. */
let movementChecked = false;
let ticksSinceRegrow = 0;
let ticksSinceStorage = 0;

/**
 * Stand the fallback mover down if `nav-movement` is in the registry.
 *
 * This CANNOT be answered from `init()`. `sim.pathing` is the only id discovery
 * sees; it registers `sim.steering` and `sim.movement` from its own `init`, and
 * that init runs at Phase.PathRequest (500) — after this module's, at
 * Phase.Economy (300). Asking too early gets "no mover exists", which is how
 * the fallback ended up fighting nav for four harvesters the first time round.
 * So the question is asked once, on the first tick, when every init has run.
 */
function checkForRealMover(): void {
  movementChecked = true;
  if (registry === null || registry.find('sim.movement') === undefined) return;
  // `Steering.seeksGoal()` already lists SeekOre and ReturnToRefinery and the
  // FSM publishes its destination through orderX/orderZ, so nav drives
  // harvesters with flow fields, formations and crowd relaxation — all of
  // which the backstop lacks. It drops to 'assist': it only touches a
  // harvester nav has explicitly stopped driving. See the Harvesting.ts header.
  setHarvesterDrive('assist');
}

/**
 * The harvester mover, registered separately so it can write position from
 * Phase.Movement — the phase that owns position — while the FSM that decides
 * where to go stays at Phase.Economy. `order: 900` puts it behind any real
 * nav-movement system, which will have already claimed anything it cares about
 * by writing `navField`.
 */
const driveModule = defineSystem({
  id: 'sim.economy.drive',
  phase: Phase.Movement,
  order: 900,
  simTick(s: SimContext): void {
    harvesters?.drive(s.dt);
  },
});

/**
 * Lay the scenario's ore patches into the cell grid. Runs exactly once.
 *
 * It used to also sweep the world declaring storage structures to the ledger,
 * which is where the silo defect lived — see `storageForSlot` above. A one-shot
 * sweep can only ever describe the world as it was on the first tick, and the
 * ore fields are the only thing here that is genuinely a property of that
 * moment.
 */
function seedFromScenario(): boolean {
  const spec = activeScenario();
  if (spec === null || ore === null || economy === null || world === null) return false;

  const terrain = world.terrain;

  // Ore must land where a harvester can actually stand. Without this filter a
  // patch authored near a shoreline drops a third of its value into the sea and
  // the field reads as half-mined before anyone has touched it.
  const accept = (cx: number, cz: number): boolean =>
    !terrain.isWater(cx, cz) && terrain.isPassable(cx, cz, Locomotor.Track);

  let cells = 0;
  let value = 0;
  for (let i = 0; i < spec.ore.length; i++) {
    const f = spec.ore[i];
    const id = ore.seedField(f.x, f.z, f.radius, f.richness, accept);
    if (id < 0) continue;
    const rec = ore.field(id);
    if (rec !== undefined) { cells += rec.cells.length; value += rec.capacity; }
  }

  // The scenario's own structures are standing by now, and the resolver reads
  // them straight out of the catalog, so one rescan here is the whole handover.
  economy.recomputeStorage();

  const s = ore.stats();
  console.info(
    `%c[economy]%c ${s.fields} ore field(s), ${cells} cells, ${Math.round(value)} credits on the ground` +
      ` · harvester drive: ${harvesterDriveMode()}`,
    'color:#7fd', 'color:inherit',
  );
  if (spec.ore.length > 0 && s.fields === 0) {
    console.warn(
      '[economy] the scenario declared ore but every cell was rejected as water or impassable — ' +
        'check the shoreline against ScenarioSpec.ore.',
    );
  }
  return true;
}

export default defineSystem({
  id: 'sim.economy',
  phase: Phase.Economy,
  order: 0,

  init(): void {
    const c = ctx();
    world = c.world;
    registry = c.registry;
    const channels = c.channels;

    ore = new OreField();
    economy = new Economy(world, channels);
    power = new PowerGrid(world, channels);
    harvesters = new HarvesterController(world, channels, ore, economy);

    world.ore = ore;
    setActiveOreField(ore);
    setActiveEconomy(economy);
    // Where the credit ceiling actually comes from. Installed before the first
    // `recomputeStorage` below, so frame zero already shows the true cap.
    economy.setStorageResolver(storageForSlot);

    seeded = false;
    movementChecked = false;
    ticksSinceRegrow = 0;
    ticksSinceStorage = 0;

    // A field running dry is a real strategic event — it is when a player has
    // to expand — but `GameEvents` has no slot for it and that file is frozen.
    // The listener channel on OreField is the substitute; the AI and the EVA
    // module subscribe to it directly.
    ore.onOreExhausted((id, x, z) => {
      console.info(`[economy] ore field ${id} exhausted at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    });

    registry.add(driveModule);

    // Power has to be correct on frame zero: a fixture screenshot poses the
    // HUD power bar before a single tick has run.
    power.recompute();
    economy.recomputeStorage();

    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmEconomy = { ore, economy, power, harvesters, world };
  },

  simTick(s: SimContext): void {
    if (ore === null || economy === null || power === null || harvesters === null) return;

    if (!movementChecked) checkForRealMover();
    if (!seeded) seeded = seedFromScenario();

    power.simTick(s.time);

    ticksSinceStorage++;
    if (ticksSinceStorage >= POWER_RECOMPUTE_INTERVAL) {
      ticksSinceStorage = 0;
      economy.recomputeStorage();
    }

    harvesters.simTick(s);
    economy.tick(s.dt, s.time);

    ticksSinceRegrow++;
    if (ticksSinceRegrow >= ORE_REGROW_INTERVAL) {
      ore.regrow(ticksSinceRegrow * SIM_DT);
      ticksSinceRegrow = 0;
    }

    // Debug counters at 2 Hz. `DebugCounters` carries an index signature, so
    // these join the F3 overlay's data without touching render/debug.ts.
    if ((s.tick % 15) === 0 && world !== null && hasGameContext()) {
      const { debug } = ctx();
      const local = world.player(world.localPlayer);
      const os = ore.stats();
      debug.counters.credits = Math.round(local.credits);
      debug.counters.income = Math.round(economy.incomeRate(world.localPlayer));
      debug.counters.powerOut = local.powerProduced;
      debug.counters.powerDraw = local.powerConsumed;
      debug.counters.harvesters = harvesters.stats().harvesters;
      debug.counters.oreLeft = Math.round(os.remaining);
    }
  },

  dispose(): void {
    registry?.remove('sim.economy.drive');
    economy?.setStorageResolver(null);
    harvesters?.dispose();
    power?.dispose();
    ore?.clear();
    if (world !== null && world.ore === ore) {
      // Hand the port back a total null object rather than a cleared field: a
      // cleared OreField would keep answering, and would answer "the whole map
      // is 16 384 empty cells", which is slower and no more useful than "no".
      world.ore = {
        oreAt: () => 0, takeOre: () => 0, oreValue: () => 1,
        findOre: () => false, totalOre: () => 0,
      };
    }
    setActiveOreField(null);
    setActiveEconomy(null);
    ore = null;
    economy = null;
    power = null;
    harvesters = null;
    world = null;
    registry = null;
    seeded = false;
    movementChecked = false;
    setHarvesterDrive('full');
  },
});
