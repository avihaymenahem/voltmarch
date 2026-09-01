/**
 * Deterministic authored ground composition for meaningful map locations.
 *
 * A depot, civilian block and ore field should not all receive the same random
 * grime. Each descriptor below names the use that caused it, stays inside its
 * authored context bounds, and consumes the existing static decal pool. The
 * planner imports no renderer or world state, so WebGL and WebGPU receive identical
 * descriptors and tests can fingerprint the complete presentation.
 *
 * This stays on the main thread intentionally: it plans at most 36 descriptors
 * from the live scenario store after the decal pool reports its remaining
 * reserve. Starting a worker and cloning those late live descriptors would cost
 * more than these few arithmetic operations and would delay world reveal.
 */

import { Rng } from '../core/math';
import { DecalKind } from './Decals';
import type { BiomeName } from './Biomes';

export type SemanticContextKind = 'depot' | 'civilian' | 'resource';
export type SemanticLandscapeContextKind = 'woodland' | 'ruin';
export type SemanticCompositionKind = SemanticContextKind | SemanticLandscapeContextKind;
export type SemanticContextCause =
  | 'service-apron'
  | 'arrival-track'
  | 'maintenance-patch'
  | 'foot-traffic'
  | 'litter-edge'
  | 'drain-runoff'
  | 'haul-apron'
  | 'haul-track'
  | 'spill-edge'
  | 'canopy-litter'
  | 'understorey-gap'
  | 'canopy-edge'
  | 'collapse-apron'
  | 'soot-fallout'
  | 'exposed-soil';

interface SemanticCompositionSourceBase {
  readonly id: number;
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /**
   * Semantic extent. Built/ruined stories settle beyond it; woodland marks
   * compose inside it because leaf litter belongs beneath the canopy.
   */
  readonly radius: number;
}

/** Existing active-place source contract, retained for API/light compatibility. */
export interface SemanticContextSource extends SemanticCompositionSourceBase {
  readonly kind: SemanticContextKind;
}

/** Cluster anchor supplied by the future non-urban scatter integration. */
export interface SemanticLandscapeContextSource extends SemanticCompositionSourceBase {
  readonly kind: SemanticLandscapeContextKind;
}

export type SemanticCompositionSource =
  | SemanticContextSource
  | SemanticLandscapeContextSource;

export interface SemanticContextMark {
  readonly sourceId: number;
  readonly context: SemanticCompositionKind;
  readonly cause: SemanticContextCause;
  readonly kind: DecalKind;
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly yaw: number;
  readonly strength: number;
}

export interface SemanticContextPlan {
  readonly marks: readonly SemanticContextMark[];
  readonly fingerprint: number;
  readonly sources: number;
  readonly depot: number;
  readonly civilian: number;
  readonly resource: number;
  readonly woodland: number;
  readonly ruin: number;
  /** Preset grammar actually used, including biome fallback resolution. */
  readonly grammar: SemanticContextPreset;
  /** Fingerprint of grammar data, independent of source locations. */
  readonly grammarFingerprint: number;
}

export interface SemanticContextOptions {
  readonly seed: number;
  readonly maxMarks: number;
  /** MAP_PRESETS key. Omission deliberately preserves the urban pilot. */
  readonly preset?: string;
  /** Used only when an unknown/missing preset needs a safe roster fallback. */
  readonly biome?: BiomeName;
}

/** Maximum authored context marks admitted on the Industrial Grid slice. */
export const SEMANTIC_CONTEXT_CAP = 36;
/** Static slots permanently protected for combat/destruction presentation. */
export const SEMANTIC_CONTEXT_PROTECTED_RESERVE = 128;

export type SemanticContextPreset =
  | 'urban'
  | 'temperate'
  | 'arid'
  | 'tropical'
  | 'snow'
  | 'coast'
  | 'atoll';

/**
 * Fixed admission ceilings for the complete shipping map roster. They only
 * divide the existing static-pool allowance; no preset can exceed the original
 * 36-mark Industrial Grid cap or touch the protected destruction reserve.
 */
export const SEMANTIC_CONTEXT_PRESET_CAPS: Readonly<Record<SemanticContextPreset, number>> = {
  urban: 36,
  temperate: 30,
  arid: 22,
  tropical: 32,
  snow: 22,
  coast: 24,
  atoll: 18,
};

