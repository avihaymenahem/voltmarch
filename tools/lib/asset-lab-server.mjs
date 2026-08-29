import path from 'node:path';
import { serve } from './serve.mjs';

/** Start an owned Asset Lab Vite process and pre-transform the requested entry. */
export async function startAssetLabDevServer(root, entry = 'asset-lab') {
  const server = await serve({
    root,
    appRoot: path.join(root, 'apps', 'asset-lab'),
    mode: 'dev',
    portHint: 4319,
  });
  const modulePath = entry === 'infantry' ? 'src/infantry.mjs' : 'src/asset-lab.mjs';
  const response = await fetch(new URL(modulePath, server.origin));
  if (!response.ok) {
    server.stop();
    throw new Error(`Asset Lab dev prewarm failed (${response.status} ${response.statusText}) for ${modulePath}`);
  }
  await response.arrayBuffer();
  return server;
}
