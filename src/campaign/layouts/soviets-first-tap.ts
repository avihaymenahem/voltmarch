/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layouts/soviets-first-tap.ts
 * ============================================================================
 * S1 — THE GROUND. Two bases on an arid seam, an Allied survey tap between
 * them, and a working town nobody is supposed to flatten.
 *
 * THIS IS THE FIRST LAYOUT AND IT IS DELIBERATELY THE PLAINEST ONE. It builds
 * the ordinary two-army opening with `buildBaseFor` — the same call
 * `PLANS.skirmish.build` makes, so an operation starts from a position a player
 * already understands — and then adds exactly three things the trigger table
 * can name: the tap, the derricks, and a relief drop zone.
 *
 * **EVERY TAG THIS STAMPS IS DECLARED ABOVE `build`.** `validateCampaign`
 * refuses an operation whose triggers name a tag no layout produces, because
 * `entityDead` reads TRUE before a tag has ever existed — a mistyped `protect`
 * fails the player on tick one, silently. `tests/campaign-maps.spec.ts` builds
 * this headlessly and checks the declaration against what actually landed, in
 * both directions.
 *
 * **IT READS NO CLOCK, NO PROFILE AND NO DOM.** It runs inside the world build,
 * which is where the tick-zero desync lives: `Scenarios.ts` calls `isBuildable`
 * while spawning a starting army and that answers from the LOCAL profile. The
 * campaign's answer is the operation's authored roster, installed by
 * `campaign-install.ts` BEFORE the boot, so this gets the same world on every
 * machine by construction.
 * ========================================================================== */

import { NONE } from '../../core/types';
import {
  addCivilians, addStartOre, buildBaseFor, islandSeats, rotateStarts, startSpots, wrapDeg,
} from '../../game/Scenarios';
import type { PlayerId } from '../../core/types';
import { layout } from '../layout';

/**
 * Where the tap and the town sit, as a fraction of the distance from the
 * player's start toward the enemy's.
 *
 * DERIVED FROM THE START SPOTS RATHER THAN HARD-CODED, because the spots
 * themselves move with the seed — `seatedSlots` chooses WHICH slots a match
 * uses and `rotateStarts` chooses who sits in them. A literal here would put
 * the objective inside somebody's base on half the rolls.
 */
const TAP_ALONG = 0.66;
const TOWN_ALONG = 0.44;
/** Metres off the start-to-start line, so the town is not on the direct route. */
const TOWN_OFFSET = 62;

