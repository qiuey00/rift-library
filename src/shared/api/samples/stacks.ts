import type { CardSummary, CopyDetails, LocationRef, PrintingSummary, StackRow } from '../common';
import type { LocationNode } from '../locations';
import type { CardCopies, CollectionValue, LocationStacks, StacksPage } from '../stacks';
import {
  atraxaDeckBoxNode,
  blackGreenNode,
  bulkTrayNode,
  hearthhullDeckBoxNode,
  landsNode,
  locationRef,
  longBoxNode,
  raresBinderNode,
  redGoldNode,
  staplesBinderNode,
  toSortNode,
  tradeBinderNode,
} from './locations';

// Sample answers for the stacks area, matching src/shared/api/stacks.ts. Screen tests mock
// the API with them; the stub routes return them until #15.

export type SampleCard = { card: CardSummary; printing: PrintingSummary };

/** Cards and printings (Magic stand-ins until #5), from the collection and Hearthhull deck. */
export const sampleCards = {
  arcaneSignet: {
    card: {
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
    },
    printing: {
      printingId: '3d994115-378d-4685-a5dc-e448831da434',
      oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
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
  },
  arcaneSignetTdc: {
    card: {
      oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
      name: 'Arcane Signet',
      frontFaceName: 'Arcane Signet',
      manaCost: '{2}',
      manaValue: 2,
      typeLine: 'Artifact',
      colorIdentity: '',
      imageSmall:
        'https://images.example.com/small/front/9/3/935644d4-a140-4f24-b8ab-d5e79a682a9b.jpg?1783907131',
      imageNormal:
        'https://images.example.com/normal/front/9/3/935644d4-a140-4f24-b8ab-d5e79a682a9b.jpg?1783907131',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '935644d4-a140-4f24-b8ab-d5e79a682a9b',
      oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
      setCode: 'tdc',
      setName: 'Tarkir: Dragonstorm Commander',
      collectorNumber: '105',
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'uncommon',
      imageSmall:
        'https://images.example.com/small/front/9/3/935644d4-a140-4f24-b8ab-d5e79a682a9b.jpg?1783907131',
      imageNormal:
        'https://images.example.com/normal/front/9/3/935644d4-a140-4f24-b8ab-d5e79a682a9b.jpg?1783907131',
    },
  },
  arcaneSignetFic: {
    card: {
      oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
      name: 'Arcane Signet',
      frontFaceName: 'Arcane Signet',
      manaCost: '{2}',
      manaValue: 2,
      typeLine: 'Artifact',
      colorIdentity: '',
      imageSmall:
        'https://images.example.com/small/front/9/c/9ce66ebc-b39f-4b40-9d95-981629a5dd06.jpg?1783906246',
      imageNormal:
        'https://images.example.com/normal/front/9/c/9ce66ebc-b39f-4b40-9d95-981629a5dd06.jpg?1783906246',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '9ce66ebc-b39f-4b40-9d95-981629a5dd06',
      oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
      setCode: 'fic',
      setName: 'Final Fantasy Commander',
      collectorNumber: '332',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'common',
      imageSmall:
        'https://images.example.com/small/front/9/c/9ce66ebc-b39f-4b40-9d95-981629a5dd06.jpg?1783906246',
      imageNormal:
        'https://images.example.com/normal/front/9/c/9ce66ebc-b39f-4b40-9d95-981629a5dd06.jpg?1783906246',
    },
  },
  blech: {
    card: {
      oracleId: 'c1bdd361-c7f2-4aa2-8d07-b582775551ff',
      name: 'Blech, Loafing Pest',
      frontFaceName: 'Blech, Loafing Pest',
      manaCost: '{1}{B}{G}',
      manaValue: 3,
      typeLine: 'Legendary Creature — Pest',
      colorIdentity: 'BG',
      imageSmall:
        'https://images.example.com/small/front/f/5/f588fa50-7cc5-41ba-90df-2d252eb5c785.jpg?1783903648',
      imageNormal:
        'https://images.example.com/normal/front/f/5/f588fa50-7cc5-41ba-90df-2d252eb5c785.jpg?1783903648',
      canBeCommander: true,
      isBasicLand: false,
    },
    printing: {
      printingId: 'f588fa50-7cc5-41ba-90df-2d252eb5c785',
      oracleId: 'c1bdd361-c7f2-4aa2-8d07-b582775551ff',
      setCode: 'sos',
      setName: 'Secrets of Strixhaven',
      collectorNumber: '176',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'rare',
      imageSmall:
        'https://images.example.com/small/front/f/5/f588fa50-7cc5-41ba-90df-2d252eb5c785.jpg?1783903648',
      imageNormal:
        'https://images.example.com/normal/front/f/5/f588fa50-7cc5-41ba-90df-2d252eb5c785.jpg?1783903648',
    },
  },
  commandTower: {
    card: {
      oracleId: '0895c9b7-ae7d-4bb3-af17-3b75deb50a25',
      name: 'Command Tower',
      frontFaceName: 'Command Tower',
      manaCost: '',
      manaValue: 0,
      typeLine: 'Land',
      colorIdentity: '',
      imageSmall:
        'https://images.example.com/small/front/8/5/85eb4b03-305b-45a4-82e5-5fcd586cc744.jpg?1783906048',
      imageNormal:
        'https://images.example.com/normal/front/8/5/85eb4b03-305b-45a4-82e5-5fcd586cc744.jpg?1783906048',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '85eb4b03-305b-45a4-82e5-5fcd586cc744',
      oracleId: '0895c9b7-ae7d-4bb3-af17-3b75deb50a25',
      setCode: 'eoc',
      setName: 'Edge of Eternities Commander',
      collectorNumber: '59',
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'common',
      imageSmall:
        'https://images.example.com/small/front/8/5/85eb4b03-305b-45a4-82e5-5fcd586cc744.jpg?1783906048',
      imageNormal:
        'https://images.example.com/normal/front/8/5/85eb4b03-305b-45a4-82e5-5fcd586cc744.jpg?1783906048',
    },
  },
  elementalMascot: {
    card: {
      oracleId: '882f30e4-4ce1-4581-8d2d-d763aa13befe',
      name: 'Elemental Mascot',
      frontFaceName: 'Elemental Mascot',
      manaCost: '{1}{U}{R}',
      manaValue: 3,
      typeLine: 'Creature — Elemental Bird',
      colorIdentity: 'UR',
      imageSmall:
        'https://images.example.com/small/front/c/5/c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0.jpg?1783903646',
      imageNormal:
        'https://images.example.com/normal/front/c/5/c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0.jpg?1783903646',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: 'c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0',
      oracleId: '882f30e4-4ce1-4581-8d2d-d763aa13befe',
      setCode: 'sos',
      setName: 'Secrets of Strixhaven',
      collectorNumber: '185',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'common',
      imageSmall:
        'https://images.example.com/small/front/c/5/c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0.jpg?1783903646',
      imageNormal:
        'https://images.example.com/normal/front/c/5/c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0.jpg?1783903646',
    },
  },
  emeritusOfWoe: {
    card: {
      oracleId: '93056597-b964-421f-be2f-e92abef1c2a4',
      name: 'Emeritus of Woe // Demonic Tutor',
      frontFaceName: 'Emeritus of Woe',
      manaCost: '{3}{B} // {1}{B}',
      manaValue: 4,
      typeLine: 'Creature — Vampire Warlock // Sorcery',
      colorIdentity: 'B',
      imageSmall:
        'https://images.example.com/small/front/7/e/7eb9e83d-515d-4911-a06b-9982200277b2.jpg?1783903682',
      imageNormal:
        'https://images.example.com/normal/front/7/e/7eb9e83d-515d-4911-a06b-9982200277b2.jpg?1783903682',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '7eb9e83d-515d-4911-a06b-9982200277b2',
      oracleId: '93056597-b964-421f-be2f-e92abef1c2a4',
      setCode: 'sos',
      setName: 'Secrets of Strixhaven',
      collectorNumber: '80',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'mythic',
      imageSmall:
        'https://images.example.com/small/front/7/e/7eb9e83d-515d-4911-a06b-9982200277b2.jpg?1783903682',
      imageNormal:
        'https://images.example.com/normal/front/7/e/7eb9e83d-515d-4911-a06b-9982200277b2.jpg?1783903682',
    },
  },
  gaeasCradle: {
    card: {
      oracleId: '7c427c3d-ecd8-45ef-bebd-8f10f4a311db',
      name: "Gaea's Cradle",
      frontFaceName: "Gaea's Cradle",
      manaCost: '',
      manaValue: 0,
      typeLine: 'Legendary Land',
      colorIdentity: 'G',
      imageSmall:
        'https://images.example.com/small/front/2/5/25b0b816-0583-44aa-9dc5-f3ff48993a51.jpg?1783946299',
      imageNormal:
        'https://images.example.com/normal/front/2/5/25b0b816-0583-44aa-9dc5-f3ff48993a51.jpg?1783946299',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '25b0b816-0583-44aa-9dc5-f3ff48993a51',
      oracleId: '7c427c3d-ecd8-45ef-bebd-8f10f4a311db',
      setCode: 'usg',
      setName: "Urza's Saga",
      collectorNumber: '321',
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'rare',
      imageSmall:
        'https://images.example.com/small/front/2/5/25b0b816-0583-44aa-9dc5-f3ff48993a51.jpg?1783946299',
      imageNormal:
        'https://images.example.com/normal/front/2/5/25b0b816-0583-44aa-9dc5-f3ff48993a51.jpg?1783946299',
    },
  },
  harmonizedTrio: {
    card: {
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
    },
    printing: {
      printingId: '617208ff-dd9b-44fd-a740-d3188081e5cc',
      oracleId: 'f6036065-7196-44d4-8a27-2199f0e1a03c',
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
  },
  hearthhull: {
    card: {
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
    },
    printing: {
      printingId: '6b913e79-a9f6-44d4-bb37-c4f6f66b8151',
      oracleId: '8d6f82d9-5c5b-4c41-8857-c0936f2d894c',
      setCode: 'eoc',
      setName: 'Edge of Eternities Commander',
      collectorNumber: '1',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'mythic',
      imageSmall:
        'https://images.example.com/small/front/6/b/6b913e79-a9f6-44d4-bb37-c4f6f66b8151.jpg?1783906067',
      imageNormal:
        'https://images.example.com/normal/front/6/b/6b913e79-a9f6-44d4-bb37-c4f6f66b8151.jpg?1783906067',
    },
  },
  magmabloodArchaicJa: {
    card: {
      oracleId: 'c6a5adc8-ee57-421e-8235-0b3160f44568',
      name: 'Magmablood Archaic',
      frontFaceName: 'Magmablood Archaic',
      manaCost: '{2/R}{2/R}{2/R}',
      manaValue: 6,
      typeLine: 'Creature — Avatar',
      colorIdentity: 'R',
      imageSmall:
        'https://images.example.com/small/front/a/c/ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed.jpg?1788983479',
      imageNormal:
        'https://images.example.com/normal/front/a/c/ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed.jpg?1788983479',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: 'ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed',
      oracleId: 'c6a5adc8-ee57-421e-8235-0b3160f44568',
      setCode: 'sos',
      setName: 'Secrets of Strixhaven',
      collectorNumber: '123',
      lang: 'ja',
      finishes: ['nonfoil', 'foil'],
      rarity: 'rare',
      imageSmall:
        'https://images.example.com/small/front/a/c/ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed.jpg?1788983479',
      imageNormal:
        'https://images.example.com/normal/front/a/c/ac5c561b-68b4-4d5d-b8d1-d5ca24f127ed.jpg?1788983479',
    },
  },
  pickYourPoison: {
    card: {
      oracleId: '9af4a832-d634-47aa-91ed-79d44fe08864',
      name: 'Pick Your Poison',
      frontFaceName: 'Pick Your Poison',
      manaCost: '{G}',
      manaValue: 1,
      typeLine: 'Sorcery',
      colorIdentity: 'G',
      imageSmall:
        'https://images.example.com/small/front/a/1/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.jpg?1783903918',
      imageNormal:
        'https://images.example.com/normal/front/a/1/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.jpg?1783903918',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: 'a11f1013-d747-4cf2-bbf5-0bd68a949ddf',
      oracleId: '9af4a832-d634-47aa-91ed-79d44fe08864',
      setCode: 'soa',
      setName: 'Secrets of Strixhaven Mystical Archive',
      collectorNumber: '55',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'uncommon',
      imageSmall:
        'https://images.example.com/small/front/a/1/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.jpg?1783903918',
      imageNormal:
        'https://images.example.com/normal/front/a/1/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.jpg?1783903918',
    },
  },
  sylvanLibrary: {
    card: {
      oracleId: '92eed395-62ca-4293-882b-8565c40daab5',
      name: 'Sylvan Library',
      frontFaceName: 'Sylvan Library',
      manaCost: '{1}{G}',
      manaValue: 2,
      typeLine: 'Enchantment',
      colorIdentity: 'G',
      imageSmall:
        'https://images.example.com/small/front/2/6/26a7c62c-12ed-493c-ba95-0f55fec83686.jpg?1783903578',
      imageNormal:
        'https://images.example.com/normal/front/2/6/26a7c62c-12ed-493c-ba95-0f55fec83686.jpg?1783903578',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '26a7c62c-12ed-493c-ba95-0f55fec83686',
      oracleId: '92eed395-62ca-4293-882b-8565c40daab5',
      setCode: 'spg',
      setName: 'Special Guests',
      collectorNumber: '155',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'mythic',
      imageSmall:
        'https://images.example.com/small/front/2/6/26a7c62c-12ed-493c-ba95-0f55fec83686.jpg?1783903578',
      imageNormal:
        'https://images.example.com/normal/front/2/6/26a7c62c-12ed-493c-ba95-0f55fec83686.jpg?1783903578',
    },
  },
  triumphOfTheHordes: {
    card: {
      oracleId: '3ded0c0c-40ce-4d14-a9a6-b023bc19ee0e',
      name: 'Triumph of the Hordes',
      frontFaceName: 'Triumph of the Hordes',
      manaCost: '{2}{G}{G}',
      manaValue: 4,
      typeLine: 'Sorcery',
      colorIdentity: 'G',
      imageSmall:
        'https://images.example.com/small/front/5/a/5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84.jpg?1783903916',
      imageNormal:
        'https://images.example.com/normal/front/5/a/5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84.jpg?1783903916',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84',
      oracleId: '3ded0c0c-40ce-4d14-a9a6-b023bc19ee0e',
      setCode: 'soa',
      setName: 'Secrets of Strixhaven Mystical Archive',
      collectorNumber: '59',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'mythic',
      imageSmall:
        'https://images.example.com/small/front/5/a/5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84.jpg?1783903916',
      imageNormal:
        'https://images.example.com/normal/front/5/a/5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84.jpg?1783903916',
    },
  },
  witherbloomCharm: {
    card: {
      oracleId: 'ee1db746-f5c1-4dce-82eb-24b273cc9507',
      name: 'Witherbloom Charm',
      frontFaceName: 'Witherbloom Charm',
      manaCost: '{B}{G}',
      manaValue: 2,
      typeLine: 'Instant',
      colorIdentity: 'BG',
      imageSmall:
        'https://images.example.com/small/front/2/5/254437f7-7a8a-4b11-9cea-e8e7ea23c59e.jpg?1783903624',
      imageNormal:
        'https://images.example.com/normal/front/2/5/254437f7-7a8a-4b11-9cea-e8e7ea23c59e.jpg?1783903624',
      canBeCommander: false,
      isBasicLand: false,
    },
    printing: {
      printingId: '254437f7-7a8a-4b11-9cea-e8e7ea23c59e',
      oracleId: 'ee1db746-f5c1-4dce-82eb-24b273cc9507',
      setCode: 'sos',
      setName: 'Secrets of Strixhaven',
      collectorNumber: '244',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'uncommon',
      imageSmall:
        'https://images.example.com/small/front/2/5/254437f7-7a8a-4b11-9cea-e8e7ea23c59e.jpg?1783903624',
      imageNormal:
        'https://images.example.com/normal/front/2/5/254437f7-7a8a-4b11-9cea-e8e7ea23c59e.jpg?1783903624',
    },
  },
} satisfies Record<string, SampleCard>;

const nonfoil: CopyDetails = {
  finish: 'nonfoil',
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
    ...nonfoil,
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
  /** In the Hearthhull deck box, pulled from the Staples binder. */
  arcaneSignetInHearthhull: stack(
    101,
    1,
    c.arcaneSignet,
    hearthhullDeckBoxNode,
    85,
    {},
    locationRef(staplesBinderNode),
  ),
  arcaneSignetInStaples: stack(102, 1, c.arcaneSignetFic, staplesBinderNode, 120),
  /** A proxy added straight into the Atraxa deck box, so it has no came-from location. Proxies are worth 0. */
  arcaneSignetProxyInAtraxa: stack(103, 1, c.arcaneSignetTdc, atraxaDeckBoxNode, 95, {
    isProxy: true,
  }),
  blechFoil: stack(104, 1, c.blech, blackGreenNode, 412, { finish: 'foil' }),
  /** In the Trade binder, which is marked For trade. */
  blechInTradeBinder: stack(116, 1, c.blech, tradeBinderNode, 189),
  commandTower: stack(105, 3, c.commandTower, landsNode, 35),
  elementalMascot: stack(106, 4, c.elementalMascot, bulkTrayNode, 12),
  emeritusOfWoeFoil: stack(107, 1, c.emeritusOfWoe, raresBinderNode, 268, { finish: 'foil' }),
  gaeasCradleProxy: stack(108, 1, c.gaeasCradle, landsNode, 89500, { isProxy: true }),
  /** There is no price for it. */
  harmonizedTrio: stack(109, 1, c.harmonizedTrio, toSortNode, null),
  /** The commander, in its deck box, pulled from the Rares binder. */
  hearthhullFoil: stack(
    110,
    1,
    c.hearthhull,
    hearthhullDeckBoxNode,
    1450,
    { finish: 'foil' },
    locationRef(raresBinderNode),
  ),
  /** A Japanese copy. */
  magmabloodArchaicJapanese: stack(111, 1, c.magmabloodArchaicJa, redGoldNode, 64, {
    language: 'ja',
  }),
  pickYourPoisonFoil: stack(112, 1, c.pickYourPoison, staplesBinderNode, 980, { finish: 'foil' }),
  sylvanLibrary: stack(113, 1, c.sylvanLibrary, raresBinderNode, 3420),
  triumphOfTheHordes: stack(114, 1, c.triumphOfTheHordes, raresBinderNode, 1875),
  witherbloomCharm: stack(115, 2, c.witherbloomCharm, blackGreenNode, 25),
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

/** GET /api/stacks?q=t:creature f:foil */
export const stacksSearchSample: StacksPage = {
  rows: [s.blechFoil, s.emeritusOfWoeFoil],
  total: totalOf([s.blechFoil, s.emeritusOfWoeFoil]),
  nextCursor: null,
};

/** GET /api/stacks?q=trade:yes: the copies in locations for trade. */
export const stacksTradeSample: StacksPage = {
  rows: [s.blechInTradeBinder],
  total: totalOf([s.blechInTradeBinder]),
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
  rows: [s.emeritusOfWoeFoil, s.sylvanLibrary, s.triumphOfTheHordes],
};

/** GET /api/locations/2/stacks?includeChildren=1: the Long box and its sections. */
export const locationStacksWithChildrenSample: LocationStacks = {
  location: longBoxNode,
  rows: [
    s.blechFoil,
    s.commandTower,
    s.gaeasCradleProxy,
    s.magmabloodArchaicJapanese,
    s.witherbloomCharm,
  ],
};

/** GET /api/cards/:oracleId/copies for Arcane Signet: in two deck boxes and the Staples binder. */
export const cardCopiesSample: CardCopies = {
  rows: [s.arcaneSignetInHearthhull, s.arcaneSignetInStaples, s.arcaneSignetProxyInAtraxa],
  counts: { owned: 3, proxies: 1, inDecks: 2, free: 1 },
};

/** GET /api/cards/:oracleId/copies for a card Jeff owns no copies of. */
export const cardCopiesEmptySample: CardCopies = {
  rows: [],
  counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
};
