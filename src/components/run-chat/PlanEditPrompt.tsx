'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, PencilLine, Wand2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  MessageActions,
  defaultMessageActionSet,
  type ContextMenuItemProps,
  useContextMenuContext,
  useMessageContext,
} from 'stream-chat-react';
import { Button } from '@/components/ui/button';
import { AI_USER_ID } from '@/lib/stream/constants';

type OpenPlanEditor = (messageId: string, currentPlan: string) => void;

const PlanEditContext = createContext<OpenPlanEditor | null>(null);

function apiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function isPlanSeedMessage(message: {
  user?: { id?: string } | null;
  text?: string;
  [key: string]: unknown;
}) {
  return (
    message.user?.id === AI_USER_ID &&
    (message.run_chat_seed === 'plan' ||
      (message.text || '').startsWith('📋 תוכנית האימון להיום'))
  );
}

function PlanEditAction(props: ContextMenuItemProps) {
  const t = useTranslations('runChat');
  const openEditor = useContext(PlanEditContext);
  const { closeMenu } = useContextMenuContext();
  const { message } = useMessageContext('PlanEditAction');

  if (!openEditor || !isPlanSeedMessage(message as typeof message & Record<string, unknown>)) {
    return null;
  }

  const currentPlan = (message.text || '').replace(/^📋\s*תוכנית האימון להיום:\s*/u, '').trim();

  return (
    <button
      {...props}
      className="str-chat__context-menu__button str-chat__message-actions-list-item-button run-chat-edit-plan-action"
      data-testid="edit-plan-with-prompt"
      onClick={() => {
        openEditor(message.id, currentPlan);
        closeMenu();
      }}
    >
      <PencilLine
        className="str-chat__icon str-chat__context-menu__button__icon"
        aria-hidden="true"
      />
      <div className="str-chat__context-menu__button__label">
        {t('editPlanWithPrompt')}
      </div>
    </button>
  );
}

export function RunChatMessageActions() {
  const actionSet = useMemo(() => {
    const menuToggle = defaultMessageActionSet.filter(
      ({ placement }) => placement === 'quick-dropdown-toggle',
    );
    const defaultActions = defaultMessageActionSet.filter(
      ({ placement }) => placement !== 'quick-dropdown-toggle',
    );
    return [
      ...menuToggle,
      {
        Component: PlanEditAction,
        placement: 'dropdown' as const,
        type: 'edit-plan-prompt',
      },
      ...defaultActions,
    ];
  }, []);

  return <MessageActions messageActionSet={actionSet} />;
}

interface PlanEditPromptProviderProps {
  chatId: string;
  supabaseToken: string;
  canEditPlan: boolean;
  children: ReactNode;
}

export function PlanEditPromptProvider({
  chatId,
  supabaseToken,
  canEditPlan,
  children,
}: PlanEditPromptProviderProps) {
  const t = useTranslations('runChat');
  const [messageId, setMessageId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  /** Suggestion reverse-engineered from the laps; submitting it unchanged keeps its structure. */
  const [extracted, setExtracted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = submitting || extracting;

  const close = () => {
    if (busy) return;
    setMessageId(null);
    setPrompt('');
    setExtracted(null);
    setError(null);
  };

  const openEditor: OpenPlanEditor = (nextMessageId, currentPlan) => {
    setMessageId(nextMessageId);
    setPrompt(currentPlan);
    setExtracted(null);
    setError(null);
  };

  const postPlan = async (payload: Record<string, unknown>) => {
    const response = await fetch(`/api/run-chat/${chatId}/plan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { error?: unknown; [key: string]: unknown };
    if (!response.ok) {
      if (body.error === 'no_laps') throw new Error(t('extractPlanNoLaps'));
      throw new Error(apiErrorMessage(body.error, t('editPlanFailed')));
    }
    return body;
  };

  const extractFromRun = async () => {
    if (!messageId) return;
    setExtracting(true);
    setError(null);
    try {
      const body = (await postPlan({ extract: 'preview', messageId })) as { plannedText: string };
      setPrompt(body.plannedText);
      setExtracted(body.plannedText);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('extractPlanFailed'));
    } finally {
      setExtracting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!messageId || !prompt.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const text = prompt.trim();
      await postPlan(
        extracted && text === extracted.trim()
          ? { extract: 'apply', messageId }
          : { plannedText: text, messageId },
      );
      setMessageId(null);
      setPrompt('');
      setExtracted(null);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('editPlanFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PlanEditContext.Provider value={canEditPlan ? openEditor : null}>
      {children}
      {messageId && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] grid place-items-center bg-page/75 p-4"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) close();
              }}
            >
              <form
                className="w-full max-w-lg rounded-2xl border border-page bg-page p-5 text-start shadow-2xl"
                data-testid="edit-plan-dialog"
                dir="rtl"
                onSubmit={submit}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-ink-700">{t('editPlanTitle')}</h2>
                    <p className="mt-1 text-sm text-ink-400">{t('editPlanDescription')}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-page hover:text-ink-900"
                    aria-label={t('close')}
                    onClick={close}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  autoFocus
                  className="min-h-28 w-full resize-y rounded-xl border border-page bg-page px-3 py-2.5 text-sm text-ink-700 outline-none focus:border-band-2"
                  data-testid="edit-plan-prompt"
                  value={prompt}
                  placeholder={t('editPlanPlaceholder')}
                  disabled={extracting}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                {extracted && !error && (
                  <p className="mt-2 text-xs text-ink-400" data-testid="extract-plan-hint">
                    {t('extractPlanHint')}
                  </p>
                )}
                {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    data-testid="extract-plan-from-run"
                    onClick={extractFromRun}
                  >
                    {extracting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    {t('extractPlanFromRun')}
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" disabled={busy} onClick={close}>
                      {t('cancel')}
                    </Button>
                    <Button type="submit" disabled={busy || !prompt.trim()}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t('rebuildPlan')}
                    </Button>
                  </div>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </PlanEditContext.Provider>
  );
}
