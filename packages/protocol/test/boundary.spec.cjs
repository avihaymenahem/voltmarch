const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('protocol imports only its own modules and game-types', () => {
  for (const name of ['index.ts', 'TurnRelay.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
    const imports = [...source.matchAll(/from\s+[\x27\x22]([^\x27\x22]+)[\x27\x22]/g)].map((m) => m[1]);
    assert.equal(imports.every((specifier) => specifier.startsWith('.') || specifier === '@voltmarch/game-types'), true);
  }
});
