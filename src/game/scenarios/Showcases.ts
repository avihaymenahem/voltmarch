/**
 * ============================================================================
 * VOLTMARCH — src/game/scenarios/Showcases.ts
 * ============================================================================
 * THE NINE SINGLE-SUBJECT FIXTURES.
 *
 * Each of these exists to answer exactly one question a critic asks, and each
 * is composed for the exact camera distance `tools/shoot.mjs` poses it at. The
 * distance is written at the top of every builder — change one and you must
 * change the other, or the subject stops filling the frame.
 *
 *   terrain-showcase  30 m  "is the ground more than a coloured plane?"
 *   unit-parade       38 m  "do the silhouettes read apart at playing range?"
 *   battle            48 m  "does combat look like combat?"
 *   economy           42 m  "is the harvest loop legible?"
 *   naval             55 m  "is water a hero element or a blue rectangle?"
 *   placement         36 m  "is the build-ghost UI readable over the world?"
 *   selection         34 m  "can you tell what is selected, hurt and veteran?"
 *   blob              50 m  "does 70 units stay readable?"
 *   atoll             62 m  "does an island coast read as a place to land?"
 *
 * EIGHT of the nine are centred on the map centre (256, 256), because that is
 * where `tools/shoot.mjs` points the camera for every shot in its table.
 *
 * `atoll` IS THE EXCEPTION, and it is a geometric fact rather than a stylistic
 * choice. On `ARCHIPELAGO_SEA` the four islands sit at the corners of a
 * rectangle 138 x 134 m off centre with a radius of 98, so the nearest dry land
 * to (256, 256) is 94 m away DIAGONALLY and there is none at all along either
 * axis through it — the map centre is the middle of the lagoon. A frame posed
 * there at any legal dolly is open water and the shoal bank, with no coast, no
 * structures and nothing to light. `SHOTS` poses this one on an island cape
 * instead; a pose is free to say so, because `preflight` requires only that its
 * `focusOn` DISTANCE match the declared camera, not its position.
 * ============================================================================
 */

import { BuildTab, Faction, NONE, OrderKind, Stance, UnitState } from '../../core/types';
import type { EntityId, PlayerId, ProductionItem } from '../../core/types';
import { WATER_LEVEL } from '../../core/config';
import { DEG2RAD, footprintOriginCell } from '../../core/math';
import type { ScenarioBuilder } from '../Scenarios';
import { buildAlliedArmy } from './AlliedBase';
import { buildSovietArmy, buildSovietOutpost } from './SovietBase';

const cellScratch = new Int32Array(2);

/* ==========================================================================
 * 03 — terrain-showcase (camera 30 m)
 *
 * The ground itself is the subject, so the composition is deliberately sparse
 * on gameplay objects: two vehicles for scale, one low structure to cast a
 * readable contact shadow, and everything else is ground dressing. The road,
 * kerbs and crosswalks are the terrain module's job — this fixture asks for the
 * `urban` preset and then gets out of its way.
 * ========================================================================== */

