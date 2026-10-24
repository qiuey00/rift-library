import { expect, type Page, type Request, test } from '@playwright/test';
import type { CardDetailsResponse } from '../../src/shared/api/cards';
import type { ProxyRequest, PullRequest } from '../../src/shared/api/pulls';
import { cards, locations, printings } from '../../src/shared/api/samples/jinx-burn';
import { pickListSample } from '../../src/shared/api/samples/pick-list';
import {
  proxyResultSample,
  pullFromOtherDeckResultSample,
  pullResultSample,
  staleCopyErrorSample,
} from '../../src/shared/api/samples/pulls';
import { undoMovementResultSample } from '../../src/shared/api/samples/undo';

// The pick list screen against the API mocked from the samples (deck 1, Jinx Burn).

const details = (
  card: (typeof cards)[keyof typeof cards],
  cardPrintings: CardDetailsResponse['printings'],
): CardDetailsResponse => ({
  card: { ...card, rulesText: '', deckable: true },
  printings: cardPrintings,
  counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
});

type Mock = {
  pickListCalls: number;
  pulls: PullRequest[];
  proxies: ProxyRequest[];
  undone: string[];
};

async function openPickList(page: Page, { stale = false } = {}): Promise<Mock> {
  const mock: Mock = { pickListCalls: 0, pulls: [], proxies: [], undone: [] };
  // Card images come from the internet; tests stay offline.
  await page.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/1/pick-list', (route) => {
    mock.pickListCalls += 1;
    return route.fulfill({ json: pickListSample });
  });
  await page.route('**/api/decks/1/pulls', (route) => {
    const body = route.request().postDataJSON() as PullRequest;
    mock.pulls.push(body);
    if (stale) return route.fulfill({ status: 409, json: staleCopyErrorSample });
    return route.fulfill({
      json: body.slotId === 118 ? pullFromOtherDeckResultSample : pullResultSample,
    });
  });
  await page.route('**/api/decks/1/proxies', (route) => {
    mock.proxies.push(route.request().postDataJSON() as ProxyRequest);
    return route.fulfill({ json: proxyResultSample });
  });
  await page.route('**/api/movements/*/undo', (route) => {
    mock.undone.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: undoMovementResultSample });
  });
  await page.route(`**/api/cards/${cards.swiftOx.id}`, (route) =>
    route.fulfill({ json: details(cards.swiftOx, [printings.swiftOxOgn]) }),
  );
  await page.route(`**/api/cards/${cards.nasusTrickster.id}`, (route) =>
    route.fulfill({ json: details(cards.nasusTrickster, [printings.nasusTricksterOgn]) }),
  );
  await page.goto('/decks/1/assemble');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');
  await expect(line(page, '104-1')).toBeVisible();
  return mock;
}

