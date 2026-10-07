import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { buildToolInput, defaultPolicy, definitionIssues, parseTestArguments, policyWeakening, toolDraft, toolUpdate, validateToolSchema } from './editor';
import type { Tool } from './types';

const tool: Tool = { id: 'tool', kind: 'HTTP', name: 'order_lookup', displayName: 'Order lookup', description: 'Find an order using its reference.', parameters: { type: 'object', properties: { reference: { type: 'string' } } }, http: { method: 'GET', url: 'https://api.example.com/orders/{{reference}}', query: {}, headers: {}, auth: { type: 'bearer' } }, dataPolicy: defaultPolicy('GET'), resultIntegrity: 'EXTERNAL', requiresApproval: false, requiredPermissions: [], timeoutMs: 15000, version: 7, digest: 'digest', enabled: true, available: true, hasSecret: true };
describe('tool editor safeguards', () => {
  it('never rehydrates a write-only secret; keeps it by omission and uses the captured version', () => {
    const draft = toolDraft(tool);
    expect(draft.secret).toBe('');
    const checked = buildToolInput(draft);
    expect(checked.errors).toEqual({});
    expect(toolUpdate(tool, checked.body!, 'keep')).toEqual({ expectedVersion: 7 });
    expect(toolUpdate(tool, checked.body!, 'remove')).toEqual({ expectedVersion: 7, secret: null });
    draft.secretAction = 'replace'; draft.secret = 'new-credential';
    expect(toolUpdate(tool, buildToolInput(draft).body!, 'replace')).toEqual({ expectedVersion: 7, secret: 'new-credential' });
  });
  it('rejects reserved schema keywords recursively rather than silently dropping them', () => {
    expect(validateToolSchema({ type: 'object', properties: { q: { type: 'string', pattern: '^safe$' } } })).toContainEqual({ path: '/parameters/properties/q/pattern', message: 'Unsupported keyword “pattern”.' });
    expect(validateToolSchema(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'))).not.toEqual([]);
    expect(validateToolSchema({ type: 'array' })).not.toEqual([]);
  });
  it('does not bump behaviour for display-name edits or cosmetic schema key ordering', () => {
    const base = { ...tool, http: { method: 'GET' as const, url: tool.http!.url, auth: { type: 'bearer' as const } } };
    const draft = toolDraft(base);
    draft.displayName = 'New display name';
    draft.parameters = '{"properties":{"reference":{"type":"string"}},"type":"object"}';
    expect(toolUpdate(base, buildToolInput(draft).body!, 'keep')).toEqual({ expectedVersion: 7, displayName: 'New display name' });
  });
  it('allows arbitrary defaults and enums without treating their contents as schemas', () => {
    expect(validateToolSchema({ type: 'object', properties: { result: { type: 'object', default: { arbitrary: 'value' }, enum: [{ freeform: 3 }] } } })).toEqual([]);
  });
  it('requires every data-policy relaxation to be explicit', () => {
    expect(defaultPolicy('POST')).toEqual({ maxClassification: 'PUBLIC', minIntegrity: 'INTERNAL', piiArguments: 'deny', sideEffects: true });
    expect(policyWeakening(defaultPolicy('POST'), { maxClassification: 'INTERNAL', minIntegrity: 'EXTERNAL', piiArguments: 'unmask', sideEffects: false })).toHaveLength(4);
    expect(policyWeakening(defaultPolicy('GET'), { maxClassification: 'PUBLIC', minIntegrity: 'TRUSTED', piiArguments: 'deny', sideEffects: true })).toEqual([]);
  });
  it('maps server JSON pointer issues to editor paths without replacing their wording', () => {
    const error = new ApiError({ status: 422, code: 'TOOL_DEFINITION_INVALID', message: 'Invalid tool', details: { issues: [{ path: '/http/url', message: 'Ask the platform operator to add it.' }] } });
    expect(definitionIssues(error)).toEqual({ 'http.url': 'Ask the platform operator to add it.' });
  });
  it('rejects moving the HTTPS origin into parameters or credentials into URLs', () => {
    for (const url of ['http://example.com', 'https://{{host}}/path', 'https://user:password@example.com']) {
      expect(buildToolInput({ ...toolDraft(tool), url }).errors['http.url']).toBeTruthy();
    }
  });
  it('measures argument size in UTF-8 bytes and requires an object', () => {
    expect(parseTestArguments('{"expression":"5 * 7"}')).toEqual({ expression: '5 * 7' });
    for (const raw of ['null', '[]', 'true']) expect(() => parseTestArguments(raw)).toThrow('JSON object');
    expect(() => parseTestArguments(JSON.stringify({ text: '🧠'.repeat(5000) }))).toThrow('16 KB');
  });
});
