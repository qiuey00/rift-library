import { expect, type Page, type Request, test } from '@playwright/test';
import type { CardSearchResponse } from '../../src/shared/api/cards';
import type { DeckView } from '../../src/shared/api/decks';
import { championSearch, emberSearch, legendSearch } from '../../src/shared/api/samples/cards';
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
  const newDeckView: DeckView = {
    deck: newDeckSample,
    slots: [],
    boards: { legend: 0, champion: 0, main: 0, battlefield: 0, rune: 0, sideboard: 0, maybe: 0 },
  };

  /** Answers Legend searches with the Jinx Legend and every other search with Jinx, Rebel. */
  async function mockNewDeckSearch(page: Page) {
    const searches: URLSearchParams[] = [];
    await page.route(SEARCH, (route) => {
      const query = new URL(route.request().url()).searchParams;
      searches.push(query);
      return route.fulfill({
        json: query.get('type') === 'legend' ? legendSearch : championSearch,
      });
    });
    return searches;
  }

  test('Legend, then Chosen Champion filtered to its tag, then a name, then Create', async ({
    page,
  }) => {
    const searches = await mockNewDeckSearch(page);
    await page.route('**/api/decks/7', (route) => route.fulfill({ json: newDeckView }));
    const created = await capture(page, 'POST', '/api/decks', newDeckSample, 201);

    await page.goto('/decks/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New deck');
    const create = page.getByRole('button', { name: 'Create' });
    await expect(create).toBeDisabled();
    await expect(page.getByLabel('Chosen Champion', { exact: true })).toHaveCount(0);

    await page.getByLabel('Legend', { exact: true }).fill('jinx');
    await page
      .getByRole('list', { name: 'Legend results' })
      .getByRole('button', { name: 'Jinx, Loose Cannon' })
      .click();
    expect(searches.at(-1)?.get('q')).toBe('jinx');
    expect(searches.at(-1)?.get('type')).toBe('legend');
    expect(searches.at(-1)?.has('domains')).toBe(false);
    expect(searches.at(-1)?.has('championTag')).toBe(false);

    const legend = page.getByRole('region', { name: 'Legend' });
    await expect(legend).toContainText('Jinx, Loose Cannon');
    await expect(legend.getByRole('img', { name: 'Fury' })).toBeVisible();
    await expect(legend.getByRole('img', { name: 'Chaos' })).toBeVisible();
    await expect(page.getByLabel('Deck name', { exact: true })).toHaveValue('Jinx, Loose Cannon');

    const championField = page.getByLabel('Chosen Champion', { exact: true });
    await expect(championField).toBeFocused();
    await championField.fill('jinx');
    await page
      .getByRole('list', { name: 'Chosen Champion results' })
      .getByRole('button', { name: 'Jinx, Rebel' })
      .click();
    expect(searches.at(-1)?.get('q')).toBe('jinx');
    expect(searches.at(-1)?.get('type')).toBe('unit');
    expect(searches.at(-1)?.get('supertype')).toBe('champion');
    expect(searches.at(-1)?.get('championTag')).toBe('Jinx');
    await expect(page.getByRole('region', { name: 'Chosen Champion' })).toContainText(
      'Jinx, Rebel',
    );

    await page.getByLabel('Deck name', { exact: true }).fill('Jinx Burn');
    await create.click();
    await expect(page).toHaveURL(/\/decks\/7$/);
    expect(created.map((request) => request.postDataJSON())).toEqual([
      {
        name: 'Jinx Burn',
        legendId: cards.jinxLooseCannon.id,
        championId: championSearch.results[0]?.id,
      },
    ]);
  });

  test('changing the Legend clears the Chosen Champion', async ({ page }) => {
    await mockNewDeckSearch(page);
    const created = await capture(page, 'POST', '/api/decks', newDeckSample, 201);
    await page.route('**/api/decks/7', (route) => route.fulfill({ json: newDeckView }));

    await page.goto('/decks/new');
    await page.getByLabel('Legend', { exact: true }).fill('jinx');
    await page.getByRole('button', { name: 'Jinx, Loose Cannon' }).click();
    await page.getByLabel('Chosen Champion', { exact: true }).fill('jinx');
    await page.getByRole('button', { name: 'Jinx, Rebel' }).click();

    await page.getByRole('button', { name: 'Remove Jinx, Loose Cannon' }).click();
    await expect(page.getByRole('region', { name: 'Chosen Champion' })).toHaveCount(0);
    await expect(page.getByLabel('Chosen Champion', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();

    // A deck can start without its Chosen Champion; the deck checks point it out.
    await page.getByLabel('Legend', { exact: true }).fill('jinx');
    await page.getByRole('button', { name: 'Jinx, Loose Cannon' }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/decks\/7$/);
    expect(created.map((request) => request.postDataJSON())).toEqual([
      { name: 'Jinx, Loose Cannon', legendId: cards.jinxLooseCannon.id },
    ]);
  });

  test('Paste a deck list is offered as the other way in', async ({ page }) => {
    await page.goto('/decks/new');
    await page.getByRole('button', { name: 'Paste a deck list' }).click();
    await expect(page.getByRole('dialog', { name: 'Paste a deck list' })).toBeVisible();
  });
});

