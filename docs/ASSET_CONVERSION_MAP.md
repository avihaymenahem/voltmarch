# VOLTMARCH asset conversion map

This is the production map for replacing or selectively upgrading the procedural troop, vehicle, naval, aircraft, and building roster. It covers **135 authored gameplay assets: 65 units and 70 structures**. Wrecks, LODs, shadow proxies, construction states, and UI renders are derived deliverables and do not buy a separate Meshy generation.

The procedural roster remains the live fallback until each imported asset reaches `validated`.

The right build HUD, selection cards and any later codex render must derive their model from the
same live `RenderBridge` registration used by the battlefield. They must not call a procedural art
library as a parallel source of truth. Deferred imported replacements invalidate the cameo cache;
the procedural library is retained only for pre-registration and load-failure fallback frames.

## Pipeline routes and statuses

| Route | Meaning |
| --- | --- |
| `BLD` | Multi-view static hard-surface building; footprint, facade, sockets, construction and damage states |
| `DEF` | Compact defence with explicit turret/barrel/emitter pivots |
| `MOD` | Shared modular kit/trim sheet; hybrid procedural assembly is preferred |
| `VEH` | Hard-surface ground vehicle with body/turret/barrel or mechanism separation |
| `AIR` | Aircraft with clean flight silhouette and only required moving parts |
| `NAV` | Waterline-aware vessel/transport with weapon and ramp pivots |
| `CHAR` | Character/creature topology, rig, shared faction animation set, LODs |

Statuses: `procedural`, `briefed`, `concept`, `meshy-raw`, `production`, `integrated`, `validated`, `deferred-hybrid`.

## Production order

1. `S1`: finish the Soviet building style kit and the six most-visible base anchors.
2. `S2`: Soviet support, technology, naval, superweapons, and defence kit.
3. `S3`: Soviet vehicle family, then naval/air, then the shared Soviet character rig.
4. `A1–A3`: Allied building, vehicle/naval/air, and character families.
5. `M1–M3`: Meridian architecture, machines, vessels, and character family.
6. `R1–R3`: Reclamation architecture, scrapyard machines, vessels, and character family.
7. `N1`: neutral capturable landmarks.

Current Meshy backlog: **38 gameplay units remain procedural** — 11 ground vehicles, 19 naval
units and 8 characters/creatures. There are no remaining building conversions in the production
backlog; modular walls/gates intentionally remain code-native where the `MOD` route calls for
seamless instancing rather than a unique generated mesh. The faction split is Soviet 9, Allied 10,
Meridian 10 and Reclamation 9. The detailed rows below are the authoritative names.

The Tesla Reactor and Soviet Construction Yard are the two paid pilots. Construction Yard v1 was
rejected for fused, swollen hard-surface geometry. V2 was also rejected after runtime review exposed
soft retopology, residual crane form, and UV-overlap-driven red texture contamination. Its shipping
import was removed and the procedural yard restored. V3 restarts from a crane-free, texture-authored
orthographic brief. Further paid generation retains the same strict geometry-first approval gate, while shared
texture/LOD work prevents unique decoded texture sets from being repeated blindly across the faction.

## Derived deliverables for every approved source

- Shipping LOD0 GLB within its class budget.
- LOD1/LOD2 and shadow proxy where the class budget requires them.
- Procedural fallback and loading-failure path.
- Team-colour mask/readability, selection and health anchors, gameplay sockets/pivots.
- Construction/active/damaged/death behaviour; vehicle and structure wreck treatment.
- Build-card/cameo render from the actual shipping material.
- Asset provenance, automated budget test, noon+dusk WebGL/WebGPU screenshots.
- Before/after disk, decoded VRAM, draw calls, triangles, load time, and GPU frame time.

The Soviet imported-building family now has the first live reusable optimization implementation: bounded
parallel loading, static geometry-only shadow proxies validated in WebGL and WebGPU, and batch-preserving
camera-distance colour LODs for every simplification candidate that passed the geometry gates. The moving
Sentry Gun remains on its articulated LOD0 shadow, and difficult colour meshes remain explicit blocked rows
rather than silently shipping weak derivatives. See `docs/ASSET_OPTIMIZATION_PIPELINE.md` for measured
runtime results and promotion rules.

The same 16 imported LOD0s now ship through required `KHR_texture_basisu` containers. Semantic ETC1S/UASTC
profiles reduce the family from 52.14 to 40.90 MiB on disk, while conservative 8bpp desktop residency falls
from 624 to 104 MiB. Each promoted file is individually smaller than its approved conventional source;
the geometry-only LOD and shadow files continue sharing the already-resident LOD0 material.

- **Conventional tank wreck family — integrated.** Meshy preview
  `01a042f1-71dc-75b7-94d6-49de14380554` and PBR refine
  `01a042fd-31ed-704b-b510-09f9aab15725` yield one 3,544-triangle neutral hulk.
  The fused presentation pedestal was removed before vehicle-profile promotion.
  Deferred Allied/Soviet light–heavy overrides fit the shared source to their
  class envelope; support, naval, Meridian and Reclamation wrecks retain their
  bespoke procedural silhouettes, and every imported override retains that
  procedural load-failure path. WebGPU integration is live; final desktop
  gameplay-scale review remains before promotion to `validated`.

