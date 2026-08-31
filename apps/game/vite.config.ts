/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, cpSync, createReadStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MONOREPO_ROOT = resolve(ROOT, '../..');
const BASIS_DEV_PATH = `/@fs/${resolve(
  MONOREPO_ROOT,
  'node_modules/three/examples/jsm/libs/basis',
).replace(/\\/g, '/')}/`;

/** The one version number. Everything else must derive from it, never restate it. */
const PKG_VERSION: string = JSON.parse(
  readFileSync(resolve(MONOREPO_ROOT, 'package.json'), 'utf8'),
).version;

const TERRAIN_MASK_ARM = process.env.VM_TERRAIN_MASK_ARM?.trim() || 'ktx2';
if (TERRAIN_MASK_ARM !== 'png' && TERRAIN_MASK_ARM !== 'ktx2') {
  throw new Error(`VM_TERRAIN_MASK_ARM must be "png" or "ktx2", got "${TERRAIN_MASK_ARM}"`);
}
// The six-file candidate is packaged and reproducible, but remains a lab arm:
// its 10.71 MiB transfer win did not improve family-ready p95 by the required
// 10% on either renderer. Keep the proven current files as the shipping arm.
const ALLIED_MESHOPT_ARM = process.env.VM_ALLIED_MESHOPT_ARM?.trim() || 'control';
if (ALLIED_MESHOPT_ARM !== 'control' && ALLIED_MESHOPT_ARM !== 'meshopt') {
  throw new Error(
    `VM_ALLIED_MESHOPT_ARM must be "control" or "meshopt", got "${ALLIED_MESHOPT_ARM}"`,
  );
}
const ALLIED_MESHOPT_STEMS = [
  'guardian-tank',
  'sabre-ifv',
  'refractor-tank',
  'construction-dozer',
  'petrel-bomber',
  'albatross-heavy-bomber',
] as const;

/**
 * Keep release notices and the pre-module shell assets single-sourced.
 * Electron embeds this same dist/ tree, while the development middleware
 * exposes only the two small shared directories the boot HTML can request.
 */
const SHARED_STATIC_DIRS = [
  { prefix: '/brand/', dir: resolve(MONOREPO_ROOT, 'packages', 'assets', 'brand') },
  { prefix: '/fonts/', dir: resolve(MONOREPO_ROOT, 'packages', 'assets', 'fonts') },
] as const;

const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/**
 * Serve the canonical shared shell assets in development and copy the same
 * directories into the release. Keeping the URL contract (`/brand/*` and
 * `/fonts/*`) stable matters because the boot curtain runs before the module
 * graph and therefore cannot import package assets through JavaScript.
 */
function releaseNoticesPlugin() {
  return {
    name: 'voltmarch-release-assets',
    configureServer(server: { middlewares: { use(handler: (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => void): void } }) {
      server.middlewares.use((req, res, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://voltmarch.local').pathname);
        } catch {
          next();
          return;
        }

        const mount = SHARED_STATIC_DIRS.find(({ prefix }) => pathname.startsWith(prefix));
        if (mount === undefined) {
          next();
          return;
        }

        const file = resolve(mount.dir, pathname.slice(mount.prefix.length));
        const root = `${resolve(mount.dir)}${sep}`;
        if (!file.startsWith(root)) {
          next();
          return;
        }

        try {
          const stat = statSync(file);
          if (!stat.isFile()) {
            next();
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', STATIC_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Cache-Control', 'no-cache');
          createReadStream(file).pipe(res);
        } catch {
          next();
        }
      });
    },
    writeBundle(output: { dir?: string }) {
      const dist = resolve(ROOT, output.dir ?? 'dist');
      const legal = resolve(dist, 'legal');
      mkdirSync(legal, { recursive: true });
      copyFileSync(resolve(MONOREPO_ROOT, 'LICENSE'), resolve(legal, 'LICENSE.txt'));
      copyFileSync(resolve(MONOREPO_ROOT, 'THIRD_PARTY_NOTICES.md'), resolve(legal, 'THIRD_PARTY_NOTICES.md'));
      copyFileSync(
        resolve(MONOREPO_ROOT, 'licenses', 'Rajdhani-OFL-1.1.txt'),
        resolve(legal, 'Rajdhani-OFL-1.1.txt'),
      );
      for (const { prefix, dir } of SHARED_STATIC_DIRS) {
        cpSync(dir, resolve(dist, prefix.slice(1, -1)), { recursive: true });
      }
    },
  };
}

/**
 * Fail closed if the development Cheat Engine ever leaks into a release.
 *
 * Bootstrap's `__DEV__` branch should let Rollup remove the dynamic import and
 * its chunk completely. This checks the emitted code rather than trusting that
 * source-level intent, so a future import move cannot silently ship cheats.
 */
