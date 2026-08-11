# Multiplayer

> ## Read this first
>
> **There is no public match server.** The multiplayer relay is written, tested and shipped as source
> in this repository, and it is **not deployed anywhere**. The published build of the game connects to
> nothing: the Multiplayer button on the main menu is disabled, with the hint *"No match server is
> configured for this build."*
>
> Head-to-head play works, and works well, **if you run the relay yourself on your own machine or your
> own server**. It is not currently something you can click on and find an opponent through.
>
> Everything below describes what happens when you do run one.

---

## 1. What multiplayer is

Deterministic lockstep over a relay. Both clients run the *same* simulation from the same seed, and
the only thing that crosses the network is each player's commands. The server forwards turn frames
and **runs no game code at all** — it has no idea what a tank is, and it cannot be asked to grant one.

The consequences are worth understanding, because they explain most of the rules on this page:

- Both players must be running the same build. Two different builds of a deterministic simulation
  fall out of step on contact.
- Nothing about the game can be cheated by lying to the server, because the server does not simulate.
  Resource, spawn and damage cheats are closed by construction.
- Fog of war and input automation **cannot** be prevented. A modified client can reveal the map and
  script its own clicks. That is inherent to lockstep and it is documented as a known limitation
  rather than a bug.
- If the two simulations ever disagree, the match is stopped. There is no way to reconcile them.

---

## 2. Getting a match running

You need two things: the client and the relay.

```
npm run dev        # the game, on http://localhost:5173
npm run server     # the relay, on ws://localhost:8787/ws
```

The client resolves its relay address in this order: `?relay=` on the URL → a saved address in
`localStorage` → a `VITE_RELAY_URL` baked in at build time → **`ws://localhost:8787/ws` if and only
if the page is served from `localhost` or `127.0.0.1`** → nothing.

That last fallback is why multiplayer works out of the box in local development and nowhere else.
The published build is served from a public host, so it falls through to nothing and the menu button
greys out.

Before it lets you into the lobby the client probes the relay — it opens a socket, greets it, and
requires an answer within four seconds. A relay that is not running produces *"the match server is
not answering"* rather than a hang.

**Hosting it for real is more work than it looks.** The relay binds to `127.0.0.1` by default and
speaks plain WebSocket; a browser refuses a plaintext socket from a secure page, so a public
deployment needs a TLS terminator and a real hostname — you cannot run it on a bare IP. The
repository ships an nginx template and a systemd unit for exactly this, both with placeholder
hostnames.

---

## 3. The lobby

Opening the Multiplayer screen connects immediately, before you touch anything.

**Left column — your side.** Pick a faction. Then either:

- **Host a match.** Choose a battlefield from the map list and a visibility: *Public* puts the room in
  the browser, *Invite only* gives you a six-character code to send to one person. Codes are
  single-use, expire after ten minutes, and are drawn from an alphabet with no `0/O`, `1/I/L` or
  `U/V` in it, so they can be read aloud.
- **Join with a code.** Type the six characters and press Enter.

**Right column — open matches.** A live, pushed list of public rooms with map, faction and age, plus
two local filters and a **Quick Match** button. Quick Match is a one-slot queue: the first player
waits, the second starts a match immediately. There is no rating and no matchmaking beyond that.

**Joining starts the match at once.** There is no waiting room, no ready check, no host kick and no
lobby chat. The moment a second player enters, the room is deleted and the match begins.

**Matches are strictly 1v1.** There are no teams, no free-for-all, no AI slots and no spectators.

**There are no player names.** Every string you see in the lobby is derived from a map id or a faction
index — never from anything another person typed. You are *You*; the other player is *Opponent*.

---

## 4. What is different from a skirmish

| Setting | In a PvP match |
| --- | --- |
| Opponent | The other player. No AI. |
| Difficulty, personality | Not offered — there is no AI to configure |
| Starting credits | Forced to **10,000** on both clients |
| Game speed | Forced to **1×** |
| Opening | Forced to the **construction vehicle** start |
| Unlocks | **Suppressed entirely.** Both players can build everything, including aircraft, superweapons and the naval arm. |
| Pause | Does not exist. The pause menu opens over a still-running simulation. |

Because gating is lifted, a PvP match is the only place you will see the whole roster without having
ground the mission table out — including the six superweapons, all four aircraft and every commander
power. Every one of those goes through the same command bus as a right-click, so they resolve
identically on both machines and record correctly into a replay. (The five commander powers still
have no button; they are console-only on both ends.)

Unlock suppression is not a convenience, it is a correctness requirement: the gate is consulted while
the world is being built, and it answers from the *local* profile. Two players with different mission
progress would build different starting armies and diverge before either of them moved.

---

## 5. The lockstep model

| Property | Value |
| --- | --- |
| Simulation rate | 30 Hz |
| Turn length | 3 ticks — **10 turns per second, ~100 ms per turn** |
| Input delay | 2 turns — **200–300 ms between the click and the effect** |
| Lookahead | 4 turns |

