import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { type AppType, app } from '../../src/server/app';
import { ActionResult, ErrorBody } from '../../src/shared/api/common';
import { HistoryDay } from '../../src/shared/api/history';
import { LocationNode, LocationNotEmptyError, LocationTree } from '../../src/shared/api/locations';
import * as copiesSamples from '../../src/shared/api/samples/copies';
import * as historySamples from '../../src/shared/api/samples/history';
import * as locationsSamples from '../../src/shared/api/samples/locations';
import * as stacksSamples from '../../src/shared/api/samples/stacks';
import * as undoSamples from '../../src/shared/api/samples/undo';
import {
  CardCopies,
  CollectionValue,
  LocationStacks,
  StacksPage,
} from '../../src/shared/api/stacks';

// The typed client, answering from the app itself instead of over the network.
const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

const samples: [string, z.ZodType, unknown][] = [
  ['locationTreeSample', LocationTree, locationsSamples.locationTreeSample],
  ['createdLocationSample', LocationNode, locationsSamples.createdLocationSample],
  ['updatedLocationSample', LocationNode, locationsSamples.updatedLocationSample],
  [
    'locationNotEmptyErrorSample',
    LocationNotEmptyError,
    locationsSamples.locationNotEmptyErrorSample,
  ],
  ['inboxProtectedErrorSample', ErrorBody, locationsSamples.inboxProtectedErrorSample],
  ['deckBoxProtectedErrorSample', ErrorBody, locationsSamples.deckBoxProtectedErrorSample],
  ['locationLoopErrorSample', ErrorBody, locationsSamples.locationLoopErrorSample],
  ['markedForTradeSample', LocationNode, locationsSamples.markedForTradeSample],
  ['deckBoxNotForTradeErrorSample', ErrorBody, locationsSamples.deckBoxNotForTradeErrorSample],
  ['moveResultSample', ActionResult, copiesSamples.moveResultSample],
  ['moveManyResultSample', ActionResult, copiesSamples.moveManyResultSample],
  ['moveContentsResultSample', ActionResult, copiesSamples.moveContentsResultSample],
  ['setProxyResultSample', ActionResult, copiesSamples.setProxyResultSample],
  ['addCopiesResultSample', ActionResult, copiesSamples.addCopiesResultSample],
  ['staleCopyErrorSample', ErrorBody, copiesSamples.staleCopyErrorSample],
  ['stacksPageSample', StacksPage, stacksSamples.stacksPageSample],
  ['stacksNextPageSample', StacksPage, stacksSamples.stacksNextPageSample],
  ['stacksSearchSample', StacksPage, stacksSamples.stacksSearchSample],
  ['stacksTradeSample', StacksPage, stacksSamples.stacksTradeSample],
  ['stacksByValueSample', StacksPage, stacksSamples.stacksByValueSample],
  ['collectionValueSample', CollectionValue, stacksSamples.collectionValueSample],
  ['locationStacksSample', LocationStacks, stacksSamples.locationStacksSample],
  [
    'locationStacksWithChildrenSample',
    LocationStacks,
    stacksSamples.locationStacksWithChildrenSample,
  ],
  ['cardCopiesSample', CardCopies, stacksSamples.cardCopiesSample],
  ['cardCopiesEmptySample', CardCopies, stacksSamples.cardCopiesEmptySample],
  ['undoMovementResultSample', ActionResult, undoSamples.undoMovementResultSample],
  ['undoBatchResultSample', ActionResult, undoSamples.undoBatchResultSample],
  ['cannotUndoErrorSample', ErrorBody, undoSamples.cannotUndoErrorSample],
  ['historyDaySample', HistoryDay, historySamples.historyDaySample],
  ['historyOlderDaySample', HistoryDay, historySamples.historyOlderDaySample],
];

