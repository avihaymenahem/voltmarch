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

  // There are no Web Workers in this project. This block used to claim texture
  // generation ran in one, citing `src/render/textures/TextureWorker.ts` — a path
  // that has never existed; `src/render/` has no `textures/` directory and there
  // is not a single `new Worker(` in `src/`. Texture generation is synchronous in
  // `src/core/assets.ts`. The setting is kept and the comment corrected rather than
  // both deleted: `format: 'es'` is the right default the day a worker does land,
  // and a reader who trusted the old comment would go looking for a file to edit.
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
    // Determinism soak needs headroom.
    testTimeout: 120_000,
  },
}));
