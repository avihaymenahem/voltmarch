/**
 * Domain-owned config slice: camera presentation and navigation.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 3. CAMERA
 *
 * The pitch is FIXED. A fixed pitch is why the shadow cascades can be fitted
 * cheaply and correctly, and why every model only has to read from one angle.
 * ========================================================================== */

export const CAMERA = {
  /** Degrees below horizontal. 52 is the RA2 "angled near-top-down" read. */
  pitchDeg: 52,
  /** Vertical field of view in degrees. Narrow keeps the perspective honest. */
  fovDeg: 36,
  /** Absolute dolly floor for authored shots and camera tooling. */
  minDistance: 30,
  /** Closest distance reachable through player zoom controls. */
  gameplayMinDistance: 36,
  /** Furthest dolly distance in metres. */
  maxDistance: 140,
  /**
   * Default distance. At 55 m a 2.25 m tank reads ~68 px tall at 1080p —
   * that is the resolution the silhouette test is run at.
   */
  defaultDistance: 55,
  /** Metres/sec of WASD pan at the default zoom (scales with distance). */
  panSpeed: 48,
  /**
   * Screen-edge band in pixels that triggers edge panning. **ZERO = OFF, and
   * off is the shipping default.**
   *
   * Edge scrolling is the single most-complained-about control scheme on a
   * laptop: the pointer is a trackpad, the cursor drifts to an edge every time
   * the player reaches for the sidebar or the tactical map, and the camera
   * runs away on its own. It is still available — Options > Controls turns it
   * back on and `SettingsScreen` writes `RENDER_CONFIG.camera.edgePanPixels`
   * directly — but nobody has to discover the toggle to stop it happening.
   *
   * `src/input/Input.ts#edgeDirection` reads THIS constant (not the live
   * render config) to decide whether to paint the eight scroll-arrow cursors,
   * so zero here also removes the affordance for a feature that is off.
   */
  edgePanPixels: 0,
  /** Edge pan speed multiplier relative to keyboard pan. */
  edgePanScale: 1.0,
  /**
   * MULTIPLIER applied to the dolly distance per wheel notch. >1 pulls back.
   *
   * This was 0.12 and documented as "fraction of the remaining distance", but
   * `CameraRig.zoomBy` has always computed `distance * pow(zoomStep, notches)`
   * and `ArtBridge.cameraPatch()` pushes this number straight into
   * `RENDER_CONFIG.camera.zoomStep` at boot. 0.12 therefore multiplied the
   * distance by 0.12 on a single notch — every wheel event slammed the camera
   * onto `minDistance` or `maxDistance` with nothing in between. 1.14 is ~13%
   * per notch, which is about ten notches across the playable 36..140 m range.
   */
  zoomStep: 1.14,
  /** Critically-damped spring half-life in seconds for pan/zoom smoothing. */
  smoothing: 0.08,
  /**
   * DEGREES/sec of Q/E yaw rotation.
   *
   * Also previously wrong in the same way as `zoomStep`: this was 1.4 and
   * commented "radians/sec", but the rig does `degToRad(cfg.yawSpeed)` on the
   * value ArtBridge copies here, so Q/E turned at 1.4 deg/s — a full circle in
   * four minutes, which reads as "the rotate keys do nothing".
   */
  yawSpeed: 80,
  /** Near/far planes. Tight near plane keeps depth precision for SSAO. */
  near: 1.0,
  far: 900,
  /** Metres of margin outside the map the camera may pan to. */
  panMargin: 24,
} as const;

