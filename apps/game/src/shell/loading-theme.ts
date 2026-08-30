/** Loading-screen faction colours, derived from the game's canonical palette. */

import { FACTION_PALETTE } from '../core/config';

type FactionPaletteKey = keyof typeof FACTION_PALETTE;

export interface LoadingFactionTheme {
  readonly accent: string;
  readonly rgb: string;
}

const THEME_KEYS: Readonly<Record<string, FactionPaletteKey>> = {
  neutral: 'neutral',
  allies: 'allies',
  soviets: 'soviets',
  meridian: 'meridian',
  pact: 'meridian',
  reclaim: 'reclaim',
  reclamation: 'reclaim',
};

function rgbChannels(hex: string): string | null {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (value === undefined) return null;
  const packed = Number.parseInt(value, 16);
  return `${(packed >>> 16) & 0xff}, ${(packed >>> 8) & 0xff}, ${packed & 0xff}`;
}

/** Resolve skirmish keys and campaign aliases through one faction colour table. */
export function loadingFactionTheme(theme: string): LoadingFactionTheme | null {
  const key = THEME_KEYS[theme];
  if (key === undefined) return null;
  const accent = FACTION_PALETTE[key].hudAccent;
  const rgb = rgbChannels(accent);
  return rgb === null ? null : { accent, rgb };
}
