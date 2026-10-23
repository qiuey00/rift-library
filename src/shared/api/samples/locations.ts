import type { ErrorBody, LocationRef } from '../common';
import type { LocationNode, LocationNotEmptyError, LocationTree } from '../locations';

// Sample answers for the locations area, matching src/shared/api/locations.ts. Screen tests
// mock the API with them; the stub routes return them until #14.

const node = (
  fields: Omit<
    LocationNode,
    'depth' | 'cardCount' | 'totalCount' | 'markedForTrade' | 'forTrade' | 'value' | 'noPriceCount'
  > &
    Partial<LocationNode>,
): LocationNode => ({
  depth: 0,
  cardCount: 0,
  totalCount: fields.cardCount ?? 0,
  markedForTrade: false,
  forTrade: fields.markedForTrade ?? false,
  value: 0,
  noPriceCount: 0,
  ...fields,
});

export const toSortNode = node({
  id: 1,
  name: 'To sort',
  type: 'inbox',
  parentId: null,
  position: 0,
  color: null,
  effectiveColor: null,
  path: 'To sort',
  cardCount: 37,
  value: 2315,
  noPriceCount: 3,
  deck: null,
});

export const longBoxNode = node({
  id: 2,
  name: 'Long box',
  type: 'box',
  parentId: null,
  position: 1,
  color: '#3b6fd8',
  effectiveColor: '#3b6fd8',
  path: 'Long box',
  cardCount: 0,
  totalCount: 1036,
  value: 97385,
  noPriceCount: 96,
  deck: null,
});

const longBoxSection = (
  id: number,
  name: string,
  position: number,
  cardCount: number,
  value: number,
  noPriceCount: number,
) =>
  node({
    id,
    name,
    type: 'box',
    parentId: longBoxNode.id,
    position,
    color: null,
    effectiveColor: longBoxNode.color,
    path: `Long box › ${name}`,
    depth: 1,
    cardCount,
    value,
    noPriceCount,
    deck: null,
  });

export const blackGreenNode = longBoxSection(3, 'Black & Green', 0, 412, 38420, 41);
export const redGoldNode = longBoxSection(4, 'Red & Gold', 1, 388, 31275, 37);
export const landsNode = longBoxSection(5, 'Lands', 2, 236, 27690, 18);

export const raresBinderNode = node({
  id: 6,
  name: 'Rares binder',
  type: 'binder',
  parentId: null,
  position: 2,
  color: '#7c5cd6',
  effectiveColor: '#7c5cd6',
  path: 'Rares binder',
  cardCount: 180,
  value: 89475,
  noPriceCount: 0,
  deck: null,
});

export const staplesBinderNode = node({
  id: 7,
  name: 'Staples binder',
  type: 'binder',
  parentId: null,
  position: 3,
  color: '#1b9aa0',
  effectiveColor: '#1b9aa0',
  path: 'Staples binder',
  cardCount: 96,
  value: 30540,
  noPriceCount: 2,
  deck: null,
});

export const bulkTrayNode = node({
  id: 8,
  name: 'Bulk tray',
  type: 'tray',
  parentId: null,
  position: 4,
  color: '#8a6248',
  effectiveColor: '#8a6248',
  path: 'Bulk tray',
  cardCount: 1450,
  value: 6855,
  noPriceCount: 102,
  deck: null,
});

/** Marked For trade, so the Locations screen lists it under Trade binders. */
export const tradeBinderNode = node({
  id: 12,
  name: 'Trade binder',
  type: 'binder',
  parentId: null,
  position: 7,
  color: '#d9822b',
  effectiveColor: '#d9822b',
  path: 'Trade binder',
  cardCount: 86,
  markedForTrade: true,
  value: 41280,
  noPriceCount: 4,
  deck: null,
});

export const hearthhullDeckBoxNode = node({
  id: 9,
  name: 'Hearthhull deck box',
  type: 'deck_box',
  parentId: null,
  position: 5,
  color: null,
  effectiveColor: null,
  path: 'Hearthhull deck box',
  cardCount: 63,
  value: 23810,
  noPriceCount: 3,
  deck: { id: 1, name: 'Hearthhull' },
});

export const atraxaDeckBoxNode = node({
  id: 10,
  name: 'Atraxa deck box',
  type: 'deck_box',
  parentId: null,
  position: 6,
  color: null,
  effectiveColor: null,
  path: 'Atraxa deck box',
  cardCount: 64,
  value: 26790,
  noPriceCount: 4,
  deck: { id: 2, name: 'Atraxa' },
});

/** GET /api/locations/tree. */
export const locationTreeSample: LocationTree = {
  nodes: [
    toSortNode,
    longBoxNode,
    blackGreenNode,
    redGoldNode,
    landsNode,
    raresBinderNode,
    staplesBinderNode,
    bulkTrayNode,
    tradeBinderNode,
    hearthhullDeckBoxNode,
    atraxaDeckBoxNode,
  ],
};

/** A location as other answers name it. */
export const locationRef = (location: LocationNode): LocationRef => ({
  id: location.id,
  name: location.name,
  type: location.type,
  path: location.path,
  color: location.effectiveColor,
  forTrade: location.forTrade,
});

/** POST /api/locations with `{ name: 'Commons box', type: 'box' }`. */
export const createdLocationSample: LocationNode = node({
  id: 11,
  name: 'Commons box',
  type: 'box',
  parentId: null,
  position: 8,
  color: null,
  effectiveColor: null,
  path: 'Commons box',
  deck: null,
});

/** PATCH /api/locations/5 with `{ color: '#2f9e5b' }`: Lands gets its own color. */
export const updatedLocationSample: LocationNode = {
  ...landsNode,
  color: '#2f9e5b',
  effectiveColor: '#2f9e5b',
};

/** DELETE /api/locations/2 while its sections hold copies. */
export const locationNotEmptyErrorSample: LocationNotEmptyError = {
  error: {
    code: 'location_not_empty',
    message: 'Long box still holds 1,036 cards. Move them first, or send them all to To sort.',
    cardCount: 1036,
  },
};

/** PATCH /api/locations/12 with `{ forTrade: true }`: the Trade binder is marked For trade. */
export const markedForTradeSample: LocationNode = tradeBinderNode;

/** PATCH /api/locations/9 with `{ forTrade: true }`: a deck box. */
export const deckBoxNotForTradeErrorSample: ErrorBody = {
  error: {
    code: 'deck_box_not_for_trade',
    message: 'Hearthhull deck box holds a deck, so it can’t be for trade.',
  },
};

/** DELETE or rename of the inbox. */
export const inboxProtectedErrorSample: ErrorBody = {
  error: {
    code: 'inbox_protected',
    message: 'To sort is the inbox, so it can’t be renamed or deleted.',
  },
};

/** DELETE /api/locations/9: a deck's own deck box. */
export const deckBoxProtectedErrorSample: ErrorBody = {
  error: {
    code: 'deck_box_protected',
    message: 'Hearthhull deck box belongs to the Hearthhull deck. Delete the deck to remove it.',
  },
};

/** PATCH /api/locations/2 with `{ parentId: 5 }`. */
export const locationLoopErrorSample: ErrorBody = {
  error: { code: 'location_loop', message: 'Long box can’t go inside one of its own sections.' },
};
