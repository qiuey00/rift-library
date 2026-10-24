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
  stacksDomainSample,
  stacksNextPageSample,
  stacksPageSample,
  stacksSearchSample,
  stacksTradeSample,
} from '../../src/shared/api/samples/stacks';
import type { StacksPage } from '../../src/shared/api/stacks';

// The Collection screen with the API mocked from the samples: GET /api/stacks answers the
// first page (13 stacks, with a next page), the next page (2 more), the `domain:chaos` search
// (every Chaos card), the `trade:yes` search (the Nasus in the Trade binder), or for any other
// search the `type:unit finish:foil` answer (Nasus and Wild Duelist, both foil). GET /api/collection/value answers the whole collection's value.

// The prices date reads the same wherever the tests run.
test.use({ timezoneId: 'UTC' });

type Sent = { url: URL; body: unknown };

async function mockApi(page: Page, firstPage: StacksPage = stacksPageSample) {
  // Card images come from the internet; tests never reach it.
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
      if (url.searchParams.get('q') === 'domain:chaos') {
        return route.fulfill({ json: stacksDomainSample });
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
  await expect(page.getByRole('link', { name: 'Daring Banner' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Daring Banner/ })).toContainText('Rares binder');
});

test('typing type:unit finish:foil sends that query and shows two chips', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await searchBox(page).fill('type:unit finish:foil');

  await expect.poll(() => lastQuery(stacks)).toBe('type:unit finish:foil');
  await expect(chips(page)).toHaveText(['Type: unit', 'Finish: foil']);
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByTestId('collection-totals')).toHaveText(
    'The search matches 2 cards in 2 stacks, 0 proxies.',
  );
  await expect(page).toHaveURL(/\?q=type%3Aunit(\+|%20)finish%3Afoil$/);
});

test('removing a chip updates the text and the request', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await searchBox(page).fill('type:unit f:foil');
  await expect.poll(() => lastQuery(stacks)).toBe('type:unit f:foil');

  await page.getByRole('button', { name: 'Remove Type: unit' }).click();
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
  await page.getByLabel('Type', { exact: true }).selectOption('unit');
  await page.getByLabel('Rarity', { exact: true }).selectOption('epic');
  await page.getByRole('group', { name: 'Domain' }).getByRole('button', { name: 'Calm' }).click();

  await page.getByRole('combobox', { name: 'Location' }).click();
  await page.getByRole('option', { name: 'Rares binder', exact: true }).click();

  await page.getByRole('combobox', { name: 'Set' }).click();
  await page.getByPlaceholder('Search sets').fill('spirit');
  await page.getByRole('option', { name: /^Spiritforged\s*SFD/ }).click();

  const q = 'finish:foil is:real type:unit rarity:epic domain:calm loc:"Rares binder" set:sfd';
  await expect(searchBox(page)).toHaveValue(q);
  await expect(chips(page)).toHaveText([
    'Finish: foil',
    'Real only',
    'Type: unit',
    'Rarity: epic',
    'Domain: Calm',
    'Location: Rares binder',
    'Set: SFD',
  ]);
  await expect.poll(() => lastQuery(stacks)).toBe(q);

  // Changing a dropdown replaces its term rather than adding another.
  await page.getByLabel('Finish', { exact: true }).selectOption('');
  await expect(searchBox(page)).toHaveValue(
    'is:real type:unit rarity:epic domain:calm loc:"Rares binder" set:sfd',
  );
});

test('the domain icons add and remove domain terms, several at once', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  const domains = page.getByRole('group', { name: 'Domain' });
  await expect(domains.getByRole('img')).toHaveCount(6);
  const chaos = domains.getByRole('button', { name: 'Chaos' });
  const calm = domains.getByRole('button', { name: 'Calm' });
  await expect(chaos).toHaveAttribute('aria-pressed', 'false');

  await chaos.click();
  await expect(chaos).toHaveAttribute('aria-pressed', 'true');
  await expect(searchBox(page)).toHaveValue('domain:chaos');
  await expect(chips(page)).toHaveText(['Domain: Chaos']);
  await expect.poll(() => lastQuery(stacks)).toBe('domain:chaos');
  // Nasus, Protector is Chaos and Calm; it matches on either.
  await expect(bodyRows(page)).toHaveCount(stacksDomainSample.rows.length);
  await expect(page.getByRole('link', { name: 'Nasus, Protector' }).first()).toBeVisible();

  await calm.click();
  await expect(searchBox(page)).toHaveValue('domain:chaos domain:calm');
  await expect(chips(page)).toHaveText(['Domain: Chaos', 'Domain: Calm']);

  await chaos.click();
  await expect(chaos).toHaveAttribute('aria-pressed', 'false');
  await expect(calm).toHaveAttribute('aria-pressed', 'true');
  await expect(searchBox(page)).toHaveValue('domain:calm');

  await page.getByRole('button', { name: 'Remove Domain: Calm' }).click();
  await expect(calm).toHaveAttribute('aria-pressed', 'false');
  await expect(searchBox(page)).toHaveValue('');
});

