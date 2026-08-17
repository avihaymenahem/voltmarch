/**
 * THROWAWAY SPIKE — Stage A of docs/WEBGPU_MIGRATION_PLAN.md §5. NOT SHIPPED CODE.
 * DELETE THIS DIRECTORY once the verdict in the commit message is recorded.
 *
 *   node tools/webgpu-spike/run.mjs [--port 5303] [--headed] [--quick]
 *
 * Serves tools/webgpu-spike/ and node_modules/three/build/ off a socket THIS
 * PROCESS owns, then drives headless Chromium through it.
 *
 * THE PORT IS OWNED, NOT PROBED. `tools/shoot.mjs`'s header records what the
 * other way costs: it guarded a fixed port with a `fetch` probe, a busy machine
 * defeated the check, and the harness photographed a NEIGHBOURING WORKTREE'S
 * BUILD while printing `12/12 captured`. `server.listen()` either binds or
 * throws EADDRINUSE — there is no window between the check and the use — and the
 * origin printed below is read off our own listener rather than assumed.
 *
 * Nothing here imports from `src/`. Nothing in `src/` imports this. `vite build`
 * takes index.html as its only input, so none of it can reach `dist/`.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const THREE_BUILD = path.join(ROOT, 'node_modules', 'three', 'build');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const START_PORT = Number(opt('--port', '5303'));
const HEADED = flag('--headed');
const QUICK = flag('--quick');

/** The sweep. 64 is where we actually sit — colour pass 54-76 at v2.12.0. */
const DRAW_POINTS = QUICK ? [64, 1000] : [50, 64, 200, 1000, 4000];
const RESOLUTIONS = QUICK ? [[1280, 720]] : [[2560, 1440], [1280, 720]];
const ARMS = ['webgl', 'webgpu', 'nodegl'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function serve(startPort) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let file;
      if (url.pathname.startsWith('/three/')) {
        file = path.join(THREE_BUILD, path.basename(url.pathname));
      } else {
        const rel = url.pathname === '/' ? '/bench.html' : url.pathname;
        file = path.join(HERE, path.basename(rel));
      }
      if (!existsSync(file)) {
        res.writeHead(404).end('not found: ' + url.pathname);
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });

  for (let port = startPort; port < startPort + 40; port++) {
    const bound = await new Promise((resolve) => {
      const onErr = () => {
        server.removeListener('error', onErr);
        resolve(false);
      };
      server.once('error', onErr);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onErr);
        resolve(true);
      });
    });
    if (bound) {
      const a = server.address();
      return { server, origin: `http://127.0.0.1:${a.port}`, port: a.port };
    }
  }
  throw new Error(`no free port in ${startPort}..${startPort + 40}`);
}

const fmt = (n, w = 8) => String(n).padStart(w);

