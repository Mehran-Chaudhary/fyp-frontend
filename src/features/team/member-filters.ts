import type { ListMembersParams, MemberSortField } from '@/lib/api/types';

/**
 * Members list filters, kept in the URL so a filtered view survives reloads, the
 * back button and opening a member's drawer.
 */
export type MemberStatusFilter = 'all' | 'active' | 'suspended' | 'removed';
export type SortDir = 'asc' | 'desc';

export interface MemberFilters {
  q: string;
  status: MemberStatusFilter;
  role: string | null;
  sort: MemberSortField;
  dir: SortDir;
  page: number;
}

export const PAGE_SIZE = 20;

const STATUSES: readonly MemberStatusFilter[] = ['all', 'active', 'suspended', 'removed'];
const SORTS: readonly MemberSortField[] = ['createdAt', 'joinedAt', 'name', 'email', 'status', 'lastActiveAt'];

export const DEFAULT_FILTERS: MemberFilters = { q: '', status: 'all', role: null, sort: 'createdAt', dir: 'desc', page: 1 };

export function readMemberFilters(params: URLSearchParams): MemberFilters {
  const status = params.get('status') as MemberStatusFilter | null;
  const sort = params.get('sort') as MemberSortField | null;
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    status: status && STATUSES.includes(status) ? status : 'all',
    role: params.get('role') || null,
    sort: sort && SORTS.includes(sort) ? sort : 'createdAt',
    dir: params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : sort && sort !== 'createdAt' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Applies a change; any change other than the page goes back to page 1. Unrelated params (e.g. `invite`) are kept. */
export function writeMemberFilters(previous: URLSearchParams, patch: Partial<MemberFilters>): URLSearchParams {
  const next = { ...readMemberFilters(previous), ...(patch.page === undefined ? { page: 1 } : null), ...patch };
  const params = new URLSearchParams(previous);
  const set = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key));
  set('q', next.q.trim() || null);
  set('status', next.status === 'all' ? null : next.status);
  set('role', next.role);
  const isDefaultSort = next.sort === 'createdAt' && next.dir === 'desc';
  set('sort', isDefaultSort ? null : next.sort);
  set('dir', isDefaultSort ? null : next.dir);
  set('page', next.page > 1 ? String(next.page) : null);
  return params;
}

export function hasActiveFilters(filters: MemberFilters): boolean {
  return !!filters.q.trim() || filters.status !== 'all' || !!filters.role;
}

/** The E37 query for these filters. */
export function toListParams(filters: MemberFilters, validRoleId: string | null): ListMembersParams {
  return {
    page: filters.page,
    limit: PAGE_SIZE,
    ...(filters.q.trim() ? { search: filters.q.trim() } : {}),
    ...(filters.status !== 'all' ? { status: filters.status.toUpperCase() as ListMembersParams['status'] } : {}),
    ...(validRoleId ? { roleId: validRoleId } : {}),
    sortBy: filters.sort,
    sortDirection: filters.dir === 'asc' ? 'ASC' : 'DESC',
  };
}
