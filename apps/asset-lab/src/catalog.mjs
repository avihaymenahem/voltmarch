const DELIVERY_DIRECTORIES = new Set(['compressed', 'derived']);

const FACTION_LABELS = {
  allies: 'Allied Forces',
  soviets: 'Soviet Union',
  meridian: 'Meridian Conclave',
  reclamation: 'Reclamation Pact',
  civilian: 'Civilian',
  neutral: 'Neutral',
  'box-prop': 'Box Props',
  'extended-foliage': 'Extended Foliage',
  foliage: 'Foliage',
  mineral: 'Minerals',
  'prop-surface': 'Surface Props',
  shrub: 'Shrubs',
};

/*
 * Match semantic role tokens, never arbitrary substrings. The previous
 * patterns classified `sputnik-dozer` as aircraft because it contains a word
 * associated with space, and every `*-yard` as naval — including Construction
 * Yard, Forgeyard, Breaker Yard, Patch Yard and Yardcrawler.
 */
const AIRCRAFT_PATTERN = /(?:^|-)(?:aircraft|bomber|carryall|fighter|gunship|helicopter|hornet|interceptor)(?:-|$)/i;
const AIRCRAFT_SLUGS = new Set(['swarmhornet']);
const VEHICLE_UNIT_SLUGS = new Set(['pactworks-carryall']);
const NAVAL_UNIT_PATTERN = /(?:^|-)(?:argosy|barge|boat|corvette|craft|cruiser|cutter|destroyer|dreadnought|hauler|hulk|hydrofoil|lighter|monitor|scow|ship|skimmer|submarine|sunmonitor|transport)(?:-|$)/i;
const NAVAL_STRUCTURE_SLUGS = new Set(['naval-yard', 'naval-pen', 'slipway', 'breaker-dock']);
const INFANTRY_UNIT_SLUGS = new Set(['attack-dog']);

export function buildAssetCatalog(urlEntries) {
  const files = Object.entries(urlEntries).map(([sourcePath, url]) => describeFile(sourcePath, url));
  const families = new Map();

  for (const file of files) {
    const key = [file.kind, file.faction, file.familySlug].join('/');
    const family = families.get(key) ?? {
      id: key,
      name: titleCase(file.familySlug),
      slug: file.familySlug,
      faction: file.faction,
      factionLabel: FACTION_LABELS[file.faction] ?? titleCase(file.faction),
      kind: file.kind,
      category: file.category,
      files: [],
      search: '',
    };
    family.files.push(file);
    families.set(key, family);
  }

  const result = [...families.values()];
  for (const family of result) {
    family.files.sort(compareVariants);
    family.primary = family.files[0];
    family.variantCount = family.files.length;
    family.hasLods = family.files.some((file) => /^LOD\d$/i.test(file.variant));
    family.hasShadow = family.files.some((file) => file.variant === 'Shadow');
    family.hasAnimations = family.files.some((file) => file.variant.startsWith('Animation'));
    family.search = [
      family.name,
      family.slug,
      family.faction,
      family.factionLabel,
      family.kind,
      family.category,
      ...family.files.map((file) => `${file.variant} ${file.sourcePath}`),
    ].join(' ').toLowerCase();
  }

  result.sort((a, b) =>
    a.faction.localeCompare(b.faction) ||
    a.kind.localeCompare(b.kind) ||
    a.name.localeCompare(b.name));
  return result;
}

export function describeFile(sourcePath, url) {
  const normalPath = sourcePath.replaceAll('\\', '/');
  const marker = normalPath.includes('/assets/game/') ? '/assets/game/' : '/assets/';
  const relative = normalPath.includes(marker) ? normalPath.split(marker)[1] : normalPath;
  const parts = relative.split('/');
  const kind = parts[0] === 'buildings' ? 'Buildings' : parts[0] === 'units' ? 'Units' : parts[0] === 'wrecks' ? 'Wrecks' : titleCase(parts[0]);
  const faction = kind === 'Wrecks' ? 'neutral' : (parts[1] ?? 'neutral').toLowerCase();
  const directories = parts.slice(kind === 'Wrecks' ? 1 : 2, -1);
  const filename = parts.at(-1) ?? 'unknown.glb';
  const stem = filename.replace(/\.glb$/i, '');
  const { familySlug, variant } = identifyVariant(stem, directories);
  const category = classifyCategory(kind, familySlug, directories);
  return { sourcePath: normalPath, relativePath: relative, url, filename, stem, kind, faction, directories, familySlug, category, variant };
}

