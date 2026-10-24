// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AddToBuyListDialog,
  type AddToBuyListDialogProps,
} from '../../../src/client/components/AddToBuyListDialog';
import { UndoBarProvider } from '../../../src/client/components/UndoBar';
import type { NewBuyItem } from '../../../src/shared/api/buy-list';
import { buyItemSample } from '../../../src/shared/api/samples/buy-list';
import { emberSignetDetails, emberSignetPrintings } from '../../../src/shared/api/samples/cards';

// The dialog with the API mocked from the samples: Ember Signet and its three printings.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cardId = emberSignetDetails.card.id;

type Call = { url: string; method: string; body: unknown };

function mockApi(post: () => Response = () => Response.json(buyItemSample, { status: 201 })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), 'http://127.0.0.1:4300'), init);
      const body = request.method === 'GET' ? undefined : await request.json();
      calls.push({ url: new URL(request.url).pathname, method: request.method, body });
      if (request.method === 'GET') {
        return Response.json(emberSignetDetails);
      }
      return post();
    }),
  );
  return calls;
}

function renderDialog(props: Partial<AddToBuyListDialogProps> = {}) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UndoBarProvider>
        <AddToBuyListDialog open onOpenChange={onOpenChange} cardId={cardId} {...props} />
      </UndoBarProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const addButton = () => screen.getByRole('button', { name: 'Add' });
const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST');

describe('AddToBuyListDialog', () => {
  it('shows the card with its printings, defaulting to any printing and one copy', async () => {
    const calls = mockApi();
    renderDialog();
    expect(await screen.findByText('Ember Signet')).toBeTruthy();
    expect(calls[0]).toMatchObject({ method: 'GET', url: `/api/cards/${cardId}` });
    expect(field('Quantity').value).toBe('1');
    const printing = field('Printing') as unknown as HTMLSelectElement;
    expect(printing.value).toBe('');
    expect([...printing.options].map((option) => option.text)).toEqual([
      'Any printing',
      'Origins (OGN) #53',
      'Vendetta (VEN) #367',
      'Spiritforged Prerelease (SPD) #331',
    ]);
  });

  it('sends the card, quantity, printing and note', async () => {
    const calls = mockApi();
    const { onOpenChange } = renderDialog();
    await screen.findByText('Ember Signet');
    await waitFor(() => expect((addButton() as HTMLButtonElement).disabled).toBe(false));

    fireEvent.change(field('Quantity'), { target: { value: '2' } });
    fireEvent.change(field('Printing'), { target: { value: emberSignetPrintings[1].printingId } });
    fireEvent.change(field('Note'), { target: { value: 'Foil for Lux Control' } });
    fireEvent.click(addButton());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        url: '/api/buy-list',
        body: {
          cardId,
          quantity: 2,
          printingId: emberSignetPrintings[1].printingId,
          note: 'Foil for Lux Control',
        } satisfies NewBuyItem,
      },
    ]);
    expect(screen.getByRole('status').textContent).toContain(
      'Added 2 × Ember Signet to the buy list',
    );
  });

  it('starts from the quantity and printing it was opened with', async () => {
    const calls = mockApi();
    renderDialog({ quantity: 3, printingId: emberSignetPrintings[2].printingId });
    await screen.findByText('Ember Signet');
    expect(field('Quantity').value).toBe('3');
    expect(field('Printing').value).toBe(emberSignetPrintings[2].printingId);

    await waitFor(() => expect((addButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addButton());
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      cardId,
      quantity: 3,
      printingId: emberSignetPrintings[2].printingId,
    });
  });

  it('leaves out the printing and note when any printing will do', async () => {
    const calls = mockApi();
    renderDialog();
    await screen.findByText('Ember Signet');
    await waitFor(() => expect((addButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addButton());
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({ cardId, quantity: 1 });
  });

  it('will not add less than one copy', async () => {
    const calls = mockApi();
    renderDialog();
    await screen.findByText('Ember Signet');
    fireEvent.change(field('Quantity'), { target: { value: '0' } });
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(addButton());
    expect(posts(calls)).toHaveLength(0);
  });

  it('says why when the server refuses, and stays open', async () => {
    mockApi(() =>
      Response.json(
        { error: { code: 'card_not_found', message: 'This card is not in the card data' } },
        { status: 404 },
      ),
    );
    const { onOpenChange } = renderDialog();
    await screen.findByText('Ember Signet');
    await waitFor(() => expect((addButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This card is not in the card data',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
