import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { EntityKind, Faction } from '../src/core/types';
import { DEF_TABLES } from '../src/data/Defs';
import { clearKindMeshes, registerKindMesh } from '../src/render/RenderBridge';
import { createCameoModelProvider } from '../src/ui/Cameos';

describe('build HUD cameos use the live render registry', () => {
  it('drops a cached procedural registration when a Meshy replacement lands', () => {
    clearKindMeshes();
    const defId = DEF_TABLES.unitByKey.get('mcv');
    expect(defId).toBeDefined();
    const material = new THREE.MeshStandardMaterial();
    const procedural = new THREE.BoxGeometry(2, 2, 2);
    const imported = new THREE.BoxGeometry(7, 3, 11);

    registerKindMesh(EntityKind.Vehicle, Faction.Allies, {
      geometry: procedural, material,
    }, defId!);
    const provider = createCameoModelProvider();
    const before = provider('mcv', Faction.Allies) as THREE.Group;
    const beforeMesh = before.children[0] as THREE.Mesh;
    expect(beforeMesh.geometry.getAttribute('position'))
      .toBe(procedural.getAttribute('position'));

    registerKindMesh(EntityKind.Vehicle, Faction.Allies, {
      geometry: imported, material,
    }, defId!, true);
    const after = provider('mcv', Faction.Allies) as THREE.Group;
    const afterMesh = after.children[0] as THREE.Mesh;
    expect(after).not.toBe(before);
    expect(afterMesh.geometry.getAttribute('position'))
      .toBe(imported.getAttribute('position'));

    clearKindMeshes();
    material.dispose();
    procedural.dispose();
    imported.dispose();
  });
});
