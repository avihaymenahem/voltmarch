import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  legalComments: 'none',
};

await build({
  ...shared,
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/index.cjs', import.meta.url)),
});

// Keep the legacy on-host paths for one deployment cycle. The currently
// installed restricted deploy helper and systemd unit can activate this new
// self-contained bundle before a future bootstrap installs the shorter paths.
await mkdir(fileURLToPath(new URL('../dist/server/src/', import.meta.url)), { recursive: true });
await mkdir(fileURLToPath(new URL('../dist/src/net/', import.meta.url)), { recursive: true });
await copyFile(
  fileURLToPath(new URL('../dist/index.cjs', import.meta.url)),
  fileURLToPath(new URL('../dist/server/src/index.js', import.meta.url)),
);
await build({
  ...shared,
  entryPoints: [fileURLToPath(new URL('../../../packages/protocol/src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/protocol.cjs', import.meta.url)),
});

await copyFile(
  fileURLToPath(new URL('../dist/protocol.cjs', import.meta.url)),
  fileURLToPath(new URL('../dist/src/net/protocol.js', import.meta.url)),
);
