import type { CardDetailsResponse, CardSearchResponse, CardSearchResult } from '../cards';
import type { CardSummary, ErrorBody, PrintingSummary } from '../common';

// Sample answers for the card search and card page routes, for stub routes and screen
// tests. The cards and printings are Magic stand-ins until #5.

export const arcaneSignet: CardSummary = {
  oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
  name: 'Arcane Signet',
  frontFaceName: 'Arcane Signet',
  manaCost: '{2}',
  manaValue: 2,
  typeLine: 'Artifact',
  colorIdentity: '',
  imageSmall:
    'https://images.example.com/small/front/3/d/3d994115-378d-4685-a5dc-e448831da434.jpg?1783906051',
  imageNormal:
    'https://images.example.com/normal/front/3/d/3d994115-378d-4685-a5dc-e448831da434.jpg?1783906051',
  canBeCommander: false,
  isBasicLand: false,
};

/** Arcane Signet's printings, newest first. */
export const arcaneSignetPrintings: PrintingSummary[] = [
  {
    printingId: '3d994115-378d-4685-a5dc-e448831da434',
    oracleId: arcaneSignet.oracleId,
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '53',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/3/d/3d994115-378d-4685-a5dc-e448831da434.jpg?1783906051',
    imageNormal:
      'https://images.example.com/normal/front/3/d/3d994115-378d-4685-a5dc-e448831da434.jpg?1783906051',
  },
  {
    printingId: '0539b83c-4459-41b5-a001-d15a1c9ddf23',
    oracleId: arcaneSignet.oracleId,
    setCode: 'cmm',
    setName: 'Commander Masters',
    collectorNumber: '367',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/0/5/0539b83c-4459-41b5-a001-d15a1c9ddf23.jpg?1783915606',
    imageNormal:
      'https://images.example.com/normal/front/0/5/0539b83c-4459-41b5-a001-d15a1c9ddf23.jpg?1783915606',
  },
  {
    printingId: '84128e98-87d6-4c2f-909b-9435a7833e63',
    oracleId: arcaneSignet.oracleId,
    setCode: 'eld',
    setName: 'Throne of Eldraine',
    collectorNumber: '331',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/8/4/84128e98-87d6-4c2f-909b-9435a7833e63.jpg?1783932545',
    imageNormal:
      'https://images.example.com/normal/front/8/4/84128e98-87d6-4c2f-909b-9435a7833e63.jpg?1783932545',
  },
];

export const arcaneDenial: CardSummary = {
  oracleId: 'ab1cc360-b9de-48d9-9983-4dfe4a7d2a37',
  name: 'Arcane Denial',
  frontFaceName: 'Arcane Denial',
  manaCost: '{1}{U}',
  manaValue: 2,
  typeLine: 'Instant',
  colorIdentity: 'U',
  imageSmall:
    'https://images.example.com/small/front/5/e/5eb843ef-b223-40d0-a461-54b16d188d0e.jpg?1783903242',
  imageNormal:
    'https://images.example.com/normal/front/5/e/5eb843ef-b223-40d0-a461-54b16d188d0e.jpg?1783903242',
  canBeCommander: false,
  isBasicLand: false,
};

export const arcaneSanctum: CardSummary = {
  oracleId: '7d7cf15c-06b9-4062-a1eb-32614c458a3b',
  name: 'Arcane Sanctum',
  frontFaceName: 'Arcane Sanctum',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Land',
  colorIdentity: 'WUB',
  imageSmall:
    'https://images.example.com/small/front/c/7/c75eeb97-3249-4762-84b0-387f27fb255f.jpg?1783909581',
  imageNormal:
    'https://images.example.com/normal/front/c/7/c75eeb97-3249-4762-84b0-387f27fb255f.jpg?1783909581',
  canBeCommander: false,
  isBasicLand: false,
};

export const arcaneLighthouse: CardSummary = {
  oracleId: '30ac68e6-160a-41f9-9f0f-0e0eef383150',
  name: 'Arcane Lighthouse',
  frontFaceName: 'Arcane Lighthouse',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Land',
  colorIdentity: '',
  imageSmall:
    'https://images.example.com/small/front/e/2/e2384e42-2442-4b40-9bae-8db470d2fb8c.jpg?1783903735',
  imageNormal:
    'https://images.example.com/normal/front/e/2/e2384e42-2442-4b40-9bae-8db470d2fb8c.jpg?1783903735',
  canBeCommander: false,
  isBasicLand: false,
};

export const pakoArcaneRetriever: CardSummary = {
  oracleId: '680a3e17-5144-4e97-bc59-9f5fc3ad6514',
  name: 'Pako, Arcane Retriever',
  frontFaceName: 'Pako, Arcane Retriever',
  manaCost: '{3}{R}{G}',
  manaValue: 5,
  typeLine: 'Legendary Creature — Elemental Dog',
  colorIdentity: 'RG',
  imageSmall:
    'https://images.example.com/small/front/0/6/066c8f63-52e6-475e-8d27-6ee37e92fc05.jpg?1783931230',
  imageNormal:
    'https://images.example.com/normal/front/0/6/066c8f63-52e6-475e-8d27-6ee37e92fc05.jpg?1783931230',
  canBeCommander: true,
  isBasicLand: false,
};

