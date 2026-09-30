import { useMemo, type ReactNode } from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Text with the query's words marked, case-insensitively. Line breaks are kept by the caller's CSS. */
export function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  const parts = useMemo<ReactNode[]>(() => {
    if (terms.length === 0) return [text];
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu');
    return text.split(pattern).map((part, index) =>
      index % 2 === 1 ? (
        <mark key={index} className="rounded-[3px] bg-warning-100 px-0.5 text-ink">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  }, [text, terms]);
  return <>{parts}</>;
}
