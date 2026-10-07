export type WorkflowNodeType = 'trigger' | 'agent' | 'tool' | 'retrieval' | 'condition' | 'supervisor' | 'approval' | 'output';
export type JsonObject = Record<string, unknown>;
export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_true' | 'is_false' | 'is_empty' | 'is_not_empty';
export interface ConditionRule { id: string; value: string; operator: ConditionOperator; operand?: string | number | boolean; caseSensitive?: boolean }
export interface GraphNode { id: string; type: WorkflowNodeType; label?: string; position?: { x: number; y: number }; data: JsonObject }
export interface GraphEdge { id: string; source: string; target: string; sourceHandle?: string; data?: { loop?: { maxIterations: number; onExhausted?: 'fall_through' | 'fail' } } }
export interface WorkflowGraph { schemaVersion: 1; nodes: GraphNode[]; edges: GraphEdge[]; viewport?: { x: number; y: number; zoom: number } }
export interface NodeTypeDescriptor {
  type: WorkflowNodeType; label: string; description: string; outputs: string[];
  produces: 'json' | 'text' | 'passages' | 'none' | 'text-or-json'; multiple: boolean;
  fields: Array<{ name: string; type: 'uuid' | 'string' | 'template' | 'integer' | 'boolean' | 'enum' | 'object' | 'array' | 'json-schema'; required: boolean; description: string; options?: string[] }>;
}
export interface GraphIssue { code: string; message: string; nodeId?: string; edgeId?: string }
export interface ValidationReport { valid: boolean; errors: GraphIssue[]; warnings: GraphIssue[]; stepBound: number | null }
export interface WorkflowSettings { maxSteps?: number; maxTokens?: number; runTimeoutMs?: number }
export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export interface WorkflowVersion {
  version: number; graph: WorkflowGraph; settings: WorkflowSettings; digest: string; valid: boolean; validation: ValidationReport;
  changeNote: string | null; restoredFromVersion: number | null; createdById: string | null; createdAt: string; isCurrent: boolean; isPublished: boolean;
}
export interface WorkflowSummary {
  id: string; name: string; description: string | null; status: WorkflowStatus; currentVersion: number; publishedVersion: number | null;
  createdById: string | null; publishedAt: string | null; lastRunAt: string | null; createdAt: string; updatedAt: string;
}
export interface Workflow extends WorkflowSummary { definition: WorkflowVersion }
export interface ListWorkflowsParams { search?: string; status?: WorkflowStatus; page?: number; limit?: number }
export interface SaveDefinitionInput { graph: WorkflowGraph; settings?: WorkflowSettings; changeNote?: string; expectedVersion: number }