function devOnlyBoundaryPlugin() {
  const forbidden = ['vm-cheat-launcher', 'CHEAT ENGINE', 'Unlimited build mode'];
  return {
    name: 'voltmarch-dev-only-boundary',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string; source?: string | Uint8Array }>) {
      for (const [file, asset] of Object.entries(bundle)) {
        const body = asset.type === 'chunk' ? asset.code : asset.source;
        if (typeof body !== 'string') continue;
        const marker = forbidden.find((value) => body.includes(value));
        if (marker !== undefined) {
          throw new Error(`[dev-boundary] release asset ${file} contains DEV-only marker "${marker}"`);
        }
      }
    },
  };
}

/**
 * VOLTMARCH build config.
 *
 * DELIBERATELY FREE OF CODE-TRANSFORM PLUGINS.
 *
 * There is no type-checking plugin here and there must never be one: esbuild
 * strips types, so a stray type error in one of ~15 parallel modules must never
 * be able to stop the game from running. `tsc --noEmit` is a separate gate
 * (`npm run typecheck`), not part of `npm run build`. The one plugin below
 * serves/copies static shell assets and legal notices without transforming code.
 */
export default defineConfig(({ command, mode }) => ({
  // Vitest's repository-contract tests deliberately resolve paths from the
  // monorepo root. The shipping Vite application remains rooted here.
  root: mode === 'test' ? MONOREPO_ROOT : ROOT,
  // Relative base so the built bundle runs from a file:// path or any subdir -
  // the screenshot harness serves it from an arbitrary root.
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // A single stable import in terrain-detail-mask.ts resolves to exactly
      // one reviewed transport arm. Unlike a conditional dynamic import this
      // prevents Rollup from retaining the non-selected control asset.
      '@terrain-detail-mask?url': `${resolve(
        MONOREPO_ROOT,
        'packages/assets/game/terrain',
        `universal-terrain-mask-4k.${TERRAIN_MASK_ARM}`,
      )}?url`,
      ...Object.fromEntries(ALLIED_MESHOPT_STEMS.map((stem) => [
        `@allied-${stem}-runtime?url`,
        `${resolve(
          MONOREPO_ROOT,
          'packages/assets/game/units/allies/compressed',
          `${stem}${ALLIED_MESHOPT_ARM === 'meshopt' ? '.meshopt' : ''}.glb`,
        )}?url`,
      ])),
    },
  },

  plugins: [releaseNoticesPlugin(), devOnlyBoundaryPlugin()],

  server: {
    /*
     * 5173 UNLESS THE ENVIRONMENT NAMES ONE. A TCP port is machine-wide, and
     * every `git worktree` of this repo runs the same dev server — so a second
     * tree, or any tool already holding 5173, turned `npm run dev` into a hard
     * failure. That is the collision `tools/shoot.mjs` records paying for on
     * port 4317, one port over.
     *
     * `strictPort` STAYS ON, and that is the point rather than an oversight.
     * A caller that names a port is waiting on that exact origin; drifting to
     * 5174 in silence is how `desktop/dev.mjs` came to document Electron
     * loading nothing. Refusing is the correct failure.
     *
     * `desktop/dev.mjs` is unaffected either way: it passes `--port` on the
     * command line, which outranks this file, and carries its own
     * `VM_DEV_PORT` override.
     */
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    open: false,
  },

  preview: {
    /*
     * THE 4317 IS A DEFAULT, NOT A CONTRACT, AND THE COMMENT HERE SAID
     * OTHERWISE FOR A LONG TIME.
     *
     * It read "matches the port tools/shoot.mjs serves the built bundle on",
     * which was true once and is not now: `shoot.mjs` runs its OWN server
     * (`tools/lib/serve.mjs`), treats 4317 as a hint, and walks to a free port
     * when it is taken — precisely so two worktrees can capture at once. So
     * nothing on this machine requires this process to hold that number, and
     * `strictPort: true` only meant the preview refused to start whenever
     * anything else already had it.
     *
     * A TCP port is machine-wide and this repo is worked in parallel
     * worktrees, so "it is free on my machine" is not a property anybody can
     * rely on. `PORT` overrides, exactly as the dev server does.
     */
    port: Number(process.env.PORT) || 4317,
    strictPort: true,
  },

  // THE WORKER THIS SETTING WAS WAITING FOR HAS LANDED.
  //
  // For a long time this block claimed texture generation ran in a worker and
  // cited `src/render/textures/TextureWorker.ts`, a path that has never existed.
  // The comment was corrected to say so and `format: 'es'` was kept, on the
  // grounds that it would be the right default the day a worker did land.
  //
  // That day is here. `src/core/workers/textureWorker.ts` is the entry, spawned
  // from `src/core/workers/spawn.ts` — the only `new Worker(` in `src/` — and
  // `format: 'es'` is now load-bearing rather than aspirational: the worker
  // imports `src/core/surfaces.ts`, and a classic-format worker would inline
  // that whole graph instead of emitting it as a module.
  //
  // The generation code was split out of `src/core/assets.ts` into
  // `src/core/surfaces.ts` precisely so this chunk stays small: `surfaces.ts`
  // imports `./math` and nothing else, so the worker bundle carries no Three.js.
  // `tests/texture-workers.spec.ts` walks the import graph and fails if any bare
  // dependency ever appears in it.
  //
  // Generation still runs synchronously on the main thread whenever a worker is
  // unavailable, which includes every test in this repo (`test.environment` is
  // 'node'). That path is the fallback for every worker failure, so it is not
  // allowed to rot.
  worker: {
    format: 'es',
  },

  define: {
    // Dev-only assertions (write-ownership checks, heap canary, validation
    // spam) compile out of the production bundle entirely.
    __DEV__: JSON.stringify(command === 'serve'),

    // `window.__VM.version` is read by the screenshot harness and quoted in bug
    // reports, and it was hardcoded to '1.0.0' in `debug.ts` while package.json
    // had moved to 1.3.0 — a version string that silently stops being true is
    // the exact defect `docs/SPEC_DRIFT_AUDIT.md` catalogues. Derived now.
    __APP_VERSION__: JSON.stringify(PKG_VERSION),

    // KTX2Loader fetches its transcoder at runtime rather than importing it.
    // Before the workspace split `/node_modules/...` happened to resolve
    // because Vite's root was the repository root. The game now lives two
    // levels lower while npm correctly hoists Three, so that URL returned
    // index.html and four workers tried to parse HTML as JavaScript. `/@fs/`
    // is Vite's development-only route to the exact hoisted dependency; the
    // production value stays empty and cannot leak a machine path into dist.
    __BASIS_TRANSCODER_PATH__: JSON.stringify(command === 'serve' ? BASIS_DEV_PATH : ''),

    // A release contains one terrain-mask transport, never both. The PNG arm
    // is the canonical visual/performance control; KTX2 is the promoted
    // default. Rollup eliminates the unreachable dynamic import and therefore
    // proves the candidate's real package delta instead of hiding a second
    // 11.5 MB copy in dist.
    __TERRAIN_MASK_ARM__: JSON.stringify(TERRAIN_MASK_ARM),
  },

  esbuild: {
    target: 'es2022',
  },

  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    // OFF for the deployed bundle. This was on so that when a critic reported
    // "the water is black", the first move could be to read the actual shader
    // line in the built bundle. That is a DEV need, and `npm run dev` serves
    // unminified modules where it is moot; what it actually bought in `dist/`
    // was an 11.2 MB `.map` shipped beside a 2.4 MB bundle on every Pages
    // deploy, publishing full source for a debugging step nobody performs
    // against production.
    //
    // Players never paid for it — a `.map` is only fetched when devtools is
    // open — so this is a deploy-weight and source-exposure change, not a
    // load-time one. Do not "restore" it expecting a frame-rate difference.
    //
    // To debug a built bundle, build with it on locally:
    //   npx vite build --sourcemap
    sourcemap: false,
    assetsInlineLimit: 4096,
    // Three plus every procedural generator is legitimately a large bundle.
    chunkSizeWarningLimit: 3000,
    reportCompressedSize: false,
  },

  test: {
    environment: 'node',
    include: ['apps/game/tests/**/*.spec.ts'],
    /*
     * NEVER COLLECT OUT OF A GIT WORKTREE.
     *
     * `.claude/worktrees/` holds full second checkouts of this repo — the
     * isolation used so parallel agents can typecheck without seeing each
     * other's half-finished edits. Each carries a complete `tests/` directory,
     * and with eight of them attached there were 725 phantom spec files sitting
     * inside the project root.
     *
     * That is not theoretical. Two runs of an identical tree reported
     * "100 passed (100) / 2404" and then "95 passed (95) / 2397", and the
     * second was the true figure — the arithmetic reconciles exactly against
     * the merge. A test count that quietly inflates is worse than a failing
     * one: it is the number that goes into CLAUDE.md and into release notes as
     * evidence of coverage.
     *
     * Vitest's default excludes do not cover this, because the extra trees are
     * not `node_modules` and not `dist`. Excluding them explicitly is cheap and
     * it is a MECHANISM — remembering to prune worktrees before running the
     * suite is not one.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    // Determinism soak needs headroom.
    testTimeout: 120_000,
    /*
     * AND SO DO THE FIXTURES THAT BUILD ONE.
     *
     * `hookTimeout` was never chosen — it was vitest's 10 s default sitting
     * next to a deliberate 120 s `testTimeout`, which is the whole tell. Some
     * `beforeAll`s here build real content: `tests/roads.spec.ts` generates a
     * `Terrain` heightfield and a whole `RoadNetwork` on it, which takes ~3.4 s
     * on an idle machine and comfortably over 10 s when the pool is saturated.
     *
     * So the budget was measuring HOW BUSY THE BOX IS, not whether the code
     * works — the same defect CLAUDE.md writes up for the perf-hud counter that
     * "tracked V8's new-space size rather than the code, which is why it moved
     * with machine load". It surfaced the moment two more spec files joined the
     * pool: roads.spec passed alone in 10.1 s and timed out in a full run, and
     * the failure named a hook in a file nothing had touched.
     *
     * Matched to `testTimeout` rather than nudged: a fixture is not faster than
     * the test it feeds, and a number picked to be "just enough" is the same
     * bug again in a year.
     */
    hookTimeout: 120_000,
  },
}));
