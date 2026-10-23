import type { CardSummary, LocationRef, PrintingSummary } from '../common';
import type { DeckList, DeckRef, DeckSummary, DeckView, PrintingHint, SlotRow } from '../decks';
import { cards, printings } from './deck-cards';

// The Decks home and the Hearthhull deck view (a made-up sample). Location and deck ids
// match the assembly samples, so a screen can go from one to the other.

export const locations = {
  toSort: { id: 1, name: 'To sort', type: 'inbox', path: 'To sort', color: null, forTrade: false },
  blackGreen: {
    id: 3,
    name: 'Black & Green',
    type: 'box',
    path: 'Long box › Black & Green',
    color: '#3b6fd8',
    forTrade: false,
  },
  redGold: {
    id: 4,
    name: 'Red & Gold',
    type: 'box',
    path: 'Long box › Red & Gold',
    color: '#3b6fd8',
    forTrade: false,
  },
  lands: {
    id: 5,
    name: 'Lands',
    type: 'box',
    path: 'Long box › Lands',
    color: '#3b6fd8',
    forTrade: false,
  },
  raresBinder: {
    id: 6,
    name: 'Rares binder',
    type: 'binder',
    path: 'Rares binder',
    color: '#7c5cd6',
    forTrade: false,
  },
  staplesBinder: {
    id: 7,
    name: 'Staples binder',
    type: 'binder',
    path: 'Staples binder',
    color: '#1b9aa0',
    forTrade: false,
  },
  bulkTray: {
    id: 8,
    name: 'Bulk tray',
    type: 'tray',
    path: 'Bulk tray',
    color: '#8a6248',
    forTrade: false,
  },
  tradeBinder: {
    id: 12,
    name: 'Trade binder',
    type: 'binder',
    path: 'Trade binder',
    color: '#d9822b',
    forTrade: true,
  },
} satisfies Record<string, LocationRef>;

export const deckRefs = {
  hearthhull: { id: 1, name: 'Hearthhull' },
  atraxa: { id: 2, name: 'Atraxa' },
  lathril: { id: 3, name: 'Lathril' },
  meren: { id: 4, name: 'Meren' },
  prosper: { id: 5, name: 'Prosper' },
  tymnaThrasios: { id: 6, name: 'Tymna & Thrasios' },
} satisfies Record<string, DeckRef>;

const nowhere = { locations: [], freeCount: 0, otherDecks: [] };

type SlotOptions = Partial<Omit<SlotRow, 'id' | 'card'>>;

/** The Hearthhull slots' tags, by slot id, sorted by name ignoring case. */
const tagsBySlot: Record<number, string[]> = {
  104: ['Removal'], // Infernal Grasp
  105: ['Ramp'], // Cultivate
  106: ['Card draw'], // Tireless Tracker
  114: ['Ramp'], // Sol Ring
  116: ['Removal'], // Beast Within
  118: ['Ramp'], // Arcane Signet
  129: ['Card draw'], // Aftermath Analyst
  130: ['Card draw', 'Ramp'], // Augur of Autumn
  133: ['Removal'], // Blasphemous Act
  147: ['Ramp'], // Farseek
};

/** A slot of the Hearthhull deck, on the main board with one copy unless `options` say otherwise. */
function slot(id: number, card: CardSummary, options: SlotOptions = {}): SlotRow {
  const row: SlotRow = {
    id,
    card,
    board: 'main',
    quantity: 1,
    pickedPrinting: null,
    printing: null,
    hint: null,
    status: 'in_box',
    inBoxQuantity: 0,
    inBoxProxy: false,
    where: nowhere,
    tags: tagsBySlot[id] ?? [],
    ...options,
  };
  row.printing = options.printing ?? row.pickedPrinting ?? hintedPrinting(card, row.hint);
  return row;
}

/** The sample printing a hint names, as the server finds it. */
function hintedPrinting(card: CardSummary, hint: PrintingHint | null): PrintingSummary | null {
  if (!hint) return null;
  return (
    Object.values(printings).find(
      (printing) =>
        printing.oracleId === card.oracleId &&
        printing.setCode === hint.setCode &&
        printing.collectorNumber === hint.collectorNumber,
    ) ?? null
  );
}

