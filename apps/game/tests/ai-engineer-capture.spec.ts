/** AI engineer purchasing, honest targeting, and escort command coverage. */

import { afterEach, describe, expect, it } from 'vitest';

import { AI_CAPTURE, BuildCatalog, BuildRole } from '../src/sim/AIStrategy';
import type { CatalogEntry, DefLookup } from '../src/sim/AIStrategy';
import { AiBrain } from '../src/sim/AI';
import { CaptureService, setCaptureService } from '../src/sim/Capture';
import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import { Rng } from '../src/core/math';
import {
  ArmorClass, CommandKind, EntityFlag, EntityKind, Faction, OrderKind, VisionLevel,
} from '../src/core/types';
import type { Command, EntityId, IRng, IVision, PlayerId, PlayerState, SimContext } from '../src/core/types';
import { SIM_DT } from '../src/core/config';

const ENEMY = 0 as PlayerId;
const AI = 1 as PlayerId;

function syntheticBinding(): DefLookup {
  const source = new BuildCatalog();
  const unitId: Record<string, number> = {};
  const buildingId: Record<string, number> = {};
  let u = 0; let b = 0;
  for (const e of source.all) {
    if (e.isBuilding) buildingId[e.key] = b++;
    else unitId[e.key] = u++;
  }
  return { tables: null, unitId, buildingId };
}

interface BrainProbe {
  budget: number;
  openingIndex: number;
  opening: readonly unknown[];
  powerUrgent: boolean;
  wantHarvesters: number;
  expandX: number;
  lastDamageTick: number;
  basePressure: number;
  engineerInProduction: number;
  roleCount: Int32Array;
  roleBuilding: Int32Array;
  census(): void;
  captureOperation(s: SimContext): void;
  chooseBuild(s: SimContext, p: PlayerState): CatalogEntry | null;
}

function ctx(tick = 600): SimContext {
  const rng: IRng = new Rng(9);
  return { dt: SIM_DT, tick, time: tick * SIM_DT, rng };
}

function closedVision(): IVision {
  const grid = new Uint8Array(1);
  return {
    isVisibleAt: () => false,
    isExplored: () => false,
    visibilityOf: () => VisionLevel.Hidden,
    canSee: () => false,
    hasRadar: () => false,
    gridFor: () => grid,
  };
}

function copyCommands(channels: Channels): Command[] {
  const out: Command[] = [];
  channels.commands.drain((c) => out.push({ ...c, entities: c.entities.slice() } as Command));
  return out;
}

function makeRig(): {
  world: World; channels: Channels; catalog: BuildCatalog; brain: AiBrain; probe: BrainProbe;
  engineer: EntityId; target: EntityId;
} {
  const world = new World();
  const channels = new Channels();
  world.addPlayer(Faction.Allies, 'Enemy', true, true);
  world.addPlayer(Faction.Soviets, 'AI', false, false);
  const p = world.player(AI);
  p.aiDifficulty = 1;
  p.credits = 5000;
  p.storageMax = 10000;
  p.stats.oreMined = 1;
  p.powerProduced = 500;
  p.powerConsumed = 50;

  const catalog = new BuildCatalog();
  catalog.bind(syntheticBinding());
  const st = world.store;

  const engineerDef = catalog.forRole(BuildRole.Engineer, Faction.Soviets)!;
  const engineer = st.alloc(EntityKind.Infantry, engineerDef.defId, AI, Faction.Soviets, 390, 0, 400, 0);
  let i = st.index(engineer);
  st.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision;
  st.hp[i] = 90; st.maxHp[i] = 90; st.maxSpeed[i] = 5; st.radius[i] = 0.7;

  const targetDef = catalog.forRole(BuildRole.WarFactory, Faction.Allies)!;
  const target = st.alloc(EntityKind.Building, targetDef.defId, ENEMY, Faction.Allies, 450, 0, 400, 0);
  i = st.index(target);
  st.flags[i] |= EntityFlag.IsFactory | EntityFlag.BlocksNav;
  st.footprintW[i] = 3; st.footprintH[i] = 2;
  st.maxHp[i] = 2000; st.hp[i] = 800; st.armorClass[i] = ArmorClass.Concrete;
  st.buildProgress[i] = 1;

  for (let k = 0; k < AI_CAPTURE.minEscort + 1; k++) {
    const tank = st.alloc(EntityKind.Vehicle, -1, AI, Faction.Soviets, 388 + k * 3, 0, 408, 0);
    i = st.index(tank);
    st.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack | EntityFlag.ProvidesVision;
    st.hp[i] = 300; st.maxHp[i] = 300; st.maxSpeed[i] = 6; st.radius[i] = 2;
  }

  const capture = new CaptureService(world, channels);
  setCaptureService(capture);
  const brain = new AiBrain(world, channels.commands, catalog, AI, 17);
  brain.attach(channels.events);
  const probe = brain as unknown as BrainProbe;
  probe.census();
  return { world, channels, catalog, brain, probe, engineer, target };
}

