# VOLTMARCH relay

A deterministic-lockstep relay for 1v1. It holds each turn's frames until every
slot has reported, broadcasts the merged frame, and compares the simulation
fingerprints that came with them.

**It runs no game code.** That is a compiler guarantee, not a convention — see
[the boundary](#the-boundary) below.

```bash
npm ci
npm run build
npm start          # 127.0.0.1:8787
npm test           # 31 tests, no sockets, no timers
npm run audit      # gate, not a suggestion — see ws below
```

From the repo root: `npm run server`, `npm run server:test`, and
`npm run typecheck` (which now runs four tsc invocations, this being the fourth).

---

## The boundary

`tsconfig.json` includes exactly four TypeScript files:

```
server/src/**            ->  src/net/protocol.ts, src/net/TurnRelay.ts
src/net/TurnRelay.ts     ->  src/net/protocol.ts
src/net/protocol.ts      ->  src/core/types.ts
src/core/types.ts        ->  nothing at all
```

Importing `three`, `src/sim/**` or `src/core/config.ts` is a build error rather
than something a reviewer has to notice. The compiled output confirms it — the
only `require()` calls that survive are `ws`, `node:crypto`, and the four local
modules. `tests/net-protocol.spec.ts` asserts the closure from the client side
too, so widening it fails the main test suite as well as this one.

The merge rule lives in `src/net/TurnRelay.ts` rather than here on purpose:
`tests/net-lockstep.spec.ts` drives two real simulations through the very same
class, so what that test proves is what this server runs.

---

## Security

The governing sentence:

> **The relay stamps identity. The simulation enforces authority. Validation
> rejects structure. Nothing silently drops.**

### Identity and authority

Every inbound command has its `player` field **overwritten** with the slot of
the socket it arrived on. A client's claim is discarded, never trusted —
`Command.player` in `src/core/types.ts` has said so since long before any of
this existed: *"The bus stamps this; never trust a client-set value."*

The simulation then refuses anything a slot does not own; every applier already
checks (`Commands.ts:868`, `Production.ts:1897`, `Relocate.ts:283`,
`RepairSell.ts:225`). So a spoofed slot degrades to **no effect**, not to
controlling the opponent's army.

### Structural validation

`validateCommand` in `src/net/protocol.ts` is a pure function with two callers —
this server, and every client. It **rebuilds** each command from a closed
allowlist rather than filtering one, so `__proto__`, `constructor` and any
unknown field are gone by construction. It **rejects rather than clamps**,
because a clamped command is a different command and two implementations that
round differently diverge.

The `Number.isFinite` checks are the load-bearing ones. This repo has already
lost a day to a NaN that reached an instance colour attribute and came back out
of the bloom pass as an entirely black frame. A remote peer must not be able to
post one deliberately.

**The two callers do different things with a rejection**, and confusing them is
the bug lockstep cannot survive:

- **Here it is a filter.** Rejection happens *before* the broadcast, so every
  client gets the same frame and the drop is atomically consistent.
- **On a client it is a tripwire.** The relay already approved it, so a failure
  means something upstream is wrong, and the client **ends the match** rather
  than dropping the command. Dropping it on one client and not the other
  manufactures a desync with no findable cause.

A submission that breaks a limit is **emptied, not refused**: the match
continues and the offender is told. Refusing to complete the turn would let one
malicious peer hang the game for everyone — denial of service dressed as
strictness.

### Transport

| | |
|---|---|
| `wss://` only | Forced anyway: a browser blocks a plaintext socket from an https page |
| Origin allowlist | `ws` does not check `Origin`, and WebSockets bypass CORS entirely |
| No cookies, no credentials | Nothing for a cross-site socket to steal, so CSWSH has no prize |
| `maxPayload` 64 KB | `ws` closes rather than buffering |
| `perMessageDeflate: false` | Compression is a CPU amplification primitive; there is nothing to save on 300-byte frames |
| Heartbeat, 2 missed pongs | Kills slowloris and half-open sockets that TCP would hold for hours |

`Origin` is trivially forged by anything that is not a browser. It is stated
here as hygiene, **not** authentication — the reason a forged one wins nothing
is that an anonymous socket has no privileges to begin with.

### Resource caps

Every value lives in `src/config.ts` with its arithmetic, and every one is
overridable by environment. Connections (global and per address), message rate
(token bucket), commands per turn, turn lookahead, match count, match lifetime,
lobby idle, code TTL. Plus `limit_conn`/`limit_req` at nginx and `MemoryMax` /
`TasksMax` in systemd, so an application-level miss still has a floor under it.

### Invite codes

Six characters from a 29-symbol alphabet with no ambiguous glyphs. That is
5.9e8 combinations, which is **not** what makes it safe — an attacker with
unlimited attempts walks it in an afternoon. Three things together do:

1. `crypto.randomInt`, never `Math.random` — a predictable code needs no guessing.
2. **10 join attempts per address per minute.** This is the actual defence.
3. Single use, consumed atomically on join, and a 10-minute expiry.

### Privacy

No accounts, no personal data, no message contents logged. Addresses are hashed
with a **per-boot random salt** — enough to count connections and rate-limit
joins, useless as a record of who played from where, and meaningless after a
restart.

### Audit findings, and what they were

A pass over this server looking specifically for what an attacker could reach
turned up six real defects. All six are fixed and tested; they are recorded here
because each was invisible in the code and obvious once named.

| | Was | Why it mattered |
|---|---|---|
| **Forwarded address ignored** | `remoteAddress` only | **The worst of them.** Behind the nginx in `deploy/`, every socket arrives from 127.0.0.1 — so `remoteAddress` was the same value for the whole internet. The per-address connection cap became a *global* cap of 8, and the join-rate limit became 10/min for **all players combined**. Every per-address limit read as working and protected nobody. Fixed by `src/address.ts`, which honours `X-Real-IP` **only** from a trusted proxy peer — trusting it unconditionally would be worse still, letting any direct client mint a new identity per request. |
| **Per-address cap raced** | check in `verifyClient`, increment on `connection` | Every simultaneous handshake from one address read the same pre-increment count and all passed. The cap held against a sequential client and not against the only kind that matters. Now reserved at verify time and reconciled against the live socket set once a second, so a dead upgrade cannot leak a slot. |
| **Rate limiter resettable** | `joinAttempts.clear()` past 10 000 entries | Wiping the map reset the limiter for *everyone on it*, including whoever filled it. An attacker reaching 10 000 distinct addresses — trivial on IPv6 — could clear their own limit on demand, and that limit is the entire defence on a six-character invite code. Now evicts only buckets that have fully refilled, which by definition carry no restriction. |
| **Listing was an amplifier** | publish inline per change | One client opening and closing rooms in a loop cost `watchers × rooms` per iteration: one cheap message in, one full listing out per watcher. A ~500× gain available to anyone past the handshake. Now coalesced — at most one listing per watcher per second, however many changes occurred. |
| **Faction bound was the player cap** | `v < 8` | `FACTION_COUNT` is 5. Indices 5–7 were relayed to both clients, seated, and used to index faction-keyed art and def tables: `undefined`, then NaN, then the black frame CLAUDE.md records losing a day to. Both clients would do it *identically*, so the checksum would agree the whole way down and never say a word. |
| **Idle sweep trusted a flag** | `conn.engaged` | Set on create/join/queue, cleared only on cancel — so a host whose room expired by TTL stayed flagged busy for the life of the process and was permanently exempt from the idle sweep. Replaced by `Lobby.isBusy()`: the lobby already knows, and a second copy of that knowledge could only ever drift. |

The pattern worth noticing: **four of the six were limits that appeared to be
enforced and were not.** A cap that silently applies to the wrong scope is worse
than no cap, because the counter still moves and nobody looks again.

### `ws` is pinned, and the pin has a reason

`8.21.3` exactly. The first pin here was `8.18.3` and `npm audit` refused it on
two high-severity advisories that are precisely this server's threat model:

- **GHSA-58qx-3vcg-4xpx** — uninitialized memory disclosure. A peer reads server memory.
- **GHSA-96hv-2xvq-fx4p** — memory exhaustion from tiny fragments. This happens
  *below* the message boundary, so no application-level rate limit can see it.

Run `npm run audit` before every deploy.

### What lockstep cannot protect

**Maphack and input automation.** Every client holds the entire world, so a
modified client can reveal fog and script perfect micro. This is inherent to the
model — it is what RA3 and StarCraft shipped — and the only fix is a
server-authoritative simulation.

Everything *else* is closed. A client cannot create credits, spawn units, deal
damage or touch another player's army, because it can only issue commands and
the simulation validates them exactly as it validates the local player's. A
client that fudges its own state diverges, and the fingerprint comparison names
it within 100 ms and ends the match. **The desync detector is also the
anti-cheat.**

---

## Deploying

`deploy/voltmarch-relay.service` and `deploy/nginx.conf` carry the install
steps in their headers. The short version: an unprivileged user, a sandboxed
systemd unit, nginx terminating TLS to `127.0.0.1:8787`, and the relay never
reachable directly.

Two things worth reading before editing them:

- **`MemoryDenyWriteExecute` must stay `no`.** V8 is a JIT — it writes machine
  code and executes it. Turning that flag on does not harden the service, it
  stops node from starting.
- **Set `VM_REQUIRE_BUILD`** to the deployed client version once you are past
  testing. GitHub Pages can serve a cached bundle to one player and a fresh one
  to the other; two builds of a deterministic simulation desync on contact, and
  refusing the pairing is far kinder than a desync forty seconds in.

---

## Protocol

`PROTOCOL_VERSION` in `src/net/protocol.ts`. A mismatch **refuses** the
connection rather than negotiating down — a peer that half-understands the
protocol is a peer that desyncs, and "it mostly worked" is what the number
exists to prevent. Same discipline as `parseReplay`, which refuses a file rather
than half-reading it.

The server never sends a free-text string for a client to display. `ErrorCode`
and `OverReason` are closed unions the client maps to its own local strings —
otherwise the relay would be an injection vector into the opponent's UI, and
`tests/foundation.spec.ts` now has a markup gate to keep the client honest about
the other half of that.
