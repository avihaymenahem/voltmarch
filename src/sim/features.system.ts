/**
 * ============================================================================
 * src/sim/features.system.ts — REGISTRATION FOR THE MISSING-SERIES-FEATURES SET
 * ============================================================================
 *
 * Six gameplay verbs land here: superweapons, engineer capture, base repair,
 * map crates, infantry garrisons and troop transports — plus the three orphaned
 * commands (`RepairToggle`, `SetStance`, `SelfDestruct`) that input has been
 * issuing into the void since the command bus was written.
 *
 * ONE FILE, EIGHT SYSTEMS
 * -----------------------
 * `src/game/Systems.ts` discovers exactly one default export per file, but
 * these features need six different sim phases (a garrison volley belongs at
 * Phase.Weapons; a capture needs Phase.Cleanup positions). So the default
 * export is the command drain — the one that must run first — and its `init`
 * registers the siblings directly with `ctx().registry`. The sub-modules carry
 * no `init` of their own on purpose: `SystemRegistry.init()` iterates a
 * SNAPSHOT of its module list, so anything added during another module's init
 * would never be initialised. All setup happens here, once, in one place.
 *
 * THE COMMAND DRAIN, AND WHY IT PARKS AND RE-ISSUES
 * ------------------------------------------------
 * `input/Commands.ts` drains at Phase.Command and re-issues everything that is
 * not an order. `sim/Production.ts` drains whatever is left at Phase.Production
 * (order 0). This module sits between them at order -100, takes the three
 * commands nobody consumed, and RE-ISSUES the rest so Production still sees
 * them. Re-issue happens after `drain()` returns, because `CommandBus.drain`
 * resets the ring and the entity arena in its `finally`.
 * ============================================================================
 */

import * as THREE from 'three';

import { defineSystem } from '../core/loop';
import { CommandKind, OrderKind, Phase, Stance } from '../core/types';
import type { BuildTab, Command, EntityId, PlayerId, SimContext } from '../core/types';
import { MAX_SELECTION } from '../core/config';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';

import { CaptureService, setCaptureService } from './Capture';
import { CrateService, setCrateService } from './Crates';
import { GarrisonService, setGarrisonService } from './Garrison';
import { RepairSellService, setRepairSellService } from './RepairSell';
import { SuperweaponService, setSuperweaponService } from './Superweapons';
import type { TargetingHost } from './Superweapons';
import { TransportService, setTransportService } from './Transport';

/* ==========================================================================
 * 1. LIVE SERVICES
 * ========================================================================== */

let superweapons: SuperweaponService | null = null;
let capture: CaptureService | null = null;
let garrison: GarrisonService | null = null;
let crates: CrateService | null = null;
let repairSell: RepairSellService | null = null;
let transport: TransportService | null = null;

/* ==========================================================================
 * 2. COMMAND PARKING
 *
 * A fixed pool of copies plus one shared entity arena. `Command.entities` is a
 * view into the bus's arena and is invalid the moment the drain returns, so
 * anything we intend to re-issue has to be copied out DURING the callback.
 * ========================================================================== */

interface ParkedCommand {
  kind: CommandKind;
  player: PlayerId;
  order: OrderKind;
  target: EntityId;
  x: number;
  z: number;
  defId: number;
  tab: BuildTab;
  cx: number;
  cz: number;
  stance: Stance;
  queued: boolean;
  arg: number;
  /** Offset into PARK_ARENA. */
  entityStart: number;
  entityCount: number;
}

const PARK_CAPACITY = 128;
/** Sized to match the CommandBus's own entity arena, so parking never truncates. */
const PARK_ARENA = new Int32Array(MAX_SELECTION * 64);
const PARKED: ParkedCommand[] = [];
for (let i = 0; i < PARK_CAPACITY; i++) {
  PARKED.push({
    kind: CommandKind.None, player: 0 as PlayerId, order: OrderKind.None,
    target: 0 as EntityId, x: 0, z: 0, defId: -1, tab: 0 as BuildTab,
    cx: 0, cz: 0, stance: Stance.Aggressive, queued: false, arg: 0,
    entityStart: 0, entityCount: 0,
  });
}
let parkCount = 0;
let parkArenaHead = 0;
/** Diagnostics: commands lost because the parking pool filled. */
let parkDropped = 0;

