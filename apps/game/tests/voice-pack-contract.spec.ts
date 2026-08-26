import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BARKS, type BarkCategory, type BarkClass } from '../src/audio/Barks';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PUBLIC_VOICE = join(ROOT, 'apps/game/public/audio/voice');

interface TakeRecord {
  transcript: string;
  sourceContainer: string;
  sourceSampleRate: number;
  sourceChannels: number;
  sourceSha256: string;
  deliveryFile: string;
  deliverySha256: string;
  deliverySampleRate: number;
  deliveryChannels: number;
  deliveryDurationSeconds: number;
}

interface PackRecord {
  packId: string;
  provider: string;
  model: string;
  sourceNote: string;
  takes: TakeRecord[];
}

interface PackContract {
  packId: string;
  barkClass: BarkClass;
  provenance: string;
  sourceContainer: string;
  maxDurationSeconds: number;
  categories: readonly BarkCategory[];
  takeCount: number;
}

const PACKS: PackContract[] = [
  {
    packId: 'AL-ARM',
    barkClass: 'allied_vehicle',
    provenance: 'AL-ARM_v1.json',
    sourceContainer: 'MP3',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire'],
    takeCount: 12,
  },
  {
    packId: 'SV-ARM',
    barkClass: 'soviet_vehicle',
    provenance: 'SV-ARM_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire'],
    takeCount: 12,
  },
  {
    packId: 'MR-ARM',
    barkClass: 'meridian_vehicle',
    provenance: 'MR-ARM_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire'],
    takeCount: 12,
  },
  {
    packId: 'RC-ARM',
    barkClass: 'reclaim_vehicle',
    provenance: 'RC-ARM_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire'],
    takeCount: 12,
  },
  {
    packId: 'AL-INF-A',
    barkClass: 'allied_infantry',
    provenance: 'AL-INF-A_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'AL-INF-B',
    barkClass: 'allied_infantry_f',
    provenance: 'AL-INF-B_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'SV-INF-A',
    barkClass: 'soviet_infantry',
    provenance: 'SV-INF-A_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'SV-INF-B',
    barkClass: 'soviet_infantry_f',
    provenance: 'SV-INF-B_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'MR-INF-A',
    barkClass: 'meridian_infantry',
    provenance: 'MR-INF-A_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'MR-INF-B',
    barkClass: 'meridian_infantry_f',
    provenance: 'MR-INF-B_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'RC-INF-A',
    barkClass: 'reclaim_infantry',
    provenance: 'RC-INF-A_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'RC-INF-B',
    barkClass: 'reclaim_infantry_f',
    provenance: 'RC-INF-B_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'underFire', 'deploy'],
    takeCount: 17,
  },
  {
    packId: 'AL-HARV',
    barkClass: 'allied_harvester',
    provenance: 'AL-HARV_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: [
      'select', 'move', 'stop', 'underFire', 'criticalDamage',
      'harvest', 'cargoFull', 'returnToRefinery',
    ],
    takeCount: 22,
  },
  {
    packId: 'SV-HARV',
    barkClass: 'soviet_harvester',
    provenance: 'SV-HARV_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: [
      'select', 'move', 'stop', 'underFire', 'criticalDamage',
      'harvest', 'cargoFull', 'returnToRefinery',
    ],
    takeCount: 22,
  },
  {
    packId: 'MR-HARV',
    barkClass: 'meridian_harvester',
    provenance: 'MR-HARV_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: [
      'select', 'move', 'stop', 'underFire', 'criticalDamage',
      'harvest', 'cargoFull', 'returnToRefinery',
    ],
    takeCount: 22,
  },
  {
    packId: 'RC-HARV',
    barkClass: 'reclaim_harvester',
    provenance: 'RC-HARV_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: [
      'select', 'move', 'stop', 'underFire', 'criticalDamage',
      'harvest', 'cargoFull', 'returnToRefinery',
    ],
    takeCount: 22,
  },
  {
    packId: 'AL-BUILD',
    barkClass: 'allied_builder',
    provenance: 'AL-BUILD_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'deploy'],
    takeCount: 16,
  },
  {
    packId: 'SV-BUILD',
    barkClass: 'soviet_builder',
    provenance: 'SV-BUILD_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'deploy'],
    takeCount: 16,
  },
  {
    packId: 'MR-BUILD',
    barkClass: 'meridian_builder',
    provenance: 'MR-BUILD_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'deploy'],
    takeCount: 16,
  },
  {
    packId: 'RC-BUILD',
    barkClass: 'reclaim_builder',
    provenance: 'RC-BUILD_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'deploy'],
    takeCount: 16,
  },
  {
    packId: 'AL-SPEC',
    barkClass: 'allied_specialist',
    provenance: 'AL-SPEC_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'capture', 'repair'],
    takeCount: 20,
  },
  {
    packId: 'SV-SPEC',
    barkClass: 'soviet_specialist',
    provenance: 'SV-SPEC_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'capture', 'repair'],
    takeCount: 20,
  },
  {
    packId: 'MR-SPEC',
    barkClass: 'meridian_specialist',
    provenance: 'MR-SPEC_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'capture', 'repair'],
    takeCount: 20,
  },
  {
    packId: 'RC-SPEC',
    barkClass: 'reclaim_specialist',
    provenance: 'RC-SPEC_v1.json',
    sourceContainer: 'WAV',
    maxDurationSeconds: 2,
    categories: ['select', 'move', 'stop', 'underFire', 'criticalDamage', 'capture', 'repair'],
    takeCount: 20,
  },
  {
    packId: 'AL-TRANS',
    barkClass: 'allied_transport',
    provenance: 'AL-TRANS_v1.json', sourceContainer: 'WAV', maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'stop', 'guard', 'patrol', 'underFire', 'criticalDamage', 'unload'],
    takeCount: 24,
  },
  {
    packId: 'SV-TRANS',
    barkClass: 'soviet_transport',
    provenance: 'SV-TRANS_v1.json', sourceContainer: 'WAV', maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'stop', 'guard', 'patrol', 'underFire', 'criticalDamage', 'unload'],
    takeCount: 24,
  },
  {
    packId: 'MR-TRANS',
    barkClass: 'meridian_transport',
    provenance: 'MR-TRANS_v1.json', sourceContainer: 'WAV', maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'stop', 'guard', 'patrol', 'underFire', 'criticalDamage', 'unload'],
    takeCount: 24,
  },
  {
    packId: 'RC-TRANS',
    barkClass: 'reclaim_transport',
    provenance: 'RC-TRANS_v1.json', sourceContainer: 'WAV', maxDurationSeconds: 2,
    categories: ['select', 'move', 'attack', 'stop', 'guard', 'patrol', 'underFire', 'criticalDamage', 'unload'],
    takeCount: 24,
  },
];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe.each(PACKS)('the original $packId voice pack', (contract) => {
  const provenance = join(ROOT, 'docs/voice/generated', contract.provenance);
  const pack = JSON.parse(readFileSync(provenance, 'utf8')) as PackRecord;

  it('has one exact recorded take for every declared runtime line', () => {
    const runtimeLines = contract.categories
      .flatMap((category) => BARKS[contract.barkClass][category]?.map((line) => line.text) ?? []);
    expect(pack.takes.map((take) => take.transcript)).toEqual(runtimeLines);
    expect(pack.takes).toHaveLength(contract.takeCount);
  });

  it('ships hash-matched 48 kHz mono derivatives under its stable pack id', () => {
    expect(pack.packId).toBe(contract.packId);
    expect(pack.provider).toBe('ElevenLabs');
    expect(pack.model).toBe('eleven_v3');
    for (const take of pack.takes) {
      const delivery = join(PUBLIC_VOICE, take.deliveryFile);
      expect(existsSync(delivery), `missing ${take.deliveryFile}`).toBe(true);
      expect(sha256(delivery), `${take.deliveryFile} changed without provenance`).toBe(take.deliverySha256);
      expect(take.deliverySampleRate).toBe(48_000);
      expect(take.deliveryChannels).toBe(1);
      expect(take.deliveryDurationSeconds).toBeLessThanOrEqual(contract.maxDurationSeconds);
    }
  });

  it('records source container truth and immutable hashes', () => {
    expect(pack.takes.every((take) => take.sourceContainer === contract.sourceContainer)).toBe(true);
    expect(pack.takes.every((take) => /^[a-f0-9]{64}$/.test(take.sourceSha256))).toBe(true);
  });
});

