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
 * ── THE TRANSPORT IS CHECKED HERE, AND IT IS ABOUT THE TARGET ──────────────
 *
 * A page served over https cannot open a `ws://` socket — the browser blocks it
 * as mixed content, and the error it reports points at the socket rather than
 * at the configuration. So a plaintext URL is refused HERE, where the message
 * can say what is actually wrong.
 *
 * THE PREDICATE USED TO BE "IS THIS PAGE PLAINTEXT", AND THE DESKTOP BUILD
 * BROKE IT. `pageIsPlaintext()` tested `location.protocol !== 'https:'`, which
 * was a correct proxy for "the browser will not stop me" on the only target
 * that existed. The packaged desktop build is served from `app://voltmarch`, and
 * measured on a real launch: `location.protocol` is `app:` while
 * `window.isSecureContext` is TRUE. The two inverted. So the guard read a
 * genuinely secure page as plaintext, the shipped client accepted
 * `ws://relay.example.com/ws` for a PUBLIC host, greeted it, and enabled the
 * Multiplayer row with no warning anywhere.
 *
 * That wire carries an invite code in cleartext and a command stream the relay
 * stamps with the sender's slot, so a path attacker on it can read the code,
 * inject well-formed orders that BOTH clients then agree on (the desync
 * detector — this project's anti-cheat — cannot see an injection both sides
 * receive), or simply be the relay.
 *
 * The question is not what scheme the PAGE uses; it is whether the socket
 * crosses a network. `ws://` is accepted only to a loopback target, which is
 * what a developer running `npm run server` actually needs and is the one case
 * with no network to attack. Everything else must be `wss://`. That covers the
 * browser rule too, which is why there is no longer a separate one.
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

/**
 * True when `raw` is a plaintext socket to somewhere other than this machine.
 *
 * The whole transport rule, and it reads the TARGET rather than the page — see
 * the header for the desktop build that made the difference matter. The host
 * test is the twin of `desktop/src/app-url.ts#isLoopbackHost`; both are
 * deliberately literal, because a hostname that merely CONTAINS "localhost"
 * (`localhost.evil.com`) resolves wherever its owner points it.
 *
 * An unparseable URL answers TRUE — refuse. `relayUrl` has already checked the
 * scheme by the time this runs, so reaching the catch means something stranger
 * than a typo.
 */
function crossesTheNetworkInClear(raw: string): boolean {
  if (!raw.startsWith('ws://')) return false;
  try {
    const h = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    return !(h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h));
  } catch {
    return true;
  }
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
  // See the header: refuse a plaintext socket to a REMOTE host here, where the
  // reason can be stated, rather than letting the browser block it at connect
  // time — or, on the desktop target, letting it succeed.
  if (crossesTheNetworkInClear(raw)) return '';
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
  if (crossesTheNetworkInClear(raw)) {
    return 'A match server on another host must use wss://, not ws://.';
  }
  return '';
}

/*
 * `setRelayUrl` USED TO LIVE HERE AND IS DELETED. Its doc comment read "Used
 * from the console", and it had exactly one reference tree-wide — its own
 * definition. On the web build that made it dead code the bundler removed:
 * `dist/assets/Shell-*.js` holds the READ of `vm.relayUrl` and contains no
 * `setItem` for it at all, so the console route it named had already stopped
 * existing. On the desktop build there is no console to use it from — the
 * application menu is nulled and no devtools accelerator is bound, verified by
 * pressing all four and reading `isDevToolsOpened()`.
 *
 * The storage key itself is unchanged and still read by `fromStorage` above, so
 * the route that DOES work is untouched: write `values["vm.relayUrl"]` into
 * `userData/storage/state.json` (desktop) or `localStorage` (web), or pass
 * `?relay=`. A dead function with a comment naming a route that does not exist
 * is worse than no function, because it reads as a supported affordance.
 */

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
