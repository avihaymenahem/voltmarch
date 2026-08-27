/**
 * Deterministic tactical sketches for the skirmish lobby.
 *
 * A lobby preview must answer the strategic question before it answers the
 * beauty question: where is water, where are the lanes, where do armies start,
 * and where is the ore.  The live minimap cannot be borrowed here because no
 * world exists yet, but the map row already carries the preset, biome, pinned
 * landform seed and seat count that generate that world.  This renderer uses
 * those same inputs to produce a stable survey instead of shipping a second
 * hand-authored screenshot catalogue that can drift from the map table.
 */

import type { MapChoice } from './settings-store';

const W = 320;
const H = 176;

interface Palette {
  land: string;
  land2: string;
  line: string;
  water: string;
  ore: string;
}

const PALETTES: Readonly<Record<string, Palette>> = {
  temperate: { land: '#536632', land2: '#788247', line: '#a2ad72', water: '#174f62', ore: '#f2bf28' },
  desert: { land: '#8a6737', land2: '#aa8750', line: '#d0ae70', water: '#235b69', ore: '#ffd02f' },
  snow: { land: '#80909a', land2: '#c7d0d1', line: '#e5ecec', water: '#235870', ore: '#f6ca31' },
  urban: { land: '#3e4548', land2: '#61686a', line: '#939a99', water: '#183e4c', ore: '#f0b92b' },
};

function rng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(
  c: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
): void {
  c.beginPath();
  const points = 18;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wobble = 0.82 + random() * 0.28;
    const px = x + Math.cos(a) * rx * wobble;
    const py = y + Math.sin(a) * ry * wobble;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

function startPositions(players: number): readonly [number, number][] {
  return players > 2
    ? [[0.18, 0.20], [0.82, 0.20], [0.18, 0.80], [0.82, 0.80]]
    : [[0.18, 0.22], [0.82, 0.78]];
}

/**
 * Strategic facts remain code-drawn over the authored battlefield art. This
 * keeps starts and ore crisp at any shell scale and, more importantly, means a
 * balance edit never requires repainting text or markers baked into an image.
 */
function paintTacticalFacts(
  c: CanvasRenderingContext2D,
  map: MapChoice,
  random: () => number,
): void {
  const p = PALETTES[map.biome] ?? PALETTES.temperate;

  // Ore is the other strategic fact the list blurb promises. The positions
  // are seeded and stable, with a central contested field always visible.
  const ores: [number, number][] = [[W * 0.5, H * 0.5]];
  for (let i = 0; i < 4; i++) ores.push([34 + random() * (W - 68), 26 + random() * (H - 52)]);
  for (const [x, y] of ores) {
    c.fillStyle = p.ore;
    c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 5, y + 4); c.lineTo(x - 5, y + 4); c.closePath(); c.fill();
  }

  for (let i = 0; i < map.players; i++) {
    const [px, py] = startPositions(map.players)[i] ?? [0.5, 0.5];
    const x = px * W;
    const y = py * H;
    c.fillStyle = '#071019';
    c.strokeStyle = '#45d7f2';
    c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#d9f8ff';
    c.font = '700 10px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(i + 1), x, y + 0.5);
  }
}

/** Paint only the transparent strategic overlay used above authored art. */
function paintMapOverlay(canvas: HTMLCanvasElement, map: MapChoice): void {
  canvas.width = W;
  canvas.height = H;
  if (typeof canvas.getContext !== 'function') return;
  const c = canvas.getContext('2d');
  if (c === null) return;
  paintTacticalFacts(c, map, rng(map.mapSeed ^ 0x6d61_7073));
}

/** Paint the map's strategic silhouette onto an existing canvas. */
export function paintMapPreview(canvas: HTMLCanvasElement, map: MapChoice): void {
  canvas.width = W;
  canvas.height = H;
  // The shell's tiny node-side DOM harness deliberately implements only the
  // elements its tests inspect. A preview is progressive decoration there;
  // the labelled figure and caption still carry the map identity.
  if (typeof canvas.getContext !== 'function') return;
  const c = canvas.getContext('2d');
  if (c === null) return;
  const p = PALETTES[map.biome] ?? PALETTES.temperate;
  const random = rng(map.mapSeed);

  c.fillStyle = p.land;
  c.fillRect(0, 0, W, H);

  // Broad relief comes from the pinned landform seed. It is deliberately
  // low-frequency: this is a tactical survey, not fake satellite photography.
  for (let i = 0; i < 12; i++) {
    blob(c, random, random() * W, random() * H, 28 + random() * 54, 14 + random() * 32,
      i % 2 === 0 ? p.land2 : p.land);
  }

  if (map.preset === 'atoll') {
    c.fillStyle = p.water;
    c.fillRect(0, 0, W, H);
    const islands: readonly [number, number][] = [[65, 45], [250, 43], [68, 136], [252, 134]];
    for (const [x, y] of islands) blob(c, random, x, y, 48, 34, p.land2);
  } else if (map.preset === 'coast' || map.preset === 'tropical') {
    c.fillStyle = p.water;
    c.beginPath();
    c.moveTo(W * 0.48, 0);
    for (let y = 0; y <= H; y += 12) {
      c.lineTo(W * (0.50 + Math.sin(y * 0.065) * 0.055), y);
    }
    c.lineTo(W, H);
    c.lineTo(W, 0);
    c.closePath();
    c.fill();
  }

  // Preset-defining lane language.
  c.save();
  c.strokeStyle = p.line;
  c.globalAlpha = 0.34;
  c.lineWidth = map.preset === 'urban' ? 5 : 3;
  if (map.preset === 'urban') {
    for (let x = 40; x < W; x += 58) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 34; y < H; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  } else if (map.preset !== 'atoll') {
    c.beginPath(); c.moveTo(22, H - 18); c.bezierCurveTo(95, 116, 210, 66, W - 18, 18); c.stroke();
    if (map.preset === 'snow') {
      c.beginPath(); c.moveTo(4, 42); c.bezierCurveTo(120, 82, 180, 90, W - 6, 132); c.stroke();
    }
  }
  c.restore();

  paintTacticalFacts(c, map, rng(map.mapSeed ^ 0x6d61_7073));
}

/** Build the selected-map preview card used by the lobby. */
export function mapPreview(map: MapChoice): HTMLElement {
  const root = document.createElement('figure');
  root.className = 'vm-map-preview';
  root.setAttribute('aria-label', `${map.name} tactical preview`);

  const art = document.createElement('img');
  art.className = 'vm-map-preview-art';
  art.src = `/maps/previews/${map.id}.webp`;
  art.alt = '';
  art.draggable = false;
  art.setAttribute('aria-hidden', 'true');
  root.appendChild(art);

  const canvas = document.createElement('canvas');
  canvas.className = 'vm-map-preview-canvas';
  paintMapOverlay(canvas, map);
  root.appendChild(canvas);

  // Public assets can still fail behind a stale service-worker cache. The old
  // deterministic survey remains a complete fallback rather than a broken
  // image icon or an empty black card.
  art.addEventListener('error', () => {
    root.classList.add('is-fallback');
    paintMapPreview(canvas, map);
  }, { once: true });

  const caption = document.createElement('figcaption');
  caption.className = 'vm-map-preview-caption';
  const title = document.createElement('span');
  title.textContent = 'TACTICAL SURVEY';
  const meta = document.createElement('span');
  meta.textContent = `${map.players} STARTS · ${map.biome.toUpperCase()} · ${map.mapSeed.toString(16).toUpperCase()}`;
  caption.append(title, meta);
  root.appendChild(caption);
  return root;
}
