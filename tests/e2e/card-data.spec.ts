import { expect, type Page, test } from '@playwright/test';
import type { CardDataStatus } from '../../src/shared/api/card-data';
import {
  cardDataRefreshStarted,
  cardDataStatusSamples,
  refreshRunningError,
} from '../../src/shared/api/samples/card-data';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

/** Answers GET /api/card-data/status with whatever `current.status` holds at the time. */
async function mockStatus(page: Page, status: CardDataStatus) {
  const current = { status, requests: 0 };
  await page.route('**/api/card-data/status', (route) => {
    current.requests += 1;
    return route.fulfill({ json: current.status });
  });
  return current;
}

test('the bar shows a percentage while card data loads, and hides once ready', async ({ page }) => {
  const mock = await mockStatus(page, cardDataStatusSamples.downloading);
  await page.goto('/collection');

  const bar = page.getByRole('progressbar', { name: 'Loading card data' });
  await expect(page.getByText('Loading card data… 35%')).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuenow', '35');

  mock.status = cardDataStatusSamples.loading;
  await expect(page.getByText('Loading card data… 62%')).toBeVisible();

  mock.status = cardDataStatusSamples.ready;
  await expect(bar).toBeHidden();
  await expect(page.getByText(/Loading card data/)).toBeHidden();
});

test('the bar stays away when card data is ready or failed', async ({ page }) => {
  const mock = await mockStatus(page, cardDataStatusSamples.ready);
  await page.goto('/');
  await expect.poll(() => mock.requests).toBeGreaterThan(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);

  await mockStatus(page, cardDataStatusSamples.error);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Decks');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('on the first start, the search box says card data is loading', async ({ page }) => {
  await mockStatus(page, cardDataStatusSamples.loading);
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search cards' }).fill('Sol Ring');
  await expect(page.getByRole('status').filter({ hasText: 'Card data is loading' })).toBeVisible();
});

test('a refresh keeps search open, since the old cards still work', async ({ page }) => {
  await mockStatus(page, { ...cardDataStatusSamples.ready, state: 'downloading', progress: 0.2 });
  await page.goto('/');
  await expect(page.getByText('Loading card data… 20%')).toBeVisible();
  await page.getByRole('combobox', { name: 'Search cards' }).fill('Sol Ring');
  await expect(page.getByText('Card data is loading')).toBeHidden();
});

test('Settings shows the card data panel', async ({ page }) => {
  await mockStatus(page, cardDataStatusSamples.ready);
  await page.goto('/settings');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  const panel = page.getByRole('region', { name: 'Card data' });
  await expect(panel).toContainText('Scryfall file dateOct 18, 2026');
  await expect(panel).toContainText('Last checkedOct 19, 2026, 1:30 AM');
  await expect(panel).toContainText('Cards33,874');
  await expect(panel).toContainText('Printings101,652');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Refresh card data' })).toBeEnabled();
});

test('Refresh card data calls the route and is disabled while it runs', async ({ page }) => {
  const mock = await mockStatus(page, cardDataStatusSamples.ready);
  let refreshes = 0;
  await page.route('**/api/card-data/refresh', (route) => {
    refreshes += 1;
    expect(route.request().method()).toBe('POST');
    mock.status = { ...cardDataRefreshStarted, progress: 0.1 };
    return route.fulfill({ json: cardDataRefreshStarted });
  });
  await page.goto('/settings');

  const button = page.getByRole('button', { name: 'Refresh card data' });
  await button.click();
  await expect.poll(() => refreshes).toBe(1);
  await expect(button).toBeDisabled();
  await expect(page.getByText('Loading card data… 10%')).toBeVisible();

  mock.status = cardDataStatusSamples.ready;
  await expect(button).toBeEnabled();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('Settings shows the last error', async ({ page }) => {
  await mockStatus(page, cardDataStatusSamples.error);
  await page.goto('/settings');

  const panel = page.getByRole('region', { name: 'Card data' });
  await expect(panel.getByRole('alert')).toHaveText(
    cardDataStatusSamples.error.error ?? 'missing sample error',
  );
  await expect(panel).toContainText('Scryfall file dateOct 11, 2026');
  await expect(panel.getByRole('button', { name: 'Refresh card data' })).toBeEnabled();
});

test('a refresh the server turns down shows why', async ({ page }) => {
  await mockStatus(page, cardDataStatusSamples.ready);
  await page.route('**/api/card-data/refresh', (route) =>
    route.fulfill({ status: 409, json: refreshRunningError }),
  );
  await page.goto('/settings');

  await page.getByRole('button', { name: 'Refresh card data' }).click();
  await expect(page.getByRole('alert')).toHaveText(refreshRunningError.error.message);
});
