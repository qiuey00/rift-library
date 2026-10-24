import { expect, type Page, test } from '@playwright/test';
import { emberSearch, emberSignetDetails } from '../../src/shared/api/samples/cards';
import { deckListSample } from '../../src/shared/api/samples/decks';
import { historyDaySample, historyOlderDaySample } from '../../src/shared/api/samples/history';
import { jinxBurnDeckBoxNode, locationTreeSample } from '../../src/shared/api/samples/locations';
import {
  cannotUndoErrorSample,
  undoBatchResultSample,
  undoMovementResultSample,
} from '../../src/shared/api/samples/undo';

// The History screen with the API mocked from the samples: Sunday 18 October 2026 (an undo
// batch, a move it undid, two single moves, a pick-list batch and an import batch), then
// Saturday 17 October with one added card. Jeff's clock is UTC−7, late on the 18th.

test.use({ locale: 'en-US', timezoneId: 'America/Los_Angeles' });

const emberSignetId = emberSignetDetails.card.id;

async function mockHistory(page: Page, { undoStatus = 200 }: { undoStatus?: number } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-18T23:00:00-07:00'));
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const historyRequests: URL[] = [];
  const undoRequests: { method: string; path: string }[] = [];
  await page.route('**/api/history?**', (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const before = url.searchParams.get('before');
    return route.fulfill({
      json: before && before < historyDaySample.day ? historyOlderDaySample : historyDaySample,
    });
  });
  const undo = (sample: unknown) => (route: import('@playwright/test').Route) => {
    const request = route.request();
    undoRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
    return undoStatus === 200
      ? route.fulfill({ json: sample })
      : route.fulfill({ status: undoStatus, json: cannotUndoErrorSample });
  };
  await page.route('**/api/movements/*/undo', undo(undoMovementResultSample));
  await page.route('**/api/batches/*/undo', undo(undoBatchResultSample));
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/decks', (route) => route.fulfill({ json: deckListSample }));
  await page.route('**/api/cards?**', (route) => route.fulfill({ json: emberSearch }));
  await page.route(`**/api/cards/${emberSignetId}`, (route) =>
    route.fulfill({ json: emberSignetDetails }),
  );
  return { historyRequests, undoRequests };
}

const movement = (page: Page, id: number) => page.locator(`li[data-movement-id="${id}"]`);
const batch = (page: Page, id: number) => page.locator(`li[data-batch-id="${id}"]`);

