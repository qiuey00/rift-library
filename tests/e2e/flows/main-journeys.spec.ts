import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import type { Board, Finish } from '../../../src/shared/api/common';
import type { LocationTree } from '../../../src/shared/api/locations';

// Jeff's main journeys through the real app and server, with no API mocks: set up storage,
// add a collection and a deck, assemble it from the pick list, take it apart, undo, change it
// through the swap list and delete a deck. The journeys share one database, so they run in
// order and each starts where the one before stopped. The deck is a stand-in until the
// Riftbound flows (#26).
//
// flow-collection.json holds the Jinx Burn deck's list and its cards other than runes in two
// groups, Spells (58 cards) and Lands (25), less Wary Sweep, which is added as a proxy. It has
// two Sun Discs, a Targon's Peak in each group and a proxy Unbound Volley next to a real one,
// plus Lee Sin, Blind Monk for the second deck and Solar Adept and Proud Trapper to swap in
// (both in Jinx's domains, Fury and Chaos, so the deck's Add card search finds them).

type FlowCollection = {
  copies: {
    name: string;
    printingId: string;
    quantity: number;
    finish: Finish;
    condition: string;
    language: string;
    isProxy: boolean;
    location: 'Spells' | 'Lands';
  }[];
  deck: {
    name: string;
    cardId: number;
    board: Board;
    quantity: number;
  }[];
};

const flow: FlowCollection = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', '..', 'fixtures', 'flow-collection.json'),
    'utf8',
  ),
);
const FRONT_ROW = 'Long box › Front row';
const BACK_ROW = 'Long box › Back row';
const LANDS_BINDER = 'Lands binder';
const SPELLS_CARDS = 58;
const LANDS_CARDS = 25;

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  // Card images come from the internet; the journeys never reach the network.
  await page.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route) => route.abort(),
  );
  // The journeys read each slot's status, which the deck view shows once Show status is on.
  await page.addInitScript(() => localStorage.setItem('deck-view-status', 'on'));
});

/** The deck ids the journeys create, in the order they are made. */
const decks = { jinxBurn: 0, leeSinBlindMonk: 0 };

const deckHeader = (page: Page) => page.getByRole('region', { name: 'Deck header' });
/** A deck view row, found by the card's exact name. */
const deckRow = (page: Page, name: string) =>
  page
    .locator('li[data-slot-id]')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .first();
