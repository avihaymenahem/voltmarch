import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const ROOT = path.resolve(GAME, '../..');
const scope = process.argv[2] ?? 'all';

const groups = {
  assets: /(?:asset|cameo|icon|palette|texture|ktx2|building-shape|faction-model|greeble|infantry-legibility)/,
  render: /(?:render|gpu|webgpu|adaptive|composit|frame-rate|fog|shroud|terrain|road|water|surface|shadow|bloom|post-|ao-|vfx|scatter|prop-|resize|hardware-calibration|metrics|overlay-frame|panel-blur|structure-rim)/,
  ui: /(?:hud|shell|settings|accessibility|tutorial|manual|profile|progression-ui|loading-tip|tips-|campaign-briefing|campaign-presentation|campaign-results|commander-powers-ui|savegame-ux|selection-cameo|objectives-ux|rally-overlay|boot-splash|desktop-|cloudflare)/,
  contracts: /(?:truthful|credits|wiki|discord|features|architecture|bundle-isolation|scope|citations|action-catalogue|reward-wiring|build-descriptions|data\.spec|content-|faction-unit-tables)/,
};

const scopes = new Set(['all', 'sim', ...Object.keys(groups)]);

if (!scopes.has(scope)) {
  console.error(`Unknown game test scope: ${scope}`);
  process.exit(2);
}

const all = readdirSync(path.join(GAME, 'tests'))
  .filter((name) => name.endsWith('.spec.ts'))
  .sort();

function category(name) {
  for (const key of ['contracts', 'assets', 'render', 'ui']) {
    if (groups[key].test(name)) return key;
  }
  return 'sim';
}

const selected = scope === 'all' ? all : all.filter((name) => category(name) === scope);
if (selected.length === 0) {
  console.error(`No tests assigned to game scope: ${scope}`);
  process.exit(2);
}

console.log(`[voltmarch] ${scope}: ${selected.length}/${all.length} spec files`);
const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const files = selected.map((name) => `apps/game/tests/${name}`);
const result = spawnSync(process.execPath, [vitest, 'run', '--config', 'apps/game/vite.config.ts', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