/** The deck list's printing for the card, as its printing hint. */
function hintFor(printing: PrintingSummary, foil = false): PrintingHint {
  return { setCode: printing.setCode, collectorNumber: printing.collectorNumber, foil };
}

/** A slot whose copy is in the Hearthhull deck box, pulled in the export's printing. */
function inBox(id: number, key: keyof typeof printings, options: SlotOptions = {}): SlotRow {
  const printing = printings[key];
  return slot(id, cards[key], {
    pickedPrinting: printing,
    hint: hintFor(printing),
    inBoxQuantity: 1,
    ...options,
  });
}

/** A slot with free copies in storage, in `where` order. */
function free(
  id: number,
  key: keyof typeof printings,
  where: LocationRef[],
  freeCount = where.length,
) {
  return slot(id, cards[key], {
    hint: hintFor(printings[key]),
    status: 'free',
    where: { locations: where, freeCount, otherDecks: [] },
  });
}

/** A slot whose only copies are in other decks' boxes. */
function inOtherDecks(id: number, key: keyof typeof printings, decks: DeckRef[]) {
  return slot(id, cards[key], {
    hint: hintFor(printings[key]),
    status: 'other_decks',
    where: { locations: [], freeCount: 0, otherDecks: decks },
  });
}

function missing(id: number, key: keyof typeof printings, options: SlotOptions = {}) {
  return slot(id, cards[key], { hint: hintFor(printings[key]), status: 'missing', ...options });
}

function basic(id: number, key: keyof typeof printings, quantity: number) {
  return slot(id, cards[key], { quantity, hint: hintFor(printings[key]), status: 'basic' });
}

function maybe(id: number, key: keyof typeof printings, options: SlotOptions = {}) {
  return slot(id, cards[key], {
    board: 'maybe',
    hint: hintFor(printings[key]),
    status: null,
    ...options,
  });
}

const { toSort, blackGreen, redGold, lands, raresBinder, staplesBinder, bulkTray, tradeBinder } =
  locations;
const { atraxa, lathril, meren } = deckRefs;

const solRingSlot = free(114, 'solRing', [staplesBinder, toSort], 3);

