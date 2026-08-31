/**
 * Deterministic, cause-linked structure wear.
 *
 * AAA environment dressing reads best when every mark explains how a place is
 * used: factories scar their egress, refineries leak at service aprons, power
 * plants oxidise around maintenance sides, and defences weather at their
 * perimeter. This planner contains no renderer or world state, so WebGL and
 * WebGPU consume the exact same descriptors and tests can fingerprint them.
 */
import { Rng } from '../core/math';
import { CELL } from '../core/config';
import { DecalKind } from './Decals';
import type { BiomeName } from './Biomes';

export type StructureWearMode = 'context' | 'legacy' | 'off';
export type StructureWearRole =
  | 'economy'
  | 'production'
  | 'command'
  | 'power'
  | 'defence'
  | 'utility';

export interface StructureWearSource {
  readonly id: number;
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly exitOffsetX: number;
  readonly exitOffsetZ: number;
  readonly produces: number;
  readonly producesTab: number;
  readonly power: number;
  readonly storage: number;
  readonly weapons: number;
  readonly buildRadius: number;
}

export interface StructureWearMark {
  readonly sourceId: number;
  readonly role: StructureWearRole;
  readonly cause: 'egress' | 'service' | 'runoff' | 'perimeter';
  readonly kind: DecalKind;
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly yaw: number;
  readonly strength: number;
}

export interface StructureWearPlan {
  readonly marks: readonly StructureWearMark[];
  readonly fingerprint: number;
  readonly sources: number;
}

export interface StructureWearOptions {
  readonly seed: number;
  readonly biome: BiomeName;
  readonly maxMarks: number;
}

export function requestedStructureWearMode(search = typeof location === 'undefined' ? '' : location.search): StructureWearMode {
  const requested = new URLSearchParams(search).get('basewear');
  return requested === 'legacy' || requested === 'off' ? requested : 'context';
}

