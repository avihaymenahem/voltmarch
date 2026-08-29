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
import { readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktopRenderer } from './renderer-build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GAME = path.join(ROOT, 'apps', 'game');

const rendererStatus = buildDesktopRenderer();
if (rendererStatus !== 0) process.exit(rendererStatus);

const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Refuse rather than package a shell around a stale or absent game.
const dist = path.join(GAME, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html is missing — run `npm run build` at the repo root first.');
  process.exit(1);
}

const icon = path.join(ROOT, 'packages', 'assets', 'brand', 'mark-512.png');

console.log(`packaging VOLTMARCH ${version}`);
// Invoke electron-builder's cli.js with the CURRENT node rather than going
// through npx: npx resolution differs between PowerShell and Git Bash on
// Windows, and it failed silently with no output and exit 1 under the latter.
// Resolve it through Node so the unified workspace install at ROOT/node_modules
// is honoured; hard-coding HERE/node_modules resurrects the nested install the
// monorepo deliberately removed and makes every release runner fail packaging.
const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
const res = spawnSync(
  process.execPath,
  [
    cli,
    '--config', 'electron-builder.yml',
    '-c.extraMetadata.version', version,
    '-c.win.icon', icon,
    // Publishing belongs to .github/workflows/desktop.yml. On a tag runner,
    // electron-builder otherwise infers an implicit GitHub publish and fails
    // before the workflow can validate and upload the complete asset set.
    '--publish', 'never',
  ],
  { cwd: HERE, stdio: 'inherit' },
);

if (res.status === 0) prune(version);
process.exit(res.status ?? 1);

/**
 * Leave `release/` holding the artifacts of the version just built, and
 * nothing else.
 *
 * WHY THIS IS NOT OPTIONAL HOUSEKEEPING. electron-builder names every output
 * after the version, so nothing it writes ever overwrites anything it wrote
 * before: each `npm run desktop:dist` ADDS ~580 MB and removes nothing. Four
 * releases in, this directory was measured at **1.2 GB** — 875 MB of installers
 * for three versions nobody can run any more, plus a 362 MB staging tree. It is
 * gitignored, so nothing was ever going to notice.
 *
 * TWO THINGS THAT MAKE THIS SAFE TO RUN UNATTENDED, and both matter:
 *
 *   1. **It runs only on `res.status === 0`.** A failed package leaves the
 *      previous installer exactly where it was, which is the one moment you
 *      actually want the old build — you have nothing else to hand a tester.
 *   2. **It keeps by NAME, not by age.** Anything carrying this version's
 *      string survives; a different `x.y.z` does not. An mtime rule would have
 *      been shorter and would delete the wrong thing the first time a build
 *      re-emitted an unchanged file with an old timestamp.
 *
 * Windows will not unlink a portable executable while somebody is playing
 * that build. A locked OLD artifact is therefore warned about and retained;
 * it must never turn a completely valid new installer into a failed release.
 *
 * `win-unpacked` and `.icon-ico` go every time. They are staging, rebuilt from
 * scratch on the next run, and between them they are the largest single item
 * here — the installer and the portable exe both already contain everything in
 * them. `latest.yml` and `builder-debug.yml` are kept: they describe THIS build,
 * they are overwritten rather than accumulated, and they are a few kB.
 */
function prune(keep) {
  const release = path.join(HERE, 'release');
  if (!existsSync(release)) return;

  // Any dotted triple that is not the one we just built. Matching the version
  // ANYWHERE in the name covers both `VOLTMARCH-2.17.0-portable.exe` and
  // `VOLTMARCH-Setup-2.17.0.exe.blockmap` without a second pattern.
  const STAGING = new Set(['win-unpacked', '.icon-ico']);
  let freed = 0;

  for (const name of readdirSync(release)) {
    const other = /\d+\.\d+\.\d+/.test(name) && !name.includes(keep);
    if (!other && !STAGING.has(name)) continue;

    const full = path.join(release, name);
    const size = sizeOf(full);
    try {
      rmSync(full, { recursive: true, force: true });
      freed += size;
      console.log(`  pruned ${name}`);
    } catch (error) {
      const code = error instanceof Error && 'code' in error
        ? String(error.code)
        : 'unknown';
      if (code !== 'EPERM' && code !== 'EBUSY') throw error;
      console.warn(`  kept locked artifact ${name} (${code}); close that build to clean it later`);
    }
  }

  if (freed > 0) console.log(`release/ pruned, ${(freed / 1e6).toFixed(0)} MB freed`);
}

function sizeOf(target) {
  const st = statSync(target, { throwIfNoEntry: false });
  if (st === undefined) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of readdirSync(target)) total += sizeOf(path.join(target, name));
  return total;
}
