# Strategic airbase and heavy bomber plan

Status: all four faction pairs and ImageGen-to-Meshy asset passes complete; Slice 1 failure handling remains in progress · owner: gameplay/AI/art pipeline · updated 2026-08-31

## Outcome

Add a faction-specific late-game building-and-aircraft pair for every army, inspired by classic RTS
airfields without turning any bomber into a normal repeat-fire gunship. The Allied pair established the
mechanics and asset-pipeline POC; Soviet, Meridian and Reclamation now ship distinct implementations:

- the **Strategic Airbase** is a 6 × 6-cell (24 × 24 m) modular structure with four visible landing
  and service bays;
- each completed, powered airbase contributes exactly four bomber slots;
- the **Albatross Heavy Bomber** can be built only while a compatible Strategic Airbase exists and
  one of its bays can be reserved;
- every bomber carries one bomb, flies one deliberate attack run, returns to a compatible airbase,
  lands, and rearms for exactly 10 seconds (300 simulation ticks);
- one bomber can be tasked alone, or any subset of ready bombers can be selected and ordered as a
  group;
- the aircraft, airbase core and service-pad family go through the normal concept, Meshy geometry,
  conditioning, PBR, LOD, shadow, integration and live-review gates. No generated output is accepted
  directly as production art.

The append-only pairs are `alliedAirbase`/`alliedAlbatross`,
`sovietHeavyAviationWorks`/`sovietMolot`, `mrdSolarAerodrome`/`mrdEcliptic`, and
`rclCarrionRoost`/`rclScrapvulture`. The existing `vindicator` remains the Petrel's fast, repeat-fire
strike role. Its display name should become **Petrel Strike Aircraft** when the Albatross ships so the
sidebar does not call two mechanically different units “bomber.”

## Product contract

### What the player owns

The bomber is a real selectable unit, not a one-click support power. A docked aircraft remains visible
on its assigned pad, can be clicked directly, can join a control group, can be damaged, and reserves
the same bay while airborne. The base is therefore both producer and home, rather than a prerequisite
that stops mattering after construction.

Each player may own at most one Strategic Airbase, and that airbase owns four numbered slots. The cap
counts queued, under-construction and completed copies, so neither shift-click nor a second build order
can bypass it. A bomber reserves a specific slot as soon as production begins, so four launched aircraft
cannot be followed by four extra queued aircraft. A destroyed bomber frees its slot immediately.

The Vehicles tab remains the purchasing surface. Adding an Aircraft tab would change a persisted enum,
duplicate an existing roster concept, and make a four-unit producer occupy permanent sidebar space.
The selected airbase exposes its four bays in the selection panel:

| Bay state | HUD treatment | Player action |
| --- | --- | --- |
| Empty | outlined slot and `BUILD` affordance | starts the Albatross entry if the shared queue can accept it |
| Building | progress and owning queue | select/cancel the production item |
| Ready | lit aircraft silhouette | click selects; Shift-click adds; attack order launches |
| Airborne | outbound/returning state | click selects the aircraft in the world |
| Reloading | deterministic countdown | selectable, but attack is unavailable until zero |
| Lost/Diverting | warning treatment | shows the rehome or recovery outcome |

Normal selection remains sufficient for one or several aircraft: click one pad, Shift-click more, or
use a control group, then right-click a valid enemy ground target or use force-attack on terrain. A
selected airbase also offers **Select ready** and **Recall airborne** contextual actions. There is no
untargeted “launch all” button and no DOM-only command path; every launch is an ordinary lockstep order.

### Combat rules

- The Albatross targets ground units, structures, and force-attacked ground. It cannot target air.
- It never auto-acquires a target while docked and does not spend its bomb on an opportunity target.
- An attack order creates a fixed ingress, release and egress corridor. The aircraft does not orbit
  over the target or make a second pass.
- The bomb releases only after the aircraft enters the authored attack corridor at attack altitude.
  A moving target is sampled at release; the bomb does not home after leaving the bay.
