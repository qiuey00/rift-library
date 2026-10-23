import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, deckSlots, deckSlotTags } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { deckView } from '../../src/server/queries/decks';
import { lookupCards } from '../../src/server/scryfall/lookup';
import {
  createDeck,
  moveSlotBoard,
  removeSlot,
  setCommanders,
  setSlotTags,
  tagKey,
} from '../../src/server/services/decks';
import { createMoxfieldDeck } from '../../src/server/services/imports/moxfield';
import type { Board } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { SlotRow } from '../../src/shared/api/decks';

// Tests never call Scryfall: names the app doesn't know stay unmatched.
vi.mock('../../src/server/scryfall/lookup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/server/scryfall/lookup')>();
  return { ...original, lookupCards: vi.fn() };
});
const lookup = vi.mocked(lookupCards);

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, '..', 'fixtures', name), 'utf8');

const oracle = (name: string) => `oracle-${name}`;
const HEARTHHULL = oracle('Hearthhull, the Worldseed');
const SOL_RING = oracle('Sol Ring');

let db: OpenDb;
let deckId: number;

function insertCard(name: string, options: { canBeCommander?: boolean } = {}) {
  db.insert(cards)
    .values({
      oracleId: oracle(name),
      name,
      frontFaceName: name,
      typeLine: 'Card',
      commanderLegality: 'legal',
      ...options,
    })
    .run();
}

function slotId(oracleId: string, board: Board, deck = deckId) {
  const slot = db
    .select({ id: deckSlots.id })
    .from(deckSlots)
    .where(
      and(eq(deckSlots.deckId, deck), eq(deckSlots.oracleId, oracleId), eq(deckSlots.board, board)),
    )
    .get();
  if (!slot) throw new Error(`no ${board} slot for ${oracleId}`);
  return slot.id;
}

/** The deck view's tags per slot, as "board name". */
function tagsByCard(deck = deckId) {
  return Object.fromEntries(
    (deckView(db, deck)?.slots ?? []).map((slot) => [`${slot.board} ${slot.card.name}`, slot.tags]),
  );
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  lookup.mockReset();
  lookup.mockImplementation(async (_db, identifiers) => ({ resolved: [], not_found: identifiers }));
  insertCard('Hearthhull, the Worldseed', { canBeCommander: true });
  insertCard('Atraxa, Grand Unifier', { canBeCommander: true });
  for (const name of [
    'Sol Ring',
    'Arcane Signet',
    'Farseek',
    'Chaos Warp',
    'Adeline, Resplendent Cathar',
    'Ashaya, Soul of the Wild',
    "Avacyn's Pilgrim",
    'Beast Whisperer',
    'Beast Within',
  ]) {
    insertCard(name);
  }
  deckId = createDeck(db, {
    name: 'Hearthhull',
    slots: [
      { oracleId: HEARTHHULL, board: 'commander', quantity: 1 },
      { oracleId: SOL_RING, board: 'main', quantity: 1 },
      { oracleId: oracle('Arcane Signet'), board: 'main', quantity: 1 },
      { oracleId: oracle('Farseek'), board: 'main', quantity: 1 },
      { oracleId: oracle('Farseek'), board: 'maybe', quantity: 1 },
    ],
  });
});
afterEach(() => db.$client.close());

async function putTags(tags: string[], slot = slotId(SOL_RING, 'main'), deck = deckId) {
  return api.decks[':id'].slots[':slotId'].tags.$put({
    param: { id: String(deck), slotId: String(slot) },
    json: { tags },
  });
}

