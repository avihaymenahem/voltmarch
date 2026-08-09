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

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

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
   */
  origins: list('VM_ORIGINS', [
    'https://avihaymenahem.github.io',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
  ]),

  /** Set to '1' to accept any Origin. Development only; refuses to run with TLS off in prod. */
  allowAnyOrigin: process.env.VM_ALLOW_ANY_ORIGIN === '1',

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

  /** Ping interval. Two missed pongs terminates — kills slowloris and half-open sockets. */
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
