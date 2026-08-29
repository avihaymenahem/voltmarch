#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = path.join(ROOT, 'apps');
const PACKAGES = path.join(ROOT, 'packages');
const IGNORED_DIRECTORIES = new Set([
  'dist', 'out', 'node_modules', '.turbo', '.wrangler', 'coverage', 'test-results', 'playwright-report',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

const appFiles = await walk(APPS);
const files = [...appFiles, ...await walk(PACKAGES)];
const byHash = new Map();
for (const file of files) {
  const bytes = await readFile(file);
  if (bytes.length === 0) continue;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const app = ownerFor(file);
  const records = byHash.get(hash) ?? [];
  records.push({ app, file });
  byHash.set(hash, records);
}

const duplicateFailures = [];
for (const records of byHash.values()) {
  if (new Set(records.map((record) => record.app)).size < 2) continue;
  duplicateFailures.push(records.map((record) => path.relative(ROOT, record.file).replaceAll('\\', '/')));
}

const importFailures = [];
const importPattern = /(?:from\s*|import\s*\(|new\s+URL\s*\()\s*['"]([^'"]+)['"]/gu;
for (const file of appFiles.filter((candidate) => SOURCE_EXTENSIONS.has(path.extname(candidate)))) {
  const source = await readFile(file, 'utf8');
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const request = match[1];
    if (!request.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), request);
    if (!isInside(target, APPS)) continue;
    const owner = ownerFor(file);
    const targetOwner = ownerFor(target);
    if (owner !== targetOwner) {
      importFailures.push(`${path.relative(ROOT, file).replaceAll('\\', '/')} -> ${request}`);
    }
  }
}

if (duplicateFailures.length || importFailures.length) {
  if (duplicateFailures.length) {
    console.error('Exact files are owned by more than one workspace; keep one canonical package source:');
    for (const group of duplicateFailures) console.error(`\n  ${group.join('\n  ')}`);
  }
  if (importFailures.length) {
    console.error('\nApp source imports a sibling app directly; move the shared dependency into packages/:');
    for (const failure of importFailures) console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(`Workspace ownership PASS: ${files.length} source files, no duplicated files or sibling-app imports.`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

function ownerFor(target) {
  if (isInside(target, APPS)) return `apps/${path.relative(APPS, target).split(path.sep)[0]}`;
  if (isInside(target, PACKAGES)) return `packages/${path.relative(PACKAGES, target).split(path.sep)[0]}`;
  return 'outside-workspaces';
}

function isInside(target, parent) {
  const relative = path.relative(parent, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
