# VOLTMARCH Art Direction V2

Status: approved direction, implementation authority for units and structures.

This document supersedes the unit/structure styling targets in
`VISUAL_DNA.md` and `RA3_LOOK_BIBLE.md` where they prescribe a deliberately
retro, faceted, or texture-led result. Those documents remain authoritative for
camera, terrain, UI, and any measured constraint that does not conflict with
this one.

The game remains procedural. V2 changes the grammar that generates the art; it
does not replace code-built meshes with downloaded models or textures.

## 1. Read order

At normal gameplay distance an asset must communicate in this order:

1. gameplay class;
2. faction;
3. individual identity;
4. surface detail.

If panel lines or greeble are visible before the class silhouette, the asset is
too busy. If removing colour makes the faction unknowable, the asset is a
palette swap and fails.

## 2. The five-layer model

Every asset is authored through the same five conceptual layers:

1. **Gameplay skeleton** — bounds, footprint, locomotion, weapon and effect
   sockets, turret rules, collision, and selection radius. Art may not change
   gameplay.
2. **Faction grammar** — construction method, profile family, negative space,
   material family, edge treatment, and motion character.
3. **Role grammar** — the shared clues that make a refinery read as a refinery
   and an anti-air platform read as anti-air across all four armies.
4. **Signature assembly** — one dominant feature and at most two supporting
   features unique to the asset. A repeated shell with a different roof prop
   is not an individual design.
5. **Distance grammar** — silhouette at blob distance, material blocks at
   gameplay distance, and tertiary hardware only in close views and cameos.

## 3. Faction construction languages

### Allies — precision aerospace

- Symmetrical, forward-swept silhouettes and continuous integrated shells.
- White ceramic armour over a visible graphite substructure.
- Cobalt optical surfaces and narrow cyan energy channels.
- Track and wheel hardware is shrouded rather than exposed.
- Buildings are low, composed campuses with one deliberate vertical command
  feature; never stacks of interchangeable white boxes.
- Motion is precise, damped and clean. Deployment panels align exactly.

### Soviets — industrial dominion

- Broad, grounded stance; cast and forged volumes rather than slab stacks.
- Olive armour, gunmetal machinery, restrained crimson identity panels and
  furnace-orange heat.
- External pressure vessels, protected joints, exhausts and load-bearing
  gantries are part of the silhouette.
- Buildings break their mass with tanks, arches, stacks and working machinery;
  a plain rectangular factory is a fail.
- Motion communicates weight: suspension compression, piston travel, recoil,
  exhaust and mechanical inertia.

### Meridian Pact — solar levitation

- No vehicle touches the ground. A visible shadow gap is mandatory.
- Hexagonal, crescent and corbelled plan language with suspended layers and
  deliberate negative space.
- Warm bone ceramic, deep jade glass and brushed-gold collectors.
- Mirror sails, collector rings and light bridges replace conventional
  exhausts, tracks and cranes.
- Buildings rise as balanced solar instruments, not decorated boxes.
- Motion is continuous: hover drift, counter-rotation and smooth deployment.

### Reclamation — weaponised salvage

- Open, asymmetric load-bearing frames with armour hung from them.
- Oxide graphite structure, mismatched warm metals, violet arc systems and
  hazard amber.
- Vehicles use visible outboard suspension or improvised lift hardware.
- Fixed casemate weapons and offset coils preserve the faction's mechanical
  doctrine; symmetry outside load-bearing pairs is a fail.
- Buildings are irregular working scaffolds with cranes, bridges and exposed
  process equipment, not random junk piles.
- Motion is articulated and imperfect but intentional: suspension travel,
  cable movement, rough deployment and unstable arc energy.

## 4. Colour is not faction geometry

Faction determines base materials and emissive language. Player identity uses
a separate team-colour channel occupying 5-8% of a vehicle and 3-6% of a
building, placed on camera-visible edge panels. Whole-hull tinting is banned.

The faction must still be recognisable with team colour disabled and with the
image converted to greyscale.

## 5. Surface hierarchy

- At least 65% of the visible area is quiet macro material.
- Secondary breaks occupy 20-30%: armour overlaps, glass, machinery and strong
  seams that change the silhouette or explain construction.
- Tertiary marks occupy at most 10% at gameplay LOD.
- Procedural noise may perturb roughness subtly; it may not draw a uniform
  panel carpet over every surface.
- Wear belongs at edges, joints, tracks, exhausts, service doors and impact
  zones. Random full-surface grime is banned.
- Emissive masks are narrow functional elements. Bloom may not erase the mask's
  internal shape.
- White ceramic must retain highlight detail. No broad region may grade to
  featureless white.

## 6. Silhouette and repetition rules

- Each asset has one dominant feature occupying roughly 25-45% of its projected
  silhouette and at most two supporting features.
- Infantry, light vehicles, armour, support vehicles and buildings keep
  non-overlapping size bands.
- Repeated faction modules are allowed only when their repetition expresses
  manufacturing language. They may not define the complete outer silhouette.
- Production structures in the same faction must have different rooflines and
  different dominant axes.
- Empty space is geometry. Hover gaps, wheel wells, gantries, arches and open
  frames are preferred over texture used to imply depth.

## 7. Runtime contract

- Preserve the existing entity definitions, bounds, sockets and deterministic
  simulation.
- Preserve batched rendering and procedural cameos.
- No per-instance material creation.
- New detail must ship with distance reduction. Large armies may not pay cameo
  geometry cost.
- The medium quality tier may regress GPU frame time by at most 10% in the
  canonical blob fixture, and normal-play draw calls may not increase.
- A V2 asset needs gameplay, greyscale, blob-distance and cameo captures before
  it replaces its predecessor.

## 8. Vertical-slice gate

The first implementation slice contains one line infantry unit, one main combat
vehicle and one production structure per faction. The twelve assets are judged
together under the same camera and light.

The slice passes only when:

- all four factions are distinguishable in greyscale;
- all three gameplay classes are immediately legible;
- no structure looks like a recoloured sibling;
- the vehicle silhouettes remain separate in a mixed formation;
- materials retain detail under noon and dusk lighting;
- the performance contract above holds.

Only then is the grammar propagated through the rest of the roster.
