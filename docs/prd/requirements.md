# Rift Library: Requirements

Oct 23, 2026 · @Jeff

Part of the [Rift Library: PRD](README.md). Rewritten from [Library of Gathering: Requirements](https://github.com/qiuey00/library-of-gathering-v2/blob/main/docs/prd/requirements.md). IDs that carry over keep their number and meaning, so code and pull requests from either app can be compared. IDs dropped with ManaBox, Moxfield and Scryfall are listed at the end and are never reused. Sources are Rift Library's [Key Flows](key-flows.md), [Concepts and Data Model](concepts-and-data-model.md) and [Decisions](decisions.md). Status: draft v0.1.

Priority has three values. **MVP** is needed for the first release, **Next** follows right after it, and **Later** is not planned yet. Library of Gathering's MVP and Next release are both already built, so both are Rift Library's MVP (D-2).

## Collection

The collection is mostly added by hand, so adding copies has to be quick (D-13).

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| COL-5 | Add a card by search, by name or public code, with printing, quantity, finish, condition, language, real or proxy and location. | MVP | Flow 1 |
| COL-6 | Store per copy stack: printing, quantity, finish, condition, language, misprint, altered, real or proxy, and purchase price (kept, not shown). | MVP | Data model |
| COL-7 | Mark selected stacks as proxy or real. | MVP | Flow 1 |
| COL-8 | Search and filter the collection by name, set, domain, card type, rarity, finish, proxy, location and trade. | MVP | Data model |
| COL-9 | Save searches for reuse. | Next | LoG |
| COL-12 | Quick add: after a card is added, the search clears and keeps the location, and every other field starts at the last value used, so a run of cards needs only a name and Enter. | MVP | Flow 1, D-13 |
| COL-13 | Lower or remove copies by hand with a reason (sold, traded, lost, miscounted); removed copies get a movement with no to location. | MVP | Flow 8 |
| COL-14 | Import copies from a CSV file, in a format matched to a sample Jeff provides. | Next | D-13 |

## Locations

Locations mirror the real shelves, boxes and binders, and every copy sits in exactly one of them. Unchanged from Library of Gathering.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| LOC-1 | Always keep one "to sort" inbox that cannot be deleted. | MVP | Flow 1 |
| LOC-2 | Create, rename and nest locations, each with a type: binder, box, deck box or tray. | MVP | Flow 1 |
| LOC-3 | Track a binder as one location, with no pages or slots. | MVP | D-19 |
| LOC-4 | Show a location's contents and card count, including its child locations. | MVP | Flow 7 |
| LOC-5 | Refuse to delete a location that holds copies until they are moved, with an option to send them all to the "to sort" inbox. | MVP | Edge cases |
| LOC-6 | Sort rules per location (by set, domain, name or type) that suggest a home for each new card. | Next | LoG |
| LOC-7 | Audit mode: check a location's real contents against the app and fix the differences. | Next | LoG |

## Decks

A deck is a Riftbound decklist that always shows, slot by slot, where its cards are right now.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| DECK-4 | Keep a public code from a pasted deck list as a printing hint; slots still accept any printing. | MVP | Data model |
| DECK-5 | Build a deck in the app: Legend search shows only Champion Legends, Chosen Champion search only champion units with the Legend's champion tag, battlefield search only battlefields, and main deck and sideboard search is filtered to the Legend's domains. | MVP | Flow 2 |
| DECK-6 | Check the deck and show problems as warnings that never block: one Legend; one Chosen Champion matching its tag; at least 40 main deck cards, Chosen Champion included; at most 3 copies of a card by name across all printings; at most 3 signature cards, all with the Legend's champion tag; every main deck, sideboard and rune card within the Legend's domains; 12 runes; 3 battlefields with different names; and the sideboard size when there is one. | MVP | Flow 2, D-21 |
| DECK-7 | Show each slot's status: in the deck box, free in storage (with its location path), only in other decks (naming them), missing, or rune. | MVP | Flow 3 |
| DECK-8 | Show a deck summary with the counts of free, in other decks and missing cards. | MVP | Flow 3 |
| DECK-9 | Warn on any card that more decks want than Jeff owns, counting proxies as owned and leaving out maybe boards and runes. | MVP | Data model |
| DECK-10 | Show each deck's state as not assembled, partly assembled or assembled, worked out from its legend, champion, main, battlefield and sideboard slots. | MVP | Data model |
| DECK-11 | Tag cards within a deck: any number of free-text tags per card, with Group by Tag and a tag filter in the deck view. Tags match ignoring case, with spaces and hyphens the same. | MVP | D-36 |
| DECK-13 | Each deck has seven boards: legend, champion, main, battlefield, rune, sideboard and maybe. The sideboard is optional, and the maybe board holds cards being considered that are never pulled, counted or checked. | MVP | D-21, D-22 |
| DECK-14 | Paste or upload a deck list to create a deck, with a preview of unmatched names to fix or skip and the deck checks. Repeated names on one board merge into one slot. | MVP | Flow 2, D-23 |
| DECK-15 | Propose the Legend and Chosen Champion from a pasted list and let Jeff confirm or change them. | MVP | Flow 2 |
| DECK-16 | Move a card between the main deck, sideboard and maybe board from its menu; when the other board already has the card, the two slots merge. | MVP | Flow 5 |

## Assembly

The pick list is the heart of the MVP: one walk past each location, and every tick is a real move.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| ASM-1 | Build a pick list from the unfilled legend, champion, main, battlefield and sideboard slots, grouped by location in location-tree order. | MVP | Flow 4 |
| ASM-2 | Suggest one copy per line: the decklist's printing first, then real before proxy, then a location already on the route. Jeff can switch to any other free copy. | MVP | Flow 4 |
| ASM-3 | Ticking a line moves the copy into the deck box at once, sets its came-from location and sets the slot's picked printing. Unticking moves it back. | MVP | Flow 4 |
| ASM-4 | When storage has no free copy, offer copies in other decks' boxes. The copy keeps its original came-from location, and the app warns that the other deck becomes partly assembled. | MVP | Flow 4 |
| ASM-5 | For a missing card, let Jeff leave a gap, add it to the buy list or add a proxy straight into the deck box. | MVP | Flow 4 |
| ASM-6 | List runes at the end as counts per domain to add. | MVP | Flow 4, D-15 |
| ASM-7 | Work out the pick list again each time it opens, so it shows only what is left. A line whose copy has moved offers another copy. | MVP | Flow 4 |

## Changing and taking apart decks

Cards leave a deck box the way they came in: back to the spot they left, unless Jeff picks another.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| CHG-1 | Update a deck from a fresh deck list. Slots are replaced, and unchanged cards keep their picked printing and tags. | MVP | Flow 5 |
| CHG-2 | When an assembled or partly assembled deck's list changes, show a swap list: take out (to each copy's came-from location) and pull in (laid out like a pick list). | MVP | Flow 5 |
| CHG-3 | Build a put-away list grouped by destination, in the same location order as the pick list. | MVP | Flow 6 |
| CHG-4 | Send each copy to its came-from location by default. Copies with no came-from location go to the "to sort" inbox. | MVP | Flow 6 |
| CHG-5 | Before confirming, let Jeff send chosen copies to another location (which becomes their spot) or keep them in the box. | MVP | Flow 6 |
| CHG-6 | Tick copies off one by one, or return them all at once. Each returned copy's came-from location is cleared. | MVP | Flow 6 |
| CHG-7 | Keep the decklist after a teardown so the deck can be built again. | MVP | Flow 6 |
| CHG-8 | Deleting an assembled or partly assembled deck runs the put-away list first. | MVP | Edge cases |

