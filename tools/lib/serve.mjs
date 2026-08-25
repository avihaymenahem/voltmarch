/**
 * ============================================================================
 * tools/lib/serve.mjs — a vite server this process can PROVE is its own
 * ============================================================================
 * Every browser-driven tool in `tools/` needs the same three things: build (or
 * not), serve, and point Playwright at it. Thirteen of them wrote that
 * themselves, and twelve wrote it with the same defect. This module is the one
 * copy.
 *
 *     import { serve } from './lib/serve.mjs';
 *     const server = await serve({ root: ROOT, mode: 'preview', portHint: 4319 });
 *     await page.goto(`${server.origin}?shot=naval`);
 *     ...
 *     server.stop();
 *
 * ----------------------------------------------------------------------------
 * THE DEFECT, WHICH WAS REPORTED AGAINST tools/shoot.mjs AND LIVED IN TWELVE
 * ----------------------------------------------------------------------------
 * The pattern was: serve on a FIXED port, then guard it with a `fetch` probe
 * that aborts after 1500 ms. That is a time-of-check/time-of-use test and a
 * busy machine defeats it without anybody's help:
 *
 *   1. the probe times out — a localhost fetch on a machine with a saturated
 *      CPU takes longer than 1500 ms all by itself — and lands in a `catch`
 *      whose comment reads "nothing answered, which is what we want". A LIVE
 *      foreign server has just been read as an empty port;
 *   2. `--strictPort` then makes OUR vite exit immediately on the bound port,
 *      and nothing looks at that exit code;
 *   3. `waitForServer` only ever asked whether SOMETHING answers. The foreign
 *      server does. Every measurement that follows is taken off it.
 *
 * A TCP port is machine-wide and every `git worktree` of this repo runs these
 * same tools, so "another checkout" is the normal case rather than a
 * hypothesis — and possibly a HALF-WRITTEN one, because its owner is rebuilding
 * it. MEASURED, in `shoot.mjs`, by holding 4317 with a server whose first
 * response is delayed past the probe's 1500 ms and whose `dist/` is one
 * constant different: the harness printed `ok` and `1/1 captured`, and
 * `12-blob-readability` came back differing from its reference in 12.4% of its
 * pixels at max delta 255. That is the whole of the reported "the shot harness
 * is nondeterministic" — a neighbour's build, not a race inside the game.
 *
 * Five of the twelve were worse than that: `gpu-profile`, `playtest`,
 * `wedge`, `tutorial-playthrough` and `cameo-audit` treated a foreign server as
 * a FEATURE — `if (!(await waitForServer(BASE, 1500))) start our own` — so on a
 * busy machine they adopted it deliberately and said nothing. Adoption is gone.
 * There is no way to tell a convenient leftover from a neighbour's half-built
 * tree, and the tools that most needed the distinction (`desync-probe`,
 * `replay-probe`) are the two whose entire output is a COMPARISON.
 *
 * ----------------------------------------------------------------------------
 * SO: THE PORT IS READ BACK, NOT ASSERTED
 * ----------------------------------------------------------------------------
 * `originFrom` watches our own child's stdout for the line vite prints once it
 * has BOUND. The number that comes back is one this process watched its own
 * child take. A child that exits without announcing one REJECTS, deliberately:
 * the two ways that happens are a broken install and a port collision, and both
 * used to end with the caller quietly measuring whatever else answered.
 *
 * The port a caller names is therefore a HINT and nothing more. When it is
 * busy the ladder walks to a port the OS says is free, so two worktrees can run
 * the same tool at once instead of one silently measuring the other's work.
 * That also retires a real collision: `flash-stack`, `boot-profile`,
 * `naval-proof`, `desync-probe` and `sobel` all hard-coded 4319, and three of
 * those five carried a comment claiming the number was chosen so they could run
 * beside something else.
 *
 * ----------------------------------------------------------------------------
 * THE BANNER IS COLOURISED, AND THE OBVIOUS STRIP IS WRONG
 * ----------------------------------------------------------------------------
 * `shoot.mjs` stripped ANSI with `/\[[0-9;]*m/g`, which removes the CSI body
 * and LEAVES THE ESC BYTE behind. vite bolds the port digits inside the URL
 * (`printServerUrls` wraps the `:(\d+)/` group in `colors.bold`), so the real
 * bytes are
 *
 *     \x1b[36mhttp://127.0.0.1:\x1b[1m4472\x1b[22m/\x1b[39m
 *
 * and that strip turns them into `http://127.0.0.1:\x1b4472\x1b/` — a string the
 * URL regex cannot match. Measured on vite 7.3.6 on this machine, `stdio:
 * 'pipe'` and all: the URL match returns null, every rung of the ladder then
 * burns its full announce timeout, and the tool dies four minutes later saying
 * no preview of its own would start. The port-identity fix was inert in exactly
 * the environment it shipped into. `stripAnsi` below removes the whole escape
 * sequence, ESC included, and `tests/` has no reach here — the regression that
 * would catch it is `node tools/shoot.mjs`, which is why the header of that
 * file insists the harness be RUN.
 * ============================================================================
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ESC itself, as a code point, so this file stays pure ASCII. */
const ESC = String.fromCharCode(0x1b);

