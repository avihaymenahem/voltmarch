/**
 * ============================================================================
 * RED ALERT — src/ui/Cameos.ts
 * ============================================================================
 * LIVE CAMEO RENDERS (VISUAL_DNA I10 / §2.8).
 *
 * The original's cameos were pre-rendered bitmaps. Ours are rendered from the
 * ACTUAL game mesh into a cached render target, which is the one modernisation
 * the references physically cannot show. What we keep, because it is identity
 * and not limitation, is the **mini-diorama**: three-quarter view, key light
 * upper-left, visible ground contact shadow, and a full-bleed environment
 * backdrop matching the current theatre. The cameo grid must read as twenty
 * tiny photographs, never twenty flat icons.
 *
 * COST MODEL
 * ----------
 * A cameo is rendered when it becomes dirty and then never again — the result
 * lives in the cell's own 2D canvas. `frame()` spends at most
 * `HUD_CAMEO.perFrameBudget` renders, so a tab switch that dirties 20 cameos
 * costs 10 frames of trickle instead of one 20 ms hitch. Hover re-renders at
 * 30 Hz with a 12 deg/s turntable and is charged against the same budget.
 *
 * We deliberately reuse the MAIN renderer rather than creating a second WebGL
 * context: a second context doubles VRAM for the shared unit atlases and loses
 * the environment map. Everything we touch on the renderer (render target,
 * tone-mapping exposure, scissor/viewport) is saved and restored inside one
 * call, and all of it happens at RenderPhase.Hud — strictly before Bootstrap's
 * `present()` runs the real frame.
 *
 * FALLBACK
 * --------
 * No building art module exists yet, and a def key may not resolve to a model.
 * Rather than shipping an empty box, `paintFallback` draws a procedural
 * diorama in 2D — same backdrop, same contact shadow, same three-quarter read,
 * a chunky faction-coloured mass instead of the mesh. It looks like an
 * unfinished cameo, not like a broken one, and it swaps to the real mesh the
 * moment a model registers under that key.
 * ============================================================================
 */

import * as THREE from 'three';

import { HUD_CAMEO, HUD_SKIN_ALLIES, HUD_SKIN_SOVIETS } from '../core/config';
import { BuildTab, Faction } from '../core/types';
import { mixHex } from './Chrome';

/* ==========================================================================
 * SECTION 1 — THEATRE BACKDROPS
 *
 * "Full-bleed environment backdrop matching the current theatre" (§2.8). The
 * colour here is FULLY SATURATED on purpose — the cameo grid is one of the few
 * places allowed above the frame's tone contract, exactly like the ore and the
 * muzzle flashes.
 * ========================================================================== */

export type Theatre = 'temperate' | 'desert' | 'snow' | 'urban';

interface Backdrop {
  /** Sky, top to horizon. */
  skyTop: string;
  skyBottom: string;
  /** Ground, horizon to bottom. */
  groundFar: string;
  groundNear: string;
  /** Warm sun bloom centre, upper left. */
  sun: string;
}

const BACKDROPS: Readonly<Record<Theatre, Backdrop>> = {
  temperate: { skyTop: '#2E5C93', skyBottom: '#8CB4D6', groundFar: '#5E6418', groundNear: '#3A3F10', sun: '#FFE4A8' },
  desert:    { skyTop: '#3E6EA8', skyBottom: '#C9A46A', groundFar: '#A8874E', groundNear: '#6E5628', sun: '#FFD08C' },
  snow:      { skyTop: '#6E8CAE', skyBottom: '#E9F2F4', groundFar: '#CBDEE6', groundNear: '#8EA2AE', sun: '#FFFFFF' },
  urban:     { skyTop: '#1A2138', skyBottom: '#4A4258', groundFar: '#3E3C33', groundNear: '#232022', sun: '#FFC98A' },
};

/** Terrain/scenario biome names map onto the four backdrops we author. */
export function theatreFor(name: string | null | undefined): Theatre {
  switch ((name ?? '').toLowerCase()) {
    case 'desert':
    case 'arid':
      return 'desert';
    case 'snow':
    case 'arctic':
      return 'snow';
    case 'urban':
    case 'city':
      return 'urban';
    default:
      return 'temperate';
  }
}