## Soviet Union — 18 structures

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| S1 | `soviet_power` | Tesla Reactor | BLD | integrated | Clean V2 replacement: geometry task `01a02c02-8084-7cc4-83bc-0afdc39073fe`, local reduction/UV, retexture task `01a02c0c-63bd-7e9a-aa5b-97bfd0969b8f`; 15,025 triangles and 3.44 MiB with 2K/2K/1K PBR maps; paired induction drums, open busbar and front chamber; no old procedural visuals |
| S1 | `soviet_conyard` | Construction Yard | BLD | integrated | V3 is a clean crane-free 34,927-triangle Meshy replacement with a deep fabrication portal and dedicated red material zones; surface v2 restores family-level plate contrast, crease response and painted-steel roughness without UV repainting; all legacy procedural visuals are filtered out, and the 32-triangle backend-neutral contact plinth supplies grounding; validation captures pending |
| S1 | `soviet_warfactory` | War Factory | BLD | integrated | Dense task `01a02b1e-16f5-7d22-936e-15e29b305a1d`; melted paid remesh rejected; local reduction + xatlas UV retained the approved shape; retexture task `01a02b62-ca73-70d4-9cc8-cdcef20dfeec`; roster-matched olive/crimson/charcoal PBR integrated at 35,378 triangles and 4.28 MiB; preserve shutter separation and exit/apron contract |
| S1 | `soviet_refinery` | Ore Refinery | BLD | integrated | Geometry task `01a02b72-5b87-7d99-b997-d16699e62815`; local 35,076-triangle reduction and xatlas UV preserved the approved hopper/intake form; retexture task `01a02b7f-1f75-709f-bd19-5f736e5b3809`; shipping PBR asset is 35,046 triangles and 4.04 MiB with 2K base/normal plus 1K packed MR; yaw +90deg restores +Z facade; preserve `DockEntry`, `Conveyor` and clear apron; dusk/WebGPU/performance validation pending |
| S1 | `soviet_barracks` | Barracks | BLD | integrated | Geometry task `01a02bcc-276b-7e44-82ab-8cdf0ea164fe`; retexture task `01a02bd6-082f-7402-852d-88a842fa5db1`; shipping body is 24,917 triangles and 3.67 MiB with 2K/2K/1K PBR maps; only the deliberately authored sliding door remains as a gameplay accessory, with WebGL/WebGPU open/closed-state validation complete |
| S1 | `soviet_radar` | Radar Tower | BLD | integrated | Geometry task `01a02b95-348f-713b-8fa3-f11855fff704`; approved 17,420-triangle body ships with one 2K/2K/1K PBR material from retexture task `01a02bab-27e5-71e4-bb27-88d10a8016b5`; generated bunker terminates in a clean spindle and the bespoke scan frame retains the 0.55 rad/s shader pivot, construction rise and animated shadow |
| S2 | `soviet_tech` | Proving Ground | BLD | integrated | Geometry task `01a02d1a-320b-7a38-b5fd-5d05a9481db4`; 1.98M-triangle source reduced and unwrapped locally with zero bounds drift; retexture task `01a02d1f-ef7b-7797-93e1-fd03013db416`; shipping static body is 14,790 triangles and 3.28 MiB with 2K/2K/1K PBR maps; broad accelerator crown, twin transformer shoulders and recessed test portal replace all procedural visuals while preserving nonvisual sockets |
| S2 | `soviet_commandpost` | Command Bunker | BLD | integrated | Geometry task `01a02d2e-4403-7ce3-a76e-57764b54f19a`; coherent 1.99M-triangle source reduced and unwrapped locally with zero bounds drift; retexture task `01a02d31-afcf-7d61-8efb-a2fe6f6b4885`; shipping static body is 14,883 triangles and 3.07 MiB with 2K/2K/1K PBR maps; low bunker, recessed command door, faceted map room and solid off-centre signal pylon replace all procedural visuals while retaining nonvisual sockets |
| S2 | `soviet_depot` | Repair Depot | BLD | integrated | Geometry task `01a02d39-8889-7f3d-aa97-2301ee14a7a2`; coherent 1.96M-triangle source reduced and unwrapped locally with zero bounds drift; retexture task `01a02d3d-764e-7fdb-a7c0-7128338855aa`; shipping static body is 15,524 triangles and 4.00 MiB with 2K/2K/1K PBR maps; open drive-on deck, low rear tool wall, twin service pylons and compact articulated welding arm replace all procedural visuals while preserving the nonvisual repair socket |
| S2 | `soviet_silo` | Ore Silo | BLD | integrated | Geometry task `01a02be4-b796-7507-bbaf-d6da6c18a5e7`; 1.97M-triangle source reduced and unwrapped locally with no paid remesh; retexture task `01a02bee-5f05-74f6-9a18-9131bb0463e8`; shipping static body is 13,264 triangles and 1.58 MiB with 1K/1K/512 PBR maps, while Hopper and DockEntry remain nonvisual gameplay sockets |
| S2 | `soviet_subpen` | Naval Pen | BLD | integrated | Geometry task `01a02d45-cd06-709e-b584-afced660a521`; coherent 1.97M-triangle source reduced and unwrapped locally with zero bounds drift; retexture task `01a02d49-c6ac-7e21-a779-b050fe6de07b`; shipping static body is 14,606 triangles and 3.91 MiB with 2K/2K/1K PBR maps; broad open berth, armored vault shoulders, low quays and compact solid signal/exhaust modules replace all procedural visuals while preserving ship-clearance and nonvisual dock sockets |
| S2 | `soviet_sentry` | Sentry Gun | DEF | integrated | Geometry task `01a02c29-443e-7a45-a226-d6373f21096b`; local reduction, UV and deterministic body/turret split; retexture task `01a02c30-6d1a-72bd-8c64-1162ee28ddd8`; shipping 8,327-triangle, 1.24 MiB two-mesh defence sharing one 1K/1K/512 PBR material; generated head slews on the gameplay turret pivot |
| S2 | `soviet_tesla` | Tesla Coil | DEF | integrated | Geometry task `01a02c3a-4dbf-7cec-b09f-046426b20f95`; local reduction/UV; retexture task `01a02c3d-2eb0-7d6b-ab7b-9bc3d41d323f`; shipping 7,449-triangle, 1.34 MiB static defence with 1K/1K/512 PBR maps; existing coil-tip/emitter gameplay sockets and VFX preserved |
| S2 | `soviet_flametower` | Flame Tower | DEF | integrated | Geometry task `01a02c1d-3bef-7f2d-bbb7-73ffafe32646`; local 13.8k reduction/UV; retexture task `01a02c24-2f20-72c2-9bb6-f67d52c3f4f2`; shipping 13,613-triangle, 1.63 MiB static defence with 1K/1K/512 PBR maps; radial nozzles preserve turretless gameplay |
| S2 | `soviet_nuke` | Nuclear Missile Silo | BLD | integrated | Geometry task `01a02d4f-e9af-7367-bd4c-fe3fbdb3aed5`; coherent 1.90M-triangle source reduced and unwrapped locally with zero bounds drift; retexture task `01a02d53-4dad-7fd6-8710-933f822ce8f1`; shipping static body is 15,923 triangles and 3.94 MiB with 2K/2K/1K PBR maps; recessed launch well, visible banded warhead, open blast-door beds and low fortress bastions replace all procedural visuals while preserving nonvisual launch sockets |
| S2 | `soviet_curtain` | Ironclad Field | BLD | integrated | Geometry task `01a02d57-eeaf-70b1-960b-e1b5e4717264`; coherent 1.98M-triangle source reduced and unwrapped locally with zero bounds drift; retexture task `01a02d5b-549a-74d2-a6ac-10a2c15685ce`; shipping static body is 16,437 triangles and 4.01 MiB with 2K/2K/1K PBR maps; paired inward emitter pylons preserve a clean central air gap while a separate rear discharge spire and low capacitor bunker replace all procedural visuals and retain nonvisual field sockets |
| S2 | `soviet_wall` | Wall | MOD | integrated | 816-triangle code-native modular blast wall; only its continuous battered core reaches the cell edge, while a single centre seam avoids doubled joins. Two-sided recessed armour bays, restrained crimson spine slabs, one merged part, no pad and the shared faction atlas preserve cheap instancing with zero unique texture memory. |
| S2 | `soviet_gate` | Gate | MOD | validated | Matching battered pylons and armoured lintel with a 2.48 m clear aperture; three-part paired leaves retract through the shader as one door, with a flush threshold and no pad seam; shared faction atlas, zero Meshy credits |

