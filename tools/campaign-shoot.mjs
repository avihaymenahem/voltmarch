/**
 * Deterministic visual QA for the campaign shell surfaces.
 *
 * The world-art harness deliberately boots through `?shot=` and never imports
 * the shell. That contract is valuable, but it also means the campaign
 * selector, briefing, in-battle command traffic, and victory/defeat
 * after-action reports were invisible to every PNG review. This companion
 * harness stays on the real product path and drives the published Shell/HUD
 * handles exactly as a player would.
 *
 *   npm run campaign:shots
 *   node tools/campaign-shoot.mjs --no-build
 *   node tools/campaign-shoot.mjs --no-build --only=02-briefing-reclamation
 *
 * Output is written to `shots-campaign/` at both the 1440p art-review size and
 * the 720p minimum desktop layout. The Chromium process and the private Vite
 * preview are always closed in `finally`; this tool must never leave the stale
 * browser instances that make a graphics review consume the whole GPU.
 */

import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots-campaign');
const PORT_HINT = 4327;
const OPERATION = 'soviets.01.first-tap';
const ALLIES_OPERATION = 'allies.01.sounding-line';
const PACT_OPERATION = 'pact.01.shallow-road';
const RECLAMATION_FINALE = 'reclamation.10.without-recourse';
const FINALE_OPERATION = 'soviets.09.nil-return';
const noBuild = process.argv.includes('--no-build');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg === undefined
  ? null
  : new Set(onlyArg.slice('--only='.length).split(',').map((value) => value.trim()).filter(Boolean));
let captureCount = 0;

const VIEWPORTS = [
  { label: '1440p', width: 2560, height: 1440 },
  { label: '720p', width: 1280, height: 720 },
  { label: 'compact', width: 1024, height: 640 },
];

if (!noBuild) await build(ROOT, { log: console.log });
// A focused iteration overwrites only its named surfaces and preserves the
// rest of the last complete review set. A full run still begins from zero so
// deleted/renamed fixtures cannot survive as misleading stale evidence.
if (only === null) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await serve({
  root: ROOT,
  mode: 'preview',
  portHint: PORT_HINT,
  log: console.log,
});

