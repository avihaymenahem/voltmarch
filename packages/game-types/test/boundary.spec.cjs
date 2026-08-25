const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('game-types remains dependency-free', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.doesNotMatch(source, /(?:from|import\s*\()[\x27\x22](?!node:)/);
});
