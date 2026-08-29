import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { workspaceBoundariesRule } from './workspace-boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const linter = new Linter({ configType: 'flat' });
const config = [{
  files: ['**/*.{js,mjs,cjs,ts,tsx}'],
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
  plugins: { voltmarch: { rules: { 'workspace-boundaries': workspaceBoundariesRule } } },
  rules: { 'voltmarch/workspace-boundaries': 'error' },
}];

function lint(code, filename) {
  return linter.verify(code, config, { filename: path.join(ROOT, filename) });
}

test('allows imports inside one app and from an app into packages', () => {
  assert.deepEqual(lint("import './local.js'; import '../../../packages/protocol/src/index.ts';", 'apps/game/src/a.ts'), []);
});

test('rejects static, dynamic, export and asset imports into a sibling app', () => {
  const messages = lint(`
    import value from '../../desktop/src/flags.ts';
    export * from '../../relay/src/index.ts';
    void import('../../website/build.mjs');
    new URL('../../asset-lab/index.html', import.meta.url);
  `, 'apps/game/src/a.ts');
  assert.equal(messages.length, 4);
  assert.ok(messages.every((message) => message.messageId === 'appToApp'));
});

test('rejects package imports from apps', () => {
  const messages = lint("import type { Thing } from '../../../apps/game/src/core/types.ts';", 'packages/protocol/src/a.ts');
  assert.equal(messages[0]?.messageId, 'packageToApp');
});

test('rejects a sibling app imported by its bare workspace package name', () => {
  const messages = lint("import desktop from '@voltmarch/desktop';", 'apps/game/src/a.ts');
  assert.equal(messages[0]?.messageId, 'appToApp');
});

test('requires sibling packages to use their workspace package name', () => {
  const relative = lint("export * from '../../game-types/src/index.ts';", 'packages/protocol/src/a.ts');
  const declared = lint("export * from '@voltmarch/game-types';", 'packages/protocol/src/a.ts');
  assert.equal(relative[0]?.messageId, 'packageToPackage');
  assert.deepEqual(declared, []);
});

test('checks CommonJS require and type import expressions', () => {
  const messages = lint(`
    const desktop = require('../../desktop/src/flags.ts');
    type Desktop = import('../../desktop/src/flags.ts').Flags;
  `, 'apps/game/src/a.ts');
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.messageId === 'appToApp'));
});
