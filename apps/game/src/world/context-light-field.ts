/**
 * Bounded semantic light composition for the retained irradiance field.
 *
 * This is deliberately a tiny main-thread job. It runs once, after live urban
 * semantic anchors exist, and touches at most a few hundred of the retained
 * 64x64 texels. Sending those late descriptors through a worker would add a
 * message/clone boundary and another synchronization point for less work than
 * the transfer itself. No simulation array is read or written here.
 *
 * Packing keeps the existing RGBA16F texture and post sample:
 *   RGB       base irradiance plus bounded scene-linear context radiance
 *   A <= 1    terrain sky-visibility metadata from world warmup
 *   A > 1     1 + local-emissive mask, consumed only by the WebGPU node
 */

import { Rng } from '../core/math';
import {
  IRRADIANCE_CONTEXT_ALPHA_BASE,
  IRRADIANCE_CONTEXT_ALPHA_MAX,
  validIrradianceField,
  type IrradianceFieldUpdate,
} from '../core/irradiance-field';
import type { SemanticContextKind, SemanticContextSource } from './semantic-context';

export const CONTEXT_LIGHT_CAP = 18;
export const CONTEXT_LIGHT_MAX_RADIANCE = 0.16;
export const CONTEXT_LIGHT_ALPHA_BASE = IRRADIANCE_CONTEXT_ALPHA_BASE;
export const CONTEXT_LIGHT_ALPHA_MAX = IRRADIANCE_CONTEXT_ALPHA_MAX;

export interface ContextLightAnchor {
  readonly sourceId: number;
  readonly context: SemanticContextKind;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Scene-linear outgoing radiance at the centre. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface ContextLightPlan {
  readonly anchors: readonly ContextLightAnchor[];
  readonly fingerprint: number;
  readonly depot: number;
  readonly civilian: number;
  readonly resource: number;
}

export interface ContextLightComposition {
  /** False when the field was invalid, empty, or had already been composed. */
  readonly applied: boolean;
  readonly changedTexels: number;
  /** Inclusive retained-texture dirty rectangle; all -1 when no texel changed. */
  readonly minTexelX: number;
  readonly minTexelZ: number;
  readonly maxTexelX: number;
  readonly maxTexelZ: number;
}

const CONTEXT_ORDER: readonly SemanticContextKind[] = ['depot', 'civilian', 'resource'];

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sourceSeed(seed: number, source: SemanticContextSource): number {
  let mixed = seed ^ Math.imul(source.id + 1, 0x9e3779b1) ^ hashText(source.key);
  mixed ^= Math.imul(Math.round(source.x * 4), 0x85ebca6b);
  mixed ^= Math.imul(Math.round(source.z * 4), 0xc2b2ae35);
  return mixed >>> 0;
}

function anchorFor(source: SemanticContextSource, seed: number): ContextLightAnchor {
  const rng = new Rng(sourceSeed(seed, source));
  const forward = source.kind === 'resource' ? 0 : Math.max(1.5, source.radius * 0.28);
  const angle = source.yaw + rng.range(-0.12, 0.12);
  const x = source.x + Math.sin(angle) * forward;
  const z = source.z + Math.cos(angle) * forward;

  switch (source.kind) {
    case 'depot':
      // Warm service lighting, broad enough to catch apron and facade.
      return {
        sourceId: source.id, context: source.kind, x, z,
        radius: Math.min(24, Math.max(15, source.radius + rng.range(7, 10))),
        red: rng.range(0.092, 0.108), green: rng.range(0.051, 0.062), blue: rng.range(0.020, 0.028),
      };
    case 'civilian':
      // Restrained sodium/window spill; smaller than an industrial apron.
      return {
        sourceId: source.id, context: source.kind, x, z,
        radius: Math.min(19, Math.max(11, source.radius + rng.range(4, 7))),
        red: rng.range(0.068, 0.082), green: rng.range(0.040, 0.050), blue: rng.range(0.020, 0.027),
      };
    case 'resource':
      // Ore already has a cool emissive core, so the ground response follows it.
      return {
        sourceId: source.id, context: source.kind, x: source.x, z: source.z,
        radius: Math.min(28, Math.max(17, source.radius + rng.range(3, 6))),
        red: rng.range(0.024, 0.034), green: rng.range(0.058, 0.072), blue: rng.range(0.100, 0.120),
      };
  }
}

function anchorSortKey(seed: number, source: SemanticContextSource): number {
  return sourceSeed(seed ^ 0xa53c9e17, source);
}

/** Deterministic and enumeration-order independent, with fair family admission. */
export function planContextLights(
  sources: readonly SemanticContextSource[],
  seed: number,
  maxLights = CONTEXT_LIGHT_CAP,
): ContextLightPlan {
  const cap = Math.min(CONTEXT_LIGHT_CAP, Math.max(0, Math.floor(maxLights)));
  const families = new Map<SemanticContextKind, SemanticContextSource[]>(
    CONTEXT_ORDER.map((kind) => [kind, []]),
  );
  for (const source of sources) families.get(source.kind)!.push(source);
  for (const family of families.values()) {
    family.sort((a, b) => anchorSortKey(seed, a) - anchorSortKey(seed, b) || a.id - b.id);
  }

  const anchors: ContextLightAnchor[] = [];
  let round = 0;
  while (anchors.length < cap) {
    let admitted = 0;
    for (const kind of CONTEXT_ORDER) {
      const source = families.get(kind)![round];
      if (source === undefined || anchors.length >= cap) continue;
      anchors.push(anchorFor(source, seed));
      admitted++;
    }
    if (admitted === 0) break;
    round++;
  }

  return {
    anchors,
    fingerprint: contextLightFingerprint(anchors),
    depot: anchors.filter((anchor) => anchor.context === 'depot').length,
    civilian: anchors.filter((anchor) => anchor.context === 'civilian').length,
    resource: anchors.filter((anchor) => anchor.context === 'resource').length,
  };
}

export function contextLightFingerprint(anchors: readonly ContextLightAnchor[]): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const anchor of anchors) {
    mix(anchor.sourceId);
    mix(CONTEXT_ORDER.indexOf(anchor.context));
    mix(Math.round(anchor.x * 32));
    mix(Math.round(anchor.z * 32));
    mix(Math.round(anchor.radius * 32));
    mix(Math.round(anchor.red * 65535));
    mix(Math.round(anchor.green * 65535));
    mix(Math.round(anchor.blue * 65535));
  }
  return hash >>> 0;
}