test('shows the day and its entries, newest first, with time, card, places, reason and deck', async ({
  page,
}) => {
  const { historyRequests } = await mockHistory(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('History');

  const today = page.getByRole('region', { name: 'Today' });
  await expect(today.getByRole('heading', { level: 2 })).toHaveText('Today');
  await expect(today.locator(':scope > ul > li')).toHaveCount(historyDaySample.entries.length);

  // The browser's offset from UTC goes with the request.
  expect(historyRequests[0].searchParams.get('offset')).toBe('420');
  expect(historyRequests[0].searchParams.has('before')).toBe(false);

  const sylvan = movement(page, 509);
  await expect(sylvan).toContainText('2:30 PM');
  await expect(sylvan.getByRole('link', { name: 'Daring Banner' })).toHaveAttribute(
    'href',
    `/cards/${historyDaySample.entries[2].kind === 'movement' && historyDaySample.entries[2].movement.card.id}`,
  );
  await expect(sylvan.locator('[data-side="from"]')).toHaveText('To sort');
  await expect(sylvan.locator('[data-side="to"]')).toHaveText('Rares binder');
  await expect(sylvan).toContainText('Moved');
  await expect(movement(page, 508)).toContainText('3');
  await expect(movement(page, 508).locator('[data-side="to"]')).toHaveText('Long box › Lands');

  const pickList = batch(page, 102);
  await expect(pickList).toContainText('Pick list · Jinx Burn · 3 cards');
  await expect(pickList).toContainText('Pulled');
  await expect(pickList.getByRole('link', { name: 'Jinx Burn' })).toHaveAttribute(
    'href',
    '/decks/1',
  );

  // An import has no "from" location: a dash.
  const added = batch(page, 101);
  await expect(added).toContainText('Added');
  await expect(added.locator('[data-side="from"]').first()).toHaveText('—');
  await expect(added.locator('[data-side="to"]').first()).toHaveText('To sort');
});

test('a card name opens its card page', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/history');
  await movement(page, 509).getByRole('link', { name: 'Daring Banner' }).click();
  await expect(page).toHaveURL(/\/cards\//);
});

test('a batch expands to its movements', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/history');
  const pickList = batch(page, 102);
  const toggle = pickList.getByRole('button', {
    name: 'Show the moves in Pick list · Jinx Burn · 3 cards',
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(movement(page, 506)).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const moves = pickList.getByRole('list', { name: 'Moves in Pick list · Jinx Burn · 3 cards' });
  await expect(moves.getByRole('listitem')).toHaveCount(3);
  await expect(moves.getByRole('link')).toHaveText([
    "Targon's Peak",
    'Jinx, Loose Cannon',
    'Ember Signet',
  ]);
  await expect(movement(page, 506).locator('[data-side="from"]')).toHaveText('Rares binder');
  await expect(movement(page, 506).locator('[data-side="to"]')).toHaveText(
    jinxBurnDeckBoxNode.path,
  );

  await toggle.click();
  await expect(moves).toHaveCount(0);
});

test('undone entries stay, greyed, with an Undone tag and no Undo', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/history');
  const undone = movement(page, 510);
  await expect(undone).toHaveAttribute('data-undone', 'true');
  await expect(undone).toContainText('Undone');
  await expect(undone.getByRole('link', { name: 'Ember Signet' })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  );
  await expect(undone.locator('span.opacity-50').first()).toHaveCSS('opacity', '0.5');
  await expect(undone.getByRole('button', { name: /^Undo/ })).toHaveCount(0);

  // Undo entries can't be undone either.
  await expect(batch(page, 106)).toContainText('Undo');
  await expect(batch(page, 106).getByRole('button', { name: /^Undo/ })).toHaveCount(0);

  // A standing move can.
  await expect(
    movement(page, 509).getByRole('button', { name: 'Undo this move of Daring Banner' }),
  ).toBeVisible();
});

test('Undo on a movement sends its undo and shows the result in the undo bar', async ({ page }) => {
  const { undoRequests, historyRequests } = await mockHistory(page);
  await page.goto('/history');
  await expect(movement(page, 509)).toBeVisible();
  const loads = historyRequests.length;

  await movement(page, 509)
    .getByRole('button', { name: 'Undo this move of Daring Banner' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: undoMovementResultSample.message }),
  ).toBeVisible();
  expect(undoRequests).toEqual([{ method: 'POST', path: '/api/movements/509/undo' }]);
  // The list reloads to show the reverse move.
  await expect.poll(() => historyRequests.length).toBeGreaterThan(loads);
});

test('Undo on a batch sends the batch undo', async ({ page }) => {
  const { undoRequests } = await mockHistory(page);
  await page.goto('/history');
  await batch(page, 102)
    .getByRole('button', { name: 'Undo Pick list · Jinx Burn · 3 cards' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: undoBatchResultSample.message }),
  ).toBeVisible();
  expect(undoRequests).toEqual([{ method: 'POST', path: '/api/batches/102/undo' }]);
});

test('Undo on one movement inside a batch sends that movement', async ({ page }) => {
  const { undoRequests } = await mockHistory(page);
  await page.goto('/history');
  await batch(page, 101)
    .getByRole('button', { name: /^Show the moves/ })
    .click();
  await movement(page, 503).getByRole('button', { name: 'Undo this move of Wild Shaman' }).click();
  await expect
    .poll(() => undoRequests)
    .toEqual([{ method: 'POST', path: '/api/movements/503/undo' }]);
});