## Soviet Union — 18 units

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| S3 | `soviet_rhino` | Anvil Heavy Tank | VEH | validated | V2 geometry task `01a02ebe-dfe0-7eda-b39f-2f93dbaa75a8` and retexture task `01a02ee9-337d-73f4-a320-c242c8d4a089` replace the rejected smooth/monochrome tank with a 23,790-triangle articulated Hull/Turret asset. It has a sealed dark turret ring, hard armour planes, distinct charcoal turret / olive hull / crimson skirt blocks, authored 2K base + normal and 1K packed PBR maps, and a 5.13 MiB KTX2 shipping source that reduces conservative decoded texture memory from 48 to 8 MiB. Procedural fallback remains; LOD1 is explicitly withheld because the final atlas seams currently prevent a valid simplification, while shadow proxy, wreck and texture-reprojected LOD remain open. |
| S3 | `soviet_apocalypse` | Sledge Tank | VEH | integrated | Geometry tasks `01a02e6b-00fd-70f7-a591-2639f77f06de` and `01a02e77-7248-7419-95d4-9394f4e435ab` rejected for four guns. V3 geometry task `01a02e7c-6a75-7c15-8d82-53a7ecc68e89` and retexture task `01a02e8f-eb6e-7c8a-b012-969ab9343c6f` ship as a 26,718-triangle articulated Hull/Turret GLB with exactly two guns, one faction-matched PBR atlas, sealed off-axis rotation, 12,896-triangle LOD1, 1,728-triangle shadow proxy and KTX2 reduction from 8.18 to 3.32 MiB. WebGL/WebGPU noon validation passes; wreck and final performance baseline remain. |
| S3 | `soviet_sickle` | Sickle | VEH | procedural | Distinct walker/mechanism branch; leg animation contract |
| S3 | `soviet_v4` | V4 Rocket Launcher | VEH | procedural | Shared tracked chassis; elevating launcher pack |
| S3 | `soviet_harvester` | Ore Collector | VEH | integrated | 49,715-triangle forged hopper/scoop hero, 22,371/12,085 LODs, 1,344-triangle shadow proxy and KTX2 PBR; procedural fallback retained |
| S3 | `soviet_dozer` | Sputnik Dozer | VEH | integrated | Geometry `01a04447-864a-78a1-876f-006ad7daf2b5`, texture `01a04456-a9e1-787e-94a6-5ba7c16af56d`; 35,150-triangle tracked utility hero with 20,803/14,513 LODs, a 2,688-triangle shadow proxy and 3.46 MiB KTX2 PBR. The detached 3,592-triangle front-claw shell keeps its approved local orientation and moves -0.18 along source X, replacing a 0.152 air gap with a deliberate 0.028 mechanical overlap. Runtime yaw rotates the complete connected vehicle 180 degrees as one unit; it must never be emulated by turning the claw again. The claw-preserving LOD1 uses a narrow 60% per-asset ceiling while remaining below the 25k hero-unit budget. Paid remesh `01a04453-1c83-71d5-87cc-61881a6f3d7b` was rejected for smoothing away the approved machinery; the reviewed local reduction ships instead. Deployment behavior and sockets remain procedural authority. |
| S3 | `soviet_mig` | Interceptor | AIR | integrated | Geometry `01a04447-a8d3-748e-82d8-49b6839a1d2f`, texture `01a04456-cde2-7fce-9079-1ee4d8c5c3d1`; 19,281-triangle delta-wing interceptor with 8,676/3,522 LODs, 1,932-triangle shadow proxy and 2.31 MiB KTX2 PBR. Procedural sockets and fallback remain active. |
| S3 | `soviet_dreadnought` | Dreadnought | NAV | integrated | Geometry `01a04dbb-cdaf-7193-abc2-dc98d5d5b709`, retexture `01a04dbd-ade8-71ff-9986-982f350c34f8`; 23,846-triangle angular capital hull split into `Hull`/`Turret`, a 1,404-triangle shadow proxy and 5.00 MiB KTX2 PBR. It is fitted to a 16.0 × 4.8 × 4.8 m gameplay envelope; procedural weapon sockets, turret authority and fallback remain active. Generated colour LODs were blocked by the visual gate. |
| S3 | `soviet_sub` | Submarine | NAV | integrated | Geometry `01a04d87-49ee-7725-b671-fae9a7162785`, retexture `01a04d97-10fd-7443-840c-6d785861a315`; 23,794-triangle long attack-submarine silhouette with 10,677/4,282-triangle reviewed LODs, an 888-triangle shadow proxy and 3.19 MiB KTX2 PBR. It is deliberately distinct from the compact Picket Boat and retains the procedural submerged/readability and weapon-socket authority. |
| S3 | `soviet_transport` | Hover Transport | NAV | procedural | Amphibious transport; ramp/cargo clearance |
| S3 | `soviet_picket` | Picket Boat | NAV | integrated | Geometry `01a04cf5-c42e-776b-a750-4ee0154099c3`, retexture `01a04cfe-8e26-71f7-b909-d30ddd1569e9`; 18,064-triangle compact surface-combat hull with a 4.46 MiB KTX2 source and a dedicated shadow proxy. It is fitted to a 9.0 × 3.3 × 2.9 m recon envelope so it remains the smallest Soviet combat hull without reading as a dinghy. Procedural bow pivot and effects sockets remain authoritative. |
| S3 | `soviet_lighter` | Assault Barge | NAV | procedural | Heavy transport; ramp and cargo deck hierarchy |
| S3 | `soviet_conscript` | Conscript | CHAR | production | Greatcoat humanoid POC: geometry `01a047c5-3b92-7b76-a835-5b28d84e1e3f`, 10k shipping remesh `01a047da-196f-7a33-af83-7f14fac5f480`, rig `01a047dc-de86-74d8-9f7d-d5d2ad426b5c`, PBR `01a047db-02b9-7a7e-9bf3-1b1709949fe9`; the 4,500-triangle/1.56 MiB textured LOD0 is integrated in gameplay. Runtime samples one trusted run/fire pose at load, discards the rig, and keeps the instanced `aGait` shader path. |
| S3 | `soviet_flak` | Flak Trooper | CHAR | integrated-hybrid | Reuses the live canonical 4,500-triangle Conscript body with a code-native drum pack and flak weapon, each hard-capped below 200 triangles. The paid unique body (`01a048de-fe28-7167-a703-ede132190ecd`) was rejected as redundant and archived outside shipping. |
| S3 | `soviet_engineer` | Combat Engineer | CHAR | integrated-hybrid | Reuses the live canonical Conscript body with a code-native horizontal gas bottle and cutting torch, each below the 200-triangle attachment ceiling. |
| S3 | `soviet_commissar` | War Commissar | CHAR | procedural | Officer variant; shared rig with unique head/coat cues |
| S3 | `soviet_dog` | Attack Dog | CHAR | integrated | Geometry `01a0494e-4e30-70e5-a170-007164c1d892`, PBR `01a04990-f10a-7be1-a75b-6eea4b18319c`; the 1.99M source was conditioned locally to a 5,987-triangle LOD0, 2,561-triangle geometry-only LOD1 and 720-triangle rest-pose shadow proxy, with a 0.81 MiB KTX2 runtime GLB. A deterministic 1.16 MiB review GLB adds an eight-joint quadruped skin plus Idle/Walk/Run/Bite clips and is validated in the shared-pose Animation Lab; Meshy's humanoid-only auto-rigger was not used. Gameplay LOD0/1 retain the existing instanced WebGPU/WebGL gait, so no skeleton or per-dog mixer is allocated yet. Procedural fallback and bite/VFX socket remain authoritative. |
| S3 | `soviet_diver` | Naval Infantry | CHAR | procedural | Shared humanoid rig where possible; aquatic equipment variant |

