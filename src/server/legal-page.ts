const ContactEmail = 'fuzzyrubrubs@gmail.com';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function legalPage(title: string, body: string): Response {
  const safeTitle = escapeHtml(title);
  return new Response(
    `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} · Venture</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #6a4bdb; color: #17181a; }
    main { box-sizing: border-box; width: min(760px, calc(100% - 32px)); margin: 32px auto; padding: clamp(24px, 6vw, 56px); background: #fff; border-radius: 24px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 8vw, 3.75rem); line-height: .98; letter-spacing: -.04em; }
    h2 { margin-top: 32px; font-size: 1.15rem; }
    p, li { color: #4c4e54; line-height: 1.65; }
    a { color: #6a4bdb; font-weight: 650; }
    .brand { color: #6a4bdb; font-size: .75rem; font-weight: 800; letter-spacing: .16em; }
    .updated { margin-top: 8px; color: #7b7e85; font-size: .875rem; }
    @media (prefers-color-scheme: dark) {
      body { background: #332b52; color: #fff; }
      main { background: #17181a; }
      p, li { color: #c7c9cf; }
      a, .brand { color: #a18bf5; }
    }
  </style>
</head>
<body><main><div class="brand">VENTURE</div><h1>${safeTitle}</h1>${body}</main></body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } }
  );
}

export const contactLink = `<a href="mailto:${ContactEmail}">${ContactEmail}</a>`;
