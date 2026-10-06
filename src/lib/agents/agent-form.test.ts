import { describe, expect, it } from 'vitest';
import type { Agent } from '../api/types';
import {
  agentPatch,
  createInput,
  createsVersion,
  emptyAgentForm,
  formFromAgent,
  mapServerFieldErrors,
  parseAgentForm,
  patchSections,
  rebaseForm,
} from './agent-form';
import { agentActions, agentCapabilities } from './capabilities';

/** "Scratch Agent": what POST /agents with only a name produced live (spec §4.1). */
const scratch: Agent = {
  id: '5248a992-f2f9-4895-a638-666cb9c774da',
  name: 'Scratch Agent',
  description: null,
  visibility: 'PRIVATE',
  accessMode: 'WORKSPACE',
  currentVersion: 1,
  model: null,
  role: null,
  greeting: null,
  knowledgeBaseCount: 1,
  createdById: 'u1',
  publishedAt: null,
  lastUsedAt: null,
  createdAt: '2026-10-06T08:00:00.000Z',
  updatedAt: '2026-10-06T08:00:00.000Z',
  canEdit: true,
  instructions: '',
  allowedRoleIds: [],
  config: {
    persona: { role: null, tone: 'neutral', language: null, greeting: null },
    model: null,
    parameters: { maxOutputTokens: 300, temperature: 0.2 },
    contextWindow: null,
    retrieval: {
      enabled: true,
      knowledgeBaseIds: ['kb-b', 'kb-a'],
      hiddenKnowledgeBases: 1,
      topK: 8,
      mode: 'hybrid',
      rerank: false,
      maxContextTokens: 3000,
      minScore: null,
      maxClassification: null,
    },
    memory: { maxMessages: 20, maxHistoryTokens: 3000 },
    grounding: 'STRICT',
    citations: true,
    tools: { toolIds: [], maxIterations: 4 },
  },
};

const draftOf = (form: ReturnType<typeof formFromAgent>) => {
  const { draft, errors } = parseAgentForm(form);
  expect(errors).toEqual({});
  return draft!;
};

describe('agentPatch (P4-API-04, Appendix A)', () => {
  it('is null when nothing changed, whatever the key order of parameters', () => {
    expect(agentPatch(scratch, draftOf(formFromAgent(scratch)))).toBeNull();
  });

  it('sends only changed keys of a section, plus expectedVersion', () => {
    const form = { ...formFromAgent(scratch), tone: 'formal' as const };
    const patch = agentPatch(scratch, draftOf(form), '  Formal tone for policy answers. ');
    expect(patch).toEqual({ expectedVersion: 1, persona: { tone: 'formal' }, changeNote: 'Formal tone for policy answers.' });
    expect(createsVersion(patch!)).toBe(true);
    expect(patchSections(patch!)).toEqual(['Persona']);
  });

  it('sends parameters whole: clearing one override sends the rest', () => {
    const form = { ...formFromAgent(scratch), maxOutputTokens: '' };
    expect(agentPatch(scratch, draftOf(form))?.parameters).toEqual({ temperature: 0.2 });
  });

  it('treats identity and access as non-versioned', () => {
    const form = { ...formFromAgent(scratch), description: 'Answers HR questions.', accessMode: 'RESTRICTED' as const, allowedRoleIds: ['r1'] };
    const patch = agentPatch(scratch, draftOf(form))!;
    expect(patch).toEqual({ expectedVersion: 1, description: 'Answers HR questions.', accessMode: 'RESTRICTED', allowedRoleIds: ['r1'] });
    expect(createsVersion(patch)).toBe(false);
  });

  it('ignores the order of knowledge bases and never sends hidden ones', () => {
    const form = { ...formFromAgent(scratch), knowledgeBaseIds: ['kb-a', 'kb-b'] };
    expect(agentPatch(scratch, draftOf(form))).toBeNull();
    const removed = { ...formFromAgent(scratch), knowledgeBaseIds: ['kb-a'] };
    expect(agentPatch(scratch, draftOf(removed))?.retrieval).toEqual({ knowledgeBaseIds: ['kb-a'] });
  });

  it('clears nullable fields with null', () => {
    const loaded = { ...scratch, description: 'Old', config: { ...scratch.config, persona: { ...scratch.config.persona, role: 'the HR assistant' }, model: 'qwen/qwen3.8-27b' } };
    const form = { ...formFromAgent(loaded), description: '  ', role: '', model: null };
    expect(agentPatch(loaded, draftOf(form))).toEqual({ expectedVersion: 1, description: null, persona: { role: null }, model: null });
  });
});