## Allies — 18 structures

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| A1 | `allied_conyard` | Construction Yard | BLD | integrated | Geometry `01a02f0f-683f-7ef1-84e3-f10bf7610f4d`, retopo `01a02f1f-c4dc-791f-ba7c-47fa60a385ed`, texture `01a02f24-f65c-7207-b63f-8fa7ef713640`; 39,166-triangle interlocking ceramic-vault hero body, complete imported shell, 17,624-triangle LOD1 and 2,268-triangle caster |
| A1 | `allied_power` | Power Plant | BLD | integrated | Geometry `01a02f14-22bc-72c1-be12-9ca64178b1ed`, retopo `01a02f1f-c8af-7920-8d70-dc92604c8b7c`, texture `01a02f24-ffa9-7555-9d96-9caa971ce724`; 31,099-triangle twin-reactor landmark, 13,993-triangle LOD1 and 1,968-triangle caster |
| A1 | `allied_barracks` | Barracks | BLD | integrated | Geometry `01a02f14-2e7b-705e-9290-23dcfd48eaaf`, retopo `01a02f1f-cc9a-78ca-a8a5-21027d69cd15`, texture `01a02f25-08e9-720b-8725-b808cc1d1968`; 26,130-triangle paired personnel modules, two colour LODs and 1,716-triangle caster |
| A1 | `allied_refinery` | Ore Refinery | BLD | integrated | Geometry `01a02f18-7b6a-770e-a48b-fd86e0b5baa6`, retopo `01a02f1f-d050-792a-8564-2e58907b65bf`, texture `01a02f25-127f-7ab5-9015-02d9d806da21`; 37,165-triangle curved processing hall with readable unload/separator language, LOD1 and 1,476-triangle caster |
| A1 | `allied_warfactory` | War Factory | BLD | integrated | Geometry `01a02f18-881a-7713-96ba-f4fef0a1db11`, retopo `01a02f1f-d40d-73f6-8d44-46f71d5121f3`, texture `01a02f25-1be8-7a2e-97cd-c1794ea279d8`; 39,115-triangle manta-roof factory with clear tank bay, LOD1 and 2,376-triangle caster |
| A1 | `allied_radar` | Radar Dome | BLD | integrated | Meshy-6 multi-view body; 27,572-triangle LOD0, 2,352-triangle inset caster, complete ceramic/graphite PBR shell |
| A2 | `allied_tech` | Tech Centre | BLD | integrated | 26,554-triangle laboratory landmark, 11,949-triangle LOD1 and 1,632-triangle inset caster |
| A2 | `allied_commandpost` | Command Post | BLD | integrated | 24,543-triangle static aerial silhouette and 2,472-triangle inset caster; no radar-dish duplication |
| A2 | `allied_depot` | Repair Depot | BLD | integrated | 26,643-triangle open service deck, 11,988-triangle LOD1 and 1,992-triangle inset caster |
| A2 | `allied_silo` | Ore Silo | BLD | integrated | Geometry `01a0405e-c2dc-78d9-893a-3b5ce47c3818`, remesh `01a04064-fbd0-7b3c-8f14-e55eabe55300`, texture `01a04067-7ba0-7b3f-8b52-93cb97656a56`; 13,799-triangle ceramic/graphite storage landmark, 2,280-triangle caster and KTX2 PBR. The procedural shell is now fallback/socket authority only. |
| A2 | `allied_navalyard` | Naval Yard | BLD | integrated | 39,462-triangle open waterline factory, 18,888-triangle LOD1 and 2,148-triangle inset caster |
| A2 | `allied_pillbox` | Pillbox | DEF | integrated shared kit | Animation-safe fixed casemate retained and audited; graphite embrasure and muzzle socket remain authoritative |
| A2 | `allied_aa` | AA Battery | DEF | integrated shared kit | Animation-safe fixed base and real turret pivot retained; dual muzzle sockets and broad faction bands validated |
| A2 | `allied_prismtower` | Refractor Tower | DEF | integrated shared kit | Animation-safe energy head, emitter socket and layered ceramic pylon retained and validated |
| A2 | `allied_chrono` | Displacement Ring | BLD | integrated | 39,469-triangle superweapon landmark, 17,760-triangle LOD1 and 1,848-triangle inset caster |
| A2 | `allied_weather` | Weather Control Device | BLD | integrated | 39,602-triangle collector landmark, 19,119-triangle LOD1 and 2,568-triangle inset caster |
| A2 | `allied_wall` | Wall | MOD | integrated shared kit | Seamless two-sided ceramic module with one centre spine per cell; no doubled join pillars |
| A2 | `allied_gate` | Gate | MOD | integrated shared kit | Terrain-following wall extension with animated leaves, ceramic pylons and two-sided team marking |