export function structureWearRole(source: StructureWearSource): StructureWearRole {
  const key = source.key.toLowerCase();
  if (source.storage > 0 || /refiner|ore|silo|depot|warehouse/.test(key)) return 'economy';
  if (source.buildRadius > 0 || /conyard|construction|command|citadel|assembly|conclave|forgeyard|foundry/.test(key)) {
    return 'command';
  }
  if (source.produces > 0 || source.producesTab >= 0 || /factory|airbase|aerodrome|shipyard|drydock|barracks|rookery|roost/.test(key)) {
    return 'production';
  }
  if (source.power > 0 || /power|reactor|generator|solar|dynamo/.test(key)) return 'power';
  if (source.weapons > 0 || /turret|cannon|coil|flak|defen|bunker|strongpoint/.test(key)) return 'defence';
  return 'utility';
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sourceSeed(seed: number, source: StructureWearSource): number {
  let mixed = (seed ^ Math.imul(source.id + 1, 0x9e3779b1) ^ hashText(source.key)) >>> 0;
  mixed ^= Math.imul(Math.round(source.x * 4), 0x85ebca6b);
  mixed ^= Math.imul(Math.round(source.z * 4), 0xc2b2ae35);
  return mixed >>> 0;
}

function toWorld(source: StructureWearSource, localX: number, localZ: number): readonly [number, number] {
  const cos = Math.cos(source.yaw);
  const sin = Math.sin(source.yaw);
  return [
    source.x + localX * cos + localZ * sin,
    source.z - localX * sin + localZ * cos,
  ];
}

function mark(
  source: StructureWearSource,
  role: StructureWearRole,
  cause: StructureWearMark['cause'],
  kind: DecalKind,
  localX: number,
  localZ: number,
  halfX: number,
  halfZ: number,
  yaw: number,
  strength: number,
): StructureWearMark {
  const [x, z] = toWorld(source, localX, localZ);
  return { sourceId: source.id, role, cause, kind, x, z, halfX, halfZ, yaw, strength };
}

function descriptorsFor(
  source: StructureWearSource,
  seed: number,
  biome: BiomeName,
): readonly StructureWearMark[] {
  const rng = new Rng(sourceSeed(seed, source));
  const role = structureWearRole(source);
  const side = rng.sign();
  const front = Math.max(source.exitOffsetZ, source.halfDepth + 2.0);
  // One half-cell diagonal plus a small apron keeps the full oriented mark,
  // rather than only its centre, beyond the owning structure's footprint.
  const clearance = CELL * Math.SQRT2 * 0.5 + 0.5;
  const outsideFront = (halfX: number, halfZ: number, requested: number): number => (
    Math.max(requested, source.halfDepth + Math.hypot(halfX, halfZ) + clearance)
  );
  const outsideSide = (halfX: number, halfZ: number): number => (
    side * (source.halfWidth + Math.hypot(halfX, halfZ) + clearance)
  );
  const dustKind = biome === 'snow' || biome === 'urban' ? DecalKind.Grime : DecalKind.Dust;
  const rustKind = biome === 'snow' ? DecalKind.Grime : DecalKind.Rust;
  const dustGain = biome === 'desert' ? 1.18 : biome === 'snow' ? 0.72 : 1;
  const rustGain = biome === 'desert' ? 0.72 : biome === 'urban' ? 1.08 : 1;
  const jitter = rng.range(-0.12, 0.12);

  switch (role) {
    case 'economy': {
      const oilRadius = rng.range(1.15, 1.75);
      const oilHalfX = oilRadius * 1.45;
      const oilHalfZ = oilRadius;
      const egressHalfX = rng.range(2.5, 3.6);
      const egressHalfZ = rng.range(5.0, 7.5);
      return [
        mark(source, role, 'service', DecalKind.Oil,
          source.exitOffsetX + side * 1.2, outsideFront(oilHalfX, oilHalfZ, front + 0.8),
          oilHalfX, oilHalfZ, source.yaw + jitter, rng.range(0.25, 0.34)),
        mark(source, role, 'egress', dustKind,
          source.exitOffsetX, outsideFront(egressHalfX, egressHalfZ, front + 3.0),
          egressHalfX, egressHalfZ, source.yaw + jitter,
          rng.range(0.19, 0.28) * dustGain),
      ];
    }
    case 'production': {
      const egressHalfX = rng.range(2.6, 4.0);
      const egressHalfZ = rng.range(5.8, 8.4);
      const serviceHalfX = rng.range(1.8, 2.8);
      const serviceHalfZ = rng.range(3.0, 4.8);
      return [
        mark(source, role, 'egress', dustKind,
          source.exitOffsetX, outsideFront(egressHalfX, egressHalfZ, front + 3.2),
          egressHalfX, egressHalfZ, source.yaw + jitter,
          rng.range(0.19, 0.29) * dustGain),
        mark(source, role, 'service', DecalKind.Grime,
          outsideSide(serviceHalfX, serviceHalfZ), rng.range(-source.halfDepth * 0.35, source.halfDepth * 0.35),
          serviceHalfX, serviceHalfZ, source.yaw + rng.range(-0.35, 0.35),
          rng.range(0.22, 0.34)),
      ];
    }
    case 'command': {
      const egressHalfX = rng.range(3.2, 4.6);
      const egressHalfZ = rng.range(5.0, 7.0);
      const serviceHalfX = rng.range(2.2, 3.2);
      const serviceHalfZ = rng.range(3.0, 4.6);
      return [
        mark(source, role, 'egress', dustKind, 0,
          outsideFront(egressHalfX, egressHalfZ, source.halfDepth + 3.5),
          egressHalfX, egressHalfZ, source.yaw + jitter,
          rng.range(0.16, 0.24) * dustGain),
        mark(source, role, 'service', DecalKind.Grime,
          outsideSide(serviceHalfX, serviceHalfZ), -source.halfDepth * 0.2,
          serviceHalfX, serviceHalfZ, source.yaw + rng.range(-0.5, 0.5),
          rng.range(0.19, 0.29)),
      ];
    }
    case 'power': {
      const runoffHalfX = rng.range(1.4, 2.2);
      const runoffHalfZ = rng.range(2.6, 4.2);
      const serviceHalfX = rng.range(2.0, 3.2);
      const serviceHalfZ = rng.range(3.3, 5.3);
      return [
        mark(source, role, 'runoff', rustKind,
          outsideSide(runoffHalfX, runoffHalfZ), rng.range(-1.0, 1.0),
          runoffHalfX, runoffHalfZ, source.yaw + rng.range(-0.25, 0.25),
          rng.range(0.27, 0.40) * rustGain),
        mark(source, role, 'service', dustKind,
          -outsideSide(serviceHalfX, serviceHalfZ), rng.range(-0.5, 1.5),
          serviceHalfX, serviceHalfZ, source.yaw + rng.range(-0.4, 0.4),
          rng.range(0.16, 0.24) * dustGain),
      ];
    }
    case 'defence': {
      const angle = rng.range(-Math.PI, Math.PI);
      const perimeterHalfX = rng.range(1.2, 2.0);
      const perimeterHalfZ = rng.range(2.2, 3.6);
      const distance = Math.hypot(source.halfWidth, source.halfDepth)
        + Math.hypot(perimeterHalfX, perimeterHalfZ) + clearance;
      return [
        mark(source, role, 'perimeter', rustKind,
          Math.sin(angle) * distance, Math.cos(angle) * distance,
          perimeterHalfX, perimeterHalfZ, source.yaw + angle,
          rng.range(0.24, 0.37) * rustGain),
      ];
    }
    default: {
      const serviceHalfX = rng.range(1.8, 2.8);
      const serviceHalfZ = rng.range(2.8, 4.5);
      return [
        mark(source, role, 'service', DecalKind.Grime,
          outsideSide(serviceHalfX, serviceHalfZ), rng.range(-1.2, 1.2),
          serviceHalfX, serviceHalfZ, source.yaw + rng.range(-0.45, 0.45),
          rng.range(0.18, 0.29)),
      ];
    }
  }
}

const ROLE_PRIORITY: Readonly<Record<StructureWearRole, number>> = {
  economy: 0,
  production: 1,
  command: 2,
  power: 3,
  defence: 4,
  utility: 5,
};

export function structureWearFingerprint(marks: readonly StructureWearMark[]): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const item of marks) {
    mix(item.sourceId);
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

export function planStructureWear(
  sources: readonly StructureWearSource[],
  options: StructureWearOptions,
): StructureWearPlan {
  const maxMarks = Math.max(0, Math.floor(options.maxMarks));
  const ordered = [...sources].sort((a, b) => {
    const roleDelta = ROLE_PRIORITY[structureWearRole(a)] - ROLE_PRIORITY[structureWearRole(b)];
    return roleDelta || a.id - b.id || a.key.localeCompare(b.key);
  });
  const candidates = ordered.map((source) => descriptorsFor(source, options.seed, options.biome));
  const marks: StructureWearMark[] = [];
  const rounds = candidates.reduce((max, row) => Math.max(max, row.length), 0);
  // Round-robin means every meaningful structure gets one readable cause before
  // any structure gets secondary dressing.
  for (let round = 0; round < rounds && marks.length < maxMarks; round++) {
    for (const row of candidates) {
      const item = row[round];
      if (item !== undefined) marks.push(item);
      if (marks.length >= maxMarks) break;
    }
  }
  return { marks, fingerprint: structureWearFingerprint(marks), sources: ordered.length };
}
