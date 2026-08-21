# Missions & Progression — design

**Status:** BUILT and shipped. This line said "agreed scope, not yet built" until 2026-08-07, long
after every file the Architecture block below proposes had landed with real consumers. Read what
follows as the design rationale for code that exists, not as a plan.

One promise in here is genuinely still unkept, and it is called out where it appears: rewards are
granted and announced, but nothing in the game consumes an unlock. See §Rewards.

## The problem, in the user's words

> "kinda boring when you have everything unlocked, so progression will open up new stuff"

That framing matters. The deliverable is not "add missions" — missions are only the delivery
mechanism. **The actual design is the unlock curve**: what a player has on day one, what they earn,
and in what order. Get that wrong and the missions are busywork attached to a game that already gave
everything away.

## Agreed scope

| Decision | Choice |
| --- | --- |
| Content model | **Objective-driven skirmish** for the missions in this document. Hand-authored story maps and scripted triggers live in the CAMPAIGN, which is a separate system — see below. |
| Unlocks gate | Specialist units & superweapons · maps & battlefields · commander powers & cosmetics |
| Factions | **All four available from the start.** Explicitly *not* an unlock. |
| AI | **Mirrors the player's unlock tier.** Difficulty scales through economy handicap and reaction time, as `AIStrategy` already does. |

The 4th faction being ungated was a deliberate call against the recommendation to make it a reward.
It stays ungated; that is not up for re-litigation, but it does mean the unlock curve has to carry
motivation on its own, which raises the bar on the reward table below.

### The content-model row said "no scripted triggers", and two systems now have them

That row read **"Objective-driven skirmish. No hand-authored story maps, no scripted triggers, no
narrative"** from the day it was written, and it was a scope fence around THIS document rather than
a claim about the engine. It stopped being readable that way the moment a second system wanted
triggers, and it was cited as a prohibition twice before it was corrected here:

- **The tutorial** (`src/shell/tutorial-steps.ts`) is scripted triggers and nothing else. Its header
  cited this row as reason 1 of three for not reusing the mission model. **That reason is retired.**
  Reasons 2 and 3 are the load-bearing ones and are untouched: a mission advances a COUNTER off an
  event while a tutorial step measures a DELTA against a per-step baseline, which the rule language
  has no concept of; and the objectives panel reads one global provider that the progression system
  owns.
- **The campaign** is a story mode of authored operations with a declarative trigger table evaluated
  by a pure director inside `simTick`. It is a **second consumer of the engine**, not a widening of
  the mission system, and it shares no rule language with `MissionRule` — deliberately, because
  `RULE_KINDS` evaluates counters over the EVENT STREAM outside `simTick` while an operation needs
  state predicates over the WORLD inside it. Two languages on opposite sides of the determinism
  boundary is the whole argument, and it is the same one the tutorial made first.

**What survives unchanged is the sentence that was actually doing work:** the missions in this
document are counters and match objectives, they are drawn rather than authored, and nothing in
`src/data/Missions.ts` is a story beat. Widening `MissionRule` to carry a campaign trigger is still
refused, and `validateMissions` refuses a campaign rule kind outright rather than trusting the type.
The fence moved; it did not come down.

**A citation to this file must name a section, never a line number.** The row above was cited as
"line 18" by `tutorial-steps.ts` and had drifted to line 23 by the time anyone checked — a pointer
that silently stops pointing at the thing it names is the defect `docs/SPEC_DRIFT_AUDIT.md`
catalogues, in miniature.

## Two scopes, one system

**Profile missions** — cross-game. Persist in a save profile, track across every match, drive
unlocks. *"Destroy 250 vehicles." "Win a match with each faction." "Bank 20,000 credits in a single
match."*

**Match objectives** — per-match, alongside the win condition. *"Lose no harvesters." "Win inside 15
minutes." "Capture the neutral tech lab."* They pay out in-match **and** feed profile progress, which
is what stops the two systems feeling bolted together.

## Architecture

```
src/progression/
  profile-store.ts      versioned platform profile; export/import as JSON
  MissionTracker.ts     subscribes to the event bus, advances mission counters
  UnlockGate.ts         resolves "what can this player build right now"
  progression.system.ts SystemModule; wires the tracker to channels
src/data/Missions.ts    the declarative mission table
src/ui/Objectives.ts    in-match objective panel
src/shell/Missions.ts   menu screen: chains, progress, rewards
```

### The determinism boundary — non-negotiable

**Mission tracking subscribes to the event bus and never runs inside `simTick`.**

The simulation is deterministic under a fixed seed and there is a soak test asserting an AI-vs-AI
match replays identically. Mission state is player-profile data — it has no business influencing
simulation state, and letting it in risks desyncs for zero gameplay benefit. Anything a mission needs
that is not already an event gets a cheap sampler on the presentation side.

The events we already emit cover most of it: entity spawned/destroyed, damage dealt, building placed,
production complete, credits changed, power state changed, match ended.

### Mission shape

