import { describe, expect, it } from 'vitest';
import { buildUploadForm, normalizeTags } from './upload';

describe('normalizeTags', () => {
  it('trims, lower-cases and de-duplicates, as the server stores them', () => {
    expect(normalizeTags(' Remote, HR ,remote,,policy ')).toEqual(['remote', 'hr', 'policy']);
    expect(normalizeTags(['Remote', 'HR', 'hr'])).toEqual(['remote', 'hr']);
  });
});

describe('buildUploadForm (P3-API-09)', () => {
  const file = new File(['hello'], 'Leave Policy.txt', { type: 'text/plain' });

  it('always sends a classification, with one part named "file"', () => {
    const form = buildUploadForm(file, file.name, { classification: 'INTERNAL' });
    expect(form.get('classification')).toBe('INTERNAL');
    expect(form.getAll('file')).toHaveLength(1);
    expect((form.get('file') as File).name).toBe('Leave Policy.txt');
    // Unknown multipart fields are refused with 422, and empty optional ones are left out.
    expect([...form.keys()].sort()).toEqual(['classification', 'file']);
  });

  it('sends tags comma-separated and normalised, and trims the text parts', () => {
    const form = buildUploadForm(file, file.name, {
      classification: 'PUBLIC',
      title: '  Leave Policy 2026 ',
      description: ' ',
      tags: ['Policy', '2026', 'policy'],
    });
    expect(form.get('title')).toBe('Leave Policy 2026');
    expect(form.get('description')).toBeNull();
    expect(form.get('tags')).toBe('policy,2026');
  });
});
