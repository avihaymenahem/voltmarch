# VISUAL DNA — VOLTMARCH
### The single authoritative art/audio spec. Art Director's cut.
**Status:** LOCKED v1.0 · Supersedes the four analyst reports where they disagree (see §0.3).
**Audience:** (a) art/engine agents who build it, (b) critics who score it against the reference screenshots.

---

## 0. HOW TO USE THIS DOCUMENT

### 0.1 Two measurement frames — never mix them

Every number in the analyst reports was measured at the reference resolution. Our target is bigger.
**All px values in this doc are tagged.**

| Frame | Screen | Cell diamond | px per world unit (horiz) | px per world unit (height) | Notes |
|---|---|---|---|---|---|
| **REF** | 1366×768 | **60 × 30 px** | 42.43 | 36.74 | what the analysts measured |
| **OUR** (canonical) | 1920×1080 | **80 × 40 px** | 56.57 | 48.99 | ship target |

**Conversion: OUR = REF × 4/3.** When a spec says "REF 14 px", build it at **18.7 OUR px**. When a critic
scores a 1920×1080 screenshot, they divide by 4/3 before comparing to a reference number.

### 0.2 The world unit

**1 world unit = 1 ground cell edge = 1.0.** A cell is a 1×1 world square that projects to a 2:1 diamond.
- 1 world unit of ground → 56.57 screen px along its axis (OUR), i.e. **(+40, ∓20) px** on screen.
- **1 world unit of HEIGHT → 48.99 screen px** (OUR) / 36.74 (REF). `= cos(30°) × horizScale`.
- **1 RA2 elevation step = 0.408 world units = 20 px (OUR) / 15 px (REF).** All cliffs, ramps and
  terrain vertices snap to multiples of 0.408.

### 0.3 DECISION LOG — where the analysts disagreed, and what wins

| # | Conflict | Terrain analyst | Units analyst | **DECISION** | Why |
|---|---|---|---|---|---|
| D1 | px per world unit of **height** | 36.74 (REF) | 26 | **36.74 (REF) / 48.99 (OUR)** | Terrain's derivation is the correct ortho math: `cos30° × (60/√2)`. Units used `30 × cos30`, which double-counts the projection. |
| D2 | **Shadow screen direction** | `(+2,−1)` = 26.565° up-right (world +X) | `(+0.975,−0.22)` = 12.7° up | **26.565° up-right, exactly on the `(+2,−1)` cell axis** | Two independent probes (cactus radial, White House radial) vs one endpoint pick. On-axis is also the only value that stays consistent as the camera zooms. Critic tolerance ±5°. |
| D3 | **Shadow multiply** | (0.47, 0.50, 0.41) | (0.53, 0.49, 0.34) | **(0.48, 0.50, 0.40)** — hard rule **B ≤ R − 0.04** | Both agree blue is cut most. Averaged. The B<R rule is the load-bearing part. |
| D4 | **Shadow edge** | 2–3 px penumbra (REF) | hard, 1-bit | **3 px penumbra at OUR scale, constant, non-distance-scaled** | Deliberate improvement (§1.14 I3). 1-bit masks were a 1996 limitation. |
| D5 | **Sun elevation / shadow length** | 40°, screen len 1.05–1.15× | implied 1.0× | **40° elevation; screen length 1.10× object screen height**, tol 0.95–1.25 | Terrain derived it from a measured sprite/shadow pair. |
| D6 | **Cells across playfield** | 20–22 | 19.8 | **21.0 default**, user zoom 16–30 | Splits it; 21 cells at 1668 px playfield = 79.4 px/cell → we round the cell to **80 px** and accept 20.85 cells. |
| D7 | **Sidebar width** | 169 px / 12.4% | 168 px / 12.3% | **168 design px, ×uiScale** (§2.1) | Same measurement within error. 168 is divisible cleanly. |
| D8 | **Health bar** | — | 30–36 px, 11–13 pips (2 lit / 1 dark) | 34 × 4 px, 1-on/1-off 2 px hatch | **34 × 4 REF px (45 × 6 OUR), 1-on/1-off 2 px hatch**, fixed width for all vehicles, wider for buildings | HUD analyst measured the actual pixel cross-section; pip counts follow from the hatch. |
| D9 | **Control-group badge** | — | 13×15, `#6E1010` / `#C83030` | 11×13, `#210000`–`#4F1210` / `#CC716D` | **12 × 14 REF px, fill `#2B0A08`, 1 px border `#CC716D`, digit `#E8B0AE`** | Split; HUD's darker fill matches the "well is black and flat" law. |
| D10 | **Veterancy chevron** | — | present, gold `#F8C820` | not present in refs, do not fabricate | **Not part of the classic layer.** Ship as a *modern addition* (§2.11): 1–2 faction-gold chevrons at the health bar's right end, ON by default, styled to the HUD's language. Flag it as new so critics don't score it as a mis-clone. |
| D11 | **Team colour share on vehicles** | — | 8.2% Allied / 17.8% Soviet | **7–10% for both factions** by *area*; Soviet may read larger because `#A80808` is more saturated | A single rule is buildable; the perceptual difference comes from hue, not coverage. |
| D12 | **Building vertical push** | (implicitly geometric) | ×1.20–1.30 | **×1.25 vertical scale on structure meshes only** (not units, not terrain, not props) | Non-negotiable identity feature. Shadows are cast from the *stretched* mesh so they stay consistent. |
| D13 | **Playfield bottom bar** | 32 px (REF) | — | 28 px (REF) | **28 REF px / 37 OUR px** | HUD analyst scanned the row boundaries directly. |

---

# 1. LOOK BIBLE

## 1.1 CAMERA & FRAMING — get this wrong and nothing else matters

```
projection      : ORTHOGRAPHIC (three.js OrthographicCamera)
yaw             : 45.000°   (eye on the +X+Z diagonal)
pitch           : 30.000°   below horizontal   [derivation: sinθ = tileH/tileW = 30/60 = 0.5]
roll            : 0.000°
eye             : target + d · (0.61237, 0.50000, 0.61237)      // (cos30·cos45, sin30, cos30·sin45)
d               : 200 world units (arbitrary under ortho; keep >150 for depth precision)
near / far      : 1 / 600
up              : (0, 1, 0)
```

**Frustum for the canonical 1920×1080 build:**

| Quantity | Value |
|---|---|
| Window | 1920 × 1080 |
| Sidebar | 252 px (13.1%) — see §2.1 |
| Command bar | 37 px |
| **Playfield** | **1668 × 1043 px** |
| px per world unit | **56.5685** (`80 / √2`) |
| Ortho `halfWidth` | **14.744** world units |
| Ortho `halfHeight` | **9.220** world units |
| Cells across playfield | **20.85** |
| Cells top-to-bottom | **26.1** |

**Zoom:** user zoom multiplies `halfWidth/halfHeight` in the range **0.76× – 1.44×** (16 → 30 cells across).
Snap zoom to steps that keep `pxPerCell` an integer (80 / 72 / 64 / 56 / 96 / 104 …) so the terrain grain
never crawls. **Default zoom is not the max zoom-out.** Showing 30+ cells reads as StarCraft II.

**Absolute rules:**
- Parallel world lines must stay parallel on screen. **Convergence over 1600 px must be ≤ 1 px.**
- Ground axes must sit at **±26.565°** (`atan(1/2)`) from horizontal, ±0.3°.
- Cell diamond aspect **2.000 : 1**, ±0.5%.
- If anyone insists on perspective: **FOV ≤ 12°, distance ≥ 250 cells.** Anything wider and vertical
  building edges stop being parallel — the single most common "this isn't RA2" tell.
- Camera pans on the ground plane only. **No rotation, no free pitch, no tilt-on-zoom.** Ever.

---

## 1.2 GLOBAL TONE CONTRACT — the most under-appreciated number in this doc

A naive PBR sun+sky render lands at luma std 60–80 for every biome. The reference is **std 32–44** for
everything except snow. This is the single fastest way to fail.

**The contract:**

> **Terrain owns luma 20–130. UI chrome, ore, muzzle flashes, explosions, tesla arcs and snow own 150–255.
> Nothing else may enter the top band.**

Measured targets the render must hit:

| Biome | luma mean | luma std | p5 | p50 | p95 | mean HSV sat | % above luma 150 |
|---|---|---|---|---|---|---|---|
| **Desert** (canonical) | **95.6** ±10 | **32.0** | 27 | 104 | 123 | **0.52** ±0.08 | **1.6%** (≤4%) |
| Temperate (day) | 80 ±12 | 40 | 20 | 72 | 150 | 0.50 | ≤5% |
| Urban / dusk | 76 ±10 | 32 | 19 | 81 | 117 | 0.39 | ≤3% |
| **Snow** (the only wide biome) | 141 ±12 | **77** | 30 | 157 | 240 | 0.34 | 25–40% |
| Twilight snow | 105 | 36 | 34 | 113 | 153 | 0.36 | ≤10% |

Open desert sand alone: **mean 104.3, std 14.6, p5→p95 spans only 41 luma levels.**

**Implementation:** author the lighting to land in-band natively. Do **not** shoot wide and crush in post —
a tone-mapping curve applied after the fact destroys the per-cell value jitter and the 1-px grain, which is
where the entire identity lives. Verify with a histogram assert in the render harness (§4, C5–C7).

---

## 1.3 LIGHTING RIG — exact numbers, no PBR defaults

```
KEY (directional sun)
  direction (travelling) : normalize(+0.766, −0.643, 0.000)     // toward world +X and down
  azimuth                : world +X exactly  (shadows fall along the (+2,−1) screen axis)
  elevation              : 40.0°
  colour                 : #FFF2DC   (2 700–3 000 K-ish warm white, NOT #FFFFFF)
  intensity              : tuned so lit desert sand albedo #856F3D renders at luma 104–112

FILL / AMBIENT
  model                  : single hemisphere-free constant ambient. NO sky IBL. NO blue ambient.
  colour                 : #6B5C3F   (warm, biome-tinted: it is the KEY colour × the ground albedo)
  intensity              : exactly enough that shadowed sand = lit sand × (0.48, 0.50, 0.40)
  RULE                   : ambient.b must be < ambient.r. If B > R anywhere, the rig is wrong.

BOUNCE
  none. No GI, no SSAO on terrain, no light probes.

FOG
  playfield fog          : NONE. Zero. RA2 has no atmospheric perspective inside the play area.
  decorative border      : massifs and terrain outside the play boundary get a flat
                           +8 luma lift and −0.06 saturation. No gradient, no depth falloff.

SHADOWS
  caster                 : all units, structures, props, cliffs. Terrain receives.
  multiply               : (0.48, 0.50, 0.40) per channel against the lit surface
  hard constraint        : B ≤ R − 0.04  (shadows are warmer/more saturated than lit, never bluer)
  screen length          : 1.10 × object screen height   (tol 0.95–1.25)
  ground length          : 1.19 × object world height
  penumbra               : constant 3 px (OUR) / 2 px (REF). NOT distance-scaled. NOT area-light.
  air units              : shadow is a detached soft ellipse offset DOWN-SCREEN by altitude
                           (55 px OUR for a Kirov at cruise) plus the normal sun offset,
                           50% opacity, 8 px blur. This is how players read altitude — keep it.
  self-shadowing         : ON for units and structures (a 1996 limitation we fix). Key:fill ≈ 4:1
                           so a 35 px tank hull spans luma 40 → 205.
```

