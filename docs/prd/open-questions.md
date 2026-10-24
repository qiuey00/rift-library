# Rift Library: Open questions

Oct 23, 2026 · @Jeff

Part of the [Rift Library: PRD](README.md). This is the one place for questions still waiting on Jeff, and for open items that wait on later work. Status: draft v0.1.

Each question says what Claude will assume if there is no answer. Jeff answers as an item under the question, or just says "default". Once an answer is used, the question and the answer are ticked and the result is added to [Rift Library: Decisions](decisions.md) as a new entry.

## Questions for Jeff

- [ ] **Sideboard in the deck box.** Should sideboard cards be pulled into the deck box with the rest of the deck, and count toward demand? Default: yes, since they travel with the deck (D-29).
- [ ] **Chosen Champion board.** Should the Chosen Champion sit on its own board, shown first like the commander in Library of Gathering, or be an ordinary main deck card that the checks look for? Default: its own board.
- [ ] **Quick add.** When adding cards by hand, should every field (finish, condition, language, real or proxy, location) start at the last value used, so a run of cards needs only the name and Enter? Default: yes (COL-12).
- [ ] **Removing copies.** When Jeff lowers or removes copies by hand, should the app ask why (sold, traded, lost, miscounted)? Default: yes (COL-13).
- [ ] **Where the docs live.** Library of Gathering kept its docs as Claude Docs and copied them into the repo. Should Rift Library's docs live only in the repo, reviewed in pull requests, or also as Claude Docs you comment on? Default: repo only (D-41).

## Answered on 2026-10-23

These were asked in the [Rift Library port plan](https://claude.ai/artifact/ECcatVkan2AwaipP9GvryJ) and are logged in Decisions.

- [x] Is starting from a copy of the v2 code fine? Copy it (D-2).
- [x] How do you track your Riftbound cards today? Mostly by hand; Jeff may have a CSV and will share it when asked again (D-13).
- [x] Do you want deck list text import and export? Yes; Jeff will share sample formats when the Decks step starts (D-23).
- [x] Sideboard? Optional per deck, plus a maybe board for cards being considered (D-22).
- [x] Collection size for speed tests? Skip speed tests for this app (D-6).
- [x] Should runes work like basic lands? Yes (D-15).
- [x] Rewrite the docs first? Yes, before any code (D-10).

## Answered on 2026-10-24

- [x] The sideboard size the checks warn on: at most 10 cards, from Riot's Tournament Rules updated 2026-10-09 (D-42).

## Waiting on later work

These need work or a file rather than an answer now.

| Open item | Waits on | Updates |
| --- | --- | --- |
| The deck list format for import and export | Jeff's sample deck lists, asked for when the Decks step starts | Concepts and Data Model: Deck lists; DECK-14, EXP-1 |
| A CSV import of the collection | Jeff's sample CSV, asked for again at the Collection step | COL-14 |
| Which finishes each printing comes in | Riftcodex has no finish field; checking TCGplayer's price entries against Jeff's real cards | Concepts and Data Model: Card data |
| Riftcodex's paging, rate limits and how often it updates | Calling the API from Jeff's computer, since this cloud environment can't reach it | Technical design: Card data |