describe('PUT /api/decks/:id/slots/:slotId/tags', () => {
  it('replaces the slot’s tags and answers the slot, tags sorted ignoring case', async () => {
    const res = await putTags(['Ramp', 'mana rock', 'Artifact']);
    expect(res.status).toBe(200);
    const row = SlotRow.parse(await res.json());
    expect(row).toMatchObject({ id: slotId(SOL_RING, 'main'), quantity: 1 });
    expect(row.tags).toEqual(['Artifact', 'mana rock', 'Ramp']);

    const again = SlotRow.parse(await (await putTags(['Fast mana'])).json());
    expect(again.tags).toEqual(['Fast mana']);
    expect(tagsByCard()['main Sol Ring']).toEqual(['Fast mana']);
  });

  it('trims each tag and merges tags with the same key, keeping the first spelling', async () => {
    const res = await putTags(['  Card draw ', 'card-draw', 'CARD   DRAW', 'Ramp', 'ramp']);
    expect(SlotRow.parse(await res.json()).tags).toEqual(['Card draw', 'Ramp']);
    expect(db.select().from(deckSlotTags).all()).toEqual(
      expect.arrayContaining([
        { slotId: slotId(SOL_RING, 'main'), tag: 'Card draw', tagKey: 'card-draw' },
        { slotId: slotId(SOL_RING, 'main'), tag: 'Ramp', tagKey: 'ramp' },
      ]),
    );
  });

  it('clears the tags with an empty list', async () => {
    await putTags(['Ramp']);
    const res = await putTags([]);
    expect(SlotRow.parse(await res.json()).tags).toEqual([]);
    expect(db.select().from(deckSlotTags).all()).toEqual([]);
  });

  it('lets Jeff respell a tag on its slot, but joins a spelling another slot has', async () => {
    await putTags(['card draw']);
    expect(SlotRow.parse(await (await putTags(['Card Draw'])).json()).tags).toEqual(['Card Draw']);

    const signet = slotId(oracle('Arcane Signet'), 'main');
    const res = await putTags(['CARD-DRAW'], signet);
    expect(SlotRow.parse(await res.json()).tags).toEqual(['Card Draw']);
  });

  it('answers 404 slot_not_found for a slot of another deck', async () => {
    const other = createDeck(db, {
      name: 'Atraxa',
      slots: [{ oracleId: SOL_RING, board: 'main', quantity: 1 }],
    });
    const res = await putTags(['Ramp'], slotId(SOL_RING, 'main', other));
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('slot_not_found');
  });

  it('answers 404 deck_not_found and 400 invalid_request', async () => {
    const missing = await putTags(['Ramp'], slotId(SOL_RING, 'main'), 999);
    expect(missing.status).toBe(404);
    expect(ErrorBody.parse(await missing.json()).error.code).toBe('deck_not_found');

    for (const tags of [['#ramp'], [''], ['x'.repeat(41)]]) {
      const res = await putTags(tags);
      expect(res.status).toBe(400);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
    }
  });
});

describe('tag rules', () => {
  it('keys tags in lower case with each run of spaces as -', () => {
    expect(tagKey('  Card   Draw ')).toBe('card-draw');
    expect(tagKey('token-maker')).toBe('token-maker');
  });

  it('deletes a slot’s tags with the slot', () => {
    setSlotTags(db, deckId, slotId(SOL_RING, 'main'), ['Ramp']);
    removeSlot(db, deckId, slotId(SOL_RING, 'main'));
    expect(db.select().from(deckSlotTags).all()).toEqual([]);
  });

  it('keeps the tags of both slots when a board move merges them', () => {
    setSlotTags(db, deckId, slotId(oracle('Farseek'), 'main'), ['Ramp', 'Land search']);
    setSlotTags(db, deckId, slotId(oracle('Farseek'), 'maybe'), ['ramp', 'Cheap']);
    const merged = moveSlotBoard(db, deckId, slotId(oracle('Farseek'), 'main'), 'maybe');
    expect(merged).toBe(slotId(oracle('Farseek'), 'maybe'));
    expect(tagsByCard()['maybe Farseek']).toEqual(['Cheap', 'Land search', 'Ramp']);
    expect(tagsByCard()['main Farseek']).toBeUndefined();
  });

  it('keeps a card’s tags when it moves up to be the commander', () => {
    setSlotTags(db, deckId, slotId(SOL_RING, 'main'), ['Ramp']);
    setCommanders(db, deckId, [SOL_RING]);
    expect(tagsByCard()['commander Sol Ring']).toEqual(['Ramp']);
  });

  it('never changes a slot’s status, counts or the deck’s state', () => {
    const before = deckView(db, deckId);
    for (const slot of before?.slots ?? []) setSlotTags(db, deckId, slot.id, ['Ramp', 'Combo']);
    const after = deckView(db, deckId);
    expect(after?.deck).toEqual(before?.deck);
    expect(after?.slots.map(({ tags, ...rest }) => rest)).toEqual(
      before?.slots.map(({ tags, ...rest }) => rest),
    );
    expect(after?.slots.every((slot) => slot.tags.join() === 'Combo,Ramp')).toBe(true);
  });
});

