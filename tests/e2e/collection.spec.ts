import { expect, type Page, test } from '@playwright/test';
import type { StackRow } from '../../src/shared/api/common';
import type { SetProxyBody } from '../../src/shared/api/copies';
import { setProxyResultSample } from '../../src/shared/api/samples/copies';
import {
  collectionCsvFileNameSample,
  collectionCsvSample,
} from '../../src/shared/api/samples/exports';
import { locationTreeSample } from '../../src/shared/api/samples/locations';
import {
  collectionValueSample,
  sampleStacks,
  stacksNextPageSample,
  stacksPageSample,
  stacksSearchSample,
  stacksTradeSample,
} from '../../src/shared/api/samples/stacks';
import type { StacksPage } from '../../src/shared/api/stacks';

// The Collection screen with the API mocked from the samples: GET /api/stacks answers the
// first page (13 stacks, with a next page), the next page (2 more), or the `t:creature f:foil`
// search (Blech and Emeritus of Woe, both foil), or the `trade:yes` search (the Blech in the
// Trade binder). GET /api/collection/value answers the whole collection's value.

// The prices date reads the same wherever the tests run.
test.use({ timezoneId: 'UTC' });

type Sent = { url: URL; body: unknown };

async function mockApi(page: Page, firstPage: StacksPage = stacksPageSample) {
  // Card images come from Scryfall; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const stacks: URL[] = [];
  const posts: Sent[] = [];
  await page.route(
    (url) => url.pathname === '/api/stacks',
    (route) => {
      const url = new URL(route.request().url());
      stacks.push(url);
      if (url.searchParams.get('cursor')) return route.fulfill({ json: stacksNextPageSample });
      if (url.searchParams.get('q') === 'trade:yes') {
        return route.fulfill({ json: stacksTradeSample });
      }
      if (url.searchParams.get('q')) return route.fulfill({ json: stacksSearchSample });
      return route.fulfill({ json: firstPage });
    },
  );
  await page.route('**/api/collection/value', (route) =>
    route.fulfill({ json: collectionValueSample }),
  );
  await page.route('**/api/exports/collection.csv', (route) =>
    route.fulfill({
      body: collectionCsvSample,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${collectionCsvFileNameSample}"`,
      },
    }),
  );
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/stacks/proxy', (route) => {
    posts.push({ url: new URL(route.request().url()), body: route.request().postDataJSON() });
    return route.fulfill({ json: setProxyResultSample });
  });
  return { stacks, posts };
}

const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search the collection' });
const chips = (page: Page) =>
  page.getByRole('list', { name: 'Search terms' }).getByRole('listitem');
const bodyRows = (page: Page) => page.locator('tbody tr[data-stack-id]');
const lastQuery = (stacks: URL[]) => stacks.at(-1)?.searchParams.get('q') ?? null;

test('lists every copy stack with the totals in the header', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Collection');
  await expect(page.getByTestId('collection-totals')).toHaveText(
    '22 cards in 16 stacks, 2 proxies.',
  );
  await expect(page.getByRole('link', { name: 'Sylvan Library' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Sylvan Library/ })).toContainText('Rares binder');
});

test('typing t:creature f:foil sends that query and shows two chips', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await searchBox(page).fill('t:creature f:foil');

  await expect.poll(() => lastQuery(stacks)).toBe('t:creature f:foil');
  await expect(chips(page)).toHaveText(['Type: creature', 'Finish: foil']);
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByTestId('collection-totals')).toHaveText(
    'The search matches 2 cards in 2 stacks, 0 proxies.',
  );
  await expect(page).toHaveURL(/\?q=t%3Acreature(\+|%20)f%3Afoil$/);
});

test('removing a chip updates the text and the request', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await searchBox(page).fill('t:creature f:foil');
  await expect.poll(() => lastQuery(stacks)).toBe('t:creature f:foil');

  await page.getByRole('button', { name: 'Remove Type: creature' }).click();
  await expect(searchBox(page)).toHaveValue('f:foil');
  await expect(chips(page)).toHaveText(['Finish: foil']);
  await expect.poll(() => lastQuery(stacks)).toBe('f:foil');

  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(chips(page)).toHaveCount(0);
});

