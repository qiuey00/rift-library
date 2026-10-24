// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeckListExportDialog,
  type DeckListExportSource,
} from '../../../src/client/components/DeckListExportDialog';
import {
  deckExportSample,
  deckPlainExportSample,
  locationExportSample,
} from '../../../src/shared/api/samples/deck-lists';

// The dialog with the export routes mocked from the samples: the Jinx Burn deck (id 1) and the
// Trade binder (location 12).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockApi(fail = false) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), 'http://127.0.0.1:4300'), init);
      const url = new URL(request.url);
      urls.push(url.pathname + url.search);
      if (fail) {
        return Response.json(
          { error: { code: 'not_found', message: 'This deck no longer exists.' } },
          { status: 404 },
        );
      }
      if (url.pathname.startsWith('/api/exports/locations/')) {
        return Response.json(locationExportSample);
      }
      const plain = url.searchParams.get('tags') === '0' && url.searchParams.get('maybe') === '0';
      return Response.json(plain ? deckPlainExportSample : deckExportSample);
    }),
  );
  return urls;
}

function mockClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

const deck: DeckListExportSource = { kind: 'deck', deckId: 1, deckName: 'Jinx Burn' };
const binder: DeckListExportSource = {
  kind: 'location',
  locationId: 12,
  locationName: 'Trade binder',
  forTrade: true,
};

function renderDialog(source: DeckListExportSource) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DeckListExportDialog open onOpenChange={() => {}} source={source} />
    </QueryClientProvider>,
  );
}

const text = () => screen.getByLabelText('Deck list text') as HTMLTextAreaElement;
const checkbox = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const download = () => screen.getByRole('link', { name: 'Download .txt' }) as HTMLAnchorElement;

describe('DeckListExportDialog', () => {
  it('shows a deck with its runes, tags and the maybe board', async () => {
    const urls = mockApi();
    renderDialog(deck);
    expect(screen.getByRole('heading', { name: 'Export Jinx Burn' })).toBeTruthy();
    expect(await screen.findByText('78 cards, 17 runes and 5 on the maybe board')).toBeTruthy();
    expect(urls).toEqual(['/api/exports/decks/1/deck-list?tags=1&maybe=1']);
    expect(text().value).toBe(deckExportSample.text);
    expect(text().readOnly).toBe(true);
    expect(checkbox('Include tags').checked).toBe(true);
    expect(checkbox('Include maybe board').checked).toBe(true);
    expect(screen.getByText(/Each card uses the printing you picked/)).toBeTruthy();
    expect(download().getAttribute('href')).toBe(
      '/api/exports/decks/1/deck-list.txt?tags=1&maybe=1',
    );
  });

  it('fetches again with the options and points Download at the same options', async () => {
    const urls = mockApi();
    renderDialog(deck);
    await screen.findByText(/on the maybe board/);
    fireEvent.click(checkbox('Include tags'));
    await waitFor(() => expect(urls).toContain('/api/exports/decks/1/deck-list?tags=0&maybe=1'));
    expect(download().getAttribute('href')).toBe(
      '/api/exports/decks/1/deck-list.txt?tags=0&maybe=1',
    );
    fireEvent.click(checkbox('Include maybe board'));
    await screen.findByText('78 cards and 17 runes');
    expect(urls.at(-1)).toBe('/api/exports/decks/1/deck-list?tags=0&maybe=0');
    expect(text().value).toBe(deckPlainExportSample.text);
    expect(download().getAttribute('href')).toBe(
      '/api/exports/decks/1/deck-list.txt?tags=0&maybe=0',
    );
  });

  it('copies the text and reads Copied until an option changes', async () => {
    mockApi();
    const writeText = mockClipboard();
    renderDialog(deck);
    await screen.findByText(/on the maybe board/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(deckExportSample.text);
    fireEvent.click(checkbox('Include maybe board'));
    expect(await screen.findByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('shows a trade binder with its Trade tag and no options', async () => {
    const urls = mockApi();
    const writeText = mockClipboard();
    renderDialog(binder);
    expect(screen.getByRole('heading', { name: 'Export Trade binder' })).toBeTruthy();
    expect(screen.getByText('Trade', { exact: true })).toBeTruthy();
    expect(
      await screen.findByText('7 cards in 4 lines · one line per printing and finish'),
    ).toBeTruthy();
    expect(urls).toEqual(['/api/exports/locations/12/deck-list']);
    expect(text().value).toBe(locationExportSample.text);
    expect(screen.queryByLabelText('Include tags')).toBeNull();
    expect(screen.getByText('Proxies are left out.')).toBeTruthy();
    expect(download().getAttribute('href')).toBe('/api/exports/locations/12/deck-list.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith(locationExportSample.text);
  });

  it('shows no Trade tag for a location that is not for trade', async () => {
    mockApi();
    renderDialog({ kind: 'location', locationId: 3, locationName: 'Staples binder' });
    await screen.findByText(/one line per printing and finish/);
    expect(screen.getByRole('heading', { name: 'Export Staples binder' })).toBeTruthy();
    expect(screen.queryByText('Trade', { exact: true })).toBeNull();
  });

  it("shows the server's error inside the dialog", async () => {
    mockApi(true);
    renderDialog(deck);
    expect((await screen.findByRole('alert')).textContent).toBe('This deck no longer exists.');
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
