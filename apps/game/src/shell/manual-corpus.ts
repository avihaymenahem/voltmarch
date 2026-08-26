/**
 * ============================================================================
 * src/shell/manual-corpus.ts — 345 KiB of wiki, and nobody pays for it at boot
 * ============================================================================
 * THIS MODULE MUST NEVER BE IMPORTED STATICALLY. It exists to be the target of
 * exactly one `await import('./manual-corpus')`, in `Manual.ts`, taken the
 * first time somebody opens the Manual tab.
 *
 * The reasoning is `src/render/gpu-path.ts`'s, applied to text instead of
 * shaders. `wiki/` is 19 files and 345 KiB of markdown; the entry chunk is
 * 2.71 MB and every player downloads it whether or not they ever read a word of
 * documentation. Statically importing this file would put the whole manual in
 * that chunk — an 11% regression on the thing that gates first paint, paid by
 * everyone, to serve a screen most sessions never open.
 *
 * With the import dynamic, Rollup emits this module and the seventeen `?raw`
 * strings it pulls in as ONE separate chunk (each markdown module has exactly
 * one importer — this file — so they merge into it rather than splitting
 * seventeen ways), and a boot that never reaches Options never fetches it.
 * `tests/manual.spec.ts` pins both halves: the source invariant, which is
 * always checkable, and the emitted chunks when `dist/` happens to be current.
 *
 * WHY `eager: true` INSIDE A LAZY IMPORT
 * --------------------------------------
 * The two arrangements cost the entry chunk exactly nothing either way. A lazy
 * glob would emit seventeen chunks and turn opening the manual into seventeen
 * round trips, and the page rail — which shows every page's real title, read
 * out of its own `#` heading — would have to fetch all of them anyway to draw
 * itself. One chunk, one request, one parse.
 *
 * THE GLOB REACHES OUTSIDE `src/`, ON PURPOSE
 * -------------------------------------------
 * `wiki/` is a sibling of `src/` under the Vite root, and it is the SAME
 * directory the GitHub wiki is published from. There is no copy in `public/`
 * and there must not be one: two copies of the player documentation is the
 * `docs/SPEC_DRIFT_AUDIT.md` defect in its purest form, and a `fetch` out of
 * `public/` would also break the `file://` case that `base: './'` in
 * `vite.config.ts` exists to keep working.
 * ============================================================================
 */

/**
 * Every wiki page, raw. Keys are the absolute-ish module ids Vite hands back
 * (`/wiki/Home.md`), which is why `slugOf` below does not trust their shape
 * beyond the basename.
 */
const SOURCES: Record<string, string> = import.meta.glob('../../../../wiki/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface ManualSource {
  /**
   * The page's wiki address — `Base-Building`, `Home`. This is the filename
   * without `.md`, and it is exactly the tail of a
   * `/avihaymenahem/voltmarch/wiki/<Page>` link, which is what makes internal
   * navigation a dictionary lookup rather than a rewrite table.
   */
  readonly slug: string;
  readonly markdown: string;
}

/** `../../wiki/Base-Building.md` -> `Base-Building`. */
function slugOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/**
 * The corpus, in filename order.
 *
 * Reading order is decided by `Manual.ts` from the front page's own contents
 * table — this function only guarantees that every file present is returned,
 * so a page added to `wiki/` appears in the game without anybody editing a
 * list. Same rule as `src/game/Systems.ts`: a module joins by existing.
 */
export function manualSources(): ManualSource[] {
  return Object.keys(SOURCES)
    .sort()
    .map((path) => ({ slug: slugOf(path), markdown: SOURCES[path] }));
}
