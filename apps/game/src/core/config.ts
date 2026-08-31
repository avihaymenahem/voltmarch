/**
 * VOLTMARCH configuration compatibility facade.
 *
 * Domain-owned literals live in ./config/*.ts. Existing imports intentionally
 * continue to resolve through this file so save, replay, protocol, test and
 * runtime identities do not move during dependency architecture Stage 0.
 */
export * from './config/runtime';
export * from './config/camera';
export * from './config/art-direction';
export * from './config/quality';
export * from './config/gameplay';
export * from './config/terrain';
export * from './config/unit-art';
export * from './config/scenarios';
export * from './config/render-bridge';
export * from './config/combat';
export * from './config/economy';
export * from './config/ai';
export * from './config/hud';
export * from './config/input';
export * from './config/audio';
export * from './config/production';
export * from './config/buildings';
export * from './config/vision';
export * from './config/vfx';
export * from './config/water';
export * from './config/roads';
export * from './config/navigation';
export * from './config/scatter';
export * from './config/abilities';