function park(cmd: Command): void {
  if (parkCount >= PARK_CAPACITY) { parkDropped++; return; }
  const p = PARKED[parkCount++];
  p.kind = cmd.kind;
  p.player = cmd.player;
  p.order = cmd.order;
  p.target = cmd.target;
  p.x = cmd.x;
  p.z = cmd.z;
  p.defId = cmd.defId;
  p.tab = cmd.tab;
  p.cx = cmd.cx;
  p.cz = cmd.cz;
  p.stance = cmd.stance;
  p.queued = cmd.queued;
  p.arg = cmd.arg;

  const n = Math.min(cmd.entityCount, PARK_ARENA.length - parkArenaHead);
  p.entityStart = parkArenaHead;
  p.entityCount = n;
  for (let i = 0; i < n; i++) PARK_ARENA[parkArenaHead + i] = cmd.entities[i];
  parkArenaHead += n;
}

/** Put everything we did not consume back on the bus for Production to find. */
function reissue(): void {
  // Same reasoning as `Commands.ts#reissueParked`: these are the SAME actions
  // going round again for a later phase, and a recorder tapping the drain
  // counts each one twice without the mark.
  ctx().channels.commands.markReissue(reissueInner);
}

function reissueInner(): void {
  const bus = ctx().channels.commands;
  for (let i = 0; i < parkCount; i++) {
    const p = PARKED[i];
    switch (p.kind) {
      case CommandKind.Order:
        bus.issueOrder(
          p.player, p.order,
          PARK_ARENA.subarray(p.entityStart, p.entityStart + p.entityCount),
          p.entityCount, p.x, p.z, p.target, p.queued,
        );
        break;
      case CommandKind.ProductionStart:
        bus.issueProductionStart(p.player, p.tab, p.defId, p.arg);
        break;
      case CommandKind.ProductionPause:
        bus.issueProductionPause(p.player, p.tab, p.arg !== 0);
        break;
      case CommandKind.ProductionCancel:
        bus.issueProductionCancel(p.player, p.tab, p.defId, p.arg);
        break;
      case CommandKind.PlaceBuilding:
        // `arg` carries the placement facing — see CommandBus.issuePlaceBuilding.
        bus.issuePlaceBuilding(p.player, p.defId, p.cx, p.cz, p.arg);
        break;
      case CommandKind.SetRally:
        bus.issueSetRally(p.player, p.target, p.x, p.z);
        break;
      case CommandKind.SellBuilding:
        bus.issueSell(p.player, p.target);
        break;
      case CommandKind.SetPrimary:
        bus.issueSetPrimary(p.player, p.target);
        break;
      default:
        // CommandKind.None and anything a future contract adds: dropping it
        // here would be silent, so say so once per occurrence.
        parkDropped++;
        break;
    }
  }
  parkCount = 0;
  parkArenaHead = 0;
}

/* ==========================================================================
 * 3. SUB-SYSTEMS
 *
 * No `init` on any of these — see the header. They are added by the default
 * export's init and run in phase order like anything else.
 * ========================================================================== */

const superweaponSystem = defineSystem({
  id: 'sim.features.superweapons',
  phase: Phase.Production,
  order: 20,
  simTick(s: SimContext): void { superweapons?.simTick(s); },
});

const repairSystem = defineSystem({
  id: 'sim.features.repair',
  phase: Phase.Economy,
  order: 500,
  simTick(s: SimContext): void { repairSell?.simTick(s); },
});

const crateSystem = defineSystem({
  id: 'sim.features.crates',
  // Late in Movement: pickups must test this tick's final positions, and the
  // crate has to be consumed before Phase.SpatialRebuild re-indexes it.
  phase: Phase.Movement,
  order: 950,
  simTick(s: SimContext): void { crates?.simTick(s); },
});

const garrisonFireSystem = defineSystem({
  id: 'sim.features.garrison.volley',
  phase: Phase.Weapons,
  order: 500,
  simTick(s: SimContext): void { garrison?.weaponsTick(s); },
});

const captureSystem = defineSystem({
  id: 'sim.features.capture',
  // Cleanup, ahead of `combat.cleanup` (order 0): positions are final and an
  // engineer consumed here is freed in the same tick.
  phase: Phase.Cleanup,
  order: -500,
  simTick(s: SimContext): void { capture?.simTick(s); },
});

const garrisonEntrySystem = defineSystem({
  id: 'sim.features.garrison',
  phase: Phase.Cleanup,
  order: -400,
  simTick(s: SimContext): void { garrison?.simTick(s); },
});

