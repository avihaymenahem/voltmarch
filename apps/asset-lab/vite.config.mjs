import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MONOREPO_ROOT = resolve(ROOT, '../..');
const BASIS_SOURCE = resolve(MONOREPO_ROOT, 'node_modules/three/examples/jsm/libs/basis');
const BASIS_DEV_PATH = `/@fs/${BASIS_SOURCE.replace(/\\/g, '/')}/`;

export default defineConfig(({ command }) => ({
  base: './',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 4319,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(ROOT)] },
  },
  define: {
    // Production uses KTX2Loader's import-relative URLs so Vite emits one
    // hashed transcoder pair. A second copied /basis pair added 584,862 bytes
    // to every distribution without changing first-transcode transfer.
    __ASSET_LAB_BASIS_PATH__: JSON.stringify(command === 'serve' ? BASIS_DEV_PATH : ''),
  },
  build: {
    target: 'esnext',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: resolve(ROOT, 'index.html'),
        infantry: resolve(ROOT, 'infantry.html'),
      },
    },
    reportCompressedSize: false,
    chunkSizeWarningLimit: 3000,
  },
}));
