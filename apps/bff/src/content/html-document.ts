import type { PageDocument } from '@greed/domain';

/** Escape text that is placed in HTML, including attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface WebAssets {
  script: string;
  style?: string;
}

/** Built asset paths. Locally the Vite dev server serves the source module. */
export function webAssets(): WebAssets {
  return {
    script: process.env.WEB_SCRIPT || '/src/main.tsx',
    style: process.env.WEB_STYLE || undefined,
  };
}

/**
 * The first HTML response for a URL: unique meta tags, and the page’s own words
 * inside `#root` so a client that does not run JavaScript still receives the page.
 * The app replaces `#root` when it starts.
 */
export function renderHtml(doc: PageDocument, origin: string, assets: WebAssets = webAssets()): string {
  const canonical = `${origin}${doc.path}`;
  const title = escapeHtml(doc.title);
  const description = escapeHtml(doc.description);
  const style = assets.style ? `\n    <link rel="stylesheet" crossorigin href="${escapeHtml(assets.style)}">` : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#000000">
    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta name="robots" content="${doc.robots}">
    <meta property="og:site_name" content="GREED">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:type" content="${doc.type}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">${style}
  </head>
  <body>
    <div id="root"><article><pre style="white-space:pre-wrap;font:inherit">${escapeHtml(doc.text)}</pre></article></div>
    <script type="module" src="${escapeHtml(assets.script)}"></script>
  </body>
</html>
`;
}
