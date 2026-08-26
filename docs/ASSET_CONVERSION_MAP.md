# VOLTMARCH asset conversion map

This is the production map for replacing or selectively upgrading the procedural troop, vehicle, naval, aircraft, and building roster. It covers **135 authored gameplay assets: 65 units and 70 structures**. Wrecks, LODs, shadow proxies, construction states, and UI renders are derived deliverables and do not buy a separate Meshy generation.

The procedural roster remains the live fallback until each imported asset reaches `validated`.

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
| S3 | `soviet_harvester` | Ore Collector | VEH | procedural | Industrial chassis; ore load/readability and unload socket |
| S3 | `soviet_dozer` | Sputnik Dozer | VEH | procedural | Utility chassis; construction/deploy cues |
| S3 | `soviet_mig` | Interceptor | AIR | procedural | Soviet air material family; preserve sharp delta silhouette |
| S3 | `soviet_dreadnought` | Dreadnought | NAV | procedural | Capital vessel; mandatory LODs and multiple weapon pivots |
| S3 | `soviet_sub` | Submarine | NAV | procedural | Submerged/readability contract and weapon socket |
| S3 | `soviet_transport` | Hover Transport | NAV | procedural | Amphibious transport; ramp/cargo clearance |
| S3 | `soviet_picket` | Picket Boat | NAV | procedural | Small shared naval material; bow weapon pivot |
| S3 | `soviet_lighter` | Assault Barge | NAV | procedural | Heavy transport; ramp and cargo deck hierarchy |
| S3 | `soviet_conscript` | Conscript | CHAR | procedural | Establish Soviet greatcoat rig/material family |
| S3 | `soviet_flak` | Flak Trooper | CHAR | procedural | Shared rig; launcher silhouette and backpack |
| S3 | `soviet_engineer` | Combat Engineer | CHAR | procedural | Shared rig; tool/case loadout |
| S3 | `soviet_commissar` | War Commissar | CHAR | procedural | Officer variant; shared rig with unique head/coat cues |
| S3 | `soviet_dog` | Attack Dog | CHAR | procedural | Separate quadruped rig and animation set |
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
| A2 | `allied_silo` | Ore Silo | BLD | integrated shared kit | Small faction-atlas storage module retained and audited; hopper/dock sockets preserved without a unique texture allocation |
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
| A3 | `allied_harvester` | Chrono Miner | VEH | procedural | Industrial collector variant with unload/chrono cues |
| A3 | `allied_dozer` | Construction Dozer | VEH | procedural | Utility chassis and construction equipment |
| A3 | `allied_vindicator` | Petrel Bomber | AIR | procedural | Establish Allied aerospace material and silhouette family |
| A3 | `allied_destroyer` | Aircraft Cruiser | NAV | procedural | Capital vessel; mandatory LODs and air-support silhouette |
| A3 | `allied_gunboat` | Assault Destroyer | NAV | procedural | Combat hull family and weapon pivots |
| A3 | `allied_transport` | Hover Transport | NAV | procedural | Amphibious transport and ramp/cargo clearance |
| A3 | `allied_hydrofoil` | Hydrofoil | NAV | procedural | Lightweight fast hull; foil readability at RTS distance |
| A3 | `allied_lighter` | Landing Craft | NAV | procedural | Transport family; ramp/cargo deck hierarchy |
| A3 | `allied_rifle` | Peacekeeper | CHAR | procedural | Establish Allied plated humanoid rig/material family |
| A3 | `allied_javelin` | Javelin | CHAR | procedural | Shared rig; launcher/backpack loadout |
| A3 | `allied_engineer` | Engineer | CHAR | procedural | Shared rig; tool/case loadout |
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
| M3 | `meridian_collector` | Sun Collector | VEH | procedural | Resource collector variant and unload socket |
| M3 | `meridian_carryall` | Pactworks Carryall | VEH | procedural | Heavy utility/transport derivative |
| M3 | `meridian_kestrel` | Kestrel Gunship | AIR | procedural | Establish Pact aerospace family and weapon sockets |
| M3 | `meridian_corvette` | Kite Corvette | NAV | procedural | Light naval hull family and battery pivots |
| M3 | `meridian_monitor` | Sunmonitor | NAV | procedural | Heavy naval hero derivative; mandatory LODs |
| M3 | `meridian_cutter` | Sun Cutter | NAV | procedural | Compact fast naval derivative |
| M3 | `meridian_lighter` | Sun Lighter | NAV | procedural | Transport/ramp derivative |
| M3 | `meridian_argosy` | Argosy | NAV | procedural | Heavy transport; deck/ramp hierarchy |
| M3 | `meridian_wayfarer` | Wayfarer | CHAR | procedural | Establish Pact robed/solar humanoid rig and material family |
| M3 | `meridian_lancer` | Sunlancer | CHAR | procedural | Shared rig; lance/cell loadout |
| M3 | `meridian_artificer` | Artificer | CHAR | procedural | Shared rig; tool/kit loadout |
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
| R3 | `reclaim_scrapper` | Scrapjaw | VEH | procedural | Aggressive close-combat chassis derivative |
| R3 | `reclaim_crawler` | Yardcrawler | VEH | procedural | Heavy utility/deploying chassis; mandatory moving hierarchy |
| R3 | `reclaim_hornet` | Swarmhornet | AIR | procedural | Establish salvaged aircraft family and weapon sockets |
| R3 | `reclaim_scow` | Slag Scow | NAV | procedural | Light scrap vessel and bow weapon pivot |
| R3 | `reclaim_hulk` | Reclaimed Hulk | NAV | procedural | Heavy capital salvage vessel; mandatory LODs |
| R3 | `reclaim_skimmer` | Scrap Skimmer | NAV | procedural | Compact fast naval derivative |
| R3 | `reclaim_hauler` | Slag Hauler | NAV | procedural | Heavy transport/ramp hierarchy |
| R3 | `reclaim_picker` | Scrap Picker | CHAR | procedural | Establish scavenger humanoid rig/material family |
| R3 | `reclaim_slagger` | Slagger | CHAR | procedural | Shared rig; satchel/hopper loadout |
| R3 | `reclaim_tinker` | Tinker | CHAR | procedural | Shared rig; tool/roll loadout |
| R3 | `reclaim_baron` | Scrap Baron | CHAR | procedural | Officer variant on shared rig |
| R3 | `reclaim_dredger` | Dredger | CHAR | procedural | Shared rig where possible; aquatic equipment |

## Neutral capturable structures — 4 structures

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| N1 | `civ_derrick` | Oil Derrick | BLD | procedural | Neutral industrial kit; readable capturable landmark |
| N1 | `civ_hospital` | Civilian Hospital | BLD | procedural | Civil architecture kit; portico/helipad identity |
| N1 | `civ_apartments` | Apartment Block | BLD | procedural | Civil modular facade/balcony kit; repeated-instance efficiency |
| N1 | `civ_mine` | Ore Mine | BLD | procedural | Neutral industrial kit; headframe/sheave/spoil silhouette |

## Neutral environment props

| Wave | Key | Asset | Route | Current state | Family plan |
| --- | --- | --- | --- | --- | --- |
| P1 | `carSedan` | Civilian Sedan | PROP | integration candidate | Meshy multi-view source `01a03d71-9a34-7f70-a29d-07e289471f78`; separate-body/four-wheel retopo; locally conditioned 2,963-triangle LOD0; 1K/512px PBR maps promoted to a 0.62 MiB KTX2 GLB; procedural fallback retained until instancing, LOD1, shadow, renderer and scene-budget gates pass |

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