afterEach(() => setCaptureService(null));

describe('AI engineer doctrine', () => {
  it('keeps faction engineers distinct from commander support', () => {
    const c = new BuildCatalog();
    expect(c.forRole(BuildRole.Engineer, Faction.Allies)?.key).toBe('engineer');
    expect(c.forRole(BuildRole.Engineer, Faction.Soviets)?.key).toBe('engineer');
    expect(c.forRole(BuildRole.Engineer, Faction.Meridian)?.key).toBe('mrdArtificer');
    expect(c.forRole(BuildRole.Engineer, Faction.Reclaim)?.key).toBe('rclTinker');
    expect(c.forRole(BuildRole.Support, Faction.Soviets)?.key).toBe('commissar');
  });

  it('issues one capture order and an attack-move escort through the command bus', () => {
    const r = makeRig();
    r.probe.budget = 8;
    r.probe.captureOperation(ctx());
    const commands = copyCommands(r.channels);
    const capture = commands.find((c) => c.kind === CommandKind.Order && c.order === OrderKind.Capture);
    const escort = commands.find((c) => c.kind === CommandKind.Order && c.order === OrderKind.AttackMove);
    expect(capture?.target).toBe(r.target);
    expect(Array.from(capture?.entities ?? [])).toEqual([r.engineer as number]);
    expect(escort?.entityCount).toBe(AI_CAPTURE.escortSize);
    expect(escort?.target).toBe(0);
  });

  it('does not target through shroud and honours capture-service vetoes', () => {
    const hidden = makeRig();
    hidden.world.vision = closedVision();
    hidden.probe.budget = 8;
    hidden.probe.captureOperation(ctx());
    expect(copyCommands(hidden.channels)).toHaveLength(0);

    setCaptureService(null);
    const vetoed = makeRig();
    const svc = new CaptureService(vetoed.world, vetoed.channels);
    svc.addVeto((id) => id === vetoed.target);
    setCaptureService(svc);
    vetoed.probe.budget = 8;
    vetoed.probe.captureOperation(ctx());
    expect(copyCommands(vetoed.channels)).toHaveLength(0);
  });

  it('buys at most one engineer for a visible legal operation', () => {
    const r = makeRig();
    const st = r.world.store;
    st.markDead(r.engineer);
    st.flushDestroyed();
    r.probe.census();
    r.probe.openingIndex = r.probe.opening.length;
    r.probe.powerUrgent = false;
    r.probe.wantHarvesters = 0;
    r.probe.expandX = -1;
    r.probe.lastDamageTick = ctx().tick;
    r.probe.basePressure = 0;
    r.probe.roleCount.fill(0);
    r.probe.roleBuilding.fill(0);
    r.probe.roleCount[BuildRole.Refinery] = r.brain.diff.maxRefineries;
    r.probe.roleCount[BuildRole.Barracks] = 1;
    r.probe.roleCount[BuildRole.WarFactory] = 1;
    r.probe.roleCount[BuildRole.Defense] = r.brain.diff.maxDefense;
    r.probe.roleCount[BuildRole.Power] = 2;
    r.probe.roleCount[BuildRole.Radar] = 1;
    r.probe.roleCount[BuildRole.TechLab] = 1;
    r.probe.roleCount[BuildRole.Repair] = 1;
    r.probe.roleCount[BuildRole.CommandPost] = 1;
    r.probe.roleCount[BuildRole.Superweapon] = r.brain.diff.maxSuperweapons;
    r.world.player(AI).commanderPowerMask = -1;
    r.world.player(AI).upgradeMask = -1;

    expect(r.probe.chooseBuild(ctx(), r.world.player(AI))?.role).toBe(BuildRole.Engineer);
    r.channels.events.emit('production:started', {
      player: AI, tab: 2, defId: r.catalog.forRole(BuildRole.Engineer, Faction.Soviets)!.defId,
      isBuilding: false, cost: 500,
    } as never);
    expect(r.probe.engineerInProduction).toBe(1);
    expect(r.probe.chooseBuild(ctx(601), r.world.player(AI))?.role).not.toBe(BuildRole.Engineer);
  });
});
