# RA3 LOOK BIBLE — VOLTMARCH
### The single authoritative visual spec for VOLTMARCH's Three.js renderer

> **On the title.** This document is named for its *reference*, not for the product. VOLTMARCH is
> an original game; Command & Conquer: Red Alert 3 is the shipped title whose frames we measure
> ourselves against, because "make it look good" is not a spec and "match this histogram" is.
> Every RA3 citation below is a measurement target. None of them describe what VOLTMARCH *is*.
**Status: AUTHORITATIVE. Where this document contradicts an analyst report, this document wins.**
**Version 1.0 — Art Director's cut**

---

## 0. THE THESIS — WHAT WE ARE ACTUALLY BUILDING

> **Red Alert 3 is a dark, high-contrast diorama of clean painted plastic toys, oversized by 2×,
> lit by one warm low sun and one blue sky, with screaming saturated accents and effects that
> clip to pure white.**

Four properties carry 80% of the identity. If a critic sees these four, we pass. If any one is
missing, no amount of polish elsewhere saves us:

1. **The frame is DARK and the accents SCREAM.** Median frame luminance **0.317**, 50% of pixels
   below 0.32, mean HSV saturation **0.512** (≈1.8× photoreal). Not "moody" — *contrasty*.
2. **Units are toys.** Chamfered convex blobs, 3–5 masses, zero dirt, a bevel highlight on every
   edge, a tank hull that is **half the footprint of a war factory**.
3. **Perspective, not isometric.** Ground-grid screen angle sweeps **±20.5° at the top row to
   ±39.7° at the bottom**; an identical unit is **2.0× bigger** at the bottom of frame than at the top.
4. **No sky, no fog, no haze.** Terrain fills 100% of the world layer in **0 of 14** reference
   frames. Distant pixels are *more* saturated than near ones.

And the one-line negative: **we are engineering against "generic mobile RTS"** — a bright, flat,
grey-green, evenly-lit plane with small realistic units and a soft veil bloom. Every number below
exists to push away from that.

---

## 1. RESOLVED CONFLICTS — THE ART DIRECTOR'S RULINGS

The five analysts disagree in nine places. These are the decided numbers. Do not re-litigate them
in code.

