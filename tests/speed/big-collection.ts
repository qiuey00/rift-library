import type { OpenDb } from '../../src/server/db/database';

// A made-up collection the size of Jeff's, for the speed checks (PLAT-6): about 35,000
// cards in the card tables' shape with about 105,000 printings, about 10,000 copies in about 7,000
// copy stacks across 40 locations, 15 decks of 100 cards (some assembled) and a year of
// movements (about 50,000). Rows are written straight into the tables, like adding cards
// and a year of use would leave them, and the same seed always makes the same collection.

export type BigCollection = {
  cards: number;
  printings: number;
  locations: number;
  stacks: number;
  copies: number;
  decks: number;
  /** Decks with every slot's copies in their deck box. */
  assembledDecks: number[];
  movements: number;
  /** A card that is in many places, for lookups by card. */
  busyOracleId: string;
  /** The first deck, assembled. */
  deckId: number;
  /** A deck that is not assembled yet, so its pick list has a walk for every slot. */
  unassembledDeckId: number;
};

const CARD_COUNT = 35_000;
const STACK_COUNT = 7_000;
const DECK_COUNT = 15;
const MOVEMENT_COUNT = 50_000;
const SET_COUNT = 320;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A small seeded random number generator (mulberry32), so every run builds the same rows. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)] as T;
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}

/** A UUID-shaped id, as oracle and printing ids are. */
function uuid(kind: number, n: number) {
  const hex = n.toString(16).padStart(12, '0');
  return `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${hex}`;
}

const ADJECTIVES = [
  'Ancient',
  'Arcane',
  'Ashen',
  'Blazing',
  'Bloodthirsty',
  'Bold',
  'Brazen',
  'Briar',
  'Cinder',
  'Clever',
  'Crimson',
  'Crystal',
  'Cursed',
  'Dread',
  'Dusk',
  'Eager',
  'Elder',
  'Ember',
  'Eternal',
  'Feral',
  'Fervent',
  'Frost',
  'Gilded',
  'Gloom',
  'Grim',
  'Hallowed',
  'Hidden',
  'Hollow',
  'Iron',
  'Ivory',
  'Jade',
  'Keen',
  'Lost',
  'Lunar',
  'Mighty',
  'Mist',
  'Molten',
  'Noble',
  'Obsidian',
  'Pale',
  'Primal',
  'Radiant',
  'Restless',
  'Rune',
  'Sacred',
  'Savage',
  'Shadow',
  'Silent',
  'Silver',
  'Solar',
  'Spectral',
  'Storm',
  'Sunlit',
  'Thorn',
  'Thunder',
  'Twilight',
  'Verdant',
  'Vicious',
  'Wild',
  'Wicked',
] as const;

const NOUNS = [
  'Acolyte',
  'Angel',
  'Archer',
  'Augury',
  'Banner',
  'Beacon',
  'Behemoth',
  'Blade',
  'Bond',
  'Champion',
  'Charm',
  'Colossus',
  'Conjurer',
  'Crown',
  'Drake',
  'Dragon',
  'Druid',
  'Elemental',
  'Envoy',
  'Familiar',
  'Gate',
  'Golem',
  'Griffin',
  'Guardian',
  'Harbinger',
  'Herald',
  'Hound',
  'Hydra',
  'Idol',
  'Knight',
  'Lantern',
  'Leviathan',
  'Mage',
  'Monk',
  'Oracle',
  'Pact',
  'Phoenix',
  'Ranger',
  'Relic',
  'Revenant',
  'Rogue',
  'Sage',
  'Scholar',
  'Scout',
  'Sentinel',
  'Serpent',
  'Shaman',
  'Signet',
  'Sphinx',
  'Spirit',
  'Squire',
  'Strider',
  'Talisman',
  'Titan',
  'Tome',
  'Vanguard',
  'Warden',
  'Wurm',
  'Wyrm',
  'Zealot',
] as const;

