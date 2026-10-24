// Sample answers for the exports area, matching src/shared/api/exports.ts. Screen tests mock
// the API with them.

const lines = (list: string[]) => `${list.join('\n')}\n`;

/** GET /api/exports/collection.csv: the header and one row per copy stack (three here). */
export const collectionCsvSample = lines([
  'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Printing ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Location,Proxy',
  'Gilded Whelp,SOS,Spiritforged,52,normal,uncommon,1,617208ff-dd9b-44fd-a740-d3188081e5cc,,false,false,near_mint,en,,To sort,false',
  '"Nasus, Protector",SOS,Spiritforged,176,normal,rare,1,f588fa50-7cc5-41ba-90df-2d252eb5c785,1.83,false,false,near_mint,en,USD,Trade binder,false',
  'Ember Signet,EOC,Origins,53,normal,uncommon,1,3d994115-378d-4685-a5dc-e448831da434,,false,false,near_mint,en,,Jinx Burn deck box,false',
]);

/** The file name GET /api/exports/collection.csv sends, with the day's date. */
export const collectionCsvFileNameSample = 'rift-library-2026-10-20.csv';
