import { z } from 'zod';
import { Finish } from '../../shared/api/common';
import type { cards, printings } from '../db/schema';

// Turns one Scryfall card object (from a bulk file or a single-card lookup) into the app's
// card and printing rows. Only the fields below are read; everything else is ignored.

const ImageUris = z.object({
  small: z.string().nullish(),
  normal: z.string().nullish(),
});

const CardFace = z.object({
  oracle_id: z.string().nullish(),
  name: z.string(),
  flavor_name: z.string().nullish(),
  type_line: z.string().nullish(),
  mana_cost: z.string().nullish(),
  cmc: z.number().nullish(),
  power: z.string().nullish(),
  toughness: z.string().nullish(),
  oracle_text: z.string().nullish(),
  image_uris: ImageUris.nullish(),
});

export const ScryfallCard = z
  .object({
    id: z.string().min(1),
    /** Missing on `reversible_card` layouts, which keep it on `card_faces[0]`. */
    oracle_id: z.string().nullish(),
    name: z.string().min(1),
    /** A printing's alternate name, such as "T'Challa's Protection" for Teferi's Protection. */
    flavor_name: z.string().nullish(),
    lang: z.string(),
    released_at: z.string(),
    set: z.string(),
    set_name: z.string(),
    collector_number: z.string(),
    rarity: z.string(),
    finishes: z.array(z.string()),
    games: z.array(z.string()),
    digital: z.boolean().nullish(),
    layout: z.string(),
    type_line: z.string().nullish(),
    mana_cost: z.string().nullish(),
    cmc: z.number().nullish(),
    power: z.string().nullish(),
    toughness: z.string().nullish(),
    color_identity: z.array(z.string()),
    keywords: z.array(z.string()).nullish(),
    legalities: z.object({ commander: z.enum(['legal', 'not_legal', 'banned', 'restricted']) }),
    oracle_text: z.string().nullish(),
    image_uris: ImageUris.nullish(),
    card_faces: z.array(CardFace).nullish(),
    /** TCGplayer market prices in dollars, such as "1.23", or null when Scryfall has none. */
    prices: z
      .object({
        usd: z.string().nullish(),
        usd_foil: z.string().nullish(),
        usd_etched: z.string().nullish(),
      })
      .nullish(),
  })
  .refine((card) => card.oracle_id ?? card.card_faces?.[0]?.oracle_id, {
    message: 'The card has no oracle_id',
  });
export type ScryfallCard = z.infer<typeof ScryfallCard>;

export type CardRow = typeof cards.$inferInsert;
export type PrintingRow = typeof printings.$inferInsert;

/** Paper printings only: the app tracks physical cards. */
export function isPaperPrinting(card: ScryfallCard) {
  return card.games.includes('paper') && card.digital !== true;
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const FINISHES: readonly string[] = Finish.options;

export function cardToRows(card: ScryfallCard): { card: CardRow; printing: PrintingRow } {
  const faces = card.card_faces ?? [];
  const front = faces[0];
  const oracleId = (card.oracle_id ?? front?.oracle_id) as string;
  const frontTypeLine = front?.type_line ?? card.type_line ?? '';
  const frontPower = front ? front.power : card.power;
  const frontToughness = front ? front.toughness : card.toughness;
  const texts = [card.oracle_text, ...faces.map((face) => face.oracle_text)].filter(
    (text): text is string => Boolean(text),
  );
  const images = card.image_uris ?? front?.image_uris;

  const has = (words: string[]) => words.every((word) => frontTypeLine.includes(word));
  const canBeCommander =
    has(['Legendary', 'Creature']) ||
    (frontTypeLine.includes('Legendary') &&
      (frontTypeLine.includes('Vehicle') || frontTypeLine.includes('Spacecraft')) &&
      frontPower != null &&
      frontToughness != null) ||
    texts.some((text) => /can be your commander/i.test(text));
  const allowsMany = texts.some(
    (text) =>
      text.includes('A deck can have any number of cards named') ||
      /A deck can have up to \S+ cards named/.test(text),
  );

  return {
    card: {
      oracleId,
      name: card.name,
      frontFaceName: front?.name ?? card.name,
      typeLine: card.type_line ?? faces.map((face) => face.type_line ?? '').join(' // '),
      manaCost: card.mana_cost || front?.mana_cost || '',
      manaValue: card.cmc ?? front?.cmc ?? 0,
      colorIdentity: WUBRG.filter((color) => card.color_identity.includes(color)).join(''),
      commanderLegality: card.legalities.commander,
      keywords: card.keywords ?? [],
      canBeCommander,
      isBasicLand: has(['Basic', 'Land']),
      allowsMany,
    },
    printing: {
      scryfallId: card.id,
      oracleId,
      setCode: card.set,
      setName: card.set_name,
      collectorNumber: card.collector_number,
      lang: card.lang,
      finishes: card.finishes.filter((finish): finish is Finish => FINISHES.includes(finish)),
      rarity: card.rarity,
      releasedAt: card.released_at,
      imageSmall: images?.small ?? null,
      imageNormal: images?.normal ?? null,
      flavorName: card.flavor_name ?? front?.flavor_name ?? null,
      priceUsd: toCents(card.prices?.usd),
      priceUsdFoil: toCents(card.prices?.usd_foil),
      priceUsdEtched: toCents(card.prices?.usd_etched),
    },
  };
}

/** A Scryfall price such as "1.23" as whole cents (123); null when missing or not a number. */
export function toCents(price: string | null | undefined) {
  if (price == null || price.trim() === '') return null;
  const dollars = Number(price);
  return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null;
}
