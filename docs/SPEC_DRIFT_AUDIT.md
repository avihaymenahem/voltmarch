# SPEC DRIFT AUDIT

**Audited:** 2026-08-05, against `main` @ `d284bd6` plus 27 files modified in the working tree.
**Scope:** whole repo except the areas noted as excluded in §8.
**Result:** 61 findings survived a sceptic pass; 14 candidates were killed.
**Status of this file:** a record of what was true on 2026-08-05, not a task list, and **no longer
a description of HEAD.** It said "Nothing here has been fixed" until 2026-08-07; by then roughly
half of the 61 findings had been, across releases v1.15.0–v1.25.0 — the MCV prereqs, the `world.vfx`
port, `Crush.ts`, `match:started`, the `--expect` parse and others were spot-verified as closed.

That blanket header had itself become the expensive thing: it forced every reader to re-verify all
61 findings before trusting any one of them, which is the exact cost this document exists to avoid.

Individual findings are **not** annotated with their current state, and deliberately so — an
annotation is another claim that can rot, and this file has already demonstrated how that goes.
Check the finding against HEAD before acting on it. Confirmed-still-live as of 2026-08-07:
findings 2, 3, 4, 6 and 7.

**Findings were added after the audit: #62 at the end of §3, and #63-#65 in §10.** It is the
missing world-space ore
renderer — nine claims across five files, three of them flatly false. It is out of numbering order
because it was found on 2026-08-12 rather than on 2026-08-05, and it is annotated with its state
(fixed, with a named residue) against the rule above, because a finding added *after* its own fix
would otherwise read as a live defect.

---

## 1. What this class of bug is

> **Something in the repository makes a factual claim, the claim is false, and the claim is
> load-bearing.**

All three clauses matter.

*A claim* is anything that asserts behaviour to a reader: a comment, a doc line, a blurb shown to
the player, a constant's name, a type declaration, an authored data field, a console message. Not
code — code cannot be wrong about itself. The claim is always in the layer *above* the code.

*False* means it contradicts what the code does, measurably. Not "unclear", not "outdated in
spirit", not "could be phrased better". If you cannot write down file:line for the claim and
file:line for the contradicting reality, it is not a finding.

*Load-bearing* means someone or something acts on the claim. A player reads a tooltip and buys the
unit. An agent reads a comment and skips a check. A tuning pass reads a measured number and moves a
different knob. A future author reads a type and assumes the compiler is holding a boundary that it
is not. The load may be latent — the claim can sit harmlessly for months and become the whole game
the moment one assumption changes. Latency is not mildness. See case 3 below.

The defining property of this bug class, and the reason it needs a dedicated audit, is that
**neither the compiler nor the test suite can see it**. A comment is not typechecked. A blurb is a
string. A dead constant compiles. A per-faction table typed `Record<string, T>` accepts a missing
faction silently. Every instance below was found by a human or an agent *reading* — never by a green
build.

### The twelve prior cases

These shipped, were found by accident, and are the evidence that this is a pattern rather than a
run of bad luck. They are listed here so a reader cold on the project can calibrate what the shape
looks like before reading §3.

| # | What was asserted | What the code did | How it surfaced |
|---|---|---|---|
| 1 | Bible: "median frame luminance 0.317" | The probe measured **linear** luminance against an **sRGB** target — the reference looked 3× darker than its own spec. §0.1 of the bible literally says "two measurement frames — never mix them". | Numbers disagreed by 3× |
| 2 | `GLOW` block in `Explosions.ts` said the flash was tamed | It halved the flash **size** and left `flashIntensity` at 7.0. Two knobs for one quantity, in two files. | User reported it a second time |
| 3 | Refinery blurbs: **"Ships with one."** on all three factions | Never implemented. Harmless while bases were pre-built by hand; the moment matches started from an MCV, three of four AI factions starved. | AI economy flatlined |
| 4 | `deploysInto` authored on every MCV; `OrderKind.Deploy`, `UnitState.Deploying`, `EntityFlag.Deployed`, `FeedbackKind.CannotDeployHere` all defined | **Zero references** in `apps/game/src/sim`, `apps/game/src/input`, `apps/game/src/ui`. A complete vocabulary with no implementation. | User asked why games start pre-seeded |
| 5 | `Shapes.ts` published eleven new primitives | Both factories ended their mass loop at `default: buildBox` — all eleven rendered as cubes. | Integrator read the loop |
| 6 | `TEAM_RGB` sized `3 * 3` | A 4th faction indexed past the end → `undefined` → **NaN** in an instance colour → bloom spread NaN through its mip chain → every pixel dead, while stats reported 285 draws. | Black frame |
| 7 | `billowShellFrac` — a *fraction* of `billowSize0TL` | Shrinking the billows collapsed the shell with them and re-stacked 8–14 additive sprites on one pixel: **brighter, not smaller**. Should have been an absolute length. | Flash fix made it worse |
| 8 | `puffSize1TL` — the bible's figure for the **whole plume** | Applied to **each** puff. A test asserted against the wrong one. | Consolidation pass |
| 9 | Options screen advertised **W/A/S/D** for camera pan | `input.system.ts` hard-coded **arrows**. Measured: `KeyD` → 0 m, `ArrowLeft` → 43.8 m. Four prominent rows described a scheme that did not exist; rebinding them did nothing. | Integrator walked the UI |
| 10 | `tools/shoot.mjs` reported "12/12 captured" | Two shots photographed the **boot curtain** mid "COMPILING SHADERS". `__VM.ready()` resolving is not the game being on screen. | Identical metrics on two scenarios |
| 11 | `tools/metrics.mjs` printed a confident "Weighted grade score" | It scored **whatever files it was handed** — sometimes 2 of 12 — with no sample size. | Agent watched the directory get wiped mid-run |
| 12 | `detectQualityTier()` chose a GPU preset | It read **CPU core count and system RAM** and never looked at the GPU. A 16-core Ryzen with *integrated* Radeon got `ultra`: 4096 shadow maps, full-res GTAO. | User reported 100% GPU |

Read the "how it surfaced" column. Not one entry says "a test failed".

Note also that four of the twelve (1, 10, 11, 12) are in the *measuring* apparatus, not the game.
That ratio repeats below: §3 findings 6, 7, 14, 15, 16, 17 are all instrument defects, and they
compound — a broken probe does not merely fail to catch drift, it actively certifies it and then
leaks its own bug into the product being measured (see finding 7).

---

## 2. How to read §3–§5

Findings are ranked by blast radius, not by how interesting they are.

