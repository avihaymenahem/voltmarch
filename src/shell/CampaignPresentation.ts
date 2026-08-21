/**
 * Campaign presentation data that is safe to load with the shell.
 *
 * The authored operation table remains behind Campaign.ts's lazy boundary.
 * This file is deliberately tiny: it maps dialogue speaker names and the one
 * gold-master briefing to UI assets. A speaker without an entry still renders
 * through the generic transmission treatment, so presentation can land one
 * chapter at a time without making the other 36 operations unreadable.
 */

export interface CampaignSpeakerPresentation {
  readonly name: string;
  readonly role: string;
  readonly portrait: string;
  readonly monogram: string;
}

export interface CampaignBriefingPresentation {
  readonly commander: CampaignSpeakerPresentation;
  readonly directive: string;
  readonly theatre: string;
  readonly opposition: string;
  readonly channel: string;
}

function portrait(file: string): string {
  return `${import.meta.env.BASE_URL}campaign/portraits/${file}`;
}

const SPEAKERS: Readonly<Record<string, CampaignSpeakerPresentation>> = {
  Rakhalt: {
    name: 'Rakhalt',
    role: 'Directorate Command',
    portrait: portrait('rakhalt.webp'),
    monogram: 'RK',
  },
  Vosk: {
    name: 'Vosk',
    role: 'Field Operations',
    portrait: portrait('vosk.webp'),
    monogram: 'VK',
  },
};

const BRIEFINGS: Readonly<Record<string, CampaignBriefingPresentation>> = {
  'soviets.01.first-tap': {
    commander: SPEAKERS.Rakhalt,
    directive: 'Take the Allied survey tap. The three derricks stay with the town.',
    theatre: 'Arid seam district',
    opposition: 'Allied survey group',
    channel: 'March priority // 01',
  },
};

/**
 * Resolve an authored speaker label to a portrait identity.
 *
 * Intercepts are written as "Rakhalt, intercepted". The suffix describes the
 * channel, not a second character, so the identity is the text before the
 * comma. Unknown speakers keep their authored name and receive the generic
 * no-portrait treatment.
 */
export function campaignSpeaker(label: string): CampaignSpeakerPresentation {
  const base = label.split(',', 1)[0]?.trim() ?? label.trim();
  const known = SPEAKERS[base];
  if (known !== undefined) {
    if (!label.toLowerCase().includes('intercept')) return known;
    return { ...known, role: 'Intercepted Signal' };
  }
  const words = base.split(/\s+/).filter(Boolean);
  const monogram = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('') || 'TX';
  return {
    name: label,
    role: label.toLowerCase().includes('intercept') ? 'Intercepted Signal' : 'Field Transmission',
    portrait: '',
    monogram,
  };
}

export function campaignBriefing(operationId: string): CampaignBriefingPresentation | null {
  return BRIEFINGS[operationId] ?? null;
}
