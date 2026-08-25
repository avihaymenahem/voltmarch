# VOLTMARCH relay

A deterministic-lockstep relay for two connected humans. It supports a duel or
a mixed 2v1/2v2 co-op seat plan, holds each socket's turn frame, broadcasts the
merged commands for every logical player, and compares the simulation
fingerprints that came with them.

**It runs no game code.** That is a compiler guarantee, not a convention — see
[the boundary](#the-boundary) below.

```bash
npm ci                                      # from the repository root
npm --workspace @voltmarch/relay run build
npm --workspace @voltmarch/relay start      # 127.0.0.1:8787
npm run server:test                         # 110 tests in 24 suites
```

The test count said "31" long after it stopped being 31. Re-count it rather than
adjusting it, and note that it includes the COMPILE: `npm run server:test` builds
first, so the four-file import closure is only real because something compiles
through it.

From the repo root: `npm run server`, `npm run server:test`, and
`npm run typecheck` (which now runs four tsc invocations, this being the fourth).

---

## The boundary

The relay imports only two environment-neutral shared workspaces:

```
apps/relay/src/**          -> packages/protocol, packages/game-types
packages/protocol         -> packages/game-types
packages/game-types       -> no runtime dependency
```

Importing `three`, `apps/game/src/sim/**` or `apps/game/src/core/config.ts` is a build error rather
than something a reviewer has to notice. The compiled output confirms it — the
production deployment is a self-contained Node bundle. Package boundary tests reject DOM,
Three.js and app-private imports. `apps/game/tests/net-protocol.spec.ts` asserts the closure from the client side
too, so widening it fails the main test suite as well as this one.

The merge rule lives in `packages/protocol/src/TurnRelay.ts` rather than here on purpose:
`apps/game/tests/net-lockstep.spec.ts` drives two real simulations through the very same
class, so what that test proves is what this server runs.

---

## Security

The governing sentence:

> **The relay stamps identity and server-issued delegation. The simulation enforces authority. Validation
> rejects structure. Nothing silently drops.**

### Identity and authority

Every inbound command has its `player` field **overwritten** with the socket's
human slot unless that logical player is in the server-owned delegation list.
In mixed co-op the list initially contains that human and its assigned AI seat;
after a disconnect it also receives the departed human and every AI that socket
hosted. A command may preserve a claimed player only when it appears in that
closed list, so a client cannot grant itself authority.

The simulation then refuses anything a slot does not own; every applier already
checks (`Commands.ts:868`, `Production.ts:1897`, `Relocate.ts:283`,
`RepairSell.ts:225`). So a spoofed slot degrades to **no effect**, not to
controlling the opponent's army.

### Structural validation

`validateCommand` in `apps/game/src/net/protocol.ts` is a pure function with two callers —
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
| `wss://` only | Enforced by the CLIENT — `net-link.ts` refuses a `ws://` URL to any non-loopback target. NOT by the browser: that rule covers a browser and stopped covering the desktop build, which is a secure context on an `app:` scheme |
| Origin allowlist | `ws` does not check `Origin`, and WebSockets bypass CORS entirely |
| No cookies, no credentials | Nothing for a cross-site socket to steal, so CSWSH has no prize |
| `maxPayload` 64 KB | `ws` closes rather than buffering |
| `perMessageDeflate: false` | Compression is a CPU amplification primitive; there is nothing to save on 300-byte frames |
| Heartbeat, ONE missed pong | Kills slowloris and half-open sockets TCP would hold for hours. Measured at `VM_HEARTBEAT_MS=1500`: one ping at +692 ms, terminated at +2201 ms. Dead-peer detection is therefore 30 s, not 45 s — size `proxy_read_timeout` against that |

`Origin` is trivially forged by anything that is not a browser. It is stated
here as hygiene, **not** authentication — the reason a forged one wins nothing
is that an anonymous socket has no privileges to begin with.

**`app://voltmarch` is on the allowlist unconditionally, and `VM_ORIGINS` cannot
remove it.** That is the packaged desktop build's origin, measured on a real
Electron launch: exact string, no trailing slash, and `app://voltmarch/` WITH one
is refused. It is unioned in rather than defaulted because `VM_ORIGINS` REPLACES
the compiled list, so an entry living only in the fallback would be gone on any
deployed relay and the desktop build would be refused at the handshake with 401 —
which the client, unable to see an HTTP status, reports to the player as "the
match server is not answering". It weakens nothing: no browser can mint an `app:`
origin, and the browser-driven case is the only one this check exists to close.

**`https://play.voltmarch.com` is also unconditional.** It is the canonical
GitHub Pages browser build, and a host-level `VM_ORIGINS` value must not turn a
domain-only routing change into a 401 at the WebSocket upgrade. The deployment
smoke test uses that exact Origin. `voltmarch.com` is the marketing site and has
no reason to open a match socket.

### Resource caps

Every value lives in `apps/game/src/config.ts` with its arithmetic, and every one is
overridable by environment. Connections (global and per address), message rate
(token bucket), commands per turn, turn lookahead, match count, match lifetime,
lobby idle, code TTL. Plus `limit_conn`/`limit_req` at nginx and `MemoryMax` /
`TasksMax` in systemd, so an application-level miss still has a floor under it.

**A per-address limit counts against a /64 for IPv6**, not a /128 — see
`apps/game/src/address.ts#limitKey`. The smallest allocation a customer gets is a /64, so
per-address means per-customer only if the key is the prefix; counting exact
addresses let one host walk out of every cap at once.

**A value the parser cannot understand is fatal, not defaulted.** See Deploying.

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
restart. Three log lines exist in the whole process and none carries an address.

**That guarantee is only as good as the proxy in front of it**, and the nginx
template shipped in `deploy/` defeated it: with no `access_log` directive, the
distribution's http-level default applies and writes `$remote_addr` for every
socket to `/var/log/nginx/access.log`. `location = /ws` now sets
`access_log off;`. If you turn it back on for a debugging session, know what you
are turning on.

### Audit findings, and what they were

A pass over this server looking specifically for what an attacker could reach
turned up six real defects. All six are fixed and tested; they are recorded here
because each was invisible in the code and obvious once named.

| | Was | Why it mattered |
|---|---|---|
| **Forwarded address ignored** | `remoteAddress` only | **The worst of them.** Behind the nginx in `deploy/`, every socket arrives from 127.0.0.1 — so `remoteAddress` was the same value for the whole internet. The per-address connection cap became a *global* cap of 8, and the join-rate limit became 10/min for **all players combined**. Every per-address limit read as working and protected nobody. Fixed by `apps/game/src/address.ts`, which honours `X-Real-IP` **only** from a trusted proxy peer — trusting it unconditionally would be worse still, letting any direct client mint a new identity per request. |
| **Per-address cap raced** | check in `verifyClient`, increment on `connection` | Every simultaneous handshake from one address read the same pre-increment count and all passed. The cap held against a sequential client and not against the only kind that matters. Now reserved at verify time and reconciled against the live socket set once a second, so a dead upgrade cannot leak a slot. |
| **Rate limiter resettable** | `joinAttempts.clear()` past 10 000 entries | Wiping the map reset the limiter for *everyone on it*, including whoever filled it. An attacker reaching 10 000 distinct addresses — trivial on IPv6 — could clear their own limit on demand, and that limit is the entire defence on a six-character invite code. Now evicts only buckets that have fully refilled, which by definition carry no restriction. |
| **Listing was an amplifier** | publish inline per change | One client opening and closing rooms in a loop cost `watchers × rooms` per iteration: one cheap message in, one full listing out per watcher. A ~500× gain available to anyone past the handshake. Now coalesced — at most one listing per watcher per second, however many changes occurred. |
| **Faction bound was the player cap** | `v < 8` | `FACTION_COUNT` is 5. Indices 5–7 were relayed to both clients, seated, and used to index faction-keyed art and def tables: `undefined`, then NaN, then the black frame CLAUDE.md records losing a day to. Both clients would do it *identically*, so the checksum would agree the whole way down and never say a word. |
| **Idle sweep trusted a flag** | `conn.engaged` | Set on create/join/queue, cleared only on cancel — so a host whose room expired by TTL stayed flagged busy for the life of the process and was permanently exempt from the idle sweep. Replaced by `Lobby.isBusy()`: the lobby already knows, and a second copy of that knowledge could only ever drift. |

The pattern worth noticing: **four of the six were limits that appeared to be
enforced and were not.** A cap that silently applies to the wrong scope is worse
than no cap, because the counter still moves and nobody looks again.

### The second pass, before the first deploy

The relay had not been touched since it was written, while the game moved three
major versions past it. Every row below is fixed and covered by a test that was
run against the broken build first and watched to fail.

| | Was | Why it mattered |
|---|---|---|
| **No unit could be bought at all** | `WIRE_LIMITS.maxDefId` 4095 against `UNIT_PUBLIC_ID_BASE` 4096 | **The worst of them: it made multiplayer unplayable.** A unit's `Command.defId` is its `publicId`, `4096 + index` — one above the ceiling — so `validateCommand` answered `bounds` for all sixty units and `TurnRelay` emptied the WHOLE submission, taking every other order in that 100 ms turn with it. Invisible because the reasoning existed everywhere else: `Production.ts` argues that upgrades sit at 2048 *because* of this ceiling, and two specs assert their own half against it. Nobody ever asserted the unit half. Now 8191, bound to the real catalog in both directions. |
| **A refusal counted as a sign of life** | `lastSubmit` stamped before validation | A submission the relay REJECTED still refreshed the silence clock, so one ~120-byte frame every ten seconds — free against a 40/s rate — kept a hostile peer alive indefinitely. The damage inverted: a starved client stalls, so the VICTIM fell silent first and was the one retired. Any losing player could convert a loss into a win. Fixed in two places, because the stamp alone was not enough: the sweep also had to stop retiring by index order, since the victim's freshness margin is one lookahead (~400 ms) against a 1 s sample. |
| **A turn could complete out of order** | `emitted = s.turn`, no succession rule | Submit only the TOP turn of the lookahead and it completes; `emitted` jumps past every turn below it and those can never be resubmitted, so the opponent blocks forever. A second, independent route to the same stolen win. Closed structurally: each slot must submit consecutive turns from `TURN_DELAY`, which is exactly what `TurnScheduler` sends, so it refuses nothing a real client does. It also makes `emitted` monotonic, which `duplicate-turn` rests on entirely. |
| **Per-address limits were per-/128** | `ipKey(address)` | The smallest IPv6 allocation a customer receives is a /64. 63 addresses out of one ordinary /64 is 504 sockets against a GLOBAL cap of 500 — measured end to end, including a legitimate player on an unrelated network then being refused 401. nginx does not bind either: `$binary_remote_addr` is all 16 bytes. Now grouped to a /64, with IPv4 and IPv4-mapped addresses untouched. |
| **A cap of 32 bit a legal gesture** | `maxCommandsPerTurn` 32 | Self-destruct fans out to one command per selected unit, up to `MAX_SELECTION` 100, so a player who box-selected 33 hulls and confirmed lost the whole turn. Now 128; the resulting frame is ~20 kB against a 64 kB payload cap, so the limit that actually protects the server did not move. |
| **The desktop build could not connect** | no `app://voltmarch` origin | Measured at both ends: the packaged app sends `Origin: app://voltmarch`, and a correctly-deployed relay answered 401 before the upgrade. See Transport above. |
| **A malformed limit fell back silently** | `num()` returning the default | `VM_MAX_CONNECTIONS_PER_IP=0` gave 8, `-5` gave 500, `abc` gave 15000. Always toward LESS restriction, always without a word — the same shape as four of the six above. |
| **A comment promised a refusal that did not exist** | `allowAnyOrigin` | *"Development only; refuses to run with TLS off in prod."* Nothing refused anything, and the sentence was unimplementable besides: this process cannot observe TLS, because nginx terminates it a hop away and proxies plain `http://` to loopback. Half was implemented (`NODE_ENV=production` now refuses to start), half was deleted rather than restated. |
| **A listen failure killed the process silently** | no `wss.on('error')` | `ws` forwards the http server's `error` event and an unhandled one is rethrown, so a port held by a stale instance produced a raw `EADDRINUSE` stack trace — and with `Restart=always`, a restart loop whose journal said nothing actionable. |
| **A retired slot was processed twice** | `peerLost(-1)` | `Lobby.leave` passes `slotOf(peer)`, which is -1 once the silence sweep has already nulled that seat; the guard read `peers[-1]`, `undefined` rather than `null`, so it fell through and notified the survivor twice. `peerLost` is now total over its slot input and delegation is idempotent. |
| **The deploy templates did not work** | `nginx.conf`, the unit file | `listen 443 ssl` with both certificate lines commented out will not load, and `certbot --nginx` cannot repair a config it must first pass `nginx -t` on. `http2 on;` is rejected outright below nginx 1.25.1 — Ubuntu 22.04/24.04 and Debian 12 — and buys a WebSocket endpoint nothing. And the distribution's default `access_log` wrote every player's real address to disk, defeating the per-boot-salt guarantee stated two sections above: the relay was honouring it exactly; nginx was not. |

The pattern in this pass is different from the first. **Six of the eleven were
correct code whose CALLER, CONSTANT or CONFIGURATION had moved underneath it**,
and the unit-id ceiling had been wrong for as long as the relay had gone
untouched. The first pass found things nobody had thought about; this one found
things that used to be true.

### `ws` is pinned, and the pin has a reason

`8.21.3` exactly. The first pin here was `8.18.3` and `npm audit` refused it on
two high-severity advisories that are precisely this server's threat model:

- **GHSA-58qx-3vcg-4xpx** — uninitialized memory disclosure. A peer reads server memory.
- **GHSA-96hv-2xvq-fx4p** — memory exhaustion from tiny fragments. This happens
  *below* the message boundary, so no application-level rate limit can see it.

**The relay deployment workflow runs `npm run audit` before packaging.** Keep `ws` pinned
exactly and treat a high-severity audit result as a deployment failure; Pages CI does not
install or test the relay because it filters to the game workspace.

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
  refusing the pairing is far kinder than a desync forty seconds in. Read the
  number out of `package.json`: the commented example in the unit file said
  `1.33.0` for three major versions, and uncommenting it as written would have
  refused every real client.
- **`VM_ORIGINS` REPLACES the compiled list.** Whatever is on that line is the
  operator-provided browser allowlist. The fixed desktop and canonical web origins
  are unioned in afterward. Measured: with the shipped unit's single entry,
  `http://localhost:5173` — which IS in `config.ts`'s fallback array — is
  answered 401. The desktop origin is the exception and must not be added there.
- **Obtain the certificate BEFORE enabling the nginx site.** `certbot --nginx`
  cannot bootstrap a `listen 443 ssl` block with no certificate: nginx refuses to
  load one and certbot config-tests before it edits. The header of
  `deploy/nginx.conf` runs `certonly --standalone` first for that reason.
- **A malformed limit now refuses to start.** `VM_MAX_CONNECTIONS=-5` used to
  give you 500 and say nothing. It exits 1 naming the variable, which
  `Restart=always` plus `StartLimitBurst` turns into five restarts and a journal
  line rather than a cap you believe you set.
- **`systemd-analyze security voltmarch-relay.service` is the right instrument**
  for the sandbox block, and it has never been run on a real target. Two
  directives were considered and deliberately left out: `PrivateUsers=yes`, which
  is the item on that list most likely to break a Node service and belongs behind
  a first-boot test, and `AF_UNIX` in `RestrictAddressFamilies`, which looks
  necessary and is probably not (the relay binds an IP literal, so node never
  calls getaddrinfo, and journald hands it a pre-connected fd).

---

## Protocol

`PROTOCOL_VERSION` in `apps/game/src/net/protocol.ts`. A mismatch **refuses** the
connection rather than negotiating down — a peer that half-understands the
protocol is a peer that desyncs, and "it mostly worked" is what the number
exists to prevent. Same discipline as `parseReplay`, which refuses a file rather
than half-reading it.

Version 5 adds bounded commander identity plus presentation-only chat and ally
pings. These messages bypass `TurnRelay` entirely, are rate-limited separately,
and cannot change a checksum or replay command stream. Version 3 names the
logical slot in `peerLost` and authorises the survivor to
run that seat's AI. It deliberately does **not** reconnect the dropped client:
that still requires replaying missed turns into a late joiner. The surviving
match continues, and delegated AI orders are ordinary validated commands that
are included in the recording.

Error and outcome prose remains a pair of closed codes mapped locally. The two
deliberate free-text surfaces are commander handles and chat: both are rebuilt
through the shared normalizers, chat identity is stamped from the server-owned
seat rather than accepted from the message, and the client uses `textContent`.
`apps/game/tests/foundation.spec.ts` keeps the markup gate on the rendering half.
