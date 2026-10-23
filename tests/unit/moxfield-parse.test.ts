import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type MoxfieldLine,
  mergeSlots,
  normalizeName,
  parseMoxfieldText,
} from '../../src/server/services/imports/moxfield-parse';

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, '..', 'fixtures', name), 'utf8');
const withSets = parseMoxfieldText(fixture('moxfield-deck-sample-with-sets.txt'));
const plain = parseMoxfieldText(fixture('moxfield-deck-sample-plain.txt'));

const BASICS = new Set(['forest', 'island', 'mountain', 'plains', 'swamp', 'wastes']);
const isBasicLand = (name: string) => BASICS.has(normalizeName(name));

const cards = (lines: MoxfieldLine[]) => lines.filter((line) => line.kind === 'card');
const namesAndQuantities = (lines: MoxfieldLine[]) =>
  mergeSlots(lines, isBasicLand)
    .map(({ name, board, quantity }) => ({ name, board, quantity }))
    .sort((a, b) => a.name.localeCompare(b.name));

describe("Jeff's Hearthhull deck", () => {
  it('tells the two formats apart', () => {
    expect(withSets.format).toBe('sets');
    expect(plain.format).toBe('plain');
  });

  it('gives the same names and quantities in both formats, with hints only in the set format', () => {
    expect(namesAndQuantities(withSets.lines)).toEqual(namesAndQuantities(plain.lines));
    expect(cards(withSets.lines).every((line) => line.setCode && line.collectorNumber)).toBe(true);
    expect(cards(plain.lines).some((line) => line.setCode || line.collectorNumber)).toBe(false);
    expect(cards(withSets.lines)[1]).toMatchObject({
      lineNo: 2,
      quantity: 1,
      name: 'Aftermath Analyst',
      setCode: 'EOC',
      collectorNumber: '91',
      foil: false,
      board: 'main',
    });
  });

  it('puts the 5 cards after SIDEBOARD: on the maybe board', () => {
    for (const { lines } of [withSets, plain]) {
      const maybe = cards(lines).filter((line) => line.board === 'maybe');
      expect(maybe.map((line) => line.name)).toEqual([
        'Centaur Vinecrasher',
        'Groundskeeper',
        'Loamcrafter Faun',
        'Uurg, Spawn of Turg',
        'World Breaker',
      ]);
      expect(lines.filter((line) => line.kind === 'header').map((line) => line.text)).toEqual([
        'SIDEBOARD:',
      ]);
      const main = cards(lines).filter((line) => line.board === 'main');
      expect(main.reduce((total, line) => total + (line.quantity ?? 0), 0)).toBe(95);
    }
  });

  it('proposes Hearthhull as the commander: the first line with sets, the last block in plain', () => {
    const proposed = (lines: MoxfieldLine[]) => lines.filter((line) => line.isCommanderProposal);

    expect(proposed(withSets.lines)).toEqual([
      expect.objectContaining({ lineNo: 1, name: 'Hearthhull, the Worldseed', board: 'main' }),
    ]);
    expect(proposed(plain.lines)).toEqual([
      expect.objectContaining({
        lineNo: plain.lines.length,
        name: 'Hearthhull, the Worldseed',
        board: 'main',
      }),
    ]);
  });

  it('reads *F* as foil', () => {
    const foils = cards(withSets.lines).filter((line) => line.foil);
    expect(foils.map((line) => [line.name, line.setCode, line.collectorNumber])).toEqual([
      ['Hearthhull, the Worldseed', 'EOC', '1'],
      ['Szarel, Genesis Shepherd', 'EOC', '4'],
    ]);
  });

  it('merges repeated basic lands into one slot each, keeping the first printing as the hint', () => {
    const slots = mergeSlots(withSets.lines, isBasicLand);
    const basics = slots.filter((slot) => slot.isBasicLand && slot.name !== 'Wastes');
    expect(
      basics.map(({ name, quantity, setCode, collectorNumber, lineNos }) => [
        name,
        quantity,
        `${setCode} ${collectorNumber}`,
        lineNos,
      ]),
    ).toEqual([
      ['Forest', 8, 'EOE 276', [27, 28]],
      ['Mountain', 3, 'EOE 274', [44, 45]],
      ['Swamp', 5, 'EOE 271', [72, 73]],
    ]);

    const plainSlots = mergeSlots(plain.lines, isBasicLand);
    expect(plainSlots.find((slot) => slot.name === 'Forest')).toMatchObject({
      quantity: 8,
      isBasicLand: true,
    });
    expect(plainSlots.find((slot) => slot.name === 'Forest')?.setCode).toBeUndefined();
    expect(plainSlots.find((slot) => slot.name === 'Sol Ring')?.isBasicLand).toBe(false);
    expect(plainSlots.filter((slot) => slot.isCommanderProposal).map((slot) => slot.name)).toEqual([
      'Hearthhull, the Worldseed',
    ]);
  });
});