- **Tier 1 (§3, findings 1–17, plus #62)** — a player, a reviewer or a CI run gets a wrong answer
  today. #62 sits at the end of §3 out of numbering order; see the note in the header.
- **Tier 2 (§4, findings 18–47)** — real contradictions, either narrower in effect or dormant.
- **Tier 3 (§5, findings 48–61)** — verified, small.

Each finding carries **LIVE** or **LATENT**.

- **LIVE** — someone is being given a false answer right now.
- **LATENT** — nothing is wrong today; the contradiction becomes a defect when a named assumption
  changes. Prior cases 3, 4 and 6 were all LATENT and all three eventually cost real time. *Latent
  does not mean minor. It means undated.*

Every finding has a **check** that runs in under a minute. Run it before you believe me. Line
numbers were correct at audit time in a tree where two agents were actively editing; prefer the
grep to the line number.

---

## 3. Tier 1 — live today

### 1. The "WAR FACTORY ONLY" MCV fix landed in a table `resolveEntry` ignores — **LIVE, critical**

**Claim.** `apps/game/src/data/Defs.ts:672-677`, on the `mcv` def:

```
// WAR FACTORY ONLY. See the note above the roster: a match now OPENS from
// one of these ... `battleLab` carries `struct.tech` and would have gated the
// rebuild behind a mission on the exact profile least able to survive losing it.
prereqs: ['warFactory'], sortOrder: 50,
```

The same comment and the same edit appear on `mrdCarryall` (`Defs.ts:846-848`,
`prereqs: ['mrdForgeyard']`) and `rclCrawler` (`Defs.ts:1010-1012`,
`prereqs: ['rclBreakerYard']`). Three deliberate, reasoned, identical fixes.

**Reality.** `apps/game/src/sim/Production.ts:867` **and** `:905` — both arms of `resolveEntry`:

```ts
prereqs: spec.prereqs,
```

Every other field in that merge falls back `def?.x ?? spec.x`. `prereqs` alone takes the spec
unconditionally, and `ContentSpec` is documented at `Production.ts:152` as the tech-tree authority.
The live rows are `Production.ts:394` `mcv → ['warFactory','battleLab']`, `:541`
`mrdCarryall → ['mrdForgeyard','mrdReliquary']`, `:678`
`rclCrawler → ['rclBreakerYard','rclCrucible']`.

**Consequence.** All three second gates carry `struct.tech` (`Defs.ts:475-477`), which `UnlockGate`
withholds from a fresh profile. **A new player who loses their MCV cannot rebuild one**, in a game
whose default start is a lone MCV. The fix was written, reviewed and merged into a table that is
never consulted for this field.

**Why the suite is green.** Three separate assertions each read a *different* table:
`Defs.ts:1774` computes reachability from `d.prereqs` (the fixed one); `apps/game/tests/match-start.spec.ts:441`
also reads `def.prereqs`; `apps/game/tests/match-start.spec.ts:938` builds a `BuildCatalog` from
`AIStrategy.FALLBACK_CATALOG`, a third table. Nothing asserts against `ProductionCatalog`, which is
what the game runs on.

**Check.** `grep -n "prereqs: spec.prereqs" apps/game/src/sim/Production.ts` → 867, 905.
`grep -n "key: 'mcv'" -A 3 apps/game/src/sim/Production.ts` → still `['warFactory','battleLab']`.

---

### 2. Two of the Meridian Pact's three "brownout disarms me" promises are false — **LIVE, high**

**Claim.** `Defs.ts:142-145` — *"the two best guns carry `needsPower` … that is the faction's whole
risk profile."* `Defs.ts:832`, the `mrdZenith` blurb shown in the sidebar: **"Siege beam. Dies in a
brownout."** `Defs.ts:1374`, `mrdGlaive`: **"Anti-infantry repeater. Needs the grid."**
`AIStrategy.ts:780-782` justifies the Pact's opening build order with *"a brownout is not an
inconvenience for this faction, it is a disarm."*

**Reality.** `apps/game/src/sim/Combat.ts:489-490` requires **both** a weapon flag and an entity flag:

```ts
if (w.needsPower && (st.flags[i] & EntityFlag.NeedsPower) !== 0
    && (st.flags[i] & EntityFlag.Powered) === 0) return;
```

`EntityFlag.NeedsPower` is only ever set from a negative **building** `power` value
(`Defs.ts:1146`, `:1151`, `Scenarios.ts:674`). So:

- `mrdZenith` (`Defs.ts:831-841`) is a **unit** — `flags: MRD_TURRETED`. It can never carry
  `NeedsPower`. **The Zenith Emitter fires through a blackout.**
- `mrdGlaive` (`Defs.ts:1373-1379`) is a building at `power: -10`, so it *does* carry the entity
  flag — but its weapon `glaiveRepeater` (`Defs.ts:176-179`) has no `needsPower` extra. **The Glaive
  Post fires through a blackout.**
- Only `mrdHelios` (`power: -55`, `heliosLance` `needsPower: true`) behaves as advertised. Soviet
  `teslaCoil` and Allied `prismTower` are both correct.

**Consequence.** This drawback is the price the Pact pays for the cheapest power in the game. Two
thirds of it is not charged, so the faction is straightforwardly stronger than its own design
document. Two sidebar tooltips tell the player the opposite of what happens, and the AI buys an
early second Solar Array to hedge a risk that does not exist.

**Check.** `grep -n "glaiveRepeater" -A 4 apps/game/src/data/Defs.ts` — no `needsPower`.
`grep -rn "EntityFlag.NeedsPower" src` — writers are buildings only.

---

### 3. `SURVIVOR_KEY` is four long against a five-member `Faction` — **LIVE, high**

`apps/game/src/sim/RepairSell.ts:54-59` states the exact failure it is guarding against — *"A Pact building
selling into a squad of G.I.s would hand the player free units of an army they are not playing"* —
and then:

```ts
const SURVIVOR_KEY: readonly string[] = ['gi', 'gi', 'conscript', 'mrdWayfarer'];
```

`FACTION_COUNT = 5` (`apps/game/src/core/types.ts:160`). `RepairSell.ts:376` reads
`SURVIVOR_KEY[p.faction] ?? 'gi'`, so **a Reclamation player selling a structure gets Allied
Peacekeepers.** `Production.spawnUnit` (`:2096`) takes `defId` from the `gi` entry and the faction
column from `p.faction`, producing an `(Infantry, faction=Reclaim, defId=gi)` triple whose `packKey`
no art module registered. The correct key is `rclPicker`.

This is confirmed case 6 (`TEAM_RGB` sized `3 * 3`) recurring in a different array. The type
`readonly string[]` is what lets it through; `readonly [string, string, string, string, string]` or
`Record<Faction, string>` would not compile.

**Check.** `grep -n "SURVIVOR_KEY" apps/game/src/sim/RepairSell.ts` — count the literals.

---

### 4. `FREE_UNITS` has no `reclaim` row — **LIVE, high**

`apps/game/src/sim/Crates.ts:97-102` has four keys: `allies`, `soviets`, `meridian`, `neutral`.
`Crates.ts:473` resolves the faction through `FACTION_PALETTE_KEYS`, which **does** contain
`'reclaim'` (`types.ts:714`). `Crates.ts:348`:

```ts
const keys = FREE_UNITS[factionKey(p.faction)] ?? FREE_UNITS.neutral;
```

A Reclamation player who opens a unit crate is handed `gi` and `conscript` — same wrong-mesh
consequence as finding 3. Reclaim's own cheap roster is `rclGrinder` / `rclSpitter` / `rclPicker`.
The declared type `Readonly<Record<string, readonly string[]>>` gives `tsc` nothing to check;
`Record<FactionPaletteKey, …>` would have.

**Check.** `grep -n "FREE_UNITS" -A 6 apps/game/src/sim/Crates.ts`.

---

### 5. The `IVfx` port is never bound — 18 sim call sites are no-ops, three tuning constants feed nothing — **LIVE, high**

`apps/game/src/core/world.ts:1162` declares `vfx: IVfx = new NullVfx();`. The sibling port *is* bound —
`apps/game/src/audio/audio.system.ts:255` does `world.audio = port;`. But:

```
$ grep -rn "\.vfx *=" src tests tools
(no output)
```

Nothing ever replaces the null object. Dead call sites: `vfx.decal` ×7 (`Damage.ts:312,612,662,663`;
`Superweapons.ts:604,639,818`), `vfx.shake` ×9 (`Crates.ts:385`; `Damage.ts:613,643,788`;
`RepairSell.ts:341`; `Superweapons.ts:640,666,794,819`), `vfx.play` ×2
(`Production.ts:1536,1757`).

Three consequences, each with a claim attached:

- **`COMBAT_DAMAGE.shakePerScale` (config.ts:2219), `SUPERWEAPON_FX.nukeShake = 1.0` and
  `stormShake = 0.22` exist only to feed this port.** Screen shake still happens by a different
  route (`Explosions.ts:383 shakeSink` ← `vfx.system.ts:498`), so a nuke produces exactly the same
  generic trauma as any large fireball. Tuning `nukeShake` does nothing.
- **A destroyed structure never leaves rubble.** `apps/game/src/art/Wrecks.ts:559-560` states it as settled
  fact: *"`Damage.ts#buildingDeath` currently stamps a `DecalKind.Rubble` decal … so the site goes
  flat."* It does make the call. Nothing receives it.
- **A finished building has sound but no visual effect.** `building:completed` reaches audio
  (`audio.system.ts:371` → `SFX.buildRise`); `Production.ts` uses no `channels.fx` at all, and its
  only visual call is the dead `vfx.play(FxKind.BuildComplete…)`.

Explosion scorches survive independently via `setScorchSink` (`Explosions.ts:127` ←
`roads.system.ts:115`), which is why this has gone unnoticed — the most visible decal type happens
to use a different pipe.

**Check.** The grep above. Then `grep -rn "world.audio *=" src` for the contrast.

---

### 6. `tools/metrics.mjs` silently rebases its flagship check onto the reference spread, and its own comment says it does not — **LIVE, high**

**Claim.** `metrics.mjs:35-42`: *"`baselineKey` marks metrics where the observed RA3 distribution is
a better target … **Two cases matter: edgeCoverage … vignetteRatio**."* And `:11` offers a worked
example: *"a median luminance of 0.48 against a target of 0.317 catches it instantly."*

**Reality.** The two entries actually carrying `baselineKey` are **`medianLuminance` (:45)** and
`edgeCoverage` (:52). `vignetteRatio` (:54) carries none. `resolveRange` (:59-65) then replaces the
bible's `[0.26, 0.40]` with `p25 − pad … p75 + pad` drawn from `docs/grade-baseline.json`
(p25 0.2234, p75 0.4017, pad 0.0891).

Measured during this audit:

```
$ node tools/metrics.mjs shots/05-combat.png
  PASS w3  # 4 Frame median luminance (sRGB)   0.4335  target 0.134…0.491  RA3=0.342
```

The enforced band is **[0.134, 0.491]** — printed, but wide enough that the file's own failing
example (0.48) now passes. `01-establishing-base` measures 0.417, also outside the bible, also PASS.

**Consequence.** This is scorecard check #4, weight 3 — the single number the tool exists to
produce. The comment tells a reader the luminance target is the bible's; it is not, and the
substitution is silent in the sense that matters: nobody reading the source would know to look.

**Check.** Run the command above and compare the printed target against `TARGETS.medianLuminance`
at `metrics.mjs:45`.

---

### 7. "Blacks not lifted" is gated at 4× the spec — and the shipping grade was already tuned on the strength of it — **LIVE, high**

`docs/RA3_LOOK_BIBLE.md:815`: `| 6 | Blacks not lifted | p1 luminance ≤ 0.06 and p99 ≥ 0.90 | 3 |`

`tools/metrics.mjs:48`: `p1Luminance: { range: [0.00, 0.25], w: 3, check: 6, … }` — no
`baselineKey`, so this is a hard-coded number that simply disagrees with the source it cites. The 14
RA3 references max out at p1 = 0.077.

Measured: `05-combat.png` p1 = **0.1177**, twice the bible's ceiling, reported `PASS w3 … blacks not
lifted`.

**This has already propagated into the product.** `apps/game/src/core/config.ts:550-553`:

> *"Lift raises the black point. Dropped further toward zero: RA3's own p1 luminance measures 0.023
> and **the scorecard's black-point band tops out at 0.25**, so there is a great deal of room below
> us and none above."*

The reasoning that set the shipping `lift` value is drawn from the probe's bug, not from the bible.
This is the clearest instance in the repo of an instrument defect becoming a product decision, and
it is exactly confirmed case 1 repeating.

**Check.** `grep -n "p1Luminance" tools/metrics.mjs`; `sed -n '813,817p' docs/RA3_LOOK_BIBLE.md`.

---

### 8. Film grain and chromatic aberration shipped ON against an explicit hard ban — **RESOLVED; grain policy superseded 2026-08-27**

The original finding remains below as historical evidence. Chromatic aberration is still banned and
structurally absent from WebGPU. On 2026-08-27 the user explicitly requested restrained film grain;
the replacement ships at 0.006 with a tested 0.008 ceiling and 12 Hz cadence in both backends.

`docs/RA3_LOOK_BIBLE.md:62`, `:252`, `:254`, and `:1081-1082` (`// measured exactly zero — do not
add`) ban both outright. `CLAUDE.md` repeats both as hard bans.

`apps/game/src/core/config.ts:565-569`, the boot values pushed by `ArtBridge.pushArt()`:

```js
/** Film grain. Subtle — it hides banding in the sky gradient. */
grain: 0.016,  grainSize: 1.4,
/** Lens colour fringing at the edges. Tiny amounts read as "a real lens". */
chromaticAberration: 0.0016,
```

Mirrored at `renderer.ts:391,393` (`0.018` / `0.0012`) and re-asserted by a **Film Grain & Vignette**
options row (`Settings.ts:149-151`), default ON (`settings-store.ts:395`). Both are genuinely
applied: `post.ts:276-281` (radial CA) and `:360-365` (animated hash grain), driven from
`syncConfig()` at `:750-752`.

**Magnitude.** `off = centered * uCA * (0.35 + r2*3.0)`; at a corner `|centered.x| = 0.5`, `r2 = 0.5`
→ `0.00148` uv → **±3.8 px at 2560 wide, roughly 7.6 px red-to-blue separation.** The bible's
measured figure is "0.0 px, sub-pixel, at corners".

**And the gate is disarmed.** `metrics.mjs:55` gives `chromaticAber` `w: 0, "(informational only)"`,
and there is **no grain metric at all** — so scorecard #36 cannot fail by construction.

Note this is not "someone forgot the rule". Both comments argue *for* the effect, so a reader
encounters a confident justification rather than an oversight. That is what makes it drift and not a
bug.

**Check.** `grep -n "grain:\|chromaticAberration:" apps/game/src/core/config.ts`;
`grep -n "chromaticAber" tools/metrics.mjs`.

---

### 9. Four different bloom thresholds; the CI regression test uses the night mood's — **LIVE, high**

`apps/game/src/core/config.ts:585-592` argues at length that the value was *"Eased from 1.25 to **1.05** … Do
not take it under 1.0."* Nine lines later, `config.ts:594`: **`threshold: 1.20,`** — within 4% of the
value the comment declares broken.

Meanwhile the entire detonation-gain rework reasons against **0.85**: `config.ts:4104, 4149, 4219,
4454`, and `apps/game/tests/vfx.spec.ts:760`:

```js
const BLOOM_THRESHOLD = 0.85;
… const ceiling = BLOOM_THRESHOLD * 5;   // 4.25; should be 6.0
```

0.85 is not a stale guess — it is `MOODS.night.bloom.threshold` (`config.ts:1130`), i.e. a real value
from the wrong table. Two further variants exist: `renderer.ts` defaults to 1.25, and `Particles.ts`
says 1.25 at `:438` while saying 1.05 at `:406` and `:449`.

**Consequence.** The suite written specifically so the flash regression *"fails in CI instead of in a
bug report"* is calibrated 41% low, and its "must clip to pure white" floor of 1.25 sits at 1.04× the
real threshold — no margin at all. This is confirmed case 2 (two knobs, one quantity, two files) at
four knobs.

**Check.** `grep -rn "threshold" apps/game/src/core/config.ts apps/game/src/render/renderer.ts apps/game/tests/vfx.spec.ts | grep -i bloom -A1`.

---

### 10. Crushing is a complete authored vocabulary with zero implementation — **LIVE tooltip, LATENT mechanic, high**

`types.ts:520-523` defines `EntityFlag.Crushable` and `EntityFlag.Crusher`; `world.ts:153-155`
allocates `crushLevel` and `crushableBy` columns; `Defs.ts` authors 14 values; `rclScrapper` and
`rclGrinder` carry `Crusher`; `Scenarios.ts` has four `Crusher` fallback rows.

```
$ grep -rn "crushLevel\[\|crushableBy\[\|EntityFlag.Crusher\|EntityFlag.Crushable" apps/game/src/sim apps/game/src/render apps/game/src/input apps/game/src/vfx apps/game/src/ui
apps/game/src/sim/Production.ts:2112:    st.crushLevel[i]  = def?.crushLevel  ?? fb.crushLevel;
apps/game/src/sim/Production.ts:2113:    st.crushableBy[i] = def?.crushableBy ?? fb.crushableBy;
```

Two writes, **no reads anywhere**. `Movement.ts` and `Steering.ts` never mention crushing. This is
confirmed case 4 (`deploysInto`) exactly, in a different subsystem.

**Load-bearing twice.** `Defs.ts:963` puts *"Drives over anything soft."* on screen in the sidebar
tooltip — LIVE false. And `Defs.ts:745-748` prices the **entire Meridian amphibious advantage**
against a ram penalty (*"`crushLevel: 0` on everything … so the Pact never wins a ram"*) that does
not exist — so a faction's balance rationale rests on an unimplemented mechanic.
`apps/game/tests/faction3.spec.ts` guards a quantity nothing reads, which is worse than no test: it signals
coverage.

**Check.** The grep above.

---

### 11. `match:started` / `match:ended` have five subscribers and zero emitters — **LIVE, high**

`types.ts:956-957` declares both. Subscribers: `audio.system.ts:467,474`; `MissionTracker.ts:294,307`;
`Hud.ts:750`. **Nothing emits either name.** The match really ends through `Shell.pollOutcome` →
`Shell.endMatch` (`:789`), which calls `progression.endMatch()` directly.

`MissionTracker.ts:38-41` and `progression/types.ts:281-285` both **document and compensate for** the
dead letter — so two of the three subscribers know. **`audio.system.ts` does not.** Therefore:

- `Music.win()` / `Music.loss()` have no other caller — **silence at the end of every match**.
- `EvaLine.MissionAccomplished` / `MissionFailed` reach `Eva.ts` only through this handler.
- `eva?.resetMatch()` / `barks?.resetMatch()` (`:470-471`) never run, so **EVA cooldowns and bark
  state carry across a restart in the same page load** — the second match of a session has a quieter
  announcer than the first.

**Check.** `grep -rn "match:started\|match:ended" src` — read the emit column. There isn't one.

---

### 12. The quality governor is documented in four files and does not exist — **LATENT, high**

`GOVERNOR_DROP_MS`, `GOVERNOR_RAISE_MS`, `GOVERNOR_WINDOW`, `MIN_RESOLUTION_SCALE` and `TARGET_FPS`
each have **exactly one reference — their declaration.** `Profiler.avgFrameMs` (`loop.ts:148,186`,
commented *"used by the quality governor"*) is written and never read. `'quality:changed'`
(`types.ts:958`) is neither emitted nor subscribed. `setResolutionScale` has two callers, both
manual (`Settings.ts:127`, `debug.ts:570`).

`config.ts:1157-1161` states operational behaviour in the present tense: *"The governor drops
resolutionScale BEFORE it drops particles."*

**Why it matters now.** Open task #28 is GPU saturation. Four independent files describe adaptive
quality as a shipped feature, so the most obvious mitigation reads as already-tried. An engineer
picking up #28 will spend an hour finding out otherwise.

**Check.** `grep -rn "GOVERNOR_DROP_MS\|quality:changed\|avgFrameMs" src` — count occurrences per
symbol.

---

### 13. Shadow map size is set twice per `applySettings`, in opposite orders — **LIVE, high**

`apps/game/src/shell/Settings.ts:117-138`. `applyQualityTier(tier)` at line 120 writes
`renderer.shadows.mapSize` from `RENDER_QUALITY_PRESETS` (low 1024 … ultra 4096). Then line 134:

```ts
if (want('graphics.shadowQuality')) {
  configureRender({ renderer: { shadows: { mapSize: SHADOW_MAP_SIZE[settings.graphics.shadowQuality] } } });
}
```

- **At boot**, `Shell.ts:1067` calls `applySettings(settings, game)` with `changed` undefined ⇒
  `all = true` ⇒ both run, shadowQuality last. The default is `'high'` (`settings-store.ts:398`) ⇒
  **2048 on every machine**, including one auto-detected as `low`, whose preset asks for 1024.
- **On a mid-session tier change**, `changed = ['graphics.tier']`, so `want('graphics.shadowQuality')`
  is false and the tier's mapSize stands — while the Shadow Detail chooser still displays the stored
  value.

The comment at `:122-123` promises *"the player's explicit choices are re-asserted on top of it
below"* — which is true for `resolutionScale` (:126) and for `ao`/`bloom`/`smaa`/`filmGrain`
(:140-142), all of which list `graphics.tier` among their conditions. **`shadowQuality` is the one
row that doesn't**, so it is simultaneously the wrong value at boot and the stale value after a
change. Directly relevant to task #28: a machine classified `low` renders 2048² shadow maps.

**Check.** `sed -n '115,145p' apps/game/src/shell/Settings.ts` and look for `graphics.tier` in each `want(...)`.

---

### 14. `tools/shoot.mjs` pins neither the resolution nor the tier it says the scorecard depends on — **LIVE, high**

`shoot.mjs:14-16`: *"Captured at 2560x1440 because §13 quotes its pass criteria in pixels at that
resolution … Shooting at any other size silently invalidates a third of the scorecard."*

`VIEWPORT` is **CSS** pixels (`:36`, with `deviceScaleFactor: 1` at `:226`). The drawing buffer is
`css × dpr × resolutionScale` (`renderer.ts:1023-1026`), and `resolutionScale` comes from
`detectQualityTier()` at `Bootstrap.ts:132`. **`grep -n "tier" tools/shoot.mjs` returns nothing**;
the `SHOTS` table only ever sets `shot` / `seed` / `art`.

So on a `medium` machine that is 0.9 → a 2304×1296 render composited up to a 2560×1440 PNG. On a CI
box classified `software` → tier `low`: **AO and SMAA off entirely**, 0.75 scale, 1024 shadow map —
and shoot.mjs still prints "12/12 captured". `shots/_report.json` records the GPU string but not the
tier, so the artefact cannot be audited after the fact either.

The fix already exists and is unused: `renderer.ts:1019-1021` — *"A fixed size means a screenshot: 1
drawing-buffer pixel per requested pixel"* — reachable through `__VM.setSize(w,h)`.

Knock-on: `tools/crop-surfaces.mjs:1-3` claims its 2× nearest-neighbour crops *"preserve per-texel
noise rather than blurring it away"*, while cutting from already-resampled pixels.

**Check.** `grep -n "tier\|setSize" tools/shoot.mjs` → nothing.

---

### 15. `metrics.mjs --expect N` is inert written flag-first, and warns falsely written flag-last — **LIVE, high**

`metrics.mjs:191` consumes the first `--` token as `mode` and **shifts it off the array**, so
`--expect` is eaten and the `findIndex` at `:219` finds nothing. `:192` then computes
`requested = args.length` *after* the shift, so when the flag comes last, the flag and its value are
counted as file paths.

Measured, both orderings:

```
$ node tools/metrics.mjs --expect 12 shots/01-establishing-base.png
  Weighted grade score: 92.0%  (1 failing checks over 1 image)      ← no gate, exit 0

$ node tools/metrics.mjs shots/01-establishing-base.png --expect 12
  WARNING: 2 of 3 given path(s) did not exist and were skipped.     ← false
  FAILED: expected 12 image(s), scored 1.
```

`--expect` is the CI gate written specifically to close confirmed case 11. Written the natural way it
does nothing. Written the way that works, it emits precisely the "a concurrent shoot.mjs cleared the
directory" alarm (`:199`) that trains the reader to ignore warnings from this tool.

**Check.** Run both lines above.

---

### 16. `shots/_metrics.json` persists a grade with no sample size — and the file on disk proves it — **LIVE, high**

`metrics.mjs:284-289` prints the short-sample warning to **`console.warn` only**. `:298` writes
`{ score, rows, failures }` — no count, no `expected`, no partial flag.

On disk at the start of this audit: `score 0.86`, `rows.length 2`, while `shots/` held 12 PNGs.
Confirmed case 11 was fixed on stdout and not in the artefact that anything downstream actually
reads. A reviewer opening the JSON sees a confident 0.86 with nothing to tell them it came from two
sixths of the scenario set.

*(This audit's verification run overwrote that gitignored file with a 1-row version. Regenerate with
`npm run shots` then `node tools/metrics.mjs shots/*.png --expect 12` — argument order per finding
15.)*

---

### 17. The RA3 "baseline" that overrides the bible is measured on 4:3 JPEGs at a third of the pixel count — **LIVE, high**

`docs/grade-baseline.json` is built from 14 references: **ten at 1440×1080, four at 1024×768, all
JPEG, all 4:3.** `edgeCoverage` is a per-pixel Sobel *coverage fraction* and is not scale-invariant.

Measured on one identical image at three sizes:

```
2560x1440   edge = 0.4401
→1440x1080  edge = 0.5023   (+14%)
→1024x768   edge = 0.5565   (+26%)
```

So a large part of the gap between our 0.44 and the enforced RA3 band `[0.599, 0.855]` is the
*measurement*, not the scene. `edgeCoverage` is the **only weighted failure on
`01-establishing-base`**, and it has been telling reviewers the scene lacks greeble.

The same 4:3-versus-16:9 mismatch contaminates `farNearSatDelta` (top and bottom 25% cover different
world content at different aspect ratios) and `vignetteRatio` (12% corner boxes). It compounds with
finding 14 (our shots are upscaled) and with `sharpen: 0.40` (`config.ts:570-576`), which raises
Sobel magnitude by construction — after which scorecard #34 no longer answers the question §14 R1's
merge gate asks of it.

**Check.** `node -e` over any shot resampled to 1440×1080 and 1024×768; or just read the `width`/
`height` fields in `docs/grade-baseline.json`.

---

### 62. Nine prose sites across five files described a world-space ore renderer that did not exist — **ADDED 2026-08-12, NOT PART OF THE ORIGINAL 61. FIXED**

This is the only entry in this document that was not found in the 2026-08-05 pass, and it is
recorded here because by every measure §1 offers it is the **largest single instance** of the bug
class: nine claims, five files, three of them flatly false, load-bearing on a player-visible feature,
and the whole thing invisible to `tsc` and to `npm test` for the reason §1 names — *a module that was
never written generates no failing test*.

**Claim.** Ore was described, in the present tense, as having a world-space renderer. `OreField`
published a complete render API — `densityAt` (*"for the crystal renderer"*), `densityAtWorld`,
`drainDirty` (*"the crystal instancer calls this once per frame"*), `pendingDirty` (*"so a renderer
can size its drain buffer"*), `getOreField()` (*"for the render-side crystal instancer"*).
`Economy.ts`'s header argued the design around it. `economy.system.ts` listed it as a wired
consumer. `config.ts` carried three authored constants for it — `ORE_CRYSTAL_COLOR`
(*"Referenced by both terrain and HUD"*), `SURFACES.oreCrystal` (*"Emissive scales with remaining
ore amount"*), `ORE_DENSITY_STEPS` (*"few enough that the crystal instancer can keep one batch per
step"*) — plus the `'oreCrystal'` SurfaceArchetype. `Showcases.ts` posed a fixture *"so the crystal
shader is in frame"*.

**Reality.** There was no renderer, no shader, no instancer and no batch. Every one of those symbols
had zero production callers. Confirmed case 4 (`deploysInto`) and case 5 (the eleven primitives) are
the same shape at a fraction of the size.

**Consequence — the one that reached a player.** Reported as *"We have ore scattered around the map,
but i cant see it, how do i know where to place my harvesters?"*. Ore had three tells, none of which
finds it: the minimap bake, a sparkle emitted at a harvester **already** mining, and the cursor
changing over an ore cell — a probe that confirms a guess and cannot direct one. Worse, the ground
cue pointed backwards: `scatter.system.ts` clears an exclusion disc around every field so harvesters
have a clear run, so with nothing drawn back into it an ore patch read as **emptier** than ordinary
ground.

**Fixed.** `apps/game/src/world/ore.system.ts` — one `InstancedMesh`, one instance per seeded cell, scale
quantised into `ORE_DENSITY_STEPS`, updates driven off `drainDirty`, shroud-tinted so it is not a map
hack. The nine prose sites were rewritten against the module that now exists; several were still
wrong in a *new* way at that point (wrong consumer named, wrong mechanism, a guard justified by a
sampling strategy the real renderer does not use), which is worth noting on its own — **writing the
code does not repair the claims, and the second-pass errors were as confident as the first**.

**The residue, and it is real.** `densityAtWorld` still has zero callers. And the fixture claim was
false for a *second* reason nobody had noticed: `addOre` only appends to `ScenarioSpec.ore`, the
cells are laid in by `seedFromScenario` which runs from `simTick`, and `?shot=` boots paused — so a
plan with `settleTicks: 0` never seeds ore at all. Nine of the thirteen capture fixtures are in that
state and five of those nine call `addOre`. **`06-economy` is the only frame in the whole capture set
in which a crystal can appear**, so `docs/RA3_LOOK_BIBLE.md` cannot presently grade this renderer on
anything else. That is an open item, not a fixed one.

**Check.** `grep -rn "crystal instancer\|crystal shader\|crystal renderer" apps/game/src/` → prose only, and
every hit should now name `apps/game/src/world/ore.system.ts`.
`grep -rn "densityAtWorld" apps/game/src/` → one declaration, no callers.
`grep -n "settleTicks" apps/game/src/game/Scenarios.ts` against the `b.addOre` sites in
`apps/game/src/game/scenarios/Showcases.ts` and `apps/game/src/game/Scenarios.ts`.

---

## 4. Tier 2 — real contradictions, narrower or dormant

### 18. The sun is world-fixed; the bible mandates it follow camera yaw, and yaw is free — **LIVE**
`RA3_LOOK_BIBLE.md:155-158`: *"**Because yaw is free, the key must rotate with the camera** … bind the
key's azimuth to `cameraYaw + 118°`."* §15:993-995 encodes `azimuthFollowsCamera: true`. Reality:
`config.ts:317 azimuthDeg: 312`, a fixed bearing; `scene.ts:449,581` call
`sunDirection(cfgSun.azimuth, …)` with no camera term; `grep -rn "azimuth" src` shows no yaw
reference anywhere. Yaw is unclamped (`camera.ts:610`; `input.system.ts:421-422` at 80°/s on Q/E).
Scorecard #17 (w2) requires a screen-space shadow vector of `(−0.95±0.12, +0.25±0.20)` — true at
exactly one yaw and rotating a full 360° with the camera, so both the look and its measurement are
yaw-dependent. **Check:** hold `E` for two seconds and watch the shadows sweep.

### 19. `transport` — the order path lies to the cursor, on three counts — **LIVE**
`Defs.ts:689` blurb *"Carries a squad across water."*, but the def authors **no `cargoMax`**
(defaults 0 at `:523`). `Commands.ts:148` matches `TRANSPORT_KEYS` as lower-cased **substrings**,
handing `seats = 5` to `transport` *and* `ifv` regardless of data, so `Commands.ts:497-503` resolves
right-clicking infantry onto your own IFV or Transport to `OrderKind.Enter` + `CursorKind.Enter` +
`valid = true`. The only consumer, `apps/game/src/sim/Garrison.ts:248`, is
`if (t < 0 || st.kind[t] !== EntityKind.Building) { this.clearOrder(i); continue; }` — **the order is
silently discarded.** Separately `AI.ts:602` justifies its MCV heuristic with *"a transport has a
non-zero `cargoMax`"*; it has zero, so `isUndeployedMcv` counts a Hover Transport as an undeployed
base in every unbound-catalog (headless) path.

### 20. `startLoadout` / `defaultBuildOrder` / `conYardKey` / `produces` — authored with design essays, read by nothing, contradicted by the live tables — **LATENT**
`grep -rn "startLoadout\|defaultBuildOrder\|conYardKey" src | grep -v Defs.ts` returns the three
`types.ts` declarations and `Shell.ts:551`, which reads only `.length` for a fallback blurb.
`.produces` / `.producesTab` outside `Defs.ts` → the `types.ts:686` declaration only. The real owners
disagree: Reclaim `startLoadout: ['rclPicker','rclPicker','rclPicker','rclGrinder']` (with a comment
explaining *"Three pickers, not two"*) vs `START_FORCE[Faction.Reclaim] = { infantry: 5, vehicles: 1 }`
(`Scenarios.ts:345`); Meridian 2+1 authored, 4+2 spawned. `defaultBuildOrder` (8 steps, ends
`rclHeap, rclCrucible`) vs `OPENING_RECLAIM` (`AIStrategy.ts:811-819`, 7 steps, ends `rclSorter,
rclSpotter`) — both carry justifying comments. `conYardKey` duplicates `UnitDef.deploysInto`, which
`Deploy.ts:156` actually uses. `Defs.ts:1707` **validates** `startLoadout` keys, which reinforces the
illusion that something consumes them.

### 21. Two `DecalKind` enums with divergent numbering, one of which types the `IVfx` port — **LATENT, and it detonates the moment finding 5 is fixed**
`types.ts:431` is `Scorch=0, Crater=1, TreadMark=2, FootPrint=3, Squish=4, OreStain=5, Rubble=6`.
`world/Decals.ts:69` is `Tread=0, Tyre=1, Scorch=2, Crater=3, Oil=4, Dust=5, Manhole=6, …`, and its
comment makes the numbering load-bearing: *"The value IS the atlas tile index."* Both are `const
enum` ⇒ bare integers at the boundary with no nominal typing. Nothing breaks today **only because of
finding 5**. Bind `world.vfx` to a real `DecalField` — the obvious fix — and `Scorch`(0) becomes
Tread, `Crater`(1) becomes Tyre, `Rubble`(6) becomes Manhole, with no type error anywhere.

### 22. `QUALITY_PRESETS`: 15 of 16 fields dead, and one dead field already disagrees with the live table — **PARTIALLY FIXED 2026-08-17**
**`shadowCascades`, `shadowResolution` and `lodBias` are DELETED** — declaration and all four preset
values — along with the sibling dead knobs found in the same sweep: `lodDistances` (`types.ts` +
`UnitFactory.ts`, the only construction site repo-wide), `cascadeNear`/`nearExtent`, `shadowColor`
(read by nobody; the blue shadow lift is `post.ts`'s `uShadowTint`), `bloom.mips` and `lensDirt`
(#53). The `shadowResolution` 2048-vs-4096 drift recorded below is therefore gone with the field.

**Still LATENT**, and the reason this is not marked FIXED outright: only `preset.textureSize` is read
(`buildings/units/faction3/faction4.system.ts`). `ssao`, `godRays`, `heatHaze`, `waterReflections`,
`maxDynamicLights`, `maxParticles`, `maxDecals`, `anisotropy`, `resolutionScale`, `bloom`,
`antialias` — **still zero reads.** `resolutionScale` low/medium still drifts **0.72/0.85 vs
0.75/0.90** against `RENDER_QUALITY_PRESETS`.

Note for whoever finishes this: deleting `lodDistances` was the honest move rather than wiring it,
because **there is no LOD system at all** — `THREE.LOD`, `LevelOfDetail` and `SimplifyModifier` all
return nothing repo-wide. A half-resolution terrain index buffer is the real opportunity there
(`terrain-gen.ts` emits a full 64×64 grid for all 64 chunks regardless of relief, and already
computes `cliffTris` per chunk), and it is unbuilt.
`renderer.ts:63-68` warns explicitly that the two tables *"used to share a bare name and be one
import away from silently swapping"*. Also `waterReflections: true` at High/Ultra, which the bible
bans outright — harmless while dead. `config.ts:5650` cites `QUALITY_PRESETS[t].maxDynamicLights` as
authoritative.

### 23. Camera: two edge-pan integrators, and `keyAccelRate` is dead in-match — **LATENT (masked by a zero)**
`input.system.ts:1171` calls `cameraRig.detachInput()`, which defaults to `keepNavigation: true` →
`setInputMode('navigation')` (`camera.ts:1468`). `navigation` only stops the *keyboard* (`onKeyDown`
returns at `:1279` unless mode is `'full'`), so `update()` still runs `this.applyEdgePan(d)`
unconditionally at `camera.ts:788`. Meanwhile `input.system.ts:428-431` re-implements edge pan
itself against `InputManager.edgeDirection` (`Input.ts:329-350`) — **a pure position test with no
motion gate, no idle timer, no proportional falloff and no `document.hasFocus()` guard**, all four of
which exist only in the rig's `applyEdgePan`. With edge scrolling enabled that gives **double speed
while the gate is armed and single ungated speed while the cursor merely rests in the band** —
precisely the laptop failure the feature was redesigned to eliminate, and which
`ActionCatalogue.ts:412-415` promises on the Help screen cannot happen. Masked today because
`CAMERA.edgePanPixels: 0`. Separately `CAMERA_NAV.keyAccelRate = 9.0` (`config.ts:291`, *"a tap
nudges and a hold sprints"*) only affects `camera.ts:978`, whose `this.keys` set is always empty
during a match. *(Related but not a finding: `RENDER_CONFIG.camera.edgePanPixels` defaults to `8`;
the shipping `0` holds only because `pushCamera()` at `Bootstrap.ts:129` — its single caller — runs
before the rig is built.)*

### 24. `config.ts` says `Input.ts#edgeDirection` reads the frozen constant; `Input.ts` says it deliberately does not — **LIVE (doc)**
`config.ts:165-167`: *"`apps/game/src/input/Input.ts#edgeDirection` reads THIS constant (not the live render
config) … so zero here also removes the affordance."* `Input.ts:331-336`: *"RENDER_CONFIG, not
core/config … Reading the frozen one meant a player who turned edge scrolling back on got the
panning but never the eight scroll-arrow cursors"* → `const band = RENDER_CONFIG.camera.edgePanPixels;`.
The config comment is the *rationale* for treating `edgePanPixels: 0` as a single safe kill switch,
so the false half is the half someone would rely on.

### 25. Rebind the pause menu and Escape starts clearing your selection — two docs say it cannot — **LIVE**
`settings-store.ts:258-260`: *"The engine hard-codes it to Escape, and the shell claims Escape … so
the engine never sees that key."* `ActionCatalogue.ts:566-568`, printed on the Help screen: *"Escape
does NOT clear the selection during a match."* But `Shell.ts:1339` matches the **stored `sys.menu`
chord**, not the literal Escape, and `sys.menu` is `binding: 'rebindable'` with a live rebind button.
`input.system.ts:872-875` still has an unconditional `case 'Escape': … else selection.clear();`.
**Check:** rebind Pause Menu to `KeyP`, select units, press Escape.

### 26. `settings-store.ts` describes the *fixed* `sel.allArmy` bug as the current design — **LATENT (a trap)**
`settings-store.ts:264-265`: *"`sel.allArmy` IS reachable, but it is **resolved ahead of the binding
table** in `input.system.ts` because Ctrl+A shares its code with Attack Move."*
`input.system.ts:815-820` says the opposite, in detail: *"…so it needs **no special case** … **It used
to be resolved ahead of the table, which quietly made the Select All Army row on the options screen
do nothing.**"* — and the handler is a plain `case` inside `switch (actionFor(k))`. The stale comment
invites a reader to "restore" the special case and silently re-break the rebind. That regression is
confirmed case 9.

### 27. Loading-screen tips hard-code rebindable keys — the exact failure `ActionCatalogue` exists to end — **FIXED 2026-08-19**
`ActionCatalogue.ts:9-13`: *"the moment a player moves Attack Move off `A`, any hand-written list of
controls somewhere else in the product becomes a lie."* `Shell.ts:583-592` is a hand-written list
rendered on every load: *"**Q and E** rotate the camera…"*, *"Attack-move (**A**) makes a column
engage…"*. `cam.rotateLeft` / `rotateRight` (:320-336) and `ord.attackMove` (:628-637) are all
`binding: 'rebindable'`. The Ctrl+digit row is genuinely `fixed` and fine.
`apps/game/tests/action-catalogue.spec.ts` knows nothing about `TIPS`.

**FIXED.** No tip spells a key any more. A tip's prose carries `{action.id}` placeholders and
`Shell.resolveTip` resolves each one through `actionKeyRow` — the tutorial's helper, reading the
LIVE settings store, exactly as `Help.ts` does — when the loading screen is drawn. The Ctrl+digit
row was routed too, despite this entry correctly calling it `fixed` and fine: a lint that carves out
"the fixed ones" is a lint whose next reader has to re-derive which ones those are.

The last clause is closed by a NEW file rather than by the one it names.
`apps/game/tests/action-catalogue.spec.ts` still knows nothing about `TIPS`; `apps/game/tests/loading-tips.spec.ts`
does, and it also carries the digit ban `apps/game/tests/build-descriptions.spec.ts` §4 applies to the other
class of in-game player copy. Its lint was written against the four key mentions in the pre-fix
table as its own falsifier, and that mattered: the tutorial's existing `IMPERATIVE_THEN_KEY` /
`NAMED_KEY_NOUN` regexes are GREEN on all three offending strings — they anchor on an imperative
(*"press A"*) and these tips are declarative (*"Q and E rotate the camera"*) — so porting them
verbatim would have shipped a passing test over the defect it was cited to close. That pin is §3 of
the new file.

### 28. `PIXELS_PER_METRE_1440` is the *bible's* camera scale, not this game's — off by ~36% — **LATENT**
`config.ts:4580-4581`: `export const PIXELS_PER_METRE_1440 = 207 / 7;` (= 29.57), sourced from *"207
px per 7 m, bible §15 camera targets"*. The bible's 207 px comes from **its** camera (fov 34, pitch
39, height 50 → slant 79.5). This game is `CAMERA.pitchDeg 52, fovDeg 36, defaultDistance 55`
(`config.ts:140-151`), and `camera.ts:925` makes `distance` the slant offset, so
`1440 / (2·tan18°·55) = **40.3 px/m**`. The constant itself is unreferenced, but the figure is
asserted as measured in eight places and derived numbers depend on it: `Shapes.ts:475,494`,
`MassList.ts:1489`, `PropLibrary.ts:820` (*"2-4 px of bevel; at 29.6 px/m that is 0.068-0.135 m"* —
should be 0.05–0.10), `WaterMaterial.ts:1244`, `config.ts:1838`, `:4516` (*"the measured 0.036 m/px"*
— actually 0.0248), `:4853` (picks a 2.0 m shoreline *"because 2.0 m is 59 px"* — it is 81 px,
outside §13 #27's 40–80 band).

### 29. Tread marks are 4–5× the bible's width, and the comment's own conversion is wrong — **LIVE**
`RA3_LOOK_BIBLE.md:721`: *"two 6–8 px strips at track gauge"*. `config.ts:5140-5141`:
`/** Half-width of one tread strip. Bible: 6-8 px at 1440p ~= 0.35 m. */ export const TREAD_HALF_WIDTH = 0.42;`
— 6–8 px at the quoted 29.6 px/m is **0.20–0.27 m of total width**, i.e. 0.10–0.135 m half-width. The
comment converts a full width into a half-width, and the value then sits 20% above even that.
`Decals.ts:689` passes it as the quad **half-extent**, so each strip is 0.84 m ≈ 25 px (34 px at the
real scale from finding 28). With `TREAD_GAUGE_FRACTION = 1.15` (≈1.96 m on a heavy tank), two 0.84 m
bands leave a 1.12 m gap — one broad smear, not two thin scars.

### 30. The VFX light budget is still calibrated to a tonemap that was replaced, contrary to its own written instruction — **LIVE**
`config.ts:3890-3895`: *"The response is this non-linear because **AgX at exposure 1.05** compresses
the highlights hard … **Fix the grade to ACES @ 0.92 and re-derive this** against the SAME two
measurements rather than by eye — the light will do more work on a darker frame, so **this number
should come down, not up**."* The grade *was* moved: `config.ts:485 mode: 'aces'`, `:492
exposure: 0.90`. `VFX_LIGHT_INTENSITY_SCALE` is still **5.0** (`:3901`), and the two values raised
for the same AgX-knee reason are untouched: `teslaArc.peak: 26` and `prism.peak: 22`, both justified
at `:3935-3937` by *"everything below ~500 effective candela sits under the **AgX** knee"*.
`renderer.ts:16` still documents *"AgX happens inside post.ts → GradePass"*. Same block, `:3897-3899`:
*"their RATIOS are the art direction (an explosion is **2.3x** a muzzle flash)"* — `explosion.peak: 20`
vs `muzzle.peak: 12` is **1.67×**. The invariant is stale inside the paragraph declaring it
inviolate.

### 31. `ArtDirection` is 6/13 dead data, and `ArtAware` has zero implementers — **LATENT**
`config.ts:1049-1051`: *"`DEFAULT_ART` is the single instance **every material, pass and generator**
reads … every ArtAware listener re-applies its uniforms."* `ArtBridge.artPatch` (`:150`) destructures
exactly five: `{ sun, atmosphere, tone, bloom, ao }`. Direct readers elsewhere cover two more
(`.factions`, `.shroud`). That leaves **`surfaces`, `vfx`, `terrain`, `water`, `hud`, `outline` with
no consumer** — 171 authored numbers in `SURFACES` alone, headed *"falsifiable PBR ranges … 'reads as
a plastic toy' is almost always a missing bevel plus missing edge wear, and both are tuned right
here"* (`config.ts:842-847`). All 22 `VfxLook` fields, 17 of 18 `HudLook` fields and all six
`OutlineLook` fields occur exactly once each — in their own constructor. And
`grep -rn "ArtAware\|applyArt\|artDeps\|art:changed" src` returns only the declaration and two
comments: nothing implements the interface, nothing calls `applyArt`, `'art:changed'` is never
emitted or subscribed. The live VFX module reads its own separate `VFX_SMOKE` / `X` /
`SUPERWEAPON_FX` blocks — two knobs per quantity in two files, the shape of confirmed cases 2 and 7.

### 32. "FOUR, TWO PER ARMY" — with four armies, half the roster has none — **LIVE**
`Superweapons.ts:11`. All four entries are `Faction.Soviets` or `Faction.Allies` (`:102,112,122,132`),
and the availability scan rejects anything else (`:514`). **A Meridian or Reclamation player can
never charge or fire any superweapon.** `docs/MISSIONS_DESIGN.md:19,108` promises superweapon unlocks
as earned content for all four factions. *(The `battleLab` fallback chain in the same file is
documented and deliberate — see §6 K1.)*

### 33. The determinism gate greps a directory, not `simTick`, and cannot detect its own vacuity — **LATENT**
`CLAUDE.md:42-43`: *"Inside `simTick`, `Math.random()`, `Date.now()` and `performance.now()` are
banned — there is a test asserting this."* `apps/game/tests/foundation.spec.ts:204-212` walks `apps/game/src/sim` only.
**Eighteen files outside `apps/game/src/sim` define a `simTick`** (`art/Wrecks.ts`, `input/input.system.ts`,
`progression/*`, `ui/Hud.ts`, `ui/hud.system.ts`, `ui/objectives.system.ts`, `vfx/vfx.system.ts`,
`world/{Water,Scatter,roads.system,water.system,scatter-clear.system}.ts`, plus core/game plumbing).
I read all eighteen: **no live violation** — every wall-clock read sits in an `init()` body or is
explicitly exempted (`MissionTracker.ts:20-21`). So the claim is currently true by luck, not by the
gate. Second half: `walkTs` returns `out` unchanged when `readdirSync` throws (`:188-191`) and the
test never asserts `files.length > 0` — this gate is on record as having been vacuous once for
exactly that reason.

### 34. `playtest.mjs determinism` prints "identical world" after comparing a census — **LATENT**
`tools/playtest.mjs:392` prints `DETERMINISTIC (identical world at t+300s)`. `norm` (`:389`)
serialises only what `PROBE` (`:66-103`) collects: per-player **rounded** credits, a power string,
counts of units and buildings by def key, and deploy counters. No positions, no HP, no orders, no
event ticks. Two runs that fought completely different battles report DETERMINISTIC if the census
matches. This is the only whole-match determinism instrument in the repo — `DebugHooks.stateHash`
(`debug.ts:79-80`, *"Return a deterministic hash of sim state (determinism soak)"*) has **exactly one
occurrence in the entire tree: that declaration.**

### 35. Two files cite a soak test that does not exist; `MISSIONS_DESIGN.md` says a shipped subsystem is unbuilt — **LIVE (doc)**
`docs/MISSIONS_DESIGN.md:54` and `apps/game/src/progression/MissionTracker.ts:14-15`: *"there is a soak test
asserting an AI-vs-AI match replays identically."* Running `npm run soak` (`vitest run -t
determinism`) gives 15 tests in 22 s — headless stream equality, an AI *command log*, byte-identical
health, identical pathing positions, deploy tick/place, relocate, scatter-clear. **None boots an
AI-vs-AI match and none replays one.** That claim is the stated justification for a "non-negotiable"
determinism boundary in `MissionTracker`. Separately `docs/MISSIONS_DESIGN.md:3` reads
`**Status:** agreed scope, not yet built.` while every file its own Architecture block proposes
exists and is wired (`apps/game/src/progression/{profile-store,MissionTracker,UnlockGate,progression.system,types}.ts`,
`apps/game/src/data/Missions.ts`, `apps/game/src/ui/Objectives.ts`, `apps/game/src/shell/Missions.ts`, four spec files, imported
for real by `Production.ts:74` and `Scenarios.ts:80`).

### 36. Scorecard check #20 does not test monotonicity and never tests the top band — **LATENT**
`RA3_LOOK_BIBLE.md:829`: *"Monotonically decreasing, **top band ≤0.10** (ACES shoulder present)"*, w2.
`metrics.mjs:152-154`:
```js
const populated = curve.filter((v) => v !== null);
const monotonic = populated.length < 3 ? 1 : (populated[populated.length-1] < populated[0] ? 1 : 0);
```
First versus last bucket only; the top-band half is never computed; fewer than three populated
buckets **auto-passes** (a near-black frame, a blown one, a boot-curtain screenshot — cf. confirmed
case 10). All 12 shots score exactly 1.0000. §4.2 makes this *the* acceptance test proving ACES rather
than Reinhard is in the chain; a regression to a global `saturate()` would re-saturate the highlights
and still return 1.

### 37. `shoot.mjs`'s `advance` advances nothing — it destroys the effect it claims to catch — **LIVE**
`?shot=` boots the sim **paused** (`Bootstrap.ts:290-292`, *"A shot must be reproducible: no wall
clock"*). `shoot.mjs:297-299` implements `advance` as
`page.evaluate(s => new Promise(r => setTimeout(r, s*1000)))` — a wall-clock sleep. Zero sim ticks.
The only thing four seconds buys is presentation particles decaying away. Real motion comes from the
fixture's `settleTicks` (`Scenarios.ts:2157` = 120 for `battle`), which `scenarios.system.ts:24-29`
already documents as the mechanism *because* "with the loop paused that advances nothing". The
`MEASURED` note at `shoot.mjs:79-85` therefore reaches the inverted conclusion: 2.5 s did not fail
because of the plume, it had **more** live fire than 4 s. `06-economy` (`advance: 6.0`, captioned "in
motion") and `08-naval-water` (`advance: 3.0`, "wakes") are still frames.

### 38. "Unlocks the top of every tab" is true for two tabs of four — **LIVE**
`Defs.ts:1223` (`battleLab`) and `:1358` (`mrdReliquary`), both rendered in the sidebar tooltip
(`Chrome.ts:494`). In `Production.CONTENT`, `battleLab` gates `prismTank`, `apocalypse`, `mcv`,
`destroyer`, `dreadnought` (all `tab: V`) and `prismTower` (`tab: D`) — **never Infantry, never
Structures.** Same for `mrdReliquary` (`mrdZenith`, `mrdCarryall`, `mrdMonitor`, `mrdHelios`); the
Pact's tier-2 infantry `mrdLancer` gates on `mrdOculus` instead. This is a 2000-credit, 24-second
purchase decision made on a false description. By contrast `rclCrucible`'s blurb (*"Opens the siege
hull, the Yardcrawler and the Hulk."*) is exactly correct, which is what makes the other two drift
rather than house style.

### 39. `PlayerState.defeated` never written; `MatchPhase` 5/6 dead; `setMatchPhase` has zero callers — **LATENT**
`types.ts:1026-1027` *"True once Victory has eliminated them."* — initialised `false` at
`world.ts:967`, **assigned nowhere**, read once at `AI.ts:459` to skip a brain tick.
`MatchPhase.Menu/Loading/Paused/Victory/Defeat` have **zero references**; the only two uses are
hard-coded initialisers to `Playing` (`Production.ts:1061`, `Hud.ts:504`).
`ProductionService.setMatchPhase` (`Production.ts:1225`) has **no callers**. `HudSnapshot.matchPhase`
is written twice and read never. So the AI runs a full brain tick for an eliminated player, and any
future "grey out the HUD on defeat" written against these enums will silently never fire.

### 40. `dockOffsetX/Z` computed for every building, read by nothing — and the config comment describes a branch that does not exist — **LATENT**
`types.ts:690-692` declares them; `Defs.ts:1128-1129` fills them for every building
(`dockOffsetZ: s.dockOffsetZ ?? halfDepth + 4`). `config.ts:2367-2371`: *"Metres the dock point sits
in FRONT of a refinery's footprint edge **when the def table carries no explicit dockOffset**."*
`Harvesting.ts:491` computes it unconditionally from the footprint —
`const reach = Math.max(1, store.footprintH[ri]) * CELL * 0.5 + HARVESTER_DOCK_STANDOFF;` — there is
no such branch, and `Defs.ts:1129` guarantees the field is never absent anyway. Repositioning one
refinery's apron currently requires a global constant that moves all four factions.

### 41. Duplicate and dead constants whose comments state shipping behaviour — **LATENT**
All verified at **exactly one reference — the declaration**:

| Constant | Comment claims | Live reality |
|---|---|---|
| `config.ts:1343 WRECK_LIFETIME = 22` | *"Seconds a wreck burns before it is removed."* | `COMBAT_DAMAGE.wreckSeconds = 26` (`:2221`), read at `Damage.ts:711,721`. **Different numbers.** |
| `config.ts:1355 GUARD_LEASH = 18` | *"Metres a Guard-stance unit will chase."* | `COMBAT_TARGETING.leashRangeMul = 1.28` (`:2111`) — a *multiplier on weapon range*, `Targeting.ts:129`. Different unit, different semantics; no metre leash exists. |
| `config.ts:1404-1406 SHOT_WIDTH/HEIGHT = 1920×1080` | *"Fixed render size for ?shot= screenshots, so they are diffable run to run."* | `shoot.mjs:36` uses 2560×1440 and says any other size invalidates §13. Two canonical numbers, neither enforced (see finding 14). |
| `config.ts:1410 SOAK_MINUTES = 20` | *"**Seconds** the determinism soak simulates."* | Name says minutes, comment says seconds, `npm run soak` reads neither. |
| `types.ts:250,272 ARMOR_CLASS_COUNT / WARHEAD_CLASS_COUNT` | *"the matrix is 7 warheads x 6 armors"* | Zero importers. All three enforcement sites hard-code literals (`Defs.ts:1650`, `Damage.ts:76-77`, `combat.system.ts:188`). **Add an 8th `WarheadClass`** and a correct 8×6 matrix is rejected, `setArmorMatrix` returns false, the stale table stays, and every shot from the new warhead falls through `armorMultiplier`'s `row === undefined → return 1` and **ignores armour entirely.** |
| `ORDER_PULSE_SECONDS`, `FOG_SPAWN_REVEAL_RADIUS`, `HARVESTER_TARGET_ROUNDTRIP` (*"used to sanity-check ore field placement"* — no such check), `SIDEBAR_WIDTH_PX`, `MINIMAP_SIZE_PX`, `CAMEO_SIZE_PX`, `HUD_DESIGN_HEIGHT`, `PANEL_GAP` | a HUD layout contract | Zero importers; `hud.css` hard-codes the pixels. **Editing config cannot move the HUD.** |

### 42. `__VM.stats()` reports `textureMB`, `heapMB` and `heapGrowthMB` as 0 unless someone opened F3 — **LATENT**
All three are computed only inside `updateOverlay()`, which `endFrame()` skips:
`debug.ts:698-700` `function endFrame(): void { cpuMs = …; if (!visible) return; … }`. `cachedTexMB`
is initialised 0 at `:383` and written only at `:396`; `heapMB` / `heapBase` only at `:390-391`.
`stats()` (`:519-521`) returns them verbatim. It is a *plausible* zero — `textures: 64` sits right
beside it, and `heapGrowthMB: 0` reads as "the zero-allocation canary is green". Any headless
profiling script gets three zeros with no warning.

### 43. `DebugCounters.batches` is displayed and never written — **LIVE**
`debug.ts:53` declares it, `:298` initialises 0, `:409` renders
`${counters.particles} / ${counters.batches} batches`. **No writer anywhere** —
`InstanceBatcher.ts:575` exposes `get batchCount()` and nothing wires it. `particles`, `entities`,
`units`, `buildings`, `projectiles`, `simMs` and `substeps` are all genuinely written; `batches` is
the only dead one, and it is the row that would show whether CLAUDE.md's "InstancedMesh for anything
repeated / under 130 draw calls" law is being met.

### 44. `INCOME_SMOOTHING` is declared twice, and the config comment claims a settle time it does not own — **LATENT**
`config.ts:2446-2451`: *"EMA weight applied to each new income sample. 0.35 settles in about three
seconds — fast enough that killing a harvester shows on the HUD."* `apps/game/src/ui/Hud.ts:209` declares a
**second, unimported** `const INCOME_SMOOTHING = 0.35;` (Hud imports only `MAX_SELECTION` from
config). The config constant governs `Economy.incomeRateArr` (`:976`), whose only consumer is a debug
counter (`economy.system.ts:253`); the number the player actually sees comes from `Hud.ts:932`'s
private copy over its own `credits:changed` bucket. `economy.system.ts:16` compounds it by claiming
the sim's `incomeRate` feeds *"the HUD"*. Retuning the documented constant moves nothing on screen.

### 45. `CLAUDE.md` and `README.md` still say three factions; the test count is off by ~90% — **LIVE (doc)**
`CLAUDE.md:7` *"**Three factions**, ore economy…"*; `README.md:7` and `:30` the same. There are
**four playable** (`Defs.ts:1534-1585`, `Production.PLAYABLE_FACTIONS`, `FACTION_COUNT = 5`).
`CLAUDE.md:16` says `npm test # vitest, currently 617 passing` — measured **1165** at audit time.
`README.md:100-111` lists 12 `apps/game/src/` directories and omits `apps/game/src/input/` and `apps/game/src/progression/`.
Confirmed case 6 was *exactly* a 3-versus-4 faction count producing a black frame, and findings 3, 4,
32 and 51 below are the same miscount recurring — while `CLAUDE.md` is the first file every agent
reads.

### 46. `Defs.ts` §6 is a five-item to-do list where all five are done, pointing at a §7 that does not exist — **LATENT**
`Defs.ts:1793-1832` instructs the reader to add `Faction.Meridian = 3` / `FACTION_COUNT = 4` to
`types.ts` (both exist; `FACTION_COUNT` is 5 and `Reclaim = 4` is never mentioned), transcribe
Meridian fallback rows (`Scenarios.ts:561+` has them), widen `Production.CONTENT` (`:698-700` covers
all four), move `FACTION_PALETTE.meridian` (`Defs.ts:1529` already reads it *from* config), and
de-binarise `Chrome.factionKey` (`paletteKeyFor` at `:128` is n-way). The header at `:55-57` says the
outstanding items *"are listed in §7"* — the block is §6 and there is no §7.

### 47. The Reclamation armoury header miscounts its own table three ways — **LIVE (doc)**
`Defs.ts:212-213` *"**ONE IDEA, EIGHT ROWS**: every gun the Reclamation fields is an arc, and every
arc CHAINS"*; `:227` *"**Every arc row is 14-20 m**"*; `:912-913` *"**Seven of the ten** guns are
`WarheadClass.Tesla` … at 14-20 m."* Counted from `RECLAIM_WEAPONS` (`Defs.ts:239-291`): **ten rows**;
**six** Tesla, not seven and not ten (`slagCharge` 12 m, `slagMortar` 42 m, `scowGun` 32 m,
`hulkBattery` 38 m are HighExplosive and chain nothing); and `pylonArc` is a **28 m** arc, 8 m outside
the band the header presents as the price of having no turret. Everything else in the block checks
out exactly (the Tesla armour row, the Grinder/Warden/Anvil comparison, `RCL_TURN`'s worked
example) — this is drift in one block, not a sloppy file.

---

## 5. Tier 3 — verified, low blast radius

| # | Finding | State | Evidence |
|---|---|---|---|
| 48 | `RenderBridge.packKey` multiplies by literal `8` for the kind dimension one line after a comment explaining why the *faction* dimension was derived from `FACTION_COUNT` — and `ENTITY_KIND_COUNT` (7) is imported into the same file and used at `:189` and `:392`. At 9 kinds it aliases silently, reproducing the "first registrant wins" symptom the comment describes. | LATENT | `RenderBridge.ts:194-211` |
| 49 | `EntityStore.alloc` validates `kind` with a named error and an explicit rationale (`world.ts:292-300`) and writes `this.faction[i] = faction` at `:312` with no check; `RenderBridge.ts:711-712` reads `TEAM_RGB[s.faction[i]*3]` unguarded, three lines from an existing `factionSlot()` clamp. Faction is the one identity column whose out-of-range value has already blanked a whole frame. | LATENT | both files |
| 50 | `TeslaBolt.trunk = new Float32Array(32 * 3)` with no clamp of `n = segs+1` against it — safe only because `VFX_TESLA.segMax = 14`. The sibling buffers two loops below *are* guarded. Raise `segMax` past 31 → writes past the end → `undefined` → **NaN into a position attribute** (confirmed case 6's failure mode). `VFX_TESLA` carries no comment tying `segMax` to this buffer. | LATENT | `Beams.ts:440,460-471`; `config.ts:4351` |
| 51 | `INFANTRY_CONTENT` (`art/units.system.ts:82`) names `'mrdSunlancer'`; the def key is `'mrdLancer'` (`Defs.ts:771` — `Sunlancer` is the display *name*). Inert today only because the `bind` loop iterates `CONTENT_TO_MODEL` / `SHARED_CONTENT_TO_MODEL`, neither of which holds any `mrd*` key — so all three Meridian entries are unreachable and there are no Reclamation entries at all. | LATENT | grep: one hit |
| 52 | `setMoveClass` (`Movement.ts:108`) is documented as *"whoever owns unit data calls `setMoveClass` at spawn … THIS is how an aircraft or a ship becomes one — nothing else can tell them apart from a hovercraft."* **Zero production callers** (tests only). `MoveClass.Air` has a full branch set in `Flowfield.ts` and at `Movement.ts:287` and is unreachable. *(Meridian doctrine at `Defs.ts:743-748` deliberately makes its flyers `Locomotor.Hover`, so this is a dead mechanism rather than a wrong result.)* | LATENT | `grep -rn setMoveClass src` |
| 53 | `lensDirt: 0.12` authored in **two** config tables (`config.ts:601`, `renderer.ts:375`), copied through `ArtBridge.ts:207`, and read only by `post.ts:728-732` to decide whether to log *"lens dirt not supported by this UnrealBloomPass build — ignored"*. `RA3_LOOK_BIBLE.md:787` bans lens dirt outright. | **FIXED 2026-08-17** — field deleted from `types.ts`, both config tables, `ArtBridge.ts` and the `post.ts` log block. `apps/game/tests/banned-effects.spec.ts` now scans for it, so it cannot return as a configured no-op. | grep: 0 hits |
| 54 | `index.html:33-37` — *"No CDN, no webfont - these are the narrow faces that **ship with Windows/macOS/Linux**"* over `font-family: 'Rajdhani', 'Oswald', …`. Both are Google Fonts; neither ships anywhere; there is no `@font-face` in the tree. The first resolvable entry is `Arial Narrow`. The "no webfonts" property holds; the sentence does not — so the HUD an author with Rajdhani installed sees is not the HUD any player sees. | LIVE | `grep -rn "@font-face" src index.html` → nothing |
| 55 | Events emitted with no subscriber: `'production:progress'` (`Production.ts:2192,2197`, every queue tick — the HUD reads progress off `HudSnapshot`) and `'vision:changed'` (`vision.system.ts:209-214`). Dead enums: `OrderKind.Patrol = 13` (*"Cycle waypoints forever"*, zero refs — the last dead `OrderKind`) and the whole `Relation` enum (`types.ts:162-170`, *"Computed from PlayerState.allyMask"* — **zero references repo-wide**, while every ally/enemy decision is an ad-hoc `areAllied()` at each site). Also written-never-read: `SelectionState.homogeneousDef` (two writers, `Selection.ts:654` and `Scenarios.ts:1927`). | LATENT | greps above |
| 56 | `shell.css:76-77` — *"the shell fades between them by toggling `is-out`"* + a 180 ms transition + `.vm-screen.is-out { opacity: 0 }`. `is-out` is **never added or removed** (no literal anywhere; the four `is-${…}` construction sites are all mission/sidebar states). `.vm-panel.is-flat` likewise. | LIVE | `grep -rn "is-out" src` |
| 57 | `__VM.stats().post` returns mangled identifiers in every built bundle. `debug.ts:525-529` maps `p.constructor.name`; `vite build` minifies class names — confirmed in `dist/assets/index-*.js`: `class Pi extends tl{`, `class zi extends zT{`. The `^_` already in that regex shows someone noticed the symptom and stripped a symbol rather than the cause. "Is SMAA on in this capture?" is unanswerable in the build that produces the artefacts. | LIVE | dist inspection |
| 58 | `shoot.mjs:324-330` claims *"A reader sees the previous complete set until this point, then the new complete set — never a partially-captured directory"* over `for (…of readdirSync(OUT)) rmSync(…)` **then** `for (…of readdirSync(STAGE)) renameSync(…)`. Delete-all-then-move-one-at-a-time leaves a real window where `shots/*.png` globs to 0–11 files — the exact condition `metrics.mjs:196-201` tells the user to suspect. Also: `shoot.mjs:284-295` asserts loudly on an unknown `__VM` pose method *"rather than a silently mis-framed shot"*, but an unknown `?shot=` is `PLANS[name] ?? PLANS[SCENARIO_DEFAULT]` (`Scenarios.ts:2318`) — a silent fall back to `skirmish`, recorded `ok: true`. All 12 current names resolve. | LATENT | reading both files |
| 59 | `apps/game/tests/_probe.spec.ts` is **tracked** (the other four `_*.spec.ts` are untracked scratch), has **zero `expect(` calls**, routes `m.stats.errors` — the mechanism `MassList` uses to reject a silhouette, i.e. confirmed case 5's failure detector — to `console.log`, and catches throws into `console.log(key + ': THREW ')`. A present, always-green test over the exact subsystem that once shipped eleven primitives as cubes. | **FIXED 2026-08-07** — file deleted. It orphaned nothing: `apps/game/tests/faction4-art.spec.ts` imports and asserts on the same four symbols. | `git log -- apps/game/tests/_probe.spec.ts` |
| 60 | `debug.ts:682` *"Exponential moving average, ~1 s window at 60 fps."* over `frameMsAvg += (dtMs - frameMsAvg) * 0.05` — a 20-frame time constant, ≈0.33 s. `fps` is derived from it, so the displayed fps settles 3× faster than documented (and is 3× twitchier than a reader tuning against it expects). | LIVE | one line |
| 61 | `apps/game/tests/data.spec.ts:160-165` — *"this arm is kept as the escape hatch for **the NEXT faction**, and it is deliberately narrow so a typo'd key cannot use it"* over `expect(def.key.startsWith('mrd')).toBe(true)`. The next faction landed as `rcl*`. Nothing breaks (every `rcl` def happens to carry a fallback row), but the comment and the predicate describe different policies, and faction five gets a confusing `no fallback for <key>` pointing at the wrong file. | LATENT | `sed -n '154,170p' apps/game/tests/data.spec.ts` |

---

## 6. Candidates that were killed

A negative result is worth as much as a positive one. Each of these looked like drift and is not.
Do not re-open them without new evidence.

| # | Killed candidate | Why it dies |
|---|---|---|
| K1 | `SUPERWEAPONS[].structureKeys` names four buildings that do not exist; one Proving Ground unlocks both weapons | **Deliberate and documented.** `apps/game/src/sim/Superweapons.ts:27-33`: *"There are no superweapon structures in the roster yet, so each entry carries a `structureKeys` fallback chain and every one of them ends at `battleLab`. The moment `nuclearSilo` / `ironCurtain` / `chronosphere` / `weatherControl` exist as building defs, they take over with no code change."* That is exactly the observed behaviour. *(The faction-coverage half is a real finding — §4 #32.)* |
| K2 | Income is exponentially smoothed twice in series | **Factually wrong.** `apps/game/src/ui/Hud.ts:696` feeds `incomeBucket` from `credits:changed` deltas directly, not from `Economy.incomeRate`. They are two independent estimators, not a cascade. *(The duplicate-constant half survives with corrected reasoning — §4 #44.)* |
| K3 | `wall` blurb "Stops vehicles. Stops nothing else." | Ambiguous. The reading "it has no gun" is defensible and probably intended. Not a factual contradiction. |
| K4 | `p99Luminance [0.90,1.00]` rewards clipping | `docs/RA3_LOOK_BIBLE.md:815` row 6 literally says `p99 ≥ 0.90`. The probe implements the spec correctly. A critique of the bible, not drift from it. |
| K5 | `unitDeathTL` — "doc says metres, value is TL" | `config.ts:4126` reads *"Fireball diameter in metres per 'size 1.0'. **Unit death is 2.2 TL.**"* The second sentence is correct and the field name says TL. Sloppy, not false. |
| K6 | The cloak subsystem's five stale comments naming `Vision.applyRenderMask` | The method **no longer exists in the working tree** (`git show HEAD:apps/game/src/sim/Vision.ts` has it at :564; the current file does not). `Vision.ts`, `vision.system.ts`, `Selection.ts`, `Overlay.ts` and `RenderBridge.ts` are all being rewritten right now under task #26. Unverifiable against a moving target — **re-audit after #26 lands.** |
| K7 | `RENDER_CONFIG.camera` disagrees with `CAMERA` on four values | Deliberate layering. `apps/game/src/game/ArtBridge.ts:122`: *"Camera constants live in core; the rig reads RENDER_CONFIG.camera."* The `RENDER_CONFIG` values are documented defaults that `pushCamera()` overwrites at `Bootstrap.ts:129`, before the rig is constructed. *(Retained as a note under §4 #23, because the single-caller dependency is fragile even though the values are correct.)* |
| K8 | `SelectionState.homogeneousDef` has two writers | True, but it is inert state with no reader to inherit anything. Style. *(Listed as dead data under §5 #55.)* |
| K9 | `tools/brand.mjs` hard-codes a machine-local Desktop path | A one-shot asset tool. Nothing shipping depends on it. |
| K10–K13 | `Int32Array(16)`, `buildingCount(256)`, `inFlight` literal `4`, "~22 cursors" | All bounds-checked or loop-derived; no failure mode at any plausible growth. Magic numbers, not defects. |
| K14 | `Chrome.factionKey` / `skinFor` are binary | `apps/game/src/ui/Chrome.ts:759` labels it *"Legacy two-way faction key. Prefer `paletteKeyFor`"*, inside an explicitly-dead LEGACY block. |

Two further near-misses, reported only as consequences rather than as findings in their own right:
`TRANSCRIPTION 11` (sharpen inflating scorecard #34) is stated openly in its own config comment, so
only its downstream effect appears, folded into §3 #17; and the audio-measure `crest` row in
`INSTRUMENTS 18` could not be reached and was **not verified** — treat it as unaudited, not clean.

---

## 7. What was checked and found clean

Re-treading these is wasted time unless the underlying code changes.

- **Determinism inside `simTick`, everywhere — not just `apps/game/src/sim`.** All eighteen files outside
  `apps/game/src/sim` that define a `simTick` were read by hand. **No live violation.** Every wall-clock read
  is in an `init()` body or explicitly exempted (`MissionTracker.ts:20-21`). The *gate* is weak
  (§4 #33); the *property* currently holds.
- **`Superweapons.ts`'s `structureKeys` fallback chain** — correct, documented, works as described
  (K1). Only the faction coverage is wrong.
- **Soviet `teslaCoil` and Allied `prismTower` power gating** — both correctly carry the entity flag
  *and* the weapon flag. Meridian's `mrdHelios` likewise. The §3 #2 defect is confined to two
  Meridian entries.
- **`rclCrucible`'s unlock blurb** and the whole Reclamation Tesla-armour / Grinder-versus-Warden
  comparison in `Defs.ts` — verified against the tables, exactly right. §4 #47 is drift in one
  header block, not a sloppy file.
- **`Explosions.ts` scorch path** — `setScorchSink` is genuinely bound (`roads.system.ts:115`) and
  independent of the dead `IVfx` port. Scorches work.
- **`ENTITY_KIND_COUNT` derivation at `RenderBridge.ts:189` and `:392`** — correct. Only the kind
  multiplier at `:211` is a literal (§5 #48).
- **`debug.ts` counters** — `particles`, `entities`, `units`, `buildings`, `projectiles`, `simMs`,
  `substeps` all genuinely written. `batches` is the sole dead one (§4 #43).
- **`p99Luminance` and the bloom `strength` chain in `metrics.mjs`** — implement their spec
  correctly (K4).
- **`Deploy.ts`** — `deploysInto` is now really consumed at `:156`. Confirmed case 4 is genuinely
  fixed; only the duplicate `conYardKey` field is dead (§4 #20).

### Not audited — deliberately

Two agents were editing 27 files during this pass. The following were **excluded and remain
unaudited**; they are the obvious place to start a follow-up once those tasks land:

- `apps/game/src/sim/Vision.ts`, `apps/game/src/sim/vision.system.ts`, and the vision paths in `apps/game/src/input/Selection.ts`,
  `apps/game/src/ui/Overlay.ts`, `apps/game/src/render/RenderBridge.ts` — mid-rewrite under task #26 (see K6).
- `apps/game/src/sim/Relocate.ts` and `apps/game/src/sim/Placement.ts` — new/modified this session.
- The audio-measure `crest` row in the metrics tooling.

---

## 8. How to stop this recurring

The defining fact about all 61 findings — and about #62, added later — is that **none was reachable
by `tsc` or by `npm test`**. So
the question is not "write more tests" — it is "what is the smallest mechanical check that converts
the largest number of these from prose into a failing assertion?"

Sorted by yield per line of work.

### 8.1 One test: dead symbols and dead events — catches ~12 findings

Roughly a fifth of everything above collapses into two mechanical patterns:

- **An exported symbol whose only occurrence in the tree is its own declaration.** Findings 5, 12,
  20, 31, 39, 41, 52, 55 — plus confirmed case 4 (`deploysInto`) and case 5 (the eleven primitives).
- **An event with subscribers and no emitter, or an emitter and no subscriber.** Findings 11, 12, 31,
  55.

Both are greppable in a single spec file:

```ts
// apps/game/tests/no-dead-vocabulary.spec.ts
// 1. For every `export const` in apps/game/src/core/config.ts and every field of the *Look
//    interfaces, assert at least one reference outside the declaring file.
// 2. For every key of `GameEvents`, assert both an `emit('<key>'` and an `on('<key>'`
//    exist somewhere under apps/game/src/.
// Allow an explicit `// DEAD-OK: <reason>` opt-out on the declaration line so the
// deliberate placeholders (Superweapons' structureKeys, K1) stay green.
```

This is the one I would implement. It is perhaps 80 lines, it needs no runtime, and it turns the
single most common failure mode in this repo — *a complete authored vocabulary with no
implementation* — from something only a careful reader finds into a red CI run. Note that it also
retroactively catches confirmed cases 4 and 5, which is the strongest evidence available that the
shape recurs.

### 8.2 Type the per-faction tables — catches 4 findings, includes two live player-visible bugs

Findings 3, 4, 32 and 51, plus confirmed case 6 (the black frame), are all the same defect: a lookup
keyed by faction, typed loosely enough that a missing row compiles.

```ts
const SURVIVOR_KEY: Record<Faction, string> = { … };            // was readonly string[]
const FREE_UNITS: Record<FactionPaletteKey, readonly string[]>   // was Record<string, …>
```

`Record<Faction, T>` is exhaustive: adding faction six then fails to compile at every table that
needs a row, which is exactly the behaviour you want. This is a pure type change with no runtime
cost and it is permanent. Highest severity-per-line of anything in this section. Sweep the repo for
`readonly string[]`, `Record<string,` and bare array literals indexed by `p.faction`.

### 8.3 Make the instruments report their own uncertainty — catches 5 findings

Findings 6, 7, 15, 16 and 17 are all `tools/metrics.mjs` and `docs/grade-baseline.json`, and they
compound: **every visual-critique number produced since the baseline landed is suspect**, and
finding 7 has already leaked into `config.ts`'s shipping `lift` value. Three cheap changes:

1. Print the **enforced** range beside the **spec** range whenever `resolveRange` substitutes one
   (the tool already computes both — it just doesn't say which it used). Kills 6 outright and makes
   7 visible.
2. Write `count`, `expected` and a `partial` boolean into `shots/_metrics.json`, not just to
   `console.warn`. Kills 16, and finishes the fix that confirmed case 11 only half-landed.
3. Parse flags with a real loop instead of `args[0]?.startsWith('--') && args.shift()`, and add one
   smoke test asserting `--expect 2` fails on one file in both argument orders. Kills 15.

Separately, record the **quality tier** and the **actual drawing-buffer size** into
`shots/_report.json` and have `shoot.mjs` call `__VM.setSize(2560,1440)` (finding 14). Without that,
every scorecard number remains machine-dependent, and no amount of fixing the probe helps.

### 8.4 A boot-time assertion for the tables that must agree — catches 3–4 findings

Findings 9 (four bloom thresholds), 22 (two quality preset tables), 44 (two `INCOME_SMOOTHING`), 41
(`WRECK_LIFETIME` vs `wreckSeconds`), and confirmed case 2 (two flash knobs) are all *one quantity,
two owners*. A `dev`-only assertion at boot — `console.assert(QUALITY_PRESETS[t].resolutionScale ===
RENDER_QUALITY_PRESETS[t].resolutionScale)` for each overlapping field — costs nothing in production
and fires the first time someone edits one table.

Better still where it is cheap: delete the losing copy. `QUALITY_PRESETS` is 15/16 dead (finding 22);
removing those fields is strictly safer than reconciling them.

### 8.5 A grep-level lint for hand-written key names — catches 2 findings

`ActionCatalogue.ts:9-13` states the rule in its own header: no hand-written control list may exist
outside the catalogue. Findings 25 and 27 break it, and confirmed case 9 is the same rule broken
before. A test that greps `apps/game/src/shell/` and `apps/game/src/ui/` for `\b(Ctrl\+|Shift\+|\bQ and E\b|\(A\))` and
requires each hit to resolve through `ActionCatalogue` would hold the line. Small, ugly, effective.

### 8.6 What no cheap check will catch

Findings 1, 2, 10, 13, 18, 19, 30, 37, 38, 47 are semantic. Nobody's linter is going to notice that a
blurb promises a brownout vulnerability the combat gate does not implement, or that a fix landed in
the wrong table. For these the only defences are:

- **Assert against the table the game actually reads.** Finding 1's three green tests each read a
  *different* prereqs table from the one `ProductionCatalog` serves. A test that walks
  `PLAYABLE_FACTIONS`, resolves each faction's MCV through `ProductionCatalog`, and asserts it is
  buildable on a fresh `UnlockGate` profile is ten lines and catches the most severe finding here.
  Generalise: *when you write a data test, resolve through the runtime service, never the source
  table.*
- **Blurbs are claims.** Any blurb asserting a mechanic (`"Dies in a brownout"`, `"Drives over
  anything soft"`, `"Ships with one"`, `"Unlocks the top of every tab"`) should either be checkable
  or be vague. Confirmed case 3 and findings 2, 10, 38 are one sentence each. A convention — put
  mechanical promises in a `mechanics:` field that a test can cross-check against the flag that
  implements it, and keep `blurb` for flavour — would make the checkable ones checkable.
- **Keep auditing.** This document is the fourth time the pattern has been found by reading. That is
  not a failure of process; reading is the instrument that works. Budget for it.

---

## 9. Notes for whoever picks this up

- **Do findings 1, 2, 3, 4 first.** All four are live, player-visible, independent, and each is a
  small edit. Finding 1 is the single most severe thing in this document.
- **Order matters between 5 and 21.** Binding `world.vfx` to a real `DecalField` without first
  unifying the two `DecalKind` enums turns every scorch into a tread mark, with no type error to
  warn you. Fix 21 first, or fix them together.
- **Findings 6, 7, 15, 16, 17 are one work item.** They all live in `tools/metrics.mjs` /
  `docs/grade-baseline.json` and they compound. Until they are fixed, do not trust any grade number
  in this repo, including ones quoted in `config.ts` comments — finding 7 shows one has already
  become a shipped value.
- **Findings 12, 13, 14, 22 all bear on open task #28 (GPU saturation).** In particular #13 means a
  machine auto-detected as `low` still renders 2048² shadow maps, and #12 means the adaptive
  mitigation that four files describe has never existed.
- **Re-audit the vision subsystem after task #26 lands** (§6 K6, §7).
- **#62 is fixed but leaves an open item**: `06-economy` is the only capture fixture in which ore
  can be drawn at all, because every other fixture that declares ore has `settleTicks: 0` and
  `?shot=` boots paused. Until a fixture with ore actually ticks, `npm run shots` cannot regress
  this renderer. Also still dead: `OreField.densityAtWorld`, zero callers.
- This audit wrote no source file. Its only side effect is `shots/_metrics.json` (gitignored), which
  now holds a stale one-row score. Regenerate with
  `npm run shots && node tools/metrics.mjs shots/*.png --expect 12` — note the argument order, per
  finding 15.


---

## 10. Findings added after the original audit

#62 was the first of these and sits at the end of §3. #63 onward are added here, from the
2026-08-18 pass that extracted `docs/AERIAL_PLAN.md` and `docs/N_ARMIES_PLAN.md` before deleting
them — each is a claim in the tree that stopped being true, found while reading those plans
against the code.

### 63. A Repair Depot already services an aircraft loitering above it, contradicting Defs.ts's "a
hangar would have nothing to do"

`apps/game/src/data/Defs.ts` states the air doctrine as *"IT NEVER LANDS. There is no airfield, no rearm and
no fuel in this game, and adding one would be a new subsystem rather than a def row… an idle
aircraft LOITERS at 22 m over whatever it is standing above and a hangar would have nothing to
do."* **The last clause is false, and repair-on-station has shipped unadvertised since the Repair
Depot landed.** `RepairSell.tickRepairs` walks `store.byKind[EntityKind.Vehicle]` — which is where
every flyer lives, because there is no `EntityKind.Aircraft` and `UnitDef.kind` is typed `Infantry
| Vehicle` — filters on `maxHp`, `hp`, `Alive` and `PendingDestroy`, none of which an aircraft
fails, and tests the pad with `dx * dx + dz * dz > r2`. **There is no Y term and no `Locomotor`
reference anywhere in the file.** So an aircraft loitering 22 m above a friendly Repair Depot is
being serviced right now, at `REPAIR_COST_PER_HP`, at `REPAIR_DEPOT.fractionPerSec` of max HP per
second, without landing, without exposure, and with `EntityFlag.BeingRepaired` visible in the
selection panel. Two consequences. A landing zone's "return to base to repair" half is not a new
mechanic — it is a mechanic the game already has and never advertised, and the only missing piece
is the ORDER that sends the aircraft there. And an aircraft healing for free with only an XZ
radius to respect is almost certainly not what anyone designed, which is the kind of thing that
reads as intended once a landing zone exists to justify it — decide whether it is a bug before
building on it, not during. Established by code read on 2026-08-18; not observed in a running
match. | LIVE |

### 64. apps/relay/README.md still advertises 31 relay tests; there are 60

`apps/relay/README.md:14` documents the relay's own suite as '`npm test` # 31 tests, no sockets, no
timers'. There are 60, and CLAUDE.md's gate list already says 60. Flagged during the four-army
audit in v2.5.0-era and still wrong. The count is the only claim on that line that can rot; the
'no sockets, no timers' half is still true.

### 65. MapChoice.players' doc gives an obsolete reason for the numbers in its own table

`MapChoice.players` in `apps/game/src/shell/settings-store.ts` explains its 2s and 4s with 'Two armies open
on the authored diagonal (`SKIRMISH_START_OFFSETS`); three or more fan around the map centre on
the same ellipse, with no reserved terrain shelf.' That stopped being true when
`SKIRMISH_START_OFFSETS` grew to four entries: `startSpots` walks the authored table for every
slot up to `SKIRMISH_ARMIES_MAX` and the geometric fan is reached only at FIVE or more armies,
which no shipped map offers. Slots 2 and 3 land on reserved shelves exactly as 0 and 1 do. The
field's VALUES are still right — the real reasons are the sea arithmetic for
`contested-strait`/`coral-shore` and an authored playtest judgement for `frozen-sector` — but the
stated reason is one revision behind the code it sits next to.


### 66. Eleven browser-only claims the desktop target made incomplete — **LIVE (doc)**

## Finding 63 — the desktop target manufactures eleven browser-only claims, and `credits-truthful`
cannot see the biggest one

Added 2026-08-18, out of numbering order, like #62: the Electron shell shipped in v2.15.0 and this
is the audit of what that made untrue. **Nothing here is fixed, and that is deliberate** — these
are INCOMPLETE rather than false while the desktop build is undistributed, since every player
still arrives through a browser. Re-verified line by line against HEAD; only one had drifted since
the original grep.

```
CLAUDE.md:7             "an original browser RTS"
README.md:6             "runs in the browser"
README.md:12            the PLAY IN BROWSER badge
README.md:42            "built for the browser"
README.md:105           "'Shipped' means apps/game/public/ — what the browser downloads"
package.json:6          "for the browser"
index.html:8            meta description "running in the browser"
wiki/Home.md:3          "runs in a browser tab"
wiki/Campaign.md:34     "stored per browser profile. Deleting site data resets it"
apps/relay/README.md:98     "a browser blocks a plaintext socket from an https page"
wiki/Multiplayer.md:58  "a browser refuses a plaintext socket from a secure page"
```

**The last two are the load-bearing ones.** They are the stated reason the relay carries no
transport check of its own, and they are claims about what a *browser* enforces being relied on by
a target that is not one: `pageIsPlaintext()` tests `location.protocol !== 'https:'`, which an
`app:` origin passes, so our own refusal does not fire on desktop.

**The one no test can catch is a fourth non-generated-asset category.** CLAUDE.md's list is
Rajdhani, the brand PNGs, the splash art and the audio — about 9 MB, all in `apps/game/public/`. The desktop
build adds roughly 150 MB of Chromium, Node, V8 and ffmpeg to what reaches a player, carrying real
attribution obligations: Electron ships `LICENSES.chromium.html` and its bundled ffmpeg is
LGPL-2.1. The credits screen names none of it. The trap is mechanical rather than a matter of
anyone forgetting: `apps/game/tests/credits-truthful.spec.ts` walks `apps/game/public/`, the Electron runtime is not
in `apps/game/public/`, so the test goes on passing at full green while the credits screen becomes
materially less true — *a green build proving nothing*, already on this repo's list of things that
have gone wrong. Extend it to require a desktop-runtime credit whenever a desktop target is
configured.

Then `CLAUDE.md`'s "WHAT IS STILL WEB-ONLY PROSE" bullet should point here instead of at the deleted plan.

### 67. R8 — the tutorial taught the opening build and omitted the game's defining verbs — **FIXED**

The shipped director stopped after fourteen steps. It covered camera, selection, move and
attack-move, MCV deployment, power/refinery/harvest, one factory/unit/rally point, then explained
victory. It did not teach control groups, stances, formations, garrison, engineer capture, repair,
sell, transports, naval crossings, commander abilities, base-wide powers, superweapons or
veterancy. The Help catalogue documenting 70 actions made the omission measurable: the beginner
path presented roughly a third of the actual command vocabulary and none of the systems that make
VOLTMARCH more than its build order.

Fixed by expanding the director to 26 independently driven steps. The new steps do not complete
from prose: capture, sale and veterancy consume confirmed simulation events; repair waits for an
owned building to enter the authoritative repair state; garrison/transport/superweapon orders are
classified by their real order and target; input/HUD-only actions use the structural tutorial
bridge. Training moved from Temperate Valley to Contested Strait so neutral structures and a sea
crossing physically exist, receives 30,000 non-persistent training credits, and temporarily lifts
the unlock gate only while the tutorial director is live. `apps/game/tests/tutorial.spec.ts` requires one
independent driver for every step and rejects completion from all foreign signals. Fixed
2026-08-24.