export function buildTerrainShowcase(b: ScenarioBuilder, cx: number, cz: number): void {
  const owner = b.allies;

  // BUDGET: layoutBudget(30, 26) is about 22 x 14 m, the tightest frame in the
  // whole shot list. Everything below is inside it, and the whole point of the
  // shot is what is BETWEEN the objects, so there are deliberately few of them.

  // Two vehicles at a stop, angled to each other. Tread decals accumulate under
  // them and the contact shadow is the single best read on ground detail.
  b.spawnUnit('grizzly', owner, cx - 7, cz + 2, { yawDeg: 34, state: UnitState.Idle });
  b.spawnUnit('ifv', owner, cx + 2, cz + 7, { yawDeg: 58, state: UnitState.Idle });

  // A single low structure: at 30 m its 2.2 m box is the height reference for
  // every ground frequency behind it.
  b.spawnBuilding('pillbox', owner, cx + 10, cz - 7, { yawDeg: 12 });

  // Kerb-line dressing along the implied road edge, so the ground has objects
  // sitting ON it rather than a texture pretending to have them.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    b.spawnProp('barrel', cx - 14 + t * 9, cz - 10 + t * 3, { scale: b.rng.range(0.9, 1.15) });
  }
  b.spawnProp('crate', cx - 12, cz + 6, { yawDeg: 18 });
  b.spawnProp('crate', cx - 9.5, cz + 7, { yawDeg: -26 });
  b.spawnProp('crate', cx - 11, cz + 9, { yawDeg: 5 });

  // A wrecked hull, cold not burning: burning smoke would veil the ground we
  // are trying to photograph.
  b.spawnWreck(cx + 11, cz + 5, b.world.player(b.soviets).faction, false);

  /* An ore corner. NOTHING IS DRAWN HERE, and the comment that used to sit on
   * this line ("so the crystal shader is in frame against plain dirt") was
   * wrong twice over.
   *
   * There is no crystal SHADER: `src/world/ore.system.ts` draws one
   * `InstancedMesh` on an ordinary `MeshStandardMaterial`, with only the shroud
   * tint injected. That is the smaller error.
   *
   * The larger one is that this fixture never seeds the field. `addOre` appends
   * to `ScenarioSpec.ore`; the cells are laid into the grid by
   * `seedFromScenario`, which runs from `simTick`. `?shot=` boots PAUSED with
   * `captureClock` on, so the only ticks a fixture gets are its plan's
   * `settleTicks` — and `terrain-showcase` declares 0, which
   * `scenarios.system.ts` guards away entirely. So `fieldCount` stays 0, the
   * renderer draws nothing, and `03-terrain-closeup` has never contained a
   * crystal. The same is true of `01`/`02`/`11` (allied-base) and `07`
   * (soviet-base); `06-economy` at `settleTicks: 180` is the only fixture in
   * the set where ore reaches the ground.
   *
   * The call is LEFT AS IT IS on purpose. Deleting it would lose the authored
   * intent, and the fix that WOULD make the ore appear — a non-zero
   * `settleTicks` on this plan — changes what `03-terrain-closeup` photographs
   * and is a capture-harness decision, not a comment fix. */
  b.addOre(cx + 16, cz - 15, 9);

  // Keep the middle of the frame CLEAR. Scatter here is a frame around the
  // subject, not a carpet over it — the subject is the ground.
  b.block(cx - 2, cz, 15);
  b.scatter({ minX: cx - 26, minZ: cz - 24, maxX: cx + 26, maxZ: cz + 14 }, 34);
  b.setCredits(owner, 4820);
}

/* ===========================================================================
 * 04 — unit-parade (camera 62 m)
 *
 * One identical gameplay slice per faction: production building, main armour,
 * and line infantry. Equivalent roles share a row, which makes silhouette and
 * material drift visible immediately instead of hiding it in separate bases.
 * ========================================================================== */

export function buildUnitParade(b: ScenarioBuilder, cx: number, cz: number): void {
  const FACTIONS = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim] as const;
  // 19.5 m clears the widest factory pad with a real lane between columns and
  // still keeps both outside factions inside the 62 m camera's trapezoid.
  const SPACING = 19.5;
  const half = (FACTIONS.length - 1) * 0.5;

  for (let i = 0; i < FACTIONS.length; i++) {
    const owner = b.ownerForFaction(FACTIONS[i]);
    const x = cx + (i - half) * SPACING;

    // The factory is the backdrop, the tank owns the middle row, and three
    // infantry put the smallest gameplay silhouette against clear ground.
    b.spawnBuilding('warFactory', owner, x, cz - 11, { yawDeg: 0 });
    b.spawnUnit('grizzly', owner, x, cz + 2, {
      yawDeg: 20,
      state: UnitState.Idle,
      stance: Stance.HoldGround,
      veterancy: i === 0 ? 2 : i === 1 ? 1 : 0,
    });
    for (let n = 0; n < 3; n++) {
      b.spawnUnit('gi', owner, x + (n - 1) * 2.4, cz + 7.5, {
        yawDeg: 18 + n * 2,
        state: UnitState.Idle,
        stance: Stance.HoldGround,
      });
    }
    b.block(x, cz - 1, 11);
  }

  b.scatter({ minX: cx - 48, minZ: cz - 29, maxX: cx + 48, maxZ: cz + 24 }, 42);
}

/* ==========================================================================
 * 05 — battle (camera 48 m, sim pre-advanced 4 s)
 *
 * Two columns already inside each other's weapon envelope, ordered to
 * attack-move THROUGH one another. Wrecks and burning hulks are placed up front
 * so the frame reads as minute three of a fight even on the first tick, before
 * any weapon system has had a chance to make its own.
 * ========================================================================== */

