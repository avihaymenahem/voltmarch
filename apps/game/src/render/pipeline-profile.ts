/** Opt-in attribution for Three's mixed WebGPU `compileAsync()` phase. */

interface RenderObjectLike {
  readonly material?: { readonly name?: string; readonly type?: string };
}

interface NodeManagerLike {
  getForRenderAsync(renderObject: RenderObjectLike): Promise<unknown>;
  getForRenderCacheKey?(renderObject: RenderObjectLike): unknown;
  get?(renderObject: RenderObjectLike): { nodeBuilderState?: unknown };
  readonly nodeBuilderCache?: Map<unknown, unknown>;
}

interface PipelineManagerLike {
  getForRender(renderObject: RenderObjectLike, promises?: Promise<unknown>[] | null): unknown;
  readonly caches: Map<unknown, unknown>;
  readonly programs: {
    readonly vertex: Map<unknown, unknown>;
    readonly fragment: Map<unknown, unknown>;
  };
}

interface RendererInternals {
  readonly _nodes?: NodeManagerLike;
  readonly _pipelines?: PipelineManagerLike;
}

interface MutableFamily {
  nodeCalls: number;
  nodeCacheHits: number;
  newPipelines: number;
  gpuPromises: number;
  nodeWallMs: number;
  gpuPromiseWallMs: number;
}

export interface PipelineCompileAttribution {
  readonly enabled: boolean;
  readonly supported: boolean;
  readonly nodeCalls: number;
  readonly nodeCacheHits: number;
  readonly nodeCacheMisses: number;
  readonly nodeWallMs: number;
  readonly pipelineCalls: number;
  readonly newPipelines: number;
  readonly newVertexPrograms: number;
  readonly newFragmentPrograms: number;
  readonly gpuPromises: number;
  /** Sum of promise lifetimes; this is deliberately not reported as end-to-end wall time. */
  readonly gpuPromiseWallMs: number;
  readonly gpuPromiseMaxMs: number;
  readonly topFamilies: string;
}

export interface PipelineCompileObserver {
  finish(): PipelineCompileAttribution;
}

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

export function pipelineProfileRequested(): boolean {
  if (typeof location === 'undefined') return false;
  const raw = new URLSearchParams(location.search).get('pipelineprofile');
  return raw === '1' || raw === 'true' || raw === '';
}

function familyOf(renderObject: RenderObjectLike): string {
  const material = renderObject.material;
  return (material?.name || material?.type || 'unnamed').slice(0, 80);
}

function empty(enabled: boolean, supported: boolean): PipelineCompileAttribution {
  return {
    enabled, supported,
    nodeCalls: 0, nodeCacheHits: 0, nodeCacheMisses: 0, nodeWallMs: 0,
    pipelineCalls: 0, newPipelines: 0, newVertexPrograms: 0, newFragmentPrograms: 0,
    gpuPromises: 0, gpuPromiseWallMs: 0, gpuPromiseMaxMs: 0, topFamilies: '',
  };
}

/**
 * Patch only the two already-created private managers for one compile call.
 * The observer is inert unless explicitly requested, restores exact function
 * identities, and never changes scheduling, shader code or cache keys.
 */
