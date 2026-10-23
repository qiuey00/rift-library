import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  type InvalidManaBoxRow,
  type ManaBoxRow,
  MissingColumnsError,
  parseManaBoxCsv,
} from '../../src/server/services/imports/manabox-parse';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const sample = fixture('manabox-sample.csv');
const binders = fixture('manabox-binders.csv');

const HEADER =
  'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,' +
  'Purchase price,Misprint,Altered,Condition,Language,Purchase price currency';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n');
const BOLT =
  'Burst Lightning,SOA,Secrets of Strixhaven Mystical Archive,41,normal,uncommon,2,112539,' +
  'f98b402a-ecdb-432f-a050-65945c8c415d,0.68,false,false,near_mint,en,USD';

function validRows(text: string) {
  return parseManaBoxCsv(text).rows.filter((row): row is ManaBoxRow => row.valid);
}

function invalidRow(text: string) {
  const [row] = parseManaBoxCsv(text).rows;
  expect(row?.valid).toBe(false);
  return row as InvalidManaBoxRow;
}

describe("parseManaBoxCsv with Jeff's sample", () => {
  const result = parseManaBoxCsv(sample);
  const rows = validRows(sample);

  it('reads 258 rows and 389 cards, all valid', () => {
    expect(result.rowCount).toBe(258);
    expect(result.cardCount).toBe(389);
    expect(rows).toHaveLength(258);
    expect(result.rows.map((row) => row.row)).toEqual(Array.from({ length: 258 }, (_, i) => i + 1));
  });

  it('has no binder or proxy column', () => {
    expect(result.hasBinderColumn).toBe(false);
    expect(result.hasProxyColumn).toBe(false);
    expect(rows.every((row) => row.isProxy === null)).toBe(true);
    expect(rows.every((row) => row.binderName === null && row.binderType === null)).toBe(true);
  });

  it('reads every field of a row', () => {
    expect(result.rows[0]).toEqual({
      row: 1,
      valid: true,
      name: 'Shamanic Revelation',
      setCode: 'SOA',
      collectorNumber: '57',
      scryfallId: '5dc1904b-b0e6-49e5-9ef3-7ea538db202b',
      quantity: 1,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      misprint: false,
      altered: false,
      purchasePrice: 2.34,
      purchaseCurrency: 'USD',
      isProxy: null,
      binderName: null,
      binderType: null,
    });
  });

  it('finds the 30 foil rows', () => {
    expect(rows.filter((row) => row.finish === 'foil')).toHaveLength(30);
    expect(rows.filter((row) => row.finish === 'nonfoil')).toHaveLength(228);
  });

  it('reads empty purchase prices as null', () => {
    expect(rows.filter((row) => row.purchasePrice === null)).toHaveLength(21);
    const antiquities = rows.filter((row) => row.name === 'Antiquities on the Loose');
    expect(antiquities.map((row) => [row.finish, row.purchasePrice])).toEqual([
      ['nonfoil', 1.02],
      ['foil', null],
    ]);
  });

  it('keeps quoted names with commas and "Front // Back" names', () => {
    const names = rows.map((row) => row.name);
    expect(names).toContain('Blech, Loafing Pest');
    expect(names).toContain('Aziza, Mage Tower Captain');
    expect(names).toContain('Harmonized Trio // Brainstorm');
    expect(names).toContain('Emeritus of Woe // Demonic Tutor');
  });

  it('reads the columns in any order', () => {
    const table = Papa.parse<string[]>(sample, { skipEmptyLines: true }).data;
    const order = table[0]?.map((_, i) => i).reverse() ?? [];
    const shuffled = Papa.unparse(table.map((cells) => order.map((i) => cells[i])));
    expect(shuffled.startsWith('Purchase price currency,Language,Condition')).toBe(true);
    expect(parseManaBoxCsv(shuffled)).toEqual(result);
  });
});

describe('parseManaBoxCsv with binder and proxy columns', () => {
  const result = parseManaBoxCsv(binders);
  const rows = validRows(binders);

  it('reads the binder and proxy columns', () => {
    expect(result.hasBinderColumn).toBe(true);
    expect(result.hasProxyColumn).toBe(true);
    expect(result.rowCount).toBe(10);
    expect(result.cardCount).toBe(14);
    expect(rows).toHaveLength(10);
  });

  it('gives each row its binder', () => {
    const binderOf = (row: ManaBoxRow) => `${row.binderType}: ${row.binderName}`;
    expect(Object.groupBy(rows, binderOf)).toEqual({
      'binder: Main binder': [expect.anything(), expect.anything(), expect.anything()],
      'binder: Trade binder': [expect.anything(), expect.anything()],
      'deck: Hearthhull': [expect.anything(), expect.anything(), expect.anything()],
      'list: Wishlist': [expect.anything(), expect.anything()],
    });
  });

  it('gives each row its proxy flag', () => {
    expect(rows.filter((row) => row.isProxy).map((row) => row.name)).toEqual([
      'Emeritus of Woe // Demonic Tutor',
      'Triumph of the Hordes',
    ]);
    expect(rows.filter((row) => row.isProxy === false)).toHaveLength(8);
  });
});