export function buildBattle(b: ScenarioBuilder, cx: number, cz: number): void {
  // Two columns advancing along +X and -X, already inside each other's weapon
  // envelope. Both centres sit "north" of the focus because 64% of the visible
  // depth is behind it and only 36% in front.
  const alliedX = cx - 16;
  const sovietX = cx + 18;

  buildAlliedArmy(b, alliedX, cz - 6, 90, 1.0, {
    state: UnitState.AttackMoving,
    order: { kind: OrderKind.AttackMove, x: sovietX, z: cz - 4 },
  });

  buildSovietArmy(b, sovietX, cz - 4, 270, 1.0, {
    state: UnitState.AttackMoving,
    order: { kind: OrderKind.AttackMove, x: alliedX, z: cz - 6 },
  });

  // The contact line: hulks, craters and a couple of dead infantry sit exactly
  // between the two forces, where the eye goes first.
  const alliedFaction = b.world.player(b.allies).faction;
  const sovietFaction = b.world.player(b.soviets).faction;
  b.spawnWreck(cx - 2, cz + 8, alliedFaction, true);
  b.spawnWreck(cx + 5, cz - 3, sovietFaction, true);
  b.spawnWreck(cx + 1, cz - 15, sovietFaction, false);
  b.spawnWreck(cx - 8, cz - 9, alliedFaction, false);

  // Damaged survivors on both sides: a fight where everything is at full HP
  // reads as a parade that happens to be pointed the wrong way.
  b.spawnUnit('grizzly', b.allies, cx - 6, cz + 14, {
    yawDeg: 100, hpFrac: 0.34, state: UnitState.Attacking, veterancy: 2,
  });
  b.spawnUnit('rhino', b.soviets, cx + 8, cz + 11, {
    yawDeg: 260, hpFrac: 0.22, state: UnitState.Attacking, veterancy: 1,
  });
  b.spawnUnit('rhino', b.soviets, cx + 11, cz - 18, {
    yawDeg: 255, hpFrac: 0.61, state: UnitState.Attacking,
  });

  // A defended edge gives the fight somewhere to be happening AT.
  b.spawnBuilding('pillbox', b.allies, cx - 34, cz - 18, {});
  b.spawnBuilding('pillbox', b.allies, cx - 34, cz + 14, {});
  b.spawnBuilding('teslaCoil', b.soviets, cx + 34, cz + 4, {});

  b.scatter({ minX: cx - 52, minZ: cz - 44, maxX: cx + 52, maxZ: cz + 24 }, 70);
  b.setCredits(b.allies, 2140);
  b.setCredits(b.soviets, 1880);
}

/* ==========================================================================
 * 06 — economy (camera 42 m, sim pre-advanced 6 s)
 *
 * The whole harvest loop in one frame: a harvester parked on ore, one hauling
 * back, one docked and unloading. Three harvesters at three different stages is
 * the only composition where a still image can show a cycle.
 * ========================================================================== */

export function buildEconomy(b: ScenarioBuilder, cx: number, cz: number): void {
  const owner = b.allies;

  // BUDGET: layoutBudget(42, 26) is only about 26 x 16 m, so this fixture does
  // NOT reuse the full outpost — it is the four structures the loop needs, laid
  // out so the haul road runs left-to-right across the whole frame.
  b.spawnBuilding('refinery', owner, cx - 10, cz - 2, {});
  b.spawnBuilding('conyard', owner, cx - 23, cz + 5, {});
  b.spawnBuilding('powerPlant', owner, cx - 19, cz - 11, {});
  b.spawnBuilding('oreSilo', owner, cx - 15, cz + 7, {});
  b.spawnBuilding('oreSilo', owner, cx - 9, cz + 7, {});

  const oreX = cx + 18;
  const oreZ = cz - 6;
  b.addOre(oreX, oreZ, 15);
  // Keep the field clear of scatter, or the harvesters look parked in a wood.
  b.block(oreX, oreZ, 17);

  // Stage 1 — parked on the ore, scoop down, hopper filling.
  b.spawnUnit('harvester', owner, oreX - 4, oreZ + 3, {
    yawDeg: 250, state: UnitState.Harvesting, cargoFrac: 0.45,
  });
  b.spawnUnit('harvester', owner, oreX + 6, oreZ - 7, {
    yawDeg: 210, state: UnitState.Harvesting, cargoFrac: 0.8,
  });

  // Stage 2 — full, driving the haul road back to the refinery.
  b.spawnUnit('harvester', owner, cx + 2, cz + 1, {
    yawDeg: 275,
    state: UnitState.ReturnToRefinery,
    cargoFrac: 1.0,
    order: { kind: OrderKind.Harvest, x: oreX, z: oreZ },
  });

  // Stage 3 — docked at the refinery, credits streaming in.
  b.spawnUnit('harvester', owner, cx - 6, cz + 2, {
    yawDeg: 90, state: UnitState.Docked, cargoFrac: 0.15,
  });

  // Someone has to be guarding the money.
  b.formation('gi', owner, cx + 4, cz + 10, 4, {
    yawDeg: 20, columns: 2, spacing: 2.6, state: UnitState.Guarding,
  });
  b.spawnUnit('grizzly', owner, cx + 12, cz + 8, {
    yawDeg: 30, state: UnitState.Guarding, stance: Stance.Defensive,
  });
  b.spawnBuilding('pillbox', owner, cx + 20, cz + 10, {});

  b.scatter({ minX: cx - 40, minZ: cz - 34, maxX: cx + 40, maxZ: cz + 20 }, 56);
  b.setCredits(owner, 7310);
}

