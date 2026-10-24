import { sql } from 'drizzle-orm';
import type { PutAwayGroup, PutAwayLine } from '../../shared/api/put-away';
import type { SwapResponse } from '../../shared/api/swap';
import type { Db } from '../db/database';
import { pickList } from './pick-list';
import { putAwayList } from './put-away';

// The swap list: after a built deck's list changes, take out the copies the new list no
// longer needs and pull in what it lacks, instead of taking the whole deck apart. It is
// worked out every time it opens and never stored. Take-outs reuse the put-away list's lines
// and destinations; pull-ins are the pick list, which already lists only what is left.

type CardNeeds = { needed: number; picked: Set<string> };

/** Per card: copies the slots off the maybe board need, and the slots' picked printings. */
function cardNeeds(db: Db, deckId: number): Map<number, CardNeeds> {
  const slots = db.all<{ cardId: number; quantity: number; pickedPrintingId: string | null }>(sql`
    SELECT card_id AS cardId, quantity, picked_printing_id AS pickedPrintingId
    FROM deck_slots
    WHERE deck_id = ${deckId} AND board <> 'maybe'`);
  const byCard = new Map<number, CardNeeds>();
  for (const slot of slots) {
    const card = byCard.get(slot.cardId) ?? { needed: 0, picked: new Set() };
    card.needed += slot.quantity;
    if (slot.pickedPrintingId) card.picked.add(slot.pickedPrintingId);
    byCard.set(slot.cardId, card);
  }
  return byCard;
}

/**
 * The copies in the deck box beyond what each card's slots off the maybe board need (maybe
 * board slots need none, nor does a card no slot lists). Proxies go first, then stacks whose
 * printing isn't a slot's picked printing, then the rest, so the copies the list wants stay.
 * A stack can be taken out in part.
 */
function takeOutLines(lines: PutAwayLine[], needs: Map<number, CardNeeds>): Set<PutAwayLine> {
  const byCard = new Map<number, PutAwayLine[]>();
  for (const line of lines) {
    const list = byCard.get(line.card.id) ?? [];
    list.push(line);
    byCard.set(line.card.id, list);
  }

  const taken = new Set<PutAwayLine>();
  for (const [cardId, stacks] of byCard) {
    const card = needs.get(cardId);
    const inBox = stacks.reduce((n, line) => n + line.quantity, 0);
    let extra = inBox - (card?.needed ?? 0);
    if (extra <= 0) continue;
    const rank = (line: PutAwayLine) =>
      line.isProxy ? 0 : card?.picked.has(line.printing.printingId) ? 2 : 1;
    const order = [...stacks].sort((a, b) => rank(a) - rank(b) || a.stackId - b.stackId);
    for (const line of order) {
      if (extra <= 0) break;
      const quantity = Math.min(extra, line.quantity);
      line.quantity = quantity;
      taken.add(line);
      extra -= quantity;
    }
  }
  return taken;
}

/** Works out a live deck's swap list; undefined when there is no such deck. */
export function swapList(db: Db, deckId: number): SwapResponse | undefined {
  const putAway = putAwayList(db, deckId);
  const pullIn = pickList(db, deckId);
  if (!putAway || !pullIn) return undefined;

  const taken = takeOutLines(
    putAway.groups.flatMap((group) => group.lines),
    cardNeeds(db, deckId),
  );
  const groups: PutAwayGroup[] = putAway.groups
    .map((group) => ({ ...group, lines: group.lines.filter((line) => taken.has(line)) }))
    .filter((group) => group.lines.length > 0);
  const takeOutCount = [...taken].reduce((n, line) => n + line.quantity, 0);

  return {
    deck: putAway.deck,
    takeOut: { groups, count: takeOutCount },
    pullIn,
    counts: { takeOut: takeOutCount, pullIn: pullIn.totals.cards },
  };
}