/** Every slot of the Hearthhull deck: 58 cards in the box, 13 free, 4 in other decks, 3 missing, 17 basics, and 5 on the maybe board. */
export const hearthhullSlots: SlotRow[] = [
  inBox(101, 'hearthhullTheWorldseed', {
    board: 'commander',
    hint: hintFor(printings.hearthhullTheWorldseed, true),
  }),

  // Free in storage.
  free(104, 'infernalGrasp', [blackGreen, staplesBinder]),
  free(105, 'cultivate', [blackGreen, bulkTray], 4),
  free(106, 'tirelessTracker', [blackGreen]),
  free(107, 'putrefy', [blackGreen]),
  free(108, 'mayhemDevil', [redGold]),
  free(109, 'rakdosCharm', [redGold]),
  // Only a proxy is free.
  free(110, 'korvoldFaeCursedKing', [redGold]),
  free(111, 'theGitrogMonster', [raresBinder]),
  free(112, 'oracleOfMulDaya', [raresBinder]),
  free(113, 'titaniaProtectorOfArgoth', [raresBinder]),
  solRingSlot,
  free(115, 'commandTower', [staplesBinder]),
  free(116, 'beastWithin', [tradeBinder]),

  // Only in other decks' boxes.
  inOtherDecks(118, 'arcaneSignet', [atraxa, meren]),
  inOtherDecks(121, 'skyshroudClaim', [atraxa]),
  inOtherDecks(122, 'naturesLore', [lathril]),
  inOtherDecks(123, 'nightsWhisper', [meren]),

  // Not owned.
  missing(119, 'soulOfWindgrace'),
  // Added in the app rather than from a deck list, so there is no printing hint.
  missing(120, 'omnathLocusOfRage', { hint: null }),
  missing(124, 'splendidReclamation'),

  // Basic lands are always available, so they are never pulled.
  basic(125, 'forest', 8),
  basic(126, 'mountain', 3),
  basic(127, 'swamp', 5),
  basic(128, 'wastes', 1),

  // In the box.
  inBox(117, 'fabledPassage'),
  inBox(129, 'aftermathAnalyst'),
  inBox(130, 'augurOfAutumn'),
  inBox(131, 'balothPrime'),
  inBox(132, 'bindingTheOldGods'),
  inBox(133, 'blasphemousAct'),
  inBox(134, 'bojukaBog'),
  inBox(135, 'braidsArisenNightmare'),
  inBox(136, 'cabarettiCourtyard'),
  inBox(137, 'canyonSlough'),
  inBox(138, 'cinderGlade'),
  inBox(139, 'dakmorSalvage'),
  inBox(140, 'escapeToTheWilds'),
  inBox(141, 'escapeTunnel'),
  inBox(142, 'eumidianHatchery'),
  inBox(143, 'eumidianWastewaker'),
  inBox(144, 'evendoBrushrazer'),
  inBox(145, 'evolvingWilds', { where: { locations: [lands], freeCount: 2, otherDecks: [] } }),
  inBox(146, 'explorationBroodship'),
  inBox(147, 'farseek'),
  inBox(148, 'festeringThicket'),
  inBox(149, 'formlessGenesis'),
  inBox(150, 'gazeOfGranite'),
  inBox(151, 'godEternalBontu'),
  inBox(152, 'hammerOfPurphoros'),
  inBox(153, 'harrow'),
  inBox(154, 'horizonExplorer'),
  inBox(155, 'juriMasterOfTheRevue'),
  inBox(156, 'karplusanForest'),
  inBox(157, 'llanowarWastes'),
  inBox(158, 'maestrosTheater'),
  inBox(159, 'mazirekKraulDeathPriest'),
  // A proxy stands in for this one.
  inBox(160, 'moraugFuryOfAkoum', { inBoxProxy: true }),
  inBox(161, 'mountainValley'),
  inBox(162, 'multaniYavimayasAvatar'),
  inBox(163, 'myriadLandscape'),
  inBox(164, 'pestInfestation'),
  inBox(165, 'planetaryAnnihilation'),
  inBox(166, 'rampagingBaloths'),
  inBox(167, 'riveteersOverlook'),
  inBox(168, 'rockyTarPit'),
  inBox(169, 'roilingRegrowth'),
  inBox(170, 'satyrWayfinder'),
  inBox(171, 'scouringSwarm'),
  inBox(172, 'shelteredThicket'),
  inBox(173, 'smolderingMarsh'),
  inBox(174, 'springbloomDruid'),
  inBox(175, 'sproutingGoblin'),
  inBox(176, 'sulfurousSprings'),
  inBox(177, 'szarelGenesisShepherd', { hint: hintFor(printings.szarelGenesisShepherd, true) }),
  inBox(178, 'tearAsunder'),
  inBox(179, 'terramorphicExpanse'),
  inBox(180, 'twilightMire'),
  inBox(181, 'vernalFen'),
  inBox(182, 'viridescentBog'),
  inBox(183, 'windgracesJudgment'),
  inBox(184, 'worldsoulsRage'),

  // The maybe board has no status. One maybe card is still in the box from an earlier list.
  maybe(185, 'centaurVinecrasher', {
    where: { locations: [blackGreen], freeCount: 1, otherDecks: [] },
  }),
  maybe(186, 'groundskeeper', {
    pickedPrinting: printings.groundskeeper,
    inBoxQuantity: 1,
  }),
  maybe(187, 'loamcrafterFaun'),
  maybe(188, 'uurgSpawnOfTurg', { where: { locations: [], freeCount: 0, otherDecks: [meren] } }),
  maybe(189, 'worldBreaker', { where: { locations: [bulkTray], freeCount: 1, otherDecks: [] } }),
];

