import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
  allowDevRuntimeContentScope,
  contentClosureReport,
  contentClosureEpoch,
  declareArtAssetFamily,
  declareContentDelivery,
  ensureContentClosureSeed,
  markContentClosureRevealed,
  markArtAssetFamilyFallbackReady,
  markContentProviderReady,
  plannedCampaignContentHint,
  requestContentDelivery,
  setCampaignContentHint,
  setContentClosureSeed,
  type ContentClosureSeed,
} from '../src/core/content-closure';
import { EntityKind, Faction, type BuildingDef, type UnitDef } from '../src/core/types';
import { contentDefReachableByFaction } from '../src/core/content-roster';
import {
  clearKindMeshes, FACTION_ANY, hasExactRegisteredKindMesh, hasRegisteredKindMesh,
  proveExactKindMeshBindings, registerKindMesh, resolveKindPreviewParts,
} from '../src/render/RenderBridge';
import { DEF_TABLES } from '../src/data/Defs';
import { CONTENT_TO_MODEL, SHARED_CONTENT_TO_MODEL } from '../src/art/units.system';
import { FACTION_KEYS, SHARED_KEYS } from '../src/art/buildings.system';
import { MERIDIAN_UNIT_MODELS } from '../src/art/Faction3Units';
import { MERIDIAN_STRUCTURE_MODELS } from '../src/art/Faction3Buildings';
import { RECLAIM_UNIT_MODELS } from '../src/art/Faction4Units';
import { RECLAIM_STRUCTURE_MODELS } from '../src/art/Faction4Buildings';
import {
  buildingProviderBindingsReady, unitProviderBindingsReady,
} from '../src/art/provider-readiness';
import {
  markReplayValidationProviderReady, validateReplayForStart,
} from '../src/shell/Shell';
import { REPLAY_FORMAT_VERSION, type ReplayFile } from '../src/game/Replay';
import { beginContentClosureRuntime } from '../src/game/Bootstrap';

afterEach(() => {
  setCampaignContentHint(null);
  setContentClosureSeed(null);
  clearKindMeshes();
  vi.restoreAllMocks();
});

function seed(overrides: Partial<ContentClosureSeed> = {}): void {
  setContentClosureSeed({
    mode: 'skirmish',
    factions: [1, 2],
    scenario: 'skirmish',
    map: 'temperate',
    opening: 'mcv',
    naval: false,
    ...overrides,
  });
}

function satisfyBaseProviders(factions: readonly number[]): void {
  for (const faction of factions) {
    markContentProviderReady(`art-unit/${faction}`);
    markContentProviderReady(`art-building/${faction}`);
  }
  for (const provider of ['art-wrecks', 'neutral-props', 'environment', 'vfx', 'audio']) {
    markContentProviderReady(provider);
  }
}

function satisfyProviders(factions: readonly number[]): void {
  satisfyBaseProviders(factions);
  const report = contentClosureReport();
  if (report.seed?.campaign != null) markContentProviderReady('campaign-validation');
  if (report.seed?.mode === 'replay') markContentProviderReady('replay-validation');
}

