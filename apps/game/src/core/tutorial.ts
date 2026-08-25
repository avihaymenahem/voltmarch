/**
 * Semantic bridge from eager gameplay modules to the lazy tutorial director.
 *
 * This file must stay import-free and prose-free. Input and HUD are eager
 * modules; importing `shell/tutorial-steps.ts` from either would pull the whole
 * authored curriculum into first paint through a second system edge.
 */
export type TutorialAction =
  | 'control-group-store'
  | 'control-group-recall'
  | 'stance-change'
  | 'formation-use'
  | 'garrison-enter'
  | 'building-capture'
  | 'repair-start'
  | 'building-sell'
  | 'transport-board'
  | 'transport-unload'
  | 'commander-ability'
  | 'commander-power'
  | 'superweapon-fire'
  | 'veterancy-rank';

/** Notify a live director without importing its shell-owned class. */
export function notifyTutorialAction(action: TutorialAction): void {
  const g = globalThis as unknown as {
    __vmTutorial?: { readonly wantsMatch?: boolean; action?: (a: TutorialAction) => void };
  };
  const tutorial = g.__vmTutorial;
  if (tutorial?.wantsMatch === true && typeof tutorial.action === 'function') {
    tutorial.action(action);
  }
}
