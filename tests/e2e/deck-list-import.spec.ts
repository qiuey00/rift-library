import { expect, type Page, test } from '@playwright/test';
import type { CardSearchResponse } from '../../src/shared/api/cards';
import type {
  DeckListCreate,
  DeckListPreview,
  DeckListPreviewRequest,
  DeckListRequest,
} from '../../src/shared/api/deck-lists';
import { cards } from '../../src/shared/api/samples/deck-cards';
import {
  deckChangesSample,
  deckListCreatedSample,
  deckListPreviewSample,
  deckListUpdatedSample,
  jinxRebelsTypoText,
} from '../../src/shared/api/samples/deck-lists';
import { deckViewSample, jinxBurn } from '../../src/shared/api/samples/decks';

// The deck list import page with the API mocked from the samples: pasting Jinx Rebels with
// "Hextek Vault" misspelled in the sideboard. The mocked preview answers the fixes and skips
// the page sends, as the server will.

const typo = deckListPreviewSample.unmatched[0];

/** The preview sample, with the request's fix or skip for the misspelled line applied. */
function previewFor(request: DeckListPreviewRequest): DeckListPreview {
  const fixed = request.fixes?.some((fix) => fix.lineNumber === typo.lineNumber);
  const skipped = request.skips?.includes(typo.lineNumber);
  if (!fixed && !skipped) return deckListPreviewSample;
  return {
    ...deckListPreviewSample,
    previewId: fixed ? 'dlp_fixed' : 'dlp_skipped',
    lines: deckListPreviewSample.lines.map((line) =>
      line.lineNumber === typo.lineNumber ? { ...line, kind: fixed ? 'card' : 'skipped' } : line,
    ),
    boards: {
      ...deckListPreviewSample.boards,
      sideboard: deckListPreviewSample.boards.sideboard + (fixed ? typo.quantity : 0),
    },
    unmatched: [],
    checks: deckListPreviewSample.checks.filter((check) => !fixed || check.code !== 'sideboard'),
  };
}

async function mockApi(page: Page) {
  // Card images come from the internet; tests never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const previews: DeckListPreviewRequest[] = [];
  await page.route('**/api/deck-lists/preview', (route) => {
    const request = route.request().postDataJSON() as DeckListPreviewRequest;
    previews.push(request);
    const preview = previewFor(request);
    return route.fulfill({
      json:
        request.deckId === undefined
          ? preview
          : {
              ...preview,
              lines: preview.lines.map((line) => ({
                ...line,
                isNew: line.text.startsWith('3 Storm Sage'),
              })),
              changes: deckChangesSample,
            },
    });
  });
  await page.route('**/api/cards?*', (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const pool =
      url.searchParams.get('type') === 'legend'
        ? [cards.jinxLooseCannon, cards.dariusHandOfNoxus]
        : [cards.hextechVault, cards.jinxRebel];
    const results: CardSearchResponse['results'] = pool
      .filter((card) => card.name.toLowerCase().includes(q.slice(0, 4)))
      .map((card) => ({ ...card, owned: 2, free: 2 }));
    return route.fulfill({ json: { results } });
  });
  return previews;
}

const lineRow = (page: Page, lineNumber: number) =>
  page
    .getByRole('list', { name: 'Lines' })
    .getByRole('listitem')
    .nth(lineNumber - 1);

async function paste(page: Page, text = jinxRebelsTypoText) {
  await page.getByLabel('Deck list text').fill(text);
}

test('pasted lines are tagged by board, and Unknown when no card matches', async ({ page }) => {
  await mockApi(page);
  await page.goto('/decks/import');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paste a deck list');
  await paste(page);

  const lines = deckListPreviewSample.lines;
  const firstOn = (board: string) =>
    lines.find((line) => line.kind === 'card' && line.board === board)?.lineNumber ?? 0;
  await expect(lineRow(page, 1)).toHaveText(/Legend:/);
  await expect(lineRow(page, firstOn('legend'))).toContainText('Legend');
  await expect(lineRow(page, firstOn('champion'))).toContainText('Champion');
  await expect(lineRow(page, firstOn('main'))).toContainText('Main');
  await expect(lineRow(page, firstOn('battlefield'))).toContainText('Battlefield');
  await expect(lineRow(page, firstOn('rune'))).toContainText('Rune');
  await expect(lineRow(page, firstOn('sideboard'))).toContainText('Sideboard');
  await expect(lineRow(page, firstOn('maybe'))).toContainText('Maybe');
  await expect(lineRow(page, typo.lineNumber)).toContainText('Hextek Vault');
  await expect(lineRow(page, typo.lineNumber)).toContainText('Unknown');

  const review = page.getByRole('complementary', { name: 'Review' });
  await expect(review.getByRole('listitem', { name: 'Legend' })).toContainText(
    'Jinx, Loose Cannon',
  );
  await expect(review.getByRole('listitem', { name: 'Chosen Champion' })).toContainText(
    'Jinx, Rebel',
  );
  await expect(review.getByLabel('Deck name')).toHaveValue('Jinx, Loose Cannon');
  await expect(review).toContainText('1 name didn’t match a card');
  await expect(review.getByRole('list', { name: 'Warnings' })).toContainText(
    'The sideboard has 6 cards; it needs 8.',
  );
  await expect(review.getByRole('button', { name: 'Create deck' })).toBeDisabled();
  await expect(review).toContainText('Fix or skip the name that didn’t match first.');
});

