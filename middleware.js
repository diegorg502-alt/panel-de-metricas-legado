export const config = {
  matcher: '/((?!_next|favicon\\.ico).*)',
};

const BOT_PATTERNS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'ClaudeBot', 'Claude-Web', 'claudebot', 'anthropic-ai',
  'CCBot', 'PerplexityBot', 'Google-Extended',
  'Bytespider', 'Amazonbot', 'Applebot-Extended',
  'FacebookBot', 'Meta-ExternalAgent',
  'DataForSeoBot', 'SemrushBot', 'AhrefsBot', 'MJ12bot', 'DotBot',
  'python-requests', 'Scrapy', 'curl/', 'Wget/',
  'HttpClient', 'axios/', 'node-fetch', 'Go-http-client',
];

export default function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  const lowerUa = ua.toLowerCase();
  const isBot = BOT_PATTERNS.some(p => lowerUa.includes(p.toLowerCase()));
  if (isBot) {
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>403</title></head><body style="font-family:sans-serif;text-align:center;padding:80px"><h1>403 — Access denied</h1><p>Automated access is not permitted.</p></body></html>',
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' } }
    );
  }
}
