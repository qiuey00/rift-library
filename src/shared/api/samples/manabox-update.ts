import type { CardSummary, LocationRef, PrintingSummary } from '../common';
import type { ManaBoxUpdateApplyResult, UpdatePreview, UpdateRow } from '../manabox-update';

export const strixhavenBinder: LocationRef = {
  id: 2,
  name: 'Strixhaven binder',
  type: 'binder',
  path: 'Strixhaven binder',
  color: '#7a3fb0',
  forTrade: false,
};

function image(size: 'small' | 'normal', path: string) {
  return `https://cards.scryfall.io/${size}/front/${path}`;
}

function sampleRow(
  card: Omit<CardSummary, 'frontFaceName' | 'imageSmall' | 'imageNormal'>,
  printing: Pick<
    PrintingSummary,
    'scryfallId' | 'setCode' | 'setName' | 'collectorNumber' | 'rarity'
  >,
  imagePath: string,
  row: Pick<UpdateRow, 'finish' | 'fileQuantity' | 'appQuantity' | 'flagged'>,
): UpdateRow {
  const images = { imageSmall: image('small', imagePath), imageNormal: image('normal', imagePath) };
  return {
    key: `${printing.scryfallId}:${row.finish}:near_mint:en:0:0`,
    card: { ...card, frontFaceName: card.name, ...images },
    printing: {
      ...printing,
      oracleId: card.oracleId,
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      ...images,
    },
    condition: 'near_mint',
    language: 'en',
    misprint: false,
    altered: false,
    ...row,
  };
}

const notCommander = { canBeCommander: false, isBasicLand: false };

/**
 * Updating the Strixhaven binder from a fresh export of it: one row in each group, and the one
 * Terramorphic Expanse is now in the Hearthhull deck box, so removing it is flagged.
 */
export const updatePreview: UpdatePreview = {
  previewId: '9c4b2a1d-7e6f-4a3b-8c2d-5e4f3a2b1c0d',
  location: strixhavenBinder,
  groups: {
    new: [
      sampleRow(
        {
          oracleId: '9af4a832-d634-47aa-91ed-79d44fe08864',
          name: 'Pick Your Poison',
          manaCost: '{G}',
          manaValue: 1,
          typeLine: 'Sorcery',
          colorIdentity: 'G',
          ...notCommander,
        },
        {
          scryfallId: 'a11f1013-d747-4cf2-bbf5-0bd68a949ddf',
          setCode: 'soa',
          setName: 'Secrets of Strixhaven Mystical Archive',
          collectorNumber: '55',
          rarity: 'uncommon',
        },
        'a/1/a11f1013-d747-4cf2-bbf5-0bd68a949ddf.jpg?1783903918',
        { finish: 'foil', fileQuantity: 1, appQuantity: 0, flagged: [] },
      ),
    ],
    raised: [
      sampleRow(
        {
          oracleId: 'c7aecca5-2f67-4245-ab2d-e723d8b23a67',
          name: 'Expressive Iteration',
          manaCost: '{U}{R}',
          manaValue: 2,
          typeLine: 'Sorcery',
          colorIdentity: 'UR',
          ...notCommander,
        },
        {
          scryfallId: '5697541f-a03f-48b9-a0fd-ee0cf5357660',
          setCode: 'soa',
          setName: 'Secrets of Strixhaven Mystical Archive',
          collectorNumber: '64',
          rarity: 'rare',
        },
        '5/6/5697541f-a03f-48b9-a0fd-ee0cf5357660.jpg?1783903913',
        { finish: 'nonfoil', fileQuantity: 2, appQuantity: 1, flagged: [] },
      ),
    ],
    lowered: [
      sampleRow(
        {
          oracleId: 'dc5dffc8-fac5-4956-bac4-1ad2cc16f6be',
          name: 'Deflecting Palm',
          manaCost: '{R}{W}',
          manaValue: 2,
          typeLine: 'Instant',
          colorIdentity: 'WR',
          ...notCommander,
        },
        {
          scryfallId: 'fa80a2e6-303f-4cd4-b719-cdc030a51181',
          setCode: 'soa',
          setName: 'Secrets of Strixhaven Mystical Archive',
          collectorNumber: '63',
          rarity: 'rare',
        },
        'f/a/fa80a2e6-303f-4cd4-b719-cdc030a51181.jpg?1783903914',
        { finish: 'nonfoil', fileQuantity: 1, appQuantity: 2, flagged: [] },
      ),
    ],
    missing: [
      sampleRow(
        {
          oracleId: '1bd3e453-aa21-4ee6-95c2-d6d920ee8e7a',
          name: 'Terramorphic Expanse',
          manaCost: '',
          manaValue: 0,
          typeLine: 'Land',
          colorIdentity: '',
          ...notCommander,
        },
        {
          scryfallId: '9a4c5629-fadd-42b9-850f-9f8586a2ca50',
          setCode: 'sos',
          setName: 'Secrets of Strixhaven',
          collectorNumber: '265',
          rarity: 'common',
        },
        '9/a/9a4c5629-fadd-42b9-850f-9f8586a2ca50.jpg?1783903615',
        {
          finish: 'nonfoil',
          fileQuantity: 0,
          appQuantity: 1,
          flagged: [{ stackId: 41, deck: { id: 1, name: 'Hearthhull' }, quantity: 1 }],
        },
      ),
    ],
  },
  unchangedCount: 251,
  unknownRows: [],
  invalidRows: [],
  lookupFailed: false,
};

export const updateApplyResult: ManaBoxUpdateApplyResult = {
  message: 'Updated Strixhaven binder: 2 cards added, 2 removed',
  batchId: 13,
  importId: 4,
};
