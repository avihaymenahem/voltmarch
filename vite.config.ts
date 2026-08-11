/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

/** The one version number. Everything else must derive from it, never restate it. */
const PKG_VERSION: string = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version;

/**
 * VOLTMARCH build config.
 *
 * DELIBERATELY PLUGIN-FREE.
 *
 * There is no type-checking plugin here and there must never be one: esbuild
 * strips types, so a stray type error in one of ~15 parallel modules must never
 * be able to stop the game from running. `tsc --noEmit` is a separate gate
 * (`npm run typecheck`), not part of `npm run build`.
 */
export default defineConfig(({ command }) => ({
  // Relative base so the built bundle runs from a file:// path or any subdir -
  // the screenshot harness serves it from an arbitrary root.
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    strictPort: true,
    open: false,
  },

  preview: {
    // Matches the port tools/shoot.mjs serves the built bundle on.
    port: 4317,
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
    include: ['tests/**/*.spec.ts'],
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
