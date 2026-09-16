import { splitNumericRuns } from '@/lib/bidi';

/**
 * Authored text with its numeric runs pinned left-to-right.
 *
 * Use this for any string a PERSON wrote that the app then renders inside Hebrew —
 * a chat message, a coach's note, a workout name off the plan. For values the app
 * itself formats, keep placing `<bdi dir="ltr">` by hand around the digits: it is
 * clearer at the call site and there is nothing to detect.
 *
 * Whitespace is preserved, so the caller still owns `whitespace-pre-wrap`.
 */
export function BidiText({ text }: { text: string }) {
  const parts = splitNumericRuns(text);
  return (
    <>
      {parts.map((p, i) =>
        p.isolate ? (
          <bdi key={i} dir="ltr">{p.text}</bdi>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