/* ==========================================================================
 * SECTION 2 — WHAT A CAMEO NEEDS TO KNOW
 * ========================================================================== */

export interface CameoSubject {
  /** Content/def key, e.g. `grizzly`, `soviet_rhino`, `conyard`. */
  key: string;
  /** Display name, used only by the fallback painter's silhouette choice. */
  name: string;
  faction: Faction;
  tab: BuildTab;
  isBuilding: boolean;
  /** Footprint in cells for buildings; 0 for units. Sizes the fallback mass. */
  footprintW: number;
  footprintH: number;
}

/**
 * A model provider. The art modules own their libraries; the HUD must not
 * import them directly or a missing sibling breaks the whole interface, so the
 * lookup is injected and may legitimately return null forever.
 */
export type ModelProvider = (key: string, faction: Faction) => THREE.Object3D | null;

/* ==========================================================================
 * SECTION 3 — PRIMING A PROTOTYPE FOR NON-INSTANCED RENDERING
 *
 * The art modules author their materials for the RenderBridge's InstancedMesh
 * path: `onBeforeCompile` injects `attribute vec4 aState` (hpFrac,
 * buildProgress, selected, seed) and `attribute vec3 aTeamColor`, both supplied
 * per INSTANCE. A plain `THREE.Mesh` has neither, so WebGL feeds the shader the
 * default (0,0,0,1) — and `src/art/BuildingFactory.ts` reads `aState.y` as the
 * construction reveal:
 *
 *     raSink = (1.0 - bp) * aFeature.y * rises;
 *
 * With `bp = 0` every mass sinks by its own model height and is then clipped at
 * the ground plane, so a cameo of a Construction Yard renders as a black cell.
 * That is the bug this function exists to prevent, and it is the reason a cameo
 * cannot simply call `prototype()` and render the result.
 *
 * The fix is per-VERTEX attributes of the same names. The geometry is rebuilt as
 * a shell that SHARES every original buffer — position, normal, uv, aFeature —
 * and adds only the two small arrays, so priming a 3000-vertex structure costs
 * ~84 KB rather than a full geometry clone.
 * ========================================================================== */

/** Values a finished, undamaged, unselected model wants: hp 1, built 1. */
const CAMEO_STATE: readonly [number, number, number, number] = [1, 1, 0, 0.5];

/**
 * Walk a prototype and give every mesh the per-instance channels its material
 * expects. Idempotent — a geometry that already carries `aState` is left alone.
 * `teamColor` is LINEAR rgb, matching the RenderBridge's `aTeamColor` contract.
 */
export function primeCameoPrototype(root: THREE.Object3D, teamColor: THREE.Color): THREE.Object3D {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || mesh.geometry === undefined) return;
    const src = mesh.geometry;
    if (src.getAttribute('aState') !== undefined) return;

    const count = src.getAttribute('position')?.count ?? 0;
    if (count === 0) return;

    const shell = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      shell.setAttribute(name, src.attributes[name]);
    }
    if (src.index !== null) shell.setIndex(src.index);
    for (const g of src.groups) shell.addGroup(g.start, g.count, g.materialIndex);
    shell.boundingBox = src.boundingBox;
    shell.boundingSphere = src.boundingSphere;

    const state = new Float32Array(count * 4);
    const team = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      state[i * 4] = CAMEO_STATE[0];
      state[i * 4 + 1] = CAMEO_STATE[1];
      state[i * 4 + 2] = CAMEO_STATE[2];
      state[i * 4 + 3] = CAMEO_STATE[3];
      team[i * 3] = teamColor.r;
      team[i * 3 + 1] = teamColor.g;
      team[i * 3 + 2] = teamColor.b;
    }
    shell.setAttribute('aState', new THREE.BufferAttribute(state, 4));
    shell.setAttribute('aTeamColor', new THREE.BufferAttribute(team, 3));

    mesh.geometry = shell;
  });
  return root;
}

/* ==========================================================================
 * SECTION 4 — THE RENDERER
 * ========================================================================== */

