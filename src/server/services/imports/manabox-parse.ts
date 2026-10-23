import Papa from 'papaparse';
import type { Finish } from '../../../shared/api/common';
import { AppError } from '../../errors';

// Reads a ManaBox CSV export into typed rows for both ManaBox import modes (add copies, update a
// location). Columns are found by their header name, so their order doesn't matter. Nothing is
// looked up or written here.

export type BinderType = 'binder' | 'deck' | 'list';

/** What every row carries, valid or not, so it can be shown to Jeff and its card looked up. */
interface RowLabel {
  /** 1-based, counting card rows only: the first row under the header is row 1. */
  row: number;
  /** As written, such as "Harmonized Trio // Brainstorm"; "" when empty or the file has no column. */
  name: string;
  setCode: string;
  collectorNumber: string;
  /** null when empty: the card is then found by set code and collector number. */
  scryfallId: string | null;
}

export interface ManaBoxRow extends RowLabel {
  valid: true;
  quantity: number;
  finish: Finish;
  /** As written, such as "near_mint". */
  condition: string;
  /** As written, such as "en". */
  language: string;
  misprint: boolean;
  altered: boolean;
  /** null when empty or the file has no column. */
  purchasePrice: number | null;
  purchaseCurrency: string | null;
  /** null when the file has no Proxy column. */
  isProxy: boolean | null;
  /** Both null when the file has no Binder Name and Binder Type columns. */
  binderName: string | null;
  binderType: BinderType | null;
}

/** A row with a bad value. The rest of the file is still read. */
export interface InvalidManaBoxRow extends RowLabel {
  valid: false;
  /** Written for Jeff, such as 'Quantity "abc" isn't a whole number above 0.' */
  reason: string;
}

export interface ManaBoxCsv {
  rows: (ManaBoxRow | InvalidManaBoxRow)[];
  hasProxyColumn: boolean;
  hasBinderColumn: boolean;
  /** Every row, valid or not. */
  rowCount: number;
  /** The quantities of the valid rows added up. */
  cardCount: number;
}

const COLUMNS = {
  scryfallId: 'Scryfall ID',
  quantity: 'Quantity',
  foil: 'Foil',
  condition: 'Condition',
  language: 'Language',
  misprint: 'Misprint',
  altered: 'Altered',
  purchasePrice: 'Purchase price',
  purchaseCurrency: 'Purchase price currency',
  proxy: 'Proxy',
  binderName: 'Binder Name',
  binderType: 'Binder Type',
  name: 'Name',
  setCode: 'Set code',
  collectorNumber: 'Collector number',
} as const;
type Column = keyof typeof COLUMNS;

const REQUIRED: Column[] = [
  'scryfallId',
  'quantity',
  'foil',
  'condition',
  'language',
  'misprint',
  'altered',
];

const FINISHES: Record<string, Finish> = { normal: 'nonfoil', foil: 'foil', etched: 'etched' };
const BINDER_TYPES: readonly string[] = ['binder', 'deck', 'list'] satisfies BinderType[];

/** Thrown when the file lacks a column the import needs. The server answers 400 `missing_columns`. */
export class MissingColumnsError extends AppError {
  /** Header names, such as ["Quantity", "Foil"]. */
  readonly missing: string[];
  readonly expected: string[];

  constructor(missing: string[], expected: string[]) {
    super(
      400,
      'missing_columns',
      `This file has no ${joinWords(missing, 'or')} column. ` +
        `A ManaBox CSV export needs the ${joinWords(expected, 'and')} columns.`,
    );
    this.name = 'MissingColumnsError';
    this.missing = missing;
    this.expected = expected;
  }
}

/** Headers are matched ignoring case and surrounding spaces. */
const headerKey = (header: string) => header.trim().toLowerCase();

