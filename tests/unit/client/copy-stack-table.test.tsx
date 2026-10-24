// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CopyStackAction,
  CopyStackTable,
  ROW_HEIGHT,
} from '../../../src/client/components/CopyStackTable';
import type { StackRow } from '../../../src/shared/api/common';
import { cardCopiesSample, sampleStacks } from '../../../src/shared/api/samples/stacks';

beforeEach(() => {
  // jsdom has no scrolling; the virtual list's scroll calls do nothing here.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

const s = sampleStacks;
const rows: StackRow[] = [
  s.nasusProtectorFoil,
  s.targonsPeak,
  s.hollowSummitProxy,
  s.grimCartographerJapanese,
  s.jinxBurnFoil,
  s.whisperingSurge,
];

function renderTable(props: Partial<Parameters<typeof CopyStackTable>[0]> = {}) {
  const result = render(
    <MemoryRouter>
      <CopyStackTable rows={rows} viewKey="test-view" {...props} />
    </MemoryRouter>,
  );
  return result;
}

const bodyRows = () =>
  screen.getAllByRole('row').filter((row) => row.hasAttribute('data-stack-id'));

const rowOf = (stack: StackRow) =>
  bodyRows().find((row) => row.dataset.stackId === String(stack.stackId)) as HTMLElement;

const checkboxOf = (stack: StackRow) =>
  within(rowOf(stack)).getByRole('checkbox', { name: new RegExp(`^Select ${stack.card.name}`) });

/** Ten thousand stacks: the sample rows repeated with new ids. */
function manyRows(count: number): StackRow[] {
  const base = Object.values(sampleStacks);
  return Array.from({ length: count }, (_, i) => ({
    ...base[i % base.length],
    stackId: i + 1,
  }));
}

describe('CopyStackTable columns', () => {
  it('shows each stack as a row with its card, printing, copy details and location', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      '',
      'Card',
      'Type',
      'Code',
      'Finish',
      'Cond.',
      'Lang.',
      'Qty',
      'Where it is',
    ]);
    expect(bodyRows()).toHaveLength(rows.length);

    const nasusProtector = rowOf(s.nasusProtectorFoil);
    const link = within(nasusProtector).getByRole('link', { name: 'Nasus, Protector' });
    expect(link.getAttribute('href')).toBe(`/cards/${s.nasusProtectorFoil.card.id}`);
    expect(
      within(nasusProtector)
        .getAllByRole('img')
        .map((icon) => icon.getAttribute('aria-label')),
    ).toEqual(['Chaos', 'Calm']);
    const cells = within(nasusProtector)
      .getAllByRole('cell')
      .map((td) => td.textContent);
    expect(cells.slice(2)).toEqual([
      'Champion unit',
      'SFD-176/221',
      'Foil',
      'NM',
      '',
      '1',
      s.nasusProtectorFoil.location.path,
    ]);
    expect(nasusProtector.querySelector('[data-location-type="box"]')).not.toBeNull();

    expect(within(rowOf(s.targonsPeak)).getAllByRole('cell')[7].textContent).toBe('3');
  });

  it('shows the language only for copies that are not English', () => {
    renderTable();
    expect(within(rowOf(s.grimCartographerJapanese)).getAllByRole('cell')[6].textContent).toBe(
      'JA',
    );
    cleanup();
    renderTable({ rows: [s.nasusProtectorFoil, s.targonsPeak] });
    expect(screen.queryByRole('columnheader', { name: 'Lang.' })).toBeNull();
  });

  it('can hide the location column', () => {
    renderTable({ showLocation: false });
    expect(screen.queryByRole('columnheader', { name: 'Where it is' })).toBeNull();
    expect(rowOf(s.nasusProtectorFoil).textContent).not.toContain(
      s.nasusProtectorFoil.location.path,
    );
  });

  it('tags proxies and copies in a deck', () => {
    renderTable();
    expect(within(rowOf(s.hollowSummitProxy)).getByText('Proxy')).toBeTruthy();
    expect(within(rowOf(s.nasusProtectorFoil)).queryByText('Proxy')).toBeNull();

    const inDeck = within(rowOf(s.jinxBurnFoil)).getByRole('link', { name: /In deck/ });
    expect(inDeck.textContent).toBe(`In deck · ${s.jinxBurnFoil.inDeck?.deckName}`);
    expect(inDeck.getAttribute('href')).toBe(`/decks/${s.jinxBurnFoil.inDeck?.deckId}`);
    expect(within(rowOf(s.targonsPeak)).queryByText(/In deck/)).toBeNull();
  });

  it('says so when there are no stacks', () => {
    renderTable({ rows: [], emptyMessage: 'Nothing in this box yet.' });
    expect(screen.getByText('Nothing in this box yet.')).toBeTruthy();
  });
});

