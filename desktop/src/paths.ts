/**
 * ============================================================================
 * VOLTMARCH desktop — src/paths.ts
 * ============================================================================
 * URL PATH -> FILE ON DISK, AND THE TRAVERSAL GUARD.
 *
 * This file imports NOTHING from electron, on purpose. It is the whole of the
 * protocol handler's decision-making, so it can be unit-tested in the ordinary
 * `npm test` gate with no Electron binary present — which matters more here
 * than it usually would, because `docs/ELECTRON_PLAN.md` §7 records that the
 * desktop target is deliberately outside CI. The only tests that will not rot
 * are the ones that need no Electron, so every decision lives in a module like
 * this one and `main.ts` is left with nothing to decide.
 *
 * It is also the security boundary. `protocol.handle` serves whatever path it
 * is given, and the renderer is the thing asking — so a `..` that escapes
 * `dist/` is arbitrary local file read. Tested as a guard, not as a mapper.
 * ============================================================================
 */

import path from 'node:path';

/** Extensions we set explicitly rather than letting Chromium sniff. */
const MIME = new Map<string, string>([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
]);

/**
 * The content type for a path, or `null` to let Chromium decide.
 *
 * `.js` and `.woff2` are the two that MUST be here. Chromium's
 * `net/base/mime_util.cc` maps `js,mjs` to `text/javascript` and `ogg,oga,opus`
 * to `audio/ogg`, but it has NO woff2 entry — and a wrong type on a module
 * script is fatal ("Expected a JavaScript module script but the server
 * responded with...") rather than cosmetic. Do not delete this map on the
 * grounds that sniffing covers it.
 */
export function contentTypeFor(filePath: string): string | null {
  return MIME.get(path.extname(filePath).toLowerCase()) ?? null;
}

/**
 * Resolve a request pathname against the served root.
 *
 * Returns `null` for anything that escapes the root — the caller answers 403.
 * `null` rather than a throw because a hostile URL is an expected input to a
 * handler serving a renderer, not an exceptional one.
 *
 * `root` must already be absolute. `urlPathname` is the `pathname` of a parsed
 * URL, so it is always `/`-prefixed and percent-encoded.
 */
export function resolveAsset(root: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    // A malformed percent-escape. Not a path we will ever serve.
    return null;
  }

  // A NUL byte truncates a path in some syscalls; refuse rather than normalise.
  if (decoded.includes('\0')) return null;

  const rel = decoded === '/' || decoded === '' ? '/index.html' : decoded;
  const abs = path.resolve(root, '.' + rel);

  // `path.resolve` has already collapsed `..`; this catches whatever still
  // landed outside. The `!== root` arm allows the root itself, which only
  // matters if someone serves a directory listing later.
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;

  return abs;
}
