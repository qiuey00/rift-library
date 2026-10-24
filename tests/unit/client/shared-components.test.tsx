// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardCopiesSection } from '../../../src/client/components/CardCopiesSection';
import { CardDecksSection } from '../../../src/client/components/CardDecksSection';
import { DeckListExportDialog } from '../../../src/client/components/DeckListExportDialog';
import { InboxBadge } from '../../../src/client/components/InboxBadge';
import { LocationTile } from '../../../src/client/components/LocationTile';
import { Panel } from '../../../src/client/components/Panel';
import { ProxyTag } from '../../../src/client/components/ProxyTag';
import { StatePill } from '../../../src/client/components/StatePill';
import { StatusBadge } from '../../../src/client/components/StatusBadge';
import { DeckState, LocationType, SlotStatus } from '../../../src/shared/api/common';

afterEach(cleanup);

describe('StatusBadge', () => {
  const words: Record<SlotStatus, string> = {
    in_box: 'In deck box',
    free: 'Free',
    other_decks: 'In other deck',
    missing: 'Missing',
    rune: 'Rune',
  };

  it.each(SlotStatus.options)('shows %s as an icon, a word and a color', (status) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(words[status]);
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.className).toContain(`text-status-${status.replace('_', '-')}`);
  });
});

describe('StatePill', () => {
  it.each([
    ['not_assembled', 'Not assembled'],
    ['partly_assembled', 'Partly assembled'],
    ['assembled', 'Assembled'],
  ] as const)('shows %s as "%s" with an icon', (state, word) => {
    render(<StatePill state={state} />);
    expect(screen.getByText(word).querySelector('svg')).not.toBeNull();
  });

  it('covers every deck state', () => {
    for (const state of DeckState.options) {
      render(<StatePill state={state} />);
    }
    expect(document.querySelectorAll('[data-state]')).toHaveLength(DeckState.options.length);
  });
});

describe('ProxyTag', () => {
  it('is an outlined "Proxy" tag with a dashed border', () => {
    render(<ProxyTag />);
    const tag = screen.getByText('Proxy');
    expect(tag.className).toContain('border-dashed');
    expect(tag.className).toContain('border-proxy');
  });
});

describe('LocationTile', () => {
  it("fills the tile with the location's color behind a white icon", () => {
    const { container } = render(<LocationTile type="binder" color="#7c5cd6" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.backgroundColor).toBe('rgb(124, 92, 214)');
    expect(tile.className).toContain('text-white');
    expect(tile.querySelector('svg')?.getAttribute('class')).toContain('lucide-book-open');
  });

  it('is grey with a dark icon when the location has no color', () => {
    const { container } = render(<LocationTile type="box" color={null} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.backgroundColor).toBe('');
    expect(tile.className).toContain('bg-location-none');
    expect(tile.querySelector('svg')?.getAttribute('class')).toContain('lucide-box');
  });

  it('has an icon for every location type and stays out of the accessibility tree', () => {
    for (const type of LocationType.options) {
      const { container } = render(<LocationTile type={type} color={null} size="sm" />);
      const tile = container.firstElementChild as HTMLElement;
      expect(tile.getAttribute('aria-hidden')).toBe('true');
      expect(tile.querySelector('svg')).not.toBeNull();
    }
  });
});

describe('Panel', () => {
  it('wraps its content in a white panel with a border and 12px corners', () => {
    render(<Panel className="p-5">Inside</Panel>);
    const panel = screen.getByText('Inside');
    expect(panel.className).toContain('rounded-xl');
    expect(panel.className).toContain('border-border');
    expect(panel.className).toContain('bg-card');
    expect(panel.className).toContain('p-5');
  });
});

describe('placeholder components', () => {
  const noop = () => {};

  it('keeps a closed dialog out of the page', () => {
    render(
      <DeckListExportDialog
        open={false}
        onOpenChange={noop}
        source={{ kind: 'deck', deckId: 1, deckName: 'Jinx Burn' }}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the card page sections and leaves the badge empty until the tree loads', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CardCopiesSection cardId={1} />
        <CardDecksSection cardId={1} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Copies' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Decks using it' })).toBeDefined();

    const empty = render(
      <QueryClientProvider client={queryClient}>
        <InboxBadge />
      </QueryClientProvider>,
    );
    expect(empty.container.innerHTML).toBe('');
  });
});
