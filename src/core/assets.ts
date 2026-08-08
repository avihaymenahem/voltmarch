/**
 * ============================================================================
 * VOLTMARCH — src/core/assets.ts
 * ============================================================================
 * THE PROCEDURAL TEXTURE FACTORY — the THREE-facing half.
 *
 * HARD REQUIREMENT: this game ships ZERO downloaded art. Every albedo, normal
 * and ORM map in the game is generated from noise and code, which means a
 * critic can retune the entire material look by editing numbers in config.ts
 * and reloading — no asset pipeline, no binary files, no drift between "the
 * texture we shipped" and "the texture the code makes".
 *
 * WHERE THE GENERATORS WENT
 * -------------------------
 * They are in `./surfaces.ts` now, unchanged. That file imports `./math` and
 * NOTHING ELSE — no THREE, no DOM — because `./workers/textureWorker.ts`
 * imports it and a worker chunk carrying a copy of Three.js would cost ~700 kB
 * to render nothing. This file re-exports all of it, so every existing
 * `from '.../core/assets'` import resolves exactly as it always did.
 *
 * THIS FILE OWNS: the `TextureFactory` — DataTexture construction, the keyed
 * GPU cache and its LRU eviction, the worker offload described below, canvas
 * interop, and the material-set builder.
 *
 * THE WORKER OFFLOAD
 * ------------------
 * Generating the boot set costs about 470 ms of CPU (`tools/bench-textures.mts`
 * measures it). That used to be 470 ms of MAIN-THREAD time behind the loading
 * curtain, during which the page could not paint, could not respond, and could
 * not report progress.
 *
 * `useWorkers()` installs a `TexturePool`. After that, `get()` still returns a
 * `THREE.DataTexture` SYNCHRONOUSLY — every call site is untouched — but the
 * texture starts as a flat fill of the right colour and size while a worker
 * does the real generation, and the bytes are copied in when the reply lands.
 * `settleWorkers()` resolves once every dispatched job has landed;
 * `workers/texture-warm.system.ts` awaits it as the last system init, so the
 * curtain never lifts on a placeholder.
 *
 * FOUR THINGS ABOUT THAT ARE DELIBERATE
 *
 * 1. THE SYNCHRONOUS PATH IS NOT A LEGACY PATH. With no pool installed — which
 *    is every test in this repo, `environment: 'node'` having no `Worker` —
 *    `get()` generates inline and returns finished pixels, exactly as it did
 *    before workers existed. That path stays first-class forever.
 * 2. EVERY WORKER FAILURE FALLS BACK TO IT. Unsupported platform, a spawn that
 *    throws, a script that 404s, a generator that blows up, a worker that
 *    simply stops answering — all of them resolve as "not done", and the
 *    factory generates that texture on the calling thread there and then,
 *    before `settleWorkers()` resolves. A broken worker costs boot time, never
 *    a broken boot.
 * 3. THE OFFLOAD IS BOOT-ONLY. `settleWorkers()` disposes the pool on its way
 *    out, so any texture requested during gameplay is generated inline. A
 *    texture that pops in three frames after a unit appears would be a
 *    regression; a slightly longer boot with no pop-in is not.
 * 4. ONE JOB PER MATERIAL, NOT PER CHANNEL. `textureSet()` asks for albedo,
 *    normal and orm in a single job, so the worker runs the generator once and
 *    packs three times — the same saving `surfaceCache` buys on this thread.
 * ============================================================================
 */

import * as THREE from 'three';
import { clamp, hash2f, hexToRgb, srgbToLinear } from './math';
import {
  b8, generateSurface, makeGradientData, packAlbedo, packChannel, packMask,
  packNormal, packOrm, placeholderBytes, resolveParams, surfaceKey, textureKey,
  usesStructuralNormal,
  type AnyGenParams, type Channel, type Surface, type TextureKind,
  type TextureRequest,
} from './surfaces';
import { TexturePool, type SpawnWorker } from './workers/TexturePool';

/**
 * Everything in `./surfaces.ts` is part of this module's public surface, and
 * was before the split. Re-exported rather than moved-and-updated so no
 * consumer had to change and no import in the repo went stale.
 */
export * from './surfaces';

/* ==========================================================================
 * THE FACTORY
 * ========================================================================== */

