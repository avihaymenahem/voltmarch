import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import * as facade from '../src/core/config';
import type {
  AbilityDef,
  MapPreset,
  QualitySettings,
  SeaSpec,
  UnitPalette,
  VfxRampStop,
  WaterPalette,
} from '../src/core/config';

const directModules = import.meta.glob('../src/core/config/*.ts', { eager: true });

function canonicalConfigValue(value: unknown, seen = new Map<object, number>()): string {
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN';
    if (Object.is(value, -0)) return 'number:-0';
    return `number:${String(value)}`;
  }
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean' || typeof value === 'bigint') return `${typeof value}:${String(value)}`;
  if (typeof value === 'symbol') return `symbol:${String(value.description)}`;
  if (typeof value === 'function') return `function:${Function.prototype.toString.call(value)}`;
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

  const prior = seen.get(value);
  if (prior !== undefined) return `reference:${prior}`;
  seen.set(value, seen.size);
  if (Array.isArray(value)) {
    return `array:[${value.map((entry) => canonicalConfigValue(entry, seen)).join(',')}]`;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return `${value.constructor.name}:${Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex')}`;
  }
  if (value instanceof Map) {
    const rows = [...value].map(([key, entry]) => (
      `${canonicalConfigValue(key, seen)}=>${canonicalConfigValue(entry, seen)}`
    )).sort();
    return `map:{${rows.join(',')}}`;
  }
  if (value instanceof Set) {
    return `set:{${[...value].map((entry) => canonicalConfigValue(entry, seen)).sort().join(',')}}`;
  }
  const object = value as Record<string, unknown>;
  const fields = Object.keys(object).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalConfigValue(object[key], seen)}`
  ));
  return `${value.constructor.name}:{${fields.join(',')}}`;
}

function runtimeValueDigest(): string {
  const seen = new Map<object, number>();
  const rows = Object.keys(facade).sort().map((name) => (
    `${name}=${canonicalConfigValue(facade[name as keyof typeof facade], seen)}`
  ));
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function exportedTypeScriptSurface(): Array<{ name: string; kind: 'type' | 'value' }> {
  const configPath = path.resolve('apps/game/tsconfig.test.json');
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (parsed === undefined) throw new Error(`Unable to parse ${configPath}`);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const facadePath = path.resolve('apps/game/src/core/config.ts');
  const source = program.getSourceFile(facadePath);
  if (source === undefined) throw new Error(`Unable to load ${facadePath}`);
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(source);
  if (symbol === undefined) throw new Error('Compatibility facade has no module symbol');
  return checker.getExportsOfModule(symbol).map((exported) => {
    const target = (exported.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(exported)
      : exported;
    return {
      name: exported.name,
      kind: (target.flags & ts.SymbolFlags.Value) !== 0 ? 'value' as const : 'type' as const,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

describe('core/config compatibility facade', () => {
  it('preserves the exact 534-name value and type export surface', () => {
    const snapshot = JSON.parse(
      readFileSync(path.resolve('apps/game/tests/fixtures/config-exports.json'), 'utf8'),
    ) as Array<{ name: string; kind: 'type' | 'value' }>;
    expect(snapshot).toHaveLength(534);
    expect(exportedTypeScriptSurface()).toEqual(
      [...snapshot].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it('re-exports every runtime value with referential identity', () => {
    const direct = new Map<string, unknown>();
    for (const module of Object.values(directModules)) {
      for (const [name, value] of Object.entries(module as Record<string, unknown>)) {
        expect(direct.has(name), `duplicate direct runtime export ${name}`).toBe(false);
        direct.set(name, value);
      }
    }
    expect(Object.keys(facade).sort()).toEqual([...direct.keys()].sort());
    for (const [name, value] of direct) {
      expect(facade[name as keyof typeof facade], name).toBe(value);
    }
  });

  it('preserves the aggregate runtime value graph, not only its names', () => {
    expect(runtimeValueDigest()).toBe('449be0e0d55a3b098c5e14339d41ce095a2eea833300f307b9e6ee63c01e3625');
  });

  it('keeps representative derived relationships unchanged', () => {
    expect(facade.SIM_DT).toBe(1 / facade.SIM_HZ);
    expect(facade.MAP_SIZE).toBe(facade.CELL * facade.MAP_CELLS);
    expect(facade.MAP_CELL_COUNT).toBe(facade.MAP_CELLS * facade.MAP_CELLS);
    expect(facade.SPATIAL_DIM).toBe(Math.ceil(facade.MAP_SIZE / facade.SPATIAL_CELL));
    expect(facade.INSTANCE_BATCH_MAX_CAPACITY).toBe(facade.MAX_ENTITIES);
  });
});

// Compile-only witnesses: the compatibility facade must remain the type API.
type FacadeTypeWitnesses = [
  AbilityDef,
  MapPreset,
  QualitySettings,
  SeaSpec,
  UnitPalette,
  VfxRampStop,
  WaterPalette,
];
type ConfigFacadeMustRemainTyped = FacadeTypeWitnesses;
