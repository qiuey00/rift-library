# Rift Library: Glossary

Oct 23, 2026 · @Jeff

Part of the [Rift Library: PRD](README.md). Each term below has one agreed meaning, used the same way in every doc and later in the app's screens and code. It keeps every term from [Library of Gathering: Glossary](https://github.com/qiuey00/library-of-gathering-v2/blob/main/docs/prd/glossary.md) that still applies, adds Riftbound's terms, and drops the Magic, ManaBox, Moxfield and Scryfall ones. Definitions follow [Rift Library: Concepts and Data Model](concepts-and-data-model.md), which holds the full rules. Status: draft v0.1.

When a doc needs a new term or uses one differently, the term is added or corrected here first.

## Riftbound

| Term | Meaning | See also |
| --- | --- | --- |
| Domain | One of Riftbound's six colors: Fury (red), Calm (green), Mind (blue), Body (orange), Chaos (purple) and Order (yellow). A card has one or more. | Data model: Entities |
| Champion Legend, Legend | The card that leads a deck, such as a champion's Legend. A deck has exactly one. Its domains are the deck's domain identity, and its champion tag decides the Chosen Champion. | DECK-5, DECK-6 |
| Champion tag | The champion name a Legend, champion unit or signature card is tied to, such as Jinx. | DECK-6 |
| Chosen Champion | One champion unit whose champion tag matches the Legend. It counts toward the main deck's 40 cards and sits on the champion board. | Data model: Boards |
| Domain identity | The domains of a deck's Legend. Main deck, sideboard and rune cards must be within it. | DECK-6 |
| Main deck | At least 40 cards, Chosen Champion included: units, spells, gear and signature cards, at most 3 copies of a card by name. | DECK-6 |
| Signature card | A card tied to one champion tag. A deck may hold at most 3, all matching its Legend's tag. | DECK-6 |
| Battlefield | A card that sets out a place to fight over. A deck brings 3 with different names. | DECK-6 |
| Rune | The cards that pay for other cards. A deck's rune deck holds 12, within its domains. The app treats runes as always available: they are not tracked as copies, never count toward demand or shortages, and appear at the end of the pick list as counts. | D-15; ASM-6 |
| Sideboard | Optional cards swapped in between games. They are pulled into the deck box and count toward demand. | D-22, D-29 |
| Card type | Legend, unit, spell, gear, battlefield or rune, with supertypes such as Champion, Signature and Token. | COL-8 |
| Energy, might, power | A card's printed numbers: its cost, its strength, and its rune cost by domain. | Data model: Entities |

## Cards and copies

| Term | Meaning | See also |
| --- | --- | --- |
| Card | One game card, whatever its printing. The app groups Riftcodex's printings by card name into one card. | Data model: Entities |
| Printing | One version of a card: its set, collector number, public code, available finishes and image. Alternate art, overnumbered and signature printings are printings of the same card. | Data model: Entities |
| Public code | The code printed on a card, such as OGN-001/298: set code, collector number and the set's size. Card search and deck lists accept it. | FIND-1, DECK-4 |
| Alternate art, overnumbered | Printings with different art, numbered past the set's size for overnumbered ones. They fill a slot like any other printing. | D-16 |
| Copy | One physical card Jeff owns. The app counts copies but stores them as copy stacks. | Data model: Entities |
| Copy stack | Physical copies of one printing that are alike and sit together in one location. It records quantity, finish, condition, language, misprint, altered, real or proxy, purchase price (kept, not shown), location and came-from location. | COL-6 |
| Split and merge | Moving part of a stack splits it in two. Stacks that match on every field, including location and came-from location, merge back into one. | Data model: Rules |
| Finish | Normal or foil. | Data model: Card data |
| Condition | How worn a copy is, such as near mint. | COL-6 |
| Real copy | An official printing of the card. | COL-7 |
| Proxy | A stand-in card. Proxies sit in locations, fill deck slots and appear on pick lists like real copies. They count as owned copies, counts show how many are proxies, and they are left out of value. | D-14; COL-7 |
| Owned copies | The sum of copy stack quantities across every printing of a card, proxies included. | Data model: Worked-out values |
| Quick add | Adding cards by search where every field keeps the last value used, so a run of cards needs only a name and Enter. | COL-12 |