describe('parseMoxfieldText', () => {
  it('marks lines it cannot read as invalid, and keeps every line with its number', () => {
    const { lines } = parseMoxfieldText(
      ['1 Sol Ring', 'Sol Ring', '0 Sol Ring', '', 'Deck notes: tuned', '2x Arcane Signet'].join(
        '\r\n',
      ),
    );
    expect(lines.map((line) => [line.lineNo, line.kind])).toEqual([
      [1, 'card'],
      [2, 'invalid'],
      [3, 'invalid'],
      [4, 'blank'],
      [5, 'invalid'],
      [6, 'card'],
    ]);
    expect(lines[1]).toEqual({ lineNo: 2, text: 'Sol Ring', kind: 'invalid' });
    expect(lines[5]).toMatchObject({ quantity: 2, name: 'Arcane Signet' });
  });

  it('reads collector numbers with letters or symbols, names with brackets, and other markers', () => {
    const { lines } = parseMoxfieldText(
      [
        '1 Brainstorm (PLST) A25-50',
        '1 Lightning Bolt (2X2) 117a *E*',
        "1 Erase (Not the Urza's Legacy One) (UNH) 32 *F*",
        '1 Command Tower (SLD) ★ *F* *A*',
        '1 Sol Ring *F*',
      ].join('\n'),
    );
    expect(
      lines.map(({ name, setCode, collectorNumber, foil }) => ({
        name,
        setCode,
        collectorNumber,
        foil,
      })),
    ).toEqual([
      { name: 'Brainstorm', setCode: 'PLST', collectorNumber: 'A25-50', foil: false },
      { name: 'Lightning Bolt', setCode: '2X2', collectorNumber: '117a', foil: false },
      {
        name: "Erase (Not the Urza's Legacy One)",
        setCode: 'UNH',
        collectorNumber: '32',
        foil: true,
      },
      { name: 'Command Tower', setCode: 'SLD', collectorNumber: '★', foil: true },
      { name: 'Sol Ring', setCode: undefined, collectorNumber: undefined, foil: true },
    ]);
  });

  it('proposes the last single-card block in plain text even without a sideboard', () => {
    const { lines } = parseMoxfieldText('1 Sol Ring\n1 Arcane Signet\n\n1 Atraxa, Grand Unifier\n');
    expect(lines).toHaveLength(4);
    expect(lines.filter((line) => line.isCommanderProposal).map((line) => line.name)).toEqual([
      'Atraxa, Grand Unifier',
    ]);
  });

  it('proposes no commander when the plain text has no block of its own for one', () => {
    const { format, lines } = parseMoxfieldText('1 Sol Ring\n1 Arcane Signet\n');
    expect(format).toBe('plain');
    expect(lines.some((line) => line.isCommanderProposal)).toBe(false);
    expect(parseMoxfieldText('').lines).toEqual([]);
  });
});

describe('mergeSlots', () => {
  it('merges names on the same board only, ignoring case', () => {
    const { lines } = parseMoxfieldText(
      '1 Sol Ring\n1 sol ring\n\nSIDEBOARD:\n1 Sol Ring\n1 Fire // Ice\n1 Fire / Ice',
    );
    expect(
      mergeSlots(lines, isBasicLand).map(({ name, board, quantity, lineNos }) => ({
        name,
        board,
        quantity,
        lineNos,
      })),
    ).toEqual([
      { name: 'Sol Ring', board: 'main', quantity: 2, lineNos: [1, 2] },
      { name: 'Sol Ring', board: 'maybe', quantity: 1, lineNos: [5] },
      { name: 'Fire // Ice', board: 'maybe', quantity: 2, lineNos: [6, 7] },
    ]);
  });
});

describe('normalizeName', () => {
  it('lower-cases names and reads " / " as " // " for double-faced cards', () => {
    expect(normalizeName('Fire / Ice')).toBe('fire // ice');
    expect(normalizeName('Fire // Ice')).toBe('fire // ice');
    expect(normalizeName('  Hearthhull,  the Worldseed ')).toBe('hearthhull, the worldseed');
  });
});

describe('tags', () => {
  const tagged = parseMoxfieldText(fixture('moxfield-deck-sample-with-tags.txt'));

  it("reads the tags at the end of Jeff's tagged lines, out of the card name", () => {
    expect(
      cards(tagged.lines).map(({ name, setCode, collectorNumber, tags }) => ({
        name,
        setCode,
        collectorNumber,
        tags,
      })),
    ).toEqual([
      {
        name: 'Adeline, Resplendent Cathar',
        setCode: 'J25',
        collectorNumber: '57',
        tags: ['token-maker'],
      },
      { name: 'Ashaya, Soul of the Wild', setCode: 'ZNR', collectorNumber: '179', tags: ['combo'] },
      { name: "Avacyn's Pilgrim", setCode: 'PLST', collectorNumber: 'MIC-132', tags: ['ramp'] },
      { name: 'Beast Whisperer', setCode: 'FDC', collectorNumber: '189', tags: ['draw'] },
      { name: 'Beast Within', setCode: 'FDC', collectorNumber: '190', tags: undefined },
    ]);
    expect(tagged.format).toBe('sets');
  });

  it('reads several tags after the foil mark, and a global #! tag without the !', () => {
    const [line] = parseMoxfieldText('1 Sol Ring (EOC) 57 *F* #ramp #!mana-rock\n').lines;
    expect(line).toMatchObject({
      kind: 'card',
      name: 'Sol Ring',
      setCode: 'EOC',
      collectorNumber: '57',
      foil: true,
      tags: ['ramp', 'mana-rock'],
    });
  });

  it('reads tags in the plain format too, and lines without tags as before', () => {
    const { lines } = parseMoxfieldText('1 Sol Ring #ramp\n1 Arcane Signet\n');
    expect(lines.map(({ name, tags }) => ({ name, tags }))).toEqual([
      { name: 'Sol Ring', tags: ['ramp'] },
      { name: 'Arcane Signet', tags: undefined },
    ]);
  });

  it('gives a merged slot every line’s tags', () => {
    const { lines } = parseMoxfieldText('1 Forest (EOE) 276 #land\n1 Forest (EOE) 277 #basic\n');
    expect(mergeSlots(lines, isBasicLand)).toEqual([
      expect.objectContaining({ name: 'Forest', quantity: 2, tags: ['land', 'basic'] }),
    ]);
  });
});
