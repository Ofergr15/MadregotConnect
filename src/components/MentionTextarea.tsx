'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { useApi } from '@/lib/api';
import { mentionToken } from '@/lib/feed/mentions';
import { FeedAvatar } from '@/components/FeedAvatar';

interface DiscoverAthlete {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * A plain textarea with "@name" mention autocomplete — typing "@" opens a
 * roster search (reusing /api/athletes/discover, the same endpoint Member
 * Discovery already uses), and picking someone inserts the structured
 * `@[Name](athleteId)` token the server actually parses (see
 * src/lib/feed/mentions.ts) rather than plain "@name" text, which would be
 * ambiguous the moment two athletes share a name.
 */
export function MentionTextarea({
  value,
  onChange,
  viewerId,
  placeholder,
  className,
  style,
  autoFocus,
  rows,
  onKeyDown,
  autoGrow,
  autoGrowMax = 120,
}: {
  value: string;
  onChange: (value: string) => void;
  viewerId: string | null;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  autoGrow?: boolean;
  autoGrowMax?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [queryStart, setQueryStart] = useState(0);

  // The route takes the viewer from the session, so viewerId is out of the URL.
  // It stays as part of the fetch gate: a mention list is only useful once we
  // know who's typing, and this keeps the "don't fetch yet" timing unchanged.
  const { data } = useApi<{ athletes: DiscoverAthlete[] }>(
    query !== null && viewerId ? '/api/athletes/discover' : null,
  );
  const suggestions = (data?.athletes || [])
    .filter((a) => a.name.toLowerCase().includes((query || '').toLowerCase()))
    .slice(0, 5);

  // "@" immediately before the cursor, with no whitespace between them, is
  // an active mention search — the captured text after "@" is the query.
  // Anything else (no "@", or the nearest "@" already has a space after it)
  // means no autocomplete should be showing.
  const detectMention = (text: string, cursorPos: number) => {
    const upToCursor = text.slice(0, cursorPos);
    const match = upToCursor.match(/@([^\s@]*)$/);
    if (match) {
      setQuery(match[1]);
      setQueryStart(cursorPos - match[1].length - 1);
    } else {
      setQuery(null);
    }
  };

  const pickAthlete = (athlete: DiscoverAthlete) => {
    const queryLength = query?.length ?? 0;
    const before = value.slice(0, queryStart);
    const after = value.slice(queryStart + 1 + queryLength);
    const token = mentionToken(athlete.name, athlete.id);
    onChange(`${before}${token} ${after}`);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + token.length + 1;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detectMention(e.target.value, e.target.selectionStart);
          if (autoGrow) {
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, autoGrowMax)}px`;
          }
        }}
        onClick={(e) => detectMention(value, e.currentTarget.selectionStart)}
        onKeyUp={(e) => detectMention(value, e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        style={style}
      />
      {query !== null && suggestions.length > 0 && (
        <div className="absolute z-20 start-0 end-0 top-full mt-1 bg-card border border-page rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => pickAthlete(a)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-page text-start"
            >
              <FeedAvatar name={a.name} url={a.avatarUrl} className="w-7 h-7 shrink-0" />
              <span className="text-sm text-ink-700 truncate" dir="auto">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
