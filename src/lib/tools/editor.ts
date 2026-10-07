import { isApiError } from '../api/errors';
import type { CreateToolInput, HttpAuth, JsonSchema, Tool, ToolDataPolicy, ToolHttpMethod, UpdateToolInput } from './types';

export const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
export const INTEGRITIES = ['TRUSTED', 'INTERNAL', 'EXTERNAL'] as const;
export const DEFAULT_SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
export type SecretAction = 'keep' | 'replace' | 'remove';
export interface ToolDraft {
  name: string; displayName: string; description: string; parameters: string; method: ToolHttpMethod; url: string;
  query: Array<[string, string]>; headers: Array<[string, string]>; body: string; authType: HttpAuth['type'];
  headerName: string; username: string; responsePath: string; timeoutMs: string; dataPolicy: ToolDataPolicy;
  requiresApproval: boolean; enabled: boolean; secretAction: SecretAction; secret: string;
}
export function defaultPolicy(method: ToolHttpMethod): ToolDataPolicy {
  return { maxClassification: 'PUBLIC', minIntegrity: method === 'GET' ? 'EXTERNAL' : 'INTERNAL', piiArguments: 'deny', sideEffects: method !== 'GET' };
}
export function toolDraft(tool?: Tool): ToolDraft {
  const http = tool?.http;
  return {
    name: tool?.name ?? '', displayName: tool?.displayName ?? '', description: tool?.description ?? '',
    parameters: JSON.stringify(tool?.parameters ?? DEFAULT_SCHEMA, null, 2), method: http?.method ?? 'GET', url: http?.url ?? '',
    query: Object.entries(http?.query ?? {}), headers: Object.entries(http?.headers ?? {}),
    body: http?.body === undefined ? '' : JSON.stringify(http.body, null, 2), authType: http?.auth.type ?? 'none',
    headerName: http?.auth.type === 'header' ? http.auth.headerName : '', username: http?.auth.type === 'basic' ? http.auth.username : '',
    responsePath: http?.responsePath ?? '', timeoutMs: String(tool?.timeoutMs ?? 15_000),
    dataPolicy: tool ? { ...tool.dataPolicy } : defaultPolicy('GET'), requiresApproval: tool?.requiresApproval ?? false,
    enabled: tool?.enabled ?? true, secretAction: 'keep', secret: '',
  };
}
const KEYWORDS = new Set(['$schema', 'type', 'title', 'description', 'enum', 'const', 'default', 'examples', 'minLength', 'maxLength', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems']);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
export interface SchemaIssue { path: string; message: string }
/** Validate the documented subset before handing the schema to the authoritative validator. */
export function validateToolSchema(value: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const walk = (node: unknown, path: string, depth: number) => {
    if (!isObject(node)) { add(path, 'Use a JSON object for each schema.'); return; }
    if (depth > 6) { add(path, 'Schemas may nest at most six levels.'); return; }
    for (const key of Object.keys(node)) if (!KEYWORDS.has(key)) add(`${path}/${key}`, `Unsupported keyword “${key}”.`);
    if (node.type !== undefined && !(Array.isArray(node.type) ? node.type.length > 0 && node.type.every((type) => TYPES.has(type)) : TYPES.has(String(node.type)))) add(`${path}/type`, 'Choose supported JSON types.');
    if (node.properties !== undefined) {
      if (!isObject(node.properties)) add(`${path}/properties`, 'Properties must be an object.');
      else {
        if (Object.keys(node.properties).length > 100) add(`${path}/properties`, 'Use at most 100 properties.');
        for (const [key, item] of Object.entries(node.properties)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || DANGEROUS.has(key)) add(`${path}/properties/${key}`, 'Use a safe identifier of at most 64 characters.');
          walk(item, `${path}/properties/${key}`, depth + 1);
        }
      }
    }
    if (node.items !== undefined) walk(node.items, `${path}/items`, depth + 1);
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length > 100)) add(`${path}/enum`, 'Enum must be an array of at most 100 values.');
    if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every((key) => typeof key === 'string'))) add(`${path}/required`, 'Required must be an array of property names.');
    for (const key of ['additionalProperties', 'uniqueItems']) if (node[key] !== undefined && typeof node[key] !== 'boolean') add(`${path}/${key}`, 'Use true or false.');
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (node[key] !== undefined && (!Number.isInteger(node[key]) || Number(node[key]) < 0 || ((key === 'minLength' || key === 'maxLength') && Number(node[key]) > 100_000))) add(`${path}/${key}`, 'Use a non-negative integer within the supported limit.');
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) if (node[key] !== undefined && (typeof node[key] !== 'number' || !Number.isFinite(node[key]))) add(`${path}/${key}`, 'Use a finite number.');
    if (node.format !== undefined && !['email', 'uri', 'uuid', 'date', 'date-time'].includes(String(node.format))) add(`${path}/format`, 'Unsupported format.');
  };
  walk(value, '/parameters', 0);
  if (!isObject(value) || value.type !== 'object') add('/parameters/type', 'The root schema must have type "object".');
  return issues;
}
export function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function policyWeakening(before: ToolDataPolicy, after: ToolDataPolicy): string[] {
  const result: string[] = [];
  if (CLASSIFICATIONS.indexOf(after.maxClassification) > CLASSIFICATIONS.indexOf(before.maxClassification)) result.push(`This lets ${after.maxClassification} data reach the destination.`);
  if (INTEGRITIES.indexOf(after.minIntegrity) > INTEGRITIES.indexOf(before.minIntegrity)) result.push(`Calls may now act on ${after.minIntegrity.toLowerCase()} context.`);
  if (before.piiArguments === 'deny' && after.piiArguments === 'unmask') result.push('Real personal data may be sent to the destination.');
  if (before.sideEffects && !after.sideEffects) result.push('This declares the request has no side effects and relaxes execution safeguards.');
  return result;
}
export function definitionIssues(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  const errors = error.fieldErrors();
  if (Array.isArray(error.details?.issues)) for (const issue of error.details.issues) {
    if (isObject(issue) && typeof issue.path === 'string' && typeof issue.message === 'string') errors[issue.path.replace(/^\//, '').replaceAll('/', '.')] = issue.message;
  }
  return errors;
}
export function buildToolInput(draft: ToolDraft): { body?: CreateToolInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9_]{2,47}$/.test(draft.name)) errors.name = 'Use 3–48 lowercase letters, digits or underscores, starting with a letter.';
  if (!draft.displayName.trim() || draft.displayName.trim().length > 80) errors.displayName = 'Use 1–80 characters.';
  if (draft.description.trim().length < 10 || draft.description.trim().length > 1000) errors.description = 'Use 10–1,000 characters.';
  let parameters: JsonSchema = DEFAULT_SCHEMA;
  try {
    const parsed: unknown = JSON.parse(draft.parameters);
    const issues = validateToolSchema(parsed);
    if (issues.length) errors.parameters = issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    else parameters = parsed as JsonSchema;
  } catch { errors.parameters = 'Enter valid JSON.'; }
  try {
    const url = new URL(draft.url);
    if (url.protocol !== 'https:' || /\{\{/.test(url.origin) || url.username || url.password) throw new Error();
  } catch { errors['http.url'] = 'Use an absolute HTTPS URL with a fixed host and no embedded credentials.'; }
  const timeoutMs = Number(draft.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 60_000) errors.timeoutMs = 'Use a whole number from 500 to 60,000 milliseconds.';
  if (draft.authType === 'header' && !draft.headerName.trim()) errors['http.auth.headerName'] = 'Enter the credential header name.';
  if (draft.authType === 'basic' && !draft.username.trim()) errors['http.auth.username'] = 'Enter the username.';
  if (draft.secretAction === 'replace' && (!draft.secret || draft.secret.length > 4096)) errors.secret = 'Enter a credential of 1–4,096 characters.';
  if (draft.responsePath && (!draft.responsePath.startsWith('/') || draft.responsePath.split('/').length > 9 || /~(?![01])/u.test(draft.responsePath))) errors['http.responsePath'] = 'Use a JSON pointer with at most eight segments, such as /data/items.';
  const pairs = (entries: Array<[string, string]>, path: string) => {
    const output: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of entries) {
      if (!key.trim()) { errors[path] = 'Every row needs a key.'; continue; }
      if (Object.hasOwn(output, key.trim())) errors[path] = `Duplicate key: ${key.trim()}.`;
      output[key.trim()] = value;
    }
    return output;
  };
  const http: CreateToolInput['http'] = {
    method: draft.method, url: draft.url.trim(), query: pairs(draft.query, 'http.query'), headers: pairs(draft.headers, 'http.headers'),
    auth: draft.authType === 'header' ? { type: 'header', headerName: draft.headerName.trim() } : draft.authType === 'basic' ? { type: 'basic', username: draft.username } : { type: draft.authType },
    ...(draft.responsePath ? { responsePath: draft.responsePath } : {}),
  };
  if (['POST', 'PUT', 'PATCH'].includes(draft.method) && draft.body.trim()) {
    try { http.body = JSON.parse(draft.body); } catch { errors['http.body'] = 'Enter valid JSON.'; }
  }
  const body: CreateToolInput = {
    name: draft.name, displayName: draft.displayName.trim(), description: draft.description.trim(), parameters, http,
    dataPolicy: draft.dataPolicy, requiresApproval: draft.requiresApproval, enabled: draft.enabled, timeoutMs,
    ...(draft.secretAction === 'replace' ? { secret: draft.secret } : {}),
  };
  return { ...(Object.keys(errors).length ? {} : { body }), errors };
}
/** Never spread a read response into a write. Preserve the credential only by omitting it. */
export function toolUpdate(base: Tool, body: CreateToolInput, secretAction: SecretAction): UpdateToolInput {
  const output: UpdateToolInput = { expectedVersion: base.version };
  for (const key of ['displayName', 'description', 'parameters', 'http', 'dataPolicy', 'requiresApproval', 'enabled', 'timeoutMs'] as const) {
    // Missing and empty query/header maps describe the same request. Avoid a
    // spurious behaviour revision when someone only renames a tool.
    const normalize = (value: unknown) => key === 'http' && isObject(value) ? { ...value, query: value.query ?? {}, headers: value.headers ?? {} } : value;
    if (canonicalJson(normalize(body[key])) !== canonicalJson(normalize(base[key]))) Object.assign(output, { [key]: body[key] });
  }
  if (secretAction === 'remove') output.secret = null;
  if (secretAction === 'replace') output.secret = body.secret;
  return output;
}
function canonicalJson(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function parseTestArguments(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value)) throw new Error('Arguments must be a JSON object.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 16 * 1024) throw new Error('Arguments must be at most 16 KB.');
  return value;
}
