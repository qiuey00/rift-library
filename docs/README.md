# Docs

These are the product and design docs for Rift Library, the Riftbound version of Library of Gathering. Each one is rewritten from the matching [Library of Gathering doc](https://github.com/qiuey00/library-of-gathering-v2/tree/main/docs), so the structure, IDs and most of the rules carry over. The plan behind the rewrite is the [Rift Library port plan](https://claude.ai/artifact/ECcatVkan2AwaipP9GvryJ).

Unlike Library of Gathering, the files here are the source. Change a doc in the same pull request as the code it describes.

## Technical design

| Doc | What it covers |
| --- | --- |
| [Technical design](technical-design.md) | Stack, architecture, database schema, Riftcodex card data, TCGCSV prices, core operations and the build plan |

## Product requirements (PRD)

| Doc | What it covers |
| --- | --- |
| [PRD hub](prd/README.md) | The problem, goals, success measures and links to every PRD doc |
| [Concepts and Data Model](prd/concepts-and-data-model.md) | Entities, relationships, worked-out values and rules |
| [Key Flows](prd/key-flows.md) | The eight MVP flows step by step, with edge cases |
| [Requirements](prd/requirements.md) | Requirements per feature area, each with an ID and priority |
| [Decisions](prd/decisions.md) | Dated log of every settled choice and why (add new entries, never edit old ones) |
| [Open questions](prd/open-questions.md) | Questions put to Jeff and their answers |
| [Glossary](prd/glossary.md) | The agreed meaning of every product term |

## UI design

| Doc | What it covers |
| --- | --- |
| [UI Design](prd/ui-design.md) | Screens, layouts and interaction rules |

Library of Gathering's Competitive notes are not carried over: Jeff doesn't want a comparison with other Riftbound apps (D-3).
