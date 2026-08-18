/**
 * ============================================================================
 * VOLTMARCH desktop — dev.mjs   (`npm run desktop:dev`)
 * ============================================================================
 * ELECTRON AGAINST THE VITE DEV SERVER, SO HMR WORKS.
 *
 * The packaged path serves `dist/` over `app://` and needs a `vite build`
 * between every edit and every look. This points the same shell at the dev
 * server instead: save a file, see it in the Electron window.
 *
 * `main.ts` and `preload.ts` are still BUILT here rather than served — they are
 * the Electron main process and a sandboxed preload, neither of which Vite
 * touches. Only the RENDERER is hot; a change to the shell itself still needs a
 * restart, and this script rebuilds them on each launch so that restart is the
 * only step.
 *
 * NO NEW DEPENDENCY. `concurrently` would be the obvious way to run two
 * processes and it is not worth a package: this is ~40 lines of `child_process`
 * and the repo's dependency list is deliberately six entries long.
 *
 * ----------------------------------------------------------------------------
 * IT REUSES A DEV SERVER THAT IS ALREADY UP, AND THAT MATTERS
 * ----------------------------------------------------------------------------
 * `.claude/launch.json` offers `dev` and `desktop-dev` as separate buttons, and
 * pressing both is the normal case. If this spawned a second Vite blindly, the
 * second one would find 5173 taken, quietly bind 5174, and Electron would load
 * a DIFFERENT server from the browser tab — two views of the same repo
 * disagreeing about which edit landed, with nothing on screen saying why. So it
 * probes first and only spawns when nothing answers.
 * ============================================================================
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.VM_DEV_PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;

/** Anything answering on the port at all — a 404 still proves a server. */
async function isUp() {
  try {
    await fetch(ORIGIN, { signal: AbortSignal.timeout(600) });
    return true;
  } catch {
    return false;
  }
}

// Paths resolve from THIS FILE, never the caller's cwd — the repo root has its
// own `src/main.ts` (the game's) and resolving against cwd once had esbuild
// bundling the whole game into the Electron main process. See build.mjs.
const built = spawnSync(process.execPath, [path.join(HERE, 'build.mjs')], {
  cwd: HERE,
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

let vite = null;
if (await isUp()) {
  console.log(`[vm] reusing the dev server already on ${ORIGIN}`);
} else {
  console.log(`[vm] starting the dev server on ${ORIGIN}`);
  // `shell: true` because npm is a .cmd on Windows and this repo is developed
  // there; `strictPort` so a busy port fails loudly instead of silently moving.
  vite = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  const deadline = Date.now() + 30_000;
  while (!(await isUp())) {
    if (vite.exitCode !== null) {
      console.error('[vm] the dev server exited before it was reachable');
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error(`[vm] the dev server never came up on ${ORIGIN}`);
      vite.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const electron = createRequire(path.join(HERE, 'package.json'))('electron');
const app = spawn(electron, ['.', `--vm-dev=${ORIGIN}`, ...process.argv.slice(2)], {
  cwd: HERE,
  stdio: 'inherit',
});

// Only stop what we started. A dev server the developer launched themselves
// outlives this process, which is the whole point of reusing it.
const stop = () => { if (vite !== null) vite.kill(); };
app.on('exit', (code) => { stop(); process.exit(code ?? 0); });
process.on('SIGINT', () => { app.kill(); stop(); process.exit(0); });
