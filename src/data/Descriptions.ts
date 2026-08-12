/**
 * ============================================================================
 * VOLTMARCH — src/data/Descriptions.ts   THE PANEL BRIEF
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every def in the game carries exactly ONE piece of player-facing prose — a
 * `blurb`, one clause long — and until now it was printed in TWO places at
 * once: on the hover card, and again in the strip along the foot of the build
 * rail. The strip was therefore a second copy of the card, and a player who
 * read both learned nothing the second time.
 *
 * Worse, the blurbs are written for somebody who already knows the game. The
 * Reliquary's says "Unlocks the top of every tab", which is exactly right and
 * completely useless to a new player: it does not say what a Reliquary IS,
 * what "the top of every tab" contains, or what it costs to get there. That
 * complaint is the reason this file exists, in those words.
 *
 * So the split is:
 *
 *   `blurb`        the CARD. One clause. What it is, for somebody who knows.
 *   this file      the PANEL. One to three sentences. What it is, why you
 *                  would build it instead of something else, and what it needs
 *                  and leads to — for somebody who has never played this.
 *
 * WHY A SEPARATE FILE, KEYED BY CONTENT KEY
 * ------------------------------------------
 * Three reasons, and the first is the load-bearing one:
 *
 *   1. `Defs.ts` is 2,800 lines and every faction's roster runs through it.
 *      A `description` column would be a hundred-plus edits scattered down a
 *      file that other work is constantly adding rows to. A separate map
 *      touches nothing.
 *   2. The def table stays a table of NUMBERS. Prose in the same row as
 *      `turretTurnRate` is prose nobody proof-reads.
 *   3. Copy is reviewable as copy. All of it is here, in one order, and
 *      reading it end to end is how you notice that four entries have started
 *      to sound the same.
 *
 * THE KEY IS THE CONTENT KEY, NEVER AN INDEX. `store.defId` is a raw index
 * into `DEF_TABLES.units` / `.buildings` and replays hold those numbers, so
 * this file must never be a reason to reorder either array. It is a `Record`
 * and the order below is presentational only.
 *
 * NO DIGITS. NOT ONE. AND THAT IS ENFORCED
 * ----------------------------------------
 * `tests/build-descriptions.spec.ts` rejects any description containing a
 * digit, and the rule is not stylistic. Every number worth quoting here is
 * owned by a table somewhere else — the cost is on the cameo, the build time
 * and the power draw are in the tooltip, the prerequisite sentence is derived
 * from `prereqs`, and everything else lives in `Defs.ts`, `config.ts` or
 * `Superweapons.ts`. A number RETYPED here is a second copy that nothing
 * compares, which is precisely the class of defect `docs/SPEC_DRIFT_AUDIT.md`
 * catalogues; the Multigunner IFV's gun was rebalanced from 22x4 to 11x5 and
 * the wiki still quotes the old figure today.
 *
 * The rule costs less than it sounds like. "Reaches further than a Grizzly" is
 * a comparison the balance pass cannot silently break in the way "reaches 26 m"
 * can, and it is the sentence a new player actually needed.
 *
 * EVERY CLAIM WAS CHECKED AGAINST THE SHIPPED TABLES
 * --------------------------------------------------
 * Not against the wiki, which was the source for the VOICE and for most of the
 * framing, and which is wrong in four places (see the commit that added this
 * file). Where a wiki sentence and `DEF_TABLES` disagreed, the table won and
 * the sentence was rewritten.
 * ============================================================================
 */

/**
 * Content key -> the panel brief.
 *
 * Covers every entry `ProductionCatalog.roster()` can put in front of a player
 * for any of the four armies, plus the three construction yards, which are
 * deployed rather than built and so never appear in a roster.
 * `tests/build-descriptions.spec.ts` walks the catalog and fails on a gap, so
 * a def added without a line here cannot ship.
 */
