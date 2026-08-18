/**
 * VOLTMARCH desktop — package the installer.
 *
 * THE VERSION IS DERIVED, NEVER RESTATED. The root package.json holds the one
 * version number (vite.config.ts already says so and feeds `__APP_VERSION__`
 * from it), and a second copy in desktop/package.json would be a claim that
 * quietly stops being true the first time somebody runs `npm version` — which
 * is the defect class docs/SPEC_DRIFT_AUDIT.md exists to catalogue. So there is
 * no `version` field over there at all; it is injected here.
 *
 * The icon is likewise taken from the shipped brand mark rather than copied
 * into a second location.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Refuse rather than package a shell around a stale or absent game.
const dist = path.join(ROOT, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html is missing — run `npm run build` at the repo root first.');
  process.exit(1);
}

const icon = path.join(ROOT, 'public', 'brand', 'mark-512.png');

console.log(`packaging VOLTMARCH ${version}`);
// Invoke electron-builder's cli.js with the CURRENT node rather than going
// through npx: npx resolution differs between PowerShell and Git Bash on
// Windows, and it failed silently with no output and exit 1 under the latter.
const cli = path.join(HERE, 'node_modules', 'electron-builder', 'cli.js');
const res = spawnSync(
  process.execPath,
  [
    cli,
    '--config', 'electron-builder.yml',
    '-c.extraMetadata.version', version,
    '-c.win.icon', icon,
  ],
  { cwd: HERE, stdio: 'inherit' },
);
process.exit(res.status ?? 1);
