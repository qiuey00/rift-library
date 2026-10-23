import path from 'node:path';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { createTestDb } from '../../src/server/db/test-db';
import { dropClues, edhrecSlug, resolveDrop } from '../../src/server/scryfall/drop';
import { loadBulkFile } from '../../src/server/scryfall/load';
import { createDeck } from '../../src/server/services/decks';
import { ErrorBody } from '../../src/shared/api/common';
import { SlotRow } from '../../src/shared/api/decks';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'scryfall', 'default-cards.json');

const HEARTHHULL_ORACLE = '8d6f82d9-5c5b-4c41-8857-c0936f2d894c';
const KORVOLD = '607c1793-8e5a-4ebf-87c6-7f9c99bbd29a';

// What Chromium carried when dragging from the live sites (2026-10-20), with fixture cards.
const scryfallSearchDrop = {
  uriList: 'https://scryfall.com/card/eoc/120/korvold-fae-cursed-king',
  html: `<img class="card eoc border-black" title="Korvold, Fae-Cursed King (Edge of Eternities Commander #120)" alt="Korvold, Fae-Cursed King (Edge of Eternities Commander #120)" src="https://cards.scryfall.io/grid/front/6/0/${KORVOLD}.webp?1752945155">`,
};
const scryfallImageDrop = {
  uriList: `https://cards.scryfall.io/display/front/6/0/${KORVOLD}.webp?1752945155`,
};
const edhrecDrop = {
  uriList: 'https://edhrec.com/cards/korvold-fae-cursed-king',
  text: 'https://edhrec.com/cards/korvold-fae-cursed-king',
  html: `<a class="piGH7G_container" href="https://edhrec.com/cards/korvold-fae-cursed-king"><img alt="" class="piGH7G_image" src="https://card-images.edhrec.com/grid/front/6/0/${KORVOLD}.webp?"><span class="piGH7G_name">Korvold, Fae-Cursed King</span></a>`,
};

let db: OpenDb;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  db = createTestDb();
  setDb(db);
  await loadBulkFile(db, FIXTURE, { bulkUpdatedAt: '2026-10-19T09:00:00.000Z' });
  fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.$client.close();
});

const korvoldOracle = () =>
  db.$client
    .prepare('SELECT oracle_id AS id FROM cards WHERE name = ?')
    .get('Korvold, Fae-Cursed King') as { id: string };

describe('dropClues', () => {
  it('reads the Scryfall id from the image, then the card page', () => {
    expect(dropClues(scryfallSearchDrop)).toEqual([
      { id: KORVOLD },
      { set: 'eoc', collector_number: '120' },
    ]);
  });

  it('reads a Scryfall card page image URL alone', () => {
    expect(dropClues(scryfallImageDrop)).toEqual([{ id: KORVOLD }]);
  });

  it('reads EDHREC’s image id, then the card slug', () => {
    expect(dropClues(edhrecDrop)).toEqual([{ id: KORVOLD }, { slug: 'korvold-fae-cursed-king' }]);
    expect(dropClues({ uriList: 'https://edhrec.com/commanders/tymna-the-weaver' })).toEqual([
      { slug: 'tymna-the-weaver' },
    ]);
  });

  it('reads plain text as a card name, dropping a decklist quantity', () => {
    expect(dropClues({ text: '1x Sol Ring' })).toEqual([{ name: 'Sol Ring' }]);
    expect(dropClues({ text: ' Cultivate ' })).toEqual([{ name: 'Cultivate' }]);
    expect(dropClues({ text: 'one\ntwo' })).toEqual([]);
    expect(dropClues({ text: 'https://example.com/x' })).toEqual([]);
  });
});

describe('edhrecSlug', () => {
  it('writes names the way EDHREC’s URLs do', () => {
    expect(edhrecSlug('Korvold, Fae-Cursed King')).toBe('korvold-fae-cursed-king');
    expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe('atraxa-praetors-voice');
    expect(edhrecSlug('Lim-Dûl the Necromancer')).toBe('lim-dul-the-necromancer');
  });
});

