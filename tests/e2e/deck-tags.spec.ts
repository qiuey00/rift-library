import { expect, type Page, test } from '@playwright/test';
import { deckChecksSample } from '../../src/shared/api/samples/deck-checks';
import { deckViewSample, slotTagsSample } from '../../src/shared/api/samples/decks';

// Tags in the deck view, with the API mocked from the samples: the Jinx Burn deck (id 1),
// where Copper Mender (slot 130) is tagged Card draw and Ramp.

test.beforeEach(async ({ page }) => {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.route('**/api/decks/1', (route) => route.fulfill({ json: deckViewSample }));
  await page.route('**/api/decks/1/checks', (route) => route.fulfill({ json: deckChecksSample }));
});

const row = (page: Page, slotId: number) => page.locator(`li[data-slot-id="${slotId}"]`);
const group = (page: Page, name: string, panel = 'Main deck') =>
  page.getByRole('region', { name: panel }).getByRole('region', { name, exact: true });
const groupNames = (page: Page) =>
  page.getByRole('region', { name: 'Main deck' }).getByRole('heading', { level: 3 });

test('each card shows its tags as chips, in rows and images', async ({ page }) => {
  await page.goto('/decks/1');
  await expect(row(page, 130).getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(
    ['Card draw', 'Ramp'],
  );
  await expect(row(page, 101).getByRole('list', { name: 'Tags' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Images' }).click();
  await expect(row(page, 114).getByRole('list', { name: 'Tags' })).toHaveText('Ramp');
});

test('Group by Tag puts a card under each of its tags', async ({ page }) => {
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Tag', exact: true }).click();
  await expect(groupNames(page)).toHaveText(['Card draw3', 'Ramp5', 'Removal3', /^Untagged\d+$/]);
  await expect(group(page, 'Card draw')).toContainText('Copper Mender');
  await expect(group(page, 'Ramp')).toContainText('Copper Mender');
  await expect(group(page, 'Untagged')).not.toContainText('Copper Mender');
  // The deck's count still counts each card once.
  await expect(page.getByRole('region', { name: 'Deck header' })).toContainText('95 cards');
  // The maybe board's cards have no tags.
  await expect(
    page.getByRole('region', { name: 'Maybe board', exact: true }).getByRole('heading', {
      level: 3,
    }),
  ).toHaveText(['Untagged5']);
});

test('the tag filter shows one tag or the untagged cards, on the main deck and maybe board', async ({
  page,
}) => {
  await page.goto('/decks/1');
  const filter = page.getByRole('combobox', { name: 'Tag' });
  await expect(filter.getByRole('option')).toHaveText([
    'Any tag',
    'Card draw',
    'Ramp',
    'Removal',
    'Untagged',
  ]);

  await filter.selectOption('Ramp');
  await expect(
    page.getByRole('region', { name: 'Main deck' }).locator('li[data-slot-id]'),
  ).toHaveCount(5);
  // The maybe board panel stays, with no cards matching.
  await expect(
    page.getByRole('region', { name: 'Maybe board', exact: true }).locator('li[data-slot-id]'),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Where it is' }).click();
  await expect(
    page.getByRole('region', { name: 'Main deck' }).locator('li[data-slot-id]'),
  ).toHaveCount(5);

  await filter.selectOption('Untagged');
  await expect(row(page, 130)).toHaveCount(0);
  await expect(row(page, 101)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Maybe board', exact: true }).locator('li[data-slot-id]'),
  ).toHaveCount(5);

  await filter.selectOption('Any tag');
  await expect(row(page, 130)).toBeVisible();
});

test('Edit tags… from the card menu saves the tags and shows the answer', async ({ page }) => {
  let sent: unknown = null;
  await page.route('**/api/decks/1/slots/114/tags', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: slotTagsSample });
  });
  await page.goto('/decks/1');
  await row(page, 114).click({ button: 'right' });
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText([
    'Change printing…',
    'Move to sideboard',
    'Move to maybe board',
    'Edit tags…',
    'Add to buy list',
  ]);
  await page.getByRole('menuitem', { name: 'Edit tags…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Sun Disc' });
  await expect(dialog.getByRole('list', { name: 'Card tags' })).toHaveText('Ramp');
  const field = dialog.getByRole('textbox', { name: 'Tags' });
  // The deck's other tags are offered while typing.
  await field.fill('car');
  await expect(dialog.getByRole('list', { name: 'Suggested tags' })).toHaveText('Card draw');
  await dialog.getByRole('button', { name: 'Card draw' }).click();
  await field.fill('energy rock');
  await field.press('Enter');
  await field.pressSequentially('ramp,');
  await expect(dialog.getByRole('list', { name: 'Card tags' }).getByRole('listitem')).toHaveText([
    'Ramp',
    'Card draw',
    'energy rock',
  ]);
  await dialog.getByRole('button', { name: 'Remove Card draw' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual({ tags: ['Ramp', 'energy rock'] });
  await expect(row(page, 114).getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(
    ['energy rock', 'Ramp'],
  );
});

test('Edit tags… opens from the keyboard and in Edit mode, and shows server errors', async ({
  page,
}) => {
  await page.route('**/api/decks/1/slots/101/tags', (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: 'invalid_request', message: 'A tag can’t contain #' } },
    }),
  );
  await page.goto('/decks/1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // The Legend's menu has it too.
  await row(page, 101).getByRole('link').first().focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Edit tags…' }).press('Enter');

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Tags' }).fill('#legend');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A tag can’t contain #');
  await expect(dialog).toBeVisible();
});

test('Export opens the deck list export dialog for the deck', async ({ page }) => {
  await page.goto('/decks/1');
  const header = page.getByRole('region', { name: 'Deck header' });
  const buttons = header.getByRole('link').or(header.getByRole('button'));
  // allTextContents doesn't wait, so wait for the header's actions first.
  await expect(header.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  const names = await buttons.allTextContents();
  expect(names.indexOf('Update from deck list')).toBe(names.indexOf('Take apart') + 1);
  expect(names.indexOf('Export')).toBe(names.indexOf('Take apart') + 2);

  await header.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Jinx Burn');
});
