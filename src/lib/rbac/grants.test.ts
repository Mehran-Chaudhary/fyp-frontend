import { describe, expect, it } from 'vitest';
import { analyseGrants, diffKeys, isEmptyDiff, PERMISSION_KEY_PATTERN } from './grants';

const CATALOGUE = ['document:read', 'document:create', 'rag:query', 'pii:policy:read', 'pii:policy:update', 'pii:reveal'];

describe('analyseGrants', () => {
  it('keeps wildcards as stored and previews their expansion', () => {
    const analysis = analyseGrants(['document:*', 'rag:query'], CATALOGUE);
    expect(analysis.wildcards).toEqual(['document:*']);
    expect(analysis.inertWildcards).toEqual([]);
    expect(analysis.expanded).toEqual(['document:create', 'document:read', 'rag:query']);
  });

  it('treats pii:* as covering multi-colon keys but pii:policy:* as matching nothing', () => {
    expect(analyseGrants(['pii:*'], CATALOGUE).expanded).toEqual(['pii:policy:read', 'pii:policy:update', 'pii:reveal']);
    const inert = analyseGrants(['pii:policy:*'], CATALOGUE);
    expect(inert.inertWildcards).toEqual(['pii:policy:*']);
    expect(inert.expanded).toEqual([]);
  });

  it('keeps concrete keys the catalogue does not know', () => {
    const analysis = analyseGrants(['document:read', 'future:thing'], CATALOGUE);
    expect(analysis.unknown).toEqual(['future:thing']);
    expect(analysis.expanded).toContain('future:thing');
  });

  it('expands the super grant to the whole catalogue', () => {
    expect(analyseGrants(['*:*'], CATALOGUE).expanded).toHaveLength(CATALOGUE.length);
  });
});

describe('diffKeys', () => {
  it('reports additions and removals, sorted', () => {
    expect(diffKeys(['b', 'a', 'c'], ['c', 'd', 'a'])).toEqual({ added: ['d'], removed: ['b'] });
    expect(isEmptyDiff(diffKeys(['a', 'b'], ['b', 'a']))).toBe(true);
  });
});

describe('PERMISSION_KEY_PATTERN', () => {
  it('matches the DTO regex', () => {
    expect(PERMISSION_KEY_PATTERN.test('pii:policy:read')).toBe(true);
    expect(PERMISSION_KEY_PATTERN.test('document:*')).toBe(true);
    expect(PERMISSION_KEY_PATTERN.test('*:*')).toBe(true);
    expect(PERMISSION_KEY_PATTERN.test('*:read')).toBe(false);
    expect(PERMISSION_KEY_PATTERN.test('Document:read')).toBe(false);
  });
});
