/**
 * ============================================================================
 * tests/campaign-capture-proof.spec.ts — AN OPERATION CAN REFUSE A CAPTURE
 * ============================================================================
 * `CaptureService.resolve` consumes the engineer on EVERY non-refused outcome —
 * capture, soften and friendly repair alike — and `refuse()` is the only branch
 * that hands it back. The three `canCapture` defs carry no `unlockedBy`, so
 * `OperationRoster` cannot withhold them, and their prereqs stand at t = 0 in
 * every `opening: 'base'` operation. So a capture costs four engineers for any
 * structure in the game: the soften lands
 * `maxHp * CAPTURE.softenFrac` (0.25) through `ARMOR_MATRIX[HighExplosive][Concrete]`
 * (1.00) and `COMBAT_DAMAGE.globalMul` (0.80) = 0.20 of max against a
 * `CAPTURE.captureHpFrac` gate of 0.50, and both are fractions of max so `maxHp`
 * cancels.
 *
 * That is a fair price for a structure an operation WANTS taken, and it is a
 * trap for one it told the player to protect. Four shipped cases:
 *
 *   pact.02.long-count      `count`      a seat-1 reading post the operation
 *                                        LOSES on (`t.countLost`, `entityDead`)
 *   pact.04.in-the-clear    `mast`       identical shape
 *   soviets.06.demolition-order `infirmary`  a Gaia hospital 40 m from the device
 *   allies.01.sounding-line  everything   the three surveyors ARE the objective
 *                                        and every capture spends one
 *
 * In the first three, capture does not fire the losing trigger by itself — it
 * strips the target's only protection, because `Targeting.isValidTarget` refuses
 * ALLIES and nothing else, and the trigger does not care who fired.
 *
 * ── WHAT THIS FILE DRIVES, AND WHAT IT REFUSES TO SUBSTITUTE ────────────────
 * The REAL `CaptureService`, the REAL operations off `CAMPAIGNS`, the REAL
 * `campaign-install.ts#Session` (through `armOperation`), and the REAL
 * install/clear path in `src/game/campaign.system.ts` — its `init()` and
 * `dispose()` are called directly, because a spec that installed its own veto
 * would prove the hook works and say nothing about whether the product installs
 * it.
 *
 * **EVERY CASE TAKES ITS FALSIFIER FIRST.** The same click, on the same
 * structure, with the operation NOT armed — so a refusal cannot be the branch
 * never firing, an engineer that never arrived, or a def table that answered
 * "this is not an engineer". `§0` is that control on its own, and every later
 * case re-takes it inline.
 *
 * Tags reach the session through `CampaignTagSet.restore`, which is the public
 * save-side half of the registry rather than a cast into `TagRegistry`. That is
 * deliberately the same door a LOADED SAVE comes through, so these cases are
 * also the evidence that a restore keeps the protection.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { Rng } from '../src/core/math';
import { CELL } from '../src/core/config';
import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';

import { BUILDINGS, DEF_TABLES } from '../src/data/Defs';
import { FALLBACK_BUILDINGS } from '../src/game/Scenarios';
import { ProductionCatalog, ProductionService, setProduction } from '../src/sim/Production';
import { CAPTURE, CaptureService, setCaptureService } from '../src/sim/Capture';
import campaignSystem from '../src/game/campaign.system';
import { armOperation, disarmOperation } from '../src/campaign/campaign-install';
// THE LIGHT SEAM, ON PURPOSE. This is the module `campaign.system.ts` reads, so
// a session this file cannot see is a session the veto cannot see either.
import { adoptPreparedOperation, campaignSession } from '../src/campaign/session';
import type { CampaignSession } from '../src/campaign/session';
import { CAMPAIGNS, campaignFacts } from '../src/campaign/index';
import { validateCampaign } from '../src/campaign/validate';
import type { ChapterDef, OperationDef } from '../src/campaign/types';

/* ==========================================================================
 * 0. THE RIG
 *
 * `tests/civilians.spec.ts`'s, because the question is a decision about one
 * structure and not about locomotion: a flat world, real def numbers, no
 * terrain, no nav. The one thing it MUST have is a `ProductionService` with
 * `bindingTables` set — `CaptureService.isEngineerSlot` asks the def table
 * first, so a rig without it answers "nothing is an engineer" and every case
 * here would pass by refusing for the wrong reason.
 * ========================================================================== */

