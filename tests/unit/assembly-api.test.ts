import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { app } from '../../src/server/app';
import { ErrorBody } from '../../src/shared/api/common';
import { type PickList, PickListResponse } from '../../src/shared/api/pick-list';
import { ProxyResult, PullResult } from '../../src/shared/api/pulls';
import { type PutAwayGroup, PutAwayResponse, ReturnResult } from '../../src/shared/api/put-away';
import { printings } from '../../src/shared/api/samples/hearthhull';
import { pickListSample } from '../../src/shared/api/samples/pick-list';
import {
  proxyResultSample,
  pullFromOtherDeckResultSample,
  pullResultSample,
  staleCopyErrorSample,
} from '../../src/shared/api/samples/pulls';
import {
  deckBoxDestinationErrorSample,
  putAwaySample,
  returnAllResultSample,
  returnResultSample,
} from '../../src/shared/api/samples/put-away';
import { swapSample } from '../../src/shared/api/samples/swap';
import { SwapResponse } from '../../src/shared/api/swap';

const soulOfWindgrace = printings.soulOfWindgraceEoc;

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectInvalid(res: Response) {
  expect(res.status).toBe(400);
  expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
}

describe('assembly samples', () => {
  const samples: [string, z.ZodType, unknown][] = [
    ['pick list', PickListResponse, pickListSample],
    ['pull', PullResult, pullResultSample],
    ['pull from another deck', PullResult, pullFromOtherDeckResultSample],
    ['proxy', ProxyResult, proxyResultSample],
    ['stale copy', ErrorBody, staleCopyErrorSample],
    ['put-away list', PutAwayResponse, putAwaySample],
    ['return', ReturnResult, returnResultSample],
    ['return all', ReturnResult, returnAllResultSample],
    ['deck box destination', ErrorBody, deckBoxDestinationErrorSample],
    ['swap list', SwapResponse, swapSample],
  ];

  it.each(samples)('the %s sample parses with its schema', (_name, schema, sample) => {
    expect(schema.parse(sample)).toEqual(sample);
  });

  function expectPickListAddsUp(list: PickList) {
    const lines = [...list.groups.flatMap((g) => g.lines), ...list.otherDecks];
    for (const group of list.groups) {
      expect(group.cardCount).toBe(group.lines.reduce((sum, l) => sum + l.quantity, 0));
      for (const l of group.lines) expect(l.suggested.location).toEqual(group.location);
    }
    for (const l of list.otherDecks) {
      expect(l.fromDeck?.id).toBe(l.suggested.inDeck?.deckId);
    }
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
    expect(list.totals).toEqual({
      lines: lines.length,
      cards: lines.reduce((sum, l) => sum + l.quantity, 0),
    });
  }

  function expectPutAwayAddsUp(groups: PutAwayGroup[]) {
    for (const group of groups) {
      for (const l of group.lines) {
        expect(l.destination).toEqual(group.location);
        expect(l.destination).toEqual(l.cameFrom ?? expect.objectContaining({ type: 'inbox' }));
      }
    }
    return groups.flatMap((g) => g.lines);
  }

  it('add up: pick list counts and totals match their lines', () => {
    expectPickListAddsUp(pickListSample.pickList);
    expectPickListAddsUp(swapSample.pullIn);
  });

  it('add up: put-away and swap lines sit under their destination', () => {
    const lines = expectPutAwayAddsUp(putAwaySample.groups);
    expect(putAwaySample.totals).toEqual({
      lines: lines.length,
      cards: lines.reduce((sum, l) => sum + l.quantity, 0),
    });

    const takeOut = expectPutAwayAddsUp(swapSample.takeOut.groups);
    const takeOutCards = takeOut.reduce((sum, l) => sum + l.quantity, 0);
    expect(swapSample.takeOut.count).toBe(takeOutCards);
    expect(swapSample.counts).toEqual({
      takeOut: takeOutCards,
      pullIn: swapSample.pullIn.totals.cards,
    });
  });
});

describe('assembly stub routes', () => {
  // Pulls and proxies are real since #44; tests/unit/pulls.test.ts covers them.
  it('POST /api/decks/:id/pulls checks the request', async () => {
    await expectInvalid(await post('/api/decks/1/pulls', { slotId: 104, quantity: 1 }));
    await expectInvalid(
      await post('/api/decks/1/pulls', { slotId: 104, stackId: 201, quantity: 0 }),
    );
    await expectInvalid(
      await post('/api/decks/1/pulls', {
        slotId: 104,
        stackId: 201,
        quantity: 1,
        reason: 'returned',
      }),
    );
    await expectInvalid(
      await post('/api/decks/0/pulls', { slotId: 104, stackId: 201, quantity: 1 }),
    );
  });

  it('POST /api/decks/:id/proxies checks the request', async () => {
    const body = { slotId: 119, scryfallId: soulOfWindgrace.scryfallId, quantity: 1 };
    await expectInvalid(await post('/api/decks/1/proxies', { ...body, scryfallId: '' }));
    await expectInvalid(await post('/api/decks/1/proxies', { ...body, slotId: '119' }));
  });

  // The put-away list answers from the database now: tests/unit/put-away.test.ts.
  it('POST /api/decks/:id/returns checks the request', async () => {
    await expectInvalid(await post('/api/decks/1/returns', { lines: [] }));
    await expectInvalid(
      await post('/api/decks/1/returns', {
        lines: [{ stackId: 302, quantity: 1 }],
        reason: 'assembled',
      }),
    );
  });
});

// The pick list, pulls, proxies and the swap list answer from the database now, each with
// typed-client checks in its own test file.
