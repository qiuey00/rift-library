import { expect, type Page, type Request, test } from '@playwright/test';
import type { PullRequest } from '../../src/shared/api/pulls';
import type { ReturnRequest } from '../../src/shared/api/put-away';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import { deckViewSample } from '../../src/shared/api/samples/decks';
import { cards, locations, printings, stack } from '../../src/shared/api/samples/jinx-burn';
import { locationTreeSample } from '../../src/shared/api/samples/locations';
import { pullResultSample } from '../../src/shared/api/samples/pulls';
import { returnResultSample } from '../../src/shared/api/samples/put-away';
import { swapSample } from '../../src/shared/api/samples/swap';
import { undoMovementResultSample } from '../../src/shared/api/samples/undo';
import type { SwapResponse } from '../../src/shared/api/swap';

// The swap list and the deck view's banner with the API mocked from the samples: Jinx Burn
// (deck 1) lost Swift Skirmisher and Vigilant Surge, and gained Volibear, Vanguard and Dawn Harrier.

type Sent = { returns: ReturnRequest[]; pulls: PullRequest[]; undone: string[] };

async function mockSwap(page: Page, swap: SwapResponse = swapSample): Promise<Sent> {
  const sent: Sent = { returns: [], pulls: [], undone: [] };
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/1/swap', (route) => route.fulfill({ json: swap }));
  await page.route('**/api/decks/1/returns', (route) => {
    sent.returns.push(route.request().postDataJSON());
    return route.fulfill({ json: returnResultSample });
  });
  await page.route('**/api/decks/1/pulls', (route) => {
    sent.pulls.push(route.request().postDataJSON());
    return route.fulfill({ json: pullResultSample });
  });
  await page.route('**/api/movements/*/undo', (route) => {
    sent.undone.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: undoMovementResultSample });
  });
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  return sent;
}

const part = (page: Page, name: 'Take out' | 'Pull in') =>
  page.getByRole('region', { name, exact: true });
const tick = (page: Page, name: RegExp) => page.getByRole('checkbox', { name });
const posted = (page: Page, path: string) =>
  page.waitForRequest((r: Request) => r.method() === 'POST' && r.url().endsWith(path));

test('both parts render, grouped by destination and by location', async ({ page }) => {
  await mockSwap(page);
  await page.goto('/decks/1/swap');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Swap list');
  await expect(page.getByRole('link', { name: 'Jinx Burn' })).toHaveAttribute('href', '/decks/1');

  const out = part(page, 'Take out');
  await expect(out.getByRole('region', { name: 'Long box › Chaos & Calm' })).toContainText(
    'Swift Skirmisher',
  );
  await expect(out.getByRole('region', { name: 'Long box › Fury & Order' })).toContainText(
    'Vigilant Surge',
  );

  const pullIn = part(page, 'Pull in');
  await expect(pullIn.getByRole('region', { name: 'Long box › Chaos & Calm' })).toContainText(
    'Volibear, Vanguard',
  );
  await expect(pullIn.getByRole('region', { name: 'Rares binder' })).toContainText('Dawn Harrier');

  await expect(page.getByText('0 of 2 taken out · 0 of 2 pulled in')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Cards swapped' })).toHaveAttribute(
    'aria-valuetext',
    '0 of 4 swapped',
  );
});

test('ticks send the right reasons and share one batch', async ({ page }) => {
  const sent = await mockSwap(page);
  await page.goto('/decks/1/swap');

  const returned = posted(page, '/api/decks/1/returns');
  await tick(page, /Swift Skirmisher/).check();
  await returned;
  await expect(tick(page, /Swift Skirmisher/)).toBeChecked();
  expect(sent.returns[0]).toEqual({
    lines: [{ stackId: 308, quantity: 1 }],
    reason: 'swapped_out',
  });

  const pulled = posted(page, '/api/decks/1/pulls');
  await tick(page, /Volibear, Vanguard/).check();
  await pulled;
  await expect(tick(page, /Volibear, Vanguard/)).toBeChecked();
  expect(sent.pulls[0]).toEqual({
    slotId: 121,
    stackId: 220,
    quantity: 1,
    batchId: returnResultSample.batchId,
    reason: 'swapped_in',
  });

  await expect(page.getByText('1 of 2 taken out · 1 of 2 pulled in')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Cards swapped' })).toHaveAttribute(
    'aria-valuetext',
    '2 of 4 swapped',
  );
  await expect(page.getByText(pullResultSample.message)).toBeVisible();

  // Unticking undoes that line's move.
  const undone = posted(page, `/api/movements/${pullResultSample.movementId}/undo`);
  await tick(page, /Volibear, Vanguard/).uncheck();
  await undone;
  await expect(tick(page, /Volibear, Vanguard/)).not.toBeChecked();
});

