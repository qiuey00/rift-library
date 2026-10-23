import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { ManaBoxApplyRequest, ManaBoxPreview } from '../../src/shared/api/manabox';
import type { ManaBoxUpdateApplyRequest, UpdatePreview } from '../../src/shared/api/manabox-update';
import { arcaneSearch, arcaneSignetDetails } from '../../src/shared/api/samples/cards';
import {
  locationTreeSample,
  longBoxNode,
  raresBinderNode,
  staplesBinderNode,
} from '../../src/shared/api/samples/locations';
import {
  manaboxApplyResult,
  manaboxBinderPreview,
  manaboxPreview,
  missingColumnsError,
  previewExpiredError,
} from '../../src/shared/api/samples/manabox';
import { updateApplyResult, updatePreview } from '../../src/shared/api/samples/manabox-update';

// The ManaBox import dialog with the API mocked from the samples: Jeff's export has 258 rows
// and 389 cards, and rows 27 (Sylvan Library, 1 card) and 231 (Follow the Lumarets, 2 cards)
// are unknown.

const fixture = path.join(import.meta.dirname, '..', 'fixtures', 'manabox-sample.csv');
const cmmSignet = arcaneSignetDetails.printings.find((printing) => printing.setCode === 'cmm');

/** Answers the API from the samples and records what the dialog sent. */
async function mockApi(page: Page, preview: ManaBoxPreview = manaboxPreview) {
  const sent = { previews: [] as string[], applies: [] as ManaBoxApplyRequest[] };
  // Card images come from Scryfall; tests never reach the network.
  await page.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route) => route.abort(),
  );
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: locationTreeSample }));
  await page.route('**/api/imports/manabox/preview', async (route) => {
    sent.previews.push(route.request().postData() ?? '');
    await route.fulfill({ json: preview });
  });
  await page.route('**/api/imports/manabox/apply', async (route) => {
    sent.applies.push(route.request().postDataJSON());
    await route.fulfill({ json: manaboxApplyResult });
  });
  await page.route('**/api/cards/search?*', (route) => route.fulfill({ json: arcaneSearch }));
  await page.route(`**/api/cards/${arcaneSignetDetails.card.oracleId}`, (route) =>
    route.fulfill({ json: arcaneSignetDetails }),
  );
  return sent;
}