/* --------------------------------------------------------------------------
 * 3b. CAMERA NAVIGATION — the pointer/trackpad control scheme
 *
 * `CAMERA` above is the RIG (where the camera is and how it moves). This block
 * is the INPUT SCHEME (how a human asks it to move). It lives in core/config
 * for the same reason everything else does — one place to retune feel — and
 * `src/render/camera.ts` seeds `DEFAULT_NAVIGATION` from it.
 *
 * The whole block exists because the game is played on laptops. A MacBook has
 * no wheel and no middle button: the only pointing device is a trackpad that
 * emits `wheel` events for a two-finger swipe and `wheel` events with
 * `ctrlKey: true` for a pinch. Binding `wheel` to zoom — which is what a
 * desktop RTS does — turns the most natural pan gesture on the machine into a
 * zoom, and leaves pinch doing nothing at all.
 * -------------------------------------------------------------------------- */

export const CAMERA_NAV = {
  /* -- wheel / trackpad --------------------------------------------------- */

  /**
   * Multiplier on a two-finger trackpad pan. 1.0 is "the ground tracks the
   * fingers": one CSS pixel of scroll moves the ground one CSS pixel.
   */
  trackpadPanSensitivity: 1.0,
  /** Multiplier on a real mouse wheel's zoom notches. */
  wheelZoomSensitivity: 1.0,
  /**
   * Notches of zoom per unit of `deltaY` on a macOS pinch (`wheel` with
   * `ctrlKey`). Pinch deltas are an order of magnitude smaller than a wheel
   * notch — a slow pinch emits 1-3 per event against a wheel's 100 — so this
   * is deliberately ~30x the plain-wheel scale.
   */
  pinchZoomSensitivity: 0.035,
  /**
   * Notches of zoom per 100 px of a TRACKPAD two-finger scroll, when
   * `trackpadScroll` is `'zoom'` (the shipping default — see the block below
   * `NavigationOptions.trackpadScroll` in `src/render/camera.ts`).
   *
   * IT IS 1.0, WHICH IS `wheelZoomSensitivity` EXACTLY, AND THE EQUALITY IS
   * LOAD-BEARING RATHER THAN LAZY. `wheelZoom` normalises by /100 before this
   * multiplies, so a 10 px trackpad sample is already a tenth of a notch
   * against a 100 px detent's whole one. With the two constants equal, the
   * device verdict decides NOTHING about a vertical scroll — the same gesture
   * dollies by the same amount whether `classifyWheelEvent` called it a mouse
   * or a trackpad. That is what makes the classifier's one known permanent
   * failure (an axis-locked integer flick of |deltaY| >= 50 saturates to
   * `mouse` and never recovers; see `wheelEvidence`) cost nothing at all.
   * `tests/camera-nav.spec.ts` pins the equality with that consequence in its
   * failure message.
   *
   * DERIVED, NOT MEASURED ON A MAC — nobody here has one. The dolly is
   * ln(140/36)/ln(1.14) = 10.365 notches end to end. A comfortable macOS swipe
   * including the inertia tail is 300-800 px, which at 1.0 is 3-8 notches, i.e.
   * a third to two thirds of the range per gesture, and `maxNotchesPerEvent`
   * (3) catches a coalesced flick. The tail alone (~130 px of decaying events
   * after the fingers lift) is 1.3 notches, x1.19 of distance — a coast, not a
   * lurch. This is the ONE number in the trackpad-zoom change that a real Mac
   * could move, which is why Options' Zoom Sensitivity slider (0.25-3x)
   * multiplies it: a player can correct a 3x error without a build.
   *
   * DO NOT reuse `pinchZoomSensitivity` here. It is 0.035 PER PIXEL, sized for
   * pinch deltas of 0.5-3; against a 130 px scroll tail it is 4.5 notches,
   * which is more than the whole 55 -> 36 m span arriving after the player stopped
   * moving.
   */
  trackpadZoomSensitivity: 1.0,
  /** Hard clamp on notches applied by any single wheel event. */
  maxNotchesPerEvent: 3,

  /* -- trackpad detection -------------------------------------------------
   * See `classifyWheelEvent` in src/render/camera.ts for how these combine.
   * The heuristic is a running score, not a per-event verdict, because a
   * trackpad fling and a wheel notch can look identical for one event.
   * ---------------------------------------------------------------------- */

  /** Milliseconds between wheel events below which the stream reads as a
   *  trackpad. Wheel detents arrive ~120 ms apart even from a fast scroller. */
  streakGapMs: 60,
  /** Milliseconds above which an event is an ISOLATED notch — mouse evidence. */
  isolatedGapMs: 250,
  /** |deltaY| at or above which a pixel-mode event is a coarse wheel detent. */
  coarseDeltaPx: 50,
  /** |deltaY| below which a pixel-mode event is a fine trackpad sample. */
  fineDeltaPx: 10,
  /** Score (−1 mouse .. +1 trackpad) that must be crossed to flip the verdict. */
  deviceFlipScore: 0.25,
  /** How much of each event's evidence folds into the running score. */
  deviceScoreBlend: 0.5,

  /* -- drag pan ------------------------------------------------------------ */

  /**
   * Pixels a RIGHT-drag must travel before it becomes a camera pan instead of
   * an order. Deliberately above `DRAG_THRESHOLD_PX` (5): a right-click that
   * wobbles must still issue the order the player asked for.
   */
  dragPanThresholdPx: 8,

  /* -- momentum ------------------------------------------------------------ */

  /** Inertia on/off by default. */
  momentum: true,
  /**
   * Exponential decay rate of the coast, per second. 6.0 is an e-fold every
   * 167 ms: the camera carries about a third of a second past your fingers and
   * settles, rather than sliding like ice or stopping dead.
   */
  momentumDamping: 6.0,
  /** Metres/sec below which the coast is snapped to zero. */
  momentumMinSpeed: 0.35,
  /** Metres/sec the coast may never exceed, whatever the fling. */
  momentumMaxSpeed: 420,
  /** Rate the velocity estimator tracks live input, per second. */
  momentumTrackRate: 30,

  /* -- keyboard ------------------------------------------------------------ */

  /**
   * Rate the WASD/arrow pan ramps to full speed, per second. 9.0 reaches 90%
   * in ~0.26 s — enough that a tap nudges and a hold sprints, which is what
   * "smooth acceleration" has to mean for a key that is either down or up.
   */
  keyAccelRate: 9.0,
  /**
   * Notches of zoom per second while a zoom key is HELD (`cam.zoomIn` /
   * `cam.zoomOut`, `=` and `-` by default).
   *
   * THE PLAYABLE DOLLY IS 10.365 NOTCHES — ln(140/36)/ln(1.14) — so 4/s crosses
   * it in 2.6 s, which is the same order as `panSpeed`'s 42 m/s crossing a
   * 512 m map. Not a taste: it is the only figure that makes a held key feel
   * like the pan keys beside it.
   *
   * Reported as *"cant zoom or scroll on z"* from a Mac trackpad. Before this,
   * `zoomBy` had exactly TWO callers and both were wheel-driven: there was no
   * keyboard route to the dolly anywhere in the game, so a player whose wheel
   * events were being classified or routed wrongly had no way out at all. A
   * keyboard zoom is immune to every trackpad unknown, which is why it landed
   * first and alone would have closed the report.
   */
  keyZoomNotchesPerSecond: 4.0,

  /* -- edge pan (only reachable when the player turns it on) --------------- */

  /**
   * Milliseconds of pointer stillness after which a parked cursor stops edge
   * panning. Classic edge scroll runs forever while the pointer rests in the
   * band; that is exactly the failure mode on a laptop, where the cursor ends
   * up at an edge because the player let go of the trackpad. Edge panning now
   * has to be RE-ARMED by pointer movement.
   */
  edgeIdleMs: 600,
  /**
   * Milliseconds an inward movement keeps edge panning armed. A movement whose
   * component points at the edge you are sitting on re-arms; drifting parallel
   * to it, or away from it, does not.
   */
  edgeIntentMs: 900,
} as const;
