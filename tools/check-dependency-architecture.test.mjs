import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ALLOWED_GAME_LAYER_EDGES,
  cyclicComponents,
  gameDependencyEdges,
  layerPolicyProblems,
  newCyclicComponents,
  runDependencyArchitecture,
  workspaceDependencyGraph,
} from './check-dependency-architecture.mjs';

test('cycle detection is deterministic and freezes additions, not improvements', () => {
  const graph = new Map([
    ['d', ['d']],
    ['c', ['a']],
    ['b', ['c']],
    ['a', ['b']],
  ]);
  assert.deepEqual(cyclicComponents(graph), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(newCyclicComponents([['a', 'b']], [['a', 'b', 'c']]), []);
  assert.deepEqual(newCyclicComponents([['a', 'b', 'x']], [['a', 'b', 'c']]), [['a', 'b', 'x']]);
});

test('layer policy is sorted, unique and categorized', () => {
  assert.deepEqual(layerPolicyProblems(), []);
  const keys = ALLOWED_GAME_LAYER_EDGES.map(([from, to]) => `${from}\0${to}`);
  assert.deepEqual(keys, [...new Set(keys)].sort());
});

test('AST scan resolves imports and static Vite globs with honest loading classification', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'voltmarch-deps-'));
  try {
    mkdirSync(path.join(fixture, 'a'), { recursive: true });
    mkdirSync(path.join(fixture, 'b'), { recursive: true });
    for (const name of ['dynamic', 'equals', 'export-runtime', 'export-type', 'import-type', 'named-type', 'require', 'static']) {
      writeFileSync(path.join(fixture, 'b', `${name}.ts`), 'export type T = string; export const value = 1;\n');
    }
    mkdirSync(path.join(fixture, 'b', 'nested'), { recursive: true });
    writeFileSync(path.join(fixture, 'b', 'root.system.ts'), 'export default {};\n');
    writeFileSync(path.join(fixture, 'b', 'nested', 'kept.system.ts'), 'export default {};\n');
    writeFileSync(path.join(fixture, 'b', 'nested', 'excluded.system.ts'), 'export default {};\n');
    writeFileSync(path.join(fixture, 'a', 'index.ts'), `
      import { value } from '../b/static';
      import { type T } from '../b/named-type';
      import equal = require('../b/equals');
      export { value as exported } from '../b/export-runtime';
      export { type T as ExportedT } from '../b/export-type';
      type Imported = import('../b/import-type').T;
      void import('../b/dynamic');
      require('../b/require');
      import.meta.glob(['../b/**/*.system.ts', '!../b/**/excluded.system.ts'], {
        eager: true,
        import: 'default',
        query: '?raw',
      });
      import.meta.glob('../b/nested/*.system.ts');
      export { value, equal };
      export type { Imported };
    `);

    const edges = gameDependencyEdges(fixture);
    const observed = edges.map(({ to, kind, loading }) => [to, kind, loading ?? 'direct']);
    assert.deepEqual(observed, [
      ['b/dynamic.ts', 'runtime', 'direct'],
      ['b/equals.ts', 'runtime', 'direct'],
      ['b/export-runtime.ts', 'runtime', 'direct'],
      ['b/export-type.ts', 'type', 'direct'],
      ['b/import-type.ts', 'type', 'direct'],
      ['b/named-type.ts', 'type', 'direct'],
      ['b/nested/excluded.system.ts', 'runtime', 'glob-lazy'],
      ['b/nested/kept.system.ts', 'runtime', 'glob-eager'],
      ['b/nested/kept.system.ts', 'runtime', 'glob-lazy'],
      ['b/require.ts', 'runtime', 'direct'],
      ['b/root.system.ts', 'runtime', 'glob-eager'],
      ['b/static.ts', 'runtime', 'direct'],
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('AST scan fails closed on computed Vite glob patterns and eager options', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'voltmarch-glob-static-'));
  try {
    mkdirSync(path.join(fixture, 'a'), { recursive: true });
    writeFileSync(path.join(fixture, 'a', 'index.ts'), "const pattern = './*.ts'; import.meta.glob(pattern);\n");
    assert.throws(() => gameDependencyEdges(fixture), /patterns must be static string literals/);
    writeFileSync(path.join(fixture, 'a', 'index.ts'), "const eager = true; import.meta.glob('./*.ts', { eager });\n");
    assert.throws(() => gameDependencyEdges(fixture), /eager must be a static boolean/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('workspace graph includes all internal dependency sections', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'voltmarch-workspaces-'));
  try {
    mkdirSync(path.join(fixture, 'packages', 'a'), { recursive: true });
    mkdirSync(path.join(fixture, 'packages', 'b'), { recursive: true });
    writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    writeFileSync(path.join(fixture, 'packages', 'a', 'package.json'), JSON.stringify({
      name: '@fixture/a',
      peerDependencies: { '@fixture/b': '*' },
    }));
    writeFileSync(path.join(fixture, 'packages', 'b', 'package.json'), JSON.stringify({
      name: '@fixture/b',
      devDependencies: { '@fixture/a': '*' },
    }));
    assert.deepEqual(cyclicComponents(workspaceDependencyGraph(fixture)), [['@fixture/a', '@fixture/b']]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('repository dependency architecture satisfies the frozen policy', () => {
  assert.equal(runDependencyArchitecture(), 0);
});
