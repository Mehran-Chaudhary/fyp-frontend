import { Check, Minus } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { evaluatePassword, STRENGTH_LABELS } from '@/lib/validation/password-policy';

const barTone = ['bg-danger-500', 'bg-danger-500', 'bg-warning-500', 'bg-brand-500', 'bg-brand-600'];
const labelTone = ['text-danger-700', 'text-danger-700', 'text-warning-700', 'text-brand-700', 'text-brand-700'];

/**
 * Live strength meter and rule checklist (spec §10). Uses the same scoring and
 * rules as the server, so what is ticked here is what the server accepts, except
 * for the breach check, which only the server can do.
 */
export function PasswordStrength({
  password,
  personalData,
  className,
}: {
  password: string;
  /** Sign-up only: email, first and last name. */
  personalData?: readonly (string | null | undefined)[];
  className?: string;
}) {
  const evaluation = useMemo(() => evaluatePassword(password, personalData), [password, personalData]);
  const started = password.length > 0;
  const score = started ? evaluation.score : 0;

  return (
    <div className={cn('rounded-lg border border-line bg-well/50 px-3.5 py-3', className)} aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((segment) => (
            <span
              key={segment}
              className={cn(
                'h-1 rounded-full transition-colors duration-300',
                started && score >= segment ? barTone[score] : 'bg-line-strong/70',
              )}
            />
          ))}
        </div>
        <span className={cn('w-20 text-right text-xs font-medium', started ? labelTone[score] : 'text-faint')}>
          {started ? STRENGTH_LABELS[score] : 'Strength'}
        </span>
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {evaluation.rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              'flex items-start gap-1.5 text-xs leading-snug transition-colors',
              rule.passed ? 'text-brand-700' : started ? 'text-ink-soft' : 'text-muted',
            )}
          >
            {rule.passed ? (
              <Check className="mt-px size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
            ) : (
              <Minus className="mt-px size-3.5 shrink-0 text-faint" aria-hidden />
            )}
            <span>
              <span className="sr-only">{rule.passed ? 'Done: ' : 'To do: '}</span>
              {rule.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