- Successful release consumes the only ordnance point. The bomber immediately flies the egress leg
  and returns home.
- Recall before release aborts the attack and preserves the bomb. Recall after release only shortens
  the return path.
- Rearm starts after touchdown, not at release, and completes after exactly 300 simulation ticks.
  A host in blackout pauses rearm and cannot launch a newly rearmed aircraft until power returns.
- Four aircraft given one target receive deterministic lane offsets based on sorted entity handle and
  home slot. They read as a formation but do not occupy the same path or bomb-release point.

The first balance pass should use a single high-explosive bomb with strong Concrete/Heavy response,
friendly fire, a visible ground shadow, a brief release whistle and a clear impact telegraph. Working
numbers—not shipping promises—are 500 centre damage, 6 m splash with falloff, 2,000 credits, 26 seconds
build time, 320 HP, 10 m/s cruise speed and 34 m sight. A full four-plane investment should severely
damage a top-tier structure but should not erase a full-health Construction Yard without counterplay.
AA, interception, the long approach, airbase cost and the rearm cycle are the intended answers.

### Sortie state machine

The authoritative state is explicit and deterministic:

```text
Building -> DockedReady -> Launching -> EnRoute -> AttackRun
                                      -> Returning -> Landing -> Reloading
                                                       ^             |
                                                       +-------------+

Any airborne state -> Diverting when its host is lost
```

`Move` launches a docked Albatross into ordinary free flight, and subsequent Move orders may send it
anywhere on the map. Attack, ForceAttack or AttackMove begin the one-bomb run. After release it returns
automatically; Stop or a new Move cancels that return and leaves the empty aircraft airborne, while Guard
recalls it to land and rearm. A normal context-click anywhere on its own airbase is also a landing request;
the controller redirects that point move to the reserved bay. Stop before release cancels the run without
spending the bomb.

Docked and landing aircraft need a special movement presentation. `Locomotor.Air` currently rises to
cruise height even when immobilized, so merely setting `Immobilized` is insufficient. Movement must
honour the sortie state: docked/reloading aircraft stay at their pad socket with gear down and no bank;
launching/landing interpolate through their approach socket; normal air movement resumes only after
clearing the pad. The real unit remains the selection and damage authority—no decorative duplicate is
placed on the building.

## Producer and capacity architecture

The current production service has one queue per tab and resolves the Vehicles queue to a tab-wide
`primaryFactory`. Docks already require a `navalFactory` exception. `BuildingDef.produces` describes
compatible output but is not the runtime routing authority, so adding another exception for the airbase
would compound the same fault.

Before the bomber POC, production should resolve every unit to an **explicit compatible producer**:

1. Build a reverse index from unit content key to completed producer definitions that list it in
   `BuildingDef.produces` (or the equivalent bound production catalogue field).
2. Count working, powered compatible producers for the queue head, rather than every producer sharing
   its tab.
3. Resolve primary status inside that compatible producer family. Selecting an airbase as primary must
   not redirect tanks, and selecting a War Factory must not redirect bombers.
4. Give the queue a truthful `No compatible producer`/`No free bay` hold reason and resume automatically
   when either condition clears.
5. Route naval production through the same mechanism and retire the dedicated naval special case only
   after its existing launch and regression suite passes unchanged.

The Allied War Factory's `produces` list must continue to exclude the Albatross. The Strategic Airbase
lists only `alliedAlbatross`, uses the Vehicles tab, and supplies exactly four capacity slots. Its
one-per-player ownership cap is enforced by the shared production availability path, so the HUD and AI
receive the same refusal. Queued plus live reserved aircraft may never exceed four.

If the host dies during production, the item may reserve another compatible free bay. If none exists,
the item holds without charging further and can be cancelled for the normal refund; it must never spawn
from a War Factory or jam unrelated vehicle production behind a permanently ready item.

## Authoritative simulation and persistence

