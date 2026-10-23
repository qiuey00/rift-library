import { expect, type Page, test } from '@playwright/test';
import type { CardDataStatus } from '../../src/shared/api/card-data';
import { cardDataStatusSamples } from '../../src/shared/api/samples/card-data';
import {
  arcaneSearch,
  arcaneSignet,
  arcaneSignetDetails,
  cardNotFoundError,
  harmonizedTrio,
  harmonizedTrioDetails,
} from '../../src/shared/api/samples/cards';

// A 1×1 PNG stands in for Scryfall's card images; tests never reach the network.
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function mockApi(page: Page, status: CardDataStatus = cardDataStatusSamples.ready) {
  await page.route('https://cards.scryfall.io/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.route('**/api/card-data/status', (route) => route.fulfill({ json: status }));
  await page.route(/\/api\/cards\/search\?/, (route) => route.fulfill({ json: arcaneSearch }));
  for (const details of [arcaneSignetDetails, harmonizedTrioDetails]) {
    await page.route(`**/api/cards/${details.card.oracleId}`, (route) =>
      route.fulfill({ json: details }),
    );
  }
}

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search cards' });
const options = (page: Page) => page.getByRole('listbox', { name: 'Cards' }).getByRole('option');

test('typing "arcane" lists Arcane Signet with its counts', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await searchBox(page).fill('arcane');

  await expect(options(page)).toHaveCount(arcaneSearch.results.length);
  const signet = options(page).first();
  await expect(signet).toContainText('Arcane Signet');
  await expect(signet).toContainText('3 owned');
  await expect(signet).toContainText('1 free');
  await expect(signet).toHaveAttribute('aria-selected', 'true');
  await expect(options(page).nth(1)).toContainText('Arcane Denial');
});

test('Enter opens the highlighted card, and ↑/↓ move the highlight', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await searchBox(page).fill('arcane');
  await expect(options(page)).toHaveCount(arcaneSearch.results.length);

  await searchBox(page).press('ArrowDown');
  await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await searchBox(page).press('ArrowUp');
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
  await searchBox(page).press('ArrowUp');
  await expect(options(page).last()).toHaveAttribute('aria-selected', 'true');
  await searchBox(page).press('ArrowDown');

  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(`/cards/${arcaneSignet.oracleId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arcane Signet');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(searchBox(page)).toHaveValue('');
});

test('clicking a result opens its card page', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await searchBox(page).fill('arcane');
  await options(page).first().click();
  await expect(page).toHaveURL(`/cards/${arcaneSignet.oracleId}`);
});

test('Esc closes the list', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await searchBox(page).fill('arcane');
  await expect(options(page).first()).toBeVisible();
  await searchBox(page).press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(searchBox(page)).toBeFocused();
});

test('/ focuses the box from another screen, but not from a text field', async ({ page }) => {
  await mockApi(page);
  await page.goto('/history');
  await expect(searchBox(page)).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(searchBox(page)).toBeFocused();
  await expect(searchBox(page)).toHaveValue('');

  // In a text field, / is just a slash.
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Other field');
    document.querySelector('main')?.append(field);
  });
  const other = page.getByRole('textbox', { name: 'Other field' });
  await other.click();
  await page.keyboard.press('/');
  await expect(other).toBeFocused();
  await expect(other).toHaveValue('/');
});

test('while card data first loads, the box says so', async ({ page }) => {
  await mockApi(page, cardDataStatusSamples.downloading);
  let searched = false;
  await page.route(/\/api\/cards\/search\?/, (route) => {
    searched = true;
    return route.fulfill({ json: arcaneSearch });
  });
  await page.goto('/');
  await searchBox(page).fill('arcane');
  await expect(page.getByRole('status').filter({ hasText: 'Card data is loading' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  expect(searched).toBe(false);
});

test('the card page shows the header, counts, image and printings', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/cards/${arcaneSignet.oracleId}`);
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Arcane Signet');
  await expect(main.getByRole('heading', { level: 1 })).toHaveCSS(
    'font-family',
    /^"Instrument Serif"/,
  );
  // The Copies table below has its own mana costs, so look in the header only.
  const header = main.locator('header');
  await expect(header.locator('i.ms.ms-cost.ms-2')).toHaveCount(1);
  await expect(header.getByText('Mana cost {2}')).toBeAttached();
  await expect(main.getByText('Artifact', { exact: true })).toBeVisible();

  await expect(main.locator('[data-count="owned"]')).toHaveText(/^\s*Owned, 1 proxy\s*3\s*$/);
  await expect(main.locator('[data-count="in-decks"]')).toContainText('2');
  await expect(main.locator('[data-count="in-decks"]')).toContainText('In deck boxes');
  await expect(main.locator('[data-count="free"]')).toContainText('1');
  await expect(main.locator('[data-count="free"]')).toContainText('Free in storage');

  await main.getByRole('button', { name: 'Add to buy list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to buy list' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(main.getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    `/history?card=${arcaneSignet.oracleId}`,
  );

  // The whole card, at its own shape, to the right of the header.
  const image = main.getByRole('img', { name: 'Arcane Signet' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', arcaneSignet.imageNormal ?? '');
  await expect(image).toHaveCSS('object-fit', 'contain');
  const imageBox = await image.boundingBox();
  const headingBox = await main.getByRole('heading', { level: 1 }).boundingBox();
  expect(imageBox && headingBox && imageBox.x > headingBox.x).toBe(true);
  expect(imageBox && Math.abs(imageBox.width / imageBox.height - 488 / 680)).toBeLessThan(0.01);

  const rows = main.getByRole('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(arcaneSignetDetails.printings.length);
  await expect(rows.first()).toContainText('Edge of Eternities Commander');
  await expect(rows.first()).toContainText('#53');
  await expect(rows.first()).toContainText('Nonfoil');
  await expect(rows.first().locator('i.ss.ss-eoc.ss-common')).toHaveCount(1);
  await expect(rows.nth(1)).toContainText('Commander Masters');
  await expect(rows.nth(1)).toContainText('Nonfoil, Foil');

  await expect(main.getByRole('heading', { name: 'Copies' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Decks' })).toBeVisible();
});

test('a double-faced card shows its full name', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/cards/${harmonizedTrio.oracleId}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Harmonized Trio // Brainstorm');
  await expect(main.getByRole('img', { name: 'Harmonized Trio // Brainstorm' })).toBeVisible();
  await expect(main.locator('i.ms.ms-cost.ms-u')).toHaveCount(2);
  await expect(main.locator('[data-count="owned"]')).toHaveText(/^\s*Owned\s*1\s*$/);
});

test('a card the card data lacks says so', async ({ page }) => {
  await mockApi(page);
  const missing = '11111111-2222-4333-8444-555555555555';
  await page.route(`**/api/cards/${missing}`, (route) =>
    route.fulfill({ status: 404, json: cardNotFoundError }),
  );
  await page.goto(`/cards/${missing}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Card not found');
  await expect(page.getByRole('main')).toContainText(cardNotFoundError.error.message);
});
