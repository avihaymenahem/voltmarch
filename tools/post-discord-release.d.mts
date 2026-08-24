export interface GitHubRelease {
  readonly name: string;
  readonly tagName: string;
  readonly url: string;
  readonly body: string;
  readonly publishedAt: string;
}

export interface DiscordReleasePayload {
  readonly username: string;
  readonly content: string;
  readonly allowed_mentions: { readonly parse: readonly string[] };
  readonly embeds: readonly [{
    readonly title: string;
    readonly url: string;
    readonly description: string;
    readonly color: number;
    readonly fields: readonly { readonly name: string; readonly value: string; readonly inline: boolean }[];
    readonly footer: { readonly text: string };
    readonly timestamp?: string;
  }];
}

export function validateWebhookUrl(raw: unknown): string;
export function normaliseRelease(raw: unknown): GitHubRelease;
export function releaseLog(release: GitHubRelease): string;
export function discordPayload(release: GitHubRelease): DiscordReleasePayload;
export function releaseFromGitHub(tag: string): GitHubRelease;
export function postRelease(
  webhook: string,
  release: GitHubRelease,
  fetchImpl?: typeof fetch,
): Promise<void>;