describe('generated content dependency closure', () => {
  it('generates deterministic semantic roots for a land MCV match', () => {
    seed({ factions: [2, 1, 2] });
    const report = contentClosureReport();
    const patterns = report.scopes.map((scope) => scope.pattern);

    expect(report.seed?.factions).toEqual([1, 2]);
    expect(patterns).toContain('art/unit/1/**');
    expect(patterns).toContain('art/building/2/**');
    expect(patterns).toContain('content/opening/mcv/1/units');
    expect(patterns).toContain('content/opening/mcv/2/buildings');
    expect(patterns).toContain('content/transitive/1/refinery-harvester');
    expect(patterns).toContain('content/transitive/2/emergency-mcv');
    expect(patterns).toContain('art/wreck/0/**');
    expect(patterns).toContain('art/neutral-prop/**');
    expect(patterns).toContain('pool/vfx/**');
    expect(patterns).toContain('audio/sfx/**');
    expect(patterns.some((pattern) => pattern.startsWith('art/naval/'))).toBe(false);
    expect(patterns.every((pattern) => !pattern.includes('.js') && !pattern.includes('chunk'))).toBe(true);
    expect([...patterns].sort()).toEqual(patterns);
  });

  it('adds four-faction naval reachability without falling back to a null plan', () => {
    seed({
      mode: 'replay', factions: [4, 2, 1, 3], map: 'sunder-atoll', naval: true,
      replayFormat: 3,
    });
    const report = contentClosureReport();
    expect(report.broadFallback).toBe(false);
    expect(report.seed?.mode).toBe('replay');
    expect(report.seed?.replayFormat).toBe(3);
    expect(report.scopes.some((scope) => scope.pattern === 'content/replay/header/v3')).toBe(true);
    for (const faction of [1, 2, 3, 4]) {
      expect(report.scopes.some((scope) => scope.pattern === `art/naval/${faction}/**`)).toBe(true);
    }
  });

  it('refuses an unvalidated direct ReplayFile as replay-validation provenance', () => {
    seed({ mode: 'replay', factions: [1, 2], replayFormat: REPLAY_FORMAT_VERSION });
    for (const faction of [1, 2]) {
      markContentProviderReady(`art-unit/${faction}`);
      markContentProviderReady(`art-building/${faction}`);
    }
    for (const provider of ['art-wrecks', 'neutral-props', 'environment', 'vfx', 'audio']) {
      markContentProviderReady(provider);
    }

    const valid: ReplayFile = {
      header: {
        formatVersion: REPLAY_FORMAT_VERSION,
        buildVersion: 'content-closure-test',
        mapSeed: 0x51c0de,
        simSeed: 4242,
        mapPreset: 'temperate',
        biome: 'temperate',
        art: 'noon',
        start: 'mcv',
        scenario: 'skirmish',
        localPlayer: 0,
        players: [
          {
            faction: Faction.Allies, isHuman: true,
            aiDifficulty: 0, aiPersonality: 0, credits: 10_000,
          },
          {
            faction: Faction.Soviets, isHuman: false,
            aiDifficulty: 1, aiPersonality: 0, credits: 10_000,
          },
        ],
      },
      commands: [],
      checks: [],
    };
    const malformed = {
      ...valid,
      header: { ...valid.header, players: [] },
    } as ReplayFile;

    expect(markReplayValidationProviderReady(malformed)).toBe(false);
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: 'provider/replay-validation', state: 'pending',
    }));
    expect(() => validateReplayForStart(malformed)).toThrow(/player list/);

    const validated = validateReplayForStart(valid);
    expect(validated).not.toBe(valid);
    expect(markReplayValidationProviderReady(validated)).toBe(true);
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: 'provider/replay-validation', state: 'ready',
    }));
  });

  it('republishes campaign validation after Bootstrap opens its runtime epoch', () => {
    setCampaignContentHint({
      operation: 'allies.09.made-good',
      layout: 'allies-made-good',
      reinforcementUnits: ['grizzly'],
      evaLines: ['reinforcements'],
      effectKinds: ['spawnUnits', 'eva'],
    });
    seed({
      mode: 'campaign', factions: [1], campaign: plannedCampaignContentHint(),
    });
    markContentProviderReady('campaign-validation');

    const epoch = beginContentClosureRuntime((freshEpoch) => {
      expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
        key: 'provider/campaign-validation', state: 'pending',
      }));
      markContentProviderReady('campaign-validation', freshEpoch);
    });
    satisfyBaseProviders([1]);

    expect(epoch).toBe(contentClosureEpoch());
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: 'provider/campaign-validation', state: 'ready',
    }));
    expect(markContentClosureRevealed()).toBe(true);
  });

  it('republishes exact replay validation after Bootstrap opens its runtime epoch', () => {
    const replay = validateReplayForStart({
      header: {
        formatVersion: REPLAY_FORMAT_VERSION,
        buildVersion: 'content-closure-bootstrap-test',
        mapSeed: 0x51c0de,
        simSeed: 4242,
        mapPreset: 'temperate',
        biome: 'temperate',
        art: 'noon',
        start: 'mcv',
        scenario: 'skirmish',
        localPlayer: 0,
        players: [
          {
            faction: Faction.Allies, isHuman: true,
            aiDifficulty: 0, aiPersonality: 0, credits: 10_000,
          },
          {
            faction: Faction.Soviets, isHuman: false,
            aiDifficulty: 1, aiPersonality: 0, credits: 10_000,
          },
        ],
      },
      commands: [],
      checks: [],
    });
    seed({ mode: 'replay', factions: [1, 2], replayFormat: REPLAY_FORMAT_VERSION });
    expect(markReplayValidationProviderReady(replay)).toBe(true);

    const epoch = beginContentClosureRuntime((freshEpoch) => {
      expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
        key: 'provider/replay-validation', state: 'pending',
      }));
      expect(markReplayValidationProviderReady(replay, freshEpoch)).toBe(true);
    });
    satisfyBaseProviders([1, 2]);

    expect(epoch).toBe(contentClosureEpoch());
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: 'provider/replay-validation', state: 'ready',
    }));
    expect(markContentClosureRevealed()).toBe(true);
  });

  it('unions every campaign trigger branch, including foreign reinforcements and EVA', () => {
    setCampaignContentHint({
      operation: 'allies.09.made-good',
      layout: 'allies-made-good',
      reinforcementUnits: ['grizzly', 'rclGrinder', 'grizzly'],
      evaLines: ['reinforcements', 'baseUnderAttack'],
      effectKinds: ['spawnUnits', 'eva', 'cameraMove', 'spawnUnits'],
    });
    seed({ mode: 'campaign', factions: [1, 4], campaign: plannedCampaignContentHint() });
    satisfyProviders([1, 4]);
    const report = contentClosureReport();
    const patterns = report.scopes.map((scope) => scope.pattern);

    expect(patterns).toContain('content/campaign/allies.09.made-good/layout/allies-made-good');
    expect(patterns).toContain('content/campaign/allies.09.made-good/reinforcement/rclGrinder');
    expect(patterns).toContain('content/campaign/allies.09.made-good/effect/cameraMove');
    expect(patterns).toContain('audio/eva/campaign/reinforcements');
    expect(report.deliveries.some((row) => (
      row.key === 'content/campaign/allies.09.made-good/reinforcement/rclGrinder'
      && row.state === 'ready'
    ))).toBe(true);
  });

  it('makes provider participation a non-vacuous reveal obligation', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([]);

    expect(markContentClosureRevealed()).toBe(false);
    const misses = contentClosureReport().misses;
    expect(misses).toContainEqual(expect.objectContaining({
      key: 'provider/art-unit/1', phase: 'reveal-gate', reason: 'not-ready',
    }));
    expect(misses).toContainEqual(expect.objectContaining({
      key: 'provider/art-building/1', phase: 'reveal-gate', reason: 'not-ready',
    }));
  });

  const providerMutationCases: readonly {
    label: string;
    domain: 'unit' | 'building';
    faction: Faction;
    mappingKeys: readonly string[];
  }[] = [
    {
      label: 'Allied units', domain: 'unit', faction: Faction.Allies,
      mappingKeys: [...Object.keys(CONTENT_TO_MODEL), ...Object.keys(SHARED_CONTENT_TO_MODEL)],
    },
    {
      label: 'Soviet units', domain: 'unit', faction: Faction.Soviets,
      mappingKeys: [...Object.keys(CONTENT_TO_MODEL), ...Object.keys(SHARED_CONTENT_TO_MODEL)],
    },
    {
      label: 'Meridian units', domain: 'unit', faction: Faction.Meridian,
      mappingKeys: Object.keys(MERIDIAN_UNIT_MODELS),
    },
    {
      label: 'Reclamation units', domain: 'unit', faction: Faction.Reclaim,
      mappingKeys: Object.keys(RECLAIM_UNIT_MODELS),
    },
    {
      label: 'Allied buildings', domain: 'building', faction: Faction.Allies,
      mappingKeys: [...Object.keys(FACTION_KEYS), ...Object.keys(SHARED_KEYS)],
    },
    {
      label: 'Soviet buildings', domain: 'building', faction: Faction.Soviets,
      mappingKeys: [...Object.keys(FACTION_KEYS), ...Object.keys(SHARED_KEYS)],
    },
    {
      label: 'Meridian buildings', domain: 'building', faction: Faction.Meridian,
      mappingKeys: Object.keys(MERIDIAN_STRUCTURE_MODELS),
    },
    {
      label: 'Reclamation buildings', domain: 'building', faction: Faction.Reclaim,
      mappingKeys: Object.keys(RECLAIM_STRUCTURE_MODELS),
    },
  ];

  it.each(providerMutationCases)(
    'keeps $label pending when one art-map row is omitted from unchanged defs',
    ({ domain, faction, mappingKeys }) => {
      seed({ factions: [faction] });
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial();
      const mesh = { geometry, material };
      const defs: readonly (UnitDef | BuildingDef)[] = domain === 'unit'
        ? DEF_TABLES.units
        : DEF_TABLES.buildings;
      const omittedDefId = defs.findIndex((def) => def.faction === faction);
      expect(omittedDefId).toBeGreaterThanOrEqual(0);
      const omitted = defs[omittedDefId];
      const mutatedMapping = new Set(mappingKeys);
      mutatedMapping.delete(omitted.key);

      for (let defId = 0; defId < defs.length; defId++) {
        const def = defs[defId];
        if (!contentDefReachableByFaction(def.faction, faction)) continue;
        if (!mutatedMapping.has(def.key)) continue;
        const kind = domain === 'unit' ? (def as UnitDef).kind : EntityKind.Building;
        registerKindMesh(
          kind,
          def.faction === Faction.Neutral ? faction : FACTION_ANY,
          mesh,
          defId,
        );
      }

      const omittedKind = domain === 'unit'
        ? (omitted as UnitDef).kind
        : EntityKind.Building;
      registerKindMesh(omittedKind, faction, mesh, -1);
      expect(hasRegisteredKindMesh(omittedKind, faction, omittedDefId)).toBe(true);
      expect(hasExactRegisteredKindMesh(omittedKind, faction, omittedDefId)).toBe(false);
      const ready = domain === 'unit'
        ? unitProviderBindingsReady(DEF_TABLES, faction)
        : buildingProviderBindingsReady(DEF_TABLES, faction);
      expect(ready).toBe(false);
      const providerKey = `art-${domain}/${faction}`;
      if (ready) markContentProviderReady(providerKey);
      expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
        key: `provider/${providerKey}`, state: 'pending',
      }));

      registerKindMesh(omittedKind, FACTION_ANY, mesh, omittedDefId);
      const repaired = domain === 'unit'
        ? unitProviderBindingsReady(DEF_TABLES, faction)
        : buildingProviderBindingsReady(DEF_TABLES, faction);
      expect(repaired).toBe(true);
      markContentProviderReady(providerKey);
      expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
        key: `provider/${providerKey}`, state: 'ready',
      }));
      geometry.dispose();
      material.dispose();
    },
  );

  it('publishes a procedural family only after its fallback is proven usable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    const keys = declareArtAssetFamily({
      domain: 'building', faction: 1, key: 'allied_refinery', owner: 'test',
      fallback: 'procedural structure with construction shader',
    });

    expect(keys).toEqual([
      'art/building/1/allied_refinery/lod0',
      'art/building/1/allied_refinery/lods',
      'art/building/1/allied_refinery/shadow-proxy',
      'art/building/1/allied_refinery/construction',
    ]);
    expect(markContentClosureRevealed()).toBe(false);

    seed({ factions: [1] });
    satisfyProviders([1]);
    const provenKeys = declareArtAssetFamily({
      domain: 'building', faction: 1, key: 'allied_refinery', owner: 'test',
      fallback: 'procedural structure with construction shader',
    });
    markArtAssetFamilyFallbackReady(provenKeys);
    expect(markContentClosureRevealed()).toBe(true);
    for (const key of provenKeys) {
      expect(requestContentDelivery(key, 'post-reveal-upgrade')).toBe(true);
    }
    expect(contentClosureReport().misses).toEqual([]);
  });

  it('turns a pre-reveal RenderBridge hazard fallback into a reveal failure', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);

    resolveKindPreviewParts(EntityKind.Vehicle, Faction.Allies, 917);

    expect(markContentClosureRevealed()).toBe(false);
    expect(contentClosureReport().misses).toContainEqual(expect.objectContaining({
      key: `render-binding/${EntityKind.Vehicle}/${Faction.Allies}/917`,
      phase: 'reveal-gate', reason: 'not-ready',
    }));
  });

  it('records a missing positive def while still rendering its generic fallback', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    const fallbackGeometry = new THREE.BoxGeometry(2, 2, 2);
    const fallbackMaterial = new THREE.MeshBasicMaterial();
    const wildcardGeometry = new THREE.BoxGeometry(3, 3, 3);
    const wildcardMaterial = new THREE.MeshBasicMaterial();
    const exactGeometry = new THREE.BoxGeometry(1, 1, 1);
    const exactMaterial = new THREE.MeshBasicMaterial();
    const promise = [{
      kind: EntityKind.Vehicle, faction: Faction.Allies, defId: 917,
    }] as const;
    registerKindMesh(
      EntityKind.Vehicle, Faction.Allies,
      { geometry: fallbackGeometry, material: fallbackMaterial }, -1,
    );

    expect(hasRegisteredKindMesh(EntityKind.Vehicle, Faction.Allies, 917)).toBe(true);
    expect(hasExactRegisteredKindMesh(EntityKind.Vehicle, Faction.Allies, 917)).toBe(false);
    expect(proveExactKindMeshBindings([])).toBe(false);
    expect(proveExactKindMeshBindings(promise)).toBe(false);
    expect(resolveKindPreviewParts(EntityKind.Vehicle, Faction.Allies, 917)[0]?.geometry)
      .toBe(fallbackGeometry);
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: `render-binding/${EntityKind.Vehicle}/${Faction.Allies}/917`, state: 'pending',
    }));

    // A second generic registration exercises settlement and must not clear the
    // positive-def obligation.
    registerKindMesh(
      EntityKind.Vehicle, FACTION_ANY,
      { geometry: wildcardGeometry, material: wildcardMaterial }, -1,
    );
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: `render-binding/${EntityKind.Vehicle}/${Faction.Allies}/917`, state: 'pending',
    }));
    expect(markContentClosureRevealed()).toBe(false);

    registerKindMesh(
      EntityKind.Vehicle, Faction.Allies,
      { geometry: exactGeometry, material: exactMaterial }, 917,
    );
    expect(hasExactRegisteredKindMesh(EntityKind.Vehicle, Faction.Allies, 917)).toBe(true);
    expect(proveExactKindMeshBindings(promise)).toBe(true);
    expect(contentClosureReport().deliveries).toContainEqual(expect.objectContaining({
      key: `render-binding/${EntityKind.Vehicle}/${Faction.Allies}/917`, state: 'ready',
    }));

    fallbackGeometry.dispose();
    fallbackMaterial.dispose();
    wildcardGeometry.dispose();
    wildcardMaterial.dispose();
    exactGeometry.dispose();
    exactMaterial.dispose();
  });

  it('keeps a boot miss sticky after its delivery registers and becomes ready', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    const missedKey = 'art/unit/1/late_registration/lod0';

    expect(requestContentDelivery(missedKey, 'early-render-lookup')).toBe(false);
    const keys = declareArtAssetFamily({
      domain: 'unit', faction: 1, key: 'late_registration', owner: 'late-provider',
      fallback: 'validated procedural unit',
    });
    markArtAssetFamilyFallbackReady(keys);

    expect(markContentClosureRevealed()).toBe(false);
    const report = contentClosureReport();
    expect(report.revealReady).toBe(false);
    const lateDeliveries = report.deliveries.filter((row) => keys.includes(row.key));
    expect(lateDeliveries).toHaveLength(keys.length);
    expect(lateDeliveries.every((row) => row.state === 'fallback-ready')).toBe(true);
    expect(report.misses).toContainEqual(expect.objectContaining({
      key: missedKey, phase: 'boot', reason: 'undeclared',
    }));
  });

  it('keeps a failed reveal gate rejected after pending content becomes ready until reset', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    const rejectedEpoch = contentClosureEpoch();
    const keys = declareArtAssetFamily({
      domain: 'unit', faction: 1, key: 'pending_at_reveal', owner: 'late-provider',
      fallback: 'validated procedural unit',
    });

    expect(markContentClosureRevealed()).toBe(false);
    markArtAssetFamilyFallbackReady(keys);
    const lateReport = contentClosureReport();
    const lateDeliveries = lateReport.deliveries.filter((row) => keys.includes(row.key));
    expect(lateDeliveries).toHaveLength(keys.length);
    expect(lateDeliveries.every((row) => row.state === 'fallback-ready')).toBe(true);
    expect(lateReport.revealReady).toBe(false);

    seed({ factions: [1] });
    satisfyProviders([1]);
    expect(contentClosureEpoch()).toBeGreaterThan(rejectedEpoch);
    const resetKeys = declareArtAssetFamily({
      domain: 'unit', faction: 1, key: 'pending_at_reveal', owner: 'late-provider',
      fallback: 'validated procedural unit',
    });
    markArtAssetFamilyFallbackReady(resetKeys);
    expect(contentClosureReport().revealReady).toBe(true);
    expect(markContentClosureRevealed()).toBe(true);
  });

  it('accepts a real RenderBridge registration without manufacturing hazard art', () => {
    seed({ factions: [1] });
    satisfyProviders([1]);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    registerKindMesh(EntityKind.Vehicle, FACTION_ANY, { geometry, material }, 917);

    expect(hasExactRegisteredKindMesh(EntityKind.Vehicle, Faction.Allies, 917)).toBe(true);
    expect(proveExactKindMeshBindings([{
      kind: EntityKind.Vehicle, faction: Faction.Allies, defId: 917,
    }])).toBe(true);
    resolveKindPreviewParts(EntityKind.Vehicle, Faction.Allies, 917);

    expect(markContentClosureRevealed()).toBe(true);
    expect(contentClosureReport().misses).toEqual([]);
    geometry.dispose();
    material.dispose();
  });

  it('trips on a pending critical delivery and an undeclared post-reveal request', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    declareContentDelivery({ key: 'audio/sfx/critical-cannon', owner: 'test', critical: true });

    expect(markContentClosureRevealed()).toBe(false);
    expect(() => requestContentDelivery('art/unit/1/synthetic/lod0', 'mutation-test')).toThrow(
      'undeclared post-reveal request',
    );
    expect(contentClosureReport().misses).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'audio/sfx/critical-cannon', reason: 'not-ready' }),
      expect.objectContaining({
        key: 'art/unit/1/synthetic/lod0', phase: 'post-reveal', reason: 'undeclared',
      }),
    ]));
  });

  it('rejects a development miss while retaining evidence for packaged fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    expect(markContentClosureRevealed()).toBe(true);

    expect(() => requestContentDelivery(
      'art/unit/4/reclaim_crawler/lod0', 'bad-provider',
    )).toThrow('undeclared post-reveal request');
    expect(contentClosureReport().misses.at(-1)).toEqual(expect.objectContaining({
      key: 'art/unit/4/reclaim_crawler/lod0', reason: 'outside-plan', state: 'missing',
    }));
  });

  it('admits only an explicit Cheat Engine art scope after reveal', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed({ factions: [1] });
    satisfyProviders([1]);
    expect(markContentClosureRevealed()).toBe(true);

    allowDevRuntimeContentScope(
      'art/unit/3/**',
      'development Cheat Engine requested an out-of-match faction',
    );
    const keys = declareArtAssetFamily({
      domain: 'unit', faction: 3, key: 'meridian_collector', owner: 'dev-test',
      fallback: 'validated procedural Pact unit model',
    });
    markArtAssetFamilyFallbackReady(keys);

    for (const key of keys) expect(requestContentDelivery(key, 'dev-test')).toBe(true);
    expect(contentClosureReport().misses).toEqual([]);
  });

  it('generation-guards late completion from a disposed battlefield', () => {
    seed({ factions: [1] });
    const oldEpoch = contentClosureEpoch();
    seed({ factions: [1] });
    markContentProviderReady('art-unit/1', oldEpoch);

    expect(contentClosureReport().deliveries.find(
      (row) => row.key === 'provider/art-unit/1',
    )?.state).toBe('pending');
  });

  it('installs a conservative all-faction plan for direct fixture bootstrap', () => {
    setContentClosureSeed(null);
    ensureContentClosureSeed({
      mode: 'fixture', factions: [1, 2, 3, 4], scenario: 'battle', map: 'temperate',
      opening: 'base', naval: false,
    });
    const report = contentClosureReport();
    expect(report.broadFallback).toBe(false);
    expect(report.seed?.mode).toBe('fixture');
    expect(report.deliveries.filter((row) => row.key.startsWith('provider/art-unit/')))
      .toHaveLength(4);
  });

  it('wires every asynchronous content owner to the semantic tracker', () => {
    const repo = path.resolve(__dirname, '..', '..', '..');
    const tracked = [
      'apps/game/src/art/units.system.ts',
      'apps/game/src/art/buildings.system.ts',
      'apps/game/src/art/Faction3Units.ts',
      'apps/game/src/art/Faction3Buildings.ts',
      'apps/game/src/art/Faction4Units.ts',
      'apps/game/src/art/Faction4Buildings.ts',
      'apps/game/src/world/scatter.system.ts',
      'apps/game/src/world/entity-props.system.ts',
    ];
    for (const file of tracked) {
      const source = readFileSync(path.join(repo, file), 'utf8');
      expect(source, file).toContain('declareArtAssetFamily');
      expect(source, file).toContain('requestArtAssetFamily');
      expect(source, file).toContain('markArtAssetFamilyReady');
    }
    for (const file of ['apps/game/src/vfx/vfx.system.ts', 'apps/game/src/audio/audio.system.ts']) {
      const source = readFileSync(path.join(repo, file), 'utf8');
      expect(source, file).toContain('declareContentDelivery');
      expect(source, file).toContain('markContentProviderReady');
    }

    const campaign = readFileSync(
      path.join(repo, 'apps/game/src/campaign/campaign-install.ts'), 'utf8',
    );
    expect(campaign).toContain('op.triggers.flatMap((trigger) => trigger.then)');
    expect(campaign).toContain("effect.do === 'spawnUnits'");
    expect(campaign).toContain("effect.do === 'eva'");

    const shell = readFileSync(path.join(repo, 'apps/game/src/shell/Shell.ts'), 'utf8');
    const reset = shell.indexOf('resetScenarioPlan();');
    const closure = shell.indexOf('setContentClosureSeed({', reset);
    const bootstrap = shell.indexOf('const boot: BootOptions', closure);
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(closure).toBeGreaterThan(reset);
    expect(bootstrap).toBeGreaterThan(closure);
    expect(shell).toContain('this.replay.file.header.formatVersion');
    expect(shell).toContain('file = validateReplayForStart(file);');
    expect(shell).toContain('markReplayValidationProviderReady(validatedReplay, epoch)');

    const host = readFileSync(path.join(repo, 'apps/game/src/game/Bootstrap.ts'), 'utf8');
    expect(host).toContain('beginContentClosureRuntime(options.onContentClosureRuntimeReady)');
    expect(host.indexOf('markContentClosureRevealed()')).toBeLessThan(
      host.indexOf('markBattlefieldReady()'),
    );
  });
});