export interface SemanticContextGrammar {
  readonly preset: SemanticContextPreset;
  readonly biome: BiomeName;
  readonly maxMarks: number;
  readonly familyOrder: readonly SemanticCompositionKind[];
  readonly woodlandGround: DecalKind;
  readonly woodlandEdge: DecalKind;
  readonly ruinGround: DecalKind;
  readonly ruinSoot: DecalKind;
  readonly woodlandStrength: number;
  readonly ruinStrength: number;
}

const URBAN_ORDER: readonly SemanticCompositionKind[] = [
  'depot', 'civilian', 'resource', 'woodland', 'ruin',
];
const LANDSCAPE_ORDER: readonly SemanticCompositionKind[] = [
  'woodland', 'ruin', 'depot', 'civilian', 'resource',
];

/**
 * Preset-owned composition grammar. Woodland changes with the ground material;
 * ruins keep their collapse/soot hierarchy but suppress dusty output on snow
 * and wet tropical ground. Values are deliberately restrained multiply marks.
 */
export const SEMANTIC_CONTEXT_GRAMMARS: Readonly<
  Record<SemanticContextPreset, SemanticContextGrammar>
> = {
  urban: {
    preset: 'urban', biome: 'urban', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.urban,
    familyOrder: URBAN_ORDER,
    woodlandGround: DecalKind.Grime, woodlandEdge: DecalKind.Patch,
    ruinGround: DecalKind.Gravel, ruinSoot: DecalKind.Scorch,
    woodlandStrength: 0.82, ruinStrength: 0.92,
  },
  temperate: {
    preset: 'temperate', biome: 'temperate', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.temperate,
    familyOrder: LANDSCAPE_ORDER,
    woodlandGround: DecalKind.LeafLitter, woodlandEdge: DecalKind.Grime,
    ruinGround: DecalKind.Gravel, ruinSoot: DecalKind.Scorch,
    woodlandStrength: 1.00, ruinStrength: 0.88,
  },
  arid: {
    preset: 'arid', biome: 'desert', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.arid,
    familyOrder: LANDSCAPE_ORDER,
    woodlandGround: DecalKind.Dust, woodlandEdge: DecalKind.Gravel,
    ruinGround: DecalKind.Gravel, ruinSoot: DecalKind.Scorch,
    woodlandStrength: 0.72, ruinStrength: 0.82,
  },
  tropical: {
    preset: 'tropical', biome: 'temperate', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.tropical,
    familyOrder: LANDSCAPE_ORDER,
    woodlandGround: DecalKind.LeafLitter, woodlandEdge: DecalKind.Grime,
    ruinGround: DecalKind.Grime, ruinSoot: DecalKind.Scorch,
    woodlandStrength: 1.08, ruinStrength: 0.72,
  },
  snow: {
    preset: 'snow', biome: 'snow', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.snow,
    familyOrder: LANDSCAPE_ORDER,
    woodlandGround: DecalKind.Grime, woodlandEdge: DecalKind.Patch,
    ruinGround: DecalKind.Gravel, ruinSoot: DecalKind.Grime,
    woodlandStrength: 0.66, ruinStrength: 0.64,
  },
  coast: {
    preset: 'coast', biome: 'temperate', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.coast,
    familyOrder: LANDSCAPE_ORDER,
    woodlandGround: DecalKind.LeafLitter, woodlandEdge: DecalKind.Grime,
    ruinGround: DecalKind.Gravel, ruinSoot: DecalKind.Grime,
    woodlandStrength: 0.84, ruinStrength: 0.74,
  },
  atoll: {
    preset: 'atoll', biome: 'temperate', maxMarks: SEMANTIC_CONTEXT_PRESET_CAPS.atoll,
    familyOrder: LANDSCAPE_ORDER,
    woodlandGround: DecalKind.Dust, woodlandEdge: DecalKind.Gravel,
    ruinGround: DecalKind.Gravel, ruinSoot: DecalKind.Grime,
    woodlandStrength: 0.68, ruinStrength: 0.68,
  },
};

/**
 * Exact admission budget against a live bounded pool. This function is shared
 * with tests so preserving the combat reserve is arithmetic, not convention.
 */
export function semanticContextBudget(
  capacity: number,
  live: number,
  protectedReserve = SEMANTIC_CONTEXT_PROTECTED_RESERVE,
  cap = SEMANTIC_CONTEXT_CAP,
): number {
  const usable = Math.floor(capacity) - Math.max(0, Math.floor(live))
    - Math.max(0, Math.floor(protectedReserve));
  return Math.min(Math.max(0, Math.floor(cap)), Math.max(0, usable));
}

