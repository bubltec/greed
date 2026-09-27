/**
 * The two server-rendered pages the OAuth flow needs (consent, and sign-in or
 * error). Plain HTML in the site's NES palette; every value is escaped.
 */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · GREED</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #fcfcfc; font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 32rem; margin: 12vh auto; padding: 0 16px; }
  .logo { font: 700 20px ui-monospace, monospace; letter-spacing: .1em; }
  .logo b { color: #3cbcfc; }
  .panel { border: 2px solid #0070ec; padding: 20px; margin-top: 20px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { color: #bcbcbc; margin: 0 0 12px; } strong { color: #fcfcfc; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
  button, a.btn { font: 700 13px ui-monospace, monospace; padding: 10px 14px; border: 2px solid #3cbcfc;
    background: #0000bc; color: #fcfcfc; cursor: pointer; text-decoration: none; }
  button.ghost { background: transparent; border-color: #0070ec; }
  .err { border-color: #f83800; } .err h1 { color: #f83800; }
  code { color: #f8b800; }
</style></head>
<body><main><div class="logo">GR<b>EE</b>D</div>${body}</main></body></html>`;
}

export function consentPage(p: {
  clientName: string;
  redirectHost: string;
  user: string;
  hidden: Record<string, string>;
}): string {
  const fields = Object.entries(p.hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return page(
    'Connect',
    `<div class="panel"><h1>Connect ${esc(p.clientName)}?</h1>
<p><strong>${esc(p.clientName)}</strong> (returning to <code>${esc(p.redirectHost)}</code>) is asking to read and
edit GREED as <strong>${esc(p.user)}</strong>: search and read entries, create and update entries, and add
sources, perspectives and links. It cannot delete entries.</p>
<form method="post" action="/api/oauth/authorize">${fields}
<div class="row"><button name="decision" value="allow">Allow</button>
<button class="ghost" name="decision" value="deny">Deny</button></div></form></div>`,
  );
}

export function signInPage(p: { clientName: string; github: boolean; local: boolean }): string {
  const github = p.github ? `<a class="btn" href="/api/auth/github">Sign in with GitHub</a>` : '';
  const local = p.local
    ? `<form method="post" action="/api/oauth/local-sign-in"><button class="ghost">Local editor sign-in</button></form>`
    : '';
  return page(
    'Sign in',
    `<div class="panel"><h1>Sign in to connect ${esc(p.clientName)}</h1>
<p>Only GREED editors can connect tools. Sign in, and you'll come straight back here.</p>
<div class="row">${github}${local}</div>${!github && !local ? '<p>No sign-in method is configured.</p>' : ''}</div>`,
  );
}

export function errorPage(title: string, message: string): string {
  return page(title, `<div class="panel err"><h1>${esc(title)}</h1><p>${esc(message)}</p></div>`);
}