test('fixing an unknown line sends the card and tags the line by its board', async ({ page }) => {
  const previews = await mockApi(page);
  await page.goto('/decks/import');
  await paste(page);

  const review = page.getByRole('complementary', { name: 'Review' });
  await review.getByRole('button', { name: /^Find the card for/ }).click();
  const dialog = page.getByRole('dialog', { name: `Find the card for line ${typo.lineNumber}` });
  await expect(dialog.getByRole('searchbox', { name: 'Card name' })).toHaveValue('Hextek Vault');
  await dialog.getByRole('searchbox', { name: 'Card name' }).fill('Hextech');
  await dialog.getByRole('button', { name: 'Hextech Vault' }).click();
  await expect(dialog).toBeHidden();

  await expect(lineRow(page, typo.lineNumber)).toContainText('Sideboard');
  await expect(review).toContainText('→ Hextech Vault');
  await expect(review).toContainText('Every name matches a card');
  expect(previews.at(-1)?.fixes).toEqual([
    { lineNumber: typo.lineNumber, cardId: cards.hextechVault.id },
  ]);
  await expect(review.getByRole('button', { name: 'Create deck' })).toBeEnabled();

  // Undo puts the line back to unknown; Skip leaves it out.
  await review.getByRole('button', { name: 'Undo' }).click();
  await expect(lineRow(page, typo.lineNumber)).toContainText('Unknown');
  await review.getByRole('button', { name: /^Skip/ }).click();
  await expect(lineRow(page, typo.lineNumber)).toContainText('Skipped');
  expect(previews.at(-1)?.skips).toEqual([typo.lineNumber]);
});

test('changing the proposed Legend and creating the deck opens it', async ({ page }) => {
  await mockApi(page);
  let created: DeckListCreate | null = null;
  let previewId = '';
  await page.route('**/api/deck-lists/*/create', (route) => {
    created = route.request().postDataJSON();
    previewId = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    return route.fulfill({ status: 201, json: deckListCreatedSample });
  });
  await page.goto('/decks/import');
  await paste(page);

  const review = page.getByRole('complementary', { name: 'Review' });
  await review.getByRole('button', { name: 'Change the Legend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose the Legend' });
  await dialog.getByRole('searchbox', { name: 'Card name' }).fill('Darius');
  await dialog.getByRole('button', { name: 'Darius, Hand of Noxus' }).click();
  await expect(review.getByRole('listitem', { name: 'Legend' })).toContainText(
    'Darius, Hand of Noxus',
  );
  await expect(review.getByLabel('Deck name')).toHaveValue('Darius, Hand of Noxus');
  await review.getByLabel('Deck name').fill('Jinx Rebels');

  await review.getByRole('button', { name: /^Skip/ }).click();
  await expect(review).toContainText('Every name matches a card');
  await review.getByRole('button', { name: 'Create deck' }).click();
  await expect(page).toHaveURL(`/decks/${deckListCreatedSample.id}`);
  expect(previewId).toBe('dlp_skipped');
  expect(created).toEqual({
    name: 'Jinx Rebels',
    legendId: cards.dariusHandOfNoxus.id,
    championId: cards.jinxRebel.id,
  });
});

test('Update from deck list shows the changes and ends on the swap list', async ({ page }) => {
  const previews = await mockApi(page);
  await page.route('**/api/decks/1', (route) => route.fulfill({ json: deckViewSample }));
  let sent: DeckListRequest | null = null;
  await page.route('**/api/decks/1/deck-list', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: deckListUpdatedSample });
  });
  await page.route('**/api/decks/1/swap', (route) => route.abort());

  await page.goto('/decks/1');
  await page
    .getByRole('region', { name: 'Deck header' })
    .getByRole('link', { name: 'Update from deck list' })
    .click();
  await expect(page).toHaveURL('/decks/1/deck-list');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `Update ${jinxBurn.name} from a deck list`,
  );
  await paste(page);

  const review = page.getByRole('complementary', { name: 'Review' });
  const changes = review.getByRole('list', { name: 'Changes' });
  await expect(changes).toContainText('+2 Storm Sage, into the main deck');
  expect(previews.at(-1)?.deckId).toBe(1);
  await expect(changes).toContainText('−1 Dawn Snare, out of the main deck');
  await expect(changes).toContainText('Calm Rune in the rune deck: 8 → 6');
  await expect(review).toContainText('updating opens the swap list');
  await expect(review.getByRole('button', { name: 'Change the Legend' })).toHaveCount(0);

  await review.getByRole('button', { name: /^Skip/ }).click();
  await review.getByRole('button', { name: 'Update deck and open swap list' }).click();
  await expect(page).toHaveURL('/decks/1/swap');
  expect(sent).toEqual({ text: jinxRebelsTypoText, skips: [typo.lineNumber] });
});

test('an empty deck offers Paste a deck list', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/decks/1', (route) =>
    route.fulfill({
      json: {
        ...deckViewSample,
        slots: deckViewSample.slots.filter((slot) => slot.board === 'legend'),
      },
    }),
  );
  await page.goto('/decks/1');
  await expect(
    page
      .getByRole('region', { name: 'Empty deck' })
      .getByRole('link', { name: 'Paste a deck list' }),
  ).toHaveAttribute('href', '/decks/1/deck-list');
});
