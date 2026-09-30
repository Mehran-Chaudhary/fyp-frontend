import { describe, expect, it } from 'vitest';
import { DEFAULT_VAULT_FILTERS, hasActiveFilters, readVaultFilters, sortPresetOf, toDocumentListParams, writeVaultFilters } from './filters';

const params = (query: string) => new URLSearchParams(query);

describe('vault filters in the URL', () => {
  it('reads defaults from an empty query', () => {
    expect(readVaultFilters(params(''))).toEqual(DEFAULT_VAULT_FILTERS);
  });

  it('reads every filter and ignores invalid values', () => {
    expect(readVaultFilters(params('kb=abc&status=indexing&classification=confidential&q=policy&sort=title&page=3'))).toEqual({
      kb: 'abc',
      status: 'indexing',
      classification: 'CONFIDENTIAL',
      q: 'policy',
      sort: 'title',
      dir: 'asc',
      page: 3,
    });
    expect(readVaultFilters(params('status=done&classification=top-secret&sort=rank&page=-2'))).toEqual(DEFAULT_VAULT_FILTERS);
  });

  it('goes back to page 1 on any change but the page', () => {
    const next = writeVaultFilters(params('page=4&q=leave'), { status: 'failed' });
    expect(next.get('page')).toBeNull();
    expect(next.get('status')).toBe('failed');
    expect(next.get('q')).toBe('leave');
  });

  it('keeps defaults and natural directions out of the URL', () => {
    expect(writeVaultFilters(params(''), { sort: 'createdAt', dir: 'desc' }).toString()).toBe('');
    expect(writeVaultFilters(params(''), { sort: 'title', dir: 'asc' }).toString()).toBe('sort=title');
    expect(writeVaultFilters(params(''), { sort: 'title', dir: 'desc' }).toString()).toBe('sort=title&dir=desc');
  });

  it('keeps unrelated parameters', () => {
    expect(writeVaultFilters(params('upload=1'), { q: 'x' }).get('upload')).toBe('1');
  });
});

describe('toDocumentListParams', () => {
  it('sends "Indexing" as three statuses in one parameter (BF-18)', () => {
    const filters = readVaultFilters(params('status=indexing'));
    expect(toDocumentListParams(filters, null).status).toEqual(['PARSING', 'CHUNKING', 'EMBEDDING']);
  });

  it('only sends a knowledge-base filter that is a valid id', () => {
    const filters = readVaultFilters(params('kb=not-a-uuid'));
    expect(toDocumentListParams(filters, null).knowledgeBaseId).toBeUndefined();
    expect(toDocumentListParams(filters, '8df97318-db90-49a0-8a1a-6d34cef3a182').knowledgeBaseId).toBe(
      '8df97318-db90-49a0-8a1a-6d34cef3a182',
    );
  });

  it('maps sorting and paging', () => {
    const filters = readVaultFilters(params('sort=sizeBytes&page=2'));
    expect(toDocumentListParams(filters, null)).toMatchObject({ page: 2, limit: 20, sortBy: 'sizeBytes', sortDirection: 'DESC' });
    expect(sortPresetOf(filters)?.label).toBe('Largest');
  });

  it('knows when filters are active', () => {
    expect(hasActiveFilters(DEFAULT_VAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters(readVaultFilters(params('classification=public')))).toBe(true);
  });
});
