import { z } from 'zod';
import { type CardType, Domain } from '../../shared/api/common';
import type { cards, printings } from '../db/schema';

// Riftcodex's records, checked with Zod, and how they become the app's rows: one printing per
// record, and one card per name key. https://riftcodex.com/docs/riftcodex/schemas/card

/** One printing, as `GET /cards` lists it. Fields the app doesn't use are left unchecked. */
export const RiftcodexCard = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Such as "ogn-202a-298" or "ven-r03". */
  riftbound_id: z.string().min(1),
  /** The docs list it, but the cards API doesn't send it yet: it is worked out from riftbound_id. */
  public_code: z.string().min(1).nullish(),
  tcgplayer_id: z.union([z.string(), z.number()]).nullish(),
  collector_number: z.number().int().nullish(),
  attributes: z
    .object({
      energy: z.number().int().nullish(),
      might: z.number().int().nullish(),
      power: z.number().int().nullish(),
    })
    .nullish(),
  classification: z.object({
    type: z.string().min(1),
    supertype: z.string().nullish(),
    rarity: z.string().nullish(),
    domain: z.array(z.string()).nullish(),
  }),
  text: z.object({ plain: z.string().nullish() }).nullish(),
  set: z.object({ set_id: z.string().min(1), label: z.string().nullish() }),
  media: z.object({ image_url: z.string().nullish(), artist: z.string().nullish() }).nullish(),
  tags: z.array(z.string()).nullish(),
  metadata: z
    .object({
      alternate_art: z.boolean().nullish(),
      overnumbered: z.boolean().nullish(),
      signature: z.boolean().nullish(),
    })
    .nullish(),
});
export type RiftcodexCard = z.infer<typeof RiftcodexCard>;

/** One set, as `GET /sets` lists it. */
export const RiftcodexSet = z.object({
  set_id: z.string().min(1),
  name: z.string().min(1),
});
export type RiftcodexSet = z.infer<typeof RiftcodexSet>;

/** The page Riftcodex answers for `GET /cards`, `GET /cards/name` and `GET /sets`. */
export const RiftcodexPage = z.object({
  items: z.array(z.unknown()),
  page: z.number().int(),
  pages: z.number().int(),
  total: z.number().int().optional(),
});

/**
 * The name key that groups printings into cards and matches deck list lines: lower case, any
 * variant in brackets at the end dropped (such as "(Alternate Art)", "(Signature)" or
 * "(Overnumbered)"), and punctuation between words treated as a space. Riftcodex writes the
 * same card as "Jinx - Demolitionist" and "Jinx, Demolitionist (Overnumbered)", which both
 * become "jinx demolitionist".
 */
export function nameKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

