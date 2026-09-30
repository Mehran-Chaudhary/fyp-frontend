import { describe, expect, it } from 'vitest';
import { hostRuleFor, isIpAllowed, isIpInCidr, isValidCidr, matchingRule, wouldLockMeOut } from './ip';

describe('isIpInCidr (agrees with the server)', () => {
  it('matches single addresses and ranges', () => {
    expect(isIpInCidr('127.0.0.1', '127.0.0.1/32')).toBe(true);
    expect(isIpInCidr('203.0.113.7', '203.0.113.0/24')).toBe(true);
    expect(isIpInCidr('203.0.114.7', '203.0.113.0/24')).toBe(false);
    expect(isIpInCidr('203.0.113.7', '203.0.113.7')).toBe(true);
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(isIpInCidr('::ffff:10.1.2.3', '10.0.0.0/8')).toBe(true);
  });

  it('never matches across families', () => {
    expect(isIpInCidr('10.1.2.3', '::/0')).toBe(false);
    expect(isIpInCidr('2001:db8::1', '0.0.0.0/0')).toBe(false);
  });

  it('matches IPv6 ranges', () => {
    expect(isIpInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(isIpInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(isIpInCidr('::1', '::1/128')).toBe(true);
  });
});

describe('isValidCidr', () => {
  it('rejects out-of-range values and leading zeros', () => {
    expect(isValidCidr('300.1.1.1/40')).toBe(false);
    expect(isValidCidr('010.0.0.1')).toBe(false);
    expect(isValidCidr('10.0.0.0/33')).toBe(false);
    expect(isValidCidr('nope')).toBe(false);
    expect(isValidCidr('10.0.0.0/')).toBe(false);
  });

  it('accepts addresses and ranges in both families', () => {
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
    expect(isValidCidr('203.0.113.7')).toBe(true);
    expect(isValidCidr('2001:db8::/32')).toBe(true);
    expect(isValidCidr('::1')).toBe(true);
  });
});

describe('lockout helpers', () => {
  it('needs at least one matching rule', () => {
    expect(isIpAllowed('10.1.2.3', [])).toBe(false);
    expect(isIpAllowed('10.1.2.3', ['192.168.0.0/16', '10.0.0.0/8'])).toBe(true);
  });

  it('reports an unknown address as unknown', () => {
    expect(wouldLockMeOut(null, ['10.0.0.0/8'])).toBe('unknown');
    expect(wouldLockMeOut('10.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(wouldLockMeOut('10.1.2.3', ['192.168.0.0/16'])).toBe(true);
  });

  it('builds a host rule for "Add my address"', () => {
    expect(hostRuleFor('203.0.113.7')).toBe('203.0.113.7/32');
    expect(hostRuleFor('2001:db8::1')).toBe('2001:db8::1/128');
  });

  it('finds the rule that lets an address in', () => {
    const rules = [
      { cidr: '192.168.0.0/16', label: 'Home' },
      { cidr: '10.0.0.0/8', label: 'Office' },
    ];
    expect(matchingRule('10.4.4.4', rules)?.label).toBe('Office');
    expect(matchingRule('8.8.8.8', rules)).toBeNull();
    expect(matchingRule(null, rules)).toBeNull();
  });
});
