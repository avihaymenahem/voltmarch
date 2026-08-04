# Missions & Progression — design

**Status:** agreed scope, not yet built.

## The problem, in the user's words

> "kinda boring when you have everything unlocked, so progression will open up new stuff"

That framing matters. The deliverable is not "add missions" — missions are only the delivery
mechanism. **The actual design is the unlock curve**: what a player has on day one, what they earn,
and in what order. Get that wrong and the missions are busywork attached to a game that already gave
everything away.

## Agreed scope

| Decision | Choice |
| --- | --- |
| Content model | **Objective-driven skirmish.** No hand-authored story maps, no scripted triggers, no narrative. |
| Unlocks gate | Specialist units & superweapons · maps & battlefields · commander powers & cosmetics |
| Factions | **All four available from the start.** Explicitly *not* an unlock. |
| AI | **Mirrors the player's unlock tier.** Difficulty scales through economy handicap and reaction time, as `AIStrategy` already does. |

The 4th faction being ungated was a deliberate call against the recommendation to make it a reward.
It stays ungated; that is not up for re-litigation, but it does mean the unlock curve has to carry
motivation on its own, which raises the bar on the reward table below.

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
  profile-store.ts      versioned localStorage profile; export/import as JSON
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

Three traps, and the rules that avoid them.

**1. Locking the roster makes game *one* boring, not game ten.**
The starting army must be complete enough for a genuinely satisfying match: the full building line,
infantry, a main battle tank, harvesters, basic defences. A player who has to grind before the game
is fun has already stopped playing.

**2. Power creep against the AI.**
If unlocks are strictly stronger, early matches are unfair and late ones trivial. Unlocks skew toward
**sidegrades and options** — a prism tank is not better than a main battle tank, it is different.
Superweapons are the one deliberate exception and sit at the end of long chains.

**3. Rewards must be visible.**
An unlock the player does not notice is not a reward. Every unlock gets an end-screen reveal, a
"NEW" badge on its cameo, and an entry in the missions screen.

### What is gated

| Tier | Available | Earned |
| --- | --- | --- |
| Units | Infantry, main tank, harvester, dozer, basic defence | Prism/tesla specialists, artillery, naval, air |
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
