/**
 * ============================================================================
 * server/src/config.ts — every limit, in one place, with its reason
 * ============================================================================
 * A public WebSocket endpoint with no authentication has exactly one defence
 * against being used as a resource: hard caps on everything, all of them
 * counted. So they are collected here rather than scattered through the code,
 * because a limit you cannot find is a limit nobody tunes and everybody
 * assumes is stricter than it is.
 *
 * EVERY VALUE IS OVERRIDABLE BY ENVIRONMENT, and every default is chosen to be
 * far above legitimate play and far below what hurts. The numbers in the
 * comments are the arithmetic, not a guess.
 * ============================================================================
 */

/**
 * A positive integer from the environment, or the default — and a REFUSAL for
 * anything else.
 *
 * IT USED TO FALL BACK SILENTLY, ALWAYS TOWARD LESS RESTRICTION. Measured:
 * `VM_MAX_CONNECTIONS_PER_IP=0` gave 8, `VM_MAX_CONNECTIONS=-5` gave 500,
 * `VM_HEARTBEAT_MS=abc` gave 15000. Every one of those is an operator who
 * believes they tightened a limit and did not, with nothing printed and nothing
 * to look at — which is the "limits that appeared to be enforced and were not"
 * pattern this server's own audit table says was four of its six original
 * defects. A typo in a unit file is invisible; a process that will not start is
 * not. `Restart=always` plus `StartLimitBurst` turns that into five restarts and
 * a journal line naming the variable, which is the correct outcome for a
 * misconfiguration at deploy time.
 *
 * Note that 0 is refused rather than accepted: every value here is a CAP, and a
 * cap of zero would refuse all play. Where "off" is meaningful the sentinel is
 * documented on the field itself.
 */
export function parseCount(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || Math.floor(v) !== v) {
    throw new Error(`[relay] ${name}=${JSON.stringify(raw)} is not a positive integer`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  return parseCount(name, process.env[name], fallback);
}

/**
 * A comma-separated list from the environment, or the default.
 *
 * IT REPLACES THE DEFAULT, IT DOES NOT EXTEND IT, and that has bitten once
 * already — the shipped systemd unit sets `VM_ORIGINS` to a single entry, so the
 * compiled fallback list is gone entirely on the deployed relay. Measured:
 * `http://localhost:5173` is in the fallback array and returned 401 under that
 * environment.
 *
 * `none` IS THE EMPTY LIST. Without it an empty list is inexpressible — the
 * empty string is indistinguishable from an unset variable — so an operator who
 * wanted `VM_TRUSTED_PROXIES` cleared (the correct setting for a relay exposed
 * directly, and the one `address.ts` documents) silently got the three loopback
 * entries back.
 */
export function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw === '') return fallback;
  if (raw.trim().toLowerCase() === 'none') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function list(name: string, fallback: string[]): string[] {
  return parseList(process.env[name], fallback);
}

/**
 * The desktop build's origin, which no operator can be expected to know.
 *
 * `desktop/src/app-url.ts` registers `app://voltmarch` as a privileged scheme
 * and every window in the packaged build is served from it, so Chromium stamps
 * exactly this string on the WebSocket handshake — measured on a real Electron
 * launch, no trailing slash, and `app://voltmarch/` WITH one is a different
 * origin that is refused. It cannot be imported: `server/tsconfig.json`'s
 * include list is the security boundary and sees four files, so the literal is
 * duplicated here and `tests/desktop-origin.spec.ts` compares the two by text —
 * the same mechanism the desktop bridge version uses for the same reason.
 *
 * ALWAYS PRESENT, NEVER ONLY A DEFAULT. `VM_ORIGINS` replaces the fallback
 * list, so an entry that lived only there would be dropped by the shipped unit
 * file and the packaged desktop build would be refused at the handshake — 401,
 * before the upgrade, reported to the player as "the match server is not
 * answering". It costs nothing to allow: `app:` is not a scheme any browser can
 * mint, the whole point of the `Origin` check is the browser-driven case, and
 * `https://evil.example` is still refused (measured).
 */
export const DESKTOP_ORIGIN = 'app://voltmarch';

