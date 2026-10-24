import type { PickListResponse } from '../pick-list';
import { cards, decks, pickLine as line, locations, printings, stack } from './jinx-burn';

// What GET /api/decks/1/pick-list answers for the partly assembled Jinx Burn deck.

const {
  chaosCalm,
  furyOrder,
  raresBinder,
  staplesBinder,
  toSort,
  bulkTray,
  tradeBinder,
  luxControlBox,
} = locations;

export const pickListSample: PickListResponse = {
  deck: { ...decks.jinxBurn, state: 'partly_assembled', deckBoxId: locations.jinxBurnBox.id },
  pickList: {
    groups: [
      {
        location: chaosCalm,
        cardCount: 4,
        lines: [
          line(104, stack(201, cards.fierceBlast, printings.fierceBlastOgn, chaosCalm), [
            stack(202, cards.fierceBlast, printings.fierceBlastSfp, staplesBinder),
          ]),
          line(105, stack(203, cards.grimScheme, printings.grimSchemeOgn, chaosCalm), [
            stack(204, cards.grimScheme, printings.grimSchemeSfp, bulkTray, { quantity: 3 }),
          ]),
          line(106, stack(205, cards.vastScout, printings.vastScoutOgn, chaosCalm)),
          line(107, stack(206, cards.boldRally, printings.boldRallyOgn, chaosCalm)),
        ],
      },
      {
        location: furyOrder,
        cardCount: 3,
        lines: [
          line(108, stack(207, cards.rogueCaptain, printings.rogueCaptainOgn, furyOrder)),
          line(109, stack(208, cards.twilightGust, printings.twilightGustOgn, furyOrder)),
          // No real copy is free, so the proxy is suggested.
          line(
            110,
            stack(209, cards.dariusAggro, printings.dariusAggroOgn, furyOrder, { isProxy: true }),
          ),
        ],
      },
      {
        location: raresBinder,
        cardCount: 3,
        lines: [
          line(
            111,
            stack(210, cards.starlitGearwright, printings.starlitGearwrightOgn, raresBinder),
          ),
          line(112, stack(211, cards.wildGuardian, printings.wildGuardianOgn, raresBinder)),
          line(113, stack(212, cards.viOutlaw, printings.viOutlawOgn, raresBinder)),
        ],
      },
      {
        location: staplesBinder,
        cardCount: 3,
        lines: [
          line(114, stack(213, cards.sunDisc, printings.sunDiscOgn, staplesBinder), [
            stack(214, cards.sunDisc, printings.sunDiscPrv, toSort),
            stack(215, cards.sunDisc, printings.sunDiscOgn, staplesBinder, { isProxy: true }),
          ]),
          line(115, stack(216, cards.targonsPeak, printings.targonsPeakOgn, staplesBinder)),
          line(117, stack(218, cards.grimSteppe, printings.grimSteppeOgn, staplesBinder)),
        ],
      },
      {
        // The only free copy is in the Trade binder, so the line says so (fromTrade).
        location: tradeBinder,
        cardCount: 1,
        lines: [
          line(116, stack(217, cards.unboundVolley, printings.unboundVolleyOgn, tradeBinder)),
        ],
      },
    ],
    otherDecks: [
      {
        ...line(
          118,
          stack(219, cards.emberSignet, printings.emberSignetPrv, luxControlBox, {
            cameFrom: staplesBinder,
            inDeck: { deckId: decks.luxControl.id, deckName: decks.luxControl.name },
          }),
        ),
        fromDeck: { ...decks.luxControl, becomesPartly: true },
      },
    ],
    missing: [
      {
        slotId: 119,
        card: cards.swiftOx,
        quantity: 1,
        hint: { publicCode: 'OGN-126', foil: false },
      },
      // Added in the app rather than from a deck list, so there is no printing hint.
      { slotId: 120, card: cards.nasusTrickster, quantity: 1, hint: null },
    ],
    runes: [
      { card: cards.calmRune, quantity: 8 },
      { card: cards.furyRune, quantity: 3 },
      { card: cards.chaosRune, quantity: 5 },
    ],
    totals: { lines: 15, cards: 15 },
  },
};
