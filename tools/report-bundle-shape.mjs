#!/usr/bin/env node

/** Deterministic raw/compressed Vite output and inter-chunk boundary report. */
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
const directory = path.resolve(args.find((argument) => !argument.startsWith('--')) ?? 'apps/game/dist/assets');
const outputIndex = args.indexOf('--output');

function logicalName(file) {
  return file.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:js|css)$)/, '');
}

function moduleReferences(code) {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const references = new Set();
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.add(path.basename(node.moduleSpecifier.text));
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])) {
      references.add(path.basename(node.arguments[0].text));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...references].filter((reference) => reference.endsWith('.js')).sort();
}

const files = readdirSync(directory)
  .filter((file) => /\.(?:js|css)$/.test(file))
  .sort();
const entries = files.map((file) => {
  const contents = readFileSync(path.join(directory, file));
  const isJavaScript = file.endsWith('.js');
  return {
    file,
    logicalName: logicalName(file),
    kind: isJavaScript ? 'js' : 'css',
    bytes: contents.byteLength,
    gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(contents, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    imports: isJavaScript
      ? moduleReferences(contents.toString('utf8')).map(logicalName)
      : [],
  };
});

function totals(kind) {
  const matching = entries.filter((entry) => entry.kind === kind);
  return {
    count: matching.length,
    bytes: matching.reduce((sum, entry) => sum + entry.bytes, 0),
    gzipBytes: matching.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    brotliBytes: matching.reduce((sum, entry) => sum + entry.brotliBytes, 0),
  };
}

const report = {
  schema: 1,
  directory,
  totals: { js: totals('js'), css: totals('css') },
  entries,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputIndex >= 0) {
  const output = args[outputIndex + 1];
  if (output === undefined) throw new Error('--output requires a file');
  writeFileSync(path.resolve(output), serialized);
} else {
  process.stdout.write(serialized);
}