const line = (page: Page, key: string) => page.locator(`[data-walk-line="${key}"]`);
const tickBox = (page: Page, key: string) => line(page, key).getByRole('checkbox');
const undoBar = (page: Page) => page.locator('[data-slot="undo-bar"]');
const isPost = (path: string) => (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === path;

test('shows each location in order, then other deck boxes, missing cards and runes', async ({
  page,
}) => {
  await openPickList(page);
  const sections = page.locator('[data-slot="walk-group"] h2');
  await expect(sections).toHaveText([
    'Long box › Chaos & Calm',
    'Long box › Fury & Order',
    'Rares binder',
    'Staples binder',
    'Trade binder',
    'In other deck boxes',
    'Missing',
  ]);
  await expect(page.getByRole('region', { name: 'Long box › Chaos & Calm' })).toContainText(
    'pull 4 here',
  );
  // One line of counts in domain order, each with its domain icon.
  const runes = page.getByRole('region', { name: 'Runes' }).getByTestId('rune-count');
  await expect(runes).toHaveText(['Fury3 Fury Rune', 'Calm8 Calm Rune', 'Chaos5 Chaos Rune']);
  await expect(runes.first().getByRole('img', { name: 'Fury' })).toBeVisible();
  await expect(line(page, '118-1')).toContainText('Lux Control becomes partly assembled');
});

test('ticking pulls at once, greys the line and names the move', async ({ page }) => {
  const mock = await openPickList(page);
  await tickBox(page, '104-1').check();
  await expect(line(page, '104-1')).toHaveAttribute('data-done', 'true');
  await expect(undoBar(page)).toContainText(pullResultSample.message);
  expect(mock.pulls).toEqual([{ slotId: 104, stackId: 201, quantity: 1 }]);

  // Later ticks join the batch the first pull opened.
  await tickBox(page, '105-1').check();
  await expect.poll(() => mock.pulls.length).toBe(2);
  expect(mock.pulls[1]).toEqual({ slotId: 105, stackId: 203, quantity: 1, batchId: 31 });
});

test('unticking undoes that line’s movement', async ({ page }) => {
  const mock = await openPickList(page);
  await tickBox(page, '104-1').check();
  await expect(undoBar(page)).toContainText(pullResultSample.message);

  const undo = page.waitForRequest(isPost(`/api/movements/${pullResultSample.movementId}/undo`));
  await tickBox(page, '104-1').uncheck();
  await undo;
  await expect(line(page, '104-1')).not.toHaveAttribute('data-done');
  await expect(undoBar(page)).toContainText(undoMovementResultSample.message);
  expect(mock.undone).toEqual(['/api/movements/412/undo']);
});

test('switching copy changes which stack the tick pulls', async ({ page }) => {
  const mock = await openPickList(page);
  await line(page, '104-1').getByRole('button', { name: 'Switch copy of Fierce Blast' }).click();
  const menu = page.getByRole('menu', { name: 'Copies of Fierce Blast' });
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await menu.getByRole('menuitemradio', { name: /Staples binder/ }).click();
  await expect(line(page, '104-1')).toContainText('Switched · Staples binder');

  await tickBox(page, '104-1').check();
  await expect.poll(() => mock.pulls).toEqual([{ slotId: 104, stackId: 202, quantity: 1 }]);
});

test('a copy from the trade binder says so, on the line and in Switch copy', async ({ page }) => {
  await openPickList(page);
  const tag = (locator: ReturnType<typeof line>) =>
    locator.getByText('From trade binder', { exact: true });
  await expect(tag(line(page, '116-1'))).toBeVisible();
  await expect(tag(line(page, '104-1'))).toHaveCount(0);

  // Fierce Blast's other copy moved to the Trade binder.
  const sample = structuredClone(pickListSample);
  const grasp = sample.pickList.groups[0].lines[0];
  grasp.alternatives[0].location = locations.tradeBinder;
  await page.route('**/api/decks/1/pick-list', (route) => route.fulfill({ json: sample }));
  await page.reload();
  await line(page, '104-1').getByRole('button', { name: 'Switch copy of Fierce Blast' }).click();
  const menu = page.getByRole('menu', { name: 'Copies of Fierce Blast' });
  await expect(
    menu.getByRole('menuitemradio', { name: /Trade binder/ }).getByText('From trade binder'),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitemradio', { name: /Chaos & Calm/ }).getByText('From trade binder'),
  ).toHaveCount(0);
});

test('pulling a copy from another deck box asks first', async ({ page }) => {
  const mock = await openPickList(page);
  await tickBox(page, '118-1').click();
  const dialog = page.getByRole('dialog', {
    name: 'Pull Ember Signet from the Lux Control deck box?',
  });
  await expect(dialog).toContainText('Lux Control becomes partly assembled.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(tickBox(page, '118-1')).not.toBeChecked();
  expect(mock.pulls).toEqual([]);

  await tickBox(page, '118-1').click();
  await dialog.getByRole('button', { name: 'Pull it' }).click();
  await expect(tickBox(page, '118-1')).toBeChecked();
  await expect(undoBar(page)).toContainText(pullFromOtherDeckResultSample.message);
  expect(mock.pulls).toEqual([{ slotId: 118, stackId: 219, quantity: 1 }]);
});

test('Add proxy uses the decklist printing, or lets Jeff pick one', async ({ page }) => {
  const mock = await openPickList(page);
  const missing = page.getByRole('region', { name: 'Missing' });
  const soul = missing.locator('[data-missing-line="119"]');
  await soul.getByRole('button', { name: 'Add proxy' }).click();
  await expect(soul).toContainText('Proxy added to the deck box');
  await expect(undoBar(page)).toContainText(proxyResultSample.message);
  expect(mock.proxies).toEqual([
    { slotId: 119, printingId: printings.swiftOxOgn.printingId, quantity: 1 },
  ]);

  // Nasus, Trickster has no printing hint, so Jeff picks one; it joins the open batch.
  const nasusTrickster = missing.locator('[data-missing-line="120"]');
  await nasusTrickster.getByRole('button', { name: 'Add proxy' }).click();
  const dialog = page.getByRole('dialog', { name: /Pick a printing/ });
  await dialog.getByRole('button', { name: /OGN-123\/298/ }).click();
  await expect(nasusTrickster).toContainText('Proxy added to the deck box');
  expect(mock.proxies[1]).toEqual({
    slotId: 120,
    printingId: printings.nasusTricksterOgn.printingId,
    quantity: 1,
    batchId: 31,
  });

  // Removing the proxy undoes its movement.
  await soul.getByRole('button', { name: 'Remove the proxy of Swift Ox' }).click();
  await expect(soul.getByRole('button', { name: 'Add proxy' })).toBeVisible();
  expect(mock.undone).toEqual([`/api/movements/${proxyResultSample.movementId}/undo`]);
});

test('Buy list and Leave gap on a missing line', async ({ page }) => {
  const mock = await openPickList(page);
  const soul = page.locator('[data-missing-line="119"]');
  await soul.getByRole('button', { name: 'Leave gap' }).click();
  await expect(soul).toContainText('Leaving a gap');
  await expect(soul.getByRole('button', { name: 'Leave gap' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await soul.getByRole('button', { name: 'Add to buy list' }).click();
  await expect(page.getByRole('dialog', { name: 'Add to buy list' })).toBeVisible();
  expect(mock.pulls).toEqual([]);
  expect(mock.proxies).toEqual([]);
});

test('a copy that has moved says so and works the pick list out again', async ({ page }) => {
  const mock = await openPickList(page, { stale: true });
  expect(mock.pickListCalls).toBe(1);
  // The 409 unticks the line again at once, so click rather than check (which expects it to stay ticked).
  await tickBox(page, '104-1').click();
  await expect(line(page, '104-1')).toContainText('This copy has moved, pick another');
  await expect(tickBox(page, '104-1')).not.toBeChecked();
  await expect.poll(() => mock.pickListCalls).toBe(2);
});

test('ticks from the keyboard, with progress in the Now picking pane', async ({ page }) => {
  const mock = await openPickList(page);
  const pane = page.getByRole('complementary', { name: 'Now picking' });
  await expect(pane).toContainText('Long box › Chaos & Calm');
  await expect(pane).toContainText('Stop 1 of 5');
  await expect(pane).toContainText('1 Fierce Blast');
  await expect(pane).toContainText('0 of 15 pulled');

  await page.keyboard.press('Space');
  await expect(tickBox(page, '104-1')).toBeChecked();
  await expect(pane).toContainText('1 of 15 pulled');
  await expect(pane).toContainText('1 Grim Scheme');

  // Skip Grim Scheme and tick Vast Scout.
  await page.keyboard.press('ArrowDown');
  await expect(pane).toContainText('1 Vast Scout');
  await page.keyboard.press('Space');
  await expect(tickBox(page, '106-1')).toBeChecked();
  await expect(pane).toContainText('2 of 15 pulled');
  await expect.poll(() => mock.pulls.map((pull) => pull.slotId)).toEqual([104, 106]);
});

test('Done returns to the deck view', async ({ page }) => {
  await openPickList(page);
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(page).toHaveURL('/decks/1');
});