interface CacheEntry {
  texture: THREE.DataTexture;
  key: string;
  bytes: number;
  /** Frame index of the last access, for LRU eviction. */
  lastUsed: number;
}

/**
 * One mounted-but-not-yet-generated channel.
 *
 * `pixels` is the SAME buffer the DataTexture was constructed around, held
 * directly rather than read back through `texture.image.data` — which THREE
 * types as nullable, and which would be one `!` per write for no gain. Whoever
 * produces the bytes (this thread or a worker) copies into it and flips
 * `needsUpdate`; the texture object never changes identity, so a material that
 * already holds a reference simply starts sampling the real thing.
 */
interface Slot {
  readonly channel: Channel;
  readonly texture: THREE.DataTexture;
  readonly pixels: Uint8Array;
}

/** What `useWorkers` accepts beyond the spawn function itself. */
export interface WorkerOptions {
  /** Hard cap on workers. Defaults to hardware concurrency minus one, max 4. */
  readonly size?: number;
  /** Per-job hang deadline in ms. */
  readonly timeoutMs?: number;
}

/** `workerStats()` — what actually happened, for the F3 overlay and for tests. */
export interface WorkerStats {
  /** A pool is installed and has not given up. */
  enabled: boolean;
  /** Jobs handed to the pool. */
  dispatched: number;
  /** Channels whose bytes came back from a worker. */
  adopted: number;
  /** Channels the factory ended up generating itself after a pool miss. */
  fellBack: number;
  /** Why the pool gave up, or '' if it has not. */
  reason: string;
}

/**
 * THE ONLY WAY TO GET A TEXTURE.
 *
 * `get()` is synchronous and always returns a usable texture. Whether the
 * pixels were computed on this thread or in a worker is an implementation
 * detail of this class and of nothing else.
 */
export class TextureFactory {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly surfaceCache = new Map<string, Surface>();
  private clock = 0;

  /** Total bytes of GPU texture data currently held. */
  bytes = 0;
  /** Soft budget; least-recently-used textures are evicted above it. */
  budgetBytes = 192 * 1024 * 1024;
  /** Diagnostics. */
  generated = 0;
  hits = 0;

  /** Default anisotropy applied to repeating surface textures. */
  defaultAnisotropy = 8;
  /**
   * Hardware ceiling. The renderer should set this from
   * `renderer.capabilities.getMaxAnisotropy()` at boot; every request is
   * clamped to it, so asking for 16 on a device that supports 4 is safe.
   */
  maxAnisotropy = 16;

  /* -- worker offload ----------------------------------------------------- */

  private pool: TexturePool | null = null;
  /**
   * Every dispatched job, INCLUDING the fallback generation it may trigger.
   * `settleWorkers()` drains this rather than the pool's own queue: a job that
   * comes back empty still has main-thread work to do afterwards, and the
   * curtain must not lift in between.
   */
  private readonly jobs = new Set<Promise<void>>();
  private dispatched = 0;
  private adopted = 0;
  private fellBack = 0;
  /**
   * Why the pool gave up, kept AFTER the pool object is gone.
   *
   * `settleWorkers()` disposes the pool, and reading the reason off a disposed
   * pool would report every boot as a clean one — including the boot where the
   * worker never loaded and the whole set was generated inline. That is exactly
   * the sort of quietly-untrue diagnostic this repo treats as a defect.
   */
  private poolReason = '';

