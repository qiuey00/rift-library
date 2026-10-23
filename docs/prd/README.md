# Rift Library: PRD

Oct 23, 2026 · @Jeff

Rift Library is a web app that knows where every physical Riftbound card Jeff owns is stored, and moves those cards in and out of decks. It is the Riftbound version of [Library of Gathering](https://github.com/qiuey00/library-of-gathering-v2/blob/main/docs/prd/README.md) and keeps its core: every copy has one location, and decks are assembled and taken apart from those locations. Status: draft v0.1, waiting for Jeff's review.

## Problem

A collection spread across binders, boxes and deck boxes makes any single card slow to find. Building a Riftbound deck means hunting through storage for a Legend, a Chosen Champion, 40 main deck cards, 3 battlefields and often a sideboard. Taking one apart leaves cards in loose piles that drift away from where they belong.

Library of Gathering already solves this for Magic. Rift Library brings the same pull-and-return loop to Riftbound, without the Magic-only parts: ManaBox, Moxfield, Scryfall and the Commander rules (D-9).

## Target user

Version 1 is for one person: Jeff, a collector and Riftbound player managing one personal collection. Shared or household collections are out of scope for now.

Jeff stores cards in named binders, boxes and deck boxes, and will mostly add the collection by hand (D-13).

## Goals and non-goals

**Goals for v1**

1. Find any owned copy, and the binder, box or deck it sits in, from one search.
2. Assemble a Riftbound deck from a pick list ordered by location, pulling from another deck when storage runs short.
3. Take a deck apart with every card returned to the spot it came from, or to a chosen exception.
4. Add the collection quickly by card search, and bring decks in from a pasted deck list.
5. Keep a history of every move, with undo.

**Not in v1**

- Phone app and offline use (web app only)
- Camera scanning
- Formats other than Riftbound constructed (D-21)
- Shared collections
- Page and slot positions inside binders
- Sharing and public decks
- Speed tests against a made-up big collection (D-6)

## MVP scope

The MVP is everything Library of Gathering does today, MVP and Next release together, rewritten for Riftbound. The code is copied from library-of-gathering-v2 (D-2), so these come over working and only need their Magic parts replaced.

| Area | In the MVP |
| --- | --- |
| Card data | Riftcodex card data, refreshed daily, with TCGplayer prices from TCGCSV |
| Collection | Add copies by search, real and proxy copies, quantity, finish, condition, language, value, CSV export |
| Locations | Nested binders, boxes, deck boxes, trays and a "to sort" inbox; binders tracked as a whole; trade binders |
| Decks | Riftbound decks with Legend, Chosen Champion, main deck, battlefields, runes, an optional sideboard and a maybe board; deck checks; ownership overlay; demand warnings; tags; deck list text import and export |
| Assembly | Pick list ordered by location, choice of printing when several are owned, pulls from other decks |
| Disassembly | Put-away list back to each card's old spot, with exceptions |
| Finding | "Where is it?" search across storage and assembled decks |
| History | Every move recorded, with undo |
| Buy list | One global buy list, filled by hand |

## Success measures

These follow Library of Gathering's three measures, with the deck size changed for Riftbound. The numbers are starting targets and can change once the app is in use.

- **Every card has a home.** A week after Jeff starts adding cards, the "to sort" inbox is empty and no copy has an unknown location.
- **Decks assemble from the pick list.** A full Riftbound deck (Legend, 40 main deck cards and 3 battlefields, with runes as counts) can be assembled in under 20 minutes without searching for any card outside the pick list.
- **Cards are in the right location.** Checking one box or binder a month finds at least 98 of every 100 cards where the app says they are.

## PRD documents

This hub links every PRD doc, and each doc links back here.

| Doc | What it covers | Status |
| --- | --- | --- |
| [Rift Library: Concepts and Data Model](concepts-and-data-model.md) | Entities, relationships, worked-out values and rules | Draft v0.1 |
| [Rift Library: Requirements](requirements.md) | Requirements per feature area, each with priority | Draft v0.1 |
| [Rift Library: Key Flows](key-flows.md) | The eight MVP flows step by step, with edge cases | Draft v0.1 |
| [Rift Library: UI Design](ui-design.md) | Screens, layouts and key interactions for the web app | Draft v0.1 |
| [Rift Library: UI canvas](ui-canvas.md) | The design canvas boards for the changed screens, and when Jeff approved each | Approved 2026-10-23 |
| [Rift Library: Decisions](decisions.md) | Dated log of every settled choice and why | Draft v0.1 |
| [Rift Library: Open questions](open-questions.md) | Questions waiting on Jeff | Draft v0.1 |
| [Rift Library: Glossary](glossary.md) | Agreed meaning of every product term | Draft v0.1 |
| [Rift Library: Technical Design](../technical-design.md) | Stack, architecture, database schema, card data and the build plan | Draft v0.1 |
| [Rift Library port plan](https://claude.ai/artifact/ECcatVkan2AwaipP9GvryJ) | What carries over from Library of Gathering, what is dropped, and the card data sources | Answered by Jeff on 2026-10-23 |
