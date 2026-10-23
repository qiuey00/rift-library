import { useEffect, useId } from 'react';
import { LocationPicker, useLocationTree } from '../LocationPicker';
import type { StepProps } from './draft';
import { ProxyOption } from './ProxyOption';

/** Step 2 for a file without binders: the one location every copy goes to. */
export function LocationStep({ draft, change }: StepProps) {
  const id = useId();
  const tree = useLocationTree();
  const nodes = tree.data?.nodes ?? [];
  const inbox = nodes.find((node) => node.type === 'inbox');

  // The "to sort" inbox until Jeff picks another location.
  useEffect(() => {
    if (draft.target === null && inbox) {
      change({ target: { id: inbox.id, name: inbox.name } });
    }
  }, [draft.target, inbox, change]);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <label htmlFor={id} className="font-bold text-[15px]">
          Where should the cards go?
        </label>
        <div className="max-w-[420px]">
          <LocationPicker
            id={id}
            value={draft.target?.id ?? null}
            onChange={(locationId) => {
              const node = nodes.find((n) => n.id === locationId);
              if (node) change({ target: { id: node.id, name: node.name } });
            }}
            excludeDeckBoxes
            placeholder="Pick where they go"
          />
        </div>
        <p className="text-[13px] text-muted-foreground">
          New cards usually start in To sort, ready to be put away.
        </p>
      </section>

      {draft.preview && !draft.preview.hasProxyColumn && (
        <ProxyOption
          checked={draft.allProxies}
          onChange={(allProxies) => change({ allProxies })}
          cardCount={draft.preview.cardCount}
        />
      )}
    </div>
  );
}