describe('parseAgentForm (spec §6)', () => {
  it('requires a name and checks ranges', () => {
    const { errors, draft } = parseAgentForm({
      ...emptyAgentForm(),
      temperature: '3',
      retrievalTopK: '21',
      maxMessages: '',
      contextWindow: '100',
      stop: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(draft).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['contextWindow', 'maxMessages', 'name', 'retrievalTopK', 'stop', 'temperature']);
  });

  it('needs a role when access is restricted', () => {
    expect(parseAgentForm({ ...emptyAgentForm(), name: 'X', accessMode: 'RESTRICTED' }).errors.allowedRoleIds).toBeTruthy();
  });
});

describe('createInput (spec §5.2 "send only what the user filled in")', () => {
  it('sends just the name for an untouched form', () => {
    expect(createInput(draftOf({ ...emptyAgentForm(), name: '  Scratch Agent ' }))).toEqual({ name: 'Scratch Agent' });
  });

  it('sends the filled sections only', () => {
    const body = createInput(
      draftOf({ ...emptyAgentForm(), name: 'HR Policy Assistant', tone: 'friendly', temperature: '0.2', retrievalTopK: '6', knowledgeBaseIds: ['kb'], citations: true }),
    );
    expect(body).toEqual({
      name: 'HR Policy Assistant',
      persona: { tone: 'friendly' },
      parameters: { temperature: 0.2 },
      retrieval: { knowledgeBaseIds: ['kb'], topK: 6 },
    });
  });
});

describe('rebaseForm (409 AGENT_VERSION_CONFLICT)', () => {
  it('keeps my edits and takes the server for the rest', () => {
    const original = formFromAgent(scratch);
    const current = { ...original, tone: 'formal' as const, instructions: 'Server text' };
    const mine = { ...original, greeting: 'Hi!' };
    expect(rebaseForm(original, current, mine)).toMatchObject({ tone: 'formal', instructions: 'Server text', greeting: 'Hi!' });
  });
});

describe('mapServerFieldErrors', () => {
  it('maps nested paths and array members', () => {
    expect(mapServerFieldErrors({ 'retrieval.topK': 'too big', 'parameters.stop.2': 'too long', other: 'x' })).toEqual({
      errors: { retrievalTopK: 'too big', stop: 'too long' },
      rest: ['x'],
    });
  });
});

describe('agentCapabilities (spec §3.6, live permission lists)', () => {
  const roles = {
    owner: 'agent:create agent:delete agent:execute agent:publish agent:read agent:update conversation:delete conversation:read conversation:read_all llm:invoke llm:manage tool:read usage:read pii:reveal',
    member: 'agent:execute agent:read conversation:delete conversation:read llm:invoke tool:execute tool:read usage:read',
    viewer: 'agent:read conversation:read tool:read',
    author: 'agent:create agent:execute agent:read conversation:delete conversation:read',
  };
  const can = (role: keyof typeof roles) => agentCapabilities(roles[role].split(' '));

  it('matches the verified role matrix', () => {
    expect(can('owner')).toMatchObject({ manageAgents: true, superviseConversations: true, revealPersonalData: true, manageModelPolicy: true });
    expect(can('member')).toMatchObject({ chat: true, manageAgents: false, superviseConversations: false, directChat: true, readUsage: true });
    expect(can('viewer')).toMatchObject({ browseAgents: true, chat: false, readModels: true, directChat: false });
  });

  it("doesn't let a creator without agent:update edit or publish their draft (P4-G04)", () => {
    expect(agentActions({ visibility: 'PRIVATE' }, can('author'))).toMatchObject({ edit: false, publish: false, chat: true });
    expect(agentActions({ visibility: 'WORKSPACE' }, can('owner'))).toMatchObject({ publish: false, unpublish: true });
  });
});
