import type { CardDetailsResponse, CardSearchResponse, CardSearchResult } from '../cards';
import type { CardSummary, ErrorBody, PrintingSummary } from '../common';

// Sample answers for the card search and card page routes, for stub routes and screen
// tests. The cards and printings are made up; their names are stand-ins.

export const emberSignet: CardSummary = {
  id: 13,
  name: 'Ember Signet',
  type: 'gear',
  supertype: null,
  domains: [],
  energy: 2,
  might: null,
  power: 0,
  championTag: null,
  imageUrl: 'https://images.example.com/riftbound/3d994115-378d-4685-a5dc-e448831da434.webp',
};

/** Ember Signet's printings, newest first. */
export const emberSignetPrintings: PrintingSummary[] = [
  {
    printingId: '3d994115-378d-4685-a5dc-e448831da434',
    publicCode: 'OGN-053/298',
    setCode: 'OGN',
    setName: 'Origins',
    collectorNumber: '53',
    rarity: 'common',
    imageUrl: 'https://images.example.com/riftbound/3d994115-378d-4685-a5dc-e448831da434.webp',
    alternateArt: false,
    overnumbered: false,
    signature: false,
    finishes: ['normal'],
    unitPrice: { normal: null, foil: null },
  },
  {
    printingId: '0539b83c-4459-41b5-a001-d15a1c9ddf23',
    publicCode: 'VEN-367/367',
    setCode: 'VEN',
    setName: 'Vendetta',
    collectorNumber: '367',
    rarity: 'uncommon',
    imageUrl: 'https://images.example.com/riftbound/0539b83c-4459-41b5-a001-d15a1c9ddf23.webp',
    alternateArt: false,
    overnumbered: false,
    signature: false,
    finishes: ['normal', 'foil'],
    unitPrice: { normal: null, foil: null },
  },
  {
    printingId: '84128e98-87d6-4c2f-909b-9435a7833e63',
    publicCode: 'SPD-331/331',
    setCode: 'SPD',
    setName: 'Spiritforged Prerelease',
    collectorNumber: '331',
    rarity: 'common',
    imageUrl: 'https://images.example.com/riftbound/84128e98-87d6-4c2f-909b-9435a7833e63.webp',
    alternateArt: false,
    overnumbered: false,
    signature: false,
    finishes: ['normal'],
    unitPrice: { normal: null, foil: null },
  },
];

export const emberRebuke: CardSummary = {
  id: 329,
  name: 'Ember Rebuke',
  type: 'spell',
  supertype: null,
  domains: ['mind'],
  energy: 2,
  might: null,
  power: 1,
  championTag: null,
  imageUrl: 'https://images.example.com/riftbound/5eb843ef-b223-40d0-a461-54b16d188d0e.webp',
};

export const emberSanctum: CardSummary = {
  id: 331,
  name: 'Ember Sanctum',
  type: 'battlefield',
  supertype: null,
  domains: ['order', 'mind'],
  energy: null,
  might: null,
  power: null,
  championTag: null,
  imageUrl: 'https://images.example.com/riftbound/c75eeb97-3249-4762-84b0-387f27fb255f.webp',
};

/** Ember Sanctum's one printing. */
export const emberSanctumPrintings: PrintingSummary[] = [
  {
    printingId: 'c75eeb97-3249-4762-84b0-387f27fb255f',
    publicCode: 'OGN-287/298',
    setCode: 'OGN',
    setName: 'Origins',
    collectorNumber: '287',
    rarity: 'uncommon',
    imageUrl: 'https://images.example.com/riftbound/c75eeb97-3249-4762-84b0-387f27fb255f.webp',
    alternateArt: false,
    overnumbered: false,
    signature: false,
    finishes: ['normal', 'foil'],
    unitPrice: { normal: null, foil: null },
  },
];

export const emberLighthouse: CardSummary = {
  id: 330,
  name: 'Ember Lighthouse',
  type: 'battlefield',
  supertype: null,
  domains: [],
  energy: null,
  might: null,
  power: null,
  championTag: null,
  imageUrl: 'https://images.example.com/riftbound/e2384e42-2442-4b40-9bae-8db470d2fb8c.webp',
};

export const poroEmberRetriever: CardSummary = {
  id: 337,
  name: 'Poro, Ember Retriever',
  type: 'unit',
  supertype: null,
  domains: ['fury', 'calm'],
  energy: 5,
  might: 4,
  power: 2,
  championTag: null,
  imageUrl: 'https://images.example.com/riftbound/066c8f63-52e6-475e-8d27-6ee37e92fc05.webp',
};

/** The Legend of Jeff's sample deck. */
export const jinxLooseCannon: CardSummary = {
  id: 124,
  name: 'Jinx, Loose Cannon',
  type: 'legend',
  supertype: null,
  domains: ['fury', 'chaos'],
  energy: null,
  might: null,
  power: null,
  championTag: 'Jinx',
  imageUrl: 'https://images.example.com/riftbound/6b913e79-a9f6-44d4-bb37-c4f6f66b8151.webp',
};

