import type { ReactNode } from 'react';
import type { CardSummary, Finish, LocationRef } from '../../../shared/api/common';

/** The copy a walk line moves: what Jeff checks against the card in his hand. */
export type WalkCopy = {
  /** Lowercase, such as "eoc". */
  setCode: string;
  /** Such as "rare"; colors the set symbol. */
  rarity: string;
  collectorNumber: string;
  finish: Finish;
  /** Such as "near_mint". */
  condition: string;
  isProxy: boolean;
};

/** A small tag after the copy details, such as "Changed · was Rares binder" or "Missing". */
export type WalkTag = {
  text: string;
  tone?: 'info' | 'missing' | 'warning' | 'trade';
};

/** One line of a pick, put-away or swap list, as the screen hands it in. */
export type WalkLineData = {
  /** Tells lines apart across the whole list. */
  key: string;
  quantity: number;
  card: Pick<CardSummary, 'oracleId' | 'name' | 'imageSmall' | 'imageNormal'>;
  copy: WalkCopy;
  /** Ticked: pulled into the deck box, or put away. */
  done: boolean;
  tag?: WalkTag;
  /** A line under the copy details, such as "Atraxa becomes partly assembled". */
  note?: string;
};

/** The lines in one location (or one other section, such as "In other deck boxes"). */
export type WalkGroupData = {
  key: string;
  /** Shown with its tile and path. Leave it out for a section that isn't a location. */
  location?: LocationRef;
  /** The heading; the location's path when left out. */
  title?: ReactNode;
  /** Such as "pull 6 here" or "put 6 here". */
  countText: string;
  /** `warning` gives the header an amber wash, as for copies in other deck boxes. */
  tone?: 'default' | 'warning';
  /** Shown at the right of the header, such as a "Tick all" button. */
  headerAction?: ReactNode;
  lines: WalkLineData[];
};

/** The line the walk is on, and its group. */
export type WalkCurrent = { line: WalkLineData; group: WalkGroupData };
