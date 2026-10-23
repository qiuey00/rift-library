import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { Board } from '../../shared/api/common';
import type { PrintingHint, SlotInput, SlotPrinting } from '../../shared/api/decks';
import type { Db } from '../db/database';
import { cards, deckSlots, deckSlotTags, decks, locations, printings } from '../db/schema';
import { AppError } from '../errors';
import { boxCopyCount, findDeck } from '../queries/decks';

// Building decks: one database transaction per action. A deck's slot status, counts and
// state are worked out in src/server/queries/decks.ts, never stored here.

/**
 * A slot to save, with the printing hint and tags a Moxfield export gives. Without `tags`,
 * Update from Moxfield keeps the slot's tags.
 */
export type DeckSlotInput = SlotInput & { hint?: PrintingHint | null; tags?: string[] };

type SlotDbRow = typeof deckSlots.$inferSelect;

const now = () => new Date().toISOString();

/** The name a new deck's box gets, such as "Hearthhull deck box". */
export function defaultBoxName(deckName: string) {
  return `${deckName} deck box`;
}

function deckOrThrow(db: Db, deckId: number) {
  const deck = findDeck(db, deckId);
  if (!deck) {
    throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
  }
  return deck;
}

function slotOrThrow(db: Db, deckId: number, slotId: number) {
  deckOrThrow(db, deckId);
  const slot = db
    .select()
    .from(deckSlots)
    .where(and(eq(deckSlots.id, slotId), eq(deckSlots.deckId, deckId)))
    .get();
  if (!slot) {
    throw new AppError(404, 'slot_not_found', 'This card is no longer in the deck.');
  }
  return slot;
}

/** Refuses cards the card data doesn't know, before a foreign key would. */
function checkCards(db: Db, oracleIds: string[]) {
  const wanted = [...new Set(oracleIds)];
  if (wanted.length === 0) return;
  const known = new Set(
    db
      .select({ oracleId: cards.oracleId })
      .from(cards)
      .where(inArray(cards.oracleId, wanted))
      .all()
      .map((row) => row.oracleId),
  );
  if (wanted.some((oracleId) => !known.has(oracleId))) {
    throw new AppError(
      400,
      'card_not_found',
      'One of these cards isn’t in the card data. Update the card data and try again.',
    );
  }
}