| # | Conflict | Analyst A | Analyst B | **RULING** | Why |
|---|---|---|---|---|---|
| 1 | Camera pitch | Camera: 38–40° | Environment: 44–48° | **39.0°** | The camera analyst fitted 7 images by vanishing-point/edge-orientation with stated residuals; the environment estimate was eyeballed off foreshortening. |
| 2 | Visible ground width | Camera: 86 m centre-row | Environment: 110–125 m | **86 m at default zoom (height 50 m); 124 m at max zoom (72 m)** | Both are right — the env analyst was reading zoomed-out frames. Our default zoom is the tighter one; RA3's marketing shots are tighter still. |
| 3 | Painted-hull roughness | Lighting: 0.32–0.42 (tight lobe on red armour) | Materials: 0.55–0.68 (broad lobe on white hull) | **base roughness 0.52 + clearcoat 0.30 @ clearcoatRoughness 0.38** | Both measurements are true of the *same* surface: a broad diffuse lobe under a weak tight clear coat. `MeshPhysicalMaterial` reproduces both. This is the single most important material ruling. |
| 4 | Bloom radius | Lighting: 0.45 | VFX: 0.32 | **0.36** | The measured halo reaches ambient by 3× core radius. 0.45 veils; 0.32 under-reads on 1440p. |
| 5 | Bloom threshold | Lighting: 0.80 | VFX: 0.85 | **0.82** | Sunlit white Empire structures peak at 0.90 and must NOT halo; FX cores at ≥1.05 linear must. |
| 6 | Tone-map exposure | Lighting: 0.90 | VFX: 1.05 | **0.92** | The lighting figure is back-solved from a measured lit/shadow albedo-cancelling pair. VFX read it off night frames which are exposure outliers. Night preset gets 1.05 separately. |
| 7 | Water reflectivity | VFX: none, ever | Mission brief: "SSR on water" | **No sky reflection, no planar mirror. Grazing-angle SSR allowed at mix ≤ 0.10, fresnel exponent 5.0, and it must sample only geometry, never a skybox.** | RA3's water is absorption + refracted seabed + foam + tight glint. SSR above 0.10 destroys the dark-base contrast trick. See §12. |
| 8 | Shadow softness | Lighting: keep hard, keep the stair-steps | Mission: "softer penumbra" | **Penumbra 2.0–2.5 px at 1440p (RA3's hardness), but stair-stepping eliminated** via 4096 maps + 3 CSM cascades + normalBias | Hardness is identity; texel aliasing is a 2008 limitation. Fix the limitation, keep the identity. |
| 9 | Prop density | Environment: ≥55/ha city | Mission: beat RA3 | **City ≥ 75/ha, wilderness ≥ 260/ha** (≈1.3× RA3) | Instancing is free for us and it was not for them. This is our safest fidelity win. |

Additional standing rulings:

- **Scale is 1 world unit = 1 metre. MBT hull = 7 m. This is law.** Every other size in the game
  derives from it.
- **Grass hue is 60–70°, never 100–120°.** Authored albedo `#5E6418`. This is the #1 amateur tell.
- **Soviets are olive-green `#4A6B33`, not grey.** Second-biggest tell.
- **No `AmbientLight` anywhere in the codebase.** `HemisphereLight` only. A flat ambient kills the
  blue shadow tint, which is the measured signature of the whole grade.
- **No fog on daylight maps. No chromatic aberration. No film grain. No depth of field. No motion
  blur.** All measured at exactly zero in the references. Every one of these is a "modern engine"
  tell that loses points.

---

## 2. CAMERA

**`THREE.PerspectiveCamera`. Never orthographic.** Proven three ways in the reference corpus:
world-parallel edge families drift **13.8–23.5°** in screen angle across a single frame; the
`ra3steam_07` road centrelines are 2.88° apart on screen and converge at a finite vanishing point
(x≈3347, y≈−859); ground foreshortening ratio goes 0.41 at the top of frame to 0.8–0.9 at the bottom.

| Parameter | Value | Notes |
|---|---|---|
| Projection | Perspective | non-negotiable |
| vFOV | **34°** | fixed forever. **Never animate FOV.** Zoom = dolly. |
| Pitch below horizontal | **39°** | constant at all zoom levels (fitted mean 37.9°, σ 3.5°) |
| Roll | **exactly 0** | `camera.up = (0,1,0)`; every vertical in every reference lands in the 90.00° orientation bin |
| Yaw | free 0–2π, default **45°** | 5 of 7 fitted frames cluster at 45–53° off the build grid |
| near / far | **1.0 / 600** | 600:1 ratio, no logarithmic depth needed |
| Height (default) | **50 m** above target ground | offset `(−43.7, +50.0, −43.7)`, slant 79.5 m |
| Height clamp | **32 m – 72 m** | 2.25× zoom range |
| Zoom step | ×1.10 per wheel notch, ~9 notches end-to-end | critically-damped spring, 0.15 s |

**Derived targets (2560×1440, default zoom, frame-centre row):**

| Quantity | Value |
|---|---|
| Centre-row visible ground width | **86 m = 12.3 tank-lengths** |
| Near-edge / far-edge width | 55 m / 158 m |
| 7 m across-screen | **207 px** |
| 7 m up-screen (max foreshortening) | 122 px (ratio 0.59) |
| 2 m infantry | **59 px tall** |
| Same tank, top vs bottom of frame | **2.01× size difference** |
| Horizon line | **≥1100 px above the top edge** — never in frame |

**Ground-axis screen angles (the fastest visual check).** The two build-grid axes must appear at:

| image row (of 1440) | grid axes at |
|---|---|
| 0 (top) | **±20.5°** |
| 480 | ±28.7° |
| 720 (centre) | **±32.2°** |
| 960 | ±35.2° |
| 1440 (bottom) | **±39.7°** |

If these are constant across rows, we have shipped Red Alert 2 (classic 2:1 iso is ±26.57° everywhere).

**Rig requirements.** Orbit around a ground-plane target, not a fixed offset — yaw is live. Therefore:
nothing may bake screen-space direction. Terrain normals, cliff decals, road textures and shadow
direction are all world-space. **Selection rings, build grids and range indicators are
ground-projected decals** (correctly foreshortened by the table above). **Health bars, chevrons and
reticles are screen-aligned billboards** and, because roll is 0, always axis-aligned.

**Shadow frustum** is a separate orthographic box fitted to the camera frustum's ground intersection
every frame: 40×58 m at min zoom, 90×130 m at max, +10% margin. Without refitting, shadow resolution
collapses at zoom-out.

**Where we beat RA3:** free 360° yaw with a snap-to-45° key, and a true dolly zoom instead of RA3's
FOV wobble. Both are pure wins with zero identity cost.

---

## 3. LIGHTING

Two lights. That is the entire rig.

### 3.1 The calibration measurement

`ra3steam_07`, tarmac road, same material, one patch in sun and one in a wall's cast shadow:

```
road LIT     #7B6A45   lum 0.419
road SHADOW  #1C2224   lum 0.129
shadow/lit per channel:  R 0.228   G 0.321   B 0.522     (luminance ratio 0.31)
```

Albedo cancels, so this directly gives **key:ambient = 2.22:1 in luminance**, with the key **3.7×
warmer in R/B than the ambient**. Every light value below is back-solved from this pair and
reproduces it to ±0.03.

### 3.2 The rig (arid/airbase calibration preset)

| | Type | Colour | Intensity |
|---|---|---|---|
| **Key** | `DirectionalLight` | **`#FFD08C`** | **3.1** |
| **Fill** | `HemisphereLight` | sky **`#6DA0F5`** / ground **`#7A6440`** | **1.00** |
| Ambient | — | — | **none. Ever.** |

- **Sun elevation 33°.** Golden-hour maps 16°; overcast 42°; moonlit 40°.
- **Sun azimuth: shadows run screen-LEFT and slightly DOWN.** Measured screen-space shadow vector
  **(−1.00, +0.10)** to **(−0.88, +0.47)**. Adopt **(−0.95, +0.25)**. The sun is behind the camera's
  right shoulder. **Because yaw is free, the key must rotate with the camera** to preserve this —
  bind the key's azimuth to `cameraYaw + 118°` so the screen-space shadow direction is invariant.
  This is a deliberate cheat and it is correct: RA3 does it too, which is why every reference frame
  has left-running shadows regardless of map.

### 3.3 Shadows

- **Hardness is a constant, not distance-varying.** Measured 0→100% edge width: median **1.6 px**,
  p25 1.1, p75 2.4, identical on 1024- and 1440-wide frames. Target **2.0–2.5 px at 1440p**.
- **Never black.** Shadowed surfaces keep **20–52% per channel** of their lit value; median
  luminance ratio **0.33**. **Never use a shadow-darkness multiplier** — the hemisphere fill does it.
- **Blue-tinted.** Normalised shadow/lit ratio ≈ **(0.44, 0.62, 1.00)** on the strongest map,
  (0.75, 0.80, 1.00) typical. B/R in shadow is 1.25–2.3× the lit B/R. This falls out of the
  hemisphere automatically — do not fake it with a tint.
- **Contact darkening is a SEPARATE additive layer and is one of the highest-value cheap wins.**
  Every unit in every reference sits in a dark pool **wider than its geometric shadow**, present even
  when the unit is already inside a large shadow. Per-unit ground decal: radial gradient, radius
  **0.55–0.7× footprint**, peak alpha **0.35**, multiply blend, colour `#101418`. **Units without
  this float.**
- **Crease AO is baked, not screen-space.** Every panel gap and hatch seam is a 1–2 px near-black
  line in the source art. Bake into vertex colours or the canvas AO map, multiplying **ambient
  only** down to 0.35–0.50 in creases.

**Where we beat RA3:** 3 CSM cascades at 4096 (RA3 had one low-res map with visible 3–5 px texel
stepping), and shadows on *everything* including props, vegetation and small greebles. **Where we
must not "improve":** do not use VSM/PCSS/soft-area shadows. RA3's edges are ~2 px hard, and an
over-soft edge instantly reads as a different engine.

### 3.4 Environment map — not optional

Procedural 128 px cube from a canvas gradient, PMREM'd once at boot: **+Y `#6DA0F5`, horizon band
`#B7C6D0`, −Y `#6E5F42`**. `scene.environment = pmrem`.

This is what makes RA3 units read as "toys you want to touch": the **silhouette rim**, a 1–3 px
bright line (+0.12 to +0.25 luminance) on every upward/outward-facing hull edge, and the **cool
specular** on barrels and tracks (`#8E97A1`, hue 212, S 0.12) which does *not* match the warm key.
With `envMapIntensity: 0` the units go matte and the render dies.

---

## 4. GRADE & POST

### 4.1 The six numbers a critic scores

| Metric | Target | Tolerance |
|---|---|---|
| Frame median luminance | **0.317** | 0.26 – 0.40 |
| Frame mean luminance | 0.353 | 0.30 – 0.42 |
| Black point (p1) | **0.022** | 0.006 – 0.06 — **not lifted** |
| Highlights (p95 / p99) | 0.797 / 0.961 | p99 must reach ≥ 0.90 |
| Mean HSV saturation | **0.512** | 0.42 – 0.68 |
| Fully-clipped pixels | 0.02–0.26% | never >1% outside big FX |

### 4.2 Tonemap

**`ACESFilmicToneMapping`, exposure 0.92.** Not Reinhard (blacks lift, too flat), not None
(highlights clip with hue shifts, which RA3 does not do). Proof: pooled saturation falls
monotonically with luminance — 0.675 in the 0.0–0.1 band down to **0.049** in the 0.97–1.0 band —
which is exactly an ACES desaturating shoulder, and the histogram is smooth to 1.0 with no clip spike.

### 4.3 Grade shader (post-tonemap, sRGB)

Measured per-channel means by tone zone give the signature: **warm-golden mids and highs,
neutral-to-cool crushed blacks, warm-white top.**

```
shadowTint   #3A4050  weight 0.06     (a TINT, not a lift — keep black point at 0)
midTint      #FFE9C0  weight 0.10
highTint     #FFFCF0  weight 0.04
contrast     S-curve, pivot 0.32, slope 1.12
vibrance     +0.30, masked by (1 - smoothstep(0.55, 0.95, lum))
```

**Vibrance, never `saturate()`.** A global saturate re-saturates the highlights and breaks the
measured sat-vs-lum curve, which is one of the acceptance tests.

### 4.4 Bloom

Measured radial profile around the Soviet reactor core: saturated to r≈25 px, half-falloff at
r≈30 px, back to background by r≈45–55 px on a 1440-wide frame → **glow radius = 3.2–3.8% of frame
width.** RA3's bloom is **tight, not veily** — the brightness comes from clipping, not blur.

```
UnrealBloomPass(res, strength 0.62, radius 0.36, threshold 0.82)   // post-tonemap sRGB
// if bloomed pre-tonemap in linear HDR: strength 0.55, radius 0.34, threshold 1.05
```

Weak sources still glow faintly — a tesla arc with core luminance 0.43 produces only +0.08 excess
out to r≈90 px — so the knee is soft (0.55), not a hard threshold.

### 4.5 Vignette

Measured mean luminance by normalised radius: flat (1.00–1.01) out to r=0.4, 0.985 at 0.6, **0.885
at 0.8, 0.830 at 1.0**. → offset/radius **0.62**, smoothness **0.55**, darkness **0.20**.

### 4.6 Explicitly zero

- **Chromatic aberration: 0.0 px.** Sub-pixel R/B-vs-G edge registration measured at frame centre
  *and* corner across five images: +0.0 px in every case.
- **Film grain: 0.** The high-frequency energy in "flat" ground patches (σ ≈ 8–16/255) is **albedo
  texture detail** — gravel, cracks, tarmac mottle. This is a positive requirement: our procedural
  ground must carry **±3–6% per-pixel luminance detail** or terrain reads as plastic.
- **Fog: null on all daylight maps.** Far-field bands measure *equal or higher* saturation than
  near-field bands in every reference. Any grey fog is an instant fail. If a map needs depth
  separation, use `FogExp2(0x2A3038, 0.0015)` capped so the far edge loses ≤8% luminance and ≤0.03
  saturation — a compositional *darkening*, never a haze.

**Where we beat RA3:** TAA or 8× MSAA + FXAA (RA3 aliased badly), and full 16-bit HDR through the
post chain. **Where we must not improve:** do not add DOF, do not add motion blur, do not add lens
dirt, do not add a "cinematic" teal-orange LUT. RA3's palette variety is enormous — green tropics,
blue night sea, white snow, warm autumn city — and the saturation comes from *materials and VFX*,
not from a global grade.

---

## 5. MATERIALS & THE UNIT DESIGN LANGUAGE

### 5.1 The thesis

**RA3 units are painted plastic toys at 2× scale.** Every volume is a chamfered convex blob, every
hard edge carries a 2–4 px bevel highlight, there is **no dirt, no streaking, no rust on vehicles**,
the only wear is darkening inside recesses, and a superheavy tank is **~55% of the screen height of
a war factory** (in reality it would be ~10%).

### 5.2 Scale rules — units are deliberately oversized

| Rule | Requirement |
|---|---|
| **R-S1** | MBT hull length = **0.45–0.55 ×** a production structure's footprint long axis. Never below 0.3. |
| **R-S2** | Tank silhouette height = **0.50–0.62 ×** a production structure's silhouette height. |
| **R-S3** | A small utility building (power plant pair) is only **1.15–1.30 ×** a tank's length. |
| **R-S4** | Infantry stand **0.30–0.38 ×** tank hull length tall (≈2.2 m against a 7 m hull). |
| **R-S5** | Buildings snap to a **square grid, 1 cell = 7 m = one tank hull.** Small 3×3, production 4×4, superweapon 6×6. |

### 5.3 Silhouette rules

- **3–5 primary masses per unit, never more than 6.** (Hammer = 5, Tengu = 4, Sickle = 4.)
- **The dominant feature is 35–50% of projected area.** Hammer's turret+barrels span 65% of hull length.
- **Turret-to-hull width ratio 0.75–0.95** (a real MBT is 0.55). Build turrets deliberately too big.
- **Top-heavy:** centre of visual mass at **60–70% of unit height**; superstructure occupies the top
  55–65%, chassis is a thin 35–45% base.
- **Tracks are proud:** protrude **8–14% of hull width** outboard each side, **18–25% of unit height**.
- **Greeble density (measured Sobel |∇|>25 coverage):** units **28–36%**, buildings **40–46%**.
  Buildings carry ~1.4× the detail density of units. Below 22% reads as untextured primitives; above
  50% reads as noise.
- **Detail budget: 6–10 discrete greeble objects + 2–4 decals per unit.** Every greeble ≥3 px at
  gameplay zoom. Nothing sub-pixel.

### 5.4 The reconciled PBR model (RULING #3)

All painted armour uses **`MeshPhysicalMaterial`**:

```
roughness 0.52   metalness 0.0   clearcoat 0.30   clearcoatRoughness 0.38   envMapIntensity 0.80
```

This simultaneously satisfies the measured broad diffuse lobe (p99/p50 = 1.44 on a white hull) and
the measured tight specular shoulder (+0.24 luminance over lit diffuse, saturation dropping 0.97 →
0.62 on Soviet red). The specular desaturates **partially, toward a tinted white** — never to pure
white on coloured armour.

| Class | roughness | metalness | clearcoat | env | Surface share |
|---|---|---|---|---|---|
| Painted hull | 0.52 | 0.00 | 0.30 | 0.80 | 60–75% |
| Bare metal (barrels, tracks, rollers) | 0.32 | 0.82 | 0 | 0.95 | 12–20% |
| Terrain / ground | 0.88 | 0.00 | 0 | 0.35 | — |
| Glass / canopy | 0.10 | 0.00 | 0.60 | 1.00 | 1–3% |

Bare-metal parts are **always desaturated warm grey-brown (S ≤ 0.26), never blue steel**:
barrels `#332F28`→`#5D5045`, track links `#030607`→`#281A11`, rollers `#DEC89F`.

### 5.5 Surface treatment

- **Edge bevels are the #1 read.** Every convex edge gets a chamfer of **1.5–3% of the part's
  smallest dimension** (2–4 px on screen). `RoundedBoxGeometry(w,h,d, segments 3, radius
  0.025·min(w,h,d))`. A hard `BoxGeometry` instantly reads as not-RA3.
- **Painted edge highlight on top of the geometry:** a hand-painted lighter band along the top edge
  of each bevel — base albedo **+22% V, −15% S**, 2–3 px wide.
- **Panel lines:** width 1.5–3 px (≈2% of the part's short dimension), drawn as a **dark inset groove
  plus a 1 px lighter lip on the sun side**. **6–14 per major hull face**, long parallel runs along
  the volume's long axis plus 2–4 cross-cuts. **Never a uniform grid.**
- **Cavity darkening is the ONLY wear:** recess colour = base albedo × **0.28–0.38** with an **+8%
  hue shift toward the shadow tint**. Baked as a 2–3 px dark line in the canvas texture, not SSAO.
- **Zero grime on vehicles.** No streaks, no mud, no scratched edges. The Empire hull measures
  saturation p50 = 0.13 with lit average `#FCF8E7` — a *clean painted white*.
- **Rust exists only on buildings**, confined to chimneys, pipes and scaffolding: `#6A4528`/`#4D3A2E`
  streaks over `#2C2A22`, 25–40% coverage of the stack.
- **Cylinders 12–16 radial segments, never 32.** RA3 silhouettes are faceted. Spheres 16×12.

### 5.6 Team colour

| Faction | Canonical albedo | Secondary | Lit sample | Shadow sample |
|---|---|---|---|---|
| Allied blue | **`#2A2ED0`** (H238 S0.80 V0.82) | `#5B63E8` | `#3224FD` | `#1C169A` |
| Soviet red | **`#E01418`** (H359 S0.91 V0.88) | `#8E0A12` | `#FF1A0A` | `#7C1212` |
| Empire orange | **`#FF9612`** (H33 S0.93 V1.00) | — | `#FFAA15` | `#7A511D` |
| Empire yellow | **`#F5E024`** (H54 S0.85 V0.96) | — | `#FFE524` | `#705E00` |

Base (non-team) colours: **Soviet olive `#4A6B33`** lit `#6C8A3E` / shadow `#1E2C16`; **Allied cool
grey-white `#B9BCC4`** mid `#6E7C8A` / shadow `#33363E`; **Empire warm off-white `#D8DCE0`** highlight
`#FEFEFE` / shadow `#6A7581`.

**Placement rules:**
- **R-T1.** Team colour = **8–14% of a vehicle's surface**, **20–28% of a walker/mech/infantry's**,
  **5–8% of a building's**. Never paint the whole hull.
- **R-T2.** It appears as **flat solid panel inserts** — discrete quads let into the hull. Not
  gradients, not tints. Hammer: 4 slabs. Guardian: 5 trapezoids per flank + turret cap.
- **R-T3.** On **top-facing and outward-facing** surfaces only (visible from the RTS camera).
- **R-T4.** **Exactly one insignia decal per unit**, 8–14% of hull width. Soviet 5-point star
  `#E4C300` on `#D51512`; Empire rising-sun disc `#DF4C1B` or pinwheel `#B82D1F`; Allied white eagle glyph.
- **R-T5.** Emissive accents are a **separate channel** and are **cyan for everyone** except the
  Soviets: Empire `#13E0D9`, Allied `#8DD9CD`→`#9DFEF5`, Soviet orange furnace `#FF7A1E`. Emissives
  occupy **1–3% of surface**, always clean rounded rectangles or discs.

### 5.7 Faction architecture — the constructible rules

**ALLIED** — rounded, splayed, cool grey-white + electric blue, real glass.
1. Splayed skirt: base flares **1.25–1.4× wider than top**, wall slope 18–25° from vertical.
2. **Open-topped hex/oct prism crown**, 0.45–0.55× base width, 0.30× total height, wall 8% of radius.
3. **Paired modules** — Allied buildings are 2 identical modules sharing an edge. Mirror, don't monolith.
4. Corner radius **6–10% of smallest dimension** — far rounder than the other factions.
5. 3–5 **horizontal banding strips** of alternating depth (±3%) running the full length.
6. Ground contact: flat near-black charcoal slab pad `#141518`, extends **8–12% beyond footprint**,
   thickness 2–3% of building height, chamfered corners.

**SOVIET** — brutalist slab, olive-drab + rust-red, rivets, industry.
1. Heavy chamfered slab: box with **45° chamfers on every vertical corner** at 6–9% of box width
   (reads as octagonal plan). Height:width ≈ 0.75:1.
2. **Fat capsule corner rails**, diameter 10–14% of wall height, full height, flat disc caps.
3. **2–3 tapered smoke stacks**, diameter 8–12% of building width, protruding **35–55% of building
   height** above the roof, top radius 0.85× base, two red bands.
4. **Bulbous pressure vessels** — spheres/capsules/retorts, radius 0.20–0.30× building width, with
   glowing amber caps.
5. **Exposed yellow lattice scaffolding** `#E5CB43` sunlit / `#919932` median, tube ⌀ ~2 px,
   X-braced squares at ~14 px pitch, plus railed catwalks with 3 horizontal rails.
6. **Rivets:** 3–5 px discs at **10–14 px pitch** along every chamfer edge and stack seam, on ~60%
   of visible edges — light dot + dark under-shadow, painted into the canvas texture.
7. Ground contact: **raised grated steel deck** `#7E7A6E`, 10–15% beyond footprint, 4–6% of building
   height thick, bevelled lip, 2 px dark edge; plus a concrete apron `#B0AC9E` with a `#D02E1C` star
   decal fronting the vehicle exit.

**EMPIRE** — folded plate, white + orange, curved eaves.
1. **Stepped pagoda**, 4 tiers, each **0.70–0.75× the width** of the one below, tier height 0.22–0.28×.
2. **Upturned eaves:** thin splayed roof plates (4–6% of tier height thick) overhanging **12–18%**,
   with the outer 15% of each corner **kicked up 12–20°**.
3. **Folded plate armour:** flat angular plates meeting at **15–35° creases**, overlapping like
   origami, each 0.12–0.30× the volume length, with a 2–3 px gap showing dark `#2A2C30` underneath.
4. **Long forward wedge** on vehicles: aspect 3.5:1 to 5:1, **55–65% of unit length**, carries the
   yellow team panel.
5. **Ball-footed outriggers:** 4–6 legs, ⌀ 3% of building width, length 12%, ending in spheres of
   2.2× the leg diameter, splayed 25° outward.
6. **Orange piping** `#FF9612` — a continuous rounded tube, ⌀ 3–4% of the volume's width, tracing the
   top edge and one flank of every major plate. **This is the single most identifying Empire cue.**
7. Ground contact: **translucent hazard pad** — rounded rect (corner r ≈ 9% of short side), 2 px
   `#E8E4D2` outline, interior of 45° yellow dashes `#FDC437` at 40% opacity, dash 14×7 px, pitch 28 px.
   The building floats 2–4 px above it on its feet, with a distinct contact shadow.

---

## 6. TERRAIN & ENVIRONMENT

### 6.1 Ground albedos (author these, not the sampled values)

| Material | **Author albedo** | Rough | Pattern scale |
|---|---|---|---|
| Lush grass | **`#5E6418`** | 0.95 | 0.35 m blade · 6–12 m blotch · 25–40 m soil macro |
| Grass, shadowed | `#2C3309` (= 0.42× lit) | 0.95 | same |
| Dry / steppe grass | `#8A7A44` | 0.95 | 0.5 m tuft · 8 m blotch |
| Bare dirt | `#9C7B52` | 0.92 | 0.25 m grain · 3 m clump · 1.6 m ruts |
| Gravel pad | `#A89A78` | 0.88 | 0.10–0.18 m stones |
| Sand | `#C4A878` | 0.90 | ripples λ 0.5–0.9 m |
| Asphalt | `#46464A` | 0.75 | 0.02 m aggregate · 3–6 m patches |
| Asphalt wheel path | `#57575C` (+18% L) | 0.70 | two 0.8 m bands per lane |
| Concrete / sidewalk | `#9A968C` | 0.70 | slab 1.2×1.2 m, joint 0.03 m |
| Cobble plaza | `#B7ADA2` | 0.68 | **sett 0.7–1.0 m**, joint 0.06–0.08 m `#6B6058` |
| Light paver band | `#D6CFC6` | 0.62 | paver 0.35×0.7 m |
| Brick paving | `#96674A` | 0.72 | **brick 0.35×0.18 m** running bond |
| Brick retaining wall | `#8E5A34` | 0.80 | course 0.22 m, per-brick jitter ±14% |
| Snow | **`#C4BAB2`** (NOT white) | 0.60 | 2–5 m drifts · 0.3 m sparkle |
| Rock, coastal wet | `#35505C` | 0.85 | vertical striation λ 0.4 m |
| Rock, dry | `#7A7258` | 0.85 | striation λ 0.5 m |
| Military pad | `#8C8462` | 0.72 | 3 m slab + hazard chevrons |
| Hedge foliage | `#2A3A16` | 0.95 | 0.15 m leaf noise, box silhouette |

**Texture features are deliberately oversized 2–3× real world** — cobbles 0.8 m not 0.15 m, bricks
0.35 m not 0.22 m, lane dashes 3.0 m. This is *why* RA3 ground reads at the RTS distance. A
"correct" 0.15 m cobble is grey mush.

White road paint is **`#D8D2C8`, never `#FFFFFF`.**

### 6.2 How surfaces meet — exactly three joint types

**(a) Man-made ↔ man-made → HARD edge + explicit trim geometry.**
Extruded kerb: top face 0.28 m, vertical face **0.15–0.20 m tall**, `#C0BAB0`, roughness 0.65. It is
real geometry and casts a real 0.15 m shadow. Spline-following, so corners are **radiused r = 4–8 m,
never mitred.** Cobble→grass gets a 0.4–0.6 m light stone kerb band (18% brighter). Sidewalk→plaza
gets a 0.3 m soldier course 12% darker.

**(b) Natural ↔ natural → SOFT splat blend.** Blend width **1.5–4.0 m**. Perturb the *mask*, not the
colour: fbm with ~0.8 m feature size, boundary displacement ±0.6 m. Scatter isolated 1–2 m grass
islands 3–6 m out into the dirt. A straight-line alpha ramp is the instant prototype tell.

**(c) Natural ↔ man-made → HARD edge + spill.** Hard base joint, then a **0.3–1.0 m dirt/sand drift
decal onto the paving**, then **let props violate the boundary** — shrub tufts overhanging the
tarmac by 0.5–1.5 m. This last one is the cheapest possible kill for the "cut-out decal" look.

### 6.3 Roads

Lane width **3.2–3.5 m**; 2-lane = 7.0–7.5 m; 4-lane = 13–14 m. **Every road is a spline with 15–40 m
radius bends. Straight axis-aligned roads are a hard fail.**

- Centre line: double solid yellow, 0.12 m stripes, 0.12 m gap, `#C9A227`.
- Lane divider: white dashes **3.0 m / 2.5–3.0 m gap**, 0.12 m wide, `#D8D2C8`.
- Edge line: solid white 0.15 m, inset 0.25 m from the kerb.
- Crosswalk: bars 0.45–0.60 m wide / same gap, full carriageway; stop line 0.3 m, 1.5 m before.
- **Red kerb paint** `#B03A2E`–`#C0392B` on corner radii and at hydrants — vertical face plus 0.08 m
  of the top, running 6–12 m along the arc. One of RA3's most recognisable street details.
- Yellow kerb dashes `#E0B12A`, 0.9 m dash / 0.45 m gap, on the kerb top face at crossings.
- Parking bays 2.5×5.0 m, 0.10 m white lines, rows of 8–14, 55–75% occupancy.
- **Wear decals are mandatory:** cracks 1–3 per 10 m of road, 0.03–0.08 m wide, `#1E1E22`, meandering
  0.5–1.5 m segments with ±25° heading jitter; patch blotches 1.5–4.0 m, 1 per 40 m², ±12% luminance;
  manholes 0.7 m, 1 per 25 m; oil stains 2–5 m ellipses at alpha 0.35 near depots.
- **Street-lamp light pools even in daylight:** 6–8 m elliptical decal, `#E8D089`, alpha 0.25.

### 6.4 Relief

**Playable ground is essentially flat: ±0.4–0.8 m of swell over 15–30 m wavelengths.** All the
shading variation in the references is texture and shadow, not geometry.

**All meaningful relief is discrete terraces, step height 4–8 m, 2–4 tiers per map.** No ramps except
explicit built ones. **Never** smooth Perlin hills or scree slopes — RA3 terrain is architecturally
authored.

- **Cliff A, retaining wall:** brick `#8E5A34`, 0.22 m courses; **grey concrete coping cap `#B8B0A6`,
  0.5–0.6 m thick, running the full top edge** (this cap is what makes the wall read); vertical
  pilaster buttresses every 6–8 m, 0.8 m wide, projecting 0.25 m; two tiers with a ~2 m setback and a
  planted strip between; follows the road spline.
- **Cliff B, natural rock:** 78–88° face, 6–14 m tall, **vertical striation λ 0.4–0.5 m at ±0.25 m
  depth**; **overhung soil/grass lip at the top, 0.3–0.8 m thick, with vegetation spilling 0.5–1.5 m
  over the edge** (a bare cliff top edge reads as a cut polygon); base skirted with 0.5–1.5 m
  boulders, 3–6 per 10 m of run.

### 6.5 Vegetation

| Archetype | Canopy Ø | Height | Colours |
|---|---|---|---|
| Broad deciduous | 7–10 m | 9–13 m | summer `#4C6B1E`/`#3A5417`/`#6B8028`; autumn `#C4761E`/`#A8531A`/`#D9A02C` |
| Columnar cypress | 1.5–2.5 m | 8–12 m | `#1E2A0C`–`#2C3A12` |
| Palm | 5–7 m span | 6–9 m | frond `#385601`, trunk `#6B5433` |
| Conifer | 4–6 m | 8–14 m | `#111409`–`#243009` |

- **Clustering:** 3–9 trees per clump, **4–8 m spacing inside, 20–50 m between clumps.** Street rows
  are regular at **8–12 m pitch**, 1.5–2.5 m off the kerb, ±0.4 m jitter.
- **Per-instance jitter is MANDATORY:** uniform scale **0.80–1.25×**, yaw 0–360°, tilt ±4°, hue ±8°,
  value ±18%, saturation ±12%. Without hue/value jitter a forest reads as a repeated stamp.
- **Season mixing:** 70% one season, 30% off-colour instances.
- **Grass tufts:** radial fan of **14–20 tapered blade cards**, each 0.15 m × 1.4–1.8 m, arcing
  outward; tuft footprint 2.0–3.5 m, height 1.5–2.5 m; **two species mixed 50/50** — golden `#C8B84A`
  tips → `#7A6A2A` base, and green `#5E8B2E` → `#2E4A14`. Tufts **cast real shadows** with readable
  fan silhouettes, and scatter only where the ground splat mask is green.
- **Animation:** canopy vertex-shader sine on world XZ, **amplitude 0.15 m at 0.25 Hz**, per-instance
  phase; grass tufts **0.06 m at 0.6 Hz**. Near-zero cost and its absence reads instantly as "static".

### 6.6 Density — the anti-emptiness law

| Scene type | RA3 measured | **Our target** |
|---|---|---|
| City / plaza | ~80 props/ha | **≥ 105/ha** |
| Wilderness / island | ~230 props/ha | **≥ 260/ha** |
| Carnival / mixed | ~55/ha (large props) | ≥ 70/ha |
| Airbase (low props) | ~30/ha + **45% of ground carrying painted decals** | ≥ 40/ha + 45% decals |

**THE SHIP-BLOCKING RULE:**
> **No contiguous walkable ground region larger than 25 m × 25 m may contain zero props AND zero
> texture-variation events AND zero decals.**

RA3's own largest unadorned patch is 23×15 m of cobble, and even that carries paving ribbons and a
cast shadow. **Target ≥55% of visible ground adorned** (prop, structure, painted marking, or a
distinct second material). A flat green plane at 5% adornment is the failure mode we are engineering
against — and it is the failure mode a procedural remake defaults to.

**This is our single biggest opportunity to beat RA3.** GPU instancing makes 1.3× their prop count
free. Use it.

---

## 7. WATER

Water is **absorption + refracted seabed + foam + tight glint**. Not a mirror.

**Depth ramp (tropical):** `#3E7A6E` (waterline) → `#1D4A44` (0.25) → `#12332E` (0.5) → `#0B2921`
(0.8) → `#041F1A` → `#00120E` (deep). Whole-body median **`#0D352D`**.
**Japan coast:** `#5E8A92` → `#4C6A75` → `#265461` → `#1C3D4E` → `#0A2032`.
**Night:** `#1D3676` → `#0B3660` → `#13224B` → `#001A42`.

```glsl
depthMeters   = (sceneDepth - waterDepth) * scale;
transmittance = exp(-depthMeters * vec3(0.62, 0.28, 0.20));  // red dies first
col = mix(deepColor, seabedColor * transmittance, transmittance.g);
```
Tuned so colour reaches p50 by ~0.9 TL of depth and p10 by ~2.4 TL. (**1 TL = 1 tank length = 7 m.**)

- **Seabed visibility is REQUIRED** for the first ~1.5 TL: large soft low-contrast blobs 0.8–4 TL
  across, contrast only 18–25 L units against the water, refraction UV offset
  `normal.xz * 0.012 * saturate(depth)` (≈6–10 px wobble at 1080p). **Completely invisible beyond 2 TL.**
- **Three wave bands:** A swell λ 1.2–2.5 TL, amp ±0.02 TL, 0.10 TL/s (drives shape); B chop λ
  0.10–0.22 TL, amp ±0.006 TL, 0.35 TL/s (the visible crinkle); **C micro-detail 2–4 px, normal-map
  only, 0.9 TL/s** — without band C the specular reads as plastic. Three scrolling FBM normal maps
  on 512² canvases, rotated 0°/47°/113°. Crests sharper than sine: `pow(abs(sin), 0.6)` or Gerstner Q ≈ 0.55.
- **Foam is filigree, not blobs:** filaments **1.5–4 px wide, 20–120 px long**, following crests, like
  torn lace. Coverage **4–8%** calm, **12–16%** choppy. `foam = smoothstep(0.62, 0.78, fbm(uv*24) +
  crestHeight*1.6)`. Foam takes the key colour: warm `#E8DCC8`, neutral `#F1F1E9`→`#FFFFFF`, night `#B3AFFB`.
- **Glint:** GGX roughness **0.045–0.07**, clipping to `#FFFFFF` over 2–5 px, **anisotropy 1.6×**
  stretched along the light azimuth, density ≈ 1 glint per 3500 px².
- **Shoreline:** a permanent churned foam band **40–80 px (0.42–0.84 TL) wide** along 100% of the
  land/water contact, ~45% coverage, bluer than open foam (`#B8CEDA` core, `#7A96A6` mid, water
  locally lightened to `#3A5A66`), pulsing ±25% at 0.45 Hz, UV scrolling landward at 0.08 TL/s,
  alpha depth-faded by `1 - saturate(depth/0.35TL)`.
- **Wakes go into a world-space foam-accumulation R8 buffer** (1024² over the play area), splatted
  additively per ship per frame and decayed `*0.988` per frame (≈4 s half-life). Far cheaper and more
  RA3 than particle ribbons. Stern churn **1.3× hull width × 1.4–1.8 hull lengths**; Kelvin V arms at
  **±19°**, 2–4 px wide, made of *discrete dashes*, extending 3.5–5 hull lengths, persisting ~4.5 s.

**Water critical rule:** open-water **mean luminance must stay in 45–115 (0–255)**. RA3 reads bright
and arcade because every effect clips to white **on a base that is 20–40% grey**. If our water median
exceeds L≈115 the effects stop popping and the whole thing reads as washed-out mobile game. **This is
the #1 water failure mode, and it is also why SSR is capped at 0.10 (RULING #7).**

---

## 8. VFX

### 8.1 The governing principle

**RA3's VFX are a CONTRAST trick, not a brightness trick.** Every measured VFX region hits `#FFFFFF`
at p99.9 — fire, foam, tesla, beams, muzzle flashes, all of them clip. Author emissives **>1.0 in
linear** so the tonemapper crushes cores to pure white with saturated coloured fringes, and **keep
the base surfaces dark**.

### 8.2 Explosions

**Fireball ramp — the white core dominates, and this is the signature:**

```
0.00 #FFFAFF  (pure white — occupies 50–55% of the fireball radius)
0.35 #FFFFAF
0.50 #FEF5B0
0.62 #FDC578
0.74 #FF9350
0.84 #FE8149
0.92 #DB6D2E
1.00 #B5501C  → alpha out
```

**A fireball whose centre is orange fails the critique immediately.**

| Element | Size (TL) | Onset | Peak | End | Blend |
|---|---|---|---|---|---|
| Flash disc | 1.8 → 3.2 | 0 | 40 ms | **140 ms** | Additive, pure white |
| Fireball (8–14 billows) | 0.9 → 2.6 | 0 | 220 ms | **750 ms** | Additive, each rotating ±35°/s |
| Shockwave ring | 0.4 → 4.5 | 30 ms | — | **420 ms** | Additive, 6→2 px thick, `#FFE8C0`→`#FFB060`, **flattened to ground, scaleY 0.12** |
| Smoke plume (14–22 puffs) | 1.2 → 4.0 | 120 ms | 1.8 s | **5.5 s** | Normal, lit |
| Debris (12–20 chunks) | 0.05–0.14 | 0 | — | 1.6 s | opaque mesh, 55° cone, 5–9 TL/s, gravity 22 TL/s², tumble 720°/s |
| Embers (30–60) | 0.02–0.04 | 0 | — | 1.9 s | Additive, flicker 18 Hz |
| Scorch decal | 1.6–2.4 | 60 ms | — | permanent | Normal |

Unit death ≈ **2.2 TL** fireball. Structure death ≈ **4.5–6 TL** with an 8 TL flash and a 3–5 s
cook-off of 3–6 smaller 1.2 TL fireballs at 250 ms intervals.

### 8.3 Tesla arcs (the Soviet signature)

Ramp (centre → edge): `#FFFFFF` → `#E8F0FF` @0.08 → `#A8C4FF` @0.18 → `#6E8CFF` @0.32 → `#3F5FE8`
@0.55 → `#1326B3` @0.80 → `#0A1450` @1.0, alpha `pow(1-r, 2.2)`.

- Core filament **2–3 px at L ≥ 248**; saturated blue sheath reaching `#1326B3`-class saturation
  (≥0.85) **within 8 px**; soft glow to ±20–40 px.
- Path: 8–14 segments of 15–25 px, lateral jitter ±(0.06 × total length) by midpoint displacement
  (3 levels, roughness 0.55).
- **Branching: 4–8 sub-branches, spawn probability 0.35/vertex, branch length 25–50% of remaining,
  ~30% of branches REJOIN the main path forming visible closed loops.** The loops are unmistakably RA3.
- Draw as **3–5 overlapping independently-jittered paths**, not one.
- Lifetime 90–140 ms per instance; **re-roll the whole path every 50 ms** while firing; total beam
  0.9–1.4 s.
- **`depthTest: false`** — RA3 bolts draw over ships and terrain alike. Verified.
- Impact starburst is **mandatory**: white→`#D4FFFF`→`#8BE0FD`→`#5D9CFF` ball at r 35–45 px for
  180 ms, plus **14–20 radial spikes**, 2–4 px wide × 60–140 px long, `#A8E4FF`, 220 ms, with 4 of
  them at ~2× length.

### 8.4 Beams

**Prism (Allied):** white core **3.5 px**, inner cyan band **33 px total**, outer halo **64 px total**,
falloff ending at 74 px. Ramp `#FFFFFF`→`#F1FEF5`→`#A7F5F9`→`#A2D2FF`→`#81B3FC`→`#6597DE`→`#547BC0`.
Continuous 1.2–2.0 s, 60 ms open / 180 ms close, width breathing ±8% at 11 Hz, taper 100%→88%.
**Cryo:** core `#EAF7FF` 5–7 px, sheath `#4FA8F0` 14 px, glow `#1E5EC8` 28 px, no jitter, no taper.
**Designator (green):** core 3 px `#C8FF6E`, glow 10 px `#5AE02A`, plus a **volumetric green shroud
at 1.35× the target's bounding box**, `#8FE24A` at alpha 0.30–0.38, with 5–8 rising tendrils.

### 8.5 Guns

- **Muzzle flashes are WHITE/CREAM, not orange, and they are LARGE.** Light tank: 50×28 px elongated
  4-point star, `#F8FAFF` core, 70 ms. Medium: 50×50 px kite, `#FFF6C8`→`#FFC940`, 90 ms. Heavy:
  **120×70 px = 1.25 TL wide**, `#FFF3C0`→`#FFC940`→`#E8871E`, 110 ms. Scale curve
  `0 → 1.0 @15 ms → 0.85 → 0`.
- **MG tracers:** tapered lozenge, bright rounded head, tail tapering to a point — **not a uniform
  line.** 25–65 px long × 2.5–4 px, ratio ≈14:1. Warm `#FFD26A`→`#FF9A2E`→`#E8781C`; Allied cold
  `#FFFFFF`→`#C8E4FF`→`#6FA8FF`. Bursts of 3–6 at 55–90 ms, then a 450–900 ms gap. Only ~1 in 3
  rounds is visible.
- **Tank main gun:** 95–130 px × 7–9 px head, tapering over the last 40%, `#FFF0B8`→`#FFD86A`→
  `#FF9A2E`→`#C85B22`, travel ~14 TL/s, with a thin `#8A8078` smoke ribbon at alpha 0.25 for the
  first 30% of flight.
- **Armour-impact spark burst** (frequently missed, very characteristic): **30–45 straight thin
  streaks** in a ~140° upward-biased fan, each 2 px × 60–180 px, `#FFF8D8`→`#F6E9B0`→`#D8B860`,
  420 ms, slight gravity droop, plus a 20 px white flash disc for 60 ms.

### 8.6 Trails — always bead chains, never ribbons

- **Cold vapour (light missiles):** discrete round puffs every **16–20 px of travel**, r 5→14 px,
  `#E4E8EC`→`#C0C6CC`, alpha 0.85→0, life 2600 ms, **Normal** blend. Total trail 350–420 px = 3.7–4.4 TL.
- **Hot rocket:** flame puffs `#FFAE3A`→`#FF7C10`, r 10→26 px, 380 ms, Additive, extending ~180 px;
  behind it smoke `#6A6560`→`#8A857E`, r 14→48 px, 3200 ms, Normal. One pair every 14 px.
  Total 420–500 px.
- **A scanline along any trail must show ≥6 luminance oscillations of ≥25 L units.** Continuous
  smooth ribbons are an RA3 negative.

### 8.7 Smoke

- Wreck/heavy damage: **near-black.** Core `#1A1A1A`, mid `#2A2622`, lit edge `#4A4A4A`, sunlit rim
  up to `#8A8580`. Structure fire: warmer `#3B3537`→`#5A4E42` with an orange-lit underside `#926339`.
  Vehicle dust: light warm grey `#C6C6C0`→`#D8D8D2`.
- **8–14 visible discrete lobes** per column; column rises **1.9–2.7 TL**, widening from 30 px at the
  base to 90–110 px at the top (**≥3× widening is an acceptance test**). Opacity 0.85 base → 0.15 top.
- **Smoke MUST receive scene light.** `color = mix(#14120F, #8A857E, dot(N,L)*0.5+0.5)`. Flat grey
  smoke looks wrong.

### 8.8 Damage states

| Health | Effect |
|---|---|
| 100–66% | none |
| 65–33% | thin grey wisp, 1 puff/600 ms, `#8A857E`, alpha 0.35, rising 0.9 TL |
| 32–1% | black column at 1 puff/220 ms + **2–4 flame tongues** on the hull, `#FFB020`→`#FF6A00`, 0.21–0.37 TL tall, flicker 12 Hz |
| Damaged structure | 1–3 roof smoke columns + internal orange emissive `#FFB01E` through windows, halo r 55 px |
| Wreck | albedo ×0.22, roughness →0.9, burning 8–12 s, smoke another 12 s, then wreck persists |

### 8.9 Dynamic light injection — NON-NEGOTIABLE

**The single biggest gap between "particles on a screenshot" and RA3 is that RA3's VFX light the
world.** Measured: pavement 300 px from a beam reads `#4560A3`–`#5B79B9`, while the same pavement on
the fireball side of the frame reads `#B5501C` — two competing coloured washes in one image. Snow
within 200 px of a tesla impact reads `#5765AC`–`#7891D4`, i.e. the effect owns 40–60% of the ground
colour.

Pool **8–12 `PointLight`s**, allocated by (distance-to-camera × intensity) priority:

| Source | Colour | Peak intensity | Range | Envelope |
|---|---|---|---|---|
| Explosion | `#FFB05A` | **28** | 7 TL | 0→28 in 40 ms → 0 by 500 ms |
| Muzzle flash | `#FFD28A` | 12 | 2.5 TL | 0→12 in 10 ms → 0 by 90 ms |
| Tesla impact | `#5A82FF` | 14 | 3.5 TL | 0→14 in 30 ms → 0 by 200 ms |
| Beam midpoint | `#6FA8FF` | 9 | 6 TL | on/off with the beam |
| Burning wreck | `#FF7A28` | 4 | 2.5 TL | flicker ±30% at 7 Hz |

### 8.10 Ground FX

- **Tread dust:** `#C6C6C0` (dry earth `#B8A484`, snow `#E8ECF0`), alpha 0.40–0.55, r 10→32 px,
  life 2.8 s, one per track every 0.15 s while moving. On paving drop to alpha 0.18 and 60% radius.
- **Tread marks:** two 6–8 px strips at track gauge, **multiply the ground by 0.72** (not a flat
  brown), laid into a world-space decal atlas, fading over 35 s.
- **Scorch:** ellipse 1.6–2.4 TL major, aspect 1.7:1, `#2A2118` at 55% centre opacity feathering to
  0 over the outer 35%, faint `#4A3A28` ring at 80% radius. **Permanent**, capped at ~200 with
  oldest-eviction.
- **Budget ~2500 live particles at a 20-unit battle.** One `InstancedMesh` per blend-mode group, one
  shared canvas-generated 4×4 sprite atlas (soft radial, billow, streak, ring, star, filigree foam).

**Where we beat RA3:** more simultaneous dynamic lights, per-particle lit smoke, and depth-aware soft
particles (no hard sprite/ground intersections). **Where we must NOT improve:** do not make the VFX
subtle, do not shrink the muzzle flashes, do not soften the sprite edges beyond their alpha ramp, do
not add motion blur.

---

## 9. HUD

Console RA3's HUD consumes **≈14.8%** of the frame (minimap panel 290×300 = 9.1%, unit portrait
220×115 = 2.6%, bottom-right portrait + credits ≈3%). RA2's sidebar consumes ≈24%.
**Target 12–16% — RA3-era, not RA2-era.** Keep the frame centre and the lower-left third clear;
that is where the action reads.

Composition targets for critic screenshots: stage **15–30 units and 6–10 structures**. Gameplay
frames run units 3–8% of pixels / structures 10–25% / ground 70–85%; marketing frames push
units+structures to 35–50%. Expect the critics' shots to be dense.

---

## 10. THE SIX MAP PRESETS

| Preset | Key colour / intensity | Sun elev | Hemi sky / ground / intensity | Exposure | shadow/lit |
|---|---|---|---|---|---|
| **Arid / airbase** (calibration) | `#FFD08C` / 3.1 | 33° | `#6DA0F5` / `#7A6440` / 1.00 | **0.92** | 0.31 |
| Temperate day | `#FFD9A0` / 3.0 | 33° | `#82AEEE` / `#7A6440` / 1.00 | 0.92 | 0.32 |
| Tropical noon | `#FFDCA8` / 3.2 | 36° | `#7BAAF0` / `#6E6030` / 1.05 | 0.94 | 0.40 |
| Golden hour | `#FFA867` / 3.6 | **16°** | `#5C7ACC` / `#4A3A2E` / 0.75 | 0.86 | 0.26 |
| Overcast snow | `#E8E4E0` / 2.0 | 42° | `#AEBECE` / `#7E7570` / 1.55 | 0.96 | 0.29 |
| Moonlit / night | `#DCE2FF` / 1.5 | 40° | `#3A4488` / `#1E2450` / 1.30 | **1.05** | 0.46 |

Overcast snow measures mean saturation **0.169** — dial vibrance down 50% for that preset only.
Night blue is **ambient, not fog**: far bands measure `#102B4F` at S 0.80 vs near `#485D8C` at S 0.62.

---

## 11. WHERE WE BEAT RA3 (2008) — AND WHERE WE MUST NOT

### Beat it — these are pure wins
1. **Real-time shadows on everything** — props, vegetation, greebles, unit-on-unit. RA3 shadowed
   selectively.
2. **3-cascade 4096 shadow maps** — same 2 px hardness, zero texel stair-stepping.
3. **Proper PBR** with clearcoat and a PMREM'd environment — RA3 faked the waxiness with baked specular.
4. **Higher prop density** (1.3× RA3) via instancing. Biggest, safest, cheapest win.
5. **Physically-based tight bloom** on HDR values instead of an sRGB-threshold blur.
6. **TAA / 8× MSAA.** RA3 aliased visibly. Clean edges cost us nothing in identity.
7. **Per-particle lit smoke and soft (depth-faded) particles.**
8. **Vertex-animated foliage** everywhere, including grass tufts. Near-free.
9. **Free 360° camera yaw** with world-space-only authoring.
10. **World-space wake/decal accumulation buffers** instead of ribbon meshes.

### Do NOT "improve" these into blandness
1. **Do not desaturate.** Mean HSV saturation stays ≥0.42. RA3 is 1.8× a photoreal reference and
   that is deliberate.
2. **Do not go photoreal-grey.** Soviets are olive, grass is yellow-green, snow is warm grey.
3. **Do not shrink the units** to realistic proportions. R-S1 through R-S5 are law.
4. **Do not make the VFX subtle.** Muzzle flashes are 5× the barrel diameter and white.
5. **Do not soften the shadows** into VSM/PCSS mush.
6. **Do not add fog, DOF, CA, grain, motion blur, or lens dirt.** All measured at zero.
7. **Do not add a sky.** 0 of 14 frames show one. Spend the budget on terrain.
8. **Do not mirror the water.** Absorption + foam + tight glint. SSR capped at 0.10.
9. **Do not lift the blacks** for "contrast safety". p1 = 0.022.
10. **Do not brighten the base scene** to make it "readable". Darkness is what makes the accents blaze.

---

## 12. `threeJsConfig` — PASTE-READY

The full config lives at the end of this document and is mirrored verbatim in the structured result.
It is designed to drop into `src/core/config.ts` so a visual critic can retune the entire game's look
from one file. See §14.

---

## 13. SCORECARD — judgeable from one screenshot

Weight 3 = fatal, 2 = major, 1 = polish. Every check is answerable by looking at (or sampling) a
single 2560×1440 render.

| # | Check | Pass criterion | W |
|---|---|---|---|
| 1 | No sky | Topmost pixel row is terrain/water/structure. Zero sky, zero horizon. | 3 |
| 2 | Perspective gradient | Same unit at top vs bottom of frame differs **1.6–2.4×** in pixel size | 3 |
| 3 | Grid-axis sweep | Ground grid ±20±4° at the top row, ±39±4° at the bottom (not constant) | 3 |
| 4 | Frame median luminance | 0.26 ≤ median ≤ 0.40 | 3 |
| 5 | Mean saturation | Mean HSV S ≥ 0.42; ≥35% of pixels at S>0.35 & V>0.25 | 3 |
| 6 | Blacks not lifted | p1 luminance ≤ 0.06 and p99 ≥ 0.90 | 3 |
| 7 | Shadow tint & depth | Same-material lit/shadow lum ratio 0.28–0.38, per-channel (0.20–0.26, 0.29–0.35, 0.46–0.56) | 3 |
| 8 | Unit-to-building scale | Tank hull ≥ 0.45× production-structure footprint long axis | 3 |
| 9 | Grass hue | Hue 55–75°, S 0.78–0.90, V 0.30–0.55. No hue 100–120° anywhere | 3 |
| 10 | Soviets are olive | Soviet base hull hue 68–80°, S 0.55–0.70. Not grey | 3 |
| 11 | Bevelled edges | Every convex edge shows a 2–4 px bevel highlight; zero razor box edges | 3 |
| 12 | No fog | Far-field band saturation ≥ near-field band saturation − 0.05 | 3 |
| 13 | Contact darkening | Every unit sits in a pool wider than its cast shadow, peak alpha ~0.35 | 3 |
| 14 | Fireball core is white | Brightest 40% of any fireball is L>245, channel spread <30 | 3 |
| 15 | Ground adornment | ≥55% of visible ground adorned; no unadorned patch > 25×25 m | 3 |
| 16 | MBT screen size | Hull long axis is 6–12% of frame width at default zoom (target 8%) | 2 |
| 17 | Shadow direction | Test-cube shadow offset (−0.95±0.12, +0.25±0.20), length 1.5–2.2× on-screen height | 2 |
| 18 | Shadow hardness | 0→100% edge width 1.2–2.5 px at 1440p; no visible texel staircase | 2 |
| 19 | Roll is zero | Every building vertical and lamp post is exactly vertical on screen | 2 |
| 20 | Sat-vs-lum curve | Monotonically decreasing, top band ≤0.10 (ACES shoulder present) | 2 |
| 21 | Team colour coverage | 8–14% of vehicle surface as flat slabs + exactly one insignia decal | 2 |
| 22 | Zero grime on vehicles | No streaks, mud, rust or scratches on any hull | 2 |
| 23 | Env-map rim | Upward/outward hull edges carry a 1–3 px line +0.12–0.25 lum over the interior | 2 |
| 24 | Bloom tightness | Halo around an emissive falls to 50% within 1.5× core radius, gone by 3.5% of frame width | 2 |
| 25 | Water base darkness | Open-water mean luminance 45–115 (of 255); no sky reflection, no mirrored geometry | 2 |
| 26 | Foam is filigree | Filaments 1.5–4 px wide; coverage 4–8% calm / 12–16% choppy; no round blobs | 2 |
| 27 | Shoreline band | 40–80 px churned foam band along 100% of land/water contact | 2 |
| 28 | VFX scene wash | Ground within 200 px of an active beam/tesla shifts ≥35 L toward the effect hue | 2 |
| 29 | Muzzle flash colour+size | White/cream core, ≥4× barrel diameter long | 2 |
| 30 | Tesla branching | ≥4 branches and ≥1 closed loop per bolt; core ≤3 px at L≥248 | 2 |
| 31 | Trails are bead chains | Scanline along a rocket trail shows ≥6 oscillations of ≥25 L | 2 |
| 32 | Roads curve | No axis-aligned straight road; corners radiused 4–8 m | 2 |
| 33 | Kerb geometry | Extruded 0.15–0.20 m kerb casting its own shadow, with red paint on corner arcs | 2 |
| 34 | Greeble density | Sobel \|∇\|>25 coverage 28–36% on units, 40–46% on buildings | 2 |
| 35 | Terraced relief | Relief is 4–8 m discrete steps with coping caps or striated cliffs; no smooth Perlin hills | 2 |
| 36 | No CA / no grain | R/B-vs-G edge registration 0.0 px at corners; flat-patch noise is albedo detail only | 1 |
| 37 | Vignette | Corner mean luminance 0.80–0.87 of centre, flat inside r=0.55 | 1 |
| 38 | HUD budget | HUD occupies 12–16% of frame; centre and lower-left third clear | 1 |
| 39 | Per-instance jitter | No two adjacent trees identical; scale 0.8–1.25×, visible hue/value spread | 1 |
| 40 | Faceted cylinders | Barrels/stacks show 12–16 facets, not smooth 32-segment tubes | 1 |

---

## 14. TOP RISKS

Brutally honest failure modes for a procedural remake, each with the mitigation that actually works.

**R1 — Units ship as untextured grey primitives because nobody wrote the greeble pass. (Severity:
fatal.)** This is the default outcome. `RoundedBoxGeometry` + a flat colour is 30 minutes of work;
panel lines, rivets, bevel highlights, cavity darkening and decals are days. The render will look
like a programmer-art prototype and every critic will say so in the first sentence.
*Mitigation:* build the canvas-texture greeble generator **before** the first unit — a shared module
that takes (base colour, panel-line layout, rivet spline, bevel mask, decal list) and emits
albedo/AO/roughness canvases. Gate unit merges on the measured Sobel test (scorecard #34): a unit
below 22% edge coverage does not land.

**R2 — The scene comes out bright, flat and grey-green — "generic mobile RTS". (Severity: fatal.)**
Every default in Three.js pushes here: `AmbientLight`, no tonemapping, `MeshStandardMaterial` with no
env map, a green `#4CAF50` plane. Median luminance lands at 0.45+, mean saturation at 0.30.
*Mitigation:* ship the config in §15 on day one and wire an automated grade probe into the screenshot
harness that prints median/mean/p1/p99/meanSat on every capture. If any is out of tolerance, the
build is red. **Ban `AmbientLight` with an ESLint rule.**

**R3 — Terrain is a big empty plane. (Severity: fatal.)** Prop scatter is always the last system
written and the first cut. RA3's city reference carries **106 discrete props on 1.3 hectares**; a
procedural remake ships 8 rocks.
*Mitigation:* implement the **25×25 m ship-blocking rule** as an automated map validator that
rasterises adornment coverage and fails the map if any empty patch exceeds it. Build the scatter
system in week one with instanced meshes, before any unit art.

**R4 — The camera drifts to orthographic-ish. (Severity: fatal.)** A programmer building an RTS
reaches for `OrthographicCamera` or a 60° FOV at a steep angle because it "feels like an RTS". Either
kills the ±20°→±40° grid sweep and the 2× top/bottom size gradient, which are the two most
recognisable RA3 signatures.
*Mitigation:* the camera constants in §15 are frozen and covered by a unit test that asserts the
computed grid-axis angle at row 0 and row H and the top/bottom size ratio. No `fov` animation
anywhere in the codebase.

**R5 — Someone "fixes" the darkness. (Severity: fatal.)** Playtesters will say the game is too dark
and hard to read. The instinctive fix — raise exposure, add ambient, lighten the ground — destroys
the entire look, because RA3's readability comes from *contrast* (dark base, screaming accents), not
from brightness.
*Mitigation:* readability problems get solved by **selection rings, contact darkening, rim light and
team-colour slabs**, never by global exposure. Put the six grade numbers in the README as a contract.

**R6 — VFX read as sprites pasted on top of the scene. (Severity: major.)** Additive quads with no
scene-light injection look exactly like a particle demo. The measured evidence is unambiguous: RA3's
pavement takes a `#4560A3` blue wash from beams and `#B5501C` orange from fireballs in the same frame.
*Mitigation:* the pooled `PointLight` manager (§8.9) is a **prerequisite** for the first weapon, not a
polish item. Acceptance test #28 is automated: sample the ground before and during a beam.

**R7 — Water becomes a mirror. (Severity: major.)** The moment someone adds a reflection probe or SSR
at default strength, the water median jumps past L=115, the foam stops popping, and the naval maps
read as a mobile game. This is also the exact place the mission brief's "beat RA3 with SSR" instinct
does the most damage.
*Mitigation:* RULING #7 — SSR mix hard-clamped to ≤0.10 in the shader with no sky term, plus an
automated water-luminance probe (scorecard #25).

**R8 — Procedural geometry produces mush instead of readable silhouettes. (Severity: major.)**
Code-generated units drift toward either 40 tiny boxes (noise) or 3 plain boxes (nothing). RA3's rule
is 3–5 masses, one dominant feature at 35–50% of area, top-heavy, oversized turret.
*Mitigation:* build every unit from a **declarative mass list** (name, primitive, dimensions, anchor)
and validate at load time: mass count 3–6, dominant mass fraction 0.35–0.50, centre of visual mass at
0.60–0.70 height, turret/hull width 0.75–0.95. Reject at build time, not in review.

**R9 — Shadow quality collapses at zoom-out. (Severity: major.)** A fixed shadow ortho box sized for
the default zoom goes to 4× the area at max zoom and the penumbra blows out to 8 px with visible
crawling.
*Mitigation:* refit the shadow frustum to the camera frustum's ground intersection every frame, 3
cascades, and assert the measured penumbra width in the screenshot harness at min, default and max zoom.

**R10 — The reconciled material model gets simplified back to `MeshStandardMaterial`. (Severity:
major.)** Someone will notice `MeshPhysicalMaterial` is slower and swap it, or set `envMapIntensity: 0`
while debugging and never restore it. Both remove the waxy specular and the silhouette rim, which is
half of why RA3 units read as toys.
*Mitigation:* material presets live in the config as a frozen table (§15), constructed only through a
factory function. Scorecard #23 (rim light) is checked on every unit render.

**R11 — The key light gets locked to world space and shadows point the wrong way when the camera
rotates. (Severity: moderate.)** With free yaw, a world-fixed sun means shadows run screen-right on
half the rotations, which no RA3 frame ever shows.
*Mitigation:* bind key azimuth to `cameraYaw + 118°` (§3.2). Document it loudly as the deliberate
cheat it is, so nobody "fixes" it later.

**R12 — Faction identity blurs because team colour is applied as a hull tint. (Severity: moderate.)**
The easy implementation is `material.color = factionColor`. RA3 uses 8–14% flat slabs plus one
insignia on an olive/grey/white base.
*Mitigation:* the unit factory takes `teamSlabs: MassRef[]` and asserts the resulting surface-area
fraction is inside R-T1's band; the base paint slot cannot accept a faction colour at all.

---

## 15. THE CONFIG

```ts
// src/core/config.ts
// RA3 LOOK BIBLE — every number the visual spec defines, in one retunable block.
// Units: metres. 1 tank length (TL) = 7 m. Angles in degrees unless suffixed Rad.
// Pixel figures are quoted at 2560x1440 and scale by (renderHeight / 1440).

export const RA3 = {

  meta: {
    version: '1.0',
    referenceResolution: [2560, 1440] as [number, number],
    tankLengthMeters: 7,
    worldUnitsPerMeter: 1,
  },

  // ─────────────────────────────────────────── CAMERA
  camera: {
    projection: 'perspective' as const,   // NEVER orthographic
    fovVerticalDeg: 34,                   // fixed forever; zoom by dolly, never by fov
    near: 1.0,
    far: 600,
    pitchDeg: 39,                         // below horizontal, constant at all zooms
    yawDefaultDeg: 45,                    // free 0..360, snap key returns here
    rollDeg: 0,                           // exactly zero, always
    height: { default: 50, min: 32, max: 72 },
    zoom: { stepMultiplier: 1.10, notches: 9, springDampingSeconds: 0.15 },
    // validation targets at default zoom, 2560x1440, frame-centre row
    targets: {
      centreRowWidthMeters: 86,
      nearEdgeWidthMeters: 55,
      farEdgeWidthMeters: 158,
      metersPerPixelAtCentre: 7 / 207,
      sevenMetersAcrossScreenPx: 207,
      sevenMetersUpScreenPx: 122,
      infantryHeightPx: 59,
      topBottomSizeRatio: 2.01,           // accept 1.6 .. 2.4
      gridAxisAngleDeg: { row0: 20.5, row480: 28.7, row720: 32.2, row960: 35.2, row1440: 39.7 },
      horizonMinPxAboveTopEdge: 1100,
    },
    shadowFrustumFit: { marginPercent: 10, refitEveryFrame: true },
  },

  // ─────────────────────────────────────────── LIGHTING
  lighting: {
    ambientLightAllowed: false,           // hard ban — HemisphereLight only
    key: {
      colorHex: 0xFFD08C,
      intensity: 3.1,
      elevationDeg: 33,
      // azimuth is bound to the camera so shadows always run screen-left+down
      azimuthFollowsCamera: true,
      azimuthOffsetFromCameraYawDeg: 118,
      screenSpaceShadowVector: [-0.95, 0.25] as [number, number],
      shadowLengthOverCasterScreenHeight: [1.5, 2.2] as [number, number],
    },
    fill: {
      type: 'hemisphere' as const,
      skyColorHex: 0x6DA0F5,
      groundColorHex: 0x7A6440,
      intensity: 1.00,
    },
    ratios: {
      keyToFillLuminance: 2.22,
      keyWarmthOverFillRB: 3.7,
      shadowOverLitLuminance: 0.33,
      shadowOverLitPerChannel: [0.228, 0.321, 0.522] as [number, number, number],
      shadowTintNormalised: [0.44, 0.62, 1.00] as [number, number, number],
    },
    shadows: {
      enabled: true,
      type: 'PCFSoft' as const,           // never VSM / PCSS
      mapSize: 4096,
      cascades: 3,
      cascadeLambda: 0.6,
      radius: 2,                          // ~2 px penumbra at 1440p; never exceed 3
      bias: -0.0005,
      normalBias: 0.02,
      penumbraTargetPx: [2.0, 2.5] as [number, number],
      darkeningMultiplier: 1.0,           // NEVER darken shadows artificially
    },
    contactDarkening: {                   // per-unit ground decal — units float without it
      enabled: true,
      radiusOverFootprint: [0.55, 0.70] as [number, number],
      peakAlpha: 0.35,
      colorHex: 0x101418,
      blend: 'multiply' as const,
      gradient: 'radial' as const,
    },
    bakedCreaseAO: {
      multiplyAmbientOnly: true,
      creaseFloor: [0.35, 0.50] as [number, number],
      lineWidthPx: [1, 2] as [number, number],
    },
    environment: {                        // procedural PMREM cube, no external asset
      cubeSizePx: 128,
      topHex: 0x6DA0F5,
      horizonHex: 0xB7C6D0,
      bottomHex: 0x6E5F42,
      rimLightLuminanceGain: [0.12, 0.25] as [number, number],
      rimLightWidthPx: [1, 3] as [number, number],
    },
  },

  // ─────────────────────────────────────────── GRADE & POST
  grade: {
    outputColorSpace: 'srgb' as const,
    toneMapping: 'ACESFilmic' as const,   // not Reinhard, not None
    exposure: 0.92,
    targets: {
      medianLuminance: 0.317, medianRange: [0.26, 0.40] as [number, number],
      meanLuminance: 0.353,   meanRange:   [0.30, 0.42] as [number, number],
      p1Luminance: 0.022,     p1Max: 0.06,
      p95Luminance: 0.797,    p99Min: 0.90,
      meanHsvSaturation: 0.512, satRange: [0.42, 0.68] as [number, number],
      saturatedPixelFractionMin: 0.35,    // S>0.35 && V>0.25
      clippedPixelFractionMax: 0.01,
    },
    colorGrade: {
      shadowTintHex: 0x3A4050, shadowTintWeight: 0.06,   // tint only — do NOT lift blacks
      midTintHex:    0xFFE9C0, midTintWeight:    0.10,
      highTintHex:   0xFFFCF0, highTintWeight:   0.04,
      contrastPivot: 0.32,
      contrastSlope: 1.12,
      vibrance: 0.30,                     // vibrance, NEVER global saturate()
      vibranceMask: { smoothstepLo: 0.55, smoothstepHi: 0.95 },
    },
    bloom: {
      space: 'post-tonemap-srgb' as const,
      strength: 0.62,
      radius: 0.36,                       // tight — never exceed 0.45
      threshold: 0.82,
      softKnee: 0.55,
      linearHdrAlternative: { strength: 0.55, radius: 0.34, threshold: 1.05 },
      haloRadiusFractionOfFrameWidth: [0.032, 0.038] as [number, number],
      halfFalloffOverCoreRadius: 1.5,
    },
    vignette: { radius: 0.62, smoothness: 0.55, darkness: 0.20, cornerOverCentre: [0.80, 0.87] as [number, number] },
    chromaticAberration: 0.0,             // measured exactly zero — do not add
    filmGrain: 0.0,                       // measured exactly zero — do not add
    depthOfField: false,
    motionBlur: false,
    antialiasing: { msaaSamples: 8, taa: true, fxaaFallback: true },
    fog: { daylight: null, optionalExpDensity: 0.0015, optionalColorHex: 0x2A3038,
           maxFarEdgeLuminanceLoss: 0.08, maxFarEdgeSaturationLoss: 0.03 },
    sky: { renderSkybox: false, renderSunDisc: false, horizonFade: false },
  },

  // ─────────────────────────────────────────── MATERIALS
  materials: {
    geometryDefaults: {
      roundedBoxSegments: 3,
      bevelRadiusOverMinDim: 0.025,       // 1.5–3% of the part's smallest dimension
      cylinderRadialSegments: 14,         // 12–16 — never 32
      sphereSegments: [16, 12] as [number, number],
      bevelHighlightPx: [2, 4] as [number, number],
      bevelHighlightValueGain: 0.22,
      bevelHighlightSaturationLoss: 0.15,
    },
    panelLines: {
      widthPx: [1.5, 3] as [number, number],
      perMajorFace: [6, 14] as [number, number],
      crossCuts: [2, 4] as [number, number],
      grooveDarkening: 0.45,
      sunSideLipPx: 1,
      uniformGridForbidden: true,
    },
    cavityWear: {
      recessAlbedoMultiplier: [0.28, 0.38] as [number, number],
      hueShiftTowardShadowPercent: 8,
      bakedNotSSAO: true,
    },
    grimeOnVehicles: 0.0,                 // zero streaks, mud, rust, scratches — ever
    rustOnBuildingsOnly: { streakHex: 0x6A4528, baseHex: 0x2C2A22, coverage: [0.25, 0.40] as [number, number],
                           allowedOn: ['stack', 'pipe', 'scaffold'] },
    greebleDensitySobel: { units: [0.28, 0.36] as [number, number], buildings: [0.40, 0.46] as [number, number],
                           hardMin: 0.22, hardMax: 0.50, threshold: 25 },
    greebleBudgetPerUnit: { objects: [6, 10] as [number, number], decals: [2, 4] as [number, number], minFeaturePx: 3 },

    presets: {
      // RULING #3: broad diffuse lobe + weak tight clearcoat reconciles both measurements
      PAINT_ALLIED:  { color: 0xB9BCC4, roughness: 0.52, metalness: 0.00, clearcoat: 0.30, clearcoatRoughness: 0.38, envMapIntensity: 0.80 },
      PAINT_SOVIET:  { color: 0x4A6B33, roughness: 0.56, metalness: 0.00, clearcoat: 0.26, clearcoatRoughness: 0.45, envMapIntensity: 0.80 },
      PAINT_EMPIRE:  { color: 0xD8DCE0, roughness: 0.50, metalness: 0.00, clearcoat: 0.32, clearcoatRoughness: 0.36, envMapIntensity: 0.80 },
      TRIM_ALLIED:   { color: 0x2A2ED0, roughness: 0.48, metalness: 0.05, clearcoat: 0.32, clearcoatRoughness: 0.38, envMapIntensity: 0.80 },
      TRIM_SOVIET:   { color: 0xE01418, roughness: 0.50, metalness: 0.05, clearcoat: 0.28, clearcoatRoughness: 0.40, envMapIntensity: 0.80 },
      TRIM_EMPIRE_O: { color: 0xFF9612, roughness: 0.50, metalness: 0.02, clearcoat: 0.32, clearcoatRoughness: 0.38, envMapIntensity: 0.80 },
      TRIM_EMPIRE_Y: { color: 0xF5E024, roughness: 0.52, metalness: 0.02, clearcoat: 0.32, clearcoatRoughness: 0.38, envMapIntensity: 0.80 },
      GUNMETAL:      { color: 0x4A443C, roughness: 0.32, metalness: 0.82, clearcoat: 0.00, envMapIntensity: 0.95 },
      TRACK_RUBBER:  { color: 0x14171A, roughness: 0.85, metalness: 0.05, clearcoat: 0.00, envMapIntensity: 0.55 },
      ROLLER_BRASS:  { color: 0xDEC89F, roughness: 0.38, metalness: 0.75, clearcoat: 0.00, envMapIntensity: 0.95 },
      GLASS_CANOPY:  { color: 0x3E5A78, roughness: 0.10, metalness: 0.00, clearcoat: 0.60, clearcoatRoughness: 0.08, envMapIntensity: 1.00, transmission: 0.25 },
      GLOW_CYAN:     { color: 0x0A2A2A, emissive: 0x13E0D9, emissiveIntensity: 2.0, roughness: 0.30, metalness: 0.0 },
      GLOW_AMBER:    { color: 0x2A1405, emissive: 0xFF7A1E, emissiveIntensity: 2.2, roughness: 0.35, metalness: 0.0 },
      TERRAIN:       { roughness: 0.88, metalness: 0.00, envMapIntensity: 0.35 },
      CONCRETE_PAD:  { color: 0xB0AC9E, roughness: 0.90, metalness: 0.00, envMapIntensity: 0.30 },
      DECK_STEEL:    { color: 0x7E7A6E, roughness: 0.62, metalness: 0.55, envMapIntensity: 0.70 },
      PAD_ALLIED:    { color: 0x141518, roughness: 0.80, metalness: 0.10, envMapIntensity: 0.25 },
    },
  },

  // ─────────────────────────────────────────── FACTIONS
  factions: {
    allied: {
      base:      { lit: 0xB9BCC4, mid: 0x6E7C8A, shadow: 0x33363E },
      team:      { albedo: 0x2A2ED0, secondary: 0x5B63E8, lit: 0x3224FD, shadow: 0x1C169A },
      emissive:  { primary: 0x8DD9CD, peak: 0x9DFEF5, intensity: 1.6 },
      padHex: 0x141518,
      shape: { skirtFlare: [1.25, 1.40] as [number, number], wallSlopeDeg: [18, 25] as [number, number],
               cornerRadiusOverMinDim: [0.06, 0.10] as [number, number], pairedModules: true,
               crownWidthOverBase: [0.45, 0.55] as [number, number], crownHeightFraction: 0.30,
               horizontalBands: [3, 5] as [number, number], bandDepthPercent: 3 },
    },
    soviet: {
      base:      { lit: 0x6C8A3E, mid: 0x4A6B33, shadow: 0x1E2C16 },
      team:      { albedo: 0xE01418, secondary: 0x8E0A12, lit: 0xFF1A0A, shadow: 0x7C1212 },
      emissive:  { primary: 0xFF7A1E, peak: 0xFFB05A, intensity: 2.2 },
      scaffoldHex: 0xE5CB43, scaffoldMedianHex: 0x919932,
      deckHex: 0x7E7A6E, apronHex: 0xB0AC9E, apronDecalHex: 0xD02E1C,
      shape: { chamferOverWidth: [0.06, 0.09] as [number, number], heightOverWidth: 0.75,
               cornerRailDiameterOverWallHeight: [0.10, 0.14] as [number, number],
               stacks: [2, 3] as [number, number], stackDiameterOverWidth: [0.08, 0.12] as [number, number],
               stackHeightOverBuildingHeight: [0.35, 0.55] as [number, number], stackTaper: 0.85,
               vesselRadiusOverWidth: [0.20, 0.30] as [number, number],
               rivetDiameterPx: [3, 5] as [number, number], rivetPitchPx: [10, 14] as [number, number],
               rivetEdgeCoverage: 0.60 },
    },
    empire: {
      base:      { lit: 0xD8DCE0, highlight: 0xFEFEFE, mid: 0x9DA6AF, shadow: 0x6A7581, secondary: 0x3A3D55 },
      team:      { orange: 0xFF9612, orangeLit: 0xFFAA15, yellow: 0xF5E024, yellowLit: 0xFFE524, shadow: 0x7A511D },
      emissive:  { primary: 0x13E0D9, peak: 0x9BF6D3, intensity: 2.0 },
      decals:    { sunDiscHex: 0xDF4C1B, sunRaysHex: 0xB82D1F, rays: 16, kanjiPlateHex: 0xC11D12, solarPanelHex: 0x364BC0 },
      padHex: 0xFDC437, padOutlineHex: 0xE8E4D2,
      shape: { pagodaTiers: 4, tierWidthRatio: [0.70, 0.75] as [number, number], tierHeightFraction: [0.22, 0.28] as [number, number],
               eaveThicknessFraction: [0.04, 0.06] as [number, number], eaveOverhang: [0.12, 0.18] as [number, number],
               eaveCornerKickDeg: [12, 20] as [number, number],
               plateCreaseDeg: [15, 35] as [number, number], plateGapPx: [2, 3] as [number, number], plateGapHex: 0x2A2C30,
               forwardWedgeAspect: [3.5, 5.0] as [number, number], forwardWedgeLengthFraction: [0.55, 0.65] as [number, number],
               outriggers: [4, 6] as [number, number], outriggerSplayDeg: 25, ballOverLegDiameter: 2.2,
               pipingDiameterOverWidth: [0.03, 0.04] as [number, number] },
    },
    teamColorRules: {
      surfaceFractionVehicle: [0.08, 0.14] as [number, number],
      surfaceFractionWalker:  [0.20, 0.28] as [number, number],
      surfaceFractionBuilding:[0.05, 0.08] as [number, number],
      insigniaCount: 1,
      insigniaWidthOverHullWidth: [0.08, 0.14] as [number, number],
      appliesToFaces: ['top', 'outward'] as const,
      asFlatSlabsNotTint: true,
      emissiveSurfaceFraction: [0.01, 0.03] as [number, number],
    },
  },

  // ─────────────────────────────────────────── UNIT / BUILDING SCALE
  scale: {
    gridCellMeters: 7,                    // 1 cell = 1 tank hull
    footprintCells: { small: 3, production: 4, superweapon: 6 },
    tankHullMeters: 7,
    heavyTankHullMeters: 11,
    mcvHullMeters: 16,
    infantryHeightMeters: 2.2,
    productionFootprintMeters: [12, 22] as [number, number],
    rules: {
      tankHullOverStructureFootprint: [0.45, 0.55] as [number, number],   // hard min 0.30
      tankSilhouetteOverStructureSilhouette: [0.50, 0.62] as [number, number],
      utilityBuildingOverTankLength: [1.15, 1.30] as [number, number],
      infantryOverTankHull: [0.30, 0.38] as [number, number],
    },
    silhouette: {
      primaryMasses: [3, 5] as [number, number], hardMax: 6,
      dominantFeatureAreaFraction: [0.35, 0.50] as [number, number],
      turretOverHullWidth: [0.75, 0.95] as [number, number],
      visualMassCentreHeightFraction: [0.60, 0.70] as [number, number],
      superstructureHeightFraction: [0.55, 0.65] as [number, number],
      trackProudFractionOfHullWidth: [0.08, 0.14] as [number, number],
      trackHeightFractionOfUnit: [0.18, 0.25] as [number, number],
      wheelDiameterOverHullLength: 0.22,
    },
  },

  // ─────────────────────────────────────────── TERRAIN
  terrain: {
    textureExaggeration: 2.5,             // RA3 oversizes ground features 2–3x. Copy this.
    highFrequencyAlbedoDetail: [0.03, 0.06] as [number, number], // ±3–6% per-pixel luminance
    relief: { playableSwellMeters: [0.4, 0.8] as [number, number], swellWavelengthMeters: [15, 30] as [number, number],
              terraceStepMeters: [4, 8] as [number, number], tiersPerMap: [2, 4] as [number, number],
              smoothPerlinHillsForbidden: true },
    albedo: {
      grassLush: 0x5E6418, grassShadowed: 0x2C3309, grassDry: 0x8A7A44,
      dirt: 0x9C7B52, gravel: 0xA89A78, sand: 0xC4A878,
      asphalt: 0x46464A, asphaltWheelPath: 0x57575C,
      concrete: 0x9A968C, cobble: 0xB7ADA2, paverBand: 0xD6CFC6,
      brickPaving: 0x96674A, brickWall: 0x8E5A34,
      snow: 0xC4BAB2, rockWet: 0x35505C, rockDry: 0x7A7258,
      militaryPad: 0x8C8462, hedge: 0x2A3A16,
      roadPaintWhite: 0xD8D2C8, roadPaintYellow: 0xC9A227,
      kerb: 0xC0BAB0, kerbRed: 0xB03A2E, kerbYellowDash: 0xE0B12A,
      copingCap: 0xB8B0A6,
    },
    roughness: { grass: 0.95, dirt: 0.92, gravel: 0.88, sand: 0.90, asphalt: 0.75,
                 concrete: 0.70, cobble: 0.68, brick: 0.72, snow: 0.60, rock: 0.85 },
    patternScaleMeters: { grassBlade: 0.35, grassBlotch: 9, soilMacro: 32, dirtGrain: 0.25,
                          gravelStone: 0.14, sandRipple: 0.7, asphaltAggregate: 0.02,
                          concreteSlab: 1.2, cobbleSett: 0.85, cobbleJoint: 0.07,
                          brick: [0.35, 0.18] as [number, number], brickCourse: 0.22, snowDrift: 3.5,
                          rockStriation: 0.45 },
    joints: {
      manMadeToManMade: { type: 'hard-with-trim' as const,
        kerbTopFaceMeters: 0.28, kerbHeightMeters: [0.15, 0.20] as [number, number],
        cornerRadiusMeters: [4, 8] as [number, number],
        stoneKerbBandMeters: [0.4, 0.6] as [number, number], stoneKerbBrightnessGain: 0.18,
        soldierCourseMeters: 0.3, soldierCourseDarkening: 0.12 },
      naturalToNatural: { type: 'soft-splat' as const, blendWidthMeters: [1.5, 4.0] as [number, number],
        maskNoiseFeatureMeters: 0.8, maskDisplacementMeters: 0.6,
        isolatedIslandMeters: [1, 2] as [number, number], islandReachMeters: [3, 6] as [number, number],
        straightAlphaRampForbidden: true },
      naturalToManMade: { type: 'hard-plus-spill' as const, driftDecalMeters: [0.3, 1.0] as [number, number],
        propOverhangMeters: [0.5, 1.5] as [number, number] },
    },
    roads: {
      laneWidthMeters: [3.2, 3.5] as [number, number],
      splineOnly: true, bendRadiusMeters: [15, 40] as [number, number],
      centreLine: { stripeMeters: 0.12, gapMeters: 0.12, double: true },
      laneDash: { lengthMeters: 3.0, gapMeters: [2.5, 3.0] as [number, number], widthMeters: 0.12 },
      edgeLine: { widthMeters: 0.15, insetMeters: 0.25 },
      crosswalk: { barMeters: [0.45, 0.60] as [number, number], gapMeters: [0.45, 0.60] as [number, number],
                   stopLineMeters: 0.3, stopLineOffsetMeters: 1.5 },
      redKerbPaint: { arcLengthMeters: [6, 12] as [number, number], topFaceCoverMeters: 0.08 },
      yellowKerbDash: { dashMeters: 0.9, gapMeters: 0.45 },
      parkingBayMeters: [2.5, 5.0] as [number, number], baysPerRow: [8, 14] as [number, number],
      lotOccupancy: [0.55, 0.75] as [number, number],
      wear: { cracksPer10m: [1, 3] as [number, number], crackWidthMeters: [0.03, 0.08] as [number, number], crackHex: 0x1E1E22,
              patchMeters: [1.5, 4.0] as [number, number], patchPerSquareMeters: 40, patchLuminanceJitter: 0.12,
              manholeDiameterMeters: 0.7, manholePerMeters: 25,
              oilStainMeters: [2, 5] as [number, number], oilStainAlpha: 0.35 },
      lampPool: { diameterMeters: [6, 8] as [number, number], colorHex: 0xE8D089, alpha: 0.25 },
      tram: { gaugeMeters: 1.4, sleeperPitchMeters: 0.6 },
    },
    cliffs: {
      retainingWall: { brickHex: 0x8E5A34, courseMeters: 0.22, brickValueJitter: 0.14,
                       copingCapMeters: [0.5, 0.6] as [number, number], copingHex: 0xB8B0A6,
                       pilasterPitchMeters: [6, 8] as [number, number], pilasterWidthMeters: 0.8, pilasterProjectionMeters: 0.25,
                       setbackMeters: 2 },
      naturalRock: { faceAngleDeg: [78, 88] as [number, number], heightMeters: [6, 14] as [number, number],
                     striationWavelengthMeters: [0.4, 0.5] as [number, number], striationDepthMeters: 0.25,
                     grassLipThicknessMeters: [0.3, 0.8] as [number, number], lipOverhangMeters: [0.5, 1.5] as [number, number],
                     boulderDiameterMeters: [0.5, 1.5] as [number, number], bouldersPer10m: [3, 6] as [number, number],
                     wetBandMeters: 1.5, wetBandGloss: 0.25 },
    },
  },

  // ─────────────────────────────────────────── VEGETATION & SCATTER
  vegetation: {
    trees: {
      deciduous:  { canopyMeters: [7, 10] as [number, number], heightMeters: [9, 13] as [number, number],
                    summer: [0x4C6B1E, 0x3A5417, 0x6B8028], autumn: [0xC4761E, 0xA8531A, 0xD9A02C] },
      cypress:    { canopyMeters: [1.5, 2.5] as [number, number], heightMeters: [8, 12] as [number, number], colors: [0x1E2A0C, 0x2C3A12] },
      palm:       { canopyMeters: [5, 7] as [number, number], heightMeters: [6, 9] as [number, number], frond: 0x385601, trunk: 0x6B5433 },
      conifer:    { canopyMeters: [4, 6] as [number, number], heightMeters: [8, 14] as [number, number], colors: [0x111409, 0x243009] },
    },
    clustering: { treesPerClump: [3, 9] as [number, number], inClumpSpacingMeters: [4, 8] as [number, number],
                  betweenClumpsMeters: [20, 50] as [number, number], clumpDiameterMeters: [15, 30] as [number, number],
                  streetRowPitchMeters: [8, 12] as [number, number], kerbOffsetMeters: [1.5, 2.5] as [number, number] },
    jitter: { scale: [0.80, 1.25] as [number, number], yawDeg: [0, 360] as [number, number], tiltDeg: 4,
              hueDeg: 8, valuePercent: 18, saturationPercent: 12, seasonMix: 0.30 },
    tufts: { bladeCards: [14, 20] as [number, number], bladeWidthMeters: 0.15, bladeLengthMeters: [1.4, 1.8] as [number, number],
             footprintMeters: [2.0, 3.5] as [number, number], heightMeters: [1.5, 2.5] as [number, number],
             speciesGolden: [0xC8B84A, 0x7A6A2A], speciesGreen: [0x5E8B2E, 0x2E4A14], mix: 0.5, castShadows: true },
    flowers: { clumpMeters: [0.35, 0.6] as [number, number], colors: [0xC24BB8, 0xE8C63C], runLength: [2, 4] as [number, number], rowsDeep: [2, 3] as [number, number] },
    hedges: { heightMeters: [0.8, 1.0] as [number, number], thicknessMeters: 0.7, topNoiseMeters: 0.08, colorHex: 0x2A3A16 },
    animation: { canopyAmplitudeMeters: 0.15, canopyHz: 0.25, tuftAmplitudeMeters: 0.06, tuftHz: 0.6, perInstancePhase: true },
  },

  scatter: {
    // densities per hectare of ELIGIBLE surface — targets are 1.3x RA3 measured
    densityPerHectare: {
      deciduousWild: [45, 90] as [number, number], deciduousPark: [115, 155] as [number, number],
      cypress: [26, 52] as [number, number], conifer: [32, 58] as [number, number], palm: [15, 32] as [number, number],
      shrubClump: [180, 285] as [number, number], dryGrassTuft: [235, 390] as [number, number],
      flowerClump: [78, 155] as [number, number], hedgeRuns: [8, 13] as [number, number],
      streetLamp: [13, 23] as [number, number], bench: [8, 15] as [number, number], parkedCar: [6, 13] as [number, number],
      cafeUmbrella: [10, 18] as [number, number], hydrantBollard: [4, 8] as [number, number],
      crateBarrel: [10, 19] as [number, number], shippingContainer: [20, 45] as [number, number],
      boulderRubble: [39, 78] as [number, number], groundDecal: [325, 520] as [number, number],
    },
    sceneTargets: { cityPropsPerHectare: 105, wildernessPropsPerHectare: 260,
                    carnivalPropsPerHectare: 70, airbasePropsPerHectare: 40, airbaseDecalGroundFraction: 0.45 },
    adornment: { minGroundFraction: 0.55, maxEmptyPatchMeters: 25 },  // SHIP-BLOCKING RULE
    poissonRadiusMeters: { treeClump: 4, shrub: 2.5, tuft: 1.8, flower: 0.5 },
  },

  // ─────────────────────────────────────────── WATER
  water: {
    reflection: { skyReflection: false, planarMirror: false, ssrEnabled: true,
                  ssrMaxMix: 0.10, ssrFresnelExponent: 5.0, ssrSamplesSkybox: false },
    meanLuminanceRange0to255: [45, 115] as [number, number],   // >125 = FAIL
    palettes: {
      tropical: [0x3E7A6E, 0x1D4A44, 0x12332E, 0x0B2921, 0x041F1A, 0x00120E],
      coastal:  [0x5E8A92, 0x4C6A75, 0x265461, 0x1C3D4E, 0x0A2032],
      night:    [0x1D3676, 0x0B3660, 0x13224B, 0x001A42],
      medianTropical: 0x0D352D,
    },
    absorption: [0.62, 0.28, 0.20] as [number, number, number],   // Beer-Lambert, red dies first
    depthP50TL: 0.9, depthP10TL: 2.4,
    seabed: { visibleToTL: 1.5, invisibleBeyondTL: 2.0, blobSizeTL: [0.8, 4.0] as [number, number],
              contrastLuminance: [18, 25] as [number, number], refractionUvScale: 0.012,
              sandHex: 0x3E7A6E, reefHex: 0x1E4038 },
    waves: {
      swell: { wavelengthTL: [1.2, 2.5] as [number, number], amplitudeTL: 0.02, speedTLPerSec: 0.10 },
      chop:  { wavelengthTL: [0.10, 0.22] as [number, number], amplitudeTL: 0.006, speedTLPerSec: 0.35 },
      micro: { featurePx: [2, 4] as [number, number], normalMapOnly: true, speedTLPerSec: 0.9 },
      normalMapSizePx: 512, rotationsDeg: [0, 47, 113], crestSharpnessPow: 0.6, gerstnerQ: 0.55,
    },
    foam: {
      filamentWidthPx: [1.5, 4] as [number, number], filamentLengthPx: [20, 120] as [number, number],
      coverageCalm: [0.04, 0.08] as [number, number], coverageChoppy: [0.12, 0.16] as [number, number],
      threshold: [0.62, 0.78] as [number, number], fbmScale: 24, crestGain: 1.6,
      colorWarm: 0xE8DCC8, colorNeutral: 0xF1F1E9, colorNight: 0xB3AFFB, blend: 'normal' as const,
    },
    glint: { roughness: [0.045, 0.07] as [number, number], anisotropy: 1.6,
             dotSizePx: [3, 8] as [number, number], densityPerSquarePx: 1 / 3500 },
    shoreline: { bandWidthPx: [40, 80] as [number, number], coverage: 0.45,
                 coreHex: 0xB8CEDA, midHex: 0x7A96A6, localWaterHex: 0x3A5A66,
                 pulseAmplitude: 0.25, pulseHz: 0.45, scrollTLPerSec: 0.08, depthFadeTL: 0.35 },
    wakes: {
      accumulationBufferPx: 1024, decayPerFrame: 0.988, halfLifeSeconds: 4.0,
      sternChurnWidthOverHull: 1.3, sternChurnLengthOverHull: [1.4, 1.8] as [number, number],
      kelvinAngleDeg: 19, kelvinWidthPx: [2, 4] as [number, number], kelvinLengthHulls: [3.5, 5.0] as [number, number],
      bowWaveThicknessPx: [3, 5] as [number, number], bowWaveArcDeg: 35, bowWaveMinSpeedFraction: 0.40,
      vPersistSeconds: 4.5, churnDissipateSeconds: 2.0,
      hoverRingDiameterTL: 0.9, hoverDroplets: [6, 10] as [number, number],
    },
  },

  // ─────────────────────────────────────────── VFX
  vfx: {
    tankLengthPx1440: 207,                // 1 TL on screen at default zoom
    maxLiveParticles: 2500,
    instancedGroups: ['additive', 'normal'] as const,
    spriteAtlas: { gridSize: 4, sizePx: 1024, cells: ['radial','billow','streak','ring','star','filigree','crown','dash'] },

    emissiveMultipliers: {
      teslaCore: 8.0, teslaGlow: 3.5, teslaSpikes: 6.0,
      prismCore: 9.0, prismHalo: 3.0, cryo: 5.5,
      explosionFlash: 12.0, fireball: 5.0, shockwave: 3.0,
      muzzleFlash: 7.0, tracer: 4.0, ember: 4.5, flameTongue: 3.2, ventGlow: 2.4,
    },
    depthTest: { teslaBolt: false, everythingElse: true },

    explosion: {
      rampHex: [0xFFFAFF, 0xFFFFAF, 0xFEF5B0, 0xFDC578, 0xFF9350, 0xFE8149, 0xDB6D2E, 0xB5501C],
      rampStops: [0.00, 0.35, 0.50, 0.62, 0.74, 0.84, 0.92, 1.00],
      whiteCoreRadiusFraction: [0.50, 0.55] as [number, number],   // orange-cored fireball = instant fail
      flash:     { sizeTL: [1.8, 3.2] as [number, number], peakMs: 40, endMs: 140 },
      fireball:  { sprites: [8, 14] as [number, number], sizeTL: [0.9, 2.6] as [number, number], peakMs: 220, endMs: 750, spinDegPerSec: 35 },
      shockwave: { sizeTL: [0.4, 4.5] as [number, number], onsetMs: 30, endMs: 420,
                   thicknessPx: [6, 2] as [number, number], hex: [0xFFE8C0, 0xFFB060], alpha: [0.75, 0], groundScaleY: 0.12 },
      smoke:     { puffs: [14, 22] as [number, number], sizeTL: [1.2, 4.0] as [number, number], onsetMs: 120, endMs: 5500 },
      debris:    { chunks: [12, 20] as [number, number], sizeTL: [0.05, 0.14] as [number, number], coneDeg: 55,
                   speedTLPerSec: [5, 9] as [number, number], gravityTLPerSec2: 22, tumbleDegPerSec: 720,
                   trailFraction: 0.40, trailMs: 200, trailHex: 0xFF9A2E, endMs: 1600 },
      embers:    { count: [30, 60] as [number, number], sizeTL: [0.02, 0.04] as [number, number], endMs: 1900,
                   hex: [0xFFC83C, 0xE8500C], buoyancyTLPerSec: 0.6, flickerHz: 18 },
      scorch:    { sizeTL: [1.6, 2.4] as [number, number], aspect: 1.7, centreAlpha: 0.55, hex: 0x2A2118,
                   ringHex: 0x4A3A28, ringRadiusFraction: 0.80, featherFraction: 0.35, permanent: true, maxDecals: 200 },
      unitDeathTL: 2.2, structureDeathTL: [4.5, 6.0] as [number, number], structureFlashTL: 8.0,
      cookOff: { count: [3, 6] as [number, number], sizeTL: 1.2, intervalMs: 250, windowMs: [3000, 5000] as [number, number] },
    },

    tesla: {
      rampHex: [0xFFFFFF, 0xE8F0FF, 0xA8C4FF, 0x6E8CFF, 0x3F5FE8, 0x1326B3, 0x0A1450],
      rampStops: [0.00, 0.08, 0.18, 0.32, 0.55, 0.80, 1.00],
      alphaPow: 2.2,
      coreWidthPx: [2, 3] as [number, number], coreMinLuminance: 248,
      segments: [8, 14] as [number, number], segmentLengthPx: [15, 25] as [number, number],
      jitterFractionOfLength: 0.06, midpointLevels: 3, midpointRoughness: 0.55,
      branches: [4, 8] as [number, number], branchSpawnProbability: 0.35,
      branchLengthFraction: [0.25, 0.50] as [number, number], branchRejoinProbability: 0.30,
      branchWidthRatio: 0.55, branchDepth: 2,
      overlappingPaths: [3, 5] as [number, number],
      instanceLifeMs: [90, 140] as [number, number], rerollMs: 50, beamDurationMs: [900, 1400] as [number, number],
      muzzleFlareHex: 0xDFF6FF, muzzleFlarePx: [22, 28] as [number, number],
      impact: { coreHex: [0xFFFFFF, 0xD4FFFF, 0x8BE0FD, 0x5D9CFF], radiusPx: [35, 45] as [number, number], lifeMs: 180,
                spikes: [14, 20] as [number, number], spikeWidthPx: [2, 4] as [number, number], spikeLengthPx: [60, 140] as [number, number],
                spikeHex: 0xA8E4FF, spikeLifeMs: 220, longSpikes: 4, longSpikeMultiplier: 2.0 },
    },

    beams: {
      prism: { coreWidthPx: 3.5, innerWidthPx: 33, haloWidthPx: 64, falloffEndPx: 74,
               rampHex: [0xFFFFFF, 0xF1FEF5, 0xA7F5F9, 0xA2D2FF, 0x81B3FC, 0x6597DE, 0x547BC0],
               rampStops: [0.00, 0.05, 0.15, 0.30, 0.48, 0.70, 0.88],
               durationMs: [1200, 2000] as [number, number], openMs: 60, closeMs: 180,
               breatheAmplitude: 0.08, breatheHz: 11, taperAtTarget: 0.88,
               outerQuadScale: 2.2, outerQuadAlpha: 0.35,
               muzzleCorePx: 30, lensStreakPx: [140, 6] as [number, number] },
      cryo:  { coreHex: 0xEAF7FF, coreWidthPx: [5, 7] as [number, number], sheathHex: 0x4FA8F0, sheathWidthPx: 14,
               glowHex: 0x1E5EC8, glowWidthPx: 28, jitter: 0, taper: 0,
               iceShell: { hex: 0xB8E4F2, alphaMax: 0.7, rampSeconds: 2.5, shards: [6, 10] as [number, number],
                           roughness: 0.15, transmission: 0.4 } },
      designator: { coreHex: 0xC8FF6E, coreWidthPx: 3, glowHex: 0x5AE02A, glowWidthPx: 10,
                    shroudScale: 1.35, shroudHex: 0x8FE24A, shroudAlpha: [0.30, 0.38] as [number, number],
                    tendrils: [5, 8] as [number, number], tendrilRiseTL: 0.4, tendrilLifeMs: 900, quadLayers: 6, scrollPerSec: 0.5 },
    },

    guns: {
      muzzleFlash: {
        light:  { sizePx: [50, 28] as [number, number], coreHex: 0xF8FAFF, outerHex: 0xBCD4EE, durationMs: 70 },
        medium: { sizePx: [50, 50] as [number, number], coreHex: 0xFFF6C8, outerHex: 0xFFC940, durationMs: 90 },
        heavy:  { sizePx: [120, 70] as [number, number], coreHex: 0xFFF3C0, outerHex: 0xFFC940, outer2Hex: 0xE8871E, durationMs: 110 },
        scaleCurveMs: [0, 15, 60, 100], scaleCurve: [0, 1.0, 0.85, 0],
        minLengthOverBarrelDiameter: 4,
        smoke: { puffs: [2, 4] as [number, number], spawnMs: 40, hex: 0x9A9490,
                 radiusPx: [18, 55] as [number, number], alpha: [0.55, 0] as [number, number], lifeMs: 900,
                 driftTLPerSec: 0.25, riseTLPerSec: 0.1 },
        sparks: { count: [8, 14] as [number, number], hex: 0xFFC83C, sizePx: [2, 3] as [number, number],
                  coneDeg: 60, speedTLPerSec: 2, lifeMs: 400 },
      },
      tracerMG: { lengthPx: [25, 65] as [number, number], widthPx: [2.5, 4] as [number, number], aspect: 14,
                  warmHex: [0xFFD26A, 0xFF9A2E, 0xE8781C], coldHex: [0xFFFFFF, 0xC8E4FF, 0x6FA8FF],
                  burst: [3, 6] as [number, number], intraBurstMs: [55, 90] as [number, number], gapMs: [450, 900] as [number, number],
                  visibleRoundFraction: 0.33, speedTLPerSec: 9, shape: 'tapered-lozenge' as const },
      tracerMain: { lengthPx: [95, 130] as [number, number], headWidthPx: [7, 9] as [number, number], taperFraction: 0.40,
                    rampHex: [0xFFF0B8, 0xFFD86A, 0xFF9A2E, 0xC85B22], speedTLPerSec: 14,
                    smokeRibbonHex: 0x8A8078, smokeRibbonAlpha: 0.25, smokeRibbonFlightFraction: 0.30 },
      armourSparks: { streaks: [30, 45] as [number, number], widthPx: 2, lengthPx: [60, 180] as [number, number],
                      fanDeg: 140, upwardBias: true, rampHex: [0xFFF8D8, 0xF6E9B0, 0xD8B860],
                      lifeMs: 420, peakMs: 90, gravityTLPerSec2: 0.4, flashDiscPx: 20, flashMs: 60 },
      sustainedHitSparks: { dots: [40, 60] as [number, number], hex: 0xFFC83C, sizePx: [2, 3] as [number, number],
                            lifeMs: 500, gravityTLPerSec2: 18, ratePerSec: 25 },
    },

    trails: {
      beadChainRequired: true,            // never continuous ribbons
      coldVapour: { spawnEveryPx: [16, 20] as [number, number], radiusPx: [5, 14] as [number, number],
                    hex: [0xE4E8EC, 0xC0C6CC], alpha: [0.85, 0] as [number, number], lifeMs: 2600,
                    blend: 'normal' as const, totalLengthTL: [3.7, 4.4] as [number, number], spinDegPerSec: 12 },
      hotRocketFlame: { spawnEveryPx: 14, radiusPx: [10, 26] as [number, number], hex: [0xFFAE3A, 0xFF7C10],
                        alpha: [0.9, 0] as [number, number], lifeMs: 380, blend: 'additive' as const,
                        extentPx: 180, spinDegPerSec: 40 },
      hotRocketSmoke: { spawnEveryPx: 14, radiusPx: [14, 48] as [number, number], hex: [0x6A6560, 0x8A857E],
                        alpha: [0.7, 0] as [number, number], lifeMs: 3200, blend: 'normal' as const,
                        totalLengthTL: [4.4, 5.3] as [number, number], spinDegPerSec: 18 },
      missileExhaustHex: 0xDFF0FF, missileExhaustPx: [14, 6] as [number, number], exhaustFlicker: 0.20, exhaustHz: 25,
      minScanlineOscillations: 6, minOscillationLuminance: 25,
    },

    smoke: {
      wreck:     { coreHex: 0x1A1A1A, midHex: 0x2A2622, litEdgeHex: 0x4A4A4A, sunlitRimHex: 0x8A8580 },
      structure: { coreHex: 0x3B3537, midHex: 0x5A4E42, fireLitUndersideHex: 0x926339 },
      exhaust:   { coreHex: 0xC6C6C0, midHex: 0xD8D8D2 },
      lobes: [8, 14] as [number, number], columnHeightTL: [1.9, 2.7] as [number, number],
      baseWidthPx: 30, topWidthPx: [90, 110] as [number, number], minWideningRatio: 3.0,
      alphaBase: 0.85, alphaTop: 0.15,
      emissionMs: 160, initialRadiusPx: 16, growthPxPerSec: 28,
      riseTLPerSec: 0.55, driftTLPerSec: 0.25, lifeMs: 4500, spinDegPerSec: 25,
      lit: true, shadowTintHex: 0x14120F, litTintHex: 0x8A857E,
    },

    damageStates: {
      healthy: { min: 0.66 },
      damaged: { max: 0.65, puffMs: 600, hex: 0x8A857E, alpha: 0.35, riseTL: 0.9 },
      critical: { max: 0.32, puffMs: 220, flameTongues: [2, 4] as [number, number],
                  flameHex: [0xFFB020, 0xFF6A00], flameHeightTL: [0.21, 0.37] as [number, number], flickerHz: 12, quadsPerTongue: 3 },
      structure: { smokeColumns: [1, 3] as [number, number], ventGlowHex: 0xFFB01E, ventHaloPx: 55 },
      wreck: { albedoMultiplier: 0.22, roughness: 0.9, burnSeconds: [8, 12] as [number, number],
               flameTongues: [3, 5] as [number, number], smokeOnlySeconds: 12, persists: true },
    },

    dynamicLights: {
      poolSize: 12, priority: 'distanceToCamera * intensity' as const,
      explosion:  { hex: 0xFFB05A, intensity: 28, rangeTL: 7.0, riseMs: 40, fallMs: 500 },
      muzzle:     { hex: 0xFFD28A, intensity: 12, rangeTL: 2.5, riseMs: 10, fallMs: 90 },
      teslaImpact:{ hex: 0x5A82FF, intensity: 14, rangeTL: 3.5, riseMs: 30, fallMs: 200 },
      beam:       { hex: 0x6FA8FF, intensity: 9,  rangeTL: 6.0, followsBeam: true },
      burningWreck:{hex: 0xFF7A28, intensity: 4,  rangeTL: 2.5, flickerAmplitude: 0.30, flickerHz: 7 },
      minGroundLuminanceShift: 35,        // acceptance: ground within 200px must shift >= 35 L
    },

    groundFx: {
      treadDust: { hex: 0xC6C6C0, dryEarthHex: 0xB8A484, snowHex: 0xE8ECF0,
                   alpha: [0.40, 0.55] as [number, number], radiusPx: [10, 32] as [number, number],
                   lifeMs: 2800, spawnMs: 150, emittersPerVehicle: 2,
                   driftTLPerSec: 0.15, riseTLPerSec: 0.05,
                   pavedAlpha: 0.18, pavedRadiusScale: 0.6 },
      treadMarks: { widthPx: [6, 8] as [number, number], groundMultiply: 0.72, fadeSeconds: 35,
                    snowHex: 0xB4BCC8, grassCrushHex: 0x3A3A20 },
      waterImpact: { crownRadiusPx: 28, crownMs: 120, droplets: [6, 10] as [number, number],
                     dropletSpeedTLPerSec: 1.5, hex: [0xEAF4F6, 0xB8D4D8], lifeMs: 500,
                     rippleRadiusPx: 60, rippleSeconds: 1.4, rippleAlpha: [0.5, 0] as [number, number] },
      waterExplosion: { columnHeightTL: [1.4, 2.2] as [number, number], baseWidthTL: 0.8, lifeMs: 900,
                        hex: [0xF0F8F8, 0xC8DCDC], foamRingTL: 3.0, foamRingSeconds: 1.6, foamPersistSeconds: 5 },
      shellCasings: { sizePx: [2, 3] as [number, number], hex: 0xC8A048, perBurst: [4, 8] as [number, number],
                      ejectTLPerSec: 0.8, lifeMs: 1200, accumulates: false },
    },
  },

  // ─────────────────────────────────────────── HUD & COMPOSITION
  hud: {
    screenFraction: [0.12, 0.16] as [number, number],
    keepClear: ['centre', 'lower-left-third'] as const,
    minimapFraction: 0.091, portraitFraction: 0.026, creditsFraction: 0.03,
    selectionRings: 'ground-projected-decal' as const,   // never screen-space circles
    healthBars: 'screen-aligned-billboard' as const,
  },
  composition: {
    stageUnits: [15, 30] as [number, number], stageStructures: [6, 10] as [number, number],
    gameplayPixelShare: { units: [0.03, 0.08] as [number, number], structures: [0.10, 0.25] as [number, number], ground: [0.70, 0.85] as [number, number] },
    marketingPixelShare: { unitsPlusStructures: [0.35, 0.50] as [number, number] },
  },

  // ─────────────────────────────────────────── MAP PRESETS
  presets: {
    aridAirbase:  { key: 0xFFD08C, keyIntensity: 3.1, sunElevationDeg: 33, sky: 0x6DA0F5, ground: 0x7A6440, fillIntensity: 1.00, exposure: 0.92, shadowOverLit: 0.31, vibranceScale: 1.0 },
    temperateDay: { key: 0xFFD9A0, keyIntensity: 3.0, sunElevationDeg: 33, sky: 0x82AEEE, ground: 0x7A6440, fillIntensity: 1.00, exposure: 0.92, shadowOverLit: 0.32, vibranceScale: 1.0 },
    tropicalNoon: { key: 0xFFDCA8, keyIntensity: 3.2, sunElevationDeg: 36, sky: 0x7BAAF0, ground: 0x6E6030, fillIntensity: 1.05, exposure: 0.94, shadowOverLit: 0.40, vibranceScale: 1.0 },
    goldenHour:   { key: 0xFFA867, keyIntensity: 3.6, sunElevationDeg: 16, sky: 0x5C7ACC, ground: 0x4A3A2E, fillIntensity: 0.75, exposure: 0.86, shadowOverLit: 0.26, vibranceScale: 1.0, shadowLengthOverHeight: [3, 4] as [number, number] },
    overcastSnow: { key: 0xE8E4E0, keyIntensity: 2.0, sunElevationDeg: 42, sky: 0xAEBECE, ground: 0x7E7570, fillIntensity: 1.55, exposure: 0.96, shadowOverLit: 0.29, vibranceScale: 0.5 },
    moonlitNight: { key: 0xDCE2FF, keyIntensity: 1.5, sunElevationDeg: 40, sky: 0x3A4488, ground: 0x1E2450, fillIntensity: 1.30, exposure: 1.05, shadowOverLit: 0.46, vibranceScale: 0.9 },
  },

  // ─────────────────────────────────────────── HARD BANS
  forbidden: {
    ambientLight: true, skybox: true, sunDisc: true, greyFog: true,
    chromaticAberration: true, filmGrain: true, depthOfField: true, motionBlur: true,
    orthographicCamera: true, fovAnimation: true, cameraRoll: true,
    vsmOrPcssShadows: true, shadowDarknessMultiplier: true,
    globalSaturate: true, liftedBlacks: true,
    planarWaterMirror: true, skyReflectionInWater: true,
    hardBoxEdges: true, teamColourAsHullTint: true, grimeOnVehicles: true,
    greySoviets: true, pureGreenGrass: true, whiteSnowAlbedo: true, whiteRoadPaint: true,
    axisAlignedStraightRoads: true, smoothPerlinTerrainHills: true,
    orangeCoredFireballs: true, continuousRocketSmokeRibbons: true,
    depthTestedTeslaBolts: true, subtleVfx: true,
  },
} as const;

export type RA3Config = typeof RA3;
```

---

*End of bible. Any change to a number in §15 requires a corresponding edit here, and vice versa.*
