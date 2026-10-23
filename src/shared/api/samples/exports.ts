import type { MoxfieldExport } from '../exports';

// Sample answers for the exports area, matching src/shared/api/exports.ts. Screen tests mock
// the API with them.

/**
 * The Hearthhull deck: commander first, then the main deck, then the maybe board, each by name.
 * Basic lands keep their counts on one line.
 */
const hearthhullLines = [
  '1 Hearthhull, the Worldseed (EOC) 1 *F*',
  '1 Aftermath Analyst (EOC) 91 #card-draw',
  '1 Arcane Signet (EOC) 53 #ramp',
  '1 Augur of Autumn (EOC) 92 #card-draw #ramp',
  '1 Baloth Prime (EOC) 13',
  '1 Beast Within (EOC) 93 #removal',
  '1 Binding the Old Gods (EOC) 52',
  '1 Blasphemous Act (EOC) 86 #removal',
  '1 Bojuka Bog (EOC) 149',
  '1 Braids, Arisen Nightmare (EOC) 82',
  '1 Cabaretti Courtyard (EOC) 151',
  '1 Canyon Slough (EOC) 152',
  '1 Cinder Glade (EOC) 154',
  '1 Command Tower (EOC) 59',
  '1 Cultivate (EOC) 95 #ramp',
  '1 Dakmor Salvage (EOC) 156',
  '1 Escape to the Wilds (EOC) 115',
  '1 Escape Tunnel (EOC) 157',
  '1 Eumidian Hatchery (EOC) 20',
  '1 Eumidian Wastewaker (EOC) 8',
  '1 Evendo Brushrazer (EOC) 10',
  '1 Evolving Wilds (EOC) 158',
  '1 Exploration Broodship (EOC) 14',
  '1 Fabled Passage (EOC) 60',
  '1 Farseek (EOC) 50 #ramp',
  '1 Festering Thicket (EOC) 21',
  '8 Forest (EOE) 276',
  '1 Formless Genesis (EOC) 96',
  '1 Gaze of Granite (EOC) 116',
  '1 God-Eternal Bontu (EOC) 83',
  '1 Hammer of Purphoros (EOC) 88',
  '1 Harrow (EOC) 98',
  '1 Horizon Explorer (EOC) 15',
  '1 Infernal Grasp (EOC) 84 #removal',
  '1 Juri, Master of the Revue (EOC) 119',
  '1 Karplusan Forest (EOC) 164',
  '1 Korvold, Fae-Cursed King (EOC) 120',
  '1 Llanowar Wastes (EOC) 165',
  '1 Maestros Theater (EOC) 167',
  '1 Mayhem Devil (EOC) 121',
  '1 Mazirek, Kraul Death Priest (EOC) 122',
  '1 Moraug, Fury of Akoum (EOC) 89',
  '3 Mountain (EOE) 274',
  '1 Mountain Valley (EOC) 61',
  "1 Multani, Yavimaya's Avatar (EOC) 100",
  '1 Myriad Landscape (EOC) 169',
  "1 Nature's Lore (EOC) 101",
  "1 Night's Whisper (EOC) 85",
  '1 Omnath, Locus of Rage (EOC) 123',
  '1 Oracle of Mul Daya (EOC) 102',
  '1 Pest Infestation (EOC) 103',
  '1 Planetary Annihilation (EOC) 12',
  '1 Putrefy (EOC) 124',
  '1 Rakdos Charm (EOC) 125',
  '1 Rampaging Baloths (EOC) 104',
  '1 Riveteers Overlook (EOC) 172',
  '1 Rocky Tar Pit (EOC) 173',
  '1 Roiling Regrowth (EOC) 105',
  '1 Satyr Wayfinder (EOC) 106',
  '1 Scouring Swarm (EOC) 16',
  '1 Sheltered Thicket (EOC) 178',
  '1 Skyshroud Claim (EOC) 107',
  '1 Smoldering Marsh (EOC) 182',
  '1 Sol Ring (EOC) 57 #ramp',
  '1 Soul of Windgrace (EOC) 126',
  '1 Splendid Reclamation (EOC) 108',
  '1 Springbloom Druid (EOC) 51',
  '1 Sprouting Goblin (EOC) 90',
  '1 Sulfurous Springs (EOC) 185',
  '5 Swamp (EOE) 271',
  '1 Szarel, Genesis Shepherd (EOC) 4 *F*',
  '1 Tear Asunder (EOC) 109',
  '1 Terramorphic Expanse (EOC) 62',
  '1 The Gitrog Monster (EOC) 117',
  '1 Tireless Tracker (EOC) 110 #card-draw',
  '1 Titania, Protector of Argoth (EOC) 111',
  '1 Twilight Mire (EOC) 189',
  '1 Vernal Fen (EOC) 24',
  '1 Viridescent Bog (EOC) 190',
  '1 Wastes (EOC) 191',
  "1 Windgrace's Judgment (EOC) 129",
  "1 Worldsoul's Rage (EOC) 130",
];

