import type { RouteObject } from 'react-router';
import { AppFrame } from './components/AppFrame';
import { BuyList } from './routes/BuyList';
import { Card } from './routes/Card';
import { Collection } from './routes/Collection';
import { Deck } from './routes/Deck';
import { DecksHome } from './routes/DecksHome';
import { History } from './routes/History';
import { Locations } from './routes/Locations';
import { NewDeck } from './routes/NewDeck';
import { NotFound } from './routes/NotFound';
import { PickList } from './routes/PickList';
import { PutAway } from './routes/PutAway';
import { Settings } from './routes/Settings';
import { SwapList } from './routes/SwapList';

/**
 * Every screen, each in its own file in ./routes, inside the app frame. Screen issues edit
 * their own file, never this list.
 */
export const routes: RouteObject[] = [
  {
    element: <AppFrame />,
    children: [
      { index: true, element: <DecksHome /> },
      { path: 'collection', element: <Collection /> },
      { path: 'locations', element: <Locations /> },
      { path: 'buy-list', element: <BuyList /> },
      { path: 'history', element: <History /> },
      { path: 'settings', element: <Settings /> },
      { path: 'cards/:oracleId', element: <Card /> },
      { path: 'decks/new', element: <NewDeck /> },
      { path: 'decks/:id', element: <Deck /> },
      { path: 'decks/:id/assemble', element: <PickList /> },
      { path: 'decks/:id/take-apart', element: <PutAway /> },
      { path: 'decks/:id/swap', element: <SwapList /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
