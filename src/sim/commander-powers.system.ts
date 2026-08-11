/**
 * ============================================================================
 * VOLTMARCH — src/sim/commander-powers.system.ts
 * ============================================================================
 * Registration for the five commander powers the mission table pays out.
 *
 * PHASE.COMMAND, ORDER 9700
 * --------------------------
 * The effects do not run here — they run inside the ONE Phase.Command drain, in
 * `src/input/Commands.ts` at order 9000, through the seam this module installs.
 * All `simTick` does at 9700 is age the charges, and it sits behind
 * `sim.abilities` (9600) so a tick that fires both resolves the hero's ability
 * first.
 *
 * It must still be a Phase.Command module rather than a later one: the charge
 * has to have been decremented for THIS tick before the next tick's drain asks
 * whether a power is ready, and putting the ageing in a later phase would make
 * "ready" mean something different depending on which phase asked.
 *
 * NO DEF TABLE
 * ------------
 * Unlike `sim/abilities.system.ts` there is nothing to await. A power belongs to
 * a player, not to a unit, so there is no `UnitDef` to bind and no content boot
 * to wait for — which is also why a power still works with every hero dead.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { PlayerId, SimContext } from '../core/types';
import { ctx } from '../game/context';
import { COMMANDER_POWERS, powerByKey } from '../progression/powers';

import {
  CommanderPowerService, setCommanderPowerSeam, setCommanderPowerService,
} from './CommanderPowers';

let service: CommanderPowerService | null = null;

export default defineSystem({
  id: 'sim.commanderPowers',
  phase: Phase.Command,
  order: 9700,

  init(): void {
    const { world, channels } = ctx();
    service = new CommanderPowerService(world, channels);
    setCommanderPowerService(service);
    setCommanderPowerSeam(service);

    // Console handle, matching __vmProduction / __vmAbilities / __vmFeatures.
    //
    // `fire` goes through `channels.commands` rather than calling `use`
    // directly, so a power called from the console is recorded by the replay
    // tap and relayed to a peer exactly as a button press would be. A console
    // that bypassed the bus would be a debugging tool that cannot reproduce the
    // bug it is being used on.
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmPowers = {
      service,
      /** `__vmPowers.fire('airstrike', 512, 512)` from the console. */
      fire: (key: string, x: number, z: number): boolean => {
        const spec = powerByKey(key);
        if (spec === undefined) return false;
        channels.commands.issueUsePower(world.localPlayer, spec.id, x, z);
        return true;
      },
      /** Seconds until each power is callable for the local player. */
      charges: (): Record<string, number> => {
        const out: Record<string, number> = {};
        for (let i = 1; i < COMMANDER_POWERS.length; i++) {
          out[COMMANDER_POWERS[i].key] = service?.chargeSecondsOf(world.localPlayer, i) ?? 0;
        }
        return out;
      },
      readyFor: (player: number, power: number): boolean =>
        service?.isReady(player as PlayerId, power) ?? false,
    };

    console.info(
      `[sim] ${COMMANDER_POWERS.length - 1} commander powers online, charging`,
    );
  },

  simTick(s: SimContext): void {
    service?.tick(s);
  },

  dispose(): void {
    service?.dispose();
    service = null;
    setCommanderPowerService(null);
    setCommanderPowerSeam(null);
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__vmPowers;
  },
});
