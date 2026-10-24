import { expect, type Page, test } from '@playwright/test';
import type { NewBuyItems } from '../../src/shared/api/buy-list';
import type { DeckSummary } from '../../src/shared/api/decks';
import { buyListSample } from '../../src/shared/api/samples/buy-list';
import { emberSignetDetails, emberSignetPrintings } from '../../src/shared/api/samples/cards';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import { deckViewSample, jinxBurn, slotSample } from '../../src/shared/api/samples/decks';

// The deck view with the API mocked from the samples: the Jinx Burn deck (id 1).

async function mockDeck(page: Page, deck: Partial<DeckSummary> = {}) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/1', (route) =>
    route.fulfill({ json: { ...deckViewSample, deck: { ...jinxBurn, ...deck } } }),
  );
  await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
}

const row = (page: Page, slotId: number) => page.locator(`li[data-slot-id="${slotId}"]`);
const group = (page: Page, name: string, panel = 'Decklist') =>
  page.getByRole('region', { name: panel }).getByRole('region', { name, exact: true });
const groupNames = (page: Page) =>
  page.getByRole('region', { name: 'Decklist' }).getByRole('heading', { level: 2 });

test.beforeEach(async ({ page }) => {
  await mockDeck(page);
});

test('the header shows the deck, its state and its actions', async ({ page }) => {
  await page.goto('/decks/1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jinx Burn');
  const header = page.getByRole('region', { name: 'Deck header' });
  await expect(header).toContainText('Partly assembled');
  await expect(header).toContainText('95 cards');
  await expect(header.getByRole('link', { name: 'Assemble' })).toHaveAttribute(
    'href',
    '/decks/1/assemble',
  );
  await expect(header.getByRole('link', { name: 'Take apart' })).toHaveAttribute(
    'href',
    '/decks/1/take-apart',
  );
  await expect(header.getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    '/history?deck=1',
  );

  await header.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Jinx Burn' })).toBeVisible();
});

test('an assembled deck has no Assemble; an empty deck box has no Take apart', async ({ page }) => {
  await mockDeck(page, { state: 'assembled' });
  await page.goto('/decks/1');
  const header = page.getByRole('region', { name: 'Deck header' });
  await expect(header).toContainText('Assembled');
  await expect(header.getByRole('link', { name: 'Assemble' })).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Take apart' })).toBeVisible();

  await mockDeck(page, { state: 'not_assembled', boxCopyCount: 0 });
  await page.reload();
  await expect(header).toContainText('Not assembled');
  await expect(header.getByRole('link', { name: 'Assemble' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Take apart' })).toHaveCount(0);
});

test('Rename saves the new name', async ({ page }) => {
  let sent: unknown = null;
  await page.route('**/api/decks/1', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { ...jinxBurn, name: 'Worldseed' } });
  });
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename deck' });
  await dialog.getByLabel('Deck name').fill('Worldseed');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual({ name: 'Worldseed' });
});

test('the availability panel counts the cards by where they are', async ({ page }) => {
  await page.goto('/decks/1');
  const panel = page.getByRole('region', { name: 'Where the cards are' });
  await expect(
    panel.getByRole('img', {
      name: '58 in deck box, 13 free, 4 in other decks, 3 missing, 17 runes',
    }),
  ).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveText([
    '58in deck box',
    '13free',
    '4in other decks',
    '3missing',
    '17runes',
  ]);
});

test('Add missing sends every missing card to the buy list after one confirmation', async ({
  page,
}) => {
  let sent: NewBuyItems | null = null;
  await page.route('**/api/buy-list/bulk', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: buyListSample });
  });
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Add missing to buy list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add missing cards to the buy list?' });
  await expect(dialog.getByRole('listitem')).toHaveText([
    '1Swift Ox',
    '1Nasus, Trickster',
    '1Twilight Flare',
  ]);
  expect(sent).toBeNull();
  await dialog.getByRole('button', { name: 'Add 3 to buy list' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').getByText('Added 3 cards to the buy list')).toBeVisible();
  expect(sent).toEqual({
    items: [
      { cardId: deckViewSample.slots.find((s) => s.id === 119)?.card.id, quantity: 1 },
      { cardId: deckViewSample.slots.find((s) => s.id === 120)?.card.id, quantity: 1 },
      { cardId: deckViewSample.slots.find((s) => s.id === 124)?.card.id, quantity: 1 },
    ],
  });
});

