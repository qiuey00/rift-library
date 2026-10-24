import { expect, type Locator, type Page, test } from '@playwright/test';
import type { CardDetailsResponse, CardSearchResponse } from '../../src/shared/api/cards';
import type { ActionResult } from '../../src/shared/api/common';
import type { AddCopiesBody } from '../../src/shared/api/copies';
import {
  cardNotFoundError,
  emberSanctum,
  emberSanctumDetails,
  emberSearch,
  emberSignet,
  emberSignetDetails,
  gildedWhelp,
  gildedWhelpDetails,
  publicCodeSearch,
} from '../../src/shared/api/samples/cards';
import { deckListSample } from '../../src/shared/api/samples/decks';
import { locationTreeSample } from '../../src/shared/api/samples/locations';
import {
  collectionValueSample,
  locationStacksSample,
  stacksPageSample,
} from '../../src/shared/api/samples/stacks';

// The Add cards dialog (quick add) with the API mocked from the samples. Searching "ember"
// finds Ember Signet (OGN-053 normal, VEN-367 normal and foil, SPD-331 normal) first, then
// Ember Sanctum (OGN-287); "gilded" finds Gilded Whelp (three printings, normal and foil);
// "sanctum" finds Ember Sanctum; a public code such as "VEN-367" finds Ember Signet.

const searches: Record<string, CardSearchResponse> = {
  ember: emberSearch,
  gilded: { results: [{ ...gildedWhelp, owned: 1, free: 1 }] },
  sanctum: { results: [{ ...emberSanctum, owned: 2, free: 2 }] },
  'VEN-367': publicCodeSearch,
};
const details: Record<number, CardDetailsResponse> = {
  [emberSignet.id]: emberSignetDetails,
  [gildedWhelp.id]: gildedWhelpDetails,
  [emberSanctum.id]: emberSanctumDetails,
};

async function mockApi(page: Page) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const added: AddCopiesBody[] = [];
  const undone: number[] = [];
  const stacks: URL[] = [];
  await page.route(
    (url) => url.pathname === '/api/stacks',
    (route) => {
      stacks.push(new URL(route.request().url()));
      return route.fulfill({ json: stacksPageSample });
    },
  );
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/decks', (route) => route.fulfill({ json: deckListSample }));
  await page.route('**/api/collection/value', (route) =>
    route.fulfill({ json: collectionValueSample }),
  );
  await page.route(
    (url) => /^\/api\/locations\/\d+\/stacks$/.test(url.pathname),
    (route) => route.fulfill({ json: locationStacksSample }),
  );
  await page.route(
    (url) => url.pathname === '/api/cards',
    (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? '';
      return route.fulfill({ json: searches[q] ?? { results: [] } });
    },
  );
  await page.route(
    (url) => /^\/api\/cards\/\d+$/.test(url.pathname),
    (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').pop());
      const json = details[id];
      return json
        ? route.fulfill({ json })
        : route.fulfill({ status: 404, json: cardNotFoundError });
    },
  );
  await page.route('**/api/stacks/add', (route) => {
    const body: AddCopiesBody = route.request().postDataJSON();
    added.push(body);
    const result: ActionResult = { message: 'Added', batchId: 200 + added.length };
    return route.fulfill({ json: result });
  });
  await page.route('**/api/batches/*/undo', (route) => {
    undone.push(Number(new URL(route.request().url()).pathname.split('/')[3]));
    const result: ActionResult = { message: 'Took back the add', batchId: null };
    return route.fulfill({ json: result });
  });
  return { added, undone, stacks };
}

async function openFromTopBar(page: Page) {
  await page.goto('/collection');
  await page.getByRole('banner').getByRole('button', { name: 'Add cards' }).click();
  return page.getByRole('dialog', { name: 'Add cards' });
}

const searchBox = (dialog: Locator) =>
  dialog.getByRole('combobox', { name: 'Card name or public code' });

const printings = (dialog: Locator) => dialog.getByRole('listbox', { name: 'Printings' });

/** Types a search and waits for its first printing to show. */
async function search(dialog: Locator, text: string, first: RegExp) {
  await searchBox(dialog).fill(text);
  await expect(printings(dialog).getByRole('option').first()).toHaveAccessibleName(first);
}

