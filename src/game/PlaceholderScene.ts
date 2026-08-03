/**
 * RED ALERT — placeholder scene.
 *
 * A stub `SystemModule` that puts a readable battlefield on screen before any
 * gameplay module exists: a ground plane, a grid, and a handful of gray-box
 * volumes at real `WorldScale` dimensions so lighting, shadows, AO, fog and
 * bloom all have something to act on.
 *
 * EVERY OBJECT IN HERE IS DISPOSABLE SCAFFOLDING. `TerrainModule` deletes the
 * ground, `models`/`RenderBridge` delete the boxes. Nothing else may import
 * this file, and it must never grow gameplay behaviour.
 */

import * as THREE from 'three';
import { RenderPhase } from '../core/types';
import type { SystemModule, RenderContext } from '../core/types';
import { BUILDING_DIMENSIONS, CELL, MAP_SIZE, UNIT_DIMENSIONS } from '../core/config';
import { LAYERS, RENDER_ORDER, type SceneRig } from '../render/scene';
import { RENDER_CONFIG } from '../render/renderer';

export interface PlaceholderSceneOptions {
  sceneRig: SceneRig;
  /** Faction team colours, so the two "armies" read apart. */
  alliesColor: number;
  sovietsColor: number;
  /** Cyan/amber emissive panel colours. */
  alliesEmissive: number;
  sovietsEmissive: number;
  /**
   * Spin the radar dish. MUST be false for `?shot=`: `RenderContext.dt` keeps
   * ticking while the sim is paused (frame systems still run), so an animated
   * prop would make every screenshot differ and destroy the diff harness.
   */
  animate?: boolean;
}

/** Height of the ground plane this module publishes. Terrain replaces it. */
export const PLACEHOLDER_GROUND_Y = 0;

