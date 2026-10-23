import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenDb } from '../../src/server/db/database';
import {
  cardDataStatus,
  cards,
  cardsStaging,
  copyStacks,
  locations,
  printings,
  printingsStaging,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { cardToRows, ScryfallCard } from '../../src/server/scryfall/card-rows';
import { loadBulkFile } from '../../src/server/scryfall/load';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'scryfall', 'default-cards.json');
const fixtureCards = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>[];
const BULK_UPDATED_AT = '2026-10-18T09:05:12.000Z';

/** The worked-out card row for the fixture card with this Scryfall id. */
function rowsFor(scryfallId: string) {
  const raw = fixtureCards.find((card) => card.id === scryfallId);
  return cardToRows(ScryfallCard.parse(raw));
}

describe('cardToRows', () => {
  it('works out a legendary creature', () => {
    const { card } = rowsFor('f96223d0-04c4-40c2-87a9-0c6bc74adddb');
    expect(card).toMatchObject({
      name: 'Braids, Arisen Nightmare',
      frontFaceName: 'Braids, Arisen Nightmare',
      manaValue: 3,
      colorIdentity: 'B',
      commanderLegality: 'legal',
      canBeCommander: true,
      isBasicLand: false,
      allowsMany: false,
    });
  });

  it('lets Hearthhull, a legendary Spacecraft with power and toughness, be a commander', () => {
    const { card, printing } = rowsFor('6b913e79-a9f6-44d4-bb37-c4f6f66b8151');
    expect(card).toMatchObject({
      oracleId: '8d6f82d9-5c5b-4c41-8857-c0936f2d894c',
      typeLine: 'Legendary Artifact — Spacecraft',
      manaCost: '{1}{B}{R}{G}',
      manaValue: 4,
      colorIdentity: 'BRG',
      canBeCommander: true,
    });
    expect(printing).toMatchObject({
      setCode: 'eoc',
      collectorNumber: '1',
      finishes: ['nonfoil', 'foil'],
    });
  });

  it('keeps a printing’s flavor name, and none on a printing without one', () => {
    const marvel = rowsFor('c54d5ea1-0cc9-4e84-b712-642d55915dae');
    expect(marvel.card.name).toBe("Teferi's Protection");
    expect(marvel.printing).toMatchObject({ setCode: 'mar', flavorName: "T'Challa's Protection" });
    expect(rowsFor('77f130c7-0138-4a1a-9f67-62d2c302dc48').printing.flavorName).toBeNull();
  });

  it('reads each finish’s US price as whole cents, and none when Scryfall has none', () => {
    const byName = (name: string) =>
      cardToRows(ScryfallCard.parse(fixtureCards.find((card) => card.name === name))).printing;
    expect(byName('Hearthhull, the Worldseed')).toMatchObject({
      priceUsd: 312,
      priceUsdFoil: 485,
      priceUsdEtched: null,
    });
    expect(byName('Thrasios, Triton Hero')).toMatchObject({
      priceUsd: null,
      priceUsdFoil: 742,
      priceUsdEtched: null,
    });
    expect(byName('Seven Dwarves')).toMatchObject({
      priceUsd: null,
      priceUsdFoil: null,
      priceUsdEtched: null,
    });
    const etched = { usd: '0.29', usd_foil: '1.10', usd_etched: '24999.99' };
    const raw = { ...fixtureCards[0], prices: etched };
    expect(cardToRows(ScryfallCard.parse(raw)).printing).toMatchObject({
      priceUsd: 29,
      priceUsdFoil: 110,
      priceUsdEtched: 2499999,
    });
    const noPrices = { ...fixtureCards[0], prices: undefined };
    expect(cardToRows(ScryfallCard.parse(noPrices)).printing.priceUsd).toBeNull();
  });

  it('does not let a legendary Spacecraft without printed power and toughness be a commander', () => {
    const raw = { ...fixtureCards.find((card) => card.name === 'Hearthhull, the Worldseed') };
    delete raw.power;
    delete raw.toughness;
    expect(cardToRows(ScryfallCard.parse(raw)).card.canBeCommander).toBe(false);
  });

  it('lets a planeswalker that says so be a commander', () => {
    const { card } = rowsFor('80eec0bd-9eb4-4360-b97b-9c7985a63343');
    expect(card).toMatchObject({
      name: 'Teferi, Temporal Archmage',
      colorIdentity: 'U',
      canBeCommander: true,
      isBasicLand: false,
    });
  });

  it('works out Partner commanders', () => {
    const thrasios = rowsFor('21e27b91-c7f1-4709-aa0d-8b5d81b22a0a').card;
    const tymna = rowsFor('bc7cbe9b-324e-42b8-94e2-36e91cb32163').card;
    expect(thrasios).toMatchObject({ colorIdentity: 'UG', canBeCommander: true, manaValue: 2 });
    expect(thrasios.keywords).toContain('Partner');
    expect(tymna).toMatchObject({ colorIdentity: 'WB', canBeCommander: true });
    expect(tymna.keywords).toContain('Partner');
  });

  it('works out a basic land', () => {
    const { card, printing } = rowsFor('fb62605c-a58e-4e53-8336-b2bee316b5a6');
    expect(card).toMatchObject({
      name: 'Forest',
      typeLine: 'Basic Land — Forest',
      manaCost: '',
      manaValue: 0,
      colorIdentity: 'G',
      isBasicLand: true,
      canBeCommander: false,
      allowsMany: false,
    });
    expect(printing.imageSmall).toMatch(/^https:\/\/cards\.scryfall\.io\/small\//);
  });

  it('lets a deck hold any number of Relentless Rats, and up to seven Seven Dwarves', () => {
    expect(rowsFor('75f47b6e-9557-4853-b8d6-7602a91c59a7').card).toMatchObject({
      allowsMany: true,
      canBeCommander: false,
      colorIdentity: 'B',
    });
    expect(rowsFor('464adbae-70ea-48e1-b8ae-b404766f7a5a').card.allowsMany).toBe(true);
  });

  it('marks a card banned in Commander', () => {
    expect(rowsFor('6d5537da-112e-4679-a113-b5d7ce32a66b').card).toMatchObject({
      name: 'Primeval Titan',
      commanderLegality: 'banned',
    });
  });

  it('works out a double-faced card from its front face', () => {
    const { card, printing } = rowsFor('6904ea20-e504-47da-95a0-08739fdde260');
    expect(card).toMatchObject({
      name: 'Delver of Secrets // Insectile Aberration',
      frontFaceName: 'Delver of Secrets',
      typeLine: 'Creature — Human Wizard // Creature — Human Insect',
      manaCost: '{U}',
      manaValue: 1,
      colorIdentity: 'U',
      canBeCommander: false,
      isBasicLand: false,
    });
    expect(printing.imageNormal).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\/front\//);
  });

  it('works out "Harmonized Trio // Brainstorm"', () => {
    const { card } = rowsFor('617208ff-dd9b-44fd-a740-d3188081e5cc');
    expect(card).toMatchObject({
      name: 'Harmonized Trio // Brainstorm',
      frontFaceName: 'Harmonized Trio',
      colorIdentity: 'U',
      isBasicLand: false,
    });
  });

  it('reads a reversible card from its first face', () => {
    const { card, printing } = rowsFor('6adadbc9-4a08-4c1d-adf7-edee73799d9e');
    expect(card).toMatchObject({
      oracleId: '12a6cad9-eb42-43bd-9e68-aaf862cd83db',
      frontFaceName: 'Adrix and Nev, Twincasters',
      typeLine: 'Legendary Creature — Merfolk Wizard // Legendary Creature — Merfolk Wizard',
      manaCost: '{2}{G}{U}',
      manaValue: 4,
      canBeCommander: true,
    });
    expect(printing.oracleId).toBe(card.oracleId);
    expect(printing.imageSmall).not.toBeNull();
  });
});

describe('loadBulkFile', () => {
  let db: OpenDb;
  let dir: string;
  beforeEach(async () => {
    db = createTestDb();
    dir = await mkdtemp(path.join(tmpdir(), 'log-scryfall-'));
  });
  afterEach(async () => {
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('fills cards and printings from the fixture, leaving out online-only and broken cards', async () => {
    const progress: number[] = [];
    const result = await loadBulkFile(db, FIXTURE, {
      bulkUpdatedAt: BULK_UPDATED_AT,
      onProgress: (read, size) => progress.push(read / size),
    });
    expect(result).toEqual({
      printingsRead: 35,
      notPaper: 1,
      skipped: 1,
      cardCount: 30,
      printingCount: 35,
    });
    expect(await db.$count(cards)).toBe(30);
    expect(await db.$count(printings)).toBe(35);
    expect(db.select().from(printings).where(eq(printings.setCode, 'vma')).all()).toEqual([]);
    // The Japanese Arcane Signet is a second printing of the same card.
    const signet = rowsFor('3d994115-378d-4685-a5dc-e448831da434').card.oracleId;
    expect(
      db
        .select({ lang: printings.lang })
        .from(printings)
        .where(eq(printings.oracleId, signet))
        .all()
        .map((row) => row.lang)
        .sort(),
    ).toEqual(['en', 'ja']);
    expect(db.select().from(cardDataStatus).get()).toMatchObject({
      bulkUpdatedAt: BULK_UPDATED_AT,
      cardCount: 30,
      printingCount: 35,
    });
    // Prices come through staging with the other columns.
    const hearthhull = rowsFor('6b913e79-a9f6-44d4-bb37-c4f6f66b8151').printing.scryfallId;
    expect(
      db
        .select({
          usd: printings.priceUsd,
          foil: printings.priceUsdFoil,
          etched: printings.priceUsdEtched,
        })
        .from(printings)
        .where(eq(printings.scryfallId, hearthhull))
        .get(),
    ).toEqual({ usd: 312, foil: 485, etched: null });
    expect(
      await db.$count(printings, eq(printings.setCode, 'eld')),
      'Seven Dwarves is the one printing with no prices',
    ).toBe(1);
    expect(
      db
        .select({ usd: printings.priceUsd, foil: printings.priceUsdFoil })
        .from(printings)
        .where(eq(printings.setCode, 'eld'))
        .get(),
    ).toEqual({ usd: null, foil: null });
    expect(await db.$count(cardsStaging)).toBe(0);
    expect(await db.$count(printingsStaging)).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it('updates rows on a second load without duplicates and deletes nothing', async () => {
    await loadBulkFile(db, FIXTURE, { bulkUpdatedAt: BULK_UPDATED_AT });
    const inbox = db.select().from(locations).get();
    db.insert(copyStacks)
      .values({
        scryfallId: '3d994115-378d-4685-a5dc-e448831da434',
        quantity: 1,
        finish: 'nonfoil',
        condition: 'near_mint',
        language: 'en',
        locationId: inbox?.id ?? 0,
      })
      .run();

    // The next file renames Arcane Signet's set and no longer has the Forests.
    const changed = fixtureCards
      .filter((card) => card.name !== 'Forest')
      .map((card) =>
        card.id === '3d994115-378d-4685-a5dc-e448831da434'
          ? { ...card, set_name: 'Renamed Set' }
          : card,
      );
    const file = path.join(dir, 'changed.json');
    await writeFile(file, JSON.stringify(changed));
    const result = await loadBulkFile(db, file, { bulkUpdatedAt: '2026-10-25T09:00:00.000Z' });

    expect(result).toMatchObject({ printingsRead: 33, cardCount: 30, printingCount: 35 });
    expect(await db.$count(printings)).toBe(35);
    expect(
      db
        .select({ setName: printings.setName })
        .from(printings)
        .where(eq(printings.scryfallId, '3d994115-378d-4685-a5dc-e448831da434'))
        .get(),
    ).toEqual({ setName: 'Renamed Set' });
    expect(await db.$count(printings, eq(printings.setCode, 'eoe'))).toBe(7);
    expect(await db.$count(copyStacks)).toBe(1);
    expect(db.select().from(cardDataStatus).all()).toEqual([
      expect.objectContaining({
        bulkUpdatedAt: '2026-10-25T09:00:00.000Z',
        cardCount: 30,
        printingCount: 35,
      }),
    ]);
  });

  it('swaps in and updates the status in one transaction', async () => {
    // A trigger that fails the status update makes the whole swap roll back.
    db.$client.exec(
      `CREATE TRIGGER fail_status BEFORE INSERT ON card_data_status BEGIN SELECT RAISE(ABORT, 'no'); END`,
    );
    await expect(loadBulkFile(db, FIXTURE, { bulkUpdatedAt: BULK_UPDATED_AT })).rejects.toThrow(
      'no',
    );
    expect(await db.$count(cards)).toBe(0);
    expect(await db.$count(printings)).toBe(0);
    expect(await db.$count(cardsStaging)).toBe(30);
  });

  it('fails on a file that is not a JSON array of cards, and leaves the data as it was', async () => {
    await loadBulkFile(db, FIXTURE, { bulkUpdatedAt: BULK_UPDATED_AT });
    const file = path.join(dir, 'cut-off.json');
    await writeFile(file, readFileSync(FIXTURE, 'utf8').slice(0, 20_000));
    await expect(
      loadBulkFile(db, file, { bulkUpdatedAt: '2026-10-25T09:00:00.000Z' }),
    ).rejects.toThrow();
    expect(await db.$count(printings)).toBe(35);
    expect(await db.$count(printingsStaging)).toBe(0);
    expect(db.select().from(cardDataStatus).get()?.bulkUpdatedAt).toBe(BULK_UPDATED_AT);
  });

  it('reads JSON Lines and gzipped files, as Scryfall serves them, the same way', async () => {
    const lines = `${fixtureCards.map((card) => JSON.stringify(card)).join('\n')}\n{not json\n`;
    const files = {
      'cards.jsonl': lines,
      'cards.jsonl.gz': gzipSync(lines),
      'cards.json.gz': gzipSync(readFileSync(FIXTURE)),
    };
    for (const [name, content] of Object.entries(files)) {
      const fresh = createTestDb();
      const file = path.join(dir, name);
      await writeFile(file, content);
      const result = await loadBulkFile(fresh, file, { bulkUpdatedAt: BULK_UPDATED_AT });
      expect(result, name).toEqual({
        printingsRead: 35,
        notPaper: 1,
        skipped: name.endsWith('.json.gz') ? 1 : 2,
        cardCount: 30,
        printingCount: 35,
      });
      fresh.$client.close();
    }
  });

  it('loads 50,000 generated cards without memory growing with the file', {
    timeout: 120_000,
  }, async () => {
    const file = path.join(dir, 'big.json');
    const template = fixtureCards.find((card) => card.name === 'Augur of Autumn') as Record<
      string,
      unknown
    >;
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i++) {
      const hex = i.toString(16).padStart(12, '0');
      lines.push(
        JSON.stringify({
          ...template,
          id: `00000000-0000-4000-8000-${hex}`,
          oracle_id: `11111111-0000-4000-8000-${hex}`,
          name: `Generated Card ${i}`,
          collector_number: String(i),
        }),
      );
    }
    await writeFile(file, `[\n${lines.join(',\n')}\n]\n`);
    const fileSize = lines.reduce((sum, line) => sum + line.length, 0);
    lines.length = 0;

    // Collect garbage before each sample, so the samples show what the load holds on to.
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const retained = () => {
      gc();
      return process.memoryUsage().heapUsed;
    };
    const before = retained();
    let peak = before;
    let nextSample = 0;
    const result = await loadBulkFile(db, file, {
      bulkUpdatedAt: BULK_UPDATED_AT,
      onProgress: (read) => {
        if (read < nextSample) return;
        nextSample = read + 2_000_000;
        peak = Math.max(peak, retained());
      },
    });
    expect(result).toMatchObject({
      printingsRead: 50_000,
      cardCount: 50_000,
      printingCount: 50_000,
    });
    // Reading the whole file at once would hold all of it, and its parsed objects, in memory.
    expect(peak - before).toBeLessThan(fileSize / 5);
  });
});