/** Seat 0. The commander, and the one that walks the engineer in. */
const PLAYER = 0 as PlayerId;
/** Seat 1. Owns the protect-targets in `pact.02` and `pact.04`. */
const FOE = 1 as PlayerId;
/** Seat 2. Gaia — allied to everybody, which is what `soviets.06` protects. */
const GAIA = 2 as PlayerId;

interface Rig {
  world: World;
  capture: CaptureService;
  building(key: string, owner: PlayerId, x: number, z: number): EntityId;
  engineer(x: number, z: number): EntityId;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  world.addPlayer(Faction.Neutral, 'Gaia', false, false);
  // Gaia's two-way alliance, exactly as `ScenarioBuilder.gaia` wires it. Without
  // it a Gaia structure is an ENEMY structure and the `soviets.06` case would be
  // measuring the soften branch instead of the neutral one.
  for (let i = 0; i < world.players.length; i++) {
    world.players[GAIA as number].allyMask |= 1 << i;
    world.players[i].allyMask |= 1 << (GAIA as number);
  }

  const channels = new Channels();
  const production = new ProductionService(
    world, channels, new ProductionCatalog({ tables: null, unitId: {}, buildingId: {} }),
  );
  production.bindingTables = DEF_TABLES;
  setProduction(production);

  const capture = new CaptureService(world, channels);
  setCaptureService(capture);

  return {
    world,
    capture,
    building(key, owner, x, z): EntityId {
      const s = world.store;
      const defId = DEF_TABLES.buildingByKey.get(key)!;
      const def = BUILDINGS[defId];
      const fb = FALLBACK_BUILDINGS[key];
      const id = s.alloc(
        EntityKind.Building, defId, owner, world.player(owner).faction, x, 0, z,
      );
      const i = s.index(id);
      s.footprintW[i] = def.footprintW;
      s.footprintH[i] = def.footprintH;
      s.maxHp[i] = def.maxHp;
      s.hp[i] = def.maxHp;
      s.radius[i] = Math.max(def.footprintW, def.footprintH) * CELL * 0.5;
      s.locomotor[i] = Locomotor.Static;
      s.buildProgress[i] = 1;
      s.flags[i] |= fb.flags | def.flags;
      world.spatial.rebuild();
      return id;
    },
    engineer(x, z): EntityId {
      const s = world.store;
      const defId = DEF_TABLES.unitByKey.get('engineer')!;
      const id = s.alloc(
        EntityKind.Infantry, defId, PLAYER, world.player(PLAYER).faction, x, 0, z,
      );
      const i = s.index(id);
      s.flags[i] |= EntityFlag.CanMove | EntityFlag.Crushable;
      s.radius[i] = 0.5;
      s.maxSpeed[i] = 4;
      s.locomotor[i] = Locomotor.Foot;
      s.hp[i] = 25;
      s.maxHp[i] = 25;
      s.weaponIndex[i] = -1;
      s.state[i] = UnitState.Idle;
      world.spatial.rebuild();
      return id;
    },
  };
}

const SIM: SimContext = { dt: 1 / 30, tick: 1, time: 1 / 30, rng: new Rng(1) };

/** What one arrival did. Everything a case needs, read once. */
interface Arrival {
  readonly outcome: 'captured' | 'softened' | 'refused';
  readonly engineerAlive: boolean;
  readonly ownerAfter: number;
  readonly hpAfter: number;
  readonly cursorOffered: boolean;
}

/**
 * Stand an engineer against `target`, order the capture, run ONE tick, and
 * report.
 *
 * The engineer is placed inside `CAPTURE.reachMetres` of the footprint edge, so
 * `withinReach` is true on the first tick and `resolve` runs immediately — this
 * measures the DECISION, not the walk. `cursorOffered` is
 * `isCapturable`, i.e. what `input/Commands.ts#capturableNow` asks before it
 * emits the order at all, so a case can tell "refused on arrival" from "never
 * offered".
 */