test('a typed rarity, type or domain shows in its filter', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection?q=rarity:showcase%20t:legend%20domain:ORDER');
  await expect(page.getByLabel('Rarity', { exact: true })).toHaveValue('showcase');
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('legend');
  await expect(
    page.getByRole('group', { name: 'Domain' }).getByRole('button', { name: 'Order' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(chips(page)).toHaveText(['Rarity: showcase', 'Type: legend', 'Domain: Order']);
});

test("rows show the card's domains, type and public code", async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Code' })).toBeVisible();
  const row = page.locator(`tr[data-stack-id="${sampleStacks.nasusProtectorFoil.stackId}"]`);
  await expect(row.getByRole('img', { name: 'Chaos' })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Calm' })).toBeVisible();
  await expect(row.locator('td').nth(2)).toHaveText('Champion unit');
  await expect(row.locator('td').nth(3)).toHaveText('SFD-176/221');
});

test('a typed term shows as the dropdown value', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection?q=f:foil%20is:proxy');
  await expect(page.getByLabel('Finish', { exact: true })).toHaveValue('foil');
  await expect(page.getByLabel('Proxy', { exact: true })).toHaveValue('proxy');
});

test('a term the search cannot use says why and is not sent', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/collection');
  await expect(bodyRows(page).first()).toBeVisible();
  const before = stacks.length;
  await searchBox(page).fill('f:shiny');
  await expect(page.getByRole('alert')).toHaveText('finish: takes normal or foil.');
  await page.waitForTimeout(500);
  expect(stacks.length).toBe(before);
});

test('Mark as proxy and Mark as real send the selected stacks', async ({ page }) => {
  const { posts } = await mockApi(page);
  await page.goto('/collection');
  await page
    .getByRole('row', { name: /Daring Banner/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('row', { name: /Targon's Peak/ })
    .getByRole('checkbox')
    .check();
  const toolbar = page.getByRole('toolbar', { name: 'Selected cards' });

  await toolbar.getByRole('button', { name: 'Mark as proxy' }).click();
  await expect.poll(() => posts).toHaveLength(1);
  expect(posts[0].body).toEqual({
    stackIds: [sampleStacks.targonsPeak.stackId, sampleStacks.daringBanner.stackId],
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
    .getByRole('row', { name: /Daring Banner/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('toolbar', { name: 'Selected cards' })
    .getByRole('button', { name: 'Move to' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Move to' });
  await expect(dialog).toContainText('1 copy of Daring Banner in Rares binder');
});

test('Add to buy list opens the dialog for the selected card', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await page
    .getByRole('row', { name: /Daring Banner/ })
    .getByRole('checkbox')
    .check();
  await page
    .getByRole('toolbar', { name: 'Selected cards' })
    .getByRole('button', { name: 'Add to buy list' })
    .click();
  await expect(page.getByRole('dialog', { name: /buy list/i })).toBeVisible();
});

test('Add card opens the Add cards dialog on the "to sort" inbox', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add cards' });
  await expect(dialog.getByRole('combobox', { name: 'Add to' })).toHaveText('To sort');
});

test('scrolling to the end loads the next page', async ({ page }) => {
  // A first page long enough that its end starts out of view.
  const many: StackRow[] = Array.from({ length: 60 }, (_, i) => ({
    ...sampleStacks.targonsPeak,
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
  await expect(page.getByRole('link', { name: 'Whispering Surge' })).toBeVisible();
});

test('an empty collection offers Create a location and Add cards', async ({ page }) => {
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
  await page.getByRole('main').getByRole('button', { name: 'Add cards' }).click();
  await expect(page.getByRole('dialog', { name: 'Add cards' })).toBeVisible();
});

test('the header shows the collection value with proxies left out', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
  await mockApi(page);
  await page.goto('/collection');
  await expect(page.getByTestId('collection-value')).toHaveText('$3,184.50');
  await expect(page.getByTestId('collection-value-note')).toHaveText(
    '3,007 cards · 214 with no price · proxies not counted · TCGplayer prices via TCGCSV, updated yesterday',
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
  await expect(valueCell(sampleStacks.daringBanner.stackId)).toHaveText('$34.20');
  await expect(valueCell(sampleStacks.targonsPeak.stackId)).toHaveText('$1.05');
  await expect(valueCell(sampleStacks.gildedWhelp.stackId)).toHaveText('No price');
  await expect(valueCell(sampleStacks.hollowSummitProxy.stackId)).toHaveText('');
});

test('a stack in a trade location shows a Trade tag after its name', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const inTrade = page.locator(
    `tr[data-stack-id="${sampleStacks.nasusProtectorInTradeBinder.stackId}"]`,
  );
  const notTrade = page.locator(`tr[data-stack-id="${sampleStacks.nasusProtectorFoil.stackId}"]`);
  await expect(inTrade.getByText('Trade', { exact: true })).toBeVisible();
  await expect(notTrade.getByText('Trade', { exact: true })).toHaveCount(0);
});

test('Export downloads the collection CSV', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const exportLink = page.getByRole('link', { name: 'Export the collection as a CSV' });
  await expect(exportLink).toHaveAttribute('title', "A CSV backup with each card's location.");
  const download = page.waitForEvent('download');
  await exportLink.click();
  // The browser fetches a download itself, past the page's mocked routes, so the real
  // server names the file with today's date.
  expect((await download).suggestedFilename()).toMatch(/^rift-library-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the card preview sits left of the list and shows the price', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const preview = page.getByRole('region', { name: 'Card preview' });
  const table = page.getByRole('table');
  await expect(preview).toBeVisible();
  const [paneBox, tableBox] = await Promise.all([preview.boundingBox(), table.boundingBox()]);
  expect((paneBox?.x ?? 0) + (paneBox?.width ?? 0)).toBeLessThanOrEqual(tableBox?.x ?? 0);

  await page.getByRole('row', { name: /Daring Banner/ }).hover();
  await expect(preview).toContainText('Daring Banner');
  await expect(preview.getByTestId('preview-price')).toHaveText('$34.20 each');

  await page.getByRole('row', { name: /Targon's Peak/ }).hover();
  await expect(preview.getByTestId('preview-price')).toHaveText('$0.35 each · $1.05 for 3');
});
