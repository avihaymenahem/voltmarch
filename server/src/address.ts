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