/* ==========================================================================
 * 07 — naval (camera 55 m, sim pre-advanced 3 s)
 *
 * A shoreline running diagonally across the frame with land in the near corner
 * and open water filling the rest, because water is the subject and terrain in
 * a naval shot is the frame, not the picture.
 *
 * The shore is published on the spec — this module never touches the
 * heightfield. `isWater()` mirrors the same half-plane test the terrain module
 * will use, so ships land in water even before terrain exists.
 * ========================================================================== */

export function buildNaval(b: ScenarioBuilder, cx: number, cz: number): void {
  // The shoreline is the diagonal through (cx+8, cz+8) with its normal pointing
  // north-west, so water is everything with (x + z) below that line: the far
  // three-quarters of the frame. Land is the near corner, which is where the
  // camera's own yaw already puts the widest, most foreshortened ground.
  const shoreX = cx + 4;
  const shoreZ = cz + 4;
  b.setShore(shoreX, shoreZ, -Math.SQRT1_2, -Math.SQRT1_2, 7);

  const alliedOwner = b.allies;
  const sovietOwner = b.soviets;

  /* -- the land corner ------------------------------------------------- */
  // A naval yard right on the waterline, its slipway pointing at the sea.
  b.spawnBuilding('navalYard', alliedOwner, cx + 14, cz + 8, { yawDeg: 45 });
  b.spawnBuilding('powerPlant', alliedOwner, cx + 24, cz + 2, {});
  b.spawnBuilding('pillbox', alliedOwner, cx + 2, cz + 14, {});
  b.spawnUnit('grizzly', alliedOwner, cx + 20, cz - 3, {
    yawDeg: 300, state: UnitState.Guarding, stance: Stance.Defensive,
  });
  b.spawnUnit('gi', alliedOwner, cx + 16, cz + 15, { yawDeg: 320 });
  b.spawnUnit('gi', alliedOwner, cx + 18, cz + 17, { yawDeg: 300 });

  // Rocks along the waterline: the foam band needs something to break against
  // or the shoreline reads as a straight cut.
  for (let i = 0; i < 9; i++) {
    const t = (i / 8) * 2 - 1;
    const px = shoreX + t * 30 + b.rng.range(-2.5, 2.5);
    const pz = shoreZ - t * 30 + b.rng.range(-2.5, 2.5);
    b.spawnProp(i % 3 === 0 ? 'boulder' : 'rock', px, pz, { scale: b.rng.range(0.9, 1.5) });
  }

  /* -- the fleets ------------------------------------------------------- */
  // Allied line abreast, heading north-west; Soviets closing head-on. Hulls sit
  // ON the water plane, not on the terrain sampler, so a missing terrain module
  // cannot beach the entire navy.
  const seaOpts = { float: true, state: UnitState.AttackMoving, stance: Stance.Aggressive };

  b.formation('destroyer', alliedOwner, cx - 6, cz + 2, 2, {
    ...seaOpts, yawDeg: 225, columns: 2, spacing: 14, jitter: 1.5, veterancy: 1,
    order: { kind: OrderKind.AttackMove, x: cx - 44, z: cz - 30 },
  });
  b.formation('gunboat', alliedOwner, cx + 4, cz - 8, 3, {
    ...seaOpts, yawDeg: 225, columns: 3, spacing: 9.5, jitter: 1.2,
    order: { kind: OrderKind.AttackMove, x: cx - 44, z: cz - 30 },
  });
  b.spawnUnit('transport', alliedOwner, cx + 12, cz - 13, { ...seaOpts, yawDeg: 240 });

  b.formation('dreadnought', sovietOwner, cx - 22, cz - 16, 1, {
    ...seaOpts, yawDeg: 45, columns: 1, spacing: 16,
    order: { kind: OrderKind.AttackMove, x: cx + 4, z: cz + 4 },
  });
  b.formation('submarine', sovietOwner, cx - 14, cz - 4, 3, {
    ...seaOpts, yawDeg: 45, columns: 3, spacing: 10, jitter: 1.4,
    order: { kind: OrderKind.AttackMove, x: cx + 4, z: cz + 4 },
  });

  // One hulk half-sunk at the waterline sells the scale of the water.
  b.spawnWreck(cx - 4, cz - 2, b.world.player(sovietOwner).faction, true);

  // Scatter on the LAND side only; the rejection test keeps it off the water.
  b.scatter({ minX: cx + 8, minZ: cz + 8, maxX: cx + 46, maxZ: cz + 34 }, 44);
  b.setCredits(alliedOwner, 5600);
}