## Locations

| Term | Meaning | See also |
| --- | --- | --- |
| Location | Any place copies sit. Each location has a name, a type and, when it sits inside another, a parent location. | LOC-2 |
| Location type | Binder, box, deck box or tray, chosen by Jeff, plus the inbox the app keeps. | LOC-2 |
| Binder | A binder is tracked as one location, with no pages or slots. | LOC-3 |
| Deck box | The location that holds a deck's cards once they are pulled. Each deck names one deck box. | Data model: Entities |
| Storage | Every location that is not a deck box. Pick lists pull from storage and put-away lists return to it. | Data model: Rules |
| Nesting | Putting one location inside another, such as trays inside a box. A location's contents and card count include its child locations. | LOC-2, LOC-4 |
| Location path | A location's full chain of parents, written top down, such as Box 1 › Tray 2. | DECK-7, FIND-2 |
| Location-tree order | The order locations appear in the location tree, top to bottom. Pick lists and put-away lists follow it so Jeff passes each location once. | ASM-1, CHG-3 |
| "To sort" inbox | The one inbox the app always keeps and won't delete. Added cards land there unless Jeff picks another location, and returned copies with no came-from location go there. An empty inbox means every card has a home. | LOC-1, CHG-4 |
| Came-from location | The storage location a copy left when it was pulled into a deck. Moving a copy into a deck box sets it, and returning the copy clears it. A copy pulled from another deck keeps its first came-from location. | ASM-3, ASM-4, FIND-5 |
| Spot | The storage location a copy belongs in: its location while in storage, or its came-from location while in a deck. | CHG-5 |
| Trade binder | Any binder or box marked For trade, or a location inside one. Its copies stay owned; the pick list uses them last. | TRADE-1, TRADE-2 |

## Decks

| Term | Meaning | See also |
| --- | --- | --- |
| Deck | A Riftbound decklist with a name and a deck box. It is built in the app or pasted from a deck list. | DECK-5, DECK-14 |
| Board | The part of a decklist a slot belongs to: legend, champion, main, battlefield, rune, sideboard or maybe. | DECK-13 |
| Maybe board | Cards Jeff is considering for a deck. They are never pulled, counted or checked. | D-22 |
| Deck slot | One line of a decklist: a card, its board, a quantity, a picked printing, a printing hint and tags. Repeated names on one board merge into one slot. | DECK-14 |
| Picked printing | The printing a slot uses. An unpicked slot accepts any printing of its card, and pulling a copy sets the slot's picked printing to that copy's printing. | ASM-3 |
| Printing hint | A public code kept from a pasted deck list or picked with Change printing. The pick list looks for it first, and the slot still accepts any printing. | DECK-4 |
| Slot filled | A slot is filled when the copies of its card in that deck's box reach the slot's quantity. | Data model: Worked-out values |
| Slot status | Where a slot's card can come from: in the deck box, free in storage, only in other decks, missing, or rune. | DECK-7, DECK-8 |
| Assembly state | Not assembled when no slot is filled, assembled when every legend, champion, main, battlefield and sideboard slot is filled, and partly assembled in between. | DECK-10 |
| Copies in decks | Owned copies whose location is a deck box. | Data model: Worked-out values |
| Free copies | Owned copies minus copies in decks, so the copies sitting in storage. | Data model: Worked-out values |
| Deck demand | The total quantity of a card on the legend, champion, main, battlefield and sideboard boards of all decks. Maybe boards and runes never count. | DECK-9 |
| Shortage | Deck demand minus owned copies, when above zero. It shows as a warning and never adds to the buy list by itself. | DECK-9, BUY-2 |
| Deck checks | The Riftbound deck rules the app checks, listed in DECK-6. Problems show as warnings and never block. | DECK-6, D-17 |
| Deck list | Plain text of a deck, board by board, that the app reads and writes. | DECK-14, EXP-1 |
| Tag | A free-text label on a deck slot, such as "removal". | DECK-11 |

