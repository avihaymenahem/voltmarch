import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const manifestPath = path.join(root, 'tools/asset-cooks/chrono-miner.runtime.json');
const schemaPath = path.join(root, 'tools/runtime-asset-cook.schema.json');
const proofPath = path.join(root, 'tools/asset-cooks/chrono-miner.rejected-proof.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CookManifest;
const rejected = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as RejectedProof;

type Role = 'lod0' | 'lod1' | 'lod2' | 'shadow';

interface CookManifest {
  version: 1;
  family: string;
  runtimeKey: string;
  sourceAuthority: { authoring: string; runtimeControl: string };
  inputs: Record<Role, string>;
  inputSha256: Record<'authoring' | 'runtimeControl' | Role, string>;
  outputs: Record<Role, string> & { report: string };
  contract: {
    hullName: string;
    movingParts: string[];
    target: [number, number, number];
    lodDistances: [number, number];
    sockets: string;
  };
  budgets: {
    maxLod0Bytes: number;
    maxFamilyBytes: number;
    maxTriangles: Record<Role, number>;
  };
}

interface CookRow {
  outputBytes: number;
  outputSha256: string;
  triangles: number;
  bounds: { min: number[]; max: number[] };
  expandedGeometrySha256: string;
}

interface CookReport {
  version: 1;
  family: string;
  runtimeKey: string;
  sourceAuthority: CookManifest['sourceAuthority'];
  contract: CookManifest['contract'];
  rows: Record<Role, CookRow>;
  familyBytes: number;
}

interface RejectedProof {
  status: 'rejected';
  family: string;
  measurement: {
    control: { familyBytes: number };
    cooked: { familyBytes: number };
    delta: { familyBytesPercent: number; completeRequestWarmMedianMs: number };
  };
  decision: { promoted: boolean; rollback: string };
  inputSha256: CookManifest['inputSha256'];
  outputs: Record<Role, { sha256: string; bytes: number }>;
}

interface GlbJson {
  nodes: Array<{
    mesh?: number;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    extras?: { voltmarchCooked?: Record<string, unknown> };
  }>;
  meshes: Array<{
    primitives: Array<{ attributes: Record<string, number>; indices?: number }>;
  }>;
  accessors: Array<{ componentType: number; count: number; normalized?: boolean }>;
  materials?: Array<{ name?: string }>;
  images?: Array<{ mimeType?: string }>;
  extensionsRequired?: string[];
}

let report: CookReport;

function runCook(
  write: boolean,
  selectedManifest = 'tools/asset-cooks/chrono-miner.runtime.json',
): void {
  execFileSync(process.execPath, [
    'tools/cook-runtime-asset-family.mjs',
    '--manifest',
    selectedManifest,
    ...(write ? ['--write'] : []),
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120_000,
  });
}

function glb(file: string): { bytes: Buffer; json: GlbJson } {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0), file).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4), file).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return {
    bytes,
    json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as GlbJson,
  };
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function triangles(json: GlbJson): number {
  let total = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const accessor = json.accessors[primitive.indices ?? primitive.attributes.POSITION];
      total += accessor.count / 3;
    }
  }
  return Math.round(total);
}

beforeAll(() => {
  runCook(true);
  report = JSON.parse(
    fs.readFileSync(path.join(root, manifest.outputs.report), 'utf8'),
  ) as CookReport;
}, 120_000);

