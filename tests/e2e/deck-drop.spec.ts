import { expect, type Locator, type Page, type Request, test } from '@playwright/test';
import type { CardDrop } from '../../src/shared/api/decks';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import { deckViewSample, slotSample } from '../../src/shared/api/samples/decks';

// Dragging a card in from scryfall.com or edhrec.com onto the deck view, with the API mocked
// from the samples: the Hearthhull deck (id 1). The drops carry what Chromium sends when
// dragging from those sites.

const edhrecDrop = {
  'text/uri-list': 'https://edhrec.com/cards/sol-ring',
  'text/plain': 'https://edhrec.com/cards/sol-ring',
  'text/html':
    '<a href="https://edhrec.com/cards/sol-ring"><img src="https://card-images.edhrec.com/grid/front/4/c/4cbc6901-6a4a-4d0a-83ea-7eefa3b35021.webp?"><span>Sol Ring</span></a>',
};

const DROP = '**/api/decks/1/slots/drop';

async function mockDeck(page: Page, view = deckViewSample) {
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/1', (route) => route.fulfill({ json: view }));
  await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
}

/** Keeps each drop sent, answering with `json` and `status`. */
async function mockDrop(page: Page, json: unknown, status = 200) {
  const sent: Request[] = [];
  await page.route(DROP, (route) => {
    sent.push(route.request());
    return route.fulfill({ status, json });
  });
  return sent;
}

/** Starts a drag from outside the window carrying `data`, and moves it over `target`. */
async function dragOver(page: Page, target: Locator, data: Record<string, string>) {
  const dataTransfer = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    return transfer;
  }, data);
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  return dataTransfer;
}

async function dropOn(page: Page, target: Locator, data: Record<string, string>) {
  const dataTransfer = await dragOver(page, target, data);
  await target.dispatchEvent('drop', { dataTransfer });
}

const decklist = (page: Page) => page.getByRole('region', { name: 'Decklist' });
const maybeBoard = (page: Page) => page.getByRole('region', { name: 'Maybe board' });

test('dropping a card on the decklist adds it to the main board', async ({ page }) => {
  await mockDeck(page);
  const sent = await mockDrop(page, slotSample);
  await page.goto('/decks/1');
  await expect(decklist(page)).toBeVisible();

  await dragOver(page, decklist(page), edhrecDrop);
  await expect(decklist(page)).toContainText('Drop to add to the main board');
  await expect(maybeBoard(page)).toContainText('Drop to add to the maybe board');

  const reload = page.waitForRequest('**/api/decks/1');
  await dropOn(page, decklist(page), edhrecDrop);
  await reload;
  expect(sent).toHaveLength(1);
  expect(sent[0].postDataJSON() as CardDrop).toEqual({
    board: 'main',
    uriList: edhrecDrop['text/uri-list'],
    html: edhrecDrop['text/html'],
    text: edhrecDrop['text/plain'],
  });
  await expect(page.getByText('Added Sol Ring to the main board.')).toBeVisible();
  await expect(decklist(page)).not.toContainText('Drop to add');
});

test('dropping on the maybe board adds it there', async ({ page }) => {
  await mockDeck(page);
  const sent = await mockDrop(page, { ...slotSample, board: 'maybe', status: null });
  await page.goto('/decks/1');
  await dropOn(page, maybeBoard(page), {
    'text/uri-list': 'https://scryfall.com/card/c21/263/sol-ring',
  });
  await expect(page.getByText('Added Sol Ring to the maybe board.')).toBeVisible();
  expect((sent[0].postDataJSON() as CardDrop).board).toBe('maybe');
});

test('a deck with no maybe board shows one to drop on during the drag only', async ({ page }) => {
  await mockDeck(page, {
    ...deckViewSample,
    slots: deckViewSample.slots.filter((slot) => slot.board !== 'maybe'),
  });
  const sent = await mockDrop(page, { ...slotSample, board: 'maybe', status: null });
  await page.goto('/decks/1');
  await expect(decklist(page)).toBeVisible();
  await expect(maybeBoard(page)).toHaveCount(0);

  await dragOver(page, decklist(page), edhrecDrop);
  await expect(maybeBoard(page)).toContainText('Drop to add to the maybe board');
  await dropOn(page, maybeBoard(page), edhrecDrop);
  await expect(page.getByText('Added Sol Ring to the maybe board.')).toBeVisible();
  expect((sent[0].postDataJSON() as CardDrop).board).toBe('maybe');
});

test('a card already in the deck or not a card shows the server’s message', async ({ page }) => {
  await mockDeck(page);
  await mockDrop(
    page,
    { error: { code: 'card_in_deck', message: 'Sol Ring is already in this deck.' } },
    409,
  );
  await page.goto('/decks/1');
  await dropOn(page, decklist(page), edhrecDrop);
  await expect(page.getByText('Sol Ring is already in this deck.')).toBeVisible();
});

test('files dragged over the deck are not taken', async ({ page }) => {
  await mockDeck(page);
  await page.goto('/decks/1');
  await expect(decklist(page)).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'deck.txt', { type: 'text/csv' }));
    return transfer;
  });
  await decklist(page).dispatchEvent('dragenter', { dataTransfer });
  await expect(decklist(page)).not.toContainText('Drop to add');
});