/** The card's name without the variant in brackets at the end. */
export function cardName(name: string) {
  return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

const TYPES: Record<string, CardType> = {
  legend: 'legend',
  unit: 'unit',
  spell: 'spell',
  gear: 'gear',
  battlefield: 'battlefield',
  rune: 'rune',
  token: 'token',
};

type CardRow = Omit<typeof cards.$inferInsert, 'id'>;
type PrintingRow = Omit<typeof printings.$inferInsert, 'cardId'>;

/** A card and the printings grouped into it, ready to write. */
export interface CardGroup {
  card: CardRow;
  printings: PrintingRow[];
}

/** A name whose printings say different things, reported after a sync. */
export interface Disagreement {
  name: string;
  /** Such as "type" or "domains". */
  field: 'type' | 'domains';
  values: string[];
}

/** The card's own fields from one printing. */
export function cardRow(record: RiftcodexCard): CardRow {
  const supertype = record.classification.supertype?.trim().toLowerCase() || null;
  const isToken = supertype === 'token' || record.classification.type.toLowerCase() === 'token';
  const type: CardType = isToken
    ? 'token'
    : (TYPES[record.classification.type.trim().toLowerCase()] ?? 'other');
  // The champion a card belongs to is its first tag; other tags are regions and tribes.
  const belongsToChampion =
    type === 'legend' || supertype === 'champion' || supertype === 'signature';
  return {
    name: cardName(record.name),
    nameKey: nameKey(record.name),
    type,
    supertype,
    domains: domains(record),
    energy: record.attributes?.energy ?? null,
    might: record.attributes?.might ?? null,
    power: record.attributes?.power ?? null,
    championTag: belongsToChampion ? (record.tags?.[0] ?? null) : null,
    rulesText: record.text?.plain ?? '',
    // Tokens are made during a game, never put in a deck.
    deckable: type !== 'token',
  };
}

/** The printing's row. `setNames` comes from the sets list, by set code. */
export function printingRow(record: RiftcodexCard, setNames: Map<string, string>): PrintingRow {
  const setCode = record.set.set_id.toUpperCase();
  const { publicCode, collectorNumber } = codes(record);
  const tcgplayerId = Number(record.tcgplayer_id);
  return {
    riftcodexId: record.id,
    riftboundId: record.riftbound_id,
    publicCode,
    setCode,
    setName: setNames.get(setCode) ?? record.set.label ?? setCode,
    collectorNumber,
    rarity: record.classification.rarity?.trim().toLowerCase() || 'unknown',
    imageUrl: record.media?.image_url ?? null,
    artist: record.media?.artist ?? null,
    alternateArt: record.metadata?.alternate_art ?? false,
    overnumbered: record.metadata?.overnumbered ?? false,
    signature: record.metadata?.signature ?? false,
    tcgplayerId:
      record.tcgplayer_id != null && Number.isSafeInteger(tcgplayerId) && tcgplayerId > 0
        ? tcgplayerId
        : null,
  };
}

/**
 * The public code, such as "OGN-202a/298", and the collector number, such as "202a". The
 * riftbound_id says both: "ogn-202a-298" is set, number and set size, and "ven-r03" has no
 * size.
 */
function codes(record: RiftcodexCard) {
  const [, number, size] = record.riftbound_id.split('-');
  const collectorNumber = number || String(record.collector_number ?? '');
  const setCode = record.set.set_id.toUpperCase();
  const publicCode = record.public_code ?? `${setCode}-${collectorNumber}${size ? `/${size}` : ''}`;
  return { publicCode, collectorNumber };
}

/** The app's domains; "Colorless" and anything else Riftcodex adds are left out. */
function domains(record: RiftcodexCard): Domain[] {
  const found = (record.classification.domain ?? []).flatMap((value) => {
    const parsed = Domain.safeParse(value.trim().toLowerCase());
    return parsed.success ? [parsed.data] : [];
  });
  return [...new Set(found)];
}

/** Printings with no variant flag first, then signature and overnumbered ones, alternate art last. */
function rank(record: RiftcodexCard) {
  const flags = record.metadata;
  if (flags?.alternate_art) return 2;
  if (flags?.signature || flags?.overnumbered) return 1;
  return 0;
}

/**
 * Groups printings with the same name key into one card. The card's fields come from its first
 * printing that isn't alternate art (one with no variant at all when there is one), and any
 * name whose printings disagree on type or domains is reported.
 */
export function groupCards(records: RiftcodexCard[], setNames: Map<string, string>) {
  const byKey = new Map<string, RiftcodexCard[]>();
  for (const record of records) {
    const key = nameKey(record.name);
    const group = byKey.get(key);
    if (group) group.push(record);
    else byKey.set(key, [record]);
  }

  const groups: CardGroup[] = [];
  const disagreements: Disagreement[] = [];
  for (const group of byKey.values()) {
    // A stable sort, so equal ranks keep Riftcodex's order.
    const ordered = [...group].sort((a, b) => rank(a) - rank(b));
    const cardRows = ordered.map(cardRow);
    const card = cardRows[0];
    if (!card) continue;
    for (const field of ['type', 'domains'] as const) {
      const values = [
        ...new Set(
          cardRows.map((row) =>
            field === 'domains' ? [...(row.domains ?? [])].sort().join(', ') || 'none' : row.type,
          ),
        ),
      ];
      if (values.length > 1) disagreements.push({ name: card.name, field, values });
    }
    groups.push({ card, printings: ordered.map((record) => printingRow(record, setNames)) });
  }
  return { groups, disagreements };
}