async function main() {
  const { server, origin } = await serve(START_PORT);
  console.log(`> serving ${origin} (this process owns the socket)`);

  /*
   * `channel: 'chrome'` IS LOAD-BEARING AND IS NOT A PREFERENCE.
   *
   * Playwright's BUNDLED Chromium, headless, cannot create a WebGPU device on
   * this platform: Dawn's D3D12 backend fails to load `dxil.dll` with Windows
   * error 87 and `WebGPURenderer` continues on WebGL2 behind one `warn()`.
   * Real Chrome and real Edge both succeed, headless and headed. See
   * `channel-probe.mjs` for the per-binary table. With the bundled build the
   * 'webgpu' arm measures WebGL2 and says WebGPU.
   */
  const browser = await chromium.launch({
    channel: opt('--channel', 'chrome'),
    headless: !HEADED,
    args: [
      // Same GPU posture tools/shoot.mjs launches with ...
      '--use-angle=default',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-device-scale-factor=1',
      // ... plus what WebGPU needs on top of it. If the answer to question 1 is
      // "no", these are the flags it was no with.
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU',
    ],
  });

  const results = { origin, node: process.version, when: new Date().toISOString(), probe: null, runs: [] };

  // ------------------------------------------------------------- probe ----
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`${origin}/probe.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__PROBE_DONE === true', null, { timeout: 120_000 });
    results.probe = await page.evaluate(() => window.__PROBE);
    results.probe.consoleLog = logs;
    await page.close();

    const p = results.probe;
    console.log('\n=== PROBE ===');
    console.log(`  navigator.gpu present : ${p.navigatorGpu}`);
    console.log(`  live backend          : ${p.liveBackend}`);
    console.log(`  backend flags         : ${JSON.stringify(p.backend)}`);
    console.log(`  adapter               : ${JSON.stringify(p.deviceAdapterInfo || p.rawAdapter)}`);
    console.log(`  onBeforeCompile       : ${JSON.stringify(p.onBeforeCompile)}`);
    console.log(`  generated shader      : ${JSON.stringify({ ...(p.generatedShader || {}), head: undefined })}`);
    console.log(`  escape hatches        : ${JSON.stringify(p.escapeHatches)}`);
    if (!p.ok) console.log(`  PROBE ERROR: ${p.error}`);
  }

  // ------------------------------------------------------------- sweep ----
  // One page per measurement point. A fresh context per point costs seconds and
  // buys the guarantee that no arm inherits another arm's warm caches.
  for (const [w, h] of RESOLUTIONS) {
    for (const draws of DRAW_POINTS) {
      for (const backend of ARMS) {
        const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
        const logs = [];
        page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
        page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
        await page.goto(`${origin}/bench.html`, { waitUntil: 'load' });
        await page.waitForFunction('window.__BENCH_READY === true', null, { timeout: 60_000 });
        const r = await page.evaluate(
          (cfg) => window.__BENCH.run(cfg),
          { backend, draws, width: w, height: h },
        );
        r.consoleLog = logs.slice(0, 12);
        results.runs.push(r);
        await page.close();

        if (!r.ok) {
          console.log(`  ${backend} ${draws}@${w}x${h}  FAILED: ${r.error.split('\n')[0]}`);
        } else {
          console.log(
            `  ${backend.padEnd(7)} draws=${String(draws).padStart(5)} ${w}x${h}` +
              `  live=${r.identity.live.padEnd(15)}` +
              ` cpu=${fmt(r.cpuMs.p50.toFixed(2), 7)}ms` +
              ` raf=${fmt(r.frameMs.p50.toFixed(2), 7)}ms` +
              ` unc=${fmt(r.uncapped.fps.toFixed(1), 7)}fps` +
              ` colour=${r.draws.colour} shadow=${r.draws.shadow} tri=${(r.draws.triangles / 1e6).toFixed(2)}M`,
          );
        }
      }
    }
  }

  await browser.close();
  server.close();

  await mkdir(path.join(HERE, 'out'), { recursive: true });
  const dest = path.join(HERE, 'out', 'results.json');
  await writeFile(dest, JSON.stringify(results, null, 2));
  console.log(`\n> wrote ${dest}`);

  report(results);
}

function report(results) {
  const rows = results.runs.filter((r) => r.ok);
  const res = [...new Set(rows.map((r) => `${r.cfg.width}x${r.cfg.height}`))];

  for (const rs of res) {
    console.log(`\n=== ${rs} — median CPU ms inside render(), and uncapped fps ===`);
    console.log(
      '  draws | colour |    tri |' +
        ARMS.map((a) => ` ${a.padStart(8)} cpu ${a.padStart(6)} fps |`).join(''),
    );
    const points = [...new Set(rows.filter((r) => `${r.cfg.width}x${r.cfg.height}` === rs).map((r) => r.cfg.draws))];
    for (const d of points) {
      const at = (a) => rows.find((r) => r.cfg.draws === d && r.cfg.backend === a && `${r.cfg.width}x${r.cfg.height}` === rs);
      const any = at('webgl') || at('webgpu');
      let line = `  ${fmt(d, 5)} | ${fmt(any ? any.draws.colour : '?', 6)} | ${fmt(any ? (any.draws.triangles / 1e6).toFixed(2) + 'M' : '?', 6)} |`;
      for (const a of ARMS) {
        const r = at(a);
        line += r ? ` ${fmt(r.cpuMs.p50.toFixed(3), 12)} ${fmt(r.uncapped.fps.toFixed(1), 10)} |` : ` ${fmt('-', 12)} ${fmt('-', 10)} |`;
      }
      console.log(line);
    }
  }

  console.log('\n=== CROSSOVER (webgpu cpu / webgl cpu; < 1.00 means WebGPU is cheaper) ===');
  for (const rs of res) {
    const points = [...new Set(rows.filter((r) => `${r.cfg.width}x${r.cfg.height}` === rs).map((r) => r.cfg.draws))];
    for (const d of points) {
      const g = rows.find((r) => r.cfg.draws === d && r.cfg.backend === 'webgl' && `${r.cfg.width}x${r.cfg.height}` === rs);
      const w = rows.find((r) => r.cfg.draws === d && r.cfg.backend === 'webgpu' && `${r.cfg.width}x${r.cfg.height}` === rs);
      if (g && w) {
        console.log(
          `  ${rs.padEnd(10)} draws=${fmt(d, 5)}  ratio=${(w.cpuMs.p50 / g.cpuMs.p50).toFixed(3)}` +
            `   (webgl ${g.cpuMs.p50.toFixed(3)}ms  webgpu ${w.cpuMs.p50.toFixed(3)}ms)`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
