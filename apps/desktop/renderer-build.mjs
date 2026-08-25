/** Build the renderer used by packaged/preview desktop releases. */
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GAME = path.join(ROOT, 'apps', 'game');
const PRODUCTION_RELAY_URL = 'wss://relay.voltmarch.com/ws';

/**
 * Desktop packaging does not run inside the Pages workflow, so it must supply
 * the production relay define itself. An explicit environment value still wins
 * for staging builds.
 */
export function buildDesktopRenderer() {
  const relayUrl = process.env.VITE_RELAY_URL?.trim() || PRODUCTION_RELAY_URL;
  console.log(`[vm] building desktop renderer with relay ${relayUrl}`);

  const result = spawnSync('npm', ['run', 'build'], {
    cwd: GAME,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, VITE_RELAY_URL: relayUrl },
  });
  if (result.status !== 0) return result.status ?? 1;

  // Refuse to package another desktop client whose Multiplayer button can only
  // say "No match server configured". Vite emits this value into a lazy shell
  // chunk, so inspect every JavaScript asset rather than guessing its filename.
  const assets = path.join(GAME, 'dist', 'assets');
  const embedded = readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .some((name) => readFileSync(path.join(assets, name), 'utf8').includes(relayUrl));
  if (!embedded) {
    console.error(`[vm] desktop renderer does not contain relay URL ${relayUrl}`);
    return 1;
  }
  return 0;
}
