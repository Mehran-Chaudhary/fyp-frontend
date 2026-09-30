/**
 * Client mirror of the backend password policy
 * (backend: src/common/validators/is-strong-password.validator.ts, spec §10).
 * The server still validates; this only lets people see problems while typing.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Exact-match denylist, compared lower-cased. Same list as the server. */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'password123!',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword123',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'letmein',
  'letmein123',
  'welcome',
  'welcome1',
  'welcome123',
  'admin',
  'admin123',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'trustno1',
  'abc123',
  'abcd1234',
  'changeme',
  'secret',
  'default',
  'test1234',
  'root',
  'toor',
]);

export type PasswordRuleId =
  | 'minLength'
  | 'maxLength'
  | 'lowercase'
  | 'uppercase'
  | 'number'
  | 'notCommon'
  | 'noRuns'
  | 'noSequences'
  | 'noPersonal';

export interface PasswordRuleResult {
  id: PasswordRuleId;
  label: string;
  passed: boolean;
}

export interface PasswordEvaluation {
  valid: boolean;
  rules: PasswordRuleResult[];
  /** 0–4, same scoring as the server's strength meter. */
  score: number;
}

/** Ascending or descending run of `length` consecutive characters ("12345", "edcba"). */
export function containsSequence(value: string, length = 5): boolean {
  if (value.length < length) return false;
  let ascending = 1;
  let descending = 1;
  for (let index = 1; index < value.length; index += 1) {
    const delta = value.charCodeAt(index) - value.charCodeAt(index - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= length || descending >= length) return true;
  }
  return false;
}

/**
 * Fragments of the user's own data worth checking: the email's local part and its
 * pieces, names and their pieces. Fragments shorter than 3 characters are ignored,
 * and the email domain is dropped (it is shared by the whole company).
 */
export function personalDataFragments(values: readonly (string | null | undefined)[]): string[] {
  const fragments = new Set<string>();
  const add = (candidate: string) => {
    const trimmed = candidate.trim().toLowerCase();
    if (trimmed.length >= 3) fragments.add(trimmed);
  };
  for (const value of values) {
    if (!value) continue;
    const at = value.lastIndexOf('@');
    const meaningful = at > 0 ? value.slice(0, at) : value;
    add(meaningful);
    for (const token of meaningful.split(/[^a-zA-Z0-9]+/)) add(token);
  }
  return Array.from(fragments);
}

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export function scorePassword(password: string): number {
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (password.length >= 20) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes >= 3) score += 1;
  if (isCommonPassword(password)) score = 0;
  return Math.min(score, 4);
}

/**
 * Evaluates a password. Pass `personalData` (email, first name, last name,
 * display name) wherever the server checks it: sign-up. Elsewhere the rule is
 * omitted from the checklist.
 */
export function evaluatePassword(password: string, personalData?: readonly (string | null | undefined)[]): PasswordEvaluation {
  const normalised = password.toLowerCase();
  const rules: PasswordRuleResult[] = [
    { id: 'minLength', label: `At least ${PASSWORD_MIN_LENGTH} characters`, passed: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'lowercase', label: 'A lowercase letter', passed: /[a-z]/.test(password) },
    { id: 'uppercase', label: 'An uppercase letter', passed: /[A-Z]/.test(password) },
    { id: 'number', label: 'A number', passed: /\d/.test(password) },
    { id: 'notCommon', label: 'Not a common password', passed: password.length > 0 && !isCommonPassword(password) },
    {
      id: 'noRuns',
      label: 'No long runs of the same character',
      passed: password.length > 0 && !/(.)\1{3,}/.test(password),
    },
    {
      id: 'noSequences',
      label: 'No sequences like 12345 or abcde',
      passed: password.length > 0 && !containsSequence(normalised, 5),
    },
  ];

  if (password.length > PASSWORD_MAX_LENGTH) {
    rules.splice(1, 0, { id: 'maxLength', label: `No more than ${PASSWORD_MAX_LENGTH} characters`, passed: false });
  }

  if (personalData) {
    const fragments = personalDataFragments(personalData);
    rules.push({
      id: 'noPersonal',
      label: 'Must not contain your name or email',
      passed: password.length > 0 && !fragments.some((fragment) => normalised.includes(fragment)),
    });
  }

  return {
    valid: rules.every((rule) => rule.passed),
    rules,
    score: scorePassword(password),
  };
}

export const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