Side maps are not sufficient for a gameplay relationship that must survive save/load and participate in
lockstep checksums. The POC uses two explicit store columns:

| Column | Suggested storage | Meaning |
| --- | --- | --- |
| `sortieHostId` | `Int32` entity reference | owning airbase handle |
| `sortieData` | packed `Uint16` | state, bay 0–3, one-bomb flag and 0–300 rearm ticks |

Both are initialized on every spawn/reset path and included in save columns, entity-reference remapping
and checksums. The existing weapon `cooldown` column is used only to observe a successful release; it is
not the ordnance or the 10-second service timer.

Append `ProjectileKind.Bomb`; never insert it into the persisted numeric order. A bomb has a downward
ballistic presentation, one impact point and no post-release homing. The combat system decrements
`ordnance` only when a shot actually spawns, so an interrupted approach cannot consume ammunition.
The sortie system observes that transition, clears target acquisition, and owns egress/return. The
existing pooled projectile, trail, impact, sound and decal channels must be reused; there are no
per-bomber lights, particles or materials.

### Host loss, sale and capture

Host transitions are deterministic and must be tested rather than left to unit destruction order:

1. Rehome to the nearest completed, powered, owned Strategic Airbase with an unreserved bay; entity
   handle breaks equal-distance ties.
2. A docked aircraft emergency-launches before the destroyed host's wreck occupies the pad.
3. If no bay exists, a loaded aircraft may complete one already-issued sortie. An empty/orphaned
   aircraft heads to the map edge for off-map recovery and is removed after a warning. If a bay becomes
   available before exit, it diverts and lands.
4. Selling is refused when occupied/reserved bays cannot all be rehomed. This is clearer and less
   exploitable than silently deleting aircraft for a partial refund.
5. Capturing the building never transfers its attached aircraft. They emergency-launch for their
   original owner and follow the same rehome rule; the captured base begins with empty slots.

## AI contract

The AI must buy and command the same objects through the same production and order services as a human:

- construct an airbase only after stable late-tech economy and power thresholds;
- count queued and reserved bombers against the four-bay limit;
- choose legitimately visible high-value structures, clustered heavy armour or static siege targets;
- never read undiscovered targets or target through shroud;
- score known AA and prefer ingress lanes that do not cross an overwhelming defence field;
- on Easy, launch one aircraft with a longer decision delay; on higher levels, synchronize two to four
  only when target value justifies the exposure;
- recall wounded aircraft before release when survival is more valuable than the sortie, and never let
  the generic aircraft-withdrawal rule fight the bomber return state;
- rebuild the airbase before ordering replacements when capacity is lost.

The Albatross is appended to the AI catalogue after existing role-first entries, with a strategic siege
role and low army weight. It must not replace the Prism Tank as the first normal Allied siege answer.

## Art direction

### Four faction designs, one sortie contract

Every army uses the same deterministic four-slot, one-bomb, return-and-rearm rules. Everything the
player sees and hears is faction-authored. No faction may ship as a recolour, material swap or minor
greeble pass over the Allied source mesh. Working display names below are concept labels; only the
already-integrated Allied content keys are frozen.

