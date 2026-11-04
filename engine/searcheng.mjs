// Headed search engine preference: pure logic, no DOM. Tested by tests/run.mjs;
// main.js + start.html mirror these rules (classic scripts: logic inlined).
export const ENGINES = ['google', 'bing', 'duckduckgo'];

export function parseEngine(raw) {
  var e = String(raw || '').toLowerCase();
  return ENGINES.includes(e) ? e : 'google';
}

export function buildSearchUrl(engine, q) {
  var query = encodeURIComponent(String(q || ''));
  switch (parseEngine(engine)) {
    case 'bing': return 'https://www.bing.com/search?q=' + query;
    case 'duckduckgo': return 'https://html.duckduckgo.com/html/?q=' + query;
    default: return 'https://www.google.com/search?q=' + query;
  }
}
