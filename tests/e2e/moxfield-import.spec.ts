import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { CardSearchResponse } from '../../src/shared/api/cards';
import type { MoxfieldCreateRequest, MoxfieldPreviewRequest } from '../../src/shared/api/moxfield';
import type {
  MoxfieldUpdateApplyRequest,
  MoxfieldUpdatePreview,
  MoxfieldUpdatePreviewRequest,
} from '../../src/shared/api/moxfield-update';
import { listChecksSample } from '../../src/shared/api/samples/deck-checks';
import { deckViewSample } from '../../src/shared/api/samples/decks';
import {
  moxfieldCreateResult,
  moxfieldPreview,
  sampleCard,
} from '../../src/shared/api/samples/moxfield';
import {
  moxfieldUpdateApplyResult,
  moxfieldUpdatePreview,
} from '../../src/shared/api/samples/moxfield-update';

const fixture = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'moxfield-deck-sample-with-sets.txt',
);
const exportText = readFileSync(fixture, 'utf8');

const hearthhull = sampleCard('Hearthhull, the Worldseed');
const szarel = sampleCard('Szarel, Genesis Shepherd');
const korvold = sampleCard('Korvold, Fae-Cursed King');

/** Answers the API from the samples and records what the page sent. */
async function mockApi(page: Page) {
  const sent = {
    previews: [] as MoxfieldPreviewRequest[],
    creates: [] as MoxfieldCreateRequest[],
    checks: 0,
    searches: [] as URLSearchParams[],
  };
  // Card images come from Scryfall; tests never reach the network.
  await page.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route) => route.abort(),
  );
  await page.route('**/api/imports/moxfield/preview', async (route) => {
    sent.previews.push(route.request().postDataJSON());
    await route.fulfill({ json: moxfieldPreview });
  });
  await page.route('**/api/imports/moxfield/create', async (route) => {
    sent.creates.push(route.request().postDataJSON());
    await route.fulfill({ json: moxfieldCreateResult });
  });
  await page.route('**/api/deck-checks', async (route) => {
    sent.checks++;
    await route.fulfill({ json: listChecksSample });
  });
  await page.route('**/api/cards/search?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    sent.searches.push(params);
    const cards =
      params.get('commander') === '1' ? [szarel, korvold] : [sampleCard('Evendo Brushrazer')];
    const answer: CardSearchResponse = {
      results: cards.map((card) => ({ ...card, owned: 1, free: 1 })),
    };
    await route.fulfill({ json: answer });
  });
  return sent;
}

async function paste(page: Page, text = exportText) {
  await page.getByLabel('Moxfield export').fill(text);
}

const review = (page: Page) => page.getByRole('complementary', { name: 'Review' });

test('pasting shows the tagged lines and the review', async ({ page }) => {
  const sent = await mockApi(page);
  await page.goto('/import/moxfield');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import a Moxfield deck');

  await paste(page);
  const lines = page.getByRole('list', { name: 'Lines' });
  await expect(lines.getByRole('listitem')).toHaveCount(moxfieldPreview.lines.length);
  await expect(lines.locator('[data-tag="commander"]')).toContainText('Commander');
  await expect(lines.locator('[data-tag="basic"]').first()).toContainText('Basic');
  await expect(lines.locator('[data-tag="maybe"]').first()).toContainText('Maybe board');
  await expect(lines.locator('[data-tag="unmatched"]')).toContainText('Evendo Brushrazer');
  await expect(lines.locator('[data-tag="unmatched"]')).toContainText('Unmatched');
  await expect(page.getByText('Moxfield, with sets')).toBeVisible();

  expect(sent.previews).toHaveLength(1);
  expect(sent.previews[0]).toEqual({ text: exportText });

  await expect(review(page).getByRole('list', { name: 'Commanders' })).toHaveText(hearthhull.name);
  await expect(review(page).getByLabel('Deck name')).toHaveValue(hearthhull.name);
  const counts = review(page).getByRole('definition');
  await expect(counts.nth(1)).toHaveText('Main board');
  await expect(review(page).getByRole('term').nth(1)).toHaveText('94');
  await expect(review(page).getByRole('term').nth(2)).toHaveText('17');
  await expect(counts.nth(2)).toContainText('8 Forest, 5 Swamp, 3 Mountain, 1 Wastes');
  await expect(review(page).getByRole('term').nth(3)).toHaveText('5');
});

test('legality warnings show and never block', async ({ page }) => {
  const sent = await mockApi(page);
  await page.goto('/import/moxfield');
  await paste(page);

  const warnings = review(page).getByRole('list', { name: 'Warnings' });
  await expect(warnings.getByRole('listitem')).toHaveText(
    listChecksSample.warnings.map((warning) => warning.message),
  );
  expect(sent.checks).toBeGreaterThan(0);
  await expect(review(page)).toContainText('checks only warn');
});

