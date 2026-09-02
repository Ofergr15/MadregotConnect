import { redirect } from 'next/navigation';

// The feed lives at /feed now, but notification rows and push payloads written
// before the move still deep-link to /dashboard/feed?item=… / ?activity=… —
// those URLs are in the DB forever, so this compat redirect must keep the
// query string intact.
export default async function LegacyFeedRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else if (value != null) qs.append(key, value);
  }
  const query = qs.toString();
  redirect(query ? `/feed?${query}` : '/feed');
}
