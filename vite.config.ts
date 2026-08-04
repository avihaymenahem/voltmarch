/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

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

  // Texture generation runs in a Web Worker (src/render/textures/TextureWorker.ts).
  // ES module workers keep the generator registry importable from both sides.
  worker: {
    format: 'es',
  },

  define: {
    // Dev-only assertions (write-ownership checks, heap canary, validation
    // spam) compile out of the production bundle entirely.
    __DEV__: JSON.stringify(command === 'serve'),
  },

  esbuild: {
    target: 'es2022',
  },

  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    // On by default here: when a critic reports "the water is black", the first
    // move is to read the actual shader line in the built bundle.
    sourcemap: true,
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
