/**
 * Run the ordinary workspace gate against the remote mainline rather than a
 * potentially stale local `main` branch. Turborepo otherwise defaults to
 * `main...HEAD`; after a release made from another worktree that can make an
 * unrelated one-file change appear to affect every workspace.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tasks = [
  'typecheck',
  'test:sim',
  'test:render',
  'test:ui',
  'test:assets',
  'test:contracts',
  'build',
];

function resolves(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const env = { ...process.env };
if (!env.TURBO_SCM_BASE) {
  env.TURBO_SCM_BASE = resolves('origin/main') ? 'origin/main' : 'main';
}
if (!env.TURBO_SCM_HEAD) env.TURBO_SCM_HEAD = 'HEAD';

console.log(
  `[affected] ${env.TURBO_SCM_BASE}...${env.TURBO_SCM_HEAD} ` +
  '(working-tree changes included by Turborepo)',
);

const turboBin = fileURLToPath(new URL('../node_modules/turbo/bin/turbo', import.meta.url));
const result = spawnSync(
  process.execPath,
  [turboBin, 'run', ...tasks, '--affected'],
  { cwd: process.cwd(), env, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