function walkIn(rig: Rig, target: EntityId): Arrival {
  const s = rig.world.store;
  const t = s.index(target);
  const cursorOffered = rig.capture.isCapturable(target, PLAYER);

  const eng = rig.engineer(
    s.posX[t], s.posZ[t] + s.footprintH[t] * CELL * 0.5 + 1.0,
  );
  const i = s.index(eng);
  s.orderKind[i] = OrderKind.Capture;
  s.orderTarget[i] = target as number;
  s.orderX[i] = s.posX[t];
  s.orderZ[i] = s.posZ[t];
  s.state[i] = UnitState.Moving;

  const before = { ...rig.capture.stats };
  rig.capture.simTick(SIM);
  const after = rig.capture.stats;

  const outcome: Arrival['outcome'] = after.captures > before.captures
    ? 'captured'
    : after.softens > before.softens ? 'softened' : 'refused';

  return {
    outcome,
    // `consume` calls `markDead`, which sets PendingDestroy without freeing the
    // slot until the Cleanup flush — so "not consumed" is the ABSENCE of that
    // bit, not `index() >= 0`, which is true either way inside one tick.
    engineerAlive: (s.flags[i] & EntityFlag.PendingDestroy) === 0,
    ownerAfter: s.owner[s.index(target)],
    hpAfter: s.hp[s.index(target)],
    cursorOffered,
  };
}

/** Arm an operation and install the veto exactly as a real boot does. */
function boot(operationId: string): OperationDef {
  const op = armOperation(operationId, 1);
  expect(op, `${operationId} is no longer a shipped operation`).not.toBeNull();
  // `init()` is what `SystemRegistry.init` calls, and it is where the veto is
  // installed — after `adoptPreparedOperation`. Calling it directly is the whole
  // point: a spec that installed its own veto would prove the hook and say
  // nothing about the product.
  campaignSystem.init?.();
  return op as OperationDef;
}

/** The engine teardown. `dispose()` is where the veto is removed. */
function shutDown(): void {
  campaignSystem.dispose?.();
  disarmOperation();
}

/**
 * Bind `tag` to `id` inside the running session, through the PUBLIC save-side
 * door.
 *
 * `CampaignTagSet.restore` REPLACES the whole registry, so every tag a case
 * needs goes in one call — which is also why this takes a table rather than a
 * pair.
 */
function stampTags(rows: readonly (readonly [string, EntityId])[]): void {
  const session: CampaignSession | null = campaignSession();
  if (session === null) throw new Error('no campaign session is live — boot() was not called');
  const ids = rows.map(([, id]) => id);
  session.tags.restore(
    rows.map(([tag], k) => ({ tag, ids: [k] })),
    (local: number) => ids[local],
  );
}

afterEach(() => {
  campaignSystem.dispose?.();
  disarmOperation();
  setCaptureService(null);
  setProduction(null);
});

/* ==========================================================================
 * 1. THE CONTROL — the click works, and it costs the engineer
 *
 * Every refusal below is an ABSENCE, and an absence passes just as happily when
 * the rig never reached the branch. This is the case that proves it does.
 * ========================================================================== */

describe('with no operation armed, an engineer spends itself exactly as it always has', () => {
  it('takes a Gaia hospital outright, at full health, and dies doing it', () => {
    const rig = makeRig();
    const b = rig.building('civHospital', GAIA, 120, 120);
    const r = walkIn(rig, b);

    expect(r.outcome, 'rule 1: a neutral structure has no health gate').toBe('captured');
    expect(r.ownerAfter).toBe(PLAYER as number);
    expect(r.engineerAlive, 'every non-refused outcome calls `consume`').toBe(false);
    expect(r.cursorOffered, 'and the cursor offered it').toBe(true);
  });

  it('softens a healthy enemy derrick instead, and dies doing that too', () => {
    const rig = makeRig();
    const b = rig.building('civOilDerrick', FOE, 160, 160);
    const s = rig.world.store;
    const maxHp = s.maxHp[s.index(b)];
    const r = walkIn(rig, b);

    expect(r.outcome, 'rule 2: above `captureHpFrac`, the engineer is spent softening')
      .toBe('softened');
    expect(r.ownerAfter, 'and the deed does not move').toBe(FOE as number);
    expect(r.engineerAlive).toBe(false);
    // The soften is a damage RECORD, so the hp drop lands when `DamageSystem`
    // runs. What this file measures is the branch; `pact/02-long-count.ts`
    // carries the 900 -> 720 -> 540 -> 360 ladder driven through real damage.
    expect(CAPTURE.softenFrac * maxHp, 'the ladder the header prices').toBeCloseTo(maxHp * 0.25, 6);
  });

  it('and captures the same derrick once it is under the gate', () => {
    const rig = makeRig();
    const b = rig.building('civOilDerrick', FOE, 160, 160);
    const s = rig.world.store;
    s.hp[s.index(b)] = s.maxHp[s.index(b)] * 0.4;

    const r = walkIn(rig, b);
    expect(r.outcome).toBe('captured');
    expect(r.ownerAfter).toBe(PLAYER as number);
    expect(r.engineerAlive).toBe(false);
  });
});