const PLACES = [
  'the Wastes',
  'the Deep',
  'the Spires',
  'the Grove',
  'the Mire',
  'the Forge',
  'the Tides',
  'the Peaks',
  'the Vault',
  'the Wilds',
  'the Sanctum',
  'the Pyre',
  'the Dunes',
  'the Fens',
  'the Ruins',
  'the Hollow',
  'the Abyss',
  'the Citadel',
  'the Marsh',
  'the Glade',
  'Zendikar',
  'Innistrad',
  'Kaldheim',
  'Dominaria',
  'Ravnica',
  'Theros',
  'Ikoria',
  'Kamigawa',
  'Eldraine',
  'Tarkir',
  'Amonkhet',
  'Ixalan',
  'Kaladesh',
  'Mirrodin',
  'Lorwyn',
  'Alara',
  'Fiora',
  'Capenna',
  'Strixhaven',
  'Arcavios',
] as const;

const TYPE_LINES = [
  'Creature — Human Wizard',
  'Creature — Elf Druid',
  'Creature — Goblin Warrior',
  'Creature — Zombie',
  'Creature — Dragon',
  'Creature — Angel',
  'Creature — Beast',
  'Creature — Merfolk Rogue',
  'Creature — Vampire Noble',
  'Creature — Spirit',
  'Instant',
  'Sorcery',
  'Enchantment',
  'Enchantment — Aura',
  'Artifact',
  'Artifact — Equipment',
  'Artifact Creature — Golem',
  'Land',
  'Planeswalker — Jace',
] as const;

const LEGENDARY_TYPES = [
  'Legendary Creature — Human Wizard',
  'Legendary Creature — Elf Druid',
  'Legendary Creature — Dragon',
  'Legendary Creature — Angel',
  'Legendary Creature — Vampire',
  'Legendary Creature — Phyrexian Praetor',
  'Legendary Creature — God',
] as const;

const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;

const CONDITIONS = ['near_mint', 'near_mint', 'near_mint', 'excellent', 'good', 'played'];

/** Color identities, weighted toward mono and two colors like real cards. */
function colorIdentity(rng: ReturnType<typeof random>) {
  const roll = rng.next();
  const count = roll < 0.15 ? 0 : roll < 0.65 ? 1 : roll < 0.9 ? 2 : roll < 0.97 ? 3 : 5;
  const letters = new Set<string>();
  while (letters.size < count) letters.add(rng.pick(['W', 'U', 'B', 'R', 'G']));
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => letters.has(c)).join('');
}

function manaCost(identity: string, rng: ReturnType<typeof random>) {
  const generic = rng.int(5);
  const colored = [...identity].map((c) => `{${c}}`).join('');
  const cost = `${generic > 0 || colored === '' ? `{${generic}}` : ''}${colored}`;
  return { cost, value: generic + identity.length };
}

function setCode(n: number) {
  // Three letters, like most set codes: "aaa", "aab", ...
  const a = 'abcdefghijklmnopqrstuvwxyz';
  return `${a[Math.floor(n / 676) % 26]}${a[Math.floor(n / 26) % 26]}${a[n % 26]}x`;
}

