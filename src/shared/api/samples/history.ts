import type { DeckRef } from '../decks';
import type { HistoryDay, MovementReason, MovementRow } from '../history';
import type { LocationNode } from '../locations';
import {
  blackGreenNode,
  hearthhullDeckBoxNode,
  landsNode,
  locationRef,
  raresBinderNode,
  staplesBinderNode,
  toSortNode,
} from './locations';
import { sampleCards as c, type SampleCard } from './stacks';

// Sample answers for the history area, matching src/shared/api/history.ts. Screen tests mock
// the API with them; the stub route returns them until #40.

const hearthhullDeck: DeckRef = { id: 1, name: 'Hearthhull' };

const movement = (
  id: number,
  createdAt: string,
  { card, printing }: SampleCard,
  quantity: number,
  from: LocationNode | null,
  to: LocationNode | null,
  reason: MovementReason,
  { deck = null, undoneAt = null }: { deck?: DeckRef | null; undoneAt?: string | null } = {},
): MovementRow => ({
  id,
  createdAt,
  card,
  printing,
  quantity,
  from: from && locationRef(from),
  to: to && locationRef(to),
  reason,
  deck,
  undoneAt,
});

/**
 * GET /api/history?offset=420: Saturday 18 October 2026, newest first. An import batch, a
 * pick-list batch, two single moves, and a move that was undone along with its undo batch.
 */
export const historyDaySample: HistoryDay = {
  day: '2026-10-18',
  entries: [
    {
      kind: 'batch',
      batch: {
        id: 106,
        kind: 'undo',
        summary: 'Undid: moved Arcane Signet to Rares binder',
        deck: null,
        createdAt: '2026-10-18T22:15:04Z',
        undone: false,
        movements: [
          movement(
            511,
            '2026-10-18T22:15:04Z',
            c.arcaneSignetFic,
            1,
            raresBinderNode,
            staplesBinderNode,
            'undo',
          ),
        ],
      },
    },
    {
      kind: 'movement',
      movement: movement(
        510,
        '2026-10-18T22:14:37Z',
        c.arcaneSignetFic,
        1,
        staplesBinderNode,
        raresBinderNode,
        'moved',
        {
          undoneAt: '2026-10-18T22:15:04Z',
        },
      ),
    },
    {
      kind: 'movement',
      movement: movement(
        509,
        '2026-10-18T21:30:12Z',
        c.sylvanLibrary,
        1,
        toSortNode,
        raresBinderNode,
        'moved',
      ),
    },
    {
      kind: 'movement',
      movement: movement(
        508,
        '2026-10-18T21:05:48Z',
        c.commandTower,
        3,
        toSortNode,
        landsNode,
        'moved',
      ),
    },
    {
      kind: 'batch',
      batch: {
        id: 102,
        kind: 'pick_list',
        summary: 'Pick list · Hearthhull · 3 cards',
        deck: hearthhullDeck,
        createdAt: '2026-10-18T20:10:05Z',
        undone: false,
        movements: [
          movement(
            507,
            '2026-10-18T20:10:40Z',
            c.commandTower,
            1,
            landsNode,
            hearthhullDeckBoxNode,
            'assembled',
            {
              deck: hearthhullDeck,
            },
          ),
          movement(
            506,
            '2026-10-18T20:10:22Z',
            c.hearthhull,
            1,
            raresBinderNode,
            hearthhullDeckBoxNode,
            'assembled',
            {
              deck: hearthhullDeck,
            },
          ),
          movement(
            505,
            '2026-10-18T20:10:05Z',
            c.arcaneSignet,
            1,
            staplesBinderNode,
            hearthhullDeckBoxNode,
            'assembled',
            {
              deck: hearthhullDeck,
            },
          ),
        ],
      },
    },
    {
      kind: 'batch',
      batch: {
        id: 101,
        kind: 'import',
        summary: 'Imported 7 cards',
        deck: null,
        createdAt: '2026-10-18T19:02:11Z',
        undone: false,
        movements: [
          movement(504, '2026-10-18T19:02:11Z', c.pickYourPoison, 1, null, toSortNode, 'imported'),
          movement(503, '2026-10-18T19:02:11Z', c.elementalMascot, 4, null, toSortNode, 'imported'),
          movement(
            502,
            '2026-10-18T19:02:11Z',
            c.magmabloodArchaicJa,
            1,
            null,
            toSortNode,
            'imported',
          ),
          movement(501, '2026-10-18T19:02:11Z', c.harmonizedTrio, 1, null, toSortNode, 'imported'),
        ],
      },
    },
  ],
  nextBefore: '2026-10-17',
};

/** GET /api/history?before=2026-10-17&offset=420: the oldest day, with one added card. */
export const historyOlderDaySample: HistoryDay = {
  day: '2026-10-17',
  entries: [
    {
      kind: 'movement',
      movement: movement(
        500,
        '2026-10-17T18:20:00Z',
        c.witherbloomCharm,
        2,
        null,
        blackGreenNode,
        'added',
      ),
    },
  ],
  nextBefore: null,
};