test('a note shows when Scryfall could not be reached', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/imports/moxfield/preview', (route) =>
    route.fulfill({ json: { ...moxfieldPreview, lookupFailed: true } }),
  );
  await page.goto('/import/moxfield');
  await paste(page);
  await expect(review(page).getByRole('status')).toContainText("Scryfall couldn't be reached");
});

test('changing the commander and fixing a name go to the next preview', async ({ page }) => {
  const sent = await mockApi(page);
  await page.goto('/import/moxfield');
  await paste(page);
  await expect(review(page).getByRole('list', { name: 'Commanders' })).toBeVisible();

  await review(page).getByRole('button', { name: 'Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose the commander' });
  await dialog.getByPlaceholder('Card name').fill('szarel');
  await dialog.getByRole('button', { name: /Szarel, Genesis Shepherd/ }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => sent.previews.at(-1)?.commanders).toEqual([szarel.oracleId]);
  expect(sent.searches.at(-1)?.get('commander')).toBe('1');
  expect(sent.searches.at(-1)?.get('q')).toBe('szarel');

  // The sample answer still names Hearthhull, so the partner goes after it.
  await review(page).getByRole('button', { name: 'Add partner' }).click();
  const partner = page.getByRole('dialog', { name: 'Add a partner' });
  await partner.getByPlaceholder('Card name').fill('korvold');
  await partner.getByRole('button', { name: /Korvold, Fae-Cursed King/ }).click();
  await expect
    .poll(() => sent.previews.at(-1)?.commanders)
    .toEqual([hearthhull.oracleId, korvold.oracleId]);

  const unmatched = review(page).getByRole('listitem', { name: 'Line 21: Evendo Brushrazer' });
  await unmatched.getByRole('button', { name: 'Find card' }).click();
  const fix = page.getByRole('dialog', { name: 'Find the card for line 21' });
  await expect(fix.getByPlaceholder('Card name')).toHaveValue('Evendo Brushrazer');
  await fix.getByRole('button', { name: /Evendo Brushrazer/ }).click();
  await expect
    .poll(() => sent.previews.at(-1)?.fixes)
    .toEqual({ 21: sampleCard('Evendo Brushrazer').oracleId });
  expect(sent.searches.at(-1)?.get('commander')).toBeNull();
  await expect(unmatched).toContainText('→ Evendo Brushrazer');
});

test('Create sends the name, commanders, fixes and skips, then opens the deck', async ({
  page,
}) => {
  const sent = await mockApi(page);
  await page.goto('/import/moxfield');
  // A second unmatched line to skip.
  const text = `${exportText.trimEnd()}\n1 Mystery Card`;
  await page.route('**/api/imports/moxfield/preview', async (route) => {
    sent.previews.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ...moxfieldPreview,
        lines: [...moxfieldPreview.lines, { lineNo: 93, text: '1 Mystery Card', tag: 'unmatched' }],
        unmatched: [
          ...moxfieldPreview.unmatched,
          { lineNo: 93, name: 'Mystery Card', quantity: 1 },
        ],
      },
    });
  });
  await paste(page, text);

  const create = review(page).getByRole('button', { name: 'Create deck' });
  await expect(create).toBeDisabled();
  await expect(review(page)).toContainText('Fix or skip the 2 unmatched names first.');

  await review(page)
    .getByRole('listitem', { name: 'Line 93: Mystery Card' })
    .getByRole('button', { name: 'Skip' })
    .click();
  await expect.poll(() => sent.previews.at(-1)?.skips).toEqual([93]);

  await review(page)
    .getByRole('listitem', { name: 'Line 21: Evendo Brushrazer' })
    .getByRole('button', { name: 'Find card' })
    .click();
  await page
    .getByRole('dialog', { name: 'Find the card for line 21' })
    .getByRole('button', { name: /Evendo Brushrazer/ })
    .click();

  await review(page).getByLabel('Deck name').fill('Hearthhull lands');
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page).toHaveURL(`/decks/${moxfieldCreateResult.deckId}`);
  expect(sent.creates).toEqual([
    {
      text,
      name: 'Hearthhull lands',
      commanders: [hearthhull.oracleId],
      fixes: { 21: sampleCard('Evendo Brushrazer').oracleId },
      skips: [93],
    },
  ]);
});