/** Classify only strong semantic names; unknown structures get no story. */
export function semanticContextKind(key: string): SemanticContextKind | null {
  const value = key.toLowerCase();
  if (/oremine|ore-mine|resource|mineral/.test(value)) return 'resource';
  if (/^civ|civilian|apartment|hospital|oil.?derrick/.test(value)) return 'civilian';
  if (/repair.?depot|service.?depot|patch.?yard|solar.?infirmary|mrd.?depot|rcl.?depot/.test(value)) {
    return 'depot';
  }
  return null;
}

/** Classify clustered landscape anchors without changing the active-place API. */
export function semanticLandscapeContextKind(key: string): SemanticLandscapeContextKind | null {
  const value = key.toLowerCase();
  if (/wreck.?field|ruin.?field|rubble.?field|battle.?field|destroyed.?site/.test(value)) {
    return 'ruin';
  }
  if (/woodland|forest|grove|copse|canopy|tree.?cluster|pine.?cluster|palm.?cluster/.test(value)) {
    return 'woodland';
  }
  return null;
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sourceSeed(seed: number, source: SemanticCompositionSource): number {
  let mixed = (seed ^ Math.imul(source.id + 1, 0x9e3779b1) ^ hashText(source.key)) >>> 0;
  mixed ^= Math.imul(Math.round(source.x * 4), 0x85ebca6b);
  mixed ^= Math.imul(Math.round(source.z * 4), 0xc2b2ae35);
  return mixed >>> 0;
}

/** Resolve a roster grammar without importing scenario config into the planner. */
export function semanticContextGrammar(
  preset: string | null | undefined,
  biome: BiomeName = 'urban',
): SemanticContextGrammar {
  const key = preset?.toLowerCase() as SemanticContextPreset | undefined;
  if (key !== undefined && Object.prototype.hasOwnProperty.call(SEMANTIC_CONTEXT_GRAMMARS, key)) {
    return SEMANTIC_CONTEXT_GRAMMARS[key];
  }
  if (biome === 'desert') return SEMANTIC_CONTEXT_GRAMMARS.arid;
  if (biome === 'snow') return SEMANTIC_CONTEXT_GRAMMARS.snow;
  if (biome === 'temperate') return SEMANTIC_CONTEXT_GRAMMARS.temperate;
  return SEMANTIC_CONTEXT_GRAMMARS.urban;
}

/** Stable config identity: fixed map grammar changes become review-visible. */
export function semanticContextGrammarFingerprint(grammar: SemanticContextGrammar): number {
  let hash = hashText(`${grammar.preset}:${grammar.biome}`);
  const mix = (value: number): void => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  mix(grammar.maxMarks);
  for (const kind of grammar.familyOrder) mix(CONTEXT_PRIORITY[kind]);
  mix(grammar.woodlandGround);
  mix(grammar.woodlandEdge);
  mix(grammar.ruinGround);
  mix(grammar.ruinSoot);
  mix(Math.round(grammar.woodlandStrength * 1000));
  mix(Math.round(grammar.ruinStrength * 1000));
  return hash >>> 0;
}

function toWorld(
  source: SemanticCompositionSource, localX: number, localZ: number,
): readonly [number, number] {
  const cos = Math.cos(source.yaw);
  const sin = Math.sin(source.yaw);
  return [
    source.x + localX * cos + localZ * sin,
    source.z - localX * sin + localZ * cos,
  ];
}

function mark(
  source: SemanticCompositionSource,
  cause: SemanticContextCause,
  kind: DecalKind,
  localX: number,
  localZ: number,
  halfX: number,
  halfZ: number,
  yaw: number,
  strength: number,
): SemanticContextMark {
  const [x, z] = toWorld(source, localX, localZ);
  return {
    sourceId: source.id,
    context: source.kind,
    cause,
    kind,
    x,
    z,
    halfX,
    halfZ,
    yaw,
    strength,
  };
}

function outside(source: SemanticCompositionSource, halfX: number, halfZ: number, extra = 0): number {
  return Math.max(0, source.radius) + Math.hypot(halfX, halfZ) + 0.75 + extra;
}

function descriptorsFor(
  source: SemanticCompositionSource,
  seed: number,
  grammar: SemanticContextGrammar,
): readonly SemanticContextMark[] {
  const rng = new Rng(sourceSeed(seed, source));
  const side = rng.sign();
  const jitter = rng.range(-0.12, 0.12);

  if (source.kind === 'woodland') {
    // Three broad, overlapping-but-not-concentric shapes describe a canopy
    // floor without filling the cluster. Their complete bounds stay inside a
    // normal source extent, leaving negative space for visible terrain.
    const extent = Math.max(0, source.radius);
    // A single tree is not a woodland context. The integration should cluster
    // first; refusing undersized anchors avoids turning every trunk into three
    // tiny stamps and protects the fixed pool budget.
    if (extent < 3.5) return [];
    const primaryX = extent * rng.range(0.28, 0.34);
    const primaryZ = extent * rng.range(0.17, 0.23);
    const gapX = extent * rng.range(0.13, 0.18);
    const gapZ = extent * rng.range(0.24, 0.30);
    const edgeX = extent * rng.range(0.16, 0.22);
    const edgeZ = extent * rng.range(0.12, 0.17);
    return [
      mark(source, 'canopy-litter', grammar.woodlandGround,
        -side * extent * 0.10, extent * rng.range(-0.08, 0.08),
        primaryX, primaryZ, source.yaw + jitter,
        rng.range(0.18, 0.27) * grammar.woodlandStrength),
      mark(source, 'understorey-gap', grammar.woodlandEdge,
        side * extent * 0.28, -extent * 0.18,
        gapX, gapZ, source.yaw + side * rng.range(0.32, 0.58),
        rng.range(0.13, 0.20) * grammar.woodlandStrength),
      mark(source, 'canopy-edge', grammar.woodlandGround,
        -side * extent * 0.48, extent * 0.12,
        edgeX, edgeZ, source.yaw - side * rng.range(0.20, 0.42),
        rng.range(0.15, 0.23) * grammar.woodlandStrength),
    ];
  }

  if (source.kind === 'ruin') {
    const apronX = rng.range(3.2, 4.8);
    const apronZ = rng.range(4.8, 6.8);
    const sootX = rng.range(1.8, 2.8);
    const sootZ = rng.range(3.2, 4.8);
    const soilX = rng.range(2.2, 3.4);
    const soilZ = rng.range(3.6, 5.4);
    return [
      mark(source, 'collapse-apron', grammar.ruinGround, 0,
        outside(source, apronX, apronZ, 0.4), apronX, apronZ,
        source.yaw + jitter, rng.range(0.22, 0.31) * grammar.ruinStrength),
      mark(source, 'soot-fallout', grammar.ruinSoot,
        side * outside(source, sootX, sootZ), rng.range(-1.2, 1.2),
        sootX, sootZ, source.yaw + side * rng.range(0.28, 0.55),
        rng.range(0.17, 0.25) * grammar.ruinStrength),
      mark(source, 'exposed-soil', grammar.ruinGround,
        -side * outside(source, soilX, soilZ, 0.6), rng.range(-1.8, 1.8),
        soilX, soilZ, source.yaw - side * rng.range(0.20, 0.48),
        rng.range(0.16, 0.24) * grammar.ruinStrength),
    ];
  }

  if (source.kind === 'depot') {
    const apronX = rng.range(3.4, 4.6);
    const apronZ = rng.range(5.8, 7.4);
    const apronD = outside(source, apronX, apronZ, 0.8);
    const trackD = outside(source, 0.16, 4.8, 1.8);
    return [
      mark(source, 'service-apron', DecalKind.Gravel, 0, apronD,
        apronX, apronZ, source.yaw + jitter, rng.range(0.22, 0.31)),
      mark(source, 'arrival-track', DecalKind.Tyre, -1.15, trackD,
        0.16, 4.8, source.yaw + jitter * 0.4, rng.range(0.48, 0.62)),
      mark(source, 'arrival-track', DecalKind.Tyre, 1.15, trackD,
        0.16, 4.8, source.yaw + jitter * 0.4, rng.range(0.48, 0.62)),
      mark(source, 'maintenance-patch', DecalKind.Patch,
        side * outside(source, 2.1, 3.4), rng.range(-1.0, 1.0),
        2.1, 3.4, source.yaw + side * rng.range(0.25, 0.48), rng.range(0.20, 0.29)),
    ];
  }

  if (source.kind === 'civilian') {
    const trafficX = rng.range(2.2, 3.1);
    const trafficZ = rng.range(3.8, 5.5);
    return [
      mark(source, 'foot-traffic', DecalKind.Patch, 0,
        outside(source, trafficX, trafficZ, 0.3), trafficX, trafficZ,
        source.yaw + jitter, rng.range(0.16, 0.23)),
      mark(source, 'litter-edge', DecalKind.PaperLitter,
        side * outside(source, 1.8, 3.0), rng.range(-1.4, 1.4),
        1.8, 3.0, source.yaw + side * rng.range(0.34, 0.62), rng.range(0.24, 0.34)),
      mark(source, 'drain-runoff', DecalKind.Grime,
        -side * outside(source, 1.25, 3.8), rng.range(-1.0, 1.0),
        1.25, 3.8, source.yaw + rng.range(-0.22, 0.22), rng.range(0.18, 0.27)),
    ];
  }

  const apronX = rng.range(4.0, 5.4);
  const apronZ = rng.range(7.0, 9.2);
  const apronD = outside(source, apronX, apronZ, 0.5);
  const trackD = outside(source, 0.16, 5.8, 1.2);
  return [
    mark(source, 'haul-apron', DecalKind.Gravel, 0, apronD,
      apronX, apronZ, source.yaw + jitter, rng.range(0.23, 0.33)),
    mark(source, 'haul-track', DecalKind.Tyre, -1.25, trackD,
      0.16, 5.8, source.yaw + jitter * 0.35, rng.range(0.46, 0.60)),
    mark(source, 'haul-track', DecalKind.Tyre, 1.25, trackD,
      0.16, 5.8, source.yaw + jitter * 0.35, rng.range(0.46, 0.60)),
    mark(source, 'spill-edge', DecalKind.Dust,
      side * outside(source, 2.5, 4.4), rng.range(-2.0, 2.0),
      2.5, 4.4, source.yaw + side * rng.range(0.25, 0.55), rng.range(0.18, 0.27)),
  ];
}

const CONTEXT_PRIORITY: Readonly<Record<SemanticCompositionKind, number>> = {
  depot: 0,
  civilian: 1,
  resource: 2,
  woodland: 3,
  ruin: 4,
};

export function semanticContextFingerprint(marks: readonly SemanticContextMark[]): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const item of marks) {
    mix(item.sourceId);
    mix(CONTEXT_PRIORITY[item.context]);
    mix(item.kind);
    mix(Math.round(item.x * 1000));
    mix(Math.round(item.z * 1000));
    mix(Math.round(item.halfX * 1000));
    mix(Math.round(item.halfZ * 1000));
    mix(Math.round(item.yaw * 1000));
    mix(Math.round(item.strength * 1000));
  }
  return hash >>> 0;
}

