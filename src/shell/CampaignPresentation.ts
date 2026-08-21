/**
 * Campaign presentation data that is safe to load with the shell.
 *
 * The authored operation table remains behind Campaign.ts's lazy boundary.
 * This file is deliberately tiny: it maps dialogue speaker names and the
 * gold-master operation loop to UI assets. A speaker without an entry still
 * renders through the generic transmission treatment, so presentation can
 * land one chapter at a time without making the other 36 operations unreadable.
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

export interface CampaignDebriefPresentation {
  readonly commander: CampaignSpeakerPresentation;
  readonly channel: string;
  readonly message: string;
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
  Wend: {
    name: 'Wend',
    role: 'Allied Survey Intelligence',
    portrait: portrait('wend.webp'),
    monogram: 'WD',
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
  'soviets.02.common-standard': {
    commander: SPEAKERS.Vosk,
    directive: 'Eight hulls. No yard, no replacements. Hold Survey 40 with five.',
    theatre: 'Temperate works corridor',
    opposition: 'Allied relief columns',
    channel: 'Field order // 02',
  },
  'soviets.03.deep-sector': {
    commander: SPEAKERS.Vosk,
    directive: 'Take the survey instruments off them, then take the tap properly.',
    theatre: 'Deep-sector survey seam',
    opposition: 'Allied survey camp',
    channel: 'Field order // 03',
  },
};

const DEBRIEFS: Readonly<Record<string, Readonly<{
  win: CampaignDebriefPresentation;
  loss: CampaignDebriefPresentation;
}>>> = {
  'soviets.01.first-tap': {
    win: {
      commander: SPEAKERS.Rakhalt,
      channel: 'Directorate assessment // 01',
      // The operation's own final line. The debrief repeats the verdict rather
      // than inventing a second version of what the commander thinks happened.
      message: 'Tap is off them. Get a survey team on that seam before the Works do.',
    },
    loss: {
      commander: SPEAKERS.Rakhalt,
      channel: 'Directorate assessment // 01',
      message: 'The tap is still Allied. Re-form the column and take it cleanly.',
    },
  },
  'soviets.02.common-standard': {
    win: {
      commander: SPEAKERS.Vosk,
      channel: 'Field assessment // 02',
      message: 'Pad is held. The Works publish what we hand them now.',
    },
    loss: {
      commander: SPEAKERS.Vosk,
      channel: 'Field assessment // 02',
      message: 'Nothing answering on the net. Survey 40 stays theirs.',
    },
  },
  'soviets.03.deep-sector': {
    win: {
      commander: SPEAKERS.Vosk,
      channel: 'Field assessment // 03',
      message: 'Tap is ours. Get our own reading on the record before the Works print theirs.',
    },
    loss: {
      commander: SPEAKERS.Vosk,
      channel: 'Field assessment // 03',
      message: 'The deep sector goes onto their standard tonight. Pull back what is left.',
    },
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

export function campaignDebrief(
  operationId: string,
  won: boolean,
): CampaignDebriefPresentation | null {
  const row = DEBRIEFS[operationId];
  if (row === undefined) return null;
  return won ? row.win : row.loss;
}
