import { expect, type Page, test } from '@playwright/test';
import { moveResultSample } from '../../src/shared/api/samples/copies';
import {
  blackGreenNode,
  locationRef,
  locationTreeSample,
} from '../../src/shared/api/samples/locations';
import {
  cardCopiesEmptySample,
  cardCopiesSample,
  sampleStacks,
} from '../../src/shared/api/samples/stacks';
import type { CardCopies } from '../../src/shared/api/stacks';

// The card page's Copies section with GET /api/cards/:oracleId/copies mocked from the samples:
// Arcane Signet in the Hearthhull deck box, the Staples binder and (a proxy) the Atraxa deck box.

const arcaneSignet = '/cards/0bc7f093-bef0-4f1a-852c-4b75ebf54838';
const s = sampleStacks;

/** The samples plus a stack two levels down, to show a full path. */
const withNested: CardCopies = {
  rows: [
    ...cardCopiesSample.rows,
    { ...s.arcaneSignetInStaples, stackId: 199, location: locationRef(blackGreenNode) },
  ],
  counts: { owned: 4, proxies: 1, inDecks: 2, free: 2 },
};

async function mockApi(page: Page, copies: CardCopies) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/cards/*/copies', (route) => route.fulfill({ json: copies }));
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  const moves: unknown[] = [];
  await page.route('**/api/moves', (route) => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ json: moveResultSample });
  });
  return { moves };
}

const section = (page: Page) => page.getByRole('region', { name: 'Copies' });
const row = (page: Page, stackId: number) =>
  section(page).locator(`tr[data-stack-id="${stackId}"]`);

test('lists every copy stack with its full location path and tags', async ({ page }) => {
  await mockApi(page, withNested);
  await page.goto(arcaneSignet);

  await expect(section(page).locator('tbody tr[data-stack-id]')).toHaveCount(4);

  const inHearthhull = row(page, s.arcaneSignetInHearthhull.stackId);
  await expect(inHearthhull).toContainText('Hearthhull deck box');
  await expect(inHearthhull.getByRole('link', { name: 'In deck · Hearthhull' })).toBeVisible();
  await expect(inHearthhull).toContainText('EOC');
  await expect(inHearthhull).toContainText('Nonfoil');
  await expect(inHearthhull).toContainText('NM');

  const proxy = row(page, s.arcaneSignetProxyInAtraxa.stackId);
  await expect(proxy).toContainText('Proxy');
  await expect(proxy.getByRole('link', { name: /In deck · Atraxa/ })).toBeVisible();

  const inStaples = row(page, s.arcaneSignetInStaples.stackId);
  await expect(inStaples).toContainText('Staples binder');
  await expect(inStaples).not.toContainText('In deck');
  await expect(inStaples).not.toContainText('Proxy');

  await expect(row(page, 199)).toContainText('Long box › Black & Green');
});

test('shows the counts in the heading', async ({ page }) => {
  await mockApi(page, cardCopiesSample);
  await page.goto(arcaneSignet);

  await expect(section(page).getByTestId('card-copies-counts')).toHaveText(
    '3 owned (1 proxy) · 2 in decks · 1 free',
  );
});

test('leaves the proxies out of the counts when there are none', async ({ page }) => {
  await mockApi(page, { ...cardCopiesSample, counts: { ...cardCopiesSample.counts, proxies: 0 } });
  await page.goto(arcaneSignet);

  await expect(section(page).getByTestId('card-copies-counts')).toHaveText(
    '3 owned · 2 in decks · 1 free',
  );
});

test('clicking a location opens it on the Locations screen', async ({ page }) => {
  await mockApi(page, withNested);
  await page.goto(arcaneSignet);

  await row(page, 199).getByRole('link', { name: 'Long box › Black & Green' }).click();
  await expect(page).toHaveURL(`/locations?selected=${blackGreenNode.id}`);
});

test('Move to opens with the selected stack and moves part of it', async ({ page }) => {
  const twoInStaples = { ...s.arcaneSignetInStaples, quantity: 2 };
  const { moves } = await mockApi(page, {
    rows: [s.arcaneSignetInHearthhull, twoInStaples],
    counts: { owned: 3, proxies: 0, inDecks: 1, free: 2 },
  });
  await page.goto(arcaneSignet);

  await row(page, twoInStaples.stackId).getByRole('checkbox').check();
  await section(page)
    .getByRole('toolbar', { name: 'Selected cards' })
    .getByRole('button', { name: 'Move to' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Move to' });
  await expect(dialog).toContainText('2 copies of Arcane Signet in Staples binder');
  await expect(dialog.getByLabel('Quantity')).toHaveValue('2');

  await dialog.getByLabel('Quantity').fill('1');
  await dialog.getByRole('combobox', { name: 'Destination' }).click();
  await page.getByRole('option', { name: /Rares binder/ }).click();
  await dialog.getByRole('button', { name: 'Move' }).click();

  await expect(dialog).toBeHidden();
  expect(moves).toEqual([
    { moves: [{ stackId: twoInStaples.stackId, quantity: 1 }], toLocationId: 6 },
  ]);
});

test('says so when Jeff owns no copies and offers to add some', async ({ page }) => {
  await mockApi(page, cardCopiesEmptySample);
  await page.goto(arcaneSignet);

  await expect(section(page)).toContainText('No copies yet');
  await expect(section(page).locator('table')).toHaveCount(0);
  await expect(section(page).getByTestId('card-copies-counts')).toHaveCount(0);
  await section(page).getByRole('button', { name: 'Add copies' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
