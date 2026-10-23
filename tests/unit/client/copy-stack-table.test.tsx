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
  s.blechFoil,
  s.commandTower,
  s.gaeasCradleProxy,
  s.magmabloodArchaicJapanese,
  s.hearthhullFoil,
  s.witherbloomCharm,
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
      'Set',
      'No.',
      'Finish',
      'Cond.',
      'Lang.',
      'Qty',
      'Where it is',
    ]);
    expect(bodyRows()).toHaveLength(rows.length);

    const blech = rowOf(s.blechFoil);
    const link = within(blech).getByRole('link', { name: 'Blech, Loafing Pest' });
    expect(link.getAttribute('href')).toBe(`/cards/${s.blechFoil.card.oracleId}`);
    expect(blech.querySelectorAll('.ms-cost')).toHaveLength(3);
    expect(blech.querySelector('.ss.ss-sos.ss-rare')).not.toBeNull();
    const cells = within(blech)
      .getAllByRole('cell')
      .map((td) => td.textContent);
    expect(cells.slice(2)).toEqual([
      'SOS',
      '#176',
      'Foil',
      'NM',
      '',
      '1',
      s.blechFoil.location.path,
    ]);
    expect(blech.querySelector('[data-location-type="box"]')).not.toBeNull();

    expect(within(rowOf(s.commandTower)).getAllByRole('cell')[7].textContent).toBe('3');
  });

  it('shows the language only for copies that are not English', () => {
    renderTable();
    expect(within(rowOf(s.magmabloodArchaicJapanese)).getAllByRole('cell')[6].textContent).toBe(
      'JA',
    );
    cleanup();
    renderTable({ rows: [s.blechFoil, s.commandTower] });
    expect(screen.queryByRole('columnheader', { name: 'Lang.' })).toBeNull();
  });

  it('can hide the location column', () => {
    renderTable({ showLocation: false });
    expect(screen.queryByRole('columnheader', { name: 'Where it is' })).toBeNull();
    expect(rowOf(s.blechFoil).textContent).not.toContain(s.blechFoil.location.path);
  });

  it('tags proxies and copies in a deck', () => {
    renderTable();
    expect(within(rowOf(s.gaeasCradleProxy)).getByText('Proxy')).toBeTruthy();
    expect(within(rowOf(s.blechFoil)).queryByText('Proxy')).toBeNull();

    const inDeck = within(rowOf(s.hearthhullFoil)).getByRole('link', { name: /In deck/ });
    expect(inDeck.textContent).toBe(`In deck · ${s.hearthhullFoil.inDeck?.deckName}`);
    expect(inDeck.getAttribute('href')).toBe(`/decks/${s.hearthhullFoil.inDeck?.deckId}`);
    expect(within(rowOf(s.commandTower)).queryByText(/In deck/)).toBeNull();
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

    fireEvent.click(checkboxOf(s.commandTower));
    fireEvent.click(checkboxOf(s.witherbloomCharm));
    const bar = screen.getByRole('toolbar', { name: 'Selected cards' });
    expect(bar.textContent).toContain('2 selected');
    expect(rowOf(s.commandTower).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(within(bar).getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith([s.commandTower, s.witherbloomCharm]);
    expect(proxy).not.toHaveBeenCalled();

    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar', { name: 'Selected cards' })).toBeNull();
  });

  it('selects a range with shift-click', () => {
    const move = vi.fn<CopyStackAction['onClick']>();
    renderTable({ actions: [{ label: 'Move to', onClick: move }] });

    fireEvent.click(checkboxOf(s.commandTower));
    fireEvent.click(checkboxOf(s.hearthhullFoil), { shiftKey: true });
    expect(screen.getByRole('toolbar').textContent).toContain('4 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith([
      s.commandTower,
      s.gaeasCradleProxy,
      s.magmabloodArchaicJapanese,
      s.hearthhullFoil,
    ]);

    // Shift-click on a selected row clears the range back to the last row clicked.
    fireEvent.click(checkboxOf(s.gaeasCradleProxy), { shiftKey: true });
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
    fireEvent.click(checkboxOf(s.commandTower));
    fireEvent.click(checkboxOf(s.witherbloomCharm));
    rerender(
      <MemoryRouter>
        <CopyStackTable
          rows={rows.filter((row) => row !== s.commandTower)}
          viewKey="test-view"
          actions={[{ label: 'Move to', onClick: move }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('toolbar').textContent).toContain('1 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith([s.witherbloomCharm]);
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
    const image = screen.getByRole('img', { name: 'Blech, Loafing Pest' }) as HTMLImageElement;
    expect(image.src).toBe(s.blechFoil.printing.imageNormal);

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
    fireEvent.click(screen.getByRole('checkbox', { name: /^Select Command Tower/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Select Witherbloom Charm/ }), {
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    expect(move).toHaveBeenCalledWith(rows.slice(1));
  });

  it('shows the card image while a text row is hovered', () => {
    renderTable();
    const preview = () => document.querySelector('[data-slot="card-preview"] img');
    expect(preview()).toBeNull();
    fireEvent.mouseEnter(rowOf(s.blechFoil), { clientX: 200 });
    expect(preview()?.getAttribute('src')).toBe(s.blechFoil.printing.imageNormal);
    fireEvent.mouseEnter(rowOf(s.commandTower), { clientX: 200 });
    expect(preview()?.getAttribute('src')).toBe(s.commandTower.printing.imageNormal);
    fireEvent.mouseLeave(rowOf(s.commandTower).parentElement as HTMLElement);
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
