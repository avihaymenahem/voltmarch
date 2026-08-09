/**
 * Audio measurement harness.
 *
 * You cannot hear a regression in a pull request, and neither can I. So every
 * sound in the bank is rendered offline in headless Chromium (the only place
 * `OfflineAudioContext` exists) and reduced to numbers that a taste argument
 * cannot override: a tank cannon whose energy sits above 500 Hz is wrong no
 * matter how anyone feels about it.
 *
 *   node tools/audio-measure.mjs                 # measure everything
 *   node tools/audio-measure.mjs cannon explos   # only ids matching a filter
 *   node tools/audio-measure.mjs --wav           # also dump WAVs to docs/audio/
 *   node tools/audio-measure.mjs --json out.json # machine-readable
 *   node tools/audio-measure.mjs --base b.json   # diff against an earlier run
 *
 * Reported per sound:
 *   peak/RMS/crest  dBFS at the bus input, and the peak-to-RMS ratio. A crest
 *                   under ~8 dB means the transient has been squashed flat; a
 *                   crest over ~22 dB means the sound is a click with nothing
 *                   behind it.
 *   centroid        energy-weighted spectral centroid in Hz. This is the single
 *                   number that says "bright" or "heavy".
 *   sub/low/mid/hi  fraction of total energy in 20-80 / 80-400 / 400-2500 /
 *                   2500-20000 Hz. Explosions need real sub; machine guns must
 *                   not.
 *   T40             seconds from the peak until the envelope is 40 dB down —
 *                   the tail length, i.e. whether the sound has a room at all.
 *   atk             milliseconds from onset to peak. A weapon report wants
 *                   single-digit milliseconds.
 */

import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WAV_DIR = join(ROOT, 'docs', 'audio');

const argv = process.argv.slice(2);
const WANT_WAV = argv.includes('--wav');
const jsonAt = argv.indexOf('--json');
const JSON_OUT = jsonAt >= 0 ? argv[jsonAt + 1] : null;
const baseAt = argv.indexOf('--base');
const BASE_IN = baseAt >= 0 ? argv[baseAt + 1] : null;
// `jsonAt + 1` is 0 when `--json` is absent, which silently swallowed the first
// positional filter. Only skip the value slot when the flag was actually given.
const FILTERS = argv.filter((a, i) => (
  !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1) && !(baseAt >= 0 && i === baseAt + 1)
));

/** Sounds worth dumping as WAV: one per family, so a human can judge by ear. */
const WAV_PICKS = [
  'cannon.heavy', 'cannon.light', 'mg.round', 'flak.round', 'rocket.launch',
  'tesla.discharge', 'tesla.charge', 'prism.fire', 'artillery.fire',
  'explosion.small', 'explosion.medium', 'explosion.large',
  'impact.armor', 'impact.dirt', 'ui.thunk', 'ui.click',
  'eva.baseUnderAttack', 'eva.constructionComplete', 'eva.missionAccomplished',
  'bark.allied_infantry', 'bark.soviet_vehicle',
  'music.idle', 'music.combat',
];

/* -------------------------------------------------------------------------- */
/* DSP                                                                        */
/* -------------------------------------------------------------------------- */

/** In-place iterative radix-2 FFT. `re`/`im` are power-of-two length. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const BANDS = [
  ['sub', 20, 80],
  ['low', 80, 400],
  ['mid', 400, 2500],
  ['hi', 2500, 20000],
];

/**
 * Welch-style average power spectrum over the whole sound. 2048-point Hann
 * windows at 50% overlap: fine enough to place a centroid, coarse enough that
 * a 2.7 s explosion measures in a few milliseconds.
 */
function spectrum(src, rate) {
  // A 2048-point window does not fit inside a 20 ms UI blip, and a sound with
  // zero complete frames measures as a centroid of 0 Hz — which reads as a bug
  // in the recipe when it is a bug in the measurement. Shrink to fit.
  let N = 2048;
  while (N > 128 && N > src.length) N >>= 1;
  const half = N >> 1;

  // Two corrections, both of which were producing WRONG ANSWERS, not merely
  // imprecise ones:
  //
  //  - A Hann window is zero at its first sample, so the frame starting at t=0
  //    discards the attack entirely. Every percussive sound in this bank IS an
  //    attack. Pad the front by half a window so the first frame is CENTRED on
  //    t=0 and the transient is weighted at 1.0.
  //  - At 50% overlap and a 43 ms window, a 25 ms debris grain falls between
  //    two frames and measures as its own body with no click. 75% overlap.
  //
  // Before this, `debris.grain` scored 96% of its energy in 80-400 Hz while
  // audibly being a band-passed click at 1.6 kHz.
  const mono = new Float64Array(src.length + N);
  mono.set(src, half);
  const hop = N >> 2;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const acc = new Float64Array(N / 2 + 1);
  let frames = 0;
  const last = Math.max(0, mono.length - N);
  for (let off = 0; off <= last; off += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = mono[off + i] * win[i];
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames === 0) return { power: acc, binHz: rate / N };
  for (let k = 0; k < acc.length; k++) acc[k] /= frames;
  return { power: acc, binHz: rate / N };
}

