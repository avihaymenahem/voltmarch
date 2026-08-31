/**
 * Domain-owned config slice: render bridge and instance-batch contracts.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import { MAX_ENTITIES } from './runtime';

/* ==========================================================================
 * 20. RENDER BRIDGE / INSTANCE BATCHER
 *
 * The sim->render seam. One InstancedMesh per (geometry, material) pair; team
 * colour is a per-INSTANCE attribute so one batch covers both armies.
 * ========================================================================== */

/**
 * Instances a fresh batch is born with. Small, because most models only ever
 * hold a handful of entities (one Construction Yard, four Radar Domes) and 40
 * batches x 4096 slots would be 40 MB of matrices for nothing.
 */
export const INSTANCE_BATCH_INITIAL_CAPACITY = 32;
/** Geometric growth factor. Never allocate per spawn. */
export const INSTANCE_BATCH_GROWTH = 2;
/** Hard ceiling per batch. A batch can never need more slots than entity slots. */
export const INSTANCE_BATCH_MAX_CAPACITY = MAX_ENTITIES;

/**
 * Metres of headroom added to every batch's bounding sphere. Covers a model
 * whose art is taller than its registered geometry bounds (turret raised,
 * recoil, construction rise) so frustum culling never pops a visible unit.
 */
export const INSTANCE_BOUNDS_PADDING = 4.0;

/**
 * Placeholder look for a kind whose art module has not landed yet. Deliberately
 * a hazard-striped box, not a grey box: an unfinished model must read as a GAP
 * in a screenshot, never as a finished asset that happens to be plain.
 */
export const PLACEHOLDER_HAZARD_COLOR = '#E0A72A';
/** How dark the team colour goes on a placeholder body. */
export const PLACEHOLDER_BODY_MUL = 0.55;
/** Metres per hazard stripe on a placeholder. */
export const PLACEHOLDER_STRIPE_METRES = 0.9;
/** Emissive gain applied to a SELECTED placeholder so selection still reads. */
export const PLACEHOLDER_SELECT_EMISSIVE = 0.7;
/** Minimum Y scale of a placeholder building at buildProgress 0. */
export const PLACEHOLDER_MIN_RISE = 0.08;
