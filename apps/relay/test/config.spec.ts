/**
 * ============================================================================
 * server/test/config.spec.ts — the only configuration surface this relay has
 * ============================================================================
 * `config.ts` is the whole tuning interface of a public, unauthenticated
 * endpoint, and it is driven entirely by environment variables set by hand in a
 * systemd unit. That combination has one characteristic failure: a value the
 * parser cannot understand, silently replaced by a default that is LOOSER than
 * the one the operator meant to set. This server's own audit table records that
 * four of its six original defects were "limits that appeared to be enforced and
 * were not"; a typo in a unit file is the same defect with a different cause.
 *
 * The parsers are exported for this file rather than reached through `CONFIG`,
 * because `CONFIG` is evaluated once at import from the real `process.env` — a
 * test that mutated the environment would be testing module-load order.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CONFIG, DESKTOP_ORIGIN, PUBLIC_WEB_ORIGIN, parseCount, parseList } from '../src/config';

describe('a malformed limit refuses to start rather than falling back', () => {
  it('accepts an unset or empty variable as "use the default"', () => {
    assert.equal(parseCount('VM_X', undefined, 500), 500);
    assert.equal(parseCount('VM_X', '', 500), 500);
  });

  it('accepts a plain positive integer', () => {
    assert.equal(parseCount('VM_X', '12', 500), 12);
  });

  it('tolerates surrounding whitespace, which is a typo and not a wrong value', () => {
    // `Number(' 8 ')` is 8. Refusing that would fail a unit file over a stray
    // space with no change in meaning, which is strictness for its own sake.
    assert.equal(parseCount('VM_X', ' 8 ', 500), 8);
  });

  for (const bad of ['0', '-5', 'abc', '1.5', 'Infinity', 'NaN', '1e999', '8x']) {
    it(`throws on ${JSON.stringify(bad)} instead of silently using the default`, () => {
      // MEASURED BEFORE THE FIX: VM_MAX_CONNECTIONS_PER_IP=0 gave 8,
      // VM_MAX_CONNECTIONS=-5 gave 500, VM_HEARTBEAT_MS=abc gave 15000. Every
      // one is an operator who believes they tightened a cap and did not, with
      // nothing printed and nothing to look at.
      assert.throws(() => parseCount('VM_X', bad, 500), /VM_X/);
    });
  }

  it('names the variable in the message, because that is the whole point', () => {
    assert.throws(() => parseCount('VM_MAX_CONNECTIONS', 'lots', 500),
      /VM_MAX_CONNECTIONS/);
  });
});

describe('a list REPLACES its default, and an empty list is expressible', () => {
  it('uses the fallback when unset', () => {
    assert.deepEqual(parseList(undefined, ['a', 'b']), ['a', 'b']);
    assert.deepEqual(parseList('', ['a', 'b']), ['a', 'b']);
  });

  it('replaces rather than extends — which has bitten once already', () => {
    // The shipped systemd unit sets VM_ORIGINS to ONE entry, so the compiled
    // fallback list is gone entirely on the deployed relay. Measured:
    // `http://localhost:5173` is in the fallback and returned 401 under it.
    assert.deepEqual(parseList('https://one.example', ['a', 'b']), ['https://one.example']);
  });

  it('trims and drops blanks, so a trailing comma is not an empty entry', () => {
    assert.deepEqual(parseList(' a , b ,', ['x']), ['a', 'b']);
  });

  it('reads `none` as the empty list', () => {
    // Without this an empty list is INEXPRESSIBLE — the empty string cannot be
    // told apart from an unset variable — so an operator who wanted
    // VM_TRUSTED_PROXIES cleared (the correct setting for a relay exposed
    // directly, and the one `address.ts` documents) silently got loopback back.
    assert.deepEqual(parseList('none', ['127.0.0.1']), []);
    assert.deepEqual(parseList(' NONE ', ['127.0.0.1']), []);
  });
});

describe('the desktop build can always reach the relay', () => {
  /**
   * MEASURED ON A REAL ELECTRON LAUNCH: the packaged desktop build stamps
   * `Origin: app://voltmarch` on its handshake — present, no trailing slash, not
   * the literal `null` — and `app://voltmarch/` WITH a slash is a different
   * origin that is refused. `originAllowed` is a plain `includes`, so the exact
   * string matters.
   *
   * It is unioned in rather than merely defaulted, because `VM_ORIGINS`
   * REPLACES the default list and the shipped unit file sets it. An entry that
   * lived only in the fallback array would be dropped by the deployed relay and
   * the desktop build would be refused at the handshake — 401, before the
   * upgrade, reported to the player as "the match server is not answering".
   */
  it('carries the desktop origin whatever VM_ORIGINS says', () => {
    assert.ok(CONFIG.origins.includes(DESKTOP_ORIGIN));
  });

  it('spells the origin exactly as Chromium sends it', () => {
    assert.equal(DESKTOP_ORIGIN, 'app://voltmarch');
    assert.ok(!DESKTOP_ORIGIN.endsWith('/'));
  });

  it('lists it once, however VM_ORIGINS is set', () => {
    // An operator who copies it into VM_ORIGINS as well must not produce a
    // duplicate entry in the log line every boot prints.
    const seen = CONFIG.origins.filter((o) => o === DESKTOP_ORIGIN);
    assert.equal(seen.length, 1);
  });

  it('is still an ALLOWLIST — the point of the check survives the addition', () => {
    assert.ok(!CONFIG.origins.includes('https://evil.example'));
  });
});

describe('the canonical web build can always reach the relay', () => {
  it('survives a host-level VM_ORIGINS replacement', () => {
    assert.equal(PUBLIC_WEB_ORIGIN, 'https://play.voltmarch.com');
    assert.ok(CONFIG.origins.includes(PUBLIC_WEB_ORIGIN));
  });

  it('is listed exactly once', () => {
    assert.equal(CONFIG.origins.filter((origin) => origin === PUBLIC_WEB_ORIGIN).length, 1);
  });
});