test('a refused undo shows its reason', async ({ page }) => {
  await mockHistory(page, { undoStatus: 409 });
  await page.goto('/history');
  await movement(page, 509)
    .getByRole('button', { name: 'Undo this move of Daring Banner' })
    .click();
  await expect(page.getByRole('alert')).toHaveText(cannotUndoErrorSample.error.message);
});

test('opens on Recently moved, unfiltered', async ({ page }) => {
  const { historyRequests } = await mockHistory(page);
  await page.goto('/history');
  await expect(page.getByRole('button', { name: 'Recently moved' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => historyRequests.length).toBeGreaterThan(0);
  const params = historyRequests[0].searchParams;
  expect([...params.keys()]).toEqual(['offset']);
});

test('filters come from the address', async ({ page }) => {
  const { historyRequests } = await mockHistory(page);

  await page.goto(`/history?card=${emberSignetId}`);
  await expect(page.getByRole('button', { name: 'Card', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('combobox', { name: 'Card', exact: true })).toHaveText(
    'Ember Signet',
  );
  await expect
    .poll(() => historyRequests.at(-1)?.searchParams.get('card'))
    .toBe(String(emberSignetId));

  await page.goto('/history?location=6');
  await expect(page.getByRole('button', { name: 'Location' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('combobox', { name: 'Location' })).toHaveText('Rares binder');
  await expect.poll(() => historyRequests.at(-1)?.searchParams.get('location')).toBe('6');

  await page.goto('/history?deck=1');
  await expect(page.getByRole('combobox', { name: 'Deck' })).toHaveValue('1');
  await expect.poll(() => historyRequests.at(-1)?.searchParams.get('deck')).toBe('1');
});

test('picking a filter puts it in the address', async ({ page }) => {
  const { historyRequests } = await mockHistory(page);
  await page.goto('/history');

  await page.getByRole('button', { name: 'Deck', exact: true }).click();
  await page.getByRole('combobox', { name: 'Deck' }).selectOption({ label: 'Jinx Burn' });
  await expect(page).toHaveURL('/history?deck=1');
  await expect.poll(() => historyRequests.at(-1)?.searchParams.get('deck')).toBe('1');

  await page.getByRole('button', { name: 'Location' }).click();
  await expect(page).toHaveURL('/history');
  await page.getByRole('combobox', { name: 'Location' }).click();
  await page.getByRole('option', { name: 'Rares binder' }).click();
  await expect(page).toHaveURL('/history?location=6');

  await page.getByRole('button', { name: 'Card', exact: true }).click();
  await page.getByRole('combobox', { name: 'Card', exact: true }).click();
  await page.getByPlaceholder('Search cards').last().fill('ember');
  await page.getByRole('option', { name: 'Ember Signet' }).click();
  await expect(page).toHaveURL(`/history?card=${emberSignetId}`);
  await expect(page.getByRole('combobox', { name: 'Card', exact: true })).toHaveText(
    'Ember Signet',
  );

  await page.getByRole('button', { name: 'Recently moved' }).click();
  await expect(page).toHaveURL('/history');
});

test('scrolling down loads the next older day', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 300 });
  const { historyRequests } = await mockHistory(page);
  await page.goto('/history');
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Yesterday' })).toHaveCount(0);
  expect(historyRequests).toHaveLength(1);

  await page.mouse.wheel(0, 4000);
  const yesterday = page.getByRole('region', { name: 'Yesterday' });
  await expect(yesterday).toBeVisible();
  await expect(movement(page, 500)).toContainText('Whispering Surge');
  await expect(movement(page, 500)).toContainText('Added');
  expect(historyRequests.at(-1)?.searchParams.get('before')).toBe('2026-10-17');
  await expect(page.getByText('That is the start of the history.')).toBeVisible();
});

test('older days are named by weekday and date', async ({ page }) => {
  await mockHistory(page);
  await page.clock.setFixedTime(new Date('2026-10-21T09:00:00-07:00'));
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Sun 18 Oct' })).toBeVisible();
});
