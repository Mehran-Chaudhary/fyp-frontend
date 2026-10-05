import { Download, KeyRound, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import type { CreatedApiKey } from '@/lib/api/types';
import { API_BASE_URL } from '@/lib/env';
import { downloadTextFile, formatDate, formatDateTime } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/** A read-only endpoint a key with these scopes may call, for the example request. */
const EXAMPLES: Array<{ scope: string; path: string }> = [
  { scope: 'knowledgebase:read', path: '/knowledge-bases' },
  { scope: 'document:read', path: '/documents' },
  { scope: 'agent:read', path: '/agents' },
];

/**
 * Shows a new key's secret exactly once (spec P2-API-29). It can't be dismissed
 * until the user confirms they stored it; the secret lives only in the parent's
 * component state and is dropped on close, navigation, workspace switch or
 * sign-out (each unmounts the parent). Copying happens on click only.
 */
export function ApiKeySecretDialog({ created, onDone }: { created: CreatedApiKey | null; onDone: () => void }) {
  return (
    <Dialog open={!!created} onOpenChange={() => undefined}>
      <DialogContent
        size="xl"
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {created ? <SecretBody key={created.apiKey.id} created={created} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SecretBody({ created, onDone }: { created: CreatedApiKey; onDone: () => void }) {
  const workspace = useWorkspace();
  const [stored, setStored] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const { apiKey, plaintextKey, warning } = created;
  const example = EXAMPLES.find((candidate) => apiKey.scopes.includes(candidate.scope));
  const base = API_BASE_URL.startsWith('http') ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
  const curl = example
    ? `curl -H "X-API-Key: ${plaintextKey}" \\\n  ${base}/organizations/${workspace.id}${example.path}`
    : null;

  const download = () => {
    const safeName = apiKey.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'api-key';
    downloadTextFile(
      `agentvault-${workspace.slug}-${safeName}.txt`,
      [
        'AgentVault API key',
        '',
        `Workspace:  ${workspace.name} (${workspace.id})`,
        `Name:       ${apiKey.name}`,
        `Created:    ${formatDateTime(apiKey.createdAt)}`,
        `Expires:    ${apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'no expiry'}`,
        `Scopes:     ${apiKey.scopes.join(', ')}`,
        `Networks:   ${apiKey.allowedIps.length ? apiKey.allowedIps.join(', ') : 'any'}`,
        '',
        plaintextKey,
        '',
        'Send it in the X-API-Key header. It is shown once and cannot be retrieved again.',
        '',
      ].join('\n'),
    );
  };

  return (
    <>
      <DialogHeader
        icon={<KeyRound />}
        title="Save your new API key"
        description={`“${apiKey.name}” is ready. Copy the key now: this is the only time it's shown.`}
      />
      <DialogBody className="grid gap-4">
        <Callout tone="security" icon={<ShieldAlert className="size-4" />}>
          {warning}
        </Callout>

        <div className="overflow-hidden rounded-lg border border-brand-200 bg-brand-50/50">
          <p className="px-3.5 pt-3 text-[11px] font-medium tracking-[0.06em] text-brand-800 uppercase">Secret key</p>
          <p className="px-3.5 pt-1.5 pb-3 font-mono text-[13px] break-all text-ink select-all" aria-label="API key">
            {plaintextKey}
          </p>
          <div className="flex flex-wrap gap-2 border-t border-brand-200 bg-surface/70 px-3.5 py-2.5">
            <CopyButton value={plaintextKey} label="Copy key" variant="primary" size="sm" onCopyResult={(ok) => setCopyFailed(!ok)} />
            <Button variant="secondary" size="sm" onClick={download}>
              <Download />
              Download .txt
            </Button>
          </div>
        </div>
        {copyFailed ? (
          <Callout tone="warning" role="alert">
            This browser didn't allow copying. Select the key above (one click selects all of it) and copy it by hand, or
            download it. It stays on screen until you confirm below.
          </Callout>
        ) : null}

        {curl ? <CodeBlock code={curl} label="Try it" /> : null}

        <ul className="grid gap-1.5 text-[13px] leading-relaxed text-muted">
          <li>
            · Send it in the <code className="font-mono text-[12px] text-ink-soft">X-API-Key</code> header. It only works
            in this workspace.
          </li>
          <li>
            · Scopes: <span className="font-mono text-[12px] text-ink-soft">{apiKey.scopes.join(', ')}</span>.
            {apiKey.expiresAt ? ` Expires ${formatDate(apiKey.expiresAt)}.` : null}
          </li>
          {apiKey.allowedIps.length ? (
            <li>
              · Only accepted from {apiKey.allowedIps.join(', ')}; anywhere else it's refused with{' '}
              <code className="font-mono text-[12px]">IP_NOT_ALLOWED</code>.
            </li>
          ) : null}
          <li>
            · If you leave or are removed from the workspace, keys you created are revoked. Suspension or a role change
            doesn't narrow or revoke them: revoke a key yourself when it should stop.
          </li>
        </ul>
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        <Checkbox checked={stored} onCheckedChange={setStored} label="I have saved this key" />
        <Button onClick={onDone} disabled={!stored}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
