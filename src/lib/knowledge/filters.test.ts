import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAULT_FILTERS,
  hasActiveFilters,
  isInProgressFilter,
  readVaultFilters,
  sortPresetOf,
  toDocumentListParams,
  toggleStatusGroup,
  writeVaultFilters,
} from './filters';

const params = (query: string) => new URLSearchParams(query);

describe('vault filters in the URL', () => {
  it('reads defaults from an empty query', () => {
    expect(readVaultFilters(params(''))).toEqual(DEFAULT_VAULT_FILTERS);
  });

  it('reads every filter and ignores invalid values', () => {
    expect(readVaultFilters(params('kb=abc&status=processing,failed&classification=confidential&q=policy&sort=title&page=3'))).toEqual({
      kb: 'abc',
      status: ['processing', 'failed'],
      classification: 'CONFIDENTIAL',
      q: 'policy',
      sort: 'title',
      dir: 'asc',
      page: 3,
    });
    expect(readVaultFilters(params('status=done&classification=top-secret&sort=rank&page=-2'))).toEqual(DEFAULT_VAULT_FILTERS);
  });

  it('still understands links from before the status groups', () => {
    expect(readVaultFilters(params('status=indexing')).status).toEqual(['processing']);
    expect(readVaultFilters(params('status=pending')).status).toEqual(['queued']);
    expect(readVaultFilters(params('status=indexed')).status).toEqual(['ready']);
  });

  it('keeps groups in lifecycle order; all four means any status', () => {
    expect(readVaultFilters(params('status=failed,queued,failed')).status).toEqual(['queued', 'failed']);
    expect(readVaultFilters(params('status=queued,processing,ready,failed')).status).toEqual([]);
  });

  it('goes back to page 1 on any change but the page', () => {
    const next = writeVaultFilters(params('page=4&q=leave'), { status: ['failed'] });
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

describe('status multi-select', () => {
  it('toggles groups and recognises "In progress"', () => {
    expect(toggleStatusGroup([], 'processing')).toEqual(['processing']);
    expect(toggleStatusGroup(['processing'], 'queued')).toEqual(['queued', 'processing']);
    expect(isInProgressFilter(['queued', 'processing'])).toBe(true);
    expect(toggleStatusGroup(['queued', 'processing'], 'processing')).toEqual(['queued']);
  });
});

describe('toDocumentListParams', () => {
  it('sends "In progress" as the four in-flight statuses in one parameter (spec §5)', () => {
    const filters = readVaultFilters(params('status=queued,processing'));
    expect(toDocumentListParams(filters, null).status).toEqual(['UPLOADED', 'PARSING', 'CHUNKING', 'EMBEDDING']);
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
    expect(hasActiveFilters(readVaultFilters(params('status=failed')))).toBe(true);
  });
});
