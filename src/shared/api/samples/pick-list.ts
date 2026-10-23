import type { PickListResponse } from '../pick-list';
import { cards, decks, pickLine as line, locations, printings, stack } from './hearthhull';

// What GET /api/decks/1/pick-list answers for the partly assembled Hearthhull deck.

const {
  blackGreen,
  redGold,
  raresBinder,
  staplesBinder,
  toSort,
  bulkTray,
  tradeBinder,
  atraxaBox,
} = locations;

export const pickListSample: PickListResponse = {
  deck: { ...decks.hearthhull, state: 'partly_assembled', deckBoxId: locations.hearthhullBox.id },
  pickList: {
    groups: [
      {
        location: blackGreen,
        cardCount: 4,
        lines: [
          line(104, stack(201, cards.infernalGrasp, printings.infernalGraspEoc, blackGreen), [
            stack(202, cards.infernalGrasp, printings.infernalGraspSoc, staplesBinder),
          ]),
          line(105, stack(203, cards.cultivate, printings.cultivateEoc, blackGreen), [
            stack(204, cards.cultivate, printings.cultivateSoc, bulkTray, { quantity: 3 }),
          ]),
          line(106, stack(205, cards.tirelessTracker, printings.tirelessTrackerEoc, blackGreen)),
          line(107, stack(206, cards.putrefy, printings.putrefyEoc, blackGreen)),
        ],
      },
      {
        location: redGold,
        cardCount: 3,
        lines: [
          line(108, stack(207, cards.mayhemDevil, printings.mayhemDevilEoc, redGold)),
          line(109, stack(208, cards.rakdosCharm, printings.rakdosCharmEoc, redGold)),
          // No real copy is free, so the proxy is suggested.
          line(110, stack(209, cards.korvold, printings.korvoldEoc, redGold, { isProxy: true })),
        ],
      },
      {
        location: raresBinder,
        cardCount: 3,
        lines: [
          line(111, stack(210, cards.theGitrogMonster, printings.theGitrogMonsterEoc, raresBinder)),
          line(112, stack(211, cards.oracleOfMulDaya, printings.oracleOfMulDayaEoc, raresBinder)),
          line(113, stack(212, cards.titania, printings.titaniaEoc, raresBinder)),
        ],
      },
      {
        location: staplesBinder,
        cardCount: 3,
        lines: [
          line(114, stack(213, cards.solRing, printings.solRingEoc, staplesBinder), [
            stack(214, cards.solRing, printings.solRingFdc, toSort),
            stack(215, cards.solRing, printings.solRingEoc, staplesBinder, { isProxy: true }),
          ]),
          line(115, stack(216, cards.commandTower, printings.commandTowerEoc, staplesBinder)),
          line(117, stack(218, cards.fabledPassage, printings.fabledPassageEoc, staplesBinder)),
        ],
      },
      {
        // The only free copy is in the Trade binder, so the line says so (fromTrade).
        location: tradeBinder,
        cardCount: 1,
        lines: [line(116, stack(217, cards.beastWithin, printings.beastWithinEoc, tradeBinder))],
      },
    ],
    otherDecks: [
      {
        ...line(
          118,
          stack(219, cards.arcaneSignet, printings.arcaneSignetFdc, atraxaBox, {
            cameFrom: staplesBinder,
            inDeck: { deckId: decks.atraxa.id, deckName: decks.atraxa.name },
          }),
        ),
        fromDeck: { ...decks.atraxa, becomesPartly: true },
      },
    ],
    missing: [
      {
        slotId: 119,
        card: cards.soulOfWindgrace,
        quantity: 1,
        hint: { setCode: 'eoc', collectorNumber: '126', foil: false },
      },
      // Added in the app rather than from Moxfield, so there is no printing hint.
      { slotId: 120, card: cards.omnath, quantity: 1, hint: null },
    ],
    basics: [
      { card: cards.forest, quantity: 8 },
      { card: cards.mountain, quantity: 3 },
      { card: cards.swamp, quantity: 5 },
    ],
    totals: { lines: 15, cards: 15 },
  },
};
