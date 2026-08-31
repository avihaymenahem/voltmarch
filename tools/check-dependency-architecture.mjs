#!/usr/bin/env node

/**
 * Deterministic dependency-architecture gate.
 *
 * Stage 0 deliberately checks two different graphs:
 *   1. npm workspace packages must remain acyclic;
 *   2. imports between top-level apps/game/src layers must use an explicitly
 *      allowed edge. The layer graph records today's app architecture; it is
 *      not a claim that every existing layer pair is already ideal.
 *
 * Run with `--discover` to print the observed game-layer edges without
 * enforcing the allow-list. That mode is diagnostic only; the normal command
 * is the release gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const GAME_SRC = path.join(REPO, 'apps', 'game', 'src');
const KNOWN_CYCLES_FILE = path.join(REPO, 'tools', 'dependency-architecture-cycles.json');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export const GAME_LAYERS = [
  'art',
  'audio',
  'campaign',
  'core',
  'data',
  'dev',
  'entry',
  'game',
  'input',
  'net',
  'platform',
  'progression',
  'render',
  'shell',
  'sim',
  'ui',
  'vfx',
  'world',
];

/**
 * Why a currently allowed layer edge exists. Categories make the table below
 * reviewable without pretending that today's cyclic folder graph is already a
 * package-ready DAG.
 */
export const GAME_LAYER_EDGE_CATEGORIES = Object.freeze({
  catalogue: 'Consumes canonical definitions, unlock data or authored catalogues.',
  composition: 'Composes an application/runtime surface from lower-level features.',
  feature: 'Integrates an explicit product feature contract such as campaign, net or progression.',
  foundation: 'Consumes import-safe core types, config, events, math or storage primitives.',
  platform: 'Consumes a browser/desktop capability seam with no private app import.',
  presentation: 'Consumes a render, art, VFX, audio, input or UI presentation service.',
  runtime: 'Consumes world, simulation or published game-runtime context/services.',
});

/**
 * Direct internal layer edges that VOLTMARCH permits today.
 *
 * Keep pairs sorted by `from`, then `to`; the gate verifies order, uniqueness,
 * known folders and category validity. Same-layer imports are always allowed
 * and therefore omitted. New package work must narrow this graph, not copy it.
 */
