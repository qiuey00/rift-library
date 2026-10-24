import { expect, type Page, test } from '@playwright/test';
import type { ReturnRequest } from '../../src/shared/api/put-away';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import { deckViewSample, jinxBurn } from '../../src/shared/api/samples/decks';
import { locationTreeSample } from '../../src/shared/api/samples/locations';
import { staleCopyErrorSample } from '../../src/shared/api/samples/pulls';
import {
  putAwaySample,
  returnAllResultSample,
  returnResultSample,
} from '../../src/shared/api/samples/put-away';

// The put-away list and deleting a deck, with the API mocked from the samples: the
// Jinx Burn deck (id 1), whose box holds 7 cards going back to 4 locations.

type Sent = { returns: ReturnRequest[]; deletes: number };

async function mockPutAway(page: Page): Promise<Sent> {
  const sent: Sent = { returns: [], deletes: 0 };
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/1/put-away', (route) => route.fulfill({ json: putAwaySample }));
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/decks/1/returns', (route) => {
    const body: ReturnRequest = route.request().postDataJSON();
    sent.returns.push(body);
    return route.fulfill({
      json: body.lines.length > 1 ? returnAllResultSample : returnResultSample,
    });
  });
  await page.route('**/api/decks/1', (route) => {
    if (route.request().method() === 'DELETE') {
      sent.deletes += 1;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: deckViewSample });
  });
  await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [] } }));
  return sent;
}

const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const groupNames = (page: Page) =>
  page.locator('[data-slot="walk-list"]').getByRole('heading', { level: 2 });
const line = (page: Page, name: string) => page.locator('li[data-walk-line]', { hasText: name });

async function openMenu(page: Page, card: string) {
  await page.getByRole('button', { name: `More for ${card}` }).click();
}

test('groups the deck box by destination, in the list order', async ({ page }) => {
  await mockPutAway(page);
  await page.goto('/decks/1/take-apart');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Take apart Jinx Burn');
  await expect(groupNames(page)).toHaveText([
    'To sort',
    'Long box › Chaos & Calm',
    'Long box › Lands',
    'Rares binder',
  ]);
  await expect(group(page, 'Long box › Chaos & Calm')).toContainText('put 3 here');
  await expect(group(page, 'To sort')).toContainText('Volibear, Pathfinder');
  await expect(group(page, 'To sort')).toContainText('Proxy');
  await expect(group(page, 'Rares binder')).toContainText('Foil');
  await expect(page.getByRole('progressbar', { name: 'Cards put away' })).toHaveAttribute(
    'aria-valuetext',
    '0 of 7 put away',
  );
});

test('ticking returns that copy at once and names the move', async ({ page }) => {
  const sent = await mockPutAway(page);
  await page.goto('/decks/1/take-apart');
  await page.getByRole('checkbox', { name: '1 Iron Insight' }).click();
  await expect(page.locator('[data-slot="undo-bar"]')).toContainText(returnResultSample.message);
  expect(sent.returns).toEqual([{ lines: [{ stackId: 302, quantity: 1 }] }]);
  await expect(page.getByRole('checkbox', { name: '1 Iron Insight' })).toBeChecked();

  // The next return joins the same batch, so the teardown is one History entry.
  await page.getByRole('checkbox', { name: '1 Eager Steppe' }).click();
  await expect.poll(() => sent.returns.length).toBe(2);
  expect(sent.returns[1]).toEqual({
    lines: [{ stackId: 305, quantity: 1 }],
    batchId: returnResultSample.batchId,
  });
  await expect(page.getByRole('progressbar', { name: 'Cards put away' })).toHaveAttribute(
    'aria-valuetext',
    '2 of 7 put away',
  );
});

test('the keyboard moves between lines and Space ticks', async ({ page }) => {
  const sent = await mockPutAway(page);
  await page.goto('/decks/1/take-apart');
  await expect(line(page, 'Volibear, Pathfinder')).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(line(page, 'Dawn Mend')).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press(' ');
  await expect.poll(() => sent.returns).toEqual([{ lines: [{ stackId: 303, quantity: 1 }] }]);
  await expect(page.getByRole('checkbox', { name: '1 Dawn Mend' })).toBeChecked();
  await expect(line(page, 'Sunken Edict')).toHaveAttribute('aria-current', 'step');
});

