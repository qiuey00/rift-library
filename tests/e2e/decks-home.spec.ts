import { expect, type Page, test } from '@playwright/test';
import type { DeckList } from '../../src/shared/api/decks';
import { deckListSample } from '../../src/shared/api/samples/decks';
import { locationTreeSample } from '../../src/shared/api/samples/locations';

async function mockDecks(page: Page, list: DeckList, locationNodes: unknown[] = []) {
  // Card images come from Scryfall; tests never reach the network.
  await page.route('https://cards.scryfall.io/**', (route) => route.abort());
  await page.route('**/api/decks', (route) => route.fulfill({ json: list }));
  await page.route('**/api/locations/tree', (route) =>
    route.fulfill({ json: { nodes: locationNodes } }),
  );
}

const tiles = (page: Page) => page.getByTestId('deck-tile');
const names = deckListSample.decks.map((d) => d.name);

test('a tile per deck, in the server order, with pills and bars', async ({ page }) => {
  await mockDecks(page, deckListSample);
  await page.goto('/');

  await expect(tiles(page)).toHaveCount(6);
  await expect(tiles(page).getByRole('heading', { level: 2 })).toHaveText(names);
  await expect(tiles(page).locator('[data-state]')).toHaveText([
    'Partly assembled',
    'Assembled',
    'Assembled',
    'Assembled',
    'Not assembled',
    'Not assembled',
  ]);

  const hearthhull = tiles(page).first();
  await expect(hearthhull.getByRole('img', { name: 'Hearthhull, the Worldseed' })).toBeVisible();
  await expect(
    hearthhull.getByRole('img', {
      name: '58 in deck box, 13 free, 4 in other deck, 3 missing',
    }),
  ).toBeVisible();
  await expect(hearthhull.getByText('Colors: black, red, green')).toBeAttached();
  await expect(hearthhull.locator('.ms')).toHaveCount(3);

  // Two partners show both commanders.
  const partners = tiles(page).last();
  await expect(partners.locator('img')).toHaveCount(2);

  await hearthhull.click();
  await expect(page).toHaveURL(`/decks/${deckListSample.decks[0].id}`);
});

test('the table shows the same decks and the choice is remembered', async ({ page }) => {
  await mockDecks(page, deckListSample);
  await page.goto('/');
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tiles(page)).toHaveCount(0);

  const rows = page.getByRole('row');
  await expect(rows).toHaveCount(7);
  await expect(rows.first().getByRole('columnheader')).toHaveText([
    'Name',
    'Commander',
    'Colors',
    'State',
    'In box',
    'Free',
    'In other decks',
    'Missing',
    'Last opened',
  ]);
  const body = page.locator('tbody tr');
  await expect(body.locator('td:first-child')).toHaveText(names);
  await expect(body.first().locator('td')).toContainText([
    'Hearthhull',
    'Hearthhull, the Worldseed',
    'Colors: black, red, green',
    'Partly assembled',
    '58',
    '13',
    '4',
    '3',
  ]);
  await expect(body.last().locator('td').nth(1)).toHaveText(
    deckListSample.decks[5].commanders.map((c) => c.name).join(' and '),
  );

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Tiles' }).click();
  await page.reload();
  await expect(tiles(page)).toHaveCount(6);
});

test('New deck opens a menu of the two ways to make one', async ({ page }) => {
  await mockDecks(page, deckListSample);
  await page.goto('/');
  await page.getByRole('button', { name: 'New deck' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Import from Moxfield', 'Build in the app']);
  await expect(menu.getByRole('menuitem', { name: 'Import from Moxfield' })).toHaveAttribute(
    'href',
    '/import/moxfield',
  );
  await menu.getByRole('menuitem', { name: 'Build in the app' }).click();
  await expect(page).toHaveURL('/decks/new');
});

test('with no locations and no decks, it shows the two ways to start', async ({ page }) => {
  await mockDecks(page, { decks: [] });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Start with where your cards live' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a location' })).toHaveAttribute(
    'href',
    '/locations',
  );
  await expect(page.getByRole('button', { name: 'Import ManaBox CSV' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Paste a Moxfield list' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New deck' })).toHaveCount(0);
});

test('with locations but no decks, it also offers a Moxfield list', async ({ page }) => {
  await mockDecks(page, { decks: [] }, locationTreeSample.nodes);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No decks yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Paste a Moxfield list' })).toHaveAttribute(
    'href',
    '/import/moxfield',
  );
  await expect(page.getByRole('link', { name: 'Create a location' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import ManaBox CSV' })).toBeVisible();
});
