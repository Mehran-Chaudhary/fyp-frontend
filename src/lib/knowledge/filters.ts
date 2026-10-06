import type { Classification, DocumentSortField, ListDocumentsParams } from '../api/types';
import { CLASSIFICATIONS } from './access';
import { STATUS_GROUP_ORDER, STATUS_GROUPS, type StatusGroup } from './status';

/**
 * The vault's filters live in the URL (Phase 3 spec §5), so a view can be shared,
 * reloaded and survives opening a document's drawer:
 * `?kb=&status=&classification=&q=&sort=&dir=&page=`.
 *
 * `status` is a multi-select of lifecycle groups (`status=queued,processing` is
 * "In progress"). Links written before the groups existed (`indexed`, `indexing`,
 * `pending`) still work.
 */
export type SortDir = 'asc' | 'desc';

export interface VaultFilters {
  kb: string | null;
  /** Empty: any status. Always in lifecycle order, without duplicates. */
  status: StatusGroup[];
  classification: Classification | null;
  q: string;
  sort: DocumentSortField;
  dir: SortDir;
  page: number;
}

export const VAULT_PAGE_SIZE = 20;

/** The groups that make up "In progress" (spec §5: UPLOADED, PARSING, CHUNKING, EMBEDDING). */
export const IN_PROGRESS_GROUPS: readonly StatusGroup[] = ['queued', 'processing'];

/** Status words from older links, mapped to the groups. */
const LEGACY_STATUS: Readonly<Record<string, StatusGroup>> = {
  pending: 'queued',
  indexing: 'processing',
  indexed: 'ready',
};

const SORTS: readonly DocumentSortField[] = ['createdAt', 'updatedAt', 'title', 'sizeBytes', 'status'];

export const DEFAULT_VAULT_FILTERS: VaultFilters = {
  kb: null,
  status: [],
  classification: null,
  q: '',
  sort: 'createdAt',
  dir: 'desc',
  page: 1,
};

/** The direction a sort field starts in: dates and sizes newest/largest first, text A–Z. */
export const naturalDir = (field: DocumentSortField): SortDir =>
  field === 'createdAt' || field === 'updatedAt' || field === 'sizeBytes' ? 'desc' : 'asc';

/** Groups in lifecycle order without duplicates; every group selected means "any status". */
export function normalizeStatusGroups(groups: readonly StatusGroup[]): StatusGroup[] {
  const set = new Set(groups);
  const ordered = STATUS_GROUP_ORDER.filter((group) => set.has(group));
  return ordered.length === STATUS_GROUP_ORDER.length ? [] : ordered;
}

function readStatus(raw: string | null): StatusGroup[] {
  if (!raw) return [];
  const groups: StatusGroup[] = [];
  for (const part of raw.split(',')) {
    const word = part.trim().toLowerCase();
    if ((STATUS_GROUP_ORDER as readonly string[]).includes(word)) groups.push(word as StatusGroup);
    else if (LEGACY_STATUS[word]) groups.push(LEGACY_STATUS[word]);
  }
  return normalizeStatusGroups(groups);
}

export function readVaultFilters(params: URLSearchParams): VaultFilters {
  const sort = params.get('sort') as DocumentSortField | null;
  const classification = params.get('classification')?.toUpperCase() as Classification | undefined;
  const page = Number.parseInt(params.get('page') ?? '', 10);
  const validSort = sort && SORTS.includes(sort) ? sort : 'createdAt';
  const dir = params.get('dir');
  return {
    kb: params.get('kb') || null,
    status: readStatus(params.get('status')),
    classification: classification && CLASSIFICATIONS.includes(classification) ? classification : null,
    q: (params.get('q') ?? '').slice(0, 200),
    sort: validSort,
    dir: dir === 'asc' || dir === 'desc' ? dir : naturalDir(validSort),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Applies a change; any change other than the page goes back to page 1 (spec §5). Unrelated params are kept. */
export function writeVaultFilters(previous: URLSearchParams, patch: Partial<VaultFilters>): URLSearchParams {
  const next = { ...readVaultFilters(previous), ...(patch.page === undefined ? { page: 1 } : null), ...patch };
  const params = new URLSearchParams(previous);
  const set = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key));
  const status = normalizeStatusGroups(next.status);
  set('kb', next.kb);
  set('status', status.length ? status.join(',') : null);
  set('classification', next.classification ? next.classification.toLowerCase() : null);
  set('q', next.q.trim() || null);
  const isDefaultSort = next.sort === 'createdAt' && next.dir === 'desc';
  set('sort', isDefaultSort ? null : next.sort);
  set('dir', isDefaultSort || next.dir === naturalDir(next.sort) ? null : next.dir);
  set('page', next.page > 1 ? String(next.page) : null);
  return params;
}

export function hasActiveFilters(filters: VaultFilters): boolean {
  return !!filters.q.trim() || filters.status.length > 0 || !!filters.classification || !!filters.kb;
}

/** Whether exactly the "In progress" groups are selected. */
export const isInProgressFilter = (groups: readonly StatusGroup[]): boolean =>
  groups.length === IN_PROGRESS_GROUPS.length && IN_PROGRESS_GROUPS.every((group) => groups.includes(group));

/** Toggles one group in a multi-select. */
export function toggleStatusGroup(groups: readonly StatusGroup[], group: StatusGroup): StatusGroup[] {
  return normalizeStatusGroups(groups.includes(group) ? groups.filter((value) => value !== group) : [...groups, group]);
}

/** The P3-API-10 query for these filters. `validKb` is the kb filter once it's known to be a UUID. */
export function toDocumentListParams(filters: VaultFilters, validKb: string | null): ListDocumentsParams {
  const statuses = filters.status.flatMap((group) => STATUS_GROUPS[group]);
  return {
    page: filters.page,
    limit: VAULT_PAGE_SIZE,
    ...(validKb ? { knowledgeBaseId: validKb } : {}),
    ...(statuses.length ? { status: statuses } : {}),
    ...(filters.classification ? { classification: filters.classification } : {}),
    ...(filters.q.trim() ? { search: filters.q.trim() } : {}),
    sortBy: filters.sort,
    sortDirection: filters.dir === 'asc' ? 'ASC' : 'DESC',
  };
}

/** The sort menu (spec §5): each entry is a field and a direction. */
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
