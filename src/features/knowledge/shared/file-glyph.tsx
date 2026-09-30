import type { DocumentFileType } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const TYPES: Readonly<Record<DocumentFileType | 'OTHER', { label: string; fill: string; stroke: string; text: string }>> = {
  PDF: { label: 'PDF', fill: '#fbefeb', stroke: '#e7c3b8', text: '#9a3b2a' },
  DOCX: { label: 'DOC', fill: '#edf2f9', stroke: '#c7d6ea', text: '#2a4a79' },
  TXT: { label: 'TXT', fill: '#f4f2ed', stroke: '#d9d4c9', text: '#57534a' },
  MARKDOWN: { label: 'MD', fill: '#eaf3ee', stroke: '#c3dccf', text: '#1f5a47' },
  OTHER: { label: '?', fill: '#f4f2ed', stroke: '#d9d4c9', text: '#8f8a80' },
};

/** A small sheet of paper with a folded corner and the file type on it. */
export function FileGlyph({
  type,
  className,
  size = 'md',
}: {
  type: DocumentFileType | null | undefined;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const style = TYPES[type ?? 'OTHER'];
  const dimensions = size === 'sm' ? 'h-7 w-[22px]' : size === 'lg' ? 'h-11 w-9' : 'h-9 w-7';
  return (
    <svg viewBox="0 0 28 36" aria-hidden className={cn('shrink-0', dimensions, className)}>
      <path
        d="M4 .75h14.2L27.25 9.8V32A3.25 3.25 0 0 1 24 35.25H4A3.25 3.25 0 0 1 .75 32V4A3.25 3.25 0 0 1 4 .75Z"
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth="1.5"
      />
      <path d="M18 1v6.2A2.8 2.8 0 0 0 20.8 10H27" fill="none" stroke={style.stroke} strokeWidth="1.5" />
      <text
        x="14"
        y="26.5"
        textAnchor="middle"
        fontSize={style.label.length > 2 ? 7.4 : 8.4}
        fontWeight="700"
        letterSpacing="0.3"
        fill={style.text}
        fontFamily="Geist Variable, ui-sans-serif, system-ui, sans-serif"
      >
        {style.label}
      </text>
    </svg>
  );
}