function emptyComposition(): ContextLightComposition {
  return {
    applied: false, changedTexels: 0,
    minTexelX: -1, minTexelZ: -1, maxTexelX: -1, maxTexelZ: -1,
  };
}

/**
 * Compose once into the existing Float32 backing store. The array identity and
 * field dimensions never change; the renderer converts it into one retained
 * 32 KiB half-float upload afterward. Alpha > 1 makes repeat calls idempotent.
 */
export function composeContextLights(
  field: IrradianceFieldUpdate,
  anchors: readonly ContextLightAnchor[],
): ContextLightComposition {
  if (!validIrradianceField(field) || anchors.length === 0) return emptyComposition();
  for (let i = 3; i < field.rgba.length; i += 4) {
    if (field.rgba[i] > CONTEXT_LIGHT_ALPHA_BASE) return emptyComposition();
  }

  const texelWidth = (field.maxX - field.minX) / field.width;
  const texelDepth = (field.maxZ - field.minZ) / field.height;
  let minTexelX = field.width;
  let minTexelZ = field.height;
  let maxTexelX = -1;
  let maxTexelZ = -1;
  let changedTexels = 0;

  for (const anchor of anchors) {
    const radius = Math.max(Math.max(texelWidth, texelDepth) * 0.75, anchor.radius);
    const x0 = Math.max(0, Math.floor((anchor.x - radius - field.minX) / texelWidth));
    const z0 = Math.max(0, Math.floor((anchor.z - radius - field.minZ) / texelDepth));
    const x1 = Math.min(field.width - 1, Math.floor((anchor.x + radius - field.minX) / texelWidth));
    const z1 = Math.min(field.height - 1, Math.floor((anchor.z + radius - field.minZ) / texelDepth));
    for (let z = z0; z <= z1; z++) {
      const worldZ = field.minZ + (z + 0.5) * texelDepth;
      for (let x = x0; x <= x1; x++) {
        const worldX = field.minX + (x + 0.5) * texelWidth;
        const distance = Math.hypot(worldX - anchor.x, worldZ - anchor.z) / radius;
        if (distance >= 1) continue;
        const edge = 1 - distance;
        const falloff = edge * edge * (3 - 2 * edge);
        const o = (z * field.width + x) * 4;
        field.rgba[o] = Math.min(CONTEXT_LIGHT_MAX_RADIANCE, field.rgba[o] + anchor.red * falloff);
        field.rgba[o + 1] = Math.min(CONTEXT_LIGHT_MAX_RADIANCE, field.rgba[o + 1] + anchor.green * falloff);
        field.rgba[o + 2] = Math.min(CONTEXT_LIGHT_MAX_RADIANCE, field.rgba[o + 2] + anchor.blue * falloff);
        const priorMask = Math.max(0, field.rgba[o + 3] - CONTEXT_LIGHT_ALPHA_BASE);
        field.rgba[o + 3] = CONTEXT_LIGHT_ALPHA_BASE + Math.max(priorMask, falloff);
        if (priorMask === 0) changedTexels++;
        minTexelX = Math.min(minTexelX, x);
        minTexelZ = Math.min(minTexelZ, z);
        maxTexelX = Math.max(maxTexelX, x);
        maxTexelZ = Math.max(maxTexelZ, z);
      }
    }
  }

  if (changedTexels === 0) return emptyComposition();
  return { applied: true, changedTexels, minTexelX, minTexelZ, maxTexelX, maxTexelZ };
}