## Allies — 16 units

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| A3 | `allied_guardian` | Guardian Tank | VEH | procedural | Establish Allied ceramic tracked chassis and turret family |
| A3 | `allied_ifv` | Sabre IFV | VEH | procedural | Shared chassis/material; modular weapon station |
| A3 | `allied_prism` | Refractor Tank | VEH | procedural | Energy-weapon derivative; emitter pivot and VFX socket |
| A3 | `allied_harvester` | Chrono Miner | VEH | integrated | 49,825-triangle precision-shell miner, 22,416/8,968 LODs, 1,728-triangle shadow proxy and KTX2 PBR; procedural fallback retained |
| A3 | `allied_dozer` | Construction Dozer | VEH | integrated | Geometry `01a04447-7acc-7897-98f1-c91c8e32646f`, texture `01a04456-9e61-736f-a71c-50fe79999c08`; 19,305-triangle ceramic tracked construction chassis with 10,862/6,711 LODs, 2,112-triangle shadow proxy and 2.85 MiB KTX2 PBR. Deployment behavior and sockets remain procedural authority. |
| A3 | `allied_vindicator` | Petrel Bomber | AIR | integrated | Geometry `01a04441-a0bb-7eff-9e1d-baecf3410869`, texture `01a04456-934c-7875-9573-ca754895ce72`; 18,056-triangle Allied strike aircraft with 8,119/3,250 LODs, 1,416-triangle shadow proxy and 2.24 MiB KTX2 PBR. Procedural sockets and fallback remain active. |
| A3 | `allied_destroyer` | Aircraft Cruiser | NAV | integrated | Geometry `01a04dbb-ccab-734d-97c5-db4a61931754`, retexture `01a04dbd-ad27-7670-94db-6b97b00ea3bf`; 24,145-triangle ceramic aviation cruiser split into `Hull`/`Turret`, a 1,128-triangle shadow proxy and 5.42 MiB KTX2 PBR. It is fitted to a 14.0 × 4.2 × 4.4 m envelope above the 12 m Assault Destroyer. Procedural aircraft-support behavior, sockets and fallback remain authoritative; unsafe generated colour LODs are withheld. |
| A3 | `allied_gunboat` | Assault Destroyer | NAV | integrated | Geometry `01a04d87-48e9-7410-a4df-30027bc751da`, retexture `01a04d97-0ffc-72fb-b782-5a28bf7bd21f`; 23,936-triangle broad three-hull trimaran split into `Hull`/`Turret`, a 1,344-triangle shadow proxy and 5.61 MiB KTX2 PBR. Its fitted gameplay/art envelope is 12.0 × 4.0 × 3.8 m, keeping the escort clearly above the 7.2 m Hydrofoil and below the 14 m Aircraft Cruiser; selection radius and turn-rate dimensions use the same ladder. Generated colour LODs were blocked after UV-seam validation; the procedural rotating pivot and sockets remain authoritative. |
| A3 | `allied_transport` | Hover Transport | NAV | procedural | Amphibious transport and ramp/cargo clearance |
| A3 | `allied_hydrofoil` | Hydrofoil | NAV | integrated | Geometry `01a04cf5-c17a-7620-bf92-51665fe15e30`, retexture `01a04cfe-8e25-709d-9399-55480f5a9f5d`; 18,272-triangle narrow four-pad monohull with a 4.98 MiB KTX2 source and dedicated shadow proxy. Its 9.0 × 3.2 × 2.8 m fitted envelope retains the foil/pad read at RTS distance while preserving a clear step below the 12 m Assault Destroyer; unsafe generated colour LODs are not registered. |
| A3 | `allied_lighter` | Landing Craft | NAV | procedural | Transport family; ramp/cargo deck hierarchy |
| A3 | `allied_rifle` | Peacekeeper | CHAR | production | The 2,888-triangle/0.58 MiB textured LOD0 is integrated in gameplay. Runtime samples one trusted run/fire pose at load, discards the rig, and keeps the instanced `aGait` shader path proven by the standalone 512-soldier WebGPU gate. |
| A3 | `allied_javelin` | Javelin | CHAR | integrated-hybrid | Reuses the live canonical 2,888-triangle Peacekeeper body with a code-native missile pack and launcher, each hard-capped below 200 triangles. The paid unique body (`01a048df-0a39-7169-9415-df93ef821e26`) was rejected as redundant and archived outside shipping. |
| A3 | `allied_engineer` | Engineer | CHAR | integrated-hybrid | Reuses the live canonical Peacekeeper body with a code-native compact toolcase and powered wrench, each below the 200-triangle attachment ceiling. |
| A3 | `allied_marshal` | Field Marshal | CHAR | procedural | Officer variant on shared rig |
| A3 | `allied_frogman` | Frogman | CHAR | procedural | Shared rig where possible; aquatic gear variant |

## Meridian Pact — 15 structures

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| M1 | `meridian_conclave` | Conclave | BLD | validated | Multi-view geometry `01a02fc7-9ace-7e7b-8764-e0b3de1a112d`; top-down-aware ivory/teal texture correction `01a02ff3-2c91-7b7f-b701-0aa5a58daf62`; local 36,057-triangle retopo, 17,299/7,211-triangle colour LODs and 2,484-triangle caster; WebGL/WebGPU fixture validation complete |
| M1 | `meridian_solararray` | Solar Array | BLD | validated | Geometry `01a02fc7-f0a1-77ef-91a8-d1f09fba9e46`, texture `01a02fd8-9565-73d0-ac93-f91a63b39748`; 25,705-triangle twin-mirror plant with dark teal cells, two colour LODs and 2,280-triangle caster |
| M1 | `meridian_cistern` | Ore Cistern | BLD | validated | Geometry `01a02fc7-faa1-77f0-9f29-1c320d53964d`, texture `01a02fd8-a04c-73d0-b5f6-12863a8c03db`; 33,921-triangle open-process refinery preserving the dock/conveyor authority, two colour LODs and 1,884-triangle caster |
| M1 | `meridian_chapterhouse` | Chapterhouse | BLD | validated | Geometry `01a02fc8-050b-77f0-ba51-503276d67634`, texture `01a02fd8-a9be-73d7-95c7-ddc270724033`; 25,354-triangle deep-entry personnel landmark, one approved colour LOD and 1,812-triangle caster |
| M1 | `meridian_forgeyard` | Forgeyard | BLD | validated | Geometry `01a02fc8-0f16-77f0-8af9-14367897abf8`, texture `01a02fd8-b4fc-73dc-a264-4356d7ea628e`; 37,381-triangle teal-mirror factory with unobstructed vehicle bay, two colour LODs and 2,184-triangle caster |
| M2 | `meridian_oculus` | Oculus | BLD | validated | Geometry `01a0300d-2dff-73c8-a65b-a76417174a67`, texture `01a03017-f22b-7588-ba5c-85b10b1d7d15`; locally reduced and UV-authored, then split and sealed at the generated crown pivot; 23,704 triangles across `Body` and animated `Aperture`, KTX2 PBR and full moving-assembly shadows |
| M2 | `meridian_pharos` | Pharos | BLD | validated | Geometry `01a0300d-39f1-7407-8b36-9748b675dd0f`, texture `01a03017-fe9d-758a-8505-e4b03c6f0dda`; 18,958-triangle command lighthouse, 9,098/3,790-triangle colour LODs and 2,364-triangle caster |
| M2 | `meridian_reliquary` | Reliquary | BLD | validated | Geometry `01a0300d-45e3-740a-9d36-31ed693b8d27`, texture `01a03018-097b-749e-ae49-6a1cee1f1429`; 24,748-triangle suspended teal lens landmark, 11,879/6,012-triangle colour LODs and 2,952-triangle caster |
| M2 | `meridian_depot` | Solar Infirmary | BLD | validated | Geometry `01a0300d-5182-7416-830a-5334cc3ff852`, texture `01a03018-14c3-74a0-86c8-f7cf56954255`; 25,814-triangle open drive-on service deck, 12,389/5,162-triangle colour LODs and 2,160-triangle caster; repair and dock sockets remain authoritative |
| M2 | `meridian_slipway` | Slipway | BLD | validated | Geometry `01a0300d-5d16-799a-be0f-98932d3247b7`, texture `01a03018-20cd-7557-a3df-4623d7903b52`; 32,550-triangle naval factory preserving the wide launch channel, 15,624/7,778-triangle colour LODs and 1,356-triangle caster |
| M3 | `meridian_vault` | Sun Vault | BLD | validated | Geometry `01a03039-e296-79b3-aa45-44c49517b796`, texture `01a03047-40f8-7b7c-af89-4678256520bc`; 13,674-triangle compact storage shell, KTX2 PBR and 2,712-triangle caster |
| M3 | `meridian_glaive` | Glaive Post | DEF | validated | Replacement geometry `01a030a7-966e-7aa0-a1df-bd473b6d3e8d` preserves the locked single fixed barrel and deep casemate recess; texture `01a030ab-4b47-7270-9ccb-a48bbebee2c7`; local 12,786-triangle retopo, 6,136/2,594-triangle colour LODs, 2,676-triangle caster and KTX2 PBR. The procedural model remains the load-failure fallback. |
| M3 | `meridian_helios` | Helios Spire | DEF | validated | Geometry `01a03039-fdb0-78d3-96d7-c0e015b41c0f`, texture `01a03047-4cf8-7a3f-8c05-7c90c3b47fa2`; 13,944 triangles split and sealed into runtime `Body`/`Head`, KTX2 PBR and full articulated shadows |
| M3 | `meridian_rampart` | Rampart | MOD | validated | Geometry `01a0303a-0bde-78d5-83e6-52c9a417815c`, texture `01a03047-5950-7a40-b683-f5325e078043`; seamless 7,899-triangle one-cell wall with no duplicate pad and a 912-triangle caster |
| M3 | `meridian_heliograph` | Heliograph | BLD | validated | Geometry `01a0303a-1961-7eb4-b239-b1ae3c7704c4`, texture `01a03047-644a-7b7e-add3-06b920a0825f`; 35,413-triangle hero dish, 16,997/8,562-triangle colour LODs and 2,640-triangle caster |

