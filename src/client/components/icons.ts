import { createLucideIcon } from 'lucide-react';

// Icons the design canvas drew that Lucide doesn't have, in Lucide's style so they sit with it.

/** An open tray, for tray locations. */
export const TrayIcon = createLucideIcon('tray', [
  ['path', { d: 'M22 12h-6l-2 3h-4l-2-3H2', key: 'tray-lip' }],
  ['path', { d: 'M2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6', key: 'tray-base' }],
]);

/** A circle split down the middle, for partly assembled decks. */
export const HalfCircleIcon = createLucideIcon('half-circle', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'half-circle-ring' }],
  ['path', { d: 'M12 2v20', key: 'half-circle-split' }],
]);
