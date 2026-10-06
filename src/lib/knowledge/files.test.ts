import { describe, expect, it } from 'vitest';
import { defaultUploadTitle, fileExtension, filenameStem, fileTypeFromName, formatBytes, precheckFile, sanitizeUploadFilename, sumBytes } from './files';

describe('precheckFile', () => {
  it('refuses types the server refuses', () => {
    expect(precheckFile({ name: 'tool.exe', size: 4 })?.code).toBe('TYPE_NOT_ALLOWED');
    expect(precheckFile({ name: 'Payroll_March_2024.xlsx', size: 4 })?.code).toBe('TYPE_NOT_ALLOWED');
  });

  it('refuses files without an extension', () => {
    expect(precheckFile({ name: 'README', size: 5 })?.code).toBe('TYPE_NOT_ALLOWED');
    expect(precheckFile({ name: '.pdf', size: 5 })?.code).toBe('TYPE_NOT_ALLOWED');
  });

  it('ignores the case of the extension', () => {
    expect(precheckFile({ name: 'Notes.MD', size: 5 })).toBeNull();
  });

  it('refuses empty files', () => {
    expect(precheckFile({ name: 'a.txt', size: 0 })?.code).toBe('EMPTY');
  });

  it('allows exactly 50 MB and no more', () => {
    expect(precheckFile({ name: 'big.pdf', size: 52_428_801 })?.code).toBe('TOO_LARGE');
    expect(precheckFile({ name: 'big.pdf', size: 52_428_800 })).toBeNull();
  });
});

describe('names', () => {
  it('reads the extension like the server', () => {
    expect(fileExtension('Q1 review.final.PDF')).toBe('pdf');
    expect(fileExtension('.bashrc')).toBe('');
  });

  it('derives the default title', () => {
    expect(filenameStem('leave-policy.txt')).toBe('leave-policy');
    expect(filenameStem('Q1 review.final.pdf')).toBe('Q1 review.final');
  });

  it('guesses the document type', () => {
    expect(fileTypeFromName('a.markdown')).toBe('MARKDOWN');
    expect(fileTypeFromName('a.text')).toBe('TXT');
    expect(fileTypeFromName('a.xlsx')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats strings and numbers in binary units', () => {
    expect(formatBytes('297')).toBe('297 B');
    expect(formatBytes('204800')).toBe('200 KB');
    expect(formatBytes(52428800)).toBe('50 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes('not a number')).toBe('0 B');
  });

  it('adds 64-bit counts without losing precision', () => {
    expect(sumBytes(['9007199254740993', '1'])).toBe('9007199254740994');
    expect(sumBytes(['297', 'x', '3'])).toBe('300');
  });
});

describe('sanitizeUploadFilename (as the server stores names)', () => {
  it('drops the client path and replaces reserved characters (verified example)', () => {
    expect(sanitizeUploadFilename('C:\\fakepath\\quarterly "draft".txt')).toBe('quarterly _draft_.txt');
    expect(defaultUploadTitle('C:\\fakepath\\quarterly "draft".txt')).toBe('quarterly _draft_');
  });

  it('keeps UTF-8 names and strips leading dots', () => {
    expect(sanitizeUploadFilename('رپورٹ.md')).toBe('رپورٹ.md');
    expect(sanitizeUploadFilename('..hidden.txt')).toBe('hidden.txt');
    expect(sanitizeUploadFilename('...')).toBe('document');
  });

  it('cuts long names to 200 characters, keeping the extension', () => {
    const name = sanitizeUploadFilename(`${'a'.repeat(250)}.pdf`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('formatBytes beyond safe integers', () => {
  it('scales 64-bit counts without rounding errors', () => {
    expect(formatBytes('9007199254740993')).toBe('8 PB');
    expect(formatBytes('')).toBe('0 B');
  });
});