describe('CopyStackTable selection', () => {
  it('selects rows with checkboxes and hands the selected rows to the action buttons', () => {
    const move = vi.fn<CopyStackAction['onClick']>();
    const proxy = vi.fn<CopyStackAction['onClick']>();
    renderTable({
      actions: [
        { label: 'Move to', onClick: move },
        { label: 'Mark as proxy', onClick: proxy },
      ],
    });
    expect(screen.queryByRole('toolbar', { name: 'Selected cards' })).toBeNull();

    fireEvent.click(checkboxOf(s.targonsPeak));
    fireEvent.click(checkboxOf(s.whisperingSurge));
    const bar = screen.getByRole('toolbar', { name: 'Selected cards' });
    expect(bar.textContent).toContain('2 selected');
    expect(rowOf(s.targonsPeak).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(within(bar).getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith([s.targonsPeak, s.whisperingSurge]);
    expect(proxy).not.toHaveBeenCalled();

    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar', { name: 'Selected cards' })).toBeNull();
  });

  it('selects a range with shift-click', () => {
    const move = vi.fn<CopyStackAction['onClick']>();
    renderTable({ actions: [{ label: 'Move to', onClick: move }] });

    fireEvent.click(checkboxOf(s.targonsPeak));
    fireEvent.click(checkboxOf(s.jinxBurnFoil), { shiftKey: true });
    expect(screen.getByRole('toolbar').textContent).toContain('4 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith([
      s.targonsPeak,
      s.hollowSummitProxy,
      s.grimCartographerJapanese,
      s.jinxBurnFoil,
    ]);

    // Shift-click on a selected row clears the range back to the last row clicked.
    fireEvent.click(checkboxOf(s.hollowSummitProxy), { shiftKey: true });
    expect(screen.getByRole('toolbar').textContent).toContain('1 selected');
  });

  it('selects every row with the header checkbox', () => {
    renderTable({ actions: [{ label: 'Move to', onClick: () => {} }] });
    const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    fireEvent.click(all);
    expect(screen.getByRole('toolbar').textContent).toContain(`${rows.length} selected`);
    expect(all.checked).toBe(true);
    fireEvent.click(all);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('drops rows that are no longer in the list from the selection', () => {
    const move = vi.fn<CopyStackAction['onClick']>();
    const { rerender } = renderTable({ actions: [{ label: 'Move to', onClick: move }] });
    fireEvent.click(checkboxOf(s.targonsPeak));
    fireEvent.click(checkboxOf(s.whisperingSurge));
    rerender(
      <MemoryRouter>
        <CopyStackTable
          rows={rows.filter((row) => row !== s.targonsPeak)}
          viewKey="test-view"
          actions={[{ label: 'Move to', onClick: move }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('toolbar').textContent).toContain('1 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith([s.whisperingSurge]);
  });
});

describe('CopyStackTable rows or images', () => {
  it('switches to card images and remembers the choice after reload', () => {
    renderTable();
    const view = screen.getByRole('group', { name: 'View' });
    expect(within(view).getByRole('button', { name: 'Rows' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(view).getByRole('button', { name: 'Images' }));
    expect(localStorage.getItem('test-view')).toBe('images');
    expect(screen.queryByRole('table')).toBeNull();
    const image = screen.getByRole('img', { name: 'Nasus, Protector' }) as HTMLImageElement;
    expect(image.src).toBe(s.nasusProtectorFoil.printing.imageUrl);

    cleanup();
    renderTable();
    expect(screen.getByRole('button', { name: 'Images' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(rows.length);

    cleanup();
    renderTable({ viewKey: 'another-screen' });
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('can select cards in the image view too', () => {
    const move = vi.fn<CopyStackAction['onClick']>();
    localStorage.setItem('test-view', 'images');
    renderTable({ actions: [{ label: 'Move to', onClick: move }] });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Select Targon's Peak/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Select Whispering Surge/ }), {
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith(rows.slice(1));
  });

  it('shows the card image while a text row is hovered', () => {
    renderTable();
    const preview = () => document.querySelector('[data-slot="card-preview"] img');
    expect(preview()).toBeNull();
    fireEvent.mouseEnter(rowOf(s.nasusProtectorFoil), { clientX: 200 });
    expect(preview()?.getAttribute('src')).toBe(s.nasusProtectorFoil.printing.imageUrl);
    fireEvent.mouseEnter(rowOf(s.targonsPeak), { clientX: 200 });
    expect(preview()?.getAttribute('src')).toBe(s.targonsPeak.printing.imageUrl);
    fireEvent.mouseLeave(rowOf(s.targonsPeak).parentElement as HTMLElement);
    expect(preview()).toBeNull();
  });
});

describe('CopyStackTable with many stacks', () => {
  it('renders only the rows in view for 10,000 stacks, and follows the scroll', () => {
    const started = performance.now();
    renderTable({ rows: manyRows(10_000) });
    expect(performance.now() - started).toBeLessThan(2000);

    const shown = bodyRows();
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.length).toBeLessThan(60);
    expect(shown[0].dataset.stackId).toBe('1');

    act(() => {
      Object.defineProperty(window, 'scrollY', { value: ROW_HEIGHT * 5000, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    const scrolled = bodyRows();
    expect(scrolled.length).toBeLessThan(60);
    const ids = scrolled.map((row) => Number(row.dataset.stackId));
    expect(ids).toContain(5001);
    expect(Math.min(...ids)).toBeGreaterThan(4900);
  });

  it('asks for the next page when the end of the list is in view', () => {
    const onEndReached = vi.fn();
    const { rerender } = renderTable({ rows: cardCopiesSample.rows, onEndReached });
    expect(onEndReached).toHaveBeenCalledTimes(1);

    const longer = manyRows(500);
    rerender(
      <MemoryRouter>
        <CopyStackTable rows={longer} viewKey="test-view" onEndReached={onEndReached} />
      </MemoryRouter>,
    );
    // The end of 500 rows is far out of view.
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});
