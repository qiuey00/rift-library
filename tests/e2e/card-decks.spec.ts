import { expect, type Page, test } from '@playwright/test';
import type { CardDecks } from '../../src/shared/api/deck-checks';
import { cardDecksSample } from '../../src/shared/api/samples/deck-checks';

const arcaneSignet = '/cards/0bc7f093-bef0-4f1a-852c-4b75ebf54838';

async function mockCardDecks(page: Page, body: CardDecks) {
  await page.route('**/api/cards/*/decks', (route) => route.fulfill({ json: body }));
}

const section = (page: Page) => page.getByRole('region', { name: 'Decks using it' });

test('lists each deck with its board, quantity and state', async ({ page }) => {
  await mockCardDecks(page, cardDecksSample);
  await page.goto(arcaneSignet);

  const rows = section(page).getByRole('listitem');
  await expect(rows).toHaveCount(cardDecksSample.decks.length);

  const hearthhull = rows.nth(0);
  await expect(hearthhull.getByRole('link')).toHaveText(cardDecksSample.decks[0].name);
  await expect(hearthhull.getByRole('link')).toHaveAttribute('href', '/decks/1');
  await expect(hearthhull).toContainText('Main board · 1 copy');
  await expect(hearthhull).toContainText('Partly assembled');

  await expect(rows.nth(1)).toContainText('Assembled');
  await expect(rows.nth(3)).toContainText('Maybe board · 1 copy');
  await expect(rows.nth(3)).toContainText('Not assembled');

  await hearthhull.getByRole('link').click();
  await expect(page).toHaveURL('/decks/1');
});

test('shows the demand warning at the top', async ({ page }) => {
  await mockCardDecks(page, cardDecksSample);
  await page.goto(arcaneSignet);

  await expect(section(page).getByRole('note')).toHaveText('3 decks want Arcane Signet, you own 2');
});

test('leaves the warning out when no deck comes up short', async ({ page }) => {
  await mockCardDecks(page, { ...cardDecksSample, demand: null });
  await page.goto(arcaneSignet);

  await expect(section(page).getByRole('listitem')).toHaveCount(cardDecksSample.decks.length);
  await expect(section(page).getByRole('note')).toHaveCount(0);
});

test('says so when no deck uses the card', async ({ page }) => {
  await mockCardDecks(page, { decks: [], demand: null });
  await page.goto(arcaneSignet);

  await expect(section(page)).toContainText('No deck uses this card.');
  await expect(section(page).getByRole('listitem')).toHaveCount(0);
});