| Faction | Airfield design | Heavy bomber design | Single-payload doctrine |
| --- | --- | --- | --- |
| Allies | **Strategic Airbase**: four clean vector-lift pads around a compact white-ceramic operations core; flush arrestor cradles, blue runway glass, precise bay numerals and restrained service arms. | **Albatross**: broad cranked wing, deep blended centre body, two separated nacelles, cobalt canopy/sensors and a visible centreline bomb bay. Controlled, modern, expensive. | Precision penetrator: strongest centre/Concrete response, tight readable blast and the cleanest ingress lane. |
| Soviets | **Heavy Aviation Works**: a fortified central bunker with four revetted hardstands, armoured fuel pipes, brutal gantries, red floodlights and blast walls. It should feel built to keep operating while shelled. | **Molot** working name: long armoured fuselage, swept high wing, four exposed engines, heavy tail and oversized landing gear—closer to a flying locomotive than a stealth wing. | Demolition bomb: slower release, largest shock and terrain throw, wider falloff and the loudest telegraph; durable airframe pays with speed. |
| Meridian Pact | **Solar Aerodrome**: four radial levitation cradles around a tall heliostat/astrolabe control spire; pale stone/ceramic, brass structure, cobalt glass and thin solar-light paths. No copied runway slabs. | **Ecliptic** working name: faceted manta/delta planform, suspended central payload, paired solar nacelles and deliberate negative-space cuts. Elegant geometry, never a conventional tube aircraft in gold. | Focused sun charge: narrow luminous impact column, high armour/structure energy response, smaller physical blast and a brief exposed charge cue. |
| Reclamation | **Carrion Roost** working name: four visibly repaired launch decks around a salvage crane and service furnace; mismatched deck plates, cable reels, scavenged arrestors and warm practical lamps. Asymmetry is composed, not random noise. | **Scrapvulture** working name: asymmetric wing, one oversized rebuilt engine balanced by a smaller booster, bolted belly cradle and readable patched control surfaces. It must still have a stable flight silhouette. | Slag cask: one physical canister that ruptures into a short local scrap/slag burst; lower centre damage, strong clustered-unit pressure and persistent scorched dressing within existing decal budgets. |

The four designs also require distinct silhouettes in sidebar cameos, faction-specific engine loops,
launch/landing cues, bomb whistles and impacts. Shared pad-state shader logic, sockets, LOD ratios,
collision conventions and WebGPU material infrastructure are allowed; shared visible source geometry is
not. The rollout gate is one complete faction at a time so an accepted Allied POC does not authorize
three unreviewed Meshy clones.

### Heavy bomber

The model must read as a heavier class than the 11 × 12 m Petrel at normal RTS distance. Target envelope:
approximately 15 m long, 16 m span and 4.2 m high, with optional folding outer tips only as a service
animation—not as the trick that makes the pads fit.

Non-negotiable silhouette cues:

1. a broad cranked/swept wing and deep centre body, visibly larger than the Petrel;
2. two separated engine nacelles with strong negative space and readable rear exhausts;
3. a ventral bomb-bay spine and one visible single-bomb delivery point.

Allied visual DNA remains white ceramic outer armour, blue-black structure, polished metal, cobalt glass
and separated team-colour clusters on silhouette edges. Team colour is 7–10% of visible unit area and
must not wash the whole wing. The production hierarchy is `Hull`, optional `GearL/GearR/GearNose`,
`BombBayDoorL/R`, `Bomb`, `EngineL/R`, `BombDrop`, and a shadow proxy; only parts that animate or carry
gameplay sockets stay separate.

Shipping budget: 12k–20k triangles at LOD0, LOD1 at 35–50%, LOD2 at 12–20%, one low shadow proxy,
one or two materials, 2K base colour, 2K normal, 1K packed metal/roughness, and no more than 5 MiB for
the primary runtime GLB. Landing gear and bay-door motion must survive the same LOD review as the hull.

### Strategic airbase

The game-scale 12.5 × 13 m aircraft fit four inset service positions inside a 6 × 6-cell footprint.
Their wings can overhang the service decks while their bay centres, collision and pathing remain inside
the 24 × 24 m gameplay bounds; the structure must not dominate an ordinary faction base.
Use four compact pads in a 2 × 2 arrangement with
noses facing outward, a compact operations/service core between them, and open approach lanes. It is a
short-field vector-lift/arrestor installation, not a fifty-metre runway that consumes a skirmish map.

The airbase must read as a modular family, not one featureless generated slab. The accepted ImageGen-led
Meshy reconstruction delivered one connected shipping body, but retained strong visual seams between
the operations core and each of the four service pads. Simulation still owns the four independent bay
sockets, capacity, approach points and state; procedural footprint, collision, selection bounds and the
complete visual fallback remain authoritative. If pad animation or damage variants are added later,
split or rebuild the visible modules locally rather than inferring gameplay state from the connected mesh.

