/**
 * ============================================================================
 * VOLTMARCH desktop — src/flags.ts
 * ============================================================================
 * WHICH CHROMIUM SWITCHES GET APPENDED, AND WHY EACH ONE EARNED ITS PLACE.
 *
 * Imports nothing from electron. `main.ts` calls `switchesFor(settings)` and
 * appends the result; every judgement about WHAT to append is here, where a
 * test can see it without an Electron binary. See the Electron plan §7.
 *
 * ----------------------------------------------------------------------------
 * THE ASK WAS "EVERY FLAG WE MIGHT NEED, ON BY DEFAULT". THE ANSWER IS THREE.
 * ----------------------------------------------------------------------------
 * Measured 2026-08-17 (RENDER_FINDINGS.md §7j), on the RTX 3080 laptop:
 *
 *     control          amd / gcn-5        <- reproduced twice
 *     hyphen only      nvidia / ampere
 *     underscore only  nvidia / ampere
 *
 * So the GPU switch works, EITHER SPELLING WORKS ALONE, and one switch moves
 * both WebGL and WebGPU. Both are appended anyway: they are different layers
 * (`gpu/config/gpu_switches.cc` vs `gpu_workaround_list.txt`), the browser
 * process translates the first into the second, and passing both costs nothing
 * while insuring against either layer changing.
 *
 * TWO TEMPTING FLAGS ARE DELIBERATELY ABSENT AND MUST STAY ABSENT BY DEFAULT:
 *
 *   `--disable-frame-rate-limit` (which IMPLIES `--disable-gpu-vsync`, so
 *   never pass both) breaks `HardwareCalibration`. `CALIBRATION.flatSlopeMs`
 *   is 1.0 and a fitted slope below it returns 'not-fill-rate-bound' and cuts
 *   nothing — CLAUDE.md calls that "the property that makes it safe to ship on
 *   hardware nobody here owns". Disabling vsync removes the vsync-flat case BY
 *   CONSTRUCTION: a previously flat machine fits a real positive slope, the
 *   guard stops firing, and first-run calibration starts cutting resolution on
 *   hardware that was fine — permanently, since `graphics.calibrated` is
 *   sticky. That is one flag with one measured consequence.
 *
 *   `--ignore-gpu-blocklist` converts "safe software fallback" into "possible
 *   driver crash" on exactly the driver combinations Chromium blocked because
 *   they crash.
 *
 * Both are offered as opt-in troubleshooting toggles instead. Neither is a
 * default, and `--enable-zero-copy` is not here at all because it is not a
 * Chromium switch — zero-copy raster is already the default and only the
 * disable side exists.
 * ============================================================================
 *
 * THE REST OF THE SWITCH RESEARCH, folded in when the Electron plan was deleted.
 *
 * DO NOT SHIP, each for a stated reason: `--in-process-gpu` removes the GPU sandbox and turns
 * this project's carefully-handled device-loss path into a hard process exit.
 * `--use-angle=<anything>` — the default is already d3d11, and `d3d9` no longer exists; keep it
 * as a support escape hatch, never a default. `--disable-gpu-vsync` is implied by
 * `--disable-frame-rate-limit`, so passing both is redundant. `--enable-unsafe-webgpu` — WebGPU
 * is stable, so this only opens non-stable surface. `--enable-features=Vulkan` on Windows,
 * `--no-sandbox` and `--disable-gpu-watchdog`: no.
 *
 * And three traps that show up in every "fix Electron GPU" thread. Renaming the executable to
 * match an NVIDIA driver profile does nothing — the profile is consulted only for the DEFAULT
 * adapter, while ANGLE selects by explicit device id — and it is indistinguishable from malware
 * to a security product. Repeated `appendSwitch('enable-features', …)` calls **replace** rather
 * than concatenate. And Electron has no `chrome://flags`, so anything a player "fixed with a
 * flag in Chrome" has to be re-expressed as a switch in the main process; there is nowhere for
 * them to toggle it.
 */

