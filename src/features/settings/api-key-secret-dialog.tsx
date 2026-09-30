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

/**
 * Shows a new key's secret exactly once (spec §5.9). It can't be closed until
 * the user confirms they stored it; the secret lives only in the parent's state
 * and is dropped when this closes.
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
  const { apiKey, plaintextKey, warning } = created;
  const endpoint = `${window.location.origin}${API_BASE_URL}/organizations/${workspace.id}/agents`;
  const example = `curl -H "X-API-Key: ${plaintextKey}" \\\n  ${endpoint}`;

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
        `Expires:    ${apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'never'}`,
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
            <CopyButton value={plaintextKey} label="Copy key" variant="primary" size="sm" />
            <Button variant="secondary" size="sm" onClick={download}>
              <Download />
              Download .txt
            </Button>
          </div>
        </div>

        <CodeBlock code={example} label="Try it" />

        <ul className="grid gap-1.5 text-[13px] leading-relaxed text-muted">
          <li>
            · The key goes in the <code className="font-mono text-[12px] text-ink-soft">X-API-Key</code> header. It is bound
            to this workspace: the workspace in the URL path is ignored.
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
          <li>· If you leave or are removed from the workspace, every key you created is revoked.</li>
        </ul>
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        <Checkbox checked={stored} onCheckedChange={setStored} label="I've stored this key somewhere safe" />
        <Button onClick={onDone} disabled={!stored}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