test('dropdown filters add chips and the same terms to the text', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');

  await page.getByLabel('Finish', { exact: true }).selectOption('foil');
  await page.getByLabel('Proxy', { exact: true }).selectOption('real');
  await page.getByLabel('Type', { exact: true }).selectOption('creature');
  await page.getByRole('button', { name: 'Black' }).click();
  await page.getByRole('button', { name: 'Green' }).click();
  await expect(page.getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('combobox', { name: 'Location' }).click();
  await page.getByRole('option', { name: 'Rares binder', exact: true }).click();

  await page.getByRole('combobox', { name: 'Set' }).click();
  await page.getByPlaceholder('Search sets').fill('strix');
  await page.getByRole('option', { name: /^Secrets of Strixhaven\s*SOS/ }).click();

  const q = 'f:foil is:real t:creature c:bg loc:"Rares binder" set:sos';
  await expect(searchBox(page)).toHaveValue(q);
  await expect(chips(page)).toHaveText([
    'Finish: foil',
    'Real only',
    'Type: creature',
    'Colors: B G',
    'Location: Rares binder',
    'Set: SOS',
  ]);
  await expect.poll(() => lastQuery(stacks)).toBe(q);

  // Changing a dropdown replaces its term rather than adding another.
  await page.getByLabel('Finish', { exact: true }).selectOption('');
  await expect(searchBox(page)).toHaveValue('is:real t:creature c:bg loc:"Rares binder" set:sos');
});

test('a typed term shows as the dropdown value', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection?q=f:etched%20is:proxy');
  await expect(page.getByLabel('Finish', { exact: true })).toHaveValue('etched');
  await expect(page.getByLabel('Proxy', { exact: true })).toHaveValue('proxy');
});

test('a term the search cannot use says why and is not sent', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await expect(bodyRows(page).first()).toBeVisible();
  const before = stacks.length;
  await searchBox(page).fill('f:shiny');
  await expect(page.getByRole('alert')).toHaveText('f: takes foil, nonfoil or etched.');
  await page.waitForTimeout(500);
  expect(stacks.length).toBe(before);
});

test('Mark as proxy and Mark as real send the selected stacks', async ({ page }) => {
  const { posts } = await mockApi(page);
  await page.goto('/collection');
  await page
    .getByRole('row', { name: /Sylvan Library/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('row', { name: /Command Tower/ })
    .getByRole('checkbox')
    .check();
  const toolbar = page.getByRole('toolbar', { name: 'Selected cards' });

  await toolbar.getByRole('button', { name: 'Mark as proxy' }).click();
  await expect.poll(() => posts).toHaveLength(1);
  expect(posts[0].body).toEqual({
    stackIds: [sampleStacks.commandTower.stackId, sampleStacks.sylvanLibrary.stackId],
    isProxy: true,
  } satisfies SetProxyBody);
  await expect(page.getByText(setProxyResultSample.message)).toBeVisible();

  await toolbar.getByRole('button', { name: 'Mark as real' }).click();
  await expect.poll(() => posts).toHaveLength(2);
  expect((posts[1].body as SetProxyBody).isProxy).toBe(false);
});

test('Move to opens the Move to dialog for the selected stacks', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await page
    .getByRole('row', { name: /Sylvan Library/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('toolbar', { name: 'Selected cards' })
    .getByRole('button', { name: 'Move to' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Move to' });
  await expect(dialog).toContainText('1 copy of Sylvan Library in Rares binder');
});

test('Add to buy list opens the dialog for the selected card', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await page
    .getByRole('row', { name: /Sylvan Library/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('toolbar', { name: 'Selected cards' })
    .getByRole('button', { name: 'Add to buy list' })
    .click();
  await expect(page.getByRole('dialog', { name: /buy list/i })).toBeVisible();
});

test('Add card opens the Add a card dialog', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a card' })).toBeVisible();
});

test('scrolling to the end loads the next page', async ({ page }) => {
  // A first page long enough that its end starts out of view.
  const many: StackRow[] = Array.from({ length: 60 }, (_, i) => ({
    ...sampleStacks.commandTower,
    stackId: 1000 + i,
  }));
  const { stacks } = await mockApi(page, { ...stacksPageSample, rows: many });
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/collection');
  await expect(bodyRows(page).first()).toBeVisible();
  expect(stacks.some((url) => url.searchParams.has('cursor'))).toBe(false);

  await page.mouse.wheel(0, 60 * 44);
  await expect.poll(() => stacks.find((url) => url.searchParams.has('cursor'))).toBeTruthy();
  const cursorUrl = stacks.find((url) => url.searchParams.has('cursor'));
  expect(cursorUrl?.searchParams.get('cursor')).toBe(stacksPageSample.nextCursor);
  await page.mouse.wheel(0, 20 * 44);
  await expect(page.getByRole('link', { name: 'Witherbloom Charm' })).toBeVisible();
});

test('an empty collection offers Create a location and Import ManaBox CSV', async ({ page }) => {
  await mockApi(page, {
    rows: [],
    total: { cards: 0, stacks: 0, proxies: 0, value: 0, noPriceCount: 0 },
    nextCursor: null,
  });
  await page.goto('/collection');
  await expect(page.getByText('No cards yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a location' })).toHaveAttribute(
    'href',
    '/locations',
  );
  await page.getByRole('button', { name: 'Import ManaBox CSV' }).click();
  await expect(page.getByRole('dialog', { name: /ManaBox/ })).toBeVisible();
});

test('the header shows the collection value with proxies left out', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
  await mockApi(page);
  await page.goto('/collection');
  await expect(page.getByTestId('collection-value')).toHaveText('$3,184.50');
  await expect(page.getByTestId('collection-value-note')).toHaveText(
    '3,007 cards · 214 with no price · proxies not counted · TCGplayer prices from Scryfall, updated yesterday',
  );
});

test('the For trade chip adds and removes trade:yes', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  const forTrade = page.getByRole('button', { name: 'For trade', exact: true });
  await expect(forTrade).toHaveAttribute('aria-pressed', 'false');

  await forTrade.click();
  await expect(forTrade).toHaveAttribute('aria-pressed', 'true');
  await expect(searchBox(page)).toHaveValue('trade:yes');
  await expect(chips(page)).toHaveText(['For trade']);
  await expect.poll(() => lastQuery(stacks)).toBe('trade:yes');
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Trade binder');

  await page.getByRole('button', { name: 'Remove For trade' }).click();
  await expect(forTrade).toHaveAttribute('aria-pressed', 'false');
  await expect(searchBox(page)).toHaveValue('');
});

test('each sort option is sent to the server', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await expect(bodyRows(page).first()).toBeVisible();
  expect(stacks.at(-1)?.searchParams.get('sort')).toBe('name');

  const sort = page.getByLabel('Sort', { exact: true });
  for (const [value, label] of [
    ['value', 'Value'],
    ['location', 'Location'],
    ['set', 'Set and number'],
    ['recent', 'Recently added'],
    ['name', 'Name'],
  ]) {
    await sort.selectOption({ label });
    await expect.poll(() => stacks.at(-1)?.searchParams.get('sort')).toBe(value);
  }
  await sort.selectOption({ label: 'Value' });
  await expect(page).toHaveURL(/\?sort=value$/);
});

test("rows show each stack's value, No price, and nothing for proxies", async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await expect(page.getByRole('columnheader', { name: 'Value' })).toBeVisible();
  const valueCell = (stackId: number) => page.locator(`tr[data-stack-id="${stackId}"] td`).nth(8);
  await expect(valueCell(sampleStacks.sylvanLibrary.stackId)).toHaveText('$34.20');
  await expect(valueCell(sampleStacks.commandTower.stackId)).toHaveText('$1.05');
  await expect(valueCell(sampleStacks.harmonizedTrio.stackId)).toHaveText('No price');
  await expect(valueCell(sampleStacks.gaeasCradleProxy.stackId)).toHaveText('');
});