**Per-biome ambient tint** (multiply the key colour by the biome's dominant hue so shadows stay in-family):

| Biome | Key | Ambient | Shadow multiply |
|---|---|---|---|
| Desert | `#FFF2DC` | `#6B5C3F` | (0.48, 0.50, 0.40) |
| Temperate | `#FFF4E2` | `#3E4630` | (0.46, 0.50, 0.42) |
| Snow | `#F2F8FF` | `#7E93A4` | (0.40, 0.44, 0.48) — the *only* biome allowed a cool shadow, and only because the snow albedo is already cyan; the multiply itself stays near-neutral |
| Urban/dusk | `#FFE0BE` | `#3A3644` | (0.44, 0.46, 0.44) |

**Local / emissive lights** (new — see §1.14 I5): tesla arcs, muzzle flashes, refinery crucibles, prism
beams and explosions inject additive light with a **hard radius clamp of 4 cells** and an additive-only
contribution that is written to a separate emissive buffer. They **never** brighten the terrain's albedo
pass — they add on top after the tone contract is enforced. Max 8 simultaneous local lights; beyond that,
fold into the emissive-sprite path with no light.

---

## 1.4 TERRAIN SURFACE — the frequency spec

**Three quarters of every frame is bare ground. The ground shader deserves more attention than any single
building.** (Measured: 74.7% of the desert reference playfield is sand-like ground pixels, even with a full
base, a highway, an ore field and 6 vehicles in shot.)

The ground is built from **five stacked octaves**, all **albedo-only** — there is no normal-mapped
bumpiness and no directional highlight shift anywhere on the terrain in any reference.

| Layer | Scale | Amplitude (desert) | Amplitude (snow) | Amplitude (grass) | Notes |
|---|---|---|---|---|---|
| **L1 Base albedo** | flat | `#856F3D` | `#CBDEE6` | `#414422` | biome base |
| **L2 Grain** | 1–2 **screen** px, tiling 64×64 per cell | **±9 luma** | ±20 | ±12–18 | value noise, **stretched 2:1 along the `(+2,+1)` iso axis** (measured anisotropy: autocorr 0.585 at `(dy1,dx2)` vs 0.520 at `(dy1,dx1)`) |
| **L3 Per-cell jitter** | 1×1 world cell, hard diamond edges | **±5 luma**, and **7% of cells at −15…−25 luma** | ±6 | ±6 | quantized, **not** smoothed across the cell boundary |
| **L4 Tile-scale** | >16 px features | ±4.1 luma | ±8 | ±5 | blotches, wear |
| **L5 Regional** | 4–8 cells | ±2.5 luma | ±5 | ±3 | very slow |

Validation (Gaussian-blur residual decomposition on open desert ground):
`total std 14.66 · 1-px residual 8.57 · 2-px 10.47 · 4-px 11.84 · 8-px 12.71 · 16-px 13.49 · 32-px 14.16`.
**The ground is dominated by its finest scale.** Critics check the 1-px residual (target 8.6, band 6–12)
and the >16-px low-frequency (target 4.1, band 2.5–6).

**Grain must be screen-stable, not world-stable at high frequency.** Bind L2 to world space (so it doesn't
crawl when the camera pans) but author it at a density that lands at 1–2 *screen* px at default zoom.
On zoom change, cross-fade the L2 octave density so grain density stays perceptually constant.

**Hue lock.** Desert clusters run luma 49 → 120 and every one of them sits at **hue 41° ± 1°**. Only
L and S move — and **S rises as L falls** (darker sand is *more* saturated, not greyer). Do not spread
desert hue across 25–55°. Same law for every biome: pick one hue, move L and S only.

---

## 1.5 BIOME PALETTES

### 1.5.1 DESERT — hue locked to 41° ± 2°

| Hex | Coverage | H / S / L | luma | Role |
|---|---|---|---|---|
| `#8D7745` | 18.3% | 42 / .34 / .41 | 120 | lit tile highlight |
| **`#856F3D`** | **28.2%** | 42 / .37 / .38 | 112 | **base sand** |
| `#7D6736` | 17.1% | 42 / .39 / .35 | 104 | mid |
| `#786332` | 15.4% | 42 / .41 / .33 | 100 | mid-dark |
| `#705A2A` | 11.1% | 41 / .46 / .30 | 91 | dark variant tile |
| `#644E20` | 6.9% | 41 / .51 / .26 | 80 | darkest variant tile |
| `#3D3112` | 2.3% | 43 / .54 / .16 | 49 | rock/pebble core |
| `#5D481D` | — | — | 73 | scatter rock (= 0.66 × sand luma) |
| `#514827` → `#282D13` | — | — | — | cactus body → shrub |
| `#7F6C3F` bulk / `#B6A572` hi → `#FFFFFF` | — | — | ≤255 | **ore** (one of the few things allowed above 150) |

Region mean `#7C6736`. Channel std R 15.9 / G 14.7 / B 12.8.

### 1.5.2 SNOW — the only wide-range biome

| Hex | Coverage | Role |
|---|---|---|
| **`#CBDEE6`** | 19.3% | **base snow** — H197 S0.36 L0.85, luma 217. **Snow is cyan-tinted, not neutral white.** |
| `#E4F5F6` | 9.9% | specular / fresh drift, luma 240 |
| `#B0C7DA` | 13.2% | half-shade |
| `#97A8AD` | 7.3% | deep shade / ice |
| `#6E818C` | 7.0% | wet snow, shore, cast shadow |
| `#073363` | 14.9% | deep water |
| `#5F665F` / `#3A4239` / `#151E18` | 23.7% | rock mid / conifer shade / conifer core |
| `#9F8C6F` / `#B39459` | 2.0–4.0% | exposed earth through snow |
| `#E1E1AF` | 1.8% | ore |

Snow shadows read deeper in relative terms: `#6E818C`→`#343D3E` on a 217 base = 0.27–0.58 multiply.

### 1.5.3 TEMPERATE — much darker than anyone expects

| Hex | Coverage | luma | Role |
|---|---|---|---|
| **`#414422`** | 38.3% | **63** | **base grass** (hue 65–69°, olive not emerald) |
| `#2C2F10` | 24.1% | 42 | grass shade |
| `#161805` | 20.0% | 21 | grass deep shade |
| `#5F5B43` | 8.8% | 89 | dry patch |
| `#6C7C1C` / `#939F2C` | — | 108 / 142 | **sunlit** lawn — the ceiling for grass |
| `#9C856B` | 5.3% | 137 | dirt path |
| `#E3CBA0` | 3.5% | 205 | concrete (exception to the tone band) |
| `#37322B` / `#344814` → `#262D09` | — | — | hedge / tree canopy |

**Grass luma mean is 61 = 24% grey.** If our grass renders above luma 145 anywhere except a small sunlit
patch, it's wrong.

### 1.5.4 WATER

| | Arctic / snow | Temperate ocean |
|---|---|---|
| Deep | **`#06305F`** (H211 S0.87 L0.21) | **`#283142`** (H220 S0.22 L0.21) |
| Mid | `#254262` | `#313949` |
| Darkest | `#06182A` | `#1B1A20` |
| Rim / shore | `#98BFF4` / `#C5D7F7` (luma 185–213) | seawall `#848642` top / `#4E5C1B` face |
| Flat-tone dominance | — | **two tones cover 78% of the surface** |

**There are no reflections. None.** No sky reflection, no building reflection, no SSR, no planar mirror.
Adding any of them destroys the look instantly. Surface variance lives at **16–32 px scale** (banded wave
rings), not per-pixel: residual std at 1 px blur is only 10.96 vs a total of 51.1.

---

## 1.6 TILE BLENDING, SHORELINES, CLIFFS

**Blending — dither, never lerp.**
RA2 does not alpha-blend terrain types. Transitions flip state repeatedly over **3–15 px** in a
checker/stipple pattern with **no monotonic gradient**.
> **Spec:** every terrain-type transition is a **2-cell-wide dither mask** (ordered 4×4 Bayer for the
> hard classic look, blue-noise for the softened option), threshold-blended. **A smooth lerp is the #2
> giveaway of a 3D remake after perspective.**

**Shorelines.**
- Water→land transition width: **4–15 px (REF) = 5–20 px (OUR)**. Extremely tight.
- Outward order: deep `#06305F` → **bright pale dithered rim `#98BFF4`/`#C5D7F7`, 3–8 px** → shallow shelf → land.
- The rim is **per-pixel dithered** between water and rim colour across its width.
- **No foam. No wave animation crossing the shore.** Only static rim + offshore ring-wave decals.
- Man-made shore = hard stone seawall, ~25 px tall (REF) ≈ 1.7 elevation levels, crisp 1-px silhouette.

**Cliffs.**
- 1 elevation level = **0.408 world units = 20 px (OUR)**. Gameplay cliffs 1–2 levels; decorative massifs 4–10.
- **Cliffs are jagged, not walls.** Silhouette breaks every **8–20 px (REF) / 11–27 px (OUR)**.
- Rock striations run **along the iso axes at ±26.5°**. Vertical striations look immediately wrong.
- **Every horizontal ledge carries a snow/sand cap** — the cliff reads as stacked shelves. 2–4 visible
  shelf breaks per elevation level.
- Palette: `#8B7048` warm outcrop, `#5E5037` shade, `#6A695B` grey-brown, cap = biome surface colour.
- **No AO darkening at the cliff base** beyond the normal cast shadow.

---

## 1.7 ROADS, PADS & GROUND DECALS

### 1.7.1 Roads — flat decals at height 0

Perpendicular cross-section, measured (REF px; ×4/3 for OUR):

```
 0–46   sand
 47–52  light shoulder / curb band  #65664F → #53574F   (6 px)
 53–55  asphalt begins
 56     lane line
 71     lane line
 87–90  DOUBLE YELLOW CENTRE LINE
 104    lane line
 120    lane line
 122–126 light shoulder band (5 px)
 127+   sand
```

| Property | REF | OUR |
|---|---|---|
| Total corridor | 80 px = **1.33 cells** | 107 px |
| Asphalt only | 68 px = **1.13 cells** | 91 px |
| Lanes | **5 painted lines at 15.5 px → 4 lanes @ 16 px (0.27 cell)** | 21 px lanes |

- Asphalt: mean `#2B2E28`, p10 `#171B17`, **p50 `#212522`**, p90 `#5D5B4B`. Slightly green-neutral, very low S.
- **Lane markings are NOT white.** Brightest 1% of the corridor averages **`#858A80`, luma 137**.
  Spec at **luma 130–150, desaturated, heavily worn and broken.**
- **Yellow centre line is a dirty ochre** `#403A1F` (peak `#625D45`), luma 55–95. It reads yellow only by
  hue contrast against luma-35 asphalt.
- Roads run **exactly on the cell axes** (`dx/dy = ±2.00`). Corners are hard 90° mitres — **no fillets**.
- **Flat decals at height 0. No extruded geometry, no bevel, no edge AO.** Hard 1-px edge against terrain;
  the only softening is the 5–6 px shoulder band.
- Concrete/pavement: `#454230` (pads) / `#3E3C23` (city), luma 58–65. **Concrete is DARKER than sand.**

### 1.7.2 Tread marks — the signature decal

| Property | Value |
|---|---|
| Form | **paired ruts**, one per track |
| Rut width | **14 px REF (0.23 cell) / 19 px OUR** |
| Pair span | 28–31 px REF / 37–41 px OUR |
| Colour | `#655025` / `#715B2A` / `#776131` on `#856F3D` |
| **Multiply** | **0.65** (band 0.58–0.72). Overlaps **saturate at 0.62 — they do not stack darker.** |
| Edge | soft, 3–4 px REF falloff each side |
| Shape | long smooth **arcs 200–600 px**, crossing and overlapping |
| Snow variant | `#807465` on `#CBDEE6` = 0.58 multiply — far more visible |
| Persistence | multiple generations visible; fade to 0.85 multiply over **90–180 s**, then out |

Their absence is immediately noticeable in any base screenshot. This is a required feature, not polish.

### 1.7.3 Building pads

- The pad is a **ground decal, not a slab**. It extends **4–10 px (REF) / 5–13 px (OUR)** past the
  building silhouette on all four sides, with edges on the **exact isometric diamond of the cell block —
  never rounded**.
- **2 px darker rim `#22231D`** + a 1 px lighter top-face lip.
- **Contact AO:** the 3–5 px of pad touching the wall is **15% darker** than the rest.
- **Pad material swaps per theatre:** dark olive concrete `#373832`/`#32332A` in desert/temperate,
  bare cleared dirt `#D9C9A6` in snow. A pad that doesn't swap looks pasted on.
- **Painted markings are a signature:** War Factory apron carries a `#D89020` 2-px painted guide rectangle
  (70×26 REF) in front of the shutter; the AFC helipad is a blue-tiled 2×2 diamond with a 6-px yellow
  cross `#E8D030` and a 4-px `#4878C8` border pattern; the Soviet War Factory door has a red
  hammer-and-sickle 22 px tall on a navy steel door.
- **Every building is grounded by exactly three cues: pad + contact AO + hard cast shadow.** Missing any
  one and it floats.

### 1.7.4 Scatter — clustered, never Poisson

| Biome | Density | Size | Coverage |
|---|---|---|---|
| **Desert rocks** | **1.22 blobs/cell**, arranged as **1 cluster per 6–10 cells, 8–15 pebbles per cluster inside a 50×25 px (REF) ellipse** | median 8×5 px, p90 15×10 px (REF) | **3.05%** |
| Desert vegetation (cactus/shrub/palm) | **1 per ~70 cells** — sparse | cactus 48×14 px REF | — |
| Snow exposed-earth patches | 1 per 5.8 cells | 50–90 px across | 4.02% |
| Snow scree | 1 per 2–4 cells in exposed areas, heavily clustered | 20–35 × 10–18 px | — |
| Conifers | 1 per 8–12 cells in wooded bands, **0 in open ground**, in copses of 3–8 | — | — |
| Temperate | canopies 40–80 px, bordering the playfield; centre stays open lawn | — | 63.8% green |

**Rock luma = 0.66 × sand luma.** Uniformly-distributed scatter is an automatic fail — the reference
crops show tight pebble clusters with 2–4 empty cells between them.

**Composition rule:** RA2 leaves space empty and lets the ground grain carry it. Structures cluster into a
~10×8-cell base footprint; the rest is open. **Do not scatter props to fill space.**

---

## 1.8 FACTION MATERIAL LANGUAGE

### 1.8.1 ALLIED — chrome, white ceramic tile, cobalt

| Role | Hex | Share of asset |
|---|---|---|
| Panel white / ceramic tile | `#C8C8C8` → `#D8D8E0` | 8–12% |
| Lavender-white specular | `#C8C8D8`, peak `#E0E4F4` | 2–4% |
| Mid chrome / body grey | `#8888B8`, `#686878` | 10–15% |
| Structural dark | `#383848`, `#282838`, `#181818` | 30–40% |
| **Team accent (blue slot)** | core `#4878C8`, shade `#183868`, hi `#8898D8` | 7–10% units / 2.5–4% buildings |
| Crucible glow | `#D89020` → `#F8C858` | 1–2% |

- Hard-edged **rectangular tile panels**. Proving Ground bulbs are quilted into ~9×9 px white tiles with 1-px
  `#9898B0` grout. Read: **ceramic + chrome + glass. Zero rust, zero rivets.**
- **Curves dominate:** barrel vaults, domes, capsules, tori. Ore Refinery = one ribbed lavender cylinder
  (7 rib bands, 11 px pitch). War Factory = quonset arch with a 14-slat roll-up shutter (3 px pitch).
- **Allied shadows go blue-black** (`#282838`).

### 1.8.2 SOVIET — riveted plate, ochre brick, red slab

| Role | Hex | Share |
|---|---|---|
| **Team accent (red slot)** | `#A80808`, hi `#E85858`, spec `#FFC9C6` | 7–10% units / 2.5–4% buildings |
| Rust-red shade | `#580808`, `#680808`, `#780808` | 8–12% |
| Olive-drab hull | `#685858`, `#786858`, `#484838` | 25–35% |
| Cold steel | `#889898`, `#687878` | 8% |
| Brick / masonry | `#A08868` → `#C0A882`, mortar `#6A5540` | buildings |
| Radioactive glow | `#40E040` | 1–3% |
| Kirov envelope | `#B0A050` → `#D8C868`, teeth `#F8D820` | — |

- Vocabulary: **rivets (1×1 px dots at 4 px REF pitch along plate seams), brick courses, chimneys, onion
  domes, lattice masts, riveted red slabs.** No curves except domes and pipes.
- **Soviet shadows go warm-red-black** (`#180808`, `#280808`). **This hue split is the fastest faction tell
  in a screenshot.**

### 1.8.3 The two-material test (hard gate)

> Every Allied asset must show **≥2 of** {white ceramic tile, polished chrome, blue glass}.
> Every Soviet asset must show **≥2 of** {riveted steel plate, ochre brick, red slab, exposed pipe/lattice}.
> **A model that could belong to either faction is a fail.**

### 1.8.4 Team colour law

Team colour is **faction-independent** — the same Allied War Factory appears blue-trimmed in one reference
and green-trimmed in another. **Faction determines form + base material; the player slot determines only the
accent.** Build the accent as a dedicated material slot driven by a vertex-colour / mask texture.

| Asset class | Share | Placement |
|---|---|---|
| Vehicles | **7–10%**, one contiguous patch | Allied: turret cap (solid block) + hull chine stripe. Soviet: 2–4 discrete rectangular side-skirt boxes on the hull flanks — **never** the turret roof. |
| Buildings | **2.5–4%** | **Vertical slabs or edge stripes at the silhouette boundary.** Tesla Coil = 4 red slabs 9×42 px REF radiating from the base. Allied Power Plant = 4 blue capsule columns 10×34 px REF. **Never a flat roof wash** — at 80 px the accent must break the *outline*, not the interior. |
| Aircraft | 4–6 separated clusters around the envelope | nose fins + gondola pods |
| Infantry | **~35%** of the sprite | helmet + torso vest — under 30% and it disappears at this size |

**Accent luminance rule:** the accent must be the **second-brightest** element on the model, **15–30%
brighter** than the surrounding hull, and must sit on a surface **normal-facing the camera**
(upper-front-left), never only on the top face.

---

## 1.9 SILHOUETTE LAW & THE SIZE LADDER

### 1.9.1 Size table

REF px at 60×30 cells; multiply by 4/3 for OUR.

| Unit | REF bbox | OUR bbox | Plan (cells) | Height above ground (REF) |
|---|---|---|---|---|
| Warden Battle Tank | **26 × 21** hull (33×42 with raised barrel) | 35 × 28 | 0.45 × 0.70 | 14 |
| Anvil Heavy Tank | 31 × 20 | 41 × 27 | 0.50 × 0.66 | 13 |
| Flak Track | 30 × 24 | 40 × 32 | 0.50 × 0.80 | 17 |
| **Chrono / War Miner** | **60 × 43** | 80 × 57 | 1.00 × 1.40 | 22 |
| IFV | 28 × 22 | 37 × 29 | 0.47 × 0.73 | 12 |
| **GI / Conscript** | **13 × 18** | 17 × 24 | 0.22 × 0.60 | 18 |
| GI deployed | 24 × 16 | 32 × 21 | 0.40 × 0.53 | 9 |
| **Kirov Airship** | **110 × 60** | 147 × 80 | 1.8 × 2.0 | flies at +45 (REF) |

| Structure | Pad (REF) | Plan | Silhouette height (REF) | **height : pad-width** |
|---|---|---|---|---|
| Refractor Tower | 46 × 26 | 1×1 | 94 | **2.04** |
| Tesla Coil | 40 × 24 | 1×1 | 105 | **2.60** |
| Proving Ground | 125 × 70 | 2×2 | 130 (175 with antennas) | 1.40 |
| Nuclear Silo | 150 × 85 | 3×3 | 135 | 0.90 |
| Power Plant | 62 × 36 | 1×1 | 50 | 0.81 |
| Ore Refinery | 195 × 110 | 3×3 | 72 (+55 stacks) | 0.65 |
| Barracks | 110 × 58 | 2×2 | 46 | 0.42 |
| War Factory | 215 × 120 | 3×3 | 78 | 0.36 |
| AFC helipad | 110 × 59 | 2×2 | 3 (flat decal) | — |

**Area ladder — obey exactly: infantry : tank : miner : building-pad ≈ 1 : 2.2 : 5.0 : 40+.**
**A tank must never exceed 0.55 cells wide.** The moment tanks approach cell width, a 20-unit army becomes
an unreadable carpet.

**Structure vertical push: ×1.25** on structure meshes only (D12). A geometrically-correct 30° render of a
1-cell tower reads ~30% too squat and critics will nail it instantly.

### 1.9.2 The eight silhouette rules

- **S1 — One dominant protrusion.** Combat vehicles get exactly one thin, long, high-contrast spike (the
  barrel): **length 40–60% of hull length at ≤12% of hull width** (REF 11–16 × 2–3 px). It is always the
  **darkest** element (`#181818`–`#282828`). Nothing else on the model may be that thin and that long.
- **S2 — Support vehicles get a block, not a spike.** The miner's rear ore hopper is a solid khaki cube
  (`#8A7A3E`–`#B8A050`) occupying **~48% of the sprite**, with 4 vertical rib lines, and **no barrel**.
  Harvester = big warm rectangular mass; tank = small cool mass + spike. That is the entire read.
- **S3 — Four non-overlapping aspect classes.** Tanks 1.24 (wider than tall), miner 1.40 but 2.3× the area,
  infantry 0.72 (taller than wide), Kirov 2.5:1 and airborne.
- **S4 — Turret pivots, hull doesn't.** Separate turret mesh with independent yaw, offset **6 px forward,
  8 px up** (REF) from hull centre. Eight identical hulls with turrets at five angles is 70% of why a blob
  reads as an army instead of a texture.
- **S5 — Track/skirt line.** Every tracked vehicle carries a **3–4 px dark band (`#101010`–`#202020`) along
  its lower edge with 5–7 bright road-wheel dots (`#8A8A8A`)**. Without it, vehicles float.
- **S6 — Negative space differentiates legged units.** Splayed legs at ~35° with visible ground between
  them. Use gaps, not detail.
- **S7 — No unit may be point-symmetric.** Every asset needs a readable front (barrel, cab, nose teeth).
- **S8 — Colour budget at 35 px.** Each vehicle must resolve to **5–7 distinguishable colour blocks**
  (dark barrel, mid hull, bright deck highlight, team patch, track band, shadow). Model **shape**, not panel
  lines — anything finer is wasted.

### 1.9.3 The 40-unit blob — readability under load

- **B1 — Two silhouette scales must never mix.** If infantry approaches tank size, both classes die.
- **B2 — Luminance separation ≥ 30 luma points** from the ground for the unit's dominant band. Every unit
  must be **both darker AND lighter than the terrain somewhere** (desert sand luma ~112; a Warden spans
  40 → 205).
- **B3 — 1–1.5 px hard contact edge.** A near-black rim on the down-light edges (screen-space outline or a
  strong rim-darkening term). This is what stops "grey blob".
- **B4 — Formation spacing ~0.9 cell centre-to-centre** (REF 46 px x / 18 px y between adjacent tanks).
  Tighter and the blob merges.
- **B5 — Never let ground and units share a hue family.** Warm desert + cool blue-grey Allies; cool snow +
  red Soviets. If a faction fights on its own hue, push the ground hue.

---

## 1.10 VFX LANGUAGE — big, saturated, short

VFX and UI own the top of the value range. **Nothing here is subtle.** REF px; ×4/3 for OUR.

| Effect | Spec |
|---|---|
| **Tank muzzle flash** | 4-point star, **14 × 12 px REF (≈ half the tank's width)**, core `#FFF0B0`, body `#F8C020`, 2 frames / 90 ms, plus a 6-px smoke puff that drifts 0.3 cells over 700 ms |
| **MG tracer** | 1 px `#FFE080` streak, 8–14 px long, 40 ms, 1 in 3 rounds only |
| **Tesla arc** | **1–2 px `#F0F0FF` jagged polyline with a 3 px `#8898FF` glow, spanning 40–60 px REF**, 3–5 segments, re-randomized every 40 ms, 180 ms total |
| **Prism beam** | **3 px `#E8B0F0` straight line, 200+ px REF**, 120 ms, with a 260 ms charge bloom at the emitter |
| **Small explosion** | 22 px REF fireball, `#FFE080` core → `#F8A020` → `#7A3010` smoke, 320 ms |
| **Medium explosion** | 48 px REF, adds 6–10 debris sprites on ballistic arcs, 1.1 s, leaves a 40-px scorch decal |
| **Large explosion** | 96 px REF, 2.6 s, secondary collapse puffs at 380/620/910/1350 ms, leaves a 90-px scorch + rubble mesh |
| **Damage states** | on the **mesh**, not the bar: **<50% HP → 1 flame** (14–22 px REF, `#F8A020`→`#FFE080`); **<25% → 2–3 flames + a dark grey smoke column** rising 60 px with 0.4 opacity |
| **Scorch decals** | permanent, `#1A160C` at 0.55 multiply, dithered edge, blend into the terrain grain |
| **Ore glitter** | 2 px specular sparkles on ore cells, 1 per ~8 cells per second, `#FFFFFF`, 100 ms |
| **Shroud edge** | **dithered** over 1 cell (blue noise), never a hard cut and never a soft gradient |

**Bloom is emissive-masked only.** Write emissive materials to a dedicated buffer and bloom *that buffer*.
**Never threshold on scene luminance** — only 1.6% of the reference playfield exceeds luma 150, and any
bloom on the ground is an automatic fail.

---

## 1.11 RENDER PIPELINE ORDER

```
1. Terrain pass          — albedo octaves L1–L5, per-cell quantization, dithered type transitions
2. Decal pass            — roads, pads, tread ruts, scorch, painted markings   (height 0, no lighting)
3. Opaque pass           — structures (×1.25 Y), units, props, cliffs; self-shadowed
4. Shadow pass           — hard multiply (0.48,0.50,0.40), 3 px constant penumbra
5. Water pass            — 2 flat tones + dithered wave rings + dithered shore rim. NO reflections.
6. Emissive pass         — writes to a separate buffer (muzzle, tesla, prism, ore, windows, glows)
7. Bloom                 — on the emissive buffer ONLY, threshold 0.0, radius 6 px, intensity 0.55
8. Shroud                — dithered edge, pure #000000 fill
9. World overlay UI      — health bars, control-group badges, chevrons, target lines
10. Sidebar + command bar
11. NO colour grading, NO vignette, NO chromatic aberration, NO film grain, NO ambient occlusion pass,
    NO screen-space reflections, NO depth of field, NO motion blur.
```

Anti-aliasing: **FXAA or 2× SSAA only.** TAA is banned — it smears the 1-px terrain grain, which is the
single highest-value feature in the whole look.

---

## 1.12 WHAT WE DELIBERATELY IMPROVE OVER 1996

These are RA2's technical limitations, not its identity. We fix them and say so.

| # | RA2 limitation | **Our version** |
|---|---|---|
| **I1** | 8-bit indexed palette, visible banding, colour-cycling animation | 32-bit rendering with **ordered dithering on all gradients** (4×4 Bayer, ±2 luma). We keep the *texture* the palette produced and lose the banding. |
| **I2** | Sprites at 32 fixed facings; visible rotation snap | **Continuous rotation.** Hulls and turrets at arbitrary yaw, turret tracks target at 120°/s, hull turns at 60°/s with track-scroll. |
| **I3** | 1-bit flat shadow silhouettes, no self-shadowing | **Real shadow maps** with a constant 3-px penumbra and unit/structure **self-shadowing** (key:fill 4:1). Multiply values stay at the measured (0.48,0.50,0.40). |
| **I4** | Static water with a 4-frame colour-cycle | **Animated** dithered wave rings + a shore rim that dithers over 5–20 px, plus a shallow-depth tint ramp. **Still zero reflections** — that part is identity, not limitation. |
| **I5** | No dynamic lights; muzzle flashes were sprite-only | **Up to 8 additive local lights** (muzzle, tesla, prism, refinery crucible, explosions) with a 4-cell radius clamp, written to the emissive buffer so they never violate the terrain tone contract. |
| **I6** | Terrain built from ~60 hand-authored tiles; visible repetition every ~8 cells | **Procedural 5-octave ground** — no visible repeat at any zoom, but with the **per-cell quantization preserved** so the diamond structure still reads. |
| **I7** | Hard shroud edge, 1 cell granularity | **Dithered shroud edge** with sub-cell resolution and a 250 ms reveal fade. |
| **I8** | Destroyed buildings pop to a static rubble sprite | **Real collapse:** 4 staged secondary puffs, physicalized debris (12 pieces, 1.8 s), a persistent rubble mesh and a 90-px scorch decal. |
| **I9** | Fixed 168-px sidebar, unusable above 1280 wide | **Vector/SDF sidebar** authored at 168 design px, rendered at integer-snapped uiScale, holding 12–14% of width at every resolution (§2.1). |
| **I10** | Static pre-rendered cameo bitmaps | **Live cameo renders** from the actual game mesh into a cached RT, with a hover turntable — but keeping the mini-diorama environment backdrop, which is identity (§2.8). |
| **I11** | No hover / press / focus states anywhere in the UI | Full interaction states + keyboard focus ring (§2.13), accessibility-compliant. |
| **I12** | No build-progress feedback beyond the cameo tint | **Radial clock wipe + bottom fill bar + queue badge** (§2.9). |
| **I13** | Cameo name illegible when the disabled sepia tint hits it | **Name label is exempt from the tint** — always white with a 1-px black outline. |
| **I14** | Tread marks limited to a small decal pool, popped out abruptly | 512-decal ring buffer, **90–180 s fade**, overlap saturating at 0.62 multiply. |
| **I15** | No selection affordance beyond the health bar at 4K | Optional **1-px faction ground ellipse at 35% opacity** under selected units — new, subtle, ON by default at ≥1440p. Never C&C3-style corner brackets. |

**And what we deliberately DO NOT "improve":** perspective camera, wide value range, blue ambient, water
reflections, soft area shadows, selection circles/brackets, terrain bloom, smooth terrain blending, PBR
metal/roughness on everything. Each of those is a fail, not an upgrade.

---

## 1.13 THE 17-POINT FAIL LIST (what a naive 3D remake gets wrong)

1. **Perspective.** Any FOV > 12° breaks it. Strictly orthographic, 30° pitch / 45° yaw.
2. **Too zoomed out.** ~21 cells across. 30+ reads as StarCraft II.
3. **Value range too wide.** Terrain p5–p95 must be 27–123 for desert/temperate.
4. **Blue shadows.** Measured multiply cuts **blue most**. Blue ambient IBL gives the exact inverse.
5. **Shadows too long or off-axis.** 1.10× screen height, exactly on the `(+2,−1)` axis.
6. **Flat-shaded ground.** ±8.6 luma of 1-px grain stretched 2:1 along the iso axis. Highest-value feature.
7. **One giant seamless ground texture.** Per-cell ±5 luma quantization with hard diamond edges + 7% dark variant cells.
8. **Smooth alpha blends between terrain types.** Real transitions are dithered over 4–15 px.
9. **Hue drift.** Desert is 41° ± 1° from luma 49 to 120. Only L and S move, and S rises as L falls.
10. **Grass too bright / too green.** Mean luma 61, hue 65–69°. Olive, and dark.
11. **Water reflections.** There are none. Two flat tones cover 78% of the surface.
12. **Roads as geometry.** Flat decals, axis-aligned, hard edge, worn `#858A80` markings, dirty `#403A1F` centre line.
13. **Terrain bloom.** Only 1.6% of the playfield exceeds luma 150.
14. **Evenly-distributed scatter.** Clusters of 8–15 pebbles per cell, 1 cluster per 6–10 cells, 3% coverage.
15. **Missing tread marks.** Paired, 0.65 multiply, curved, long-lived, overlapping.
16. **Cliffs as smooth walls.** Stacked 20-px shelves, iso-axis striations, a cap on every ledge.
17. **Squat buildings.** Apply the ×1.25 vertical push to structures.

---

# 2. HUD SPEC

## 2.1 Resolution independence — the single biggest thing to fix

The original sidebar is a **fixed-pixel asset**: 168 px at every resolution, which is 4.4% of a 4K screen
and unusable. We author it as **vector/SDF against a 168-design-px width** and render at an integer-snapped
scale.

```
uiScale = clamp( floor(screenH / 720 * 4) / 4, 1.0, 4.0 )
```

| Screen | uiScale | Sidebar px | % of width | Cameo art |
|---|---|---|---|---|
| 1366 × 768 | **1.00** | **168** | **12.3%** | 60 × 48 |
| 1920 × 1080 | **1.50** | **252** | **13.1%** | 90 × 72 |
| 2560 × 1440 | **2.00** | 336 | 13.1% | 120 × 96 |
| 3840 × 2160 | **3.00** | 504 | 13.1% | 180 × 144 |

User override 0.75× – 3.0× on top. **Every bevel hairline must snap to 1 device pixel at every scale** —
a bilinear upscale of the original art is an automatic fail. At 1366×768 the render must match the table in
§2.2 within ±2 px.

**Command bar:** full screen width, **28 design px** tall.

## 2.2 Vertical stack (design px, against a 768-design-tall screen)

| y range | Height | Element |
|---|---|---|
| 0–3 | 4 | Outer chrome cap; top highlight hairline `#F7F0FD` at y=1 |
| **4–15** | **12** | **Credits readout** (§2.3) |
| 16–18 | 3 | Bevel / shadow |
| **19–38** | **20** | **Top button pair** (§2.4) |
| 39–47 | 9 | Chrome bezel above radar, `#B0B0C4` |
| **48–157** | **110** | **Radar / minimap** (§2.5) |
| 158–170 | 13 | Chrome bezel below radar + 3 status LEDs |
| **171–196** | **26** | **Repair / Sell arc** (§2.6) |
| **197–227** | **31** | **Tab strip** (§2.7) |
| **229–727** | **498** | **Cameo grid** — 10 rows × 50 px pitch (§2.8) |
| 727–733 | 7 | Chrome band |
| 734–757 | 24 | Bottom lens + faction emblem (§2.10) |
| 758–767 | 10 | Dark base |

Header stack above the grid = **229 design px (29.8% of design height)**.
Row count = `floor((designH − 229 − 41) / 50)` — 10 rows at 768, 15 at 1080-equivalent design height if the
aspect allows; **cap at 12 rows** so the grid never dominates.

## 2.3 Credits readout

| Property | Value |
|---|---|
| Field | **145 × 12 design px** (0.863W × 0.071W), centred in the sidebar |
| Interior | Allied `#10111A` · Soviet `#181818` — **flat, no gradient** (an unlit LCD) |
| Frame | 1 px bright chrome hairline on top (`#F7F0FD` / Soviet `#CCBB7D`), 2–3 px dark inner shadow underneath. **Recessed well, not a raised plate.** |
| Digits | **6 px pitch (5 px glyph + 1 px tracking), 8 px cap height**, centred, tabular, no `$`, no thousands separator. Sized for 8 digits. |
| Digit colour | Allied **`#B0CCEA`** · Soviet **`#F1DB75`**, 1 px darker AA fringe, **no glow** |
| Behaviour | **Tallies** toward the true value at 12% of the remaining delta per frame, min 3/frame |
| **NEW** | **Δ flyout:** `+150` green `#7CE87C` / `−1000` red `#E85858` rises 12 px and fades over 600 ms above the readout |

## 2.4 Top button pair

- One **downward-pointing lens strip**, y 19–38 (**20 px**), x 1204–1360 at design scale, split **exactly at
  the sidebar centre** by a 1 px dark divider. Each half ≈ **77 × 20 px**.
- Shape: wide at the top edge, tapering to a shallow arc at the bottom. **Not a rectangle.**
- Allied fill: vertical gradient `#7ED8FC` → `#3B90F7` → `#2265FB` → `#050E58`; 1 px `#95EDFF` upper rim,
  1 px `#00001C` lower rim.
- Soviet fill: brushed silver `#B7B0BD` → `#8A8B92`, brass rim `#8A834A`.
- Glyphs — Allied as **darker cut-outs** (`#0D20A7`), Soviet as **red** (`#B31B18`):
  - **Left:** rounded plate with an interlocking S / double-hook swirl (two arrows curling into each other) — *diplomacy*.
  - **Right:** rounded plate with `▬ ● ▬` — a slider knob between two track segments — *options*.

## 2.5 Radar / minimap

| Property | Value |
|---|---|
| Black field | **142 × 110 design px** (0.845W × 0.655W), aspect 1.29:1, `#000000` flat |
| Map bitmap | fitted to **height**, **letterboxed with pure black on both sides** (88 × 110 in the reference). **Keep the letterbox — it is part of the silhouette.** Drawn as an **axis-aligned rectangle**; the iso diamond you see is map *content*, not the frame. |
| Map border | 1 px, Allied `#C2C9BD` / Soviet `#FDFAB9` |
| Viewport rect | **1 px, unfilled**, faction colour, sized exactly `screenViewport / worldSize` (reference: 27 × 33 = 30.3% × 30.0%). **No fill, no corner ticks, no drop shadow.** |
| Blips | **2 × 2 px crosses** in owner colour: own `#5A8FD0`, enemy `#E8534F`, neutral `#E8E8E8` |
| Terrain | heavily downsampled terrain average (desert `#6A653D`–`#A7A67E`; snow `#4A4A47`) |
| Shroud | pure `#000000` |
| Bezel | ~9 px chrome above (`#AFAABE`–`#BDC8CB`), ~13 px below (`#C0C9C8`–`#B8B6C2`); Soviet brass `#DED48F` / `#F2DDA9` / `#C8BF6B` |
| Status LEDs | 3 dots, 4–5 px, at x ≈ 1208 / 1215 / 1222 design, pale cyan `#7CD8FF` → `#2A6E97` (lit / lit / dim) |
| **NEW** | click-to-jump, drag-to-pan, smoothly interpolated viewport rect (no per-frame jitter), a **400 ms faction-coloured ping ring** on attack alerts, and a **dithered shroud edge** |

## 2.6 Repair / Sell arc — exactly two buttons

- y 171–196 (**26 px**), one arc split at the centre; each half ≈ **62 × 24 px**.
- The arc **bows upward**: convex top edge, matching concave bottom, 1 px dark centre seam.
- Allied: lens gradient `#68E5FF` → `#3086FF` → `#2E28F5` → `#00002D`; glyphs **cut in darker blue `#0D20A7`**.
- Soviet: brushed silver `#C4C6CC` → `#8A8B92` with horizontal brush noise; glyphs **red `#8D1718` / `#A03738`** with a 1 px lighter red inner highlight.
- **Glyph 1 (left) = Repair:** open-end wrench at ~20° from vertical, head up, **10 × 20 px**.
- **Glyph 2 (right) = Sell:** `$` with a double vertical stroke, **14 × 20 px**.
- **Do not add a third or fourth button here.** No power-down, no waypoint — waypoint lives on the command bar.
- **NEW armed state:** while the mode is active the lens pulses `#7ED8FC` between 0.8 and 1.0 alpha at
  1.2 Hz and the cursor changes.

## 2.7 Tab strip — exactly four

- y 197–227 (**~31 px**), spanning **120 design px** → **30 px per tab**, butted with a 1 px seam, **no gaps**.
- The strip follows a shallow arc: outer tabs sit ~2 px lower, each plate slightly keystoned toward centre.
- Icons **16 × 16** inside a 30 × 26 plate → 4–7 px padding.
- **Order, left → right: ① house with pitched roof = Structures · ② shield = Defence · ③ standing figure =
  Infantry · ④ rounded chassis with two flanking treads = Vehicles.**
- **Selected state differs by faction — keep both:**
  - **Allied = plate inversion.** Unselected core `#0022A0`, top-lit face `#2F85FE`, rim `#89E5FF`, glyph
    lighter than the plate. Selected plate goes **pale cyan-white** `#8DFAFF` → `#C8FFFF` → `#BDFFFF` rim
    and the **glyph flips to dark blue**.
  - **Soviet = glyph recolour.** All 4 plates stay brushed silver `#B7B0BD`–`#CDCADB`. Selected glyph
    **pulses between `#FCEB1F` gold and `#C40B0E` red at ~1 Hz**; unselected glyphs are dark red
    `#A50804`–`#C40B0E`.

## 2.8 Cameo grid — the core of the HUD

| Property | Design px | As fraction of W = 168 |
|---|---|---|
| Columns × rows | **2 × 10** | — |
| **Cameo art** | **60 × 48** (5:4) | 0.357W × 0.286W |
| Horizontal pitch | **64** (gap 4) | 0.381W |
| Vertical pitch | **50** (gap 2) | 0.298W |
| Grid bounds | x 1219→1342 (**124 px**), y 229→727 (**498 px**) | 0.738W |
| Left gutter (power bar) | **21** | 0.125W |
| Right gutter (decorative rail) | **23** | 0.137W |

**Cell chrome (empty slot).** Measured cross-section at the left edge:
`#746F75 (1px bevel highlight) → #3C393C → #020002 (1px black) → #404040 → #1E1E1E → #101010 → #080808 (flat well)`
Top edge: `#5A5858` for 2 px fading over 5 px to `#0F0F0F`. Result: a **black glossy plastic key** with a
soft diagonal top-left gloss sweep and a ~3 px corner radius. Soviet uses the same key with a thicker,
whiter bevel (`#EEEEEE`/`#FFFFFE` peak) reading as polished steel.

**Cameo art style — this is a major identity marker.** Each cameo is a **mini-diorama, not a symbol**:
- Rendered from the **actual game mesh** (I10) into a 60×48-logical RT.
- Three-quarter view, key light upper-left ~35° elevation, rim light, visible ground contact shadow.
- Subject occupies **70–85%** of the frame.
- **Full-bleed environment backdrop matching the current theatre** — desert sky and sand `#C9A46A`/`#8497AE`,
  snow `#E9F2F4`, night sky, mushroom cloud. Colour is **fully saturated** — the cameo grid reads as
  **20 tiny photographs**, never as 20 flat icons.
- Idle at 0 fps (cached); on hover re-render at 30 fps with a **12°/s turntable** and the turret tracking the
  cursor. Cached-frame cost budget < 0.2 ms.

**Name label:** white pixel text drawn **directly over the bottom of the art**, baseline flush with the
cameo's bottom edge. Colour `#F7FBFE`–`#FFFCDE`, **1 px pure-black outline on all sides (`#090000`)**,
**8 px cap height**, all-caps, condensed, ~1 px letter spacing. No box, no scrim. Long names **wrap to two
lines stacked upward** into the art (`PATRIOT / MISSILES`).

**"Ready" overlay:** a dark translucent box centred horizontally, offset ~3 px below the cameo's top edge.
Allied **36 × 13 px**, interior `#052A44`–`#082536` at ~65% opacity, text `#A9CFED`. Soviet **36 × 12 px**,
near-black interior, text `#E9ED63`/`#F1F665`. Typography: **bold, mixed-case "Ready"** at ~11 px cap —
**the only mixed-case string in the entire HUD.** Keep it that way.

**Disabled / charging state:** remap the entire cameo onto a **warm khaki/sepia ramp — hue 45–50°,
saturation 0.30–0.45, value +8%**. Blues disappear entirely. Uniform across the whole cameo, no wipe
boundary. **Exception (I13): the name label is exempt from the tint** and stays white-on-black-outline.

## 2.9 Build progress — new, the thing the refs cannot show

- **Radial clock wipe:** 60% black overlay sweeping clockwise from 12 o'clock, plus a **2 px
  faction-coloured arc** on the leading edge (`#3B90F7` Allied / `#E7C86E` Soviet). At 50% progress the
  wipe must be exactly a half-disc.
- **Bottom fill bar:** 3 px tall inside the cell's lower bevel, faction colour, easing to true progress.
- **Queue badge:** bottom-**right** of the cell, **16 × 14 design px**, black plate at 80% opacity, 1 px
  faction bevel, digit in the faction numeral colour at 9 px cap. Shown only when queued ≥ 2. Punches in
  with a 120 ms 1.25 → 1.0 scale on increment.
- **Hold/paused:** the wipe freezes and the fill bar desaturates to `#6A6A6A`.

## 2.10 Power bar, right rail, bottom cap

**Vertical power bar** — left gutter, hard against the cameo column.
- Allied **12 design px wide** (x 1202–1213), Soviet 14 px. Runs the full grid height (498 px).
- Texture: horizontal hatch, **3 px vertical pitch — 1 px bright line + 2 px dark.**
- Allied greens: bright `#B8FBB2`/`#9EFF8A`, mid `#4CA84C`, shadow `#276316`/`#0B6807`.
  Soviet greens brighter/more saturated: `#6CE36E`/`#68D469`/`#3D993B`.
- **Fill is bottom-anchored and tri-banded:** unlit black at the top = headroom; **green = surplus**;
  **yellow (`#F7EDB0` bright / `#4E4626` dark) = the moving boundary marker**; **red (`#E16251` bright /
  `#3B1012` dark) from the bottom = power drawn**. Yellow is a transition band, not a fixed element — it
  vanishes when drain is near-total.
- **No numeric power readout in the classic layer.** **NEW:** hover tooltip giving `output / drain`
  numerals, and a **1.5 Hz pulse on the red band when drain > output**.

**Right decorative rail (23 design px):** a column of **chrome half-domes / piston caps, one per cameo row
(10 total), 50 px pitch**. Cross-section at a dome centre:
`#3B3A43 → #53515D → #6B6977 → #8B8899 → #AAACBE → #BBBCD0 (peak) → #A6A5B8 → #898795 → #07060B`.
Between domes the channel collapses to `#050C1A`–`#14171F`. Soviet replaces domes with **brass turbine fins**
— `#F0E39A` highlight / `#6D6720` body / `#422D06` shadow.

**Bottom cap (41 design px):** Allied = chrome shelf `#FCFBFF → #D0CEDF` (7 px), then a **wide blue lens arc**
`#57D3F9 → #2D4CF6 → #000066` (24 px) bisected by a 1 px vertical seam, then a dark plinth; a **silver eagle
emblem ~28 × 18 px** on the shelf at the right. Soviet = brass shelf, brushed-silver arc plate split at
centre, and a **red radiator grille** beneath — ~24 vertical bars `#8C2322`/`#730805` at 4 px pitch.

## 2.11 In-world overlay UI

**There are no selection circles, boxes or corner brackets in RA2. Selection is the health bar appearing.**
Adding C&C3/RA3-style brackets is an instant, obvious fail.

| Element | Spec (REF px; ×4/3 for OUR, ×uiScale for overlay) |
|---|---|
| **Health bar** | **34 × 4 px** for all vehicles (buildings wider, proportional to pad width). 1 px light top and bottom rules (`#DEFBEF`/`#D0FFDB`), **2 px tall fill**. Fill is a **1-on / 1-off vertical hatch (2 px period)**: green `#56AE5E`/`#5CB263` alternating with `#0A5A0C`. Damaged remainder is **unlit dark**, not a second colour. Sits **10 px above the sprite's top edge**, horizontally centred. |
| **Control-group badge** | **12 × 14 px** plate hanging off the **left end** of the bar, immediately below it. Fill `#2B0A08`, 1 px border `#CC716D`, single bright digit `#E8B0AE` at ~9 px cap. Shows the control-group number — **not** veterancy. |
| **Target line** | 1 px dotted magenta `#C060C0`, 3 px dash period, attacker → target. Waypoint routes use the same dash in faction colour. |
| **Veterancy chevron** *(NEW, flagged)* | 1 chevron = veteran, 2 = elite. Faction gold `#F8C820`, **8 × 10 px**, at the **right end of the health bar**. Not in the references — this is our addition, styled to match. |
| **Selection ellipse** *(NEW, flagged)* | 1 px faction-coloured ground ellipse at **35% opacity**, ON by default at ≥1440p, user-toggleable. Subtle. Never a filled disc, never a bracket. |

## 2.12 Bottom command bar & superweapon readout

**Command bar** — full screen width, below the world view, **28 design px** tall.
Construction top to bottom: world view → **1–2 px bright white rule** (`#F3F7FF` / Soviet `#AAAEBD`) →
**flat black `#000000` field** → **1–2 px dark red rule** (`#400E0D`).
- **Left end cap:** a chrome hydraulic ram / handle assembly, x 0–48, with two rivet bosses. Allied silver,
  Soviet brass with a red pull-ring.
- **6 icons, ~20 × 16 px, centres at x = 104 / 157 / 208 / 260 / 312 / 366 → 52 px pitch**, left-aligned.
  The right two-thirds of the bar stays empty black.
- Glyphs, left → right: ① ellipse containing one vertical bar · ② ellipse containing two vertical bars ·
  ③ a `{` followed by a 3×3 grid of dots (*formation move*) · ④ four triangular arrows radiating outward
  (*scatter*) · ⑤ a shield (*guard*) · ⑥ a dotted Z-path with a flag at the end node (*waypoint*).
- **Soft-glow line art on black — no plates, no separators.** Allied `#85CDF9`/`#DFFFFF`/`#6480C1`;
  Soviet `#E7C86E`/`#C8AC5A`/`#D3B36C`.

**Superweapon countdown** — **solid black boxes (not translucent)** inside the world view, bottom-right,
right edge **3 px clear of the sidebar**. Reference: 104 × 19 px, width fitted to the text.
Stacked rows when multiple weapons charge, **~18 px tall, ~2 px gap, each right-aligned** (ragged left edges).
Text: all-caps stencil, **9 px cap**, label left-aligned, `MM:SS` right-aligned, ~8 px between them.
**Colour = state:** charging → red `#E81B1C`/`#DE2324`; at `00:00` the row **flashes red ↔ gold** at ~1 Hz.
**NEW:** a 1 px faction-coloured progress underline across the box width.

## 2.13 Interaction states — the original has none

| State | Spec |
|---|---|
| **Hover** | Cell bevel highlight lifts `#746F75 → #B8B8C6`; 1 px faction rim fades in over **80 ms**; cameo brightness +6%; hover tick sound |
| **Press** | Whole cell offsets **+1 px down-right**, bevel inverts (highlight moves to bottom-right), **40 ms** |
| **Keyboard focus** | **2 px dashed faction outline, 8 px dash** — must be visually distinct from hover |
| **Tooltip** | 220 ms delay, appears **left of the sidebar** (never overlapping), max 280 logical px wide. Content: name / cost / build time / power delta / one-line role, plus prerequisites in red when disabled. Panel = black `#0A0A12` well with a 1 px chrome bevel — same material language as the credits readout |
| **Click timing** | UI click fires on **`pointerdown`**, never `click`. The ~90 ms difference is perceptible and makes the whole interface feel soft |

## 2.14 The chrome language — five laws

1. **Arc, arc, arc.** Four horizontal arcs stack down the sidebar (top pair, repair/sell, tab strip, bottom
   cap) and **every one bows toward the sidebar's centre**. Nothing in the chrome is a plain rectangle except
   the credits well and the cameo keys.
2. **Every edge is a 3-zone bevel:** 1 px specular highlight → 5–9 px body ramp → 1 px black terminator.
   Canonical ramp: `#3B3A43 → #6B6977 → #AAACBE → #BBBCD0 → #898795 → #07060B`.
3. **The chrome highlight is cool violet-grey `#BBBCD0`, never neutral white, never warm.** That violet cast
   is what makes it read as gunmetal rather than plastic.
4. **Wells are black and flat; plates are gradient and lit.** Credits `#10111A`, cameo keys `#080808`,
   radar `#000000`. **Nothing is mid-grey flat.**
5. **Rivets, seams, pistons.** Ten piston domes, the hydraulic end cap, the Soviet radiator grille, the rivet
   bosses. Machinery, not UI panels.

## 2.15 Faction recolour matrix — full material swap, not a hue rotate

| | **Allied** | **Soviet** |
|---|---|---|
| Frame metal | cool chrome `#BBBCD0` / `#6B6977` / `#07060B` | brass/gold `#F0E39A` / `#A89344` / `#422D06` |
| Interactive surface | blue lens `#7ED8FC → #2265FB → #050E58` | brushed silver `#CDCADB → #8A8B92` |
| Glyph | darker blue cut-out `#0D20A7` | saturated red `#B31B18` / `#A50804` |
| Accent / selected | pale cyan `#BDFFFF` | gold `#FCEB1F` (pulsing to red) |
| Numerals | `#B0CCEA` | `#F1DB75` |
| Radar frame + viewport | off-white `#C2C9BD` | gold `#FDFAB9` |
| Emblem | silver eagle, bottom-right of cap | red radiator grille + brass fins |
| Command-bar icons | glow blue `#85CDF9` | glow gold `#E7C86E` |

## 2.16 Typography

**One family, four sizes.** A condensed, squarish, all-caps display face with flat terminals, uniform stroke
weight, and **no true curves — every "O" is an octagon.** Ship it as a real variable vector font with the
original's proportions.

| Use | Cap height (design px) | Colour | Treatment |
|---|---|---|---|
| Cameo name | 8 | `#F7FBFE` | **1 px hard black outline** (never a soft shadow — the outline is a signature) |
| Credits digits | 8, 6 px pitch, tabular | `#B0CCEA` / `#F1DB75` | 1 px darker AA fringe |
| Superweapon readout | 9 | `#E81B1C` / gold | none |
| "Ready" | ~11, **bold, mixed case** | `#A9CFED` / `#E9ED63` | the sole mixed-case string in the HUD |

No anti-aliasing beyond a single darker fringe pixel. No drop shadows anywhere except the cameo-name outline.

## 2.17 HUD non-negotiables (critic fail conditions)

1. Sidebar on the **right**, **12–14% of width**, fixed aspect, never left, never floating.
2. **2-column cameo grid, 5:4 art (60 × 48 design), 10 rows.** Not 3-column, not square, not a card rail.
3. **4 tabs**, order Structures / Defence / Infantry / Vehicles.
4. **Exactly 2 arc buttons** below the radar (wrench, `$`).
5. Faction recolour is **full-material**, not a hue rotate.
6. Cameos are **rendered mini-dioramas with environment backdrops**, never flat symbolic icons.
7. Chrome highlight is **cool violet-grey**, never neutral white.
8. Command bar: full-width black strip, white rule above, dark red rule below, **6 glow-line icons at 52 px
   pitch, left-aligned**, faction-tinted.
9. **No selection circles or corner brackets in the world layer.**
10. Radar keeps its **letterboxed** map and 1 px unfilled viewport rect.

---

# 3. AUDIO SPEC

**Fully procedural WebAudio. Zero audio files. Every number is an implementation target.**

## 3.1 Engine architecture

**Context.** One `AudioContext`, `{ latencyHint: 'interactive', sampleRate: 48000 }`. Created **suspended**;
resume on the first `pointerdown` on the canvas or sidebar. Silent-fail until then. Filter frequencies are
sample-rate independent, so a device at another rate needs no adaptation.

**Bake at load, play from buffer** — the single most important performance decision. Do **not** build a
9-node graph per gunshot at runtime.
- At load, render **N variants** of each one-shot into `AudioBuffer`s via `OfflineAudioContext`.
- Variant counts: tank cannon 6 · MG round 8 · rocket launch 4 · tesla discharge 6 · small explosion 6 ·
  medium 5 · large 4 · UI click 3 · thunk 3 · error 2 · chime 1 · debris grain 12.
- Runtime playback = `BufferSource → variantGain → panner → [send] → bus` — **4 nodes, ~0.05 ms**.
- Runtime variation on top: `playbackRate = rand(0.94, 1.07)` plus `detune`. With 6 baked variants the
  effective repeat period exceeds **200 firings**.
- Bake budget **≤ 380 ms**, split across 4 rAF frames behind an "INITIALIZING AUDIO SUBSYSTEM" loading line.
  ~9.5 MB stereo float32; convert anything that gets panned to mono → ~5 MB.
- **Loops** (wind, base hum, engines, Kirov prop, music stems) stay as live graphs — they need continuous
  modulation.

**Voice budget.** Hard cap **64 one-shot sources + 24 loops + 34 music nodes = 122**.
Per-category: gunfire 16 · explosions 8 · tesla 6 · rockets 10 · engines 8 · footsteps 6 · UI 4 ·
voice 2 (1 EVA + 1 bark).
**Stealing:** when a category is full, kill the oldest instance with the lowest current gain, ramping to 0
over 12 ms first. **Pre-cull:** if the computed final gain is below **−42 dBFS**, never allocate the node.

**Crowd summation** (required for the 28-Kirov / 70-infantry screenshot): if ≥ 6 instances of the same SFX id
fire within a **90 ms** window, play **one** at `gain × (1 + 0.42·ln n)`, widen its pan to the group centroid,
and add a 55 ms smear across 3 taps at **0, 18, 41 ms** so it reads as a volley.

**Screen geometry the panner depends on:** playfield rect only, never the window.
`pan = clamp(((screenX − playfieldCx) / (playfieldW/2)) · 0.85, −0.95, 0.95)`. Never hard-pan to ±1.0.

## 3.2 EVA announcer

**Character:** female, mid-alto, **F0 ≈ 190 Hz**, near-monotone with a **−12% F0 terminal fall**. Clipped and
unemotional — a system, not a person. **150–160 wpm.** No warmth below 380 Hz; that is what makes it read as
radio rather than narrator.

**Tier B (default) — procedural formant synth.** Fully in-graph, filterable, deterministic.
- Glottal source: `sawtooth` at F0, plus a second saw **+7 cents at −9 dB**. F0 contour: 190 Hz baseline,
  ±4 Hz per syllable, **−22 Hz linear over the final 180 ms**.
- Shaping: saw → `lowpass` 2600 Hz Q 0.5 → `waveshaper` tanh drive 3.
- **Formant bank: three parallel bandpass filters**, gains 1.0 / 0.55 / 0.22, bandwidths 70 / 110 / 160 Hz.

| Phoneme | F1 | F2 | F3 | ms | | Phoneme | F1 | F2 | F3 | ms |
|---|---|---|---|---|---|---|---|---|---|---|
| /i/ | 300 | 2700 | 3300 | 95 | | /ʊ/ | 450 | 1100 | 2350 | 70 |
| /ɪ/ | 400 | 2000 | 2550 | 70 | | /u/ | 320 | 900 | 2200 | 100 |
| /ɛ/ | 550 | 1900 | 2500 | 80 | | /ʌ/ | 650 | 1200 | 2500 | 75 |
| /æ/ | 700 | 1700 | 2400 | 105 | | /ɝ/ | 490 | 1350 | 1700 | 110 |
| /ɑ/ | 800 | 1150 | 2800 | 110 | | /ə/ | 500 | 1500 | 2500 | 55 |
| /ɔ/ | 570 | 840 | 2400 | 105 | | /eɪ/ | 500→330 | 1800→2500 | 2550 | 140 |
| /oʊ/ | 550→380 | 1000→850 | 2400 | 140 | | /aɪ/ | 780→350 | 1150→2200 | 2600 | 150 |

Consonants: /s/ noise→BP 5800 Q1.8, 95 ms, −6 dB · /z/ same +F0 buzz −10 dB, BP 5200, 80 ms ·
/ʃ/ BP 2500 Q1.5, 105 ms, −5 dB · /f/ BP 6800 Q0.9, 80 ms, −13 dB · /t/ 4 ms silence + click BP 3600 Q2.5,
32 ms, −4 dB · /d/ = /t/ + 28 ms voice bar, BP 2600, 55 ms · /k/ click BP 1900 Q2.0, 38 ms, −5 dB ·
/p/ click BP 750 Q1.6, 28 ms, −8 dB · /b/ = /p/ + 30 ms voice bar, 55 ms · /n/,/m/ F0 → LP 900 + notch at
1400, 65 ms · /l/ 380/1050/2700 · /r/ 350/1050/1600 · /w/ glide 320→550 / 800→1400.

Envelope per phoneme: 8 ms attack, sustain, 12 ms release. Inter-word gap 70 ms, comma gap 180 ms.
**Ship a hand-authored phoneme string per line** (~40 lines × ~14 phonemes ≈ 3 KB JSON). **Do not write a
text-to-phoneme engine.** Bake each line once at load (~55 ms total).

**Tier A (option) — SpeechSynthesis.** Voice preference `/zira|samantha|google us english|karen|moira|female/i`
→ first `en-US` → first available. `rate 1.08, pitch 1.14, volume 0.92`.
**Critical caveat:** utterance output does **not** route through `AudioContext` in any shipping browser — it
cannot be bandpassed. Tier A must therefore be accompanied by a synthesized **radio bed** played in sync, and
the music duck must be driven by `onstart`/`onend`, not an analyser. Tier A is the *intelligibility* option;
**Tier B is the default and the aesthetic one.**

**The radio chain** (shared by EVA and all barks), serial and in this exact order:
1. `highpass` 380 Hz Q 0.71 — kills chest resonance, 70% of the effect
2. `lowpass` 2900 Hz Q 0.9 — comms band ceiling
3. `peaking` +6.5 dB @ 1750 Hz Q 1.3 — presence/squawk
4. `peaking` −4 dB @ 620 Hz Q 1.0 — de-box
5. `WaveShaper` 2048 pt, `oversample: '2x'`, `y = tanh(kx)/tanh(k)`, **k = 7.5 EVA / 11 barks**
6. `DynamicsCompressor` thr −22, knee 3, ratio 8:1, atk 0.004, rel 0.09 — **the pumping is the point**
7. Parallel slap delay 34 ms, feedback 0.12, wet −18 dB
8. Parallel micro-convolver: 180 ms IR `noise[i]·exp(−6i/N)` + discrete taps at 7/13/23 ms at 0.6/0.4/0.3, wet −24 dB
9. Output gain

**Squelch** (the mic-key clicks that sell it):
- **Pre-roll**, starting 130 ms before the first phoneme: 22 ms white noise → BP 1400 Q4, env 1 ms/20 ms,
  −20 dB; then 110 ms of carrier hiss → BP 1600 Q0.7 at −34 dB.
- **Post-roll**, 60 ms after the last phoneme: 34 ms burst → BP 1100 Q3, −22 dB, 45 ms exponential hiss tail.
- **18% of the time**, a single 9 ms dropout (gain 0 with 2 ms ramps) in the middle third.
  **Never on `Our base is under attack`** — clarity wins on alerts.

**Line inventory** (P0 = highest). Cooldowns are per-line-id, wall-clock, checked at *enqueue*.

| Line | Trigger | P | Cooldown |
|---|---|---|---|
| `Battle control online.` | match start + 1.2 s | P2 | once |
| `Construction complete.` | structure placed on the map | P2 | 2.5 s |
| `Unit ready.` | vehicle/aircraft exits the factory | P3 | **4.0 s**, max 1 per 4 s regardless of count |
| `Training complete.` | infantry exits barracks | P3 | 4.0 s (alternate with `Unit ready`) |
| `New construction options.` | a tech prerequisite is newly satisfied | P2 | 6 s — suppresses a concurrent `Construction complete` |
| `Insufficient funds.` | cameo click over budget **or** production stalls on funds > 0.5 s | P3 | **6.0 s** |
| `Cannot build here.` / `Cannot deploy here.` | red placement ghost clicked / illegal deploy | P3 | 2.0 s |
| **`Our base is under attack.`** | own structure damaged by an enemy, > 40 s since last | **P0** | **40 s** (reset only on a *fired* warning) |
| `Our forces are under attack.` | own unit damaged > 90 world units from any owned structure | P1 | 30 s, fully suppressed if the base warning fired in the last 8 s |
| `Warning: our ally's base is under attack.` | ally structure damaged | P1 | 60 s |
| `Low power.` | produced < consumed for ≥ 1.5 s continuously | P1 | 45 s; re-arm only after 10 s restored |
| `Silos needed.` | credits ≥ 0.92 × storage | P2 | 60 s |
| `Structure lost.` | own structure destroyed | P1 | 5 s; coalesce 3+ within 3 s into one |
| `Unit lost.` | own unit destroyed | P3 | **8 s** (uncapped this fires ~50×/min in a mass battle) |
| `Primary building selected.` / `New rally point established.` / `Selected structure sold.` / `Repairing.` / `Building.` | as named | P3/P4 | 1.5–3 s |
| `Reinforcements have arrived.` | scripted/paradrop delivery lands | P1 | 10 s |
| `<Superweapon> ready.` (Ironclad Field / Displacement Ring / Weather device / Nuclear silo / Force shield / Spy satellite) | charge timer hits 0 | **P0** | once per charge |
| `Nuclear missile launched.` | any player launches | **P0** | once — ducks everything −14 dB for 2.2 s |
| `Warning: incoming missile.` | hostile superweapon targets own base radius, 6 s pre-impact | **P0** | once |
| `Mission accomplished.` / `Mission failed.` / `Battle control terminated.` | win / loss / exit | P0/P0/P2 | once |

**Queue rules.** One EVA voice at a time; queue depth 3. Duplicate ids are dropped on enqueue. A full queue
drops the lowest priority (ties → oldest). **P0 preempts P2/P3/P4** — ramp the current line to 0 over 60 ms,
clear all P≥2, play immediately; P0 never preempts P0. **Global floor: 350 ms of silence between lines.**
**Session dampening:** after 5 firings in a match multiply the cooldown ×1.5, after 10 ×2.2, cap ×3 — P3/P4 only.

## 3.3 Unit barks

Same Tier-B synth and radio chain, but **k = 11**, `lowpass` **2500 Hz**, `highpass` **420 Hz**, squelch
pre-roll shortened to 60 ms. Barks are shorter than EVA and **louder in the mids** so they cut through
gunfire without extra gain.

| Class | F0 | Rate | Extra |
|---|---|---|---|
| Allied infantry (GI) | 118 | 1.00 | — |
| Allied infantry (female) | 196 | 1.02 | — |
| Soviet Conscript | 104 | 0.94 | +2 dB @ 300 Hz Q1.4 (chest) |
| Engineer / Spy | 132 | 1.10 | lowpass → 3100 Hz |
| Light vehicle crew | 126 | 1.06 | 90 Hz saw engine bleed at −26 dB |
| Heavy tank crew | 96 | 0.92 | engine bleed −20 dB, lowpass 2100 Hz |
| Aircraft pilot | 140 | 1.14 | HP 520 / LP 2400, +8 dB @ 2000 Hz, +18% noise floor |
| Naval | 110 | 0.98 | +6 dB @ 250 Hz, longer reverb send (−16 dB) |
| Attack dog | — | — | not speech — see §3.4.11 |

**Cooldowns:** 0.9 s per unit, 0.4 s globally (**only one bark voice ever exists**). If 12 units are selected,
**exactly one speaks** — the one nearest the click, weighted against speaking twice in a row. Re-selecting an
already-selected group re-barks at most every 2.5 s. Line choice is a shuffle-bag, reshuffled when empty.

**Lines (original, same register):**
- **Allied GI** — select: "GI reporting." / "Ready to move out." / "Awaiting orders." / "Standing by."
  move: "Moving out." / "On my way." / "Affirmative." / "Got it."
  attack: "Engaging." / "Opening fire." / "Target acquired." / "They're going down."
  deploy: "Digging in." / "Sandbags up."  under fire (auto, 12 s): "Taking fire!" / "We're pinned!"
- **Allied vehicle** — select: "Tank commander." / "Armor ready." / "Engine's hot." / "Crew standing by."
  move: "Rolling out." / "Moving." / "Repositioning."  attack: "Target in sights." / "Firing main gun." / "Engaging armor."
- **Allied air** — select: "Airborne." / "Pilot ready." / "Wings level."  move: "Vectoring in." / "Climbing out."
  attack: "Weapons free." / "Missiles away." / "Rolling in hot."
- **Allied Engineer** — select: "Engineer here." / "Tools ready."  capture: "I'll get it running." / "Moving to secure."
- **Soviet Conscript** — select: "Conscript reporting." / "For the Union." / "Awaiting command." / "Ready, Comrade."
  move: "Moving, Comrade." / "As ordered." / "Da." / "We advance."
  attack: "Attacking!" / "Open fire!" / "Crush them!"  under fire: "We are under fire!" / "Comrade, we need support!"
- **Soviet vehicle** — select: "Armor standing by." / "Tank ready, Comrade." / "Treads warm."
  move: "Advancing." / "The line moves forward."  attack: "Cannon loaded." / "Nothing will stand." / "Firing."
- **Soviet air** — select: "Kirov reporting." / "Airship ready."  move: "Course laid in." / "Ascending."
  attack: "Bomb bay open." / "Payload away."
- **Tesla Trooper** — select: "Charged." / "Coils hot."  attack: "Discharging!" / "Feel the current!"
- **Harvester** — select: "Ore truck ready."  ordered: "Heading to the field."  full (auto, P4, 20 s): "Cargo full, returning."
- **MCV** — select: "Construction vehicle standing by."  deploy: "Deploying."

## 3.4 Weapons, impacts, engines

Envelopes are (attack ms → peak → decay ms). **Never exponential-ramp to 0** — go to 0.0001, then
`setValueAtTime(0)`. Levels are peak dBFS at the SFX bus input, before distance attenuation.

**3.4.1 Tank cannon** (900 ms, four layers):

| Layer | Source | Frequency motion | Envelope | Level |
|---|---|---|---|---|
| A crack | noise → LP Q1.0 | 6500 → 420 Hz exp over 140 ms | 1 ms → 1.0 → 180 ms | −4 dB |
| B body | sine | 112 → 41 Hz exp over 220 ms | 2 ms → 0.9 → 320 ms | −3 dB |
| C punch | triangle | 250 → 62 Hz over 60 ms | 1 ms → 0.75 → 90 ms | −8 dB |
| D tail | pink noise → LP 300 → reverb send | static | 40 ms → 0.5 → 750 ms | −16 dB |

Anvil Tank variant: **all frequencies ×0.86, all decays ×1.25, layer B +2 dB.**
Sledge: fire the stack twice, second at +95 ms, −2.5 dB, pitch ×1.04.
**Shell eject** 30% of the time at +55 ms: noise → BP 3200 **Q 12**, 3/120 ms, −22 dB, pan +0.06.
**Muzzle sub-thump** for camera-shake sync: 45 Hz sine, 8/70 ms, −10 dB, **bypassing the distance lowpass**.
Variance: freq ×rand(0.94,1.07), durations ×rand(0.92,1.08), level ±1.5 dB, pan ±0.04.

**3.4.2 Machine gun** (90 ms per round): snap = noise → HP 400 → BP 1800 Q1.4, **0.5 ms → 1.0 → 16 ms**, −7 dB ·
thump = square 185 → 88 Hz over 25 ms, 1/30 ms, −13 dB · air tail = noise → HP 3500, 2/55 ms, −20 dB.
**Rate 11 rounds/s (91 ms period) ±8 ms jitter. Bursts of 5–9. Inter-burst gap 0.55–0.90 s.**
Round 1: +2 dB, tail ×1.2. Rounds 2..n: level ×rand(0.80,1.00), rate ×rand(0.90,1.12).
Alternate pan ±0.035 round-to-round. Flak variant: rate 6/s, add a 40 ms BP 900 Q3 clank + an airburst
0.4–0.9 s later (small explosion at −9 dB, ×1.3 pitch).

**3.4.3 Rocket / missile.** *Launch (0–350 ms):* noise → BP **Q 0.8** sweeping 400 → 2400 Hz, env 25 ms → 1.0,
−8 dB; ignition crack noise → HP 1500, 0.5/45 ms, −6 dB; sub kick sine 95 → 48 Hz over 120 ms, −11 dB.
*Flight (0.9–2.4 s):* pink noise + saw 62 Hz (−14 dB) → LP sweeping **900 → 1600 Hz** Q1.2, 23 Hz tremolo
depth 0.15, level −12 dB × distance, updated at 20 Hz. **Doppler:**
`detune = 1200·log2(343 / (343 − v_radial))` clamped ±350 cents, 20 Hz update with a 50 ms ramp.
Panning updated at 20 Hz along the flight path — **the strongest 3D cue in the whole mix.**
*Impact:* medium explosion + 8 debris grains.
Patriot/AA: flight 0.4–0.8 s, LP 1400 → 2600 Hz, 14 Hz tremolo at depth 0.3 (reads as a seeker).

**3.4.4 Prism.** Charge 260 ms: sine 620 → 2100 Hz exp, 200 ms attack → 0.5, ring-mod partner at 971 Hz at 30%.
Fire 200 ms: sine **1800 → 320 Hz over 180 ms**, 1/200 ms, −5 dB. Ring modulator at 970 Hz, wet 45%.
Shimmer: noise → BP 6200 Q3, 5/180 ms, −18 dB. Refraction split: repeat at −4 dB, ×1.19, +90 ms.

**3.4.5 Tesla coil** (6 can fire at once — variance is load-bearing).
*Charge 700 ms:* saw 55 → 220 Hz exp → BP 300 → 2000 Hz Q2.5, gain −30 → −10 dB, ring-mod vs a 3000 Hz sine
at 25% wet (this is what makes it electrical rather than a siren), 7 Hz flutter rising to 19 Hz at depth 0.12.
*Discharge 220 ms:* **3–5 grains**, each 14 ms noise → BP `rand(1200,5200)` Hz **Q rand(6,14)** + a square at
centre/2 with 8 ms decay at −8 dB. Amplitudes `[1.0, 0.7, 0.45, 0.3, 0.2]`, onsets `[0, 34, 71, 118, 176]` ms
±12 ms. Whole discharge ring-modulated by **130 Hz** at 35% wet.
*Body 400 ms:* sine 60 + sine 50 (10 Hz beat), 3/400 ms, −9 dB.
*Crackle tail 250 ms:* noise → HP 2500, gain gated by `random() > 0.45` evaluated at **60 Hz** (write the
control-rate buffer during the offline bake), −20 dB.
6 baked variants + runtime rate rand(0.93,1.09) → perceived repeat period > 40 s with 6 coils on a 2 s cycle.

**3.4.6 Explosions.**
- **Small** (260 ms): noise → LP **3000 → 300 Hz over 120 ms**, 0.5/180 ms; sine 125 → 52 Hz over 100 ms at
  −9 dB. Peak **−14 dB**, reverb send −28 dB.
- **Medium** (1.1 s): pre-crack noise → HP 2200, 0.4/28 ms, −6 dB; body noise → LP **5000 → 180 Hz over
  400 ms** Q0.9, 1/700 ms; sub sine 92 → 30 Hz over 450 ms, 3/620 ms, **−3 dB** (loudest single element);
  **6–10 debris grains** of 20 ms noise → BP rand(900,4000) Q4, onsets over 250–900 ms, −24 dB, pan ±0.15.
  Peak **−4 dB**, send −18 dB.
- **Large** (2.6 s): pre-crack HP 2000, 40 ms, −3 dB; body noise → LP **6000 → 120 Hz over 900 ms** exp,
  2/1600 ms; sub sine 70 → 22 Hz over 1200 ms, 5/1500 ms, **−1 dB**; rumble bed pink → LP 90 Hz modulated by
  a **0.7 Hz** sine at depth 0.5, 900 ms, −12 dB; **4 metallic collapse hits at 380/620/910/1350 ms**
  (noise → BP rand(200,700) Q8, 90 ms, −16 dB); **25 debris grains** over 2.5 s at −20 dB.
  Peak **−1 dB**, send −10 dB. **Ducks the SFX bus −9 dB (12 ms / 400 ms / 700 ms) and music −3 dB — the mix
  clearing for the boom is the single most impactful trick in the spec.**
- **Nuke** (9 s): *pre-roll 3.5 s* — two saws at 220 and 331 Hz sweeping ×1.9 up exponentially through
  LP 1400 → 4000 Hz, gain −24 → −8 dB, 0.9 Hz wobble. *Detonation* — Large with all frequencies ×0.72 and all
  durations ×2.1. *Shockwave* — a second body layer at +420 ms, noise → BP 180 Hz Q0.6, 1.4 s, −7 dB.
  *Tail* — 6 s convolver at wet −6 dB. *Tinnitus* — 4200 Hz sine at −32 dB from +200 ms decaying over 2.0 s,
  with a **master lowpass sweeping 900 → 18000 Hz over 1.2 s**, fully recovered by t+3.2 s.
  Ducks everything else **−14 dB for 2.2 s**.

**3.4.7 Superweapon FX.** *Ironclad Field:* saw 40 + 41.5 Hz (1.5 Hz beat) → LP 300, 1.4 s, −8 dB; metallic
"seal" noise → BP 2400 Q9 with a **reversed envelope** (600 ms rise, 40 ms cut), −12 dB. Invulnerable units
get a +140 Hz resonant peak (Q6) on their own weapon sounds. *Displacement Ring:* ascending sine glissando
200 → 3200 Hz over 900 ms with a 3-tap feedback delay (170 ms, fb 0.55); the departure is the **time-reversed
buffer** of the arrival.

**3.4.8 Impacts.** Armor hit: 12 ms noise → BP rand(2200,4800) Q10, 70 ms, −18 dB. Ricochet (15%): + a sine
sweeping rand(2600,4200) → rand(700,1200) Hz over 220 ms at −24 dB. Dirt/snow: 30 ms noise → LP 900,
110 ms, −22 dB; snow adds an HP 2500 crisp layer at −28 dB.

**3.4.9 Frequency-slot allocation** (prevents mud when 5 families fire at once):

| Family | Owns | Carve applied to it |
|---|---|---|
| Explosion sub | 20–90 Hz | — (owns it) |
| Tank cannon | 90–500 Hz + 2–7 kHz | −3 dB @ 1500 Hz Q1 |
| Machine gun | 1.2–4 kHz | highpass 180 Hz |
| Rocket motor | 400–1600 Hz | highpass 200 Hz, −4 dB @ 3 kHz |
| Tesla | 2–6 kHz + a 130 Hz ring | highpass 90 Hz |
| Voice / EVA | 380–2900 Hz | the ducks make room |
| Music | full range | −4 dB shelf above 4 kHz at combat L3+ |

**3.4.10 Engine loops.** All are 2.0 s baked buffers with `loop = true`, `playbackRate` driven by throttle so
nothing re-renders.
- Light vehicle: saw at `55 + 42·throttle` Hz + a second saw ×1.5 detuned +9 cents → LP `500 + 900·throttle`
  Q3 → tanh drive 4. −26 dB idle, −18 dB full.
- Heavy tank: base 38 Hz, plus a **tread layer** — noise → BP 1100 Q2 gated at `4.5 · speed` Hz, −24 dB.
- Kirov: prop = saw 8.5 Hz through LP 220 used as an *amplitude gate* on pink noise → BP 180 Q1.2, plus a
  44 Hz drone. **Capped at 4 real voices**; instances 5..28 fold into crowd summation with the drone at +1.4.
- Aircraft: pink noise → BP 1600 Q0.8 + saw 130 Hz, Doppler on the whole chain.

**3.4.11 Attack dog.** Not speech. 3 saws at 340/510/680 Hz through a BP sweeping 700 → 1800 → 500 Hz over
180 ms, env 4 ms → 1.0 → 40 ms → 0.4 → 180 ms, plus a noise layer at −14 dB. 2–3 barks at 210 ms spacing,
each ×rand(0.92,1.10).

## 3.5 Ambience & UI

**Wind** — source is a **10 s Voss-McCartney pink noise buffer** (6 octaves) generated once at load, looped
with a 400 ms equal-power crossfade at the seam.

| Theatre | Level | LP cutoff | Cutoff LFO | Gain LFO | Extra |
|---|---|---|---|---|---|
| **Desert** | −30 dB | 380–900 Hz | 0.05 Hz (±220) + 0.13 Hz (±90) | 0.06 Hz, depth 0.35 | gust every 18–40 s: cutoff → 1400 Hz, +5 dB, 2.5 s env |
| **Snow** | −24 dB | 300–700 Hz | 0.07 + 0.19 Hz | 0.09 Hz, depth 0.45 | whistle: noise → BP 1250 **Q 7** at −34 dB, centre wandering ±180 Hz at 0.11 Hz |
| **Urban** | −34 dB | 250–550 Hz | 0.04 Hz | 0.05 Hz, depth 0.25 | distant traffic: pink → LP 400 at −40 dB |

**Base hum** — 3 saws at **50.0 / 50.6 / 75.0 Hz** (the 0.6 Hz beat is the generator wobble) → LP 220 Q1.5 →
tanh drive 2. Level by power-plant count: 1 = −34 dB, 2 = −31, 3 = −29, 4 = −27.5, 5 = −26.5, **6+ = −26**.
**On low power: all three oscillators sag −80 cents over 3 s and gain a 1.6 Hz flutter at depth 0.3** — the
player hears the brownout before EVA says it. Mono, centred, no distance attenuation; fades over 4 s if the
camera moves > 40 tiles from any owned structure.

**Water** — instantiated only when water > 8% of the visible frustum. Noise → BP 700 Q0.8, gain gated by a
0.35 Hz + 0.9 Hz sine pair (combined depth 0.6), −33 dB. Pan follows the visible-water centroid, clamped ±0.4.
Snow maps add an ice crack every 25–60 s: 90 ms BP 1800 Q12, −28 dB, random pan.

**Refinery / harvester** — refinery loop: square 30 Hz + noise → BP 450 Q2 gated at 1.4 Hz, −28 dB, positional.
Ore dump: 900 ms noise → LP 1200 → 400 Hz with 14 rattle grains, −16 dB.

**UI sounds** — all baked, all on `uiBus`, all mono-centred, **no distance and no pan**.

| Sound | Recipe | Level |
|---|---|---|
| Cameo click | 8 ms noise → BP 2200 Q3 (−10 dB) + square 900 Hz 6 ms 1 ms attack (−14 dB) + sine 55 Hz 40 ms (−16 dB) | −12 dB |
| Tab / sidebar button | as above with BP 1500 and a 130 Hz thump, 55 ms | −13 dB |
| Hover tick | 4 ms noise → BP 3400 Q5 | −28 dB |
| Build-complete chime | **G5 784 / B5 988 / D6 1175 Hz** at 0 / 90 / 180 ms, each = fundamental + ×2 (−12 dB) + ×3 (−20 dB), env 4 ms → 380 ms exp; whole chime through a 90 ms delay fb 0.2, wet −20 dB | −10 dB |
| Ready flash | sine 1568 Hz, 3/160 ms, + a 3136 Hz partial at −16 dB | −18 dB |
| **Placement thunk** | sine 140 → 48 Hz over 220 ms (2/260 ms) + noise → LP 400, 90 ms + dust noise → BP 1100 Q1.2, 40 ms attack → 0.35 → 480 ms | **−6 dB** (it must feel heavy) |
| Placement ghost move | 3 ms noise → BP 2800 Q6, max 8/s | −34 dB |
| Error buzz | square 110 Hz + square 110 Hz at −12 cents, gated into **3 pulses of 55 ms with 45 ms gaps**, → BP 700 Q3 → tanh drive 6 | −11 dB |
| Sell / demolish | descending saw 400 → 90 Hz over 500 ms → LP 900 + a 3-hit debris tail | −12 dB |
| **Marquee drag** | **silence — correct. RA never sounded the selection box.** | — |
| Minimap ping | two sines at 1046 Hz, 60 ms each, 140 ms apart, hard-panned to the alert's screen-x | −20 dB |
| Superweapon tick | T−10 s and below: 20 ms sine 1200 Hz + 8 ms click, once/s, ramping −30 → −18 dB; the T−0 tick is 1600 Hz at −14 dB | — |

## 3.6 Music — procedural industrial military rock

> **Original composition generated at runtime**, in the genre and instrumentation of the series' industrial-rock
> combat themes. **Do not transcribe or reproduce any copyrighted riff, melody, or vocal sample.**

**Global:** **122 BPM** (quarter 491.8 ms, eighth 245.9, **16th 122.95**, bar 1967.2 ms). **E natural minor**,
with a **Phrygian ♭2 (F♮)** substituted in the tension bars — that half-step is where the menacing military
character lives. E1 = 41.20, E2 = 82.41, G2 = 98.00, A2 = 110.00, B2 = 123.47, E3 = 164.81.
**Loop 32 bars = 62.95 s**, four 8-bar sections **A / B / C / D**.
**Scheduler: lookahead.** `setInterval(tick, 25)` scheduling everything in `[now, now + 0.12 s]` against
`ctx.currentTime`. Never schedule from `setTimeout` alone — the 10–40 ms drift is audible on 16ths.

**Bass ostinato** (the engine of the track): straight **16ths on E1**, palm-mute character. Saw + square
(−8 dB) + sine sub (−4 dB). Per note: LP env **1600 → 380 Hz over 55 ms** Q4; amp 2 ms → 1.0 → 88 ms, hard
8 ms release → **105 ms note with an 18 ms gap** (the gap is what makes it chug). Accent multipliers per bar:
`[1.00, .62, .72, .62, .94, .62, .72, .66, 1.00, .62, .72, .62, .90, .68, .80, .74]`.
Roots per bar — **A:** E E E E E E G F#(→F♮ on the last beat) · **B:** E E G G A A B B ·
**C:** E E E G A A♭ G E · **D:** E E C C B B E E. Level −8 dB through tanh drive 5.

**Rhythm guitar:** two saws detuned **±11 cents** at E2 (octave-doubled at E3, −9 dB) → tanh **drive 12** (4×
oversample) → cabinet: HP 90 → BP 1600 Q0.7 (mix 60%) → LP 4500 Q0.9 → peaking +4 dB @ 2400 Q2 →
peaking −5 dB @ 400 Q1.4. 8ths in B/C, sustained power chords in A, silent in D's first 4 bars.
**Haas double-track:** two instances panned −0.55 / +0.55, right delayed **11 ms** and +4 cents, −11 dB each.

**Kick:** sine **120 → 45 Hz over 45 ms**, 1 ms → 1.0 → 180 ms, plus a 6 ms beater click → HP 3000 at −18 dB.
Pattern (16ths) `[1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0]` in A/B; `[1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0]` in C.
−6 dB.

**Snare:** body triangle **190 Hz** (1/90 ms); wires noise → BP 900 Q0.7 + HP 4200 summed (1/110 ms); rim
crack 4 ms noise → BP 2800 Q6 at −8 dB. Backbeat on **steps 4 and 12** always; ghosts at −16 dB on 7/11/15 in
C; a **16th roll on steps 12–15** in the last bar of every 8 with gains `[0.5, 0.65, 0.8, 1.0]`. −8 dB,
send −20 dB into a separate 320 ms plate.

**Hats & metal:** closed hat 6 ms noise → HP 7000 + BP 9500 Q2, 28 ms, −20 dB, on every off-8th in B/C.
**Anvil (the industrial signature):** noise → 3 parallel BP at **1873 / 2790 / 4310 Hz, Q 22 each**,
1 ms → 1.0 → 620 ms, on step 8 of bars 4 and 8 of each section, −14 dB, pan alternating ±0.3.

**Brass stabs:** 5 saws — root, +1200¢, minor 3rd, 5th, +1900¢ — detuned `[0, +6, −5, +8, −7]` cents.
Env 12 ms → 1.0 → 40 ms → 0.7 → 180 ms release; LP env **400 → 3200 Hz over 30 ms** Q2, back to 1400 Hz on
release. Bar 1 step 0 and bar 5 step 0 of B; steps 0/6/10 of every bar in C. Chords Em / C / D / Em, one per
2 bars. −13 dB, widened with a 15 ms L/R delay.

**Choir pad (A and D):** 3 saws per note → LP 900 Q0.8 + a formant pair (BP 620 Q5 + BP 1100 Q5) to fake
vowels. 2.5 s attack, whole notes, −20 dB, heavy send (−8 dB into a 3.2 s tail).

**Siren lead (C only):** saw → LP driven by a **0.5 Hz triangle LFO between 500 and 4500 Hz, Q 8**. −17 dB,
sustained E4/B3 alternating every 2 bars.

**Dynamic intensity.** Compute combat heat each second:
```
H = clamp( 0.55·(damage dealt+taken in last 4 s / 900)
         + 0.30·(hostile units within 30 tiles of camera / 12)
         + 0.15·(own units firing / 10), 0, 1 )
```
Smooth with `H_s += (H − H_s)·0.12` per 250 ms tick (~2 s up). **Decay is slower: factor 0.04 (~6 s down)** —
music must not drop out the moment a fight pauses.

| Layer | H_s | Instruments added | Bus level |
|---|---|---|---|
| **L0 Idle** | 0.00–0.10 | pad only, half-tempo kick on beat 1 | −16 dB |
| **L1 Base** | 0.10–0.28 | + bass ostinato, kick, closed hat | −12 dB |
| **L2 Alert** | 0.28–0.52 | + snare backbeat, guitar 8ths, anvil | −10 dB |
| **L3 Combat** | 0.52–0.78 | + brass stabs, double-time kick, snare ghosts | −8 dB |
| **L4 Full** | 0.78–1.00 | + siren lead, octave guitar, snare rolls every 4 bars | −7 dB, **+3 dB shelf below 120 Hz** |

**Layer changes only take effect on a bar boundary** (2-bar going down). Never crossfade mid-bar — it sounds
like a bug. Crossfade = 1 bar (1.967 s) equal-power on each stem's gain.
Section order A→B→C→D→A is independent of intensity, **except** that if `H_s > 0.6` when D would start,
**repeat C instead (max 3 consecutive)** so the peak doesn't deflate mid-battle.
Win → crossfade to an **E major, 108 BPM, brass-led** variant over 1.5 s.
Loss → detune everything **−700 cents over 2.5 s** while the gain ramps out; stop at t+3 s.

**Node hygiene:** pool the gain+filter chains; oscillators can only be started once, so allocate them fresh
and `stop()` at note end + 50 ms. ~24 oscillator allocations/s at L4, ~0.3 ms/s measured. Pre-allocate 48
gain/filter pairs rather than churning per 16th — GC pauses click.

## 3.7 Mix

```
                                     ┌── musicDuck ──┐
[music stems] ── musicBus (-9 dB) ───┤               ├──┐
                                     └───────────────┘  │
[weapons/expl] ─ sfxBus   ( 0 dB) ─── sfxDuck ──────────┤
[EVA + barks] ── voiceBus (+2 dB) ─── (no duck) ────────┼── masterGain (-1 dB)
[UI]  ────────── uiBus    (-4 dB) ─── uiDuck ───────────┤        │
[wind/hum/water] ambBus   (-14 dB) ── ambDuck ──────────┘        ▼
      (sends) ── reverbSend → Convolver → reverbReturn (-18 dB) ─┤
                                                                 ▼
                                                DynamicsCompressor (limiter)
                                                                 ▼
                                                     WaveShaper (soft clip)
                                                                 ▼
                                                          destination
```

Every bus is `GainNode(level) → GainNode(duck, default 1.0)`. Five user sliders (Master, Music, SFX, Voice,
Ambience) map to the *first* gain of each bus with `gain = (v/100)^2.2`.

**Ducking** — all on the duck nodes via `setTargetAtTime`:

| Trigger | Bus | Amount | Attack | Hold | Release |
|---|---|---|---|---|---|
| EVA playing | music | **−11 dB** | 60 ms | line | 450 ms |
| EVA playing | sfx | −5 dB | 60 ms | line | 350 ms |
| EVA playing | ambience | −6 dB | 80 ms | line | 500 ms |
| Unit bark | music / sfx | −4 / −2 dB | 40 ms | bark | 250 / 200 ms |
| Large explosion | sfx / music | −9 / −3 dB | 12 / 20 ms | 400 / 300 ms | 700 / 600 ms |
| Nuke | music, sfx, ui, amb | **−14 dB** | 30 ms | 2200 ms | 1200 ms |
| Paused | all except ui | −inf | 200 ms | — | 300 ms |
| Window blur | master | −inf | 400 ms | — | 400 ms (then `ctx.suspend()` after 2 s) |

**Ducks are multiplicative and stacked** — compute `duckGain = Π(active factors)` in a single reducer and
apply with `setTargetAtTime(v, now, 0.02)`. **Never let two systems write competing ramps to one AudioParam.**

**Panning.** `StereoPannerNode` for everything except in-flight rockets and aircraft, which use `PannerNode`
with `panningModel: 'equalpower'` (HRTF costs 8× for no benefit in a top-down game). Off-screen sounds still
pan, using extrapolated screen position, clamped. **Vertical screen position does not affect pan** — it adds
+2 dB of reverb send for the upper 30% of the playfield ("further away").

**Distance** (`d` in world tiles, `z` = zoom):
- Gain `g = 1 / (1 + (d·z / 18)²)` → −6 dB at 18 tiles, −14 at 36, −20 at 54.
- Lowpass `fc = clamp(18000 / (1 + d·z/24), 900, 18000)` Hz.
- Highpass `fhp = clamp(20 + d·z·1.4, 20, 220)` Hz — thins distant events so the sub belongs to nearby action.
- Reverb send `= −24 + 14·clamp(d/40, 0, 1)` dB.
- **Cull below −42 dB.** Update moving sources at **20 Hz** with a 50 ms `setTargetAtTime` so nothing zippers.
- At max zoom-out (`z = 2.2`) apply an extra **−3 dB SFX trim and +2 dB ambience** — wide shots feel
  atmospheric, not punchy.

**Reverb** — procedural IRs generated with `OfflineAudioContext` at load:
`ir[i] = (2·rand()−1) · pow(1 − i/N, 3.2)`, run through an offline lowpass at the damping frequency, then
early taps stamped at 0.6 / 0.4 / 0.3 / 0.22. **Stereo with independent noise seeds** (decorrelation = width).

| Environment | RT60 | Pre-delay | Early taps (ms) | Damping | Wet return |
|---|---|---|---|---|---|
| Desert | 1.10 s | 12 ms | 9, 17, 31 | LP 5.5 kHz | −22 dB |
| Snow | 0.60 s | 8 ms | 7, 13 | LP 3.5 kHz | −26 dB |
| Urban | 1.90 s | 18 ms | 11, 19, 29, 41 | LP 7 kHz | −16 dB |
| Water-heavy | 1.40 s | 14 ms | 13, 23, 37 | LP 6 kHz | −20 dB |

**One convolver active at a time**, crossfaded over 2 s on theatre change.

**Master.** `DynamicsCompressor` thr −6, knee 0, ratio 20, atk 0.003, rel 0.25 → `WaveShaper` soft clip
(4096 pt `tanh(1.6x)/tanh(1.6)`, `oversample: '4x'`) → `masterGain = 0.891` (**−1.0 dBFS ceiling**).
**Target integrated loudness ≈ −16 LUFS** at the L2 combat state; peaks at −1 dBFS on nukes only.

**Accessibility.** Options → Audio: 5 sliders; **EVA voice: Synthesized / System / Off**; **Unit responses:
On / Reduced (selection only) / Off**; **Reduce loud transients** (caps explosions at −9 dB, disables the nuke
master-lowpass); **Mono output** (`ChannelMergerNode` sum before the limiter).
**Subtitles:** every EVA line and bark emits its text. EVA renders bottom-centre of the playfield in the
superweapon red (`#D01818`), 16 px, 3.5 s dwell; barks in white at 13 px, 1.8 s dwell.

## 3.8 Build order

1. Context + bus graph + limiter + 5 sliders (~150 lines)
2. Bake system + one-shot player with pan/distance (~200 lines)
3. **UI sounds** — instant, huge perceived-quality win, testable with no game running
4. Cannon, MG, explosion S/M/L — **four sounds cover 80% of the soundscape**
5. Ambience (wind + base hum)
6. EVA Tier B + the 8 highest-value lines + the priority queue
7. Music L0–L2, then L3–L4
8. Rockets/Doppler, Tesla, Prism
9. Unit barks
10. Superweapons, reverb theatre switching, options panel, subtitles

---

# 4. SCORECARD

26 criteria, **scored 0–10 each and multiplied by the weight column. Weights sum to 37 → maximum 370.**
**Ship gate: weighted total ≥ 280 (75.7%) with no single criterion below 4.**
Visual criteria are scored from a 1920×1080 screenshot of a desert Allied base (plus a snow shot for C13 and a
mass-battle shot for C21). Audio criteria are scored by reading the audio source.

| # | Criterion | Weight | **Fail (0–3) looks like** | **Pass (8–10) looks like** |
|---|---|---|---|---|
| **C1** | **Projection purity** | ×2 | Any convergence: parallel building edges meet, distant cells are smaller than near ones, camera tilts on zoom. FOV > 12°. | Orthographic. Parallel edges converge **≤ 1 px over 1600 px**. Cell diamond aspect **2.000 : 1 ± 0.5%**. Ground axes at **26.565° ± 0.3°**. |
| **C2** | **Framing / zoom** | ×1 | 28+ cells across; the base is a cluster of tiny objects; reads as StarCraft II. | **20–22 cells across the playfield**, cell ≈ 80 × 40 px. Individual tank turret angles are readable without zooming. |
| **C3** | **Tone contract** | ×2 | Playfield luma mean > 130 or std > 55. Bright sky-lit sand. >8% of pixels above luma 150. | Playfield luma **mean 96 ± 10, std 32 ± 8, p5/p95 = 27/123 ± 10**, **≤ 4% above luma 150**. Terrain and UI occupy visibly different value bands. |
| **C4** | **Ground grain** | ×2 | Flat/plastic ground, or a single tiled photo texture. 1-px blur residual < 4 or > 15. Isotropic noise. | **1-px residual std 8.6 (band 6–12)**, visibly anisotropic — fine diagonal combing **stretched 2:1 along the `(+2,+1)` axis** at 4× zoom. |
| **C5** | **Cell structure** | ×1 | One seamless ground; no diamond structure anywhere; or a visible grid line overlay. | **Per-cell ±5 luma quantization with hard diamond edges** and ~**7% dark variant cells** at −15…−25 luma, visible as soft diamond patches at 4×. No drawn grid lines. |
| **C6** | **Hue discipline** | ×1 | Desert hue spread across 25–55°; grey-desaturated dark sand; emerald grass. | Sand hue **41° ± 3°** across all values, mean HSV sat **0.52 ± 0.08**, **saturation rises as lightness falls**. Grass luma mean ≈ 61 at hue 65–69°. |
| **C7** | **Terrain-type transitions** | ×1 | Smooth alpha gradients between sand/rock/snow/water over 20+ px. | **Dithered/stippled 2-cell transitions** — state flips repeatedly over 5–20 px with no monotonic ramp. |
| **C8** | **Shadow geometry** | ×2 | Shadows on a screen diagonal, or pointing down-left, or 2× too long, or soft area shadows with 20 px penumbra. | Shadows along the **`(+2,−1)` axis at 26.565° ± 5°**, **screen length 1.10 × object screen height (0.95–1.25)**, **constant 3 px penumbra**. |
| **C9** | **Shadow colour** | ×2 | Blue-tinted shadows (B > R). Sky-IBL ambient. Shadows lighter than 0.6 or crushed to black. | Per-channel multiply **(0.48, 0.50, 0.40) ± 0.07** with **B ≤ R − 0.04** — shadows read slightly warmer and more saturated than the lit surface. |
| **C10** | **Roads** | ×1 | Extruded road geometry with bevels, bright white `#FFFFFF` lane paint, saturated yellow centre line, rounded corners, edge AO. | **Flat height-0 decal**, asphalt p50 `#212522`, corridor **1.13 cells of asphalt**, **markings at luma 130–150**, dirty ochre `#403A1F` centre line, hard 90° mitres, 6-px shoulder band. |
| **C11** | **Tread marks** | ×1 | Absent. Or hard-edged, straight, uniformly dark, stacking darker on overlap. | **Paired ruts, 19 px each (OUR), 0.65 multiply, soft 4-px falloff**, long curving arcs, multiple generations at different fades, overlaps **saturating at 0.62**. |
| **C12** | **Scatter distribution** | ×1 | Evenly Poisson-scattered pebbles; or clean empty ground; or rocks covering 15% of the area. | **Clusters of 8–15 pebbles per ~1 cell, 1 cluster per 6–10 cells, 3.05% total coverage (2–5%), rock luma = 0.66 × sand luma.** |
| **C13** | **Water** | ×1 | Reflective water, SSR, sky mirror, animated normal-mapped waves, foam lines at the shore. | **Two flat tones covering ~78%**, deep `#06305F` (arctic) / `#283142` (temperate), **zero reflections**, dithered ring waves at 16–32 px scale, **dithered 5–20 px shore rim, no foam**. |
| **C14** | **Cliffs & elevation** | ×1 | Smooth extruded walls, vertical striations, arbitrary heights, AO pooling at the base. | **Stacked 20-px shelves**, silhouette breaking every 11–27 px, **striations along the iso axes**, a biome cap on every ledge, all vertices snapped to **0.408 world units**. |
| **C15** | **Size ladder** | ×2 | Tanks at or above cell width; infantry the same size as tanks; the harvester indistinguishable from a tank. | Tank hull **35 px OUR (≤ 44 max)**, infantry **17 × 24**, harvester **≥ 2.2× the tank's area with no barrel**. Four non-overlapping aspect classes. |
| **C16** | **Silhouette law** | ×2 | Detailed panel-lined models that mush at 35 px; no barrel spike; point-symmetric hulls; no track band. | Every combat vehicle has **one near-black barrel ≥ 15 px OUR at ≤ 3 px wide**; a **3–4 px dark track band with road-wheel dots**; a readable front; **5–7 distinguishable colour blocks** total. |
| **C17** | **Building proportion** | ×1 | Squat, geometrically-correct buildings; Refractor Tower shorter than 1.6× its base. | **×1.25 vertical push applied.** Height : pad-width ratios within ±15% of: Refractor 2.04, Tesla 2.60, Proving Ground 1.40, War Factory 0.36. |
| **C18** | **Faction material split** | ×2 | Grey PBR metal on everything; both factions distinguishable only by accent hue. | Allied shows **≥2 of** {white ceramic tile `#C8C8C8`, polished chrome, blue glass} with **blue-black shadows `#282838`**. Soviet shows **≥2 of** {riveted plate, ochre brick `#A08868`, red slab `#A80808`, exposed pipe} with **warm-black shadows `#180808`**. |
| **C19** | **Team colour placement** | ×1 | Whole-hull tint; team colour > 25% or < 3%; accent only on top faces; a flat roof wash on buildings. | **7–10% of vehicle pixels, 2.5–4% of building pixels**, contiguous, **touching the silhouette edge**, on camera-facing surfaces, **15–30% brighter than the surrounding hull**. Buildings use vertical slabs/edge stripes. |
| **C20** | **Grounding** | ×1 | Buildings float; no pad; rounded pad corners; pad identical in every theatre. | **Pad decal 5–13 px past the silhouette on the exact cell diamond**, 2 px `#22231D` rim, **contact AO 15% darker in the 3–5 px touching the wall**, hard cast shadow, **theatre-appropriate pad material**, painted markings present. |
| **C21** | **Blob readability** | ×1 | A 30-unit army is a uniform coloured carpet; tanks and harvesters indistinguishable; units merge with the ground. | At 100% zoom a viewer can **count the tanks and tell tanks from harvesters without pausing**. ≥30 luma separation from the ground, 1–1.5 px contact edge, ~0.9 cell spacing, visibly varied turret angles. |
| **C22** | **VFX language & post** | ×1 | Subtle desaturated particles; bloom on the terrain; vignette, chromatic aberration, DOF, TAA smear; grey smoke only. | Muzzle flash a **19-px OUR 4-point `#F8C020` star (~half the tank's width)**; tesla `#F0F0FF` polyline with `#8898FF` glow; damage flames 19–29 px OUR saturated orange. **Bloom on the emissive buffer only** — zero terrain bloom, zero vignette/CA/DOF/TAA. |
| **C23** | **Sidebar geometry** | ×2 | Sidebar on the left, floating, or < 10% / > 18% of width; 3-column or square cameos; wrong tab count; 4 arc buttons; a full-bleed minimap. | Right side, **12–14% of width**, **2 × 10 grid of 5:4 cameos (90 × 72 at 1080p) at 64/50 design pitch**, **4 tabs** (Structures/Defence/Infantry/Vehicles), **exactly 2 arc buttons** (wrench, `$`), **letterboxed radar with a 1 px unfilled viewport rect**, vertical power bar in the left gutter, 10 piston domes in the right. |
| **C24** | **Sidebar material** | ×2 | Flat mid-grey panels; neutral-white highlights; rectangular everything; a hue-rotate between factions; flat symbolic cameo icons. | **Four arcs bowing toward centre**; every edge a **1 px specular → body ramp → 1 px black** bevel; highlight **`#BBBCD0` cool violet-grey**; wells flat black, plates gradient; **full material recolour** Allied chrome+blue-lens vs Soviet brass+brushed-silver+red-glyph; **cameos are mini-dioramas with theatre backdrops**. |
| **C25** | **In-world UI** | ×1 | Selection circles, corner brackets, floating nameplates, health bars scaling per unit, coloured "damaged" bar segments. | **No circles, no brackets.** Health bar **45 × 6 px OUR, 1-on/1-off 2 px green hatch, unlit remainder**, 10 px above the sprite; **12 × 14 maroon control-group badge** at its left end; dotted `#C060C0` target line. Any addition (vet chevron, faction ellipse) is subtle and clearly styled to the HUD language. |
| **C26** | **Audio architecture** *(code-read)* | ×2 | Audio files shipped; a fresh node graph per gunshot; no voice cap; EVA spamming; no ducking; identical repeats. | Zero files. **`OfflineAudioContext` bake with the specified variant counts**; runtime playback ≤ 4 nodes; **64/24/34 voice caps with gain-ramped stealing and a −42 dB pre-cull**; crowd summation at ≥6 in 90 ms; EVA priority queue with per-id wall-clock cooldowns (`Unit ready` ≥ 4 s, `Unit lost` ≥ 8 s, base-attack 40 s); **music ducks −11 dB in 60 ms under EVA**; large explosion ducks SFX −9 dB; **122 BPM E-minor lookahead scheduler with bar-boundary layer changes**; master limiter to −1.0 dBFS. |

**Scoring notes for critics.**
- Score each criterion 0–10, multiply by its weight, sum. Weights total 37, so the maximum is **370**.
  Ship gate **≥ 280**, and **no criterion below 4** regardless of total.
- C1, C3, C4, C8, C9, C15, C16, C18, C23, C24, C26 are the **identity criteria**. A score below 5 on any two of
  them is a hard fail regardless of the total.
- Where a metric is scriptable (C1, C3, C4, C5, C8, C9, C12, C15), run the assert rather than eyeballing it.

---

## APPENDIX A — QUICK-REFERENCE PALETTE CARD

```
DESERT        base #856F3D  hi #8D7745  lo #705A2A  darkest #644E20
              rock #5D481D  cactus #514827  bush #282D13
              ore  #B6A572 (hi) / #7F6C3F (bulk)
SNOW          base #CBDEE6  hi #E4F5F6  shade #B0C7DA  deep shade #97A8AD
              wet/shadow #6E818C  earth-through-snow #9F8C6F  ore #E1E1AF
TEMPERATE     grass #414422  dark #2C2F10  darkest #161805  lit #939F2C
              dirt #9C856B  hedge #37322B  canopy #344814  concrete #E3CBA0
WATER arctic  deep #06305F  darkest #06182A  rim #98BFF4 / #C5D7F7
WATER temp    deep #283142  mid #313949  dark #1B1A20
ROAD          asphalt #212522  shoulder #65664F  markings #858A80
              yellow centre #403A1F (peak #625D45)
CONCRETE      #454230 (pads)  #3E3C23 (city)  pad rim #22231D
CLIFF         rock #8B7048  shade #5E5037  grey #6A695B  cap = biome surface
TREAD         #655025 / #715B2A / #776131 @ 0.65 multiply

ALLIED        tile #C8C8C8→#D8D8E0  spec #E0E4F4  chrome #8888B8/#686878
              dark #383848/#282838  accent #4878C8 (shade #183868, hi #8898D8)
              glow #D89020→#F8C858
SOVIET        red #A80808 (hi #E85858, spec #FFC9C6, shade #580808)
              olive #685858/#786858/#484838  steel #889898/#687878
              brick #A08868→#C0A882 (mortar #6A5540)  glow #40E040
              Kirov #B0A050→#D8C868  teeth #F8D820

HUD Allied    chrome #BBBCD0/#6B6977/#07060B  lens #7ED8FC→#2265FB→#050E58
              glyph #0D20A7  selected #BDFFFF  numerals #B0CCEA  radar #C2C9BD
HUD Soviet    brass #F0E39A/#A89344/#422D06  silver #CDCADB→#8A8B92
              glyph #B31B18/#A50804  selected #FCEB1F  numerals #F1DB75  radar #FDFAB9
HUD wells     credits #10111A (Allied) / #181818 (Soviet)  cameo key #080808  radar #000000
POWER BAR     green #B8FBB2/#4CA84C/#276316  yellow #F7EDB0/#4E4626  red #E16251/#3B1012
HEALTH BAR    lit #56AE5E/#5CB263  unlit #0A5A0C  rules #DEFBEF
              badge fill #2B0A08  border #CC716D  digit #E8B0AE

SHADOW        multiply (0.48, 0.50, 0.40) — B ≤ R − 0.04, NEVER blue-shifted
SUN           direction normalize(+0.766, −0.643, 0), elevation 40°, colour #FFF2DC
AMBIENT       #6B5C3F desert / #3E4630 temperate / #7E93A4 snow / #3A3644 urban
```

## APPENDIX B — CANONICAL CONSTANTS (paste into the engine)

```js
export const RA = {
  // camera
  YAW_DEG: 45, PITCH_DEG: 30, ROLL_DEG: 0, ORTHO: true,
  EYE_DIR: [0.61237244, 0.5, 0.61237244],

  // scale
  CELL_PX: 80,                 // canonical @1920x1080
  PX_PER_WORLD_HORIZ: 56.5685, // CELL_PX / Math.SQRT2
  PX_PER_WORLD_HEIGHT: 48.9898,// PX_PER_WORLD_HORIZ * Math.cos(30°)
  ELEVATION_STEP: 0.40824829,  // world units per RA2 elevation level
  CELLS_ACROSS_DEFAULT: 21, ZOOM_MIN: 0.76, ZOOM_MAX: 1.44,

  // lighting
  SUN_DIR: [0.766, -0.643, 0.0], SUN_ELEV_DEG: 40, SUN_COLOR: 0xFFF2DC,
  SHADOW_MULT: [0.48, 0.50, 0.40], SHADOW_PENUMBRA_PX: 3,
  SHADOW_LEN_RATIO: 1.10, FOG: null,

  // terrain
  GRAIN_AMP_LUMA: { desert: 9, snow: 20, grass: 15 },
  GRAIN_ANISO: [2, 1],          // stretched along the (+2,+1) screen axis
  CELL_JITTER_LUMA: 5, VARIANT_CELL_FRACTION: 0.07, VARIANT_CELL_DELTA: [-25, -15],
  TRANSITION_DITHER_CELLS: 2,

  // structures
  STRUCTURE_Y_SCALE: 1.25,

  // hud
  HUD_DESIGN_W: 168, HUD_DESIGN_H: 768,
  CAMEO: { w: 60, h: 48, pitchX: 64, pitchY: 50, cols: 2, rows: 10 },
  uiScale: h => Math.min(4, Math.max(1, Math.floor(h / 720 * 4) / 4)),

  // audio
  BPM: 122, MUSIC_KEY: 'Em', SAMPLE_RATE: 48000,
  VOICE_CAPS: { oneshot: 64, loops: 24, music: 34 },
  MASTER_CEILING_DBFS: -1.0, TARGET_LUFS: -16,
};
```

*End of VISUAL_DNA.md — v1.0, LOCKED.*