test.describe('Editing on the deck view', () => {
  test('Edit shows the Add card search, filtered to the deck domains', async ({ page }) => {
    const searches = await mockSearch(page, emberSearch);
    const added = await capture(page, 'POST', '/api/decks/1/slots', slotSample);

    await page.goto('/decks/1');
    await expect(page.getByRole('region', { name: 'Edit deck' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Sun Disc' })).toHaveCount(0);

    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    await edit.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    const panel = page.getByRole('region', { name: 'Edit deck' });
    await panel.getByLabel('Add card', { exact: true }).fill('ember');
    await panel.getByRole('button', { name: 'Ember Signet' }).click();

    expect(searches.at(-1)?.get('q')).toBe('ember');
    expect(searches.at(-1)?.get('domains')).toBe(jinxBurn.domains.join(','));
    expect(searches.at(-1)?.has('type')).toBe(false);
    await expect(panel.getByRole('status')).toHaveText('Added Ember Signet to the main board.');
    expect(added.map((request) => request.postDataJSON())).toEqual([
      { cardId: cards.emberSignet.id, board: 'main', quantity: 1 },
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

    await page.getByRole('button', { name: 'Edit Sun Disc' }).click();
    await page.getByRole('menuitem', { name: 'Change quantity' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change quantity' });
    await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveValue('1');
    await dialog.getByLabel('Quantity', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Edit Sun Disc' }).click();
    await page.getByRole('menuitem', { name: 'Move to maybe board' }).click();
    await expect.poll(() => changes.length).toBe(2);

    await page.getByRole('button', { name: 'Edit Ivory Reaver' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move to maybe board' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move to main board' }).click();
    await expect.poll(() => toMain.length).toBe(1);

    await page.getByRole('button', { name: 'Edit Sun Disc' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect.poll(() => removed.length).toBe(1);

    expect(changes.map((request) => request.postDataJSON())).toEqual([
      { quantity: 3 },
      { board: 'maybe' },
    ]);
    expect(toMain[0]?.postDataJSON()).toEqual({ board: 'main' });
  });

  test('the Legend menu changes the Legend', async ({ page }) => {
    const searches = await mockSearch(page, dariusAggroSearch);
    const puts = await capture(page, 'PUT', '/api/decks/1/legend', deckViewSample);

    await page.goto('/decks/1');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    await page.getByRole('button', { name: 'Edit Jinx, Loose Cannon' }).click();
    await expect(page.getByRole('menuitem', { name: 'Change quantity' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Change legend' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change legend' });
    await dialog.getByLabel('Legend', { exact: true }).fill('darius');
    await dialog.getByRole('button', { name: 'Darius, Hand of Noxus' }).click();
    await expect(dialog).toBeHidden();
    expect(searches.at(-1)?.get('type')).toBe('legend');

    expect(puts.map((request) => request.postDataJSON())).toEqual([
      { legendId: cards.dariusHandOfNoxus.id },
    ]);
  });
});
