# Rift Library: Decisions

Oct 23, 2026 · @Jeff

Part of the [Rift Library: PRD](README.md). This is the log of every settled product choice, with the reason and where it was made. It starts fresh for Rift Library: decisions that still hold from [Library of Gathering: Decisions](https://github.com/qiuey00/library-of-gathering-v2/blob/main/docs/prd/decisions.md) are carried over with their old ID in the Source column ("LoG D-11"), and the Magic-only ones (LoG D-2, D-7, D-13 to D-20, D-22, D-47, D-49, D-56 to D-60) are not. Status: draft v0.1.

In the Source column, "Jeff" means Jeff answered it directly, mostly in comments on the [Rift Library port plan](https://claude.ai/artifact/ECcatVkan2AwaipP9GvryJ) on 2026-10-23, and "default" means Claude proposed it and it waits for Jeff's approval of this doc.

To change a decision, add a new entry and record the old one under Changed decisions, rather than editing it away. IDs stay fixed so other docs can point at them.

## Scope and platform

| ID | Decision | Why | Source |
| --- | --- | --- | --- |
| D-1 | Rift Library holds one person's collection, Jeff's, with no sharing or other accounts. | Jeff is the only user. | LoG D-1 |
| D-2 | Rift Library starts from a copy of the library-of-gathering-v2 code, with the same stack, and the Magic-only parts removed. Library of Gathering's MVP and Next release are both Rift Library's MVP, since they come over already built. | Most of the app doesn't depend on the game. | Jeff, 2026-10-23 |
| D-3 | No comparison with other Riftbound apps. They may still inspire a screen, and are named where they do. | Jeff doesn't need a competitive comparison. | Jeff, 2026-10-23 |
| D-4 | The app runs only on Jeff's own computer, with no hosting or sign-in. Hosting with a sign-in is Later (LATER-7). | Same as Library of Gathering. | LoG D-4 |
| D-5 | The app is a web app for desktop browsers. Phone use of the pick and put-away lists waits for hosting (PLAT-5). | Same as Library of Gathering. | LoG D-3, D-5 |
| D-6 | No speed tests and no made-up big collection to run them against. | Jeff asked to skip them for this app. | Jeff, 2026-10-23 |
| D-7 | Card data comes from Riftcodex (api.riftcodex.com), a free fan-run API that needs no key. Riot's official Riftbound API is not used: it needs an approved key, and Riot's policy lists apps with small personal audiences as unapproved. Rift Library shows Riot's legal notice (PLAT-8). | Riftcodex is the only free source with every printing, image and TCGplayer id. | Port plan, Jeff, 2026-10-23 |
| D-8 | Prices are TCGplayer market prices per printing and finish, from TCGCSV's free daily files (category 89), matched to printings by TCGplayer product id. Proxies are never counted in value. | Same price source as Library of Gathering (TCGplayer), without Scryfall. | Port plan, Jeff, 2026-10-23; LoG D-8, D-56 |
| D-9 | No ManaBox, Moxfield, Scryfall or EDHREC integration. | Magic-only services. | Jeff, 2026-10-23 |
| D-10 | The docs are rewritten for Riftbound first, in their own pull request, before any code is copied. | Jeff wants the docs settled first. | Jeff, 2026-10-23 |

## Collection and data model

| ID | Decision | Why | Source |
| --- | --- | --- | --- |
| D-11 | No stored reservations. A copy's physical location is the only truth. Deck demand is worked out and shown as a warning, and picking can pull a copy from another assembled deck as a recorded move. | Reservations add state that drifts away from the shelf. | LoG D-11 |
| D-12 | Each copy is in exactly one location at a time, and an assembled deck's box counts as a location. | Every move is one record and every search gives one answer. | LoG D-12 |
| D-13 | The collection is mostly added by hand through card search, so adding many cards in a row must be quick (COL-12). A CSV import waits until Jeff provides a sample file (COL-14). | Jeff has no ManaBox-style export for Riftbound, and may have a CSV later. | Jeff, 2026-10-23 |
| D-14 | Each copy stack is marked real or proxy. Proxies have locations, fill deck slots, appear on pick lists and count as owned when working out shortages. | Proxies sit in storage and deck boxes like real cards. | LoG D-21 |
| D-15 | Runes are always available, as basic lands were in Library of Gathering. They are not tracked as copies, never count toward demand or shortages, and show on the pick list as counts. | Jeff's answer. | Jeff, 2026-10-23 |
| D-16 | A decklist slot accepts any printing of its card, alternate art and signature printings included. When a copy is pulled, the slot takes that copy's printing. | Same as Library of Gathering. | LoG D-23 |
| D-17 | Decks that break Riftbound's deck rules are saved with warnings rather than blocked. | A deck in progress is often illegal for a while. | LoG D-24 |

## Locations

| ID | Decision | Why | Source |
| --- | --- | --- | --- |
| D-18 | Locations can nest and come in kinds: binder, box, deck box and tray. There is always a "to sort" inbox. | Same as Library of Gathering. | LoG D-25 |
| D-19 | A binder is tracked as a whole, not by page or slot. | Same as Library of Gathering. | LoG D-26 |
| D-20 | A trade binder is any binder or box marked For trade; its copies stay owned and keep their location. The pick list uses them only as a last choice, marked From trade binder. | Same as Library of Gathering. | LoG D-55 |

## Decks, assembly and teardown

| ID | Decision | Why | Source |
| --- | --- | --- | --- |
| D-21 | Riftbound constructed is the only format. A deck has a Legend, a Chosen Champion, a main deck of at least 40 cards (Chosen Champion included), 3 battlefields, 12 runes, an optional sideboard and a maybe board. The checks follow Riftbound's core rules 103.2 to 103.5. | Jeff plays Riftbound; one format keeps the checks simple. | Port plan, default |
| D-22 | The sideboard is optional per deck. Every deck also has a maybe board for cards Jeff is considering that aren't in the deck; it is never pulled, counted or checked. | Jeff's answer. | Jeff, 2026-10-23 |
| D-23 | Decks are built in the app or pasted as a deck list, and exported in the same format. The format follows samples Jeff will provide when the Decks step starts. | Jeff's answer. | Jeff, 2026-10-23 |
| D-24 | When several copies could fill a slot, the pick list suggests the decklist's printing first, then real before proxy, then a location already on the route. | Same as Library of Gathering. | LoG D-28 |
| D-25 | Ticking a pick-list line moves the copy into the deck right away. There is no saved picking session. | Same as Library of Gathering. | LoG D-29 |
| D-26 | Taking a deck apart sends each copy back to the spot it came from, with exceptions Jeff can mark before confirming. | Same as Library of Gathering. | LoG D-30 |
| D-27 | A copy that went from storage to deck B and then to deck A returns to its original storage spot, not to deck B. | Same as Library of Gathering. | LoG D-31 |
| D-28 | Copies with no known came-from spot go to the "to sort" inbox when a deck is taken apart. | Same as Library of Gathering. | LoG D-32 |
| D-29 | Sideboard cards are pulled into the deck box with the rest of the deck and count toward demand. | They travel with the deck. | Default |
| D-42 | The sideboard check warns when a sideboard has more than 10 cards. Copies of a card by name count across the Chosen Champion, main deck and sideboard together, and every sideboard card must fit the Legend's domains and signature tag like a main deck card. | Riot's Tournament Rules (last updated 2026-10-09), 601.1.c: "A player's sideboard can include 10 or fewer cards", limits on named copies "apply to the combination of main deck and sideboard", and a sideboard "can consist only of valid Main Deck cards". The January 2026 update had said 8. | Tournament Rules, checked 2026-10-24 |

## Buy list, history and screens

| ID | Decision | Why | Source |
| --- | --- | --- | --- |
| D-30 | There is one global buy list. Cards go on it only when Jeff adds them, never automatically from deck shortages. | Same as Library of Gathering. | LoG D-33 |
| D-31 | Every change of location is recorded as a move. Undo writes the reverse move instead of deleting history. | Same as Library of Gathering. | LoG D-35 |
| D-32 | Decks is the home screen. | Same as Library of Gathering. | LoG D-36 |
| D-33 | Card lists switch between text rows and card images, and text rows show the card image on hover. | Same as Library of Gathering. | LoG D-37 |
| D-34 | The screens are designed for a light theme first. | Same as Library of Gathering. | LoG D-38 |
| D-35 | There is no print view for the pick list or put-away list. | Same as Library of Gathering. | LoG D-39 |
| D-36 | Deck tags keep the spelling Jeff typed and match ignoring case, with spaces and hyphens the same, so "Card draw" and "card-draw" are one tag. | Same as Library of Gathering. | LoG D-60 |
| D-37 | The collection export is a CSV in Rift Library's own columns, one row per copy stack with the location path. If a CSV import arrives (COL-14), it reads this format too, so the export doubles as a backup. | No ManaBox format to borrow. | Default |

## How the docs are written

| ID | Decision | Why | Source |
| --- | --- | --- | --- |
| D-38 | The PRD is a hub doc that links a separate doc per area, and each doc links back to the hub. | Same as Library of Gathering. | LoG D-41 |
| D-39 | Jeff reviews by commenting. Questions for Jeff are checklists, and each question and its answer are ticked once the answer is used. | Same as Library of Gathering. | LoG D-42 |
| D-40 | A doc is marked approved (v1.0) only when Jeff says so. | Same as Library of Gathering. | LoG D-43 |
| D-41 | The docs live in the rift-library repository as the source, not as copies of Claude Docs. | One place to change them, in the same pull request as the code. | Default |

## Changed decisions

These replaced a Library of Gathering decision. The entry above always holds the current answer.

| What | Library of Gathering | Rift Library | Why it changed |
| --- | --- | --- | --- |
| Format | Commander only (LoG D-2) | Riftbound constructed only (D-21) | Different game |
| Card data | Scryfall bulk data (LoG D-7, D-56) | Riftcodex and TCGCSV (D-7, D-8) | Scryfall has no Riftbound cards |
| Collection import | ManaBox CSV (LoG D-13 to D-18, D-47, D-49) | By hand, CSV later (D-13) | No ManaBox for Riftbound |
| Deck import | Moxfield text (LoG D-13, D-19, D-20, D-58 to D-60) | Deck list text in Jeff's format (D-23) | No Moxfield for Riftbound |
| Always-available cards | Basic lands (LoG D-22) | Runes (D-15) | Runes play the same role |
| Speed | Quick at about 10,000 cards, with speed tests (LoG D-6) | No speed tests (D-6) | Jeff's answer |
