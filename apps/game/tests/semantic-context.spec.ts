import { describe, expect, it } from 'vitest';

import { DECAL_POOL_STATIC } from '../src/core/config';
import { DecalKind } from '../src/world/Decals';
import {
  SEMANTIC_CONTEXT_CAP,
  SEMANTIC_CONTEXT_GRAMMARS,
  SEMANTIC_CONTEXT_PRESET_CAPS,
  SEMANTIC_CONTEXT_PROTECTED_RESERVE,
  planSemanticContexts,
  semanticContextBudget,
  semanticContextFingerprint,
  semanticContextGrammar,
  semanticContextGrammarFingerprint,
  semanticContextKind,
  semanticLandscapeContextKind,
  type SemanticCompositionSource,
  type SemanticContextSource,
  type SemanticLandscapeContextSource,
} from '../src/world/semantic-context';

function source(overrides: Partial<SemanticContextSource> = {}): SemanticContextSource {
  return {
    id: 1,
    kind: 'depot',
    key: 'repairDepot',
    x: 120,
    z: 180,
    yaw: 0,
    radius: 10,
    ...overrides,
  };
}

const SOURCES: readonly SemanticContextSource[] = [
  source(),
  source({ id: 7, kind: 'civilian', key: 'civApartments', x: 240, z: 220, radius: 8 }),
  source({ id: 0x40000000, kind: 'resource', key: 'ore-field-0', x: 330, z: 310, radius: 22 }),
];

function landscapeSource(
  overrides: Partial<SemanticLandscapeContextSource> = {},
): SemanticLandscapeContextSource {
  return {
    id: 40,
    kind: 'woodland',
    key: 'temperate-woodland-0',
    x: 160,
    z: 140,
    yaw: 0.35,
    radius: 16,
    ...overrides,
  };
}

const LANDSCAPE_SOURCES: readonly SemanticLandscapeContextSource[] = [
  landscapeSource(),
  landscapeSource({
    id: 41, kind: 'ruin', key: 'wreck-field-0', x: 280, z: 190, yaw: -0.4, radius: 9,
  }),
];

describe('semantic context classification', () => {
  it('recognises only the authored depot/civilian/resource families', () => {
    expect(semanticContextKind('repairDepot')).toBe('depot');
    expect(semanticContextKind('rclPatchYard')).toBe('depot');
    expect(semanticContextKind('civApartments')).toBe('civilian');
    expect(semanticContextKind('civHospital')).toBe('civilian');
    expect(semanticContextKind('civOreMine')).toBe('resource');
    expect(semanticContextKind('warFactory')).toBeNull();
  });

  it('recognises clustered landscape names without widening active-place classification', () => {
    expect(semanticLandscapeContextKind('north-woodland-cluster')).toBe('woodland');
    expect(semanticLandscapeContextKind('pineCluster-4')).toBe('woodland');
    expect(semanticLandscapeContextKind('old-wreck-field')).toBe('ruin');
    expect(semanticLandscapeContextKind('destroyedSite-east')).toBe('ruin');
    expect(semanticLandscapeContextKind('tree')).toBeNull();
    expect(semanticLandscapeContextKind('vehicle-wreck')).toBeNull();
    expect(semanticContextKind('north-woodland-cluster')).toBeNull();
  });
});