Required sockets are `Bay0..3`, `Approach0..3`, `Touchdown0..3`, `Launch0..3`, `Service0..3`, a holding
point, selection/health anchors, and damage/smoke anchors. The family should submit the four identical
pad modules as one instanced/merged material family rather than four unique draws or texture sets.
Touchdown Y is authored per faction rather than assumed to be terrain height: conditioned LOD0 deck
intersections plus 0.18 m clearance are Allied 1.01 m, Soviet 2.29 m, Meridian 0.67 m and Reclamation
1.98 m. Produced aircraft and returning aircraft use the same deterministic height.
Return-home accepts a click anywhere inside the full 6 × 6 footprint. Touchdown uses the navigation
layer's existing hull-aware arrival distance (`radius + NAV_ARRIVE_SLACK`), so steering and the sortie
controller cannot stop at two incompatible radii.
Placement previews also follow the render registry generation. If progressive loading replaces a
small synchronous faction fallback while an airbase is already on the cursor, the hologram rebuilds
from the authored structure immediately instead of freezing the fallback inside the 6 × 6 grid.

Treat the complete four-bay field as an airbase-class landmark: 70k–100k LOD0 triangles, one material,
2K/2K/1K textures, at most 9 MiB compressed primary GLB, a validated colour LOD and a shadow proxy.
The acceptance report records the complete 6 × 6 family
triangles, draws, compressed bytes and decoded texture memory so modularity does not hide total cost.

## Meshy pipeline

The Allied production pass followed this gate:

1. Create coherent true-orthographic front/right/back/left bomber references plus a top view, and the
   same cardinal/elevated set for the airbase core and one service bay. Reject perspective-cardinal
   views before generation.
2. Freeze the three silhouette cues, scale envelopes, part list, four-pad clearance and Allied material
   swatches in each concept README.
3. Generate geometry only. Review cardinal screenshots, manifolds, fused surfaces, flat-pad integrity,
   bomb-bay/gear separation and exact aircraft clearance before any PBR task.
4. Condition locally: axes, scale, origins, named parts, UVs, hard edges, tangent basis, collision,
   sockets, LODs and shadow proxies. A paid remesh is allowed only after one isolated test proves the
   dense source is correct and local reduction cannot meet budget without silhouette loss.
5. Run Meshy PBR/retexture only on geometry that passed. Consolidate arbitrary generated materials into
   the Allied family contract, generate KTX2 derivatives, and keep raw tasks plus metadata under
   `meshy_output/`.
6. Integrate behind the imported-asset registry with the procedural fallback intact. Render cameos from
   the actual integrated assets and perform day/night/snow cardinal review at gameplay distance.

The initial 40-credit text-only Allied preview pair was rejected before refinement: the aircraft read as a
melted fighter and the base lost the four-bay language. ImageGen then produced the authoritative concept
and isolated reconstruction references. Fresh PBR image-to-3D jobs consumed 30 credits each:
`01a0542b-6770-70ba-a9d5-dc3a05042ecf` for the Albatross and
`01a0542b-7158-7514-b446-00c8870f2948` for the Strategic Airbase. Raw tasks remain in `meshy_output/`.

Each later faction used a fresh isolated ImageGen reference and its own image-to-3D PBR job rather than
deriving from Allied geometry. The final Meridian tasks are
`01a05484-5273-72db-8249-74b00b79335a` (Ecliptic) and
`01a05484-5e27-7644-ae83-b25294637672` (Solar Aerodrome); the Reclamation tasks are
`01a05484-6b3e-7762-b8f2-d951a0e0f734` (Scrapvulture) and
`01a05484-765a-77bc-b96d-767b68cf89e8` (Carrion Roost). Those four accepted jobs consumed 120 credits.
Their reconstruction references and immutable contracts live under `docs/concepts/meshy/`; raw task
metadata and source downloads remain under the matching timestamped `meshy_output/` directories.

