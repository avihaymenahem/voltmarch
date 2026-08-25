/**
 * ============================================================================
 * "SOME ENEMIES ARE INVISIBLE" — the measurement, not the theory
 * ============================================================================
 * The player reported three times that an enemy walked into their base which
 * they could shoot, hover and target, and never see. Every previous pass
 * narrowed the search by READING. This file asks the mechanical question
 * instead, once per simulated frame:
 *
 *   For every ALIVE entity the visibility mask says the local player may see,
 *   did it receive an instance slot that the GPU will actually draw?
 *
 * `RenderBridge.auditNow()` answers it, and answers with a mechanism —
 * no-instance-slot / beyond-draw-count / degenerate-matrix /
 * outside-batch-bounds / slot-not-owned — so a failure here names the bug
 * rather than hinting at it.
 *
 * Everything runs headless. `THREE.InstancedMesh` never touches a GL context,
 * so a whole match's worth of spawn/kill/fog churn costs milliseconds.
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { EntityStore } from '../src/core/world';
import { EntityFlag, EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { INSTANCE_BATCH_INITIAL_CAPACITY } from '../src/core/config';
import { mulberry32 } from '../src/core/math';
import {
  FACTION_ANY,
  RenderBridge,
  clearKindMeshes,
  registerKindMesh,
  setRenderBridge,
  type KindMesh,
  type RenderAudit,
  type RenderVisibilityMask,
} from '../src/render/RenderBridge';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* ========================================================================== */
/* Rig                                                                        */
/* ========================================================================== */

function makeRig(): { store: EntityStore; scene: THREE.Scene; bridge: RenderBridge } {
  clearKindMeshes();
  const store = new EntityStore();
  const scene = new THREE.Scene();
  const bridge = new RenderBridge(store, scene);
  setRenderBridge(bridge);
  return { store, scene, bridge };
}

function teardown(bridge: RenderBridge): void {
  clearKindMeshes();
  setRenderBridge(null);
  bridge.dispose();
}

/** A two-part model, so the audit exercises the multi-part slot invariant. */
function makeModel(): KindMesh {
  const mat = new THREE.MeshStandardMaterial();
  return {
    geometry: new THREE.BoxGeometry(3, 2, 6),
    material: mat,
    parts: [{ geometry: new THREE.BoxGeometry(1.6, 1, 1.6), material: mat, y: 2, followsTurret: true }],
  };
}

/** The shroud, as the bridge sees it: a slot-indexed predicate and nothing more. */
class MaskStub implements RenderVisibilityMask {
  readonly hidden = new Set<number>();
  isRenderHiddenAt(index: number): boolean {
    return this.hidden.has(index);
  }
}

/** One rendered frame: snapshot, draw, audit. */
function frame(store: EntityStore, bridge: RenderBridge): RenderAudit {
  store.snapshotPrev();
  bridge.update(1);
  return bridge.auditNow();
}

function describeMisses(audit: RenderAudit): string {
  return audit.misses
    .map((m) =>
      `${m.reason}: slot ${m.index} gen ${m.gen} kind ${m.kind} faction ${m.faction} ` +
      `def ${m.defId} at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) in batch "${m.batch}" ` +
      `instance ${m.slot}/${m.drawCount} of ${m.capacity} — ${m.detail}`)
    .join('\n');
}

/* ========================================================================== */

