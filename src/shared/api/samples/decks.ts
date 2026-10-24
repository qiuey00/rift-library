import { Board, type CardSummary, type LocationRef, type PrintingSummary } from '../common';
import type { DeckList, DeckRef, DeckSummary, DeckView, PrintingHint, SlotRow } from '../decks';
import { cards, printings } from './deck-cards';

// The Decks home and the Jinx Burn deck view (a made-up sample). Location and deck ids
// match the assembly samples, so a screen can go from one to the other.

export const locations = {
  toSort: { id: 1, name: 'To sort', type: 'inbox', path: 'To sort', color: null, forTrade: false },
  chaosCalm: {
    id: 3,
    name: 'Chaos & Calm',
    type: 'box',
    path: 'Long box › Chaos & Calm',
    color: '#3b6fd8',
    forTrade: false,
  },
  furyOrder: {
    id: 4,
    name: 'Fury & Order',
    type: 'box',
    path: 'Long box › Fury & Order',
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
  jinxBurn: { id: 1, name: 'Jinx Burn' },
  luxControl: { id: 2, name: 'Lux Control' },
  viktorTempo: { id: 3, name: 'Viktor Tempo' },
  ahriMidrange: { id: 4, name: 'Ahri Midrange' },
  annieAggro: { id: 5, name: 'Annie Aggro' },
  leeSinCombo: { id: 6, name: 'Lee Sin Combo' },
} satisfies Record<string, DeckRef>;

const nowhere = { locations: [], freeCount: 0, otherDecks: [] };

type SlotOptions = Partial<Omit<SlotRow, 'id' | 'card'>>;

/** The Jinx Burn slots' tags, by slot id, sorted by name ignoring case. */
const tagsBySlot: Record<number, string[]> = {
  104: ['Removal'], // Fierce Blast
  105: ['Ramp'], // Grim Scheme
  106: ['Card draw'], // Vast Scout
  114: ['Ramp'], // Sun Disc
  116: ['Removal'], // Unbound Volley
  118: ['Ramp'], // Ember Signet
  129: ['Card draw'], // Tidal Vanguard
  130: ['Card draw', 'Ramp'], // Copper Mender
  133: ['Removal'], // Vigilant Surge
  147: ['Ramp'], // Iron Insight
};

/** A slot of the Jinx Burn deck, on the main board with one copy unless `options` say otherwise. */
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
  const key = (Object.keys(printings) as (keyof typeof printings)[]).find(
    (key) =>
      cards[key].id === card.id && printings[key].publicCode.startsWith(`${hint.publicCode}/`),
  );
  return key ? printings[key] : null;
}

/** The deck list's printing for the card, as its printing hint: its public code, such as "OGN-001". */
function hintFor(printing: PrintingSummary, foil = false): PrintingHint {
  return { publicCode: printing.publicCode.split('/')[0], foil };
}

/** A slot whose copy is in the Jinx Burn deck box, pulled in the export's printing. */
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

function rune(id: number, key: keyof typeof printings, quantity: number) {
  return slot(id, cards[key], {
    board: 'rune',
    quantity,
    hint: hintFor(printings[key]),
    status: 'rune',
  });
}

function maybe(id: number, key: keyof typeof printings, options: SlotOptions = {}) {
  return slot(id, cards[key], {
    board: 'maybe',
    hint: hintFor(printings[key]),
    status: null,
    ...options,
  });
}

const { toSort, chaosCalm, furyOrder, lands, raresBinder, staplesBinder, bulkTray, tradeBinder } =
  locations;
const { luxControl, viktorTempo, ahriMidrange } = deckRefs;

const sunDiscSlot = free(114, 'sunDisc', [staplesBinder, toSort], 3);

