import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { ErrorBody } from '../../src/shared/api/common';
import { ManaBoxApplyResult, ManaBoxPreview } from '../../src/shared/api/manabox';
import { ManaBoxUpdateApplyResult, UpdatePreview } from '../../src/shared/api/manabox-update';
import { MoxfieldCreateResult, MoxfieldPreview } from '../../src/shared/api/moxfield';
import {
  MoxfieldUpdateApplyResult,
  MoxfieldUpdatePreview,
} from '../../src/shared/api/moxfield-update';
import {
  manaboxApplyResult,
  manaboxBinderPreview,
  manaboxPreview,
  missingColumnsError,
  previewExpiredError,
} from '../../src/shared/api/samples/manabox';
import { updateApplyResult, updatePreview } from '../../src/shared/api/samples/manabox-update';
import { moxfieldCreateResult, moxfieldPreview } from '../../src/shared/api/samples/moxfield';
import {
  moxfieldUpdateApplyResult,
  moxfieldUpdatePreview,
} from '../../src/shared/api/samples/moxfield-update';

const fixtures = path.join(import.meta.dirname, '..', 'fixtures');

// The typed client, answered by the app in this process.
const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

async function sampleCsv() {
  const csv = await readFile(path.join(fixtures, 'manabox-sample.csv'));
  return new File([csv], 'manabox-sample.csv', { type: 'text/csv' });
}

async function deckText() {
  return readFile(path.join(fixtures, 'moxfield-deck-sample-with-sets.txt'), 'utf8');
}

describe('imports samples', () => {
  it('match their schemas', () => {
    expect(ManaBoxPreview.parse(manaboxPreview)).toEqual(manaboxPreview);
    expect(ManaBoxPreview.parse(manaboxBinderPreview)).toEqual(manaboxBinderPreview);
    expect(ManaBoxApplyResult.parse(manaboxApplyResult)).toEqual(manaboxApplyResult);
    expect(ErrorBody.parse(missingColumnsError)).toEqual(missingColumnsError);
    expect(ErrorBody.parse(previewExpiredError)).toEqual(previewExpiredError);
    expect(UpdatePreview.parse(updatePreview)).toEqual(updatePreview);
    expect(ManaBoxUpdateApplyResult.parse(updateApplyResult)).toEqual(updateApplyResult);
    expect(MoxfieldPreview.parse(moxfieldPreview)).toEqual(moxfieldPreview);
    expect(MoxfieldCreateResult.parse(moxfieldCreateResult)).toEqual(moxfieldCreateResult);
    expect(MoxfieldUpdatePreview.parse(moxfieldUpdatePreview)).toEqual(moxfieldUpdatePreview);
    expect(MoxfieldUpdateApplyResult.parse(moxfieldUpdateApplyResult)).toEqual(
      moxfieldUpdateApplyResult,
    );
  });

  it('describe the fixture files they stand for', async () => {
    const text = (await deckText()).split('\n');
    expect(moxfieldPreview.lines.map((line) => line.text)).toEqual(text.slice(0, -1));
    const cards = (board: string) =>
      moxfieldPreview.slots
        .filter((slot) => slot.board === board)
        .reduce((sum, slot) => sum + slot.quantity, 0);
    // The unmatched line is counted on its board but has no slot.
    expect(cards('main') + 1).toBe(moxfieldPreview.counts.main);
    expect(cards('maybe')).toBe(moxfieldPreview.counts.maybe);
    expect(moxfieldUpdatePreview.lines.filter((line) => line.isNew)).toHaveLength(2);
    expect(Object.values(updatePreview.groups).map((rows) => rows.length)).toEqual([1, 1, 1, 1]);
  });
});

describe('imports stubs', () => {
  it('answer a request without its file or with bad values with 400 invalid_request', async () => {
    const noFile = await app.request('/api/imports/manabox/preview', {
      method: 'POST',
      body: new FormData(),
    });
    const badLocation = await api.imports.manabox['update-preview'].$post({
      form: { file: await sampleCsv(), locationId: 'shelf' },
    });
    const badFix = await app.request('/api/imports/manabox/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ previewId: 'x', allProxies: false, fixes: { one: 'x' }, skips: [] }),
    });
    const threeCommanders = await api.imports.moxfield.create.$post({
      json: { text: '', name: 'Deck', commanders: ['a', 'b', 'c'], fixes: {}, skips: [] },
    });
    for (const res of [noFile, badLocation, badFix, threeCommanders]) {
      expect(res.status).toBe(400);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
    }
  });
});
