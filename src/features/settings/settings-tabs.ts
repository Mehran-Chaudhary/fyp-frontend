import { Cpu, KeySquare, Network, ScanEye, Settings2, ShieldCheck, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { TabNavItem } from '@/components/ui/tab-nav';
import type { Can } from '@/lib/permissions/can';

/**
 * The settings tabs a member can see (Phase 2 spec §4, Phase 3 §5). Each tab checks its own
 * read permission, so someone with only apikey:read still reaches API keys and a
 * missing read never blanks the whole area.
 */
export function settingsTabs(base: string, can: Can): TabNavItem[] {
  const tabs: TabNavItem[] = [];
  if (can('workspace:read')) {
    tabs.push({ to: `${base}/general`, label: 'General', icon: Settings2 });
    tabs.push({ to: `${base}/defaults`, label: 'Defaults', icon: SlidersHorizontal });
    tabs.push({ to: `${base}/security`, label: 'Security', icon: ShieldCheck });
  }
  if (can('security:read')) tabs.push({ to: `${base}/networks`, label: 'Networks', icon: Network });
  if (can('apikey:read')) tabs.push({ to: `${base}/api-keys`, label: 'API keys', icon: KeySquare });
  // Phase 3 §5: the redaction policy is read with pii:policy:read, edited with pii:policy:update.
  if (can('pii:policy:read')) tabs.push({ to: `${base}/privacy`, label: 'Privacy', icon: ScanEye });
  // Phase 4 §5.8: the catalogue and policy are readable with any of these; editing needs llm:manage.
  if (can.any('llm:invoke', 'llm:manage', 'agent:read')) tabs.push({ to: `${base}/models`, label: 'Models', icon: Cpu });
  if (can('workspace:read') && can.any('workspace:transfer', 'workspace:delete')) {
    tabs.push({ to: `${base}/danger`, label: 'Danger zone', icon: TriangleAlert });
  }
  return tabs;
}