test('uploading the .txt file reads it like a paste', async ({ page }) => {
  const sent = await mockApi(page);
  await page.goto('/import/moxfield');
  await page.getByLabel('Upload a .txt file').setInputFiles(fixture);
  await expect(page.getByLabel('Moxfield export')).toHaveValue(exportText);
  await expect.poll(() => sent.previews.at(-1)?.text).toBe(exportText);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('Moxfield export')).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Lines' })).toBeHidden();
});

test.describe('Update a deck mode', () => {
  const deck = deckViewSample.deck;

  /** Answers the update endpoints from the samples and records what the page sent. */
  async function mockUpdate(page: Page, result = moxfieldUpdateApplyResult) {
    const sent = {
      previews: [] as MoxfieldUpdatePreviewRequest[],
      applies: [] as MoxfieldUpdateApplyRequest[],
    };
    await mockApi(page);
    await page.route(`**/api/decks/${deck.id}`, (route) => route.fulfill({ json: deckViewSample }));
    await page.route('**/api/imports/moxfield/update-preview', async (route) => {
      sent.previews.push(route.request().postDataJSON());
      await route.fulfill({ json: moxfieldUpdatePreview });
    });
    await page.route('**/api/imports/moxfield/update-apply', async (route) => {
      sent.applies.push(route.request().postDataJSON());
      await route.fulfill({ json: result });
    });
    return sent;
  }

  test('shows the deck name, New tags and the change list', async ({ page }) => {
    const sent = await mockUpdate(page);
    await page.goto(`/import/moxfield?deck=${deck.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Update from Moxfield');
    await expect(page.getByRole('link', { name: deck.name })).toHaveAttribute(
      'href',
      `/decks/${deck.id}`,
    );

    await paste(page);
    const lines = page.getByRole('list', { name: 'Lines' });
    const newLines = lines.locator('[data-new]');
    await expect(newLines).toHaveCount(2);
    await expect(newLines.nth(0)).toContainText("Assassin's Trophy");
    await expect(newLines.nth(0)).toContainText('New');
    await expect(newLines.nth(1)).toContainText('Chaos Warp');
    await expect(lines.locator('[data-tag="main"]:not([data-new])').first()).not.toContainText(
      'New',
    );
    expect(sent.previews[0]).toEqual({ deckId: deck.id, text: exportText });

    await expect(review(page).getByRole('heading', { name: deck.name })).toBeVisible();
    await expect(review(page).getByLabel('Deck name')).toHaveCount(0);

    await expect(review(page).getByRole('heading', { name: 'What changes' })).toBeVisible();
    const changes = review(page);
    await expect(changes.getByRole('region', { name: '2 out' }).getByRole('listitem')).toHaveText([
      '1 Blasphemous Act',
      '1 Infernal Grasp',
    ]);
    await expect(changes.getByRole('region', { name: '2 in' }).getByRole('listitem')).toHaveText([
      "1 Assassin's Trophy",
      '1 Chaos Warp',
    ]);
  });

  test('changed quantities are listed', async ({ page }) => {
    await mockUpdate(page);
    const forest = sampleCard('Forest');
    await page.route('**/api/imports/moxfield/update-preview', (route) =>
      route.fulfill({
        json: {
          ...moxfieldUpdatePreview,
          changes: {
            added: [],
            removed: [],
            changed: [{ card: forest, board: 'main', from: 7, to: 8 }],
          },
        } satisfies MoxfieldUpdatePreview,
      }),
    );
    await page.goto(`/import/moxfield?deck=${deck.id}`);
    await paste(page);
    const changed = review(page).getByRole('region', { name: '1 changed quantity' });
    await expect(changed.getByRole('listitem')).toHaveText(['Forest: 7 → 8']);
  });

  test('Update deck goes to the swap list when the deck box needs a swap', async ({ page }) => {
    const sent = await mockUpdate(page);
    await page.goto(`/import/moxfield?deck=${deck.id}`);
    await paste(page);
    const update = review(page).getByRole('button', { name: 'Update deck' });
    await expect(update).toBeEnabled();
    await update.click();

    await expect(page).toHaveURL(`/decks/${deck.id}/swap`);
    expect(sent.applies).toEqual([
      {
        deckId: deck.id,
        text: exportText,
        commanders: [hearthhull.oracleId],
        fixes: {},
        skips: [],
      },
    ]);
  });

  test('Update deck goes back to the deck view otherwise', async ({ page }) => {
    await mockUpdate(page, { ...moxfieldUpdateApplyResult, needsSwap: false });
    await page.goto(`/import/moxfield?deck=${deck.id}`);
    await paste(page);
    await review(page).getByRole('button', { name: 'Update deck' }).click();
    await expect(page).toHaveURL(`/decks/${deck.id}`);
  });
});
