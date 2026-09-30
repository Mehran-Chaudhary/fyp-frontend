import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Classification, KnowledgeBase } from '@/lib/api/types';
import {
  assignableClassifications,
  canOnKnowledgeBase,
  clearanceOf,
  KNOWLEDGE_PERMISSION_KEYS,
  lacksPermissionFor,
  type KnowledgeAction,
} from '@/lib/knowledge/access';
import { capabilityBlocked, useKnowledgeLayer, type KnowledgeCapability, type LayerGap } from '@/lib/knowledge/layer';
import { allKnowledgeBasesQuery } from '@/lib/queries';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

export interface KnowledgeAccess {
  /** The knowledge permissions you hold, as concrete keys. */
  permissions: ReadonlySet<string>;
  /** Your clearance (§3.3); equals E77's `clearance`. */
  clearance: Classification;
  /** Classifications you may assign: upload, reclassify, a base's default. */
  assignable: Classification[];
  /** The owner bypasses compartments and never loses access to a base. */
  isOwner: boolean;
  /** For the self-lockout guard (§6.7). */
  membershipId: string;
  roleIds: string[];
  has: (permission: string) => boolean;
  /** §3.5: the permissions and at least the level on this base. */
  can: (action: KnowledgeAction, knowledgeBase: Pick<KnowledgeBase, 'access'> | null | undefined) => boolean;
  /** The role permission is missing altogether: hide the control rather than disable it. */
  lacks: (action: KnowledgeAction) => boolean;
}

/**
 * The UI rules of §3.7, computed once per render of the workspace. The permission
 * snapshot may hold wildcards (`document:*`), so each key is resolved through
 * `can()`, which also means unknown permissions allow everything (the server decides).
 */
export function useKnowledgeAccess(): KnowledgeAccess {
  const workspace = useWorkspace();
  const can = useCan();
  const membership = workspace.membership;

  return useMemo(() => {
    const permissions: ReadonlySet<string> = new Set(KNOWLEDGE_PERMISSION_KEYS.filter((key) => can(key)));
    return {
      permissions,
      clearance: clearanceOf(permissions),
      assignable: assignableClassifications(permissions),
      isOwner: membership.isOwner,
      membershipId: membership.id,
      roleIds: membership.roles.map((role) => role.id),
      has: (permission) => permissions.has(permission),
      can: (action, knowledgeBase) => !!knowledgeBase && canOnKnowledgeBase(action, knowledgeBase, permissions),
      lacks: (action) => lacksPermissionFor(action, permissions),
    };
  }, [can, membership]);
}

/** What the knowledge layer can't do on this server (§6.9), for this workspace. */
export function useLayerGap(): { gap: LayerGap | undefined; blocked: (capability: KnowledgeCapability) => boolean } {
  const workspace = useWorkspace();
  const gap = useKnowledgeLayer((state) => state.gaps[workspace.id]);
  return useMemo(() => ({ gap, blocked: (capability: KnowledgeCapability) => capabilityBlocked(gap, capability) }), [gap]);
}

/**
 * Every knowledge base you can read (E60, all pages), with a lookup by id. The
 * sidebar, the vault's filters, names in tables and the statistics all share it.
 */
export function useKnowledgeBases(options: { enabled?: boolean } = {}) {
  const workspace = useWorkspace();
  const can = useCan();
  const query = useQuery({
    ...allKnowledgeBasesQuery(workspace.id),
    enabled: can('knowledgebase:read') && (options.enabled ?? true),
  });
  const byId = useMemo(() => new Map((query.data ?? []).map((knowledgeBase) => [knowledgeBase.id, knowledgeBase])), [query.data]);
  return { ...query, list: query.data ?? [], byId };
}
