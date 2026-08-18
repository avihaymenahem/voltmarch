/**
 * ============================================================================
 * VOLTMARCH desktop — preview.mjs   (`npm run desktop:preview`)
 * ============================================================================
 * THE DESKTOP SHELL ON THE BUILT GAME. No dev server, no HMR, `app://`.
 *
 * The sibling of `dev.mjs`, and the difference is the whole point of having
 * both: `dev.mjs` points Electron at Vite so an edit is on screen without a
 * rebuild, and this one runs the shipped path — `dist/` served over the custom
 * scheme, exactly as the packaged app does. Use this to check something that
 * only exists on the real path: the CSP, the `app://` storage origin, code
 * caching, first-paint timing, or simply that the build works.
 *
 * ----------------------------------------------------------------------------
 * IT ALWAYS BUILDS `dist/` FIRST, AND THAT IS DELIBERATE
 * ----------------------------------------------------------------------------
 * `npm run desktop` does NOT — it runs `build.mjs`, which emits the Electron
 * main process and the preload and nothing else, so it will happily launch the
 * shell onto whatever `dist/` happens to be lying on disk. That is not
 * hypothetical: it has already cost this project an afternoon, with the author
 * playing a build that predated the fixes they were testing and reporting the
 * old behaviour back as still broken.
 *
 * A preview of a stale build is worse than no preview, because it looks like
 * evidence. Seven seconds of `vite build` buys the guarantee that what is on
 * screen is what is in the working tree.
 *
 * NO NEW DEPENDENCY, and paths resolve from THIS FILE rather than the caller's
 * cwd — the repo root has its own `src/main.ts` (the game's), and resolving
 * against cwd once had esbuild bundling the whole game into the Electron main
 * process. See `build.mjs`.
 * ============================================================================
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.VM_PREVIEW_PORT ?? 4317);
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

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });

console.log('[vm] building dist/ — a preview of a stale build is worse than none');
if (run('npm', ['run', 'build'], ROOT).status !== 0) process.exit(1);

const built = spawnSync(process.execPath, [path.join(HERE, 'build.mjs')], {
  cwd: HERE,
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

// Sanity: the shell resolves `dist/` itself, but failing here names the problem
// instead of leaving Electron to show an empty window and a 404 in a log.
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('[vm] dist/index.html is missing after a successful build — refusing to launch');
  process.exit(1);
}

/*
 * A `vite preview` on the side, purely so the launch button has something to
 * point a browser tab at. THE ELECTRON WINDOW DOES NOT USE IT — the shell
 * serves `dist/` over `app://` from disk, which is the path being previewed.
 * Same reuse logic as `dev.mjs`: probe first, because a blind second server
 * binds a different port and then two things disagree about which build they
 * are showing.
 */
let server = null;
if (await isUp()) {
  console.log(`[vm] reusing the preview server already on ${ORIGIN}`);
} else {
  server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  const deadline = Date.now() + 30_000;
  while (!(await isUp())) {
    if (server.exitCode !== null) break; // not fatal: the desktop window is the point
    if (Date.now() > deadline) {
      console.warn(`[vm] preview server never came up on ${ORIGIN}; launching the shell anyway`);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// NO `--vm-dev`. That flag is the only thing that would point the window at a
// dev server; without it `main.ts` loads `app://voltmarch/index.html`.
const electron = createRequire(path.join(HERE, 'package.json'))('electron');
const app = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: HERE, stdio: 'inherit' });

const stop = () => { if (server !== null) server.kill(); };
app.on('exit', (code) => { stop(); process.exit(code ?? 0); });
process.on('SIGINT', () => { app.kill(); stop(); process.exit(0); });
