import { expect, type Page, test } from '@playwright/test';
import { inDeckErrorSample, removeCopiesResultSample } from '../../src/shared/api/samples/copies';
import { deckListSample } from '../../src/shared/api/samples/decks';
import { historyOlderDaySample } from '../../src/shared/api/samples/history';
import { locationTreeSample, raresBinderNode } from '../../src/shared/api/samples/locations';
import {
  cardCopiesSample,
  collectionValueSample,
  locationStacksSample,
  sampleStacks,
  stacksPageSample,
} from '../../src/shared/api/samples/stacks';

// Lowering or removing copies by hand (COL-13) from the Locations screen, the Collection and a
// card page, with the API mocked from the samples. The Rares binder holds three stacks and has
// a Jinx Burn foil out in the Jinx Burn deck box.

const s = sampleStacks;
const threeDuelists = { ...s.wildDuelistFoil, quantity: 3 };

async function mockApi(page: Page, { refuse = false }: { refuse?: boolean } = {}) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/decks', (route) => route.fulfill({ json: deckListSample }));
  await page.route('**/api/collection/value', (route) =>
    route.fulfill({ json: collectionValueSample }),
  );
  await page.route(
    (url) => /^\/api\/locations\/\d+\/stacks$/.test(url.pathname),
    (route) =>
      route.fulfill({
        json: {
          ...locationStacksSample,
          rows: [threeDuelists, ...locationStacksSample.rows.slice(1)],
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/stacks',
    (route) =>
      route.fulfill({
        json: { ...stacksPageSample, rows: [threeDuelists], nextCursor: null },
      }),
  );
  await page.route('**/api/cards/*/copies', (route) => route.fulfill({ json: cardCopiesSample }));
  const removals: unknown[] = [];
  await page.route('**/api/copies/remove', (route) => {
    removals.push(route.request().postDataJSON());
    return refuse
      ? route.fulfill({ status: 409, json: inDeckErrorSample })
      : route.fulfill({ json: removeCopiesResultSample });
  });
  return { removals };
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected cards' }).first();
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Lower or remove' });

test('lowers part of a stack on the Locations screen and offers Undo', async ({ page }) => {
  const { removals } = await mockApi(page);
  await page.goto(`/locations?selected=${raresBinderNode.id}`);

  await page.locator(`tr[data-stack-id="${threeDuelists.stackId}"]`).getByRole('checkbox').check();
  await toolbar(page).getByRole('button', { name: 'Lower or remove…' }).click();

  await expect(dialog(page)).toContainText('3 copies of Wild Duelist in Rares binder');
  // All of it by default.
  await expect(dialog(page).getByLabel('How many to remove')).toHaveValue('3');
  await dialog(page).getByLabel('How many to remove').fill('2');
  // Remove waits for a reason.
  await expect(dialog(page).getByRole('button', { name: 'Remove' })).toBeDisabled();
  await dialog(page).getByText('Sold', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Remove' }).click();

  await expect(dialog(page)).toBeHidden();
  expect(removals).toEqual([{ stackId: threeDuelists.stackId, quantity: 2, reason: 'sold' }]);
  const undoBar = page.locator('[data-slot="undo-bar"]');
  await expect(undoBar).toContainText(removeCopiesResultSample.message);
  await expect(undoBar.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('removes all of a stack from the Collection with a reason', async ({ page }) => {
  const { removals } = await mockApi(page);
  await page.goto('/collection');

  await page.locator(`tr[data-stack-id="${threeDuelists.stackId}"]`).getByRole('checkbox').check();
  await toolbar(page).getByRole('button', { name: 'Lower or remove…' }).click();
  await dialog(page).getByText('Traded', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Remove' }).click();

  await expect(dialog(page)).toBeHidden();
  expect(removals).toEqual([{ stackId: threeDuelists.stackId, quantity: 3, reason: 'traded' }]);
});

test('takes one stack at a time and never one in a deck box', async ({ page }) => {
  await mockApi(page);
  await page.goto('/cards/13');
  const copies = page.getByRole('region', { name: 'Copies' });
  const remove = copies
    .getByRole('toolbar', { name: 'Selected cards' })
    .getByRole('button', { name: 'Lower or remove…' });

  await copies
    .locator(`tr[data-stack-id="${s.emberSignetInJinxBurn.stackId}"]`)
    .getByRole('checkbox')
    .check();
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAttribute('title', inDeckErrorSample.error.message);

  await copies
    .locator(`tr[data-stack-id="${s.emberSignetInStaples.stackId}"]`)
    .getByRole('checkbox')
    .check();
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAttribute('title', 'Pick one stack to lower or remove');

  await copies
    .locator(`tr[data-stack-id="${s.emberSignetInJinxBurn.stackId}"]`)
    .getByRole('checkbox')
    .uncheck();
  await expect(remove).toBeEnabled();
});

test("shows the server's message when it refuses", async ({ page }) => {
  await mockApi(page, { refuse: true });
  await page.goto('/cards/13');
  const copies = page.getByRole('region', { name: 'Copies' });
  await copies
    .locator(`tr[data-stack-id="${s.emberSignetInStaples.stackId}"]`)
    .getByRole('checkbox')
    .check();
  await copies.getByRole('button', { name: 'Lower or remove…' }).click();
  await dialog(page).getByText('Lost', { exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Remove' }).click();

  await expect(dialog(page).getByRole('alert')).toHaveText(inDeckErrorSample.error.message);
  await expect(dialog(page)).toBeVisible();
});

test('lists copies out in decks from the location in their own group', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/locations?selected=${raresBinderNode.id}`);

  const out = page.getByRole('region', { name: 'Out in decks' });
  await expect(out).toContainText('1 card from here sits in deck boxes');
  const row = out.locator(`tr[data-stack-id="${s.jinxBurnFoil.stackId}"]`);
  await expect(row).toContainText('Jinx Burn');
  await expect(row.getByRole('link', { name: /In deck · Jinx Burn/ })).toBeVisible();
  // They aren't in the location's own list.
  await expect(page.locator(`tr[data-stack-id="${s.jinxBurnFoil.stackId}"]`)).toHaveCount(1);
});

test('History shows a removal with a dash for its destination and the reason', async ({ page }) => {
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/history?**', (route) => route.fulfill({ json: historyOlderDaySample }));
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/decks', (route) => route.fulfill({ json: deckListSample }));
  await page.goto('/history');

  const removal = page.locator('li[data-movement-id="499"]');
  await expect(removal).toContainText('Whispering Surge');
  await expect(removal.locator('[data-side="to"]')).toHaveText('—');
  await expect(removal).toContainText('Removed');
  await expect(removal.getByTestId('removal-reason')).toHaveText('Sold');
});
