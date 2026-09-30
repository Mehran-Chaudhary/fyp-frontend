import { describe, expect, it } from 'vitest';
import { domainProblem, emailDomain, isEmailAllowed, normaliseDomain } from './domains';

describe('allowed email domains', () => {
  it('normalises entries the way the server compares them', () => {
    expect(normaliseDomain(' @Acme.Test ')).toBe('acme.test');
  });

  it('matches the exact domain, case-insensitively, and never subdomains', () => {
    expect(isEmailAllowed('zara@ACME.test', ['acme.test'])).toBe(true);
    expect(isEmailAllowed('zara@mail.acme.test', ['acme.test'])).toBe(false);
    expect(isEmailAllowed('zara@gmail.com', ['acme.test', 'example.com'])).toBe(false);
  });

  it('allows everything when there is no restriction', () => {
    expect(isEmailAllowed('zara@gmail.com', [])).toBe(true);
    expect(isEmailAllowed('zara@gmail.com', undefined)).toBe(true);
  });

  it('explains invalid domains', () => {
    expect(domainProblem('acme.test')).toBeNull();
    expect(domainProblem('localhost')).not.toBeNull();
    expect(domainProblem('zara@acme.test')).not.toBeNull();
    expect(domainProblem('-acme.test')).not.toBeNull();
  });

  it('extracts the domain of an address', () => {
    expect(emailDomain('Zara@Acme.Test')).toBe('acme.test');
    expect(emailDomain('nope')).toBe('');
  });
});
