export type ToolKind = 'BUILTIN' | 'HTTP';
export type Classification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type Integrity = 'TRUSTED' | 'INTERNAL' | 'EXTERNAL';
export type ToolHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type HttpAuth = { type: 'none' | 'bearer' } | { type: 'header'; headerName: string } | { type: 'basic'; username: string };
export interface HttpToolConfig {
  method: ToolHttpMethod; url: string; query?: Record<string, string>; headers?: Record<string, string>;
  body?: unknown; auth: HttpAuth; responsePath?: string;
}
export interface ToolDataPolicy {
  maxClassification: Classification; minIntegrity: Integrity; piiArguments: 'unmask' | 'deny'; sideEffects: boolean;
}
export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
export interface JsonSchema {
  $schema?: string; type?: JsonSchemaType | JsonSchemaType[]; title?: string; description?: string; enum?: unknown[];
  const?: unknown; default?: unknown; examples?: unknown[]; minLength?: number; maxLength?: number;
  format?: 'email' | 'uri' | 'uuid' | 'date' | 'date-time'; minimum?: number; maximum?: number;
  exclusiveMinimum?: number; exclusiveMaximum?: number; properties?: Record<string, JsonSchema>; required?: string[];
  additionalProperties?: boolean; items?: JsonSchema; minItems?: number; maxItems?: number; uniqueItems?: boolean;
}
export interface Tool {
  id: string; kind: ToolKind; name: string; displayName: string; description: string; parameters: JsonSchema;
  dataPolicy: ToolDataPolicy; resultIntegrity: Integrity; requiresApproval: boolean; requiredPermissions: string[];
  timeoutMs: number; version: number; digest: string; enabled: boolean; available: boolean; http?: HttpToolConfig;
  hasSecret?: boolean; createdAt?: string | null; updatedAt?: string | null;
}
export interface CreateToolInput {
  name: string; displayName: string; description: string; parameters: JsonSchema; http: HttpToolConfig;
  dataPolicy?: Partial<ToolDataPolicy>; requiresApproval?: boolean; timeoutMs?: number; enabled?: boolean; secret?: string;
}
export interface UpdateToolInput extends Partial<Omit<CreateToolInput, 'name' | 'secret'>> { secret?: string | null; expectedVersion?: number }
export type ToolExecutionStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'DENIED';
export interface ToolExecution {
  id: string; createdAt: string; completedAt: string | null; toolName: string; toolId: string | null;
  toolVersion: number | null; status: ToolExecutionStatus; denialReason: string | null; errorCode: string | null;
  agentId: string | null; conversationId: string | null; workflowRunId: string | null; workflowStepId: string | null;
  durationMs: number | null; resultBytes: number; contextClassification: Classification | null;
  contextIntegrity: Integrity | null; sideEffects: boolean; argumentsDigest: string | null;
}
export type ToolTestResult =
  | { status: 'ok'; executionId: string; durationMs: number; content: string; truncated: boolean }
  | { status: 'error' | 'denied'; executionId: string; durationMs: number; code: string; message: string };
export interface ListToolsParams { page?: number; limit?: number; kind?: ToolKind; search?: string }
export interface ToolLedgerParams { page?: number; limit?: number; toolId?: string; runId?: string }