## Moving cards

| Term | Meaning | See also |
| --- | --- | --- |
| Pick list | The list of copies to pull for a deck's unfilled slots, grouped by location in location-tree order. It suggests one copy per line and is worked out again each time it opens. | ASM-1, ASM-7 |
| Route | The locations a pick list or put-away list visits, in location-tree order. | ASM-2 |
| Pull | Moving a copy into a deck's box. Ticking a pick list line does it at once. Unticking moves the copy back. | ASM-3 |
| Missing card | A slot's card with no free copy in storage and none in other decks. Jeff can leave a gap, add it to the buy list or add a proxy straight into the deck box. | ASM-5 |
| Take apart | Returning every copy in a deck's box to storage with the put-away list. The decklist is kept. | CHG-7 |
| Put-away list | The list of a deck's copies to return, grouped by destination in the same location order as the pick list. | CHG-3, CHG-6 |
| Return | Sending a copy back to its came-from location and clearing it. A copy with no came-from location goes to the "to sort" inbox. | CHG-4 |
| Exception | A choice made before confirming a put-away: send chosen copies to a different location, which becomes their spot, or keep them in the box. | CHG-5 |
| Swap list | The list shown when an assembled or partly assembled deck's list changes: copies to take out and copies to pull in. | CHG-2 |
| Move | Moving selected copies, or a whole location's contents, to another location by hand. | FIND-4 |
| Movement | One recorded change of location, with the copy stack, quantity, from, to, reason, deck and time. | HIST-1 |
| Batch | Movements made together, such as one pick list, shown as one History entry. | HIST-2 |
| Undo | Reversing a movement by writing the reverse movement, so history is never deleted. | HIST-3 |
| Recently moved | A list of the latest moves. | FIND-6 |
| Buy list | One list of cards Jeff chose to buy, each with a quantity, an optional printing, a note and the date added. | BUY-1, BUY-2 |

## Card data and prices

| Term | Meaning | See also |
| --- | --- | --- |
| Riftcodex | The free, fan-run Riftbound card API the app loads cards and printings from. | D-7; PLAT-3 |
| Riftcodex id | Riftcodex's id for one printing. | Technical design |
| TCGplayer id | TCGplayer's product id for a printing. Riftcodex gives it, and prices are matched by it. | D-8 |
| TCGCSV | A free site that publishes TCGplayer's prices as daily files. Riftbound is its category 89. | D-8; VAL-1 |
| Value | Quantity times the TCGplayer market price for a stack's finish. Proxies are left out, and copies with no price are counted as no price. | VAL-2 |

## Planning labels

| Term | Meaning | See also |
| --- | --- | --- |
| MVP | Needed for the first release. It runs only on Jeff's own computer. | Requirements; PLAT-4 |
| Next | Follows right after the MVP, such as saved searches, audit mode and a CSV import. | Requirements |
| Later | Wanted but not planned yet, such as using the pick list in a phone browser. | Requirements; PLAT-5 |
| Requirement ID | An area prefix and a number, such as ASM-3. IDs carried over from Library of Gathering keep their number; dropped ones are never reused. | Requirements |
| Decision ID | D and a number, such as D-15. Decisions carried over from Library of Gathering name their old ID as "LoG D-23". | Decisions |
| Flow number | Flow 1 to Flow 8, the step-by-step journeys that requirements cite as their source. | Key Flows |
| LoG | Library of Gathering, the Magic app Rift Library is ported from. | PRD hub |
