import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GAME_SPEEDS } from '../src/core/config';
import { SPEEDS } from '../src/shell/settings-store';

const SRC = join(__dirname, '..', 'src');
const source = (file: string): string => readFileSync(join(SRC, file), 'utf8');

describe('UI bug round', () => {
  it('keeps setup and runtime speed tables aligned through 2.5x', () => {
    expect(SPEEDS).toEqual([...GAME_SPEEDS]);
    expect(GAME_SPEEDS.at(-1)).toBe(2.5);
  });

  it('routes the rebindable speed action to the live loop', () => {
    const shell = source('shell/Shell.ts');
    expect(shell).toContain("bindings['sys.speed']");
    expect(shell).toContain('loop.cycleSpeed();');
    expect(source('input/ActionCatalogue.ts')).not.toContain(
      "id: 'sys.speed',\n    label: 'Cycle Game Speed',\n    description: 'Reserved.",
    );
  });

  it('shows one multiplayer workflow at a time and makes public discovery the default', () => {
    const lobby = source('shell/MultiplayerSetup.ts');
    expect(lobby).toContain('this.buildIdentity(frame.body);');
    expect(lobby).toContain("this.buildWorkflowNav(frame.body);");
    expect(lobby).toContain('this.buildFind(this.findPanel);');
    expect(lobby).toContain('this.buildHost(this.hostPanel);');
    expect(lobby).toContain("this.showWorkflow('find');");
    expect(lobby).toContain("'section', 'vm-mp-browser'");
    expect(lobby).toContain("'span', 'vm-mp-room-action', 'Join'");
    expect(lobby).toContain("'Host a Public Match'");
  });

  it('recovers a dropped lobby session without claiming match rejoin support', () => {
    const lobby = source('shell/MultiplayerSetup.ts');
    const session = source('net/Session.ts');
    expect(lobby).toContain('this.scheduleReconnect();');
    expect(lobby).toContain('this.session?.reconnectLobby()');
    expect(session).toContain('reconnectLobby(): boolean');
    expect(session).toContain('this.slot !== -1');
  });

  it('darkens native select popups and gives result actions room', () => {
    const css = source('shell/shell.css');
    expect(css).toContain('.vm-shell select option');
    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('width: min(1040px, 96vw);');
    expect(css).toContain('grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));');
    expect(css).toContain('.vm-menu-nav > .vm-btn.is-primary');
  });

  it('surfaces the exact production refusal when a blocked cameo is clicked', () => {
    const hud = source('ui/Hud.ts');
    expect(hud).toContain("`Cannot build ${cameo.name}`");
    expect(hud).toContain('lockedSentence(cameo.reason');
    expect(hud).toContain("`build-blocked:${cameo.key}`");
  });
});