describe('parseManaBoxCsv with a broken file', () => {
  it('names the missing and expected columns', () => {
    const noQuantityOrFoil = sample.replace('Foil,', 'Finish,').replace('Quantity,', 'Count,');
    expect(() => parseManaBoxCsv(noQuantityOrFoil)).toThrow(MissingColumnsError);
    try {
      parseManaBoxCsv(noQuantityOrFoil);
    } catch (error) {
      const missing = error as MissingColumnsError;
      expect(missing.missing).toEqual(['Quantity', 'Foil']);
      expect(missing.status).toBe(400);
      expect(missing.code).toBe('missing_columns');
      expect(missing.message).toBe(
        'This file has no Quantity or Foil column. A ManaBox CSV export needs the Scryfall ID, ' +
          'Quantity, Foil, Condition, Language, Misprint and Altered columns.',
      );
    }
  });

  it('treats a file that is not a CSV export as missing every column', () => {
    const text = fixture('moxfield-deck-sample-plain.txt');
    expect(() => parseManaBoxCsv(text)).toThrow(/has no Scryfall ID, Quantity, Foil/);
    expect(() => parseManaBoxCsv('')).toThrow(MissingColumnsError);
  });

  it('needs Binder Type when the file has Binder Name', () => {
    const text = binders.replace('Binder Type,', 'Kind,');
    expect(() => parseManaBoxCsv(text)).toThrow(/has no Binder Type column/);
  });

  it('marks a row with a bad value invalid and reads the rest', () => {
    const result = parseManaBoxCsv(csv(BOLT, BOLT.replace(',2,112539', ',abc,112539'), BOLT));
    expect(result.rowCount).toBe(3);
    expect(result.cardCount).toBe(4);
    expect(result.rows.map((row) => row.valid)).toEqual([true, false, true]);
    expect(result.rows[1]).toEqual({
      row: 2,
      valid: false,
      reason: 'Quantity "abc" isn\'t a whole number above 0.',
      name: 'Burst Lightning',
      setCode: 'SOA',
      collectorNumber: '41',
      scryfallId: 'f98b402a-ecdb-432f-a050-65945c8c415d',
    });
  });

  it('says what is wrong with each bad value', () => {
    expect(invalidRow(csv(BOLT.replace(',2,112539', ',0,112539'))).reason).toBe(
      'Quantity "0" isn\'t a whole number above 0.',
    );
    expect(invalidRow(csv(BOLT.replace(',normal,', ',shiny,'))).reason).toBe(
      'Foil "shiny" isn\'t normal, foil or etched.',
    );
    expect(invalidRow(csv(BOLT.replace(',0.68,false,false,', ',0.68,maybe,,'))).reason).toBe(
      'Misprint "maybe" isn\'t true or false. Altered is empty.',
    );
    expect(invalidRow(csv(BOLT.replace(',0.68,', ',cheap,'))).reason).toBe(
      'Purchase price "cheap" isn\'t a number.',
    );
    expect(invalidRow(csv(BOLT.replace(',near_mint,en,', ',,en,'))).reason).toBe(
      'Condition is empty.',
    );
    expect(invalidRow(csv(`${BOLT},extra`)).reason).toBe(
      'This row has 16 values but the file has 15 columns.',
    );
    expect(
      invalidRow(binders.split('\r\n').slice(0, 2).join('\n').replace(',binder,', ',box,')),
    ).toMatchObject({ reason: 'Binder Type "box" isn\'t binder, deck or list.' });
  });

  it('finds a card without a Scryfall ID by set code and collector number', () => {
    const noId = BOLT.replace('f98b402a-ecdb-432f-a050-65945c8c415d', '');
    expect(validRows(csv(noId))[0]).toMatchObject({
      scryfallId: null,
      setCode: 'SOA',
      collectorNumber: '41',
    });
    expect(invalidRow(csv(noId.replace(',41,', ',,'))).reason).toBe(
      'This row has no Scryfall ID, or set code and collector number, to find the card.',
    );
  });

  it('reads etched finishes and skips blank lines', () => {
    const etched = BOLT.replace(',normal,', ',etched,');
    const rows = validRows(`${csv(etched, '', BOLT)}\r\n`);
    expect(rows.map((row) => [row.row, row.finish])).toEqual([
      [1, 'etched'],
      [2, 'nonfoil'],
    ]);
  });
});
