import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ path: '/planning', status: 'ready', tenantId: 'tenant-a' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('../../app/components/TenantProvider', () => ({
  useTenant: () => ({ status: state.status, writeTenantId: state.tenantId }),
}));
import ContextualAssistant from '../../components/assistant/ContextualAssistant';

const source = readFileSync(new URL('../../components/assistant/ContextualAssistant.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../components/assistant/contextualAssistant.module.css', import.meta.url), 'utf8');
const frame = readFileSync(new URL('../../app/components/ApplicationFrame.tsx', import.meta.url), 'utf8');

describe('assistant mobile placement', () => {
  beforeEach(() => { state.path = '/planning'; state.status = 'ready'; });

  it('renders the real collapsed control on planning without a fixed utility or opened panel', () => {
    const html = renderToStaticMarkup(createElement(ContextualAssistant));
    expect(html).toContain('aria-label="TMS Assistant"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="tms-assistant-panel"');
    expect(html).not.toContain('<section');
    expect(html).not.toMatch(/class="[^"]*\bfixed\b/);
  });

  it('preserves the route and ready-tenant visibility gates', () => {
    state.status = 'signed-out';
    expect(renderToStaticMarkup(createElement(ContextualAssistant))).toBe('');
    state.status = 'ready'; state.path = '/auth/confirm';
    expect(renderToStaticMarkup(createElement(ContextualAssistant))).toBe('');
  });

  it('puts mobile guidance after the workspace instead of making it a shrinking flex column', () => {
    expect(frame).toMatch(/<ThemeScope>\{children\}<\/ThemeScope>\s*<\/div>\s*<ContextualAssistant\s*\/>/);
    const mobile = css.slice(0, css.indexOf('@media'));
    expect(mobile).toMatch(/position:\s*static/);
    expect(mobile).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1024px\)[\s\S]*position:\s*fixed/);
  });

  it('bounds opened guidance and keeps both disclosure controls touch-sized', () => {
    expect(css).toMatch(/\.panel\s*\{[^}]*max-inline-size:\s*100%/);
    expect(css).toMatch(/\.panel\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('65dvh');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toMatch(/\.touchTarget\s*\{[^}]*min-block-size:\s*44px/);
    expect(source.match(/className=\{styles\.touchTarget\}/g)).toHaveLength(2);
    expect(source).toContain('Close guidance');
  });
});
