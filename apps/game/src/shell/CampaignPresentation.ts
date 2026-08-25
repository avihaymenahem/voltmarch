/**
 * Campaign presentation data that is safe to load with the shell.
 *
 * The authored operation table remains behind Campaign.ts's lazy boundary.
 * This file is deliberately light: it maps dialogue speaker names and the
 * complete operation roster to UI assets without importing the authored
 * campaign table into the entry chunk. A speaker without an entry still
 * renders through the generic transmission treatment.
 */

export type CampaignTheme = 'allies' | 'pact' | 'reclamation' | 'soviets';

export interface CampaignSpeakerPresentation {
  readonly name: string;
  readonly role: string;
  readonly portrait: string;
  readonly monogram: string;
  readonly theme: CampaignTheme | 'neutral';
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

export interface CampaignDebriefContext {
  /** 0 none, 1 bronze, 2 silver, 3 gold. */
  readonly medal?: number;
  /** The authored objective title that ended a failed operation. */
  readonly failedObjective?: string;
}

export interface CampaignOperationIdentity {
  readonly id: string;
  readonly title: string;
  readonly chapterTitle: string;
  readonly theme: CampaignTheme;
}

export interface CampaignFinalePresentation {
  readonly title: string;
  readonly message: string;
}

export interface CampaignMedalStandard {
  readonly tier: 0 | 1 | 2 | 3;
  readonly label: string;
  readonly requirement: string;
}

const CAMPAIGN_MEDAL_STANDARDS: readonly CampaignMedalStandard[] = [
  { tier: 0, label: 'No Medal', requirement: 'No campaign award recorded' },
  { tier: 1, label: 'Bronze Medal', requirement: 'Operation complete' },
  { tier: 2, label: 'Silver Medal', requirement: 'All bonus objectives' },
  { tier: 3, label: 'Gold Medal', requirement: 'All bonus objectives · Hard or Brutal' },
];

function portrait(file: string): string {
  return `${import.meta.env.BASE_URL}campaign/portraits/${file}`;
}

const SPEAKERS: Readonly<Record<string, CampaignSpeakerPresentation>> = {
  Rakhalt: {
    name: 'Rakhalt',
    role: 'Directorate Command',
    portrait: portrait('rakhalt.webp'),
    monogram: 'RK',
    theme: 'soviets',
  },
  Vosk: {
    name: 'Vosk',
    role: 'Field Operations',
    portrait: portrait('vosk.webp'),
    monogram: 'VK',
    theme: 'soviets',
  },
  Wend: {
    name: 'Wend',
    role: 'Allied Survey Intelligence',
    portrait: portrait('wend.webp'),
    monogram: 'WD',
    theme: 'allies',
  },
  Aubray: {
    name: 'Aubray',
    role: 'Continental Field Command',
    portrait: portrait('aubray.webp'),
    monogram: 'AY',
    theme: 'allies',
  },
  Calvane: {
    name: 'Calvane',
    role: 'Meridian Conclave Command',
    portrait: portrait('calvane.webp'),
    monogram: 'CV',
    theme: 'pact',
  },
  Nael: {
    name: 'Nael',
    role: 'Pact Field Reader',
    portrait: portrait('nael.webp'),
    monogram: 'NL',
    theme: 'pact',
  },
  Tallow: {
    name: 'Tallow',
    role: 'Salvage House Principal',
    portrait: portrait('tallow.webp'),
    monogram: 'TW',
    theme: 'reclamation',
  },
  Cregg: {
    name: 'Cregg',
    role: 'Salvage House Broker',
    portrait: portrait('cregg.webp'),
    monogram: 'CG',
    theme: 'reclamation',
  },
  Bramm: {
    name: 'Bramm',
    role: 'Continental Survey Specialist',
    portrait: portrait('bramm.webp'),
    monogram: 'IB',
    theme: 'allies',
  },
  Hesk: {
    name: 'Hesk',
    role: 'Eleven Houses Representative',
    portrait: portrait('hesk.webp'),
    monogram: 'HK',
    theme: 'pact',
  },
  Oreth: {
    name: 'Oreth',
    role: 'Warden of the Count',
    portrait: portrait('oreth.webp'),
    monogram: 'OR',
    theme: 'pact',
  },
  Ardle: {
    name: 'Ardle',
    role: 'Depot Four Administration',
    portrait: portrait('ardle.webp'),
    monogram: 'AR',
    theme: 'allies',
  },
  Averill: {
    name: 'Averill',
    role: 'Continental Schedule Command',
    portrait: portrait('averill.webp'),
    monogram: 'AV',
    theme: 'allies',
  },
  Merrow: {
    name: 'Merrow',
    role: 'Continental Sector Registrar',
    portrait: portrait('merrow.webp'),
    monogram: 'MW',
    theme: 'allies',
  },
  Rathe: {
    name: 'Rathe',
    role: 'Continental Plant Authority',
    portrait: portrait('rathe.webp'),
    monogram: 'RT',
    theme: 'allies',
  },
  Sennet: {
    name: 'Sennet',
    role: 'Depot Nine Administration',
    portrait: portrait('sennet.webp'),
    monogram: 'SN',
    theme: 'allies',
  },
  Bardin: {
    name: 'Bardin',
    role: 'Directorate Allocation Command',
    portrait: portrait('bardin.webp'),
    monogram: 'BD',
    theme: 'soviets',
  },
  Skell: {
    name: 'Skell',
    role: 'Directorate Works Receiving',
    portrait: portrait('skell.webp'),
    monogram: 'SK',
    theme: 'soviets',
  },
  Tolvar: {
    name: 'Tolvar',
    role: 'Ninth Allocation Command',
    portrait: portrait('tolvar.webp'),
    monogram: 'TV',
    theme: 'soviets',
  },
};

const CAMPAIGN_PORTRAITS = [...new Set(Object.values(SPEAKERS).map((speaker) => speaker.portrait))];
let portraitsPrimed = false;

/**
 * Start the small campaign cast downloading when campaign UI is first opened.
 *
 * This is intentionally campaign-only rather than an index.html preload: a
 * skirmish player should not pay for portraits they will never see. Holding
 * the Image objects also lets async decoding finish before the briefing and
 * before the first trigger swaps one into the communications panel. Direct
 * operation launches call this again safely; the guard makes that a no-op.
 */
const primedPortraits: HTMLImageElement[] = [];
export function preloadCampaignPortraits(): void {
  if (portraitsPrimed || typeof Image === 'undefined') return;
  portraitsPrimed = true;
  for (const src of CAMPAIGN_PORTRAITS) {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    primedPortraits.push(image);
  }
}

const SPECIAL_BRIEFINGS: Readonly<Record<string, CampaignBriefingPresentation>> = {
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

const SPECIAL_DEBRIEFS: Readonly<Record<string, Readonly<{
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
 * Commander's intent, not a duplicate of the objective ledger.
 *
 * The objective rows remain the precise rules the simulation scores. These
 * lines tell the player how the operation fits the Allied campaign and, where
 * an operation has two primary rows, bind them into one coherent order.
 */
const AUTHORED_DIRECTIVES: Readonly<Record<string, string>> = {
  'allies.01.sounding-line':
    'Get the survey party to the deep head and hold the string until both readings close.',
  'allies.02.instrument-room':
    'Take the Works survey office intact. Keep a section inside until every page is copied.',
  'allies.03.ground-truth':
    'Reach Bramm before she strikes the final station. Bring her party and the rate series out.',
  'allies.04.misclosure':
    'Keep the reduction office standing until Bramm files. If you can spare the force, break the ridge muster.',
  'allies.05.forced-closure':
    'Stop the Ninth’s forced run before publication. We need the computing hall cold—and preferably whole.',
  'allies.06.machine-time':
    'Put four feeder houses on the works and keep the line unbroken until the reduction closes.',
  'allies.07.fair-copy':
    'Lodge the corrected series at both trunk heads before the counters shut. One head is not publication.',
  'allies.08.standing-order':
    'Hold the year’s arrears and the block head at the close. Make the correction standing, not temporary.',
  'allies.09.made-good':
    'Land on Bench Nine, remove the breaking crew and make the corrected ground true in fact.',

  'pact.01.shallow-road':
    'Take the Allied mast off our crust. Bring the bore head back whole so the hole can be capped and entered.',
  'pact.02.long-count':
    'Remove the Soviet pump and leave the reading post untouched. Four centuries of count outrank one day of yield.',
  'pact.03.concession':
    'Lift the four plate loads in order and carry every bearer home. A broken count proves nothing.',
  'pact.04.in-the-clear':
    'Hold the cut to named depth and leave the Allied instrument standing. Let their own reading witness ours.',
  'pact.05.open-count':
    'Take the Oculus whole, clear both armies from its floor and read every plate onto the open net.',
  'pact.06.common-ground':
    'Clear the breakers from the section and stand in the cut when the Works sit. The entry must match the ground.',
  'pact.07.thin-place':
    'Turn the mirror on both cutting heads without entering the parcel. The hamlet survives the allocation.',
  'pact.08.struck-off':
    'Walk nine households to the reading station and remove the replacement head before the hour. Discharge both claims.',
  'pact.09.vacant-possession':
    'Put three readers on the floor and every Pact gun outside the precinct at the hour. Convey it without possession.',

  'reclamation.01.held-paper':
    'Take the district mast off the office and keep the four yards standing. The paper already says they are ours.',
  'reclamation.02.written-off':
    'Bank sixteen thousand from the field they abandoned. Deeds and intact plant improve the margin, not the obligation.',
  'reclamation.03.sold-twice':
    'Hold two taps at both ends of the pan for five minutes. We settle both invoices before the buyers compare them.',
  'reclamation.04.served-notice':
    'Remove the register and its counterpart, then bring the work party to the far-road pickup. No filing, no requisition.',
  'reclamation.05.closing-entry':
    'Keep the counting house on our books and twelve thousand in the box when the week closes.',
  'reclamation.06.in-duplicate':
    'Write the counterpart, lodge it at the bonded store and bring the receipt home. One copy has made us vulnerable long enough.',
  'reclamation.07.payment-in-kind':
    'Levy all three gantries and leave the receiving office standing. Their own counterfoils will prove the payment.',
  'reclamation.08.contra-entry':
    'Put three lots on the assessor’s counter before the whistle and keep the ore stacks on our books while he counts.',
  'reclamation.09.book-value':
    'Clear the three outlying lots and put twenty-two thousand on the counter. Settle at book value, on the day.',
  'reclamation.10.without-recourse':
    'Take the district exchange standing and hold all four bonded stores through one reading. Endorse the book away from us.',

  'soviets.04.company-town':
    'Put three town derricks on our books and hold them through the shift. Five working is the answer nobody can revise.',
  'soviets.05.short-allocation':
    'Hold two seam workings until the shift closes. The sector produces whether next quarter admits it or not.',
  'soviets.06.demolition-order':
    'Take both feeder plants and the forecast device off the seam before the order executes. Leave the infirmary out of it.',
  'soviets.07.right-of-entry':
    'Take the district register and counterpart standing before the wind-up. We need one record, readable end to end.',
  'soviets.08.carriage-forward':
    'Put nine of the yards’ twelve on the seam with the plant standing at the close. Show Continental a working sector.',
  'soviets.09.nil-return':
    'Post thirty thousand against the quarter and keep the seam working. A delivered return is the only answer they file.',
};

interface AuthoredDebriefMessages {
  readonly win: string;
  readonly loss: string;
}

/** Outcome-specific Allied returns drawn from each operation's authored close. */
const AUTHORED_DEBRIEFS: Readonly<Record<string, AuthoredDebriefMessages>> = {
  'allies.01.sounding-line': {
    win: 'Reading is in: two points, ninety-two metres, and a gradient the schedule can carry.',
    loss: 'The line closed without our return. The model keeps a blank where the seam should be.',
  },
  'allies.02.instrument-room': {
    win: 'The copy is out. Survey 12-206 is back on the schedule with eleven years of returns attached.',
    loss: 'The district keeps its office and its paper. We came away without a supportable record.',
  },
  'allies.03.ground-truth': {
    win: 'Bramm and the rate series are clear of the beach. The forecast has ground under it now.',
    loss: 'Bramm filed the line before we reached her. What remains is forecast, not ground truth.',
  },
  'allies.04.misclosure': {
    win: 'The closed reduction is on the wire. The arc is out, and now every siting office has to admit it.',
    loss: 'The office and its books are gone. Eleven years of the eastern arc cannot be reconstructed here.',
  },
  'allies.05.forced-closure': {
    win: 'The model is off their books and the run stopped where it stood. The false closure goes no farther.',
    loss: 'The forced closure is published. Until we displace it, every new schedule will carry their error.',
  },
  'allies.06.machine-time': {
    win: 'The reduction closed with an unbroken feed. We have the answer; now we have to own where it is filed.',
    loss: 'The frames stopped and the quarter changed hands. Every partial in that machine is scrap paper.',
  },
  'allies.07.fair-copy': {
    win: 'Both heads carry the fair copy. Every yard on the continent opens to the corrected number tomorrow.',
    loss: 'The counters shut on the Order’s slip. Our correction is right and, for this edition, unread.',
  },
  'allies.08.standing-order': {
    win: 'Counted, signed and entered. The corrected series now stands over the Works’ own hand for the year.',
    loss: 'The counter closed short of the figure or the block head. Nothing in the standing series changes.',
  },
  'allies.09.made-good': {
    win: 'Station Nine is occupied and entered on corrected ground. The amendment is a fact now, not a promise.',
    loss: 'The quarter’s list leaves Bench Nine under the salvage claim. The books changed; the ground did not.',
  },

  'pact.01.shallow-road': {
    win: 'The mast is off them and the bore is entered against our count. This road is shallow no longer.',
    loss: 'Their mast still stands over a hole in our crust. The reading will be theirs until we return.',
  },
  'pact.02.long-count': {
    win: 'The pump is ours, the post is standing, and the last entry in four hundred years bears this hour.',
    loss: 'The pump remains and the count is exposed beside it. Yield has displaced custody for another day.',
  },
  'pact.03.concession': {
    win: 'Four loads went out and four bearers came home. The count is inside the Conclave in its proper order.',
    loss: 'The plates remain on the road or under the torches. An incomplete count cannot carry the concession.',
  },
  'pact.04.in-the-clear': {
    win: 'Depth is witnessed in the open by their instrument and ours. Every yard on the coast has the same number.',
    loss: 'The cut closed without a common reading. We are where the count stood four centuries ago.',
  },
  'pact.05.open-count': {
    win: 'The last plate was read from a whole Oculus onto an open net. The count belongs to every receiver now.',
    loss: 'The floor never cleared or the Oculus was lost. A count held in silence remains a faction’s claim.',
  },
  'pact.06.common-ground': {
    win: 'The Works entered the amendment while we stood on clear crust. The sale and the ground are on one record.',
    loss: 'The sitting closed over a working plant or an empty cut. The Timetable keeps the breakers’ version.',
  },
  'pact.07.thin-place': {
    win: 'Both collars are glass and the hamlet stands. The allocation has no working cut to attach itself to.',
    loss: 'The heads turned or the parcel was entered in our name. We proved the allocation by trying to stop it.',
  },
  'pact.08.struck-off': {
    win: 'The holding is discharged and the replacement head is off the road. Enter all who came out, by name.',
    loss: 'The hour left a household or a cutting head on the parcel. The salvage claim survives our objection.',
  },
  'pact.09.vacant-possession': {
    win: 'The count was received on the floor with every Pact gun beyond the wall. The precinct passes cleanly.',
    loss: 'The hour passed without three readers or with our arms inside. Possession defeated the conveyance.',
  },

  'reclamation.01.held-paper': {
    win: 'The mast is off them and the four yards remain earning. Nobody in the district can challenge the paper now.',
    loss: 'The office still has its mast or our yards paid the price. Held paper without held plant is a poor asset.',
  },
  'reclamation.02.written-off': {
    win: 'Sixteen thousand is banked from ground two administrations called empty. File the return under their signatures.',
    loss: 'The bank is short and the Sorter has nothing left to send. The written-off field stays written off.',
  },
  'reclamation.03.sold-twice': {
    win: 'Both delivery notes are cut, signed and filed upward. Four delivered and Nine received the same lot.',
    loss: 'The week closed with the pan short. Two depots will compare invoices before we can close either account.',
  },
  'reclamation.04.served-notice': {
    win: 'The books and the crew are off the siding. The district cannot file a requisition it cannot enter.',
    loss: 'The schedule remains or the crew did not clear the road. Number Six is still theirs by morning.',
  },
  'reclamation.05.closing-entry': {
    win: 'Counting house standing, twelve thousand in the box, and the only complete account on the continent still ours.',
    loss: 'The week closed without the house or the price. Whatever we owned will be counted in somebody else’s hand.',
  },
  'reclamation.06.in-duplicate': {
    win: 'Lodged, stamped and receipted. The counterpart now exists in their book as well as ours.',
    loss: 'The bond shut without a returned docket. We moved the liability and failed to bring back the proof.',
  },
  'reclamation.07.payment-in-kind': {
    win: 'Three lines are discharged and the receiving office stands behind them. Copy every Works hand on the counterfoils.',
    loss: 'The whistle left the gantries on their books or their office in rubble. The entry remains unpaid.',
  },
  'reclamation.08.contra-entry': {
    win: 'Three lots were weighed away and all three ore stacks remain ours. The contra entry is discharged in full.',
    loss: 'The whistle found fewer than three lots on the apron. The entry stays open and security follows it.',
  },
  'reclamation.09.book-value': {
    win: 'Paid at the counter, in full and on the day, out of three lots the ledger already priced.',
    loss: 'The counter shut short or a lot remained on our books. What we broke up bought us no discharge.',
  },
  'reclamation.10.without-recourse': {
    win: 'All four copies were signed in one reading and endorsed jointly to the houses, without recourse.',
    loss: 'The exchange closed without one complete reading. We still hold the road, the copies and the liability.',
  },

  'soviets.04.company-town': {
    win: 'The shift is done and the town’s output is on our books. Let the Ninth and Eleventh compare filings.',
    loss: 'The ledger closed without our three. Whatever the town produced goes under somebody else’s district.',
  },
  'soviets.05.short-allocation': {
    win: 'The shift closed with the sector producing. The nil revision goes back up the line with our meter attached.',
    loss: 'Two workings are gone or held against us. The sector reads nil because the ground was allowed to agree.',
  },
  'soviets.06.demolition-order': {
    win: 'The set and both plants are off the seam, infirmary standing. The branch can withdraw its order as redundant.',
    loss: 'The order executed with the forecast works still theirs. The seam is a hole in a survey now.',
  },
  'soviets.07.right-of-entry': {
    win: 'The part and counterpart are in one pair of hands, readable end to end before the branch signed the wind-up.',
    loss: 'The record burned, moved or went onto the branch line. The seam returns to two claims and no entry.',
  },
  'soviets.08.carriage-forward': {
    win: 'Plant standing, shift on the ground, taps behind us. Continental has already written next quarter against it.',
    loss: 'The shift closed short or the plant came off the seam. A scheduled sector that cannot show work gets posted away.',
  },
  'soviets.09.nil-return': {
    win: 'Thirty thousand is weighed and entered against the Ninth’s record. The sector cannot be filed as nil again.',
    loss: 'The quarter closed without the figure or the working seam. Their nil certificate becomes the only return.',
  },
};

/** One closing thesis per chapter, shown only after its final operation wins. */
const CAMPAIGN_FINALES: Readonly<Record<string, CampaignFinalePresentation>> = {
  'soviets.09.nil-return': {
    title: 'The sector stands',
    message: 'The Ninth’s return is filed against working ground. No schedule can call the seam nil again.',
  },
  'allies.09.made-good': {
    title: 'The correction stands',
    message: 'Bench Nine makes the amended series true on the ground. The continental timetable changes with it.',
  },
  'pact.09.vacant-possession': {
    title: 'The count is open',
    message: 'The precinct passes without possession. Four centuries of readings now belong to every receiver.',
  },
  'reclamation.10.without-recourse': {
    title: 'The account is closed',
    message: 'The exchange, the copies and the liability pass together. The houses leave with a clean book.',
  },
};

type TheatreKey = 'arid' | 'atoll' | 'snow' | 'temperate' | 'tropical' | 'urban';
type OppositionKey = 'Allies' | 'Meridian' | 'Reclaim' | 'Soviets';
type OperationPresentationRow = readonly [
  id: string,
  title: string,
  commander: keyof typeof SPEAKERS,
  theatre: TheatreKey,
  opposition: OppositionKey,
];

/**
 * The complete 37-operation presentation roster.
 *
 * It intentionally repeats only the five small fields the shell needs. The
 * operation table itself stays behind `campaign-install`'s dynamic boundary;
 * `tests/campaign-presentation-coverage.spec.ts` compares this registry to the
 * real table so a renamed or newly-authored operation cannot silently fall
 * back to the old text-only briefing.
 */
const OPERATION_ROWS: readonly OperationPresentationRow[] = [
  ['soviets.01.first-tap', 'First Tap', 'Rakhalt', 'arid', 'Allies'],
  ['soviets.02.common-standard', 'Common Standard', 'Vosk', 'temperate', 'Allies'],
  ['soviets.03.deep-sector', 'Deep Sector', 'Vosk', 'snow', 'Allies'],
  ['soviets.04.company-town', 'Company Town', 'Vosk', 'urban', 'Allies'],
  ['soviets.05.short-allocation', 'Short Allocation', 'Vosk', 'temperate', 'Allies'],
  ['soviets.06.demolition-order', 'Demolition Order', 'Vosk', 'snow', 'Allies'],
  ['soviets.07.right-of-entry', 'Right of Entry', 'Rakhalt', 'urban', 'Allies'],
  ['soviets.08.carriage-forward', 'Carriage Forward', 'Rakhalt', 'temperate', 'Allies'],
  ['soviets.09.nil-return', 'Nil Return', 'Rakhalt', 'snow', 'Allies'],

  ['allies.01.sounding-line', 'Sounding Line', 'Aubray', 'temperate', 'Soviets'],
  ['allies.02.instrument-room', 'Instrument Room', 'Aubray', 'urban', 'Soviets'],
  ['allies.03.ground-truth', 'Ground Truth', 'Aubray', 'tropical', 'Meridian'],
  ['allies.04.misclosure', 'Misclosure', 'Aubray', 'snow', 'Soviets'],
  ['allies.05.forced-closure', 'Forced Closure', 'Aubray', 'arid', 'Soviets'],
  ['allies.06.machine-time', 'Machine Time', 'Aubray', 'urban', 'Reclaim'],
  ['allies.07.fair-copy', 'Fair Copy', 'Aubray', 'temperate', 'Meridian'],
  ['allies.08.standing-order', 'Standing Order', 'Aubray', 'snow', 'Reclaim'],
  ['allies.09.made-good', 'Made Good', 'Aubray', 'atoll', 'Reclaim'],

  ['pact.01.shallow-road', 'The Shallow Road', 'Calvane', 'tropical', 'Allies'],
  ['pact.02.long-count', 'The Long Count', 'Calvane', 'temperate', 'Soviets'],
  ['pact.03.concession', 'The Concession', 'Calvane', 'arid', 'Reclaim'],
  ['pact.04.in-the-clear', 'In the Clear', 'Calvane', 'snow', 'Allies'],
  ['pact.05.open-count', 'The Open Count', 'Calvane', 'urban', 'Meridian'],
  ['pact.06.common-ground', 'Common Ground', 'Calvane', 'temperate', 'Reclaim'],
  ['pact.07.thin-place', 'The Thin Place', 'Calvane', 'arid', 'Soviets'],
  ['pact.08.struck-off', 'Struck Off', 'Calvane', 'arid', 'Reclaim'],
  ['pact.09.vacant-possession', 'Vacant Possession', 'Calvane', 'snow', 'Meridian'],

  ['reclamation.01.held-paper', 'Held Paper', 'Tallow', 'urban', 'Soviets'],
  ['reclamation.02.written-off', 'Written Off', 'Cregg', 'temperate', 'Soviets'],
  ['reclamation.03.sold-twice', 'Sold Twice', 'Cregg', 'arid', 'Allies'],
  ['reclamation.04.served-notice', 'Served Notice', 'Cregg', 'snow', 'Allies'],
  ['reclamation.05.closing-entry', 'Closing Entry', 'Tallow', 'urban', 'Meridian'],
  ['reclamation.06.in-duplicate', 'In Duplicate', 'Tallow', 'urban', 'Allies'],
  ['reclamation.07.payment-in-kind', 'Payment in Kind', 'Tallow', 'temperate', 'Soviets'],
  ['reclamation.08.contra-entry', 'Contra Entry', 'Tallow', 'urban', 'Meridian'],
  ['reclamation.09.book-value', 'Book Value', 'Tallow', 'temperate', 'Allies'],
  ['reclamation.10.without-recourse', 'Without Recourse', 'Tallow', 'urban', 'Soviets'],
];

/** Lightweight title-screen scope; the full campaign table remains lazy. */
export const CAMPAIGN_OPERATION_IDS = Object.freeze(OPERATION_ROWS.map((row) => row[0]));
export const CAMPAIGN_OPERATION_COUNT = CAMPAIGN_OPERATION_IDS.length;

const OPERATIONS = new Map(OPERATION_ROWS.map((row) => [row[0], row] as const));

const CHAPTER_TITLES: Readonly<Record<CampaignTheme, string>> = {
  soviets: 'Hold the Seam',
  allies: 'The Timetable',
  pact: 'The Crust',
  reclamation: 'Salvage Rights',
};

const THEATRES: Readonly<Record<TheatreKey, string>> = {
  arid: 'Arid seam district',
  atoll: 'Atoll approaches',
  snow: 'Northern survey sector',
  temperate: 'Temperate works corridor',
  tropical: 'Littoral survey belt',
  urban: 'Industrial registry district',
};

const OPPOSITION: Readonly<Record<OppositionKey, string>> = {
  Allies: 'Allied Continental force',
  Meridian: 'Meridian Pact formation',
  Reclaim: 'Reclamation salvage house',
  Soviets: 'Soviet March column',
};

function operationIndex(id: string): string {
  return id.split('.')[1]?.padStart(2, '0') ?? '00';
}

function chapterOf(id: string): 'allies' | 'pact' | 'reclamation' | 'soviets' | null {
  const chapter = id.split('.')[0];
  if (chapter === 'allies' || chapter === 'pact'
    || chapter === 'reclamation' || chapter === 'soviets') return chapter;
  return null;
}

/** The faction skin for every campaign-facing surface. */
export function campaignTheme(operationId: string): CampaignTheme | null {
  return chapterOf(operationId);
}

/**
 * Small, synchronous identity for save rows and other shell chrome.
 *
 * This reads the presentation registry rather than importing the authored
 * campaign table, preserving the campaign chunk boundary while ensuring a
 * save made on a shared battlefield still says which operation it belongs to.
 */
export function campaignOperationIdentity(operationId: string): CampaignOperationIdentity | null {
  const row = OPERATIONS.get(operationId);
  const theme = chapterOf(operationId);
  if (row === undefined || theme === null) return null;
  return {
    id: row[0],
    title: row[1],
    chapterTitle: CHAPTER_TITLES[theme],
    theme,
  };
}

/** Authored chapter conclusion, or null for every non-final operation. */
export function campaignFinale(operationId: string): CampaignFinalePresentation | null {
  return CAMPAIGN_FINALES[operationId] ?? null;
}

/** One player-facing statement of the grader used before and after an operation. */
export function campaignMedalStandard(medal: number): CampaignMedalStandard {
  const safe = Number.isFinite(medal) ? Math.floor(medal) : 0;
  const tier = Math.max(0, Math.min(3, safe));
  return CAMPAIGN_MEDAL_STANDARDS[tier] ?? CAMPAIGN_MEDAL_STANDARDS[0];
}

function briefingChannel(id: string): string {
  const index = operationIndex(id);
  switch (chapterOf(id)) {
    case 'soviets': return `March priority // ${index}`;
    case 'allies': return `Continental order // ${index}`;
    case 'pact': return `Conclave direction // ${index}`;
    case 'reclamation': return `House instruction // ${index}`;
    default: return `Command order // ${index}`;
  }
}

function debriefChannel(id: string): string {
  const index = operationIndex(id);
  switch (chapterOf(id)) {
    case 'soviets': return `Directorate assessment // ${index}`;
    case 'allies': return `Continental return // ${index}`;
    case 'pact': return `Conclave finding // ${index}`;
    case 'reclamation': return `House account // ${index}`;
    default: return `Command assessment // ${index}`;
  }
}

function debriefMessage(
  id: string,
  title: string,
  won: boolean,
  context: CampaignDebriefContext,
): string {
  const medal = Math.max(0, Math.min(3, Math.floor(context.medal ?? 0)));
  const failed = context.failedObjective?.trim();
  switch (chapterOf(id)) {
    case 'soviets':
      if (!won) return failed === undefined || failed === ''
        ? `${title} remains open. Re-form the column before they write the result for us.`
        : `${failed} was not achieved. Re-form the column before they write the result for us.`;
      if (medal >= 3) return `${title} is closed to gold standard. Ground, entry and timing all held.`;
      if (medal >= 2) return `${title} is closed cleanly. The Directorate has every required entry.`;
      return `${title} is closed. The Directorate has the ground and the entry.`;
    case 'allies':
      if (!won) return failed === undefined || failed === ''
        ? `${title} is not supportable on this return. Reset the instruments and go again.`
        : `${failed} is not supportable on this return. Reset the instruments and go again.`;
      if (medal >= 3) return `${title} is filed to gold standard. Every control agrees with the ground.`;
      if (medal >= 2) return `${title} is filed with the complete supporting record.`;
      return `${title} is filed. The Continental record now agrees with the ground.`;
    case 'pact':
      if (!won) return failed === undefined || failed === ''
        ? `${title} has not been made good. Withdraw in order and reopen the count.`
        : `${failed} has not been made good. Withdraw in order and reopen the count.`;
      if (medal >= 3) return `${title} stands at gold measure. No second reading can alter it.`;
      if (medal >= 2) return `${title} stands with every concession entered.`;
      return `${title} stands. Enter the finding and leave nothing for a second reading.`;
    case 'reclamation':
      if (!won) return failed === undefined || failed === ''
        ? `${title} is still theirs on paper and in fact. Bring back what remains.`
        : `${failed} is still theirs on paper and in fact. Bring back what remains.`;
      if (medal >= 3) return `${title} clears at gold value. Every extra is on our books.`;
      if (medal >= 2) return `${title} is entered with the whole consideration attached.`;
      return `${title} is on our books. Price the ground before somebody else does.`;
    default:
      return won ? `${title} is complete.` : `${title} was not completed.`;
  }
}

function authoredWinQuality(theme: CampaignTheme | null, medal: number): string {
  if (medal <= 0) return '';
  switch (theme) {
    case 'soviets':
      if (medal >= 3) return ' Ground, entry and timing all held to gold standard.';
      if (medal >= 2) return ' The Directorate has every required entry.';
      return ' Ground and entry are on the Directorate books.';
    case 'allies':
      if (medal >= 3) return ' Filed to gold standard; every control agrees with the ground.';
      if (medal >= 2) return ' The complete supporting record is attached.';
      return ' The return is supportable and filed.';
    case 'pact':
      if (medal >= 3) return ' It stands at gold measure; no second reading can alter it.';
      if (medal >= 2) return '; every concession and witness is entered.';
      return ' The finding stands in the count.';
    case 'reclamation':
      if (medal >= 3) return ' Cleared at gold value; every extra remains on our books.';
      if (medal >= 2) return ' The whole consideration is attached.';
      return ' The settled consideration remains on our books.';
    default: return '';
  }
}

function authoredFailureReason(theme: CampaignTheme | null, failed: string | undefined): string {
  if (failed === undefined || failed === '') return '';
  switch (theme) {
    case 'soviets': return `${failed} was not achieved. `;
    case 'allies': return `${failed} is not supportable on this return. `;
    case 'pact': return `${failed} has not been made good. `;
    case 'reclamation': return `${failed} is still theirs on paper and in fact. `;
    default: return `${failed} was not completed. `;
  }
}

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
    theme: 'neutral',
  };
}

export function campaignBriefing(
  operationId: string,
  primaryObjective?: string,
): CampaignBriefingPresentation | null {
  const special = SPECIAL_BRIEFINGS[operationId];
  if (special !== undefined) return special;
  const row = OPERATIONS.get(operationId);
  if (row === undefined) return null;
  const [, title, commander, theatre, opposition] = row;
  return {
    commander: SPEAKERS[commander],
    // Authored command intent binds multi-part objectives into one order. The
    // scored objective remains the safe fallback for newly added operations,
    // and the title fallback serves headless callers without an objective row.
    directive: AUTHORED_DIRECTIVES[operationId]
      ?? primaryObjective
      ?? `Complete ${title} and hold the result.`,
    theatre: THEATRES[theatre],
    opposition: OPPOSITION[opposition],
    channel: briefingChannel(operationId),
  };
}

export function campaignDebrief(
  operationId: string,
  won: boolean,
  context: CampaignDebriefContext = {},
): CampaignDebriefPresentation | null {
  const special = SPECIAL_DEBRIEFS[operationId];
  if (special !== undefined) return won ? special.win : special.loss;
  const row = OPERATIONS.get(operationId);
  if (row === undefined) return null;
  const [, title, commander] = row;
  const authored = AUTHORED_DEBRIEFS[operationId];
  if (authored !== undefined) {
    const medal = Math.max(0, Math.min(3, Math.floor(context.medal ?? 0)));
    const failed = context.failedObjective?.trim();
    const theme = chapterOf(operationId);
    let message: string;
    if (won) {
      message = `${authored.win}${authoredWinQuality(theme, medal)}`;
    } else {
      message = `${authoredFailureReason(theme, failed)}${authored.loss}`;
    }
    return {
      commander: SPEAKERS[commander],
      channel: debriefChannel(operationId),
      message,
    };
  }
  return {
    commander: SPEAKERS[commander],
    channel: debriefChannel(operationId),
    message: debriefMessage(operationId, title, won, context),
  };
}