describe('Moxfield tags', () => {
  it('saves the tags of Jeff’s tagged export on the new deck’s slots', async () => {
    const text = `1 Atraxa, Grand Unifier (ONE) 196 #commander\n${fixture('moxfield-deck-sample-with-tags.txt')}`;
    const { deckId: id } = await createMoxfieldDeck(db, {
      name: 'Tagged',
      text,
      commanders: [oracle('Atraxa, Grand Unifier')],
      fixes: {},
      skips: [],
    });
    expect(tagsByCard(id)).toEqual({
      'commander Atraxa, Grand Unifier': ['commander'],
      'main Adeline, Resplendent Cathar': ['token-maker'],
      'main Ashaya, Soul of the Wild': ['combo'],
      "main Avacyn's Pilgrim": ['ramp'],
      'main Beast Whisperer': ['draw'],
      'main Beast Within': [],
    });
  });

  it('keeps the first spelling of a tag repeated in the text', async () => {
    const text = '1 Hearthhull, the Worldseed\n1 Sol Ring #Card-Draw\n1 Farseek #card-draw\n';
    const { deckId: id } = await createMoxfieldDeck(db, {
      name: 'Draw',
      text,
      commanders: [HEARTHHULL],
      fixes: {},
      skips: [],
    });
    expect(tagsByCard(id)['main Farseek']).toEqual(['Card-Draw']);
  });

  async function update(text: string) {
    const res = await api.imports.moxfield['update-apply'].$post({
      json: { deckId, text, commanders: [HEARTHHULL], fixes: {}, skips: [] },
    });
    expect(res.status).toBe(200);
  }

  it('sets the staying slots’ tags from an update whose text has tags', async () => {
    setSlotTags(db, deckId, slotId(SOL_RING, 'main'), ['Card draw', 'Old']);
    setSlotTags(db, deckId, slotId(oracle('Arcane Signet'), 'main'), ['Ramp']);
    await update(
      [
        '1 Hearthhull, the Worldseed (EOC) 1',
        '1 Sol Ring (EOC) 57 #card-draw #ramp',
        '1 Arcane Signet (EOC) 53',
        '1 Chaos Warp (MBC) 72 #removal',
      ].join('\n'),
    );
    expect(tagsByCard()).toEqual({
      'commander Hearthhull, the Worldseed': [],
      // "ramp" takes the spelling Arcane Signet had; Arcane Signet's own tags go.
      'main Sol Ring': ['Card draw', 'Ramp'],
      'main Arcane Signet': [],
      'main Chaos Warp': ['removal'],
    });
  });

  it('keeps the slots’ tags when the update text has no tags (a plain export)', async () => {
    setSlotTags(db, deckId, slotId(SOL_RING, 'main'), ['Ramp']);
    await update('1 Hearthhull, the Worldseed\n1 Sol Ring\n1 Chaos Warp\n');
    expect(tagsByCard()).toEqual({
      'commander Hearthhull, the Worldseed': [],
      'main Sol Ring': ['Ramp'],
      'main Chaos Warp': [],
    });
  });

  it('leaves tags out of the preview answers', async () => {
    const res = await api.imports.moxfield.preview.$post({
      json: { text: '1 Sol Ring #ramp\n' },
    });
    expect(Object.keys(await res.json())).not.toContain('slotTags');
  });
});
