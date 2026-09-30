/** Colour helpers for user-chosen role colours (hex strings from the server). */

/** Role colour presets: muted, readable colours that sit well on the paper background. */
export const ROLE_COLOR_PRESETS = [
  '#206c55',
  '#0ea5e9',
  '#3e6bb0',
  '#6366f1',
  '#8b5cf6',
  '#c026d3',
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#64748b',
] as const;

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX_PATTERN.test(value);
}

/** '#0ea5e9' → [14, 165, 233]; '#abc' is expanded first. */
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!isHexColor(hex)) return null;
  let digits = hex.slice(1);
  if (digits.length === 3) digits = digits.split('').map((d) => d + d).join('');
  const value = Number.parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 'rgb(14 165 233 / 0.12)' for tinted backgrounds, or undefined for an invalid colour. */
export function withAlpha(hex: string | null | undefined, alpha: number): string | undefined {
  const rgb = hex ? hexToRgb(hex) : null;
  return rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})` : undefined;
}

/** Lowercase six-digit form, for comparing and storing. */
export function normaliseHex(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
