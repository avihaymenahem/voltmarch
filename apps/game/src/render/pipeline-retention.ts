/**
 * Process-lifetime WebGPU shader/pipeline retention.
 *
 * Three's common renderer reference-counts programmable stages and render
 * pipelines. Disposing the last material/render object removes both caches,
 * even when the WebGPURenderer and GPUDevice deliberately survive into the
 * next match. VOLTMARCH tears down every world between matches, so the default
 * policy turns a clean resource teardown into a full shader recompile.
 *
 * We pin three@0.185.1 and retain only these two bounded caches. Textures,
 * geometries, bind groups, scene objects and materials still dispose normally.
 * A later object with the same generated WGSL and render-state key adopts the
 * existing GPU pipeline; a new MSAA/shadow/format variant compiles once and is
 * then retained beside it.
 *
 * `_pipelines` and the two release methods are private-by-convention Three.js
 * seams. `installPersistentPipelineCache` therefore validates their complete
 * shape and refuses loudly when an upgrade moves them instead of pretending the
 * optimization still works.
 */

interface PipelineManagerLike {
  caches: Map<unknown, unknown>;
  programs: {
    vertex: Map<unknown, unknown>;
    fragment: Map<unknown, unknown>;
    compute: Map<unknown, unknown>;
  };
  _releasePipeline(pipeline: unknown): void;
  _releaseProgram(program: unknown): void;
}

interface RendererWithPipelines {
  _pipelines?: PipelineManagerLike;
}

const installed = new WeakSet<object>();
const battlefieldWarm = new WeakSet<object>();

function managerOf(renderer: object): PipelineManagerLike | null {
  const manager = (renderer as RendererWithPipelines)._pipelines;
  if (
    manager === undefined
    || !(manager.caches instanceof Map)
    || !(manager.programs?.vertex instanceof Map)
    || !(manager.programs?.fragment instanceof Map)
    || !(manager.programs?.compute instanceof Map)
    || typeof manager._releasePipeline !== 'function'
    || typeof manager._releaseProgram !== 'function'
  ) return null;
  return manager;
}

/** Install once on the process-lifetime WebGPURenderer. */
export function installPersistentPipelineCache(renderer: object): boolean {
  if (installed.has(renderer)) return true;
  const manager = managerOf(renderer);
  if (manager === null) return false;

  // Keep cache entries at usedTimes=0. Three increments them again when a new
  // RenderObject adopts the same key, so reference accounting resumes normally.
  manager._releasePipeline = () => {};
  manager._releaseProgram = () => {};
  installed.add(renderer);
  return true;
}

export interface PipelineCacheStats {
  readonly retained: boolean;
  readonly battlefieldWarm: boolean;
  readonly pipelines: number;
  readonly vertexPrograms: number;
  readonly fragmentPrograms: number;
  readonly computePrograms: number;
}

/** Cheap diagnostics used by the boot log and tests. */
export function pipelineCacheStats(renderer: object): PipelineCacheStats {
  const manager = managerOf(renderer);
  return {
    retained: installed.has(renderer),
    battlefieldWarm: battlefieldWarm.has(renderer),
    pipelines: manager?.caches.size ?? 0,
    vertexPrograms: manager?.programs.vertex.size ?? 0,
    fragmentPrograms: manager?.programs.fragment.size ?? 0,
    computePrograms: manager?.programs.compute.size ?? 0,
  };
}

/** Called only after the full battlefield compile resolves successfully. */
export function markBattlefieldPipelinesWarm(renderer: object): void {
  battlefieldWarm.add(renderer);
}