/** The commander of Jeff's sample deck: a Spacecraft, not a creature, that can be a commander. */
export const hearthhullTheWorldseed: CardSummary = {
  oracleId: '8d6f82d9-5c5b-4c41-8857-c0936f2d894c',
  name: 'Hearthhull, the Worldseed',
  frontFaceName: 'Hearthhull, the Worldseed',
  manaCost: '{1}{B}{R}{G}',
  manaValue: 4,
  typeLine: 'Legendary Artifact — Spacecraft',
  colorIdentity: 'BRG',
  imageSmall:
    'https://images.example.com/small/front/6/b/6b913e79-a9f6-44d4-bb37-c4f6f66b8151.jpg?1783906067',
  imageNormal:
    'https://images.example.com/normal/front/6/b/6b913e79-a9f6-44d4-bb37-c4f6f66b8151.jpg?1783906067',
  canBeCommander: true,
  isBasicLand: false,
};

/** A card with two faces: the name holds both, and the images show the front. */
export const harmonizedTrio: CardSummary = {
  oracleId: 'f6036065-7196-44d4-8a27-2199f0e1a03c',
  name: 'Harmonized Trio // Brainstorm',
  frontFaceName: 'Harmonized Trio',
  manaCost: '{U} // {U}',
  manaValue: 1,
  typeLine: 'Creature — Merfolk Bard Wizard // Instant',
  colorIdentity: 'U',
  imageSmall:
    'https://images.example.com/small/front/6/1/617208ff-dd9b-44fd-a740-d3188081e5cc.jpg?1783903691',
  imageNormal:
    'https://images.example.com/normal/front/6/1/617208ff-dd9b-44fd-a740-d3188081e5cc.jpg?1783903691',
  canBeCommander: false,
  isBasicLand: false,
};

/** Harmonized Trio's printings, newest first (all three came out on the same day). */
export const harmonizedTrioPrintings: PrintingSummary[] = [
  {
    printingId: '617208ff-dd9b-44fd-a740-d3188081e5cc',
    oracleId: harmonizedTrio.oracleId,
    setCode: 'sos',
    setName: 'Secrets of Strixhaven',
    collectorNumber: '52',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/6/1/617208ff-dd9b-44fd-a740-d3188081e5cc.jpg?1783903691',
    imageNormal:
      'https://images.example.com/normal/front/6/1/617208ff-dd9b-44fd-a740-d3188081e5cc.jpg?1783903691',
  },
  {
    printingId: 'c8f1baae-dd81-4e10-841e-15531ea1ffaa',
    oracleId: harmonizedTrio.oracleId,
    setCode: 'sos',
    setName: 'Secrets of Strixhaven',
    collectorNumber: '317',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/c/8/c8f1baae-dd81-4e10-841e-15531ea1ffaa.jpg?1783903598',
    imageNormal:
      'https://images.example.com/normal/front/c/8/c8f1baae-dd81-4e10-841e-15531ea1ffaa.jpg?1783903598',
  },
  {
    printingId: '7bf58206-b7b6-45e7-b99a-9de1c58c5c96',
    oracleId: harmonizedTrio.oracleId,
    setCode: 'psos',
    setName: 'Secrets of Strixhaven Promos',
    collectorNumber: '52p',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/7/b/7bf58206-b7b6-45e7-b99a-9de1c58c5c96.jpg?1783903554',
    imageNormal:
      'https://images.example.com/normal/front/7/b/7bf58206-b7b6-45e7-b99a-9de1c58c5c96.jpg?1783903554',
  },
];

/** Arcane Signet in search results: 3 owned, 2 of them in deck boxes. */
export const arcaneSignetResult: CardSearchResult = { ...arcaneSignet, owned: 3, free: 1 };

/** GET /api/cards/search?q=arcane */
export const arcaneSearch: CardSearchResponse = {
  results: [
    arcaneSignetResult,
    { ...arcaneDenial, owned: 1, free: 0 },
    { ...arcaneSanctum, owned: 2, free: 2 },
    { ...arcaneLighthouse, owned: 0, free: 0 },
    { ...pakoArcaneRetriever, owned: 1, free: 1 },
  ],
};

/** GET /api/cards/search?q=hearthhull&commander=1 */
export const commanderSearch: CardSearchResponse = {
  results: [{ ...hearthhullTheWorldseed, owned: 1, free: 0 }],
};

/** A search that matches nothing. */
export const emptySearch: CardSearchResponse = { results: [] };

/** GET /api/cards/0bc7f093-bef0-4f1a-852c-4b75ebf54838: 3 owned, one a proxy, 2 in deck boxes. */
export const arcaneSignetDetails: CardDetailsResponse = {
  card: { ...arcaneSignet, keywords: [], commanderLegality: 'legal' },
  printings: arcaneSignetPrintings,
  counts: { owned: 3, proxies: 1, inDecks: 2, free: 1 },
};

/** GET /api/cards/f6036065-7196-44d4-8a27-2199f0e1a03c */
export const harmonizedTrioDetails: CardDetailsResponse = {
  card: { ...harmonizedTrio, keywords: ['Prepared'], commanderLegality: 'legal' },
  printings: harmonizedTrioPrintings,
  counts: { owned: 1, proxies: 0, inDecks: 0, free: 1 },
};

/** The 404 GET /api/cards/:oracleId answers for a card the card data doesn't have. */
export const cardNotFoundError: ErrorBody = {
  error: {
    code: 'card_not_found',
    message: "That card isn't in the card data. If it's new, press Refresh card data in Settings.",
  },
};