/* ==========================================================================
 * 2. A LIST — `pact.02.long-count` protects `count` and nothing else
 * ========================================================================== */

describe('captureProof as a list refuses the named tag', () => {
  it('THE CASE: the reading post is refused and the Artificer walks home', () => {
    const rig = makeRig();
    const count = rig.building('civOilDerrick', FOE, 200, 200);
    const s = rig.world.store;
    // UNDER THE HEALTH GATE, deliberately. At full health the enemy branch would
    // soften and this case would pass whether or not the veto exists — the
    // engineer would die either way and only the reason would differ. Below the
    // gate the unvetoed answer is an outright CAPTURE, so a refusal here can
    // only be the veto.
    s.hp[s.index(count)] = s.maxHp[s.index(count)] * 0.4;

    boot('pact.02.long-count');
    stampTags([['count', count]]);

    const r = walkIn(rig, count);
    expect(r.outcome).toBe('refused');
    expect(r.engineerAlive, '`refuse()` does not consume — a vetoed click costs a walk')
      .toBe(true);
    expect(r.ownerAfter, 'and the post stays the Ninth\'s, which is what keeps it safe')
      .toBe(FOE as number);
    expect(r.hpAfter, 'not softened either — the veto sits ahead of the enemy branch')
      .toBe(s.maxHp[s.index(count)] * 0.4);
    expect(r.cursorOffered, '`isCapturable` consults the vetoes, so the walk never starts')
      .toBe(false);
  });

  it('and the pump beside it, which is unlisted, is still taken', () => {
    /*
     * THE SELECTIVITY HALF, AND IT IS THE ONE THAT MATTERS FOR THIS OPERATION.
     * `t.win` is `ownerCount(1, 'building', 'tap', max: 0)` — the primary is
     * SATISFIED by a capture, and the objective title says "take the Soviet
     * pumping head off them" because of it. A blanket here would delete the
     * operation's own second route.
     */
    const rig = makeRig();
    const tap = rig.building('civOreMine', FOE, 240, 240);
    const s = rig.world.store;
    s.hp[s.index(tap)] = s.maxHp[s.index(tap)] * 0.4;

    boot('pact.02.long-count');
    stampTags([['tap', tap]]);

    const r = walkIn(rig, tap);
    expect(r.outcome).toBe('captured');
    expect(r.ownerAfter).toBe(PLAYER as number);
    expect(r.engineerAlive, 'a real capture still costs the engineer').toBe(false);
    expect(r.cursorOffered).toBe(true);
  });

  it('pact.04 protects its mast the same way, and it is a real def not a civilian', () => {
    /*
     * THE SECOND LIST CASE, AND IT IS NOT A COPY. `mast` is an Allied `radar` —
     * an ordinary production structure on the foe's seat, where `count` is a
     * `civOilDerrick`. `resolve`'s enemy branch does not care, but this file
     * would not know that without driving both.
     *
     * The falsifier runs first, on its own rig, because a refusal that came from
     * `radar` being unbuildable or absent from `FALLBACK_BUILDINGS` would look
     * exactly like the veto working.
     */
    const control = makeRig();
    const c = control.building('radar', FOE, 220, 220);
    control.world.store.hp[control.world.store.index(c)] =
      control.world.store.maxHp[control.world.store.index(c)] * 0.4;
    expect(walkIn(control, c).outcome, 'the control has to succeed').toBe('captured');

    const rig = makeRig();
    const mast = rig.building('radar', FOE, 220, 220);
    const s = rig.world.store;
    s.hp[s.index(mast)] = s.maxHp[s.index(mast)] * 0.4;

    boot('pact.04.in-the-clear');
    stampTags([['mast', mast]]);

    const r = walkIn(rig, mast);
    expect(r.outcome).toBe('refused');
    expect(r.ownerAfter, 'the Allies keep it, which is what keeps their guns off it')
      .toBe(FOE as number);
    expect(r.engineerAlive).toBe(true);
    expect(r.cursorOffered).toBe(false);
  });

  it('and an untagged structure is not covered by the list at all', () => {
    const rig = makeRig();
    const other = rig.building('civApartments', FOE, 280, 280);
    const s = rig.world.store;
    s.hp[s.index(other)] = s.maxHp[s.index(other)] * 0.4;

    boot('pact.02.long-count');
    stampTags([['count', rig.building('civOilDerrick', FOE, 200, 200)]]);

    expect(walkIn(rig, other).outcome).toBe('captured');
  });
});