export const ALLOWED_GAME_LAYER_EDGES = Object.freeze([
  ['art', 'core', 'foundation'],
  ['art', 'data', 'catalogue'],
  ['art', 'game', 'runtime'],
  ['art', 'render', 'presentation'],
  ['art', 'world', 'runtime'],
  ['audio', 'core', 'foundation'],
  ['audio', 'game', 'runtime'],
  ['audio', 'render', 'presentation'],
  ['audio', 'sim', 'runtime'],
  ['campaign', 'audio', 'presentation'],
  ['campaign', 'core', 'foundation'],
  ['campaign', 'data', 'catalogue'],
  ['campaign', 'game', 'runtime'],
  ['campaign', 'progression', 'feature'],
  ['campaign', 'sim', 'runtime'],
  ['campaign', 'world', 'runtime'],
  ['core', 'art', 'presentation'],
  ['core', 'world', 'runtime'],
  ['data', 'core', 'foundation'],
  ['data', 'progression', 'feature'],
  ['data', 'sim', 'runtime'],
  ['dev', 'core', 'foundation'],
  ['dev', 'game', 'runtime'],
  ['dev', 'sim', 'runtime'],
  ['entry', 'core', 'foundation'],
  ['entry', 'game', 'composition'],
  ['entry', 'platform', 'platform'],
  ['entry', 'render', 'presentation'],
  ['entry', 'shell', 'composition'],
  ['game', 'art', 'presentation'],
  ['game', 'audio', 'presentation'],
  ['game', 'campaign', 'feature'],
  ['game', 'core', 'foundation'],
  ['game', 'data', 'catalogue'],
  ['game', 'dev', 'feature'],
  ['game', 'input', 'presentation'],
  ['game', 'net', 'feature'],
  ['game', 'platform', 'platform'],
  ['game', 'progression', 'feature'],
  ['game', 'render', 'presentation'],
  ['game', 'shell', 'composition'],
  ['game', 'sim', 'runtime'],
  ['game', 'ui', 'presentation'],
  ['game', 'vfx', 'presentation'],
  ['game', 'world', 'runtime'],
  ['input', 'core', 'foundation'],
  ['input', 'game', 'runtime'],
  ['input', 'render', 'presentation'],
  ['input', 'sim', 'runtime'],
  ['net', 'core', 'foundation'],
  ['net', 'game', 'runtime'],
  ['progression', 'campaign', 'feature'],
  ['progression', 'core', 'foundation'],
  ['progression', 'data', 'catalogue'],
  ['progression', 'game', 'runtime'],
  ['progression', 'platform', 'platform'],
  ['render', 'art', 'presentation'],
  ['render', 'core', 'foundation'],
  ['render', 'game', 'runtime'],
  ['render', 'sim', 'runtime'],
  ['render', 'vfx', 'presentation'],
  ['render', 'world', 'runtime'],
  ['shell', 'art', 'presentation'],
  ['shell', 'audio', 'presentation'],
  ['shell', 'campaign', 'feature'],
  ['shell', 'core', 'foundation'],
  ['shell', 'data', 'catalogue'],
  ['shell', 'game', 'runtime'],
  ['shell', 'input', 'presentation'],
  ['shell', 'net', 'feature'],
  ['shell', 'platform', 'platform'],
  ['shell', 'progression', 'feature'],
  ['shell', 'render', 'presentation'],
  ['shell', 'sim', 'runtime'],
  ['shell', 'ui', 'presentation'],
  ['shell', 'world', 'runtime'],
  ['sim', 'campaign', 'feature'],
  ['sim', 'core', 'foundation'],
  ['sim', 'data', 'catalogue'],
  ['sim', 'game', 'runtime'],
  ['sim', 'input', 'presentation'],
  ['sim', 'progression', 'feature'],
  ['sim', 'render', 'presentation'],
  ['sim', 'world', 'runtime'],
  ['ui', 'art', 'presentation'],
  ['ui', 'audio', 'presentation'],
  ['ui', 'campaign', 'feature'],
  ['ui', 'core', 'foundation'],
  ['ui', 'data', 'catalogue'],
  ['ui', 'game', 'runtime'],
  ['ui', 'input', 'presentation'],
  ['ui', 'platform', 'platform'],
  ['ui', 'progression', 'feature'],
  ['ui', 'render', 'presentation'],
  ['ui', 'sim', 'runtime'],
  ['ui', 'world', 'runtime'],
  ['vfx', 'core', 'foundation'],
  ['vfx', 'game', 'runtime'],
  ['vfx', 'render', 'presentation'],
  ['vfx', 'world', 'runtime'],
  ['world', 'art', 'presentation'],
  ['world', 'core', 'foundation'],
  ['world', 'game', 'runtime'],
  ['world', 'render', 'presentation'],
  ['world', 'sim', 'runtime'],
  ['world', 'vfx', 'presentation'],
]);

function posix(relative) {
  return relative.replaceAll('\\', '/');
}

function sortedDirectoryFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? sortedDirectoryFiles(target) : [target];
    })
    .sort((a, b) => posix(a).localeCompare(posix(b)));
}

function json(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function expandWorkspacePattern(pattern, repo = REPO) {
  if (!pattern.endsWith('/*')) {
    const direct = path.join(repo, pattern, 'package.json');
    return existsSync(direct) ? [direct] : [];
  }
  const parent = path.join(repo, pattern.slice(0, -2));
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name, 'package.json'))
    .filter((file) => existsSync(file))
    .sort((a, b) => posix(a).localeCompare(posix(b)));
}

export function workspaceDependencyGraph(repo = REPO) {
  const rootPackage = json(path.join(repo, 'package.json'));
  const patterns = Array.isArray(rootPackage.workspaces)
    ? rootPackage.workspaces
    : rootPackage.workspaces?.packages ?? [];
  const manifests = patterns
    .flatMap((pattern) => expandWorkspacePattern(pattern, repo))
    .map((file) => ({ file, manifest: json(file) }))
    .filter(({ manifest }) => typeof manifest.name === 'string')
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const names = new Set(manifests.map(({ manifest }) => manifest.name));
  const graph = new Map();
  for (const { manifest } of manifests) {
    const declared = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
      ...manifest.devDependencies,
    };
    graph.set(
      manifest.name,
      Object.keys(declared).filter((name) => names.has(name)).sort(),
    );
  }
  return graph;
}

/** Return canonical, deterministic strongly-connected dependency groups. */
export function cyclicComponents(graph) {
  const indexByNode = new Map();
  const lowByNode = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let nextIndex = 0;

  function visit(node) {
    indexByNode.set(node, nextIndex);
    lowByNode.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    onStack.add(node);

    for (const target of [...(graph.get(node) ?? [])].sort()) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowByNode.set(node, Math.min(lowByNode.get(node), lowByNode.get(target)));
      } else if (onStack.has(target)) {
        lowByNode.set(node, Math.min(lowByNode.get(node), indexByNode.get(target)));
      }
    }

    if (lowByNode.get(node) !== indexByNode.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    component.sort();
    const selfCycle = component.length === 1 && (graph.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfCycle) components.push(component);
  }

  for (const node of [...graph.keys()].sort()) if (!indexByNode.has(node)) visit(node);
  return components.sort((a, b) => a.join('\0').localeCompare(b.join('\0')));
}

