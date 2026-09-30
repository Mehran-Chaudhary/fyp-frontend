/**
 * The filename from a Content-Disposition header: the RFC 5987 `filename*` (UTF-8)
 * first, then `filename`. The backend sends both, and the plain one has non-ASCII
 * characters replaced by `_` ("Überblick.md" arrives as "_berblick.md"), so the
 * extended one must win (Phase 3 spec §2.4, Appendix B).
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      // A malformed escape: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}
