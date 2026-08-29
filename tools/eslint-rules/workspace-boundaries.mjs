import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_PACKAGES = readWorkspacePackages();

/**
 * Enforce the monorepo ownership graph at authoring time.
 *
 * apps/<name>     -> itself or packages/*
 * packages/<name> -> itself or sibling packages through their package name
 *
 * The hash/import ownership gate remains the repository-wide backstop for
 * binary assets and non-ESLint file types. This rule gives source imports an
 * immediate, line-specific failure in editors and CI.
 */
export const workspaceBoundariesRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent private source imports across VOLTMARCH workspace boundaries.',
    },
    schema: [],
    messages: {
      appToApp: 'App "{{source}}" cannot import private source from app "{{target}}". Move the shared dependency into packages/.',
      packageToApp: 'Package "{{source}}" cannot import from app "{{target}}". Apps may depend on packages, never the reverse.',
      packageToPackage: 'Package "{{source}}" must consume sibling package "{{target}}" by its workspace package name, not a relative private-source path.',
    },
  },

  create(context) {
    const source = workspaceFor(context.filename);
    if (!source) return {};

    const inspect = (node, valueNode) => {
      const request = stringValue(valueNode);
      if (!request) return;
      const pathRequest = request.startsWith('.') || path.isAbsolute(request);
      const cleanRequest = request.split(/[?#]/u, 1)[0];
      const target = pathRequest
        ? workspaceFor(path.resolve(path.dirname(context.filename), cleanRequest))
        : workspaceForPackageRequest(cleanRequest);
      if (!target || target.id === source.id) return;

      if (source.kind === 'apps' && target.kind === 'apps') {
        context.report({ node, messageId: 'appToApp', data: { source: source.name, target: target.name } });
      } else if (source.kind === 'packages' && target.kind === 'apps') {
        context.report({ node, messageId: 'packageToApp', data: { source: source.name, target: target.name } });
      } else if (pathRequest && source.kind === 'packages' && target.kind === 'packages') {
        context.report({ node, messageId: 'packageToPackage', data: { source: source.name, target: target.name } });
      }
    };

    return {
      ImportDeclaration: (node) => inspect(node.source, node.source),
      ExportNamedDeclaration: (node) => { if (node.source) inspect(node.source, node.source); },
      ExportAllDeclaration: (node) => inspect(node.source, node.source),
      ImportExpression: (node) => inspect(node.source, node.source),
      TSImportType: (node) => inspect(node.source, node.source),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') inspect(node.arguments[0] ?? node, node.arguments[0]);
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'URL') inspect(node.arguments[0] ?? node, node.arguments[0]);
      },
    };
  },
};

function workspaceFor(target) {
  const relative = path.relative(ROOT, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const [kind, name] = relative.split(path.sep);
  if ((kind !== 'apps' && kind !== 'packages') || !name) return null;
  return { kind, name, id: `${kind}/${name}` };
}

function stringValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
}

function workspaceForPackageRequest(request) {
  for (const [packageName, workspace] of WORKSPACE_PACKAGES) {
    if (request === packageName || request.startsWith(`${packageName}/`)) return workspace;
  }
  return null;
}

function readWorkspacePackages() {
  const result = new Map();
  for (const kind of ['apps', 'packages']) {
    const root = path.join(ROOT, kind);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(readFileSync(path.join(root, entry.name, 'package.json'), 'utf8'));
        if (typeof manifest.name === 'string') {
          result.set(manifest.name, { kind, name: entry.name, id: `${kind}/${entry.name}` });
        }
      } catch { /* A workspace without a manifest has no bare package identity. */ }
    }
  }
  return result;
}

export default workspaceBoundariesRule;
