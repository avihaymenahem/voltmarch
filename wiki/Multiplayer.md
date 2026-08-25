# Multiplayer

> ## Read this first
>
> **The public relay is live.** Open the current browser build at
> [play.voltmarch.com](https://play.voltmarch.com/). It connects to
> `wss://relay.voltmarch.com/ws`, and the title screen probes that relay before enabling Multiplayer.
>
> If the relay is unavailable, Multiplayer stays disabled rather than opening a dead lobby. The
> source and deployment templates remain in this repository for local development and self-hosting.
>
> Everything below describes what happens when you do run one.

---

## 1. What multiplayer is

Deterministic lockstep over a relay. Two human clients run the *same* simulation from the same seed,
and the only thing that crosses the network is their commands. A match may contain two human armies
and up to two AI armies: the server owns that logical seat plan while the clients still run every
simulation entity. The server forwards turn frames and **runs no game code at all** — it has no idea
what a tank is, and it cannot be asked to grant one.

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

The client resolves its relay address in this order: `?relay=` on the URL → the platform settings
store → a `VITE_RELAY_URL` baked in at build time → **`ws://localhost:8787/ws` if and only
if the page is served from `localhost` or `127.0.0.1`** → nothing.

That last fallback makes multiplayer work out of the box in local development. The published build
does not rely on it: GitHub Actions bakes `wss://relay.voltmarch.com/ws` into the game served from
`play.voltmarch.com`.

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

**Left column — your side.** Choose a 2–20 character commander name and a faction. Names accept
Unicode letters and numbers plus spaces, `_`, `.`, and `-`; they are normalized and checked again by
the relay. Then either:

- **Host a match.** Choose a format — head-to-head 1v1, co-op 2v1 AI, or co-op 2v2 AI — then choose
  the human and AI factions, each AI difficulty, a compatible battlefield and a visibility.
  *Public* puts the room in the browser; *Invite only* gives you a six-character code to send to one
  person. Codes are single-use, expire after ten minutes, and omit easily confused characters.
- **Join with a code.** Type the six characters and press Enter.

**Right column — open matches.** A live, pushed list of public rooms with map, faction, format and
age, plus two local filters and a **Quick Match** button. Quick Match deliberately remains a 1v1
queue: the first player waits, the second starts a match immediately. There is no rating and no
matchmaking beyond that.

**Joining starts the match at once.** There is no waiting room, no ready check, no host kick and no
lobby chat. The moment a second player enters, the room is deleted and the match begins.

Mixed matches always use two allied humans against one or two allied AIs. Each human client hosts
one AI brain at most, and those orders travel through the relay exactly like human commands. This is
co-op against AI, not shared control: every army still has one logical owner.

Commander names appear in the public room list, live army labels, chat, end-screen opponent data and
new replay headers. Older replays remain readable and fall back to faction names.

### In-match communication

- Press **Enter** during a live match to open the compact chat field. Enter sends; Escape cancels.
  Messages are one line, capped at 180 characters and rate-limited by the relay.
- In a mixed co-op match, **right-click the minimap** to place an expanding ring for your human
  teammate. The relay sends it only to sockets on the sender's team. A duel has no teammate, so the
  ping action is disabled there.
- Chat and map pings are presentation messages. They do **not** enter `WireCommand`, the delayed turn
  stream, checksums or replay commands; losing one cannot desynchronise a match.

---

## 4. What is different from a skirmish

| Setting | In a PvP match |
| --- | --- |
| Opponents | One human in a duel, or one/two AI armies in mixed co-op. AI takes over a departed human army. |
| Difficulty, personality | Each hosted AI has a selectable difficulty; personalities are not offered. |
| Starting credits | Forced to **10,000** on both clients |
| Game speed | Forced to **1×** |
| Opening | Forced to the **construction vehicle** start |
| Unlocks | **Suppressed entirely.** Both players can build everything, including aircraft and superweapons. |
| Pause | Does not exist. The pause menu opens over a still-running simulation. |

Because gating is lifted, a PvP match is the only place you will see the whole roster without having
ground the mission table out — including the six superweapons and all four aircraft. Both go through
the same command bus as a right-click, so they resolve identically on both machines and record
correctly into a replay.

Two things are NOT in that list any more and neither needed to be. **The five commander powers** are
bought from a Command Post with credits both players can see, so they were never gated by the
profile. **The navy** is not gated either: docks, hulls and the swimmer infantry are day-one in a
skirmish too, and a lockstep match is exactly why — a profile-based refusal lands on one machine and
not the other, and content required to reach the enemy is the worst possible thing to hang that on.

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
machines simultaneously. In mixed co-op each socket merges its human commands with the commands of
its assigned AI seat before submitting the frame. The relay accepts a logical player id only when
that id is in its server-owned control list for that socket. The 200–300 ms of input delay is not
lag — it is the mechanism, and it is constant regardless of your ping.

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

**There is no reconnection.** Catching a dropped client up still requires replaying every missed
turn, so that client stops locally. The surviving match no longer ends: the relay retires the dead
command source and delegates both the departed human army and any AI seat that socket hosted. The
remaining client runs those brains through the same command bus.

| What happens | Result |
| --- | --- |
| The other socket drops | Its human seat and hosted AI seats are delegated immediately; AI command takes over. |
| The other socket stops sending but still answers pings | After 15 seconds of silence it receives the same takeover. |
| The other player quits cleanly | Its human army and hosted AI work are handed over immediately. |
| **Your** socket drops | The match stops and is **scored as a loss for you** |

There is AI takeover for the survivor, but still no pause-on-disconnect or rejoin.

---

## 7. What does not exist

Stated plainly, because it is quicker than finding out:

- The hosted service is anonymous; it has no account or social layer.
- No reconnect or rejoin after a drop; the survivor continues against AI.
- No spectators or observers.
- No four-human 2v2, online free-for-all or shared army control. Mixed 2v1/2v2 is two humans versus AI.
- No emotes, taunts, friend list or account-backed identity. Commander names are local handles.
- No ranking, rating, ladder or leaderboard.
- No lobby ready-check, host kick or map veto.
- No AI personalities and no co-op Quick Match queue.
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
| Peer silence before disconnect | 15 s |
| Maximum message size | 64 KB |
| Commands per turn | 128 (a turn over the cap is emptied, not truncated) |
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
5. Host a duel or mixed co-op room; Quick Match remains a duel queue.
6. Expect 200–300 ms of input delay by design, and expect a freeze rather than a warning if one side
   hitches.

The determinism itself is well covered — there is a cross-engine desync probe with a committed
baseline, a replay system that reproduces a match from its command stream, and a checksum comparison
running every turn. What is missing is not correctness. It is deployment.

---

**See also:** [Strategy](/avihaymenahem/voltmarch/wiki/Strategy) · [Maps](/avihaymenahem/voltmarch/wiki/Maps) · [How to Play](/avihaymenahem/voltmarch/wiki/How-to-Play) ·
[Controls](/avihaymenahem/voltmarch/wiki/Controls) · [Units and Verbs](/avihaymenahem/voltmarch/wiki/Units-and-Verbs) · [Home](/avihaymenahem/voltmarch/wiki/Home)