## Meridian Pact — 16 units

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| M3 | `meridian_solarch` | Solarch | VEH | procedural | Establish elegant solar ground-hull material family |
| M3 | `meridian_skiff` | Sandskiff | VEH | procedural | Fast skimmer derivative and hover silhouette |
| M3 | `meridian_zenith` | Zenith Emitter | VEH | procedural | Energy weapon platform with emitter pivot |
| M3 | `meridian_collector` | Sun Collector | VEH | integrated | 49,837-triangle true-hover collector, 22,425/8,968 LODs, 1,656-triangle shadow proxy and KTX2 PBR; private-registry fallback retained |
| M3 | `meridian_carryall` | Pactworks Carryall | VEH | integrated | Geometry `01a04447-9298-7ca7-8f6a-2d247de21a7f`, texture `01a04456-b6c4-7380-ac1f-24aa47718037`; 19,594-triangle ivory/teal construction carrier with 8,817/4,943 LODs, 1,680-triangle shadow proxy and 3.03 MiB KTX2 PBR. Private-registry loading keeps its procedural deploy cues and fallback. |
| M3 | `meridian_kestrel` | Kestrel Gunship | AIR | integrated | Geometry `01a04447-b377-7cb9-9b99-61f115d2f35f`, texture `01a04456-d97f-79eb-9780-48006a92104e`; 19,360-triangle solar gunship with 8,710/3,484 LODs, 1,080-triangle shadow proxy and 2.92 MiB KTX2 PBR. Private-registry loading retains procedural sockets and fallback. |
| M3 | `meridian_corvette` | Kite Corvette | NAV | integrated | Geometry `01a04d87-4b38-75bb-b9e7-4857b4793db8`, retexture `01a04d97-126c-7651-bab5-24cfcd86c025`; 24,650-triangle broad kite/manta warship split into `Hull`/`Turret`, a 1,464-triangle shadow proxy and 5.99 MiB KTX2 PBR. Its broad closed-wing planform is intentionally unlike the previous crescent/open-jaw Sun Cutter. Generated colour LODs failed the UV-seam gate and are not registered; procedural battery pivot and sockets remain authoritative. |
| M3 | `meridian_monitor` | Sunmonitor | NAV | integrated | Geometry `01a04dbb-ce9a-7135-92ea-edd7057f419c`, successful retexture retry `01a04dc0-a355-7346-8666-f65eb5e14a40`; 23,611-triangle solar capital ship split into `Hull`/`Turret`, a 708-triangle shadow proxy and 5.84 MiB KTX2 PBR. The first retexture attempt `01a04dbd-af12-740b-a864-3d58396f9e32` failed without consuming credit. Runtime fits the ship to 15.0 × 4.6 × 4.4 m and retains procedural combat/socket authority; generated colour LODs remain blocked. |
| M3 | `meridian_cutter` | Sun Cutter | NAV | integrated | Geometry `01a04cf5-c28d-7435-99fd-d5c5eb1b2fb0`, retexture `01a04cfe-8f49-71de-b536-14d8b9fa2463`; 18,287-triangle crescent/open-jaw fast hull with a 4.73 MiB KTX2 source and dedicated shadow proxy. Its fitted recon envelope is 9.2 × 3.3 × 2.8 m; unsafe generated colour LODs are withheld. |
| M3 | `meridian_lighter` | Sun Lighter | NAV | procedural | Transport/ramp derivative |
| M3 | `meridian_argosy` | Argosy | NAV | procedural | Heavy transport; deck/ramp hierarchy |
| M3 | `meridian_wayfarer` | Wayfarer | CHAR | production | The 5,937-triangle textured LOD0 is integrated in gameplay through the load-time pose bake and instanced shader-gait path; the rig and clips remain shared Asset Lab sources, not per-entity runtime objects. |
| M3 | `meridian_lancer` | Sunlancer | CHAR | integrated-hybrid | Reuses the live canonical 5,937-triangle Wayfarer body with a code-native solar-cell pack and lance, each hard-capped below 200 triangles. The paid unique body (`01a048df-1613-70e0-9cb1-7e74f5185a0f`) was rejected as redundant and archived outside shipping. |
| M3 | `meridian_artificer` | Artificer | CHAR | integrated-hybrid | Reuses the live canonical Wayfarer body with a code-native instrument case and calibrator, each below the 200-triangle attachment ceiling. |
| M3 | `meridian_hierarch` | Hierarch | CHAR | procedural | Officer variant on shared rig |
| M3 | `meridian_tidewalker` | Tidewalker | CHAR | procedural | Shared rig where possible; aquatic equipment |

