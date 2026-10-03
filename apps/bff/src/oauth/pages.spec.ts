import { describe, expect, it } from 'vitest';
import { consentPage, errorPage, signInPage } from './pages.js';

describe('OAuth pages', () => {
  it('escapes everything it renders', () => {
    const html = consentPage({ clientName: '<b>"Evil"</b>', redirectHost: 'a&b', user: "o'neil", hidden: { state: '"><script>' }, github: false });
    expect(html).not.toContain('<b>"Evil"');
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&lt;b&gt;&quot;Evil&quot;&lt;/b&gt;');
    expect(html).toContain('o&#39;neil');
  });

  it('offers re-sign-in with GitHub on the consent page only when GitHub is configured', () => {
    const base = { clientName: 'Claude', redirectHost: 'claude.ai', user: 'a@x.com', hidden: {} };
    expect(consentPage({ ...base, github: true })).toContain('/api/auth/github');
    expect(consentPage({ ...base, github: false })).not.toContain('/api/auth/github');
    expect(consentPage({ ...base, github: false })).toContain('never published entries');
  });

  it('shows whichever sign-in methods exist, or says there are none', () => {
    expect(signInPage({ clientName: 'C', github: true, local: false })).toContain('Sign in with GitHub');
    expect(signInPage({ clientName: 'C', github: false, local: true })).toContain('Local editor sign-in');
    expect(signInPage({ clientName: 'C', github: false, local: false })).toContain('No sign-in method is configured');
    expect(signInPage({ clientName: 'C', github: true, local: true })).not.toContain('No sign-in method');
  });

  it('renders an error page', () => {
    expect(errorPage('Nope', 'Because <reasons>')).toContain('Because &lt;reasons&gt;');
  });
});