test('rows show only the cards until Show status is turned on', async ({ page }) => {
  await page.goto('/decks/1');
  const toggle = page.getByRole('button', { name: 'Show status' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, 119)).toContainText('Swift Ox');
  await expect(page.getByRole('region', { name: 'Decklist' }).locator('[data-status]')).toHaveCount(
    0,
  );
  await expect(row(page, 160)).not.toContainText('Proxy');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 119)).toContainText('Missing');

  // The choice is remembered.
  await page.reload();
  await expect(row(page, 119)).toContainText('Missing');
});

test('rows show each status, with location paths and the other decks', async ({ page }) => {
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Show status' }).click();

  // In the deck box, with a proxy.
  await expect(row(page, 160)).toContainText('Senna, Outlaw');
  await expect(row(page, 160)).toContainText('In deck box');
  await expect(row(page, 160)).toContainText('Proxy');

  // Free: the best location's path, and how many more locations have one.
  await expect(row(page, 104)).toContainText('Free');
  await expect(row(page, 104)).toContainText('Long box › Chaos & Calm+1 more');
  await expect(row(page, 106)).toContainText('Long box › Chaos & Calm');
  await expect(row(page, 106)).not.toContainText('more');

  // Only in other decks, naming them.
  await expect(row(page, 118)).toContainText('In other deck');
  await expect(row(page, 118)).toContainText('Lux Control, Ahri Midrange');

  // Missing. Rows carry no Add to buy list link; it is on the right-click menu.
  await expect(row(page, 119)).toContainText('Missing');
  await expect(
    page.getByRole('region', { name: 'Decklist' }).getByText('Add to buy list'),
  ).toHaveCount(0);

  // Runes show a grey count; maybe board rows have no status.
  await expect(row(page, 125)).toContainText('8Calm Rune');
  await expect(row(page, 125)).toContainText('Rune');
  await expect(row(page, 185).locator('[data-status]')).toHaveCount(0);

  // The name opens the card page.
  await row(page, 114).getByRole('link', { name: 'Sun Disc' }).click();
  await expect(page).toHaveURL(/\/cards\/\d+$/);
});

test('Group by Type puts cards in deck list order, with the boards after the main deck', async ({
  page,
}) => {
  await page.goto('/decks/1');
  await expect(groupNames(page)).toHaveText([
    'Legend1',
    /^Units\d+$/,
    /^Spells\d+$/,
    /^Gear\d+$/,
    /^Other\d+$/,
    'Battlefields3',
    'Runes17',
  ]);

  const runes = group(page, 'Runes');
  const names = await runes.locator('li a').allTextContents();
  expect(names).toContain('Calm Rune');
  expect(names).toContain('Body Rune');
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  // The Legend goes in Legend, never with the main deck's cards.
  await expect(group(page, 'Legend')).toContainText('Jinx, Loose Cannon');
  await expect(group(page, 'Gear')).not.toContainText('Jinx, Loose Cannon');
});

