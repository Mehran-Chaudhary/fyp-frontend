import type { DocumentFileType } from '../api/types';

/** The server's accepted extensions (UPLOAD_ALLOWED_TYPES pdf,docx,txt,md). */
export const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'text', 'md', 'markdown'] as const;
/** For `<input type="file" accept=…>`. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
/** UPLOAD_MAX_FILE_SIZE, 50 MB in binary units. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Refuse more than this many files per drop (the upload budget is 100 per hour, §6.2). */
export const MAX_FILES_PER_DROP = 100;

export type PrecheckProblem =
  | { code: 'EMPTY'; message: string }
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'TYPE_NOT_ALLOWED'; message: string };

/** Same extension rule as the server: the text after the last dot, not counting a leading dot. */
export function fileExtension(name: string): string {
  const base = name.replace(/^\.+/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** "Q1 review.final.pdf" → "Q1 review.final": what the server uses as the title when none is sent. */
export function filenameStem(name: string): string {
  const base = name.replace(/^\.+/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Problems the server would certainly refuse. The server still inspects the content. */
export function precheckFile(file: Pick<File, 'name' | 'size'>, maxBytes = MAX_UPLOAD_BYTES): PrecheckProblem | null {
  const extension = fileExtension(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      code: 'TYPE_NOT_ALLOWED',
      message: extension
        ? `.${extension} files aren't accepted. Use PDF, Word (.docx), text or Markdown.`
        : "This file has no extension, so its type can't be confirmed.",
    };
  }
  if (file.size === 0) return { code: 'EMPTY', message: 'The file is empty.' };
  if (file.size > maxBytes) return { code: 'TOO_LARGE', message: `Larger than the ${formatBytes(maxBytes)} limit.` };
  return null;
}

/** The document type a file will most likely get, from its extension (for icons before upload). */
export function fileTypeFromName(name: string): DocumentFileType | null {
  switch (fileExtension(name)) {
    case 'pdf':
      return 'PDF';
    case 'docx':
      return 'DOCX';
    case 'txt':
    case 'text':
      return 'TXT';
    case 'md':
    case 'markdown':
      return 'MARKDOWN';
    default:
      return null;
  }
}

/** For `sizeBytes` / `totalBytes` (strings) and numbers. Binary units, like the server. */
export function formatBytes(value: string | number): string {
  const bytes = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Number.isFinite(bytes) ? bytes : 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? Math.round(size) : Math.round(size * 10) / 10} ${units[unit]}`;
}

/** Adds up 64-bit byte counts sent as strings without losing precision. */
export function sumBytes(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    try {
      total += BigInt(value);
    } catch {
      // A malformed count is skipped rather than poisoning the total.
    }
  }
  return total.toString();
}
