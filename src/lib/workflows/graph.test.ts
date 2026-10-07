import { describe, expect, it } from 'vitest';
import { ancestors, canLoop, changeRuleOperator, jsonDraftErrors, loopBodyExecutions, nextNodeId, normalizeGraph, settingsErrors, sourceHandles, templateSuggestions } from './graph';
import type { WorkflowGraph } from './types';

const graph: WorkflowGraph = {
  schemaVersion: 1,
  nodes: [
    { id: 'start', type: 'trigger', data: { inputSchema: { properties: { amount: { type: 'number' } } } } },
    { id: 'calc', type: 'tool', data: { arguments: { value: '{{input.amount}}' } }, position: { x: 1.7, y: 20.2 } },
    { id: 'check', type: 'condition', data: { rules: [{ id: 'again', value: '{{nodes.calc.output}}', operator: 'lt', operand: 5 }] } },
    { id: 'end', type: 'output', data: {} },
  ],
  edges: [{ id: 'a', source: 'start', target: 'calc' }, { id: 'b', source: 'calc', target: 'check' }, { id: 'c', source: 'check', sourceHandle: 'else', target: 'end' }],
};

describe('workflow graph safety', () => {
  it('offers only ancestors for template completion, including typed input fields', () => {
    const values = templateSuggestions(graph, 'check');
    expect(values).toContain('{{input.amount}}');
    expect(values).toContain('{{nodes.calc.output}}');
    expect(values).not.toContain('{{nodes.end.output}}');
    expect(values).not.toContain('{{nodes.check.output}}');
  });
  it('only permits condition rule back edges to ancestors', () => {
    expect(canLoop(graph, { id: 'loop', source: 'check', sourceHandle: 'again', target: 'calc' })).toBe(true);
    expect(canLoop(graph, { id: 'loop', source: 'check', sourceHandle: 'else', target: 'calc' })).toBe(false);
    expect(canLoop(graph, { id: 'loop', source: 'check', sourceHandle: 'again', target: 'end' })).toBe(false);
    expect(canLoop(graph, { id: 'loop', source: 'calc', sourceHandle: 'error', target: 'start' })).toBe(false);
  });
  it('traverses invalid cyclic drafts without hanging or exposing the node itself', () => {
    expect([...ancestors({ ...graph, edges: [...graph.edges, { id: 'bad', source: 'check', target: 'start' }] }, 'check')]).toEqual(['calc', 'start']);
  });
  it('numeric conditions remain numbers and unary changes discard operands', () => {
    const rule = changeRuleOperator({ id: 'r', value: '{{input.amount}}', operator: 'equals', operand: '9' }, 'gt');
    expect(rule.operand).toBe(0);
    expect(changeRuleOperator(rule, 'is_true')).not.toHaveProperty('operand');
  });
  it('keeps ids and arguments intact while normalising canvas-only values', () => {
    const saved = normalizeGraph(graph);
    expect(saved.nodes[1]).toEqual({ ...graph.nodes[1], position: { x: 2, y: 20 } });
    expect(saved.nodes[1].data.arguments).toEqual({ value: '{{input.amount}}' });
    expect(nextNodeId('tool', [{ id: 'tool', type: 'tool', data: {} }, { id: 'tool_2', type: 'tool', data: {} }])).toBe('tool_3');
  });
  it('includes error outcomes on retrieval and supervisors and rules on conditions', () => {
    expect(sourceHandles({ id: 'r', type: 'retrieval', data: {} })).toContain('error');
    expect(sourceHandles({ id: 's', type: 'supervisor', data: {} })).toContain('error');
    expect(sourceHandles(graph.nodes[2])).toEqual(['again', 'else']);
  });
  it('counts the initial loop body execution before the bounded repeats', () => {
    expect(loopBodyExecutions(2)).toBe(3);
    expect(loopBodyExecutions(1)).toBe(2);
  });
  it('rejects invalid resource limits without assuming deployment-specific ceilings', () => {
    expect(settingsErrors({ maxSteps: 1, maxTokens: 999, runTimeoutMs: 999 })).toEqual({ maxSteps: expect.any(String), maxTokens: expect.any(String), runTimeoutMs: expect.any(String) });
    expect(settingsErrors({ maxSteps: 10001, maxTokens: Number.NaN, runTimeoutMs: Infinity })).toEqual({ maxSteps: expect.any(String), maxTokens: expect.any(String), runTimeoutMs: expect.any(String) });
    expect(settingsErrors({ maxSteps: 2.5 })).toHaveProperty('maxSteps');
    expect(settingsErrors({ maxSteps: 10000, maxTokens: 100000000, runTimeoutMs: 1800000 })).toEqual({});
    expect(settingsErrors({})).toEqual({});
  });
  it('detects incomplete JSON to prevent silently saving the previous valid value', () => {
    expect(jsonDraftErrors({ 'tool:arguments': '{"amount":', 'agent:outputSchema': '{}' })).toEqual([['tool:arguments', '{"amount":']]);
  });
  it('keeps invalid condition drafts inspectable when their rule collection is malformed', () => {
    expect(sourceHandles({ id: 'bad', type: 'condition', data: { rules: 'unfinished' } })).toEqual(['else']);
  });
});
