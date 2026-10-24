# Rift Library

A local web app that tracks where every physical Riftbound card is, and builds and takes apart decks from those locations. It runs only on Jeff's computer: one Node server on 127.0.0.1:4300 serves the screens and the API. It starts from a copy of the [library-of-gathering-v2](https://github.com/qiuey00/library-of-gathering-v2) code (D-2). The design is in `docs/technical-design.md`, and the product docs (PRD, UI Design, decisions, glossary) are in `docs/prd/`; see `docs/README.md`.

ManaBox, Moxfield and Scryfall are gone (#3): the app starts with empty card tables and no outside card source until the Riftcodex sync (#7). The Riftbound schema is in (#5): cards, printings and card data status tables, the seven boards, runes in place of basic lands and the Legend in place of the commander. Deck checks answer no warnings until #16. Quick add refuses a finish the printing doesn't come in, and removing copies by hand (COL-13) is in (#10). The rest of the build is listed in the tracking issue, [#27](https://github.com/qiuey00/rift-library/issues/27).

## Docs

The files in `docs/` are the source (D-41): there is no Claude artifact behind them. When behavior changes, update the doc in the same pull request as the code, so the docs never drift from the app.

## Stack

TypeScript (strict) on Node.js 24. Screens: React built with Vite. Server: Hono on Node. Shared Zod schemas. Biome, Vitest, Playwright (Chromium only).

## Layout

```
src/shared/api/          one schema file per area, plus common.ts
src/shared/api/samples/  typed sample responses per area
src/server/app.ts        the API: every route module, chained, and AppType
src/server/server.ts     serves the API and the built screens on 127.0.0.1:4300
src/server/routes/       one file per area
src/server/services/     the rules (one database transaction per action)
src/server/queries/      worked-out values
src/server/riftcodex/    card data from Riftcodex (the sync arrives with #7)
src/server/db/           Drizzle schema and migrations
src/client/api.ts        the typed API client
src/client/router.tsx    every screen address, inside the app frame
src/client/routes/       one file per screen
src/client/components/   the frame, shared pieces and placeholder components
src/client/components/ui/  shadcn/ui parts
src/client/styles.css    Tailwind, the look's colors and the fonts
tests/unit/              Vitest
tests/e2e/               Playwright
tests/fixtures/          made-up card data and a collection for the browser tests
data/                    the database and downloads (not in git)
docs/                    technical design, PRD and UI docs (the source)
```

## Scripts

- `npm run dev`: screens on http://localhost:5173 with hot reload, `/api` passed to the server, which restarts on change.
- `npm start`: build the screens, then serve the app at http://localhost:4300.
- `npm run build`: build the screens into `dist/client`.
- `npm test`: unit tests. `npm run test:e2e`: browser tests (it runs `npm start` itself; first run `npx playwright install chromium`).
- `npm run db:generate`: after changing `src/server/db/schema.ts`, write the migration into `src/server/db/migrations` (commit it). The server applies migrations when it starts.
- `npm run lint` (`biome check`; `npm run lint:fix` fixes formatting and imports), `npm run typecheck` (`tsc --noEmit`).

Scripts must work on macOS and Windows: no `rm -rf`, no `FOO=bar cmd`, build paths with `path.join`.

## API conventions

- JSON in and out, all under `/api`.
- Errors use the HTTP status plus `{ "error": { "code": string, "message": string } }` (`ErrorBody`). The message is written for Jeff, such as "This copy has moved, pick another". Throw `new AppError(status, code, message)` from `src/server/errors.ts`; anything else becomes a 500 `internal_error`.
- App ids are numbers, card ids included (`cards.id`, `cardId`). Printing ids are Riftcodex's ids, as strings (`printings.riftcodex_id`, which `printingId` and `copy_stacks.printing_id` point at). Path and query ids arrive as text: check them with `IdParam`.
- `Finish` is `normal` or `foil`. `Board` is one of the seven boards: `legend`, `champion` (the Chosen Champion), `main`, `battlefield`, `rune`, `sideboard` and `maybe`. A rune slot's `SlotStatus` is `rune`: runes are always available and never tracked as copies (D-15).
- `GET /api/cards?q=` matches the start of any word of a card name, or a public code (such as `OGN-042`, `ogn-42` or `ogn-042/298`); `type`, `supertype`, `domains`, `championTag` and `deckable=1` narrow it.
- Every request body, query and path param is checked with Zod through `validate(target, schema)` from `src/server/validate.ts` (a wrapper over `@hono/zod-validator` that answers 400 `invalid_request` in the error shape).
- Shared schemas used by every area are in `src/shared/api/common.ts`: `Finish`, `LocationType`, `Board`, `SlotStatus`, `DeckState`, `ErrorBody`, `CardSummary`, `PrintingSummary`, `LocationRef`, `CopyDetails`, `StackRow`, `ActionResult`, `Id`, `IdParam`. Each schema has a type of the same name.
- Area contracts (separate issues) define each area's schemas in `src/shared/api/<area>.ts`, typed samples in `src/shared/api/samples/<area>.ts`, and route handlers that return the samples, each marked `// STUB until #N`. The server issue for that area replaces the stub with real logic.
- Screen tests mock the API with Playwright `page.route` using those samples, so screens never wait for their server. Server tests use a fresh in-memory database.

## Route modules

Each area is a `new Hono()` in `src/server/routes/<name>.ts`, mounted at `/api` in `src/server/app.ts`. All 15 are already registered, so an area issue edits only its own file. Write full paths under `/api` (for example `.get('/locations', ...)` answers `GET /api/locations`) and chain every route onto the instance (`new Hono().get(...).post(...)`) so `AppType` and the typed client in `src/client/api.ts` see it.

`card-data`, `cards`, `locations`, `copies`, `stacks`, `undo`, `history`, `decks`, `deck-checks`, `buy-list`, `pick-list`, `pulls`, `put-away`, `swap`, `exports`.

## Database

- SQLite file `<DATA_DIR>/library.db` (`DATA_DIR` defaults to `data/` in the app's folder; unit and browser tests point it at a temp folder). Opened with WAL and foreign keys on by `openDatabase` in `src/server/db/database.ts`, which also keeps the "To sort" inbox.
- Queries and services take a `Db` (the database or a transaction) as their first argument. Routes get the server's database with `getDb()`. Unit tests use `createTestDb()` from `src/server/db/test-db.ts` (and `setDb` it when calling routes).
- Location tree order, paths, inherited colors and descendants come from `src/server/queries/locations.ts`.

## Screens

- Tailwind CSS with shadcn/ui parts (Radix underneath), Lucide icons, React Router, TanStack Query. Add shadcn parts with `npx shadcn@latest add <name>` (it reads `components.json` and writes to `src/client/components/ui/`), then point any `cn` import at `@/lib/utils` and re-apply the app's look: buttons and fields are 40 px tall with `rounded-lg`, panels, dialogs and menus use `bg-card`/`bg-popover` with the soft shadow. `@/` means `src/client` (tsconfig, Vite and Vitest). Keep each part's shadcn code otherwise unchanged, so later `add --diff` shows only the look.
- Colors are Tailwind colors defined in `src/client/styles.css`: `primary` is the accent blue, `background` the page, `card` the panels, `border` the panel border, `top-bar`, and `status-<status>` (text, hyphenated, such as `status-other-decks`), `-fill` (bars, dots) and `-soft` (badge background) for each slot status, and `trade` (with `trade-soft`) for the Trade tag on anything marked for trade. Fonts (`font-sans`, `font-serif` for titles) are bundled, so nothing loads from the network. Domains show with `DomainIcon` and `DomainIcons` (the six icons from the UI canvas, as inline SVGs with the domain's name), and sets show as their code, such as OGN.
- Shared pieces: `Panel`, `StatusBadge`, `StatePill`, `ProxyTag`, `LocationTile`, and `useUndoBar().show({ message, batchId })` after any action that moves copies.
- Each screen and placeholder component already exists with its props; an issue replaces its own file's body. Placeholders say "Coming soon".
- Component tests are Vitest files under `tests/unit/client/` that start with `// @vitest-environment jsdom` and call `cleanup` after each test.

## Rules

- Rules live in `src/server/services` and run in one database transaction per action.
- Screens only show what the server returns; they never work out rules themselves.
- The server listens on 127.0.0.1 only, so no other device can reach it (there is no sign-in).
- Code uses the product's words: copy stack, location, "to sort" inbox, deck box, came-from location, slot, picked printing, printing hint, pick list, put-away list, swap list, movement, batch.
- Pull requests must pass lint, typecheck, unit and e2e tests. The Checks workflow (`.github/workflows/checks.yml`) runs all of them on macOS and the unit tests on Windows; a pull request is ready to merge once both jobs pass.