export function planSemanticContexts(
  sources: readonly SemanticCompositionSource[],
  options: SemanticContextOptions,
): SemanticContextPlan {
  const grammar = semanticContextGrammar(options.preset, options.biome);
  const maxMarks = Math.min(grammar.maxMarks, Math.max(0, Math.floor(options.maxMarks)));
  const groups = grammar.familyOrder.map((kind) => (
    sources.filter((source) => source.kind === kind).sort((a, b) => (
      a.id - b.id || a.key.localeCompare(b.key)
    ))
  ));
  // Interleave context families before descriptor rounds. If the live pool is
  // nearly at its protected reserve, each admitted family gets a defining mark
  // before a dense district/forest consumes secondary detail slots.
  const ordered: SemanticCompositionSource[] = [];
  const groupLength = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let i = 0; i < groupLength; i++) {
    for (const group of groups) {
      const source = group[i];
      if (source !== undefined) ordered.push(source);
    }
  }
  const rows = ordered.map((source) => descriptorsFor(source, options.seed, grammar));
  const marks: SemanticContextMark[] = [];
  const rounds = rows.reduce((max, row) => Math.max(max, row.length), 0);
  // Every location gets its defining primary story before any receives a
  // secondary detail. Dense apartment districts cannot starve ore/depot cues.
  for (let round = 0; round < rounds && marks.length < maxMarks; round++) {
    for (const row of rows) {
      const item = row[round];
      if (item !== undefined) marks.push(item);
      if (marks.length >= maxMarks) break;
    }
  }
  const count = (kind: SemanticCompositionKind): number => (
    ordered.filter((source) => source.kind === kind).length
  );
  return {
    marks,
    fingerprint: semanticContextFingerprint(marks),
    sources: ordered.length,
    depot: count('depot'),
    civilian: count('civilian'),
    resource: count('resource'),
    woodland: count('woodland'),
    ruin: count('ruin'),
    grammar: grammar.preset,
    grammarFingerprint: semanticContextGrammarFingerprint(grammar),
  };
}