## Delivery slices

### Slice 0 — deterministic greybox POC

Implemented and regression-covered on 2026-08-30. The live `strategic-airbase` fixture renders the
imported ImageGen-to-Meshy four-pad structure and four Albatrosses; the content-alias gate and procedural
fallbacks prevent either asset from silently wearing a default tank or structure model on import failure.

- Add compatible-producer routing and retire no naval path until parity tests pass.
- Add the 6 × 6 airbase greybox, four sockets and one greybox bomber.
- Implement one airbase, four reservations, individual/group orders, single release, return and exact
  300-tick rearm.
- Save/load and replay every state before art integration.
- Prove placement on every shipped skirmish map and record the minimum viable base-clearance changes.

This began as the cheap playable gate; the accepted imported art now sits behind the same fallbacks.

### Slice 1 — failure handling and AI

In progress. Nearest powered compatible-base rehome and loaded pre-release recall through the existing
Stop/Guard command path are implemented; orphan exit, sale/capture policy, lane offsets and the bay rack
remain open.

- Rehome/divert/orphan, sell refusal, capture, blackout and mid-production host-loss behavior.
- AI build, target, lane, recall and difficulty rules using legitimate knowledge only.
- Airbase selection-panel bay rack, contextual actions, cursor/EVA feedback and accessibility labels.

### Slice 2 — asset POC

Completed for the Allied POC on 2026-08-30. The 49,025-triangle Albatross ships as a 4.49 MiB KTX2 GLB
with a 22,061-triangle colour LOD and 1,320-triangle shadow proxy. The 88,608-triangle complete airbase
ships as a 6.99 MiB KTX2 GLB with a 44,031-triangle colour LOD and 3,072-triangle shadow proxy. Both use
one material and an estimated 8 MiB decoded texture footprint. Meshy's connected bomb is visual only;
the deterministic runtime bomb remains an independent gameplay payload. Live sortie review on 2026-09-01
found the imported Albatross flying tail-first at the previous +90° fit, so its shared hull/LOD/shadow fit
now rotates -90°—an explicit 180° visual correction with no simulation-yaw or replay change.

Completed for the Soviet pair on 2026-08-30 from dedicated ImageGen references rather than an Allied
recolour. The 32,784-triangle Molot ships as a 2.89 MiB KTX2 GLB with 14,752- and 5,900-triangle colour
LODs plus a 984-triangle shadow proxy. The 49,516-triangle Heavy Aviation Works ships as a 4.28 MiB KTX2
GLB with 22,262- and 10,418-triangle colour LODs plus a 3,072-triangle shadow proxy. The natural PBR
atlases retain gunmetal, olive and restrained red breakup; runtime family gains lift readability without
washing the whole model in faction colour. The Soviet catalogue uses the same four-slot, one-base cap,
free-flight, single-release, return/landing and 300-tick rearm contract as the Allied POC.
Live sortie review on 2026-09-01 found the imported Molot tail aligned with authoritative movement:
its cockpit points along source -X, so runtime conditioning now rotates +90° rather than -90° to map
the nose onto gameplay +Z. The correction is render-only and is pinned by a focused spec plus the
native-WebGPU `07h-soviet-aviation-works` fixture; sortie state, steering and replay data are unchanged.

