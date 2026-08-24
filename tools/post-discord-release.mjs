/**
 * Post one published GitHub release to the VOLTMARCH Discord channel.
 *
 * The GitHub release is the source of truth: this reads the exact generated
 * notes back through `gh`, then sends a short command-software card plus the
 * complete notes as a Markdown attachment. The webhook URL is accepted only
 * through the environment and is never printed.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EMBED_DESCRIPTION_LIMIT = 3800;
const MAX_ATTEMPTS = 4;
const RELEASE_FIELDS = 'name,body,url,tagName,publishedAt';

function required(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export function validateWebhookUrl(raw) {
  const value = required(raw, 'DISCORD_RELEASE_WEBHOOK_URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DISCORD_RELEASE_WEBHOOK_URL is not a valid URL');
  }
  const trustedHost = url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
  if (url.protocol !== 'https:' || !trustedHost || !/^\/api\/webhooks\/[^/]+\/[^/]+/.test(url.pathname)) {
    throw new Error('DISCORD_RELEASE_WEBHOOK_URL is not a Discord HTTPS webhook URL');
  }
  url.searchParams.set('wait', 'true');
  return url.toString();
}

export function normaliseRelease(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('GitHub returned no release');
  const name = required(raw.name, 'release.name');
  const tagName = required(raw.tagName, 'release.tagName');
  const url = required(raw.url, 'release.url');
  const body = typeof raw.body === 'string' && raw.body.trim().length > 0
    ? raw.body.trim()
    : 'Maintenance release. See GitHub for downloads and build details.';
  const publishedAt = typeof raw.publishedAt === 'string' ? raw.publishedAt : '';
  return { name, tagName, url, body, publishedAt };
}

function excerpt(text) {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  const suffix = '\n\n_The complete release log is attached below._';
  const room = EMBED_DESCRIPTION_LIMIT - suffix.length - 1;
  const candidate = text.slice(0, room);
  const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
  return `${candidate.slice(0, breakAt > room * 0.72 ? breakAt : room).trimEnd()}…${suffix}`;
}

export function releaseLog(release) {
  return [
    `# ${release.name}`,
    '',
    `Version: ${release.tagName}`,
    `Release: ${release.url}`,
    release.publishedAt.length > 0 ? `Published: ${release.publishedAt}` : '',
    '',
    release.body,
    '',
  ].filter((line, index, all) => line.length > 0 || all[index - 1] !== '').join('\n');
}

export function discordPayload(release) {
  return {
    username: 'VOLTMARCH // Release Command',
    content: '## COMMAND SOFTWARE UPDATE',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${release.name} is live`,
      url: release.url,
      description: excerpt(release.body),
      color: 0x19d5ff,
      fields: [
        { name: 'VERSION', value: `\`${release.tagName}\``, inline: true },
        { name: 'DOWNLOAD', value: `[Open the GitHub release](${release.url})`, inline: true },
      ],
      footer: { text: 'VOLTMARCH // COMMAND SOFTWARE' },
      ...(release.publishedAt.length > 0 ? { timestamp: release.publishedAt } : {}),
    }],
  };
}

export function releaseFromGitHub(tag) {
  const json = execFileSync(
    'gh',
    ['release', 'view', required(tag, 'release tag'), '--json', RELEASE_FIELDS],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return normaliseRelease(JSON.parse(json));
}

function attachmentName(tag) {
  const safe = tag.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `VOLTMARCH-${safe}-release-notes.md`;
}

function makeForm(release) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(discordPayload(release)));
  form.append(
    'files[0]',
    new Blob([releaseLog(release)], { type: 'text/markdown;charset=utf-8' }),
    attachmentName(release.tagName),
  );
  return form;
}

function retryDelay(response, attempt, body) {
  if (response.status === 429) {
    const fromBody = Number(body?.retry_after);
    if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody * 1000);
    const fromHeader = Number(response.headers.get('retry-after'));
    if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader * 1000);
  }
  return 750 * (2 ** attempt);
}

export async function postRelease(webhook, release, fetchImpl = fetch) {
  const url = validateWebhookUrl(webhook);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { method: 'POST', body: makeForm(release) });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay({ status: 0, headers: new Headers() }, attempt)));
      continue;
    }

    const text = await response.text();
    if (response.ok) return;

    let json = null;
    try { json = JSON.parse(text); } catch { /* Discord may return plain text upstream errors. */ }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`Discord rejected the release post (${response.status}): ${text.slice(0, 500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt, json)));
  }
}

async function main() {
  const tag = required(process.argv[2], 'release tag argument');
  const webhook = required(process.env.DISCORD_RELEASE_WEBHOOK_URL, 'DISCORD_RELEASE_WEBHOOK_URL');
  const release = releaseFromGitHub(tag);
  await postRelease(webhook, release);
  console.log(`Discord release announcement posted for ${release.tagName}.`);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
