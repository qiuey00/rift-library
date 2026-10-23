import type { CardSummary, CopyDetails, LocationRef, PrintingSummary, StackRow } from '../common';
import type { PickLine } from '../pick-list';
import type { PutAwayLine } from '../put-away';

// The Hearthhull deck and the copies it pulls from, shared by the pick list, put-away and
// swap samples. Cards and printings are Magic stand-ins until #5.

export const cards = {
  hearthhull: {
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
  infernalGrasp: {
    oracleId: '94f0a572-e91c-4b56-a5d1-6cbbeabd210d',
    name: 'Infernal Grasp',
    frontFaceName: 'Infernal Grasp',
    manaCost: '{1}{B}',
    manaValue: 2,
    typeLine: 'Instant',
    colorIdentity: 'B',
    imageSmall:
      'https://images.example.com/small/front/0/6/060b7e5f-5b40-4efc-9fad-4cebf40b654b.jpg?1783906040',
    imageNormal:
      'https://images.example.com/normal/front/0/6/060b7e5f-5b40-4efc-9fad-4cebf40b654b.jpg?1783906040',
    canBeCommander: false,
    isBasicLand: false,
  },
  cultivate: {
    oracleId: '8b755881-a72d-4e21-a369-d2924eb4585a',
    name: 'Cultivate',
    frontFaceName: 'Cultivate',
    manaCost: '{2}{G}',
    manaValue: 3,
    typeLine: 'Sorcery',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/7/e/7ee610ee-7711-4a6b-b441-d6c73e6ef2b4.jpg?1783906035',
    imageNormal:
      'https://images.example.com/normal/front/7/e/7ee610ee-7711-4a6b-b441-d6c73e6ef2b4.jpg?1783906035',
    canBeCommander: false,
    isBasicLand: false,
  },
  tirelessTracker: {
    oracleId: 'e6555cca-e608-4c87-b835-9cd47fd1f543',
    name: 'Tireless Tracker',
    frontFaceName: 'Tireless Tracker',
    manaCost: '{2}{G}',
    manaValue: 3,
    typeLine: 'Creature — Human Scout',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/6/6/66444549-ad9b-49c6-a7c6-34e977c1085d.jpg?1783906030',
    imageNormal:
      'https://images.example.com/normal/front/6/6/66444549-ad9b-49c6-a7c6-34e977c1085d.jpg?1783906030',
    canBeCommander: false,
    isBasicLand: false,
  },
  putrefy: {
    oracleId: '9b271430-f53d-42d6-a547-2f286dd9bcb6',
    name: 'Putrefy',
    frontFaceName: 'Putrefy',
    manaCost: '{1}{B}{G}',
    manaValue: 3,
    typeLine: 'Instant',
    colorIdentity: 'BG',
    imageSmall:
      'https://images.example.com/small/front/1/e/1e355b88-a73d-430b-95eb-8ba646f2e406.jpg?1783906026',
    imageNormal:
      'https://images.example.com/normal/front/1/e/1e355b88-a73d-430b-95eb-8ba646f2e406.jpg?1783906026',
    canBeCommander: false,
    isBasicLand: false,
  },
  mayhemDevil: {
    oracleId: '4709f11c-aef8-45ac-b2bf-e640c568dfac',
    name: 'Mayhem Devil',
    frontFaceName: 'Mayhem Devil',
    manaCost: '{1}{B}{R}',
    manaValue: 3,
    typeLine: 'Creature — Devil',
    colorIdentity: 'BR',
    imageSmall:
      'https://images.example.com/small/front/6/7/674f3a8a-4552-4289-b92a-06ce158f115c.jpg?1783906026',
    imageNormal:
      'https://images.example.com/normal/front/6/7/674f3a8a-4552-4289-b92a-06ce158f115c.jpg?1783906026',
    canBeCommander: false,
    isBasicLand: false,
  },
  rakdosCharm: {
    oracleId: '5e62b51d-faec-4aa0-9504-cf2c282d08ea',
    name: 'Rakdos Charm',
    frontFaceName: 'Rakdos Charm',
    manaCost: '{B}{R}',
    manaValue: 2,
    typeLine: 'Instant',
    colorIdentity: 'BR',
    imageSmall:
      'https://images.example.com/small/front/6/4/64b67170-1602-4050-80c0-ade2a6cac211.jpg?1783906024',
    imageNormal:
      'https://images.example.com/normal/front/6/4/64b67170-1602-4050-80c0-ade2a6cac211.jpg?1783906024',
    canBeCommander: false,
    isBasicLand: false,
  },
  korvold: {
    oracleId: '9ae669dd-7e60-4649-b96e-35da28be641a',
    name: 'Korvold, Fae-Cursed King',
    frontFaceName: 'Korvold, Fae-Cursed King',
    manaCost: '{2}{B}{R}{G}',
    manaValue: 5,
    typeLine: 'Legendary Creature — Dragon Noble',
    colorIdentity: 'BRG',
    imageSmall:
      'https://images.example.com/small/front/6/0/607c1793-8e5a-4ebf-87c6-7f9c99bbd29a.jpg?1783906027',
    imageNormal:
      'https://images.example.com/normal/front/6/0/607c1793-8e5a-4ebf-87c6-7f9c99bbd29a.jpg?1783906027',
    canBeCommander: true,
    isBasicLand: false,
  },
  theGitrogMonster: {
    oracleId: 'a5e54d2b-aad8-4ddd-af4b-13668913762b',
    name: 'The Gitrog Monster',
    frontFaceName: 'The Gitrog Monster',
    manaCost: '{3}{B}{G}',
    manaValue: 5,
    typeLine: 'Legendary Creature — Frog Horror',
    colorIdentity: 'BG',
    imageSmall:
      'https://images.example.com/small/front/4/0/40489e28-878d-44a2-847f-07beef1aa0f8.jpg?1783906028',
    imageNormal:
      'https://images.example.com/normal/front/4/0/40489e28-878d-44a2-847f-07beef1aa0f8.jpg?1783906028',
    canBeCommander: true,
    isBasicLand: false,
  },
  oracleOfMulDaya: {
    oracleId: '6c5b02eb-7829-436a-8555-fea200e4b67f',
    name: 'Oracle of Mul Daya',
    frontFaceName: 'Oracle of Mul Daya',
    manaCost: '{3}{G}',
    manaValue: 4,
    typeLine: 'Creature — Elf Shaman',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/a/b/ab19808f-a5b8-4dfd-800e-2064cd6538c8.jpg?1783906033',
    imageNormal:
      'https://images.example.com/normal/front/a/b/ab19808f-a5b8-4dfd-800e-2064cd6538c8.jpg?1783906033',
    canBeCommander: false,
    isBasicLand: false,
  },
  titania: {
    oracleId: 'd0ade00d-a496-441d-9b7e-7dc033d3292c',
    name: 'Titania, Protector of Argoth',
    frontFaceName: 'Titania, Protector of Argoth',
    manaCost: '{3}{G}{G}',
    manaValue: 5,
    typeLine: 'Legendary Creature — Elemental',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/7/3/732c208b-cd9e-48a9-9b9d-aba63066ba53.jpg?1783906029',
    imageNormal:
      'https://images.example.com/normal/front/7/3/732c208b-cd9e-48a9-9b9d-aba63066ba53.jpg?1783906029',
    canBeCommander: true,
    isBasicLand: false,
  },
  solRing: {
    oracleId: '6ad8011d-3471-4369-9d68-b264cc027487',
    name: 'Sol Ring',
    frontFaceName: 'Sol Ring',
    manaCost: '{1}',
    manaValue: 1,
    typeLine: 'Artifact',
    colorIdentity: '',
    imageSmall:
      'https://images.example.com/small/front/e/e/ee6e5a35-fe21-4dee-b0ef-a8f2841511ad.jpg?1783906049',
    imageNormal:
      'https://images.example.com/normal/front/e/e/ee6e5a35-fe21-4dee-b0ef-a8f2841511ad.jpg?1783906049',
    canBeCommander: false,
    isBasicLand: false,
  },
  commandTower: {
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
  beastWithin: {
    oracleId: '7735eeba-693b-47e2-bd51-414379cf1016',
    name: 'Beast Within',
    frontFaceName: 'Beast Within',
    manaCost: '{2}{G}',
    manaValue: 3,
    typeLine: 'Instant',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/c/c/ccac70d4-6e04-4802-8bb8-021368a40e14.jpg?1783906036',
    imageNormal:
      'https://images.example.com/normal/front/c/c/ccac70d4-6e04-4802-8bb8-021368a40e14.jpg?1783906036',
    canBeCommander: false,
    isBasicLand: false,
  },
  fabledPassage: {
    oracleId: '0c85b8f7-0bd0-4680-9ec5-d4b110460a54',
    name: 'Fabled Passage',
    frontFaceName: 'Fabled Passage',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Land',
    colorIdentity: '',
    imageSmall:
      'https://images.example.com/small/front/6/a/6a21ecc8-f6fd-4670-91d8-94b9ce94c2fe.jpg?1783906047',
    imageNormal:
      'https://images.example.com/normal/front/6/a/6a21ecc8-f6fd-4670-91d8-94b9ce94c2fe.jpg?1783906047',
    canBeCommander: false,
    isBasicLand: false,
  },
  arcaneSignet: {
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
  soulOfWindgrace: {
    oracleId: '2d73a3bd-f052-4f48-9a72-12db03e27249',
    name: 'Soul of Windgrace',
    frontFaceName: 'Soul of Windgrace',
    manaCost: '{1}{B}{R}{G}',
    manaValue: 4,
    typeLine: 'Legendary Creature — Cat Avatar',
    colorIdentity: 'BRG',
    imageSmall:
      'https://images.example.com/small/front/5/a/5a80f7e1-1d79-4302-a603-73eb060b97a6.jpg?1783906025',
    imageNormal:
      'https://images.example.com/normal/front/5/a/5a80f7e1-1d79-4302-a603-73eb060b97a6.jpg?1783906025',
    canBeCommander: true,
    isBasicLand: false,
  },
  omnath: {
    oracleId: '1816eede-c5bd-49df-958f-a3af64cb2932',
    name: 'Omnath, Locus of Rage',
    frontFaceName: 'Omnath, Locus of Rage',
    manaCost: '{3}{R}{R}{G}{G}',
    manaValue: 7,
    typeLine: 'Legendary Creature — Elemental',
    colorIdentity: 'RG',
    imageSmall:
      'https://images.example.com/small/front/7/7/777552e5-cc2d-460f-b26f-977c6ebcfc6b.jpg?1783906026',
    imageNormal:
      'https://images.example.com/normal/front/7/7/777552e5-cc2d-460f-b26f-977c6ebcfc6b.jpg?1783906026',
    canBeCommander: true,
    isBasicLand: false,
  },
  forest: {
    oracleId: 'b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6',
    name: 'Forest',
    frontFaceName: 'Forest',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Basic Land — Forest',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/6/7/673141ec-826f-4132-8282-d499990495a7.jpg?1783905910',
    imageNormal:
      'https://images.example.com/normal/front/6/7/673141ec-826f-4132-8282-d499990495a7.jpg?1783905910',
    canBeCommander: false,
    isBasicLand: true,
  },
  mountain: {
    oracleId: 'a3fb7228-e76b-4e96-a40e-20b5fed75685',
    name: 'Mountain',
    frontFaceName: 'Mountain',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Basic Land — Mountain',
    colorIdentity: 'R',
    imageSmall:
      'https://images.example.com/small/front/d/e/de0ac2b0-175b-4e71-9172-ce2a72234818.jpg?1783905907',
    imageNormal:
      'https://images.example.com/normal/front/d/e/de0ac2b0-175b-4e71-9172-ce2a72234818.jpg?1783905907',
    canBeCommander: false,
    isBasicLand: true,
  },
  swamp: {
    oracleId: '56719f6a-1a6c-4c0a-8d21-18f7d7350b68',
    name: 'Swamp',
    frontFaceName: 'Swamp',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Basic Land — Swamp',
    colorIdentity: 'B',
    imageSmall:
      'https://images.example.com/small/front/5/8/58496a56-437f-4204-9691-f63795e5cdab.jpg?1783905909',
    imageNormal:
      'https://images.example.com/normal/front/5/8/58496a56-437f-4204-9691-f63795e5cdab.jpg?1783905909',
    canBeCommander: false,
    isBasicLand: true,
  },
  rampagingBaloths: {
    oracleId: '2d3e6549-6cc6-434f-a189-ba3b55e64c34',
    name: 'Rampaging Baloths',
    frontFaceName: 'Rampaging Baloths',
    manaCost: '{4}{G}{G}',
    manaValue: 6,
    typeLine: 'Creature — Beast',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/8/4/84aa18de-6acc-46cc-8e28-3046790a6751.jpg?1783906033',
    imageNormal:
      'https://images.example.com/normal/front/8/4/84aa18de-6acc-46cc-8e28-3046790a6751.jpg?1783906033',
    canBeCommander: false,
    isBasicLand: false,
  },
  blasphemousAct: {
    oracleId: '7a2484a9-04fd-41a0-8224-610c1c07ed10',
    name: 'Blasphemous Act',
    frontFaceName: 'Blasphemous Act',
    manaCost: '{8}{R}',
    manaValue: 9,
    typeLine: 'Sorcery',
    colorIdentity: 'R',
    imageSmall:
      'https://images.example.com/small/front/f/b/fbeeb7d0-cda8-414b-82d3-a83f1883bdd2.jpg?1783906038',
    imageNormal:
      'https://images.example.com/normal/front/f/b/fbeeb7d0-cda8-414b-82d3-a83f1883bdd2.jpg?1783906038',
    canBeCommander: false,
    isBasicLand: false,
  },
  worldBreaker: {
    oracleId: 'deeb7e22-b207-42de-b9d4-f790403d52a9',
    name: 'World Breaker',
    frontFaceName: 'World Breaker',
    manaCost: '{6}{G}',
    manaValue: 7,
    typeLine: 'Creature — Eldrazi',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/d/2/d25856c9-cb3d-44d9-905e-007f1af65c06.jpg?1783906029',
    imageNormal:
      'https://images.example.com/normal/front/d/2/d25856c9-cb3d-44d9-905e-007f1af65c06.jpg?1783906029',
    canBeCommander: false,
    isBasicLand: false,
  },
  uurg: {
    oracleId: '0191a93a-f304-4c20-9af4-7cdea82c07cf',
    name: 'Uurg, Spawn of Turg',
    frontFaceName: 'Uurg, Spawn of Turg',
    manaCost: '{B}{B}{G}',
    manaValue: 3,
    typeLine: 'Legendary Creature — Frog Beast',
    colorIdentity: 'BG',
    imageSmall:
      'https://images.example.com/small/front/d/1/d1974536-9e4f-4808-9e49-a036ec7bf65c.jpg?1783906023',
    imageNormal:
      'https://images.example.com/normal/front/d/1/d1974536-9e4f-4808-9e49-a036ec7bf65c.jpg?1783906023',
    canBeCommander: true,
    isBasicLand: false,
  },
  farseek: {
    oracleId: '495e52e6-4c2b-4574-9474-eadbdcc8b4ac',
    name: 'Farseek',
    frontFaceName: 'Farseek',
    manaCost: '{1}{G}',
    manaValue: 2,
    typeLine: 'Sorcery',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/9/5/95e0760a-d285-493b-88cd-7556d9b10007.jpg?1783906051',
    imageNormal:
      'https://images.example.com/normal/front/9/5/95e0760a-d285-493b-88cd-7556d9b10007.jpg?1783906051',
    canBeCommander: false,
    isBasicLand: false,
  },
  naturesLore: {
    oracleId: '78826359-fe63-44ad-adc4-a17ffcd710e4',
    name: "Nature's Lore",
    frontFaceName: "Nature's Lore",
    manaCost: '{1}{G}',
    manaValue: 2,
    typeLine: 'Sorcery',
    colorIdentity: 'G',
    imageSmall:
      'https://images.example.com/small/front/5/b/5b42a79a-1f08-4e15-b40e-c993307ae066.jpg?1783906033',
    imageNormal:
      'https://images.example.com/normal/front/5/b/5b42a79a-1f08-4e15-b40e-c993307ae066.jpg?1783906033',
    canBeCommander: false,
    isBasicLand: false,
  },
  nightsWhisper: {
    oracleId: '7ffae8f8-3006-4969-a339-6d30678f87ea',
    name: "Night's Whisper",
    frontFaceName: "Night's Whisper",
    manaCost: '{1}{B}',
    manaValue: 2,
    typeLine: 'Sorcery',
    colorIdentity: 'B',
    imageSmall:
      'https://images.example.com/small/front/6/7/67bdba19-c74a-462d-9e51-4fd7f0a6a2c3.jpg?1783906041',
    imageNormal:
      'https://images.example.com/normal/front/6/7/67bdba19-c74a-462d-9e51-4fd7f0a6a2c3.jpg?1783906041',
    canBeCommander: false,
    isBasicLand: false,
  },
  braids: {
    oracleId: 'e0445c80-fa53-4c3e-881e-940e9fce7f57',
    name: 'Braids, Arisen Nightmare',
    frontFaceName: 'Braids, Arisen Nightmare',
    manaCost: '{1}{B}{B}',
    manaValue: 3,
    typeLine: 'Legendary Creature — Nightmare',
    colorIdentity: 'B',
    imageSmall:
      'https://images.example.com/small/front/f/9/f96223d0-04c4-40c2-87a9-0c6bc74adddb.jpg?1783906041',
    imageNormal:
      'https://images.example.com/normal/front/f/9/f96223d0-04c4-40c2-87a9-0c6bc74adddb.jpg?1783906041',
    canBeCommander: true,
    isBasicLand: false,
  },
  bojukaBog: {
    oracleId: '04b7362d-0490-4cb0-b5d7-2a7732f659ce',
    name: 'Bojuka Bog',
    frontFaceName: 'Bojuka Bog',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Land',
    colorIdentity: 'B',
    imageSmall:
      'https://images.example.com/small/front/b/0/b0c6fb5e-07e2-4d22-be19-60592f00584a.jpg?1783906018',
    imageNormal:
      'https://images.example.com/normal/front/b/0/b0c6fb5e-07e2-4d22-be19-60592f00584a.jpg?1783906018',
    canBeCommander: false,
    isBasicLand: false,
  },
  cinderGlade: {
    oracleId: 'dfac0258-e148-4d7d-8ded-fc2466d9caa6',
    name: 'Cinder Glade',
    frontFaceName: 'Cinder Glade',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Land — Mountain Forest',
    colorIdentity: 'RG',
    imageSmall:
      'https://images.example.com/small/front/7/8/7865ae5f-cfd9-4913-bcf5-aadbd6824e65.jpg?1783906016',
    imageNormal:
      'https://images.example.com/normal/front/7/8/7865ae5f-cfd9-4913-bcf5-aadbd6824e65.jpg?1783906016',
    canBeCommander: false,
    isBasicLand: false,
  },
} satisfies Record<string, CardSummary>;

export const printings = {
  hearthhullEoc: {
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
  infernalGraspEoc: {
    printingId: '060b7e5f-5b40-4efc-9fad-4cebf40b654b',
    oracleId: '94f0a572-e91c-4b56-a5d1-6cbbeabd210d',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '84',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/0/6/060b7e5f-5b40-4efc-9fad-4cebf40b654b.jpg?1783906040',
    imageNormal:
      'https://images.example.com/normal/front/0/6/060b7e5f-5b40-4efc-9fad-4cebf40b654b.jpg?1783906040',
  },
  cultivateEoc: {
    printingId: '7ee610ee-7711-4a6b-b441-d6c73e6ef2b4',
    oracleId: '8b755881-a72d-4e21-a369-d2924eb4585a',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '95',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/7/e/7ee610ee-7711-4a6b-b441-d6c73e6ef2b4.jpg?1783906035',
    imageNormal:
      'https://images.example.com/normal/front/7/e/7ee610ee-7711-4a6b-b441-d6c73e6ef2b4.jpg?1783906035',
  },
  tirelessTrackerEoc: {
    printingId: '66444549-ad9b-49c6-a7c6-34e977c1085d',
    oracleId: 'e6555cca-e608-4c87-b835-9cd47fd1f543',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '110',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/6/6/66444549-ad9b-49c6-a7c6-34e977c1085d.jpg?1783906030',
    imageNormal:
      'https://images.example.com/normal/front/6/6/66444549-ad9b-49c6-a7c6-34e977c1085d.jpg?1783906030',
  },
  putrefyEoc: {
    printingId: '1e355b88-a73d-430b-95eb-8ba646f2e406',
    oracleId: '9b271430-f53d-42d6-a547-2f286dd9bcb6',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '124',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/1/e/1e355b88-a73d-430b-95eb-8ba646f2e406.jpg?1783906026',
    imageNormal:
      'https://images.example.com/normal/front/1/e/1e355b88-a73d-430b-95eb-8ba646f2e406.jpg?1783906026',
  },
  mayhemDevilEoc: {
    printingId: '674f3a8a-4552-4289-b92a-06ce158f115c',
    oracleId: '4709f11c-aef8-45ac-b2bf-e640c568dfac',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '121',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/6/7/674f3a8a-4552-4289-b92a-06ce158f115c.jpg?1783906026',
    imageNormal:
      'https://images.example.com/normal/front/6/7/674f3a8a-4552-4289-b92a-06ce158f115c.jpg?1783906026',
  },
  rakdosCharmEoc: {
    printingId: '64b67170-1602-4050-80c0-ade2a6cac211',
    oracleId: '5e62b51d-faec-4aa0-9504-cf2c282d08ea',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '125',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/6/4/64b67170-1602-4050-80c0-ade2a6cac211.jpg?1783906024',
    imageNormal:
      'https://images.example.com/normal/front/6/4/64b67170-1602-4050-80c0-ade2a6cac211.jpg?1783906024',
  },
  korvoldEoc: {
    printingId: '607c1793-8e5a-4ebf-87c6-7f9c99bbd29a',
    oracleId: '9ae669dd-7e60-4649-b96e-35da28be641a',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '120',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'mythic',
    imageSmall:
      'https://images.example.com/small/front/6/0/607c1793-8e5a-4ebf-87c6-7f9c99bbd29a.jpg?1783906027',
    imageNormal:
      'https://images.example.com/normal/front/6/0/607c1793-8e5a-4ebf-87c6-7f9c99bbd29a.jpg?1783906027',
  },
  theGitrogMonsterEoc: {
    printingId: '40489e28-878d-44a2-847f-07beef1aa0f8',
    oracleId: 'a5e54d2b-aad8-4ddd-af4b-13668913762b',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '117',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'mythic',
    imageSmall:
      'https://images.example.com/small/front/4/0/40489e28-878d-44a2-847f-07beef1aa0f8.jpg?1783906028',
    imageNormal:
      'https://images.example.com/normal/front/4/0/40489e28-878d-44a2-847f-07beef1aa0f8.jpg?1783906028',
  },
  oracleOfMulDayaEoc: {
    printingId: 'ab19808f-a5b8-4dfd-800e-2064cd6538c8',
    oracleId: '6c5b02eb-7829-436a-8555-fea200e4b67f',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '102',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/a/b/ab19808f-a5b8-4dfd-800e-2064cd6538c8.jpg?1783906033',
    imageNormal:
      'https://images.example.com/normal/front/a/b/ab19808f-a5b8-4dfd-800e-2064cd6538c8.jpg?1783906033',
  },
  titaniaEoc: {
    printingId: '732c208b-cd9e-48a9-9b9d-aba63066ba53',
    oracleId: 'd0ade00d-a496-441d-9b7e-7dc033d3292c',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '111',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'mythic',
    imageSmall:
      'https://images.example.com/small/front/7/3/732c208b-cd9e-48a9-9b9d-aba63066ba53.jpg?1783906029',
    imageNormal:
      'https://images.example.com/normal/front/7/3/732c208b-cd9e-48a9-9b9d-aba63066ba53.jpg?1783906029',
  },
  solRingEoc: {
    printingId: 'ee6e5a35-fe21-4dee-b0ef-a8f2841511ad',
    oracleId: '6ad8011d-3471-4369-9d68-b264cc027487',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '57',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/e/e/ee6e5a35-fe21-4dee-b0ef-a8f2841511ad.jpg?1783906049',
    imageNormal:
      'https://images.example.com/normal/front/e/e/ee6e5a35-fe21-4dee-b0ef-a8f2841511ad.jpg?1783906049',
  },
  commandTowerEoc: {
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
  beastWithinEoc: {
    printingId: 'ccac70d4-6e04-4802-8bb8-021368a40e14',
    oracleId: '7735eeba-693b-47e2-bd51-414379cf1016',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '93',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/c/c/ccac70d4-6e04-4802-8bb8-021368a40e14.jpg?1783906036',
    imageNormal:
      'https://images.example.com/normal/front/c/c/ccac70d4-6e04-4802-8bb8-021368a40e14.jpg?1783906036',
  },
  fabledPassageEoc: {
    printingId: '6a21ecc8-f6fd-4670-91d8-94b9ce94c2fe',
    oracleId: '0c85b8f7-0bd0-4680-9ec5-d4b110460a54',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '60',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/6/a/6a21ecc8-f6fd-4670-91d8-94b9ce94c2fe.jpg?1783906047',
    imageNormal:
      'https://images.example.com/normal/front/6/a/6a21ecc8-f6fd-4670-91d8-94b9ce94c2fe.jpg?1783906047',
  },
  arcaneSignetEoc: {
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
  soulOfWindgraceEoc: {
    printingId: '5a80f7e1-1d79-4302-a603-73eb060b97a6',
    oracleId: '2d73a3bd-f052-4f48-9a72-12db03e27249',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '126',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'mythic',
    imageSmall:
      'https://images.example.com/small/front/5/a/5a80f7e1-1d79-4302-a603-73eb060b97a6.jpg?1783906025',
    imageNormal:
      'https://images.example.com/normal/front/5/a/5a80f7e1-1d79-4302-a603-73eb060b97a6.jpg?1783906025',
  },
  omnathEoc: {
    printingId: '777552e5-cc2d-460f-b26f-977c6ebcfc6b',
    oracleId: '1816eede-c5bd-49df-958f-a3af64cb2932',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '123',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'mythic',
    imageSmall:
      'https://images.example.com/small/front/7/7/777552e5-cc2d-460f-b26f-977c6ebcfc6b.jpg?1783906026',
    imageNormal:
      'https://images.example.com/normal/front/7/7/777552e5-cc2d-460f-b26f-977c6ebcfc6b.jpg?1783906026',
  },
  forestEoe: {
    printingId: '673141ec-826f-4132-8282-d499990495a7',
    oracleId: 'b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6',
    setCode: 'eoe',
    setName: 'Edge of Eternities',
    collectorNumber: '276',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/6/7/673141ec-826f-4132-8282-d499990495a7.jpg?1783905910',
    imageNormal:
      'https://images.example.com/normal/front/6/7/673141ec-826f-4132-8282-d499990495a7.jpg?1783905910',
  },
  mountainEoe: {
    printingId: 'de0ac2b0-175b-4e71-9172-ce2a72234818',
    oracleId: 'a3fb7228-e76b-4e96-a40e-20b5fed75685',
    setCode: 'eoe',
    setName: 'Edge of Eternities',
    collectorNumber: '274',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/d/e/de0ac2b0-175b-4e71-9172-ce2a72234818.jpg?1783905907',
    imageNormal:
      'https://images.example.com/normal/front/d/e/de0ac2b0-175b-4e71-9172-ce2a72234818.jpg?1783905907',
  },
  swampEoe: {
    printingId: '58496a56-437f-4204-9691-f63795e5cdab',
    oracleId: '56719f6a-1a6c-4c0a-8d21-18f7d7350b68',
    setCode: 'eoe',
    setName: 'Edge of Eternities',
    collectorNumber: '271',
    lang: 'en',
    finishes: ['nonfoil', 'foil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/5/8/58496a56-437f-4204-9691-f63795e5cdab.jpg?1783905909',
    imageNormal:
      'https://images.example.com/normal/front/5/8/58496a56-437f-4204-9691-f63795e5cdab.jpg?1783905909',
  },
  rampagingBalothsEoc: {
    printingId: '84aa18de-6acc-46cc-8e28-3046790a6751',
    oracleId: '2d3e6549-6cc6-434f-a189-ba3b55e64c34',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '104',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/8/4/84aa18de-6acc-46cc-8e28-3046790a6751.jpg?1783906033',
    imageNormal:
      'https://images.example.com/normal/front/8/4/84aa18de-6acc-46cc-8e28-3046790a6751.jpg?1783906033',
  },
  blasphemousActEoc: {
    printingId: 'fbeeb7d0-cda8-414b-82d3-a83f1883bdd2',
    oracleId: '7a2484a9-04fd-41a0-8224-610c1c07ed10',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '86',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/f/b/fbeeb7d0-cda8-414b-82d3-a83f1883bdd2.jpg?1783906038',
    imageNormal:
      'https://images.example.com/normal/front/f/b/fbeeb7d0-cda8-414b-82d3-a83f1883bdd2.jpg?1783906038',
  },
  worldBreakerEoc: {
    printingId: 'd25856c9-cb3d-44d9-905e-007f1af65c06',
    oracleId: 'deeb7e22-b207-42de-b9d4-f790403d52a9',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '112',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'mythic',
    imageSmall:
      'https://images.example.com/small/front/d/2/d25856c9-cb3d-44d9-905e-007f1af65c06.jpg?1783906029',
    imageNormal:
      'https://images.example.com/normal/front/d/2/d25856c9-cb3d-44d9-905e-007f1af65c06.jpg?1783906029',
  },
  uurgEoc: {
    printingId: 'd1974536-9e4f-4808-9e49-a036ec7bf65c',
    oracleId: '0191a93a-f304-4c20-9af4-7cdea82c07cf',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '127',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/d/1/d1974536-9e4f-4808-9e49-a036ec7bf65c.jpg?1783906023',
    imageNormal:
      'https://images.example.com/normal/front/d/1/d1974536-9e4f-4808-9e49-a036ec7bf65c.jpg?1783906023',
  },
  farseekEoc: {
    printingId: '95e0760a-d285-493b-88cd-7556d9b10007',
    oracleId: '495e52e6-4c2b-4574-9474-eadbdcc8b4ac',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '50',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/9/5/95e0760a-d285-493b-88cd-7556d9b10007.jpg?1783906051',
    imageNormal:
      'https://images.example.com/normal/front/9/5/95e0760a-d285-493b-88cd-7556d9b10007.jpg?1783906051',
  },
  naturesLoreEoc: {
    printingId: '5b42a79a-1f08-4e15-b40e-c993307ae066',
    oracleId: '78826359-fe63-44ad-adc4-a17ffcd710e4',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '101',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/5/b/5b42a79a-1f08-4e15-b40e-c993307ae066.jpg?1783906033',
    imageNormal:
      'https://images.example.com/normal/front/5/b/5b42a79a-1f08-4e15-b40e-c993307ae066.jpg?1783906033',
  },
  nightsWhisperEoc: {
    printingId: '67bdba19-c74a-462d-9e51-4fd7f0a6a2c3',
    oracleId: '7ffae8f8-3006-4969-a339-6d30678f87ea',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '85',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/6/7/67bdba19-c74a-462d-9e51-4fd7f0a6a2c3.jpg?1783906041',
    imageNormal:
      'https://images.example.com/normal/front/6/7/67bdba19-c74a-462d-9e51-4fd7f0a6a2c3.jpg?1783906041',
  },
  braidsEoc: {
    printingId: 'f96223d0-04c4-40c2-87a9-0c6bc74adddb',
    oracleId: 'e0445c80-fa53-4c3e-881e-940e9fce7f57',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '82',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/f/9/f96223d0-04c4-40c2-87a9-0c6bc74adddb.jpg?1783906041',
    imageNormal:
      'https://images.example.com/normal/front/f/9/f96223d0-04c4-40c2-87a9-0c6bc74adddb.jpg?1783906041',
  },
  bojukaBogEoc: {
    printingId: 'b0c6fb5e-07e2-4d22-be19-60592f00584a',
    oracleId: '04b7362d-0490-4cb0-b5d7-2a7732f659ce',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '149',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/b/0/b0c6fb5e-07e2-4d22-be19-60592f00584a.jpg?1783906018',
    imageNormal:
      'https://images.example.com/normal/front/b/0/b0c6fb5e-07e2-4d22-be19-60592f00584a.jpg?1783906018',
  },
  cinderGladeEoc: {
    printingId: '7865ae5f-cfd9-4913-bcf5-aadbd6824e65',
    oracleId: 'dfac0258-e148-4d7d-8ded-fc2466d9caa6',
    setCode: 'eoc',
    setName: 'Edge of Eternities Commander',
    collectorNumber: '154',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'rare',
    imageSmall:
      'https://images.example.com/small/front/7/8/7865ae5f-cfd9-4913-bcf5-aadbd6824e65.jpg?1783906016',
    imageNormal:
      'https://images.example.com/normal/front/7/8/7865ae5f-cfd9-4913-bcf5-aadbd6824e65.jpg?1783906016',
  },
  solRingFdc: {
    printingId: '4f152dd9-2b35-45b2-90fe-8c71d0634226',
    oracleId: '6ad8011d-3471-4369-9d68-b264cc027487',
    setCode: 'fdc',
    setName: 'Foundations Commander',
    collectorNumber: '286',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/4/f/4f152dd9-2b35-45b2-90fe-8c71d0634226.jpg?1789753351',
    imageNormal:
      'https://images.example.com/normal/front/4/f/4f152dd9-2b35-45b2-90fe-8c71d0634226.jpg?1789753351',
  },
  cultivateSoc: {
    printingId: 'f1cc00f9-ae7b-4f7b-95f2-bc5c00e4bd72',
    oracleId: '8b755881-a72d-4e21-a369-d2924eb4585a',
    setCode: 'soc',
    setName: 'Secrets of Strixhaven Commander',
    collectorNumber: '265',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'common',
    imageSmall:
      'https://images.example.com/small/front/f/1/f1cc00f9-ae7b-4f7b-95f2-bc5c00e4bd72.jpg?1783903767',
    imageNormal:
      'https://images.example.com/normal/front/f/1/f1cc00f9-ae7b-4f7b-95f2-bc5c00e4bd72.jpg?1783903767',
  },
  infernalGraspSoc: {
    printingId: 'f67b323d-0dda-45f8-84b7-d883ce5045a8',
    oracleId: '94f0a572-e91c-4b56-a5d1-6cbbeabd210d',
    setCode: 'soc',
    setName: 'Secrets of Strixhaven Commander',
    collectorNumber: '216',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/f/6/f67b323d-0dda-45f8-84b7-d883ce5045a8.jpg?1783903785',
    imageNormal:
      'https://images.example.com/normal/front/f/6/f67b323d-0dda-45f8-84b7-d883ce5045a8.jpg?1783903785',
  },
  arcaneSignetFdc: {
    printingId: 'ee7710cf-e73d-479f-bc8d-0e78a0e324d9',
    oracleId: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
    setCode: 'fdc',
    setName: 'Foundations Commander',
    collectorNumber: '245',
    lang: 'en',
    finishes: ['nonfoil'],
    rarity: 'uncommon',
    imageSmall:
      'https://images.example.com/small/front/e/e/ee7710cf-e73d-479f-bc8d-0e78a0e324d9.jpg?1789753310',
    imageNormal:
      'https://images.example.com/normal/front/e/e/ee7710cf-e73d-479f-bc8d-0e78a0e324d9.jpg?1789753310',
  },
} satisfies Record<string, PrintingSummary>;

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
  hearthhullBox: {
    id: 9,
    name: 'Hearthhull deck box',
    type: 'deck_box',
    path: 'Hearthhull deck box',
    color: null,
    forTrade: false,
  },
  atraxaBox: {
    id: 10,
    name: 'Atraxa deck box',
    type: 'deck_box',
    path: 'Atraxa deck box',
    color: null,
    forTrade: false,
  },
  /** Marked For trade. */
  tradeBinder: {
    id: 12,
    name: 'Trade binder',
    type: 'binder',
    path: 'Trade binder',
    color: '#d9822b',
    forTrade: true,
  },
} satisfies Record<string, LocationRef>;

export const decks = {
  hearthhull: { id: 1, name: 'Hearthhull' },
  atraxa: { id: 2, name: 'Atraxa' },
};

const nearMint: CopyDetails = {
  finish: 'nonfoil',
  condition: 'near_mint',
  language: 'en',
  misprint: false,
  altered: false,
  isProxy: false,
};

/** One copy of a printing in a location, near mint English unless `details` says otherwise. */
export function stack(
  stackId: number,
  card: CardSummary,
  printing: PrintingSummary,
  location: LocationRef,
  details: Partial<
    Pick<StackRow, keyof CopyDetails | 'quantity' | 'cameFrom' | 'inDeck' | 'unitPrice'>
  > = {},
): StackRow {
  const row = {
    stackId,
    quantity: 1,
    card,
    printing,
    ...nearMint,
    location,
    cameFrom: null,
    inDeck: null,
    unitPrice: null,
    ...details,
  };
  return { ...row, value: stackValue(row) };
}

/** quantity × unitPrice, as the server works it out: 0 for proxies and stacks with no price. */
export function stackValue(row: Pick<StackRow, 'quantity' | 'unitPrice' | 'isProxy'>): number {
  return row.isProxy || row.unitPrice === null ? 0 : row.quantity * row.unitPrice;
}

/** A copy sitting in the Hearthhull deck box, pulled from `cameFrom`. */
export function inHearthhullBox(
  stackId: number,
  card: CardSummary,
  printing: PrintingSummary,
  cameFrom: LocationRef | null,
  details: Partial<Pick<StackRow, keyof CopyDetails | 'unitPrice'>> = {},
): StackRow {
  return stack(stackId, card, printing, locations.hearthhullBox, {
    cameFrom,
    inDeck: { deckId: decks.hearthhull.id, deckName: decks.hearthhull.name },
    ...details,
  });
}

/** A pick-list line pulling one copy from `suggested` for one slot. */
export function pickLine(
  slotId: number,
  suggested: StackRow,
  alternatives: StackRow[] = [],
): PickLine {
  return {
    key: `${slotId}-1`,
    slotId,
    card: suggested.card,
    quantity: suggested.quantity,
    suggested,
    alternatives,
    fromDeck: null,
    fromTrade: suggested.location.forTrade,
  };
}

/** A put-away line for a stack in a deck box: it goes back to its came-from location, or to the inbox. */
export function putAwayLine(row: StackRow): PutAwayLine {
  const { stackId, card, printing, quantity, cameFrom } = row;
  const { finish, condition, language, misprint, altered, isProxy } = row;
  return {
    stackId,
    card,
    printing,
    finish,
    condition,
    language,
    misprint,
    altered,
    isProxy,
    quantity,
    destination: cameFrom ?? locations.toSort,
    cameFrom,
  };
}