export default layout({
  id: 'soviets-first-tap',
  tags: ['tap', 'derrick', 'relief'],

  build(b, cx, cz, start, c) {
    const spots = startSpots(cx, cz, b.armies, b.sea, b.seed);
    const seats = islandSeats(spots, b.sea);
    const owners: PlayerId[] = rotateStarts(spots.map((_, i) => b.armySlot(i)), b.seed);

    // SEAT 0 IS ALWAYS THE PLAYER, and `rotateStarts` is what makes that a
    // statement about the CORNER rather than about the slot — the player's
    // start moves with the seed, which is the whole point of the rotation.
    for (let i = 0; i < seats.length; i++) {
      buildBaseFor(b, owners[i], seats[i].x, seats[i].z, {
        facingDeg: wrapDeg(seats[i].facingDeg + 180),
      });
    }

    const home = seats[0];
    const foe = seats[1] ?? seats[0];
    const dx = foe.x - home.x;
    const dz = foe.z - home.z;
    const len = Math.max(1e-3, Math.sqrt(dx * dx + dz * dz));
    const nx = dx / len;
    const nz = dz / len;
    // The perpendicular, so the town sits off the direct route rather than in
    // the middle of the only approach.
    const px = -nz;
    const pz = nx;

    const at = (along: number, offset: number): { x: number; z: number } => ({
      x: home.x + nx * len * along + px * offset,
      z: home.z + nz * len * along + pz * offset,
    });

    /**
     * Put a structure down on ground it can legally stand on.
     *
     * THE FIRST DRAFT DID NOT DO THIS AND THE BUILD SAID SO. `auditConnectivity`
     * printed "7 structures on ground isBuildable refuses (first: civOreMine at
     * 304,380)" — a line nobody would have read in a match, because a scenario
     * spawn does not go through placement legality and the structure appears
     * anyway. It just appears half-buried in a slope.
     *
     * `findClearFootprint` walks a widening ring for a legal footprint, which
     * is the same primitive the scenario's own base placement uses. The
     * fallback is the nominal point rather than nothing: a tap that fails to
     * appear is an operation nobody can win, and a tap on a slope is only ugly.
     */
    const scratch = new Float32Array(2);
    const place = (key: string, p: { x: number; z: number }): { x: number; z: number } => {
      const f = b.footprintOf(key);
      if (b.findClearFootprint(p.x, p.z, f.w, f.h, scratch)) {
        return { x: scratch[0], z: scratch[1] };
      }
      return p;
    };

    /* -- the tap ---------------------------------------------------------
     * A civilian ore mine, owned by the ENEMY. The Works sank it and the
     * Allies hold it; Rakhalt's orders are to take the seam off them. Using a
     * civilian structure rather than an Allied one matters: the player must be
     * able to tell it apart from the base they are also shooting at, and the
     * silhouette is the only thing carrying that at gameplay zoom.
     */
    const tapAt = place('civOreMine', at(TAP_ALONG, 0));
    const tap = b.spawnBuilding('civOreMine', c.seat(1), tapAt.x, tapAt.z, { yawDeg: 200 });
    c.tag('tap', tap);
    if (tap !== NONE) b.block(tapAt.x, tapAt.z, 22);

    /* -- the town --------------------------------------------------------
     * Three derricks the secondary objective asks you neither to break nor to
     * take. Owned by the enemy for a mechanical reason rather than a fictional
     * one: `ownerCount` names a SEAT, and the Gaia slot sits outside the seat
     * range an operation declares. The fiction survives it — they are the
     * Allied survey camp's derricks, and the town works them either way.
     *
     * **THAT SEAT IS ALSO WHY THEY ARE WORTH TAKING, WHICH IS THE HALF NOBODY
     * WROTE DOWN.** A seat-1 derrick is an ENEMY building: the capture cursor
     * comes up over it, `CaptureService` flips it at or below half health, and
     * `civilian.system.ts` then pays the holder `CIVILIAN_INCOME` — 15 cr/s,
     * 900 a minute, three of them. It is not a prop the trigger table happens
     * to count; it is the most valuable thing on the map that is not a base,
     * and the operation charges the secondary for it on purpose.
     */
    const town = at(TOWN_ALONG, TOWN_OFFSET);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const spot = place('civOilDerrick', {
        x: town.x + Math.cos(a) * 26,
        z: town.z + Math.sin(a) * 26,
      });
      const id = b.spawnBuilding(
        'civOilDerrick', c.seat(1), spot.x, spot.z, { yawDeg: (i * 120) % 360 },
      );
      c.tag('derrick', id);
      // Block AFTER placing, so the next derrick's search cannot land on top of
      // this one — `findClearFootprint` reads the block list.
      if (id !== NONE) b.block(spot.x, spot.z, 18);
    }
    b.block(town.x, town.z, 40);

    /* -- the relief drop zone --------------------------------------------
     * Nothing is placed here. The tag exists so the trigger table has a name
     * for where the wave arrives, and `spawnUnits` stamps `relief` on what it
     * puts down — which is why `validateCampaign` does NOT require this layout
     * to produce it. It is declared above anyway, because a reader looking for
     * "where does relief come from" should find the answer in the file that
     * owns the ground.
     */

    addStartOre(b, spots, b.sea);
    addCivilians(b, spots);
    b.setCameraFocus(home.x, home.z - 8);
    b.scatter({ minX: cx - 130, minZ: cz - 130, maxX: cx + 130, maxZ: cz + 130 }, 150);
    void start;
  },
});
