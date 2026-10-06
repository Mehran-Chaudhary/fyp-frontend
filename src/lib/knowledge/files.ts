import type { DocumentFileType } from '../api/types';

/** The server's accepted extensions (UPLOAD_ALLOWED_TYPES pdf,docx,txt,md). */
export const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'text', 'md', 'markdown'] as const;
/** For `<input type="file" accept=…>`. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
/** UPLOAD_MAX_FILE_SIZE, 50 MB in binary units. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Refuse more than this many files per drop (the upload budget is 100 per hour, §5 "Upload"). */
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

const FILENAME_MAX = 200;

/**
 * The name the server stores for an upload (P3-API-09): the client path is dropped,
 * control characters become spaces, `"*:<>?|` become `_`, leading dots go, and long
 * names are cut to 200 characters keeping a short extension. Verified example:
 * `C:\fakepath\quarterly "draft".txt` → `quarterly _draft_.txt`.
 */
export function sanitizeUploadFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  let cleaned = '';
  for (const character of base.normalize('NFC')) {
    const code = character.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  let name = cleaned
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/["*:<>?|]/g, '_')
    .replace(/^\.+/, '');
  if (name.length > FILENAME_MAX) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = `${name.slice(0, FILENAME_MAX - extension.length)}${extension}`;
  }
  return name || 'document';
}

/** The title the server gives an upload sent without one. */
export const defaultUploadTitle = (filename: string): string => filenameStem(sanitizeUploadFilename(filename));

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

/**
 * The number of bytes a 64-bit count (sent as a decimal string, spec §2) stands
 * for, for display. Counts past Number.MAX_SAFE_INTEGER are scaled with BigInt
 * first, so the shown size stays right even where a plain Number would round.
 */
function bytesForDisplay(value: string | number): { bytes: number; scaled: number } {
  if (typeof value === 'number') return { bytes: value, scaled: 0 };
  let big: bigint;
  try {
    big = BigInt(value.trim() || 'x');
  } catch {
    return { bytes: Number.NaN, scaled: 0 };
  }
  let scaled = 0;
  while (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    big /= 1024n;
    scaled += 1;
  }
  return { bytes: Number(big), scaled };
}

/** For `sizeBytes` / `totalBytes` (strings) and numbers. Binary units, like the server. */
export function formatBytes(value: string | number): string {
  const { bytes, scaled } = bytesForDisplay(value);
  if (!Number.isFinite(bytes) || (scaled === 0 && bytes < 1024)) return `${Number.isFinite(bytes) ? bytes : 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let size = scaled === 0 ? bytes / 1024 : bytes;
  let unit = scaled === 0 ? 0 : scaled - 1;
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