describe('render visibility — every entity the sim shows must reach a draw slot', () => {
  it('draws a lone unit and reports no miss', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 100, 0, 200, 0);

    const audit = frame(store, bridge);
    expect(describeMisses(audit)).toBe('');
    expect(audit.eligible).toBe(1);
    expect(audit.drawn).toBe(1);
    expect(bridge.missedDraws).toBe(0);
    teardown(bridge);
  });

  it('survives a wave larger than the initial batch capacity', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);

    const wave = INSTANCE_BATCH_INITIAL_CAPACITY * 5 + 3;
    for (let k = 0; k < wave; k++) {
      store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 40 + k * 3, 0, 60 + (k % 7) * 4, 0);
    }

    const audit = frame(store, bridge);
    expect(describeMisses(audit)).toBe('');
    expect(audit.drawn).toBe(wave);
    expect(bridge.batcher.unwrittenSlots).toBe(0);
    teardown(bridge);
  });

  it('keeps every entity drawable across a fog mask that flaps', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    const mask = new MaskStub();
    bridge.visibility = mask;

    const ids: number[] = [];
    for (let k = 0; k < 60; k++) {
      const id = store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, k * 5, 0, 120, 0);
      ids.push(store.index(id));
    }

    for (let f = 0; f < 40; f++) {
      mask.hidden.clear();
      // A shroud edge sweeping across the column: a different half is hidden
      // every frame, which is exactly what a moving scout produces.
      for (let k = 0; k < ids.length; k++) {
        if ((k + f) % 3 !== 0) mask.hidden.add(ids[k]);
      }
      const audit = frame(store, bridge);
      expect(describeMisses(audit)).toBe('');
    }
    expect(bridge.missedDraws).toBe(0);
    expect(bridge.batcher.unwrittenSlots).toBe(0);
    teardown(bridge);
  });

  it('holds under a full match of spawn / kill / mask churn', () => {
    const { store, bridge } = makeRig();
    // Two shared models and one per-faction model, which is the registration
    // shape the art modules actually use.
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 11);
    registerKindMesh(EntityKind.Infantry, FACTION_ANY, makeModel(), 12);
    registerKindMesh(EntityKind.Vehicle, Faction.Reclaim, makeModel(), 13);
    registerKindMesh(EntityKind.Building, FACTION_ANY, makeModel(), 20);

    const mask = new MaskStub();
    bridge.visibility = mask;
    const rng = mulberry32(0xC0FFEE);
    const live: EntityId[] = [];
    const factions = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim];
    const kinds = [EntityKind.Vehicle, EntityKind.Infantry, EntityKind.Vehicle, EntityKind.Building];
    const defs = [11, 12, 13, 20];

    for (let f = 0; f < 300; f++) {
      // Spawn a burst.
      const spawns = (rng() * 9) | 0;
      for (let n = 0; n < spawns; n++) {
        const pick = (rng() * 4) | 0;
        const id = store.alloc(
          kinds[pick], defs[pick], P1, factions[pick],
          rng() * 500, 0, rng() * 500, rng() * 6.283,
        );
        if (id !== 0) live.push(id);
      }
      // Kill a few.
      const kills = (rng() * 7) | 0;
      for (let n = 0; n < kills && live.length > 0; n++) {
        const at = (rng() * live.length) | 0;
        store.markDead(live[at]);
        live.splice(at, 1);
      }
      store.flushDestroyed();

      // Reshroud from scratch every frame, as `computeRenderMask` does.
      mask.hidden.clear();
      for (let a = 0; a < store.aliveCount; a++) {
        const i = store.alive[a];
        if (rng() < 0.35) mask.hidden.add(i);
      }

      const audit = frame(store, bridge);
      if (audit.misses.length > 0) {
        throw new Error(`frame ${f}: ${audit.misses.length} entities did not reach a draw slot\n` +
          describeMisses(audit));
      }
    }

    expect(bridge.missedDraws).toBe(0);
    expect(bridge.batcher.unwrittenSlots).toBe(0);
    teardown(bridge);
  });

  it('a garrisoned entity is not eligible, and is not counted as a miss', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Infantry, FACTION_ANY, makeModel(), 3);
    const id = store.alloc(EntityKind.Infantry, 3, P0, Faction.Allies, 10, 0, 10, 0);
    store.flags[store.index(id)] |= EntityFlag.Garrisoned;

    const audit = frame(store, bridge);
    expect(audit.eligible).toBe(0);
    expect(audit.misses.length).toBe(0);
    teardown(bridge);
  });
});

/* ========================================================================== */
/* The instrument itself must be able to fail                                 */
/* ========================================================================== */

