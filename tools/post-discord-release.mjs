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
const RELEASE_FIELDS = 'name,body,url,tagName,publishedAt,assets';
const DEPLOY_TARGETS = ['desktop', 'relay'];
const TARGET_COPY = {
  desktop: { label: 'Windows desktop', url: null },
  relay: { label: 'Multiplayer relay', url: null },
};

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
  const assets = Array.isArray(raw.assets)
    ? raw.assets.flatMap((asset) => {
      if (typeof asset === 'string') return [asset];
      return asset !== null && typeof asset === 'object' && typeof asset.name === 'string'
        ? [asset.name]
        : [];
    })
    : [];
  return { name, tagName, url, body, publishedAt, assets };
}

/**
 * A release post is a deployment receipt, not a guess based on release notes.
 * The workflow supplies only surfaces it verified for this exact commit.
 */
export function normaliseDeployment(raw, release) {
  if (raw === null || typeof raw !== 'object') throw new Error('deployment receipt is required');
  const source = Array.isArray(raw.targets)
    ? raw.targets
    : typeof raw.targets === 'string' ? raw.targets.split(',') : [];
  const targets = [...new Set(source.map((target) => String(target).trim()).filter(Boolean))];
  if (targets.length === 0) throw new Error('deployment.targets must name at least one surface');
  for (const target of targets) {
    if (!DEPLOY_TARGETS.includes(target)) throw new Error(`unknown deployment target: ${target}`);
  }

  const sha = required(raw.sha, 'deployment.sha');
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) throw new Error('deployment.sha is not a Git commit');

  // A desktop claim is true only when the complete updater set exists. This
  // prevents Discord from advertising an installer that auto-update cannot use.
  if (targets.includes('desktop')) {
    const version = release.tagName.replace(/^v/, '');
    const expected = [
      `VOLTMARCH-Setup-${version}.exe`,
      `VOLTMARCH-Setup-${version}.exe.blockmap`,
      `VOLTMARCH-${version}-portable.exe`,
      'latest.yml',
    ];
    const missing = expected.filter((name) => !release.assets.includes(name));
    if (missing.length > 0) throw new Error(`desktop release is incomplete: ${missing.join(', ')}`);
  }

  return { targets, sha };
}

function excerpt(text) {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  const suffix = '\n\n_The complete release log is attached below._';
  const room = EMBED_DESCRIPTION_LIMIT - suffix.length - 1;
  const candidate = text.slice(0, room);
  const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
  return `${candidate.slice(0, breakAt > room * 0.72 ? breakAt : room).trimEnd()}…${suffix}`;
}

function targetLine(target, release) {
  const copy = TARGET_COPY[target];
  const url = target === 'desktop' ? release.url : copy.url;
  return url === null ? copy.label : `[${copy.label}](${url})`;
}

export function releaseLog(release, deployment) {
  return [
    `# ${release.name}`,
    '',
    `Version: ${release.tagName}`,
    `Commit: ${deployment.sha}`,
    `Release: ${release.url}`,
    release.publishedAt.length > 0 ? `Published: ${release.publishedAt}` : '',
    '',
    '## Verified deployment surfaces',
    '',
    ...deployment.targets.map((target) => `- ${targetLine(target, release)}`),
    '',
    release.body,
    '',
  ].filter((line, index, all) => line.length > 0 || all[index - 1] !== '').join('\n');
}

export function discordPayload(release, deployment) {
  const omitted = DEPLOY_TARGETS.filter((target) => !deployment.targets.includes(target));
  return {
    username: 'VOLTMARCH // Release Command',
    content: '## VERIFIED DEPLOYMENT',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${release.name} deployed`,
      url: release.url,
      description: excerpt(release.body),
      color: 0x19d5ff,
      fields: [
        { name: 'VERSION', value: `\`${release.tagName}\``, inline: true },
        { name: 'COMMIT', value: `\`${deployment.sha.slice(0, 12)}\``, inline: true },
        {
          name: 'DEPLOYED',
          value: deployment.targets.map((target) => targetLine(target, release)).join('\n'),
          inline: false,
        },
        ...(omitted.length > 0 ? [{
          name: 'NOT IN THIS DEPLOY',
          value: omitted.map((target) => TARGET_COPY[target].label).join('\n'),
          inline: false,
        }] : []),
        { name: 'DOWNLOADS & NOTES', value: `[Open the GitHub release](${release.url})`, inline: false },
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

function makeForm(release, deployment) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(discordPayload(release, deployment)));
  form.append(
    'files[0]',
    new Blob([releaseLog(release, deployment)], { type: 'text/markdown;charset=utf-8' }),
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

export async function postRelease(webhook, release, deployment, fetchImpl = fetch) {
  const url = validateWebhookUrl(webhook);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { method: 'POST', body: makeForm(release, deployment) });
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
  const deployment = normaliseDeployment({
    targets: required(process.env.VM_DEPLOYED_TARGETS, 'VM_DEPLOYED_TARGETS'),
    sha: required(process.env.VM_DEPLOYED_SHA, 'VM_DEPLOYED_SHA'),
  }, release);
  await postRelease(webhook, release, deployment);
  console.log(
    `Discord release announcement posted for ${release.tagName}: ${deployment.targets.join(', ')}.`,
  );
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
