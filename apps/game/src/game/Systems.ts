/**
 * System auto-discovery.
 *
 * Eighteen modules are built in parallel by separate agents. If they all had to
 * add a line to one registration file, that file would be the single merge
 * conflict in an otherwise conflict-free design. So instead:
 *
 *   **A module is registered by existing.** Drop a file named `*.system.ts`
 *   anywhere under `src/` that default-exports a `SystemModule`, and it joins
 *   the frame. Nothing else to edit.
 *
 * The glob is `../ ** /*.system.ts` (spaces added here so this comment does not
 * close itself). The `.system.ts` suffix rather than a bare `system.ts` matters:
 * several modules share a folder — three live in `src/world/`, five in
 * `src/sim/` — and a `*​/system.ts` pattern would silently register only one per
 * directory. A system that is never registered and never warns is the worst
 * failure mode available here, so discovery is loud: every id is logged at boot,
 * and a file that exports the wrong shape is reported by name.
 *
 * Ordering never depends on discovery order — `SystemRegistry` sorts by
 * `phase`, then `order`, then registration sequence, and this module registers
 * in sorted-path order so that final tie-break is deterministic across machines.
 */

import type { SystemModule } from '../core/types';
import type { SystemRegistry } from '../core/loop';

/** Vite inlines this at build time; the value is a path -> module record. */
const discovered = import.meta.glob<Record<string, unknown>>('../**/*.system.ts', {
  eager: true,
});

export interface DiscoveryResult {
  registered: string[];
  skipped: { path: string; reason: string }[];
}

function isSystemModule(v: unknown): v is SystemModule {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Partial<SystemModule>;
  if (typeof m.id !== 'string' || m.id.length === 0) return false;
  // A module with none of the three hooks does nothing; that is a mistake worth
  // reporting rather than silently registering a no-op.
  return typeof m.init === 'function' || typeof m.simTick === 'function' || typeof m.frame === 'function';
}

/**
 * Register every discovered system. Returns what landed and what did not, so
 * Bootstrap can log it and the screenshot harness can assert against it.
 *
 * A module that throws while being registered is skipped, not fatal: half a
 * game that renders is far more useful to the visual critics than a stack trace.
 */
export function registerDiscoveredSystems(registry: SystemRegistry): DiscoveryResult {
  const result: DiscoveryResult = { registered: [], skipped: [] };
  const seen = new Map<string, string>();

  for (const path of Object.keys(discovered).sort()) {
    const mod = discovered[path];
    const candidate = mod?.default;

    if (candidate === undefined) {
      result.skipped.push({ path, reason: 'no default export' });
      continue;
    }
    if (!isSystemModule(candidate)) {
      result.skipped.push({
        path,
        reason: 'default export is not a SystemModule (needs a string `id` and at least one of init/simTick/frame)',
      });
      continue;
    }

    const previous = seen.get(candidate.id);
    if (previous !== undefined) {
      // Two modules claiming one id would make the profiler and the
      // write-ownership assert lie about which code is running.
      result.skipped.push({ path, reason: `duplicate system id "${candidate.id}", already claimed by ${previous}` });
      continue;
    }

    try {
      registry.add(candidate);
      seen.set(candidate.id, path);
      result.registered.push(candidate.id);
    } catch (err) {
      result.skipped.push({ path, reason: `registry.add threw: ${String(err)}` });
    }
  }

  return result;
}

/** One line at boot, so a missing module is obvious immediately. */
export function logDiscovery(result: DiscoveryResult): void {
  console.info(
    `%c[systems]%c ${result.registered.length} registered: ${result.registered.join(', ') || '(none)'}`,
    'color:#7fd', 'color:inherit',
  );
  for (const s of result.skipped) {
    console.warn(`[systems] skipped ${s.path}: ${s.reason}`);
  }
}
