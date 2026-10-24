import { expect, type Page, test } from '@playwright/test';
import {
  moveContentsResultSample,
  setProxyResultSample,
} from '../../src/shared/api/samples/copies';
import { deckListSample } from '../../src/shared/api/samples/decks';
import {
  createdLocationSample,
  locationNotEmptyErrorSample,
  locationTreeSample,
  markedForTradeSample,
  updatedLocationSample,
} from '../../src/shared/api/samples/locations';
import {
  collectionValueSample,
  locationStacksSample,
  locationStacksWithChildrenSample,
} from '../../src/shared/api/samples/stacks';

// The Locations screen with the API mocked from the samples: the tree has To sort (37 cards),
// the Long box and its three sections, two binders, the Bulk tray, the Trade binder (12, for
// trade) and two deck boxes; the Rares binder (6) holds three stacks and the Long box (2)
// holds five with its children.

type Sent = { method: string; path: string; body: unknown };

/** The sample tree plus an empty Commons box, so there is something to delete outright. */
const tree = {
  nodes: [
    ...locationTreeSample.nodes.slice(0, 8),
    createdLocationSample,
    ...locationTreeSample.nodes.slice(8),
  ],
};

async function mockApi(page: Page) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const sent: Sent[] = [];
  const stacks: URL[] = [];
  const record = (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request();
    sent.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postData() ? request.postDataJSON() : null,
    });
  };
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: tree }));
  await page.route('**/api/decks', (route) => route.fulfill({ json: deckListSample }));
  await page.route('**/api/collection/value', (route) =>
    route.fulfill({ json: collectionValueSample }),
  );
  await page.route(
    (url) => /^\/api\/locations\/\d+\/stacks$/.test(url.pathname),
    (route) => {
      const url = new URL(route.request().url());
      stacks.push(url);
      const children = url.searchParams.get('includeChildren') === '1';
      const json = url.pathname.includes('/2/')
        ? children
          ? locationStacksWithChildrenSample
          : { location: locationStacksWithChildrenSample.location, rows: [], outInDecks: [] }
        : locationStacksSample;
      return route.fulfill({ json });
    },
  );
  await page.route('**/api/locations', (route) => {
    record(route);
    return route.fulfill({ json: createdLocationSample });
  });
  await page.route(
    (url) => /^\/api\/locations\/\d+$/.test(url.pathname),
    (route) => {
      record(route);
      const request = route.request();
      const method = request.method();
      if (method === 'DELETE') {
        // The Long box is refused the first time: it still holds cards.
        const refused =
          route.request().url().endsWith('/2') &&
          !sent.some((s) => s.path === '/api/locations/2/move-contents');
        return refused
          ? route.fulfill({ status: 409, json: locationNotEmptyErrorSample })
          : route.fulfill({ status: 204 });
      }
      const body = request.postDataJSON() as { forTrade?: boolean } | null;
      return route.fulfill({
        json: body?.forTrade !== undefined ? markedForTradeSample : updatedLocationSample,
      });
    },
  );
  await page.route('**/api/locations/*/move-contents', (route) => {
    record(route);
    return route.fulfill({ json: moveContentsResultSample });
  });
  await page.route('**/api/stacks/proxy', (route) => {
    record(route);
    return route.fulfill({ json: setProxyResultSample });
  });
  return { sent, stacks };
}

const row = (page: Page, id: number) => page.locator(`li[data-location-id="${id}"]`);
const openMenu = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `More for ${name}` }).click();
};

test('the tree shows tiles, counts, the pinned inbox and the Deck boxes group', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/locations');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Locations');

  const inbox = page.getByRole('list', { name: 'Inbox' });
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(inbox).toContainText('To sort');
  await expect(inbox.getByTestId('location-count')).toHaveText('37');

  const storage = page.getByRole('list', { name: 'Storage' }).getByRole('listitem');
  await expect(storage).toHaveCount(8);
  await expect(row(page, 2).getByTestId('location-count')).toHaveText('1,036');
  await expect(row(page, 2).locator('[data-location-type="box"]')).toHaveCSS(
    'background-color',
    'rgb(59, 111, 216)',
  );
  // Sections sit one level in and use the Long box's color.
  await expect(row(page, 3).getByRole('button').first()).toHaveCSS('padding-left', '28px');
  await expect(row(page, 3).locator('[data-location-type="box"]')).toHaveCSS(
    'background-color',
    'rgb(59, 111, 216)',
  );

  const deckBoxes = page.getByRole('list', { name: 'Deck boxes' }).getByRole('listitem');
  await expect(deckBoxes).toHaveCount(2);
  await expect(deckBoxes.nth(0)).toContainText('Jinx Burn');
  await expect(deckBoxes.nth(0).locator('span[data-state]')).toHaveText('Partly assembled');
  await expect(deckBoxes.nth(1)).toContainText('Lux Control');
  await expect(deckBoxes.nth(1).locator('span[data-state]')).toHaveText('Assembled');

  // To sort is shown until something else is picked.
  await expect(page.getByRole('heading', { level: 2, name: 'To sort' })).toBeVisible();
});