  /**
   * Offload generation to a worker pool until `settleWorkers()` is called.
   *
   * Safe to call with a spawn function that cannot produce a worker: the pool
   * disables itself on the first submit and every request generates inline.
   * Calling it twice is a no-op — the first pool wins.
   */
  useWorkers(spawn: SpawnWorker, options: WorkerOptions = {}): void {
    if (this.pool !== null) return;
    this.pool = new TexturePool({
      spawn,
      ...(options.size !== undefined ? { size: options.size } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      onDisabled: (reason: string) => {
        console.warn(`[textures] worker offload off (${reason}) — generating on the main thread`);
      },
    });
  }

  /**
   * Wait for every dispatched texture to hold its real pixels, then stop
   * offloading and release the workers.
   *
   * The loop re-checks rather than awaiting once: adopting one job's bytes can
   * trigger fallback generation, and a system initialising later can dispatch
   * more. This resolves only when the set is genuinely empty. It cannot hang —
   * every job carries a deadline in `TexturePool`, and a missed deadline
   * resolves the job as a fallback rather than leaving it outstanding.
   */
  async settleWorkers(): Promise<void> {
    while (this.jobs.size > 0) await Promise.all([...this.jobs]);
    if (this.pool === null) return;
    // Latch BEFORE disposing: a healthy pool reports '', and disposing one sets
    // its reason to 'disposed', which would erase a real failure.
    this.poolReason = this.pool.reason;
    this.pool.dispose();
    this.pool = null;
  }

  /** What the offload actually did. */
  workerStats(): WorkerStats {
    return {
      enabled: this.pool !== null && this.pool.enabled,
      dispatched: this.dispatched,
      adopted: this.adopted,
      fellBack: this.fellBack,
      reason: this.pool !== null ? this.pool.reason : this.poolReason,
    };
  }

  /* -- the public getters ------------------------------------------------- */

  /**
   * Get (or generate) a texture. Always returns a usable texture immediately.
   */
  get(req: TextureRequest): THREE.DataTexture {
    return this.textureSet(req, [req.channel ?? 'albedo'])[0];
  }

  /**
   * Get several channels of ONE request, sharing a single generator run.
   *
   * This is the call `materialTextureSet` makes, and it is why a material costs
   * one generator run rather than three — on this thread via `surfaceCache`,
   * and in the worker because the whole set travels as one job.
   */
  textureSet(req: TextureRequest, channels: readonly Channel[]): THREE.DataTexture[] {
    const out: THREE.DataTexture[] = [];
    /** The not-yet-generated channels, each holding the buffer to write into. */
    const wanted: Slot[] = [];

    for (const channel of channels) {
      const key = textureKey({ ...req, channel });
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        hit.lastUsed = ++this.clock;
        this.hits++;
        out.push(hit.texture);
        continue;
      }
      // Placeholder for now; filled in below on the synchronous path, or by the
      // worker reply. Size and format are final either way, so the texture
      // object handed out here is the one that stays in the cache.
      const mounted = this.mount(key, { ...req, channel });
      wanted.push(mounted);
      out.push(mounted.texture);
    }

    if (wanted.length === 0) return out;

    const pool = this.pool;
    if (pool === null || !pool.enabled) {
      this.fill(req, wanted);   // THE SYNCHRONOUS PATH — unchanged behaviour.
      return out;
    }

    this.dispatch(pool, req, wanted);
    return out;
  }

  /**
   * Get the raw generated Surface, cached independently of the packed
   * textures — so requesting albedo + normal + orm for one material runs the
   * generator ONCE, not three times.
   *
   * ALWAYS SYNCHRONOUS, and deliberately so. Its callers (`TerrainMaterial`'s
   * biome layer array) pack the float channels themselves the instant they get
   * them, so there is nothing here for a worker to hand back. Moving this one
   * is a separate change with a separate consumer edit behind it.
   */
  surface(kind: TextureKind, params: AnyGenParams): Surface {
    // Accepts a PARTIAL param set: defaults are filled here, so a caller that
    // only cares about three fields does not have to spell out twenty.
    const p = resolveParams({ kind, ...params } as TextureRequest);
    const skey = surfaceKey(kind, p);
    const hit = this.surfaceCache.get(skey);
    if (hit !== undefined) return hit;

    const s = generateSurface(kind, p);
    this.surfaceCache.set(skey, s);
    return s;
  }

  /** Bake a 1D colour ramp (fire gradient, health bar, LUT strip). */
  gradient(
    stops: readonly (readonly [number, string])[], width = 256, name = 'gradient',
  ): THREE.DataTexture {
    const key = `gradient|${name}|${width}|${stops.map((s) => s[0] + s[1]).join(',')}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) { hit.lastUsed = ++this.clock; this.hits++; return hit.texture; }

    const data = makeGradientData(stops, width);
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = key;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this.cache.set(key, { texture: tex, key, bytes: data.byteLength, lastUsed: ++this.clock });
    this.bytes += data.byteLength;
    this.generated++;
    return tex;
  }

  /**
   * A 1x1 texture of a solid colour. Used as the immediate placeholder while a
   * real texture generates, and as the flat-colour stub for unimplemented
   * archetypes.
   */
  solid(hex: string, srgb = true): THREE.DataTexture {
    const key = `solid|${hex}|${srgb}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) { hit.lastUsed = ++this.clock; this.hits++; return hit.texture; }