/* ==========================================================================
 * 3. `'all'` — and the difference from a list, on ONE structure
 * ========================================================================== */

describe("captureProof: 'all' refuses everything, which a list does not", () => {
  it('the same untagged enemy block: taken under pact.02, refused under allies.01', () => {
    /*
     * ONE STRUCTURE, TWO OPERATIONS, TWO ANSWERS. Doing it on a single
     * structure is what makes this a comparison rather than two independent
     * assertions that could both be true for unrelated reasons.
     *
     * `allies.01.sounding-line` needs the blanket because its hazards are
     * UNTAGGED: its layout stamps `party` and `sortie` and neither is a
     * building, so a tag list there is not a weaker protection but an empty one.
     */
    const listRig = makeRig();
    const underList = listRig.building('civApartments', FOE, 300, 300);
    listRig.world.store.hp[listRig.world.store.index(underList)] =
      listRig.world.store.maxHp[listRig.world.store.index(underList)] * 0.4;
    boot('pact.02.long-count');
    const listed = walkIn(listRig, underList);
    shutDown();

    const allRig = makeRig();
    const underAll = allRig.building('civApartments', FOE, 300, 300);
    allRig.world.store.hp[allRig.world.store.index(underAll)] =
      allRig.world.store.maxHp[allRig.world.store.index(underAll)] * 0.4;
    boot('allies.01.sounding-line');
    const blanketed = walkIn(allRig, underAll);

    expect(listed.outcome, 'a list covers its tags and nothing else').toBe('captured');
    expect(blanketed.outcome, "'all' covers a structure nobody tagged").toBe('refused');
    expect(listed.engineerAlive).toBe(false);
    expect(blanketed.engineerAlive, 'and the surveyor survives the misclick').toBe(true);
  });

  it("and 'all' reaches a Gaia structure too, which is the sharpest form", () => {
    // A neutral structure is taken OUTRIGHT at any health, so this is the one
    // shape where a single click is a whole surveyor with no ladder to notice.
    const rig = makeRig();
    const block = rig.building('civApartments', GAIA, 320, 320);

    boot('allies.01.sounding-line');
    const r = walkIn(rig, block);

    expect(r.outcome).toBe('refused');
    expect(r.ownerAfter).toBe(GAIA as number);
    expect(r.engineerAlive).toBe(true);
  });
});

/* ==========================================================================
 * 4. THE GAIA CASE — `soviets.06`, where capture and garrison differ
 * ========================================================================== */

describe('soviets.06 keeps the infirmary and lets the works be taken', () => {
  it('the hospital is refused where an unarmed operation would hand it over', () => {
    const rig = makeRig();
    const infirmary = rig.building('civHospital', GAIA, 340, 340);

    // The falsifier, inline: the identical click with nothing armed.
    const control = walkIn(rig, infirmary);
    expect(control.outcome, 'the control has to succeed or the case below is vacuous')
      .toBe('captured');

    const rig2 = makeRig();
    const inf2 = rig2.building('civHospital', GAIA, 340, 340);
    boot('soviets.06.demolition-order');
    stampTags([['infirmary', inf2]]);

    const r = walkIn(rig2, inf2);
    expect(r.outcome).toBe('refused');
    expect(r.ownerAfter, 'Gaia keeps the deed, so it keeps the universal alliance')
      .toBe(GAIA as number);
    expect(r.engineerAlive).toBe(true);
  });

  it("and `works` stays capturable, because the primary says \"take off the seam\"", () => {
    const rig = makeRig();
    const plant = rig.building('powerPlant', FOE, 360, 360);
    const s = rig.world.store;
    s.hp[s.index(plant)] = s.maxHp[s.index(plant)] * 0.4;

    boot('soviets.06.demolition-order');
    stampTags([['works', plant]]);

    const r = walkIn(rig, plant);
    expect(r.outcome, '`ownerCount(1, building, works, max: 0)` is answered by a deed')
      .toBe('captured');
    expect(r.ownerAfter).toBe(PLAYER as number);
  });
});

