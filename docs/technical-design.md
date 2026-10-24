# Rift Library: Technical Design

Oct 23, 2026 · @Jeff

Part of the [Rift Library: PRD](prd/README.md). This doc decides how Rift Library gets built from [Library of Gathering's technical design](https://github.com/qiuey00/library-of-gathering-v2/blob/main/docs/technical-design.md) and code: what stays, the database tables, where card data and prices come from, and the build plan. Anything not mentioned here works as it does in Library of Gathering. Status: draft v0.1.

## Stack

The stack is Library of Gathering's, unchanged (D-2): TypeScript end to end on Node.js 24, React screens built with Vite, Tailwind CSS with shadcn/ui on Radix, TanStack Table, Virtual and Query, React Router, a Hono server, SQLite through better-sqlite3 and Drizzle, Zod schemas shared by both sides, Biome, Vitest and Playwright on Chromium. It runs on macOS first and Windows second, at http://localhost:4300, listening on 127.0.0.1 only.

| Part | Change from Library of Gathering |
| --- | --- |
| Icons and symbols | The Mana font and Keyrune are removed. Domains show through `DomainIcon` in `src/client/components/DomainIcon.tsx`, a colored dot with the domain's name until the six small SVGs are drawn, and sets show as their code. Lucide and the Instrument fonts stay. |
| File reading | stream-json and the Scryfall bulk reader are removed. Riftcodex and TCGCSV answer plain JSON, read with `fetch`. Papa Parse stays for the collection CSV export and a later CSV import. |
| Speed tests | `tests/speed`, `npm run seed:big`, `npm run test:speed` and `npm run test:speed:e2e` are removed (D-6). |

## Architecture

```mermaid
flowchart LR
  subgraph computer["Jeff's computer"]
    browser["Browser<br/>React screens"]
    server["Local server: Node and Hono<br/>routes, rules, card data sync"]
    db[("SQLite file<br/>data/library.db")]
  end
  subgraph internet["Internet"]
    riftcodex["Riftcodex API<br/>api.riftcodex.com"]
    tcgcsv["TCGCSV<br/>tcgcsv.com"]
    images["Card images<br/>Riot's image servers"]
  end
  browser -- "JSON over HTTP, localhost only" --> server
  server -- "one transaction per action" --> db
  server -- "daily sync" --> riftcodex
  server -- "daily prices" --> tcgcsv
  browser -- "card images" --> images
```

The screens talk only to the local server, except for card images, which the browser loads straight from the links Riftcodex gives (on Riot's `cmsassets.rgpub.io`). Only the server reads or writes the database and calls Riftcodex and TCGCSV. Everything works offline except images and the daily sync, and the app keeps using the card data it has.

## Database schema

Eleven tables in one SQLite file, written as Drizzle schema files and created by migrations. Library of Gathering's migrations are replaced by one fresh first migration, since there is no Riftbound data to carry over. App rows use whole-number ids, printings keep Riftcodex's ids, true or false is 0 or 1, times are UTC and money is whole US cents.

| Table | Columns | Keys and rules |
| --- | --- | --- |
| cards | id, name, name\_key (lower case, spaces collapsed), type (legend, unit, spell, gear, battlefield, rune, token or other), supertype (such as champion, signature or token), domains (a list), energy, might, power, champion\_tag, rules\_text, deckable (0 for tokens and other cards a deck can't hold) | Key: id. Unique on name\_key. Riftcodex has no card-level id, so printings are grouped into cards by name. |
| printings | riftcodex\_id, card\_id, riftbound\_id, public\_code (such as OGN-001/298), set\_code, set\_name, collector\_number, rarity, image\_url, artist, alternate\_art, overnumbered, signature, tcgplayer\_id, finishes (a list), price\_normal, price\_foil | Key: riftcodex\_id. Indexed on card\_id, on public\_code for search and deck lists, and on tcgplayer\_id for prices. |
| card\_data\_status | cards\_synced\_at, prices\_updated\_at, card\_count, printing\_count | One row. |
| locations | as in Library of Gathering, including color and for\_trade | At most one inbox, which can't be deleted. A location that still holds copies can't be deleted. |
| copy\_stacks | as in Library of Gathering, with printing\_id pointing at printings.riftcodex\_id and finish normal or foil | The same unique index is the merge rule. |
| decks | as in Library of Gathering | Each deck has its own deck box. |
| deck\_slots | id, deck\_id, card\_id, board (legend, champion, main, battlefield, rune, sideboard or maybe), quantity, picked\_printing\_id, hint\_public\_code, hint\_foil | One slot per card per board in a deck. Deleted with their deck. |
| deck\_slot\_tags | as in Library of Gathering | |
| movement\_batches | as in Library of Gathering, with kinds add, remove, pick list, put-away, swap, move and undo | The import kind goes with the imports table. |
| movements | as in Library of Gathering, with a reason for removals (sold, traded, lost or miscounted) | Never deleted. |
| buy\_list\_items | as in Library of Gathering, with card\_id and printing\_id | Only Jeff adds rows. |

Library of Gathering's imports and binder\_mappings tables are dropped with ManaBox and Moxfield. Worked-out values stay queries, never stored columns, as in Library of Gathering; the queries change only where boards and runes replace commander and basic lands.

## Card data from Riftcodex

All card names, printings, domains, types, champion tags and images come from Riftcodex (D-7, PLAT-3), a free API that needs no key. Riftbound has a few thousand printings, so the app reads the whole list each time instead of streaming a bulk file.

1. **Sync.** On the first start, and every 24 hours while the server runs, the server pages through `GET https://api.riftcodex.com/cards` and the sets list, about 100 records a request with a short pause between requests. Each record is checked with Zod; one that fails is skipped and counted instead of stopping the sync.
2. **Grouping.** Printings with the same name key become one card. The card's type, domains, numbers, champion tag (from Riftcodex's tags) and rules text come from its first printing that is not alternate art.
3. **Writing.** The new rows are written in one transaction, so the app stays usable and never shows a half-synced list. A sync adds and updates rows but never deletes a printing that a copy stack, slot or buy list item points to.
4. **Unknown cards.** When a pasted deck list names a card the app doesn't know, the server asks `GET /cards/name` with fuzzy matching, and anything still unknown is listed to fix or skip.
5. **Settings.** Settings shows when cards and prices were last updated, a Refresh card data button, and Riot's legal notice (PLAT-8).

This cloud environment can't reach Riftcodex or TCGCSV, so the sync is written and tested against saved sample responses in `tests/fixtures/riftcodex/` and `tests/fixtures/tcgcsv/`. Riftcodex's exact paging, page size and rate limits are checked from Jeff's computer before the Card data pull request is merged.

## Prices from TCGCSV

Prices are TCGplayer market prices (D-8, VAL-1), from TCGCSV's daily files, which it updates around 20:00 UTC. Riftbound is TCGCSV category 89.

1. Once a day, after the card sync, the server reads `GET https://tcgcsv.com/tcgplayer/89/groups` (one group per set, such as Origins, Spiritforged, Unleashed, Vendetta and Radiance, plus promos), then `GET https://tcgcsv.com/tcgplayer/89/<groupId>/prices` for each group.
2. Each price entry has a productId, a subTypeName (Normal or Foil) and a marketPrice in dollars. The server matches productId to a printing's tcgplayer\_id and stores the market price in whole cents as price\_normal or price\_foil, empty when there is none.
3. The subtypes that appear for a printing become its finishes. A printing with no price entries offers both normal and foil.
4. A stack's value is its quantity times the price for its finish, as in Library of Gathering; proxies and stacks with no price count as zero, and real copies with no price are counted.

## Deck lists

The deck list format waits for Jeff's samples (D-23). Until then the parser in `src/server/decklists/` reads and writes plain text in this shape, and is the one place to change when the samples arrive:

```
Legend:
1 <Legend name>
Champion:
1 <Chosen Champion name> OGN-123
Main:
3 <card name>
...
Battlefields:
1 <battlefield name>
...
Runes:
6 Fury Rune
6 Chaos Rune
Sideboard:
2 <card name>
Maybe:
1 <card name>
```
A line is a quantity, a card name and an optional public code. Names match the name key, then fuzzy matching through Riftcodex. Lines with no heading go to the main deck.

## Core operations

Every core operation keeps Library of Gathering's behavior and code: `moveCopies`, the pick list, pulls, change printing, change board, missing card, the put-away list, the swap list, delete and undo. The changes are in what counts:

| Action | Change |
| --- | --- |
| Pick list | Built from unfilled legend, champion, main, battlefield and sideboard slots. Rune slots close the list as counts per domain, where basic lands were. |
| Change board | Moves a card between the main deck, sideboard and maybe board (DECK-16). Moving between main and sideboard moves no copies; moving to the maybe board puts the copy on the swap list. |
| Deck checks | Rewritten in `src/server/queries/deck-checks.ts` for the rules in DECK-6. |
| Add and remove | Quick add writes one add batch per card added. Lowering or removing copies writes a remove batch with the reason and no to location (COL-13). |
| Card search | Matches the start of any word of a card name, ignoring case, or a public code with or without leading zeros and the set size (`OGN-042`, `ogn-42`, `ogn-042/298`). An exact public code comes first, then names starting with the text, then other word starts, then codes starting with the text. `type`, `supertype`, `domains`, `championTag` and `deckable` narrow it for deck building (FIND-1). |
| Drag a card in | Removed with `src/server/scryfall/drop.ts` (D-9). |

## What is removed from the copied code

| Removed | Where |
| --- | --- |
| Scryfall bulk load, daily check, lookups and drop parsing | `src/server/scryfall/` (replaced by `src/server/riftcodex/` and `src/server/tcgcsv/`) |
| ManaBox import and update | routes `manabox`, `manabox-update`; `src/server/services/imports/manabox*`; the ManaBox import dialog |
| Moxfield import, update and export | routes `moxfield`, `moxfield-update`; Moxfield parts of `exports`; `src/server/services/imports/moxfield*`; the MoxfieldImport screen and MoxfieldExportDialog |
| Binder mappings and the imports table | `src/server/db/schema.ts` |
| Commander rules | commander, partner and color identity code in `src/server/queries/deck-checks.ts` and the deck screens |
| Speed tests and the big seed | `tests/speed/` and their scripts |
| Mana and Keyrune fonts | `package.json`, `src/client/styles.css` |
| Jeff's ManaBox and Moxfield samples | `tests/fixtures/` |

One route module is added, `deck-lists` (paste, preview and create; update a deck), and the four ManaBox and Moxfield modules go, leaving 16. `card-data` keeps its name and serves the Riftcodex sync status and refresh. CLAUDE.md is rewritten for Rift Library in the Skeleton step.

## Build plan

The build is six steps, each one pull request in rift-library that leaves the app working (D-10 puts this docs pull request first).

| Step | What Jeff can do after it | Requirements |
| --- | --- | --- |
| 0. Docs | Read and approve Rift Library's PRD, UI design and this doc. | All |
| 1. Skeleton | Start the app: the v2 code, renamed to Rift Library, with ManaBox, Moxfield, Scryfall, Commander rules and speed tests removed, a fresh first migration, an empty card table, and the checks workflow passing. | PLAT-1, PLAT-2, PLAT-4, PLAT-8 |
| 2. Card data | Load Riftcodex cards on first start, search any card by name or public code, and open its card page with domain icons. | PLAT-3, FIND-1 |
| 3. Collection | Add cards with quick add, lower or remove copies, and filter the collection by domain, type and rarity. Jeff is asked again for a CSV sample here. | COL-5 to COL-8, COL-12, COL-13 |
| 4. Decks | Build a Riftbound deck with its seven boards, see the Riftbound deck checks, paste and export deck lists. Jeff is asked for sample deck lists here. | DECK-4 to DECK-16, CHG-1, EXP-1 |
| 5. Prices | See TCGplayer prices from TCGCSV and values everywhere Library of Gathering showed them. | VAL-1, VAL-2 |
| 6. Finish | Flow tests over the main journeys with Riftbound samples, and the design pass from the canvas. | — |

Locations, the pick list, put-away and swap lists, history and undo, the buy list, trade binders, tags and the CSV export come over working in step 1 and change only where steps 2 to 5 touch them.

## Risks

| Risk | What the design does about it |
| --- | --- |
| Riftcodex is one person's fan project and could stop or change | Each record is checked with Zod and the app keeps its loaded data. Scrydex (paid, with prices) is the fallback source, behind the same `src/server/riftcodex/` module. |
| Riftcodex can't be reached from the cloud environment where Claude works | Sync code is built against saved sample responses, and checked from Jeff's computer before merging. |
| Grouping by name merges two different cards that share a name | Riftbound names are unique per card today; the sync reports any name whose printings disagree on type or domains. |
| Riot's fan content rules change | The legal notice is in one place, and the app doesn't use Riot's API. |

## Open questions

- [ ] Should Library of Gathering's 4 migrations be replaced by one fresh first migration, as above? Default: yes, since there is no data to carry over.
- [ ] Is Scrydex an acceptable paid fallback if Riftcodex goes away? Default: decide only if it happens.
