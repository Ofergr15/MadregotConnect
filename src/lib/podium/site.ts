/**
 * Reads a product off podiumsport.co.il (a Konimbo store) — the price check and "add a link".
 * Server-side fetch with a browser User-Agent: without one the store answers a
 * "עבור לדף המבוקש" referrer gate instead of the page (checked 10-26).
 *
 *  · by barcode: /search/?q=<barcode> — the result tile carries data-item-code = the barcode.
 *  · by link: an /items/<id>-… page the admin pasted for a product the search didn't find.
 */

export const PODIUM_ORIGIN = 'https://www.podiumsport.co.il';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export interface SiteProduct {
  url: string;
  imageUrl: string | null;
  price: number | null;
  regularPrice: number | null;
  deal: string | null;
  title: string | null;
  code: string | null;
}

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'he-IL,he;q=0.9' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`podium ${r.status}`);
  return r.text();
}

const num = (s: string | null | undefined): number | null => {
  const m = s?.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

/** Deals the store shows as icons ("קנו 10 קבלו 1 חינם"): the icon's alt in the raw page, its
 *  caption once scripts ran. "חדש NEW" is a label, not a deal. */
function deals(block: string): string | null {
  const icons = block.slice(block.indexOf('item_icons') >= 0 ? block.indexOf('item_icons') : 0);
  const all = [
    ...[...icons.matchAll(/<li[^>]*>\s*<img[^>]*alt=["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...block.matchAll(/class=["']txt-icon["']>([^<$]+)</g)].map((m) => m[1]),
  ].map(decode).filter((t) => t && !/^חדש/.test(t));
  return all[0] ?? null;
}

const Q = `["']`;
const attr = (cls: string) => new RegExp(`<p class=${Q}${cls}[^"']*${Q}[^>]*>([\\s\\S]*?)</p>`);

/** One search-result tile → the product. Exported for the tests. */
export function parseTile(tile: string): SiteProduct | null {
  const href = tile.match(/href=["']\s*(\/items\/[^"'\s]+)\s*["']/)?.[1];
  if (!href) return null;
  const img = tile.match(/class=["']img_wrapper["']>\s*<img[^>]*src=["']([^"']+)["']/)?.[1] ?? null;
  const price = num(strip(tile.match(attr('price\\s'))?.[1]?.replace(/<span[\s\S]*?<\/span>/, '') ?? ''));
  const regular = num(strip(tile.match(attr('origin_price'))?.[1]?.replace(/<span[\s\S]*?<\/span>/, '') ?? ''));
  const title = tile.match(/<h3 class=["']title[^"']*["']>([^<]+)</)?.[1];
  return {
    url: PODIUM_ORIGIN + href.split('?')[0],
    imageUrl: img ? img.replace(/\/(original|show|medium|small)\//, '/large/') : null,
    price,
    regularPrice: regular && price && regular > price ? regular : null,
    deal: deals(tile),
    title: title ? decode(title) : null,
    code: tile.match(/data-item-code="([^"]+)"/)?.[1] ?? null,
  };
}

/** The tile whose data-item-code is this barcode, from a search page. Exported for the tests. */
export function tileFor(html: string, barcode: string): string | null {
  const i = html.indexOf(`data-item-code="${barcode}"`);
  if (i < 0) return null;
  const start = html.lastIndexOf('<div id="item_id_', i);
  const next = html.indexOf('<div id="item_id_', i);
  return html.slice(start < 0 ? i : start, next < 0 ? i + 20000 : next);
}

export async function findByBarcode(barcode: string): Promise<SiteProduct | null> {
  const html = await get(`${PODIUM_ORIGIN}/search/?q=${encodeURIComponent(barcode)}`);
  const tile = tileFor(html, barcode);
  return tile ? parseTile(tile) : null;
}

/** Is this a product page on the store? (The only links "add a link" accepts.) */
export function isPodiumItemUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return /(^|\.)podiumsport\.co\.il$/.test(url.hostname) && url.pathname.startsWith('/items/');
  } catch { return false; }
}

/** An item page → the product. Exported for the tests. */
export function parseItemPage(html: string, url: string): SiteProduct {
  const og = (k: string) => html.match(new RegExp(`property="og:${k}" content="([^"]*)"`))?.[1] ?? html.match(new RegExp(`og:${k}" content="([^"]*)"`))?.[1] ?? null;
  const price = num(html.match(/class="price_value" content="([\d.]+)"/)?.[1]);
  const regular = num(html.match(/class="origin_price_number"[^>]*>([^<]*)</)?.[1]);
  const title = og('title') ?? html.match(/<title>([^<]*)/)?.[1] ?? null;
  return {
    url: url.split('?')[0],
    imageUrl: og('image'),
    price,
    regularPrice: regular && price && regular > price ? regular : null,
    // The item page draws its deal icons from a script; readItem takes the deal from the
    // search tile instead.
    deal: null,
    title: title ? strip(title) : null,
    code: null,
  };
}

const itemId = (u: string) => u.match(/\/items\/(\d+)/)?.[1] ?? null;

export async function readItem(url: string): Promise<SiteProduct> {
  if (!isPodiumItemUrl(url)) throw new Error('not a podium item link');
  const page = parseItemPage(await get(url), url);
  // The deal and the barcode live on the search tile: search the title, take the tile of this item.
  const id = itemId(url);
  if (page.title && id) {
    try {
      const html = await get(`${PODIUM_ORIGIN}/search/?q=${encodeURIComponent(page.title.replace(/ - פודיום.*$/, '').slice(0, 80))}`);
      const i = html.indexOf(`/items/${id}`);
      if (i > 0) {
        const start = html.lastIndexOf('<div id="item_id_', i);
        const tile = parseTile(html.slice(start, html.indexOf('<div id="item_id_', i)));
        if (tile) return { ...page, deal: tile.deal, code: tile.code, imageUrl: page.imageUrl ?? tile.imageUrl, regularPrice: page.regularPrice ?? tile.regularPrice };
      }
    } catch { /* the page alone is enough */ }
  }
  return page;
}
