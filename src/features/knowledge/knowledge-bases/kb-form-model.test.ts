import { describe, expect, it } from 'vitest';
import type { KnowledgeBase } from '@/lib/api/types';
import { changesChunking, effectiveChunkSize, initialValues, toCreateRequest, toUpdateRequest, validateKbForm } from './kb-form-model';

const all = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
const confidential = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'] as const;

const kb: KnowledgeBase = {
  id: '8df97318-db90-49a0-8a1a-6d34cef3a182',
  name: 'Company Handbook',
  description: 'Policies and guides every employee may read.',
  accessMode: 'WORKSPACE',
  defaultClassification: 'INTERNAL',
  embeddingModel: 'nomic-embed-text',
  embeddingDimensions: 768,
  chunkSize: null,
  chunkOverlap: null,
  access: 'MANAGE',
  stats: { documents: 0, ready: 0, processing: 0, failed: 0, totalBytes: '0' },
  createdById: null,
  createdAt: '2026-09-30T04:35:34.867Z',
  updatedAt: '2026-09-30T04:35:34.867Z',
};

describe('knowledge-base form', () => {
  it('starts a new base as INTERNAL, open to the workspace, inheriting chunking', () => {
    expect(initialValues(undefined, all)).toMatchObject({
      accessMode: 'WORKSPACE',
      defaultClassification: 'INTERNAL',
      chunkSizeMode: 'inherit',
      chunkOverlapMode: 'inherit',
    });
    expect(initialValues(undefined, ['PUBLIC']).defaultClassification).toBe('PUBLIC');
  });

  it('checks the overlap against the size that will apply, including an inherited one (BF-15)', () => {
    const values = { ...initialValues(undefined, all), name: 'Finance', chunkOverlapMode: 'custom' as const, chunkOverlap: '300' };
    expect(validateKbForm(values, { size: 256, overlap: null }, all).chunkOverlap).toBe('Must be smaller than the chunk size (256).');
    expect(validateKbForm(values, { size: null, overlap: null }, all).chunkOverlap).toBeUndefined(); // platform 512
    expect(effectiveChunkSize(values, { size: 256, overlap: null })).toBe(256);
  });

  it('checks ranges and the name', () => {
    const errors = validateKbForm(
      { ...initialValues(undefined, all), name: '  ', chunkSizeMode: 'custom', chunkSize: '32', chunkOverlapMode: 'custom', chunkOverlap: '2000' },
      { size: null, overlap: null },
      all,
    );
    expect(errors.name).toBeDefined();
    expect(errors.chunkSize).toMatch(/64 to 4096/);
    expect(errors.chunkOverlap).toMatch(/0 to 1024/);
  });

  it('refuses a default classification above your clearance', () => {
    const values = { ...initialValues(undefined, all), name: 'Payroll', defaultClassification: 'RESTRICTED' as const };
    expect(validateKbForm(values, { size: null, overlap: null }, confidential).defaultClassification).toBeDefined();
  });

  it('creates with only what was set', () => {
    expect(toCreateRequest({ ...initialValues(undefined, all), name: ' Finance Reports ', accessMode: 'RESTRICTED' })).toEqual({
      name: 'Finance Reports',
      accessMode: 'RESTRICTED',
      defaultClassification: 'INTERNAL',
    });
  });

  it('updates only what changed, with null to inherit and to remove the description', () => {
    expect(toUpdateRequest(initialValues(kb, all), kb)).toEqual({});
    const values = { ...initialValues(kb, all), description: '', chunkSizeMode: 'custom' as const, chunkSize: '256' };
    const body = toUpdateRequest(values, kb);
    expect(body).toEqual({ description: null, chunkSize: 256 });
    expect(changesChunking(body)).toBe(true);

    const customised = { ...kb, chunkSize: 256, chunkOverlap: 32 };
    expect(toUpdateRequest({ ...initialValues(customised, all), chunkSizeMode: 'inherit' }, customised)).toEqual({ chunkSize: null });
  });
});