export function parseManaBoxCsv(text: string): ManaBoxCsv {
  const parsed = Papa.parse<Record<string, string | undefined>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: headerKey,
    transform: (value) => value.trim(),
  });

  const fields = new Set(parsed.meta.fields ?? []);
  const has = (column: Column) => fields.has(headerKey(COLUMNS[column]));

  // Binder Name and Binder Type only mean something together.
  const hasBinderColumn = has('binderName') || has('binderType');
  const expected: Column[] = hasBinderColumn ? [...REQUIRED, 'binderName', 'binderType'] : REQUIRED;
  const missing = expected.filter((column) => !has(column));
  if (missing.length > 0) {
    throw new MissingColumnsError(
      missing.map((column) => COLUMNS[column]),
      expected.map((column) => COLUMNS[column]),
    );
  }

  const rowProblems = new Map<number, string>();
  for (const error of parsed.errors) {
    if (error.row === undefined || rowProblems.has(error.row)) continue;
    const record = parsed.data[error.row];
    rowProblems.set(
      error.row,
      error.type === 'FieldMismatch' && record
        ? `This row has ${countValues(record)} values but the file has ${fields.size} columns.`
        : error.type === 'Quotes'
          ? "This row's quote marks don't pair up."
          : `${error.message}.`,
    );
  }

  const hasProxyColumn = has('proxy');
  const rows = parsed.data.map((record, index) =>
    readRow(record, index + 1, rowProblems.get(index), { hasProxyColumn, hasBinderColumn }),
  );
  const cardCount = rows.reduce((sum, row) => sum + (row.valid ? row.quantity : 0), 0);
  return { rows, hasProxyColumn, hasBinderColumn, rowCount: rows.length, cardCount };
}

function readRow(
  record: Record<string, string | undefined>,
  row: number,
  fileProblem: string | undefined,
  file: { hasProxyColumn: boolean; hasBinderColumn: boolean },
): ManaBoxRow | InvalidManaBoxRow {
  const cell = (column: Column) => record[headerKey(COLUMNS[column])] ?? '';
  const label: RowLabel = {
    row,
    name: cell('name'),
    setCode: cell('setCode'),
    collectorNumber: cell('collectorNumber'),
    scryfallId: cell('scryfallId').toLowerCase() || null,
  };

  const problems: string[] = fileProblem ? [fileProblem] : [];
  const bad = (column: Column, expectation: string) => {
    const value = cell(column);
    problems.push(
      value === ''
        ? `${COLUMNS[column]} is empty.`
        : `${COLUMNS[column]} "${value}" isn't ${expectation}.`,
    );
    return undefined;
  };
  const readBoolean = (column: Column) => {
    const value = cell(column).toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return bad(column, 'true or false');
  };
  const readText = (column: Column) => cell(column) || bad(column, '');

  const quantity = /^\d+$/.test(cell('quantity')) ? Number(cell('quantity')) : 0;
  if (quantity < 1) bad('quantity', 'a whole number above 0');
  const finish = FINISHES[cell('foil').toLowerCase()] ?? bad('foil', 'normal, foil or etched');
  const condition = readText('condition');
  const language = readText('language');
  const misprint = readBoolean('misprint');
  const altered = readBoolean('altered');

  const priceText = cell('purchasePrice');
  let purchasePrice: number | null = null;
  if (/^\d+(\.\d+)?$/.test(priceText)) purchasePrice = Number(priceText);
  else if (priceText !== '') bad('purchasePrice', 'a number');

  const isProxy = file.hasProxyColumn ? readBoolean('proxy') : null;

  let binderName: string | null = null;
  let binderType: BinderType | null = null;
  if (file.hasBinderColumn) {
    binderName = readText('binderName') ?? null;
    const type = cell('binderType').toLowerCase();
    if (BINDER_TYPES.includes(type)) binderType = type as BinderType;
    else bad('binderType', 'binder, deck or list');
  }

  if (!label.scryfallId && !(label.setCode && label.collectorNumber)) {
    problems.push(
      'This row has no Scryfall ID, or set code and collector number, to find the card.',
    );
  }

  if (
    problems.length > 0 ||
    finish === undefined ||
    condition === undefined ||
    language === undefined ||
    misprint === undefined ||
    altered === undefined ||
    isProxy === undefined
  ) {
    return { ...label, valid: false, reason: problems.join(' ') };
  }
  return {
    ...label,
    valid: true,
    quantity,
    finish,
    condition,
    language,
    misprint,
    altered,
    purchasePrice,
    purchaseCurrency: cell('purchaseCurrency') || null,
    isProxy,
    binderName,
    binderType,
  };
}

/** How many values a row really had, counting any past the last column. */
function countValues(record: Record<string, unknown>) {
  const { __parsed_extra: extra, ...values } = record;
  return Object.keys(values).length + (Array.isArray(extra) ? extra.length : 0);
}

/** ["A", "B", "C"] → "A, B and C". */
function joinWords(words: string[], conjunction: 'and' | 'or') {
  return words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} ${conjunction} ${words.at(-1)}`;
}