test('Group by Where it is, and Sort by energy', async ({ page }) => {
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Show status' }).click();
  await page.getByRole('button', { name: 'Where it is' }).click();
  await expect(groupNames(page)).toHaveText([
    'In deck box58',
    'Free in storage13',
    'Only in other decks4',
    'Missing3',
    'Runes17',
  ]);

  // Free cards stay in location order.
  const paths = await group(page, 'Free in storage')
    .locator('li[data-slot-id]')
    .evaluateAll((rows) =>
      rows.map((li) => li.querySelector('[data-location-type] + span')?.textContent ?? ''),
    );
  expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));

  await page.getByRole('button', { name: 'Energy' }).click();
  await expect(page.getByRole('button', { name: 'Energy' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const missing = await group(page, 'Missing').locator('li a').allTextContents();
  // Swift Ox and Twilight Flare (4) go by name, then Nasus, Trickster (7).
  expect(missing).toEqual(['Swift Ox', 'Twilight Flare', 'Nasus, Trickster']);
});

test('the maybe board is its own panel below the decklist, grouped by type', async ({ page }) => {
  await page.goto('/decks/1');
  const decklist = page.getByRole('region', { name: 'Decklist' });
  const maybe = page.getByRole('region', { name: 'Maybe board', exact: true });
  await expect(maybe.getByRole('heading', { level: 2 })).toHaveText('Maybe board5 cards');
  await expect(maybe.getByRole('heading', { level: 3 })).toHaveText(['Units5']);
  await expect(maybe.locator('li a')).toHaveText([
    'Dawn Harrier',
    'Hextech Captain',
    'Ivory Reaver',
    'Primal Priest',
    'Volibear, Vanguard',
  ]);
  await expect(decklist.locator('li[data-slot-id="185"]')).toHaveCount(0);
  // Below the decklist, not beside it.
  const listBox = await decklist.boundingBox();
  const maybeBox = await maybe.boundingBox();
  expect(maybeBox?.y).toBeGreaterThan((listBox?.y ?? 0) + (listBox?.height ?? 0));

  // Maybe cards have no status, so the panel keeps its type groups under Where it is.
  await page.getByRole('button', { name: 'Where it is' }).click();
  await expect(maybe.getByRole('heading', { level: 3 })).toHaveText(['Units5']);
  await page.getByRole('button', { name: 'Images' }).click();
  await expect(maybe.getByRole('heading', { level: 3 })).toHaveText(['Units5']);
  await expect(maybe.locator('li[data-slot-id]')).toHaveCount(5);
});

test('a deck with no maybe cards has no maybe board panel', async ({ page }) => {
  await page.route('**/api/decks/1', (route) =>
    route.fulfill({
      json: {
        ...deckViewSample,
        slots: deckViewSample.slots.filter((slot) => slot.board !== 'maybe'),
      },
    }),
  );
  await page.goto('/decks/1');
  await expect(page.getByRole('region', { name: 'Decklist' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Maybe board', exact: true })).toHaveCount(0);
});

test('the demand warning shows in the side pane, not on the card row', async ({ page }) => {
  await page.goto('/decks/1');
  await expect(row(page, 118)).toContainText('Ember Signet');
  await expect(row(page, 118)).not.toContainText('decks want');
  const demand = page.getByRole('list', { name: 'Demand warnings' });
  await expect(demand).toContainText('Ember Signet');
  await expect(demand).toContainText('3 decks want Ember Signet, you own 2');
});

test('right-clicking a card offers Add to buy list, with the missing count', async ({ page }) => {
  await page.goto('/decks/1');
  await row(page, 119).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to buy list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to buy list' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Quantity')).toHaveValue('1');
  await page.keyboard.press('Escape');

  // In Images view too.
  await page.getByRole('button', { name: 'Images' }).click();
  await row(page, 104).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Add to buy list' })).toBeVisible();
});

/** Keeps the body of every PATCH to the slot, answering with a slot. */
async function captureSlotChanges(page: Page, slotId: number) {
  const sent: unknown[] = [];
  await page.route(`**/api/decks/1/slots/${slotId}`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: slotSample });
  });
  return sent;
}

test('right-click moves a card between the main and maybe boards, never the Legend', async ({
  page,
}) => {
  const toMaybe = await captureSlotChanges(page, 114);
  const toMain = await captureSlotChanges(page, 187);
  await page.goto('/decks/1');

  await row(page, 114).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move to main board' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Move to maybe board' }).click();
  await expect.poll(() => toMaybe).toEqual([{ board: 'maybe' }]);

  await row(page, 187).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move to maybe board' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Move to main board' }).click();
  await expect.poll(() => toMain).toEqual([{ board: 'main' }]);

  await row(page, 101).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Change printing…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Move to/ })).toHaveCount(0);
});

