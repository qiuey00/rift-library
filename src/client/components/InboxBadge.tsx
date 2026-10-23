import { useLocationTree } from './LocationPicker';

/** The number of copies in the "to sort" inbox, on the Locations link. Nothing when it's empty. */
export function InboxBadge() {
  const tree = useLocationTree();
  const inbox = tree.data?.nodes.find((node) => node.type === 'inbox');
  if (!inbox || inbox.cardCount === 0) return null;
  return (
    <span
      data-testid="inbox-badge"
      className="min-w-5 rounded-full bg-primary px-1.5 py-px text-center font-bold text-[11px] text-white"
    >
      {inbox.cardCount.toLocaleString('en-US')}
    </span>
  );
}