    hexToRgb(hex, RGB_A);
    const data = new Uint8Array([b8(RGB_A[0]), b8(RGB_A[1]), b8(RGB_A[2]), 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = key;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.cache.set(key, { texture: tex, key, bytes: 4, lastUsed: ++this.clock });
    this.bytes += 4;
    return tex;
  }

  /**
   * Drop every cached texture whose key starts with `prefix`, so an art change
   * that alters (say) the Soviet camo colours rebuilds only those textures and
   * not the other 40 MB.
   */
  invalidate(prefix: string): number {
    let n = 0;
    for (const [key, entry] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      entry.texture.dispose();
      this.bytes -= entry.bytes;
      this.cache.delete(key);
      n++;
    }
    for (const key of this.surfaceCache.keys()) {
      if (key.startsWith(prefix)) this.surfaceCache.delete(key);
    }
    return n;
  }

  /** Release everything. Between matches / on teardown. */
  dispose(): void {
    this.pool?.dispose();
    this.pool = null;
    for (const e of this.cache.values()) e.texture.dispose();
    this.cache.clear();
    this.surfaceCache.clear();
    this.bytes = 0;
  }

  /** Diagnostics for the F3 overlay. */
  stats(): { count: number; megabytes: number; generated: number; hits: number } {
    return {
      count: this.cache.size,
      megabytes: this.bytes / (1024 * 1024),
      generated: this.generated,
      hits: this.hits,
    };
  }

  /* -- internals ---------------------------------------------------------- */

  /**
   * Build the DataTexture for one channel, fill it with the placeholder, and
   * put it in the cache. The pixels are overwritten in place afterwards —
   * never the texture object — so a material that already references it sees
   * the real bytes with no reassignment and no second upload path.
   */
  private mount(key: string, req: TextureRequest): Slot {
    const pixels = placeholderBytes(req);
    const tex = new THREE.DataTexture(
      pixels.data, pixels.size, pixels.size, THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    tex.name = key;
    tex.colorSpace = pixels.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const wrap = req.tiling === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.magFilter = THREE.LinearFilter;
    // Trilinear + anisotropy is not optional. A missing mip chain turns ANY
    // fine detail into shimmering static at RTS camera distance, which reads
    // exactly like the noise the clean generator set exists to remove.
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = clamp(req.anisotropy ?? this.defaultAnisotropy, 1, this.maxAnisotropy);
    tex.needsUpdate = true;

    const bytes = pixels.data.byteLength * 4 / 3;  // + mip chain
    this.cache.set(key, { texture: tex, key, bytes, lastUsed: ++this.clock });
    this.bytes += bytes;
    this.generated++;
    this.evictIfNeeded();
    return { channel: req.channel ?? 'albedo', texture: tex, pixels: pixels.data };
  }

  /**
   * Generate the wanted channels on THIS thread and write them into their
   * mounted buffers. One generator run for the whole set, via `surfaceCache`.
   */
  private fill(req: TextureRequest, wanted: readonly Slot[]): void {
    const surface = this.surface(req.kind, req);
    const relief = resolveParams(req).relief;
    const structural = usesStructuralNormal(req);
    for (const slot of wanted) {
      slot.pixels.set(packChannel(surface, slot.channel, structural, relief).data);
      slot.texture.needsUpdate = true;
    }
  }

  /**
   * Hand one job to the pool and arrange for its bytes to land in the mounted
   * textures. Registers a promise in `jobs` that covers BOTH the worker round
   * trip and any fallback generation, so `settleWorkers()` cannot resolve while
   * a texture is still holding its placeholder.
   */
  private dispatch(pool: TexturePool, req: TextureRequest, wanted: readonly Slot[]): void {
    this.dispatched++;
    const channels = wanted.map((w) => w.channel);
    const job = pool.submit(req, channels).then((layers) => {
      if (layers === null || layers.length !== channels.length) {
        // THE FALLBACK. The pool could not serve this — unsupported platform, a
        // dead worker, a generator that threw. Generate it here and now, while
        // `settleWorkers()` is still waiting on this promise.
        this.fill(req, wanted);
        this.fellBack += wanted.length;
        return;
      }
      for (let i = 0; i < wanted.length; i++) {
        // Copy into the buffer the texture already owns rather than swapping
        // `image.data`: the texture object is referenced by a material by now,
        // and one buffer identity keeps THREE's upload bookkeeping simple.
        // ~1 MB at 512², well under a millisecond, and it happens once.
        wanted[i].pixels.set(layers[i].data);
        wanted[i].texture.needsUpdate = true;
        this.adopted++;
      }
    });
    this.jobs.add(job);
    void job.finally(() => { this.jobs.delete(job); });
  }

  /** Evict least-recently-used entries until we are under budget. */
  private evictIfNeeded(): void {
    if (this.bytes <= this.budgetBytes) return;
    const entries = Array.from(this.cache.values()).sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < entries.length && this.bytes > this.budgetBytes * 0.9; i++) {
      const e = entries[i];
      e.texture.dispose();
      this.bytes -= e.bytes;
      this.cache.delete(e.key);
    }
  }
}

/** Scratch RGB triple for this module's colour helpers. Never escapes. */
const RGB_A = new Float32Array(3);

/** The shared factory. One per process; tests may construct their own. */
export const textures = new TextureFactory();

/* ==========================================================================
 * CANVAS INTEROP
 *
 * The generators deliberately avoid canvas 2D (its antialiasing differs
 * between engines, which would break screenshot diffing). Canvas is used only
 * where the OUTPUT must be a DOM image: HUD panel backgrounds injected into
 * CSS as data URLs.
 * ========================================================================== */

/** OffscreenCanvas where available, else a DOM canvas, else null (headless). */
export function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    return c;
  }
  return null;
}