/**
 * A complete CSI escape sequence, ESC INCLUDED.
 *
 * `/\[[0-9;]*m/g` — the version this replaces — matched the body and left the
 * ESC byte sitting between `:` and the port digits, so the URL regex below
 * could never match a colourised banner. See the header.
 */
const CSI = new RegExp(ESC + String.raw`\[[0-?]*[ -/]*[@-~]`, 'g');

/** vite colourises its banner and bolds the port digits INSIDE the URL. */
export const stripAnsi = (s) => String(s).replace(CSI, '');

/**
 * The line vite prints once it is listening, in either mode:
 *
 *     ➜  Local:   http://127.0.0.1:4472/
 */
const URL_LINE = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\//;

/**
 * Kill a child AND everything it spawned.
 *
 * `child.kill()` is not enough and the difference was never academic. Started
 * through `npx` on Windows the tree is cmd.exe -> npx-cli.js -> node vite.js,
 * and `kill()` reaps the first of three: the real server survives, keeps the
 * port, and the NEXT run adopts it. Everything here spawns vite as one direct
 * node process, and this is the belt to that pair of braces.
 */
export function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

/** A port nothing is listening on right now, chosen by the OS. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The origin OUR server is listening on, taken from OUR child's own stdout.
 *
 * This is the whole of the port half of the identity guarantee: the number that
 * comes back is one this process watched its own child bind and announce,
 * rather than one written down in a constant and hoped for.
 *
 * Rejection means "try the next rung of the ladder", never "carry on".
 */
export function originFrom(child, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.stdout.off('data', onOut);
      child.stderr.off('data', onOut);
      child.off('exit', onExit);
      settle(value);
    };
    const onOut = (chunk) => {
      out += stripAnsi(chunk);
      const m = URL_LINE.exec(out);
      if (m !== null) finish(resolve, `http://127.0.0.1:${m[1]}/`);
    };
    const onExit = (code) => finish(reject, new Error(
      `the server exited (${code}) before it announced a port. Output:\n${out.slice(-2000)}`,
    ));
    const timer = setTimeout(() => finish(reject, new Error(
      `the server never announced a port within ${timeoutMs} ms. Output:\n${out.slice(-2000)}`,
    )), timeoutMs);
    child.stdout.on('data', onOut);
    child.stderr.on('data', onOut);
    child.on('exit', onExit);
  });
}

/**
 * Poll until the announced origin actually answers.
 *
 * NOT an identity check and never was — it only ever asked whether SOMETHING
 * answers, which is step 3 of the defect in the header. It survives because a
 * server that announced a port and then failed to serve it is still worth
 * distinguishing from one that is merely slow.
 */
export async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * PREVIEW IDENTITY — prove the origin serves the `dist/` ON THIS DISK, by
 * comparing the bytes.
 *
 * Reading the port off our own child is necessary and STILL not sufficient on
 * Windows, where a wildcard bind (`0.0.0.0`) and a specific one (`127.0.0.1`)
 * can hold the same port number at once and the OS routes by longest match. Two
 * processes can therefore both be "listening on 4319" and both be right, and
 * which one answers is not something a tool gets to assume.
 *
 * `dist/index.html` names its own hashed chunks, so it is a fingerprint of the
 * build for free — no nonce to inject, no server to modify.
 *
 * WHAT IT PROVES: the reply came from a `dist/` byte-for-byte identical to the
 * one on this disk. WHAT IT DOES NOT: that the answering process is the child
 * we spawned. A leaked preview of THIS SAME checkout, serving the same bytes,
 * passes — and is harmless for a preview server, because the bytes are the
 * whole of what it serves.
 */
