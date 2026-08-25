/**
 * ============================================================================
 * tests/net-lobby.spec.ts — the lobby's two pieces of real logic
 * ============================================================================
 * Most of `MultiplayerSetup` is DOM assembly and is covered by the fact that it
 * compiles and renders. Two things underneath it are NOT decoration:
 *
 *   1. WHERE THE RELAY IS. A game served over https cannot open a `ws://`
 *      socket — the browser blocks it as mixed content and reports the failure
 *      at the socket, which points a reader at the network code rather than at
 *      the one-line misconfiguration that caused it. `net-link.ts` refuses that
 *      combination up front so the menu can say what is actually wrong.
 *
 *   2. THAT EVERY CODE THE RELAY CAN SEND HAS LOCAL TEXT. The server never
 *      sends prose — it sends a closed union, and the client maps it. A code
 *      with no mapping would surface as `undefined` in front of a player, and
 *      the whole reason for the closed union is that the relay must never be
 *      able to put a string on somebody's screen.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CODE_ALPHABET, CODE_LENGTH, isWellFormedCode } from '../src/net/protocol';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Point `net-link` at a synthetic page.
 *
 * The module reads `location` and `localStorage` at CALL time, not at import
 * time, so stubbing the globals is enough and no module reset is needed.
 */
function pageAt(href: string, stored: string | null = null): void {
  const url = new URL(href);
  vi.stubGlobal('location', {
    protocol: url.protocol,
    hostname: url.hostname,
    search: url.search,
  });
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: () => { /* not under test */ },
    removeItem: () => { /* not under test */ },
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

/* ========================================================================== */

describe('where the relay is', () => {
  it('offers a localhost relay to a localhost dev server', async () => {
    pageAt('http://localhost:5173/');
    const { relayUrl, multiplayerAvailable } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('ws://localhost:8787/ws');
    expect(multiplayerAvailable()).toBe(true);
  });

  it('offers NOTHING to an https page with no relay configured', async () => {
    // This is the shipped GitHub Pages case until a relay is deployed. It must
    // report "not configured" rather than guessing at an address.
    pageAt('https://avihaymenahem.github.io/voltmarch/');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
    expect(unavailableReason()).toContain('No match server');
  });

  it('REFUSES a ws:// relay from an https page, and says why', async () => {
    // The defect this exists to prevent: the browser blocks the socket as mixed
    // content, and the resulting error names the socket rather than the config.
    pageAt('https://example.com/game/', 'ws://relay.example.com/ws');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
    expect(unavailableReason()).toContain('wss://');
  });

  it('accepts a wss:// relay from an https page', async () => {
    pageAt('https://example.com/game/', 'wss://relay.example.com/ws');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('wss://relay.example.com/ws');
    expect(unavailableReason()).toBe('');
  });

  it('lets ?relay= outrank a stored address, for a one-off test server', async () => {
    pageAt('https://example.com/?relay=wss%3A%2F%2Fstaging.example.com%2Fws', 'wss://saved.example.com/ws');
    const { relayUrl } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('wss://staging.example.com/ws');
  });

  it('refuses an address that is not a WebSocket URL at all', async () => {
    pageAt('https://example.com/', 'https://relay.example.com/ws');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
    expect(unavailableReason()).toContain('not a WebSocket URL');
  });

  it('survives storage being unavailable', async () => {
    // Private mode throws on `localStorage`. Multiplayer must degrade to "not
    // configured", never to an exception during menu construction.
    const url = new URL('https://example.com/');
    vi.stubGlobal('location', { protocol: url.protocol, hostname: url.hostname, search: '' });
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    const { relayUrl } = await import('../src/shell/net-link');
    expect(() => relayUrl()).not.toThrow();
    expect(relayUrl()).toBe('');
  });
});

describe('invite codes are checkable before they are sent', () => {
  it('accepts a well-formed code', () => {
    expect(isWellFormedCode('23456789'.slice(0, CODE_LENGTH))).toBe(true);
  });

  it('rejects the wrong length, so a typo never costs a join attempt', () => {
    // The relay allows ten join attempts a minute; spending one on a code that
    // could not possibly be valid is the difference between a typo and a
    // lockout for somebody reading a code off a screen.
    expect(isWellFormedCode('ABC12')).toBe(false);
    expect(isWellFormedCode('ABC1234')).toBe(false);
  });

  it('rejects glyphs the alphabet deliberately excludes', () => {
    for (const bad of '01OILUV') {
      const code = (bad + '23456').slice(0, CODE_LENGTH);
      expect(isWellFormedCode(code), `must reject ${bad}`).toBe(false);
    }
  });

  it('rejects lower case rather than silently accepting it', () => {
    expect(isWellFormedCode('abcdef')).toBe(false);
  });
});

describe('every relay-controlled display string has an explicit safety contract', () => {
  /**
   * Read from the source, because `ErrorCode` and `OverReason` are types and
   * have no runtime form. The `Record<ErrorCode, string>` in Session.ts already
   * makes this a COMPILE error — this test exists so a mapping that is present
   * but EMPTY is caught too, which the type cannot see.
   */
  function unionMembers(source: string, name: string): string[] {
    const start = source.indexOf(`export type ${name} =`);
    const block = source.slice(start, source.indexOf(';', start));
    return Array.from(block.matchAll(/'([a-z-]+)'/g)).map((m) => m[1]!);
  }

  const protocol = read('src/net/protocol.ts');
  const session = read('src/net/Session.ts');

  it('has non-empty local text for every ErrorCode', () => {
    const codes = unionMembers(protocol, 'ErrorCode');
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const code of codes) {
      const key = /^[a-z]+$/.test(code) ? code : `'${code}'`;
      const match = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*'([^']+)'`).exec(session);
      expect(match, `ErrorCode "${code}" has no local text`).not.toBeNull();
      expect(match?.[1]?.length ?? 0, `ErrorCode "${code}" maps to an empty string`).toBeGreaterThan(4);
    }
  });

  it('has non-empty local text for every OverReason', () => {
    const reasons = unionMembers(protocol, 'OverReason');
    expect(reasons.length).toBeGreaterThanOrEqual(4);
    for (const reason of reasons) {
      const key = /^[a-z]+$/.test(reason) ? reason : `'${reason}'`;
      const match = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*'([^']+)'`).exec(session);
      expect(match, `OverReason "${reason}" has no local text`).not.toBeNull();
    }
  });

  it('carries only the strings it is supposed to', () => {
    /*
     * THE CHEAPEST GUARANTEE AVAILABLE: every string that can cross the wire
     * is named here. Identity and chat deliberately widened this boundary, so
     * their shared normalization and textContent-only rendering are tested.
     *
     * So this enumerates every `field: string` DECLARATION in the wire types
     * and demands the set be exactly the fields that are meant to be there.
     * Adding a fourth is not forbidden — it is forbidden to add one WITHOUT
     * coming here, deciding how it is bounded, and writing it down.
     *
     *   t     — the discriminant, matched against a closed union
     *   build — a version string, compared for equality and never rendered
     *   code  — an invite code, checked against CODE_ALPHABET at both ends
     *   map   — a map id, checked against /^[a-z0-9-]+$/ by the relay
     *   id    — a public room handle, checked against /^[a-z0-9]+$/ by
     *           `isRoomId`. Added with the room browser, and this test is what
     *           made that addition a decision rather than a slip: the gate
     *           fired on the first run after the field landed.
     */
    // Scoped to the two message unions. Searching the whole file would pick up
    // `parseMessage`'s own `{ ok: false; reason: string }`, which never crosses
    // the wire — and a check that reports fields the protocol does not have is
    // a check nobody will trust the next time it fires.
    const from = protocol.indexOf('export type ClientMessage');
    const to = protocol.indexOf('export function parseMessage');
    expect(from, 'the union must be findable').toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const wire = protocol.slice(from, to);

    const declared = new Set(
      Array.from(wire.matchAll(/(\w+)\??:\s*string\s*[;}]/g)).map((m) => m[1]!),
    );
    // v5's deliberate authored strings: `name` is normalized at create/join
    // and echoed from a server-owned seat; `text` is normalized, capped and
    // rendered through textContent. Neither enters a turn frame.
    expect([...declared].sort()).toEqual(['build', 'code', 'id', 'map', 'name', 'text']);
    // `t` is a literal type, not a free string — that is the whole point.
    expect(wire).toMatch(/t:\s*'hello'/);
  });

  it('has exactly the bounded commander and invite-code text inputs', () => {
    const lobby = read('src/shell/MultiplayerSetup.ts');
    const inputs = lobby.match(/\.type\s*=\s*'text'/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(lobby).toMatch(/maxLength\s*=\s*COMMANDER_NAME_MAX/);
    expect(lobby).toMatch(/normalizeCommanderName/);
    expect(lobby).toMatch(/maxLength\s*=\s*CODE_LENGTH_HINT/);
  });
});

