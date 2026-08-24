/** Shared visual language for mission-earned insignia and field decals. */

export type CosmeticKind = 'insignia' | 'decal';

export function cosmeticKind(id: string): CosmeticKind | null {
  if (id.startsWith('cosmetic.insignia.')) return 'insignia';
  if (id.startsWith('cosmetic.decal.')) return 'decal';
  return null;
}

const MARK_PATHS: Readonly<Record<string, readonly string[]>> = {
  bronze: ['M50 16 59 38 83 40 65 56 70 81 50 68 30 81 35 56 17 40 41 38Z'],
  gold: ['M50 13 60 37 86 39 66 56 72 83 50 69 28 83 34 56 14 39 40 37Z'],
  veteran: ['M22 31 50 49 78 31', 'M22 48 50 66 78 48', 'M22 65 50 83 78 65'],
  magnate: ['M50 14 82 50 50 86 18 50Z', 'M50 27 69 50 50 73 31 50Z'],
  warlord: ['M20 70 15 30 38 48 50 18 62 48 85 30 80 70Z', 'M22 78H78'],
  allies: ['M50 66 27 79 12 61 39 45', 'M50 66 73 79 88 61 61 45', 'M50 28V75'],
  soviets: ['M50 13 60 38 87 40 66 57 72 84 50 69 28 84 34 57 13 40 40 38Z'],
  meridian: ['M50 28A22 22 0 1 0 50 72A22 22 0 1 0 50 28', 'M50 9V21M50 79V91M9 50H21M79 50H91M21 21 30 30M70 70 79 79M79 21 70 30M30 70 21 79'],
  admiralty: ['M50 18V76', 'M34 32H66', 'M20 57C24 77 39 86 50 86 61 86 76 77 80 57', 'M20 57 31 64M80 57 69 64'],
  unbroken: ['M50 13 80 24V49C80 69 67 82 50 89 33 82 20 69 20 49V24Z', 'M34 50 46 62 69 36'],
  fleet: ['M12 37C24 27 35 47 47 37S70 47 88 37', 'M12 54C24 44 35 64 47 54S70 64 88 54', 'M12 71C24 61 35 81 47 71S70 81 88 71'],
  warhead: ['M50 13C61 27 66 40 66 56H34C34 40 39 27 50 13Z', 'M34 56 24 79 43 70 50 87 57 70 76 79 66 56Z'],
  grid: ['M22 22H78V78H22Z', 'M22 40H78M22 59H78M40 22V78M59 22V78'],
  chevron: ['M16 28 50 51 84 28', 'M16 49 50 72 84 49'],
  laurel: ['M47 81C25 73 18 52 26 29', 'M53 81C75 73 82 52 74 29', 'M29 38 18 34M27 49 15 48M30 61 19 66M71 38 82 34M73 49 85 48M70 61 81 66'],
  centurion: ['M27 78H73', 'M35 78V43C35 25 65 25 65 43V78', 'M26 43H74', 'M50 20V43M39 23 50 13 61 23'],
  star: ['M50 13 60 38 87 40 66 57 72 84 50 69 28 84 34 57 13 40 40 38Z'],
};

/** Render the exact mark used by both the profile collection and reward reveal. */
export function cosmeticMark(id: string, kind: CosmeticKind, size = 72): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', `vm-profile-mark is-${kind}`);
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');

  const frame = document.createElementNS(ns, 'path');
  frame.setAttribute('class', 'vm-profile-mark-frame');
  frame.setAttribute('d', kind === 'insignia'
    ? 'M50 4 91 19V51C91 74 73 91 50 97 27 91 9 74 9 51V19Z'
    : 'M50 6 88 22 94 50 88 78 50 94 12 78 6 50 12 22Z');
  svg.appendChild(frame);

  const key = id.split('.').at(-1) ?? '';
  for (const d of MARK_PATHS[key] ?? MARK_PATHS.star) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('class', 'vm-profile-mark-glyph');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
