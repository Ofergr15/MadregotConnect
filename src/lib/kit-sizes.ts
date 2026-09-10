/**
 * Club kit sizes — one list per garment, in one file.
 *
 * These strings are duplicated in four places by nature: the academy intake form's
 * option pills, the Personal info picker, the PUT /api/athletes/me validation, and
 * a CHECK constraint in the database. Three of those are TypeScript and can import
 * from here; the fourth is SQL and cannot, so migration 099 spells them out and
 * `kitSizes.test.ts` reads that file back and compares. Adding a size therefore
 * means editing here AND writing a migration — which is correct, since a value the
 * form offers but the CHECK rejects is a save that fails with a 500.
 *
 * Shoe sizes are NOT here: they are a much longer half-step range with its own
 * bounds test, and they live in lib/shoe-catalog.ts as EU_SHOE_SIZES.
 */

/** Shirt, pants and tights all use the same body sizing. */
export const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type ClothingSize = (typeof CLOTHING_SIZES)[number];

/**
 * Socks are sized off the shoe, in the EU ranges the supplier lists — deliberately
 * NOT the XS–XXL list, and deliberately not the 21-value shoe picklist either,
 * because socks are only made in four spans.
 */
export const SOCK_SIZES = ['35-38', '39-42', '43-46', '47+'] as const;
export type SockSize = (typeof SOCK_SIZES)[number];

/**
 * The four kit questions, as `athletes` column ⇄ camelCase API field ⇄ its list.
 * Anything that has to handle "every kit size" (the API's validation loop, the
 * setup score, a future kit-order export) walks this instead of naming four
 * fields, so a fifth garment is one entry rather than a grep.
 */
export const KIT_SIZE_FIELDS = [
  { field: 'shirtSize', column: 'shirt_size', options: CLOTHING_SIZES },
  { field: 'pantsSize', column: 'pants_size', options: CLOTHING_SIZES },
  { field: 'tightsSize', column: 'tights_size', options: CLOTHING_SIZES },
  { field: 'socksSize', column: 'socks_size', options: SOCK_SIZES },
] as const satisfies ReadonlyArray<{
  field: string;
  column: string;
  options: readonly string[];
}>;

export type KitSizeField = (typeof KIT_SIZE_FIELDS)[number]['field'];

/**
 * The columns migration 099 adds, as a PostgREST select fragment.
 *
 * shirt_size is NOT in here on purpose: it landed with 061 and every route that
 * reads it already lists it. These three are the ones a route has to be able to
 * step BACK from, because migrations here are applied by hand and there is a window
 * where the code is deployed and the columns do not exist yet.
 */
export const KIT_SIZE_COLUMNS_099 = 'pants_size, tights_size, socks_size';

/**
 * The three 099 fields for computeSetupState, read off a row that may not have the
 * columns at all — undefined reads as null, i.e. "not answered", which is the same
 * thing the score would say the day after the migration lands. So a route in the
 * pre-099 window under-reports the Sizes task instead of throwing.
 */
export function kitSizeSetupInput(row: Record<string, unknown>) {
  return {
    pantsSize: (row.pants_size as string) || null,
    tightsSize: (row.tights_size as string) || null,
    socksSize: (row.socks_size as string) || null,
  };
}
