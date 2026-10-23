// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UNDO_BAR_MS,
  type UndoBarInput,
  UndoBarProvider,
  useUndoBar,
} from '../../../src/client/components/UndoBar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A button that calls show() with each input in turn. */
function ShowButton({ inputs }: { inputs: UndoBarInput[] }) {
  const undoBar = useUndoBar();
  const next = useRef(0);
  return (
    <button
      type="button"
      onClick={() => {
        undoBar.show(inputs[Math.min(next.current, inputs.length - 1)]);
        next.current += 1;
      }}
    >
      Move
    </button>
  );
}

function renderBar(...inputs: UndoBarInput[]) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <UndoBarProvider>
        <ShowButton inputs={inputs} />
      </UndoBarProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  return { invalidate, bar: screen.getByRole('status') };
}

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body, { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('UndoBar', () => {
  it('shows what moved with an Undo button', () => {
    const { bar } = renderBar({ message: 'Moved 3 cards to Long box', batchId: 12 });
    expect(bar.textContent).toContain('Moved 3 cards to Long box');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined();
  });

  it('calls the undo route and shows the message it returns', async () => {
    const fetch = answer(200, { message: 'Put 3 cards back in Bulk tray', batchId: 13 });
    const { bar, invalidate } = renderBar({ message: 'Moved 3 cards to Long box', batchId: 12 });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(fetch).toHaveBeenCalledWith('/api/batches/12/undo', { method: 'POST' });
    await waitFor(() => expect(bar.textContent).toContain('Put 3 cards back in Bulk tray'));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows the server's error when the undo is refused", async () => {
    answer(409, {
      error: {
        code: 'copies_moved',
        message: 'These cards have moved since, so undo can’t put them back.',
      },
    });
    const { bar, invalidate } = renderBar({ message: 'Moved 1 card to Hearthhull', batchId: 5 });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() =>
      expect(bar.textContent).toContain(
        'These cards have moved since, so undo can’t put them back.',
      ),
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { bar } = renderBar({ message: 'Moved 1 card to Hearthhull', batchId: 5 });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(bar.textContent).toContain("Couldn't reach the server to undo"));
  });

  it('has no Undo button when there is nothing to undo', () => {
    const { bar } = renderBar({ message: 'Nothing moved', batchId: null });
    expect(bar.textContent).toContain('Nothing moved');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('closes after about 8 seconds', () => {
    vi.useFakeTimers();
    const { bar } = renderBar({ message: 'Moved 3 cards to Long box', batchId: 12 });

    act(() => vi.advanceTimersByTime(UNDO_BAR_MS - 100));
    expect(bar.textContent).toContain('Moved 3 cards');
    act(() => vi.advanceTimersByTime(200));
    expect(bar.textContent).toBe('');
  });

  it('stays open while the pointer is over it', () => {
    vi.useFakeTimers();
    const { bar } = renderBar({ message: 'Moved 3 cards to Long box', batchId: 12 });

    fireEvent.mouseEnter(bar.firstElementChild as Element);
    act(() => vi.advanceTimersByTime(UNDO_BAR_MS * 2));
    expect(bar.textContent).toContain('Moved 3 cards');

    fireEvent.mouseLeave(bar.firstElementChild as Element);
    act(() => vi.advanceTimersByTime(UNDO_BAR_MS));
    expect(bar.textContent).toBe('');
  });

  it('is replaced by the next show, which starts its own 8 seconds', () => {
    vi.useFakeTimers();
    const { bar } = renderBar(
      { message: 'Moved 3 cards to Long box', batchId: 12 },
      { message: 'Moved 1 card to Rares binder', batchId: 13 },
    );

    act(() => vi.advanceTimersByTime(UNDO_BAR_MS - 1000));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(bar.textContent).toContain('Moved 1 card to Rares binder');
    expect(bar.textContent).not.toContain('Long box');

    act(() => vi.advanceTimersByTime(UNDO_BAR_MS - 100));
    expect(bar.textContent).toContain('Rares binder');
  });

  it('closes with its Close button', () => {
    const { bar } = renderBar({ message: 'Moved 3 cards to Long box', batchId: 12 });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(bar.textContent).toBe('');
  });

  it('needs the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ShowButton inputs={[]} />)).toThrow(/UndoBarProvider/);
  });
});