/** Opens the dialog from the top bar's Import menu. */
async function openDialog(page: Page) {
  await page.goto('/collection');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('menuitem', { name: 'ManaBox CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import from ManaBox' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const currentStep = (page: Page) =>
  page.getByRole('list', { name: 'Steps' }).locator('[aria-current="step"]');

async function chooseFile(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Import from ManaBox' });
  await dialog.getByLabel('ManaBox CSV', { exact: true }).setInputFiles(fixture);
  await expect(dialog).toContainText('manabox-sample.csv');
  await dialog.getByRole('button', { name: 'Next: Location' }).click();
  await expect(currentStep(page)).toContainText('Location');
}

test('choose a file, keep the inbox, fix one row, skip one and add the cards', async ({ page }) => {
  const sent = await mockApi(page);
  const dialog = await openDialog(page);
  await expect(currentStep(page)).toContainText('File');
  await expect(dialog.getByRole('button', { name: 'Add copies' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await chooseFile(page);
  expect(sent.previews).toHaveLength(1);
  expect(sent.previews[0]).toContain('filename="manabox-sample.csv"');

  // The "to sort" inbox is the default, and the proxies option is off.
  await expect(dialog.getByRole('combobox')).toHaveText('To sort');
  await expect(dialog.getByRole('checkbox', { name: 'These are all proxies' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Next: Preview' }).click();

  const counts = dialog.locator('dl[aria-label="Counts"]');
  await expect(counts.getByRole('term')).toHaveText(['rows', 'cards', 'unknown rows']);
  await expect(counts.getByRole('definition')).toHaveText(['258', '389', '2']);

  const confirm = dialog.getByRole('button', { name: /^Add .* cards to To sort$/ });
  await expect(confirm).toBeDisabled();
  await expect(dialog).toContainText('Fix or skip the 2 unknown rows first.');

  // Fix row 27: find the card, then its printing.
  const sylvan = dialog.getByRole('row', { name: 'Row 27: Sylvan Library' });
  await sylvan.getByRole('button', { name: 'Fix' }).click();
  const fix = page.getByRole('dialog', { name: 'Fix row 27' });
  await expect(fix.getByPlaceholder('Card name')).toHaveValue('Sylvan Library');
  await fix.getByRole('button', { name: /Arcane Signet/ }).click();
  await fix.getByRole('button', { name: /Commander Masters \(CMM\) #367/ }).click();
  await expect(fix).toBeHidden();
  await expect(sylvan).toContainText('→ Arcane Signet, Commander Masters (CMM) #367');

  // Skip row 231, which takes its 2 cards off the total.
  const lumarets = dialog.getByRole('row', { name: 'Row 231: Follow the Lumarets' });
  await lumarets.getByRole('button', { name: 'Skip' }).click();
  await expect(lumarets).toContainText('skipped');

  await expect(dialog.getByRole('button', { name: 'Add 387 cards to To sort' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Add 387 cards to To sort' }).click();

  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    {
      previewId: manaboxPreview.previewId,
      targetLocationId: 1,
      allProxies: false,
      fixes: { 27: cmmSignet?.scryfallId },
      skips: [231],
    },
  ]);
  const undoBar = page.locator('[data-slot="undo-bar"]');
  await expect(undoBar).toContainText(manaboxApplyResult.message);
  await expect(undoBar.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('another location and "These are all proxies" go to the apply', async ({ page }) => {
  const sent = await mockApi(page);
  const dialog = await openDialog(page);
  await chooseFile(page);

  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: raresBinderNode.name }).click();
  await expect(dialog.getByRole('combobox')).toHaveText(raresBinderNode.path);
  await dialog.getByRole('checkbox', { name: 'These are all proxies' }).check();
  await expect(dialog).toContainText('All 389 imported cards will be marked as proxy.');
  await dialog.getByRole('button', { name: 'Next: Preview' }).click();

  const preview = dialog.getByRole('table');
  for (const row of manaboxPreview.unknownRows) {
    await preview
      .getByRole('row', { name: `Row ${row.row}: ${row.name}` })
      .getByRole('button', { name: 'Skip' })
      .click();
  }
  await dialog.getByRole('button', { name: 'Add 386 cards to Rares binder' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    {
      previewId: manaboxPreview.previewId,
      targetLocationId: raresBinderNode.id,
      allProxies: true,
      fixes: {},
      skips: [27, 231],
    },
  ]);
});

test('a file without the ManaBox columns shows why on the file step', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/imports/manabox/preview', (route) =>
    route.fulfill({ status: 400, json: missingColumnsError }),
  );
  const dialog = await openDialog(page);
  await dialog.getByLabel('ManaBox CSV', { exact: true }).setInputFiles(fixture);
  await dialog.getByRole('button', { name: 'Next: Location' }).click();

  await expect(dialog.getByRole('alert')).toHaveText(missingColumnsError.error.message);
  await expect(currentStep(page)).toContainText('File');
});

test('an expired preview asks for the file again', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/imports/manabox/apply', (route) =>
    route.fulfill({ status: 410, json: previewExpiredError }),
  );
  const dialog = await openDialog(page);
  await chooseFile(page);
  await dialog.getByRole('button', { name: 'Next: Preview' }).click();
  await dialog.getByRole('button', { name: 'Skip the rest' }).click();
  await dialog.getByRole('button', { name: 'Add 386 cards to To sort' }).click();

  await expect(currentStep(page)).toContainText('File');
  await expect(dialog.getByRole('alert')).toHaveText(previewExpiredError.error.message);
  await expect(dialog.getByRole('button', { name: 'Choose file' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next: Location' })).toBeDisabled();
});

test('rows with bad values and a Scryfall outage are listed', async ({ page }) => {
  await mockApi(page, {
    ...manaboxPreview,
    invalidRows: manaboxBinderPreview.invalidRows,
    lookupFailed: true,
  });
  const dialog = await openDialog(page);
  await chooseFile(page);
  await dialog.getByRole('button', { name: 'Next: Preview' }).click();

  await expect(dialog.getByRole('status')).toHaveText(
    "Couldn't reach Scryfall; unknown cards are listed to fix or skip",
  );
  const badRows = dialog.getByRole('list', { name: 'Rows with bad values' });
  await expect(badRows).toBeHidden();
  await dialog.getByText('Skipped: 1 row with bad values').click();
  await expect(badRows).toContainText('Row 87');
  await expect(badRows).toContainText('Quantity is "abc", not a number');
  await expect(badRows.getByRole('button')).toHaveCount(0);
});

/** Chooses the binders sample; the dialog only learns the file has binders once it's read. */
async function chooseBinderFile(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Import from ManaBox' });
  await dialog.getByLabel('ManaBox CSV', { exact: true }).setInputFiles(fixture);
  await dialog.getByRole('button', { name: 'Next: Location' }).click();
  await expect(currentStep(page)).toContainText('Binders');
  return dialog;
}

const binderRow = (page: Page, name: string) =>
  page.getByRole('dialog', { name: 'Import from ManaBox' }).getByRole('row', { name });

// The binders sample: Rares (164 cards, remembered as the Rares binder), Strixhaven (389),
// the Hearthhull deck (100) and the Wants list (15), with row 412 (1 card) unknown.

test('binders map to remembered, existing and new locations', async ({ page }) => {
  const sent = await mockApi(page, manaboxBinderPreview);
  await openDialog(page);
  const dialog = await chooseBinderFile(page);

  // The remembered mapping is prefilled; the list is skipped and has no picker.
  const rares = binderRow(page, 'Rares (Binder)');
  await expect(rares.getByRole('combobox', { name: 'Location for Rares' })).toHaveText(
    raresBinderNode.path,
  );
  await expect(rares).toContainText('Remembered');
  await expect(rares).toContainText('164');
  const wants = binderRow(page, 'Wants (List)');
  await expect(wants).toContainText("Skipped: cards you don't own");
  await expect(wants).toContainText('15');
  await expect(wants.getByRole('combobox')).toHaveCount(0);
  await expect(wants.getByRole('button')).toHaveCount(0);

  // Next waits until every binder and deck has somewhere to go.
  const next = dialog.getByRole('button', { name: 'Next: Preview' });
  await expect(next).toBeDisabled();
  await expect(dialog).toContainText(
    'Pick a location for the 2 binders and decks without one first.',
  );
  await binderRow(page, 'Strixhaven (Binder)')
    .getByRole('combobox', { name: 'Location for Strixhaven' })
    .click();
  await page.getByRole('option', { name: staplesBinderNode.name }).click();
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(next).toBeDisabled();
  await expect(dialog).toContainText('Pick where Hearthhull goes first.');

  // A new location for the deck: its name starts as the ManaBox name, as a binder.
  const hearthhull = binderRow(page, 'Hearthhull (Deck)');
  await hearthhull.getByRole('button', { name: 'New location for Hearthhull' }).click();
  await expect(hearthhull.getByLabel('Name')).toHaveValue('Hearthhull');
  await expect(hearthhull.getByLabel('Type')).toHaveValue('binder');
  await hearthhull.getByLabel('Type').selectOption('box');
  await hearthhull.getByLabel('Name').fill('');
  await expect(next).toBeDisabled();
  await expect(dialog).toContainText('Name the new location for Hearthhull first.');
  await hearthhull.getByLabel('Name').fill('Hearthhull shelf');
  await hearthhull.getByRole('combobox', { name: 'Inside (optional)' }).click();
  await page.getByRole('option', { name: longBoxNode.name, exact: true }).click();
  await expect(hearthhull.getByRole('combobox', { name: 'Inside (optional)' })).toHaveText(
    longBoxNode.path,
  );

  await expect(next).toBeEnabled();
  await next.click();
  await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
  // 668 cards less the 15 in the list and the skipped row's 1, into 3 locations.
  const confirm = dialog.getByRole('button', { name: 'Add 652 cards to 3 locations' });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    {
      previewId: manaboxBinderPreview.previewId,
      destinations: {
        'binder:Rares': raresBinderNode.id,
        'binder:Strixhaven': staplesBinderNode.id,
      },
      newLocations: {
        'deck:Hearthhull': { name: 'Hearthhull shelf', type: 'box', parentId: longBoxNode.id },
      },
      allProxies: false,
      fixes: {},
      skips: [412],
    },
  ]);
});

test('binders sharing a location count it once, and a new location can be undone', async ({
  page,
}) => {
  const sent = await mockApi(page, manaboxBinderPreview);
  await openDialog(page);
  const dialog = await chooseBinderFile(page);

  for (const [row, name] of [
    ['Strixhaven (Binder)', 'Location for Strixhaven'],
    ['Hearthhull (Deck)', 'Location for Hearthhull'],
  ]) {
    await binderRow(page, row).getByRole('combobox', { name }).click();
    await page.getByRole('option', { name: raresBinderNode.name }).click();
    await expect(page.getByRole('option')).toHaveCount(0);
  }
  // Picking a new location and changing its mind keeps the remembered one.
  const rares = binderRow(page, 'Rares (Binder)');
  await rares.getByRole('button', { name: 'New location for Rares' }).click();
  await rares.getByRole('button', { name: 'Use an existing location for Rares' }).click();
  await expect(rares.getByRole('combobox', { name: 'Location for Rares' })).toHaveText(
    raresBinderNode.path,
  );

  await dialog.getByRole('button', { name: 'Next: Preview' }).click();
  await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add 652 cards to 1 location' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    {
      previewId: manaboxBinderPreview.previewId,
      destinations: {
        'binder:Rares': raresBinderNode.id,
        'binder:Strixhaven': raresBinderNode.id,
        'deck:Hearthhull': raresBinderNode.id,
      },
      newLocations: {},
      allProxies: false,
      fixes: {},
      skips: [412],
    },
  ]);
});

// Update a location with the update sample: the Strixhaven binder export has one row in each
// group, and the missing Terramorphic Expanse sits in the Hearthhull deck box (stack 41).

/** Answers the update endpoints from the samples and records what the dialog sent. */
async function mockUpdateApi(page: Page, preview: UpdatePreview = updatePreview) {
  await mockApi(page);
  const sent = { previews: [] as string[], applies: [] as ManaBoxUpdateApplyRequest[] };
  await page.route('**/api/imports/manabox/update-preview', async (route) => {
    sent.previews.push(route.request().postData() ?? '');
    await route.fulfill({ json: preview });
  });
  await page.route('**/api/imports/manabox/update-apply', async (route) => {
    sent.applies.push(route.request().postDataJSON());
    await route.fulfill({ json: updateApplyResult });
  });
  return sent;
}

/** Chooses the file in Update a location mode and goes to the location step. */
async function chooseUpdateFile(page: Page) {
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Update a location' }).click();
  await dialog.getByLabel('ManaBox CSV', { exact: true }).setInputFiles(fixture);
  await dialog.getByRole('button', { name: 'Next: Location' }).click();
  await expect(currentStep(page)).toContainText('Location');
  return dialog;
}

async function pickUpdateLocation(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Import from ManaBox' });
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: raresBinderNode.name }).click();
  await dialog.getByRole('button', { name: 'Next: Preview' }).click();
  await expect(currentStep(page)).toContainText('Preview');
}

test('Update a location needs a location, then shows each group with its count', async ({
  page,
}) => {
  const sent = await mockUpdateApi(page);
  const dialog = await chooseUpdateFile(page);
  // The file is read against the location, so nothing is sent before one is picked.
  expect(sent.previews).toHaveLength(0);

  // No default: Next waits for a location.
  await expect(dialog.getByRole('combobox')).toHaveText('Pick a location');
  const next = dialog.getByRole('button', { name: 'Next: Preview' });
  await expect(next).toBeDisabled();
  await expect(dialog).toContainText('Pick the location the file describes first.');

  await pickUpdateLocation(page);
  expect(sent.previews).toHaveLength(1);
  expect(sent.previews[0]).toContain('filename="manabox-sample.csv"');
  expect(sent.previews[0]).toMatch(
    new RegExp(`name="locationId"\\r\\n\\r\\n${raresBinderNode.id}\\r\\n`),
  );

  for (const name of ['New: 1', 'Raised: 1', 'Lowered: 1', 'Missing: 1']) {
    await expect(dialog.getByRole('group', { name })).toBeVisible();
  }
  await expect(dialog).toContainText('251 stacks stay the same.');

  // A collapsed group opens to its rows: card, printing, finish, condition, file and app.
  const raised = dialog.getByRole('group', { name: 'Raised: 1' });
  const iteration = raised.getByRole('row', { name: 'Expressive Iteration' });
  await expect(iteration).toBeHidden();
  await raised.getByText('Raised', { exact: true }).click();
  await expect(iteration.getByRole('cell')).toHaveText([
    'Expressive Iteration',
    'SOA #64',
    'Nonfoil',
    'Near mint',
    '2',
    '1',
  ]);

  // The group with a deck-box copy starts open, set to Keep.
  const flagged = dialog.getByRole('group', { name: '1 in Hearthhull deck box' });
  await expect(flagged.getByRole('button', { name: 'Keep' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Keeping it leaves the lowered Deflecting Palm's one copy to remove.
  await dialog.getByRole('button', { name: 'Update Strixhaven binder' }).click();
  const ask = page.getByRole('dialog', { name: 'Remove 1 card from Strixhaven binder?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Remove 1 card and update' }).click();

  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    { previewId: updatePreview.previewId, removeFlagged: [], fixes: {}, skips: [] },
  ]);
  await expect(page.locator('[data-slot="undo-bar"]')).toContainText(updateApplyResult.message);
});

test('switching a flagged copy to Remove sends it and counts it in the confirmation', async ({
  page,
}) => {
  const sent = await mockUpdateApi(page);
  const dialog = await chooseUpdateFile(page);
  await pickUpdateLocation(page);

  const flagged = dialog.getByRole('group', { name: '1 in Hearthhull deck box' });
  await expect(flagged.locator('..').locator('..')).toContainText(
    'Removing it would empty a slot in Hearthhull.',
  );
  await flagged.getByRole('button', { name: 'Remove' }).click();
  await expect(flagged.getByRole('button', { name: 'Remove' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Cancel goes back to the preview without importing.
  await dialog.getByRole('button', { name: 'Update Strixhaven binder' }).click();
  const ask = page.getByRole('dialog', { name: 'Remove 2 cards from Strixhaven binder?' });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toBeHidden();
  expect(sent.applies).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Update Strixhaven binder' }).click();
  await ask.getByRole('button', { name: 'Remove 2 cards and update' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    { previewId: updatePreview.previewId, removeFlagged: [41], fixes: {}, skips: [] },
  ]);
});

test('an update that removes nothing applies without asking', async ({ page }) => {
  const sent = await mockUpdateApi(page, {
    ...updatePreview,
    groups: { ...updatePreview.groups, lowered: [], missing: [] },
  });
  const dialog = await chooseUpdateFile(page);
  await pickUpdateLocation(page);
  await expect(dialog.getByRole('group', { name: 'Missing: 0' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Update Strixhaven binder' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.applies).toHaveLength(1);
});

test('unknown and invalid rows in an update are fixed, skipped and listed as in add mode', async ({
  page,
}) => {
  const sent = await mockUpdateApi(page, {
    ...updatePreview,
    unknownRows: manaboxPreview.unknownRows,
    invalidRows: manaboxBinderPreview.invalidRows,
  });
  const dialog = await chooseUpdateFile(page);
  await pickUpdateLocation(page);

  const confirm = dialog.getByRole('button', { name: 'Update Strixhaven binder' });
  await expect(confirm).toBeDisabled();
  await expect(dialog).toContainText('Fix or skip the 2 unknown rows first.');
  await expect(dialog).toContainText('Skipped: 1 row with bad values');
  await dialog
    .getByRole('row', { name: 'Row 231: Follow the Lumarets' })
    .getByRole('button', { name: 'Skip' })
    .click();
  await dialog
    .getByRole('row', { name: 'Row 27: Sylvan Library' })
    .getByRole('button', { name: 'Skip' })
    .click();
  await confirm.click();
  await page
    .getByRole('dialog', { name: 'Remove 1 card from Strixhaven binder?' })
    .getByRole('button', { name: 'Remove 1 card and update' })
    .click();
  await expect(dialog).toBeHidden();
  expect(sent.applies).toEqual([
    { previewId: updatePreview.previewId, removeFlagged: [], fixes: {}, skips: [231, 27] },
  ]);
});
