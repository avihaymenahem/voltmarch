/**
 * Domain-owned config slice: selection and world-space order feedback.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 20. INPUT, SELECTION AND ORDER FEEDBACK      (owned by src/input/**)
 *
 * The feel numbers. An RTS is judged in its first thirty seconds on whether a
 * click lands where the eye expected and whether an order visibly *happened*.
 * Everything here is measured in CSS pixels, metres or seconds — never in
 * frames, because the whole input layer is frame-rate independent.
 * ========================================================================== */

/** Pixels of travel before a HELD button starts painting a marquee. */
export const MARQUEE_MIN_PX = 6;
/** Pixels of slop between two clicks that still count as a double-click. */
export const DOUBLE_CLICK_SLOP_PX = 6;
/** Milliseconds within which two taps of the same digit centre the camera. */
export const GROUP_DOUBLE_TAP_MS = 380;
/**
 * Screen-pixel radius around the cursor searched for an entity before falling
 * back to the ground-plane hit. This is what makes clicking a tall Tesla Coil
 * feel right: its ground footprint is 4 m away from the pixels you aimed at.
 */
export const PICK_SCREEN_RADIUS_PX = 26;
/** Extra metres added to an entity's own radius when picking. Forgiving, not sloppy. */
export const PICK_WORLD_SLOP = 0.9;
/** Waypoints a single unit may hold from shift-queuing. */
export const MAX_WAYPOINTS = 8;
/** Metres from its order point at which a unit is considered arrived. */
export const ARRIVE_RADIUS = 2.6;

/* -- order feedback (world-space, drawn at RenderPhase.Overlay) ----------- */

/** Simultaneous order markers. Older ones are recycled oldest-first. */
export const ORDER_MARKER_POOL = 48;
/** Seconds an order marker lives. Short: it is a confirmation, not decoration. */
export const ORDER_MARKER_SECONDS = 0.9;
/** Metres of radius the marker ring settles at. */
export const ORDER_MARKER_RADIUS = 2.2;
/** The marker punches out to this multiple of its radius before settling. */
export const ORDER_MARKER_POP = 1.85;
/** Metres the marker floats above the ground so it never z-fights terrain. */
export const OVERLAY_LIFT = 0.16;
/** Move / rally / attack marker colours. Accents SCREAM (bible §0.1). */
export const ORDER_MOVE_COLOR = '#38F08A';
export const ORDER_ATTACK_COLOR = '#FF3B24';
export const ORDER_SPECIAL_COLOR = '#FFC64A';

/* -- marquee (the fallback DOM rectangle) ---------------------------------
 * The HUD's world-overlay canvas draws the marquee whenever it is mounted; the
 * input module only falls back to a DOM rectangle when it is not. These three
 * style it. There are deliberately NO selection-bracket constants here:
 * src/ui/Overlay.ts owns the selection affordance (VISUAL_DNA non-negotiable
 * #9 — "selection is the health bar appearing").
 * ------------------------------------------------------------------------ */

/** Marquee stroke, fill and glow. RA3 HUD language: thin, bright, cyan-green. */
export const MARQUEE_STROKE = 'rgba(127,216,192,0.95)';
export const MARQUEE_FILL = 'rgba(127,216,192,0.10)';
export const MARQUEE_GLOW = 'rgba(127,216,192,0.35)';