/** Adds up slots for the same card and board, keeping the first hint. */
function mergeInputs(slots: DeckSlotInput[]) {
  const merged = new Map<string, DeckSlotInput>();
  for (const slot of slots) {
    const key = `${slot.board}\n${slot.oracleId}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += slot.quantity;
      existing.hint ??= slot.hint;
      if (slot.tags) existing.tags = [...(existing.tags ?? []), ...slot.tags];
    } else {
      merged.set(key, { ...slot });
    }
  }
  return [...merged.values()];
}

function hintColumns(hint: PrintingHint | null | undefined) {
  return {
    hintSetCode: hint?.setCode ?? null,
    hintCollectorNumber: hint?.collectorNumber ?? null,
    hintFoil: hint?.foil ?? false,
  };
}

/** Lower case, each run of spaces turned into -, so "Card draw" and "card-draw" are one tag. */
export function tagKey(tag: string) {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Trimmed tags, one per tag key, keeping the first spelling. */
function uniqueTags(tags: string[]) {
  const byKey = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tagKey(tag);
    if (tag !== '' && !byKey.has(key)) byKey.set(key, tag);
  }
  return byKey;
}

/**
 * Replaces a slot's tags. A tag the deck already has under the same key keeps the deck's
 * spelling, so "card-draw" from Moxfield joins an existing "Card draw". With `renaming`
 * (Jeff editing the slot's tags), the slot's own old spellings don't count.
 */
function writeTags(db: Db, deckId: number, slotId: number, tags: string[], renaming = false) {
  const wanted = uniqueTags(tags);
  const spelled = new Map<string, string>();
  if (wanted.size > 0) {
    // The slot's own spelling first, then the deck's earliest slot.
    const rows = db
      .select({ slotId: deckSlotTags.slotId, tag: deckSlotTags.tag, tagKey: deckSlotTags.tagKey })
      .from(deckSlotTags)
      .innerJoin(deckSlots, eq(deckSlots.id, deckSlotTags.slotId))
      .where(and(eq(deckSlots.deckId, deckId), inArray(deckSlotTags.tagKey, [...wanted.keys()])))
      .orderBy(desc(sql`${deckSlotTags.slotId} = ${slotId}`), deckSlotTags.slotId)
      .all();
    for (const row of rows) {
      if (renaming && row.slotId === slotId) continue;
      if (!spelled.has(row.tagKey)) spelled.set(row.tagKey, row.tag);
    }
  }
  db.delete(deckSlotTags).where(eq(deckSlotTags.slotId, slotId)).run();
  if (wanted.size === 0) return;
  db.insert(deckSlotTags)
    .values(
      [...wanted].map(([key, tag]) => ({ slotId, tag: spelled.get(key) ?? tag, tagKey: key })),
    )
    .run();
}

/** Gives a slot the tags of another one it doesn't already have. */
function copyTags(db: Db, fromSlotId: number, toSlotId: number) {
  const from = db.select().from(deckSlotTags).where(eq(deckSlotTags.slotId, fromSlotId)).all();
  if (from.length === 0) return;
  db.insert(deckSlotTags)
    .values(from.map((row) => ({ slotId: toSlotId, tag: row.tag, tagKey: row.tagKey })))
    .onConflictDoNothing()
    .run();
}

/** Replaces a slot's tags: PUT /api/decks/:id/slots/:slotId/tags. */
export function setSlotTags(db: Db, deckId: number, slotId: number, tags: string[]) {
  db.transaction((tx) => {
    slotOrThrow(tx, deckId, slotId);
    writeTags(tx, deckId, slotId, tags, true);
    touch(tx, deckId);
  });
}

function findSlot(db: Db, deckId: number, oracleId: string, board: Board) {
  return db
    .select()
    .from(deckSlots)
    .where(
      and(
        eq(deckSlots.deckId, deckId),
        eq(deckSlots.oracleId, oracleId),
        eq(deckSlots.board, board),
      ),
    )
    .get();
}

function touch(db: Db, deckId: number) {
  db.update(decks).set({ updatedAt: now() }).where(eq(decks.id, deckId)).run();
}

/**
 * Creates the deck's own box (a top-level deck box named "<deck name> deck box"), the deck
 * and its slots. Returns the new deck's id. The Moxfield import calls it too.
 */
export function createDeck(db: Db, input: { name: string; slots: DeckSlotInput[] }): number {
  return db.transaction((tx) => {
    checkCards(
      tx,
      input.slots.map((slot) => slot.oracleId),
    );
    const top = tx
      .select({ position: max(locations.position) })
      .from(locations)
      .where(isNull(locations.parentId))
      .get();
    const box = tx
      .insert(locations)
      .values({
        name: defaultBoxName(input.name),
        type: 'deck_box',
        position: (top?.position ?? -1) + 1,
      })
      .returning({ id: locations.id })
      .get();
    const deck = tx
      .insert(decks)
      .values({ name: input.name, deckBoxId: box.id })
      .returning({ id: decks.id })
      .get();
    const slots = mergeInputs(input.slots);
    if (slots.length > 0) {
      const ids = tx
        .insert(deckSlots)
        .values(
          slots.map((slot) => ({
            deckId: deck.id,
            oracleId: slot.oracleId,
            board: slot.board,
            quantity: slot.quantity,
            ...hintColumns(slot.hint),
          })),
        )
        .returning({ id: deckSlots.id })
        .all();
      slots.forEach((slot, i) => {
        if (slot.tags?.length) writeTags(tx, deck.id, ids[i].id, slot.tags);
      });
    }
    return deck.id;
  });
}

/** Renames the deck, and its box too while the box still has its default name. */
export function renameDeck(db: Db, deckId: number, name: string) {
  db.transaction((tx) => {
    const deck = deckOrThrow(tx, deckId);
    const box = tx.select().from(locations).where(eq(locations.id, deck.deckBoxId)).get();
    if (box && box.name === defaultBoxName(deck.name)) {
      tx.update(locations)
        .set({ name: defaultBoxName(name) })
        .where(eq(locations.id, box.id))
        .run();
    }
    tx.update(decks).set({ name, updatedAt: now() }).where(eq(decks.id, deckId)).run();
  });
}

/**
 * Makes these cards (one, or two partners) the deck's commanders. A new commander already on
 * the main board moves up from it, keeping its picked printing; former commanders leave the deck.
 */
export function setCommanders(db: Db, deckId: number, oracleIds: string[]) {
  db.transaction((tx) => {
    deckOrThrow(tx, deckId);
    checkCards(tx, oracleIds);
    const wanted = new Set(oracleIds);
    const current = tx
      .select()
      .from(deckSlots)
      .where(and(eq(deckSlots.deckId, deckId), eq(deckSlots.board, 'commander')))
      .all();
    for (const slot of current) {
      if (wanted.has(slot.oracleId)) {
        wanted.delete(slot.oracleId);
        if (slot.quantity !== 1) {
          tx.update(deckSlots).set({ quantity: 1 }).where(eq(deckSlots.id, slot.id)).run();
        }
      } else {
        tx.delete(deckSlots).where(eq(deckSlots.id, slot.id)).run();
      }
    }
    for (const oracleId of wanted) {
      const main = findSlot(tx, deckId, oracleId, 'main');
      if (main && main.quantity === 1) {
        tx.update(deckSlots).set({ board: 'commander' }).where(eq(deckSlots.id, main.id)).run();
        continue;
      }
      if (main) {
        tx.update(deckSlots)
          .set({ quantity: main.quantity - 1 })
          .where(eq(deckSlots.id, main.id))
          .run();
      }
      const commander = tx
        .insert(deckSlots)
        .values({
          deckId,
          oracleId,
          board: 'commander',
          quantity: 1,
          pickedScryfallId: main?.pickedScryfallId ?? null,
        })
        .returning({ id: deckSlots.id })
        .get();
      if (main) copyTags(tx, main.id, commander.id);
    }
    touch(tx, deckId);
  });
}

/** Adds a card to a board, adding to the slot already there for that card and board. Returns the slot id. */
export function addSlot(db: Db, deckId: number, input: DeckSlotInput): number {
  return db.transaction((tx) => {
    deckOrThrow(tx, deckId);
    checkCards(tx, [input.oracleId]);
    const existing = findSlot(tx, deckId, input.oracleId, input.board);
    touch(tx, deckId);
    if (existing) {
      tx.update(deckSlots)
        .set({ quantity: existing.quantity + input.quantity })
        .where(eq(deckSlots.id, existing.id))
        .run();
      return existing.id;
    }
    return tx
      .insert(deckSlots)
      .values({
        deckId,
        oracleId: input.oracleId,
        board: input.board,
        quantity: input.quantity,
        ...hintColumns(input.hint),
      })
      .returning({ id: deckSlots.id })
      .get().id;
  });
}

/**
 * Adds one copy of a card dropped onto the deck view to a board. Refuses a card already on
 * any board of the deck, unless a deck can hold any number of it (basic lands, Relentless Rats),
 * which gets one more. Returns the slot id.
 */
export function addDroppedCard(db: Db, deckId: number, oracleId: string, board: Board): number {
  return db.transaction((tx) => {
    deckOrThrow(tx, deckId);
    checkCards(tx, [oracleId]);
    const card = tx
      .select({ name: cards.name, allowsMany: cards.allowsMany, basic: cards.isBasicLand })
      .from(cards)
      .where(eq(cards.oracleId, oracleId))
      .get();
    const inDeck = tx
      .select({ id: deckSlots.id })
      .from(deckSlots)
      .where(and(eq(deckSlots.deckId, deckId), eq(deckSlots.oracleId, oracleId)))
      .get();
    if (inDeck && !card?.allowsMany && !card?.basic) {
      throw new AppError(409, 'card_in_deck', `${card?.name} is already in this deck.`);
    }
    return addSlot(tx, deckId, { oracleId, board, quantity: 1 });
  });
}

export function setSlotQuantity(db: Db, deckId: number, slotId: number, quantity: number) {
  db.transaction((tx) => {
    slotOrThrow(tx, deckId, slotId);
    tx.update(deckSlots).set({ quantity }).where(eq(deckSlots.id, slotId)).run();
    touch(tx, deckId);
  });
}

/**
 * Moves a slot to another board. When that board already has the card, the two slots become
 * one there. Returns the id of the slot the card ends up in.
 */
export function moveSlotBoard(db: Db, deckId: number, slotId: number, board: Board): number {
  return db.transaction((tx) => {
    const slot = slotOrThrow(tx, deckId, slotId);
    if (slot.board === board) return slot.id;
    const target = findSlot(tx, deckId, slot.oracleId, board);
    touch(tx, deckId);
    if (!target) {
      tx.update(deckSlots).set({ board }).where(eq(deckSlots.id, slot.id)).run();
      return slot.id;
    }
    tx.update(deckSlots)
      .set({
        quantity: target.quantity + slot.quantity,
        pickedScryfallId: target.pickedScryfallId ?? slot.pickedScryfallId,
        ...(target.hintSetCode ? {} : hintColumns(hintOf(slot))),
      })
      .where(eq(deckSlots.id, target.id))
      .run();
    copyTags(tx, slot.id, target.id);
    tx.delete(deckSlots).where(eq(deckSlots.id, slot.id)).run();
    return target.id;
  });
}

/**
 * Makes this printing the slot's printing: it becomes the printing hint the pick list looks
 * for, and the picked printing is cleared unless it is the same printing. Copies already in
 * the deck box stay and still fill the slot, whatever their printing.
 */
export function setSlotPrinting(db: Db, deckId: number, slotId: number, printing: SlotPrinting) {
  db.transaction((tx) => {
    const slot = slotOrThrow(tx, deckId, slotId);
    const found = tx
      .select({
        oracleId: printings.oracleId,
        setCode: printings.setCode,
        collectorNumber: printings.collectorNumber,
      })
      .from(printings)
      .where(eq(printings.scryfallId, printing.scryfallId))
      .get();
    if (!found) {
      throw new AppError(404, 'printing_not_found', 'That printing isn’t in the card data.');
    }
    if (found.oracleId !== slot.oracleId) {
      throw new AppError(400, 'wrong_card', 'That printing is of a different card.');
    }
    tx.update(deckSlots)
      .set({
        ...hintColumns({
          setCode: found.setCode,
          collectorNumber: found.collectorNumber,
          foil: printing.foil,
        }),
        pickedScryfallId:
          slot.pickedScryfallId === printing.scryfallId ? slot.pickedScryfallId : null,
      })
      .where(eq(deckSlots.id, slot.id))
      .run();
    touch(tx, deckId);
  });
}

function hintOf(slot: SlotDbRow): PrintingHint | null {
  return slot.hintSetCode && slot.hintCollectorNumber
    ? { setCode: slot.hintSetCode, collectorNumber: slot.hintCollectorNumber, foil: slot.hintFoil }
    : null;
}

export function removeSlot(db: Db, deckId: number, slotId: number) {
  db.transaction((tx) => {
    slotOrThrow(tx, deckId, slotId);
    tx.delete(deckSlots).where(eq(deckSlots.id, slotId)).run();
    touch(tx, deckId);
  });
}

/**
 * Replaces every slot of the deck with these, for Update from Moxfield. A card that stays
 * keeps its picked printing, and a slot that stays on its board keeps its id. A slot given
 * `tags` gets exactly those; one without keeps its tags.
 */
export function replaceSlots(db: Db, deckId: number, slots: DeckSlotInput[]) {
  db.transaction((tx) => {
    deckOrThrow(tx, deckId);
    checkCards(
      tx,
      slots.map((slot) => slot.oracleId),
    );
    const old = tx.select().from(deckSlots).where(eq(deckSlots.deckId, deckId)).all();
    const pickedByCard = new Map<string, string>();
    for (const slot of old) {
      if (slot.pickedScryfallId && !pickedByCard.has(slot.oracleId)) {
        pickedByCard.set(slot.oracleId, slot.pickedScryfallId);
      }
    }
    const oldByKey = new Map(old.map((slot) => [`${slot.board}\n${slot.oracleId}`, slot]));
    const kept = new Set<number>();
    const tagged: [number, string[]][] = [];

    for (const slot of mergeInputs(slots)) {
      const existing = oldByKey.get(`${slot.board}\n${slot.oracleId}`);
      if (existing) {
        kept.add(existing.id);
        tx.update(deckSlots)
          .set({ quantity: slot.quantity, ...hintColumns(slot.hint) })
          .where(eq(deckSlots.id, existing.id))
          .run();
        if (slot.tags) tagged.push([existing.id, slot.tags]);
      } else {
        const added = tx
          .insert(deckSlots)
          .values({
            deckId,
            oracleId: slot.oracleId,
            board: slot.board,
            quantity: slot.quantity,
            pickedScryfallId: pickedByCard.get(slot.oracleId) ?? null,
            ...hintColumns(slot.hint),
          })
          .returning({ id: deckSlots.id })
          .get();
        if (slot.tags) tagged.push([added.id, slot.tags]);
      }
    }
    const gone = old.filter((slot) => !kept.has(slot.id)).map((slot) => slot.id);
    if (gone.length > 0) tx.delete(deckSlots).where(inArray(deckSlots.id, gone)).run();
    // After the slots that left took their tags with them, so only staying spellings count.
    for (const [slotId, tags] of tagged) writeTags(tx, deckId, slotId, tags);
    touch(tx, deckId);
  });
}

/** Deletes the deck and its box, refused while the box holds copies. */
export function deleteDeck(db: Db, deckId: number) {
  db.transaction((tx) => {
    const deck = deckOrThrow(tx, deckId);
    const held = boxCopyCount(tx, deck.deckBoxId);
    if (held > 0) {
      throw new AppError(
        409,
        'deck_box_not_empty',
        `The ${deck.name} deck box still holds ${held} ${held === 1 ? 'card' : 'cards'}. Put them away first, then delete the deck.`,
      );
    }
    const deletedAt = now();
    tx.update(decks).set({ deletedAt }).where(eq(decks.id, deckId)).run();
    tx.update(locations).set({ deletedAt }).where(eq(locations.id, deck.deckBoxId)).run();
  });
}

/** Sets when the deck was last opened, for the Decks home's order. */
export function markOpened(db: Db, deckId: number) {
  db.transaction((tx) => {
    deckOrThrow(tx, deckId);
    tx.update(decks).set({ openedAt: now() }).where(eq(decks.id, deckId)).run();
  });
}