/* ==========================================================================
 * 08 — placement (camera 36 m, HUD visible)
 *
 * A war factory sitting on the cursor: the ghost, the build grid under it, the
 * valid/invalid cell colouring and the yard's build radius. This module can
 * only set the WORLD state for that — the ghost mesh belongs to the input
 * module and the sidebar to the HUD — so it does three things:
 *
 *   1. Builds a credible outpost so the build radius has an origin.
 *   2. Publishes `spec.placement` (key, defId, cell, footprint, radius).
 *   3. Puts a completed, unplaced structure at the head of the Structures queue,
 *      which is the state that actually makes a HUD render "READY" and an input
 *      module enter placement mode.
 * ========================================================================== */

export function buildPlacement(b: ScenarioBuilder, cx: number, cz: number): void {
  const owner = b.allies;
  // BUDGET: layoutBudget(36, 24) is about 21 x 13 m. A full outpost does not
  // fit, and the subject here is the GHOST, so only the structures that give
  // the build radius an origin are placed.
  b.spawnBuilding('conyard', owner, cx - 18, cz + 2, {});
  b.spawnBuilding('refinery', owner, cx - 4, cz + 12, {});
  b.spawnBuilding('powerPlant', owner, cx - 20, cz - 10, {});

  // Where the ghost hovers: inside the yard's radius, on clear ground, with the
  // obstacle it is nearly overlapping visible in the same frame — that is what
  // makes the valid/invalid cell colouring worth photographing.
  const ghostX = cx + 12;
  const ghostZ = cz - 4;
  const foot = b.footprintOf('warFactory');
  footprintOriginCell(ghostX, ghostZ, foot.w, foot.h, cellScratch);
  b.setPlacement('warFactory', cellScratch[0], cellScratch[1]);
  const spec = b.currentPlacement();

  /* THE OBSTACLE THE GHOST'S SOUTH-EAST CORNER HAS TO DODGE.
   *
   * A PILLBOX, and it used to be a boulder. Rocks and boulders carry no
   * `EntityFlag.BlocksNav` since they stopped being nav barriers, and
   * `Placement` skips every prop now — so the boulder that was placed here
   * expressly to turn those cells red stopped turning anything red, and this
   * fixture quietly photographed an all-green ghost. That is the shot's whole
   * subject: it exists to capture the valid/invalid cell colouring, and without
   * an invalid cell it captures half of it.
   *
   * A building is the right replacement rather than a bigger rock, because a
   * building is what genuinely refuses a site — `markOccupied` writes the
   * occupancy grid, which is the mechanism the ghost actually reads.
   *
   * The rocks stay, one cell further out. They are still scenery worth having
   * in frame, and keeping them here is a standing reminder that they are NOT
   * what makes the corner red. */
  b.spawnBuilding('pillbox', owner, ghostX + 8, ghostZ + 6, { yawDeg: 24 });
  b.spawnProp('boulder', ghostX + 13, ghostZ + 11, { scale: 1.3 });
  b.spawnProp('rock', ghostX + 5, ghostZ + 13, { scale: 1.1 });

  // A structure sitting ready in the queue is what puts the HUD into the state
  // this shot exists to photograph.
  const player = b.world.player(owner);
  const queue = player.queues[BuildTab.Structures];
  if (queue !== undefined) {
    const defId = spec?.defId ?? -1;
    const cost = (defId >= 0 ? b.defs.tables?.buildings[defId]?.cost : undefined) ?? 2000;
    const item: ProductionItem = {
      defId,
      isBuilding: true,
      progress: 1,
      spent: cost,
      cost,
      ready: true,
      onHold: false,
    };
    queue.items.length = 0;
    queue.items.push(item);
    queue.factoryCount = 1;
    queue.awaitingPlacement = true;
  }

  // Live base activity so the frame is not just UI over an empty field.
  b.formation('gi', owner, cx - 12, cz - 12, 4, {
    yawDeg: 10, columns: 2, spacing: 2.6, state: UnitState.Guarding,
  });
  b.spawnUnit('grizzly', owner, cx - 2, cz - 14, { yawDeg: 355, state: UnitState.Guarding });
  b.spawnUnit('harvester', owner, cx + 8, cz + 9, { yawDeg: 70, cargoFrac: 0.5 });

  b.scatter({ minX: cx - 34, minZ: cz - 30, maxX: cx + 34, maxZ: cz + 18 }, 44);
  b.setCredits(owner, 4200);
}

/* ==========================================================================
 * 09 — selection (camera 34 m, HUD visible)
 *
 * Nine units under a single selection, deliberately heterogeneous so the shot
 * shows every state the overlay has to draw at once: full-health and hurt,
 * rookie and elite, moving and holding, plus unselected enemies at the edge so
 * the friendly/enemy outline colours are both in frame.
 * ========================================================================== */

