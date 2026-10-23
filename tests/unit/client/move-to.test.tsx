// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LocationPicker,
  type LocationPickerProps,
} from '../../../src/client/components/LocationPicker';
import { MoveToDialog, type MoveToDialogProps } from '../../../src/client/components/MoveToDialog';
import { UndoBarProvider } from '../../../src/client/components/UndoBar';
import type { Id } from '../../../src/shared/api/common';
import type { MoveCopiesBody } from '../../../src/shared/api/copies';
import {
  moveManyResultSample,
  moveResultSample,
  staleCopyErrorSample,
} from '../../../src/shared/api/samples/copies';
import { locationTreeSample } from '../../../src/shared/api/samples/locations';
import { sampleStacks } from '../../../src/shared/api/samples/stacks';

// The location picker and the Move to dialog, with the API mocked from the samples: the
// location tree (To sort, Long box and its three sections, two binders, the Bulk tray and
// two deck boxes) and POST /api/moves.

beforeAll(() => {
  // jsdom lacks what the popover and its list measure with.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Call = { url: string; method: string; body: unknown };

function mockApi(move: () => Response = () => Response.json(moveResultSample)) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), 'http://127.0.0.1:4300'), init);
      const url = new URL(request.url).pathname;
      if (request.method === 'GET' && url === '/api/locations/tree') {
        calls.push({ url, method: 'GET', body: undefined });
        return Response.json(locationTreeSample);
      }
      calls.push({ url, method: request.method, body: await request.json() });
      return move();
    }),
  );
  return calls;
}

function withProviders(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <UndoBarProvider>{children}</UndoBarProvider>
    </QueryClientProvider>
  );
}

/** The picker holding its own value, as a screen would. */
function Picker(props: Omit<LocationPickerProps, 'value' | 'onChange'> & { start?: Id }) {
  const [value, setValue] = useState<Id | null>(props.start ?? null);
  return (
    <>
      <label htmlFor="where">Where</label>
      <LocationPicker id="where" {...props} value={value} onChange={setValue} />
    </>
  );
}

const openPicker = (name = 'Where') => fireEvent.click(screen.getByRole('combobox', { name }));
const rows = () => within(screen.getByRole('listbox')).queryAllByRole('option');
const rowNames = () => rows().map((row) => row.textContent);
const search = (text: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Search locations' }), {
    target: { value: text },
  });

describe('LocationPicker', () => {
  it('lists every location in tree order, indented by depth, with its tile', async () => {
    mockApi();
    render(withProviders(<Picker />));
    expect(screen.getByRole('combobox', { name: 'Where' }).textContent).toBe('Pick a location');
    openPicker();
    await waitFor(() => expect(rows()).toHaveLength(11));
    expect(rowNames()).toEqual(locationTreeSample.nodes.map((node) => node.name));

    const lands = rows()[4];
    const longBox = rows()[1];
    expect(Number.parseInt(lands.style.paddingLeft, 10)).toBeGreaterThan(
      Number.parseInt(longBox.style.paddingLeft, 10),
    );
    // Lands has no color of its own, so its tile takes the Long box's blue.
    const tile = lands.querySelector('[data-location-type]') as HTMLElement;
    expect(tile.dataset.locationType).toBe('box');
    expect(tile.style.backgroundColor).toBe('rgb(59, 111, 216)');
    // To sort has no color: a grey tile.
    const inbox = rows()[0].querySelector('[data-location-type]') as HTMLElement;
    expect(inbox.dataset.locationType).toBe('inbox');
    expect(inbox.style.backgroundColor).toBe('');
  });

  it('filters by name or path as Jeff types', async () => {
    mockApi();
    render(withProviders(<Picker />));
    openPicker();
    await waitFor(() => expect(rows()).toHaveLength(11));

    search('lands');
    expect(rowNames()).toEqual(['Long box › Lands']);

    search('LONG BOX');
    expect(rowNames()).toEqual([
      'Long box',
      'Long box › Black & Green',
      'Long box › Red & Gold',
      'Long box › Lands',
    ]);

    search('binder');
    expect(rowNames()).toEqual(['Rares binder', 'Staples binder', 'Trade binder']);

    search('nowhere');
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('No location matches “nowhere”.')).toBeTruthy();
  });

  it('hides deck boxes and excluded locations when asked', async () => {
    mockApi();
    render(withProviders(<Picker excludeDeckBoxes excludeIds={[1, 8]} />));
    openPicker();
    await waitFor(() => expect(rows()).toHaveLength(7));
    expect(rowNames()).toEqual([
      'Long box',
      'Black & Green',
      'Red & Gold',
      'Lands',
      'Rares binder',
      'Staples binder',
      'Trade binder',
    ]);
  });

  it('shows the picked location with its tile and path', async () => {
    mockApi();
    render(withProviders(<Picker placeholder="Pick a box" />));
    const trigger = screen.getByRole('combobox', { name: 'Where' });
    expect(trigger.textContent).toBe('Pick a box');
    openPicker();
    await waitFor(() => expect(rows()).toHaveLength(11));
    fireEvent.click(rows()[3]);

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toBe('Long box › Red & Gold');
    const tile = trigger.querySelector('[data-location-type]') as HTMLElement;
    expect(tile.style.backgroundColor).toBe('rgb(59, 111, 216)');
  });
});

