import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { setDb } from '../../src/server/db/database';
import { createTestDb } from '../../src/server/db/test-db';
import { ErrorBody } from '../../src/shared/api/common';
import { DeckCheckCode } from '../../src/shared/api/deck-checks';
import {
  DeckChanges,
  DeckListPreview,
  DeckListText,
  DeckListUpdated,
} from '../../src/shared/api/deck-lists';
import { DeckRunes, DeckSummary, SlotChange } from '../../src/shared/api/decks';
import { DeckListExport } from '../../src/shared/api/exports';
import {
  deckChangesSample,
  deckExportSample,
  deckListCreatedSample,
  deckListPreviewSample,
  deckListUpdatedSample,
  deckPlainExportSample,
  jinxRebelsText,
  jinxRebelsTypoText,
  locationExportSample,
} from '../../src/shared/api/samples/deck-lists';

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

beforeEach(() => {
  setDb(createTestDb());
});

describe('deck list samples', () => {
  it.each([
    ['preview', DeckListPreview, deckListPreviewSample],
    ['created deck', DeckSummary, deckListCreatedSample],
    ['changes', DeckChanges, deckChangesSample],
    ['update', DeckListUpdated, deckListUpdatedSample],
    ['deck export', DeckListExport, deckExportSample],
    ['plain deck export', DeckListExport, deckPlainExportSample],
    ['location export', DeckListExport, locationExportSample],
  ] as const)('the %s sample parses', (_name, schema, sample) => {
    expect(() => (schema as z.ZodType).parse(sample)).not.toThrow();
  });

  it('Jinx Rebels is a full Riftbound deck', () => {
    const preview = DeckListPreview.parse(deckListPreviewSample);
    // The typo line is on the sideboard, so every other board is whole.
    expect(preview.boards).toMatchObject({
      legend: 1,
      champion: 1,
      main: 39,
      battlefield: 3,
      rune: 12,
      sideboard: 6,
    });
    const copies = new Map<number, number>();
    for (const slot of preview.slots) {
      if (slot.board === 'maybe' || slot.board === 'rune') continue;
      copies.set(slot.card.id, (copies.get(slot.card.id) ?? 0) + slot.quantity);
    }
    expect(Math.max(...copies.values())).toBeLessThanOrEqual(3);
    const domains = new Set(preview.legend?.domains);
    for (const slot of preview.slots.filter((s) => s.board !== 'maybe')) {
      expect(
        slot.card.domains.every((d) => domains.has(d)),
        slot.card.name,
      ).toBe(true);
    }
    expect(preview.checks.map((check) => check.code)).toEqual(DeckCheckCode.options);
  });

  it('numbers every line of the pasted text and lists the misspelled one', () => {
    const lines = jinxRebelsTypoText.trimEnd().split('\n');
    expect(deckListPreviewSample.lines.map((line) => line.text)).toEqual(lines);
    expect(deckListPreviewSample.lines.map((line) => line.lineNumber)).toEqual(
      lines.map((_line, i) => i + 1),
    );
    const [typo] = deckListPreviewSample.unmatched;
    expect(lines[typo.lineNumber - 1]).toMatch(/^2 Hextek Vault /);
    expect(jinxRebelsText).toContain('2 Hextech Vault ');
  });

  it('writes deck lists in the format the import reads', () => {
    expect(jinxRebelsText.split('\n').slice(0, 5)).toEqual([
      'Legend:',
      '1 Jinx, Loose Cannon OGN-001 *F*',
      '',
      'Champion:',
      '1 Jinx, Rebel OGN-202',
    ]);
    expect(jinxRebelsText).toContain('3 Sun Disc OGN-');
    expect(jinxRebelsText).toMatch(/^3 Sun Disc OGN-\d+ #energy rock #Ramp$/m);
    for (const sample of [deckExportSample, deckPlainExportSample]) {
      const cardLines = sample.text.split('\n').filter((line) => /^\d/.test(line));
      expect(cardLines).toHaveLength(sample.lineCount);
      expect(cardLines.reduce((n, line) => n + Number.parseInt(line, 10), 0)).toBe(
        sample.cardCount + sample.runeCount + sample.maybeCount,
      );
    }
    expect(deckExportSample.maybeCount).toBeGreaterThan(0);
    expect(deckPlainExportSample.maybeCount).toBe(0);
    expect(deckPlainExportSample.text).not.toContain('#');
    expect(deckPlainExportSample.text).not.toContain('Maybe:');
  });
});

describe('deck list routes', () => {
  // STUB until #19.
  it('POST /api/deck-lists/preview answers the preview', async () => {
    const res = await api['deck-lists'].preview.$post({ json: { text: jinxRebelsTypoText } });
    expect(res.status).toBe(200);
    expect(DeckListPreview.parse(await res.json()).previewId).toBe('dlp_7f3a9c');
  });

  it('POST /api/deck-lists/preview refuses an empty list', async () => {
    const res = await api['deck-lists'].preview.$post({ json: { text: '  \n' } });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
    expect(DeckListText.safeParse('1 Sun Disc').success).toBe(true);
  });

  // STUB until #19.
  it('POST /api/deck-lists/:previewId/create makes the deck', async () => {
    const res = await api['deck-lists'][':previewId'].create.$post({
      param: { previewId: 'dlp_7f3a9c' },
      json: { name: 'Jinx Rebels', legendId: 124, championId: 341 },
    });
    expect(res.status).toBe(201);
    expect(DeckSummary.parse(await res.json()).name).toBe('Jinx Rebels');
  });

  it('POST /api/deck-lists/:previewId/create refuses an id that isn’t a preview', async () => {
    const res = await api['deck-lists'][':previewId'].create.$post({
      param: { previewId: 'nope' },
      json: { name: 'Jinx Rebels', legendId: 124, championId: null },
    });
    expect(res.status).toBe(400);
  });

  // STUB until #19.
  it('POST /api/decks/:id/deck-list answers whether a swap list is needed', async () => {
    const res = await api.decks[':id']['deck-list'].$post({
      param: { id: '1' },
      json: { text: jinxRebelsText, skips: [3] },
    });
    expect(res.status).toBe(200);
    expect(DeckListUpdated.parse(await res.json()).needsSwap).toBe(true);
  });
});

describe('deck routes added for Riftbound', () => {
  it('PUT /api/decks/:id/runes answers 404 for a deck that doesn’t exist', async () => {
    const res = await api.decks[':id'].runes.$put({
      param: { id: '1' },
      json: { runes: [{ cardId: 172, quantity: 6 }] },
    });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });

  it('PUT /api/decks/:id/runes takes each rune card once', () => {
    const twice = {
      runes: [
        { cardId: 172, quantity: 6 },
        { cardId: 172, quantity: 2 },
      ],
    };
    expect(DeckRunes.safeParse(twice).success).toBe(false);
    expect(DeckRunes.safeParse({ runes: [{ cardId: 172, quantity: 0 }] }).success).toBe(true);
  });

  it('moves a slot only between the main deck, sideboard and maybe board', () => {
    for (const board of ['main', 'sideboard', 'maybe']) {
      expect(SlotChange.safeParse({ board }).success, board).toBe(true);
    }
    for (const board of ['legend', 'champion', 'battlefield', 'rune']) {
      expect(SlotChange.safeParse({ board }).success, board).toBe(false);
    }
  });
});

describe('deck list exports', () => {
  // STUB until #20.
  it.each([
    ['decks', deckExportSample],
    ['locations', locationExportSample],
  ] as const)(
    'GET /api/exports/%s/:id/deck-list answers the list and the .txt file',
    async (area, sample) => {
      const json = await app.request(`/api/exports/${area}/1/deck-list`);
      expect(json.status).toBe(200);
      expect(DeckListExport.parse(await json.json())).toEqual(sample);

      const file = await app.request(`/api/exports/${area}/1/deck-list.txt`);
      expect(file.status).toBe(200);
      expect(file.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(file.headers.get('Content-Disposition')).toBe(
        `attachment; filename="${sample.fileName}"`,
      );
      expect(await file.text()).toBe(sample.text);
    },
  );

  it('refuses an id that isn’t a number', async () => {
    const res = await app.request('/api/exports/decks/abc/deck-list');
    expect(res.status).toBe(400);
  });

  it('takes the tags and maybe options and refuses anything but 0 or 1', async () => {
    for (const query of ['tags=0&maybe=0', 'tags=1&maybe=0', '']) {
      const res = await app.request(`/api/exports/decks/1/deck-list.txt?${query}`);
      expect(res.status, query).toBe(200);
    }
    const res = await app.request('/api/exports/decks/1/deck-list?tags=yes');
    expect(res.status).toBe(400);
  });
});
