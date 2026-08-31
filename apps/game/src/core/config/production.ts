/**
 * Domain-owned config slice: production queues and structure placement.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 21. PRODUCTION, BUILD QUEUES AND STRUCTURE PLACEMENT
 *
 * The build loop the player lives in. Everything here is a FEEL number: how
 * long a stalled queue waits before it admits it is broke, how heavy a placed
 * structure lands, how far a fresh tank drives before it stops. They are
 * separated from the balance globals in section 16 (cost, buildTime, refund)
 * because those are what a designer tunes and these are what a *director*
 * tunes.
 * ========================================================================== */

export const PRODUCTION = {
  /**
   * Metres between adjacent rally slots, floor and per-hull term.
   *
   * A factory used to hand every unit the IDENTICAL rally point, and
   * `NAV_ARRIVE_SLACK` parks each of them within `radius + 1.1` m of it — so
   * twenty riflemen settled inside a 3.1 m circle with the closest pair 0.2305
   * m apart against a 0.468 m hull sum, i.e. interpenetrating. Each unit now
   * takes a slot on a packed lattice around the flag.
   *
   * Spacing is `max(rallyMinSpacing, 2 * radius + rallyGap)` — derived from the
   * hull that will actually stand there, so a Warden rank does not overlap and
   * an infantry rank does not sprawl. Infantry (radius 0.234) land on the 2.0 m
   * floor; a tank at 1.7 gets 4.8 m.
   */
  rallyMinSpacing: 2.0,
  rallyGap: 1.4,
  /**
   * Seconds a head item may crawl on partial payment before it flips to the
   * flashing ON HOLD state. Without a grace window a harvester unloading in
   * 40-credit dribbles would strobe the cameo once per tick.
   */
  fundsHoldGraceSeconds: 0.6,
  /** Minimum seconds between two "Insufficient funds" EVA lines per player. */
  evaInsufficientFundsSeconds: 6.0,
  /** Sim ticks between `production:progress` emits. 2 = 15 Hz = HUD_TEXT_HZ. */
  progressEventInterval: 2,
  /** Exponential-decay rate of the ticking credits readout. Higher = snappier. */
  creditsDisplayLambda: 9.0,
  /**
   * HP a structure has the instant it is planted, as a fraction of maxHp. It
   * ramps to 1.0 with buildProgress, so a rush that catches a half-built
   * refinery actually gets rewarded for it.
   */
  buildingStartHpFrac: 0.25,
  /** Metres past the footprint edge a produced unit is placed. */
  exitClearanceMetres: 1.2,
  /** Metres past the exit point the default (never-moved) rally flag sits. */
  rallyForwardMetres: 7.0,
  /** Rings of the spiral search for a free egress cell before giving up. */
  egressSearchRings: 5,
  /**
   * Rings around a surviving owned asset where an off-map recovery MCV may
   * arrive. Twelve cells (24 m) clears even the largest structure footprint
   * while keeping the delivery visibly tied to the player's remaining force.
   */
  emergencyMcvSearchRings: 12,
  /** Metres of clearance a fresh unit needs from anything already standing. */
  egressClearanceMetres: 1.15,
  /** Seconds a finished-but-blocked unit waits before it re-tries the exit. */
  egressRetrySeconds: 0.25,

  /* -- THE NAVAL PAIR. These two numbers are ONE RULE and must be read
   * together, because between them they are the difference between a shipyard
   * and a shipyard-shaped ornament.
   *
   * `shoreSearchCells` is what `evaluatePlacement` demands before it will let a
   * Naval Yard be founded: navigable water within that many cells of the
   * footprint. `navalEgressRings` is what `Production.findEgressSpot` is then
   * allowed to spend looking for a launch cell. If the second is ever smaller
   * than the first can require, a LEGAL site produces a permanently stalled
   * queue — paid for, `ready: true`, nothing ever comes out — which is exactly
   * the failure `Locomotor.Air` shipped for two releases.
   *
   * The arithmetic, worst case: water `shoreSearchCells` beyond the BACK edge
   * of the footprint while the door is on the FRONT. That is
   * `shoreSearchCells + maxFootprintCells + ceil(exit reach)` cells of
   * Chebyshev distance from the door — 6 + 6 + 3 = 15. Egress is a ring scan,
   * not a path, so it reads straight through the building's own cells.
   * `tests/naval-shore.spec.ts` asserts the relation rather than trusting this
   * comment.
   * -------------------------------------------------------------------- */

  /**
   * Cells from a shore-bound structure's footprint within which navigable water
   * must be found. 6 cells is 24 m — a dock apron, not a lake view.
   */
  shoreSearchCells: 6,
  /**
   * Distinct water cells that have to be in that halo. A two-cell puddle in a
   * noise basin is not a harbour, and before the seas landed those puddles were
   * the only water on any shipped map.
   */
  shoreWaterCells: 8,
  /**
   * Rings the egress spiral may spend finding open water for a HULL. Larger
   * than `egressSearchRings` by construction — see the block above.
   */
  navalEgressRings: 15,
} as const;