export async function assertServesDist(origin, root) {
  const wanted = readFileSync(join(root, 'dist', 'index.html'));
  let served;
  try {
    const res = await fetch(origin, { signal: AbortSignal.timeout(30_000) });
    served = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new Error(`could not read ${origin} back to check whose build it serves: ${err}`);
  }
  if (!served.equals(wanted)) {
    throw new Error(
      `${origin} is not serving this checkout's dist/.\n` +
        `Its index.html is ${served.length} bytes where ours is ${wanted.length}; the hashed ` +
        'chunk names it points at belong to somebody else\'s build.\n' +
        'That is another worktree\'s preview holding the port.',
    );
  }
}

/**
 * DEV IDENTITY — prove the origin is rooted at the tree on this disk.
 *
 * A dev server has no `dist/` to fingerprint: it transforms `/src/**` on every
 * request, so nothing it serves is byte-comparable with a file. What it does
 * have is `/@fs/<absolute path>`, which vite answers only for paths inside its
 * OWN `server.fs.allow` — and that list defaults to the workspace root of the
 * root it was started with. A server rooted at another worktree therefore
 * cannot produce this file. MEASURED: it does not 403, it falls through to the
 * SPA fallback and returns `index.html` with status 200, so the discriminator
 * has to be the BYTES and not the status code.
 *
 * `package.json` is the probe file because `?raw` returns it verbatim (checked:
 * 1249 bytes in, 1249 bytes out, no transform) and because it is the one file
 * whose `version` field moves every release.
 *
 * WHAT IT PROVES: the answering server can read THIS root and returns this
 * root's bytes for it. WHAT IT DOES NOT PROVE, and this is a weaker guarantee
 * than `assertServesDist` gives: it says nothing about the module graph the
 * server has cached, so a LEAKED DEV SERVER FROM AN EARLIER RUN OF THIS SAME
 * CHECKOUT passes it while serving stale transforms — the failure
 * `cameo-audit.mjs` records as "Failed to fetch dynamically imported module".
 * The port being read off our own child is what closes that; this only closes
 * the case where the answering process is rooted somewhere else.
 */
export async function assertServesSource(origin, root) {
  const probe = join(root, 'package.json').replace(/\\/g, '/');
  const wanted = readFileSync(probe, 'utf8');
  let served;
  try {
    const res = await fetch(`${origin}@fs/${probe}?raw`, { signal: AbortSignal.timeout(30_000) });
    served = await res.text();
  } catch (err) {
    throw new Error(`could not read ${origin} back to check which tree it is rooted at: ${err}`);
  }
  if (served !== wanted) {
    throw new Error(
      `${origin} is not rooted at ${root}.\n` +
        `It answered /@fs/${probe}?raw with ${served.length} bytes where the file on this disk ` +
        `is ${wanted.length}` +
        (served.trimStart().startsWith('<!doctype') || served.includes('<html')
          ? ' — and what came back is the SPA fallback, which is what vite serves for a path ' +
            'outside its own fs.allow. That is another worktree\'s dev server holding the port.'
          : '.') +
        '\nIf vite changed what `?raw` returns, this check is what breaks first; fix it here ' +
        'rather than deleting it.',
    );
  }
}

/**
 * Start a vite server and hand back one this process can prove is its own.
 *
 * `mode: 'preview'` serves `dist/` (identity: byte-compare against
 * `dist/index.html`); `mode: 'dev'` serves source so `/src/**.ts` stays
 * importable by path (identity: `/@fs/` against this root). `identity: false`
 * turns the check off and is for callers that have deliberately pointed `root`
 * at a tree they do not own — nothing in this repo does.
 *
 * THE LADDER. `--strictPort` is passed explicitly on every rung rather than
 * inherited: `vite.config.ts` sets it for both modes, but `tools/sobel.mjs`
 * runs against a generated config that does not, and a rung that silently HOPS
 * instead of refusing would hand back a port this process never watched vite
 * take — which is the guarantee the whole file exists for.
 *
 * Refusing is the right default for one server on one machine — silently moving
 * would hide a leaked server from whoever left it running — and it is the WRONG
 * behaviour for a repo whose normal state is several worktrees sharing one
 * machine and one port number. So: the hint first, because a single-agent run
 * should keep an address a human already knows, then up to three ports the OS
 * says are free. Every rung ends with a port THIS process watched vite bind and
 * announce, so moving off the hint gives up nothing.
 */
