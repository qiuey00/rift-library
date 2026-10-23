import { expect, type Page, test } from '@playwright/test';
import type { AddCopiesBody } from '../../src/shared/api/copies';
import {
  arcaneSearch,
  arcaneSignet,
  arcaneSignetDetails,
  arcaneSignetPrintings,
} from '../../src/shared/api/samples/cards';
import { addCopiesResultSample } from '../../src/shared/api/samples/copies';
import { locationTreeSample } from '../../src/shared/api/samples/locations';
import { stacksPageSample } from '../../src/shared/api/samples/stacks';

// The Add card dialog, opened from the Collection screen, with the API mocked from the
// samples: searching "arcane" finds Arcane Signet, whose printings are EOC #53 (nonfoil),
// CMM #367 (nonfoil, foil) and ELD #331 (nonfoil).

async function mockApi(page: Page) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const added: AddCopiesBody[] = [];
  await page.route(
    (url) => url.pathname === '/api/stacks',
    (route) => route.fulfill({ json: stacksPageSample }),
  );
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/cards/search?*', (route) => route.fulfill({ json: arcaneSearch }));
  await page.route(`**/api/cards/${arcaneSignet.oracleId}`, (route) =>
    route.fulfill({ json: arcaneSignetDetails }),
  );
  await page.route('**/api/stacks/add', (route) => {
    added.push(route.request().postDataJSON());
    return route.fulfill({ json: addCopiesResultSample });
  });
  return added;
}

async function openDialog(page: Page) {
  await page.goto('/collection');
  await page.getByRole('button', { name: 'Add card' }).click();
  return page.getByRole('dialog', { name: 'Add a card' });
}

async function pickArcaneSignet(page: Page) {
  const dialog = await openDialog(page);
  await dialog.getByRole('searchbox', { name: 'Card' }).fill('arcane');
  await dialog.getByRole('button', { name: 'Arcane Signet' }).click();
  return dialog;
}

const printing = (dialog: ReturnType<Page['getByRole']>, name: RegExp) =>
  dialog.getByRole('radiogroup', { name: 'Printing' }).getByRole('radio', { name });

test('search, pick a printing, set every field and add: the body carries them all', async ({
  page,
}) => {
  const added = await mockApi(page);
  const dialog = await pickArcaneSignet(page);

  await expect(dialog.getByRole('radio')).toHaveCount(arcaneSignetPrintings.length);
  // The newest printing starts picked.
  await expect(printing(dialog, /EOC #53/)).toHaveAttribute('aria-checked', 'true');
  await printing(dialog, /CMM #367/).click();
  await expect(printing(dialog, /CMM #367/)).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('img', { name: /Arcane Signet/ })).toHaveAttribute(
    'src',
    /0539b83c-4459-41b5-a001-d15a1c9ddf23/,
  );

  await dialog.getByLabel('Quantity').fill('3');
  await dialog.getByLabel('Finish').selectOption('foil');
  await dialog.getByLabel('Condition').selectOption('light_played');
  await dialog.getByLabel('Language').selectOption('ja');
  await dialog.getByRole('combobox', { name: 'Location' }).click();
  await page.getByRole('option', { name: 'Rares binder', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Proxy' }).check();
  await dialog.getByText('More', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Misprint' }).check();
  await dialog.getByRole('checkbox', { name: 'Altered' }).check();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  await expect.poll(() => added).toHaveLength(1);
  expect(added[0]).toEqual({
    printingId: '0539b83c-4459-41b5-a001-d15a1c9ddf23',
    quantity: 3,
    finish: 'foil',
    condition: 'light_played',
    language: 'ja',
    misprint: true,
    altered: true,
    isProxy: true,
    locationId: 6,
  });
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-slot=undo-bar]')).toContainText(
    'Added 1 Arcane Signet to Rares binder',
  );
});

test('the finishes follow the picked printing', async ({ page }) => {
  await mockApi(page);
  const dialog = await pickArcaneSignet(page);
  const finish = dialog.getByLabel('Finish');

  await expect(finish.getByRole('option')).toHaveText(['Nonfoil']);
  await printing(dialog, /CMM #367/).click();
  await expect(finish.getByRole('option')).toHaveText(['Nonfoil', 'Foil']);
  await finish.selectOption('foil');
  // ELD only comes in nonfoil, so the foil pick falls back.
  await printing(dialog, /ELD #331/).click();
  await expect(finish.getByRole('option')).toHaveText(['Nonfoil']);
  await expect(finish).toHaveValue('nonfoil');
});

test('the defaults: one near mint copy in the printing’s language, into To sort', async ({
  page,
}) => {
  const added = await mockApi(page);
  const dialog = await pickArcaneSignet(page);

  await expect(dialog.getByLabel('Quantity')).toHaveValue('1');
  await expect(dialog.getByLabel('Condition')).toHaveValue('near_mint');
  await expect(dialog.getByLabel('Language')).toHaveValue('en');
  await expect(dialog.getByRole('combobox', { name: 'Location' })).toHaveText('To sort');
  await expect(dialog.getByRole('checkbox', { name: 'Proxy' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  await expect.poll(() => added).toHaveLength(1);
  expect(added[0]).toEqual({
    printingId: '3d994115-378d-4685-a5dc-e448831da434',
    quantity: 1,
    finish: 'nonfoil',
    condition: 'near_mint',
    language: 'en',
    misprint: false,
    altered: false,
    isProxy: false,
    locationId: 1,
  });
  await expect(page.locator('[data-slot=undo-bar]')).toBeVisible();
});