test('Send elsewhere sends toLocationId and hides deck boxes', async ({ page }) => {
  const sent = await mockSwap(page);
  await page.goto('/decks/1/swap');

  await page.getByRole('button', { name: 'More for Vigilant Surge' }).click();
  await page.getByRole('menuitem', { name: 'Send elsewhere…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Vigilant Surge elsewhere' });
  await dialog.getByRole('combobox', { name: 'Where it goes' }).click();
  const options = page.getByRole('option');
  await expect(options.filter({ hasText: 'Rares binder' })).toBeVisible();
  await expect(options.filter({ hasText: 'deck box' })).toHaveCount(0);
  await options.filter({ hasText: 'Rares binder' }).click();
  await dialog.getByRole('button', { name: 'Send here' }).click();
  await expect(dialog).toBeHidden();

  await expect(part(page, 'Take out')).toContainText('Send to Rares binder');
  const returned = posted(page, '/api/decks/1/returns');
  await tick(page, /Vigilant Surge/).check();
  await returned;
  expect(sent.returns[0].lines).toEqual([
    { stackId: 309, quantity: 1, toLocationId: locations.raresBinder.id },
  ]);
  expect(sent.returns[0].reason).toBe('swapped_out');
});

test('Switch copy pulls the picked copy; a copy in another deck asks first', async ({ page }) => {
  const otherCopy = stack(230, cards.dawnHarrier, printings.dawnHarrierOgn, locations.bulkTray);
  const inLuxControl = stack(
    231,
    cards.volibearVanguard,
    printings.volibearVanguardOgn,
    locations.luxControlBox,
    {
      inDeck: { deckId: 2, deckName: 'Lux Control' },
    },
  );
  const [chaosCalm, rares] = swapSample.pullIn.groups;
  const swap: SwapResponse = {
    ...swapSample,
    pullIn: {
      ...swapSample.pullIn,
      groups: [{ ...rares, lines: [{ ...rares.lines[0], alternatives: [otherCopy] }] }],
      otherDecks: [
        {
          ...chaosCalm.lines[0],
          suggested: inLuxControl,
          fromDeck: { id: 2, name: 'Lux Control', becomesPartly: true },
        },
      ],
    },
  };
  const sent = await mockSwap(page, swap);
  await page.goto('/decks/1/swap');

  await page.getByRole('button', { name: 'Switch copy of Dawn Harrier' }).click();
  await page.getByRole('menuitemradio', { name: /Bulk tray/ }).click();
  await expect(part(page, 'Pull in')).toContainText('Switched · Bulk tray');
  const pulled = posted(page, '/api/decks/1/pulls');
  await tick(page, /Dawn Harrier/).check();
  await pulled;
  expect(sent.pulls[0]).toMatchObject({ slotId: 122, stackId: 230, reason: 'swapped_in' });

  await expect(part(page, 'Pull in')).toContainText('Lux Control becomes partly assembled');
  // Ticking asks first, so the box stays unticked until Pull it.
  await tick(page, /Volibear, Vanguard/).click();
  const confirm = page.getByRole('dialog', {
    name: /Pull Volibear, Vanguard from the Lux Control/,
  });
  await expect(confirm).toContainText('Lux Control becomes partly assembled.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(tick(page, /Volibear, Vanguard/)).not.toBeChecked();
  expect(sent.pulls).toHaveLength(1);

  await tick(page, /Volibear, Vanguard/).click();
  const pulledFromLuxControl = posted(page, '/api/decks/1/pulls');
  await confirm.getByRole('button', { name: 'Pull it' }).click();
  await pulledFromLuxControl;
  expect(sent.pulls[1]).toMatchObject({ slotId: 121, stackId: 231, reason: 'swapped_in' });
});

test('Done returns to the deck view', async ({ page }) => {
  await mockSwap(page);
  await page.route('**/api/decks/1', (route) => route.fulfill({ json: deckViewSample }));
  await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
  await page.goto('/decks/1/swap');
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/decks\/1$/);
});

test.describe('deck view banner', () => {
  async function mockDeck(page: Page, swap: SwapResponse) {
    await mockSwap(page, swap);
    await page.route('**/api/decks/1', (route) => route.fulfill({ json: deckViewSample }));
    await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
  }

  test('shows the counts and links to the swap list', async ({ page }) => {
    await mockDeck(page, swapSample);
    await page.goto('/decks/1');
    const banner = page.getByRole('status', { name: 'Swap list' });
    await expect(banner).toContainText('List changed: 2 to take out, 2 to pull in');
    await expect(banner.getByRole('link', { name: 'Open swap list' })).toHaveAttribute(
      'href',
      '/decks/1/swap',
    );
    await banner.getByRole('link', { name: 'Open swap list' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Swap list');
  });

  test('hides once Take out is empty', async ({ page }) => {
    await mockDeck(page, {
      ...swapSample,
      takeOut: { groups: [], count: 0 },
      counts: { takeOut: 0, pullIn: 2 },
    });
    const swapRequest = page.waitForResponse((r) => r.url().endsWith('/api/decks/1/swap'));
    await page.goto('/decks/1');
    await swapRequest;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jinx Burn');
    await expect(page.getByRole('status', { name: 'Swap list' })).toHaveCount(0);
  });
});
