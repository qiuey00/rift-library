// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MoxfieldExportDialog,
  type MoxfieldExportSource,
} from '../../../src/client/components/MoxfieldExportDialog';
import {
  hearthhullMoxfieldExportSample,
  hearthhullPlainMoxfieldExportSample,
  tradeBinderMoxfieldExportSample,
} from '../../../src/shared/api/samples/exports';

// The dialog with the export routes mocked from the samples: the Hearthhull deck (id 1) and the
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
        return Response.json(tradeBinderMoxfieldExportSample);
      }
      const plain = url.searchParams.get('tags') === '0' && url.searchParams.get('maybe') === '0';
      return Response.json(
        plain ? hearthhullPlainMoxfieldExportSample : hearthhullMoxfieldExportSample,
      );
    }),
  );
  return urls;
}

function mockClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

const deck: MoxfieldExportSource = { kind: 'deck', deckId: 1, deckName: 'Hearthhull' };
const binder: MoxfieldExportSource = {
  kind: 'location',
  locationId: 12,
  locationName: 'Trade binder',
  forTrade: true,
};

function renderDialog(source: MoxfieldExportSource) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MoxfieldExportDialog open onOpenChange={() => {}} source={source} />
    </QueryClientProvider>,
  );
}

const text = () => screen.getByLabelText('Moxfield text') as HTMLTextAreaElement;
const checkbox = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const download = () => screen.getByRole('link', { name: 'Download .txt' }) as HTMLAnchorElement;

describe('MoxfieldExportDialog', () => {
  it('shows a deck with tags and the maybe board, commander first', async () => {
    const urls = mockApi();
    renderDialog(deck);
    expect(screen.getByRole('heading', { name: 'Export Hearthhull to Moxfield' })).toBeTruthy();
    expect(
      await screen.findByText('95 cards and 5 on the maybe board · commander first'),
    ).toBeTruthy();
    expect(urls).toEqual(['/api/exports/decks/1/moxfield?tags=1&maybe=1']);
    expect(text().value).toBe(hearthhullMoxfieldExportSample.text);
    expect(text().readOnly).toBe(true);
    expect(checkbox('Include tags').checked).toBe(true);
    expect(checkbox('Include maybe board').checked).toBe(true);
    expect(screen.getByText(/Each card uses the printing you picked/)).toBeTruthy();
    expect(download().getAttribute('href')).toBe(
      '/api/exports/decks/1/moxfield.txt?tags=1&maybe=1',
    );
  });

  it('fetches again with the options and points Download at the same options', async () => {
    const urls = mockApi();
    renderDialog(deck);
    await screen.findByText(/on the maybe board/);
    fireEvent.click(checkbox('Include tags'));
    await waitFor(() => expect(urls).toContain('/api/exports/decks/1/moxfield?tags=0&maybe=1'));
    expect(download().getAttribute('href')).toBe(
      '/api/exports/decks/1/moxfield.txt?tags=0&maybe=1',
    );
    fireEvent.click(checkbox('Include maybe board'));
    await screen.findByText('95 cards · commander first');
    expect(urls.at(-1)).toBe('/api/exports/decks/1/moxfield?tags=0&maybe=0');
    expect(text().value).toBe(hearthhullPlainMoxfieldExportSample.text);
    expect(download().getAttribute('href')).toBe(
      '/api/exports/decks/1/moxfield.txt?tags=0&maybe=0',
    );
  });

  it('copies the text and reads Copied until an option changes', async () => {
    mockApi();
    const writeText = mockClipboard();
    renderDialog(deck);
    await screen.findByText(/on the maybe board/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(hearthhullMoxfieldExportSample.text);
    fireEvent.click(checkbox('Include maybe board'));
    expect(await screen.findByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('shows a trade binder with its Trade tag and no options', async () => {
    const urls = mockApi();
    const writeText = mockClipboard();
    renderDialog(binder);
    expect(screen.getByRole('heading', { name: 'Export Trade binder to Moxfield' })).toBeTruthy();
    expect(screen.getByText('Trade', { exact: true })).toBeTruthy();
    expect(
      await screen.findByText('86 cards in 10 lines · one line per printing and finish'),
    ).toBeTruthy();
    expect(urls).toEqual(['/api/exports/locations/12/moxfield']);
    expect(text().value).toBe(tradeBinderMoxfieldExportSample.text);
    expect(screen.queryByLabelText('Include tags')).toBeNull();
    expect(screen.getByText(/Proxies are left out/)).toBeTruthy();
    expect(download().getAttribute('href')).toBe('/api/exports/locations/12/moxfield.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith(tradeBinderMoxfieldExportSample.text);
  });

  it('shows no Trade tag for a location that is not for trade', async () => {
    mockApi();
    renderDialog({ kind: 'location', locationId: 3, locationName: 'Staples binder' });
    await screen.findByText(/one line per printing and finish/);
    expect(screen.getByRole('heading', { name: 'Export Staples binder to Moxfield' })).toBeTruthy();
    expect(screen.queryByText('Trade', { exact: true })).toBeNull();
  });

  it("shows the server's error inside the dialog", async () => {
    mockApi(true);
    renderDialog(deck);
    expect((await screen.findByRole('alert')).textContent).toBe('This deck no longer exists.');
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