export function createPlaceholderScene(options: PlaceholderSceneOptions): SystemModule & {
  /** Flat ground sampler for `CameraRig.setGroundHeightFn`. */
  heightAt(x: number, z: number): number;
} {
  const { sceneRig } = options;
  const scene = sceneRig.scene;

  const disposables: Array<{ dispose(): void }> = [];
  const root = new THREE.Group();
  root.name = '__placeholderScenario';

  let spinner: THREE.Object3D | null = null;

  function track<T extends { dispose(): void }>(v: T): T {
    disposables.push(v);
    return v;
  }

  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    z: number,
    material: THREE.Material,
    y = 0,
  ): THREE.Mesh {
    const geo = track(new THREE.BoxGeometry(w, h, d));
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y + h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = RENDER_ORDER.OPAQUE;
    mesh.layers.set(LAYERS.DEFAULT);
    root.add(mesh);
    return mesh;
  }

  return {
    id: 'game.placeholderScene',
    renderPhase: RenderPhase.Bridge,

    init(): void {
      /* ---- ground ------------------------------------------------------ */
      // `createScene` already publishes a textured 512 m plane. Only build our
      // own if that one is switched off, so we can never z-fight with it.
      if (!RENDER_CONFIG.scene.placeholderGround) {
        const geo = track(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 32, 32));
        geo.rotateX(-Math.PI / 2);
        const mat = track(
          new THREE.MeshStandardMaterial({ color: 0x6b6455, roughness: 1, metalness: 0 }),
        );
        const ownGround = new THREE.Mesh(geo, mat);
        ownGround.name = '__gameGround';
        ownGround.position.set(MAP_SIZE * 0.5, PLACEHOLDER_GROUND_Y, MAP_SIZE * 0.5);
        ownGround.receiveShadow = true;
        ownGround.renderOrder = RENDER_ORDER.TERRAIN;
        ownGround.layers.set(LAYERS.DEFAULT);
        ownGround.layers.enable(LAYERS.TERRAIN);
        root.add(ownGround);
      } else {
        sceneRig.setPlaceholderGroundVisible(true);
      }

      /* ---- 4 m cell grid ------------------------------------------------ */
      // Draws the build grid the whole game is snapped to. Lifted 2 cm so it
      // never z-fights the ground.
      const grid = new THREE.GridHelper(MAP_SIZE, MAP_SIZE / 4, 0x2a3038, 0x2a3038);
      grid.position.set(MAP_SIZE * 0.5, PLACEHOLDER_GROUND_Y + 0.02, MAP_SIZE * 0.5);
      const gridMat = grid.material as THREE.Material;
      gridMat.transparent = true;
      gridMat.opacity = 0.16;
      gridMat.depthWrite = false;
      grid.renderOrder = RENDER_ORDER.DECALS;
      grid.layers.set(LAYERS.DEFAULT);
      track(grid.geometry);
      track(gridMat);
      root.add(grid);

      /* ---- materials --------------------------------------------------- */
      const concrete = track(
        new THREE.MeshStandardMaterial({ color: 0xb9bcb6, roughness: 0.88, metalness: 0.0 }),
      );
      const allies = track(
        new THREE.MeshStandardMaterial({
          color: options.alliesColor,
          roughness: 0.42,
          metalness: 0.65,
          emissive: options.alliesEmissive,
          // The 2-4 emissiveIntensity band in the art bible is for a small
          // PANEL. These gray boxes emit over their whole surface, and bloom
          // radius is 0.70 — at 2.6 a single box veils the entire frame to
          // white. Verified in browser. Real models keep the emissive masked
          // to a few percent of the area and can use the full band.
          emissiveIntensity: 0.35,
        }),
      );
      const soviets = track(
        new THREE.MeshStandardMaterial({
          color: options.sovietsColor,
          roughness: 0.6,
          metalness: 0.5,
          emissive: options.sovietsEmissive,
          emissiveIntensity: 0.35,
        }),
      );

      /* ---- gray-box base ------------------------------------------------ */
      const cx = MAP_SIZE * 0.5;
      const cz = MAP_SIZE * 0.5;
      // NOTE the two different vocabularies in core/config.ts:
      //   BUILDING_DIMENSIONS.{w,h} are FOOTPRINT CELLS (multiply by CELL);
      //   `height` is metres. UNIT_DIMENSIONS.{l,w,h} are all metres.
      const yard = BUILDING_DIMENSIONS.conYard;
      const plant = BUILDING_DIMENSIONS.powerPlant;
      const tank = UNIT_DIMENSIONS.heavyTank;

      // Two bases, one per faction, either side of the centre line.
      box(yard.w * CELL, yard.height, yard.h * CELL, cx - 22, cz - 14, concrete);
      box(plant.w * CELL, plant.height, plant.h * CELL, cx - 22, cz + 4, allies);
      box(yard.w * CELL, yard.height, yard.h * CELL, cx + 22, cz + 14, concrete);
      box(plant.w * CELL, plant.height, plant.h * CELL, cx + 22, cz - 4, soviets);

      // A skirmish line of tanks so scale reads immediately.
      for (let i = 0; i < 5; i++) {
        box(tank.w, tank.h, tank.l, cx - 16 + i * 8, cz + 22, allies);
        box(tank.w, tank.h, tank.l, cx - 16 + i * 8, cz - 26, soviets);
      }

      // One spinning radar dish: proof the frame loop is actually running.
      const dishGeo = track(new THREE.ConeGeometry(2.4, 3.2, 5));
      const dish = new THREE.Mesh(dishGeo, allies);
      dish.position.set(cx, 8.4, cz);
      dish.rotation.z = Math.PI * 0.28;
      dish.castShadow = true;
      dish.layers.set(LAYERS.DEFAULT);
      const mast = box(1.4, 8.4, 1.4, cx, cz, concrete);
      mast.add(dish);
      dish.position.set(0, 4.2, 0);
      spinner = dish;

      scene.add(root);
    },

    frame(ctx: RenderContext): void {
      // ~9 deg/s. Uses the render dt, not the sim dt — this is pure decoration
      // and must never touch simulation state.
      if (spinner && options.animate !== false) spinner.rotateY(ctx.dt * 0.16);
    },

    dispose(): void {
      scene.remove(root);
      root.clear();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      spinner = null;
    },

    heightAt(): number {
      return PLACEHOLDER_GROUND_Y;
    },
  };
}
