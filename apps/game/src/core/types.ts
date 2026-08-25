/**
 * Compatibility surface for the game runtime.
 *
 * The canonical dependency-free domain vocabulary lives in
 * `@voltmarch/game-types`. Keeping this re-export during the monorepo move lets
 * the existing game modules migrate package imports incrementally without
 * duplicating enum values that are persisted in saves, replays, and lockstep.
 */
export * from '@voltmarch/game-types';
