import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ErrorBody, type Id } from '../../shared/api/common';
import type { DeckView } from '../../shared/api/decks';
import { api } from '../api';
import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export type DeleteDeckDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: Id;
  deckName: string;
};

/** The error code DELETE /api/decks/:id answers while the deck box still holds copies. */
const NOT_EMPTY = 'deck_box_not_empty';

/**
 * Deletes a deck after one confirmation. A deck whose box holds copies goes to the put-away
 * list in delete mode first, which deletes the deck once the last card is back.
 */
export function DeleteDeckDialog({ open, onOpenChange, deckId, deckName }: DeleteDeckDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const takeApart = `/decks/${deckId}/take-apart?mode=delete`;

  // The same query as the deck view, so it is usually already loaded.
  const deck = useQuery({
    queryKey: ['decks', deckId],
    enabled: open,
    queryFn: async (): Promise<DeckView> => {
      const res = await api.decks[':id'].$get({ param: { id: String(deckId) } });
      if (!res.ok) throw new Error("Couldn't load this deck.");
      return res.json();
    },
  });
  const boxCopyCount = deck.data?.deck.boxCopyCount ?? 0;

  const remove = useMutation({
    mutationFn: async (): Promise<'deleted' | 'not_empty'> => {
      const res = await api.decks[':id'].$delete({ param: { id: String(deckId) } });
      if (res.ok) return 'deleted';
      const body = ErrorBody.safeParse(await res.json().catch(() => null));
      if (body.success && body.data.error.code === NOT_EMPTY) return 'not_empty';
      throw new Error(body.success ? body.data.error.message : "Couldn't delete the deck.");
    },
    onSuccess: (outcome) => {
      onOpenChange(false);
      if (outcome === 'not_empty') {
        navigate(takeApart);
        return;
      }
      queryClient.removeQueries({ queryKey: ['decks', deckId] });
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      navigate('/');
    },
  });

  const confirm = () => {
    if (boxCopyCount > 0) {
      onOpenChange(false);
      navigate(takeApart);
    } else {
      remove.mutate();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {deckName}?</DialogTitle>
          <DialogDescription>
            {boxCopyCount > 0
              ? `Its deck box holds ${boxCopyCount} ${boxCopyCount === 1 ? 'card' : 'cards'}. You'll put them away first, then the deck is deleted.`
              : 'The decklist and its deck box are deleted. No cards move.'}
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <p role="alert" className="m-0 text-sm text-status-missing">
            {remove.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={deck.isPending || remove.isPending}
          >
            {boxCopyCount > 0 ? 'Put cards away' : 'Delete deck'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