test('Send elsewhere moves a line to its new group and sends toLocationId', async ({ page }) => {
  const sent = await mockPutAway(page);
  await page.goto('/decks/1/take-apart');
  await openMenu(page, 'Weathered Canyon');
  await page.getByRole('menuitem', { name: 'Send elsewhere' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Weathered Canyon elsewhere' });
  await dialog.getByLabel('Location').click();
  // Deck boxes can't be picked.
  await expect(page.getByRole('option', { name: /deck box/i })).toHaveCount(0);
  await page.getByRole('option', { name: 'Staples binder' }).click();
  await dialog.getByRole('button', { name: 'Send here' }).click();
  await expect(dialog).toBeHidden();

  const staples = group(page, 'Staples binder');
  await expect(staples).toContainText('Weathered Canyon');
  await expect(staples).toContainText('Changed · was Long box › Lands');
  await expect(group(page, 'Long box › Lands')).not.toContainText('Weathered Canyon');

  await page.getByRole('checkbox', { name: '1 Weathered Canyon' }).click();
  await expect
    .poll(() => sent.returns)
    .toEqual([{ lines: [{ stackId: 306, quantity: 1, toLocationId: 7 }] }]);
});

test('Keep in box leaves a line out of Return all, which confirms with the count', async ({
  page,
}) => {
  const sent = await mockPutAway(page);
  await page.goto('/decks/1/take-apart');
  await openMenu(page, 'Iron Insight');
  await page.getByRole('menuitem', { name: 'Keep in box' }).click();
  const kept = group(page, 'Kept in box');
  await expect(kept).toContainText('Iron Insight');
  await expect(kept).toContainText('Changed · was Long box › Chaos & Calm');

  await page.getByRole('button', { name: 'Return all' }).click();
  const dialog = page.getByRole('dialog', { name: 'Return 6 cards?' });
  await dialog.getByRole('button', { name: 'Return 6 cards' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => sent.returns.length).toBe(1);
  expect(sent.returns[0].lines.map((l) => l.stackId).sort()).toEqual([
    301, 303, 304, 305, 306, 307,
  ]);
  await expect(page.locator('[data-slot="undo-bar"]')).toContainText(returnAllResultSample.message);
  await expect(page.getByRole('checkbox', { name: '1 Iron Insight' })).not.toBeChecked();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/decks\/1$/);
});

test('a stale copy shows its message and loads the list again', async ({ page }) => {
  await mockPutAway(page);
  let loads = 0;
  await page.route('**/api/decks/1/put-away', (route) => {
    loads += 1;
    return route.fulfill({ json: putAwaySample });
  });
  await page.route('**/api/decks/1/returns', (route) =>
    route.fulfill({ status: 409, json: staleCopyErrorSample }),
  );
  await page.goto('/decks/1/take-apart');
  await page.getByRole('checkbox', { name: '1 Iron Insight' }).click();
  await expect(page.getByRole('alert')).toHaveText(staleCopyErrorSample.error.message);
  await expect.poll(() => loads).toBe(2);
});

test('deleting a deck with copies puts them away first, then sends DELETE', async ({ page }) => {
  const sent = await mockPutAway(page);
  await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Jinx Burn?' });
  await expect(dialog).toContainText(`holds ${jinxBurn.boxCopyCount} cards`);
  await dialog.getByRole('button', { name: 'Put cards away' }).click();

  await expect(page).toHaveURL(/\/decks\/1\/take-apart\?mode=delete$/);
  await expect(page.getByRole('note')).toHaveText('Put these cards away to delete the deck');
  await openMenu(page, 'Iron Insight');
  await expect(page.getByRole('menuitem', { name: 'Send elsewhere' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Keep in box' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(sent.deletes).toBe(0);

  await page.getByRole('checkbox', { name: '1 Iron Insight' }).click();
  await expect.poll(() => sent.returns.length).toBe(1);
  expect(sent.deletes).toBe(0);
  await page.getByRole('button', { name: 'Return all' }).click();
  await page
    .getByRole('dialog', { name: 'Return 6 cards?' })
    .getByRole('button', { name: 'Return 6 cards' })
    .click();
  await expect.poll(() => sent.deletes).toBe(1);
  await expect(page).toHaveURL(/\/$/);
});

test('deleting an empty deck sends DELETE right after the confirmation', async ({ page }) => {
  const sent = await mockPutAway(page);
  await page.route('**/api/decks/1', (route) => {
    if (route.request().method() === 'DELETE') {
      sent.deletes += 1;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      json: { ...deckViewSample, deck: { ...jinxBurn, boxCopyCount: 0 } },
    });
  });
  await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Jinx Burn?' })
    .getByRole('button', { name: 'Delete deck' })
    .click();
  await expect.poll(() => sent.deletes).toBe(1);
  await expect(page).toHaveURL(/\/$/);
  expect(sent.returns).toEqual([]);
});