function analyse(samples, channels, rate) {
  const n = Math.floor(samples.length / channels);
  const mono = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += samples[i * channels + c];
    mono[i] = s / channels;
  }

  let peak = 0, peakAt = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) { peak = a; peakAt = i; }
    sum2 += mono[i] * mono[i];
  }
  const rms = Math.sqrt(sum2 / Math.max(1, n));

  // Onset: first sample above 1% of peak. Attack is onset -> peak.
  let onset = 0;
  for (let i = 0; i < n; i++) { if (Math.abs(mono[i]) > peak * 0.01) { onset = i; break; } }

  // Envelope: 5 ms RMS windows. T40 is where it falls 40 dB under its own max.
  const w = Math.max(16, Math.round(rate * 0.005));
  const env = [];
  for (let i = 0; i + w <= n; i += w) {
    let s = 0;
    for (let k = 0; k < w; k++) s += mono[i + k] * mono[i + k];
    env.push(Math.sqrt(s / w));
  }
  let envMax = 0, envMaxAt = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > envMax) { envMax = env[i]; envMaxAt = i; }
  const floor = envMax * Math.pow(10, -40 / 20);
  let t40 = env.length;
  for (let i = envMaxAt; i < env.length; i++) if (env[i] < floor) { t40 = i; break; }
  const t40Sec = ((t40 - envMaxAt) * w) / rate;

  // Crest over the whole file is length-dependent — a 3 s explosion that is
  // mostly tail scores the same 21 dB as a dry click, so the number says
  // nothing. `punch` is peak against the RMS of the loudest 200 ms, which is
  // what a listener actually judges density by.
  const wp = Math.min(n, Math.round(rate * 0.2));
  let best = 0, run = 0;
  for (let i = 0; i < n; i++) {
    run += mono[i] * mono[i];
    if (i >= wp) run -= mono[i - wp] * mono[i - wp];
    if (i >= wp - 1 && run > best) best = run;
  }
  const rms200 = Math.sqrt(best / wp);

  const { power, binHz } = spectrum(mono, rate);
  let total = 0, weighted = 0;
  const bandE = {};
  for (const [name] of BANDS) bandE[name] = 0;
  for (let k = 1; k < power.length; k++) {
    const hz = k * binHz;
    if (hz > 20000) break;
    const p = power[k];
    total += p;
    weighted += p * hz;
    for (const [name, lo, hi] of BANDS) if (hz >= lo && hz < hi) bandE[name] += p;
  }
  const bands = {};
  for (const [name] of BANDS) bands[name] = total > 0 ? bandE[name] / total : 0;

  const db = (v) => (v <= 1e-9 ? -120 : 20 * Math.log10(v));
  return {
    seconds: n / rate,
    peakDb: db(peak),
    rmsDb: db(rms),
    crestDb: db(peak) - db(rms),
    punchDb: db(peak) - db(rms200),
    centroidHz: total > 0 ? weighted / total : 0,
    bands,
    t40Sec,
    attackMs: ((peakAt - onset) / rate) * 1000,
  };
}

/* -------------------------------------------------------------------------- */
/* WAV                                                                        */
/* -------------------------------------------------------------------------- */

