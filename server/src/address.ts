/**
 * ============================================================================
 * server/src/address.ts — which address a connection belongs to
 * ============================================================================
 * Extracted from `index.ts` for one reason: `index.ts` starts a WebSocket
 * server the moment it is imported, so nothing in it can be unit tested. This
 * is the single most security-critical function in the relay — every per-address
 * limit is only as good as its answer — so it lives where a test can reach it.
 *
 * ── THE TWO WAYS TO GET THIS WRONG, AND BOTH WERE LIVE ─────────────────────
 *
 * 1. IGNORE THE HEADER. Behind the nginx in `deploy/nginx.conf` every socket
 *    arrives from 127.0.0.1, so `remoteAddress` is the SAME VALUE for the whole
 *    internet. The 8-connections-per-address cap becomes a global cap of 8 —
 *    the ninth player anywhere is refused — and the 10-joins-per-minute limit
 *    becomes 10 joins per minute for all players combined. Every limit reads as
 *    working and protects nothing. This is what shipped.
 *
 * 2. TRUST THE HEADER. `X-Real-IP` is a client-supplied string. Honouring it on
 *    a direct connection lets anyone send a different one per request and mint
 *    a fresh identity at will, which evades every per-address limit there is —
 *    strictly worse than having none, because the counters still look busy.
 *
 * The only correct rule is the conjunction: honour the header, and only from a
 * socket peer that is itself a trusted proxy.
 * ============================================================================
 */

import type { IncomingMessage } from 'node:http';

/** Longest plausible address. Bounds what a proxy can push into a Map key. */
const MAX_ADDRESS_LEN = 64;

function usable(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ADDRESS_LEN;
}

/**
 * The address to attribute a connection to.
 *
 * `trustedProxies` is the list of socket peers whose forwarding headers are
 * believed. An empty list means "trust nothing", which is the right default for
 * a relay exposed directly.
 *
 * `X-Forwarded-For` is a comma-separated chain and the LEFTMOST entry is the
 * one the nearest proxy observed. Reading the last would read whatever the
 * client appended.
 */
export function clientAddress(
  req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string | undefined } },
  trustedProxies: readonly string[],
): string {
  const peer = req.socket.remoteAddress ?? '';
  if (!trustedProxies.includes(peer)) return peer;

  const real = req.headers['x-real-ip'];
  const realOne = Array.isArray(real) ? real[0] : real;
  if (usable(realOne)) return realOne.trim();

  const fwd = req.headers['x-forwarded-for'];
  const chain = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof chain === 'string') {
    const first = chain.split(',')[0]?.trim();
    if (usable(first)) return first;
  }
  return peer;
}

/**
 * The key every per-address limit is counted against.
 *
 * ── AN IPv6 ADDRESS IS NOT AN IDENTITY; A PREFIX IS ────────────────────────
 *
 * `clientAddress` answers WHICH address a connection came from, and that is the
 * right answer to that question. It is the wrong thing to COUNT, because the
 * smallest IPv6 allocation a residential or hosting customer receives is a /64
 * — 1.8e19 addresses, every one of them a distinct `remoteAddress` and every
 * one of them the same person. So `maxConnectionsPerIp` 8 becomes 8 per
 * ADDRESS, and 63 addresses out of one ordinary /64 is 504 sockets, past the
 * global `maxConnections` of 500. Measured on a real relay at
 * VM_MAX_CONNECTIONS=6 / VM_MAX_CONNECTIONS_PER_IP=2: three addresses inside one
 * /64 held six sockets, and a legitimate player on an unrelated network was
 * then refused 401. The same arithmetic frees the join limit that is the ENTIRE
 * defence on a six-character invite code.
 *
 * nginx does not bind either: `limit_conn_zone $binary_remote_addr` is the full
 * 16 bytes for IPv6, so the edge counts per /128 as well.
 *
 * The codebase already knew the premise — `Bucket.spent`'s comment calls
 * reaching many distinct addresses "trivial on IPv6" — and applied it to the
 * eviction path while leaving the keying alone. This is the other half.
 *
 * IPv4 IS UNTOUCHED, and so is an IPv4-mapped address (`::ffff:1.2.3.4`), which
 * is an IPv4 address wearing IPv6 syntax: grouping those would merge unrelated
 * customers. Anything unparseable falls back to the address itself, which is
 * the strictest available answer rather than the loosest.
 */
export function limitKey(address: string, ipv6PrefixBits: number): string {
  return ipv6Prefix(address, ipv6PrefixBits) ?? address;
}

/**
 * `address` reduced to its first `bits`, or null when it is not a real IPv6
 * address. Rendered as `a:b:c:d:0:0:0:0/bits` — a key, not an address, and
 * deliberately not re-parseable as one.
 */
function ipv6Prefix(address: string, bits: number): string | null {
  if (!Number.isInteger(bits) || bits < 1 || bits > 128) return null;
  // A link-local address may carry a zone (`fe80::1%eth0`). Not part of the
  // address, and it must not become part of the key.
  const zone = address.indexOf('%');
  const bare = zone >= 0 ? address.slice(0, zone) : address;
  if (!bare.includes(':')) return null;
  // `::ffff:203.0.113.9` and `::203.0.113.9` are IPv4. Leave them alone.
  if (/\d+\.\d+\.\d+\.\d+$/.test(bare)) return null;

  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  let parts: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    parts = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  } else {
    if (head.length !== 8) return null;
    parts = head;
  }

  const whole = Math.floor(bits / 16);
  const partial = bits % 16;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = parts[i] ?? '';
    if (!/^[0-9a-fA-F]{1,4}$/.test(raw)) return null;
    const h = Number.parseInt(raw, 16);
    if (i < whole) out.push(h.toString(16));
    else if (i === whole && partial > 0) out.push(((h >>> (16 - partial)) << (16 - partial)).toString(16));
    else out.push('0');
  }
  return `${out.join(':')}/${bits}`;
}