/** Builds the collection into an empty database (one just opened with its migrations). */
export function seedBigCollection(db: OpenDb, options: { now?: number } = {}): BigCollection {
  const now = options.now ?? Date.now();
  const rng = random(56);
  const client = db.$client;

  const result = client.transaction((): BigCollection => {
    // Sets, newest last, across about 30 years.
    const sets = Array.from({ length: SET_COUNT }, (_, n) => ({
      code: setCode(n),
      name: `${ADJECTIVES[n % ADJECTIVES.length]} ${NOUNS[(n * 7) % NOUNS.length]} Set ${n + 1}`,
      releasedAt: new Date(now - (SET_COUNT - n) * 34 * DAY_MS).toISOString().slice(0, 10),
      next: 1,
    }));

    // Cards and printings.
    const insertCard = client.prepare(`
      INSERT INTO cards (oracle_id, name, front_face_name, type_line, mana_cost, mana_value,
        color_identity, commander_legality, keywords, can_be_commander, is_basic_land, allows_many)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertPrinting = client.prepare(`
      INSERT INTO printings (printing_id, oracle_id, set_code, set_name, collector_number, lang,
        finishes, rarity, released_at, image_small, image_normal, price_usd, price_usd_foil,
        price_usd_etched)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    type Card = {
      oracleId: string;
      identity: string;
      commander: boolean;
      basic: boolean;
      printings: string[];
    };
    const cards: Card[] = [];
    let printingCount = 0;

    const addPrintings = (card: Card, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const set = rng.pick(sets);
        const printingId = uuid(2, printingCount);
        printingCount += 1;
        const foil = rng.next();
        const finishes =
          foil < 0.55
            ? ['nonfoil', 'foil']
            : foil < 0.9
              ? ['nonfoil']
              : foil < 0.97
                ? ['foil']
                : ['etched'];
        const image = `https://images.example.com/%s/front/${printingId.slice(-2)}/${printingId}.jpg`;
        // Prices in cents, worked out from the printing's number rather than the random
        // numbers so the rest of the collection stays the same; about one in ten has none.
        const price = (printingCount * 7919) % 10_000;
        const hasPrice = price % 10 !== 0;
        const priceFor = (finish: string, cents: number) =>
          hasPrice && finishes.includes(finish) ? cents : null;
        insertPrinting.run(
          printingId,
          card.oracleId,
          set.code,
          set.name,
          String(set.next),
          rng.chance(0.95) ? 'en' : rng.pick(['ja', 'de', 'fr']),
          JSON.stringify(finishes),
          rng.pick(['common', 'common', 'uncommon', 'rare', 'mythic']),
          set.releasedAt,
          image.replace('%s', 'small'),
          image.replace('%s', 'normal'),
          priceFor('nonfoil', 10 + price),
          priceFor('foil', 25 + price * 2),
          priceFor('etched', 40 + price * 3),
        );
        set.next += 1;
        card.printings.push(printingId);
      }
    };

    for (const name of BASICS) {
      const card: Card = {
        oracleId: uuid(1, cards.length),
        identity: '',
        commander: false,
        basic: true,
        printings: [],
      };
      insertCard.run(
        card.oracleId,
        name,
        name,
        `Basic Land — ${name}`,
        '',
        0,
        '',
        'legal',
        '[]',
        0,
        1,
        1,
      );
      addPrintings(card, 40);
      cards.push(card);
    }

    // Unique names: every adjective, noun and place, shuffled, the first ones taken.
    const names: string[] = [];
    for (const adjective of ADJECTIVES) {
      for (const noun of NOUNS) {
        names.push(`${adjective} ${noun}`);
        for (const place of PLACES) names.push(`${adjective} ${noun} of ${place}`);
      }
    }
    for (let i = names.length - 1; i > 0; i -= 1) {
      const j = rng.int(i + 1);
      [names[i], names[j]] = [names[j] as string, names[i] as string];
    }

    for (let n = 0; cards.length < CARD_COUNT; n += 1) {
      const commander = rng.chance(0.06);
      const identity = colorIdentity(rng);
      const { cost, value } = manaCost(identity, rng);
      let name = names[n] as string;
      let front = name;
      if (rng.chance(0.03)) {
        front = name;
        name = `${name} // ${names[names.length - 1 - n]}`;
      }
      const keywords =
        commander && rng.chance(0.1) ? ['Partner'] : rng.chance(0.3) ? ['Flying'] : [];
      const card: Card = {
        oracleId: uuid(1, cards.length),
        identity,
        commander,
        basic: false,
        printings: [],
      };
      insertCard.run(
        card.oracleId,
        name,
        front,
        commander ? rng.pick(LEGENDARY_TYPES) : rng.pick(TYPE_LINES),
        cost,
        value,
        identity,
        rng.chance(0.005) ? 'banned' : 'legal',
        JSON.stringify(keywords),
        commander ? 1 : 0,
        0,
        0,
      );
      const roll = rng.next();
      addPrintings(card, roll < 0.35 ? 1 : roll < 0.6 ? 2 : roll < 0.8 ? 3 : roll < 0.92 ? 5 : 9);
      cards.push(card);
    }

    client
      .prepare(
        `INSERT INTO card_data_status (id, bulk_updated_at, last_checked_at, card_count, printing_count)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET bulk_updated_at = excluded.bulk_updated_at,
           last_checked_at = excluded.last_checked_at, card_count = excluded.card_count,
           printing_count = excluded.printing_count`,
      )
      .run(
        new Date(now - DAY_MS).toISOString(),
        new Date(now).toISOString(),
        cards.length,
        printingCount,
      );

    // Locations: the inbox plus 39 more, three levels deep in the closet.
    const insertLocation = client.prepare(
      'INSERT INTO locations (name, type, parent_id, position, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const created = new Date(now - 366 * DAY_MS).toISOString();
    const addLocation = (
      name: string,
      type: string,
      parentId: number | null,
      position: number,
      color: string | null = null,
    ) => Number(insertLocation.run(name, type, parentId, position, color, created).lastInsertRowid);

    const inboxId = (
      client.prepare("SELECT id FROM locations WHERE type = 'inbox'").get() as {
        id: number;
      }
    ).id;
    const storage: number[] = [inboxId];
    const closet = addLocation('Closet', 'box', null, 1, '#3b82f6');
    storage.push(closet);
    for (let b = 1; b <= 6; b += 1) {
      const box = addLocation(`Bulk box ${b}`, 'box', closet, b);
      storage.push(box);
      for (const [r, row] of ['A', 'B', 'C'].entries()) {
        storage.push(addLocation(`Row ${row}`, 'box', box, r));
      }
    }
    const shelf = addLocation('Shelf', 'box', null, 2, '#a855f7');
    storage.push(shelf);
    const binders = [
      'Rares binder',
      'Commander staples',
      'Foils binder',
      'Trade binder',
      'Lands binder',
      'Old frames binder',
      'Dragons binder',
      'Tokens and oddities',
    ];
    for (const [i, name] of binders.entries()) {
      storage.push(addLocation(name, 'binder', shelf, i, i % 3 === 0 ? '#f59e0b' : null));
    }
    const desk = addLocation('Desk', 'box', null, 3, '#10b981');
    storage.push(desk);
    storage.push(addLocation('Trade tray', 'tray', desk, 0));
    storage.push(addLocation('New cards tray', 'tray', desk, 1));
    storage.push(addLocation('Box of lands', 'box', null, 4));
    storage.push(addLocation('Foils box', 'box', null, 5, '#ef4444'));
    const landsBox = storage[storage.length - 2] as number;
    // The trade binder and tray are marked For trade.
    client
      .prepare("UPDATE locations SET for_trade = 1 WHERE name IN ('Trade binder', 'Trade tray')")
      .run();

    // Copy stacks in storage, keeping the merge rule: alike copies in one place are one row.
    const insertStack = client.prepare(`
      INSERT INTO copy_stacks (printing_id, quantity, finish, condition, language, misprint,
        altered, is_proxy, location_id, came_from_location_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    type Stack = {
      id: number;
      printingId: string;
      finish: string;
      condition: string;
      locationId: number;
    };
    const stacks: Stack[] = [];
    const seen = new Set<string>();
    let copies = 0;
    const addStack = (
      printingId: string,
      quantity: number,
      locationId: number,
      cameFrom: number | null = null,
      finish = rng.chance(0.2) ? 'foil' : 'nonfoil',
      condition = rng.pick(CONDITIONS),
    ) => {
      const proxy = rng.chance(0.02) ? 1 : 0;
      const key = `${printingId}|${finish}|${condition}|${proxy}|${locationId}|${cameFrom ?? 0}`;
      if (seen.has(key)) return undefined;
      seen.add(key);
      const at = new Date(now - rng.int(365) * DAY_MS).toISOString();
      const id = Number(
        insertStack.run(
          printingId,
          quantity,
          finish,
          condition,
          'en',
          0,
          0,
          proxy,
          locationId,
          cameFrom,
          at,
          at,
        ).lastInsertRowid,
      );
      const stack = { id, printingId, finish, condition, locationId };
      stacks.push(stack);
      copies += quantity;
      return stack;
    };

    // Basic lands: a few big stacks in the box of lands.
    for (const basic of cards.slice(0, BASICS.length)) {
      for (const printingId of basic.printings.slice(0, 6)) {
        addStack(printingId, 4 + rng.int(12), landsBox, null, 'nonfoil', 'near_mint');
      }
    }

    // About 6,000 owned cards; a few of them in many places.
    const owned = cards.slice(BASICS.length).filter(() => rng.chance(0.175));
    const busy = owned[0] as Card;
    for (let i = 0; i < 40; i += 1) {
      addStack(rng.pick(busy.printings), 1, rng.pick(storage));
    }
    const storageTarget = STACK_COUNT - 1_000; // the rest go into deck boxes below
    while (stacks.length < storageTarget) {
      const card = rng.pick(owned);
      const roll = rng.next();
      const quantity = roll < 0.75 ? 1 : roll < 0.9 ? 2 : roll < 0.97 ? 3 : 4;
      addStack(rng.pick(card.printings), quantity, rng.pick(storage));
    }

    // Decks: a commander, 89 other cards (mostly owned ones), 10 basics and a few maybes.
    const insertDeck = client.prepare(
      'INSERT INTO decks (name, deck_box_id, created_at, updated_at, opened_at) VALUES (?, ?, ?, ?, ?)',
    );
    const insertSlot = client.prepare(`
      INSERT INTO deck_slots (deck_id, oracle_id, board, quantity, picked_printing_id)
      VALUES (?, ?, ?, ?, ?)`);
    const insertTag = client.prepare(
      'INSERT INTO deck_slot_tags (slot_id, tag, tag_key) VALUES (?, ?, ?)',
    );
    // Tags on most slots, one to three each (without the rng, so the rest stays the same).
    const TAGS = [
      'Ramp',
      'Card draw',
      'Removal',
      'token-maker',
      'combo',
      'Board wipe',
      'Protection',
    ];
    let tagged = 0;
    const commanders = cards.filter((card) => card.commander);
    const assembledDecks: number[] = [];
    let unassembledDeckId = 0;
    const firstStorageStack = new Map<string, Stack>();
    for (const stack of stacks) {
      const card = stack.printingId;
      if (!firstStorageStack.has(card)) firstStorageStack.set(card, stack);
    }

    const deckIds: number[] = [];
    for (let d = 0; d < DECK_COUNT; d += 1) {
      const commander = commanders[d * 13] as Card;
      const name = `${names[CARD_COUNT + d]} deck`;
      const boxId = addLocation(`${name} box`, 'deck_box', null, 10 + d);
      const at = new Date(now - (200 - d * 10) * DAY_MS).toISOString();
      const deckId = Number(
        insertDeck.run(
          name,
          boxId,
          at,
          at,
          d < 10 ? new Date(now - d * DAY_MS).toISOString() : null,
        ).lastInsertRowid,
      );
      deckIds.push(deckId);
      // Decks 1 to 5 are assembled, 6 to 8 partly, the rest not at all.
      const assembled = d < 5 ? 1 : d < 8 ? 0.5 : 0;
      if (assembled === 1) assembledDecks.push(deckId);
      if (assembled === 0 && unassembledDeckId === 0) unassembledDeckId = deckId;

      const chosen = new Set<Card>([commander]);
      while (chosen.size < 90) {
        chosen.add(rng.chance(0.8) ? rng.pick(owned) : rng.pick(cards.slice(BASICS.length)));
      }
      const slots: { card: Card; board: string; quantity: number }[] = [
        ...[...chosen].map((card, i) => ({
          card,
          board: i === 0 ? 'commander' : 'main',
          quantity: 1,
        })),
        { card: cards[d % 5] as Card, board: 'main', quantity: 6 },
        { card: cards[(d + 1) % 5] as Card, board: 'main', quantity: 4 },
        ...Array.from({ length: 3 }, () => ({
          card: rng.pick(owned),
          board: 'maybe',
          quantity: 1,
        })),
      ];
      const maybes = new Set<string>();
      for (const slot of slots) {
        if (slot.board === 'maybe') {
          if (maybes.has(slot.card.oracleId) || chosen.has(slot.card)) continue;
          maybes.add(slot.card.oracleId);
        }
        let picked: string | null = null;
        if (slot.board !== 'maybe' && rng.next() < assembled) {
          // Pulled: the copies sit in the deck box and remember where they came from.
          const printing = rng.pick(slot.card.printings);
          const from = firstStorageStack.get(printing);
          if (
            addStack(
              printing,
              slot.quantity,
              boxId,
              from?.locationId ?? closet,
              'nonfoil',
              'near_mint',
            )
          ) {
            picked = printing;
          }
        }
        const slotId = insertSlot.run(
          deckId,
          slot.card.oracleId,
          slot.board,
          slot.quantity,
          picked,
        ).lastInsertRowid;
        tagged += 1;
        for (let t = 0; t < tagged % 4; t += 1) {
          const tag = TAGS[(tagged + t * 3) % TAGS.length] as string;
          insertTag.run(slotId, tag, tag.toLowerCase().replace(/\s+/g, '-'));
        }
      }
    }

    // Fill up to about 7,000 stacks with more storage copies.
    while (stacks.length < STACK_COUNT) {
      addStack(rng.pick(rng.pick(owned).printings), 1, rng.pick(storage));
    }

    // A year of movements, oldest first, in batches like the app makes them.
    const insertBatch = client.prepare(
      'INSERT INTO movement_batches (kind, deck_id, created_at) VALUES (?, ?, ?)',
    );
    const insertMovement = client.prepare(`
      INSERT INTO movements (batch_id, copy_stack_id, printing_id, finish, condition, language,
        quantity, from_location_id, to_location_id, reason, deck_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'en', ?, ?, ?, ?, ?, ?)`);
    const kinds = [
      ['move', 'moved', 1, 4],
      ['add', 'added', 1, 3],
      ['import', 'imported', 60, 400],
      ['pick_list', 'assembled', 20, 100],
      ['put_away', 'returned', 10, 60],
      ['swap', 'swapped_in', 2, 8],
    ] as const;
    let movementCount = 0;
    // Spread start times over the year, then sort so ids grow with time like real use.
    const batches: { at: number; kind: (typeof kinds)[number] }[] = [];
    let planned = 0;
    while (planned < MOVEMENT_COUNT) {
      const roll = rng.next();
      const kind =
        kinds[
          roll < 0.55 ? 0 : roll < 0.75 ? 1 : roll < 0.8 ? 2 : roll < 0.9 ? 3 : roll < 0.97 ? 4 : 5
        ];
      batches.push({ at: now - rng.next() * 365 * DAY_MS, kind });
      planned += (kind[2] + kind[3]) / 2;
    }
    batches.sort((a, b) => a.at - b.at);
    for (const { at, kind } of batches) {
      if (movementCount >= MOVEMENT_COUNT) break;
      const [batchKind, reason, min, max] = kind;
      const deckId =
        batchKind === 'pick_list' || batchKind === 'put_away' || batchKind === 'swap'
          ? rng.pick(deckIds)
          : null;
      const createdAt = new Date(at).toISOString();
      const batchId = Number(insertBatch.run(batchKind, deckId, createdAt).lastInsertRowid);
      const size = Math.min(min + rng.int(max - min + 1), MOVEMENT_COUNT - movementCount);
      for (let i = 0; i < size; i += 1) {
        const stack = rng.pick(stacks);
        const arriving = batchKind === 'import' || batchKind === 'add';
        insertMovement.run(
          batchId,
          stack.id,
          stack.printingId,
          stack.finish,
          stack.condition,
          1,
          arriving ? null : rng.pick(storage),
          stack.locationId,
          reason,
          deckId,
          new Date(at + i * 10).toISOString(),
        );
        movementCount += 1;
      }
    }

    return {
      cards: cards.length,
      printings: printingCount,
      locations: storage.length,
      stacks: stacks.length,
      copies,
      decks: DECK_COUNT,
      assembledDecks,
      movements: movementCount,
      busyOracleId: busy.oracleId,
      deckId: deckIds[0] as number,
      unassembledDeckId,
    };
  })();

  client.pragma('optimize');
  return result;
}
