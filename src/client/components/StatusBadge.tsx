import { CircleCheck, CircleX, Layers, type LucideIcon, MapPin, Package } from 'lucide-react';
import type { SlotStatus } from '../../shared/api/common';
import { cn } from '../lib/utils';

/**
 * How each slot status looks. Always the word and the icon with the color, never color alone.
 * The `fill` colors (for bars and dots) are Tailwind colors too, such as `bg-status-in-box-fill`.
 */
export const slotStatusLook: Record<SlotStatus, { word: string; icon: LucideIcon; color: string }> =
  {
    in_box: {
      word: 'In deck box',
      icon: CircleCheck,
      color: 'bg-status-in-box-soft text-status-in-box',
    },
    free: { word: 'Free', icon: MapPin, color: 'bg-status-free-soft text-status-free' },
    other_decks: {
      word: 'In other deck',
      icon: Package,
      color: 'bg-status-other-decks-soft text-status-other-decks',
    },
    missing: {
      word: 'Missing',
      icon: CircleX,
      color: 'bg-status-missing-soft text-status-missing',
    },
    rune: { word: 'Rune', icon: Layers, color: 'bg-status-rune-soft text-status-rune' },
  };

/** A slot's status as a small pill: icon, word and color. */
export function StatusBadge({ status, className }: { status: SlotStatus; className?: string }) {
  const { word, icon: Icon, color } = slotStatusLook[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-bold text-xs',
        color,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
      {word}
    </span>
  );
}
