import { Outlet, ScrollRestoration } from 'react-router';
import { CardDataProgress } from './CardDataProgress';
import { TopBar } from './TopBar';
import { UndoBarProvider } from './UndoBar';

/** The frame every screen sits in: the top bar, the screen, and the undo bar. */
export function AppFrame() {
  return (
    <UndoBarProvider>
      <a
        href="#main"
        className="sr-only rounded-lg bg-card px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to the screen
      </a>
      <TopBar />
      <CardDataProgress />
      <main id="main" className="pb-24">
        <Outlet />
      </main>
      <ScrollRestoration />
    </UndoBarProvider>
  );
}