describe('the code alphabet is shared, not copied', () => {
  it('the relay imports it from the protocol rather than declaring its own', () => {
    // Two alphabets would eventually differ by one glyph, and the relay would
    // then mint codes the lobby refuses to send.
    const config = read('server/src/config.ts');
    expect(config).toMatch(/export \{[^}]*CODE_ALPHABET[^}]*\} from '\.\.\/\.\.\/src\/net\/protocol'/);
    expect(CODE_ALPHABET.length).toBeGreaterThan(20);
  });
});

/* ==========================================================================
 * THE DESKTOP TARGET, WHICH THE OLD PREDICATE COULD NOT SEE
 * ========================================================================== */

describe('the transport rule reads the TARGET, not the page', () => {
  /**
   * `pageIsPlaintext()` tested `location.protocol !== 'https:'`. That was a
   * correct proxy for "the browser will not stop me" while a browser was the
   * only target. The packaged desktop build is served from `app://voltmarch`,
   * and MEASURED on a real Electron launch: `location.protocol` is `app:`
   * while `window.isSecureContext` is TRUE. The two inverted, so the guard read
   * a genuinely secure page as plaintext and the shipped client accepted a
   * public `ws://` relay, greeted it, and enabled the Multiplayer row with no
   * warning — verified by launching the real app against a stub relay.
   */
  it('REFUSES a public ws:// relay from the desktop app', async () => {
    pageAt('app://voltmarch/index.html', 'ws://relay.example.com/ws');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
    expect(unavailableReason()).toContain('wss://');
  });

  it('still allows a LOOPBACK ws:// relay from the desktop app', async () => {
    // `--vm-relay=ws://localhost:8787/ws` is the only way a developer reaches a
    // local relay on that target — `localDefault()` is inert there, because
    // `location.hostname` is `voltmarch`. A blanket "wss:// only" rule would
    // have closed the hole by breaking desktop development.
    pageAt('app://voltmarch/index.html?relay=ws%3A%2F%2Flocalhost%3A8787%2Fws');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('ws://localhost:8787/ws');
    expect(unavailableReason()).toBe('');
  });

  it('accepts wss:// from the desktop app', async () => {
    pageAt('app://voltmarch/index.html', 'wss://relay.example.com/ws');
    const { relayUrl } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('wss://relay.example.com/ws');
  });

  it('offers no relay at all to the desktop app by default', async () => {
    // `localDefault()` keys on `location.hostname`, which is `voltmarch` here.
    pageAt('app://voltmarch/index.html');
    const { relayUrl, unavailableReason } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
    expect(unavailableReason()).toContain('No match server');
  });

  it('refuses a public ws:// relay from a PLAINTEXT dev page too', async () => {
    // The old rule allowed this: the page was http, so anything went. The
    // question was never what the page uses — it is whether the socket crosses
    // a network somebody can sit on.
    pageAt('http://localhost:5173/', 'ws://relay.example.com/ws');
    const { relayUrl } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
  });

  it('does not read a hostname that merely CONTAINS localhost as loopback', async () => {
    // `localhost.evil.com` resolves wherever its owner points it. The same trap
    // `desktop/src/app-url.ts#isLoopbackHost` is written literally to avoid.
    pageAt('https://example.com/', 'ws://localhost.evil.com/ws');
    const { relayUrl } = await import('../src/shell/net-link');
    expect(relayUrl()).toBe('');
  });

  it('treats 127.0.0.1 and [::1] as this machine', async () => {
    for (const url of ['ws://127.0.0.1:8787/ws', 'ws://127.9.9.9:8787/ws', 'ws://[::1]:8787/ws']) {
      pageAt('https://example.com/', url);
      const { relayUrl } = await import('../src/shell/net-link');
      expect(relayUrl(), url).toBe(url);
    }
  });
});

describe('net-link exposes no writer for the relay address', () => {
  it('has no setRelayUrl, because the route its comment named did not exist', async () => {
    // It had exactly one reference tree-wide — its own definition — and the
    // web bundle had already tree-shaken it out, so "used from the console" was
    // false on both targets. The storage key it wrote is still READ, so the
    // route that works (edit the stored value, or pass `?relay=`) is untouched.
    const mod = await import('../src/shell/net-link');
    expect('setRelayUrl' in mod).toBe(false);
    expect(read('src/shell/net-link.ts')).not.toMatch(/^export function setRelayUrl/m);
  });
});