Completed for Meridian and Reclamation on 2026-08-31 from four dedicated ImageGen references. The
19,904-triangle Ecliptic ships with 8,956- and 3,582-triangle colour LODs plus a 1,188-triangle shadow
proxy; the 49,490-triangle Solar Aerodrome ships with 23,748- and 9,892-triangle colour LODs plus a
3,072-triangle shadow proxy. The 19,870-triangle Scrapvulture ships with conservative 10,626- and
10,618-triangle colour LODs plus a 1,488-triangle shadow proxy; its unusual asymmetric outline is kept
ahead of a more aggressive LOD2 reduction. The 49,598-triangle Carrion Roost ships with 23,760- and
11,854-triangle colour LODs plus a 2,592-triangle shadow proxy. All four have conditioned KTX2 PBR
shipping GLBs, procedural failure fallbacks, faction cameos and deterministic fixture coverage.
Desktop WebGPU review of `meridian-solar-aerodrome` and `reclamation-carrion-roost` confirmed the
four-bay compositions, distinct faction silhouettes and imported unit LOD/shadow paths with no warning
or fallback error. A subsequent normal-base comparison rejected the original 32 m footprint as too
large; all four imported structures and bay sockets now fit the compact 24 m authority.

### Slice 3 — shipping gate

- Balance four-plane alpha strikes against AA, repair, common structures and top-tier targets.
- Validate dense-base frame time, launch/return spikes, draw calls, triangles, load bytes and decoded
  texture memory on desktop WebGPU.
- Capture day, night, rain and snow presentation; confirm pad lighting does not become per-object lights.
- Update asset provenance, conversion map, faction docs, strategy docs, descriptions and current release
  handoff only after the content actually ships.

## Acceptance matrix

- A single powered airbase exposes four and only four reservable slots; a fifth bomber cannot charge or
  silently enter the queue.
- A second Strategic Airbase cannot be queued or constructed; the sidebar reports the one-per-player cap.
- The single airbase exposes four slots, and airborne/reloading/queued bombers still count against them.
- A bomber is never produced by a War Factory or dock, and naval/ground routing remains unchanged.
- One selected bomber launches alone; any selected subset launches together with deterministic lanes.
- The bomber releases exactly one bomb, never auto-reacquires, returns, touches down and rearms for
  exactly 300 ticks. Save/load and replay preserve the timer and state.
- Blackout, host destruction, sale, capture, bomber death and mid-build host loss follow the written
  rules without leaks, stuck queues or checksum drift.
- AI uses the same capacity and orders, does not read shrouded targets, and Easy never coordinates a
  four-plane opening strike.
- All 6 × 6 placements, rotations, build-radius checks, scatter clearing, nav blocking and destruction
  footprints pass on shipped maps.
- Parked aircraft can be selected without the building stealing the click; rings, health bars, bomb
  cursor and targeting preview remain correctly anchored at every camera zoom.
- Four simultaneous launches, four impacts and four returns create no runtime shader compilation,
  unique materials, per-aircraft lights or unbounded particle/decal allocations.
- LOD/shadow transitions, imported failure fallback, cameos and all four faction material/team masks pass live
  WebGPU review in normal, night and snow scenes.

## Implementation map

The expected owning seams are:

- content and balance: `apps/game/src/data/Defs.ts`, `apps/game/src/sim/Production.ts`, descriptions and
  content bindings;
- authoritative state: `apps/game/src/core/world.ts`, save/checksum/replay column registries and
  write ownership;
- sortie/combat: a focused `BomberSortieSystem` beside Movement/Combat plus an appended bomb projectile;
- commands and HUD: selection/order validation, contextual airbase bay actions and existing read-only HUD
  feature seams;
- AI: `apps/game/src/sim/AIStrategy.ts` catalogue and the brain's production/strike decision layer;
- art: imported unit/building registries, faction material binding, LOD/shadow/cameo conditioning and the
  procedural `UnitDefs.ts`/`BuildingDefs.ts` fallback paths;
- tests: compatible production, sortie state machine, save/replay/checksum, AI knowledge, 6 × 6 placement,
  air-layer targeting, asset registry, LOD/shadow and desktop WebGPU performance captures.

The POC is complete only when Slice 0 passes as a deterministic greybox. A pretty Meshy aircraft that
cannot reserve, launch, bomb, return, reload and survive save/replay is not progress on this feature.
