import { expect, type Page, type Request, test } from '@playwright/test';
import type { CardSearchResponse } from '../../src/shared/api/cards';
import type { DeckView } from '../../src/shared/api/decks';
import { emberSearch, legendSearch } from '../../src/shared/api/samples/cards';
import { cards } from '../../src/shared/api/samples/deck-cards';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import {
  deckViewSample,
  jinxBurn,
  newDeckSample,
  slotSample,
} from '../../src/shared/api/samples/decks';

// Building a deck in the app, with the API mocked from the samples: /decks/new, and the
// deck view's Edit mode on the Jinx Burn deck (id 1).

const SEARCH = /\/api\/cards\?/;

const dariusAggroSearch: CardSearchResponse = {
  results: [{ ...cards.dariusHandOfNoxus, owned: 1, free: 1 }],
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
  test('the Legend search asks only for legends, and Create sends the deck', async ({ page }) => {
    const searches = await mockSearch(page, legendSearch);
    const newDeckView: DeckView = {
      deck: newDeckSample,
      slots: [],
      boards: { legend: 0, champion: 0, main: 0, battlefield: 0, rune: 0, sideboard: 0, maybe: 0 },
    };
    await page.route('**/api/decks/7', (route) => route.fulfill({ json: newDeckView }));
    const created = await capture(page, 'POST', '/api/decks', newDeckSample, 201);

    await page.goto('/decks/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New deck');
    const create = page.getByRole('button', { name: 'Create' });
    await expect(create).toBeDisabled();

    await page.getByLabel('Legend', { exact: true }).fill('jinx');
    await page
      .getByRole('list', { name: 'Legend results' })
      .getByRole('button', { name: 'Jinx, Loose Cannon' })
      .click();
    expect(searches.at(-1)?.get('q')).toBe('jinx');
    expect(searches.at(-1)?.get('type')).toBe('legend');
    expect(searches.at(-1)?.has('domains')).toBe(false);

    await expect(page.getByRole('region', { name: 'Legend' })).toContainText('Jinx, Loose Cannon');
    await expect(page.getByLabel('Deck name', { exact: true })).toHaveValue('Jinx, Loose Cannon');

    await page.getByLabel('Deck name', { exact: true }).fill('Jinx Burn');
    await create.click();
    await expect(page).toHaveURL(/\/decks\/7$/);
    expect(created.map((request) => request.postDataJSON())).toEqual([
      { name: 'Jinx Burn', legendId: cards.jinxLooseCannon.id },
    ]);
  });
});

