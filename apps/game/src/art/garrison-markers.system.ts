/**
 * Presentation-only world markers for currently garrisoned structures.
 *
 * Occupancy is sampled at 6 Hz from the canonical garrison handle column. The
 * system never calls into garrison gameplay, mutates an entity, or installs a
 * collision/nav object. It only rebuilds one InstancedMesh.
 */

import { defineSystem } from '../core/loop';
import {
  EntityFlag, EntityKind, Faction, RenderPhase, type EntityId, type RenderContext,
} from '../core/types';
import { ctx } from '../game/context';
import {
  GarrisonFortificationMarkers,
  MAX_MARKED_GARRISONS,
  type GarrisonMarkerHost,
} from './GarrisonFortificationMarkers';

const REFRESH_SECONDS = 1 / 6;

let markers: GarrisonFortificationMarkers | null = null;
let elapsed = Number.POSITIVE_INFINITY;
const hosts: GarrisonMarkerHost[] = [];
const seenHosts = new Set<number>();

function rebuild(): void {
  if (markers === null) return;
  const { world, debug } = ctx();
  const store = world.store;
  const infantry = store.byKind[EntityKind.Infantry];
  const infantryCount = store.byKindCount[EntityKind.Infantry];
  hosts.length = 0;
  seenHosts.clear();

  for (let a = 0; a < infantryCount && hosts.length < MAX_MARKED_GARRISONS; a++) {
    const unit = infantry[a];
    if ((store.flags[unit] & EntityFlag.Garrisoned) === 0) continue;
    const host = store.index(store.garrisonId[unit] as EntityId);
    if (host < 0 || seenHosts.has(host) || store.kind[host] !== EntityKind.Building) continue;
    const flags = store.flags[host];
    if ((flags & (EntityFlag.Alive | EntityFlag.PendingDestroy)) !== EntityFlag.Alive) continue;
    seenHosts.add(host);
    hosts.push({
      x: store.posX[host],
      y: store.posY[host],
      z: store.posZ[host],
      yaw: store.yaw[host],
      footprintW: store.footprintW[host],
      footprintH: store.footprintH[host],
      faction: store.faction[host] as Faction,
    });
  }

  markers.update(hosts);
  debug.setCounter('garrisonMarkers', hosts.length);
}

export default defineSystem({
  id: 'art.garrison-markers',
  renderPhase: RenderPhase.BuildingAnim,
  order: 10,

  init(): void {
    const { sceneRig, debug } = ctx();
    markers = new GarrisonFortificationMarkers(sceneRig.scene);
    elapsed = Number.POSITIVE_INFINITY;
    debug.setCounter('garrisonMarkers', 0);
  },

  frame(render: RenderContext): void {
    markers?.updatePulse(render.time);
    elapsed += render.dt;
    if (elapsed < REFRESH_SECONDS) return;
    elapsed %= REFRESH_SECONDS;
    rebuild();
  },

  dispose(): void {
    markers?.dispose();
    markers = null;
    hosts.length = 0;
    seenHosts.clear();
    elapsed = Number.POSITIVE_INFINITY;
  },
});
