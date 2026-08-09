/**
 * ============================================================================
 * server/test/address.spec.ts — who a connection belongs to
 * ============================================================================
 * Every per-address limit in the relay — the connection cap and the join-rate
 * limit that is the sole defence on a six-character invite code — is exactly as
 * good as this function's answer. There are two ways to get it wrong and both
 * were live in the code at once:
 *
 *   IGNORING the header collapses every address into 127.0.0.1 behind nginx,
 *   so the caps become global and protect nobody.
 *
 *   TRUSTING the header lets any direct client mint a new identity per request
 *   and evade the caps entirely.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clientAddress } from '../src/address';

const TRUSTED = ['127.0.0.1', '::1'];

/** A minimal upgrade request. */
function req(peer: string, headers: Record<string, string | string[]> = {}) {
  return { headers, socket: { remoteAddress: peer } } as never;
}

describe('clientAddress', () => {
  it('uses the socket peer when nothing is trusted', () => {
    assert.equal(clientAddress(req('203.0.113.9'), []), '203.0.113.9');
  });

  it('IGNORES a forwarded header from an untrusted peer', () => {
    // The evasion: a direct client claiming to be somebody else, once per
    // request, defeating every per-address limit in the server.
    const r = req('203.0.113.9', { 'x-real-ip': '10.0.0.1', 'x-forwarded-for': '10.0.0.2' });
    assert.equal(clientAddress(r, TRUSTED), '203.0.113.9');
  });

  it('HONOURS x-real-ip from a trusted proxy', () => {
    // Without this, every player behind the documented nginx shares one bucket.
    const r = req('127.0.0.1', { 'x-real-ip': '198.51.100.7' });
    assert.equal(clientAddress(r, TRUSTED), '198.51.100.7');
  });

  it('takes the LEFTMOST x-forwarded-for entry, not the last', () => {
    // The left end is what the nearest proxy observed. The right end is
    // whatever the client appended before it arrived.
    const r = req('127.0.0.1', { 'x-forwarded-for': '198.51.100.7, 10.0.0.1, 10.0.0.2' });
    assert.equal(clientAddress(r, TRUSTED), '198.51.100.7');
  });

  it('prefers x-real-ip over x-forwarded-for', () => {
    const r = req('127.0.0.1', { 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '10.0.0.1' });
    assert.equal(clientAddress(r, TRUSTED), '198.51.100.7');
  });

  it('falls back to the peer when a trusted proxy sends no header', () => {
    assert.equal(clientAddress(req('127.0.0.1'), TRUSTED), '127.0.0.1');
  });

  it('refuses an empty or oversized header value', () => {
    // A header is a Map key here; an unbounded one is a memory primitive.
    assert.equal(clientAddress(req('127.0.0.1', { 'x-real-ip': '' }), TRUSTED), '127.0.0.1');
    assert.equal(clientAddress(req('127.0.0.1', { 'x-real-ip': 'a'.repeat(500) }), TRUSTED), '127.0.0.1');
  });

  it('survives a repeated header, which node surfaces as an array', () => {
    const r = req('127.0.0.1', { 'x-real-ip': ['198.51.100.7', '10.0.0.1'] });
    assert.equal(clientAddress(r, TRUSTED), '198.51.100.7');
  });

  it('survives a socket with no address at all', () => {
    const r = { headers: {}, socket: {} } as never;
    assert.equal(clientAddress(r, TRUSTED), '');
  });

  it('does not treat an untrusted proxy as trusted by prefix', () => {
    // '127.0.0.1.evil.example' must not match '127.0.0.1'.
    const r = req('127.0.0.1.evil.example', { 'x-real-ip': '10.0.0.1' });
    assert.equal(clientAddress(r, TRUSTED), '127.0.0.1.evil.example');
  });
});
