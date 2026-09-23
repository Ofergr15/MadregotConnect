'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pageToLines, type Glyph, type TextLine } from '@/lib/pdf/rtl-text';
import { nutritionOutline, type NutritionOutline } from '@/lib/pdf/nutrition-outline';
import { PlanPdfViewer } from '@/components/PlanPdfViewer';

/**
 * The week's nutrition sheet as text that reflows. The PDF itself is a sibling view,
 * chosen on the program page's own switch rather than from inside here.
 *
 * The report was "the nutrition plan isn't readable enough", and measured it is
 * arithmetic rather than taste: the sheets are A4 PORTRAIT set in 12pt, so
 * fit-to-width on a 390pt phone is 0.66× and the club reads a 7.9pt document.
 * Zooming trades that for horizontal panning on every line, because a PDF page
 * cannot reflow. Unlike the training plan — a real table, five sheets of A4
 * landscape — the nutrition sheet is a flat list: a day heading, then a few
 * one-line instructions. Nothing in it needs a fixed layout, so it is rendered as
 * text at the app's own size, in the app's own RTL.
 *
 * The text is the coach's, verbatim; only the grouping into days is inferred (see
 * lib/pdf/nutrition-outline). And when the extraction does not look like one of her
 * sheets — a scan, an image-only export — this shows the PDF instead of a confident
 * guess. Same for a pdf.js failure. A plan is not the place to display something we
 * are not sure of.
 */

interface Props {
  url: string;
  /** For the PDF fallback's own canvas/iframe title. */
  title: string;
  /**
   * Whether this sheet reconstructed into readable text — `false` for a scan or an
   * image-only export, where this component shows the PDF instead of a confident
   * guess. The program page needs it to decide whether its "in app / PDF" switch has
   * two real options to offer, or whether the PDF is the only thing there is.
   */
  onTextAvailable?: (ok: boolean) => void;
}

/**
 * pdf.js's text items → the plain positioned glyphs the reconstruction takes.
 *
 * `transform` is the text matrix: [4] and [5] are the position, and the rendered
 * font size is the length of its first column — `item.height` is the font's ascent
 * box and is 0 for a lot of items, so it cannot be used for the space threshold.
 */
function toGlyphs(items: Array<Record<string, unknown>>): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const item of items) {
    const str = item.str as string | undefined;
    const transform = item.transform as number[] | undefined;
    if (!str || !transform) continue;
    glyphs.push({
      str,
      x: transform[4],
      y: transform[5],
      width: (item.width as number) || 0,
      size: Math.hypot(transform[2], transform[3]) || (item.height as number) || 12,
    });
  }
  return glyphs;
}

export function NutritionPlanView({ url, title, onTextAvailable }: Props) {
  const [state, setState] = useState<'loading' | 'text' | 'pdf'>('loading');
  const [outline, setOutline] = useState<NutritionOutline | null>(null);

  // Held in a ref so a parent that passes an inline arrow does not re-run the whole
  // extraction on every render of the page above.
  const report = useRef(onTextAvailable);
  report.current = onTextAvailable;

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setOutline(null);

    (async () => {
      try {
        // Same dynamic import and worker path as PlanPdfViewer — pdf.js must not
        // sit in the chunk every screen in the app pays for.
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const doc = await pdfjs.getDocument({ url }).promise;
        const lines: TextLine[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          // Per page, not per document: the bracket-direction call inside
          // pageToLines is about one page's producer, and `y` means nothing across
          // a page break.
          lines.push(...pageToLines(toGlyphs(content.items as Array<Record<string, unknown>>)));
        }
        if (cancelled) return;
        const built = nutritionOutline(lines);
        setOutline(built);
        setState(built ? 'text' : 'pdf');
        report.current?.(!!built);
      } catch {
        if (cancelled) return;
        setState('pdf');
        report.current?.(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (state === 'pdf' || !outline) {
    return <PlanPdfViewer url={url} title={title} />;
  }

  return (
    <div className="space-y-3">
      {outline.title && (
        <h2 className="text-sm font-bold text-ink-900 text-center">{outline.title}</h2>
      )}

      {outline.sections.map((section, i) => (
        <div key={`${section.day ?? 'notes'}-${i}`} className="rounded-card bg-card p-4">
          {section.day && (
            <h3 className="text-xs font-bold text-brand-700 mb-2">{`יום ${section.day}`}</h3>
          )}
          <div className="space-y-1.5">
            {section.lines.map((line, j) => (
              <p
                key={j}
                className={cn(
                  'text-xs leading-relaxed',
                  // A sub-heading groups the lines under it, so it is set apart
                  // rather than indented — the instructions it heads are already
                  // short, and indenting them costs width the phone does not have.
                  line.kind === 'sub'
                    ? 'font-bold text-ink-800 pt-1'
                    : 'text-ink-700',
                )}
              >
                {line.text}
              </p>
            ))}
          </div>
        </div>
      ))}
      {/* No "show the original" button at the bottom any more: the PDF is a view of
          its own on the switch at the top of the page (feedback 757fc57a). A second
          route to it down here would be the same file behind two different controls,
          and the one down here was the one nobody scrolled far enough to find. */}
    </div>
  );
}