## The Reclamation — 15 structures

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| R1 | `reclaim_foundry` | Foundry | BLD | validated | Geometry `01a030b7-1243-718a-b282-ad2283cd3b38`, texture `01a030b8-8d03-735a-b918-6ee4112e1538`, hard-surface retopo `01a030df-d807-71fe-afe7-38f6c9c516ac`; 195,311-triangle crisp close shell and 1,980-triangle caster with KTX2 PBR. Its colour LODs are quarantined after a live WebGPU presentation failure; the approved retopo stays active at all distances. Procedural Foundry remains the load-failure fallback. |
| R1 | `reclaim_furnace` | Scrap Furnace | BLD | validated | Geometry `01a030c8-0166-7546-adc0-c4cb62663b10`, texture `01a030ca-cfc9-705e-ad4d-c183c905a645`, hard-surface retopo `01a030e5-766b-7bd1-9c8a-49f0f91ff6d0`; 96,806-triangle compact furnace and 2,028-triangle caster with KTX2 PBR. Its colour LODs remain quarantined pending a replacement desktop proof. Procedural furnace remains the load-failure fallback. |
| R1 | `reclaim_sorter` | Ore Sorter | BLD | validated | Geometry `01a030c8-0b48-7b4e-a097-a935cf1e527a`, texture `01a030ca-d850-705f-a9d7-01c52b3c8fd8`, hard-surface retopo `01a030e5-7ab0-72fc-9681-302c1918d441`; 126,532-triangle refinery and 1,956-triangle caster with KTX2 PBR. Its colour LOD remains quarantined pending a replacement desktop proof. Procedural sorter remains the load-failure fallback. |
| R1 | `reclaim_rookery` | Rookery | BLD | validated | Geometry `01a03120-e719-7907-bd9e-f8814c756f01`, remesh `01a03123-dab7-7f0c-bd35-c9698fa86d10`, texture `01a03126-ac0a-70f3-a929-0f4ae3e1a146`; 24,158-triangle hard-surface barracks, 11,595-triangle reviewed LOD1, 2,628-triangle caster and KTX2 PBR. |
| R1 | `reclaim_breakeryard` | Breaker Yard | BLD | validated | Geometry `01a03120-e7a4-7fdc-b1f0-abfe6713be64`, remesh `01a03123-dacc-7986-a8ef-ec50b916d7cd`, texture `01a03126-ac0e-7ffe-9f61-87f61b80fbf7`; 36,017-triangle vehicle factory, 17,829-triangle reviewed LOD1, 2,844-triangle caster and KTX2 PBR. |
| R1 | `reclaim_spotter` | Spotter Mast | BLD | validated | Geometry `01a03120-e7d8-7e57-8e5f-93259061c0b4`, remesh `01a03123-dabc-7874-8561-4a949062e787`, texture `01a03126-ac08-792a-b3a5-28a3dec89763`; 17,309-triangle phased-array radar, 8,494-triangle reviewed LOD1, 2,592-triangle caster and KTX2 PBR. |
| R2 | `reclaim_signalrig` | Signal Rig | BLD | validated | Meshy geometry `01a03134-9fa9-7bde-a65b-0be1390eb7d6`; 26,236-triangle horn-and-drum silhouette, approved LOD1 and KTX2 |
| R2 | `reclaim_crucible` | Crucible | BLD | validated | Meshy geometry `01a03131-2362-71fd-8696-a3fd6aa9218c`; 31,746-triangle open energy vessel, approved LOD1 and KTX2 |
| R2 | `reclaim_depot` | Patch Yard | BLD | validated | Meshy geometry `01a03131-235e-71fd-843e-e710599843dc`; 21,703-triangle service bay, approved LOD1 and KTX2 |
| R2 | `reclaim_drydock` | Breaker Dock | BLD | validated | Meshy geometry `01a03144-b4c9-7695-9733-127e0eb859c4`; 35,868-triangle shear-leg dock, approved LOD1 and KTX2 |
| R2 | `reclaim_heap` | Slag Heap | BLD | validated | Meshy geometry `01a03144-b516-7cd0-845a-1c54081cf487`; 21,957-triangle open crib, KTX2; colour LOD blocked to protect silhouette |
| R2 | `reclaim_spitpost` | Spitpost | DEF | validated | Meshy geometry `01a03144-b514-70b0-bafc-ae37e333edcc`; 18,009-triangle fixed casemate, KTX2; colour LOD blocked to protect firing throat |
| R2 | `reclaim_pylon` | Arc Pylon | DEF | validated | Meshy geometry `01a0314e-b329-71d5-8375-7c2dfa70348e`; 24,552-triangle fixed broken-ring emitter, KTX2; colour LOD blocked |
| R2 | `reclaim_barricade` | Scrap Barricade | MOD | validated | Meshy geometry `01a0314e-b322-72bc-9953-cc7fb393d6a6`; 7,417-triangle tileable wall, KTX2, no colour LOD required |
| R2 | `reclaim_stormworks` | Stormworks | BLD | validated | Meshy geometry `01a0314e-b31f-710e-b55f-510451b52eb6`; 42,464-triangle superweapon landmark, KTX2; colour LOD blocked |

