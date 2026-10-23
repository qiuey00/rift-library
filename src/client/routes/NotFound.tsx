import { Link } from 'react-router';
import { Panel } from '../components/Panel';

/** Any address that isn't a screen. */
export function NotFound() {
  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <h1 className="font-serif text-[44px] leading-[1.05]">Nothing here</h1>
      <Panel className="p-5">
        There is no screen at this address.{' '}
        <Link to="/" className="font-semibold text-primary hover:underline">
          Go to Decks
        </Link>
      </Panel>
    </div>
  );
}
