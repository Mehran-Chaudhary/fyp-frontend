import { clsx, type ClassValue } from 'clsx';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "Sara Khan" → "SK", "zara@example.com" → "ZA". */
export function initials(name: string | null | undefined, fallback = '?'): string {
  const source = (name ?? '').trim();
  if (!source) return fallback;
  const base = source.includes('@') ? source.split('@')[0] : source;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  return isValid(date) ? date : null;
}

/** "Sep 29, 2026" */
export function formatDate(value: string | number | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'MMM d, yyyy') : fallback;
}

/** "Sep 29, 2026, 8:34 PM" */
export function formatDateTime(value: string | number | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'MMM d, yyyy, p') : fallback;
}

/** "8:50 PM" in the viewer's locale. */
export function formatTime(value: string | number | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'p') : fallback;
}

/** "3 minutes ago" */
export function formatRelative(value: string | number | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  if (!date) return fallback;
  if (Math.abs(Date.now() - date.getTime()) < 45_000) return 'just now';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** 754 → "12:34", 3725 → "1:02:05" */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const ACRONYMS = new Set(['hr', 'it', 'ai', 'qa', 'ui', 'ux', 'pii', 'api', 'ceo', 'cto', 'cfo', 'cio', 'ciso', 'pr', 'rnd', 'sre']);

/** Title-case a slug for display fallbacks: "hr-manager" → "HR Manager". */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (ACRONYMS.has(part.toLowerCase()) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Stable small hash for deterministic decorative choices (workspace tiles). */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadTextFile(filename: string, contents: string, type = 'text/plain'): void {
  const blob = new Blob([contents], { type: `${type};charset=utf-8` });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * An image URL that is safe to put in `src`: absolute http(s) only. Profile
 * avatars are free text on the server (the DTO doesn't check URL syntax), so
 * anything else, `javascript:` and `data:` included, falls back to initials.
 */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The current time, for event handlers that record when something was sent. */
export function timestamp(): number {
  return Date.now();
}