/* ==========================================================================
 * 5. LIFETIME — whoever sets it clears it
 * ========================================================================== */

describe('the veto belongs to the engine that installed it', () => {
  it('is gone after dispose, so the next skirmish inherits nothing', () => {
    const rig = makeRig();
    const count = rig.building('civOilDerrick', FOE, 200, 200);
    const s = rig.world.store;
    s.hp[s.index(count)] = s.maxHp[s.index(count)] * 0.4;

    boot('pact.02.long-count');
    stampTags([['count', count]]);
    expect(walkIn(rig, count).outcome, 'armed').toBe('refused');

    // The engine goes down. `campaign.system.ts#dispose` removes the veto and
    // detaches the session; nothing else in the product does.
    campaignSystem.dispose?.();

    expect(walkIn(rig, count).outcome, 'and the rule leaves with it').toBe('captured');
  });

  it('and dispose really calls the unsubscribe, rather than leaning on the detach', () => {
    /*
     * THE VACUITY THIS TEST ALMOST WAS, WRITTEN DOWN BECAUSE IT WAS MEASURED.
     *
     * The predicate re-reads `campaignSession()` instead of closing over the
     * session it was installed for, deliberately — a veto whose session has been
     * detached must behave like no veto at all. The cost of that choice is that a
     * LEAKED veto (unsubscribe dropped) is INVISIBLE to every case above: it
     * answers false the moment `detachOperation` runs, so the whole file stays
     * green. Deleting the `unhookCaptureProof =` assignment in
     * `campaign.system.ts` was tried and the suite reported 21/21.
     *
     * `vetoes` is private, so the count cannot be read. What CAN be read is
     * whether the predicate is still on the list when a session comes back:
     * `dispose()` clears `live` and leaves `pending` alone, and
     * `adoptPreparedOperation()` — the very first thing the NEXT engine's
     * `init()` does — re-attaches it. With the unsubscribe honoured the list is
     * empty and the click succeeds. With it dropped, the old closure is still
     * there, sees a live session again, and refuses.
     */
    const rig = makeRig();
    const count = rig.building('civOilDerrick', FOE, 200, 200);
    const s = rig.world.store;
    s.hp[s.index(count)] = s.maxHp[s.index(count)] * 0.4;

    boot('pact.02.long-count');
    stampTags([['count', count]]);
    expect(walkIn(rig, count).outcome, 'armed').toBe('refused');

    campaignSystem.dispose?.();
    // The session comes back WITHOUT a fresh install. Anything still refusing
    // here is a predicate `dispose()` failed to take off the list.
    adoptPreparedOperation();
    expect(campaignSession(), 'the armed session really did come back').not.toBeNull();

    expect(walkIn(rig, count).outcome, 'a leaked veto would still be refusing')
      .toBe('captured');
  });

  it('installs nothing at all when no operation is armed', () => {
    /*
     * `armCaptureProof` returns early when `campaignSession()` is null, so an
     * ordinary skirmish carries no campaign predicate on the veto list. An inert
     * veto would be harmless and would still be a rule a reader has to check.
     */
    const rig = makeRig();
    const b = rig.building('civHospital', GAIA, 380, 380);
    campaignSystem.init?.();
    expect(walkIn(rig, b).outcome).toBe('captured');
  });
});

/* ==========================================================================
 * 6. VALIDATION — a typo is a build error, not a silent permission
 * ========================================================================== */

/** The shipped campaign with one operation's fields overridden. */
function campaignWith(opId: string, over: Partial<OperationDef>): readonly ChapterDef[] {
  return CAMPAIGNS.map((ch) => ({
    ...ch,
    operations: ch.operations.map((o) => (o.id === opId ? { ...o, ...over } : o)),
  }));
}

const faultsFor = (chapters: readonly ChapterDef[]): readonly string[] =>
  validateCampaign(chapters, campaignFacts());