function identifyVariant(stem, directories) {
  const derived = directories.includes('derived');
  const compressed = directories.includes('compressed');
  const infantryPoc = directories.includes('infantry-poc');
  const commander = directories.includes('commanders');
  const animationReview = directories.includes('animation');
  const suffixes = [
    [/\.shadow$/i, 'Shadow'],
    [/\.lod(\d+)$/i, (_, level) => `LOD${level}`],
    [/\.clay$/i, 'Clay review'],
  ];
  for (const [pattern, variant] of suffixes) {
    const match = stem.match(pattern);
    if (match) return {
      familySlug: stem.replace(pattern, ''),
      variant: typeof variant === 'function' ? variant(...match) : variant,
    };
  }
  if (infantryPoc || commander) {
    const animation = stem.match(/-(walk|run-shoot|run)$/i);
    if (animation) return { familySlug: infantryFamily(stem), variant: `Animation · ${titleCase(animation[1])}` };
    if (/-rigged-textured$/i.test(stem)) return { familySlug: infantryFamily(stem), variant: 'Rigged review · textured' };
    if (/-rigged$/i.test(stem)) return { familySlug: infantryFamily(stem), variant: 'Rigged review · clay' };
    if (/-lod0$/i.test(stem)) return { familySlug: infantryFamily(stem), variant: 'LOD0 · gameplay' };
  }
  if (animationReview && /-rigged$/i.test(stem)) {
    return { familySlug: stem.replace(/-rigged$/i, ''), variant: 'Animation rig · embedded clips' };
  }
  if (compressed) return { familySlug: stem, variant: 'Runtime · KTX2' };
  if (derived) return { familySlug: stem, variant: 'Derived' };
  return { familySlug: stem, variant: 'Source · authored PBR' };
}

function infantryFamily(stem) {
  return stem.replace(/-(rigged-textured|rigged|lod0|walk|run-shoot|run)$/i, '');
}

function classifyCategory(kind, slug, directories) {
  if (kind === 'Environment') return 'Environment';
  if (kind === 'Buildings') return NAVAL_STRUCTURE_SLUGS.has(slug) ? 'Naval structures' : 'Buildings';
  if (kind === 'Wrecks') return 'Wrecks';
  if (directories.includes('infantry-poc') || directories.includes('commanders') || INFANTRY_UNIT_SLUGS.has(slug)) return 'Infantry';
  if (VEHICLE_UNIT_SLUGS.has(slug)) return 'Vehicles';
  // Compound ship roles such as `aircraft-cruiser` are naval even though they
  // contain an aviation token. Resolve the hull role before the payload role.
  if (NAVAL_UNIT_PATTERN.test(slug)) return 'Naval units';
  if (AIRCRAFT_SLUGS.has(slug) || AIRCRAFT_PATTERN.test(slug)) return 'Aircraft';
  return 'Vehicles';
}

function compareVariants(a, b) {
  return variantPriority(a.variant) - variantPriority(b.variant) || a.variant.localeCompare(b.variant);
}

function variantPriority(variant) {
  if (variant === 'LOD0 · gameplay') return 0;
  if (variant === 'Source · authored PBR') return 1;
  if (variant === 'Runtime · KTX2') return 2;
  if (variant.startsWith('Rigged review · textured')) return 3;
  if (variant.startsWith('LOD1')) return 4;
  if (variant.startsWith('LOD2')) return 5;
  if (variant.startsWith('Animation')) return 6;
  if (variant.startsWith('Rigged review')) return 7;
  if (variant === 'Clay review') return 8;
  if (variant === 'Shadow') return 9;
  return 10;
}

function titleCase(value) {
  return String(value)
    .replaceAll(/[-_.]+/g, ' ')
    .replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

export function catalogSummary(catalog) {
  return {
    families: catalog.length,
    files: catalog.reduce((sum, family) => sum + family.files.length, 0),
    factions: new Set(catalog.map((family) => family.faction)).size,
    categories: new Set(catalog.map((family) => family.category)).size,
  };
}
