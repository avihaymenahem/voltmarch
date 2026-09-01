/** Presentation-only CPU owner for the currently installed retained field. */

import type { IrradianceFieldUpdate } from '../core/irradiance-field';

let active: IrradianceFieldUpdate | null = null;

export function setRetainedIrradianceField(field: IrradianceFieldUpdate | null): void {
  active = field;
}

export function retainedIrradianceField(): IrradianceFieldUpdate | null {
  return active;
}
