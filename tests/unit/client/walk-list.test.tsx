// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NowPickingPane,
  type WalkCurrent,
  type WalkGroupData,
  type WalkLineData,
  WalkList,
  WalkProgress,
} from '../../../src/client/components/walk-list';
import type { PickLine } from '../../../src/shared/api/pick-list';
import { pickListSample } from '../../../src/shared/api/samples/pick-list';

afterEach(cleanup);

const { pickList } = pickListSample;

function toLine(line: PickLine): WalkLineData {
  const { suggested } = line;
  return {
    key: line.key,
    quantity: line.quantity,
    card: line.card,
    copy: {
      setCode: suggested.printing.setCode,
      rarity: suggested.printing.rarity,
      collectorNumber: suggested.printing.collectorNumber,
      finish: suggested.finish,
      condition: suggested.condition,
      isProxy: suggested.isProxy,
    },
    done: false,
    note: line.fromDeck?.becomesPartly
      ? `${line.fromDeck.name} becomes partly assembled`
      : undefined,
  };
}

const sampleGroups: WalkGroupData[] = [
  ...pickList.groups.map((group) => ({
    key: String(group.location.id),
    location: group.location,
    countText: `pull ${group.cardCount} here`,
    lines: group.lines.map(toLine),
  })),
  {
    key: 'other-decks',
    title: 'In other deck boxes',
    countText: 'Pulling one leaves that deck partly assembled',
    tone: 'warning' as const,
    lines: pickList.otherDecks.map(toLine),
  },
];
const allLines = sampleGroups.flatMap((group) => group.lines);

