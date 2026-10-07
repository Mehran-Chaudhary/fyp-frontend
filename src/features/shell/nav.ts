import {
  Bot,
  ChartColumn,
  Database,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  MessagesSquare,
  ScrollText,
  Settings,
  UserRoundSearch,
  Users,
  Wrench, Activity, ClipboardCheck, Gauge, BarChart3,
  type LucideIcon,
} from 'lucide-react';

export type SectionKey =
  | 'chat'
  | 'agents'
  | 'playground'
  | 'workflows'
  | 'tools'
  | 'runs'
  | 'approvals'
  | 'command-centre'
  | 'governance'
  | 'documents'
  | 'supervision'
  | 'usage'
  | 'audit'
  | 'team'
  | 'settings';

export interface SectionDefinition {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  /** Visible when the member holds any of these (spec §5.4). */
  anyOf: string[];
  phase: number;
  group: 'main' | 'build' | 'govern';
  summary: string;
  bullets: string[];
}

/**
 * Sections from phases up to this one are built; later ones are labelled as planned
 * and make no backend calls (Phase 1 spec §5 "Permission-driven UI"). Phases follow
 * the five-phase delivery plan (docs/FRONTEND_PHASES.md).
 */
export const LIVE_PHASE = 5;

/**
 * Workspace sections. A section shows a "planned" page until its phase ships; the
 * permission that reveals it is final.
 */
export const SECTIONS: Record<SectionKey, SectionDefinition> = {
  tools: { key: 'tools', label: 'Tools', icon: Wrench, anyOf: ['tool:read'], phase: 5, group: 'build', summary: 'Define and test governed integrations.', bullets: ['Built-in and HTTP tools', 'Data policy and execution ledger'] },
  runs: { key: 'runs', label: 'Runs', icon: Activity, anyOf: ['workflow:read'], phase: 5, group: 'main', summary: 'Live workflow execution and recovery.', bullets: ['Step timelines and protected content', 'Cancel, resume, and trace runs'] },
  approvals: { key: 'approvals', label: 'Approvals', icon: ClipboardCheck, anyOf: ['workflow:approve'], phase: 5, group: 'main', summary: 'Human decisions for workflow steps.', bullets: ['Clearance-aware requests', 'Audited approval and rejection'] },
  'command-centre': { key: 'command-centre', label: 'Command Centre', icon: BarChart3, anyOf: ['usage:read'], phase: 5, group: 'govern', summary: 'Workspace activity and performance.', bullets: ['Usage, runs, tools and documents', 'Trends, rankings and security events'] },
  governance: { key: 'governance', label: 'Governance', icon: Gauge, anyOf: ['usage:read', 'quota:manage', 'agent:read', 'llm:invoke', 'agent:execute'], phase: 5, group: 'govern', summary: 'Token quotas and agent circuit breakers.', bullets: ['Live consumption and quota history', 'Review and reset paused agents'] },
  chat: {
    key: 'chat',
    label: 'Chat',
    icon: MessagesSquare,
    anyOf: ['conversation:read'],
    phase: 4,
    group: 'main',
    summary: 'Talk to the agents published to you and watch answers stream in, with citations to the documents behind them.',
    bullets: [
      'Answers grounded in the knowledge bases you can read',
      'Personal data masked before any model sees it',
      'Every source cited and linked',
    ],
  },
  agents: {
    key: 'agents',
    label: 'AI agents',
    icon: Bot,
    anyOf: ['agent:read'],
    phase: 4,
    group: 'build',
    summary:
      "Build digital employees: give each one a persona, a system prompt, a model, and exactly the knowledge it's allowed to use.",
    bullets: [
      'Persona, tone and system prompt editor with version history',
      'Models chosen from the workspace allowlist',
      'Knowledge-base access, limited by role and data classification',
    ],
  },
  playground: {
    key: 'playground',
    label: 'Playground',
    icon: FlaskConical,
    anyOf: ['llm:invoke'],
    phase: 4,
    group: 'build',
    summary: 'Talk to a model directly, without an agent, to compare models and see personal-data masking at work.',
    bullets: ['System prompt and sampling controls', 'Streaming or whole answers', 'A masking report for every reply'],
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
  supervision: {
    key: 'supervision',
    label: 'Supervision',
    icon: UserRoundSearch,
    anyOf: ['conversation:read_all'],
    phase: 4,
    group: 'govern',
    summary: "Review everyone's conversations with personal data masked. Every view is audited.",
    bullets: ['Masked titles and messages', 'Reveal only with pii:reveal, behind a confirmation', 'Owner and agent filters'],
  },
  usage: {
    key: 'usage',
    label: 'Usage',
    icon: ChartColumn,
    anyOf: ['usage:read'],
    phase: 4,
    group: 'govern',
    summary: 'Model calls, tokens, latency and masking overhead across the workspace.',
    bullets: ['Outcomes from completed to throttled', 'Latency percentiles and time to first token', 'By model and by agent'],
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
    // Each settings tab has its own read permission (Phase 2 spec §3); any one reveals the section.
    // Models (Phase 4 §5.8) is readable with llm:invoke, llm:manage or agent:read.
    anyOf: ['workspace:read', 'security:read', 'apikey:read', 'pii:policy:read', 'llm:invoke', 'llm:manage', 'agent:read'],
    phase: 2,
    group: 'govern',
    summary:
      'Workspace profile, processing defaults, security policy and privacy: required two-step verification, IP allowlists, API keys and the redaction policy.',
    bullets: [
      'Name, description, chunking defaults and audit retention',
      'Require two-step verification or a verified email for every member',
      'Network allowlists, scoped API keys, ownership transfer',
    ],
  },
};

export const HOME_NAV = { label: 'Dashboard', icon: LayoutDashboard };

/** Labels for the path segment after a section, for the breadcrumb. */
export const SUBSECTION_LABELS: Record<string, string> = {
  members: 'Members',
  invitations: 'Invitations',
  roles: 'Roles',
  general: 'General',
  defaults: 'Defaults',
  security: 'Security',
  networks: 'Networks',
  'api-keys': 'API keys',
  privacy: 'Privacy',
  models: 'Models',
  danger: 'Danger zone',
};

/** Workspace pages outside any section, by their path segment (breadcrumb label). */
export const STANDALONE_PAGES: Record<string, string> = {
  'my-workspace-profile': 'Your workspace profile',
};

/**
 * Pages that belong to a section without having their own nav item, for the
 * breadcrumb (Documents › Knowledge bases, Documents › Search).
 */
export const PAGE_PARENTS: Record<string, { parent: SectionKey; label: string }> = {
  'knowledge-bases': { parent: 'documents', label: 'Knowledge bases' },
  search: { parent: 'documents', label: 'Search' },
};

/** `label: null`: the items sit right under the dashboard, without a heading. */
export const NAV_GROUPS: Array<{ key: 'main' | 'build' | 'govern'; label: string | null; sections: SectionKey[] }> = [
  { key: 'main', label: null, sections: ['chat', 'runs', 'approvals'] },
  { key: 'build', label: 'Build', sections: ['agents', 'playground', 'tools', 'workflows', 'documents'] },
  { key: 'govern', label: 'Govern', sections: ['command-centre', 'supervision', 'usage', 'governance', 'audit', 'team', 'settings'] },
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