function dependencyReference(node) {
  if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
    const clause = node.importClause;
    const named = clause?.namedBindings;
    const onlyNamedTypes = named !== undefined
      && ts.isNamedImports(named)
      && named.elements.length > 0
      && named.elements.every((element) => element.isTypeOnly);
    return {
      specifier: node.moduleSpecifier.text,
      kind: clause?.isTypeOnly === true || (clause?.name === undefined && onlyNamedTypes) ? 'type' : 'runtime',
    };
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
    const onlyNamedTypes = node.exportClause !== undefined
      && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.length > 0
      && node.exportClause.elements.every((element) => element.isTypeOnly);
    return {
      specifier: node.moduleSpecifier.text,
      kind: node.isTypeOnly || onlyNamedTypes ? 'type' : 'runtime',
    };
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    if (expression !== undefined && ts.isStringLiteralLike(expression)) {
      return { specifier: expression.text, kind: node.isTypeOnly ? 'type' : 'runtime' };
    }
  }
  if (ts.isImportTypeNode(node)) {
    if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      return { specifier: node.argument.literal.text, kind: 'type' };
    }
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return { specifier: node.arguments[0].text, kind: 'runtime' };
    }
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      return { specifier: node.arguments[0].text, kind: 'runtime' };
    }
  }
  return null;
}

function isImportMetaGlobCall(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'glob'
    && ts.isMetaProperty(node.expression.expression)
    && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.expression.expression.name.text === 'meta';
}

function staticGlobPatterns(call, file) {
  const argument = call.arguments[0];
  if (argument === undefined) throw new Error(`${file}: import.meta.glob requires a pattern`);
  if (ts.isStringLiteralLike(argument)) return [argument.text];
  if (ts.isArrayLiteralExpression(argument)) {
    const patterns = argument.elements.map((element) => {
      if (!ts.isStringLiteralLike(element)) {
        throw new Error(`${file}: import.meta.glob patterns must be static string literals`);
      }
      return element.text;
    });
    if (patterns.length === 0) throw new Error(`${file}: import.meta.glob pattern array is empty`);
    return patterns;
  }
  throw new Error(`${file}: import.meta.glob patterns must be static string literals`);
}

function globLoading(call, file) {
  const options = call.arguments[1];
  if (options === undefined) return 'lazy';
  if (!ts.isObjectLiteralExpression(options)) {
    throw new Error(`${file}: import.meta.glob options must be a static object literal`);
  }
  const eager = options.properties.find((property) => (
    property.name !== undefined
    && ((ts.isIdentifier(property.name) && property.name.text === 'eager')
      || (ts.isStringLiteralLike(property.name) && property.name.text === 'eager'))
  ));
  if (eager === undefined) return 'lazy';
  if (!ts.isPropertyAssignment(eager)
    || (eager.initializer.kind !== ts.SyntaxKind.TrueKeyword
      && eager.initializer.kind !== ts.SyntaxKind.FalseKeyword)) {
    throw new Error(`${file}: import.meta.glob eager must be a static boolean`);
  }
  return eager.initializer.kind === ts.SyntaxKind.TrueKeyword ? 'eager' : 'lazy';
}

function globRegex(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length;) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      index += 2;
      if (pattern[index] === '/') {
        expression += '(?:[^/]+/)*';
        index++;
      } else {
        expression += '.*';
      }
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      index++;
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      index++;
      continue;
    }
    if (character === '[') {
      const close = pattern.indexOf(']', index + 1);
      if (close !== -1) {
        expression += pattern.slice(index, close + 1);
        index = close + 1;
        continue;
      }
    }
    expression += character.replace(/[|\\{}()[\]^$+?.-]/g, '\\$&');
    index++;
  }
  return new RegExp(`${expression}$`);
}

function normalizedGlobSubject(fromFile, target, pattern, gameSrc) {
  if (pattern.startsWith('/')) {
    const appRoot = path.dirname(gameSrc);
    return `/${posix(path.relative(appRoot, target))}`;
  }
  const relative = posix(path.relative(path.dirname(fromFile), target));
  return pattern.startsWith('./') ? `./${relative}` : relative;
}