test('a stack in a trade location shows a Trade tag after its name', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const inTrade = page.locator(`tr[data-stack-id="${sampleStacks.blechInTradeBinder.stackId}"]`);
  const notTrade = page.locator(`tr[data-stack-id="${sampleStacks.blechFoil.stackId}"]`);
  await expect(inTrade.getByText('Trade', { exact: true })).toBeVisible();
  await expect(notTrade.getByText('Trade', { exact: true })).toHaveCount(0);
});

test('Export downloads the collection CSV', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const exportLink = page.getByRole('link', { name: 'Export the collection as a ManaBox CSV' });
  await expect(exportLink).toHaveAttribute(
    'title',
    "ManaBox CSV with each card's location. Import it again to restore.",
  );
  const download = page.waitForEvent('download');
  await exportLink.click();
  // The browser fetches a download itself, past the page's mocked routes, so the real
  // server names the file with today's date.
  expect((await download).suggestedFilename()).toMatch(/^rift-library-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('Import opens the ManaBox import', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await page.getByRole('button', { name: 'Import from ManaBox' }).click();
  await expect(page.getByRole('dialog', { name: /ManaBox/ })).toBeVisible();
});

test('the card preview sits left of the list and shows the price', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const preview = page.getByRole('region', { name: 'Card preview' });
  const table = page.getByRole('table');
  await expect(preview).toBeVisible();
  const [paneBox, tableBox] = await Promise.all([preview.boundingBox(), table.boundingBox()]);
  expect((paneBox?.x ?? 0) + (paneBox?.width ?? 0)).toBeLessThanOrEqual(tableBox?.x ?? 0);

  await page.getByRole('row', { name: /Sylvan Library/ }).hover();
  await expect(preview).toContainText('Sylvan Library');
  await expect(preview.getByTestId('preview-price')).toHaveText('$34.20 each');

  await page.getByRole('row', { name: /Command Tower/ }).hover();
  await expect(preview.getByTestId('preview-price')).toHaveText('$0.35 each · $1.05 for 3');
});