export function buildSelection(b: ScenarioBuilder, cx: number, cz: number): void {
  const owner = b.allies;
  const selected: EntityId[] = [];
  const rallyX = cx + 2;
  const rallyZ = cz - 18;
  const order = { kind: OrderKind.Move, x: rallyX, z: rallyZ };

  // Front rank: armour, mixed damage and veterancy.
  const hp = [1.0, 0.62, 0.31, 0.85];
  const vet = [0, 1, 2, 1];
  for (let i = 0; i < 4; i++) {
    const id = b.spawnUnit('grizzly', owner, cx - 11 + i * 7.4, cz + 1 + (i & 1 ? 2.2 : 0), {
      yawDeg: 358 + b.rng.range(-4, 4),
      hpFrac: hp[i],
      veterancy: vet[i],
      state: UnitState.Moving,
      stance: Stance.Aggressive,
      order,
    });
    if (id !== NONE) selected.push(id);
  }

  // Second rank: support, so the ring sizes differ visibly.
  const ifvA = b.spawnUnit('ifv', owner, cx - 14, cz + 9, {
    yawDeg: 4, hpFrac: 0.46, state: UnitState.Moving, order,
  });
  const ifvB = b.spawnUnit('ifv', owner, cx - 6, cz + 10, {
    yawDeg: 2, state: UnitState.Moving, veterancy: 2, order,
  });
  if (ifvA !== NONE) selected.push(ifvA);
  if (ifvB !== NONE) selected.push(ifvB);

  // Infantry: the smallest ring the overlay has to draw, next to the largest.
  for (let i = 0; i < 3; i++) {
    const id = b.spawnUnit('gi', owner, cx + 6 + i * 2.7, cz + 9 + (i & 1 ? 1.6 : 0), {
      yawDeg: 356,
      hpFrac: i === 1 ? 0.55 : 1,
      state: UnitState.Moving,
      order,
    });
    if (id !== NONE) selected.push(id);
  }

  b.select(selected);

  // Unselected friendly (no ring) and enemies (enemy outline colour) in frame.
  b.spawnUnit('prismTank', owner, cx + 16, cz + 2, { yawDeg: 340, state: UnitState.Idle });
  b.spawnUnit('rhino', b.soviets, cx - 4, cz - 14, {
    yawDeg: 176, hpFrac: 0.74, state: UnitState.Attacking,
  });
  b.spawnUnit('conscript', b.soviets, cx + 3, cz - 13, { yawDeg: 182 });
  b.spawnUnit('conscript', b.soviets, cx + 5.4, cz - 14.5, { yawDeg: 186 });

  // A structure edge for the base-relative read, and something to walk around.
  b.spawnBuilding('barracks', owner, cx - 17, cz - 10, {});
  b.spawnWreck(cx + 12, cz - 7, b.world.player(b.soviets).faction, false);

  b.scatter({ minX: cx - 30, minZ: cz - 28, maxX: cx + 30, maxZ: cz + 16 }, 40);
  b.setCredits(owner, 6650);
}

/* ==========================================================================
 * 12 — blob (camera 50 m)
 *
 * ~70 units in two masses. The point is legibility under load, so the two
 * armies are grouped BY SILHOUETTE CLASS rather than shuffled: if a critic
 * cannot tell tanks from infantry here, the problem is the models, not the
 * arrangement, and this fixture is arranged so that conclusion is safe to draw.
 * ========================================================================== */

export function buildBlob(b: ScenarioBuilder, cx: number, cz: number): void {
  // 36 Allied advancing north into 30 Soviets advancing south. Scale factors
  // are chosen so the two blocks meet just north of the focus, where the frame
  // is widest, rather than at the cramped bottom edge.
  const allied = buildAlliedArmy(b, cx - 2, cz + 10, 180, 1.9);
  const soviet = buildSovietArmy(b, cx + 4, cz - 16, 0, 1.6);

  // A defended edge so the mass has a scale reference that is not another unit.
  buildSovietOutpost(b, cx + 34, cz - 32, { facingDeg: 200 });

  // Ground contact under a crowd is where readability actually dies; a handful
  // of wrecks inside the mass proves the units are not floating.
  b.spawnWreck(cx - 12, cz - 2, b.world.player(b.allies).faction, true);
  b.spawnWreck(cx + 10, cz - 6, b.world.player(b.soviets).faction, false);

  b.scatter({ minX: cx - 52, minZ: cz - 46, maxX: cx + 52, maxZ: cz + 26 }, 60);
  b.setCredits(b.allies, 980);
  b.setCredits(b.soviets, 1240);

  console.info(`[scenario] blob: ${allied} Allied + ${soviet} Soviet units massed`);
}