export async function serve({
  root,
  appRoot = join(root ?? '', 'apps/game'),
  mode = 'preview',
  portHint,
  viteArgs = [],
  identity = mode === 'preview' ? 'dist' : 'source',
  ladder = 4,
  announceTimeoutMs = 90_000,
  log = () => {},
} = {}) {
  if (typeof root !== 'string' || root === '') throw new Error('serve({ root }) is required');
  if (typeof appRoot !== 'string' || appRoot === '') throw new Error('serve({ appRoot }) is required');
  if (mode !== 'preview' && mode !== 'dev') throw new Error(`serve({ mode }) must be preview or dev, not ${mode}`);
  if (mode === 'preview' && !existsSync(join(appRoot, 'dist', 'index.html'))) {
    throw new Error(`${join(appRoot, 'dist', 'index.html')} does not exist — build before serving a preview.`);
  }

  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error(`no vite at ${vite} — run npm install in ${root}.`);

  let child = null;
  let origin = null;
  const problems = [];

  for (let attempt = 0; attempt < ladder && child === null; attempt++) {
    const port = attempt === 0 && portHint !== undefined ? portHint : await freePort();
    /*
     * ONE process, started directly. Not `npx vite` and not through a shell: on
     * Windows that is cmd.exe -> npx-cli.js -> node vite.js, killing the parent
     * leaves the server running, and the leftover is what the next run adopts.
     */
    const candidate = spawn(
      process.execPath,
      [vite,
        ...(mode === 'preview' ? ['preview'] : []),
        '--port', String(port), '--strictPort', '--host', '127.0.0.1',
        ...viteArgs],
      { cwd: appRoot, stdio: 'pipe', detached: process.platform !== 'win32' },
    );
    try {
      origin = await originFrom(candidate, announceTimeoutMs);
      child = candidate;
    } catch (err) {
      killTree(candidate);
      // vite's own reason, which is on a later line than its banner.
      const why = /^Error: .*/m.exec(err.message);
      problems.push(`port ${port}: ${why !== null ? why[0] : err.message.split('\n')[0]}`);
    }
  }

  if (child === null) {
    throw new Error(`no ${mode} server of our own would start:\n  ${problems.join('\n  ')}`);
  }
  if (problems.length) log(`  (${problems.join('; ')})`);

  /*
   * DRAIN THE PIPES. With `stdio: 'pipe'` and nobody reading, the OS buffer
   * fills and the child blocks on its next write — vite is chatty in dev (every
   * optimised dep, every HMR event) so it hits the wall inside a minute and the
   * next `page.goto` gets ERR_CONNECTION_REFUSED with no explanation. Two runs
   * of `sobel.mjs` died that way. The tail is kept because it is the only place
   * vite's own account of a failure survives.
   */
  let tail = '';
  const drain = (chunk) => { tail = (tail + stripAnsi(chunk)).slice(-4000); };
  child.stdout.on('data', drain);
  child.stderr.on('data', drain);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    killTree(child);
  };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(1); });
  process.on('SIGTERM', () => { stop(); process.exit(1); });

  try {
    if (!(await waitForServer(origin))) {
      throw new Error(`the server announced ${origin} and then never answered it:\n${tail}`);
    }
    if (identity === 'dist') await assertServesDist(origin, appRoot);
    else if (identity === 'source') await assertServesSource(origin, root);
    else if (typeof identity === 'function') await identity(origin, root);
  } catch (err) {
    stop();
    throw err;
  }

  return {
    origin,
    /** The port vite announced, not the one it was asked for. */
    port: Number(new URL(origin).port),
    child,
    mode,
    /** vite's last 4 kB, for a failure whose cause is on the server side. */
    tail: () => tail,
    stop,
    /**
     * OUR SERVER, STILL ALIVE.
     *
     * `originFrom` proves the origin was ours at the moment it was read. This
     * proves it has not since died and left the port to whatever picks it up
     * next — the same failure, moved from the start of the run to the start of
     * each page. Call it before anything that would otherwise be measured off a
     * stranger.
     */
    assertAlive(context = 'this run') {
      if (child.exitCode !== null) {
        throw new Error(
          `the ${mode} server exited (${child.exitCode}) part-way through ${context}. Everything ` +
            `after that point would have been measured off whatever else answers ${origin}.\n${tail}`,
        );
      }
    },
  };
}

/**
 * `npm run build`, as a promise that rejects with the build's own output.
 *
 * Here because nine tools had their own copy and one of them (`gpu-profile`)
 * threw away stdout, so a failed build reported the string 'build failed' and
 * nothing else.
 */
export function build(root, { log = () => {} } = {}) {
  log('> building...');
  return new Promise((resolve, reject) => {
    const b = spawn('npm', ['run', 'build'], {
      cwd: root, shell: process.platform === 'win32', stdio: 'pipe',
    });
    let out = '';
    b.stdout.on('data', (d) => (out += d));
    b.stderr.on('data', (d) => (out += d));
    b.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`build failed:\n${out.slice(-4000)}`))));
  });
}
