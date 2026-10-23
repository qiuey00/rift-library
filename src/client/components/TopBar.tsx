import { Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { cn } from '../lib/utils';
import { InboxBadge } from './InboxBadge';
import { TopBarSearch } from './TopBarSearch';

/** The five screens in the top bar, in order. Deck pages count as Decks. */
const screens = [
  {
    to: '/',
    label: 'Decks',
    matches: (path: string) => path === '/' || path.startsWith('/decks/'),
  },
  { to: '/collection', label: 'Collection' },
  { to: '/locations', label: 'Locations', badge: <InboxBadge /> },
  { to: '/buy-list', label: 'Buy list' },
  { to: '/history', label: 'History' },
];

const isAt = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

/**
 * The dark bar across the top of every screen. Laid out for 1280 px and wider; narrower,
 * it wraps onto two lines rather than scroll sideways.
 */
export function TopBar() {
  const { pathname } = useLocation();

  return (
    <header className="flex flex-wrap items-center gap-5 bg-top-bar px-6 py-2.5 text-[#f1f2f5]">
      <Link to="/" className="flex items-center gap-2.5 text-white">
        <Logo />
        <span className="whitespace-nowrap font-serif text-[23px]">Rift Library</span>
      </Link>

      <nav aria-label="Main" className="flex flex-wrap gap-0.5">
        {screens.map((screen) => {
          const active = screen.matches ? screen.matches(pathname) : isAt(pathname, screen.to);
          return (
            <Link
              key={screen.to}
              to={screen.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-[7px] rounded-[7px] px-3 py-2 hover:bg-top-bar-hover hover:text-white',
                active
                  ? 'bg-top-bar-raised font-semibold text-white'
                  : 'font-medium text-top-bar-text',
              )}
            >
              {screen.label}
              {screen.badge}
            </Link>
          );
        })}
      </nav>

      {/* Below 1280 px the search box takes a second line of its own. */}
      <div className="ml-auto flex max-w-[500px] flex-[1_1_260px] max-xl:order-last max-xl:max-w-none max-xl:basis-full">
        <TopBarSearch />
      </div>

      <div className="flex items-center gap-2 max-xl:ml-auto">
        <Link
          to="/settings"
          aria-label="Settings"
          aria-current={isAt(pathname, '/settings') ? 'page' : undefined}
          className="flex size-[38px] items-center justify-center rounded-lg text-top-bar-text hover:bg-top-bar-hover hover:text-white aria-[current=page]:bg-top-bar-raised aria-[current=page]:text-white"
        >
          <Settings aria-hidden="true" className="size-[18px]" />
        </Link>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect
        x="4"
        y="6"
        width="12"
        height="17"
        rx="2"
        transform="rotate(-12 10 14.5)"
        fill="#3c6fe0"
      />
      <rect
        x="11"
        y="4"
        width="12"
        height="17"
        rx="2"
        transform="rotate(9 17 12.5)"
        fill="#f1f2f5"
        stroke="#161922"
        strokeWidth="1.5"
      />
      <path d="M17 8.6l2.1 3.7-2.1 3.7-2.1-3.7z" fill="#161922" />
    </svg>
  );
}