export function observePipelineCompile(
  renderer: object,
  enabled = pipelineProfileRequested(),
): PipelineCompileObserver {
  if (!enabled) return { finish: () => empty(false, false) };

  const internals = renderer as RendererInternals;
  const nodes = internals._nodes;
  const pipelines = internals._pipelines;
  if (
    nodes === undefined
    || pipelines === undefined
    || typeof nodes.getForRenderAsync !== 'function'
    || typeof pipelines.getForRender !== 'function'
    || !(pipelines.caches instanceof Map)
    || !(pipelines.programs?.vertex instanceof Map)
    || !(pipelines.programs?.fragment instanceof Map)
  ) return { finish: () => empty(true, false) };

  const families = new Map<string, MutableFamily>();
  const family = (renderObject: RenderObjectLike): MutableFamily => {
    const key = familyOf(renderObject);
    let value = families.get(key);
    if (value === undefined) {
      value = {
        nodeCalls: 0, nodeCacheHits: 0, newPipelines: 0, gpuPromises: 0,
        nodeWallMs: 0, gpuPromiseWallMs: 0,
      };
      families.set(key, value);
    }
    return value;
  };

  let nodeCalls = 0;
  let nodeCacheHits = 0;
  let nodeWallMs = 0;
  let pipelineCalls = 0;
  let newPipelines = 0;
  let newVertexPrograms = 0;
  let newFragmentPrograms = 0;
  let gpuPromises = 0;
  let gpuPromiseWallMs = 0;
  let gpuPromiseMaxMs = 0;
  let finished = false;

  const originalNode = nodes.getForRenderAsync;
  const originalPipeline = pipelines.getForRender;

  nodes.getForRenderAsync = function profiledNode(renderObject) {
    const row = family(renderObject);
    const objectData = typeof this.get === 'function' ? this.get(renderObject) : undefined;
    let cacheHit = objectData?.nodeBuilderState !== undefined;
    if (!cacheHit && typeof this.getForRenderCacheKey === 'function'
      && this.nodeBuilderCache instanceof Map) {
      cacheHit = this.nodeBuilderCache.has(this.getForRenderCacheKey(renderObject));
    }
    nodeCalls++;
    row.nodeCalls++;
    if (cacheHit) {
      nodeCacheHits++;
      row.nodeCacheHits++;
    }
    const started = now();
    return Promise.resolve(originalNode.call(this, renderObject)).finally(() => {
      const elapsed = now() - started;
      nodeWallMs += elapsed;
      row.nodeWallMs += elapsed;
    });
  };

  pipelines.getForRender = function profiledPipeline(renderObject, promises = null) {
    pipelineCalls++;
    const row = family(renderObject);
    const pipelineCount = this.caches.size;
    const vertexCount = this.programs.vertex.size;
    const fragmentCount = this.programs.fragment.size;
    const promiseStart = promises?.length ?? 0;
    const result = originalPipeline.call(this, renderObject, promises);
    const pipelineDelta = Math.max(0, this.caches.size - pipelineCount);
    newPipelines += pipelineDelta;
    row.newPipelines += pipelineDelta;
    newVertexPrograms += Math.max(0, this.programs.vertex.size - vertexCount);
    newFragmentPrograms += Math.max(0, this.programs.fragment.size - fragmentCount);

    if (promises !== null) {
      for (let index = promiseStart; index < promises.length; index++) {
        const started = now();
        gpuPromises++;
        row.gpuPromises++;
        promises[index] = Promise.resolve(promises[index]).finally(() => {
          const elapsed = now() - started;
          gpuPromiseWallMs += elapsed;
          row.gpuPromiseWallMs += elapsed;
          gpuPromiseMaxMs = Math.max(gpuPromiseMaxMs, elapsed);
        });
      }
    }
    return result;
  };

  return {
    finish(): PipelineCompileAttribution {
      if (!finished) {
        finished = true;
        nodes.getForRenderAsync = originalNode;
        pipelines.getForRender = originalPipeline;
      }
      const topFamilies = [...families.entries()]
        .sort((a, b) => (b[1].nodeWallMs + b[1].gpuPromiseWallMs)
          - (a[1].nodeWallMs + a[1].gpuPromiseWallMs))
        .slice(0, 6)
        .map(([name, value]) => `${name}:${value.nodeCalls}/${value.newPipelines}`)
        .join(',');
      return {
        enabled: true,
        supported: true,
        nodeCalls,
        nodeCacheHits,
        nodeCacheMisses: nodeCalls - nodeCacheHits,
        nodeWallMs,
        pipelineCalls,
        newPipelines,
        newVertexPrograms,
        newFragmentPrograms,
        gpuPromises,
        gpuPromiseWallMs,
        gpuPromiseMaxMs,
        topFamilies,
      };
    },
  };
}
