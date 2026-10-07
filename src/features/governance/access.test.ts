import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AnalyticsPage } from '@/features/analytics/analytics-page';
import { WorkspaceContext, type ActiveWorkspace } from '@/features/workspaces/workspace-context';
import { GovernancePage } from './governance-page';

const workspace: ActiveWorkspace = {
  id: 'workspace-a', slug: 'workspace-a', name: 'Workspace A', summary: null,
  membership: null, permissions: [], details: null,
};

function render(permissions: string[], page: 'analytics' | 'governance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // Previously authorized data remains in memory; current capabilities must still gate it.
  client.setQueryData(['ws', workspace.id, 'analytics', 'security'], {
    pages: [[{ id: 'event', at: '2026-10-07T12:00:00Z', action: 'sensitive.security.event', severity: 'CRITICAL', status: 'DENIED', actorType: 'USER', actorLabel: 'Private actor', resourceType: null, resourceId: null, errorCode: null, ipAddress: null, requestId: null }]],
    pageParams: [undefined],
  });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, null, createElement(WorkspaceContext.Provider, { value: { ...workspace, permissions } },
      createElement(page === 'analytics' ? AnalyticsPage : GovernancePage))),
  ));
  client.clear();
  return html;
}

describe('independent governance permissions', () => {
  it.each(['security:read', 'audit:read'])('opens the security feed with %s alone', (permission) => {
    const html = render([permission], 'analytics');
    expect(html).toContain('Security event feed');
    expect(html).toContain('sensitive.security.event');
    expect(html).not.toContain('Activity over time');
    expect(html).not.toContain('Who uses what');
  });
  it('does not reveal cached security records to a usage-only reader', () => {
    const html = render(['usage:read'], 'analytics');
    expect(html).toContain('Activity over time');
    expect(html).not.toContain('Security event feed');
    expect(html).not.toContain('sensitive.security.event');
    expect(html).not.toContain('Private actor');
  });
  it('lets an agent reader inspect circuits without revealing workspace quotas', () => {
    const html = render(['agent:read'], 'governance');
    expect(html).toContain('Agent circuit breakers');
    expect(html).not.toContain('Workspace quotas');
    expect(html).not.toContain('Create quota');
    expect(html).not.toContain('My quotas');
  });
  it('gates cached security records when all capabilities are revoked', () => {
    expect(render([], 'analytics')).not.toContain('sensitive.security.event');
  });
});
