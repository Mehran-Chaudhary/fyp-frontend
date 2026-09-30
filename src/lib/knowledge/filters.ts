import type { Classification, DocumentSortField, ListDocumentsParams } from '../api/types';
import { CLASSIFICATIONS } from './access';
import { BADGE_STATUSES, type VaultBadge } from './status';

/**
 * The vault's filters live in the URL (Phase 3 spec §5), so a view can be shared,
 * reloaded and survives opening a document's drawer:
 * `?kb=&status=&classification=&q=&sort=&dir=&page=`.
 */
export type StatusFilter = 'all' | 'indexed' | 'indexing' | 'pending' | 'failed';
export type SortDir = 'asc' | 'desc';

export interface VaultFilters {
  kb: string | null;
  status: StatusFilter;
  classification: Classification | null;
  q: string;
  sort: DocumentSortField;
  dir: SortDir;
  page: number;
}

export const VAULT_PAGE_SIZE = 20;

const STATUSES: readonly StatusFilter[] = ['all', 'indexed', 'indexing', 'pending', 'failed'];

/** The status filter's options, named after the mockup's badges. */
export const STATUS_FILTER_LABELS: Readonly<Record<StatusFilter, string>> = {
  all: 'Any status',
  indexed: 'Indexed',
  indexing: 'Indexing',
  pending: 'Pending',
  failed: 'Failed',
};
const SORTS: readonly DocumentSortField[] = ['createdAt', 'updatedAt', 'title', 'sizeBytes', 'status'];

export const DEFAULT_VAULT_FILTERS: VaultFilters = {
  kb: null,
  status: 'all',
  classification: null,
  q: '',
  sort: 'createdAt',
  dir: 'desc',
  page: 1,
};

/** The direction a sort field starts in: dates and sizes newest/largest first, text A–Z. */
export const naturalDir = (field: DocumentSortField): SortDir =>
  field === 'createdAt' || field === 'updatedAt' || field === 'sizeBytes' ? 'desc' : 'asc';

export function readVaultFilters(params: URLSearchParams): VaultFilters {
  const status = params.get('status') as StatusFilter | null;
  const sort = params.get('sort') as DocumentSortField | null;
  const classification = params.get('classification')?.toUpperCase() as Classification | undefined;
  const page = Number.parseInt(params.get('page') ?? '', 10);
  const validSort = sort && SORTS.includes(sort) ? sort : 'createdAt';
  const dir = params.get('dir');
  return {
    kb: params.get('kb') || null,
    status: status && STATUSES.includes(status) ? status : 'all',
    classification: classification && CLASSIFICATIONS.includes(classification) ? classification : null,
    q: (params.get('q') ?? '').slice(0, 200),
    sort: validSort,
    dir: dir === 'asc' || dir === 'desc' ? dir : naturalDir(validSort),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Applies a change; any change other than the page goes back to page 1. Unrelated params are kept. */
export function writeVaultFilters(previous: URLSearchParams, patch: Partial<VaultFilters>): URLSearchParams {
  const next = { ...readVaultFilters(previous), ...(patch.page === undefined ? { page: 1 } : null), ...patch };
  const params = new URLSearchParams(previous);
  const set = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key));
  set('kb', next.kb);
  set('status', next.status === 'all' ? null : next.status);
  set('classification', next.classification ? next.classification.toLowerCase() : null);
  set('q', next.q.trim() || null);
  const isDefaultSort = next.sort === 'createdAt' && next.dir === 'desc';
  set('sort', isDefaultSort ? null : next.sort);
  set('dir', isDefaultSort || next.dir === naturalDir(next.sort) ? null : next.dir);
  set('page', next.page > 1 ? String(next.page) : null);
  return params;
}

export function hasActiveFilters(filters: VaultFilters): boolean {
  return !!filters.q.trim() || filters.status !== 'all' || !!filters.classification || !!filters.kb;
}

const STATUS_BADGE: Readonly<Record<Exclude<StatusFilter, 'all'>, VaultBadge>> = {
  indexed: 'INDEXED',
  indexing: 'INDEXING',
  pending: 'PENDING',
  failed: 'FAILED',
};

/** The E69 query for these filters. `validKb` is the kb filter once it's known to be a UUID. */
export function toDocumentListParams(filters: VaultFilters, validKb: string | null): ListDocumentsParams {
  return {
    page: filters.page,
    limit: VAULT_PAGE_SIZE,
    ...(validKb ? { knowledgeBaseId: validKb } : {}),
    ...(filters.status !== 'all' ? { status: [...BADGE_STATUSES[STATUS_BADGE[filters.status]]] } : {}),
    ...(filters.classification ? { classification: filters.classification } : {}),
    ...(filters.q.trim() ? { search: filters.q.trim() } : {}),
    sortBy: filters.sort,
    sortDirection: filters.dir === 'asc' ? 'ASC' : 'DESC',
  };
}

/** The sort menu (§6.1): each entry is a field and a direction. */
export const SORT_PRESETS: ReadonlyArray<{ key: string; label: string; sort: DocumentSortField; dir: SortDir }> = [
  { key: 'newest', label: 'Newest', sort: 'createdAt', dir: 'desc' },
  { key: 'oldest', label: 'Oldest', sort: 'createdAt', dir: 'asc' },
  { key: 'title-asc', label: 'Title A–Z', sort: 'title', dir: 'asc' },
  { key: 'title-desc', label: 'Title Z–A', sort: 'title', dir: 'desc' },
  { key: 'largest', label: 'Largest', sort: 'sizeBytes', dir: 'desc' },
  { key: 'smallest', label: 'Smallest', sort: 'sizeBytes', dir: 'asc' },
  { key: 'updated', label: 'Recently updated', sort: 'updatedAt', dir: 'desc' },
  { key: 'status', label: 'Status', sort: 'status', dir: 'asc' },
];

export function sortPresetOf(filters: Pick<VaultFilters, 'sort' | 'dir'>) {
  return SORT_PRESETS.find((preset) => preset.sort === filters.sort && preset.dir === filters.dir) ?? null;
}