const storageCount = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Storage' })
    .locator('li[data-location-id]')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${name} \\d`) }) })
    .getByTestId('location-count');

async function newLocation(page: Page, name: string, type: string, inside?: string) {
  await page.getByRole('button', { name: 'New location' }).click();
  const dialog = page.getByRole('dialog', { name: 'New location' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Type').selectOption(type);
  if (inside) {
    await dialog.getByRole('combobox', { name: 'Inside' }).click();
    await page.getByRole('option', { name: inside, exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Add location' }).click();
  await expect(dialog).toBeHidden();
}

/** Calls the real API, as a screen would, and answers its JSON. */
async function call<T>(
  request: APIRequestContext,
  method: 'get' | 'post',
  url: string,
  data?: unknown,
) {
  const res = await request[method](url, data === undefined ? undefined : { data });
  expect(res.ok(), `${method.toUpperCase()} ${url}`).toBe(true);
  return (await res.json()) as T;
}

/** Opens a card's page from the deck view and returns its Copies rows. */
async function copiesOf(page: Page, deckId: number, name: string) {
  await page.goto(`/decks/${deckId}`);
  await deckRow(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return page.getByRole('region', { name: 'Copies' }).locator('tbody tr[data-stack-id]');
}

/**
 * Ticks every line left on a walk list, one at a time, as Jeff would. A copy in another deck's
 * box asks first, and is pulled.
 */
async function tickEveryLine(page: Page, list: Locator, otherDeck?: string) {
  const open = list.locator('li[data-walk-line]:not([data-done])');
  await expect(open.first()).toBeVisible();
  for (let left = await open.count(); left > 0; left--) {
    const key = await open.first().getAttribute('data-walk-line');
    const line = list.locator(`li[data-walk-line="${key}"]`);
    const fromOtherDeck = otherDeck && (await line.textContent())?.includes(`${otherDeck} becomes`);
    await line.getByRole('checkbox').click();
    if (fromOtherDeck) {
      const confirm = page.getByRole('dialog', { name: /from the .* deck box\?$/ });
      await confirm.getByRole('button', { name: 'Pull it' }).click();
    }
    await expect(line).toHaveAttribute('data-done', 'true');
    await expect(open).toHaveCount(left - 1);
  }
}

test('1. storage is set up and the collection added to it', async ({ page }) => {
  await page.goto('/locations');
  await newLocation(page, 'Long box', 'box');
  await newLocation(page, 'Front row', 'box', 'Long box');
  await newLocation(page, 'Back row', 'box', 'Long box');
  await newLocation(page, LANDS_BINDER, 'binder');

  const { nodes } = await call<LocationTree>(page.request, 'get', '/api/locations/tree');
  const where = {
    Spells: nodes.find((node) => node.name === 'Front row')?.id,
    Lands: nodes.find((node) => node.name === LANDS_BINDER)?.id,
  };
  for (const { name: _name, location, ...copy } of flow.copies) {
    await call(page.request, 'post', '/api/stacks/add', {
      ...copy,
      misprint: false,
      altered: false,
      locationId: where[location],
    });
  }

  await page.goto('/locations');
  await expect(storageCount(page, 'Front row')).toHaveText(String(SPELLS_CARDS));
  await expect(storageCount(page, LANDS_BINDER)).toHaveText(String(LANDS_CARDS));
  await expect(storageCount(page, 'Back row')).toHaveText('0');
});

test('2. the Jinx Burn deck is added with statuses and paths', async ({ page }) => {
  const [legend, ...slots] = flow.deck;
  const deck = await call<{ id: number }>(page.request, 'post', '/api/decks', {
    name: 'Jinx Burn',
    legendId: legend?.cardId,
  });
  decks.jinxBurn = deck.id;
  for (const { cardId, board, quantity } of slots) {
    await call(page.request, 'post', `/api/decks/${deck.id}/slots`, { cardId, board, quantity });
  }
  await page.goto(`/decks/${decks.jinxBurn}`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jinx Burn');
  await expect(deckHeader(page)).toContainText('Not assembled');
  await expect(deckRow(page, 'Grim Scheme')).toContainText('Free');
  await expect(deckRow(page, 'Grim Scheme')).toContainText(FRONT_ROW);
  await expect(deckRow(page, 'Weathered Canyon')).toContainText('Free');
  await expect(deckRow(page, 'Weathered Canyon')).toContainText(LANDS_BINDER);
  // Targon's Peak is in both binders.
  await expect(deckRow(page, "Targon's Peak")).toContainText('+1 more');
  await expect(deckRow(page, 'Wary Sweep')).toContainText('Missing');
  await expect(deckRow(page, 'Calm Rune')).toContainText('Rune');
});

test('3. a second deck sharing Ember Signet is built in the app and assembled first', async ({
  page,
}) => {
  await page.goto('/decks/new');
  await page.getByLabel('Legend', { exact: true }).fill('lee sin');
  await page
    .getByRole('list', { name: 'Legend results' })
    .getByRole('button', { name: 'Lee Sin, Blind Monk' })
    .click();
  await page.getByLabel('Deck name', { exact: true }).fill('Lee Sin Combo');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/decks\/\d+$/);
  decks.leeSinBlindMonk = Number(new URL(page.url()).pathname.split('/').at(-1));

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Edit deck' });
  await panel.getByLabel('Add card', { exact: true }).fill('ember signet');
  await panel.getByRole('button', { name: 'Ember Signet' }).click();
  await expect(panel.getByRole('status')).toHaveText('Added Ember Signet to the main board.');
  await panel.getByRole('button', { name: 'Done editing' }).click();
  await expect(deckRow(page, 'Ember Signet')).toContainText('Free');

  await deckHeader(page).getByRole('link', { name: 'Assemble' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');
  await tickEveryLine(page, page.locator('[data-slot="walk-list"]'));
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(deckRow(page, 'Ember Signet')).toContainText('In deck box');
});

test('4. Jinx Burn is assembled from the pick list, borrowing a copy and adding a proxy', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/decks/${decks.jinxBurn}`);
  await expect(deckRow(page, 'Ember Signet')).toContainText('In other deck');
  await expect(deckRow(page, 'Ember Signet')).toContainText('Lee Sin Combo');
  await deckHeader(page).getByRole('link', { name: 'Assemble' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');

  const walk = page.locator('[data-slot="walk-list"]');
  await expect(walk.getByRole('region', { name: 'In other deck boxes' })).toContainText(
    'Ember Signet',
  );
  // The real Unbound Volley is suggested over the proxy next to it.
  const unboundVolley = walk.locator('li[data-walk-line]', { hasText: 'Unbound Volley' });
  await expect(unboundVolley).not.toContainText('Proxy');
  // Runes close the list in domain order, each with its domain icon.
  await expect(page.getByRole('region', { name: 'Runes' }).getByTestId('rune-count')).toHaveText([
    'Fury3 Fury Rune',
    'Calm8 Calm Rune',
    'Body1 Body Rune',
    'Chaos5 Chaos Rune',
  ]);

  await tickEveryLine(page, walk, 'Lee Sin Combo');

  const sweep = page.locator('[data-missing-line]', { hasText: 'Wary Sweep' });
  await sweep.getByRole('button', { name: 'Add proxy' }).click();
  // The deck list has no printing hints, so Jeff picks the proxy's printing.
  const printing = page.getByRole('dialog', {
    name: 'Pick a printing for the Wary Sweep proxy',
  });
  await printing.getByRole('button', { name: /^OGN-130\/298/ }).click();
  await expect(sweep).toContainText('Proxy added to the deck box');

  await page.getByRole('link', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(deckRow(page, 'Wary Sweep')).toContainText('Proxy');

  await page.goto(`/decks/${decks.leeSinBlindMonk}`);
  await expect(deckHeader(page)).toContainText('Partly assembled');
});

test('5. taking Jinx Burn apart puts every copy back where it came from', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/decks/${decks.jinxBurn}`);
  await deckHeader(page).getByRole('link', { name: 'Take apart' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Take apart Jinx Burn');
  const group = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(group('To sort')).toContainText('Wary Sweep');
  // The borrowed copy goes back to its storage spot, not to the deck it was borrowed from.
  await expect(group(FRONT_ROW)).toContainText('Ember Signet');
  await expect(page.getByRole('region', { name: /Lee Sin Combo/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'More for Iron Insight' }).click();
  await page.getByRole('menuitem', { name: 'Send elsewhere' }).click();
  const sendDialog = page.getByRole('dialog', { name: 'Send Iron Insight elsewhere' });
  await sendDialog.getByLabel('Location').click();
  await page.getByRole('option', { name: 'Back row', exact: true }).click();
  await sendDialog.getByRole('button', { name: 'Send here' }).click();
  await expect(group(BACK_ROW)).toContainText('Iron Insight');

  await page.getByRole('button', { name: 'Return all' }).click();
  const confirm = page.getByRole('dialog', { name: 'Return 78 cards?' });
  await confirm.getByRole('button', { name: 'Return 78 cards' }).click();
  await expect(page.getByRole('progressbar', { name: 'Cards put away' })).toHaveAttribute(
    'aria-valuetext',
    /^78 of 78/,
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Not assembled');

  // Storage holds what it held before, less Lee Sin Combo (in its deck box) and Iron Insight (sent on).
  await page.goto('/locations');
  await expect(storageCount(page, 'Front row')).toHaveText(String(SPELLS_CARDS - 2));
  await expect(storageCount(page, LANDS_BINDER)).toHaveText(String(LANDS_CARDS));
  await expect(storageCount(page, 'Back row')).toHaveText('1');
  await expect(page.getByRole('list', { name: 'Inbox' }).getByTestId('location-count')).toHaveText(
    '1',
  );

  const signet = await copiesOf(page, decks.jinxBurn, 'Ember Signet');
  await expect(signet).toHaveCount(1);
  await expect(signet).toContainText(FRONT_ROW);
  const tower = await copiesOf(page, decks.jinxBurn, "Targon's Peak");
  await expect(tower).toHaveCount(2);
  await expect(tower.filter({ hasText: LANDS_BINDER })).toHaveCount(1);
  await expect(tower.filter({ hasText: FRONT_ROW })).toHaveCount(1);
  const sunDisc = await copiesOf(page, decks.jinxBurn, 'Sun Disc');
  await expect(sunDisc).toHaveCount(1);
  await expect(sunDisc).toContainText(FRONT_ROW);
  const ironInsight = await copiesOf(page, decks.jinxBurn, 'Iron Insight');
  await expect(ironInsight).toContainText(BACK_ROW);
  const sweep = await copiesOf(page, decks.jinxBurn, 'Wary Sweep');
  await expect(sweep).toContainText('To sort');
  await expect(sweep).toContainText('Proxy');
});

test('6. undoing a pull from History puts the copy back and unfills the slot', async ({ page }) => {
  test.setTimeout(120_000);
  // Assemble Jinx Burn again; the proxy is now a free copy in To sort.
  await page.goto(`/decks/${decks.jinxBurn}/assemble`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');
  await expect(page.locator('[data-missing-line]')).toHaveCount(0);
  await tickEveryLine(page, page.locator('[data-slot="walk-list"]'));
  await page.goto(`/decks/${decks.jinxBurn}`);
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(deckRow(page, 'Grim Scheme')).toContainText('In deck box');

  await page.goto('/history');
  const pickList = page
    .locator('li[data-batch-id]')
    .filter({ has: page.getByRole('button', { name: /^Show the moves in Pick list/ }) })
    .first();
  await pickList.getByRole('button', { name: /^Show the moves in Pick list/ }).click();
  await pickList.getByRole('button', { name: 'Undo this move of Grim Scheme' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grim Scheme' })).toBeVisible();

  await page.goto(`/decks/${decks.jinxBurn}`);
  await expect(deckHeader(page)).toContainText('Partly assembled');
  await expect(deckRow(page, 'Grim Scheme')).toContainText('Free');
  await expect(deckRow(page, 'Grim Scheme')).toContainText(FRONT_ROW);
  const grimScheme = await copiesOf(page, decks.jinxBurn, 'Grim Scheme');
  await expect(grimScheme).toHaveCount(1);
  await expect(grimScheme).toContainText(FRONT_ROW);
});

test('7. after re-assembling, changing two cards goes through the swap list', async ({ page }) => {
  await page.goto(`/decks/${decks.jinxBurn}/assemble`);
  const walk = page.locator('[data-slot="walk-list"]');
  await expect(walk.locator('li[data-walk-line]')).toHaveCount(1);
  await tickEveryLine(page, walk);
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Assembled');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const name of ['Vast Scout', 'Rogue Captain']) {
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(deckRow(page, name)).toHaveCount(0);
  }
  const panel = page.getByRole('region', { name: 'Edit deck' });
  for (const name of ['Solar Adept', 'Proud Trapper']) {
    await panel.getByLabel('Add card', { exact: true }).fill(name.toLowerCase());
    await panel.getByRole('button', { name }).click();
    await expect(panel.getByRole('status')).toHaveText(`Added ${name} to the main board.`);
  }
  await panel.getByRole('button', { name: 'Done editing' }).click();
  await page
    .getByRole('status', { name: 'Swap list' })
    .getByRole('link', { name: 'Open swap list' })
    .click();

  await expect(page).toHaveURL(`/decks/${decks.jinxBurn}/swap`);
  const takeOut = page.getByRole('region', { name: 'Take out', exact: true });
  const pullIn = page.getByRole('region', { name: 'Pull in', exact: true });
  await expect(takeOut.getByRole('region', { name: FRONT_ROW })).toContainText('Vast Scout');
  await expect(takeOut.getByRole('region', { name: FRONT_ROW })).toContainText('Rogue Captain');
  await expect(pullIn.getByRole('region', { name: FRONT_ROW })).toContainText('Solar Adept');
  await expect(pullIn.getByRole('region', { name: FRONT_ROW })).toContainText('Proud Trapper');
  await tickEveryLine(page, takeOut);
  await tickEveryLine(page, pullIn);
  await expect(page.getByText('2 of 2 taken out · 2 of 2 pulled in')).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();

  await expect(page).toHaveURL(`/decks/${decks.jinxBurn}`);
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(page.getByRole('status', { name: 'Swap list' })).toHaveCount(0);
  await expect(deckRow(page, 'Solar Adept')).toContainText('In deck box');
  await expect(deckRow(page, 'Vast Scout')).toHaveCount(0);
});

test('8. deleting the second deck puts its cards away first', async ({ page }) => {
  await page.goto(`/decks/${decks.leeSinBlindMonk}`);
  const leeSinBlindMonkPage = await deckRow(page, 'Lee Sin, Blind Monk')
    .getByRole('link', { name: 'Lee Sin, Blind Monk', exact: true })
    .getAttribute('href');
  await deckHeader(page).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Lee Sin Combo?' });
  await expect(dialog).toContainText('Its deck box holds 1 card.');
  await dialog.getByRole('button', { name: 'Put cards away' }).click();

  await expect(page.getByRole('note')).toHaveText('Put these cards away to delete the deck');
  await expect(page.getByRole('region', { name: FRONT_ROW, exact: true })).toContainText(
    'Lee Sin, Blind Monk',
  );
  await page.getByRole('checkbox', { name: '1 Lee Sin, Blind Monk' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Lee Sin Combo/ })).toHaveCount(0);

  await page.goto(leeSinBlindMonkPage ?? '');
  const copies = page.getByRole('region', { name: 'Copies' }).locator('tbody tr[data-stack-id]');
  await expect(copies).toHaveCount(1);
  await expect(copies).toContainText(FRONT_ROW);
});