test('Change printing lists the printings and saves the one picked, with foil', async ({
  page,
}) => {
  await page.route('**/api/cards/*', (route) => route.fulfill({ json: emberSignetDetails }));
  const changes = await captureSlotChanges(page, 118);
  await page.goto('/decks/1');

  // Mid-screen, so the menu opens below the pointer rather than up over it.
  await row(page, 118).evaluate((li) => li.scrollIntoView({ block: 'center' }));
  await row(page, 118).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change printing…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change printing' });
  const printings = dialog.getByRole('radiogroup', { name: 'Printings' }).getByRole('radio');
  await expect(printings).toHaveCount(3);
  await expect(printings.first()).toHaveAccessibleName(/OGN #53 \(in the deck now\)/);
  await expect(printings.first()).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(dialog.getByLabel('Foil')).toBeDisabled();

  const ven = emberSignetPrintings[1];
  await dialog.getByRole('radio', { name: /VEN #367/ }).click();
  await dialog.getByLabel('Foil').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(changes).toEqual([{ printing: { printingId: ven?.printingId, foil: true } }]);
});

test('Change printing says a copy in the deck box stays', async ({ page }) => {
  await page.route('**/api/cards/*', (route) =>
    route.fulfill({ json: { ...emberSignetDetails, printings: emberSignetPrintings } }),
  );
  const view = structuredClone(deckViewSample);
  const signet = view.slots.find((slot) => slot.id === 118);
  if (signet) Object.assign(signet, { inBoxQuantity: 1, pickedPrinting: emberSignetPrintings[0] });
  await page.route('**/api/decks/1', (route) =>
    route.fulfill({ json: { ...view, deck: jinxBurn } }),
  );
  await page.goto('/decks/1');

  // Mid-screen, so the menu opens below the pointer rather than up over it.
  await row(page, 118).evaluate((li) => li.scrollIntoView({ block: 'center' }));
  await row(page, 118).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change printing…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change printing' });
  await dialog.getByRole('radio', { name: /SPD #331/ }).click();
  await expect(dialog).toContainText(
    'The deck box already holds the OGN #53 copy. It stays there and still counts for this card.',
  );
});

test('the card menu opens from the keyboard', async ({ page }) => {
  await page.goto('/decks/1');
  await row(page, 114).getByRole('link', { name: 'Sun Disc' }).focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Add to buy list' }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add to buy list' })).toBeVisible();
});

test('the side pane lists the deck checks that warn as notes', async ({ page }) => {
  await page.goto('/decks/1');
  const checks = page.getByRole('list', { name: 'Deck checks' });
  await expect(checks.getByRole('listitem')).toHaveText(
    deckChecksSample.checks
      .filter((check) => check.result === 'warn')
      .map((check) => check.message),
  );
});

test('the card preview follows the hovered row', async ({ page }) => {
  await page.goto('/decks/1');
  const preview = page.getByRole('region', { name: 'Card preview' });
  await expect(preview.getByRole('img')).toHaveAttribute('alt', 'Jinx, Loose Cannon');
  await row(page, 114).hover();
  await expect(preview.getByRole('img')).toHaveAttribute('alt', 'Sun Disc');
  await expect(preview.getByRole('link', { name: 'Open card page' })).toBeVisible();
});

test('the card preview stays whole in view down to the end of the decklist', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/decks/1');
  const preview = page.getByRole('region', { name: 'Card preview' });
  await expect(preview).toBeInViewport();
  await page.mouse.wheel(0, 20000);
  await expect
    .poll(() => page.evaluate(() => window.scrollY + window.innerHeight))
    .toBe(await page.evaluate(() => document.documentElement.scrollHeight));
  await expect(preview).toBeInViewport({ ratio: 1 });
});

test('a long side pane scrolls the deck checks under a pinned card preview', async ({ page }) => {
  const demand = Array.from({ length: 40 }, (_, i) => ({
    ...deckChecksSample.demand[0],
    card: { ...deckChecksSample.demand[0].card, oracleId: `demand-${i}`, name: `Card ${i}` },
  }));
  await page.route('**/api/decks/1/checks', (route) =>
    route.fulfill({ json: { ...deckChecksSample, demand } }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/decks/1');
  const pane = page.getByRole('complementary', { name: 'Card preview and deck checks' });
  const checks = page.getByTestId('deck-checks-panel');
  const preview = page.getByRole('region', { name: 'Card preview' });
  await expect(page.getByRole('list', { name: 'Demand warnings' })).toContainText('Card 39');
  const box = await pane.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(900);
  await page.mouse.wheel(0, 5000);
  await checks.hover();
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => checks.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'Card 39' })).toBeInViewport();
  await expect(preview).toBeInViewport({ ratio: 1 });
});

test('the rows / images switch is remembered', async ({ page }) => {
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Images' }).click();
  await expect(row(page, 114).getByRole('img', { name: 'Sun Disc' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Images' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(row(page, 114).getByRole('img', { name: 'Sun Disc' })).toBeVisible();
  await page.getByRole('button', { name: 'Rows' }).click();
  await expect(row(page, 114).getByRole('img')).toHaveCount(0);
});

test('the deck view keeps its own rows / images choice', async ({ page }) => {
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Images' }).click();
  const stored = await page.evaluate(() => [
    localStorage.getItem('deck-view'),
    localStorage.getItem('buy-list-view'),
  ]);
  expect(stored).toEqual(['images', null]);
});

test('a deck with only its Legend offers Add cards', async ({ page }) => {
  await page.route('**/api/decks/1', (route) =>
    route.fulfill({
      json: {
        ...deckViewSample,
        slots: deckViewSample.slots.filter((slot) => slot.board === 'legend'),
      },
    }),
  );
  await page.goto('/decks/1');
  const empty = page.getByRole('region', { name: 'Empty deck' });
  await empty.getByRole('button', { name: 'Add cards' }).click();
  await expect(empty).toHaveCount(0);
});
