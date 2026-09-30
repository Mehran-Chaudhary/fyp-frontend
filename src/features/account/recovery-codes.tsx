import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import { APP_NAME } from '@/lib/env';
import { downloadTextFile, formatDateTime } from '@/lib/utils';

/**
 * The ten one-time recovery codes (spec §7.13 step 3). They are shown exactly
 * once, so the user must confirm they saved them before closing.
 */
export function RecoveryCodesPanel({
  codes,
  email,
  acknowledged,
  onAcknowledgedChange,
}: {
  codes: string[];
  email?: string;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  const download = () => {
    const lines = [
      `${APP_NAME} recovery codes`,
      email ? `Account: ${email}` : null,
      `Generated: ${formatDateTime(new Date())}`,
      '',
      'Each code can be used once to sign in when you cannot use your authenticator app.',
      'Keep them somewhere safe, such as a password manager. Generating new codes invalidates these.',
      '',
      ...codes,
      '',
    ].filter((line): line is string => line !== null);
    downloadTextFile('agentvault-recovery-codes.txt', lines.join('\n'));
  };

  return (
    <div className="grid gap-4">
      <Callout tone="warning" title="Save these codes now">
        Each code works once. Store them somewhere safe; they won't be shown again.
      </Callout>
      <ol
        className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border border-line bg-well/50 px-5 py-4 font-mono text-[13.5px] text-ink select-all"
        aria-label="Recovery codes"
      >
        {codes.map((code, index) => (
          <li key={code} className="flex items-baseline gap-2.5">
            <span className="w-4 text-right text-[11px] text-faint tabular select-none">{index + 1}</span>
            <span className="tracking-wide">{code}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join('\n')} label="Copy codes" />
        <Button variant="secondary" size="sm" onClick={download}>
          <Download />
          Download .txt
        </Button>
      </div>
      <Checkbox
        checked={acknowledged}
        onCheckedChange={onAcknowledgedChange}
        label="I've saved my recovery codes"
        description="Without them, losing your phone can lock you out of your account."
      />
    </div>
  );
}
