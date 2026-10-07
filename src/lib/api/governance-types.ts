import type { UsageSummary } from './types';

export interface AuditLog {
  id: string; sequence: string; action: string; status: string; severity: string;
  actorType: string; actorId: string | null; actorLabel: string | null;
  resourceType: string | null; resourceId: string | null; resourceLabel: string | null;
  ipAddress: string | null; userAgent: string | null; requestId: string | null;
  httpMethod: string | null; httpPath: string | null; httpStatus: number | null;
  durationMs: number | null; errorCode: string | null; errorMessage: string | null;
  metadata: Record<string, unknown>; createdAt: string;
}
export interface AuditStatistics {
  totalRecords: string; headSequence: string; bySeverity: Record<string, number>;
  byStatus: Record<string, number>; topActions: Array<{ action: string; count: number }>;
}
export interface ChainVerification {
  organizationId: string; valid: boolean; recordsChecked: number; brokenAtSequence?: string;
  brokenRecordId?: string; reason?: string; verifiedAt: string; prunedThroughSequence?: string; anchors?: number;
}
export interface AuditArchive {
  sequence: string; firstSequence: string; recordsPruned: number; cutoff: string;
  archived: boolean; archiveSha256: string | null; createdAt: string;
}
export interface AuditFilters {
  action?: string; actionPrefix?: string; severity?: string; status?: string; actorType?: string;
  actorId?: string; resourceType?: string; resourceId?: string; requestId?: string;
  ipAddress?: string; from?: string; to?: string; page?: number; limit?: number;
}
export interface TimeWindow { from: string; to: string }
export interface AnalyticsOverview extends TimeWindow {
  inference: UsageSummary;
  activity: { activeMembers: number; activeApiKeys: number; activeAgents: number; conversationsStarted: number; turns: number };
  workflows: { runs: number; completed: number; failed: number; cancelled: number; timedOut: number; active: number; durationP50Ms: number | null; durationP95Ms: number | null; tokens: number; deadLetters: number };
  tools: { calls: number; succeeded: number; failed: number; timedOut: number; denied: number; denialsByReason: Record<string, number> };
  knowledge: { documentsByStatus: Record<string, number>; storedBytes: number; retrievalQueries: number; withheldEvents: number };
  privacy: { entitiesMasked: number; entitiesByType: Record<string, number>; egressBlocked: number; refusedForRedaction: number; degradedRedactions: number };
  governance: { throttledCalls: number; budgetExhaustions: number; rateLimitEvents: number; circuitBreaks: number; openCircuits: number; budgetsNearLimit: number };
  security: { bySeverity: Record<string, number>; topAlerts: Array<{ action: string; count: number }>; failedSignIns: number; accessDenials: number };
}
export type SeriesMetric = 'tokens' | 'invocations' | 'throttled' | 'failures' | 'latency_p95' | 'ttft_p95' | 'redaction_p95' | 'entities_masked' | 'workflow_runs' | 'workflow_failures' | 'tool_calls' | 'tool_denials' | 'security_events' | 'rag_queries';
export interface Timeseries extends TimeWindow { metric: SeriesMetric; interval: 'hour' | 'day'; points: Array<{ at: string; value: number | null }> }
export type TopDimension = 'agents' | 'models' | 'members' | 'api_keys';
export interface TopEntry { key: string | null; label: string | null; invocations: number; tokens: number; throttled: number }
export interface SecurityEvent {
  id: string; at: string; action: string; severity: 'WARNING' | 'CRITICAL'; status: string;
  actorType: string; actorLabel: string | null; resourceType: string | null; resourceId: string | null;
  errorCode: string | null; ipAddress: string | null; requestId: string | null;
}
export type QuotaScope = 'ORGANIZATION' | 'MEMBER' | 'AGENT' | 'API_KEY';
export type QuotaPeriod = 'MINUTE' | 'DAY' | 'MONTH';
export interface Quota {
  id: string; scope: QuotaScope; subjectId: string | null; period: QuotaPeriod;
  tokenLimit: number; enforcement: 'HARD' | 'SOFT'; alertThreshold: number;
  managedBy: 'WORKSPACE' | 'PLATFORM'; label: string | null;
  usage: { used: number; reserved: number; remaining: number; percent: number; periodStart: string; resetsAt: string } | null;
  rate: { available: number | null } | null;
}
export interface CreateQuotaInput {
  scope: QuotaScope; subjectId?: string; period: QuotaPeriod; tokenLimit: number;
  enforcement?: 'HARD' | 'SOFT'; alertThreshold?: number; label?: string;
}
export interface UpdateQuotaInput { tokenLimit?: number; enforcement?: 'HARD' | 'SOFT'; alertThreshold?: number; label?: string | null }
export interface QuotaHistoryEntry { periodStart: string; tokensUsed: number; requests: number; rejected: number; alertedAt: string | null; exhaustedAt: string | null }
export interface AgentCircuit { agentId: string; state: 'closed' | 'open'; reason?: 'RUNAWAY_SPEND' | 'REPEATED_FAILURES'; openedAt?: string; retryAt?: string }
