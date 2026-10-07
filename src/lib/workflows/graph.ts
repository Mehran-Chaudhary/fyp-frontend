import type { ConditionOperator, ConditionRule, GraphEdge, GraphNode, NodeTypeDescriptor, WorkflowGraph, WorkflowNodeType, WorkflowSettings } from './types';

export const conditionOperators: ConditionOperator[] = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte', 'is_true', 'is_false', 'is_empty', 'is_not_empty'];
export const numericOperator = (operator: ConditionOperator) => ['gt', 'gte', 'lt', 'lte'].includes(operator);
export const unaryOperator = (operator: ConditionOperator) => operator.startsWith('is_');
export const jsonDraftErrors = (drafts: Record<string, string>) => Object.entries(drafts).filter(([, text]) => { try { JSON.parse(text); return false; } catch { return true; } });
/** DTO bounds only. The server further clamps these to its configured platform ceilings. */
export function settingsErrors(settings: WorkflowSettings): Partial<Record<keyof WorkflowSettings, string>> {
  const errors: Partial<Record<keyof WorkflowSettings, string>> = {};
  if (settings.maxSteps !== undefined && (!Number.isInteger(settings.maxSteps) || settings.maxSteps < 2 || settings.maxSteps > 10000)) errors.maxSteps = 'Use a whole number from 2 to 10,000.';
  if (settings.maxTokens !== undefined && (!Number.isInteger(settings.maxTokens) || settings.maxTokens < 1000 || settings.maxTokens > 100000000)) errors.maxTokens = 'Use a whole number from 1,000 to 100,000,000.';
  if (settings.runTimeoutMs !== undefined && (!Number.isSafeInteger(settings.runTimeoutMs) || settings.runTimeoutMs < 1000)) errors.runTimeoutMs = 'Use a whole number of at least 1,000 milliseconds.';
  return errors;
}

export const loopBodyExecutions = (maxIterations: number) => maxIterations + 1;
export function changeRuleOperator(rule: ConditionRule, operator: ConditionOperator): ConditionRule {
  const { operand, ...rest } = rule;
  return { ...rest, operator, ...(!unaryOperator(operator) ? { operand: numericOperator(operator) ? (typeof operand === 'number' ? operand : 0) : operand ?? '' } : {}) };
}

export function sourceHandles(node: GraphNode, descriptor?: NodeTypeDescriptor): string[] {
  if (node.type === 'condition') return [...(Array.isArray(node.data?.rules) ? node.data.rules as ConditionRule[] : []).flatMap((rule) => typeof rule?.id === 'string' && rule.id ? [rule.id] : []), 'else'];
  if (descriptor) return descriptor.outputs;
  switch (node.type) {
    case 'trigger': return ['out'];
    case 'agent': case 'tool': case 'retrieval': return ['out', 'error'];
    case 'supervisor': return ['worker', 'done', 'error'];
    case 'approval': return ['approved', 'rejected'];
    case 'output': return [];
    default: return [];
  }
}

/** Stable human-readable ids survive reorders, dragging, undo, save and restore. */
export function nextNodeId(type: WorkflowNodeType, nodes: readonly GraphNode[]) {
  const used = new Set(nodes.map((node) => node.id));
  if (!used.has(type)) return type;
  let index = 2;
  while (used.has(`${type}_${index}`)) index += 1;
  return `${type}_${index}`;
}

export function defaultNodeData(type: WorkflowNodeType): Record<string, unknown> {
  switch (type) {
    case 'trigger': return { inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false } };
    case 'agent': return { agentId: '', prompt: '{{input.input}}', useTools: false, output: { format: 'text' } };
    case 'tool': return { toolId: '', arguments: {} };
    case 'retrieval': return { query: '{{input.input}}', topK: 5 };
    case 'condition': return { rules: [{ id: 'match', value: '{{input.input}}', operator: 'is_not_empty' }] };
    case 'supervisor': return { strategy: 'round_robin', maxRounds: 3 };
    case 'approval': return { message: 'Please review this request: {{input.input}}', onTimeout: 'reject', allowSelfApproval: false };
    case 'output': return {};
  }
}

export function ancestors(graph: WorkflowGraph, nodeId: string): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const edge of graph.edges) {
      if (edge.target !== id || edge.data?.loop || edge.source === nodeId || result.has(edge.source)) continue;
      result.add(edge.source);
      visit(edge.source);
    }
  };
  visit(nodeId);
  return result;
}

/** Only a condition rule can loop to its own predecessor, never else/error/out. */
export function canLoop(graph: WorkflowGraph, edge: GraphEdge): boolean {
  const source = graph.nodes.find((node) => node.id === edge.source);
  return source?.type === 'condition' && ((source.data.rules ?? []) as ConditionRule[]).some((rule) => rule.id === edge.sourceHandle) && ancestors({ ...graph, edges: graph.edges.filter((candidate) => candidate.id !== edge.id) }, source.id).has(edge.target);
}

function schemaPaths(schema: unknown, prefix: string, depth = 0): string[] {
  if (!schema || typeof schema !== 'object' || depth > 3) return [];
  const object = schema as Record<string, unknown>;
  if (object.type === 'array') return [`${prefix}[0]`, ...schemaPaths(object.items, `${prefix}[0]`, depth + 1)];
  if (!object.properties || typeof object.properties !== 'object') return [];
  return Object.entries(object.properties).flatMap(([name, child]) => [`${prefix}.${name}`, ...schemaPaths(child, `${prefix}.${name}`, depth + 1)]);
}

export function templateSuggestions(graph: WorkflowGraph, nodeId: string): string[] {
  const trigger = graph.nodes.find((node) => node.type === 'trigger');
  const input = ['input', ...schemaPaths(trigger?.data.inputSchema ?? { properties: { input: {} } }, 'input')];
  const upstream = ancestors(graph, nodeId);
  return [...input, ...graph.nodes.filter((node) => upstream.has(node.id)).flatMap((node) => {
    const root = `nodes.${node.id}.output`;
    const output = node.data.output as { schema?: unknown } | undefined;
    return [root, ...schemaPaths(output?.schema, root)];
  })].map((path) => `{{${path}}}`);
}

/** Strip UI state before sending the graph; node data is preserved even in invalid drafts. */
export function normalizeGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: graph.nodes.map(({ id, type, label, position, data }) => ({ id, type, ...(label ? { label } : {}), ...(position ? { position: { x: Math.round(position.x), y: Math.round(position.y) } } : {}), data })),
    edges: graph.edges.map(({ id, source, target, sourceHandle, data }) => ({ id, source, target, ...(sourceHandle && sourceHandle !== 'out' ? { sourceHandle } : {}), ...(data?.loop ? { data: { loop: data.loop } } : {}) })),
    ...(graph.viewport ? { viewport: graph.viewport } : {}),
  };
}