describe('Industrial Grid semantic context planner', () => {
  it('is deterministic and independent of source enumeration order', () => {
    const a = planSemanticContexts(SOURCES, { seed: 0x1d0c17, maxMarks: 36 });
    const b = planSemanticContexts([...SOURCES].reverse(), { seed: 0x1d0c17, maxMarks: 36 });
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(semanticContextFingerprint(a.marks));
    expect(a.sources).toBe(3);
    expect([a.depot, a.civilian, a.resource]).toEqual([1, 1, 1]);
  });

  it('spends a tight pool fairly across all three context families', () => {
    const plan = planSemanticContexts([
      ...Array.from({ length: 8 }, (_, id) => source({ id: 20 + id, kind: 'civilian', key: `civ-${id}` })),
      ...SOURCES,
    ], { seed: 8, maxMarks: 3 });
    expect(plan.marks).toHaveLength(3);
    expect(new Set(plan.marks.map((mark) => mark.context))).toEqual(
      new Set(['depot', 'civilian', 'resource']),
    );
  });

  it('uses cause-linked elongated compositions beyond every owning radius', () => {
    const plan = planSemanticContexts(SOURCES, { seed: 17, maxMarks: 36 });
    const byId = new Map(SOURCES.map((item) => [item.id, item]));
    for (const mark of plan.marks) {
      const owner = byId.get(mark.sourceId)!;
      const distance = Math.hypot(mark.x - owner.x, mark.z - owner.z);
      expect(distance - Math.hypot(mark.halfX, mark.halfZ)).toBeGreaterThanOrEqual(owner.radius + 0.74);
      expect(mark.halfX).not.toBeCloseTo(mark.halfZ, 3);
      expect(mark.strength).toBeGreaterThan(0.1);
      expect(mark.strength).toBeLessThan(0.7);
    }
    expect(plan.marks.find((mark) => mark.context === 'depot')?.kind).toBe(DecalKind.Gravel);
    expect(plan.marks.find((mark) => mark.context === 'civilian')?.kind).toBe(DecalKind.Patch);
    expect(plan.marks.find((mark) => mark.context === 'resource')?.kind).toBe(DecalKind.Gravel);
  });

  it('hard-caps descriptors and returns no work for a zero budget', () => {
    expect(planSemanticContexts(SOURCES, { seed: 1, maxMarks: 0 }).marks).toEqual([]);
    const plan = planSemanticContexts(SOURCES, { seed: 1, maxMarks: 5 });
    expect(plan.marks).toHaveLength(5);
  });

  it('preserves the original pilot when grammar options are omitted', () => {
    const legacy = planSemanticContexts(SOURCES, { seed: 0x1d0c17, maxMarks: 36 });
    const explicit = planSemanticContexts(SOURCES, {
      seed: 0x1d0c17, maxMarks: 36, preset: 'urban', biome: 'urban',
    });
    expect(legacy.marks).toEqual(explicit.marks);
    expect(legacy.fingerprint).toBe(explicit.fingerprint);
    expect([legacy.woodland, legacy.ruin]).toEqual([0, 0]);
  });
});