describe('resolveDrop', () => {
  it('finds each kind of drop in the card data without asking Scryfall', async () => {
    const korvold = korvoldOracle().id;
    expect(await resolveDrop(db, scryfallSearchDrop)).toBe(korvold);
    expect(await resolveDrop(db, scryfallImageDrop)).toBe(korvold);
    expect(await resolveDrop(db, edhrecDrop)).toBe(korvold);
    expect(await resolveDrop(db, { uriList: 'https://scryfall.com/card/eoc/120/x' })).toBe(korvold);
    expect(
      await resolveDrop(db, { uriList: 'https://edhrec.com/cards/korvold-fae-cursed-king' }),
    ).toBe(korvold);
    expect(await resolveDrop(db, { text: 'korvold, fae-cursed king' })).toBe(korvold);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('matches a double-faced card’s EDHREC slug and name by its front face', async () => {
    const trio = await resolveDrop(db, { uriList: 'https://edhrec.com/cards/harmonized-trio' });
    expect(trio).toBeDefined();
    expect(await resolveDrop(db, { text: 'Harmonized Trio' })).toBe(trio);
  });

  it('asks Scryfall about a card the card data doesn’t know', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ object: 'list', not_found: [], data: [] }), { status: 200 }),
    );
    expect(await resolveDrop(db, { text: 'Not A Card' })).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.identifiers).toEqual([{ name: 'Not A Card' }]);
  });

  it('doesn’t ask Scryfall about a slug alone', async () => {
    expect(await resolveDrop(db, { uriList: 'https://edhrec.com/cards/no-such-card' })).toBe(
      undefined,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

describe('POST /api/decks/:id/slots/drop', () => {
  const newDeck = () =>
    String(
      createDeck(db, {
        name: 'Hearthhull',
        slots: [{ oracleId: HEARTHHULL_ORACLE, board: 'commander', quantity: 1 }],
      }),
    );
  const drop = (
    id: string,
    json: Parameters<(typeof api.decks)[':id']['slots']['drop']['$post']>[0]['json'],
  ) => api.decks[':id'].slots.drop.$post({ param: { id }, json });

  it('adds the dropped card to the board it was dropped on', async () => {
    const id = newDeck();
    const res = await drop(id, { board: 'maybe', ...edhrecDrop });
    expect(res.status).toBe(200);
    const slot = SlotRow.parse(await res.json());
    expect(slot).toMatchObject({ board: 'maybe', quantity: 1, hint: null });
    expect(slot.card.name).toBe('Korvold, Fae-Cursed King');
  });

  it('refuses a card already in the deck, on any board', async () => {
    const id = newDeck();
    await drop(id, { board: 'main', ...scryfallSearchDrop });
    const res = await drop(id, { board: 'maybe', ...scryfallImageDrop });
    expect(res.status).toBe(409);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'card_in_deck',
      message: 'Korvold, Fae-Cursed King is already in this deck.',
    });

    const commander = await drop(id, { board: 'main', text: 'Hearthhull, the Worldseed' });
    expect(commander.status).toBe(409);
  });

  it('adds one more of a basic land or a card a deck can hold any number of', async () => {
    const id = newDeck();
    await drop(id, { board: 'main', text: 'Forest' });
    const forest = SlotRow.parse(await (await drop(id, { board: 'main', text: 'Forest' })).json());
    expect(forest.quantity).toBe(2);
    await drop(id, { board: 'main', text: 'Relentless Rats' });
    const rats = await drop(id, { board: 'main', text: 'Relentless Rats' });
    expect(SlotRow.parse(await rats.json()).quantity).toBe(2);
  });

  it('says so when the drop isn’t a card', async () => {
    const id = newDeck();
    const res = await drop(id, { board: 'main', uriList: 'https://example.com/' });
    expect(res.status).toBe(422);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('card_not_recognized');
  });

  it('says so when Scryfall is needed but can’t be reached', async () => {
    const id = newDeck();
    const res = await drop(id, { board: 'main', text: 'Sol Ring' });
    expect(res.status).toBe(503);
    expect(ErrorBody.parse(await res.json()).error.message).toContain('Couldn’t reach Scryfall');
  });

  it('answers 404 for a deck that doesn’t exist', async () => {
    const res = await drop('99', { board: 'main', ...edhrecDrop });
    expect(res.status).toBe(404);
  });
});