describe('the rejected static runtime asset cook proof', () => {
  it('keeps source authority intact and generates only into ignored experiment storage', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
    expect(schema.$id).toBe('https://voltmarch.local/schemas/runtime-asset-cook.v1.json');
    expect(manifest).toMatchObject({
      version: 1,
      family: 'allied-chrono-miner',
      runtimeKey: 'allied_harvester',
      contract: {
        hullName: 'Hull',
        movingParts: [],
        target: [4, 3.3, 8.6],
        lodDistances: [46, 76],
        sockets: 'procedural-authority',
      },
    });
    for (const file of [
      manifest.sourceAuthority.authoring,
      manifest.sourceAuthority.runtimeControl,
      ...Object.values(manifest.inputs),
    ]) expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    for (const file of Object.values(manifest.outputs)) {
      expect(file).toMatch(/^\.turbo\/runtime-cooks\/chrono-miner\//);
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
    expect(report.sourceAuthority).toEqual(manifest.sourceAuthority);
  });

  it('reproduces the structural result and the frozen rejection hashes', () => {
    const roles: Role[] = ['lod0', 'lod1', 'lod2', 'shadow'];
    let familyBytes = 0;
    for (const role of roles) {
      const input = glb(path.join(root, manifest.inputs[role]));
      const output = glb(path.join(root, manifest.outputs[role]));
      const row = report.rows[role];
      familyBytes += output.bytes.length;

      expect(triangles(output.json), role).toBe(triangles(input.json));
      expect(triangles(output.json), role).toBe(row.triangles);
      expect(row.triangles, role).toBeLessThanOrEqual(manifest.budgets.maxTriangles[role]);
      expect(output.bytes.length, role).toBe(rejected.outputs[role].bytes);
      expect(sha256(output.bytes), role).toBe(rejected.outputs[role].sha256);
      expect(row.expandedGeometrySha256, role).toMatch(/^[0-9a-f]{64}$/);
      expect(output.json.extensionsRequired, role).toContain('EXT_meshopt_compression');
      expect(output.json.extensionsRequired, role).not.toContain('KHR_mesh_quantization');

      const node = output.json.nodes.find((candidate) => candidate.mesh !== undefined);
      expect(node, role).toBeDefined();
      expect(node).not.toHaveProperty('matrix');
      expect(node).not.toHaveProperty('translation');
      expect(node).not.toHaveProperty('rotation');
      expect(node).not.toHaveProperty('scale');
      expect(node?.extras?.voltmarchCooked).toMatchObject({
        version: 1,
        runtimeKey: manifest.runtimeKey,
        geometryContract: 'voltmarch.imported-static.v1',
        role,
        bounds: row.bounds,
      });

      const primitive = output.json.meshes[0].primitives[0];
      for (const semantic of role === 'shadow' ? ['POSITION'] : ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        const accessor = output.json.accessors[primitive.attributes[semantic]];
        expect(accessor.componentType, `${role}:${semantic}`).toBe(5126);
        expect(accessor.normalized ?? false, `${role}:${semantic}`).toBe(false);
      }
      expect(primitive.attributes).not.toHaveProperty('TANGENT');
    }
    expect(familyBytes).toBe(report.familyBytes);
    expect(familyBytes).toBe(rejected.measurement.cooked.familyBytes);
    expect(manifest.inputSha256).toEqual(rejected.inputSha256);
  });

  it('refuses to write outside the ignored runtime-cook quarantine', () => {
    const unsafeManifest = {
      ...manifest,
      outputs: {
        ...manifest.outputs,
        lod0: 'packages/assets/game/units/allies/chrono-miner.runtime.glb',
      },
    };
    const unsafePath = '.turbo/runtime-cooks/unsafe-manifest.json';
    fs.mkdirSync(path.dirname(path.join(root, unsafePath)), { recursive: true });
    fs.writeFileSync(path.join(root, unsafePath), `${JSON.stringify(unsafeManifest, null, 2)}\n`);
    expect(() => runCook(true, unsafePath)).toThrow(/must stay under \.turbo\/runtime-cooks/);
    expect(fs.existsSync(path.join(root, unsafeManifest.outputs.lod0))).toBe(false);
  });

  it('preserves the KTX2 PBR contract and exact gameplay envelope', () => {
    const { json } = glb(path.join(root, manifest.outputs.lod0));
    expect(json.extensionsRequired).toContain('KHR_texture_basisu');
    expect(json.images).toHaveLength(3);
    expect(json.images?.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
    expect(json.materials?.map((material) => material.name)).toEqual(['Allied Chrono Miner PBR']);
    expect(report.rows.lod0.bounds).toEqual({ min: [-2, 0, -4.3], max: [2, 3.3, 4.3] });
  });

  it('regenerates byte-identically from the retained controls', () => {
    expect(() => runCook(false)).not.toThrow();
  });

  it('records the failed promotion gate and leaves no runtime or shipping-asset route', () => {
    expect(rejected).toMatchObject({
      status: 'rejected',
      decision: { promoted: false },
      measurement: {
        delta: { familyBytesPercent: 71.03, completeRequestWarmMedianMs: 226.2 },
      },
    });
    expect(rejected.decision.rollback).toContain('Meshopt GLB family remains the only imported runtime path');

    const source = fs.readFileSync(
      path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8',
    );
    expect(source).not.toContain('cooked/chrono-miner.runtime');
    expect(source).not.toContain('assetcook');
    expect(source).toContain('compressed/chrono-miner.meshopt.glb');
    expect(source).toContain('loadImportedUnitOverride');

    const registry = fs.readFileSync(path.join(root, 'apps/game/src/art/units.system.ts'), 'utf8');
    expect(registry).toContain('imported ${spec.label} rejected; using procedural fallback');

    const dist = path.join(root, 'apps/game/dist');
    if (fs.existsSync(dist)) {
      const pending = [dist];
      const builtFiles: string[] = [];
      while (pending.length > 0) {
        const directory = pending.pop()!;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) pending.push(absolute);
          else builtFiles.push(absolute);
        }
      }
      expect(builtFiles.map((file) => path.basename(file)).filter(
        (name) => name.includes('chrono-miner.runtime'),
      )).toEqual([]);
      const builtSource = builtFiles
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.readFileSync(file, 'utf8'))
        .join('\n');
      expect(builtSource).not.toContain('assetcook');
      expect(builtSource).not.toContain('cooked/chrono-miner.runtime');
    }
  });
});
