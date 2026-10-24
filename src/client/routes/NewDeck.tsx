import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, X } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CardSearchResult } from '../../shared/api/cards';
import { ErrorBody } from '../../shared/api/common';
import { api } from '../api';
import { CardSearchPicker } from '../components/CardSearchPicker';
import { ComingSoonDialog } from '../components/ComingSoonDialog';
import { DomainIcons } from '../components/DomainIcon';
import { Panel } from '../components/Panel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { typeLine } from '../lib/card-text';

/** Starts a new deck (`/decks/new`): pick the Legend, its Chosen Champion and a name. */
export function NewDeck() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameId = useId();
  const [legend, setLegend] = useState<CardSearchResult | null>(null);
  const [champion, setChampion] = useState<CardSearchResult | null>(null);
  const [pasting, setPasting] = useState(false);
  /** Null while the name follows the Legend. */
  const [typedName, setTypedName] = useState<string | null>(null);

  const name = typedName ?? legend?.name ?? '';

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.decks.$post({
        json: {
          name: name.trim(),
          legendId: legend?.id ?? 0,
          ...(champion ? { championId: champion.id } : {}),
        },
      });
      if (!res.ok) {
        const body = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(body.success ? body.data.error.message : "Couldn't create the deck.");
      }
      return res.json();
    },
    onSuccess: (deck) => {
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate(`/decks/${deck.id}`);
    },
  });

  const pickLegend = (card: CardSearchResult | null) => {
    setLegend(card);
    setChampion(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-6 pt-8 pb-12">
      <div className="flex flex-col gap-1">
        <Link to="/" className="text-[13px] text-muted-foreground hover:underline">
          Decks ›
        </Link>
        <h1 className="font-serif text-[44px] leading-[1.05]">New deck</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-muted-foreground">
            Pick the Legend and its Chosen Champion, then add cards from the deck view.
          </p>
          <Button type="button" variant="outline" onClick={() => setPasting(true)}>
            <ClipboardPaste aria-hidden="true" />
            Paste a deck list
          </Button>
        </div>
      </div>
      <ComingSoonDialog title="Paste a deck list" open={pasting} onOpenChange={setPasting} />
      <Panel className="p-6">
        <form onSubmit={submit} aria-label="New deck" className="flex flex-col gap-5">
          {legend ? (
            <PickedCard label="Legend" card={legend} onRemove={() => pickLegend(null)} />
          ) : (
            <CardSearchPicker
              label="Legend"
              placeholder="Search Champion Legends"
              type="legend"
              onPick={pickLegend}
              autoFocus
            />
          )}

          {legend &&
            (champion ? (
              <PickedCard
                label="Chosen Champion"
                card={champion}
                onRemove={() => setChampion(null)}
              />
            ) : (
              <CardSearchPicker
                key={legend.id}
                label="Chosen Champion"
                placeholder={
                  legend.championTag
                    ? `Search ${legend.championTag} champion units`
                    : 'Search champion units'
                }
                type="unit"
                supertype="champion"
                championTag={legend.championTag ?? undefined}
                onPick={setChampion}
                autoFocus
              />
            ))}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="font-semibold">
              Deck name
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder="Named after the Legend"
            />
          </div>

          {create.isError && (
            <p role="alert" className="text-destructive text-sm">
              {create.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2.5">
            <Button asChild variant="outline">
              <Link to="/">Cancel</Link>
            </Button>
            <Button
              type="submit"
              disabled={legend === null || name.trim() === '' || create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function PickedCard({
  label,
  card,
  onRemove,
}: {
  label: string;
  card: CardSearchResult;
  onRemove: () => void;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <span className="font-semibold">{label}</span>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
        {card.imageUrl ? (
          <img
            src={card.imageUrl}
            alt=""
            className="h-14 w-10 shrink-0 rounded-[3px] object-contain"
          />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{card.name}</span>
          <span className="truncate text-[12px] text-muted-foreground">{typeLine(card)}</span>
        </span>
        <DomainIcons domains={card.domains} className="text-xs" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${card.name}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
