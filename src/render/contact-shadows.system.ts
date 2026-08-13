/**
 * ============================================================================
 * VOLTMARCH — src/render/contact-shadows.system.ts
 * ============================================================================
 * Registration shim for `ContactShadows.ts`. All of the work is there; this
 * file builds one field, hands it the terrain's height function, and rewrites
 * it once per rendered frame.
 *
 * RenderPhase.Bridge, order 5: after the bridge has placed this frame's
 * entities and before the VFX pass, so a pool is written from the position the
 * hull is actually being drawn at rather than last frame's. Reading positions
 * from the store means it does not matter whether the bridge has run — the
 * store is the truth either way — but keeping it adjacent is what makes the
 * ordering obvious to the next reader.
 *
 * NO ENTITY WORK IN `init()`. The lesson is recorded in `world/ore.system.ts`:
 * init runs long before the scenario spawns anything, so a module that
 * enumerates entities there sees an empty world and silently draws nothing
 * forever. This one allocates at capacity with `count = 0` and fills from
 * `frame()`, which is correct on the first frame and on every frame after a
 * new match.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { RenderPhase } from '../core/types';
import { ctx } from '../game/context';
import { getTerrain } from '../world/Terrain';
import { ContactShadowField } from './ContactShadows';

let field: ContactShadowField | null = null;

export default defineSystem({
  id: 'render.contactShadows',
  renderPhase: RenderPhase.Bridge,
  order: 5,

  init(): void {
    const { sceneRig } = ctx();
    // Resolved per call rather than captured: terrain is rebuilt between
    // matches, and a captured reference to a disposed heightfield is a worse
    // failure than a flat pool.
    field = new ContactShadowField((x, z) => getTerrain()?.heightAt(x, z) ?? 0);
    sceneRig.scene.add(field.mesh);
  },

  frame(): void {
    if (field === null) return;
    field.update(ctx().world);
  },

  dispose(): void {
    field?.dispose();
    field = null;
  },
});