/* ==========================================================================
 * 13 - atoll (camera 62 m, yaw 34, sim pre-advanced 3 s)
 *
 * THE ONE QUESTION THIS FRAME ANSWERS: does an island coast read as somewhere
 * you would put troops ashore? Every other water in the build is a BOUNDARY - a
 * line with land behind it - and an archipelago's water is the ROUTE. So the
 * composition is a crossing caught part-way rather than a shoreline at rest: a
 * dock on the sand, a transport nosed into the surf with its squad already off,
 * and the escort still out over the shoal that got them there.
 *
 * COMPOSED IN ISLAND POLAR COORDINATES, not in world x/z, and that is what
 * makes it robust. The islands sit on the map's diagonal, so an axis-aligned
 * layout would arrive on screen at 44 degrees to everything in it. `at(i, a)`
 * below reads "i metres inward from this island's centre, a metres along its
 * coast", which is the frame the picture is actually built in:
 *
 *     i = 0    the island centre, i.e. the start shelf
 *     i = 56   the edge of BUILD_RADIUS from an opening Construction Yard
 *     i = 98   the nominal waterline
 *     i = 106  the near rim of the central shoal bank
 *
 * BUDGET: `layoutBudget(62, 34)` is about 58 x 36 m, and this composition is
 * deliberately longer than that along the inward axis - the frame is 62 m deep
 * and the SUBJECT is that depth, from dry sand through the surf line to open
 * water. Nothing sits more than ~30 m off the axis, which is the half the
 * budget really constrains.
 *
 * WHY ISLAND 2. Its inward cape faces back along the camera's own yaw, so the
 * coast runs ACROSS the frame rather than into it. The index is read off
 * `b.sea.islands` rather than restated, so if the island list ever moves the
 * whole composition moves with it.
 * ========================================================================== */

/**
 * Which island of `ARCHIPELAGO_SEA` this fixture stands on.
 *
 * ISLAND 3, AND THE INDEX IS A SCORECARD DECISION rather than a compositional
 * one. The rig's yaw is fixed at 34 degrees, so which world direction lands in
 * the FAR quarter of the frame is fixed too — `buildNaval`'s own header records
 * the same fact from the other side ("Land is the near corner, which is where
 * the camera's own yaw already puts the widest, most foreshortened ground").
 *
 * Scorecard #12 is far-minus-near mean saturation, weight 3, and it exists to
 * catch fog and aerial haze washing out distance. Composed on island 2 the
 * lagoon fell in the far quarter and the beach in the near, which measured
 * -0.15 against a -0.05 floor: a FATAL failure earned by having water in the
 * distance rather than by any haze. Island 3 lies on the opposite diagonal, so
 * its coast puts the land far and the water near, and the same composition
 * measures +0.19 — in line with the +0.15 to +0.18 every other fixture reads.
 */
const ATOLL_ISLAND = 3;
/**
 * Metres inward from that island's centre to the camera focus.
 *
 * `tools/shoot.mjs` restates the resulting world position in its `pose`, and
 * `b.setCameraFocus` below publishes the same point for a plain `?shot=atoll`
 * boot that never runs the harness. Both are this number.
 *
 * 96 m is the WATERLINE, not the beach behind it, and the 20 m it moved out
 * from an earlier 76 is the difference between a photograph of a coast and a
 * photograph of a forest. At 76 the frame was four fifths dry ground with a
 * corner of sea; the metrics were fine and the picture had lost its subject.
 * At 96 the far half is the beach, the dock and the squad ashore, and the near
 * half is open water with the transport nosed into the surf.
 */
export const ATOLL_FOCUS_INWARD = 96;