function writeWav(path, samples, channels, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

const EVA_PICKS = [
  'battleControlOnline', 'constructionComplete', 'unitReady', 'baseUnderAttack',
  'insufficientFunds', 'missionAccomplished', 'incomingMissile', 'lowPower',
];
const BARK_PICKS = ['allied_infantry', 'soviet_infantry', 'allied_vehicle', 'soviet_vehicle', 'allied_air'];
const MUSIC_PICKS = [
  { id: 'idle', heat: 0.0, seconds: 8 },
  { id: 'mid', heat: 0.45, seconds: 8 },
  { id: 'combat', heat: 0.95, seconds: 10 },
];

async function main() {
  const bundle = await build({
    entryPoints: [join(ROOT, 'tools', 'audio-probe.ts')],
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    write: false,
    logLevel: 'warning',
  });
  const code = bundle.outputFiles[0].text;

  // SERVE `public/`, do not `setContent`.
  //
  // `setContent` leaves the page on about:blank, where a relative fetch has no
  // base to resolve against — so every recorded take failed to load and the
  // whole bank silently fell back to its synthesised recipe. The tool still
  // printed a full table, and the numbers were plausible because they were the
  // REAL numbers for the old bank. A measurement harness that cannot see the
  // thing that ships is worse than no harness: it reports confidently on
  // something nobody is listening to. Serving the directory over a real origin
  // is the whole fix, and it costs one ephemeral port.
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>probe</title>');
      return;
    }
    const file = join(ROOT, 'public', path.replace(/^\/+/, ''));
    // Never serve outside `public/` — this is a local tool, but a path that
    // escapes its root is a bug wherever it appears.
    if (!file.startsWith(join(ROOT, 'public')) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': path.endsWith('.ogg') ? 'audio/ogg' : 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(origin);
  await page.addScriptTag({ content: code });

  const results = [];
  const collect = (rows) => { for (const r of rows) results.push(r); };

  collect(await page.evaluate(() => globalThis.__vmAudioProbe.bank(0)));
  collect(await page.evaluate((ids) => globalThis.__vmAudioProbe.eva(ids, -6), EVA_PICKS));
  collect(await page.evaluate((cs) => globalThis.__vmAudioProbe.barks(cs, -8), BARK_PICKS));
  collect(await page.evaluate((ms) => globalThis.__vmAudioProbe.music(ms), MUSIC_PICKS));

  await browser.close();
  server.close();

  if (WAV_PICKS.length > 0 && WANT_WAV) mkdirSync(WAV_DIR, { recursive: true });

  const report = {};
  for (const r of results) {
    if (FILTERS.length > 0 && !FILTERS.some((f) => r.id.includes(f))) continue;
    const bytes = Buffer.from(r.pcm, 'base64');
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const m = analyse(samples, r.channels, r.sampleRate);
    report[r.id] = { group: r.group, rawPeak: r.rawPeak, specDb: r.specDb, ...m };
    if (WANT_WAV && WAV_PICKS.includes(r.id)) {
      writeWav(join(WAV_DIR, `${r.id.replace(/[^\w.-]/g, '_')}.wav`), samples, r.channels, r.sampleRate);
    }
  }

  const base = BASE_IN && existsSync(BASE_IN) ? JSON.parse(readFileSync(BASE_IN, 'utf8')) : null;

  const groups = new Map();
  for (const [id, m] of Object.entries(report)) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push([id, m]);
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n, d = 1) => String(v.toFixed(d)).padStart(n);
  console.log('');
  for (const [group, rows] of groups) {
    console.log(`\x1b[1m${group.toUpperCase()}\x1b[0m`);
    console.log(
      `  ${pad('id', 20)}${pad('peak', 7)}${pad('rms', 8)}${pad('punch', 8)}` +
      `${pad('cent', 8)}${pad('sub', 7)}${pad('low', 7)}${pad('mid', 7)}${pad('hi', 7)}` +
      `${pad('T40', 7)}${pad('atk', 6)}${pad('dur', 6)}`,
    );
    for (const [id, m] of rows) {
      let line =
        `  ${pad(id, 20)}${num(m.peakDb, 6)} ${num(m.rmsDb, 7)} ${num(m.punchDb, 7)} ` +
        `${num(m.centroidHz, 7, 0)} ${num(m.bands.sub * 100, 6)} ${num(m.bands.low * 100, 6)} ` +
        `${num(m.bands.mid * 100, 6)} ${num(m.bands.hi * 100, 6)} ` +
        `${num(m.t40Sec, 6, 2)} ${num(m.attackMs, 5, 1)} ${num(m.seconds, 5, 2)}`;
      const b = base?.[id];
      if (b) {
        const d = m.centroidHz - b.centroidHz;
        line += `   \x1b[90mΔcent ${d >= 0 ? '+' : ''}${d.toFixed(0)}\x1b[0m`;
      }
      console.log(line);
    }
    console.log('');
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }
  if (WANT_WAV) console.log(`wavs -> ${WAV_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