/** Every slot of the Jinx Burn deck: 58 cards in the box, 13 free, 4 in other decks, 3 missing, 17 runes, and 5 on the maybe board. */
export const jinxBurnSlots: SlotRow[] = [
  inBox(101, 'jinxLooseCannon', {
    board: 'legend',
    hint: hintFor(printings.jinxLooseCannon, true),
  }),

  // Free in storage.
  free(104, 'fierceBlast', [chaosCalm, staplesBinder]),
  free(105, 'grimScheme', [chaosCalm, bulkTray], 4),
  free(106, 'vastScout', [chaosCalm]),
  free(107, 'boldRally', [chaosCalm]),
  free(108, 'rogueCaptain', [furyOrder]),
  free(109, 'twilightGust', [furyOrder]),
  // Only a proxy is free.
  free(110, 'dariusHandOfNoxus', [furyOrder]),
  free(111, 'starlitGearwright', [raresBinder]),
  free(112, 'wildGuardian', [raresBinder]),
  free(113, 'viOutlaw', [raresBinder]),
  sunDiscSlot,
  free(115, 'targonsPeak', [staplesBinder]),
  free(116, 'unboundVolley', [tradeBinder]),

  // Only in other decks' boxes.
  inOtherDecks(118, 'emberSignet', [luxControl, ahriMidrange]),
  inOtherDecks(121, 'duskLash', [luxControl]),
  inOtherDecks(122, 'dawnMend', [viktorTempo]),
  inOtherDecks(123, 'sunkenEdict', [ahriMidrange]),

  // Not owned.
  missing(119, 'swiftOx'),
  // Added in the app rather than from a deck list, so there is no printing hint.
  missing(120, 'nasusTrickster', { hint: null }),
  missing(124, 'twilightFlare'),

  // Runes are always available, so they are never pulled.
  rune(125, 'calmRune', 8),
  rune(126, 'furyRune', 3),
  rune(127, 'chaosRune', 5),
  rune(128, 'bodyRune', 1),

  // In the box.
  inBox(117, 'grimSteppe', { board: 'battlefield' }),
  inBox(129, 'tidalVanguard'),
  inBox(130, 'copperMender'),
  inBox(131, 'lunarHarrier'),
  inBox(132, 'crimsonIdol'),
  inBox(133, 'vigilantSurge'),
  inBox(134, 'eagerSteppe', { board: 'battlefield' }),
  inBox(135, 'volibearPathfinder'),
  inBox(136, 'ninefoldTemple', { board: 'battlefield' }),
  inBox(137, 'starlitCitadel'),
  inBox(138, 'weatheredCanyon'),
  inBox(139, 'twilightQuarry'),
  inBox(140, 'ninefoldVerdict'),
  inBox(141, 'jadeGlade'),
  inBox(142, 'rustedTemple'),
  inBox(143, 'stormSage'),
  inBox(144, 'ferventCharger'),
  inBox(145, 'paleCrossing', { where: { locations: [lands], freeCount: 2, otherDecks: [] } }),
  inBox(146, 'radiantIdol'),
  inBox(147, 'ironInsight'),
  inBox(148, 'ninefoldDocks'),
  inBox(149, 'waryRecall'),
  inBox(150, 'moltenCleave'),
  inBox(151, 'crimsonShaman'),
  inBox(152, 'moltenHourglass'),
  inBox(153, 'emberRecall'),
  inBox(154, 'bitterZealot'),
  inBox(155, 'jaxVanguard'),
  inBox(156, 'hextechVault'),
  inBox(157, 'proudCitadel'),
  inBox(158, 'verdantShrine'),
  inBox(159, 'leonaVeteran'),
  // A proxy stands in for this one.
  inBox(160, 'sennaOutlaw', { inBoxProxy: true }),
  inBox(161, 'spectralBridge'),
  inBox(162, 'heimerdingerWarden'),
  inBox(163, 'frostPlaza'),
  inBox(164, 'echoingBurst'),
  inBox(165, 'dawnUproar'),
  inBox(166, 'swiftSkirmisher'),
  inBox(167, 'blazingArchive'),
  inBox(168, 'ninefoldCitadel'),
  inBox(169, 'brazenTithe'),
  inBox(170, 'clockworkGearwright'),
  inBox(171, 'grimProwler'),
  inBox(172, 'starlitHollow'),
  inBox(173, 'rustedOutpost'),
  inBox(174, 'lunarReaver'),
  inBox(175, 'scorchedHerald'),
  inBox(176, 'brineHollow'),
  inBox(177, 'fioraGuardian', { hint: hintFor(printings.fioraGuardian, true) }),
  inBox(178, 'mysticWhirl'),
  inBox(179, 'stormHollow'),
  inBox(180, 'cinderHarbor'),
  inBox(181, 'frostBluffs'),
  inBox(182, 'voidDocks'),
  inBox(183, 'goldenSnare'),
  inBox(184, 'warySweep'),

  // The maybe board has no status. One maybe card is still in the box from an earlier list.
  maybe(185, 'primalPriest', {
    where: { locations: [chaosCalm], freeCount: 1, otherDecks: [] },
  }),
  maybe(186, 'hextechCaptain', {
    pickedPrinting: printings.hextechCaptain,
    inBoxQuantity: 1,
  }),
  maybe(187, 'ivoryReaver'),
  maybe(188, 'volibearVanguard', {
    where: { locations: [], freeCount: 0, otherDecks: [ahriMidrange] },
  }),
  maybe(189, 'dawnHarrier', { where: { locations: [bulkTray], freeCount: 1, otherDecks: [] } }),
];