/**
 * Render a Surface's packed albedo into a canvas and return a data URL, for
 * the CSS layer of the HUD. Returns an empty string in a headless context.
 */
export function surfaceToDataUrl(s: Surface, channel: Channel = 'albedo'): string {
  const canvas = createCanvas(s.size, s.size);
  if (canvas === null) return '';
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx === null) return '';

  const data = channel === 'normal' ? packNormal(s)
    : channel === 'orm' ? packOrm(s)
    : channel === 'mask' ? packMask(s)
    : packAlbedo(s);
  // packAlbedo puts the team mask in alpha; for a DOM image we want opaque.
  const rgba = new Uint8ClampedArray(data.length);
  rgba.set(data);
  if (channel === 'albedo' || channel === 'normal' || channel === 'orm') {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }
  ctx.putImageData(new ImageData(rgba, s.size, s.size), 0, 0);

  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }
  return '';
}

/** Wrap an existing canvas as a THREE texture (cameo baking, HUD atlases). */
export function textureFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas, srgb = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * CONVENIENCE BUILDERS
 *
 * The three-texture set a PBR material actually needs, generated from ONE
 * surface pass. This is the call a material factory makes.
 * ========================================================================== */

export interface MaterialTextures {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  ormMap: THREE.DataTexture;
}

/** The channels a standard PBR material needs, in a fixed order. */
const PBR_CHANNELS: readonly Channel[] = ['albedo', 'normal', 'orm'];

/**
 * Albedo + normal + ORM for one surface request, sharing one generation.
 *
 * One `textureSet` call rather than three `get` calls: same result, but the
 * three channels travel to the worker as a single job, so the generator runs
 * once there too.
 */
export function materialTextureSet(
  factory: TextureFactory, req: TextureRequest,
): MaterialTextures {
  const [map, normalMap, ormMap] = factory.textureSet(req, PBR_CHANNELS);
  return { map, normalMap, ormMap };
}

/**
 * Linear-space RGB triple for a hex colour, for direct upload into a uniform.
 * Allocates — call at material construction, never per frame.
 */
export function linearColorTriple(hex: string): [number, number, number] {
  hexToRgb(hex, RGB_A);
  return [srgbToLinear(RGB_A[0]), srgbToLinear(RGB_A[1]), srgbToLinear(RGB_A[2])];
}

/** Deterministic per-instance variation seed from an entity seed. */
export function instanceSeed(entitySeed: number, salt: number): number {
  return hash2f((entitySeed * 65536) | 0, salt);
}
