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
      s.arcaneSignet,
      s.arcaneDenial,
      s.arcaneSanctum,
      s.arcaneLighthouse,
      s.pakoArcaneRetriever,
      s.hearthhullTheWorldseed,
      s.harmonizedTrio,
    ]) {
      CardSummary.parse(card);
    }
    for (const printing of [...s.arcaneSignetPrintings, ...s.harmonizedTrioPrintings]) {
      PrintingSummary.parse(printing);
    }
    CardSearchResult.parse(s.arcaneSignetResult);
    for (const search of [s.arcaneSearch, s.commanderSearch, s.emptySearch]) {
      CardSearchResponse.parse(search);
    }
    for (const details of [s.arcaneSignetDetails, s.harmonizedTrioDetails]) {
      const parsed = CardDetailsResponse.parse(details);
      const { owned, inDecks, free } = parsed.counts;
      expect(free).toBe(owned - inDecks);
    }
    ErrorBody.parse(s.cardNotFoundError);
  });

  it('match what the screens need', () => {
    const signet = cardSamples.arcaneSearch.results.find((r) => r.name === 'Arcane Signet');
    expect(signet).toMatchObject({ owned: 3, free: 1 });
    expect(cardSamples.commanderSearch.results[0]).toMatchObject({
      name: 'Hearthhull, the Worldseed',
      colorIdentity: 'BRG',
      canBeCommander: true,
    });
    expect(cardSamples.arcaneSignetDetails.printings).toHaveLength(3);
    expect(cardSamples.harmonizedTrioDetails.card).toMatchObject({
      name: 'Harmonized Trio // Brainstorm',
      frontFaceName: 'Harmonized Trio',
    });
    expect(cardSamples.arcaneSignet.imageSmall).toMatch(
      /^https:\/\/images\.example\.com\/small\/front\/[0-9a-f]\/[0-9a-f]\/[0-9a-f-]{36}\.jpg\?\d+$/,
    );
  });
});

describe('card search query', () => {
  it('needs q, defaults the limit to 20 and checks the color identity', () => {
    expect(CardSearchQuery.parse({ q: 'arcane' })).toEqual({ q: 'arcane', limit: 20 });
    expect(CardSearchQuery.parse({ q: 'x', identity: '', limit: '5' }).limit).toBe(5);
    expect(CardSearchQuery.safeParse({}).success).toBe(false);
    expect(CardSearchQuery.safeParse({ q: '  ' }).success).toBe(false);
    expect(CardSearchQuery.safeParse({ q: 'x', identity: 'brg' }).success).toBe(false);
    expect(CardSearchQuery.safeParse({ q: 'x', commander: 'yes' }).success).toBe(false);
  });
});

describe('card search route', () => {
  it('answers a search without q with 400 invalid_request', async () => {
    const res = await app.request('/api/cards/search');
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
  });
});
