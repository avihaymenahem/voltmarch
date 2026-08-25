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

import { clientAddress, limitKey } from '../src/address';

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

/* ==========================================================================
 * WHAT A LIMIT IS COUNTED AGAINST
 * ========================================================================== */

describe('limitKey groups IPv6 so a prefix cannot walk out of every cap', () => {
  /**
   * `clientAddress` answers WHICH address a connection came from, correctly.
   * That is the wrong thing to COUNT: the smallest IPv6 allocation a customer
   * gets is a /64, so `maxConnectionsPerIp` 8 was 8 per /128 and 63 addresses
   * out of one ordinary /64 is 504 sockets — past the GLOBAL cap of 500.
   * Measured against a real relay at VM_MAX_CONNECTIONS=6 /
   * VM_MAX_CONNECTIONS_PER_IP=2: three addresses inside one /64 held six
   * sockets, and a legitimate player elsewhere was then refused 401. The same
   * arithmetic frees the join limit that is the ENTIRE defence on a
   * six-character invite code.
   */
  it('collapses every address in a /64 to one key', () => {
    const a = limitKey('2001:db8:aaaa:bbbb::1', 64);
    const b = limitKey('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff', 64);
    const c = limitKey('2001:db8:aaaa:bbbb:1234:5678:9abc:def0', 64);
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it('keeps a DIFFERENT /64 separate — it is a grouping, not a merge', () => {
    assert.notEqual(
      limitKey('2001:db8:aaaa:bbbb::1', 64),
      limitKey('2001:db8:aaaa:bbbc::1', 64),
    );
  });

  it('leaves IPv4 exactly as it found it', () => {
    assert.equal(limitKey('203.0.113.9', 64), '203.0.113.9');
    assert.equal(limitKey('198.51.100.7', 64), '198.51.100.7');
  });

  it('leaves an IPv4-MAPPED address alone, because it is an IPv4 address', () => {
    // `::ffff:203.0.113.9` is how a dual-stack listener reports an IPv4 peer.
    // Grouping those by prefix would merge every IPv4 client in the world.
    assert.equal(limitKey('::ffff:203.0.113.9', 64), '::ffff:203.0.113.9');
    assert.notEqual(limitKey('::ffff:203.0.113.9', 64), limitKey('::ffff:198.51.100.7', 64));
  });

  it('strips a zone id rather than keying on it', () => {
    // `fe80::1%eth0` and `fe80::1%eth1` are the same address on two interfaces.
    assert.equal(limitKey('fe80::1%eth0', 64), limitKey('fe80::1%eth1', 64));
  });

  it('honours a prefix that is not a whole hextet', () => {
    // /56 splits inside the fourth group, which is where an off-by-one in the
    // mask would hide: bb and ba differ in the low byte only.
    assert.equal(limitKey('2001:db8:aaaa:bb01::1', 56), limitKey('2001:db8:aaaa:bbff::9', 56));
    assert.notEqual(limitKey('2001:db8:aaaa:bb01::1', 56), limitKey('2001:db8:aaaa:ba01::1', 56));
  });

  it('counts per exact address at 128, which is the behaviour that shipped', () => {
    assert.notEqual(
      limitKey('2001:db8:aaaa:bbbb::1', 128),
      limitKey('2001:db8:aaaa:bbbb::2', 128),
    );
  });

  it('falls back to the address itself for anything it cannot parse', () => {
    // The STRICTEST available answer, never the loosest: an unparseable value
    // must not collapse two clients together.
    for (const junk of ['', 'not-an-address', '2001:db8::1::2', 'gggg::1', '1:2:3:4:5:6:7']) {
      assert.equal(limitKey(junk, 64), junk);
    }
    assert.notEqual(limitKey('gggg::1', 64), limitKey('gggg::2', 64));
  });

  it('refuses a nonsense prefix width rather than producing a wrong key', () => {
    for (const bits of [0, -1, 129, 1.5, Number.NaN]) {
      assert.equal(limitKey('2001:db8:aaaa:bbbb::1', bits), '2001:db8:aaaa:bbbb::1');
    }
  });
});