describe('locations, copies and history samples', () => {
  it.each(samples)('%s matches its schema', (_name, schema, sample) => {
    expect(schema.parse(sample)).toEqual(sample);
  });

  it('every sample file export is checked', () => {
    const exported = [copiesSamples, historySamples, locationsSamples, stacksSamples, undoSamples]
      .flatMap((module) => Object.keys(module))
      .filter((name) => name.endsWith('Sample'));
    expect(exported.sort()).toEqual(samples.map(([name]) => name).sort());
  });

  it('lists the tree with the inbox first and deck boxes last', () => {
    const types = locationsSamples.locationTreeSample.nodes.map((node) => node.type);
    expect(types[0]).toBe('inbox');
    expect(types.slice(-2)).toEqual(['deck_box', 'deck_box']);
  });

  it('covers a proxy, a foil, a non-English copy and a copy in a deck box', () => {
    const rows = [
      ...stacksSamples.stacksPageSample.rows,
      ...stacksSamples.stacksNextPageSample.rows,
    ];
    expect(rows.some((row) => row.isProxy)).toBe(true);
    expect(rows.some((row) => row.finish === 'foil')).toBe(true);
    expect(rows.some((row) => row.language !== 'en')).toBe(true);
    expect(rows.some((row) => row.inDeck && row.cameFrom)).toBe(true);
  });

  it('adds up the collection totals from the rows', () => {
    const rows = [
      ...stacksSamples.stacksPageSample.rows,
      ...stacksSamples.stacksNextPageSample.rows,
    ];
    expect(stacksSamples.stacksPageSample.total).toEqual({
      stacks: rows.length,
      cards: rows.reduce((sum, row) => sum + row.quantity, 0),
      proxies: rows.filter((row) => row.isProxy).reduce((sum, row) => sum + row.quantity, 0),
      value: rows.reduce((sum, row) => sum + row.value, 0),
      noPriceCount: rows
        .filter((row) => !row.isProxy && row.unitPrice === null)
        .reduce((sum, row) => sum + row.quantity, 0),
    });
  });

  it('prices every stack: a proxy is worth 0, and one stack has no price', () => {
    const rows = [
      ...stacksSamples.stacksPageSample.rows,
      ...stacksSamples.stacksNextPageSample.rows,
    ];
    for (const row of rows) {
      const expected = row.isProxy || row.unitPrice === null ? 0 : row.quantity * row.unitPrice;
      expect(row.value).toBe(expected);
    }
    expect(rows.some((row) => row.isProxy && row.unitPrice !== null && row.value === 0)).toBe(true);
    expect(rows.filter((row) => row.unitPrice === null)).toHaveLength(1);
    expect(rows.filter((row) => row.location.forTrade)).toHaveLength(1);
  });

  it('adds up location values into their parents and the whole collection', () => {
    const nodes = locationsSamples.locationTreeSample.nodes;
    for (const node of nodes) {
      const children = nodes.filter((child) => child.parentId === node.id);
      if (children.length === 0) continue;
      expect(node.value).toBe(children.reduce((sum, child) => sum + child.value, 0));
      expect(node.noPriceCount).toBe(children.reduce((sum, child) => sum + child.noPriceCount, 0));
    }
    const topLevel = nodes.filter((node) => node.parentId === null);
    const whole = stacksSamples.collectionValueSample;
    expect(topLevel.reduce((sum, node) => sum + node.value, 0)).toBe(whole.value);
    expect(topLevel.reduce((sum, node) => sum + node.noPriceCount, 0)).toBe(whole.noPriceCount);
    expect(topLevel.reduce((sum, node) => sum + node.totalCount, 0)).toBe(whole.cards);
    const trade = nodes.filter((node) => node.forTrade);
    expect(trade.map((node) => [node.name, node.markedForTrade])).toEqual([['Trade binder', true]]);
  });
});

describe('locations, copies and stacks request checks', () => {
  it.each([
    [
      'a location for the inbox type',
      () => client.locations.$post({ json: { name: 'Inbox 2', type: 'inbox' as 'box' } }),
    ],
    ['an empty change', () => client.locations[':id'].$patch({ param: { id: '5' }, json: {} })],
    [
      'a color that is not a hex color',
      () => client.locations[':id'].$patch({ param: { id: '5' }, json: { color: 'blue' } }),
    ],
    [
      'a location id that is not a number',
      () => client.locations[':id'].$delete({ param: { id: 'rares' } }),
    ],
    ['a move of no copies', () => client.moves.$post({ json: { moves: [], toLocationId: 9 } })],
    [
      'a move of zero copies',
      () => client.moves.$post({ json: { moves: [{ stackId: 1, quantity: 0 }], toLocationId: 9 } }),
    ],
    [
      'a card id that is not an oracle id',
      () => client.cards[':oracleId'].copies.$get({ param: { oracleId: 'arcane-signet' } }),
    ],
    [
      'history without the UTC offset',
      () => client.history.$get({ query: {} as { offset: string } }),
    ],
    [
      'history with a date that is not a date',
      () => client.history.$get({ query: { offset: '0', before: '18/10/2026' } }),
    ],
  ])('refuses %s with 400 invalid_request', async (_name, send) => {
    const res = await send();
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
  });
});
