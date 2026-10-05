import {
  Bot,
  Database,
  GitBranch,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type SectionKey = 'agents' | 'workflows' | 'documents' | 'audit' | 'team' | 'settings';

export interface SectionDefinition {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  /** Visible when the member holds any of these (spec §5.4). */
  anyOf: string[];
  phase: number;
  group: 'build' | 'govern';
  summary: string;
  bullets: string[];
}

/**
 * Sections from phases up to this one are built; later ones are labelled as planned
 * and make no backend calls (Phase 1 spec §5 "Permission-driven UI"). Phases follow
 * the five-phase delivery plan (docs/FRONTEND_PHASES.md).
 */
export const LIVE_PHASE = 3;

/**
 * Workspace sections. A section shows a "planned" page until its phase ships; the
 * permission that reveals it is final.
 */
export const SECTIONS: Record<SectionKey, SectionDefinition> = {
  agents: {
    key: 'agents',
    label: 'AI agents',
    icon: Bot,
    anyOf: ['agent:read'],
    phase: 4,
    group: 'build',
    summary:
      "Build digital employees: give each one a persona, a system prompt, a locally hosted model, and exactly the knowledge and tools it's allowed to use.",
    bullets: [
      'Persona, tone and system prompt editor with version history',
      'Choice of local models served through Ollama',
      'Knowledge-base and tool access, limited by role and data classification',
    ],
  },
  workflows: {
    key: 'workflows',
    label: 'Workflows',
    icon: GitBranch,
    anyOf: ['workflow:read'],
    phase: 5,
    group: 'build',
    summary:
      'Chain agents, tools and data sources on a visual canvas, then run them as background jobs that hand work from one agent to the next.',
    bullets: [
      'Drag-and-drop canvas for agents, tools, triggers and outputs',
      'Supervisor routing between agents over an encrypted queue',
      'Retries, timeouts and a dead-letter queue for failed steps',
    ],
  },
  documents: {
    key: 'documents',
    label: 'Documents',
    icon: Database,
    anyOf: ['knowledgebase:read', 'document:read'],
    phase: 3,
    group: 'build',
    summary:
      'Upload PDFs, Word files and text into access-controlled knowledge bases, and follow each one through parsing, chunking, embedding and PII redaction.',
    bullets: [
      'Knowledge bases open to the workspace or restricted to roles',
      'Live pipeline status from upload to searchable',
      'A per-document PII report before anything reaches a model',
    ],
  },
  audit: {
    key: 'audit',
    label: 'Audit logs',
    icon: ScrollText,
    anyOf: ['audit:read'],
    phase: 5,
    group: 'govern',
    summary:
      'An immutable record of every agent action, tool call, data access, permission denial and redaction, filterable for compliance reviews.',
    bullets: [
      'Tamper-evident trail of user and agent activity',
      'Filters by actor, action, resource and time',
      'Security events such as denied access and blocked networks',
    ],
  },
  team: {
    key: 'team',
    label: 'Team',
    icon: Users,
    // member:read per the spec; role:read alone still reaches the Roles tab.
    anyOf: ['member:read', 'role:read'],
    phase: 2,
    group: 'govern',
    summary: 'See who is in this workspace, invite people, and decide what each of them can do.',
    bullets: [
      'Member directory with roles, status and last activity',
      'Email invitations with a chosen role',
      'Custom roles such as "HR Manager" built from 64 permissions',
    ],
  },
  settings: {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    // workspace:read per the spec; apikey:read alone still reaches the API keys tab.
    anyOf: ['workspace:read', 'apikey:read'],
    phase: 2,
    group: 'govern',
    summary: 'Workspace profile and security policy: required two-step verification, IP allowlists and API keys.',
    bullets: [
      'Name, description and audit retention',
      'Require two-step verification for every member',
      'Network allowlists and scoped API keys',
    ],
  },
};

export const HOME_NAV = { label: 'Dashboard', icon: LayoutDashboard };

/** Labels for the path segment after a section, for the breadcrumb. */
export const SUBSECTION_LABELS: Record<string, string> = {
  members: 'Members',
  invitations: 'Invitations',
  roles: 'Roles',
  security: 'Security',
  'api-keys': 'API keys',
};

/**
 * Pages that belong to a section without having their own nav item, for the
 * breadcrumb (Documents › Knowledge bases, Documents › Search).
 */
export const PAGE_PARENTS: Record<string, { parent: SectionKey; label: string }> = {
  'knowledge-bases': { parent: 'documents', label: 'Knowledge bases' },
  search: { parent: 'documents', label: 'Search' },
};

export const NAV_GROUPS: Array<{ key: 'build' | 'govern'; label: string; sections: SectionKey[] }> = [
  { key: 'build', label: 'Build', sections: ['agents', 'workflows', 'documents'] },
  { key: 'govern', label: 'Govern', sections: ['audit', 'team', 'settings'] },
];

/** Friendly names for the permission catalogue's categories. */
export const PERMISSION_CATEGORY_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  members: 'Members',
  access_control: 'Access control',
  security: 'Security',
  observability: 'Audit & usage',
  knowledge: 'Knowledge',
  clearance: 'Document clearance',
  agents: 'Agents',
  workflows: 'Workflows',
  tools: 'Tools',
  privacy: 'Privacy',
};