Your commands are collected, sent at the end of a turn, and executed two turns later on both
machines simultaneously. The 200–300 ms of input delay is not lag — it is the mechanism, and it is
constant regardless of your ping.

**The step gate stalls; it never skips.** If your opponent's commands for a turn have not arrived, the
simulation stops and waits. Tick N is tick N whenever each machine gets there; executing a turn
without a peer's commands would be permanent divergence.

> **A stall is invisible.** The code that measures how long you have been waiting exists and is
> commented as being "read by the HUD to raise a 'waiting for opponent' indicator" — and nothing reads
> it. There is no such indicator in the shipped build. A late opponent produces a frozen simulation
> with a live camera and no explanation on screen. If the game appears to freeze while the camera
> still pans, you are waiting for the other player.

---

## 6. Desyncs and disconnects

**Desync ends the match.** Both clients fingerprint their simulation state every turn and the relay
compares them. A mismatch stops the game for both players with *"The two games fell out of step and
the match was stopped."* It is scored as a **loss for both sides**, which is deliberate — there is no
honest way to say who was right.

A handful of other conditions are also fatal by design: a command the build cannot apply, a command
that fails validation on the client, an unparseable frame. In each case the match ends rather than
the command being silently dropped, because dropping it on one machine and not the other is a desync
with no findable cause.

**There is no reconnection.** A dropped socket ends the match. This is stated in the source as a
deliberate v1 scope decision, not an oversight.

| What happens | Result |
| --- | --- |
| Your opponent's socket drops | You keep playing — the relay fills their turns with blanks — and see *"Opponent disconnected — 30s"* |
| …and they do not come back | After the 30-second grace, **you win**: *"Your opponent disconnected. The match is yours."* |
| Your opponent stops sending but still answers pings | After 15 seconds of silence it is treated as a disconnect and the same grace runs |
| Your opponent quits cleanly | The same 30-second countdown runs. There is no instant resignation. |
| **Your** socket drops | The match stops and is **scored as a loss for you** |

There is no AI takeover, no pause-on-disconnect and no rejoin.

---

## 7. What does not exist

Stated plainly, because it is quicker than finding out:

- No public or hosted match server.
- No reconnect, and no rejoin after a drop.
- No spectators or observers.
- No teams, no 2v2, no free-for-all — 1v1 only.
- No chat, pings, emotes, taunts or player names.
- No ranking, rating, ladder or leaderboard.
- No lobby ready-check, host kick or map veto.
- No pause.
- No "waiting for opponent" indicator.
- No persistence of anything: rooms, matches and queue positions live in the server process and are
  gone if it restarts.
- No accounts, no funds, no personal data anywhere in the server. Client addresses are hashed with a
  salt generated fresh at every server boot.

Two smaller things worth knowing:

- **Build-version checking is off by default.** The client sends its build string, and the server only
  refuses a mismatch if the operator explicitly configures one. Two players on different builds can
  therefore be paired, and the result is a desync a minute later rather than a clean refusal. If you
  are hosting, set the required build.
- **Browsing the room list disconnects you after 60 seconds.** The idle timeout counts *hosting*,
  *queuing* and *playing* as busy — but not *watching the list*. Sit on the browser without hosting or
  queuing and you will be dropped at the one-minute mark regardless of what you are clicking.

---

## 8. Server limits

Every one of these is an environment-variable override on the relay, and these are the defaults.

| Limit | Default |
| --- | --- |
| Bind address / port | `127.0.0.1:8787` |
| Connections | 500 total, 8 per address |
| Concurrent matches | 200 |
| Open rooms | 200 |
| Messages | 40/sec per socket, burst 80 |
| Join attempts | 10 per minute |
| Heartbeat | 15 s; two missed pongs terminates |
| Room-browser idle timeout | 60 s |
| Invite code lifetime | 10 minutes, single use |
| Match lifetime | 2 hours |
| Disconnect grace | 30 s |
| Peer silence before disconnect | 15 s |
| Maximum message size | 64 KB |
| Commands per turn | 32 (a turn over the cap is emptied, not truncated) |
| Entities per command | 100 |
| Room list length | 60 shown, true total reported |

The default origin allowlist accepts the project's published site and the standard local development
ports.

---

## 9. If you are trying it anyway

Practical notes for a two-machine test on a LAN:

1. Run the relay with `VM_HOST=0.0.0.0` so it is reachable off the loopback.
2. Serve the client over plain HTTP from the same origin on both machines, or the browser will refuse
   the plaintext socket.
3. Point the second machine at the relay with `?relay=ws://<host>:8787/ws`.
4. Set `VM_REQUIRE_BUILD` to the version both machines are running.
5. Expect 200–300 ms of input delay by design, and expect a freeze rather than a warning if one side
   hitches.

The determinism itself is well covered — there is a cross-engine desync probe with a committed
baseline, a replay system that reproduces a match from its command stream, and a checksum comparison
running every turn. What is missing is not correctness. It is deployment.

---

**See also:** [Strategy](Strategy) · [Maps](Maps) · [How to Play](How-to-Play) ·
[Controls](Controls) · [Units and Verbs](Units-and-Verbs) · [Home](Home)