## Finding and moving cards

Any card can be found in one search, and moved from wherever it turns up. Unchanged from Library of Gathering except that search also takes public codes.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| FIND-1 | Put a card search box on every screen. It matches card names and public codes. | MVP | Flow 7 |
| FIND-2 | Card page lists every copy stack with quantity, printing, finish, condition, proxy tag and full location path, and marks copies that are in a deck. | MVP | Flow 7 |
| FIND-3 | Card page lists the decks that use the card and any demand warning. | MVP | Flow 7 |
| FIND-4 | Move selected copies, or a whole location's contents, to another location. Moving part of a stack splits it, and alike stacks in one place merge. | MVP | Flow 7 |
| FIND-5 | Moving a copy into a deck box sets its came-from location; moving it anywhere else clears it. | MVP | Flow 7 |
| FIND-6 | Show a Recently moved list of the latest moves. | MVP | Flow 7 |

## History and undo

Every change of location is recorded, so any mistake can be walked back. Unchanged from Library of Gathering.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| HIST-1 | Write one movement for every change of location, with the copy stack, quantity, from, to, reason, deck and time. Added copies write a movement with no from location; removed copies one with no to location. | MVP | Data model |
| HIST-2 | Show history for a card, a location or a deck. | MVP | LoG |
| HIST-3 | Undo any movement by writing the reverse movement; history is never deleted. Undoing a pull puts the copy back in storage and unfills the slot. | MVP | Data model |

