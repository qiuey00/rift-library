import { BookOpen, Box, Inbox, type LucideIcon, Package } from 'lucide-react';
import type { LocationType } from '../../shared/api/common';
import { cn } from '../lib/utils';
import { TrayIcon } from './icons';

const typeIcon: Record<LocationType, LucideIcon> = {
  binder: BookOpen,
  box: Box,
  deck_box: Package,
  tray: TrayIcon,
  inbox: Inbox,
};

const sizes = {
  sm: { tile: 'rounded-[5px] p-[3px]', icon: 14 },
  md: { tile: 'rounded-md p-1', icon: 16 },
  lg: { tile: 'rounded-[7px] p-[5px]', icon: 18 },
};

/**
 * A location's mark, shown wherever a location appears: its box or binder icon on a square
 * in the location's color, or grey with a dark icon when it has none. It sits next to the
 * location's name, so screen readers skip it.
 */
export function LocationTile({
  type,
  color,
  size = 'md',
  className,
}: {
  type: LocationType;
  /** The effective color, as on `LocationRef`, such as "#3b6fd8". */
  color: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const Icon = typeIcon[type];
  return (
    <span
      aria-hidden="true"
      data-location-type={type}
      className={cn(
        'inline-flex shrink-0',
        sizes[size].tile,
        color ? 'text-white' : 'bg-location-none text-status-free',
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      <Icon size={sizes[size].icon} strokeWidth={2} />
    </span>
  );
}