```ts
interface MissionDef {
  id: string;
  scope: 'profile' | 'match';
  title: string;
  description: string;
  category: 'combat' | 'economy' | 'construction' | 'tactics' | 'mastery';
  tracking: 'counter' | 'threshold' | 'flag' | 'timed' | 'streak';
  target: number;
  /** Declarative predicate over the event stream — never arbitrary code. */
  match: EventPredicate;
  reward: Reward[];
  requires?: string[];      // mission ids — this is how chains form
  faction?: Faction;        // faction-specific chains
  difficulty?: 1 | 2 | 3;
}
```

Declarative predicates rather than callbacks, for the same reason `Defs.ts` is a table: authoring a
mission should be adding a data row, and data rows can be validated at module load.

## The unlock curve

Four traps, and the rules that avoid them.

**1. Locking the roster makes game *one* boring, not game ten.**
The starting army must be complete enough for a genuinely satisfying match: the full building line,
infantry, a main battle tank, harvesters, basic defences. A player who has to grind before the game
is fun has already stopped playing.

**2. Power creep against the AI.**
If unlocks are strictly stronger, early matches are unfair and late ones trivial. Unlocks skew toward
**sidegrades and options** — a refractor tank is not better than a main battle tank, it is different.
Superweapons are the one deliberate exception and sit at the end of long chains.

**3. Rewards must be visible.**
An unlock the player does not notice is not a reward. Every unlock gets an end-screen reveal, a
"NEW" badge on its cameo, and an entry in the missions screen.

**4. A battlefield can turn optional content into the only road.**
The three rules above are all about CONTENT, and they were all satisfied when `Sunder Atoll` shipped:
a fresh profile kept a complete army, nothing it was missing was strictly stronger, and every reward
was visible. It was still a **permanent stalemate** on a fresh profile — four islands, one army each,
`struct.naval` behind "win 10 skirmishes", every lift behind a dock, and `UnlockGate.mirrorAI`
stranding the AI on the same terms. Four armies that could not touch each other, and no way for the
match to end.

So the rule the other three do not cover:

> **Content required to REACH THE ENEMY is never progression-gated.**

It is answered from the **map**, not from the profile — `mapForcesSeaCrossing` in
`src/sim/LandRoutes.ts` is true only where there is navigable water AND the ground is split into more
than one land mass, which today is `Sunder Atoll` and nothing else. On every land map, and on both
half-plane sea maps, a dock stays exactly as gated as it was: there the sea is a second front, not
the only one. The exemption covers the dock and the amphibious lift and stops there
(`ProductionCatalog.isSeaMobility`) — **warships stay earned**, because a gunboat widens an army and
a barge is how the army arrives.

Deriving it from the map rather than the profile is also what keeps it PvP-safe: every client shares
the battlefield, so every client gets the same answer. `tests/sea-crossing-gate.spec.ts` is the gate.

### What is gated

| Tier | Available | Earned |
| --- | --- | --- |
| Units | Infantry, main tank, harvester, dozer, basic defence | Refractor/tesla specialists, artillery, naval, air |
| ...except | On a map with no land route, the dock and the lift (see trap 4) | The warships still are |
| Structures | Con yard, power, barracks, refinery, war factory, radar | Tech centre, advanced defences, superweapon structures |
| Maps | 2–3 starters | Naval, urban, canyon, snow biomes |
| Meta | — | Commander powers, insignia, unit decals |
| Factions | **All four** | — |

### AI parity

`UnlockGate` resolves for a *player*, not globally. The AI player resolves against the human's tier,
so it can never field something the player has not seen. Difficulty remains economy handicap +
reaction time + composition quality. A skirmish-setup toggle can lift the restriction for players who
want the harder game.

## Persistence

`profile-store.ts` follows the existing `settings-store.ts` pattern: localStorage, a versioned
schema, and an explicit migration path. Two requirements that are easy to skip and painful to retrofit:

- **Export/import as JSON**, so a cleared browser store is not a wiped account.
- **Schema version + migration from day one.** The first shipped save format is permanent; changing
  it later without migration silently destroys player progress.

## UI surfaces

- **Main menu → Missions**: chains, progress bars, rewards, locked/unlocked state.
- **In match**: objective panel in the HUD, collapsible, showing active objectives and progress.
- **Pause menu**: current objectives (sits naturally beside the new help screen).
- **End screen**: objectives completed, missions advanced, unlocks earned — with a reveal beat.

## Rollout

1. Profile store + schema + migration
2. Mission catalogue + tracker (profile scope only) — provable without any UI
3. `UnlockGate` in the production catalogue + AI parity
4. Missions menu screen + end-screen rewards
5. Match objectives + HUD objective panel
6. Content: author the chains

Each phase is shippable. Phase 3 is the one that can break an existing player's match, so it needs
the most care: a profile with nothing unlocked must still produce a complete, winnable game.

## Open risks

- **Grind.** Targets tuned too high turn unlocks into a chore. Start generous; it is easy to raise a
  number and hostile to lower one after players have earned things.
- **Locked content the AI shows off.** Solved by AI parity, but it must hold everywhere — including
  neutral/capturable structures and map-placed hardware.
- **Save corruption.** Mitigated by versioning + export, but a corrupt profile must fail soft to a
  fresh one rather than a broken boot.
- **Objective spam.** Too many simultaneous objectives is noise. Cap the visible set.
