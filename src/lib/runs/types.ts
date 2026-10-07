import type { Classification } from '@/lib/api/types';
type UUID = string;
type ISODate = string;
type Integrity = 'TRUSTED' | 'UNTRUSTED';
type NodeType = 'trigger' | 'agent' | 'tool' | 'retrieval' | 'condition' | 'supervisor' | 'approval' | 'output';

// ── Runs ────────────────────────────────────────────────────────────────────

export type RunStatus = 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
export type StepStatus = 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
export type FailureClass = 'TRANSIENT' | 'PERMANENT' | 'TIMEOUT' | 'POLICY';

export interface Run {
  id: UUID;
  workflowId: UUID;
  workflowVersion: number;
  status: RunStatus;
  trigger: 'MANUAL' | 'API';
  initiatorUserId: UUID | null;
  initiatorApiKeyId: UUID | null;
  classification: Classification;  // the most sensitive data the run touched
  integrity: Integrity;
  maxSteps: number;
  stepsScheduled: number;
  maxTokens: number;
  tokensUsed: number;
  toolCalls: number;
  errorCode: string | null;
  errorStepId: UUID | null;
  createdAt: ISODate;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  deadlineAt: ISODate;
  duplicate?: boolean;            // returned for a repeated idempotency key
}
export interface StepApproval {
  requestedAt: ISODate;
  expiresAt: ISODate;
  decision?: 'approved' | 'rejected';
  decidedAt?: ISODate;
  decidedBy?: 'person' | 'timeout';
  decidedById?: UUID | null;
}
export interface StepToolCall { executionId: UUID; tool: string; status: 'ok' | 'error' | 'denied'; code?: string; reason?: string; durationMs: number }
export interface Step {
  id: UUID;
  nodeId: string;
  nodeType: NodeType;
  iteration: number;
  status: StepStatus;
  handles: string[];              // the outcome taken: which edges are live
  predecessors: string[];         // "nodeId#iteration"
  attempt: number;
  maxAttempts: number;
  classification: Classification;
  integrity: Integrity;
  agentId: UUID | null;
  agentVersion: number | null;
  toolId: UUID | null;
  toolVersion: number | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  toolCalls: StepToolCall[];
  errorCode: string | null;
  failureClass: FailureClass | null;
  deadLettered: boolean;
  approval: StepApproval | null;
  inputBytes: number;
  outputBytes: number;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  durationMs: number | null;
  createdAt: ISODate;
}
export interface RunDetail extends Run { steps: Step[] }

export interface StartRunInput { input: Record<string, unknown>; idempotencyKey?: string; version?: number }

export type ContentState = 'VISIBLE' | 'MASKED' | 'WITHHELD';
export type RunWithheldReason = 'CLEARANCE' | 'COMPARTMENT' | 'SOURCE_DELETED' | 'REDACTION_UNAVAILABLE' | 'NOT_AVAILABLE';
export interface ContentView {
  contentState: ContentState;
  withheldReason?: RunWithheldReason;
  input?: unknown;                // null when withheld
  output?: unknown;
  classification: Classification;
}

export interface ApprovalItem {
  runId: UUID;
  stepId: UUID;
  workflowId: UUID;
  nodeId: string;
  requestedAt: ISODate;
  expiresAt: ISODate;
  initiatorUserId: UUID | null;
  classification: Classification;
  message: string | null;         // null when you are not cleared for the step's label
  canDecide: boolean;
}
export interface ApprovalDecisionInput { decision: 'approve' | 'reject'; comment?: string }

export interface DeadLetter {
  runId: UUID;
  stepId: UUID;
  workflowId: UUID;
  workflowVersion: number;
  nodeId: string;
  nodeType: NodeType;
  iteration: number;
  attempts: number;
  errorCode: string | null;
  failureClass: FailureClass | null;
  deadLetteredAt: ISODate;
  runStatus: RunStatus;
}
export interface RunTrace { runId: UUID; complete: boolean; problems: string[]; trace: Record<string, unknown> }

// ── Real-time ───────────────────────────────────────────────────────────────

export interface ReadyPayload { organizationId: UUID; rooms: string[]; expiresAt: number | null; serverTime: ISODate }
export type EventDatum = string | number | boolean | null | string[] | number[];
export type RealtimeEventType =
  | 'run.started' | 'run.resumed' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.timed_out'
  | 'step.queued' | 'step.started' | 'step.retrying' | 'step.completed' | 'step.failed' | 'step.skipped'
  | 'step.waiting_approval' | 'tool.called' | 'tool.denied' | 'approval.requested' | 'approval.decided';
export interface RealtimeEvent {
  id: string;                     // stream position "<ms>-<seq>": keep the newest for resume
  type: RealtimeEventType;
  organizationId: UUID;
  at: ISODate;
  runId?: UUID;
  workflowId?: UUID;
  stepId?: UUID;
  nodeId?: string;
  initiatorUserId?: UUID;
  data: Record<string, EventDatum>;
}
export type NotificationKind = 'agent_email' | 'quota.threshold' | 'quota.exhausted' | 'agent.circuit_opened';
export interface NotificationEvent {
  id: string;
  type: 'notification';
  organizationId: UUID;
  at: ISODate;
  runId?: UUID;
  data: { kind: NotificationKind } & Record<string, EventDatum>;
}
export type Ack<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; code: string; message: string };
export type SubscribeAck = Ack<{ runId: UUID; replayed: number; events: RealtimeEvent[] }>;
export type ResumeAck = Ack<{ replayed: number; events: Array<RealtimeEvent | NotificationEvent> }>;
export type RefreshAck = Ack<{ expiresAt: number }>;