const hearthhullMaybeLines = [
  '1 Centaur Vinecrasher (EOC) 94',
  '1 Groundskeeper (EOC) 97',
  '1 Loamcrafter Faun (EOC) 99',
  '1 Uurg, Spawn of Turg (EOC) 127',
  '1 World Breaker (EOC) 112',
];
const lines = (list: string[]) => `${list.join('\n')}\n`;

/** GET /api/exports/decks/1/moxfield: tags and the maybe board, as Moxfield imports them. */
export const hearthhullMoxfieldExportSample: MoxfieldExport = {
  fileName: 'Hearthhull.txt',
  text: lines([...hearthhullLines, '', 'SIDEBOARD:', ...hearthhullMaybeLines]),
  cardCount: 95,
  maybeCount: 5,
  lineCount: hearthhullLines.length + hearthhullMaybeLines.length,
};

/** GET /api/exports/decks/1/moxfield?tags=0&maybe=0 */
export const hearthhullPlainMoxfieldExportSample: MoxfieldExport = {
  fileName: 'Hearthhull.txt',
  text: lines(hearthhullLines.map((line) => line.replace(/ #.*$/, ''))),
  cardCount: 95,
  maybeCount: 0,
  lineCount: hearthhullLines.length,
};

const tradeBinderLines = [
  '10 Arcane Signet (FIC) 332',
  '1 Blech, Loafing Pest (SOS) 176',
  '13 Command Tower (EOC) 59',
  '24 Elemental Mascot (SOS) 185',
  '13 Harmonized Trio // Brainstorm (SOS) 52',
  '1 Jeweled Lotus (EOC) 160 *F*',
  '6 Magmablood Archaic (SOS) 123',
  '1 Pick Your Poison (SOA) 55 *F*',
  '1 Triumph of the Hordes (SOA) 59',
  '16 Witherbloom Charm (SOS) 244',
];

/** GET /api/exports/locations/12/moxfield: the Trade binder, to share as a Moxfield binder. */
export const tradeBinderMoxfieldExportSample: MoxfieldExport = {
  fileName: 'Trade binder.txt',
  text: lines(tradeBinderLines),
  cardCount: 86,
  maybeCount: 0,
  lineCount: tradeBinderLines.length,
};

/** GET /api/exports/collection.csv: the header and one row per copy stack (three here). */
export const collectionCsvSample = lines([
  'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Binder Name,Binder Type,Proxy',
  'Harmonized Trio // Brainstorm,SOS,Secrets of Strixhaven,52,normal,uncommon,1,,617208ff-dd9b-44fd-a740-d3188081e5cc,,false,false,near_mint,en,,To sort,binder,false',
  '"Blech, Loafing Pest",SOS,Secrets of Strixhaven,176,normal,rare,1,,f588fa50-7cc5-41ba-90df-2d252eb5c785,1.83,false,false,near_mint,en,USD,Trade binder,binder,false',
  'Arcane Signet,EOC,Edge of Eternities Commander,53,normal,uncommon,1,,3d994115-378d-4685-a5dc-e448831da434,,false,false,near_mint,en,,Hearthhull deck box,binder,false',
]);

/** The file name GET /api/exports/collection.csv sends, with the day's date. */
export const collectionCsvFileNameSample = 'rift-library-2026-10-20.csv';