describe('source-specific voice pack provenance', () => {
  const allied = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/AL-ARM_v1.json'), 'utf8')) as PackRecord;
  const soviet = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/SV-ARM_v1.json'), 'utf8')) as PackRecord;
  const meridian = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/MR-ARM_v1.json'), 'utf8')) as PackRecord;
  const reclamation = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/RC-ARM_v1.json'), 'utf8')) as PackRecord;
  const alliedInfantry = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/AL-INF-A_v1.json'), 'utf8')) as PackRecord;
  const alliedInfantryB = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/AL-INF-B_v1.json'), 'utf8')) as PackRecord;
  const sovietInfantry = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/SV-INF-A_v1.json'), 'utf8')) as PackRecord;
  const sovietInfantryB = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/SV-INF-B_v1.json'), 'utf8')) as PackRecord;
  const meridianInfantry = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/MR-INF-A_v1.json'), 'utf8')) as PackRecord;
  const meridianInfantryB = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/MR-INF-B_v1.json'), 'utf8')) as PackRecord;
  const reclaimInfantry = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/RC-INF-A_v1.json'), 'utf8')) as PackRecord;
  const reclaimInfantryB = JSON.parse(readFileSync(join(ROOT, 'docs/voice/generated/RC-INF-B_v1.json'), 'utf8')) as PackRecord;

  it('documents the Allied API playground payload rather than trusting renamed extensions', () => {
    expect(allied.sourceNote).toMatch(/MP3 payloads?[\s\S]*output\.bin/i);
  });

  it('documents the Soviet direct 48 kHz mono WAV export', () => {
    expect(soviet.sourceNote).toMatch(/mono 48 kHz PCM WAV/i);
    expect(soviet.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(soviet.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the Meridian direct 48 kHz mono WAV export', () => {
    expect(meridian.sourceNote).toMatch(/mono 48 kHz PCM WAV/i);
    expect(meridian.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(meridian.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the Reclamation direct 48 kHz mono WAV export', () => {
    expect(reclamation.sourceNote).toMatch(/mono 48 kHz PCM WAV/i);
    expect(reclamation.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(reclamation.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the Allied infantry direct 48 kHz mono WAV export', () => {
    expect(alliedInfantry.sourceNote).toMatch(/mono 48 kHz PCM WAV/i);
    expect(alliedInfantry.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(alliedInfantry.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the second Allied infantry API-generated WAV export', () => {
    expect(alliedInfantryB.sourceNote).toMatch(/project automation[\s\S]*ElevenLabs API/i);
    expect(alliedInfantryB.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(alliedInfantryB.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the selected Soviet infantry API-generated WAV export', () => {
    expect(sovietInfantry.sourceNote).toMatch(/project automation[\s\S]*Candidate 2/i);
    expect(sovietInfantry.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(sovietInfantry.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the second selected Soviet infantry API-generated WAV export', () => {
    expect(sovietInfantryB.sourceNote).toMatch(/project automation[\s\S]*Candidate 2/i);
    expect(sovietInfantryB.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(sovietInfantryB.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the selected Meridian infantry API-generated WAV export', () => {
    expect(meridianInfantry.sourceNote).toMatch(/project automation[\s\S]*Candidate 2/i);
    expect(meridianInfantry.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(meridianInfantry.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the second selected Meridian infantry API-generated WAV export', () => {
    expect(meridianInfantryB.sourceNote).toMatch(/project automation[\s\S]*Candidate 3/i);
    expect(meridianInfantryB.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(meridianInfantryB.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the selected Reclamation infantry API-generated WAV export', () => {
    expect(reclaimInfantry.sourceNote).toMatch(/project automation[\s\S]*Candidate 3/i);
    expect(reclaimInfantry.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(reclaimInfantry.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });

  it('documents the second selected Reclamation infantry API-generated WAV export', () => {
    expect(reclaimInfantryB.sourceNote).toMatch(/project automation[\s\S]*Candidate 1/i);
    expect(reclaimInfantryB.takes.every((take) => take.sourceSampleRate === 48_000)).toBe(true);
    expect(reclaimInfantryB.takes.every((take) => take.sourceChannels === 1)).toBe(true);
  });
});
