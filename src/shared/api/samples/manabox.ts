import type { ErrorBody, LocationRef } from '../common';
import type { ManaBoxApplyResult, ManaBoxPreview } from '../manabox';
import { locationRef, raresBinderNode } from './locations';

export const toSortInbox: LocationRef = {
  id: 1,
  name: 'To sort',
  type: 'inbox',
  path: 'To sort',
  color: null,
  forTrade: false,
};

/**
 * The preview of Jeff's ManaBox export in tests/fixtures/manabox-sample.csv: 258 rows and 389
 * cards, no Binder Name or Proxy column, and two rows Scryfall doesn't know.
 */
export const manaboxPreview: ManaBoxPreview = {
  previewId: '6f1d2c9e-3b4a-4e8f-9a7c-1d5e2f3a4b6c',
  fileName: 'manabox-sample.csv',
  hasBinderColumn: false,
  hasProxyColumn: false,
  rowCount: 258,
  cardCount: 389,
  binders: [],
  unknownRows: [
    {
      row: 27,
      name: 'Sylvan Library',
      setCode: 'SPG',
      collectorNumber: '155',
      scryfallId: '26a7c62c-12ed-493c-ba95-0f55fec83686',
      quantity: 1,
    },
    {
      row: 231,
      name: 'Follow the Lumarets',
      setCode: 'SOS',
      collectorNumber: '148',
      scryfallId: 'f9488480-2b6c-40bc-a93e-29fb1292a2e4',
      quantity: 2,
    },
  ],
  invalidRows: [],
  lookupFailed: false,
};

/**
 * The preview of a whole-collection export with Binder Name, Binder Type and Proxy columns: two
 * binders (Rares went to the Rares binder last time), one deck, one list, and one row
 * with a quantity that isn't a number.
 */
export const manaboxBinderPreview: ManaBoxPreview = {
  previewId: '0b8e7d6c-5a4f-4321-8fed-cba987654321',
  fileName: 'ManaBox_Collection.csv',
  hasBinderColumn: true,
  hasProxyColumn: true,
  rowCount: 476,
  cardCount: 668,
  binders: [
    {
      key: 'binder:Rares',
      name: 'Rares',
      type: 'binder',
      rowCount: 120,
      cardCount: 164,
      mappedLocation: locationRef(raresBinderNode),
    },
    {
      key: 'binder:Strixhaven',
      name: 'Strixhaven',
      type: 'binder',
      rowCount: 258,
      cardCount: 389,
      mappedLocation: null,
    },
    {
      key: 'deck:Hearthhull',
      name: 'Hearthhull',
      type: 'deck',
      rowCount: 86,
      cardCount: 100,
      mappedLocation: null,
    },
    {
      key: 'list:Wants',
      name: 'Wants',
      type: 'list',
      rowCount: 12,
      cardCount: 15,
      mappedLocation: null,
    },
  ],
  unknownRows: [
    {
      row: 412,
      name: 'Lightning Bolt',
      setCode: 'XYZ',
      collectorNumber: '999',
      scryfallId: null,
      quantity: 1,
    },
  ],
  invalidRows: [
    {
      row: 87,
      name: 'Counterspell',
      setCode: 'MH2',
      collectorNumber: '267',
      reason: 'Quantity is "abc", not a number',
    },
  ],
  lookupFailed: false,
};

/** Applying Jeff's sample into the "to sort" inbox with the two unknown rows skipped. */
export const manaboxApplyResult: ManaBoxApplyResult = {
  message: 'Added 386 cards to To sort',
  batchId: 12,
  importId: 3,
  cardCount: 386,
  skippedCount: 2,
};

/** The 400 answer to a file without the columns ManaBox exports. */
export const missingColumnsError: ErrorBody = {
  error: {
    code: 'missing_columns',
    message:
      "This doesn't look like a ManaBox CSV export. It needs these columns: Scryfall ID, Quantity, Foil, Condition, Language, Misprint and Altered.",
  },
};

/** The 410 answer to applying a preview the server no longer holds. */
export const previewExpiredError: ErrorBody = {
  error: {
    code: 'preview_expired',
    message: 'This preview has expired. Choose the file again to see a fresh one.',
  },
};