test.describe('Editing on the deck view', () => {
  test('the main deck search is limited to the deck domains and adds to the main deck', async ({
    page,
  }) => {
    const searches = await mockSearch(page, emberSearch);
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);

    await page.goto('/decks/1');
    await expect(page.getByRole('region', { name: 'Edit deck' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Sun Disc' })).toHaveCount(0);
    await expect(page.getByLabel('Add to main deck')).toHaveCount(0);

    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    await edit.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    const main = page.getByRole('region', { name: 'Main deck' });
    await main.getByLabel('Add to main deck', { exact: true }).fill('ember');
    await main.getByRole('button', { name: 'Ember Signet', exact: true }).click();

    expect(searches.at(-1)?.get('q')).toBe('ember');
    expect(searches.at(-1)?.get('domains')).toBe(jinxBurn.domains.join(','));
    expect(searches.at(-1)?.get('deckable')).toBe('1');
    expect(searches.at(-1)?.has('type')).toBe(false);
    await expect(main.getByRole('status')).toHaveText('Added Ember Signet to the main deck.');
    expect(added.map((request) => request.postDataJSON())).toEqual([
      { cardId: cards.emberSignet.id, board: 'main', quantity: 1 },
    ]);

    await page.getByRole('button', { name: 'Done editing' }).click();
    await expect(page.getByRole('region', { name: 'Edit deck' })).toBeHidden();
    await expect(page.getByLabel('Add to main deck')).toHaveCount(0);
  });

  test('the battlefield search asks only for battlefields and adds to the battlefields', async ({
    page,
  }) => {
    const searches = await mockSearch(page, {
      results: [{ ...cards.targonsPeak, owned: 1, free: 1 }],
    });
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const battlefields = page.getByRole('region', { name: 'Battlefields' });
    await battlefields.getByLabel('Add battlefield', { exact: true }).fill('targon');
    await battlefields.getByRole('button', { name: cards.targonsPeak.name }).click();

    expect(searches.at(-1)?.get('type')).toBe('battlefield');
    expect(searches.at(-1)?.has('domains')).toBe(false);
    await expect(battlefields.getByRole('status')).toHaveText(
      `Added ${cards.targonsPeak.name} to the battlefields.`,
    );
    expect(added.map((request) => request.postDataJSON())).toEqual([
      { cardId: cards.targonsPeak.id, board: 'battlefield', quantity: 1 },
    ]);
  });

  test('editing shows the sideboard and maybe board with searches of their own', async ({
    page,
  }) => {
    const searches = await mockSearch(page, emberSearch);
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);
    await page.goto('/decks/1');
    await expect(page.getByRole('region', { name: 'Sideboard', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    const sideboard = page.getByRole('region', { name: 'Sideboard', exact: true });
    await sideboard.getByLabel('Add to sideboard', { exact: true }).fill('ember');
    await sideboard.getByRole('button', { name: 'Ember Signet', exact: true }).click();
    expect(searches.at(-1)?.get('domains')).toBe(jinxBurn.domains.join(','));
    await expect.poll(() => added.length).toBe(1);
    expect(added[0]?.postDataJSON()).toEqual({
      cardId: cards.emberSignet.id,
      board: 'sideboard',
      quantity: 1,
    });
    await expect(
      page
        .getByRole('region', { name: 'Maybe board', exact: true })
        .getByLabel('Add to maybe board'),
    ).toBeVisible();
  });

  test('the row menu changes the quantity, moves the board and removes the slot', async ({
    page,
  }) => {
    const changes = await capture(page, 'PATCH', '/api/decks/1/slots/114', slotSample);
    const toMain = await capture(page, 'PATCH', '/api/decks/1/slots/187', slotSample);
    const removed = await capture(page, 'DELETE', '/api/decks/1/slots/114');
    const battlefieldRemoved = await capture(page, 'DELETE', '/api/decks/1/slots/117');

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    await page.getByRole('button', { name: 'Edit Sun Disc' }).click();
    await page.getByRole('menuitem', { name: 'Change quantity' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change quantity' });
    await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('1');
    await dialog.getByLabel('Quantity', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Edit Sun Disc' }).click();
    await page.getByRole('menuitem', { name: 'Move to sideboard' }).click();
    await expect.poll(() => changes.length).toBe(2);

    await page.getByRole('button', { name: 'Edit Ivory Reaver' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move to maybe board' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move to main deck' }).click();
    await expect.poll(() => toMain.length).toBe(1);

    await page.getByRole('button', { name: 'Edit Sun Disc' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect.poll(() => removed.length).toBe(1);

    // A battlefield can only be removed.
    await page.getByRole('button', { name: 'Edit Grim Steppe' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Remove']);
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect.poll(() => battlefieldRemoved.length).toBe(1);

    expect(changes.map((request) => request.postDataJSON())).toEqual([
      { quantity: 3 },
      { board: 'sideboard' },
    ]);
    expect(toMain[0]?.postDataJSON()).toEqual({ board: 'main' });
  });

  test('Replace… on the Legend searches only legends and saves the new Legend', async ({
    page,
  }) => {
    const searches = await mockSearch(page, dariusAggroSearch);
    const puts = await capture(page, 'PUT', '/api/decks/1/legend', deckViewSample);

    await page.goto('/decks/1');
    await expect(page.getByRole('button', { name: 'Replace the Legend' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Jinx, Loose Cannon' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Replace the Legend' }).click();
    const dialog = page.getByRole('dialog', { name: 'Replace legend' });
    await dialog.getByLabel('Legend', { exact: true }).fill('darius');
    await dialog.getByRole('button', { name: 'Darius, Hand of Noxus' }).click();
    await expect(dialog).toBeHidden();
    expect(searches.at(-1)?.get('type')).toBe('legend');

    expect(puts.map((request) => request.postDataJSON())).toEqual([
      { legendId: cards.dariusHandOfNoxus.id },
    ]);
  });

  test('Pick… on the champion searches the Legend’s champion units and adds the champion', async ({
    page,
  }) => {
    const searches = await mockSearch(page, {
      results: [{ ...cards.jinxRebel, owned: 1, free: 1 }],
    });
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Pick a Chosen Champion' }).click();
    const dialog = page.getByRole('dialog', { name: 'Pick a Chosen Champion' });
    await dialog.getByLabel('Chosen Champion', { exact: true }).fill('jinx');
    await dialog.getByRole('button', { name: 'Jinx, Rebel' }).click();
    await expect(dialog).toBeHidden();

    expect(searches.at(-1)?.get('type')).toBe('unit');
    expect(searches.at(-1)?.get('supertype')).toBe('champion');
    expect(searches.at(-1)?.get('championTag')).toBe('Jinx');
    expect(added.map((request) => request.postDataJSON())).toEqual([
      { cardId: cards.jinxRebel.id, board: 'champion', quantity: 1 },
    ]);
  });

  test('Replace… on the champion adds the new one, then takes the old one out', async ({
    page,
  }) => {
    const view = structuredClone(deckViewSample);
    view.slots.splice(1, 0, {
      ...structuredClone(slotSample),
      id: 190,
      card: cards.jinxRebel,
      board: 'champion',
      tags: [],
    });
    view.deck = { ...view.deck, champion: cards.jinxRebel };
    await page.route('**/api/decks/1', (route) => route.fulfill({ json: view }));
    await mockSearch(page, { results: [{ ...cards.viOutlaw, owned: 1, free: 1 }] });
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);
    const removed = await capture(page, 'DELETE', '/api/decks/1/slots/190');

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Replace the Chosen Champion' }).click();
    const dialog = page.getByRole('dialog', { name: 'Replace Chosen Champion' });
    await dialog.getByLabel('Chosen Champion', { exact: true }).fill('vi');
    await dialog.getByRole('button', { name: cards.viOutlaw.name }).click();
    await expect(dialog).toBeHidden();
    expect(added.map((request) => request.postDataJSON())).toEqual([
      { cardId: cards.viOutlaw.id, board: 'champion', quantity: 1 },
    ]);
    expect(removed).toHaveLength(1);
  });
});
