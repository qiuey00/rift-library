import { describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';
import { CardDataStatus } from '../../src/shared/api/card-data';
import {
  CardDetailsResponse,
  CardSearchQuery,
  CardSearchResponse,
  CardSearchResult,
} from '../../src/shared/api/cards';
import { CardSummary, ErrorBody, PrintingSummary } from '../../src/shared/api/common';
import * as cardDataSamples from '../../src/shared/api/samples/card-data';
import * as cardSamples from '../../src/shared/api/samples/cards';

describe('card data samples', () => {
  it('has a status in each state that parses', () => {
    for (const [state, status] of Object.entries(cardDataSamples.cardDataStatusSamples)) {
      expect(CardDataStatus.parse(status).state).toBe(state);
    }
    CardDataStatus.parse(cardDataSamples.cardDataStatus);
    CardDataStatus.parse(cardDataSamples.cardDataRefreshStarted);
    ErrorBody.parse(cardDataSamples.refreshRunningError);
  });
});

describe('card samples', () => {
  it('parse with their schemas', () => {
    const s = cardSamples;
    for (const card of [
      s.emberSignet,
      s.emberRebuke,
      s.emberSanctum,
      s.emberLighthouse,
      s.poroEmberRetriever,
      s.jinxLooseCannon,
      s.gildedWhelp,
    ]) {
      CardSummary.parse(card);
    }
    for (const printing of [...s.emberSignetPrintings, ...s.gildedWhelpPrintings]) {
      PrintingSummary.parse(printing);
    }
    CardSearchResult.parse(s.emberSignetResult);
    for (const search of [s.emberSearch, s.legendSearch, s.emptySearch]) {
      CardSearchResponse.parse(search);
    }
    for (const details of [s.emberSignetDetails, s.gildedWhelpDetails]) {
      const parsed = CardDetailsResponse.parse(details);
      const { owned, inDecks, free } = parsed.counts;
      expect(free).toBe(owned - inDecks);
    }
    ErrorBody.parse(s.cardNotFoundError);
  });

  it('match what the screens need', () => {
    const signet = cardSamples.emberSearch.results.find((r) => r.name === 'Ember Signet');
    expect(signet).toMatchObject({ owned: 3, free: 1 });
    expect(cardSamples.legendSearch.results[0]).toMatchObject({
      name: 'Jinx, Loose Cannon',
      type: 'legend',
      domains: ['fury', 'chaos'],
    });
    expect(cardSamples.emberSignetDetails.printings).toHaveLength(3);
    expect(cardSamples.gildedWhelpDetails.card).toMatchObject({
      name: 'Gilded Whelp',
      deckable: true,
    });
    expect(cardSamples.emberSignet.imageUrl).toMatch(
      /^https:\/\/images\.example\.com\/riftbound\/[0-9a-f-]{36}\.webp$/,
    );
  });
});

describe('card search query', () => {
  it('needs q, defaults the limit to 20 and checks the type and domains', () => {
    expect(CardSearchQuery.parse({ q: 'ember' })).toEqual({ q: 'ember', limit: 20 });
    expect(CardSearchQuery.parse({ q: 'x', domains: '', limit: '5' })).toEqual({
      q: 'x',
      domains: [],
      limit: 5,
    });
    expect(CardSearchQuery.parse({ q: 'x', domains: 'fury,chaos' }).domains).toEqual([
      'fury',
      'chaos',
    ]);
    expect(CardSearchQuery.safeParse({}).success).toBe(false);
    expect(CardSearchQuery.safeParse({ q: '  ' }).success).toBe(false);
    expect(CardSearchQuery.safeParse({ q: 'x', domains: 'green' }).success).toBe(false);
    expect(CardSearchQuery.safeParse({ q: 'x', type: 'creature' }).success).toBe(false);
  });
});

describe('card search route', () => {
  it('answers a search without q with 400 invalid_request', async () => {
    const res = await app.request('/api/cards');
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
  });
});