export const BUILD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  /* ======================================================================
   * SHARED — the Allied and Soviet pool, plus the two other yards
   * ==================================================================== */

  conyard:
    'Your base. Everything you build has to go inside its radius, or beside '
    + 'something you have already planted. It is unpacked from a Construction '
    + 'Vehicle, and no brownout can darken it.',

  powerPlant:
    'The grid everything else draws on. Run a deficit and your build speed '
    + 'drops and your defences go dark, biggest draw first — so add a plant '
    + 'before you add anything expensive.',

  refinery:
    'Where harvesters cash ore in for credits. It comes with a free harvester '
    + 'and raises your storage cap. Build it early and near the ore: the length '
    + 'of that drive is what sets your income.',

  barracks:
    'Trains every foot soldier. A second one does not give you a second queue, '
    + 'it makes the one queue faster. It also unlocks your walls and your first '
    + 'cheap defensive emplacement.',

  warFactory:
    'Builds every vehicle you own, harvesters and aircraft included, and sets '
    + 'their rally point. It is the gate in front of both your army and a '
    + 'bigger economy.',

  radar:
    'Turns the tactical map on, and sees further than any other building you '
    + 'own. It is also the middle rung of the tech tree: the second-tier units '
    + 'and the Battle Lab behind them all name it.',

  oreSilo:
    'Bank space, and nothing else. Credits earned above your storage cap are '
    + 'thrown away rather than held, so when the game starts warning you about '
    + 'silos, this is the answer.',

  repairDepot:
    'Park a damaged vehicle beside it and it is mended automatically — there '
    + 'is no order and no button. A repair costs a fraction of a new hull, so '
    + 'it pays for itself as soon as you own armour.',

  battleLab:
    'The tech building the two original armies share: one structure opens the '
    + 'top of every tab — the heaviest tank, the capital ship and both '
    + 'superweapons. It hangs off the Radar Dome.',

  navalYard:
    'Builds Allied ships into the vehicle queue. Only worth founding on a map '
    + 'with water — and where there is water, it is also your only way of '
    + 'moving infantry across it.',

  subPen:
    'The Soviet naval yard under another name, feeding the same vehicle queue: '
    + 'the transport, the ambush submarine and the Dreadnought. Only worth '
    + 'founding on a map with water.',

  wall:
    'Cheap blocks that stop vehicles, and only vehicles — infantry walk '
    + 'straight through a wall line. Their other use is creep: every structure '
    + 'you plant extends the ground you may build on.',

  gate:
    'A wall segment your own units can drive through and the enemy cannot. '
    + 'Walls never stopped infantry in the first place, so a gate is for your '
    + 'convenience rather than their inconvenience.',

  /* -- shared units ---------------------------------------------------- */

  engineer:
    'Walks into a building and takes it, and is spent doing it. A neutral '
    + 'structure flips at any health; an enemy one has to be at half health or '
    + 'below. He also repairs one of yours back to full.',

  harvester:
    'Your entire economy in one vehicle. It finds ore, mines it and banks it at '
    + 'a refinery on its own, forever. It is unarmed and expensive — the first '
    + 'thing a good opponent will come for.',

  mcv:
    'A Construction Yard folded up and driven around. Take it where you want a '
    + 'second base and press D to unpack it. This is how you expand across the '
    + 'map, and how you replace a lost yard.',

  transport:
    'An unarmed lift with more infantry seats than anything else in the game. '
    + 'It hovers, so it crosses water — the only way either original army puts a '
    + 'squad ashore. Passengers cannot fire.',

  /* ======================================================================
   * ALLIED FORCES
   * ==================================================================== */

  pillbox:
    'A cheap machine-gun nest and your first real defence. It shreds infantry '
    + 'and barely scratches armour, and it draws no power, so it keeps firing '
    + 'through a blackout that darkens the rest.',

  aaTurret:
    'The only emplacement in the game built purely for aircraft. It reaches up, '
    + 'and it hits light armour hardest — which is what every aircraft is made '
    + 'of. It will not help you against a tank.',

  prismTower:
    'A beam tower with the longest reach of any defence in the game, and it '
    + 'shoots at aircraft. Prism ignores most armour. It needs the Battle Lab, '
    + 'and goes dark the moment your grid browns out.',

  chronosphere:
    'The one superweapon that moves your own army instead of hurting somebody '
    + "else's. Pick a source and a destination, and a squad's worth of your units "
    + 'is lifted from one to the other.',

  weatherControl:
    'A sustained lightning barrage over a patch of map. More total damage than '
    + 'a nuclear strike, but scattered — use it to deny ground or wreck a '
    + 'production line, not to delete one building.',

  gi:
    'Your basic rifleman: cheap bodies that shred other infantry, and they can '
    + 'shoot at aircraft. Against armour he is nearly useless — small arms barely '
    + 'mark a tank — so bring a Javelin.',

  javelin:
    'A shoulder rocket that genuinely kills tanks and aircraft where a rifle '
    + 'cannot. He is the slowest thing you field and the heavy tanks out-reach '
    + 'him, so keep him behind your own line.',

  fieldMarshal:
    'Your commander, one alive at a time. He carries a full prism emitter, and '
    + 'Chrono Rally teleports nearby units to him — the longest reach of any '
    + 'commander ability, for regrouping a push.',

  grizzly:
    'The Allied main battle tank and the backbone of a push: turreted, quick, '
    + 'and cheaper than the Soviet equivalent, so you field more of them. It '
    + 'flattens infantry it drives over.',

  ifv:
    'A fast turreted raider. Its autocannon is at its best against light hulls '
    + 'and aircraft and at its worst against a tank — hunt harvesters and '
    + 'scouts with it, do not trade with armour.',

  prismTank:
    'Beam artillery. Enormous damage that almost no armour resists, from '
    + 'further out than any tank gun reaches. It stops to fire, cannot shoot at '
    + 'aircraft, and dies to a raid it did not see.',

  vindicator:
    'A strike aircraft, and the toughest of the four. Its rockets hurt armour '
    + 'and buildings alike, and most of the army cannot shoot back at it. Buy '
    + 'it to open a base, not to win a dogfight.',

  gunboat:
    'An escort hull with a high-explosive deck gun, which is the warhead '
    + 'buildings resist worst — so it is a shore bombardment platform as much '
    + 'as a screen. It cannot answer aircraft.',

  destroyer:
    'The Allied capital ship: the same deck gun as the escort, on far more hull '
    + 'and better armour. It needs the Battle Lab, and like the escort it '
    + 'cannot answer aircraft.',

  upgAlliedOptics:
    'A purchase, not a unit: buy it once and every rifleman you own or ever '
    + 'train sees further. Sight decides who shoots first, so it is worth more '
    + 'the more infantry you field.',

  upgAlliedComposite:
    'A purchase, not a unit: buy it once and every vehicle you own or ever '
    + 'build takes less damage. It never expires and costs nothing to keep, so '
    + 'the earlier you buy it the more hulls it saves.',

  upgAlliedLogistics:
    'A purchase, not a unit: buy it once and everything in every queue finishes '
    + 'sooner — structures, infantry and vehicles alike. It compounds over the '
    + 'match, so buy it early or not at all.',

  /* ======================================================================
   * SOVIET UNION
   * ==================================================================== */

  sentryGun:
    'The Soviet machine-gun nest: the same gun as the Allied Pillbox at the '
    + 'same price, and no power draw. Good against infantry, nearly useless '
    + 'against armour, and it fires through a blackout.',

  flameTower:
    'A short-ranged flamethrower, brutal on foot troops because its splash '
    + 'catches whoever is standing near the target. It has the shortest reach of '
    + 'any emplacement, so attackers stand off it.',

  teslaCoil:
    'Deletes infantry and hurts armour badly, and it elevates, so it is the '
    + "Soviets' only anti-air structure. It arrives a tier earlier than the "
    + 'Allied beam tower, and it goes dark in a brownout.',

  nuclearSilo:
    'One annihilating blast, with the widest radius of any superweapon. It is '
    + 'announced before it lands, so it clears ground rather than catching an '
    + 'army that is paying attention.',

  ironCurtain:
    'True invulnerability for every friendly unit in the radius — not damage '
    + 'reduction, invulnerability. A tank column walking into a defended base '
    + 'is exactly what it is for.',

  conscript:
    'The cheapest body either original army fields, and the fastest to train. '
    + 'One does nothing; a wave of them is a real problem. Like every rifle, it '
    + 'barely marks armour.',

  attackDog:
    'The fastest thing on foot in the game, and a scout first — send it to find '
    + 'the enemy before you commit. It tears infantry apart at a bite of reach, '
    + 'and can do nothing at all to a vehicle.',

  flakTrooper:
    'A drum-fed autocannon. It erases anything light — raiders, hover hulls and '
    + 'every aircraft — and only chips heavy armour. The Soviet answer to a big '
    + 'tank is a bigger tank, not this man.',

  commissar:
    'Your commander, one alive at a time, and the toughest of the four. He '
    + 'carries a tesla coil that chains between targets and elevates, and Iron '
    + 'Will makes nearby units briefly invulnerable.',

  rhino:
    'The Soviet main battle tank: slower and dearer than the Allied one, but '
    + 'heavier armour, a bigger gun and more reach. Small arms and autocannon '
    + 'barely dent it.',

  apocalypse:
    'The heaviest tank in the game, with the longest reach of any tank gun, and '
    + 'it flattens infantry it drives over. Slow and expensive — escort it, and '
    + 'never walk it into a rocket squad alone.',

  mig:
    'The fastest thing on the map, and a pure interceptor: its autocannon is at '
    + 'its best against light armour, which is what every aircraft is made of. '
    + 'It cannot hurt a tank or open a base.',

  submarine:
    'An ambush hull. One heavy torpedo on a long reload, so it wants to open a '
    + 'fight rather than sit in one. It cannot shoot at aircraft, and it dies '
    + 'quickly to anything that catches it.',

  dreadnought:
    'The Soviet siege ship: the longest naval reach in the game, heavy armour, '
    + 'and missiles that elevate — so it is the one Soviet hull that answers '
    + 'aircraft at range.',

  upgSovietBodyArmour:
    'A purchase, not a unit: buy it once and every conscript you own or ever '
    + 'train takes less damage. Soviet infantry are meant to be spent in '
    + 'numbers; this makes each of them last longer.',

  upgSovietUranium:
    'A purchase, not a unit: buy it once and every vehicle you own or ever '
    + 'build hits harder. It needs the Battle Lab, which puts it late — but it '
    + 'improves an Apocalypse as much as a Rhino.',

  upgSovietSlurry:
    'A purchase, not a unit: buy it once and every ore load your harvesters '
    + 'bank is worth more credits. It pays for itself over a long match and '
    + 'does nothing at all in a short one.',

  /* ======================================================================
   * THE MERIDIAN PACT
   * ==================================================================== */

  mrdConclave:
    "The Pact's construction yard. Everything you build has to go inside its "
    + 'radius, or beside something already planted. It unfolds from a Pactworks '
    + 'Carryall, and no brownout can darken it.',

  mrdSolarArray:
    'The cheapest power per credit in the game, which is why the Pact reaches '
    + "its second tier before anyone else. It also has half a Power Plant's hit "
    + 'points, so your grid is your softest target.',

  mrdCistern:
    'The Pact refinery. Collectors cash their ore in here, it raises your '
    + 'storage cap, and it arrives with a free Sun Collector. Build it early, '
    + 'and build it near the ore.',

  mrdChapterhouse:
    'Trains Pact infantry. A second one makes the one queue faster rather than '
    + 'adding another. It also unlocks the Rampart and the Glaive Post, the only '
    + 'defences you get for a long while.',

  mrdForgeyard:
    'Builds every Pact hull — collectors, the line tank, the raider and the '
    + 'gunship — and sets their rally point. Everything that leaves it hovers '
    + 'or flies, so no lake on the map is in your way.',

  mrdOculus:
    'Turns the tactical map on, and sees further than any other radar in the '
    + 'game. It is the middle rung of the tech tree — the Sunlancer, the '
    + 'Kestrel, the Hierarch and the Reliquary all need it.',

  mrdVault:
    'Bank space, and nothing else. Credits earned above your storage cap are '
    + 'thrown away rather than held, so when the game starts warning you about '
    + 'storage, this is the answer.',

  mrdSlipway:
    'Builds Pact warships. The Pact ground army already crosses water on its '
    + 'own, so a Slipway is about firepower afloat rather than about getting '
    + 'anywhere you could not already reach.',

  mrdDepot:
    'Park a damaged hull beside it and it is mended automatically — there is no '
    + 'order and no button. A repair costs a fraction of a new hull, so it pays '
    + 'for itself as soon as you own vehicles.',

  mrdReliquary:
    "The Pact's tech building, and the gate in front of everything expensive: "
    + 'the Zenith siege beam, the Helios Spire, the Sunmonitor and the '
    + 'Heliograph. It needs an Oculus, and it draws heavily.',

  mrdRampart:
    'The Pact wall. It stops vehicles and nothing else — infantry walk straight '
    + 'through — and the Pact has no gate, so leave your own column a way out '
    + 'before you close the perimeter.',

  mrdGlaive:
    "The Pact's cheap anti-infantry emplacement. It cannot shoot at aircraft, "
    + "and unlike other armies' cheap defences it is on the grid: a brownout "
    + 'silences it along with the Spire.',

  mrdHelios:
    'A long beam tower that shoots at aircraft — the only anti-air structure '
    + 'the Pact has, and its only defence with real reach. It needs the '
    + 'Reliquary, and goes dark when your grid browns out.',

  mrdHeliograph:
    'The one superweapon the Pact gets. A single annihilating strike, announced '
    + 'before it burns. There is no Iron Curtain and no Chronosphere here — '
    + 'whatever you want done, this is the button.',

  mrdWayfarer:
    'Pact line infantry: the fastest basic rifleman in the game and the '
    + 'widest-eyed, with thin skin to pay for it. The carbine elevates, but it is '
    + 'a nuisance to aircraft rather than a deterrent.',

  mrdLancer:
    'The Pact anti-armour infantryman, cheaper and longer-ranged than the '
    + 'Allied Javelin. Until a Helios Spire is standing, he is also the '
    + 'heaviest anti-air punch the Pact can put on the ground.',

  mrdArtificer:
    'Walks into a building and takes it, and is spent doing it. A neutral '
    + 'structure flips at any health; an enemy one has to be at half health or '
    + 'below. He also repairs one of yours back to full.',

  mrdHierarch:
    'Your commander, one alive at a time: the fastest, the widest-eyed and the '
    + 'lightest of the four. Prism Focus burns every enemy standing near him, '
    + 'the only commander ability that deals damage.',

  mrdCollector:
    'The Pact harvester. A smaller hopper than a standard one, but cheaper and '
    + 'much faster, so it makes the difference up in trips. More trips means '
    + 'more time in the open, so screen it.',

  mrdSkiff:
    'The fastest ground hull in the game, and three things at once: a raider, '
    + 'an anti-air platform and a two-seat transport. It has almost no armour, '
    + 'so it must never be caught standing still.',

  mrdSolarch:
    'The Pact main line: turreted, faster than any other line tank, and it '
    + 'reaches further than a Grizzly. Light armour, though — autocannon and '
    + 'massed rifles take it apart, so win the standoff.',

  mrdZenith:
    'A siege beam with the longest ground reach the Pact has, doing damage '
    + 'almost no armour resists. It stops to fire, cannot answer aircraft, and '
    + 'dies to anything that closes with it.',

  mrdCarryall:
    'A Conclave folded up and driven around. Take it where you want a second '
    + 'base and press D to unpack it. This is how the Pact expands, and how it '
    + 'replaces a Conclave it has lost.',

  mrdKestrel:
    'Guided rocket pods on a fast airframe. Tank guns cannot elevate, so a '
    + 'Kestrel over an armoured column is untouchable by most of it — and its '
    + 'wide sight makes it an excellent scout.',

  mrdCorvette:
    'A Pact escort hull. Its battery is high explosive, the warhead buildings '
    + 'resist worst, which makes it a shoreline demolition tool as much as a '
    + 'screen. It cannot shoot at aircraft.',

  mrdMonitor:
    'The Pact capital ship: the longest reach in its fleet, the best armour in '
    + 'it, and missiles that elevate — so unlike the escort it answers '
    + 'aircraft. It needs a Slipway and the Reliquary.',

  upgMrdWayfinding:
    'A purchase, not a unit: buy it once and every Wayfarer you own or ever '
    + 'train sees further still. The Pact already has the widest eyes in the '
    + 'game; this turns that into shooting first.',

  upgMrdSolarSails:
    'A purchase, not a unit: buy it once and every Pact hull you own or ever '
    + 'build moves faster. The Pact wins standoffs and loses brawls, and speed '
    + 'is what lets you choose which one you are in.',

  upgMrdCapacitors:
    'A purchase, not a unit: buy it once and everything you own reloads faster, '
    + 'emplacements included. It needs the Reliquary, so it is a late buy that '
    + 'improves an army you already have.',

  /* ======================================================================
   * THE RECLAMATION
   * ==================================================================== */

  rclFoundry:
    'The Reclamation construction yard, and the toughest of the three. '
    + 'Everything you build has to go inside its radius, or beside something '
    + 'already planted. It unfolds from a Yardcrawler.',

  rclFurnace:
    'The cheapest and toughest power plant in the game, and by a distance the '
    + 'least productive. You will build five or six of them, and your own '
    + 'defensive belt is what browns the base out.',

  rclSorter:
    'The Reclamation refinery. Scrapjaws cash their ore in here, it raises your '
    + 'storage cap, and it arrives with a free Scrapjaw. It is also the gate in '
    + 'front of the Breaker Yard.',

  rclRookery:
    'Trains Scrap Pickers, cheaper and faster than any other army trains '
    + 'infantry, and unlocks the Barricade and the Spitpost. A second one makes '
    + 'the queue quicker rather than adding another.',

  rclBreakerYard:
    'Builds every Reclamation hull and sets their rally point. It is the '
    + 'cheapest and fastest vehicle factory in the game, and the line hulls '
    + 'behind it need nothing else — that is the tempo.',

  rclSpotter:
    'Turns the tactical map on, and it is the gate in front of the Arc Pylon, '
    + 'the Swarmhornet and the Crucible. Your heavy defence therefore arrives a '
    + 'tier before an Allied or Pact beam tower.',

  rclHeap:
    'Bank space, and nothing else. Credits earned above your storage cap are '
    + 'thrown away rather than held, so when the game starts warning you about '
    + 'storage, this is the answer.',

  rclDrydock:
    'Builds the two Reclamation hulls that float: an armed barge that also '
    + 'carries troops, and a salvaged capital ship. Only worth founding on a '
    + 'map with water.',

  rclDepot:
    'Park a damaged hull beside it and it is welded back up automatically — no '
    + 'order, no button. The toughest repair structure in the game, and a repair '
    + 'costs a fraction of a new hull.',

  rclCrucible:
    'The Reclamation tech building. It opens the Slaghurler — the only hull in '
    + 'the army that can break a base — plus the Reclaimed Hulk and the '
    + 'Stormworks. It hangs off the Spotter Mast.',

  rclBarricade:
    'The Reclamation wall. It stops vehicles and nothing else — infantry walk '
    + 'straight through — and the Reclamation has no gate, so leave yourself a '
    + 'way out before you close the perimeter.',

  rclSpitpost:
    'A cheap chained coil: every shot jumps on to a second target, which is why '
    + 'massed infantry evaporates in front of it. It draws no power at all, so '
    + 'it fires straight through a total blackout.',

  rclPylon:
    'Chained arcs, and it elevates — the closest thing the Reclamation has to '
    + 'anti-air. It draws more power than any building bar a superweapon, then '
    + 'fires through the brownout it caused.',

  rclStormworks:
    "The Reclamation's one superweapon: loose arcs raining anywhere on the map. "
    + 'More total damage than a nuclear strike, but none of it where you aimed. '
    + 'It denies ground, it does not demolish.',

  rclPicker:
    'The cheapest unit in the game and the fastest to train. Unlike every other '
    + "army's basic rifleman his arc really does hurt armour and aircraft — he is "
    + 'simply bad at it, so bring a great many.',

  rclSlagger:
    'A satchel of molten slag, and one of only two things the Reclamation can '
    + 'bring to a land map that truly hurts a building. His reach is nearly the '
    + 'shortest going; he has to walk right up.',

  rclTinker:
    'Walks into a building and takes it, and is spent doing it. A neutral '
    + 'structure flips at any health; an enemy one has to be at half health or '
    + 'below. He also repairs one of yours back to full.',

  rclBaron:
    'Your commander, one alive at a time. Salvage Call strips nearby wrecks for '
    + 'credits and heals every friendly around him — the only ability that pays '
    + 'you, and the shortest cooldown going.',

  rclScrapper:
    'The Reclamation harvester: cheaper than a standard one, a slightly smaller '
    + 'hopper, heavy armour, and it flattens infantry it drives over. It is '
    + 'still unarmed, so it still wants an escort.',

  rclSpitter:
    'A fast coil buggy, and the mobile answer to aircraft this army otherwise '
    + 'lacks. Very short reach and no armour to speak of, so it raids and runs '
    + '— it cannot hold a line.',

  rclGrinder:
    'The Reclamation line hull. Cheaper and quicker to build than any other '
    + 'main tank, and frailer. No turret and very short reach mean it has to '
    + 'close, so pick your ground before you do.',

  rclSlaghurler:
    'The only hull in the army that can break a base. Its mortar ties for the '
    + 'longest reach of any weapon in the game, but it cannot fire close in, '
    + 'must stop to fire, and is made of paper.',

  rclCrawler:
    'A Foundry folded up and driven around. Take it where you want a second '
    + 'base and press D to unpack it. This is how the Reclamation expands, and '
    + 'how it replaces a Foundry it has lost.',

  rclHornet:
    'The cheapest aircraft in the game and the thinnest-skinned. Its arc chains '
    + 'between targets, so one pass lands on several things at once. Fly it '
    + 'over the line, and keep it away from flak.',

  rclScow:
    'An armed barge. Its bow gun is high explosive, which is what actually '
    + 'hurts a shoreline base, and it carries a squad — the closest thing the '
    + 'Reclamation has to a troop transport.',

  rclHulk:
    "Somebody else's capital ship, welded back together: heavy armour, high "
    + 'explosive and long reach. No turret, though, so you have to point the '
    + 'whole ship, and it cannot answer aircraft.',

  upgRclSwarmDrill:
    'A purchase, not a unit: buy it once and every picker you own or ever train '
    + 'reloads faster. The Reclamation wins by volume, and this is the cheapest '
    + 'way to buy more of it.',

  upgRclOvercharge:
    'A purchase, not a unit: buy it once and every Reclamation hull you own or '
    + 'ever build hits harder. Your hulls are frail and short-ranged, so damage '
    + 'is how they win the exchange they do get.',

  upgRclSalvage:
    'A purchase, not a unit: buy it once and every ore load a Scrapjaw banks is '
    + 'worth more credits — the biggest yield bonus going. It pays off over a '
    + 'long match and does nothing in a short one.',
};

/**
 * The panel brief for a content key, or '' when there is none.
 *
 * '' rather than a throw, and rather than the blurb: the caller
 * (`Hud.extrasFor`) already falls back to the blurb, and it is the only place
 * that knows whether one exists. A key with no entry here is a coverage bug
 * that `tests/build-descriptions.spec.ts` fails on, not something to paper
 * over at runtime.
 *
 * `Object.hasOwn` rather than `?? ''`, and that is not defensive padding: the
 * argument is a content key from a def table, `BUILD_DESCRIPTIONS` is an object
 * literal, and `BUILD_DESCRIPTIONS['toString']` is therefore a FUNCTION off
 * `Object.prototype` — which `?? ''` happily passes through to a `nodeValue`
 * assignment. The spec pins it; the first version of this function failed it.
 */
export function describeBuildable(key: string): string {
  return Object.hasOwn(BUILD_DESCRIPTIONS, key) ? BUILD_DESCRIPTIONS[key] : '';
}
