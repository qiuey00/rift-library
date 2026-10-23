import { expect, type Page, type Request, test } from '@playwright/test';
import type { BuyItemChange, BuyList } from '../../src/shared/api/buy-list';
import { buyItemSample, buyListSample } from '../../src/shared/api/samples/buy-list';

// The Buy list screen with the API mocked from the samples: Soul of Windgrace (item 3, a
// picked printing), Splendid Reclamation (item 2) and Arcane Signet (item 1), newest first.

type Sent = { method: string; url: string; body: unknown };

async function mockBuyList(page: Page, list: BuyList = buyListSample) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const sent: Sent[] = [];
  const record = (request: Request) =>
    sent.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
  await page.route('**/api/buy-list', (route) => route.fulfill({ json: list }));
  await page.route('**/api/buy-list/*', (route) => {
    const request = route.request();
    record(request);
    if (request.method() === 'DELETE') {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: buyItemSample });
  });
  return sent;
}

const row = (page: Page, id: number) => page.locator(`tr[data-item-id="${id}"]`);

test('one row per item, newest first, with its printing, quantity, note and date', async ({
  page,
}) => {
  await mockBuyList(page);
  await page.goto('/buy-list');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Buy list');
  await expect(page.getByText('3 cards, 3 copies.')).toBeVisible();

  const rows = page.getByRole('region', { name: 'Cards to buy' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.getByRole('link')).toHaveText([
    'Soul of Windgrace',
    'Splendid Reclamation',
    'Arcane Signet',
  ]);

  const soul = row(page, 3);
  await expect(soul).toContainText('Edge of Eternities Commander (EOC) #126');
  await expect(soul.getByRole('spinbutton', { name: /Quantity of/ })).toHaveValue('1');
  await expect(soul.getByRole('textbox', { name: /Note for/ })).toHaveValue('For Hearthhull');
  await expect(soul).toContainText('Oct 18, 2026');

  const reclamation = row(page, 2);
  await expect(reclamation).toContainText('Any printing');
  await expect(reclamation.getByRole('textbox')).toHaveValue('');
});

test('a card name opens its card page', async ({ page }) => {
  await mockBuyList(page);
  await page.goto('/buy-list');
  const signet = buyListSample.items[2].card;
  await row(page, 1).getByRole('link', { name: signet.name }).click();
  await expect(page).toHaveURL(`/cards/${signet.oracleId}`);
});

test('hovering a row shows its card beside the list', async ({ page }) => {
  await mockBuyList(page);
  await page.goto('/buy-list');
  const preview = page.getByRole('complementary', { name: 'Card preview' }).getByRole('img');
  await expect(preview).toHaveAttribute('alt', buyListSample.items[0].card.name);
  await row(page, 1).hover();
  await expect(preview).toHaveAttribute('alt', 'Arcane Signet');
});

test('editing the quantity sends PATCH when the field loses focus', async ({ page }) => {
  const sent = await mockBuyList(page);
  await page.goto('/buy-list');
  const quantity = row(page, 2).getByRole('spinbutton');
  await quantity.fill('3');
  expect(sent).toEqual([]);
  await quantity.blur();
  await expect.poll(() => sent).toHaveLength(1);
  expect(sent[0].method).toBe('PATCH');
  expect(sent[0].url).toMatch(/\/api\/buy-list\/2$/);
  expect(sent[0].body).toEqual({ quantity: 3 } satisfies BuyItemChange);
});

test('a quantity below one is put back, not sent', async ({ page }) => {
  const sent = await mockBuyList(page);
  await page.goto('/buy-list');
  const quantity = row(page, 2).getByRole('spinbutton');
  await quantity.fill('0');
  await quantity.blur();
  await expect(quantity).toHaveValue('1');
  // Leaving an unchanged field sends nothing either.
  await row(page, 3).getByRole('textbox').focus();
  await row(page, 3).getByRole('textbox').blur();
  expect(sent).toEqual([]);
});

test('editing the note sends PATCH when the field loses focus', async ({ page }) => {
  const sent = await mockBuyList(page);
  await page.goto('/buy-list');
  const note = row(page, 1).getByRole('textbox', { name: 'Note for Arcane Signet' });
  await note.fill('Any foil is fine');
  await note.press('Enter');
  await expect.poll(() => sent).toHaveLength(1);
  expect(sent[0].method).toBe('PATCH');
  expect(sent[0].url).toMatch(/\/api\/buy-list\/1$/);
  expect(sent[0].body).toEqual({ note: 'Any foil is fine' } satisfies BuyItemChange);
});

test('Remove sends DELETE', async ({ page }) => {
  const sent = await mockBuyList(page);
  await page.goto('/buy-list');
  await row(page, 3).getByRole('button', { name: 'Remove Soul of Windgrace' }).click();
  await expect.poll(() => sent).toHaveLength(1);
  expect(sent[0].method).toBe('DELETE');
  expect(sent[0].url).toMatch(/\/api\/buy-list\/3$/);
});

test('a failed change says why', async ({ page }) => {
  await mockBuyList(page);
  await page.route('**/api/buy-list/*', (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: 'buy_item_not_found', message: 'This card is no longer on the list' },
      },
    }),
  );
  await page.goto('/buy-list');
  await row(page, 1).getByRole('button', { name: 'Remove Arcane Signet' }).click();
  await expect(page.getByRole('alert')).toHaveText('This card is no longer on the list');
});

test('the rows / images switch shows images and is remembered', async ({ page }) => {
  await mockBuyList(page);
  await page.goto('/buy-list');
  const view = page.getByRole('group', { name: 'View' });
  await expect(view.getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-pressed', 'true');
  await view.getByRole('button', { name: 'Images' }).click();

  const tiles = page.getByRole('region', { name: 'Cards to buy' }).getByRole('listitem');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.first().getByRole('img')).toHaveAttribute('alt', 'Soul of Windgrace');
  await expect(tiles.first().getByRole('spinbutton')).toHaveValue('1');
  await expect(page.locator('table')).toHaveCount(0);

  await page.reload();
  await expect(view.getByRole('button', { name: 'Images' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('an empty buy list says where cards come from', async ({ page }) => {
  await mockBuyList(page, { items: [] });
  await page.goto('/buy-list');
  await expect(
    page.getByText('Nothing to buy. Add cards from a deck, a pick list or a card page.'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'View' })).toHaveCount(0);
});
