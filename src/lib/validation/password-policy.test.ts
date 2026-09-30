import { describe, expect, it } from 'vitest';
import { containsSequence, evaluatePassword, personalDataFragments, scorePassword } from './password-policy';
import { slugify, slugPreview } from './slug';

const failing = (password: string, personal?: string[]) =>
  evaluatePassword(password, personal)
    .rules.filter((rule) => !rule.passed)
    .map((rule) => rule.id);

describe('evaluatePassword (mirrors the server policy, spec §10)', () => {
  it('accepts a password that meets every rule', () => {
    expect(evaluatePassword('Vault-Garden-2931').valid).toBe(true);
  });

  it('requires length, lowercase, uppercase and a number; not a symbol', () => {
    expect(failing('short1A')).toContain('minLength');
    expect(failing('ALLUPPERCASE123')).toContain('lowercase');
    expect(failing('alllowercase123')).toContain('uppercase');
    expect(failing('NoNumbersHereAtAll')).toContain('number');
    expect(evaluatePassword('NoSymbolsNeeded2931').valid).toBe(true);
  });

  it('rejects over-long passwords', () => {
    expect(failing(`Aa1${'x'.repeat(130)}`)).toContain('maxLength');
  });

  it('rejects common passwords (exact, case-insensitive)', () => {
    expect(failing('Password123')).toContain('notCommon');
    expect(failing('Password123!')).toContain('notCommon');
    // Containing a common word is fine; only exact matches are refused.
    expect(failing('Password123-river-Kite')).not.toContain('notCommon');
  });

  it('rejects runs of four identical characters', () => {
    expect(failing('Xaaaa-River-2931')).toContain('noRuns');
    expect(failing('Xaaa-River-2931')).not.toContain('noRuns');
  });

  it('rejects ascending or descending sequences of five', () => {
    expect(failing('River-12345-Kite')).toContain('noSequences');
    expect(failing('River-edcba-Kite9')).toContain('noSequences');
    expect(failing('River-ABCDE-Kite9')).toContain('noSequences');
    expect(failing('River-1234-Kite')).not.toContain('noSequences');
  });

  it('checks personal data only when it is given (sign-up)', () => {
    expect(failing('Hanbal-River-2931')).not.toContain('noPersonal');
    expect(failing('Hanbal-River-2931', ['ahmad.hanbal@example.com', 'Ahmad', 'Hanbal'])).toContain('noPersonal');
    // Fragments under 3 characters and the email domain are ignored.
    expect(failing('Example-River-2931', ['al@example.com', 'Al', 'Bo'])).not.toContain('noPersonal');
  });
});

describe('helpers', () => {
  it('splits personal data into meaningful fragments', () => {
    expect(personalDataFragments(['ahmad.hanbal@example.com'])).toEqual(['ahmad.hanbal', 'ahmad', 'hanbal']);
  });

  it('detects sequences', () => {
    expect(containsSequence('xx56789')).toBe(true);
    expect(containsSequence('13579')).toBe(false);
  });

  it('scores like the server', () => {
    expect(scorePassword('')).toBe(0);
    expect(scorePassword('abcdefghijkl')).toBe(1);
    expect(scorePassword('Abcdefghijk1')).toBe(2);
    expect(scorePassword('Abcdefghijklmno1')).toBe(3);
    expect(scorePassword('Abcdefghijklmnopqrs1')).toBe(4);
    expect(scorePassword('password123')).toBe(0);
  });
});

describe('slugify (same rule as the server)', () => {
  it('folds diacritics and collapses separators', () => {
    expect(slugify('Anwältin GmbH')).toBe('anwaltin-gmbh');
    expect(slugify('  Zara   Labs!! ')).toBe('zara-labs');
    expect(slugify('Acme -- Corp')).toBe('acme-corp');
  });

  it('cuts to 60 characters without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('leaves the preview empty when too short', () => {
    expect(slugPreview('A')).toBe('');
    expect(slugPreview('日本')).toBe('');
    expect(slugPreview('AB')).toBe('ab');
  });
});
