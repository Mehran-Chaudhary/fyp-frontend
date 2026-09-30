import { hashString } from '@/lib/utils';

/**
 * A colour family per kind of personal data, so a chunk's detections read at a
 * glance: people, contact details, money, places, identifiers.
 */
export interface EntityTone {
  chip: string;
  dot: string;
}

const TONES = {
  person: { chip: 'border-[#d9cdea] bg-[#f3eff9] text-[#523c6e]', dot: 'bg-[#7a5aa6]' },
  contact: { chip: 'border-info-200 bg-info-50 text-info-700', dot: 'bg-info-500' },
  phone: { chip: 'border-[#c4e0df] bg-[#ecf6f5] text-[#1f5758]', dot: 'bg-[#2f7f80]' },
  money: { chip: 'border-warning-200 bg-warning-50 text-warning-700', dot: 'bg-warning-500' },
  place: { chip: 'border-success-200 bg-success-50 text-success-700', dot: 'bg-success-500' },
  identifier: { chip: 'border-danger-200 bg-danger-50 text-danger-700', dot: 'bg-danger-500' },
  other: { chip: 'border-line-strong bg-well text-ink-soft', dot: 'bg-faint' },
} satisfies Record<string, EntityTone>;

const FALLBACK: readonly EntityTone[] = [TONES.person, TONES.contact, TONES.phone, TONES.money, TONES.place, TONES.identifier];

export function entityTone(entityType: string): EntityTone {
  const type = entityType.toUpperCase();
  if (/PERSON|NAME|NRP/.test(type)) return TONES.person;
  if (/EMAIL|URL|IP_ADDRESS|DOMAIN/.test(type)) return TONES.contact;
  if (/PHONE|MOBILE|FAX/.test(type)) return TONES.phone;
  if (/CARD|IBAN|BANK|SALARY|ACCOUNT|MONEY|AMOUNT|SWIFT|CRYPTO/.test(type)) return TONES.money;
  if (/LOCATION|ADDRESS|CITY|COUNTRY|GPE|POSTCODE|ZIP/.test(type)) return TONES.place;
  if (/CNIC|SSN|PASSPORT|LICEN|NTN|NIN|TAX|ID$|_ID|NATIONAL|MEDICAL|NHS/.test(type)) return TONES.identifier;
  if (type === 'CUSTOM') return TONES.other;
  return FALLBACK[hashString(type) % FALLBACK.length];
}
