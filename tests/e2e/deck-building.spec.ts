import { expect, type Page, type Request, test } from '@playwright/test';
import type { CardSearchResponse } from '../../src/shared/api/cards';
import type { DeckView } from '../../src/shared/api/decks';
import { arcaneSearch, commanderSearch } from '../../src/shared/api/samples/cards';
import { cards } from '../../src/shared/api/samples/deck-cards';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import {
  deckViewSample,
  hearthhull,
  newDeckSample,
  slotSample,
} from '../../src/shared/api/samples/decks';

// Building a deck in the app, with the API mocked from the samples: /decks/new, and the
// deck view's Edit mode on the Hearthhull deck (id 1).

const SEARCH = /\/api\/cards\/search\?/;

const korvoldSearch: CardSearchResponse = {
  results: [{ ...cards.korvoldFaeCursedKing, owned: 1, free: 1 }],
};

/** Answers every card search with `answer`, and keeps each search's query. */
async function mockSearch(page: Page, answer: CardSearchResponse) {
  const searches: URLSearchParams[] = [];
  await page.route(SEARCH, (route) => {
    searches.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: answer });
  });
  return searches;
}

/** Keeps every request whose method and path match, answering with `json` (or 204 with none). */
async function capture(page: Page, method: string, path: string, json?: unknown, status = 200) {
  const sent: Request[] = [];
  await page.route(`**${path}`, (route) => {
    if (route.request().method() !== method) return route.fallback();
    sent.push(route.request());
    return json === undefined ? route.fulfill({ status: 204 }) : route.fulfill({ status, json });
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/*/checks', (route) => route.fulfill({ json: deckChecksSample }));
  await page.route('**/api/decks/1', (route) => route.fulfill({ json: deckViewSample }));
});

test.describe('New deck', () => {
  test('the commander search asks only for commanders, and Create sends the deck', async ({
    page,
  }) => {
    const searches = await mockSearch(page, commanderSearch);
    const newDeckView: DeckView = { deck: newDeckSample, slots: [] };
    await page.route('**/api/decks/7', (route) => route.fulfill({ json: newDeckView }));
    const created = await capture(page, 'POST', '/api/decks', newDeckSample, 201);

    await page.goto('/decks/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New deck');
    const create = page.getByRole('button', { name: 'Create' });
    await expect(create).toBeDisabled();

    await page.getByLabel('Commander', { exact: true }).fill('hearthhull');
    await page
      .getByRole('list', { name: 'Commander results' })
      .getByRole('button', { name: 'Hearthhull, the Worldseed' })
      .click();
    expect(searches.at(-1)?.get('q')).toBe('hearthhull');
    expect(searches.at(-1)?.get('commander')).toBe('1');
    expect(searches.at(-1)?.has('identity')).toBe(false);

    await expect(page.getByRole('region', { name: 'Commander' })).toContainText(
      'Hearthhull, the Worldseed',
    );
    await expect(page.getByLabel('Deck name', { exact: true })).toHaveValue(
      'Hearthhull, the Worldseed',
    );

    await page.getByLabel('Deck name', { exact: true }).fill('Worldseed Lands');
    await create.click();
    await expect(page).toHaveURL(/\/decks\/7$/);
    expect(created.map((request) => request.postDataJSON())).toEqual([
      { name: 'Worldseed Lands', commanders: [cards.hearthhullTheWorldseed.oracleId] },
    ]);
  });

  test('a partner is searched the same way and names the deck with both', async ({ page }) => {
    const searches = await mockSearch(page, commanderSearch);
    const created = await capture(page, 'POST', '/api/decks', newDeckSample, 201);
    await page.route('**/api/decks/7', (route) =>
      route.fulfill({ json: { deck: newDeckSample, slots: [] } }),
    );

    await page.goto('/decks/new');
    await page.getByLabel('Commander', { exact: true }).fill('hearthhull');
    await page.getByRole('button', { name: 'Hearthhull, the Worldseed' }).click();

    await page.unroute(SEARCH);
    const partnerSearches = await mockSearch(page, korvoldSearch);
    await page.getByLabel('Partner (optional)', { exact: true }).fill('korvold');
    await page.getByRole('button', { name: 'Korvold, Fae-Cursed King' }).click();
    expect(partnerSearches.at(-1)?.get('commander')).toBe('1');
    expect(searches.length).toBeGreaterThan(0);

    await expect(page.getByLabel('Deck name', { exact: true })).toHaveValue(
      'Hearthhull, the Worldseed & Korvold, Fae-Cursed King',
    );
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/decks\/7$/);
    expect(created[0]?.postDataJSON()).toEqual({
      name: 'Hearthhull, the Worldseed & Korvold, Fae-Cursed King',
      commanders: [cards.hearthhullTheWorldseed.oracleId, cards.korvoldFaeCursedKing.oracleId],
    });
  });
});

