import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isNewerVersion, releaseNotesText } from '../desktop/src/update-state';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('desktop release version comparison', () => {
  it('orders stable numeric versions without accepting malformed or prerelease tags', () => {
    expect(isNewerVersion('3.2.0', '3.1.9')).toBe(true);
    expect(isNewerVersion('v4.0.0', '3.99.99')).toBe(true);
    expect(isNewerVersion('3.1.0', '3.1.0')).toBe(false);
    expect(isNewerVersion('3.0.9', '3.1.0')).toBe(false);
    expect(isNewerVersion('3.2.0-beta.1', '3.1.0')).toBe(false);
    expect(isNewerVersion('latest', '3.1.0')).toBe(false);
  });

  it('normalises external release notes and caps their renderer payload', () => {
    expect(releaseNotesText([{ note: 'One\r\nline' }, { note: 'Two' }]))
      .toBe('One\nline\n\nTwo');
    expect(releaseNotesText('x'.repeat(3000))).toHaveLength(2400);
    expect(releaseNotesText({ html: '<script>bad()</script>' })).toBe('');
  });
});

describe('desktop updater shipping contract', () => {
  it('never auto-downloads and never interrupts a live match with its prompt', () => {
    const controller = read('desktop/src/updater.ts');
    const prompt = read('src/shell/DesktopUpdatePrompt.ts');
    expect(controller).toContain('autoUpdater.autoDownload = false');
    expect(controller).toContain('autoUpdater.autoInstallOnAppQuit = true');
    expect(controller).toContain("if (!app.isPackaged) return 'development'");
    expect(controller).toContain('PORTABLE_EXECUTABLE_DIR');
    expect(prompt).toContain("this.shellState !== 'menu'");
    expect(prompt).toContain('copy.textContent =');
    expect(prompt).not.toContain('innerHTML');
  });

  it('publishes exact updater metadata and URL-safe Windows asset names', () => {
    const builder = read('desktop/electron-builder.yml');
    const packager = read('desktop/dist.mjs');
    const workflow = read('.github/workflows/desktop.yml');
    expect(builder).toContain('artifactName: ${productName}-Setup-${version}.${ext}');
    expect(builder).toContain('artifactName: ${productName}-${version}-portable.${ext}');
    expect(workflow).toContain('latest.yml');
    expect(workflow).toContain('.exe.blockmap');
    expect(workflow).toContain('VOLTMARCH-Setup-$version.exe');
    expect(packager).toContain("'--publish', 'never'");
  });
});