/** A pick list screen in miniature: it keeps the ticks and fills the pane, like #46 will. */
function Demo({ onToggle = () => {} }: { onToggle?: (line: WalkLineData) => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<WalkCurrent | null>(null);
  const groups = sampleGroups.map((group) => ({
    ...group,
    lines: group.lines.map((line) => ({ ...line, done: done.has(line.key) })),
  }));
  const progress = { done: done.size, total: allLines.length, label: 'pulled' };
  return (
    <MemoryRouter>
      <WalkProgress {...progress} />
      <WalkList
        groups={groups}
        onToggle={(line) => {
          onToggle(line);
          setDone((before) => {
            const after = new Set(before);
            if (after.has(line.key)) after.delete(line.key);
            else after.add(line.key);
            return after;
          });
        }}
        onCurrentChange={setCurrent}
        renderActions={(line) => (
          <button type="button" aria-label={`Switch copy for ${line.card.name}`}>
            Switch copy
          </button>
        )}
      />
      <NowPickingPane
        line={current?.line ?? null}
        location={current?.group.location ?? null}
        progress={progress}
      />
    </MemoryRouter>
  );
}

const row = (name: string) => screen.getByRole('checkbox', { name: `1 ${name}` }).closest('li');
const currentRow = () => document.querySelector('li[aria-current="step"]');
const pane = () => screen.getByRole('complementary', { name: 'Now picking' });
const key = (k: string) => fireEvent.keyDown(document.body, { key: k });

describe('WalkList', () => {
  it('renders each group with its tile, path, count and lines', () => {
    render(<Demo />);
    const chaosCalm = screen.getByRole('region', { name: 'Long box › Chaos & Calm' });
    expect(within(chaosCalm).getByRole('heading', { level: 2 }).textContent).toBe(
      'Long box › Chaos & Calm',
    );
    expect(chaosCalm.querySelector('[data-location-type="box"]')).not.toBeNull();
    expect(within(chaosCalm).getByText('pull 4 here')).toBeTruthy();
    expect(within(chaosCalm).getAllByRole('checkbox')).toHaveLength(4);

    const names = screen.getAllByRole('region').map((group) => group.getAttribute('aria-label'));
    expect(names).toEqual([
      'Long box › Chaos & Calm',
      'Long box › Fury & Order',
      'Rares binder',
      'Staples binder',
      'Trade binder',
      'In other deck boxes',
    ]);
  });

  it('shows the copy, a card link, Proxy, line actions and the note', () => {
    render(<Demo />);
    const grasp = row('Fierce Blast');
    expect(grasp).not.toBeNull();
    const link = within(grasp as HTMLElement).getByRole('link', { name: 'Fierce Blast' });
    expect(link.getAttribute('href')).toBe(`/cards/${pickList.groups[0].lines[0].card.id}`);
    expect(grasp?.textContent).toMatch(/OGN #\d+ · Normal · Near mint/);
    expect(grasp?.querySelector('[data-set="OGN"]')).not.toBeNull();
    expect(within(grasp as HTMLElement).getByRole('button', { name: /Switch copy/ })).toBeTruthy();

    const dariusAggro = pickList.groups[1].lines[2].card.name;
    expect(within(row(dariusAggro) as HTMLElement).getByText('Proxy')).toBeTruthy();
    expect(screen.getByText('Lux Control becomes partly assembled')).toBeTruthy();
  });

  it('greys a ticked line and calls onToggle with it', () => {
    const onToggle = vi.fn();
    render(<Demo onToggle={onToggle} />);
    const checkbox = screen.getByRole('checkbox', { name: '1 Grim Scheme' });
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ key: allLines[1].key }));
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(row('Grim Scheme')?.getAttribute('data-done')).toBe('true');
    expect(row('Grim Scheme')?.querySelector('.opacity-50')).not.toBeNull();

    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('starts on the first unticked line; ↑ / ↓ move and Space ticks', () => {
    const onToggle = vi.fn();
    render(<Demo onToggle={onToggle} />);
    expect(currentRow()).toBe(row('Fierce Blast'));

    key('ArrowDown');
    expect(currentRow()).toBe(row('Grim Scheme'));
    key('ArrowDown');
    key('ArrowUp');
    expect(currentRow()).toBe(row('Grim Scheme'));

    // Space ticks the current line and walks on to the next unticked one.
    key(' ');
    expect(onToggle).toHaveBeenLastCalledWith(expect.objectContaining({ key: allLines[1].key }));
    expect(
      (screen.getByRole('checkbox', { name: '1 Grim Scheme' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(currentRow()).toBe(row(allLines[2].card.name));

    // Back up to the ticked line and untick it.
    key('ArrowUp');
    key(' ');
    expect(
      (screen.getByRole('checkbox', { name: '1 Grim Scheme' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(currentRow()).toBe(row('Grim Scheme'));

    // ↑ stops at the first line.
    key('ArrowUp');
    key('ArrowUp');
    expect(currentRow()).toBe(row('Fierce Blast'));
  });

  it('leaves keys typed in a field alone', () => {
    const onToggle = vi.fn();
    render(
      <>
        <input aria-label="Search cards" />
        <Demo onToggle={onToggle} />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'Search cards' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: ' ' });
    expect(onToggle).not.toHaveBeenCalled();
    expect(currentRow()).toBe(row('Fierce Blast'));
  });

  it('makes a clicked line the current one', () => {
    render(<Demo />);
    fireEvent.mouseDown(row('Twilight Gust') as HTMLElement);
    expect(currentRow()).toBe(row('Twilight Gust'));
  });

  it('shows the card image while the name is hovered', () => {
    render(<Demo />);
    const grasp = row('Fierce Blast') as HTMLElement;
    const link = within(grasp).getByRole('link', { name: 'Fierce Blast' });
    expect(grasp.querySelector('[data-slot="hover-image"]')).toBeNull();
    fireEvent.mouseEnter(link);
    expect(grasp.querySelector('[data-slot="hover-image"]')?.getAttribute('src')).toBe(
      pickList.groups[0].lines[0].card.imageUrl,
    );
    fireEvent.mouseLeave(link);
    expect(grasp.querySelector('[data-slot="hover-image"]')).toBeNull();
  });

  it('turns the keyboard off when asked', () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter>
        <WalkList groups={sampleGroups} onToggle={onToggle} keyboard={false} />
      </MemoryRouter>,
    );
    key('ArrowDown');
    key(' ');
    expect(onToggle).not.toHaveBeenCalled();
    expect(currentRow()).toBe(row('Fierce Blast'));
  });
});

describe('WalkProgress', () => {
  it('shows the count and fills the bar', () => {
    render(<WalkProgress done={34} total={41} label="pulled" />);
    expect(screen.getByText('34 of 41 pulled')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('34');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('83%');
  });

  it('updates as lines are ticked', () => {
    render(<Demo />);
    expect(screen.getAllByText(`0 of ${allLines.length} pulled`)).toHaveLength(2);
    key(' ');
    key(' ');
    expect(screen.getAllByText(`2 of ${allLines.length} pulled`)).toHaveLength(2);
  });
});

describe('NowPickingPane', () => {
  it('follows the current line: location, image and copy', () => {
    render(<Demo />);
    const first = pickList.groups[0].lines[0];
    expect(within(pane()).getByText('Long box › Chaos & Calm')).toBeTruthy();
    expect(within(pane()).getByRole('img', { name: first.card.name }).getAttribute('src')).toBe(
      first.card.imageUrl,
    );

    // Move to the first line in the next location.
    for (let i = 0; i < 4; i++) key('ArrowDown');
    const next = pickList.groups[1].lines[0];
    expect(within(pane()).getByText('Long box › Fury & Order')).toBeTruthy();
    expect(within(pane()).getByRole('img', { name: next.card.name })).toBeTruthy();
    expect(within(pane()).getByText('Space')).toBeTruthy();
  });

  it('says when every line is ticked', () => {
    render(<NowPickingPane line={null} location={null} progress={{ done: 15, total: 15 }} />);
    expect(screen.getByText('Every line is ticked.')).toBeTruthy();
    expect(screen.getByText('15 of 15')).toBeTruthy();
  });
});
