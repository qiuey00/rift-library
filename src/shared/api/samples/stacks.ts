import type { CardSummary, CopyDetails, LocationRef, PrintingSummary, StackRow } from '../common';
import type { LocationNode } from '../locations';
import type { CardCopies, CollectionValue, LocationStacks, StacksPage } from '../stacks';
import {
  bulkTrayNode,
  chaosCalmNode,
  furyOrderNode,
  jinxBurnDeckBoxNode,
  landsNode,
  locationRef,
  longBoxNode,
  luxControlDeckBoxNode,
  raresBinderNode,
  staplesBinderNode,
  toSortNode,
  tradeBinderNode,
} from './locations';

// Sample answers for the stacks area, matching src/shared/api/stacks.ts. Screen tests mock
// the API with them; the stub routes return them until #15.

export type SampleCard = { card: CardSummary; printing: PrintingSummary };

/** Cards and printings (Magic stand-ins until #5), from the collection and Jinx Burn deck. */
export const sampleCards = {
  emberSignet: {
    card: {
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
    },
    printing: {
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
  },
  emberSignetRad: {
    card: {
      id: 13,
      name: 'Ember Signet',
      type: 'gear',
      supertype: null,
      domains: [],
      energy: 2,
      might: null,
      power: 0,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/935644d4-a140-4f24-b8ab-d5e79a682a9b.webp',
    },
    printing: {
      printingId: '935644d4-a140-4f24-b8ab-d5e79a682a9b',
      publicCode: 'RAD-105/200',
      setCode: 'RAD',
      setName: 'Radiance',
      collectorNumber: '105',
      rarity: 'uncommon',
      imageUrl: 'https://images.example.com/riftbound/935644d4-a140-4f24-b8ab-d5e79a682a9b.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal'],
      unitPrice: { normal: null, foil: null },
    },
  },
  emberSignetOgt: {
    card: {
      id: 13,
      name: 'Ember Signet',
      type: 'gear',
      supertype: null,
      domains: [],
      energy: 2,
      might: null,
      power: 0,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/9ce66ebc-b39f-4b40-9d95-981629a5dd06.webp',
    },
    printing: {
      printingId: '9ce66ebc-b39f-4b40-9d95-981629a5dd06',
      publicCode: 'OGT-332/332',
      setCode: 'OGT',
      setName: 'Origins Tokens',
      collectorNumber: '332',
      rarity: 'common',
      imageUrl: 'https://images.example.com/riftbound/9ce66ebc-b39f-4b40-9d95-981629a5dd06.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  nasusProtector: {
    card: {
      id: 29,
      name: 'Nasus, Protector',
      type: 'unit',
      supertype: 'champion',
      domains: ['chaos', 'calm'],
      energy: 3,
      might: 2,
      power: 2,
      championTag: 'Nasus',
      imageUrl: 'https://images.example.com/riftbound/f588fa50-7cc5-41ba-90df-2d252eb5c785.webp',
    },
    printing: {
      printingId: 'f588fa50-7cc5-41ba-90df-2d252eb5c785',
      publicCode: 'SFD-176/221',
      setCode: 'SFD',
      setName: 'Spiritforged',
      collectorNumber: '176',
      rarity: 'rare',
      imageUrl: 'https://images.example.com/riftbound/f588fa50-7cc5-41ba-90df-2d252eb5c785.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  targonsPeak: {
    card: {
      id: 50,
      name: "Targon's Peak",
      type: 'battlefield',
      supertype: null,
      domains: [],
      energy: null,
      might: null,
      power: null,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/85eb4b03-305b-45a4-82e5-5fcd586cc744.webp',
    },
    printing: {
      printingId: '85eb4b03-305b-45a4-82e5-5fcd586cc744',
      publicCode: 'OGN-059/298',
      setCode: 'OGN',
      setName: 'Origins',
      collectorNumber: '59',
      rarity: 'common',
      imageUrl: 'https://images.example.com/riftbound/85eb4b03-305b-45a4-82e5-5fcd586cc744.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal'],
      unitPrice: { normal: null, foil: null },
    },
  },
  wildShaman: {
    card: {
      id: 69,
      name: 'Wild Shaman',
      type: 'unit',
      supertype: null,
      domains: ['mind', 'fury'],
      energy: 3,
      might: 2,
      power: 2,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0.webp',
    },
    printing: {
      printingId: 'c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0',
      publicCode: 'SFD-185/221',
      setCode: 'SFD',
      setName: 'Spiritforged',
      collectorNumber: '185',
      rarity: 'common',
      imageUrl: 'https://images.example.com/riftbound/c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  wildDuelist: {
    card: {
      id: 73,
      name: 'Wild Duelist',
      type: 'unit',
      supertype: null,
      domains: ['chaos'],
      energy: 4,
      might: 3,
      power: 1,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/7eb9e83d-515d-4911-a06b-9982200277b2.webp',
    },
    printing: {
      printingId: '7eb9e83d-515d-4911-a06b-9982200277b2',
      publicCode: 'SFD-080/221',
      setCode: 'SFD',
      setName: 'Spiritforged',
      collectorNumber: '80',
      rarity: 'epic',
      imageUrl: 'https://images.example.com/riftbound/7eb9e83d-515d-4911-a06b-9982200277b2.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  hollowSummit: {
    card: {
      id: 334,
      name: 'Hollow Summit',
      type: 'battlefield',
      supertype: null,
      domains: [],
      energy: null,
      might: null,
      power: null,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/25b0b816-0583-44aa-9dc5-f3ff48993a51.webp',
    },
    printing: {
      printingId: '25b0b816-0583-44aa-9dc5-f3ff48993a51',
      publicCode: 'LEG-321/321',
      setCode: 'LEG',
      setName: 'Legacy Promos',
      collectorNumber: '321',
      rarity: 'rare',
      imageUrl: 'https://images.example.com/riftbound/25b0b816-0583-44aa-9dc5-f3ff48993a51.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal'],
      unitPrice: { normal: null, foil: null },
    },
  },
  gildedWhelp: {
    card: {
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
    },
    printing: {
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
  },
  jinxBurn: {
    card: {
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
    },
    printing: {
      printingId: '6b913e79-a9f6-44d4-bb37-c4f6f66b8151',
      publicCode: 'OGN-001/298',
      setCode: 'OGN',
      setName: 'Origins',
      collectorNumber: '1',
      rarity: 'epic',
      imageUrl: 'https://images.example.com/riftbound/6b913e79-a9f6-44d4-bb37-c4f6f66b8151.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  grimCartographerJa: {
    card: {
      id: 157,
      name: 'Grim Cartographer',
      type: 'unit',
      supertype: null,
      domains: ['fury'],
      energy: 6,
      might: 5,
      power: 0,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed.webp',
    },
    printing: {
      printingId: 'ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed',
      publicCode: 'SFD-123/221',
      setCode: 'SFD',
      setName: 'Spiritforged',
      collectorNumber: '123',
      rarity: 'rare',
      imageUrl: 'https://images.example.com/riftbound/ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  hextechBonfire: {
    card: {
      id: 193,
      name: 'Hextech Bonfire',
      type: 'spell',
      supertype: null,
      domains: ['calm'],
      energy: 1,
      might: null,
      power: 1,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.webp',
    },
    printing: {
      printingId: 'a11f1013-d747-4cf2-bbf5-0bd68a949ddf',
      publicCode: 'OGS-055/55',
      setCode: 'OGS',
      setName: 'Proving Grounds',
      collectorNumber: '55',
      rarity: 'uncommon',
      imageUrl: 'https://images.example.com/riftbound/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  daringBanner: {
    card: {
      id: 284,
      name: 'Daring Banner',
      type: 'gear',
      supertype: null,
      domains: ['calm'],
      energy: 2,
      might: null,
      power: 1,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/26a7c62c-12ed-493c-ba95-0f55fec83686.webp',
    },
    printing: {
      printingId: '26a7c62c-12ed-493c-ba95-0f55fec83686',
      publicCode: 'ARC-155/155',
      setCode: 'ARC',
      setName: 'Arcane Box Set',
      collectorNumber: '155',
      rarity: 'epic',
      imageUrl: 'https://images.example.com/riftbound/26a7c62c-12ed-493c-ba95-0f55fec83686.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  sunkenInsight: {
    card: {
      id: 305,
      name: 'Sunken Insight',
      type: 'spell',
      supertype: null,
      domains: ['calm'],
      energy: 4,
      might: null,
      power: 2,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84.webp',
    },
    printing: {
      printingId: '5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84',
      publicCode: 'OGS-059/59',
      setCode: 'OGS',
      setName: 'Proving Grounds',
      collectorNumber: '59',
      rarity: 'epic',
      imageUrl: 'https://images.example.com/riftbound/5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
  whisperingSurge: {
    card: {
      id: 322,
      name: 'Whispering Surge',
      type: 'spell',
      supertype: null,
      domains: ['chaos', 'calm'],
      energy: 2,
      might: null,
      power: 2,
      championTag: null,
      imageUrl: 'https://images.example.com/riftbound/254437f7-7a8a-4b11-9cea-e8e7ea23c59e.webp',
    },
    printing: {
      printingId: '254437f7-7a8a-4b11-9cea-e8e7ea23c59e',
      publicCode: 'SFD-244/244',
      setCode: 'SFD',
      setName: 'Spiritforged',
      collectorNumber: '244',
      rarity: 'uncommon',
      imageUrl: 'https://images.example.com/riftbound/254437f7-7a8a-4b11-9cea-e8e7ea23c59e.webp',
      alternateArt: false,
      overnumbered: false,
      signature: false,
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    },
  },
} satisfies Record<string, SampleCard>;

const normal: CopyDetails = {
  finish: 'normal',
  condition: 'near_mint',
  language: 'en',
  misprint: false,
  altered: false,
  isProxy: false,
};

/** A stack of `quantity` copies, each worth `unitPrice` cents (null: there is no price). */
const stack = (
  stackId: number,
  quantity: number,
  { card, printing }: SampleCard,
  location: LocationNode,
  unitPrice: number | null,
  details: Partial<CopyDetails> = {},
  cameFrom: LocationRef | null = null,
): StackRow => {
  const isProxy = details.isProxy ?? false;
  return {
    stackId,
    quantity,
    card,
    printing,
    ...normal,
    ...details,
    location: locationRef(location),
    cameFrom,
    inDeck: location.deck ? { deckId: location.deck.id, deckName: location.deck.name } : null,
    unitPrice,
    value: isProxy || unitPrice === null ? 0 : quantity * unitPrice,
  };
};

const c = sampleCards;

/** Copy stacks, by name. */
export const sampleStacks = {
  /** In the Jinx Burn deck box, pulled from the Staples binder. */
  emberSignetInJinxBurn: stack(
    101,
    1,
    c.emberSignet,
    jinxBurnDeckBoxNode,
    85,
    {},
    locationRef(staplesBinderNode),
  ),
  emberSignetInStaples: stack(102, 1, c.emberSignetOgt, staplesBinderNode, 120),
  /** A proxy added straight into the Lux Control deck box, so it has no came-from location. Proxies are worth 0. */
  emberSignetProxyInLuxControl: stack(103, 1, c.emberSignetRad, luxControlDeckBoxNode, 95, {
    isProxy: true,
  }),
  nasusProtectorFoil: stack(104, 1, c.nasusProtector, chaosCalmNode, 412, { finish: 'foil' }),
  /** In the Trade binder, which is marked For trade. */
  nasusProtectorInTradeBinder: stack(116, 1, c.nasusProtector, tradeBinderNode, 189),
  targonsPeak: stack(105, 3, c.targonsPeak, landsNode, 35),
  wildShaman: stack(106, 4, c.wildShaman, bulkTrayNode, 12),
  wildDuelistFoil: stack(107, 1, c.wildDuelist, raresBinderNode, 268, { finish: 'foil' }),
  hollowSummitProxy: stack(108, 1, c.hollowSummit, landsNode, 89500, { isProxy: true }),
  /** There is no price for it. */
  gildedWhelp: stack(109, 1, c.gildedWhelp, toSortNode, null),
  /** The Legend, in its deck box, pulled from the Rares binder. */
  jinxBurnFoil: stack(
    110,
    1,
    c.jinxBurn,
    jinxBurnDeckBoxNode,
    1450,
    { finish: 'foil' },
    locationRef(raresBinderNode),
  ),
  /** A Japanese copy. */
  grimCartographerJapanese: stack(111, 1, c.grimCartographerJa, furyOrderNode, 64, {
    language: 'ja',
  }),
  hextechBonfireFoil: stack(112, 1, c.hextechBonfire, staplesBinderNode, 980, { finish: 'foil' }),
  daringBanner: stack(113, 1, c.daringBanner, raresBinderNode, 3420),
  sunkenInsight: stack(114, 1, c.sunkenInsight, raresBinderNode, 1875),
  whisperingSurge: stack(115, 2, c.whisperingSurge, chaosCalmNode, 25),
};

const s = sampleStacks;
const allRows = Object.values(sampleStacks);
const firstPageRows = allRows.slice(0, 13);

const totalOf = (rows: StackRow[]): StacksPage['total'] => ({
  stacks: rows.length,
  cards: rows.reduce((sum, row) => sum + row.quantity, 0),
  proxies: rows.reduce((sum, row) => sum + (row.isProxy ? row.quantity : 0), 0),
  value: rows.reduce((sum, row) => sum + row.value, 0),
  noPriceCount: rows.reduce(
    (sum, row) => sum + (!row.isProxy && row.unitPrice === null ? row.quantity : 0),
    0,
  ),
});
const total = totalOf(allRows);

/** GET /api/stacks: the first page, with a next page to load. */
export const stacksPageSample: StacksPage = {
  rows: firstPageRows,
  total,
  nextCursor: 'eyJuYW1lIjoiU3lsdmFuIExpYnJhcnkiLCJpZCI6MTEzfQ',
};

/** GET /api/stacks?cursor=…: the last page. */
export const stacksNextPageSample: StacksPage = {
  rows: allRows.slice(firstPageRows.length),
  total,
  nextCursor: null,
};

/** GET /api/stacks?q=t:unit f:foil */
export const stacksSearchSample: StacksPage = {
  rows: [s.nasusProtectorFoil, s.wildDuelistFoil],
  total: totalOf([s.nasusProtectorFoil, s.wildDuelistFoil]),
  nextCursor: null,
};

/** GET /api/stacks?q=trade:yes: the copies in locations for trade. */
export const stacksTradeSample: StacksPage = {
  rows: [s.nasusProtectorInTradeBinder],
  total: totalOf([s.nasusProtectorInTradeBinder]),
  nextCursor: null,
};

/** GET /api/stacks?sort=value: the most valuable stacks first (proxies are worth 0). */
export const stacksByValueSample: StacksPage = {
  rows: [...allRows].sort((a, b) => b.value - a.value || a.stackId - b.stackId),
  total,
  nextCursor: null,
};

/** GET /api/collection/value: the whole collection, deck boxes included. */
export const collectionValueSample: CollectionValue = {
  value: 318450,
  cards: 3012,
  noPriceCount: 214,
  proxies: 5,
  pricesUpdatedAt: '2026-10-18T21:04:31Z',
};

/** GET /api/locations/6/stacks: the Rares binder, which has no children. */
export const locationStacksSample: LocationStacks = {
  location: raresBinderNode,
  rows: [s.wildDuelistFoil, s.daringBanner, s.sunkenInsight],
};

/** GET /api/locations/2/stacks?includeChildren=1: the Long box and its sections. */
export const locationStacksWithChildrenSample: LocationStacks = {
  location: longBoxNode,
  rows: [
    s.nasusProtectorFoil,
    s.targonsPeak,
    s.hollowSummitProxy,
    s.grimCartographerJapanese,
    s.whisperingSurge,
  ],
};

/** GET /api/cards/:oracleId/copies for Ember Signet: in two deck boxes and the Staples binder. */
export const cardCopiesSample: CardCopies = {
  rows: [s.emberSignetInJinxBurn, s.emberSignetInStaples, s.emberSignetProxyInLuxControl],
  counts: { owned: 3, proxies: 1, inDecks: 2, free: 1 },
};

/** GET /api/cards/:oracleId/copies for a card Jeff owns no copies of. */
export const cardCopiesEmptySample: CardCopies = {
  rows: [],
  counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
};
