import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('voiceover presentation wiring', () => {
  it('sends both announcer and unit captions to the dedicated HUD surface', () => {
    const audio = read('apps/game/src/audio/audio.system.ts');
    expect(audio).toContain("onSubtitle: subtitle('EVA')");
    expect(audio).toContain("onSubtitle: subtitle('UNIT')");
    expect(audio).toContain('voiceSubtitle?.(speaker, text, dwellSec)');

    const hud = read('apps/game/src/ui/Hud.ts');
    expect(hud).toContain('voiceSubtitle(speaker: string, text: string, dwellSec: number)');
    expect(hud).toContain('gameplay?.subtitles === false');
  });

  it('does not duplicate Unit Ready at both HUD edges', () => {
    const hud = read('apps/game/src/ui/Hud.ts');
    expect(hud).not.toContain("[EvaLine.UnitReady]: ['info', 'Unit ready']");
    expect(hud).toContain('ConstructionComplete` and `UnitReady` are deliberately ABSENT');
    expect(hud).toContain("bus.on('production:ready'");
  });

  it('keeps voice controls independent of mixer volume', () => {
    const settings = read('apps/game/src/shell/Settings.ts');
    expect(settings).toContain("'Strategic Announcer'");
    expect(settings).toContain("'Unit Responses'");
    expect(settings).toContain('setAnnouncerEnabled(settings.audio.announcer)');
    expect(settings).toContain('setBarkMode(');
  });

  it('cannot leak completed speech into the shared voice budget', () => {
    const engine = read('apps/game/src/audio/AudioEngine.ts');
    const eva = read('apps/game/src/audio/Eva.ts');
    const barks = read('apps/game/src/audio/Barks.ts');

    expect(engine).toContain('export interface PlayedBufferVoice');
    expect(engine).toContain('this.releaseVoice(voice);');
    expect(engine).toContain('onEnded(callback: () => void): void');
    expect(eva).toContain('played.onEnded(() => {');
    expect(barks).toContain('played.onEnded(() => {');
    expect(eva).not.toContain('played.source.onended =');
    expect(barks).not.toContain('played.source.onended =');
  });

  it('routes the real content key before falling back to broad entity flags', () => {
    const audio = read('apps/game/src/audio/audio.system.ts');
    const realKey = audio.indexOf('let hint = contentKeyOf(world, i)');
    const harvesterFallback = audio.indexOf('EntityFlag.IsHarvester', realKey);
    expect(realKey).toBeGreaterThan(-1);
    expect(harvesterFallback).toBeGreaterThan(realKey);
  });

  it('keeps all newly connected acknowledgement and EVA routes visible', () => {
    const audio = read('apps/game/src/audio/audio.system.ts');
    expect(audio).toContain("[OrderKind.Capture]: 'capture'");
    expect(audio).toContain("eva?.say('allyUnderAttack')");
    expect(audio).toContain("eva?.say('battleControlTerminated')");
    expect(audio).toContain("if (p.isBuilding) eva?.say('building')");

    const production = read('apps/game/src/sim/Production.ts');
    expect(production).toContain('EvaLine.NewRallyPoint');
    expect(production).toContain('EvaLine.PrimaryBuildingSelected');

    const repairSell = read('apps/game/src/sim/RepairSell.ts');
    expect(repairSell).toContain('EvaLine.Repairing');
  });

  it('keeps tactical acknowledgements outside broad legacy categories', () => {
    const audio = read('apps/game/src/audio/audio.system.ts');
    expect(audio).toContain("[OrderKind.AttackMove]: 'attackMove'");
    expect(audio).toContain("[OrderKind.Stop]: 'stop'");
    expect(audio).toContain("[OrderKind.Guard]: 'guard'");
    expect(audio).toContain("[OrderKind.Patrol]: 'patrol'");
    expect(audio).toContain("[OrderKind.Scatter]: 'scatter'");
    expect(audio).toContain("[OrderKind.Harvest]: 'harvest'");
    expect(audio).toContain("[OrderKind.Repair]: 'repair'");
    expect(audio).toContain("[OrderKind.Enter]: 'enterTransport'");
    expect(audio).toContain("[OrderKind.Unload]: 'unload'");
    expect(audio).toContain("[OrderKind.UseAbility]: 'ability'");
    const barks = read('apps/game/src/audio/Barks.ts');
    expect(barks).toContain('BARK_CATEGORY_FALLBACK');
    expect(barks).toContain("criticalDamage: 'underFire'");
    expect(barks).toContain("veterancy: 'select'");
    expect(barks).toContain("return '__synthetic__.cargoFull'");

    const harvesting = read('apps/game/src/sim/Harvesting.ts');
    expect(harvesting).toContain("this.emitVoiceState(i, id, 'harvest')");
    expect(harvesting).toContain("this.emitVoiceState(i, id, 'cargoFull')");
    expect(harvesting).toContain("this.emitVoiceState(i, id, 'returnToRefinery')");
  });

  it('never plays autonomous unit chatter without player intent', () => {
    const audio = read('apps/game/src/audio/audio.system.ts');
    const damaged = audio.slice(
      audio.indexOf("bus.on('entity:damaged'"),
      audio.indexOf("bus.on('entity:killed'"),
    );
    const playerIntent = audio.slice(audio.indexOf('player intent: the ONLY source of unit speech'));

    expect(audio).not.toContain("bus.on('harvester:state'");
    expect(audio).not.toContain("bus.on('entity:veterancy'");
    expect(damaged).not.toContain('barkFor(');
    const captured = audio.slice(
      audio.indexOf("bus.on('building:captured'"),
      audio.indexOf("bus.on('building:sold'"),
    );
    expect(captured).not.toContain('barkFor(');
    expect(playerIntent).toContain("bus.on('selection:changed'");
    expect(playerIntent).toContain("bus.on('order:issued'");
  });
});