test('the Locations link shows the inbox count', async ({ page }) => {
  await mockApi(page);
  await page.goto('/collection');
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', {
    name: /Locations/,
  });
  await expect(link.getByTestId('inbox-badge')).toHaveText('37');
});

test('selecting a location shows its contents and puts it in the address', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/locations');
  await row(page, 6)
    .getByRole('button', { name: /^Rares binder 180/ })
    .click();
  await expect(page).toHaveURL(/\/locations\?selected=6$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Rares binder' })).toBeVisible();
  await expect(page.getByTestId('location-total')).toHaveText('180 cards · proxies not counted');
  // The location's own stacks; its Out in decks group is a table of its own.
  const own = page.locator('table').first();
  await expect(own.locator('tbody tr[data-stack-id]')).toHaveCount(3);
  await expect(own.getByRole('columnheader', { name: 'Where it is' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Include child locations' })).toBeDisabled();
  expect(stacks.at(-1)?.pathname).toBe('/api/locations/6/stacks');
});

test('Include child locations lists the children with the location column', async ({ page }) => {
  const { stacks } = await mockApi(page);
  await page.goto('/locations?selected=2');
  await expect(page.getByTestId('location-total')).toHaveText(
    '1,036 cards including child locations · 96 cards have no price · proxies not counted',
  );
  await expect(page.getByText('No cards directly here.')).toBeVisible();

  await page.getByRole('switch', { name: 'Include child locations' }).click();
  await expect.poll(() => stacks.at(-1)?.searchParams.get('includeChildren')).toBe('1');
  await expect(page.locator('tbody tr[data-stack-id]')).toHaveCount(5);
  await expect(page.getByRole('columnheader', { name: 'Where it is' })).toBeVisible();
});

test('New location sends the name, type and parent', async ({ page }) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations');
  await page.getByRole('button', { name: 'New location' }).click();
  const dialog = page.getByRole('dialog', { name: 'New location' });
  await dialog.getByLabel('Name').fill('Commons box');
  await dialog.getByLabel('Type').selectOption('tray');
  await dialog.getByRole('combobox', { name: 'Inside' }).click();
  // Nothing can go inside the inbox.
  await expect(page.getByRole('option', { name: 'To sort' })).toHaveCount(0);
  await page.getByRole('option', { name: 'Long box', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add location' }).click();

  await expect(dialog).toBeHidden();
  expect(sent).toEqual([
    {
      method: 'POST',
      path: '/api/locations',
      body: { name: 'Commons box', type: 'tray', parentId: 2 },
    },
  ]);
  await expect(page).toHaveURL(/selected=11$/);
});

test('the menu renames, colors and reorders a location', async ({ page }) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations');

  await openMenu(page, 'Lands');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename Lands' });
  await rename.getByLabel('Name').fill('Basic lands');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(rename).toBeHidden();

  await openMenu(page, 'Lands');
  await page.getByRole('menuitem', { name: 'Color' }).click();
  await page.getByRole('menuitem', { name: 'Green' }).click();

  await openMenu(page, 'Lands');
  await page.getByRole('menuitem', { name: 'Color' }).click();
  await page.getByRole('menuitem', { name: 'None' }).click();

  await openMenu(page, 'Lands');
  // Lands is the last section of the Long box.
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Move up' }).click();

  await openMenu(page, 'Rares binder');
  await page.getByRole('menuitem', { name: 'Move down' }).click();

  await expect.poll(() => sent.length).toBe(5);
  expect(sent).toEqual([
    { method: 'PATCH', path: '/api/locations/5', body: { name: 'Basic lands' } },
    { method: 'PATCH', path: '/api/locations/5', body: { color: '#2f9e5b' } },
    { method: 'PATCH', path: '/api/locations/5', body: { color: null } },
    { method: 'PATCH', path: '/api/locations/5', body: { position: 1 } },
    { method: 'PATCH', path: '/api/locations/6', body: { position: 3 } },
  ]);
});

test('Move contents sends the location with its children; History links there', async ({
  page,
}) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations');
  await openMenu(page, 'Long box');
  await page.getByRole('menuitem', { name: 'Move contents' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move contents' });
  await expect(dialog).toContainText('Moves all 1,036 cards in Long box, its child locations');
  await dialog.getByRole('combobox', { name: 'Destination' }).click();
  // Not into itself or one of its sections.
  await expect(page.getByRole('option', { name: 'Lands' })).toHaveCount(0);
  await page.getByRole('option', { name: 'Bulk tray' }).click();
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([
    {
      method: 'POST',
      path: '/api/locations/2/move-contents',
      body: { toLocationId: 8, includeChildren: true },
    },
  ]);
  await expect(page.getByText(moveContentsResultSample.message)).toBeVisible();

  await openMenu(page, 'Rares binder');
  await expect(page.getByRole('menuitem', { name: 'History' })).toHaveAttribute(
    'href',
    '/history?location=6',
  );
});

test('the inbox has no Rename or Delete, and a deck’s box has no Delete', async ({ page }) => {
  await mockApi(page);
  await page.goto('/locations');
  await openMenu(page, 'To sort');
  await expect(page.getByRole('menuitem', { name: 'Move contents' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openMenu(page, 'Jinx Burn deck box');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
});

test('an empty location is deleted after one confirmation', async ({ page }) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations?selected=11');
  await openMenu(page, 'Commons box');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Commons box?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{ method: 'DELETE', path: '/api/locations/11', body: null }]);
  await expect(page).toHaveURL(/\/locations$/);
});

test('deleting a location that holds cards sends them to To sort, then deletes it', async ({
  page,
}) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations');
  await openMenu(page, 'Long box');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Long box still holds 1,036 cards' });
  await dialog.getByRole('button', { name: 'Send all to “To sort”' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([
    {
      method: 'POST',
      path: '/api/locations/2/move-contents',
      body: { toLocationId: 1, includeChildren: true },
    },
    { method: 'DELETE', path: '/api/locations/2', body: null },
  ]);
});

test('a refused delete offers Send all to To sort', async ({ page }) => {
  // The tree says the Long box is empty, but the server knows better.
  const { sent } = await mockApi(page);
  await page.route('**/api/locations/tree', (route) =>
    route.fulfill({
      json: { nodes: tree.nodes.map((n) => (n.id === 2 ? { ...n, totalCount: 0 } : n)) },
    }),
  );
  await page.goto('/locations');
  await openMenu(page, 'Long box');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Long box still holds 1,036 cards' });
  await dialog.getByRole('button', { name: 'Send all to “To sort”' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
    'DELETE /api/locations/2',
    'POST /api/locations/2/move-contents',
    'DELETE /api/locations/2',
  ]);
});

test('the selection actions mark proxies and open Move to and Add to buy list', async ({
  page,
}) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations?selected=6');
  await page.getByRole('checkbox', { name: /Select Daring Banner/ }).check();
  await page.getByRole('checkbox', { name: /Select Sunken Insight/ }).check();
  const bar = page.getByRole('toolbar', { name: 'Selected cards' });

  await bar.getByRole('button', { name: 'Mark as proxy' }).click();
  await expect.poll(() => sent.length).toBe(1);
  await bar.getByRole('button', { name: 'Mark as real' }).click();
  await expect.poll(() => sent.length).toBe(2);
  const ids = [locationStacksSample.rows[1]?.stackId, locationStacksSample.rows[2]?.stackId];
  expect(sent).toEqual([
    { method: 'POST', path: '/api/stacks/proxy', body: { stackIds: ids, isProxy: true } },
    { method: 'POST', path: '/api/stacks/proxy', body: { stackIds: ids, isProxy: false } },
  ]);

  await bar.getByRole('button', { name: 'Move to' }).click();
  await expect(page.getByRole('dialog', { name: 'Move to' })).toContainText('2 stacks');
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: 'Add to buy list' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the Storage, Trade binders and Deck boxes sections collapse and reopen', async ({ page }) => {
  await mockApi(page);
  await page.goto('/locations');
  const trade = page.getByRole('list', { name: 'Trade binders' });
  await expect(trade.getByRole('listitem')).toHaveCount(1);
  await expect(trade).toContainText('Trade binder');
  await expect(page.getByRole('list', { name: 'Storage' })).not.toContainText('Trade binder');

  for (const name of ['Storage', 'Trade binders', 'Deck boxes']) {
    const header = page.getByRole('button', { name, exact: true });
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name })).toHaveCount(0);
  }
  // The inbox stays, and each section remembers it was closed.
  await expect(page.getByRole('list', { name: 'Inbox' })).toBeVisible();
  await page.reload();
  const storage = page.getByRole('button', { name: 'Storage', exact: true });
  await expect(storage).toHaveAttribute('aria-expanded', 'false');
  await storage.click();
  await expect(page.getByRole('list', { name: 'Storage' }).getByRole('listitem')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Trade binders' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('Trade binders shows only with a trade location; trade inside storage is tagged', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/api/locations/tree', (route) =>
    route.fulfill({
      json: {
        nodes: tree.nodes
          .filter((n) => n.id !== 12)
          .map((n) => (n.id === 5 ? { ...n, markedForTrade: true, forTrade: true } : n)),
      },
    }),
  );
  await page.goto('/locations?selected=5');
  await expect(page.getByRole('button', { name: 'Trade binders' })).toHaveCount(0);
  await expect(row(page, 5).getByText('Trade', { exact: true })).toBeVisible();
  await expect(row(page, 4).getByText('Trade', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('LocationsStorage');
});

test('values show on rows, the selected location and the collection', async ({ page }) => {
  await mockApi(page);
  await page.goto('/locations?selected=12');
  await expect(page.getByTestId('collection-value')).toHaveText('$3,184.50');
  await expect(row(page, 2).getByTestId('location-value')).toHaveText('$973.85');
  await expect(row(page, 12).getByTestId('location-value')).toHaveText('$412.80');

  await expect(
    page.getByRole('heading', { level: 2, name: 'Trade binder', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Trade binders');
  const header = page.locator('section').first();
  await expect(header.getByTestId('location-value')).toHaveText('$412.80');
  await expect(header.getByText('Trade', { exact: true })).toBeVisible();
  await expect(page.getByTestId('location-total')).toHaveText(
    '86 cards · 4 cards have no price · proxies not counted',
  );
  await expect(page.getByText('Marked for trade. These cards are still yours')).toBeVisible();

  // The stacks table has a Value column.
  await expect(page.getByRole('columnheader', { name: 'Value' }).first()).toBeVisible();
  const first = locationStacksSample.rows[0];
  if (!first) throw new Error('sample has rows');
  await expect(page.locator(`tbody tr[data-stack-id="${first.stackId}"]`)).toContainText(
    first.unitPrice === null ? 'No price' : `$${(first.value / 100).toFixed(2)}`,
  );

  await page.goto('/locations?selected=9');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Deck boxes');
  await expect(page.getByText('Marked for trade.')).toHaveCount(0);
});

test('the For trade switch sends the request; not offered for the inbox or deck boxes', async ({
  page,
}) => {
  const { sent } = await mockApi(page);
  await page.goto('/locations');
  await openMenu(page, 'Staples binder');
  const toggle = page.getByRole('menuitemcheckbox', { name: 'For trade' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect.poll(() => sent.length).toBe(1);

  await openMenu(page, 'Trade binder');
  await expect(page.getByRole('menuitemcheckbox', { name: 'For trade' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemcheckbox', { name: 'For trade' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent).toEqual([
    { method: 'PATCH', path: '/api/locations/7', body: { forTrade: true } },
    { method: 'PATCH', path: '/api/locations/12', body: { forTrade: false } },
  ]);

  for (const name of ['To sort', 'Jinx Burn deck box']) {
    await openMenu(page, name);
    await expect(page.getByRole('menuitem', { name: 'History' })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: 'For trade' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Export list' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('Export list opens the dialog from the header and the menu', async ({ page }) => {
  await mockApi(page);
  await page.goto('/locations?selected=12');
  await page.getByRole('button', { name: 'Export list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export Trade binder' });
  await expect(dialog).toBeVisible();
  // Coming soon until the deck list export (#24).
  await expect(dialog.getByText('Coming soon.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await openMenu(page, 'Rares binder');
  await page.getByRole('menuitem', { name: 'Export list' }).click();
  await expect(page.getByRole('dialog', { name: 'Export Rares binder' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Not for the inbox or a deck box.
  await page.goto('/locations?selected=1');
  await expect(page.getByRole('heading', { level: 2, name: 'To sort' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export list' })).toHaveCount(0);
  await page.goto('/locations?selected=9');
  await expect(page.getByRole('heading', { level: 2, name: 'Jinx Burn deck box' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export list' })).toHaveCount(0);
});