/**
 * Five slots behind the garrison, and the gap is load-bearing.
 *
 * Both services scan for `OrderKind.Enter`; the garrison owns the ones whose
 * target is a Building and walks past everything else without clearing it, so
 * this one has to run AFTER it to pick those up. See the ownership table in
 * `sim/Transport.ts`'s header.
 */
const transportSystem = defineSystem({
  id: 'sim.features.transport',
  phase: Phase.Cleanup,
  order: -395,
  simTick(s: SimContext): void { transport?.simTick(s); },
});

/* ==========================================================================
 * 4. THE DEFAULT EXPORT — command drain + ownership of every service
 * ========================================================================== */

export default defineSystem({
  id: 'sim.features',
  phase: Phase.Production,
  order: -100,

  async init(): Promise<void> {
    const { world, channels, registry, cameraRig, handle } = ctx();

    capture = new CaptureService(world, channels);
    setCaptureService(capture);

    garrison = new GarrisonService(world, channels);
    setGarrisonService(garrison);
    garrison.attach();

    crates = new CrateService(world, channels);
    setCrateService(crates);

    repairSell = new RepairSellService(world, channels);
    setRepairSellService(repairSell);
    repairSell.attach();

    superweapons = new SuperweaponService(world, channels);
    setSuperweaponService(superweapons);

    // The seat counts live on `UnitDef.passengers`, so this needs the def
    // tables. Awaited rather than resolved in the background: a transport whose
    // capacity has not landed yet reads as "not a transport", and the very
    // first `Enter` order of the match would be refused for a reason no player
    // could see. `deploy.system.ts` awaits the same binding for the same reason.
    transport = new TransportService(world, channels);
    setTransportService(transport);
    try {
      const binding = await resolveDefBinding();
      if (binding.tables !== null) transport.bindDefs(binding.tables);
    } catch {
      // No data module: every seat count stays 0 and the verb is inert. That is
      // the correct answer on fallback content, which has no transport row.
    }
    transport.attach();

    // Targeting mode. The listener is installed only while a weapon is armed,
    // so ordinary selection and ordering are untouched the rest of the time.
    const hit = new THREE.Vector3();
    const host: TargetingHost = {
      element: handle.canvas,
      groundAt(clientX: number, clientY: number, out: Float32Array): boolean {
        if (!cameraRig.screenToGround(clientX, clientY, hit)) return false;
        out[0] = hit.x;
        out[1] = hit.z;
        return true;
      },
    };
    superweapons.attachTargeting(host);

    registry.add(superweaponSystem);
    registry.add(repairSystem);
    registry.add(crateSystem);
    registry.add(garrisonFireSystem);
    registry.add(captureSystem);
    registry.add(garrisonEntrySystem);
    registry.add(transportSystem);

    // Console + harness handles, matching the __vm* convention used by
    // production, economy and combat.
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmFeatures = {
      superweapons, capture, garrison, crates, repairSell, transport,
      /** `__vmFeatures.fire('nuke', 512, 512)` from the console. */
      fire: (key: string, x: number, z: number) =>
        superweapons?.fireAt(world.localPlayer, key, x, z) ?? 'rejected',
      arm: (key: string) => superweapons?.arm(world.localPlayer, key) ?? false,
      parkDropped: () => parkDropped,
    };

    console.info(
      '[features] superweapons, engineer capture, base repair, crates, garrisons '
      + 'and transports online',
    );
  },

  simTick(_s: SimContext): void {
    const bus = ctx().channels.commands;
    if (bus.pending === 0) return;
    const svc = repairSell;

    bus.drain((cmd) => {
      if (svc !== null && svc.handleCommand(cmd)) return;
      park(cmd);
    });
    reissue();
  },

  dispose(): void {
    const { registry } = ctx();
    for (const id of [
      'sim.features.superweapons',
      'sim.features.repair',
      'sim.features.crates',
      'sim.features.garrison.volley',
      'sim.features.capture',
      'sim.features.garrison',
      'sim.features.transport',
    ]) registry.remove(id);

    superweapons?.dispose();
    garrison?.dispose();
    crates?.dispose();
    repairSell?.dispose();
    capture?.dispose();
    transport?.dispose();

    setSuperweaponService(null);
    setGarrisonService(null);
    setCrateService(null);
    setRepairSellService(null);
    setCaptureService(null);
    setTransportService(null);
    superweapons = null;
    garrison = null;
    crates = null;
    repairSell = null;
    capture = null;
    transport = null;

    parkCount = 0;
    parkArenaHead = 0;
    delete (globalThis as unknown as Record<string, unknown>).__vmFeatures;
  },
});
