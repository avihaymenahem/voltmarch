/**
 * VOLTMARCH desktop — build the main process and the preload.
 *
 * The renderer is NOT built here. It is the root `npm run build` (`vite build`)
 * output, used verbatim, so that the desktop and web targets are the same
 * bytes. That is the whole coexistence design — see the Electron plan §2.
 *
 * Two bundles, both CommonJS, for two different reasons:
 *   main    — CJS because `registerSchemesAsPrivileged` and every appendSwitch
 *             must run before the `ready` event, and ESM module evaluation is
 *             asynchronous relative to app startup.
 *   preload — CJS because Electron runs SANDBOXED preloads "as plain JavaScript
 *             without an ESM context", so an `import` there is a syntax error.
 *
 * WHY NO STANDARD ELECTRON+VITE INTEGRATION — folded in when the Electron plan was deleted.
 *
 * `desktop/build.mjs`'s header says the renderer is not built there. Add why none of the
 * standard integrations were used, because it will be proposed again: **electron-vite**
 * *replaces* `vite build` and takes ownership of the renderer, which is the one thing that must
 * not move if `dist/` is to stay byte-for-byte the shared client artifact. **Electron Forge's Vite
 * plugin** is still marked experimental and mandates three config files plus a `main` pointing
 * into `.vite/build`. **vite-plugin-electron** is a direct violation of the plugin-free rule
 * stated in `vite.config.ts`. The main process here is small and imports only `electron`, so
 * the correct seam is `vite build` unchanged plus a ~15-line standalone esbuild call — which is
 * what this file is.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * PATHS RESOLVE FROM THIS FILE, NOT FROM THE CALLER'S CWD.
 *
 * They were relative, and the repo root has a `src/main.ts` too — the GAME's
 * entry point. So `node desktop/build.mjs` from the root pointed esbuild at
 * the wrong `src/main.ts` and started bundling the whole game into the Electron
 * main process. It announced itself only as a wall of `import.meta is not
 * available with the "cjs" output format` warnings, which read as a config
 * nit rather than "you are building the wrong program". `npm run desktop:build`
 * happened to set the cwd correctly, so this was invisible until it wasn't.
 *
 * Same fix, and the same reason, as the one `tools/brand.mjs` documents.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'info',
  sourcemap: true,
};

await build({
  ...common,
  entryPoints: [path.join(HERE, 'src', 'main.ts')],
  outfile: path.join(HERE, 'out', 'main.js'),
});
await build({
  ...common,
  entryPoints: [path.join(HERE, 'src', 'preload.ts')],
  outfile: path.join(HERE, 'out', 'preload.js'),
});