/** A champion unit of Jinx: the Chosen Champion of a Jinx deck. */
export const jinxRebel: CardSummary = {
  id: 341,
  name: 'Jinx, Rebel',
  type: 'unit',
  supertype: 'champion',
  domains: ['fury', 'chaos'],
  energy: 4,
  might: 4,
  power: 1,
  championTag: 'Jinx',
  imageUrl: 'https://images.example.com/riftbound/0c41d8a2-5e7b-4f0e-9d3a-6a1f2b7c9e10.webp',
};

/** A card with two faces: the name holds both, and the images show the front. */
export const gildedWhelp: CardSummary = {
  id: 121,
  name: 'Gilded Whelp',
  type: 'unit',
  supertype: null,
  domains: ['mind'],
  energy: 1,
  might: 1,
  power: 1,
  championTag: null,
  imageUrl: 'https://images.example.com/riftbound/617208ff-dd9b-44fd-a740-d3188081e5cc.webp',
};

/**
 * Gilded Whelp's printings, newest first (all three came out on the same day): one plain, one
 * overnumbered, and one alternate art signature printing.
 */
export const gildedWhelpPrintings: PrintingSummary[] = [
  {
    printingId: '617208ff-dd9b-44fd-a740-d3188081e5cc',
    publicCode: 'SFD-052/221',
    setCode: 'SFD',
    setName: 'Spiritforged',
    collectorNumber: '52',
    rarity: 'rare',
    imageUrl: 'https://images.example.com/riftbound/617208ff-dd9b-44fd-a740-d3188081e5cc.webp',
    alternateArt: false,
    overnumbered: false,
    signature: false,
    finishes: ['normal', 'foil'],
    unitPrice: { normal: null, foil: null },
  },
  {
    printingId: 'c8f1baae-dd81-4e10-841e-15531ea1ffaa',
    publicCode: 'SFD-317/317',
    setCode: 'SFD',
    setName: 'Spiritforged',
    collectorNumber: '317',
    rarity: 'rare',
    imageUrl: 'https://images.example.com/riftbound/c8f1baae-dd81-4e10-841e-15531ea1ffaa.webp',
    alternateArt: false,
    overnumbered: true,
    signature: false,
    finishes: ['normal', 'foil'],
    unitPrice: { normal: null, foil: null },
  },
  {
    printingId: '7bf58206-b7b6-45e7-b99a-9de1c58c5c96',
    publicCode: 'SFX-52p/52',
    setCode: 'SFX',
    setName: 'Spiritforged Extras',
    collectorNumber: '52p',
    rarity: 'rare',
    imageUrl: 'https://images.example.com/riftbound/7bf58206-b7b6-45e7-b99a-9de1c58c5c96.webp',
    alternateArt: true,
    overnumbered: false,
    signature: true,
    finishes: ['normal', 'foil'],
    unitPrice: { normal: null, foil: null },
  },
];

/** Ember Signet in search results: 3 owned, 2 of them in deck boxes. */
export const emberSignetResult: CardSearchResult = { ...emberSignet, owned: 3, free: 1 };

/** GET /api/cards?q=ember */
export const emberSearch: CardSearchResponse = {
  results: [
    emberSignetResult,
    { ...emberRebuke, owned: 1, free: 0 },
    { ...emberSanctum, owned: 2, free: 2 },
    { ...emberLighthouse, owned: 0, free: 0 },
    { ...poroEmberRetriever, owned: 1, free: 1 },
  ],
};

/** GET /api/cards?q=OGN-053: a public code finds the card with that printing. */
export const publicCodeSearch: CardSearchResponse = { results: [emberSignetResult] };

/** GET /api/cards?q=jinx&type=legend */
export const legendSearch: CardSearchResponse = {
  results: [{ ...jinxLooseCannon, owned: 1, free: 0 }],
};

/** GET /api/cards?q=jinx&type=unit&supertype=champion&championTag=Jinx */
export const championSearch: CardSearchResponse = {
  results: [{ ...jinxRebel, owned: 1, free: 1 }],
};

/** A search that matches nothing. */
export const emptySearch: CardSearchResponse = { results: [] };

/** GET /api/cards/13: 3 owned, one a proxy, 2 in deck boxes. */
export const emberSignetDetails: CardDetailsResponse = {
  card: { ...emberSignet, rulesText: 'Exhaust: Add 1 energy.', deckable: true },
  printings: emberSignetPrintings,
  counts: { owned: 3, proxies: 1, inDecks: 2, free: 1 },
};

/** GET /api/cards/:id for Gilded Whelp. */
export const gildedWhelpDetails: CardDetailsResponse = {
  card: { ...gildedWhelp, rulesText: 'When you play me, draw 1.', deckable: true },
  printings: gildedWhelpPrintings,
  counts: { owned: 1, proxies: 0, inDecks: 0, free: 1 },
};

/** GET /api/cards/331: a battlefield, whose image shows in landscape. */
export const emberSanctumDetails: CardDetailsResponse = {
  card: {
    ...emberSanctum,
    rulesText: 'When you conquer here, draw 1.\nUnits here have +1 might.',
    deckable: true,
  },
  printings: emberSanctumPrintings,
  counts: { owned: 2, proxies: 0, inDecks: 0, free: 2 },
};

/** The 404 GET /api/cards/:id answers for a card the card data doesn't have. */
export const cardNotFoundError: ErrorBody = {
  error: {
    code: 'card_not_found',
    message: "That card isn't in the card data. If it's new, press Refresh card data in Settings.",
  },
};