describe('validateCampaign refuses a captureProof that cannot bite', () => {
  it('the shipped campaign is clean, or nothing below means anything', () => {
    expect(faultsFor(CAMPAIGNS)).toEqual([]);
  });

  it('a tag no layout stamps is a fault naming the tag and the layout', () => {
    /*
     * THE `map.coral-shore` SHAPE. A well-spelled no-op is worse than a typo,
     * because the typo was refused: the veto would match nothing, the structure
     * would stay capturable, and the operation's own source would go on claiming
     * otherwise. Nothing at runtime can report it — a veto that matches nothing
     * is indistinguishable from no veto.
     */
    const f = faultsFor(campaignWith('pact.02.long-count', { captureProof: ['cuont'] }));
    expect(f, `expected exactly one fault, got: ${JSON.stringify(f, null, 2)}`).toHaveLength(1);
    expect(f[0]).toContain('captureProof names tag \'cuont\'');
    expect(f[0]).toContain('pact-long-count');
  });

  it('an empty list is a fault, because it reads as protection and is not', () => {
    const f = faultsFor(campaignWith('pact.02.long-count', { captureProof: [] }));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('captureProof is an empty list');
  });

  it('a repeated tag is a fault', () => {
    const f = faultsFor(campaignWith('pact.02.long-count', { captureProof: ['count', 'count'] }));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('twice');
  });

  it("and 'all' is accepted without naming anything, which is the whole point", () => {
    expect(faultsFor(campaignWith('pact.02.long-count', { captureProof: 'all' }))).toEqual([]);
    expect(faultsFor(campaignWith('pact.02.long-count', { captureProof: undefined }))).toEqual([]);
  });
});

/* ==========================================================================
 * 7. THE SHIPPED TABLE — the six, by name, in both directions
 * ========================================================================== */

describe('exactly six operations declare captureProof', () => {
  const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c: ChapterDef) => c.operations);

  it('and they are the six whose headers say so', () => {
    /*
     * A ROSTER RATHER THAN A RULE, and both directions matter. A NEW operation
     * arriving is a content decision somebody should have to write down; one of
     * these LEAVING silently reopens a documented hazard whose paragraph now
     * says it is closed.
     *
     * `reclamation.05.closing-entry` was the fifth, and it is the second of the
     * three shapes this list holds. Four of these protect a structure the
     * OPPONENT owns; that one protects two the PLAYER owns — every threshold in
     * the file counts what seat 0 holds, so a captured counting house reads as a
     * lost one and ends the operation in a defeat on the tick it changes hands.
     * Its header measures that seat 1 really does open holding an
     * `mrdArtificer`, so this is not a well-spelled no-op waiting on a call site.
     *
     * `pact.07.thin-place` is the sixth and the THIRD shape: three GAIA
     * buildings, which is `Capture.resolve` rule 1 — a neutral structure is taken
     * outright, at ANY health, by one engineer, with no health gate to soften
     * through. They are the operation's `hamlet` primary, and a captured holding
     * lands on SEAT 0 in the middle of the enemy's own parcel, where
     * `Targeting.isValidTarget` — which refuses only ALLIES — makes it a legal
     * target for every gun the Ninth owns while the trigger that ends the match
     * does not care who fired. The player opens with an `mrdArtificer`, so the
     * play is available and the veto is not a no-op. Its header records the door
     * this does NOT close: `GarrisonService.enter` calls `captureBuilding()`
     * directly and consults no `CaptureService` veto, which is
     * `allies.07.fair-copy`'s finding.
     */
    const declared = ALL
      .filter((o) => o.captureProof !== undefined)
      .map((o) => `${o.id} = ${Array.isArray(o.captureProof) ? o.captureProof.join(',') : 'all'}`)
      .sort();
    expect(declared).toEqual([
      'allies.01.sounding-line = all',
      'pact.02.long-count = count',
      'pact.04.in-the-clear = mast',
      'pact.07.thin-place = terrace,well,infirmary',
      'reclamation.05.closing-entry = house,ledger',
      'soviets.06.demolition-order = infirmary',
    ]);
  });

  it("and soviets.06 is a LIST so its own primary still has a second route", () => {
    // `t.win` reads `ownerCount(1, 'building', 'works', max: 0)` and the
    // objective title says "take off the seam". A blanket there would make the
    // title a lie, so this is asserted by name rather than left to the roster.
    const op = ALL.find((o) => o.id === 'soviets.06.demolition-order')!;
    expect(op.captureProof).not.toBe('all');
    expect(op.captureProof).not.toContain('works');
    expect(op.captureProof).not.toContain('stack');
    expect(op.captureProof).not.toContain('device');
  });

  it("and allies.01 is the only 'all', because it is the only one with no deed to take", () => {
    const blanket = ALL.filter((o) => o.captureProof === 'all').map((o) => o.id);
    expect(blanket).toEqual(['allies.01.sounding-line']);
  });
});