/** What the user has chosen. Persisted next to the app, read BEFORE app ready. */
export interface DesktopSettings {
  /**
   * Force the discrete GPU. Default ON — it is the reason this wrapper exists.
   *
   * A SETTING rather than a hard-coded switch, and the reason is timing, not
   * caution: Chromium switches must be appended before `app.whenReady()`, so
   * this decision is taken before any window, renderer or settings screen
   * exists. If a hard-coded switch ever bricks the boot on somebody's machine
   * there is no in-app route back — only editing a file by hand, which is the
   * exact ergonomic this feature exists to escape. `--vm-safe-mode` is the
   * other half of that: it ignores this file entirely.
   */
  forceHighPerformanceGpu: boolean;
  /** Opt-in. See the header — this one has a measured cost. */
  unlockFrameRate: boolean;
  /** Opt-in troubleshooting only. */
  ignoreGpuBlocklist: boolean;
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  forceHighPerformanceGpu: true,
  unlockFrameRate: false,
  ignoreGpuBlocklist: false,
};

/**
 * Normalise an untrusted blob (a hand-edited JSON file) into settings.
 *
 * Every unknown or malformed field falls back to the default rather than
 * throwing: this is read before a window exists, so an exception here is a
 * silent failure to launch with no way to report it.
 */
export function normaliseSettings(raw: unknown): DesktopSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof DesktopSettings): boolean =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_SETTINGS[k];
  return {
    forceHighPerformanceGpu: bool('forceHighPerformanceGpu'),
    unlockFrameRate: bool('unlockFrameRate'),
    ignoreGpuBlocklist: bool('ignoreGpuBlocklist'),
  };
}

/**
 * The ordered switch list. Each entry is `[name]` or `[name, value]`.
 *
 * ALWAYS-ON, regardless of settings:
 *   `disable-renderer-backgrounding` — with `backgroundThrottling: false` on
 *   the window, this is the fix for a LIVE multiplayer bug. `loop.ts` drives on
 *   rAF, Chromium calls rAF ZERO times for a hidden document, the lockstep step
 *   gate "stalls, never skips", and `sampleStall()` only raises a HUD
 *   indicator with no timeout. So one player minimising freezes the match for
 *   BOTH, indefinitely. There is no web-side fix, which is why it is not a
 *   setting.
 *
 * `disable-backgrounding-occluded-windows` is deliberately NOT here: Chromium
 * names that constant `kDisableBackgroundingOccludedWindowsForTesting`, and
 * shipping a ForTesting switch by default is a different risk class.
 * `backgroundThrottling: false` is the product-facing mechanism and it covers
 * occluded and minimised windows on Windows.
 */
export interface ChromiumSwitch {
  readonly name: string;
  /** Omitted for a bare switch. Present only where Chromium expects `--x=y`. */
  readonly value?: string;
}

export function switchesFor(settings: DesktopSettings): readonly ChromiumSwitch[] {
  const out: ChromiumSwitch[] = [{ name: 'disable-renderer-backgrounding' }];

  if (settings.forceHighPerformanceGpu) {
    out.push({ name: 'force-high-performance-gpu' }); // browser-process switch
    out.push({ name: 'force_high_performance_gpu' }); // GPU driver-bug-workaround name
  }
  // Implies --disable-gpu-vsync; passing both would be redundant.
  if (settings.unlockFrameRate) out.push({ name: 'disable-frame-rate-limit' });
  if (settings.ignoreGpuBlocklist) out.push({ name: 'ignore-gpu-blocklist' });

  return out;
}

/**
 * True when the process was launched with the safe-mode escape hatch.
 *
 * Deliberately parsed from argv rather than from the settings file, because
 * its whole purpose is to be reachable when the settings file is what broke
 * the boot.
 */
export function safeModeRequested(argv: readonly string[]): boolean {
  return argv.includes('--vm-safe-mode');
}