interface Job {
  canvas: HTMLCanvasElement;
  subject: CameoSubject;
  /** Turntable angle in radians, advanced only while hovered. */
  spin: number;
  hovered: boolean;
  /** Wall-clock seconds of the last render; throttles the hover turntable. */
  lastRender: number;
  dirty: boolean;
}

export class CameoRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1.25, 0.5, 200);
  private readonly pivot = new THREE.Group();
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly fill: THREE.HemisphereLight;

  private readonly backdropMesh: THREE.Mesh;
  private readonly backdropTex: THREE.CanvasTexture;
  private readonly backdropCanvas: HTMLCanvasElement;

  private readonly shadowMesh: THREE.Mesh;

  private rt: THREE.WebGLRenderTarget | null = null;
  private rtW = 0;
  private rtH = 0;
  private pixels = new Uint8Array(0);
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;

  private theatre: Theatre = 'temperate';
  private provider: ModelProvider = () => null;
  private current: THREE.Object3D | null = null;

  /** Keyed by canvas, so a cell that scrolls to a new def just re-registers. */
  private readonly jobs = new Map<HTMLCanvasElement, Job>();
  private readonly queue: Job[] = [];

  /** Model bounds are static; measuring one every hover frame is pure waste. */
  private readonly boundsCache = new WeakMap<THREE.Object3D, THREE.Box3>();
  private readonly scratchSize = new THREE.Vector3();
  private readonly scratchCentre = new THREE.Vector3();

  private disposed = false;
  /** Diagnostics for the boot log / debug overlay. */
  rendersThisFrame = 0;
  totalRenders = 0;
  meshHits = 0;
  fallbacks = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Key light upper-LEFT at ~35 deg elevation, per §2.8. The rim is what
    // stops a dark hull dissolving into a dark backdrop; the hemisphere is the
    // fill (AmbientLight is banned engine-wide by the look bible).
    this.key = new THREE.DirectionalLight(0xfff0d8, 3.4);
    this.key.position.set(-2.2, 2.4, 3.0);
    this.rim = new THREE.DirectionalLight(0xbcd8ff, 1.5);
    this.rim.position.set(2.6, 1.2, -2.4);
    this.fill = new THREE.HemisphereLight(0x8fb4e8, 0x6a5c3c, 0.85);
    this.scene.add(this.key, this.rim, this.fill, this.pivot);

    // Backdrop: a plane parked behind the subject, textured from a 2D canvas so
    // the theatre swap is a repaint rather than a shader.
    this.backdropCanvas = document.createElement('canvas');
    this.backdropCanvas.width = 64;
    this.backdropCanvas.height = 64;
    this.backdropTex = new THREE.CanvasTexture(this.backdropCanvas);
    this.backdropTex.colorSpace = THREE.SRGBColorSpace;
    this.backdropMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.backdropTex, depthWrite: false, toneMapped: false }),
    );
    this.backdropMesh.renderOrder = -100;
    this.scene.add(this.backdropMesh);

    // Contact shadow: one soft radial blob on the ground plane. Every reference
    // cameo has one and a subject without it floats instantly.
    this.shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: makeBlobTexture(),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        color: 0x000000,
        opacity: 0.55,
      }),
    );
    this.shadowMesh.rotation.x = -Math.PI * 0.5;
    this.scene.add(this.shadowMesh);

    this.scratch = document.createElement('canvas');
    const sctx = this.scratch.getContext('2d');
    if (!sctx) throw new Error('[hud] 2D context unavailable for the cameo blitter');
    this.scratchCtx = sctx;

    this.paintBackdrop();
  }

  /* -- configuration ------------------------------------------------------ */

  setModelProvider(fn: ModelProvider): void {
    this.provider = fn;
    // Every cached cameo was drawn against the OLD provider; a model landing
    // mid-match must replace the fallbacks rather than wait for a tab switch.
    for (const job of this.jobs.values()) this.markDirty(job);
  }

  setTheatre(t: Theatre): void {
    if (this.theatre === t) return;
    this.theatre = t;
    this.paintBackdrop();
    for (const job of this.jobs.values()) this.markDirty(job);
  }

  /** Environment map for the physical materials the unit factory produces. */
  setEnvironment(env: THREE.Texture | null): void {
    this.scene.environment = env;
  }

  /* -- registration ------------------------------------------------------- */

  /**
   * Bind a cell canvas to a subject. Cheap and idempotent: re-binding the same
   * subject does nothing, re-binding a different one queues one render.
   */
  bind(canvas: HTMLCanvasElement, subject: CameoSubject): void {
    const existing = this.jobs.get(canvas);
    if (existing && existing.subject.key === subject.key && existing.subject.faction === subject.faction) {
      existing.subject = subject;
      return;
    }
    // `dirty` starts FALSE on purpose: markDirty() is what pushes the job onto
    // the render queue, and it early-outs on an already-dirty job. Being born
    // dirty means being born unqueued, i.e. never rendered at all.
    const job: Job = existing ?? {
      canvas,
      subject,
      spin: 0,
      hovered: false,
      lastRender: 0,
      dirty: false,
    };
    job.subject = subject;
    job.spin = 0;
    this.jobs.set(canvas, job);
    this.markDirty(job);
  }

  unbind(canvas: HTMLCanvasElement): void {
    const job = this.jobs.get(canvas);
    if (!job) return;
    this.jobs.delete(canvas);
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** Hover starts the turntable; leaving it freezes the pose where it stopped. */
  setHovered(canvas: HTMLCanvasElement, hovered: boolean): void {
    const job = this.jobs.get(canvas);
    if (!job || job.hovered === hovered) return;
    job.hovered = hovered;
    if (!hovered) this.markDirty(job); // one last frame at the resting pose
  }

  /** Force a repaint, e.g. after a device-pixel-ratio change resized the canvas. */
  invalidateAll(): void {
    for (const job of this.jobs.values()) this.markDirty(job);
  }

  private markDirty(job: Job): void {
    if (job.dirty) return;
    job.dirty = true;
    this.queue.push(job);
  }

  /* -- per-frame ---------------------------------------------------------- */

  frame(time: number, dt: number): void {
    if (this.disposed) return;
    this.rendersThisFrame = 0;

    // Hovered cameos re-arm themselves at HUD_CAMEO.hoverHz. Everything else is
    // pure cache, which is why an idle sidebar costs zero GPU.
    const hoverPeriod = 1 / HUD_CAMEO.hoverHz;
    const spinStep = THREE.MathUtils.degToRad(HUD_CAMEO.turntableDegPerSec) * dt;
    for (const job of this.jobs.values()) {
      if (!job.hovered) continue;
      job.spin += spinStep;
      if (time - job.lastRender >= hoverPeriod) this.markDirty(job);
    }

    let budget = HUD_CAMEO.perFrameBudget;
    while (budget > 0 && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || !job.dirty) continue;
      job.dirty = false;
      if (!this.jobs.has(job.canvas)) continue;
      this.render(job, time);
      budget--;
    }
  }

  /* -- the render --------------------------------------------------------- */

  private render(job: Job, time: number): void {
    const canvas = job.canvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    job.lastRender = time;
    this.totalRenders++;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const model = this.provider(job.subject.key, job.subject.faction);
    if (model === null) {
      this.fallbacks++;
      paintFallback(ctx, w, h, job.subject, BACKDROPS[this.theatre]);
      return;
    }
    this.meshHits++;

    this.ensureTarget(w * HUD_CAMEO.supersample, h * HUD_CAMEO.supersample);
    const rt = this.rt;
    if (rt === null) {
      paintFallback(ctx, w, h, job.subject, BACKDROPS[this.theatre]);
      return;
    }

    // --- pose ------------------------------------------------------------
    this.pivot.clear();
    // Reset BEFORE measuring: Box3.setFromObject reads matrixWorld, and the
    // pivot still carries the previous cameo's offset and turntable angle.
    // Measuring through that produces a box that drifts a little further off
    // every hover frame, which reads as the subject slowly sliding out of shot.
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.add(model);
    this.pivot.updateMatrixWorld(true);
    this.current = model;

    const box = this.boundsOf(model);
    const size = this.scratchSize;
    const centre = this.scratchCentre;
    box.getSize(size);
    box.getCenter(centre);
    // Framing radius for the lights and the backdrop only. The CAMERA is fitted
    // per axis below — a single bounding radius pads a wide flat War Factory as
    // if it were a sphere and leaves it filling barely half the cell.
    const radius = Math.max(0.35, 0.5 * Math.max(size.x, size.y, size.z));

    // Recentre horizontally, keep the model standing ON the ground plane so the
    // contact shadow lands where the tracks are.
    this.pivot.position.set(-centre.x, -box.min.y, -centre.z);
    this.pivot.rotation.y = THREE.MathUtils.degToRad(HUD_CAMEO.yawDeg) + job.spin;

    const aspect = w / h;
    this.camera.aspect = aspect;
    // Fit per axis and take the binding one, so the subject fills
    // HUD_CAMEO.subjectFill of whichever dimension runs out first. The width
    // term uses the FOOTPRINT DIAGONAL because the three-quarter yaw turns a
    // 12 x 12 m pad into a ~17 m wide silhouette; using max(x, z) would clip
    // the corners of every square structure.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const tanHalf = Math.tan(vFov * 0.5);
    const halfW = 0.5 * Math.hypot(size.x, size.z);
    const halfH = 0.5 * size.y;
    const fitH = halfH / tanHalf;
    const fitW = halfW / (tanHalf * Math.max(0.001, aspect));
    const dist = Math.max(0.6, Math.max(fitH, fitW) / HUD_CAMEO.subjectFill);

    const pitch = THREE.MathUtils.degToRad(HUD_CAMEO.pitchDeg);
    // Aim a little below the box centre so the subject sits high enough for the
    // name label, which is drawn straight over the bottom of the art.
    const cy = size.y * 0.42;
    this.camera.position.set(0, cy + dist * Math.sin(pitch), dist * Math.cos(pitch));
    this.camera.lookAt(0, cy, 0);
    this.camera.near = Math.max(0.05, dist - radius * 3);
    this.camera.far = dist + radius * 8;
    this.camera.updateProjectionMatrix();

    // Lights scale with the subject or a 60 m warship gets a 2 m key light.
    this.key.position.set(-radius * 1.8, radius * 2.0, radius * 2.4);
    this.rim.position.set(radius * 2.2, radius * 1.0, -radius * 2.0);

    // Backdrop plane parked just in front of the far clip, sized to fill.
    const bz = this.camera.far * 0.82;
    const bh = 2 * bz * Math.tan(vFov * 0.5);
    this.backdropMesh.position.set(0, cy, 0);
    this.backdropMesh.scale.set(bh * aspect * 1.05, bh * 1.05, 1);
    this.backdropMesh.quaternion.copy(this.camera.quaternion);
    this.backdropMesh.position.copy(this.camera.position);
    this.backdropMesh.translateZ(-bz);

    this.shadowMesh.position.set(0, 0.012, 0);
    this.shadowMesh.scale.set(radius * 3.1, radius * 3.1, 1);

    // --- draw ------------------------------------------------------------
    const prevTarget = this.renderer.getRenderTarget();
    const prevExposure = this.renderer.toneMappingExposure;
    const prevScissorTest = this.renderer.getScissorTest();
    // Cameos are the "twenty tiny photographs" exception to the frame's tone
    // contract; at the world's exposure they read as twenty dark smudges.
    this.renderer.toneMappingExposure = prevExposure * 1.42;
    this.renderer.setScissorTest(false);
    this.renderer.setRenderTarget(rt);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(rt, 0, 0, this.rtW, this.rtH, this.pixels);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMappingExposure = prevExposure;
    this.renderer.setScissorTest(prevScissorTest);

    this.pivot.clear();
    this.current = null;

    // --- blit -------------------------------------------------------------
    // GL reads bottom-up; flip while copying rows so the ImageData is upright.
    const img = this.scratchCtx.createImageData(this.rtW, this.rtH);
    const dst = img.data;
    const src = this.pixels;
    const stride = this.rtW * 4;
    for (let y = 0; y < this.rtH; y++) {
      const s = (this.rtH - 1 - y) * stride;
      dst.set(src.subarray(s, s + stride), y * stride);
    }
    this.scratchCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.scratch, 0, 0, this.rtW, this.rtH, 0, 0, w, h);
  }

  /** Local-space bounds of a prototype, measured once and cached. */
  private boundsOf(model: THREE.Object3D): THREE.Box3 {
    let box = this.boundsCache.get(model);
    if (box === undefined) {
      box = new THREE.Box3().setFromObject(model);
      this.boundsCache.set(model, box);
    }
    return box;
  }

  private ensureTarget(w: number, h: number): void {
    const tw = Math.max(8, Math.round(w));
    const th = Math.max(8, Math.round(h));
    if (this.rt !== null && this.rtW === tw && this.rtH === th) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(tw, th, {
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rtW = tw;
    this.rtH = th;
    this.pixels = new Uint8Array(tw * th * 4);
    this.scratch.width = tw;
    this.scratch.height = th;
  }

  /** Repaint the 64x64 backdrop gradient for the current theatre. */
  private paintBackdrop(): void {
    const c = this.backdropCanvas;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const b = BACKDROPS[this.theatre];

    const sky = ctx.createLinearGradient(0, 0, 0, c.height * 0.62);
    sky.addColorStop(0, b.skyTop);
    sky.addColorStop(1, b.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, c.width, Math.ceil(c.height * 0.62));

    const ground = ctx.createLinearGradient(0, c.height * 0.62, 0, c.height);
    ground.addColorStop(0, b.groundFar);
    ground.addColorStop(1, b.groundNear);
    ctx.fillStyle = ground;
    ctx.fillRect(0, Math.floor(c.height * 0.62), c.width, c.height);

    // Sun bloom upper-left, matching the key light direction. Tight and weak on
    // purpose: a wide 55%-alpha wash lifts the whole backdrop into the subject's
    // value range and the mesh stops reading against it. The cameo is allowed
    // to be saturated (§2.8) but it still has to have a figure and a ground.
    const sun = ctx.createRadialGradient(
      c.width * 0.24, c.height * 0.18, 0,
      c.width * 0.24, c.height * 0.18, c.width * 0.34,
    );
    sun.addColorStop(0, b.sun);
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, c.width, Math.ceil(c.height * 0.62));
    ctx.globalAlpha = 1;

    // Corner falloff: the darkest pixels in the cell belong at the edges, which
    // is what pushes the eye to the middle where the subject is.
    const vig = ctx.createRadialGradient(
      c.width * 0.5, c.height * 0.5, c.width * 0.22,
      c.width * 0.5, c.height * 0.5, c.width * 0.78,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, c.width, c.height);

    this.backdropTex.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pivot.clear();
    this.current = null;
    this.jobs.clear();
    this.queue.length = 0;
    this.rt?.dispose();
    this.rt = null;
    this.backdropTex.dispose();
    (this.backdropMesh.material as THREE.Material).dispose();
    this.backdropMesh.geometry.dispose();
    const sm = this.shadowMesh.material as THREE.MeshBasicMaterial;
    sm.map?.dispose();
    sm.dispose();
    this.shadowMesh.geometry.dispose();
    this.scene.clear();
  }
}