/**
 * Cells in the largest connected body of navigable water before a battlefield
 * counts as one a NAVY can be fielded on. See `src/sim/NavalWater.ts`.
 *
 * NOT "IS THERE ANY WATER". Every biome in this game carves basins, so every
 * map has always had some. Measured on the six shipped battlefields at their
 * pinned seeds, largest single body:
 *
 *     contested-strait  3622      airbase-flats       0
 *     coral-shore       3952      industrial-grid     0
 *                                 temperate-valley    3
 *                                 frozen-sector      11
 *
 * Two clusters four orders of magnitude apart. 300 cells — 4800 m2, a 70 m
 * square — sits between them with a decade of margin either way, and is also
 * the smallest lagoon on which "build a shipyard and sail out of it" is a real
 * transaction rather than a joke.
 */
export const NAVAL_MIN_SEA_CELLS = 300;

export const PLACEMENT = {
  /**
   * Metres from any OTHER completed friendly structure that new construction is
   * allowed. A Construction Yard uses the much larger BUILD_RADIUS instead —
   * that pair is what makes a base creep outward one structure at a time
   * instead of teleporting across the map.
   */
  adjacencyRadius: 20,
  /**
   * Splat layer stamped under a finished structure — `SurfaceId.Concrete` in
   * world/Biomes.ts. Every RA3 reference frame plants its structures on a
   * poured pad with a painted border (refs/ra3steam_07.jpg), and stamping the
   * terrain splat buys that for ZERO extra draw calls and no z-fighting.
   */
  padSurface: 4,
  /** Splat weight of the pad. Below 1 so the biome still reads through it. */
  padWeight: 0.85,
  /** Cells of pad painted beyond the footprint edge. */
  padMarginCells: 1,

  /**
   * Alpha of the translucent ghost volume. Low on purpose: the volume is
   * double-sided, so front and back walls stack to roughly twice this, and the
   * per-cell validity carpet has to read THROUGH it. Measured on a 3x2 War
   * Factory ghost at 62 m — at 0.30 the carpet disappeared entirely.
   */
  ghostOpacity: 0.17,
  /** Alpha of the ghost's edge wire — the part that actually reads at 39°. */
  ghostEdgeOpacity: 0.85,
  /** Metres the per-cell validity quads float above the ground. */
  cellLift: 0.16,
  /** Metres shaved off each side of a validity quad so the grid lines show. */
  cellInset: 0.22,
  /** Alpha of a validity quad. This is the part the player actually reads. */
  cellOpacity: 0.58,
  /** Largest footprint the overlay can draw, in cells per side. */
  maxFootprintCells: 6,

  /**
   * The chevron on the ghost's FRONT edge, which is the only thing that changes
   * on screen when a square footprint is rotated. Sized in cells along the
   * direction it points; clamped to just over half the footprint's depth so a
   * 1x1 wall does not get a marker bigger than the wall.
   */
  facingSize: 0.8,
  /** Metres the facing chevron floats above the ground. Above `cellLift`, so
   *  it reads on top of the validity carpet rather than fighting it. */
  facingLift: 0.22,
  /** Alpha of the facing chevron. Higher than the carpet: it is a pointer, and
   *  a pointer that has to be looked for is not one. */
  facingOpacity: 0.92,

  /**
   * Cell is legal. Kept identical to `HudLook.ok` — move both or neither, or
   * the sidebar's "valid" green stops being the world's "valid" green.
   *
   * #4ADE80 -> #34D399, AND THE CARPET IS NOT WHY. Measured by repainting each
   * part of the ghost separately in a live capture of `09-placement`: of the
   * 190 383 pixels that fail scorecard #9 in that frame, **771 — 0.4% — lie
   * under the carpet**, and removing the carpet outright makes the fixture
   * WORSE (0.0516 -> 0.0601), because a 0.58-alpha sheet at hue ~135 is
   * covering leaking ground.
   *
   * The offender is the HOLOGRAM VOLUME, which takes this same colour from
   * `updateMeshes` (`volumeMat.color.copy(tint)`) and is DoubleSide at
   * `ghostOpacity` 0.17 — so front wall plus back wall lay ~0.31 of it over a
   * large, mostly-lawn area of the frame. At #4ADE80 that composite lands at
   * hue 100.7 over sunlit grass: just inside the window's bottom edge, which is
   * the worst possible place to sit, because ordinary variation in the ground
   * underneath scatters pixels across the boundary. Hiding the volume alone
   * takes the fixture 0.0516 -> 0.0268.
   *
   * So the tint has to leave the neighbourhood of the edge, and there is only
   * one direction available. Yellower is worse, measured: #8FE04C reads 0.0340
   * and #A3E635 0.0279, because rotating down drags the composite over shadowed
   * ground INTO the window from above. Bluer works, and the knee is sharp —
   * predicted from two captures and confirmed against three held out, all
   * within 0.0005: hue 146 -> 0.0392, hue 151 -> 0.0262, hue 155 -> 0.0097.
   * #34D399 is hue 158, the first ordinary GREEN clear of the knee rather than
   * a teal; #2DD4BF at hue 172 measures the same 0.0093 and is not worth the
   * colour.
   */
  validColor: '#34D399',
  /** Cell is illegal. HudLook.danger. */
  invalidColor: '#E03A2A',
  /**
   * Ghost volume tint while the whole footprint is legal.
   *
   * IT REACHES THE SCREEN FOR AT MOST ONE FRAME, and that is why it may sit
   * only 6 degrees of hue from `validColor` without the two being confusable.
   * The volume and the edge wire are CONSTRUCTED with this colour, and then
   * `updateMeshes` overwrites both with `okColor`/`badColor` on every frame the
   * ghost is up — so what a player actually sees on a legal footprint is
   * `validColor`, never this. Left as it is rather than churned: it is the
   * constructor default for two materials, and deleting it would mean giving
   * them an untinted first frame.
   */
  ghostColor: '#7FD8C0',
} as const;

/**
 * Concrete contribution for one cell around a completed building.
 *
 * The occupied footprint stays unmistakably paved.  The old half-strength
 * rectangular margin also painted all four corner blocks, though, so a row of
 * structures merged into one large checkerboard.  A lighter, cornerless apron
 * reads as drainage / hardstand beside the walls while allowing the biome to
 * remain visible between neighbouring buildings.
 */
export function placementPadWeight(
  x: number, z: number, cx: number, cz: number, w: number, h: number,
): number {
  const insideX = x >= cx && x < cx + w;
  const insideZ = z >= cz && z < cz + h;
  if (insideX && insideZ) return PLACEMENT.padWeight;
  if (!insideX && !insideZ) return 0;

  const edgeDistance = insideX
    ? (z < cz ? cz - z : z - (cz + h - 1))
    : (x < cx ? cx - x : x - (cx + w - 1));
  const taper = 1 - (edgeDistance - 1) / Math.max(1, PLACEMENT.padMarginCells);
  return PLACEMENT.padWeight * 0.32 * Math.max(0, taper);
}
