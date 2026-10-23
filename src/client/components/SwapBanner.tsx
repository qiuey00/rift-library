import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { Link } from 'react-router';
import type { Id } from '../../shared/api/common';
import { fetchSwap, swapQueryKey } from './swap-list/api';
import { Button } from './ui/button';

/**
 * The deck page's banner for a swap list waiting to be done: "List changed: 3 to take out,
 * 4 to pull in", with a button to the swap list. It is worked out from the server's swap list
 * each time, and shows only while that list has copies to take out.
 */
export function SwapBanner({ deckId }: { deckId: Id }) {
  const swap = useQuery({
    queryKey: swapQueryKey(deckId),
    queryFn: () => fetchSwap(deckId),
    retry: false,
  });
  const counts = swap.data?.counts;
  if (!counts || counts.takeOut === 0) return null;

  return (
    <div
      role="status"
      aria-label="Swap list"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#c9d6f5] bg-[#e8eefc] px-4 py-3 text-[#1b3f9c] shadow-[0_1px_2px_rgba(20,24,33,0.04)]"
    >
      <span className="flex items-center gap-2.5 font-semibold">
        <ArrowLeftRight aria-hidden="true" className="size-4 shrink-0" />
        List changed: {counts.takeOut} to take out, {counts.pullIn} to pull in
      </span>
      <Button asChild>
        <Link to={`/decks/${deckId}/swap`}>Open swap list</Link>
      </Button>
    </div>
  );
}
