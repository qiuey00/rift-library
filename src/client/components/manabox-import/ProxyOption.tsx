import { plural } from './draft';

/** "These are all proxies", for an Add copies file without a Proxy column. Off unless ticked. */
export function ProxyOption({
  checked,
  onChange,
  cardCount,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  cardCount: number;
}) {
  return (
    <section
      aria-labelledby="manabox-proxy-title"
      className="flex items-start gap-3 rounded-[10px] border border-[#b9a8e6] border-dashed bg-[#faf8fe] px-3.5 py-3"
    >
      <span className="mt-0.5 rounded-full border border-[#7b61c4] border-dashed bg-card px-[7px] py-px font-bold text-[#5b3fa8] text-[11px]">
        Proxy
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 id="manabox-proxy-title" className="font-semibold text-sm">
          This file has no Proxy column
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            className="size-4 accent-[#7b61c4]"
          />
          These are all proxies
        </label>
        <span className="text-muted-foreground text-xs">
          {checked
            ? `All ${plural(cardCount, 'imported card')} will be marked as proxy.`
            : 'Leave this off unless every card in the file is a proxy.'}
        </span>
      </div>
    </section>
  );
}