const addedLines = (dialog: Locator) =>
  dialog.getByRole('region', { name: 'Added' }).getByRole('listitem');

test('adds three cards in a row with only names and Enter', async ({ page }) => {
  const { added } = await mockApi(page);
  const dialog = await openFromTopBar(page);
  await expect(searchBox(dialog)).toBeFocused();
  await expect(dialog.getByRole('combobox', { name: 'Add to' })).toHaveText('To sort');

  for (const [text, first] of [
    ['ember', /Ember Signet, OGN-053/],
    ['gilded', /Gilded Whelp, SFD-052/],
    ['sanctum', /Ember Sanctum, OGN-287/],
  ] as const) {
    await search(dialog, text, first);
    await expect(printings(dialog).getByRole('option', { selected: true })).toHaveAccessibleName(
      first,
    );
    await searchBox(dialog).press('Enter');
    await expect(searchBox(dialog)).toHaveValue('');
    await expect(searchBox(dialog)).toBeFocused();
  }

  await expect.poll(() => added.length).toBe(3);
  const base = {
    quantity: 1,
    finish: 'normal',
    condition: 'near_mint',
    language: 'en',
    misprint: false,
    altered: false,
    isProxy: false,
    locationId: 1,
  };
  expect(added).toEqual([
    { ...base, printingId: emberSignetDetails.printings[0]?.printingId },
    { ...base, printingId: gildedWhelpDetails.printings[0]?.printingId },
    { ...base, printingId: emberSanctumDetails.printings[0]?.printingId },
  ]);
  // Newest first.
  await expect(addedLines(dialog)).toHaveCount(3);
  await expect(addedLines(dialog).nth(0)).toContainText('Ember Sanctum');
  await expect(addedLines(dialog).nth(0)).toContainText(
    'OGN-287/298 · Normal · Near mint · English → To sort',
  );
  await expect(addedLines(dialog).nth(1)).toContainText('Gilded Whelp');
  await expect(addedLines(dialog).nth(2)).toContainText('Ember Signet');
  await expect(dialog.getByTestId('added-summary')).toHaveText('3 cards added.');
  // The undo bar stays away while the dialog is open.
  await expect(page.locator('[data-slot=undo-bar]')).toHaveCount(0);
});

test('every field and the location keep their value from card to card', async ({ page }) => {
  const { added } = await mockApi(page);
  const dialog = await openFromTopBar(page);

  await dialog.getByRole('combobox', { name: 'Add to' }).click();
  await page.getByRole('option', { name: 'Rares binder', exact: true }).click();
  await dialog.getByRole('button', { name: 'More' }).click();
  await dialog.getByRole('button', { name: 'Foil' }).click();
  await dialog.getByLabel('Condition').selectOption('light_played');
  await dialog.getByLabel('Language').selectOption('ja');
  await dialog.getByRole('checkbox', { name: 'Proxy' }).check();

  // The arrow keys move to the foil printing, VEN-367.
  await search(dialog, 'ember', /Ember Signet, OGN-053/);
  await searchBox(dialog).press('ArrowRight');
  await expect(printings(dialog).getByRole('option', { selected: true })).toHaveAccessibleName(
    /VEN-367/,
  );
  await searchBox(dialog).press('Enter');
  await expect(searchBox(dialog)).toHaveValue('');

  await search(dialog, 'gilded', /Gilded Whelp, SFD-052/);
  await dialog.getByRole('button', { name: 'Add 2' }).click();
  await expect(searchBox(dialog)).toHaveValue('');
  await expect(searchBox(dialog)).toBeFocused();

  await expect.poll(() => added.length).toBe(2);
  const kept = {
    quantity: 2,
    finish: 'foil',
    condition: 'light_played',
    language: 'ja',
    misprint: false,
    altered: false,
    isProxy: true,
    locationId: 6,
  };
  expect(added).toEqual([
    { ...kept, printingId: emberSignetDetails.printings[1]?.printingId },
    { ...kept, printingId: gildedWhelpDetails.printings[0]?.printingId },
  ]);
  await expect(dialog.getByRole('combobox', { name: 'Add to' })).toHaveText('Rares binder');
  await expect(dialog.getByLabel('Condition')).toHaveValue('light_played');
  await expect(dialog.getByLabel('Language')).toHaveValue('ja');
  await expect(dialog.getByRole('checkbox', { name: 'Proxy' })).toBeChecked();
  await expect(addedLines(dialog).nth(0)).toContainText(
    'SFD-052/221 · Foil · Light played · Japanese → Rares binder',
  );
  await expect(addedLines(dialog).nth(0)).toContainText('Proxy');
});

