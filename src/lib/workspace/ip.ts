/**
 * IP and CIDR matching, copied from the backend's `src/common/utils/ip.util.ts`
 * rather than taken from a library, so the client-side lockout check gives exactly
 * the server's answer: IPv4-mapped IPv6, leading-zero rejection, bare addresses as
 * /32 or /128 (spec Appendix B).
 */

interface ParsedIp {
  value: bigint;
  family: 'ipv4' | 'ipv6';
  bits: number;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIp(input: string): ParsedIp | null {
  if (!input) return null;
  let address = input.trim();
  if (address.startsWith('[')) {
    const closing = address.indexOf(']');
    if (closing > 0) address = address.slice(1, closing);
  }
  const zoneIndex = address.indexOf('%');
  if (zoneIndex >= 0) address = address.slice(0, zoneIndex);
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
  if (mapped) address = mapped[1];
  const v4 = parseIpv4(address);
  if (v4 !== null) return { value: v4, family: 'ipv4', bits: 32 };
  const v6 = parseIpv6(address);
  if (v6 !== null) return { value: v6, family: 'ipv6', bits: 128 };
  return null;
}

function parseIpv4(address: string): bigint | null {
  const match = IPV4_PATTERN.exec(address);
  if (!match) return null;
  let value = 0n;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(match[i]);
    if (match[i].length > 1 && match[i].startsWith('0')) return null;
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(address: string): bigint | null {
  if (!address.includes(':')) return null;
  const doubleColonCount = (address.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;
  let head: string[];
  let tail: string[];
  if (doubleColonCount === 1) {
    const [left, right] = address.split('::');
    head = left ? left.split(':') : [];
    tail = right ? right.split(':') : [];
  } else {
    head = address.split(':');
    tail = [];
  }
  const expand = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1];
    if (!last.includes('.')) return groups;
    const v4 = parseIpv4(last);
    if (v4 === null) return null;
    const high = (v4 >> 16n) & 0xffffn;
    const low = v4 & 0xffffn;
    return [...groups.slice(0, -1), high.toString(16), low.toString(16)];
  };
  const expandedHead = expand(head);
  const expandedTail = expand(tail);
  if (expandedHead === null || expandedTail === null) return null;
  const missing = 8 - (expandedHead.length + expandedTail.length);
  if (missing < 0) return null;
  if (doubleColonCount === 0 && missing !== 0) return null;
  const groups = [...expandedHead, ...Array.from({ length: missing }, () => '0'), ...expandedTail];
  let value = 0n;
  for (const group of groups) {
    if (group.length === 0 || group.length > 4 || !/^[0-9a-f]+$/i.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const parsedIp = parseIp(ip);
  if (!parsedIp) return false;
  const slashIndex = cidr.indexOf('/');
  const networkPart = slashIndex === -1 ? cidr : cidr.slice(0, slashIndex);
  const parsedNetwork = parseIp(networkPart);
  if (!parsedNetwork) return false;
  if (parsedNetwork.family !== parsedIp.family) return false;
  const prefixLength = slashIndex === -1 ? parsedNetwork.bits : Number.parseInt(cidr.slice(slashIndex + 1), 10);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > parsedIp.bits) return false;
  if (prefixLength === 0) return true;
  const hostBits = BigInt(parsedIp.bits - prefixLength);
  const mask = ((1n << BigInt(prefixLength)) - 1n) << hostBits;
  return (parsedIp.value & mask) === (parsedNetwork.value & mask);
}

/** Matches at least one rule. Unlike the server helper, an empty list returns false here. */
export function isIpAllowed(ip: string, cidrs: readonly string[]): boolean {
  return cidrs.some((cidr) => isIpInCidr(ip, cidr));
}

export function isValidCidr(cidr: string): boolean {
  const trimmed = cidr.trim();
  const slashIndex = trimmed.indexOf('/');
  const networkPart = slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex);
  const parsed = parseIp(networkPart);
  if (!parsed) return false;
  if (slashIndex === -1) return true;
  const suffix = trimmed.slice(slashIndex + 1);
  if (!/^\d{1,3}$/.test(suffix)) return false;
  const prefixLength = Number.parseInt(suffix, 10);
  return Number.isInteger(prefixLength) && prefixLength >= 0 && prefixLength <= parsed.bits;
}

/** §5.8.3: would this set of rules, with enforcement on, still let me in? */
export function wouldLockMeOut(currentIp: string | null, activeCidrs: readonly string[]): boolean | 'unknown' {
  if (!currentIp) return 'unknown';
  return !isIpAllowed(currentIp, activeCidrs);
}

/** The rule to add for "Add my address". */
export const hostRuleFor = (ip: string): string => (ip.includes(':') ? `${ip}/128` : `${ip}/32`);

/** The first rule that matches the address, for "matches rule 'Office'". */
export function matchingRule<T extends { cidr: string }>(ip: string | null, rules: readonly T[]): T | null {
  if (!ip) return null;
  return rules.find((rule) => isIpInCidr(ip, rule.cidr)) ?? null;
}