/** The canonical browser build; VM_ORIGINS must never remove it. */
export const PUBLIC_WEB_ORIGIN = 'https://play.voltmarch.com';

export const CONFIG = {
  /** Bind address. LOOPBACK BY DEFAULT — nginx is the only thing that should reach this. */
  host: process.env.VM_HOST ?? '127.0.0.1',
  port: num('VM_PORT', 8787),

  /**
   * Origins allowed to open a socket.
   *
   * WebSockets are NOT subject to CORS, and `ws` does not check `Origin` on its
   * own — without this, any page on the internet can open a socket here on a
   * visitor's behalf. Stated honestly: `Origin` is trivially forged by anything
   * that is not a browser, so this is anti-CSWSH hygiene and NOT
   * authentication. It costs nothing and closes the browser-driven case.
   *
   * The reason there is nothing worth stealing through such a socket is the
   * other half: this server sets no cookies and reads no credentials, so a
   * cross-site connection is an anonymous connection with no privileges.
   *
   * `DESKTOP_ORIGIN` is unioned in rather than listed as a default, because
   * `VM_ORIGINS` REPLACES the default. See its own comment.
   */
  origins: [DESKTOP_ORIGIN, PUBLIC_WEB_ORIGIN, ...list('VM_ORIGINS', [
    PUBLIC_WEB_ORIGIN,
    'https://avihaymenahem.github.io',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
  ]).filter((o) => o !== DESKTOP_ORIGIN && o !== PUBLIC_WEB_ORIGIN)],

  /**
   * Set to '1' to accept any `Origin`. DEVELOPMENT ONLY, and the process
   * refuses to start with it set when `NODE_ENV=production`.
   *
   * THIS COMMENT USED TO PROMISE SOMETHING UNIMPLEMENTABLE. It read "refuses to
   * run with TLS off in prod", and neither half was true: nothing refused
   * anything (the only other mention in the whole server is a `console.warn`,
   * and a relay started with `NODE_ENV=production VM_ALLOW_ANY_ORIGIN=1` was
   * measured accepting `Origin: https://attacker.example` with 101), and this
   * process CANNOT OBSERVE TLS at all — nginx terminates it one hop away and
   * `proxy_pass` is plain `http://` to loopback by design. A comment stating a
   * property the code does not implement is a defect in this repo, so one half
   * was implemented (`index.ts#assertConfigSafe`) and the unimplementable half
   * was deleted rather than restated.
   */
  allowAnyOrigin: process.env.VM_ALLOW_ANY_ORIGIN === '1',

  /** True when this is a production deployment. The systemd unit sets it. */
  production: process.env.NODE_ENV === 'production',

  /**
   * Trust `X-Real-IP` / `X-Forwarded-For` from these socket addresses.
   *
   * THIS IS THE DIFFERENCE BETWEEN HAVING PER-ADDRESS LIMITS AND NOT.
   *
   * Behind the nginx in `deploy/nginx.conf`, every connection arrives from
   * 127.0.0.1. Without this, `remoteAddress` is the SAME VALUE for the entire
   * internet: the 8-connections-per-address cap becomes a global cap of 8, and
   * the 10-joins-per-minute limit becomes 10 joins per minute for all players
   * combined. The rate limiting reads as working and protects nothing.
   *
   * AND IT MUST NOT BE UNCONDITIONAL. A forwarded header is a client-supplied
   * string; trusting one on a DIRECT connection lets anyone mint a fresh
   * identity per request and evade every per-address limit there is. So the
   * header is honoured only when the socket peer is itself a trusted proxy.
   */
  trustedProxies: list('VM_TRUSTED_PROXIES', ['127.0.0.1', '::1', '::ffff:127.0.0.1']),

  /**
   * The client build that may connect, or empty to accept any.
   *
   * ENFORCED, NOT ADVISORY — unlike `ReplayHeader.buildVersion`, which only
   * warns. GitHub Pages can serve a cached bundle to one player and a fresh one
   * to the other, and two different builds of a deterministic simulation desync
   * on contact. Refusing the pairing is a clear message; a desync forty seconds
   * in is not.
   */
  requireBuild: process.env.VM_REQUIRE_BUILD ?? '',

  /* -- resource caps ------------------------------------------------------ */

  /** Total concurrent sockets. Beyond this, new connections are closed at once. */
  maxConnections: num('VM_MAX_CONNECTIONS', 500),
  /** Concurrent sockets from one address. Generous: a household shares an IP. */
  maxConnectionsPerIp: num('VM_MAX_CONNECTIONS_PER_IP', 8),
  /**
   * How much of an IPv6 address a per-address limit is counted against.
   *
   * 64, because that is the smallest allocation a customer receives — see
   * `address.ts#limitKey` for the arithmetic and the measurement. IPv4 and
   * IPv4-mapped addresses are unaffected at any setting. Set to **128** to count
   * per exact address, which is the behaviour that shipped and which a single
   * host can walk out of 1.8e19 ways.
   */
  ipv6PrefixBits: num('VM_IPV6_PREFIX_BITS', 64),
  /** Live matches. Each is two sockets and a few turns of buffer. */
  maxMatches: num('VM_MAX_MATCHES', 200),

  /**
   * Messages per second per socket, and the burst it may bank.
   *
   * A healthy client sends 10 turn frames a second, one per turn. 40 is four
   * times that; 80 of burst absorbs a client catching up after a hiccup without
   * ever approaching a rate that costs the server anything.
   */
  messageRate: num('VM_MESSAGE_RATE', 40),
  messageBurst: num('VM_MESSAGE_BURST', 80),

  /** Join-by-code attempts per address per minute. This is what makes a 6-character code safe. */
  joinAttemptsPerMinute: num('VM_JOIN_ATTEMPTS_PER_MINUTE', 10),

  /* -- lifetimes ---------------------------------------------------------- */

  /**
   * Ping interval. ONE missed pong terminates — kills slowloris and half-open
   * sockets.
   *
   * This said "two missed pongs" and the sweep in `index.ts` terminates on the
   * first: `alive` is cleared immediately after each ping and a pong is the only
   * thing that sets it. Measured at `VM_HEARTBEAT_MS=1500` — one ping at +692 ms,
   * socket closed by the server at +2201 ms. The distinction is not academic:
   * this is the number an operator sizes `proxy_read_timeout` against, and the
   * real dead-peer detection window is 30 s, not 45 s.
   */
  heartbeatMs: num('VM_HEARTBEAT_MS', 15_000),
  /** A socket that connects and then does nothing. */
  lobbyIdleMs: num('VM_LOBBY_IDLE_MS', 60_000),
  /** An unjoined invite code stops working after this. */
  codeTtlMs: num('VM_CODE_TTL_MS', 10 * 60_000),
  /** Hard ceiling on a single match. Nothing legitimate runs this long. */
  matchTtlMs: num('VM_MATCH_TTL_MS', 2 * 60 * 60_000),
  /** How long the survivor waits before the match is awarded to them. */
  graceMs: num('VM_GRACE_MS', 30_000),
  /**
   * How long a slot may go without submitting a turn before it is treated as
   * disconnected.
   *
   * The grace timer only starts when a SOCKET CLOSES. A client that stops
   * submitting while still answering pings — hung, suspended, or deliberately
   * holding its opponent hostage — froze the other player at a turn boundary
   * until the two-hour match TTL. A healthy client submits ten times a second,
   * so 15 s is three orders of magnitude of slack.
   */
  silenceMs: num('VM_SILENCE_MS', 15_000),

  /** Bytes. `ws` closes the socket rather than buffering past this. */
  maxPayloadBytes: num('VM_MAX_PAYLOAD', 64 * 1024),
} as const;

/**
 * The code alphabet and length live in the SHARED protocol module, not here.
 *
 * Both ends need them — the relay generates a code, and the lobby checks what
 * was typed before spending a round trip and one of the player's ten
 * join attempts a minute being told it was a typo. Two copies of an alphabet
 * would eventually differ by one character and produce codes one side rejects.
 */
export { CODE_ALPHABET, CODE_LENGTH } from '../../src/net/protocol';