test('a printing that only comes in normal adds as normal, keeping the foil pick', async ({
  page,
}) => {
  const { added } = await mockApi(page);
  const dialog = await openFromTopBar(page);
  await dialog.getByRole('button', { name: 'Foil' }).click();

  await search(dialog, 'ember', /Ember Signet, OGN-053/);
  await expect(dialog.getByRole('button', { name: 'Foil' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Normal' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await searchBox(dialog).press('Enter');
  await search(dialog, 'gilded', /Gilded Whelp/);
  await searchBox(dialog).press('Enter');

  await expect.poll(() => added.map((body) => body.finish)).toEqual(['normal', 'foil']);
});

test('a public code puts its printing first', async ({ page }) => {
  const { added } = await mockApi(page);
  const dialog = await openFromTopBar(page);

  await search(dialog, 'VEN-367', /Ember Signet, VEN-367/);
  await searchBox(dialog).press('Enter');

  await expect.poll(() => added[0]?.printingId).toBe(emberSignetDetails.printings[1]?.printingId);
});

test('Undo on an Added line takes back that add only', async ({ page }) => {
  const { added, undone } = await mockApi(page);
  const dialog = await openFromTopBar(page);

  await search(dialog, 'ember', /Ember Signet/);
  await searchBox(dialog).press('Enter');
  await expect(addedLines(dialog)).toHaveCount(1);
  await search(dialog, 'gilded', /Gilded Whelp/);
  await searchBox(dialog).press('Enter');
  await expect(addedLines(dialog)).toHaveCount(2);
  expect(added).toHaveLength(2);

  await addedLines(dialog)
    .filter({ hasText: 'Ember Signet' })
    .getByRole('button', { name: 'Undo' })
    .click();

  await expect(addedLines(dialog)).toHaveCount(1);
  await expect(addedLines(dialog).first()).toContainText('Gilded Whelp');
  // The first add was batch 201.
  expect(undone).toEqual([201]);
  await expect(dialog.getByTestId('added-summary')).toHaveText('1 card added.');
  await expect(page.locator('[data-slot=undo-bar]')).toHaveCount(0);
});

test('typing the next card before an add finishes keeps what was typed', async ({ page }) => {
  await mockApi(page);
  // Hold the add's answer until the next search is typed (the last route added wins).
  let answer = () => {};
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route('**/api/stacks/add', async (route) => {
    await held;
    const result: ActionResult = { message: 'Added', batchId: 301 };
    return route.fulfill({ json: result });
  });
  const dialog = await openFromTopBar(page);

  await search(dialog, 'ember', /Ember Signet/);
  await searchBox(dialog).press('Enter');
  await searchBox(dialog).fill('gilded');
  answer();

  await expect(addedLines(dialog)).toHaveCount(1);
  await expect(searchBox(dialog)).toHaveValue('gilded');
  await expect(printings(dialog).getByRole('option').first()).toHaveAccessibleName(/Gilded Whelp/);
});

test('Close returns to the screen underneath, which refreshes', async ({ page }) => {
  const { stacks } = await mockApi(page);
  const dialog = await openFromTopBar(page);
  await expect.poll(() => stacks.length).toBeGreaterThan(0);

  await search(dialog, 'ember', /Ember Signet/);
  await searchBox(dialog).press('Enter');
  await expect(addedLines(dialog)).toHaveCount(1);
  const before = stacks.length;
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => stacks.length).toBeGreaterThan(before);
});

test('opened from a location, that location starts picked', async ({ page }) => {
  const { added } = await mockApi(page);
  await page.goto('/locations?selected=6');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add cards' });

  await expect(dialog.getByRole('combobox', { name: 'Add to' })).toHaveText('Rares binder');
  await expect(searchBox(dialog)).toBeFocused();
  await search(dialog, 'ember', /Ember Signet/);
  await searchBox(dialog).press('Enter');

  await expect.poll(() => added[0]?.locationId).toBe(6);
  await expect(addedLines(dialog).first()).toContainText('→ Rares binder');
});
