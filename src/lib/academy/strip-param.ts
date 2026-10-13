/**
 * The current address without one query parameter, or null when it isn't there (launch
 * N23). Closing the thread sheet left `?thread=mine` in the address, so the next in-app
 * link to the same address changed nothing and the sheet never reopened.
 */
export function withoutParam(href: string, name: string): string | null {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(name)) return null;
    url.searchParams.delete(name);
    const q = url.searchParams.toString();
    return `${url.pathname}${q ? `?${q}` : ''}${url.hash}`;
  } catch {
    return null;
  }
}