function expandInternalGlob(fromFile, patterns, sourceFiles, gameSrc) {
  const positive = patterns.filter((pattern) => !pattern.startsWith('!'));
  const negative = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  if (positive.length === 0) throw new Error(`${fromFile}: import.meta.glob needs a positive pattern`);
  const positiveRegex = positive.map((pattern) => [pattern, globRegex(pattern)]);
  const negativeRegex = negative.map((pattern) => [pattern, globRegex(pattern)]);
  return sourceFiles.flatMap((target) => {
    const matched = positiveRegex.find(([pattern, regex]) => (
      regex.test(normalizedGlobSubject(fromFile, target, pattern, gameSrc))
    ));
    if (matched === undefined) return [];
    const excluded = negativeRegex.some(([pattern, regex]) => (
      regex.test(normalizedGlobSubject(fromFile, target, pattern, gameSrc))
    ));
    return excluded ? [] : [{ target, pattern: matched[0] }];
  });
}

function resolveInternalSource(fromFile, specifier, gameSrc = GAME_SRC) {
  let base;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    base = path.resolve(gameSrc, specifier.slice(2));
  } else {
    return null;
  }
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  const target = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (target === undefined) return null;
  const relative = posix(path.relative(gameSrc, target));
  return relative.startsWith('../') ? null : target;
}

function layerOf(file, gameSrc = GAME_SRC) {
  const relative = posix(path.relative(gameSrc, file));
  return relative.includes('/') ? relative.slice(0, relative.indexOf('/')) : 'entry';
}

export function gameDependencyEdges(gameSrc = GAME_SRC) {
  const files = sortedDirectoryFiles(gameSrc).filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file)));
  const edges = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function walk(node) {
      if (isImportMetaGlobCall(node)) {
        const patterns = staticGlobPatterns(node, file);
        const loading = globLoading(node, file);
        for (const { target, pattern } of expandInternalGlob(file, patterns, files, gameSrc)) {
          edges.push({
            from: posix(path.relative(gameSrc, file)),
            to: posix(path.relative(gameSrc, target)),
            fromLayer: layerOf(file, gameSrc),
            toLayer: layerOf(target, gameSrc),
            specifier: pattern,
            kind: 'runtime',
            loading: `glob-${loading}`,
          });
        }
      }
      const dependency = dependencyReference(node);
      if (dependency !== null) {
        const target = resolveInternalSource(file, dependency.specifier, gameSrc);
        if (target !== null) {
          const fromLayer = layerOf(file, gameSrc);
          const toLayer = layerOf(target, gameSrc);
          edges.push({
            from: posix(path.relative(gameSrc, file)),
            to: posix(path.relative(gameSrc, target)),
            fromLayer,
            toLayer,
            specifier: dependency.specifier,
            kind: dependency.kind,
          });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  return edges.sort((a, b) => (
    a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.kind.localeCompare(b.kind)
    || a.specifier.localeCompare(b.specifier)
  ));
}

export function observedLayerGraph(edges) {
  const graph = new Map(GAME_LAYERS.map((layer) => [layer, []]));
  for (const { fromLayer, toLayer } of edges) {
    if (fromLayer === toLayer) continue;
    const targets = graph.get(fromLayer);
    if (!targets.includes(toLayer)) targets.push(toLayer);
  }
  for (const targets of graph.values()) targets.sort();
  return graph;
}

export function allowedLayerEdgeSet(edges = ALLOWED_GAME_LAYER_EDGES) {
  return new Set(edges.map(([from, to]) => `${from}\0${to}`));
}

export function layerViolations(edges, allowed = ALLOWED_GAME_LAYER_EDGES) {
  const allowedPairs = allowedLayerEdgeSet(allowed);
  return edges.filter(
    ({ fromLayer, toLayer }) => fromLayer !== toLayer && !allowedPairs.has(`${fromLayer}\0${toLayer}`),
  );
}

export function layerPolicyProblems(
  edges = ALLOWED_GAME_LAYER_EDGES,
  layers = GAME_LAYERS,
  categories = GAME_LAYER_EDGE_CATEGORIES,
) {
  const problems = [];
  const seen = new Set();
  let previous = '';
  for (const edge of edges) {
    const [from, to, category] = edge;
    const key = `${from}\0${to}`;
    if (!layers.includes(from)) problems.push(`unknown from layer: ${from}`);
    if (!layers.includes(to)) problems.push(`unknown to layer: ${to}`);
    if (from === to) problems.push(`same-layer edge must be implicit: ${from}`);
    if (!(category in categories)) problems.push(`unknown edge category: ${category}`);
    if (seen.has(key)) problems.push(`duplicate edge: ${from} -> ${to}`);
    if (previous !== '' && previous.localeCompare(key) > 0) problems.push(`unsorted edge: ${from} -> ${to}`);
    seen.add(key);
    previous = key;
  }
  return problems;
}

export function gameModuleGraph(edges, files) {
  const graph = new Map(files.map((file) => [file, []]));
  for (const { from, to } of edges) {
    const targets = graph.get(from);
    if (targets !== undefined && !targets.includes(to)) targets.push(to);
  }
  for (const targets of graph.values()) targets.sort();
  return graph;
}

export function unknownGameSourceLayers(gameSrc = GAME_SRC) {
  return [...new Set(
    sortedDirectoryFiles(gameSrc)
      .filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file)))
      .map((file) => layerOf(file, gameSrc))
      .filter((layer) => !GAME_LAYERS.includes(layer)),
  )].sort();
}