test.describe('Editing on the deck view', () => {
  test('Edit shows the Add card search, filtered to the deck colors', async ({ page }) => {
    const searches = await mockSearch(page, arcaneSearch);
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);

    await page.goto('/decks/1');
    await expect(page.getByRole('region', { name: 'Edit deck' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Sol Ring' })).toHaveCount(0);

    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    await edit.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    const panel = page.getByRole('region', { name: 'Edit deck' });
    await panel.getByLabel('Add card', { exact: true }).fill('arcane');
    await panel.getByRole('button', { name: 'Arcane Signet' }).click();

    expect(searches.at(-1)?.get('q')).toBe('arcane');
    expect(searches.at(-1)?.get('identity')).toBe(hearthhull.colorIdentity);
    expect(searches.at(-1)?.has('commander')).toBe(false);
    await expect(panel.getByRole('status')).toHaveText('Added Arcane Signet to the main board.');
    expect(added.map((request) => request.postDataJSON())).toEqual([
      { oracleId: cards.arcaneSignet.oracleId, board: 'main', quantity: 1 },
    ]);

    await panel.getByRole('button', { name: 'Done editing' }).click();
    await expect(panel).toBeHidden();
  });

  test('the row menu changes the quantity, moves the board and removes the slot', async ({
    page,
  }) => {
    const changes = await capture(page, 'PATCH', '/api/decks/1/slots/114', slotSample);
    const toMain = await capture(page, 'PATCH', '/api/decks/1/slots/187', slotSample);
    const removed = await capture(page, 'DELETE', '/api/decks/1/slots/114');

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    await page.getByRole('button', { name: 'Edit Sol Ring' }).click();
    await page.getByRole('menuitem', { name: 'Change quantity' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change quantity' });
    await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('1');
    await dialog.getByLabel('Quantity', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Edit Sol Ring' }).click();
    await page.getByRole('menuitem', { name: 'Move to maybe board' }).click();
    await expect.poll(() => changes.length).toBe(2);

    await page.getByRole('button', { name: 'Edit Loamcrafter Faun' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move to maybe board' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move to main board' }).click();
    await expect.poll(() => toMain.length).toBe(1);

    await page.getByRole('button', { name: 'Edit Sol Ring' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect.poll(() => removed.length).toBe(1);

    expect(changes.map((request) => request.postDataJSON())).toEqual([
      { quantity: 3 },
      { board: 'maybe' },
    ]);
    expect(toMain[0]?.postDataJSON()).toEqual({ board: 'main' });
  });

  test('the commander menu changes the commander and adds or removes a partner', async ({
    page,
  }) => {
    const searches = await mockSearch(page, korvoldSearch);
    const puts = await capture(page, 'PUT', '/api/decks/1/commanders', deckViewSample);
    const hearthhullId = cards.hearthhullTheWorldseed.oracleId;
    const korvoldId = cards.korvoldFaeCursedKing.oracleId;

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    const commanderMenu = page.getByRole('button', { name: 'Edit Hearthhull, the Worldseed' });
    await commanderMenu.click();
    await expect(page.getByRole('menuitem', { name: 'Change quantity' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Change commander' }).click();
    let dialog = page.getByRole('dialog', { name: 'Change commander' });
    await dialog.getByLabel('Commander', { exact: true }).fill('korvold');
    await dialog.getByRole('button', { name: 'Korvold, Fae-Cursed King' }).click();
    await expect(dialog).toBeHidden();
    expect(searches.at(-1)?.get('commander')).toBe('1');

    await commanderMenu.click();
    await page.getByRole('menuitem', { name: 'Add a partner' }).click();
    dialog = page.getByRole('dialog', { name: 'Add a partner' });
    await dialog.getByLabel('Commander', { exact: true }).fill('korvold');
    await dialog.getByRole('button', { name: 'Korvold, Fae-Cursed King' }).click();
    await expect(dialog).toBeHidden();

    expect(puts.map((request) => request.postDataJSON())).toEqual([
      { oracleIds: [korvoldId] },
      { oracleIds: [hearthhullId, korvoldId] },
    ]);
  });

  test('a deck with two commanders offers Remove partner', async ({ page }) => {
    const partners: DeckView = {
      ...deckViewSample,
      deck: { ...hearthhull, commanders: [cards.hearthhullTheWorldseed, cards.tymnaTheWeaver] },
    };
    await page.route('**/api/decks/1', (route) => route.fulfill({ json: partners }));
    const puts = await capture(page, 'PUT', '/api/decks/1/commanders', deckViewSample);

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Hearthhull, the Worldseed' }).click();
    await expect(page.getByRole('menuitem', { name: 'Add a partner' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Remove this partner' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]?.postDataJSON()).toEqual({ oracleIds: [cards.tymnaTheWeaver.oracleId] });
  });
});
