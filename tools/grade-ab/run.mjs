/**
 * DRIVE THE GRADE A/B. `node tools/grade-ab/run.mjs [--port 5304] [--headed]`
 *
 * Starts a Vite dev server THIS PROCESS OWNS on an explicit port, opens ONE real
 * Chrome, reads `window.__GRADE_AB__`, and tears both down on every exit path.
 *
 * THREE THINGS THAT ARE NOT PREFERENCES:
 *
 *  1. `channel: 'chrome'`. Playwright's BUNDLED Chromium cannot create a WebGPU
 *     device on this platform — Dawn's D3D12 backend fails to load `dxil.dll`
 *     (Windows error 87) and `WebGPURenderer` continues on WebGL2 behind one
 *     `warn()`. Real Chrome succeeds, headless and headed.
 *  2. A REAL ORIGIN. WebGPU needs a secure context; a `data:` URL reports no
 *     `navigator.gpu` at all, which cost the Stage A spike an hour of
 *     confidently wrong conclusions. http://localhost is a secure context.
 *  3. THE BACKEND IS READ, NOT ASSUMED. `navigator.gpu` plus a real adapter were
 *     BOTH true throughout that failure. Only `renderer.backend.isWebGPUBackend`
 *     settles it, and the probe reports it so no number here can be quoted
 *     against a renderer nobody selected. Same rule as
 *     `src/render/backend.ts#assertBackend`.
 *
 * ── WHAT IT MEASURED, 2026-08-17 ────────────────────────────────────────────
 * Live backend `webgpu`, asserted. Over a 256x64 scene-linear chart spanning
 * 0 -> 0.18 -> 1.0 -> 8.0 neutral ramps plus saturated hues at 1.4:
 *
 *     max |delta|   1 / 255      subpixels over 1/255   0
 *     mean |delta|  0.0000407    (2 subpixels of 49 152 differ, by 1 each)
 *
 * and the Y-ramp flip probe read 0.00012 straight against 56.38 flipped, so
 * `screenUV` and `vUv` agree about which way is up — the predicted failure,
 * measured absent. Full context in `docs/RENDER_FINDINGS.md` §7d.
 *
 * The flipped arm is what makes the straight one mean anything. Do not delete it.
 *
 * The port is OWNED rather than probed: Vite runs with `--strictPort`, so it
 * either binds or dies. `tools/shoot.mjs`'s header records what the other way
 * costs — a fixed port guarded by a `fetch` probe photographed a NEIGHBOURING
 * WORKTREE'S BUILD while printing `12/12 captured`.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(opt('--port', '5304'));
const HEADED = argv.includes('--headed');

let BROWSER = null;
let VITE = null;

async function teardown() {
  try {
    if (BROWSER) await BROWSER.close();
  } catch { /* already gone */ }
  BROWSER = null;
  try {
    if (VITE) VITE.kill();
  } catch { /* already gone */ }
  VITE = null;
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await teardown();
    process.exit(130);
  });
}
process.on('unhandledRejection', async (e) => {
  console.error('unhandledRejection:', e);
  await teardown();
  process.exit(1);
});

function startVite() {
  return new Promise((resolve, reject) => {
    /*
     * SPAWNED WITHOUT A SHELL, AND THAT IS THE BUG THIS COMMENT EXISTS FOR.
     *
     * The first version ran `npx.cmd` with `shell: true`, so the child was
     * cmd.exe and Vite was its GRANDCHILD. `child.kill()` then reaped the shell
     * and left Vite holding port 5304, and the next run died on EADDRINUSE
     * against its own orphan. Invoking Vite's bin through `process.execPath` is
     * one process, and one process is one thing to kill — the same reasoning as
     * `tools/webgpu-spike/run.mjs`'s "one browser and one socket, both closed on
     * every exit path".
     */
    const child = spawn(
      process.execPath,
      [
        path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
        '--port', String(PORT), '--strictPort', '--host', '127.0.0.1',
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    VITE = child;
    let done = false;
    const onData = (buf) => {
      /*
       * ANSI STRIPPED BEFORE MATCHING. Vite BOLDS the port number, so the raw
       * bytes carry escape codes between the host and the digits and a regex for
       * a plain origin matches nothing — the server was up and the runner timed
       * out waiting for it to say so.
       */
      // eslint-disable-next-line no-control-regex
      const s = buf.toString().replace(/\[[0-9;]*m/g, '');
      process.stdout.write(s.includes('ready') ? `  vite: ${s.trim()}\n` : '');
      /*
       * The origin comes from OUR OWN CHILD'S STDOUT, never from an assumption.
       * `localhost` as well as the literal address, because Vite prints the
       * hostname it was given — and both are secure contexts, which is what
       * `navigator.gpu` requires.
       */
      const m = s.match(/http:\/\/(localhost|127\.0\.0\.1):(\d+)/);
      if (m && !done) {
        done = true;
        resolve(`http://${m[1]}:${m[2]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => process.stderr.write(`  vite!: ${b}`));
    child.on('exit', (code) => {
      if (!done) reject(new Error(`vite exited before it was ready (code ${code})`));
    });
    setTimeout(() => {
      if (!done) reject(new Error('vite did not report an origin within 60s'));
    }, 60_000);
  });
}

async function main() {
  const origin = await startVite();
  console.log(`> serving ${origin} (this process owns it)`);

  BROWSER = await chromium.launch({
    channel: 'chrome',
    headless: !HEADED,
    args: [
      '--use-angle=default',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const page = await BROWSER.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [page ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

  await page.goto(`${origin}/tools/grade-ab/probe.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__GRADE_AB__ !== undefined, null, { timeout: 90_000 });
  const result = await page.evaluate(() => window.__GRADE_AB__);

  console.log('\n=== GRADE A/B ===');
  console.log(JSON.stringify(result, null, 2));

  await teardown();

  if (!result?.ok) process.exit(1);
  if (result.backend !== 'webgpu') {
    console.error(
      `\nREFUSING TO REPORT: live backend is "${result.backend}", not webgpu. ` +
      'A number taken under the WebGL2 fallback describes a renderer nobody selected. ' +
      'See docs/RENDER_FINDINGS.md §7c and src/render/backend.ts#assertBackend.',
    );
    process.exit(2);
  }
}

main().catch(async (e) => {
  console.error(e);
  await teardown();
  process.exit(1);
});