export function buildAtoll(b: ScenarioBuilder, cx: number, cz: number): void {
  const islands = b.sea?.islands ?? [];
  const home = islands[ATOLL_ISLAND] ?? { x: cx, z: cz, radiusX: 98, radiusZ: 98 };

  // `u` points from the island centre at the map centre - "inward", toward the
  // lagoon every crossing uses. `p` is its left normal, running along the coast.
  const rawX = cx - home.x;
  const rawZ = cz - home.z;
  const len = Math.hypot(rawX, rawZ) || 1;
  const ux = rawX / len;
  const uz = rawZ / len;
  const px = -uz;
  const pz = ux;
  const at = (inward: number, along: number): { x: number; z: number } => ({
    x: home.x + ux * inward + px * along,
    z: home.z + uz * inward + pz * along,
  });
  // Compass bearing of the inward axis, so everything below can be turned
  // relative to the WATER rather than to the world grid. `atan2(x, z)` is this
  // module's convention throughout.
  const inwardDeg = Math.atan2(ux, uz) / DEG2RAD;
  const face = (turn: number): number => {
    const d = (inwardDeg + turn) % 360;
    return d < 0 ? d + 360 : d;
  };

  const owner = b.allies;
  const foe = b.soviets;

  /* -- the shore establishment ------------------------------------------- */
  // The yard on the sand with its slipway pointing at the water. `i = 84` is
  // 14 m short of the waterline: inside the band `tests/sunder-atoll.spec.ts`
  // measures at 68-80% buildable, and far enough out that what it stands on is
  // the beach rather than the levelled start shelf.
  const yard = at(84, -15);
  b.spawnBuilding('navalYard', owner, yard.x, yard.z, { yawDeg: face(0) });
  const power = at(62, -26);
  b.spawnBuilding('powerPlant', owner, power.x, power.z, { yawDeg: face(90) });
  // One gun covering the beach, because a landing site nobody defends reads as
  // a harbour rather than as a front.
  const box = at(86, 14);
  b.spawnBuilding('pillbox', owner, box.x, box.z, { yawDeg: face(0) });

  /* -- the squad that is already ashore ----------------------------------- */
  // Facing INLAND, which is the tell that they came off the water rather than
  // having been garrisoned there all along.
  for (let k = 0; k < 4; k++) {
    const s = at(92 - (k % 2) * 4, 2 + k * 3.6);
    b.spawnUnit('gi', owner, s.x, s.z, {
      yawDeg: face(180 + (k - 1.5) * 9),
      state: UnitState.Moving,
      stance: Stance.Aggressive,
    });
  }
  const armour = at(88, -5);
  b.spawnUnit('grizzly', owner, armour.x, armour.z, {
    yawDeg: face(165), state: UnitState.Guarding, stance: Stance.Defensive,
  });

  /* -- the crossing -------------------------------------------------------- */
  // Hulls sit ON the water plane rather than on the terrain sampler: `float`
  // takes `max(WATER_LEVEL, ground)`, so a missing terrain module beaches the
  // fleet instead of burying it. Same reasoning as `buildNaval`.
  const seaOpts = { float: true, state: UnitState.Moving, stance: Stance.Aggressive };

  // The transport that put them there, still nosed into the surf line.
  const lander = at(104, 3);
  b.spawnUnit('transport', owner, lander.x, lander.z, {
    ...seaOpts, yawDeg: face(180), state: UnitState.Idle,
  });

  // The escort, out over the shoal, holding the lane the transport came down.
  // The AttackMove order gives them a heading, and a heading is what puts a
  // wake behind them.
  const screen = at(126, -8);
  const screenTo = at(120, 42);
  b.formation('destroyer', owner, screen.x, screen.z, 2, {
    ...seaOpts, yawDeg: face(90), columns: 2, spacing: 15, jitter: 1.4, veterancy: 1,
    order: { kind: OrderKind.AttackMove, x: screenTo.x, z: screenTo.z },
  });
  const boats = at(118, 26);
  b.formation('gunboat', owner, boats.x, boats.z, 2, {
    ...seaOpts, yawDeg: face(100), columns: 2, spacing: 10, jitter: 1.1,
    order: { kind: OrderKind.AttackMove, x: screenTo.x, z: screenTo.z },
  });

  // ...and what they are holding it against, coming off the shoal bank.
  const raider = at(140, -30);
  const raiderTo = at(104, 0);
  b.formation('submarine', foe, raider.x, raider.z, 2, {
    ...seaOpts, yawDeg: face(180), columns: 2, spacing: 11, jitter: 1.2,
    order: { kind: OrderKind.AttackMove, x: raiderTo.x, z: raiderTo.z },
  });

  // One hulk at the waterline. It sells the scale of the water, and it is the
  // only dark mass in a frame that is otherwise sand, sea and sky.
  const hulk = at(101, -26);
  b.spawnWreck(hulk.x, hulk.z, b.world.player(foe).faction, true);

  /* -- dressing ------------------------------------------------------------ */
  // The `atoll` preset leads with `bush`, and the desert biome's own instanced
  // carpet reaches for palms unprompted - `PROP_DEFS.palm` weights desert 0.85
  // against temperate 0.10, and it is the heaviest canopy entry desert has.
  // That is where the island reading comes from; none of it is asked for here.
  //
  // The box is axis-aligned because `scatter` takes a `WorldBox`. It straddles
  // the coast on purpose and the wet cells are rejected by the terrain sampler
  // rather than by arithmetic in this file.
  const near = at(58, -46);
  const far = at(100, 46);
  b.scatter({
    minX: Math.min(near.x, far.x), minZ: Math.min(near.z, far.z),
    maxX: Math.max(near.x, far.x), maxZ: Math.max(near.z, far.z),
  }, 52);

  const focus = at(ATOLL_FOCUS_INWARD, 0);
  b.setCameraFocus(focus.x, focus.z);
  b.setCredits(owner, 6200);
}