describe('non-urban semantic composition grammar', () => {
  it('owns an explicit bounded grammar for every non-urban map preset', () => {
    expect(SEMANTIC_CONTEXT_PRESET_CAPS).toEqual({
      urban: 36,
      temperate: 30,
      arid: 22,
      tropical: 32,
      snow: 22,
      coast: 24,
      atoll: 18,
    });
    for (const [preset, grammar] of Object.entries(SEMANTIC_CONTEXT_GRAMMARS)) {
      expect(grammar.preset).toBe(preset);
      expect(grammar.maxMarks).toBe(SEMANTIC_CONTEXT_PRESET_CAPS[grammar.preset]);
      expect(grammar.maxMarks).toBeLessThanOrEqual(SEMANTIC_CONTEXT_CAP);
      expect(semanticContextGrammarFingerprint(grammar)).not.toBe(0);
    }
    expect(semanticContextGrammar('unknown', 'desert').preset).toBe('arid');
    expect(semanticContextGrammar(undefined, 'snow').preset).toBe('snow');
    // Omission is the compatibility path used by the existing urban caller.
    expect(semanticContextGrammar(undefined).preset).toBe('urban');
  });

  it('is deterministic, enumeration independent and fair to both landscape families', () => {
    const options = { seed: 0x7e44a1, maxMarks: 6, preset: 'temperate', biome: 'temperate' } as const;
    const a = planSemanticContexts(LANDSCAPE_SOURCES, options);
    const b = planSemanticContexts([...LANDSCAPE_SOURCES].reverse(), options);
    expect(a).toEqual(b);
    expect([a.woodland, a.ruin]).toEqual([1, 1]);
    expect(new Set(a.marks.slice(0, 2).map((mark) => mark.context))).toEqual(
      new Set(['woodland', 'ruin']),
    );
  });

  it('keeps canopy marks within woodland extents and ruin marks outside wreck silhouettes', () => {
    const plan = planSemanticContexts(LANDSCAPE_SOURCES, {
      seed: 17, maxMarks: 12, preset: 'temperate', biome: 'temperate',
    });
    const byId = new Map(LANDSCAPE_SOURCES.map((item) => [item.id, item]));
    for (const mark of plan.marks) {
      const owner = byId.get(mark.sourceId)!;
      const distance = Math.hypot(mark.x - owner.x, mark.z - owner.z);
      const bound = Math.hypot(mark.halfX, mark.halfZ);
      if (mark.context === 'woodland') {
        expect(distance + bound).toBeLessThan(owner.radius);
      } else {
        expect(distance - bound).toBeGreaterThanOrEqual(owner.radius + 0.74);
      }
      expect(mark.halfX).not.toBeCloseTo(mark.halfZ, 3);
      expect(mark.strength).toBeGreaterThan(0.08);
      expect(mark.strength).toBeLessThan(0.4);
    }
    expect(planSemanticContexts([
      landscapeSource({ radius: 2, key: 'single-tree-not-a-cluster' }),
    ], {
      seed: 17, maxMarks: 3, preset: 'temperate', biome: 'temperate',
    }).marks).toEqual([]);
  });

  it('clamps oversized requests to each fixed preset ceiling', () => {
    const many: SemanticCompositionSource[] = Array.from({ length: 40 }, (_, id) => (
      landscapeSource({
        id: 100 + id,
        kind: id % 2 === 0 ? 'woodland' : 'ruin',
        key: id % 2 === 0 ? `woodland-${id}` : `wreck-field-${id}`,
        x: 30 + id * 4,
        z: 80 + id * 3,
      })
    ));
    for (const preset of ['temperate', 'arid', 'tropical', 'snow', 'coast', 'atoll'] as const) {
      const plan = planSemanticContexts(many, { seed: 91, maxMarks: 999, preset });
      expect(plan.marks).toHaveLength(SEMANTIC_CONTEXT_PRESET_CAPS[preset]);
    }
  });

  it('locks grammar and representative plan fingerprints for the full roster', () => {
    const fingerprints = Object.fromEntries(
      (['urban', 'temperate', 'arid', 'tropical', 'snow', 'coast', 'atoll'] as const).map((preset) => {
        const plan = planSemanticContexts(LANDSCAPE_SOURCES, { seed: 0x6a09e667, maxMarks: 6, preset });
        return [preset, [plan.grammarFingerprint, plan.fingerprint]];
      }),
    );
    expect(fingerprints).toEqual({
      urban: [662111986, 3273445274],
      temperate: [4010434920, 2729034536],
      arid: [3045575233, 3973923905],
      tropical: [588925861, 2381132583],
      snow: [2065724906, 2701194202],
      coast: [128547193, 1422481270],
      atoll: [4247798649, 4281949901],
    });
  });
});

describe('semantic context pool reserve', () => {
  it('never admits marks from the protected combat/destruction reserve', () => {
    expect(semanticContextBudget(DECAL_POOL_STATIC, 0)).toBe(SEMANTIC_CONTEXT_CAP);
    expect(semanticContextBudget(DECAL_POOL_STATIC, 240)).toBe(16);
    expect(semanticContextBudget(DECAL_POOL_STATIC, 256)).toBe(0);
    expect(semanticContextBudget(DECAL_POOL_STATIC, 999)).toBe(0);
    for (let live = 0; live <= DECAL_POOL_STATIC; live++) {
      const admitted = semanticContextBudget(DECAL_POOL_STATIC, live);
      if (live <= DECAL_POOL_STATIC - SEMANTIC_CONTEXT_PROTECTED_RESERVE) {
        expect(live + admitted).toBeLessThanOrEqual(
          DECAL_POOL_STATIC - SEMANTIC_CONTEXT_PROTECTED_RESERVE,
        );
      } else {
        expect(admitted).toBe(0);
      }
    }
  });
});
