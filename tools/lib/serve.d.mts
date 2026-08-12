/**
 * ============================================================================
 * tools/lib/serve.d.mts — the typed surface of the shared server harness
 * ============================================================================
 *
 * `serve.mjs` is plain JavaScript, like every other file under `tools/`, and it
 * stays that way: these tools are run with bare `node`, with no build step
 * between editing one and using it, which is most of why they get used at all.
 *
 * This file exists for ONE import. `tests/shot-camera.spec.ts` calls `stripAnsi`
 * directly, because that function is where the port fix was silently inert —
 * the old strip removed the CSI body and left the ESC byte, vite bolds the port
 * digits inside the URL it prints, and the URL regex therefore returned null on
 * every rung of the port ladder. A grep over the source cannot catch that; only
 * running the function can. So the spec runs it, and `tsconfig.test.json` needs
 * a declaration to let it.
 *
 * Only the members `tests/` actually imports are declared. The rest of the
 * module's surface is documented in `serve.mjs` itself, and adding a type here
 * for something no test imports would be a second description of one thing.
 * ============================================================================
 */

/**
 * Remove every ANSI escape sequence from `s`, INCLUDING the ESC byte.
 *
 * The whole sequence, not just the bracketed body: `/\[[0-9;]*m/g` leaves a
 * bare `` behind, which is invisible in a terminal and fatal to a regex.
 */
export declare function stripAnsi(s: string): string;
