// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AddCardDialog } from '../../../src/client/components/AddCardDialog';
import { UndoBarProvider } from '../../../src/client/components/UndoBar';
import { emberSignet, emberSignetDetails } from '../../../src/shared/api/samples/cards';
import { addCopiesResultSample } from '../../../src/shared/api/samples/copies';
import { locationTreeSample } from '../../../src/shared/api/samples/locations';

// The Add card dialog opened from a card and a location (as the card page and the Locations
// screen open it), with the API mocked from the samples.

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

function mockApi() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), 'http://127.0.0.1:4300'), init);
      const url = new URL(request.url).pathname;
      if (url === '/api/locations/tree') return Response.json(locationTreeSample);
      if (url === `/api/cards/${emberSignet.id}`) return Response.json(emberSignetDetails);
      calls.push({ url, body: request.method === 'GET' ? undefined : await request.json() });
      return Response.json(addCopiesResultSample);
    }),
  );
  return calls;
}

describe('AddCardDialog', () => {
  it('starts from the given card and location, skipping the search', async () => {
    const calls = mockApi();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UndoBarProvider>
          <AddCardDialog
            open
            onOpenChange={() => {}}
            defaultCardId={emberSignet.id}
            defaultLocationId={6}
          />
        </UndoBarProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('searchbox', { name: 'Card' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Location' }).textContent).toContain(
        'Rares binder',
      ),
    );
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(3));
    const add = screen.getByRole('button', { name: 'Add' });
    await waitFor(() => expect(add).not.toHaveProperty('disabled', true));
    fireEvent.click(add);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/api/stacks/add',
      body: expect.objectContaining({
        printingId: emberSignetDetails.printings[0]?.printingId,
        locationId: 6,
        quantity: 1,
      }),
    });
  });
});