export function newCyclicComponents(actual, known) {
  return actual.filter((component) => !known.some(
    (knownComponent) => component.every((file) => knownComponent.includes(file)),
  ));
}

function graphLines(graph) {
  return [...graph.entries()].sort(([a], [b]) => a.localeCompare(b)).map(
    ([from, targets]) => `${from}: [${[...targets].sort().join(', ')}]`,
  );
}

export function runDependencyArchitecture({ discover = false } = {}) {
  const packageGraph = workspaceDependencyGraph();
  const packageCycles = cyclicComponents(packageGraph);
  const gameEdges = gameDependencyEdges();
  const sourceFiles = sortedDirectoryFiles(GAME_SRC)
    .filter((file) => SOURCE_EXTENSIONS.includes(path.extname(file)))
    .map((file) => posix(path.relative(GAME_SRC, file)));
  const moduleCycles = cyclicComponents(gameModuleGraph(gameEdges, sourceFiles));
  const knownCycles = existsSync(KNOWN_CYCLES_FILE) ? json(KNOWN_CYCLES_FILE).components : [];
  const newModuleCycles = discover ? [] : newCyclicComponents(moduleCycles, knownCycles);
  const observedLayers = observedLayerGraph(gameEdges);
  const crossLayerEdges = gameEdges.filter(({ fromLayer, toLayer }) => fromLayer !== toLayer);
  const runtimeEdges = gameEdges.filter(({ kind }) => kind === 'runtime');
  const typeEdges = gameEdges.filter(({ kind }) => kind === 'type');
  const violations = discover ? [] : layerViolations(gameEdges);
  const policyProblems = layerPolicyProblems();
  const unknownLayers = unknownGameSourceLayers();

  if (discover) {
    console.log('Observed apps/game layer graph:');
    console.log(graphLines(observedLayers).join('\n'));
    console.log(`Observed cross-layer imports: ${crossLayerEdges.length}`);
    console.log(`Observed resolved imports: ${runtimeEdges.length} runtime, ${typeEdges.length} type-only`);
    console.log(`Observed file dependency cycles: ${moduleCycles.length}`);
    for (const component of moduleCycles) console.log(`  ${component.join(' <-> ')}`);
  }

  if (packageCycles.length > 0) {
    console.error('Workspace package dependency cycles:');
    for (const component of packageCycles) console.error(`  ${component.join(' <-> ')}`);
  }
  if (violations.length > 0) {
    console.error('Disallowed apps/game layer imports:');
    for (const edge of violations) {
      console.error(`  ${edge.from} -> ${edge.to} (${edge.fromLayer} -> ${edge.toLayer})`);
    }
  }
  if (newModuleCycles.length > 0) {
    console.error('New apps/game file dependency cycles:');
    for (const component of newModuleCycles) console.error(`  ${component.join(' <-> ')}`);
  }
  if (policyProblems.length > 0) {
    console.error('Invalid apps/game layer policy:');
    for (const problem of policyProblems) console.error(`  ${problem}`);
  }
  if (unknownLayers.length > 0) console.error(`Unknown apps/game source layers: ${unknownLayers.join(', ')}`);
  if (
    packageCycles.length > 0
    || violations.length > 0
    || newModuleCycles.length > 0
    || policyProblems.length > 0
    || unknownLayers.length > 0
  ) return 1;
  if (!discover) {
    console.log(
      `dependency architecture ok: ${packageGraph.size} workspaces are acyclic; `
      + `${crossLayerEdges.length} cross-layer imports use allowed edges; `
      + `${runtimeEdges.length} runtime and ${typeEdges.length} type-only resolved imports; `
      + `${moduleCycles.length} known file SCCs and no new cycle`,
    );
  }
  return 0;
}

const isMain = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = runDependencyArchitecture({ discover: process.argv.includes('--discover') });