## Buy list

One global buy list that fills only when Jeff adds to it. Unchanged from Library of Gathering.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| BUY-1 | Add cards to the buy list from a deck, a pick list or a card page, with a quantity, an optional printing and a note. | MVP | Flow 3 |
| BUY-2 | Never add cards automatically, including from deck shortages. | MVP | D-30 |
| BUY-3 | View, edit and remove buy list items. | MVP | Data model |
| BUY-4 | Export the buy list. | Next | LoG |

## Trade binders and values

Carried over from Library of Gathering's Next release, with prices from TCGCSV instead of Scryfall.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| TRADE-1 | Mark any binder or box as For trade. Its copies stay in the collection. Trade locations sit in their own Trade binders section of the Locations tree, and the Collection can filter to trade cards. | MVP | D-20 |
| TRADE-2 | The pick list offers a trade copy only when no other copy is free, and marks it From trade binder. | MVP | D-20 |
| VAL-1 | Load the TCGplayer market price for each printing and finish (normal, foil) from TCGCSV, refreshed daily. | MVP | D-8 |
| VAL-2 | Show value for each copy, each location (including the locations inside it), the trade binder and the whole collection. Proxies are left out, and copies with no price are counted and shown as no price. | MVP | D-8 |

## Exports

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| EXP-1 | Export a deck as a deck list in the same format the import reads, board by board, each line with its picked printing (or printing hint) and the card's tags. Copy it or download it as a .txt file. | MVP | D-23 |
| EXP-2 | Export any location, meant for the trade binder, as a list: one line per printing and finish with its quantity, proxies left out. Copy it or download it as a .txt file. | MVP | D-20 |
| PLAT-7 | Export the whole collection as a CSV backup, one row per copy stack with its printing, finish, condition, language, flags, quantity, location path and value. | MVP | D-37 |

## Platform

The MVP is a web app for one person. It runs on Jeff's own computer; hosting comes later.

| ID | Requirement | Priority | Source |
| --- | --- | --- | --- |
| PLAT-1 | Run as a web app in current desktop browsers. | MVP | D-5 |
| PLAT-2 | Hold one person's collection, with no sharing or other accounts. | MVP | D-1 |
| PLAT-3 | Card data (names, printings, domains, types, champion tags, images) comes from Riftcodex. The app checks for new data when it opens and every 24 hours while it runs, and whenever a pasted deck list has a card it doesn't know. | MVP | D-7 |
| PLAT-4 | Run only on Jeff's own computer, with no hosting or sign-in. | MVP | D-4 |
| PLAT-5 | Make the pick list and put-away list usable in a phone browser. This needs hosting (LATER-7), so it comes later. | Later | D-5 |
| PLAT-8 | Show Riot's legal notice (that Rift Library isn't endorsed by Riot Games) in Settings and the README, as Riot's fan content policy asks. | MVP | D-7 |

## Not in v1

These stay out so nobody builds them early.

| ID | Feature | Priority | Source |
| --- | --- | --- | --- |
| LATER-1 | Camera scanning to add cards in bulk | Later | LoG |
| LATER-3 | Phone app with offline sync | Later | LoG |
| LATER-4 | Sharing and public decks | Later | LoG |
| LATER-5 | Want list | Later | LoG |
| LATER-6 | Collections shared between people | Later | LoG |
| LATER-7 | Host the app with a sign-in, so it opens from any browser and phone | Later | LoG |

Two things are out by decision rather than timing: formats other than Riftbound constructed, and tracking binder pages or slots.

## Dropped from Library of Gathering

These IDs are not used in Rift Library and are never reused for something else.

| ID | What it was | Why it's dropped |
| --- | --- | --- |
| COL-1 to COL-4, COL-10, COL-11 | ManaBox CSV import, location update, proxy column and binder mapping | No ManaBox (D-9); COL-13 and COL-14 cover the same needs by hand and by CSV |
| DECK-1 to DECK-3 | Moxfield import, Moxfield parsing rules, commander proposal | No Moxfield (D-9); replaced by DECK-14 and DECK-15 |
| DECK-12 | Drag a card in from scryfall.com or edhrec.com | No Scryfall (D-9); could return later for a Riftbound site |
| PLAT-6 | Stay quick for about 10,000 cards, checked by speed tests | No speed tests (D-6) |
| LATER-2 | Card prices and collection value | Already in the MVP as VAL-1 and VAL-2 |
