// Shop link search via Google Custom Search Engine (CSE).
// Reuses the existing CSE credentials from the moodboard feature but
// switches from image search to standard web search so we get product
// pages instead of image grids.

export type ShopResult = {
  url: string;
  title: string;
};

/**
 * Find the top product-page match for an item.
 *
 * How it works:
 * - Runs a normal (non-image) Google CSE query.
 * - Appends "buy" / "shop" / "retail" keywords to increase the chance
 *   that results point to actual e-commerce pages rather than blogs.
 * - Returns the first result that looks like a product page, or the first
 *   result overall as a fallback.
 */
export async function findShopLink(
  searchQuery: string,
): Promise<ShopResult | null> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ENGINE_ID;
  if (!key || !cx) {
    console.warn('Google CSE not configured — shop link skipped');
    return null;
  }

  // Boost commerce intent with buying keywords.
  const enriched = `${searchQuery} buy shop`;

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', enriched);
  url.searchParams.set('num', '5');
  url.searchParams.set('safe', 'active');

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    // 429 quota, 403 key issues — fail silently so the API route can
    // still return items without links.
    console.warn('Google CSE shop search error:', res.status);
    return null;
  }

  const data = await res.json();
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return null;

  // Prefer results that look like product pages (contain /product/, /item/,
  // /shop/, or sit on known retail domains) over blog posts or Pinterest pins.
  const retailSignals = /\/(product|item|shop|p\/|dp\/)|amazon\.|nordstrom\.|zara\.|shopify\.|asos\.|ebay\.|etsy\.|uniqlo\.|h&m\.|macys\.|target\.|walmart\./i;

  for (const it of items) {
    const link = it.link;
    if (typeof link === 'string' && retailSignals.test(link)) {
      return { url: link, title: String(it.title ?? '').slice(0, 200) };
    }
  }

  // Fallback: return the very first result.
  const first = items[0];
  return first?.link
    ? { url: String(first.link), title: String(first.title ?? '').slice(0, 200) }
    : null;
}