describe('render visibility — the audit is not vacuous', () => {
  it('names an entity whose instance slot was released behind the bridge', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 50, 0, 50, 0);
    frame(store, bridge);

    // Free the instance out from under the binding — the "recycled slot" class.
    const batch = bridge.batcher.all[0];
    batch.free(0);

    const audit = bridge.auditNow();
    expect(audit.misses.length).toBe(1);
    expect(audit.misses[0].reason).toBe('slot-not-owned');
    expect(audit.misses[0].index).toBe(0);
    teardown(bridge);
  });

  it('names an entity the draw call never reaches', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 50, 0, 50, 0);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 60, 0, 50, 0);
    frame(store, bridge);

    for (const part of bridge.batcher.all[0].parts) part.mesh.count = 1;

    const audit = bridge.auditNow();
    expect(audit.misses.length).toBe(1);
    expect(audit.misses[0].reason).toBe('beyond-draw-count');
    teardown(bridge);
  });

  it('names an entity that falls outside the batch culling sphere', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 50, 0, 50, 0);
    frame(store, bridge);

    for (const part of bridge.batcher.all[0].parts) part.mesh.boundingSphere!.radius = 0.01;

    const audit = bridge.auditNow();
    expect(audit.misses.length).toBe(1);
    expect(audit.misses[0].reason).toBe('outside-batch-bounds');
    teardown(bridge);
  });

  it('names a structure the shader will sink below its own ground cut', () => {
    // `src/art/BuildingFactory.ts` sinks a structure by `1 - aState.y` of its
    // model height and discards everything under the ground plane. At
    // buildProgress 0 with no UnderConstruction flag, Production's rise loop —
    // which is gated on that flag — will never advance it again, so the
    // structure is alive, targetable and permanently unrasterised. Nothing at
    // the instance-slot level can see that, which is why it is checked here.
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Building, FACTION_ANY, makeModel(), 5);
    const id = store.alloc(EntityKind.Building, 5, P1, Faction.Meridian, 90, 0, 90, 0);
    const i = store.index(id);
    store.buildProgress[i] = 0;
    store.flags[i] &= ~EntityFlag.UnderConstruction;

    const audit = frame(store, bridge);
    expect(audit.misses.length).toBe(1);
    expect(audit.misses[0].reason).toBe('sunk-below-ground-cut');
    expect(bridge.sunkStructures).toBeGreaterThan(0);

    // The same progress WITH the flag is an ordinary rising structure.
    store.flags[i] |= EntityFlag.UnderConstruction;
    expect(frame(store, bridge).misses.length).toBe(0);
    teardown(bridge);
  });

  it('names an instance drawn nowhere near where the sim has it', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    const id = store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 50, 0, 50, 0);
    frame(store, bridge);

    // Move the entity without letting the bridge redraw it: the instance buffer
    // now points somewhere the player will never look.
    const i = store.index(id);
    store.posX[i] = 900;
    store.posZ[i] = 900;

    const audit = bridge.auditNow();
    expect(audit.misses.length).toBe(1);
    expect(audit.misses[0].reason).toBe('transform-drift');
    teardown(bridge);
  });

  it('counts a live instance slot that no entity wrote this frame', () => {
    const { store, bridge } = makeRig();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, makeModel(), 7);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 50, 0, 50, 0);
    frame(store, bridge);

    const batch = bridge.batcher.all[0];
    expect(batch.writtenCount).toBe(batch.liveCount);
    // Hand out a slot nobody owns; the next endFrame must notice.
    batch.alloc();
    frame(store, bridge);
    expect(batch.unwrittenSlots).toBeGreaterThan(0);
    teardown(bridge);
  });

  it('names a model that occupies a slot and draws no triangles', () => {
    // The other invisibility no slot check can see: an art module that hands
    // over an empty geometry gets a perfect instance and an empty screen.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, bridge } = makeRig();
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, {
      geometry: empty, material: new THREE.MeshStandardMaterial(),
    }, 7);
    store.alloc(EntityKind.Vehicle, 7, P1, Faction.Soviets, 10, 0, 10, 0);

    frame(store, bridge);
    expect(spy.mock.calls.some((c) => String(c[0]).includes('draw nothing'))).toBe(true);
    spy.mockRestore();
    teardown(bridge);
  });
});
