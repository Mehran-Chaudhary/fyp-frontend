import { beforeEach, describe, expect, it } from 'vitest';
import { capabilityBlocked, clearLayerGap, recordLayerGap, useKnowledgeLayer } from './layer';

const gap = () => useKnowledgeLayer.getState().gaps.ws;

describe('knowledge layer gaps', () => {
  beforeEach(() => clearLayerGap('ws'));

  it('blocks what needs a missing setting, and only that', () => {
    recordLayerGap('ws', ['STORAGE_S3_BUCKET']);
    expect(capabilityBlocked(gap(), 'download')).toBe(true);
    expect(capabilityBlocked(gap(), 'upload')).toBe(true);
    expect(capabilityBlocked(gap(), 'reindex')).toBe(true);
    expect(capabilityBlocked(gap(), 'search')).toBe(false);
  });

  it('accumulates what later answers name', () => {
    recordLayerGap('ws', ['QDRANT_URL', 'AI_SERVICE_URL']);
    expect(capabilityBlocked(gap(), 'search')).toBe(true);
    expect(capabilityBlocked(gap(), 'download')).toBe(false);
    recordLayerGap('ws', ['STORAGE_S3_BUCKET']);
    expect(gap()?.missing).toEqual(['AI_SERVICE_URL', 'QDRANT_URL', 'STORAGE_S3_BUCKET']);
  });

  it('blocks just the refused capability when no setting is named', () => {
    recordLayerGap('ws', [], 'search');
    expect(capabilityBlocked(gap(), 'search')).toBe(true);
    expect(capabilityBlocked(gap(), 'upload')).toBe(false);
  });

  it('forgets on "check again"', () => {
    recordLayerGap('ws', ['QDRANT_URL']);
    clearLayerGap('ws');
    expect(capabilityBlocked(gap(), 'search')).toBe(false);
  });
});
