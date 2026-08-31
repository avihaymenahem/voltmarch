import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import sharp from 'sharp';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, 'public');
const target = join(root, 'dist');
const sharedAssets = join(root, '..', '..', 'packages', 'assets');
const socialCards = join(root, '..', '..', 'marketing', 'social-cards');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
cpSync(join(sharedAssets, 'fonts'), join(target, 'fonts'), { recursive: true });
cpSync(join(sharedAssets, 'brand'), join(target, 'brand'), { recursive: true });

const cardManifest = JSON.parse(readFileSync(join(socialCards, 'manifest.json'), 'utf8'));
if (cardManifest.cards.length !== cardManifest.expectedCount) {
  throw new Error(`Social-card manifest expected ${cardManifest.expectedCount} cards but contains ${cardManifest.cards.length}`);
}

const cardTarget = join(target, 'cards');
mkdirSync(cardTarget, { recursive: true });
const optimizedCards = [];
const optimizeCard = async (card) => {
  const sourcePath = join(socialCards, ...card.output.split('/'));
  const relativeOutput = card.output.slice(0, -extname(card.output).length) + '.webp';
  const outputPath = join(cardTarget, ...relativeOutput.split('/'));
  mkdirSync(dirname(outputPath), { recursive: true });
  const result = await sharp(sourcePath)
    .resize({ width: 720, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5, smartSubsample: true })
    .toFile(outputPath);
  return {
    key: card.key,
    name: card.name,
    faction: card.faction,
    type: card.type,
    blurb: card.blurb,
    collectorId: card.collectorId,
    rarity: card.rarity,
    image: `/cards/${relativeOutput.replaceAll('\\', '/')}`,
    width: result.width,
    height: result.height,
  };
};

for (let index = 0; index < cardManifest.cards.length; index += 8) {
  const batch = cardManifest.cards.slice(index, index + 8);
  optimizedCards.push(...await Promise.all(batch.map(optimizeCard)));
}
writeFileSync(join(cardTarget, 'manifest.json'), JSON.stringify({
  version: 1,
  count: optimizedCards.length,
  generatedAt: cardManifest.generatedAt,
  cards: optimizedCards,
}));

const analyticsToken = process.env.CF_WEB_ANALYTICS_TOKEN?.trim() ?? '';
if (analyticsToken && !/^[a-f0-9]{32}$/iu.test(analyticsToken)) {
  throw new Error('CF_WEB_ANALYTICS_TOKEN must be a 32-character hexadecimal site token');
}
const analyticsTag = analyticsToken
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${analyticsToken}"}'></script>`
  : '';
for (const page of ['index.html', 'privacy.html']) {
  const path = join(target, page);
  const html = readFileSync(path, 'utf8');
  if (!html.includes('<!-- CF_WEB_ANALYTICS -->')) {
    throw new Error(`${page} is missing its Cloudflare analytics placeholder`);
  }
  writeFileSync(path, html.replace('<!-- CF_WEB_ANALYTICS -->', analyticsTag));
}
console.log(`Built launch site: ${target}`);
console.log(`Optimized social cards: ${optimizedCards.length}`);
console.log(`Cloudflare Web Analytics: ${analyticsToken ? 'enabled' : 'disabled'}`);