/* ==========================================================================
 * SECTION 4 — THE PROCEDURAL FALLBACK
 *
 * Same diorama grammar as the 3D path — backdrop, horizon, contact shadow,
 * three-quarter chunky mass, bevel highlight on the top edge, one team-colour
 * slab — so a sidebar that is half real meshes and half fallbacks still reads
 * as one set of photographs rather than a mixture of art and placeholder.
 * ========================================================================== */

function paintFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  subject: CameoSubject,
  b: Backdrop,
): void {
  const skin = subject.faction === Faction.Soviets ? HUD_SKIN_SOVIETS : HUD_SKIN_ALLIES;
  const horizon = h * 0.62;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, b.skyTop);
  sky.addColorStop(1, b.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  const sun = ctx.createRadialGradient(w * 0.22, h * 0.18, 0, w * 0.22, h * 0.18, w * 0.6);
  sun.addColorStop(0, b.sun);
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, horizon);
  ctx.globalAlpha = 1;

  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, b.groundFar);
  ground.addColorStop(1, b.groundNear);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Body colour: olive for Soviets, grey-white for Allies. Never the team
  // colour itself — that is a 7-10% accent slab, not a hull paint (R12).
  const body = subject.faction === Faction.Soviets ? '#4A6B33' : '#B9BCC4';
  const bodyLo = mixHex(body, '#0A0A0C', 0.55);
  const bodyHi = mixHex(body, '#FFFFFF', 0.38);
  const team = subject.faction === Faction.Soviets ? '#C0201C' : '#3B90F7';

  const cx = w * 0.5;
  const baseY = h * 0.80;
  const scale = subject.isBuilding
    ? Math.min(1.15, 0.62 + 0.13 * Math.max(subject.footprintW, subject.footprintH))
    : subject.tab === BuildTab.Infantry ? 0.62 : 0.86;

  // Contact shadow first — the cue that stops the mass floating.
  const shW = w * 0.46 * scale;
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.03, baseY + h * 0.02, shW, shW * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  const bw = w * 0.44 * scale;
  const bh = h * (subject.isBuilding ? 0.44 : subject.tab === BuildTab.Infantry ? 0.46 : 0.30) * scale;
  const depth = bw * 0.30;
  const left = cx - bw * 0.5 - depth * 0.35;
  const top = baseY - bh;

  // Front face.
  ctx.fillStyle = body;
  ctx.fillRect(left, top, bw, bh);
  // Right (shaded) face, drawn as a parallelogram for the three-quarter read.
  ctx.fillStyle = bodyLo;
  ctx.beginPath();
  ctx.moveTo(left + bw, top);
  ctx.lineTo(left + bw + depth, top - depth * 0.45);
  ctx.lineTo(left + bw + depth, top - depth * 0.45 + bh);
  ctx.lineTo(left + bw, top + bh);
  ctx.closePath();
  ctx.fill();
  // Top (lit) face.
  ctx.fillStyle = mixHex(body, '#FFFFFF', 0.20);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + depth, top - depth * 0.45);
  ctx.lineTo(left + bw + depth, top - depth * 0.45);
  ctx.lineTo(left + bw, top);
  ctx.closePath();
  ctx.fill();

  // Bevel highlight on every convex edge — property 2 of the look bible.
  ctx.strokeStyle = bodyHi;
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + depth, top - depth * 0.45);
  ctx.lineTo(left + bw + depth, top - depth * 0.45);
  ctx.stroke();

  // One contiguous team-colour slab on a camera-facing surface.
  ctx.fillStyle = team;
  ctx.fillRect(left + bw * 0.12, top + bh * 0.52, bw * 0.30, bh * 0.22);

  // Class tell: a barrel for combat vehicles, a mast for defences, a stack for
  // structures. Enough to keep the twenty fallbacks from looking identical.
  ctx.fillStyle = '#1A1A1E';
  if (subject.tab === BuildTab.Vehicles && !subject.isBuilding) {
    ctx.fillRect(left + bw * 0.42, top - depth * 0.45 - bh * 0.20, bw * 0.62, Math.max(1.5, bh * 0.10));
  } else if (subject.tab === BuildTab.Defense) {
    ctx.fillRect(cx - bw * 0.05, top - bh * 0.55, Math.max(1.5, bw * 0.09), bh * 0.60);
    ctx.fillStyle = team;
    ctx.fillRect(cx - bw * 0.11, top - bh * 0.62, bw * 0.22, Math.max(1.5, bh * 0.10));
  } else if (subject.isBuilding) {
    ctx.fillRect(left + bw * 0.68, top - depth * 0.45 - bh * 0.34, bw * 0.14, bh * 0.36);
  }

  // Hard 1 px contact edge along the base (blob-readability rule B3).
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, bw - 1, bh - 1);

  // Faint faction chrome vignette so the fallback still sits in the HUD family.
  const vig = ctx.createLinearGradient(0, 0, 0, h);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, `rgba(0,0,0,0.28)`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  void skin;
}

/* ==========================================================================
 * SECTION 5 — HELPERS
 * ========================================================================== */

/** Soft radial blob used as the ground contact shadow in the 3D path. */
function makeBlobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.72)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
