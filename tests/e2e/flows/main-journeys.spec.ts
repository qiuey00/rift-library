import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import type { LocationTree } from '../../../src/shared/api/locations';

// Jeff's main journeys through the real app and server, with no API mocks: set up storage,
// add a collection and a deck, assemble it from the pick list, take it apart, undo, change it
// through the swap list and delete a deck. The journeys share one database, so they run in
// order and each starts where the one before stopped. The cards are Magic stand-ins until
// the Riftbound flows (#26).
//
// flow-collection.json holds the Hearthhull deck's list and its nonbasic cards in two groups,
// Spells (58 cards) and Lands (25), less Worldsoul's Rage, which is added as a proxy. It has
// two Sol Rings, a Command Tower in each group and a proxy Beast Within next to a real one,
// plus Tymna the Weaver for the second deck and Primeval Titan and Seven Dwarves to swap in.

type FlowCollection = {
  copies: {
    name: string;
    printingId: string;
    quantity: number;
    finish: 'nonfoil' | 'foil' | 'etched';
    condition: string;
    language: string;
    isProxy: boolean;
    location: 'Spells' | 'Lands';
  }[];
  deck: {
    name: string;
    oracleId: string;
    board: 'commander' | 'main' | 'maybe';
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
const decks = { hearthhull: 0, tymna: 0 };

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

test('2. the Hearthhull deck is added with statuses and paths', async ({ page }) => {
  const [commander, ...slots] = flow.deck;
  const deck = await call<{ id: number }>(page.request, 'post', '/api/decks', {
    name: 'Hearthhull',
    commanders: [commander?.oracleId],
  });
  decks.hearthhull = deck.id;
  for (const { oracleId, board, quantity } of slots) {
    await call(page.request, 'post', `/api/decks/${deck.id}/slots`, { oracleId, board, quantity });
  }
  await page.goto(`/decks/${decks.hearthhull}`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hearthhull');
  await expect(deckHeader(page)).toContainText('Not assembled');
  await expect(deckRow(page, 'Cultivate')).toContainText('Free');
  await expect(deckRow(page, 'Cultivate')).toContainText(FRONT_ROW);
  await expect(deckRow(page, 'Cinder Glade')).toContainText('Free');
  await expect(deckRow(page, 'Cinder Glade')).toContainText(LANDS_BINDER);
  // Command Tower is in both binders.
  await expect(deckRow(page, 'Command Tower')).toContainText('+1 more');
  await expect(deckRow(page, "Worldsoul's Rage")).toContainText('Missing');
  await expect(deckRow(page, 'Forest')).toContainText('Basic');
});

test('3. a second deck sharing Arcane Signet is built in the app and assembled first', async ({
  page,
}) => {
  await page.goto('/decks/new');
  await page.getByLabel('Commander', { exact: true }).fill('tymna');
  await page
    .getByRole('list', { name: 'Commander results' })
    .getByRole('button', { name: 'Tymna the Weaver' })
    .click();
  await page.getByLabel('Deck name', { exact: true }).fill('Tymna');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/decks\/\d+$/);
  decks.tymna = Number(new URL(page.url()).pathname.split('/').at(-1));

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Edit deck' });
  await panel.getByLabel('Add card', { exact: true }).fill('arcane signet');
  await panel.getByRole('button', { name: 'Arcane Signet' }).click();
  await expect(panel.getByRole('status')).toHaveText('Added Arcane Signet to the main board.');
  await panel.getByRole('button', { name: 'Done editing' }).click();
  await expect(deckRow(page, 'Arcane Signet')).toContainText('Free');

  await deckHeader(page).getByRole('link', { name: 'Assemble' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');
  await tickEveryLine(page, page.locator('[data-slot="walk-list"]'));
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(deckRow(page, 'Arcane Signet')).toContainText('In deck box');
});

test('4. Hearthhull is assembled from the pick list, borrowing a copy and adding a proxy', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/decks/${decks.hearthhull}`);
  await expect(deckRow(page, 'Arcane Signet')).toContainText('In other deck');
  await expect(deckRow(page, 'Arcane Signet')).toContainText('Tymna');
  await deckHeader(page).getByRole('link', { name: 'Assemble' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');

  const walk = page.locator('[data-slot="walk-list"]');
  await expect(walk.getByRole('region', { name: 'In other deck boxes' })).toContainText(
    'Arcane Signet',
  );
  // The real Beast Within is suggested over the proxy next to it.
  const beastWithin = walk.locator('li[data-walk-line]', { hasText: 'Beast Within' });
  await expect(beastWithin).not.toContainText('Proxy');
  await expect(page.getByRole('region', { name: 'Basic lands' })).toContainText(
    '8 Forest, 3 Mountain, 5 Swamp, 1 Wastes',
  );

  await tickEveryLine(page, walk, 'Tymna');

  const rage = page.locator('[data-missing-line]', { hasText: "Worldsoul's Rage" });
  await rage.getByRole('button', { name: 'Add proxy' }).click();
  // The deck list has no printing hints, so Jeff picks the proxy's printing.
  const printing = page.getByRole('dialog', {
    name: "Pick a printing for the Worldsoul's Rage proxy",
  });
  await printing.getByRole('button', { name: /^EOC #130/ }).click();
  await expect(rage).toContainText('Proxy added to the deck box');

  await page.getByRole('link', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(deckRow(page, "Worldsoul's Rage")).toContainText('Proxy');

  await page.goto(`/decks/${decks.tymna}`);
  await expect(deckHeader(page)).toContainText('Partly assembled');
});

test('5. taking Hearthhull apart puts every copy back where it came from', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/decks/${decks.hearthhull}`);
  await deckHeader(page).getByRole('link', { name: 'Take apart' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Take apart Hearthhull');
  const group = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(group('To sort')).toContainText("Worldsoul's Rage");
  // The borrowed copy goes back to its storage spot, not to the deck it was borrowed from.
  await expect(group(FRONT_ROW)).toContainText('Arcane Signet');
  await expect(page.getByRole('region', { name: /Tymna/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'More for Farseek' }).click();
  await page.getByRole('menuitem', { name: 'Send elsewhere' }).click();
  const sendDialog = page.getByRole('dialog', { name: 'Send Farseek elsewhere' });
  await sendDialog.getByLabel('Location').click();
  await page.getByRole('option', { name: 'Back row', exact: true }).click();
  await sendDialog.getByRole('button', { name: 'Send here' }).click();
  await expect(group(BACK_ROW)).toContainText('Farseek');

  await page.getByRole('button', { name: 'Return all' }).click();
  const confirm = page.getByRole('dialog', { name: 'Return 78 cards?' });
  await confirm.getByRole('button', { name: 'Return 78 cards' }).click();
  await expect(page.getByRole('progressbar', { name: 'Cards put away' })).toHaveAttribute(
    'aria-valuetext',
    /^78 of 78/,
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Not assembled');

  // Storage holds what it held before, less Tymna (in its deck box) and Farseek (sent on).
  await page.goto('/locations');
  await expect(storageCount(page, 'Front row')).toHaveText(String(SPELLS_CARDS - 2));
  await expect(storageCount(page, LANDS_BINDER)).toHaveText(String(LANDS_CARDS));
  await expect(storageCount(page, 'Back row')).toHaveText('1');
  await expect(page.getByRole('list', { name: 'Inbox' }).getByTestId('location-count')).toHaveText(
    '1',
  );

  const signet = await copiesOf(page, decks.hearthhull, 'Arcane Signet');
  await expect(signet).toHaveCount(1);
  await expect(signet).toContainText(FRONT_ROW);
  const tower = await copiesOf(page, decks.hearthhull, 'Command Tower');
  await expect(tower).toHaveCount(2);
  await expect(tower.filter({ hasText: LANDS_BINDER })).toHaveCount(1);
  await expect(tower.filter({ hasText: FRONT_ROW })).toHaveCount(1);
  const solRing = await copiesOf(page, decks.hearthhull, 'Sol Ring');
  await expect(solRing).toHaveCount(1);
  await expect(solRing).toContainText(FRONT_ROW);
  const farseek = await copiesOf(page, decks.hearthhull, 'Farseek');
  await expect(farseek).toContainText(BACK_ROW);
  const rage = await copiesOf(page, decks.hearthhull, "Worldsoul's Rage");
  await expect(rage).toContainText('To sort');
  await expect(rage).toContainText('Proxy');
});

test('6. undoing a pull from History puts the copy back and unfills the slot', async ({ page }) => {
  test.setTimeout(120_000);
  // Assemble Hearthhull again; the proxy is now a free copy in To sort.
  await page.goto(`/decks/${decks.hearthhull}/assemble`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick list');
  await expect(page.locator('[data-missing-line]')).toHaveCount(0);
  await tickEveryLine(page, page.locator('[data-slot="walk-list"]'));
  await page.goto(`/decks/${decks.hearthhull}`);
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(deckRow(page, 'Cultivate')).toContainText('In deck box');

  await page.goto('/history');
  const pickList = page
    .locator('li[data-batch-id]')
    .filter({ has: page.getByRole('button', { name: /^Show the moves in Pick list/ }) })
    .first();
  await pickList.getByRole('button', { name: /^Show the moves in Pick list/ }).click();
  await pickList.getByRole('button', { name: 'Undo this move of Cultivate' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cultivate' })).toBeVisible();

  await page.goto(`/decks/${decks.hearthhull}`);
  await expect(deckHeader(page)).toContainText('Partly assembled');
  await expect(deckRow(page, 'Cultivate')).toContainText('Free');
  await expect(deckRow(page, 'Cultivate')).toContainText(FRONT_ROW);
  const cultivate = await copiesOf(page, decks.hearthhull, 'Cultivate');
  await expect(cultivate).toHaveCount(1);
  await expect(cultivate).toContainText(FRONT_ROW);
});

test('7. after re-assembling, changing two cards goes through the swap list', async ({ page }) => {
  await page.goto(`/decks/${decks.hearthhull}/assemble`);
  const walk = page.locator('[data-slot="walk-list"]');
  await expect(walk.locator('li[data-walk-line]')).toHaveCount(1);
  await tickEveryLine(page, walk);
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(deckHeader(page)).toContainText('Assembled');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const name of ['Tireless Tracker', 'Mayhem Devil']) {
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(deckRow(page, name)).toHaveCount(0);
  }
  const panel = page.getByRole('region', { name: 'Edit deck' });
  for (const name of ['Primeval Titan', 'Seven Dwarves']) {
    await panel.getByLabel('Add card', { exact: true }).fill(name.toLowerCase());
    await panel.getByRole('button', { name }).click();
    await expect(panel.getByRole('status')).toHaveText(`Added ${name} to the main board.`);
  }
  await panel.getByRole('button', { name: 'Done editing' }).click();
  await page
    .getByRole('status', { name: 'Swap list' })
    .getByRole('link', { name: 'Open swap list' })
    .click();

  await expect(page).toHaveURL(`/decks/${decks.hearthhull}/swap`);
  const takeOut = page.getByRole('region', { name: 'Take out', exact: true });
  const pullIn = page.getByRole('region', { name: 'Pull in', exact: true });
  await expect(takeOut.getByRole('region', { name: FRONT_ROW })).toContainText('Tireless Tracker');
  await expect(takeOut.getByRole('region', { name: FRONT_ROW })).toContainText('Mayhem Devil');
  await expect(pullIn.getByRole('region', { name: FRONT_ROW })).toContainText('Primeval Titan');
  await expect(pullIn.getByRole('region', { name: FRONT_ROW })).toContainText('Seven Dwarves');
  await tickEveryLine(page, takeOut);
  await tickEveryLine(page, pullIn);
  await expect(page.getByText('2 of 2 taken out · 2 of 2 pulled in')).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();

  await expect(page).toHaveURL(`/decks/${decks.hearthhull}`);
  await expect(deckHeader(page)).toContainText('Assembled');
  await expect(page.getByRole('status', { name: 'Swap list' })).toHaveCount(0);
  await expect(deckRow(page, 'Primeval Titan')).toContainText('In deck box');
  await expect(deckRow(page, 'Tireless Tracker')).toHaveCount(0);
});

test('8. deleting the second deck puts its cards away first', async ({ page }) => {
  await page.goto(`/decks/${decks.tymna}`);
  const tymnaPage = await deckRow(page, 'Tymna the Weaver')
    .getByRole('link', { name: 'Tymna the Weaver', exact: true })
    .getAttribute('href');
  await deckHeader(page).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Tymna?' });
  await expect(dialog).toContainText('Its deck box holds 1 card.');
  await dialog.getByRole('button', { name: 'Put cards away' }).click();

  await expect(page.getByRole('note')).toHaveText('Put these cards away to delete the deck');
  await expect(page.getByRole('region', { name: FRONT_ROW, exact: true })).toContainText(
    'Tymna the Weaver',
  );
  await page.getByRole('checkbox', { name: '1 Tymna the Weaver' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Tymna/ })).toHaveCount(0);

  await page.goto(tymnaPage ?? '');
  const copies = page.getByRole('region', { name: 'Copies' }).locator('tbody tr[data-stack-id]');
  await expect(copies).toHaveCount(1);
  await expect(copies).toContainText(FRONT_ROW);
});
