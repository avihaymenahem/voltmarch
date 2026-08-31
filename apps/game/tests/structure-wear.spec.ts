import { describe, expect, it } from 'vitest';
import { BuildTab } from '../src/core/types';
import { DecalKind } from '../src/world/Decals';
import {
  planStructureWear, requestedStructureWearMode, structureWearFingerprint,
  structureWearRole, type StructureWearSource,
} from '../src/world/structure-wear';

function source(overrides: Partial<StructureWearSource> = {}): StructureWearSource {
  return {
    id: 7,
    key: 'warFactory',
    x: 100,
    z: 140,
    yaw: 0,
    halfWidth: 8,
    halfDepth: 10,
    exitOffsetX: 0,
    exitOffsetZ: 14,
    produces: 4,
    producesTab: 1,
    power: -30,
    storage: 0,
    weapons: 0,
    buildRadius: 0,
    ...overrides,
  };
}

describe('structure wear mode', () => {
  it('ships contextual wear with exact same-build rollback and disable flags', () => {
    expect(requestedStructureWearMode('')).toBe('context');
    expect(requestedStructureWearMode('?basewear=context')).toBe('context');
    expect(requestedStructureWearMode('?basewear=legacy')).toBe('legacy');
    expect(requestedStructureWearMode('?basewear=off')).toBe('off');
    expect(requestedStructureWearMode('?basewear=typo')).toBe('context');
  });
});

describe('cause-linked structure wear planner', () => {
  it('classifies roles from real building semantics before name fallbacks', () => {
    expect(structureWearRole(source({ key: 'oreSilo', storage: 500, produces: 0, producesTab: -1 }))).toBe('economy');
    expect(structureWearRole(source())).toBe('production');
    expect(structureWearRole(source({ key: 'conyard', buildRadius: 36, produces: 0, producesTab: BuildTab.Structures }))).toBe('command');
    expect(structureWearRole(source({ key: 'mrdConclave', buildRadius: 36, produces: 0, producesTab: BuildTab.Structures }))).toBe('command');
    expect(structureWearRole(source({ key: 'rclFoundry', buildRadius: 36, produces: 0, producesTab: BuildTab.Structures }))).toBe('command');
    expect(structureWearRole(source({ key: 'reactor', produces: 0, producesTab: -1, power: 100 }))).toBe('power');
    expect(structureWearRole(source({ key: 'flakCannon', produces: 0, producesTab: -1, weapons: 1 }))).toBe('defence');
    expect(structureWearRole(source({ key: 'radar', produces: 0, producesTab: -1 }))).toBe('utility');
  });

  it('is deterministic and independent of source enumeration order', () => {
    const sources = [
      source({ id: 3, key: 'powerPlant', produces: 0, producesTab: -1, power: 100 }),
      source({ id: 2, key: 'refinery', produces: 0, producesTab: -1, storage: 4000 }),
      source({ id: 9, key: 'warFactory' }),
    ];
    const a = planStructureWear(sources, { seed: 1234, biome: 'temperate', maxMarks: 48 });
    const b = planStructureWear([...sources].reverse(), { seed: 1234, biome: 'temperate', maxMarks: 48 });
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(structureWearFingerprint(a.marks));
  });

  it('hard-caps marks and gives every source a primary cause before secondary dressing', () => {
    const sources = Array.from({ length: 12 }, (_, id) => source({ id, x: id * 20 }));
    const plan = planStructureWear(sources, { seed: 77, biome: 'desert', maxMarks: 12 });
    expect(plan.marks).toHaveLength(12);
    expect(new Set(plan.marks.map((item) => item.sourceId)).size).toBe(12);
    expect(plan.marks.every((item) => item.cause === 'egress')).toBe(true);
  });

  it('places production wear beyond the footprint and aligned with local +Z egress', () => {
    const plan = planStructureWear([source()], { seed: 19, biome: 'temperate', maxMarks: 2 });
    const egress = plan.marks.find((item) => item.cause === 'egress');
    expect(egress).toBeDefined();
    expect(egress!.z).toBeGreaterThan(150);
    expect(egress!.z - Math.hypot(egress!.halfX, egress!.halfZ)).toBeGreaterThan(150);
    expect(Math.abs(egress!.x - 100)).toBeLessThan(0.001);
    expect(Math.abs(egress!.yaw)).toBeLessThan(0.13);

    const turned = planStructureWear([source({ yaw: Math.PI / 2 })], {
      seed: 19, biome: 'temperate', maxMarks: 1,
    }).marks[0];
    expect(turned.x).toBeGreaterThan(110);
    expect(Math.abs(turned.z - 140)).toBeLessThan(0.001);
  });

  it('uses role-specific decal families instead of one random weather recipe', () => {
    const economy = planStructureWear([
      source({ key: 'refinery', storage: 4000, produces: 0, producesTab: -1 }),
    ], { seed: 5, biome: 'urban', maxMarks: 2 }).marks;
    const power = planStructureWear([
      source({ key: 'powerPlant', power: 100, produces: 0, producesTab: -1 }),
    ], { seed: 5, biome: 'temperate', maxMarks: 2 }).marks;
    const defence = planStructureWear([
      source({ key: 'flakCannon', weapons: 1, produces: 0, producesTab: -1 }),
    ], { seed: 5, biome: 'temperate', maxMarks: 2 }).marks;
    expect(economy[0].kind).toBe(DecalKind.Oil);
    expect(power[0].kind).toBe(DecalKind.Rust);
    expect(defence[0].cause).toBe('perimeter');
  });

  it('changes material response by biome without changing bounded topology', () => {
    const temperate = planStructureWear([source()], { seed: 8, biome: 'temperate', maxMarks: 2 });
    const snow = planStructureWear([source()], { seed: 8, biome: 'snow', maxMarks: 2 });
    expect(temperate.marks).toHaveLength(2);
    expect(snow.marks).toHaveLength(2);
    expect(temperate.fingerprint).not.toBe(snow.fingerprint);
    expect(snow.marks[0].kind).toBe(DecalKind.Grime);
  });

  it('returns no descriptors for a zero budget and only finite bounded descriptors otherwise', () => {
    expect(planStructureWear([source()], { seed: 1, biome: 'temperate', maxMarks: 0 }).marks).toEqual([]);
    const marks = planStructureWear([source()], { seed: 1, biome: 'desert', maxMarks: 48 }).marks;
    for (const item of marks) {
      expect([item.x, item.z, item.halfX, item.halfZ, item.yaw, item.strength].every(Number.isFinite)).toBe(true);
      expect(item.halfX).toBeGreaterThan(0);
      expect(item.halfZ).toBeGreaterThan(0);
      expect(item.strength).toBeGreaterThan(0);
      expect(item.strength).toBeLessThan(0.6);
    }
  });
});