export const hearthhull: DeckSummary = {
  ...deckRefs.hearthhull,
  deckBoxId: 9,
  commanders: [cards.hearthhullTheWorldseed],
  colorIdentity: 'BRG',
  state: 'partly_assembled',
  counts: { inBox: 58, free: 13, otherDecks: 4, missing: 3, basics: 17 },
  // The 58 plus Groundskeeper, still in the box from the maybe board.
  boxCopyCount: 59,
  openedAt: '2026-10-18T21:40:00Z',
};

const atraxaDeck: DeckSummary = {
  ...deckRefs.atraxa,
  deckBoxId: 10,
  commanders: [cards.atraxaPraetorsVoice],
  colorIdentity: 'WUBG',
  state: 'assembled',
  counts: { inBox: 89, free: 0, otherDecks: 0, missing: 0, basics: 11 },
  boxCopyCount: 89,
  openedAt: '2026-10-17T19:12:00Z',
};

const lathrilDeck: DeckSummary = {
  ...deckRefs.lathril,
  deckBoxId: 11,
  commanders: [cards.lathrilBladeOfTheElves],
  colorIdentity: 'BG',
  state: 'assembled',
  counts: { inBox: 66, free: 0, otherDecks: 0, missing: 0, basics: 34 },
  boxCopyCount: 66,
  openedAt: '2026-10-15T02:30:00Z',
};

const merenDeck: DeckSummary = {
  ...deckRefs.meren,
  deckBoxId: 12,
  commanders: [cards.merenOfClanNelToth],
  colorIdentity: 'BG',
  state: 'assembled',
  counts: { inBox: 68, free: 0, otherDecks: 0, missing: 0, basics: 32 },
  boxCopyCount: 68,
  openedAt: '2026-10-11T23:05:00Z',
};

const prosperDeck: DeckSummary = {
  ...deckRefs.prosper,
  deckBoxId: 13,
  commanders: [cards.prosperTomeBound],
  colorIdentity: 'BR',
  state: 'not_assembled',
  counts: { inBox: 0, free: 60, otherDecks: 7, missing: 6, basics: 27 },
  boxCopyCount: 0,
  openedAt: '2026-10-02T18:44:00Z',
};

/** Two partner commanders, imported from a deck list and never opened. */
export const tymnaThrasios: DeckSummary = {
  ...deckRefs.tymnaThrasios,
  deckBoxId: 14,
  commanders: [cards.tymnaTheWeaver, cards.thrasiosTritonHero],
  colorIdentity: 'WUBG',
  state: 'not_assembled',
  counts: { inBox: 0, free: 52, otherDecks: 9, missing: 11, basics: 28 },
  boxCopyCount: 0,
  openedAt: null,
};

/** GET /api/decks: the Decks home, most recently opened first. */
export const deckListSample: DeckList = {
  decks: [hearthhull, atraxaDeck, lathrilDeck, merenDeck, prosperDeck, tymnaThrasios],
};

/** GET /api/decks/1: the Hearthhull deck view. */
export const deckViewSample: DeckView = { deck: hearthhull, slots: hearthhullSlots };

/** POST /api/decks: a new deck holds only its commanders, which are free in storage. */
export const newDeckSample: DeckSummary = {
  id: 7,
  name: 'Korvold',
  deckBoxId: 15,
  commanders: [cards.korvoldFaeCursedKing],
  colorIdentity: 'BRG',
  state: 'not_assembled',
  counts: { inBox: 0, free: 1, otherDecks: 0, missing: 0, basics: 0 },
  boxCopyCount: 0,
  openedAt: null,
};

/** POST /api/decks/1/slots and PATCH /api/decks/1/slots/114: the Sol Ring slot. */
export const slotSample: SlotRow = solRingSlot;

/** PUT /api/decks/1/slots/114/tags with `{ tags: ['Ramp', 'mana rock', 'ramp'] }`: repeats merge. */
export const slotTagsSample: SlotRow = { ...solRingSlot, tags: ['mana rock', 'Ramp'] };