function renderDialog(props: Partial<MoveToDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onMoved = vi.fn();
  render(
    withProviders(
      <MoveToDialog
        open
        onOpenChange={onOpenChange}
        onMoved={onMoved}
        stacks={[sampleStacks.elementalMascot]}
        {...props}
      />,
    ),
  );
  return { onOpenChange, onMoved };
}

const moveButton = () => screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement;
const quantityField = () => screen.queryByLabelText('Quantity') as HTMLInputElement | null;
const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST');

async function pickDestination(name: string) {
  openPicker('Destination');
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  const row = rows().find((option) => option.textContent === name);
  if (!row) {
    throw new Error(`No row named ${name}`);
  }
  fireEvent.click(row);
}

describe('MoveToDialog', () => {
  it('moves a whole stack by default and shows the undo bar', async () => {
    const calls = mockApi();
    const { onOpenChange, onMoved } = renderDialog();
    expect(screen.getByText('4 copies of Elemental Mascot in Bulk tray')).toBeTruthy();
    expect(quantityField()?.value).toBe('4');
    expect(moveButton().disabled).toBe(true);

    await pickDestination('Hearthhull deck box');
    fireEvent.click(moveButton());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        url: '/api/moves',
        body: { moves: [{ stackId: 106, quantity: 4 }], toLocationId: 9 } satisfies MoveCopiesBody,
      },
    ]);
    expect(onMoved).toHaveBeenCalledWith(moveResultSample);
    const bar = screen.getByRole('status');
    expect(bar.textContent).toContain(moveResultSample.message);
    expect(within(bar).getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('moves part of a stack', async () => {
    const calls = mockApi();
    renderDialog();
    await pickDestination('Lands');
    fireEvent.change(quantityField() as HTMLInputElement, { target: { value: '1' } });
    fireEvent.click(moveButton());
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      moves: [{ stackId: 106, quantity: 1 }],
      toLocationId: 5,
    });
  });

  it('will not move more copies than the stack holds, or none', async () => {
    mockApi();
    renderDialog();
    await pickDestination('Lands');
    expect(moveButton().disabled).toBe(false);
    fireEvent.change(quantityField() as HTMLInputElement, { target: { value: '5' } });
    expect(moveButton().disabled).toBe(true);
    fireEvent.change(quantityField() as HTMLInputElement, { target: { value: '0' } });
    expect(moveButton().disabled).toBe(true);
  });

  it('moves several whole stacks with no quantity field', async () => {
    const calls = mockApi(() => Response.json(moveManyResultSample));
    renderDialog({ stacks: [sampleStacks.commandTower, sampleStacks.blechFoil] });
    expect(screen.getByText('2 stacks, 4 cards')).toBeTruthy();
    expect(quantityField()).toBeNull();
    await pickDestination('Rares binder');
    fireEvent.click(moveButton());
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      moves: [
        { stackId: 105, quantity: 3 },
        { stackId: 104, quantity: 1 },
      ],
      toLocationId: 6,
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(moveManyResultSample.message),
    );
  });

  it('leaves out where the copies already are', async () => {
    mockApi();
    renderDialog();
    openPicker('Destination');
    await waitFor(() => expect(rows()).toHaveLength(10));
    expect(rowNames()).not.toContain('Bulk tray');
  });

  it('shows the message when a copy has moved, and stays open', async () => {
    mockApi(() => Response.json(staleCopyErrorSample, { status: 409 }));
    const { onOpenChange, onMoved } = renderDialog();
    await pickDestination('Lands');
    fireEvent.click(moveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This copy has moved, pick another',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
  });
});