## The Reclamation — 15 units

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| R3 | `reclaim_grinder` | Grinder | VEH | procedural | Establish asymmetrical scrap chassis/material family |
| R3 | `reclaim_spitter` | Arcspitter | VEH | procedural | Shared chassis; energy weapon pivot/socket |
| R3 | `reclaim_slaghurler` | Slaghurler | VEH | procedural | Shared chassis; artillery mechanism |
| R3 | `reclaim_scrapper` | Scrapjaw | VEH | integrated | 44,402-triangle open-frame crusher, 19,913/12,267 LODs, 1,104-triangle shadow proxy and KTX2 PBR; private-registry fallback retained |
| R3 | `reclaim_crawler` | Yardcrawler | VEH | integrated | Geometry `01a04447-9d30-71b1-81c1-565a961eb744`, texture `01a04456-c1bd-7382-80a2-3c043e87ef33`; 43,232-triangle open-frame construction hero with 23,700/15,116 LODs, 2,472-triangle shadow proxy and 4.01 MiB KTX2 PBR. Paid remesh `01a04453-209c-78b5-ac46-b8086b0ad1ca` was rejected for changing and over-smoothing the salvage machinery; the reviewed local reduction ships. Private-registry fallback retains deployment behavior. |
| R3 | `reclaim_hornet` | Swarmhornet | AIR | integrated | V1 geometry `01a04447-be66-78b8-a1ed-76ffe03c655a` / texture `01a04456-e53f-7fe2-8a32-420e0eb5c8fa` was rejected after the live art gate exposed folded surfaces, self-intersections and malformed fan ducts; every V1 runtime binary was removed. V2 geometry `01a0448a-33fb-7d12-a912-52e9c04799f5` and texture `01a04490-df81-76d3-b463-f7382d144820` use coherent top/front/side/rear references and ship as one clean 19,775-triangle hull with exactly two enclosed fans, 8,895/3,558 LODs, a 1,728-triangle shadow proxy and 2.83 MiB KTX2 PBR. Procedural sockets and fallback remain active. |
| R3 | `reclaim_scow` | Slag Scow | NAV | integrated | V1 geometry `01a04d87-4c72-72d4-9d3b-9ac423dc1710` was rejected for ambiguous multi-barrel bow clutter. V2 geometry `01a04d95-fef0-7207-9d39-202820f950f7` and retexture `01a04d9b-a5f3-76d6-90f2-33c4c5437673` ship as a 23,182-triangle slab-sided salvage scow with one deterministic 192-triangle central fixed cannon, 10,423/4,202-triangle reviewed LODs, a 1,500-triangle shadow proxy and 3.36 MiB KTX2 PBR. Procedural firing socket remains authoritative. |
| R3 | `reclaim_hulk` | Reclaimed Hulk | NAV | integrated | The cluttered V1 (`01a04dbb-cfb6-7063-ac11-e830b9f3d523`, retexture `01a04dbd-b002-747f-a447-43ebc89fa753`, remesh `01a04dc6-62f6-72eb-a17b-aea1953725b1`) was rejected and never entered runtime. Clean V2 geometry `01a04ddd-5eba-7264-899e-8b2eb0ef60a3` and retexture `01a04ddf-b137-7468-a079-d7e5a77726c5` ship as a 24,692-triangle closed salvage barge split into `Hull`/`Turret`, with a 1,932-triangle shadow proxy and 5.23 MiB KTX2 PBR. Runtime fits it to 15.0 × 4.8 × 4.4 m and retains procedural behavior/socket authority; generated colour LODs are withheld. |
| R3 | `reclaim_skimmer` | Scrap Skimmer | NAV | integrated | Geometry `01a04cf5-c549-73d1-90e7-778dc720049d`, retexture `01a04cfe-9185-7099-800a-a532a759db85`; 16,560-triangle compact fast salvage hull with a 2.59 MiB single-sided KTX2 source and dedicated shadow proxy. It is fitted to a 9.0 × 3.4 × 2.8 m recon envelope; the procedural fixed weapon socket remains authoritative. |
| R3 | `reclaim_hauler` | Slag Hauler | NAV | procedural | Heavy transport/ramp hierarchy |
| R3 | `reclaim_picker` | Scrap Picker | CHAR | production | The accepted 8,501-triangle textured LOD0 is integrated in gameplay through the load-time pose bake and instanced shader-gait path; the rig and clips remain shared Asset Lab sources, not per-entity runtime objects. |
| R3 | `reclaim_slagger` | Slagger | CHAR | integrated-hybrid | Reuses the live canonical Scrap Picker body with a code-native hopper and slag projector, each hard-capped below 200 triangles. The paid unique body (`01a048df-22ce-716f-8e42-86317a535ba9`) was rejected as redundant and archived outside shipping. |
| R3 | `reclaim_tinker` | Tinker | CHAR | integrated-hybrid | Reuses the live canonical Scrap Picker body with a code-native tool roll and salvage cutter, each below the 200-triangle attachment ceiling. |
| R3 | `reclaim_baron` | Scrap Baron | CHAR | procedural | Officer variant on shared rig |
| R3 | `reclaim_dredger` | Dredger | CHAR | procedural | Shared rig where possible; aquatic equipment |

## Neutral capturable structures — 4 structures

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| N1 | `civ_derrick` | Oil Derrick | BLD | validated | Geometry `01a03e6b-f287-70ec-84a0-a2b567e4943b`, 20k retopo `01a03e71-cda0-72f7-aa35-f42cf6e74c9a`, texture `01a03e7b-b3f1-76b9-b7cb-72ec959f2af5`; 19,673-triangle pumpjack landmark, 2,880-triangle caster and KTX2 PBR. Auto colour LOD was visually rejected and quarantined; procedural fallback retained. |
| N1 | `civ_hospital` | Civilian Hospital | BLD | validated | Geometry `01a03e6d-be61-7b25-a21d-b96285c5dca5`, texture `01a03e7d-7160-771f-86f2-3a91c63a2b98`; conservative local hard-surface reduction to 39,291 triangles, 2,112-triangle caster and KTX2 PBR. The 17k Meshy retopo and generated colour LOD were rejected for window holes/faceting; procedural fallback retained. |
| N1 | `civ_apartments` | Apartment Block | BLD | validated | Geometry `01a03eab-d27f-7ece-baf9-7caa397bc084`, texture `01a03eb7-ad43-7b59-bd6f-e708b6e0744e`; conservative local hard-surface reduction to 33,363 shipping triangles, reviewed 14,981-triangle LOD1, 2,112-triangle caster and KTX2 PBR. The paid 33k Meshy remesh was rejected for rounding the facade and collapsing balcony recesses; the stricter automatic LOD2 remains blocked and is not referenced. Procedural fallback retained. |
| N1 | `civ_mine` | Ore Mine | BLD | integrated | Geometry `01a0405e-c3c4-7553-a1cc-910c52928425`, remesh `01a04064-fca5-7f23-8910-2a914744cf99`, texture `01a04067-7c98-7b40-9624-6df71607c93a`; 22,073-triangle A-frame headhouse with twin winding drums, reviewed 16,438-triangle LOD1, 1,812-triangle caster and KTX2 PBR. The procedural shell is now fallback/socket authority only. |

## Neutral environment props

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| P1 | `carSedan` | Civilian Sedan | PROP | integration candidate | Meshy multi-view source `01a03d71-9a34-7f70-a29d-07e289471f78`; separate-body/four-wheel retopo; locally conditioned 2,963-triangle LOD0; 1K/512px PBR maps promoted to a 0.62 MiB KTX2 GLB; procedural fallback retained until instancing, LOD1, shadow, renderer and scene-budget gates pass |
| P1 | `oreCluster` | Ore Crystal Cluster | PROP | integrated | Code-native hard-faceted five-shard cluster with a buried two-mass mineral foot, terrain-normal alignment and baked footing AO. One shared instanced colour draw plus one instanced shadow submission; no texture allocation or generation credits, and depletion scaling/regrowth remain unchanged. |

## Throughput and memory strategy

The map is intentionally family-first, not 135 isolated purchases:

- Create one faction material/trim language before its roster: shared steel/ceramic/scrap/solar surfaces, team-colour mask convention, emissive convention, decals, damage overlays.
- Generate one hero anchor to validate a family, then two related assets in a batch. Do not queue a whole faction before reviewing in-game silhouettes.
- Vehicles reuse chassis and wheel/track/material families where the fiction supports it; infantry reuse one rig and animation set per humanoid faction.
- Walls, gates, and repeated modules stay hybrid and instanced unless an imported kit proves cheaper in draw calls and memory.
- KTX2/Basis compression, automatic LOD generation and bounded load/caching telemetry are now live for the Soviet pilot group; reuse those gates before converting another faction.
- The acceptance benchmark is not an empty showcase. Measure dense bases and large armies under the actual camera in both renderers.

## Pilot facts

`soviet_power` remains one 15,025-triangle mesh/material with 2K base, 2K source normal and 1K packed metal/roughness maps. Its approved conventional source is 3.44 MiB and roughly 48 MiB decoded with mipmaps; the shipping KTX2 GLB is 2.63 MiB and conservatively 8 MiB resident on an 8bpp desktop target. The geometry is comfortably below the standard-building visual-LOD threshold, and the measured texture promotion is now the baseline for later factions.
