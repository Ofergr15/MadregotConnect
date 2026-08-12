'use client';

import { useState } from 'react';
import { Check, ChevronDown, Loader2, Wrench, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import type { ToolTraceAttachment, ToolTraceStep } from '@/lib/run-chat/attachments';
import { getToolMetadata } from '@/lib/run-chat/tool-metadata';

function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function ToolStep({ step }: { step: ToolTraceStep }) {
  const locale = useLocale();
  const t = useTranslations('runChat');
  const [expanded, setExpanded] = useState(false);
  const metadata = getToolMetadata(step.name, locale);
  if (metadata.hidden) return null;
  const running = step.status === 'running';
  const failed = step.status === 'error';
  const row = (
    <>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-500/10 text-primary-300">
        <Wrench className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
        <span className="font-medium text-slate-400">{metadata.label}</span>
        <span className="mx-1 text-slate-600">·</span>
        <span>{running ? metadata.running : failed ? t('toolFailed') : metadata.complete}</span>
      </span>
      {running ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-400" />
      ) : failed ? (
        <X className="h-3.5 w-3.5 text-red-400" />
      ) : (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      )}
      {!running && (
        <ChevronDown
          className={`h-3 w-3 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      )}
    </>
  );

  return (
    <Collapsible
      open={expanded}
      className="w-fit min-w-[13rem] max-w-[22rem] overflow-hidden rounded-lg bg-transparent"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={running}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
        aria-expanded={expanded}
        className="h-8 w-full justify-start gap-1.5 px-1.5 text-start font-normal hover:bg-slate-800/25 disabled:cursor-default disabled:opacity-100"
      >
        {row}
      </Button>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-slate-700/35 px-2 py-2">
          {Object.keys(step.args).length > 0 && (
            <Detail label={t('toolArguments')} value={pretty(step.args)} />
          )}
          {step.result && <Detail label={t('toolResult')} value={pretty(step.result)} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[10px] leading-relaxed text-slate-300">
        {value}
      </pre>
    </div>
  );
}

export function ToolTraceCard({ attachment }: { attachment: ToolTraceAttachment }) {
  const visible = attachment.steps.filter((step) => !getToolMetadata(step.name, 'en').hidden);
  if (!visible.length) return null;

  return (
    <div className="my-0.5 w-fit max-w-[22rem] space-y-1">
      {visible.map((step) => <ToolStep key={step.id} step={step} />)}
    </div>
  );
}
