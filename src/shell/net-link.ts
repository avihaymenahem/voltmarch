/**
 * ============================================================================
 * src/shell/net-link.ts — where the relay is, and whether there is one
 * ============================================================================
 * The game is a static bundle on GitHub Pages; the relay is a process on a VPS
 * somewhere else. Nothing in the build knows that address, so it is configured
 * rather than assumed — and when it is NOT configured, multiplayer says so
 * plainly instead of failing with a socket error nobody can act on.
 *
 * Resolution order, most specific first:
 *
 *   1. `?relay=` on the URL          — one match against a test server
 *   2. `localStorage` override        — a developer's own box, persistently
 *   3. `VITE_RELAY_URL` at build time — how a real deployment sets it
 *   4. localhost default              — `npm run dev` + `npm run server`
 *   5. nothing                        — the menu entry says "not configured"
 *
 * ── THE SCHEME IS CHECKED, NOT ASSUMED ─────────────────────────────────────
 *
 * A page served over https cannot open a `ws://` socket — the browser blocks it
 * as mixed content, and the error it reports points at the socket rather than
 * at the configuration. So a plaintext URL is refused HERE, where the message
 * can say what is actually wrong, unless the page itself is plaintext (which
 * only happens on localhost).
 * ============================================================================
 */

import { CODE_LENGTH, PROTOCOL_VERSION } from '../net/protocol';
import { persistentStorage } from '../platform/storage';

/** Length of an invite code, for the input's `maxLength`. */
export const CODE_LENGTH_HINT = CODE_LENGTH;

const STORAGE_KEY = 'vm.relayUrl';

/** Build-time configuration. Set `VITE_RELAY_URL` when deploying. */
function fromBuild(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_RELAY_URL ?? '';
}

function fromQuery(): string {
  if (typeof location === 'undefined') return '';
  return new URLSearchParams(location.search).get('relay') ?? '';
}

function fromStorage(): string {
  try {
    return persistentStorage().getItem(STORAGE_KEY) ?? '';
  } catch {
    // Private mode, or storage disabled. Not worth reporting.
    return '';
  }
}

/** True when the page itself is insecure, i.e. a local dev server. */
function pageIsPlaintext(): boolean {
  return typeof location !== 'undefined' && location.protocol !== 'https:';
}

function localDefault(): string {
  if (typeof location === 'undefined') return '';
  const host = location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return '';
  return 'ws://localhost:8787/ws';
}

/**
 * The relay URL, or '' when multiplayer is not configured for this build.
 *
 * Returns '' rather than throwing so the menu can offer a disabled entry with
 * an explanation, which is more useful than an option that appears to work.
 */
export function relayUrl(): string {
  const raw = fromQuery() || fromStorage() || fromBuild() || localDefault();
  if (raw === '') return '';
  if (!/^wss?:\/\//.test(raw)) return '';
  // See the header: refuse plaintext from a secure page here, where the reason
  // can be stated, rather than letting the browser block it at connect time.
  if (raw.startsWith('ws://') && !pageIsPlaintext()) return '';
  return raw;
}

/** True when a relay is configured and reachable in principle. */
export function multiplayerAvailable(): boolean {
  return relayUrl() !== '';
}

/**
 * Why multiplayer is unavailable, for the menu to show.
 *
 * Separate from `relayUrl()` because the two answers differ: an unset URL and a
 * `ws://` URL on an https page are both "unavailable", and only one of them is
 * something the player can do anything about.
 */
export function unavailableReason(): string {
  const raw = fromQuery() || fromStorage() || fromBuild() || localDefault();
  // SHORT, because it renders as a menu-row hint beside a label. The long
  // form ran to 305 px and squeezed the row's label to zero width, where a
  // flex item overflows its text rather than clipping it — so this sentence
  // was painted over the word "Multiplayer". The CSS refuses to collapse the
  // label now; this keeps the row from needing the ellipsis in the first place.
  if (raw === '') return 'No match server configured';
  if (!/^wss?:\/\//.test(raw)) return 'The configured match server address is not a WebSocket URL.';
  if (raw.startsWith('ws://') && !pageIsPlaintext()) {
    return 'The match server must use wss:// when the game is served over https.';
  }
  return '';
}

/** Point this build at a relay, persistently. Used from the console. */
export function setRelayUrl(url: string): void {
  try {
    if (url === '') persistentStorage().removeItem(STORAGE_KEY);
    else persistentStorage().setItem(STORAGE_KEY, url);
  } catch {
    // Nothing to do; the query flag still works.
  }
  reachable = null;
}

/* ==========================================================================
 * REACHABILITY
 *
 * A CONFIGURED URL IS NOT A RUNNING SERVER, and offering Multiplayer on the
 * strength of a string in `localStorage` sends the player into a lobby that
 * spins on "Connecting…" until they give up. The menu asks the relay whether it
 * is there before it offers the entry.
 *
 * The probe is a REAL HANDSHAKE, not a TCP connect: it opens the socket, sends
 * `hello`, and waits for `welcome`. That is the only check that distinguishes
 * "something is listening on that port" from "the relay is up, speaks our
 * protocol version, and accepts this build" — which are exactly the failures
 * worth catching before the player commits to the screen.
 * ========================================================================== */

const PROBE_TIMEOUT_MS = 4000;
/** How long a verdict is trusted. Long enough not to probe on every menu open. */
const PROBE_TTL_MS = 60_000;

let reachable: { ok: boolean; at: number } | null = null;
let inFlight: Promise<boolean> | null = null;

/** The last known verdict without probing: true, false, or null for unknown. */
export function relayKnownReachable(): boolean | null {
  if (reachable === null) return null;
  if (Date.now() - reachable.at > PROBE_TTL_MS) return null;
  return reachable.ok;
}

/**
 * Ask the relay whether it is there. Cached, and never more than one at a time.
 *
 * Resolves false rather than rejecting for every failure mode — unreachable,
 * refused, wrong protocol, timed out. A menu cannot act on an exception, and
 * every one of those means the same thing to a player.
 */
export async function probeRelay(): Promise<boolean> {
  const cached = relayKnownReachable();
  if (cached !== null) return cached;
  if (inFlight !== null) return inFlight;

  const url = relayUrl();
  if (url === '') { reachable = { ok: false, at: Date.now() }; return false; }

  inFlight = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean, ws?: WebSocket): void => {
      if (done) return;
      done = true;
      reachable = { ok, at: Date.now() };
      inFlight = null;
      try { ws?.close(); } catch { /* already gone */ }
      resolve(ok);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // A malformed URL throws synchronously in some browsers.
      finish(false);
      return;
    }

    const timer = setTimeout(() => { finish(false, ws); }, PROBE_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      // The protocol version travels with the greeting, so a relay that is up
      // but incompatible answers with an error rather than a welcome — and this
      // reports it as unreachable, which is what it is from here.
      ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, build: buildId() }));
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      clearTimeout(timer);
      let ok = false;
      try {
        const msg: unknown = JSON.parse(String(ev.data));
        ok = typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'welcome';
      } catch {
        ok = false;
      }
      finish(ok, ws);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); finish(false, ws); });
    ws.addEventListener('close', () => { clearTimeout(timer); finish(false); });
  });

  return inFlight;
}

/** Forget the cached verdict, so the next ask probes again. */
export function forgetRelayProbe(): void {
  reachable = null;
}

declare const __APP_VERSION__: string;

function buildId(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
}