export const jinxBurn: DeckSummary = {
  ...deckRefs.jinxBurn,
  deckBoxId: 9,
  legend: cards.jinxLooseCannon,
  champion: null,
  domains: cards.jinxLooseCannon.domains,
  state: 'partly_assembled',
  counts: { inBox: 58, free: 13, otherDecks: 4, missing: 3, runes: 17 },
  // The 58 plus Hextech Captain, still in the box from the maybe board.
  boxCopyCount: 59,
  openedAt: '2026-10-18T21:40:00Z',
};

const luxControlDeck: DeckSummary = {
  ...deckRefs.luxControl,
  deckBoxId: 10,
  legend: cards.luxLadyOfLuminosity,
  champion: null,
  domains: cards.luxLadyOfLuminosity.domains,
  state: 'assembled',
  counts: { inBox: 89, free: 0, otherDecks: 0, missing: 0, runes: 11 },
  boxCopyCount: 89,
  openedAt: '2026-10-17T19:12:00Z',
};

const viktorTempoDeck: DeckSummary = {
  ...deckRefs.viktorTempo,
  deckBoxId: 11,
  legend: cards.viktorHeraldOfTheArcane,
  champion: null,
  domains: cards.viktorHeraldOfTheArcane.domains,
  state: 'assembled',
  counts: { inBox: 66, free: 0, otherDecks: 0, missing: 0, runes: 34 },
  boxCopyCount: 66,
  openedAt: '2026-10-15T02:30:00Z',
};

const ahriMidrangeDeck: DeckSummary = {
  ...deckRefs.ahriMidrange,
  deckBoxId: 12,
  legend: cards.ahriNineTailedFox,
  champion: null,
  domains: cards.ahriNineTailedFox.domains,
  state: 'assembled',
  counts: { inBox: 68, free: 0, otherDecks: 0, missing: 0, runes: 32 },
  boxCopyCount: 68,
  openedAt: '2026-10-11T23:05:00Z',
};

const annieAggroDeck: DeckSummary = {
  ...deckRefs.annieAggro,
  deckBoxId: 13,
  legend: cards.annieDarkChild,
  champion: null,
  domains: cards.annieDarkChild.domains,
  state: 'not_assembled',
  counts: { inBox: 0, free: 60, otherDecks: 7, missing: 6, runes: 27 },
  boxCopyCount: 0,
  openedAt: '2026-10-02T18:44:00Z',
};

/** A Legend and its Chosen Champion, imported from a deck list and never opened. */
export const leeSinCombo: DeckSummary = {
  ...deckRefs.leeSinCombo,
  deckBoxId: 14,
  legend: cards.leeSinBlindMonk,
  champion: cards.leeSinCentered,
  domains: cards.leeSinBlindMonk.domains,
  state: 'not_assembled',
  counts: { inBox: 0, free: 52, otherDecks: 9, missing: 11, runes: 28 },
  boxCopyCount: 0,
  openedAt: null,
};

/** GET /api/decks: the Decks home, most recently opened first. */
export const deckListSample: DeckList = {
  decks: [jinxBurn, luxControlDeck, viktorTempoDeck, ahriMidrangeDeck, annieAggroDeck, leeSinCombo],
};

/** GET /api/decks/1: the Jinx Burn deck view, board by board. It has no Chosen Champion or sideboard yet. */
export const deckViewSample: DeckView = {
  deck: jinxBurn,
  slots: [...jinxBurnSlots].sort(
    (a, b) => Board.options.indexOf(a.board) - Board.options.indexOf(b.board),
  ),
  boards: { legend: 1, champion: 0, main: 74, battlefield: 3, rune: 17, sideboard: 0, maybe: 5 },
};

/** POST /api/decks: a new deck holds only its Legend, which is free in storage. */
export const newDeckSample: DeckSummary = {
  id: 7,
  name: 'Darius Aggro',
  deckBoxId: 15,
  legend: cards.dariusHandOfNoxus,
  champion: null,
  domains: cards.dariusHandOfNoxus.domains,
  state: 'not_assembled',
  counts: { inBox: 0, free: 1, otherDecks: 0, missing: 0, runes: 0 },
  boxCopyCount: 0,
  openedAt: null,
};

/** POST /api/decks/1/slots and PATCH /api/decks/1/slots/114: the Sun Disc slot. */
export const slotSample: SlotRow = sunDiscSlot;

/** PUT /api/decks/1/slots/114/tags with `{ tags: ['Ramp', 'energy rock', 'ramp'] }`: repeats merge. */
export const slotTagsSample: SlotRow = { ...sunDiscSlot, tags: ['energy rock', 'Ramp'] };