let browser = null;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-angle=default',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const page = await browser.newPage({
    viewport: VIEWPORTS[0],
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(180_000);
  page.setDefaultNavigationTimeout(180_000);

  const faults = [];
  page.on('pageerror', (error) => faults.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The optional local multiplayer relay is intentionally absent from an
    // isolated preview. Keep every other browser error fatal.
    if (text.includes("WebSocket connection to 'ws://localhost:8787/ws' failed")) return;
    faults.push(`[console] ${text}`);
  });

  const query = new URLSearchParams({ seed: '7', art: 'noon', ai: 'off' });
  await page.goto(`${server.origin}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const shell = window.__vmShell;
    const curtain = document.getElementById('loading');
    return shell !== undefined
      && shell.getState() === 'menu'
      && (curtain === null || curtain.hidden === true);
  });

  // CSS motion is presentation, not fixture state. Settle it before every
  // shutter so a half-faded panel cannot become a false layout difference.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important}',
  });

  const waitForPortraits = async (selector) => {
    await page.waitForFunction((activeSelector) => {
      const portraits = [...document.querySelectorAll(activeSelector)];
      return portraits.length > 0 && portraits.every((image) => (
        image instanceof HTMLImageElement
        && image.complete
        && image.naturalWidth > 0
      ));
    }, selector);
  };

  const capture = async (surface, ready, portraits) => {
    if (only !== null && !only.has(surface)) return;
    await page.waitForSelector(ready);
    await waitForPortraits(portraits);
    for (const viewport of VIEWPORTS) {
      await page.evaluate(async () => {
        if (document.fullscreenElement !== null) await document.exitFullscreen();
      });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      const path = join(OUT, `${surface}-${viewport.label}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      captureCount++;
      console.log(`  ${surface} ${viewport.width}x${viewport.height} -> ${path}`);
    }
  };

  const seedFirstTapComms = async () => {
    await page.evaluate(() => {
      window.__vmHud?.campaignComms.clear();
      window.__vmShell.playCampaignBeat({
        kind: 'dialogue',
        speaker: 'Rakhalt',
        text: 'The survey says the seam runs under that town. The Allies sank a tap on it nine days ago. Take it off them. The derricks are the town’s — do not break them and do not take them.',
      });
      window.__vmShell.playCampaignBeat({
        kind: 'dialogue',
        speaker: 'Vosk',
        text: 'Column on the west road. They are not coming for us — they are covering the tap.',
      });
      window.__vmShell.playCampaignBeat({
        kind: 'dialogue',
        speaker: 'Rakhalt',
        text: 'That derrick fed four hundred people, and it does not any more. Note it in the log and keep going.',
      });
      if (window.__vmHud !== undefined) window.__vmHud.campaignComms.frame = () => {};
    });
  };

  const startCampaignOperation = async (operation) => {
    await page.evaluate((id) => window.__vmShell.startOperation(id), operation);
    await page.waitForFunction(() => window.__vmShell?.getState() === 'playing');
  };

  const publishCampaignWin = async (operation, objectives, durationSec) => {
    await page.evaluate(({ id, rows, duration }) => {
      window.__vmShell.publishCampaignResult({
        operationId: id,
        medal: 3,
        reason: '',
        objectives: rows,
      });
      window.__vmShell.endMatch({ won: true, durationSec: duration, wallSec: duration });
    }, { id: operation, rows: objectives, duration: durationSec });
  };

  // Gold is only a truthful award on Hard or Brutal. Keep the visual fixture
  // internally possible instead of showing the contradictory Normal + Gold
  // combination an earlier hand-published result accidentally captured.
  await page.evaluate(() => {
    window.__vmShell.setCampaignDifficulty(2);
    window.__vmShell.openCampaign();
  });
  await capture('01-selector', '.vm-camp-chapter', '.vm-camp-card-portrait');

  await page.evaluate((operation) => window.__vmShell.openBriefing(operation), OPERATION);
  await capture('02-briefing', '.vm-camp-command-portrait', '.vm-camp-command-portrait');

  // One faction skin cannot prove a four-faction command language. Drive the
  // same real briefing surface through all three other campaigns so portrait,
  // palette, role copy and compact layout regressions are visible in PNG QA.
  await page.evaluate((operation) => window.__vmShell.openBriefing(operation), ALLIES_OPERATION);
  await capture('02-briefing-allies', '.vm-camp-command-portrait', '.vm-camp-command-portrait');
  await page.evaluate((operation) => window.__vmShell.openBriefing(operation), PACT_OPERATION);
  await capture('02-briefing-pact', '.vm-camp-command-portrait', '.vm-camp-command-portrait');
  await page.evaluate((operation) => window.__vmShell.openBriefing(operation), RECLAMATION_FINALE);
  await capture('02-briefing-reclamation', '.vm-camp-command-portrait', '.vm-camp-command-portrait');

  await startCampaignOperation(OPERATION);

  // The command-comms card and its log are campaign surfaces too, but they
  // exist only while an operation is live. Feed it three lines from First Tap
  // through the same public Shell seam the Director uses, then freeze only the
  // presentation timer so resizing for review cannot advance the queue.
  await seedFirstTapComms();
  await capture('06-in-battle-comms', '.vm-campaign-comms:not([hidden])', '.vm-comms-portrait:not([hidden])');

  // First Tap's real four-second opener may land while three viewport shutters
  // are being taken. Wait for that Director beat, then re-seed after it has
  // fired so the log fixture contains exactly the three lines under review
  // rather than a timing-dependent repeat on whichever viewport came last.
  await page.waitForFunction(() => document.querySelectorAll('.vm-comms-history-row').length >= 4);
  await seedFirstTapComms();
  await page.locator('.vm-comms-action').filter({ hasText: 'LOG' }).click();
  await capture('07-transmission-log', '.vm-comms-history:not([hidden])', '.vm-comms-portrait:not([hidden])');
  await page.evaluate(() => window.__vmHud?.campaignComms.clear());

  await page.evaluate((operation) => {
    // `endMatch` does not invent campaign truth. In the product the Director
    // publishes this graded ledger immediately before it asks the shell to end
    // the match; reproduce that public sequence so this remains a real result
    // screen rather than a private renderer call.
    window.__vmShell.publishCampaignResult({
      operationId: operation,
      medal: 3,
      reason: '',
      objectives: [
        {
          id: 'sink',
          title: 'Take the Allied survey tap',
          kind: 'primary',
          status: 'complete',
        },
        {
          id: 'derricks',
          title: 'Take the seam and leave the town its three derricks',
          kind: 'secondary',
          status: 'complete',
          credits: 500,
        },
      ],
    });
    window.__vmShell.endMatch({ won: true, durationSec: 601, wallSec: 601 });
  }, OPERATION);
  await capture('03-after-action', '.vm-camp-after-action', '.vm-camp-debrief-portrait');

  // Retry through the public operation lifecycle so the loss fixture proves
  // the same re-arm path a player uses after a failed attempt. A hand-built
  // EndScreen would miss stale roster/session/result bugs by construction.
  await page.evaluate(() => window.__vmShell.retryOperation());
  await page.waitForFunction(() => window.__vmShell?.getState() === 'playing');
  await page.evaluate((operation) => {
    window.__vmShell.publishCampaignResult({
      operationId: operation,
      medal: 0,
      reason: 'sink',
      objectives: [
        {
          id: 'sink',
          title: 'Take the Allied survey tap',
          kind: 'primary',
          status: 'failed',
        },
        {
          id: 'derricks',
          title: 'Take the seam and leave the town its three derricks',
          kind: 'secondary',
          status: 'active',
          credits: 500,
        },
      ],
    });
    window.__vmShell.endMatch({ won: false, durationSec: 214, wallSec: 214 });
  }, OPERATION);
  await capture('04-after-action-loss', '.vm-camp-after-action.is-loss', '.vm-camp-debrief-portrait');

  // A chapter finale is not an ordinary win with different prose. It replaces
  // forward navigation with a completion action and adds the authored epilogue
  // inside the report, so it gets its own real operation latch and capture.
  // Exercise the other faction result languages as real operation outcomes,
  // not hand-mounted panels. Their commanders, medal copy and action rows are
  // all selected from the armed operation.
  await startCampaignOperation(ALLIES_OPERATION);
  await publishCampaignWin(ALLIES_OPERATION, [
    { id: 'sound', title: 'Sound the seam at the deep head', kind: 'primary', status: 'complete' },
    { id: 'party', title: 'Bring the survey party through', kind: 'primary', status: 'complete' },
    {
      id: 'gradient',
      title: 'Take the control reading inside five minutes',
      kind: 'secondary',
      status: 'complete',
      credits: 500,
    },
  ], 713);
  await capture('08-after-action-allies', '.vm-camp-after-action.is-allies', '.vm-camp-debrief-portrait');

  // Results do not deploy the next battle behind the player's back. Follow the
  // actual primary action and prove the campaign hands off through the next
  // dossier, where the new objectives, grade and commander can be reviewed.
  await page.locator('.vm-page-foot .vm-btn').filter({ hasText: 'NEXT OPERATION' }).click();
  await page.waitForFunction(() => (
    window.__vmShell?.getState() === 'briefing'
    && document.querySelector('.vm-camp-brief-title')?.textContent?.includes('02 · Instrument Room') === true
  ));
  await capture('13-next-operation-briefing', '.vm-camp-command-portrait', '.vm-camp-command-portrait');

  await startCampaignOperation(PACT_OPERATION);
  await publishCampaignWin(PACT_OPERATION, [
    { id: 'mast', title: 'Take the Allied instrument mast off them', kind: 'primary', status: 'complete' },
    { id: 'bore', title: 'Take the bore head intact', kind: 'secondary', status: 'complete', credits: 500 },
    { id: 'wade', title: 'Come round the cut by water', kind: 'secondary', status: 'complete', credits: 400 },
  ], 824);
  await capture('09-after-action-pact', '.vm-camp-after-action.is-pact', '.vm-camp-debrief-portrait');

  // The longest live-card state gets a dedicated real Reclamation operation.
  // Wait out its four-second authored opener, clear it, then publish one actual
  // three-page Tallow transmission and prove both edge states in pixels.
  await startCampaignOperation(RECLAMATION_FINALE);
  await page.waitForFunction(() => document.querySelectorAll('.vm-comms-history-row').length >= 2);
  await page.evaluate(() => {
    window.__vmHud?.campaignComms.clear();
    window.__vmShell.playCampaignBeat({
      kind: 'dialogue',
      speaker: 'Tallow',
      text: 'Endorsed to the four houses jointly and without recourse. We cannot be paid to read it, leaned on to alter it, or answered to when a house refuses a line. Nine yards became four paying for that book, and today we gave it away. I would do it in the same order again. A record everybody may check is the only property worth more once you stop owning it. Take the company name off the spine on your way out. It was never the name that made it true.',
    });
    if (window.__vmHud !== undefined) window.__vmHud.campaignComms.frame = () => {};
  });
  await page.waitForFunction(() => (
    document.querySelector('.vm-comms-page')?.textContent?.trim() === '1 / 3'
    && document.querySelector('.vm-comms-action.is-next')?.textContent?.trim() === 'NEXT (2)'
  ));
  await capture('10-paged-transmission-first', '.vm-campaign-comms.is-reclamation:not([hidden])', '.vm-comms-portrait:not([hidden])');
  await page.locator('.vm-comms-action.is-next').click();
  await page.waitForFunction(() => (
    document.querySelector('.vm-comms-page')?.textContent?.trim() === '2 / 3'
    && document.querySelector('.vm-comms-action.is-next')?.textContent?.trim() === 'NEXT (1)'
  ));
  await page.locator('.vm-comms-action.is-next').click();
  await page.waitForFunction(() => (
    document.querySelector('.vm-comms-page')?.textContent?.trim() === '3 / 3'
    && document.querySelector('.vm-comms-action.is-next')?.textContent?.trim() === 'CLOSE'
  ));
  await capture('11-paged-transmission-final', '.vm-campaign-comms.is-reclamation:not([hidden])', '.vm-comms-portrait:not([hidden])');
  await page.evaluate(() => window.__vmHud?.campaignComms.clear());
  await publishCampaignWin(RECLAMATION_FINALE, [
    {
      id: 'counter',
      title: 'Take the district exchange back off the establishment, standing',
      kind: 'primary',
      status: 'complete',
    },
    {
      id: 'endorse',
      title: 'Hold all four bonded stores at once for the reading, from the hour until four',
      kind: 'primary',
      status: 'complete',
    },
    {
      id: 'yard',
      title: 'Finish the day with the last yard on this road still on our books',
      kind: 'secondary',
      status: 'complete',
    },
  ], 1316);
  await capture('12-after-action-reclamation', '.vm-camp-after-action.is-reclamation', '.vm-camp-debrief-portrait');

  await startCampaignOperation(FINALE_OPERATION);
  await page.evaluate((operation) => {
    window.__vmShell.publishCampaignResult({
      operationId: operation,
      medal: 3,
      reason: '',
      objectives: [
        {
          id: 'return',
          title: 'Post the quarter: thirty thousand banked, with the seam still working',
          kind: 'primary',
          status: 'complete',
        },
        {
          id: 'interim',
          title: 'Send an interim seventeen thousand before the twelve-minute bell',
          kind: 'secondary',
          status: 'complete',
          credits: 500,
        },
        {
          id: 'paper',
          title: "Take the establishment's own return off them",
          kind: 'secondary',
          status: 'complete',
          credits: 600,
        },
      ],
    });
    window.__vmShell.endMatch({ won: true, durationSec: 1188, wallSec: 1188 });
  }, FINALE_OPERATION);
  await capture('05-campaign-finale', '.vm-camp-finale', '.vm-camp-debrief-portrait');

  // PROGRESSION STATES ARE PRODUCT SURFACES, NOT ARITHMETIC. Retire the last
  // operation, clear this isolated capture profile, then write through the real
  // progression handle so the selector is graded in fresh, partial and fully
  // completed states. This catches medal, current-row and lock-copy failures
  // that a pristine profile can never expose.
  await page.evaluate(() => window.__vmShell.quitToMenu());
  await page.waitForFunction(() => window.__vmShell?.getState() === 'menu');
  await page.evaluate(() => {
    window.__vmProgression.resetProfile();
    window.__vmProgression.recordCampaignOperation('soviets.01.first-tap', 3);
    window.__vmProgression.recordCampaignOperation('soviets.02.common-standard', 2);
    window.__vmProgression.recordCampaignOperation('soviets.03.deep-sector', 1);
    window.__vmShell.openCampaign();
  });
  await page.waitForFunction(() => (
    document.querySelector('.vm-camp-overall-copy')?.textContent?.trim() === '3 / 37 complete · 1 gold'
    && document.querySelector('.vm-camp-op.is-current')?.getAttribute('data-operation-id')
      === 'soviets.04.company-town'
  ));
  await capture('14-selector-progress', '.vm-camp-op.is-current', '.vm-camp-card-portrait');

  // Discover the shipped operation ids from the selector itself rather than
  // duplicating a 37-row list in the harness. Stable data attributes are the
  // automation contract; authored titles remain free to improve.
  const operationIds = await page.evaluate(() => {
    const ids = [];
    for (const card of document.querySelectorAll('.vm-camp-card[data-chapter-id]')) {
      if (!(card instanceof HTMLButtonElement)) continue;
      card.click();
      for (const row of document.querySelectorAll('.vm-camp-op[data-operation-id]')) {
        const id = row.getAttribute('data-operation-id');
        if (id !== null) ids.push(id);
      }
    }
    return ids;
  });
  if (operationIds.length !== 37 || new Set(operationIds).size !== 37) {
    throw new Error(`campaign selector exposed ${operationIds.length} operation ids, expected 37 unique rows`);
  }
  await page.evaluate((ids) => {
    for (let i = 0; i < ids.length; i++) {
      window.__vmProgression.recordCampaignOperation(ids[i], (i % 3) + 1);
    }
    window.__vmShell.openCampaign();
  }, operationIds);
  await page.waitForFunction(() => (
    document.querySelector('.vm-camp-overall-copy')?.textContent?.startsWith('37 / 37 complete') === true
    && document.querySelectorAll('.vm-camp-card.is-complete').length === 4
  ));
  await capture('15-selector-complete', '.vm-camp-card.is-complete', '.vm-camp-card-portrait');

  await page.evaluate((operation) => window.__vmShell.openBriefing(operation), OPERATION);
  await page.waitForFunction(() => (
    document.querySelector('.vm-camp-brief-record-value')?.textContent?.trim() === 'Gold Medal'
  ));
  await capture('16-replay-briefing-medal', '.vm-camp-brief-record', '.vm-camp-command-portrait');

  if (faults.length > 0) {
    throw new Error(`campaign capture emitted browser errors:\n${faults.join('\n')}`);
  }
  console.log(`> campaign visual QA complete: ${captureCount} captures`);
} finally {
  await browser?.close();
  server.stop();
}
