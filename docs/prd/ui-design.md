# Rift Library: UI Design

Oct 23, 2026 · @Jeff

Part of the [Rift Library: PRD](README.md). These screens carry out [Rift Library: Key Flows](key-flows.md) and [Rift Library: Requirements](requirements.md); requirement IDs such as ASM-3 point back to them. The screens are Library of Gathering's, described in [Library of Gathering: UI Design](https://github.com/qiuey00/library-of-gathering-v2/blob/main/docs/prd/ui-design.md) and its [design canvas](https://claude.ai/artifact/3cPBiMTicSPBafVKLEVTSi), with the changes below. Anything this doc doesn't change works as it does there. The changed screens are drawn on the [Rift Library UI canvas](ui-canvas.md); where this doc and the canvas differ, the canvas wins. Status: draft v0.1.

**Design principles** (unchanged)

1. **Where comes first.** Every row that shows a card also shows where it is, as a location path.
2. **Nothing to keep in sync.** Statuses and counts are worked out live, so no screen asks Jeff to reserve or reconcile anything.
3. **One walk per box.** Pick and put-away lists are ordered by location, so each binder or box is visited once.
4. **Every tick is a real move.** A tick moves the copy at once, and undo is one click away.
5. **Desktop first.** The app runs in a desktop browser on Jeff's own computer, so screens can be dense and keyboard friendly.

## Look

The look stays Library of Gathering's: a dark top bar over a light grey page with white panels, one blue accent, Instrument Sans for text and Instrument Serif for titles, status colors, location color tiles, and teal for trade.

- **Symbols.** The Mana font and Keyrune set symbols are dropped. Domains show as six colored domain icons (Fury red, Calm green, Mind blue, Body orange, Chaos purple, Order yellow), drawn as small SVGs bundled with the app, so nothing loads from the network. Sets show as their code, such as OGN, until a free set symbol font for Riftbound turns up.
- **Card images.** Shown whole, from the image links Riftcodex gives, which point at Riot's own image servers. Battlefields are printed sideways, so their images and tiles are shown in landscape.
- **Legal notice.** Settings shows Riot's notice that Rift Library isn't endorsed by Riot Games (PLAT-8).

## App layout

- **Top bar:** Decks, Collection, Locations, Buy list and History, in that order, with card search on every screen (FIND-1). The Import button becomes **Add cards**, which opens quick add (COL-12). Locations carries a badge with the number of cards in the "to sort" inbox.
- **Card search:** typing a name or public code shows matching cards with owned and free counts, and Enter opens the card page. The `/` key jumps to it.
- **Undo bar:** after any move, a bar at the bottom names what moved and offers Undo.
- **Decks home:** a tile per deck with the Legend's image, its domain icons, a state pill and a bar of in deck box, free, in other decks and missing counts, sorted by most recently opened. A switch shows the same decks as a table.

## Add cards

Quick add replaces Library of Gathering's ManaBox import as the main way cards come in (Flow 1, COL-5, COL-12).

- A dialog with a location picker at the top (the "to sort" inbox by default, or the location open on the Locations screen), a search field, and the fields quantity, finish, condition, language and Proxy.
- Typing shows matching printings as small images with set, number and public code; arrow keys move between them and Enter picks one.
- After a card is added, its line appears in an Added list under the search, the search clears and keeps focus, and every field keeps its value. Each line in the Added list has Undo.
- Close returns to the screen underneath, which shows the new copies.

## Deck view

The deck view answers "can I build this today, and from where?" without a single click.

- **Header:** deck name, the Legend's domain icons, a state pill and the actions Assemble, Take apart, Update from deck list and Export (DECK-10, CHG-1, EXP-1). Take apart appears only when something is in the deck box.
- **Legend and champion:** the Legend and the Chosen Champion sit first, as two card images side by side, where Library of Gathering showed the commander. The rune counts sit beside them in the same panel.
- **Main deck:** grouped by card type in columns (units, spells, gear), with signature cards marked. Group by also offers Where it is, Domain and Tag; Sort by offers name and energy.
- **Battlefields:** a row of three small landscape tiles under the Legend panel, above the main deck.
- **Runes:** one line of counts per domain, such as "6 Fury Rune · 6 Chaos Rune", with plus and minus buttons, in the Legend panel. Runes have no status, since they are always available (D-15).
- **Sideboard:** its own panel with its card count, shown only when the deck has a sideboard, with statuses like the main deck.
- **Maybe board:** its own panel at the bottom, titled Maybe board with the note "Not counted, picked or checked with the deck.", and left out when empty (D-22).
- **Row actions:** right-clicking a card opens Change printing…, Move to sideboard, Move to maybe board or Move to main deck (DECK-16), Edit tags… and Add to buy list. Legend, champion and battlefield cards have no move.
- **Side pane:** the card preview at the top, then Deck checks (DECK-6) and the Wanted by more decks than you own list (DECK-9).
- **Drag a card in** from scryfall.com or edhrec.com is dropped (D-9).

## Pick list, put-away list and swap list

Unchanged, except that the legend, champion and battlefields are ordinary lines in their location's group, and runes close the pick list as one line of counts per domain (ASM-6).

## Card page

Unchanged, except that the header shows the card's domains, type, energy, might and power, and the printings list shows alternate art, overnumbered and signature printings with a small tag.

## Locations

Unchanged. A location's menu loses Export to Moxfield and gains Export list (EXP-2), and the contents table gains Lower or remove… on selected rows (COL-13).

## Collection, buy list and history

- **Collection:** unchanged, except the filters cover name, set, domain, card type, rarity, finish, proxy, location and trade (COL-8), and key:value search reads `set:ogn`, `domain:fury`, `type:unit` and `rarity:epic`. Import ManaBox CSV is gone; Export CSV stays (PLAT-7).
- **Buy list:** unchanged.
- **History:** unchanged. Removed copies show with a dash for their destination and the reason Jeff gave.

## Deck list import

A full page as in Library of Gathering's Moxfield import, with the pasted list on the left, each line tagged by its board, and the review on the right: the proposed Legend and Chosen Champion as cards with Change, a deck name field, counts per board, unmatched names with a search to fix each, and deck checks as amber warnings (DECK-14, DECK-15). Update from deck list uses the same page and ends on the swap list for an assembled deck.

## Interaction rules

Unchanged, with two words replaced: Basic land becomes Rune in Slot status (a grey count), and the empty states offer Create a location and Add cards, and for an empty deck, Paste a deck list.

## Open questions

- [x] Should battlefields show as landscape tiles in a row of three, as above? Yes, smaller and above the main deck (Jeff, on the canvas, 2026-10-23).
- [x] Should the design canvas be redrawn for Riftbound before the screens change, as Library of Gathering did for UI changes? Yes: the [Rift Library UI canvas](ui-canvas.md) has a board each for the deck view, add cards, deck list import, new deck and Decks home, and each is approved before its screen issue starts (#6).
