// Pure agent routing — dependency-free ES module, no Node.
// Usable from the embedded native frontend via dynamic import('./agent-routing.mjs').
// Exact known-site table + typo normalization moved verbatim from agent/agentloop.mjs:
// Channel4/Sky maps, no arbitrary first-hit, URL path case preserved.
// Current-page pure policy stays separate in agent/model-agent.mjs.

const SITES = { 'bbc news': 'https://www.bbc.co.uk/news', bbc: 'https://www.bbc.co.uk/news',
  'bc news': 'https://www.bbc.co.uk/news', 'bbc news website': 'https://www.bbc.co.uk/news',
  'sky news': 'https://news.sky.com/uk', sky: 'https://news.sky.com/uk',
  'investing': 'https://www.investing.com/', 'investing dot com': 'https://www.investing.com/',
  google: 'https://www.google.com', news: 'https://www.bbc.co.uk/news',
  youtube: 'https://www.youtube.com', github: 'https://github.com', wikipedia: 'https://en.wikipedia.org',
  'channel 4': 'https://www.channel4.com', channel4: 'https://www.channel4.com',
  '4od': 'https://www.channel4.com', 'channel four': 'https://www.channel4.com',
  itv: 'https://www.itv.com', itvx: 'https://www.itvx.com',
  my5: 'https://www.channel5.com', 'channel 5': 'https://www.channel5.com',
  channel5: 'https://www.channel5.com', more4: 'https://www.channel4.com/collection/more4',
  e4: 'https://www.channel4.com/collection/e4', film4: 'https://www.film4.com' };
const GOOGLE_TLD = { germany: 'de', france: 'fr', spain: 'es', italy: 'it', uk: 'co.uk', japan: 'co.jp', canada: 'ca', australia: 'com.au', brazil: 'com.br', india: 'co.in', netherlands: 'nl', ireland: 'ie', sweden: 'se' };
function siteFor(target) {
  // Strip filler first so "sky news website properly" still exact-matches;
  // website affixes second. Exact-map only — no fuzzy substring, no ad-risk auto-open.
  let t = String(target || '').replace(/\s+(properly|please|for me)\s*$/i, '').trim()
    .replace(/^(?:the\s+)?(?:website|site|webpage|page)\s+(?:of\s+|for\s+)?/i, '')
    .replace(/\s+(?:website|site|webpage|page)\s*$/i, '')
    .replace(/\s+(properly|please|for me)\s*$/i, '')
    .replace(/\s+dot\s+/g, '.').replace(/\sdot\s/g, '.').trim();
  t = t.replace(/\bsk\s+y\b/gi, 'sky').replace(/\bch\s*annel\b/gi, 'channel');
  if (SITES[t]) return SITES[t];
  const gm = t.match(/^google\s+([a-z]+)$/);
  if (gm && GOOGLE_TLD[gm[1]]) return 'https://www.google.' + GOOGLE_TLD[gm[1]] + '/';
  /* Exact-map only: fuzzy substring matches (any "bbc"/"sky" mention opening
     news) hijacked unrelated asks, and blind first-hit auto-open risks ads.
     Unknown sites return null so the smart-model turn picks a justified
     result via web_search + open_result instead. */
  return null;
}

export const AGENT_TOOLS = [
  { name: 'browser_open', description: 'Open a website in the integrated browser pane', input: 'url or site name' },
  { name: 'browser_read', description: 'Read the current browser page (title + text)', input: 'none' },
  { name: 'web_search', description: 'Search the web through the integrated browser', input: 'query' },
  { name: 'browser_current', description: 'Show what the browser is currently on', input: 'none' },
  { name: 'browser_click', description: 'Click an element, link, or coordinates on the active page', input: 'selector or text' },
  { name: 'browser_type', description: 'Type text into an input field on the web page', input: 'text, optional selector' },
  { name: 'browser_press', description: 'Press a keyboard key on the web page', input: 'key name' },
  { name: 'browser_screenshot', description: 'Capture a real web-page screenshot where supported; unsupported backends report an error', input: 'optional fullPage' },
  { name: 'doc_open', description: 'Open a PDF, Office or text document in the Document pane', input: 'document url' },
];

/* Document links route to the local Document reader; ordinary sites stay
   in the live browser. Unsupported formats report their limits. */
export function isDocUrl(u) {
  const s = String(u || '').replace(/\s+dot\s+/gi, '.').trim();
  return /\.(pdf|docx|odt|xlsx|pptx|md|markdown|txt|text|html?|csv|json)([?#/]|$)/i.test(s);
}

/** Deterministic tool decision. Returns {tool, args} or null. */
export function decideTool(query) {
  const q = String(query || '');
  const low = q.toLowerCase().trim();
  let rm0 = low.match(/^(?:open|show|go to)\s+result\s+(\d{1,2})$/);
  if (rm0) return { tool: 'open_result', args: { n: Number(rm0[1]) } };
  const cm = q.trim().match(/^(?:please\s+)?click\s+(?:on\s+|the\s+)?(.+)$/i);
  if (cm && !/^(here|pin|close|minimise|tab|profile|mode)\b/i.test(cm[1])) {
    return { tool: 'browser_click', args: { selector: cm[1].trim().replace(/^["']|["']$/g, '') } };
  }
  const tm = q.trim().match(/^(?:please\s+)?type\s+["']?([^"']+)["']?\s+(?:in|into|on)\s+(?:the\s+)?(.+)$/i);
  if (tm) {
    return { tool: 'browser_type', args: { text: tm[1].trim(), selector: tm[2].trim() } };
  }
  const tm2 = q.trim().match(/^(?:please\s+)?type\s+["']([^"']+)["']$/i);
  if (tm2) {
    return { tool: 'browser_type', args: { text: tm2[1].trim() } };
  }
  const prm = low.match(/^(?:please\s+)?press\s+(?:the\s+)?(enter|tab|escape|space|backspace|arrowdown|arrowup|return)\b/i);
  if (prm) {
    const keys = { enter: 'Enter', tab: 'Tab', escape: 'Escape', space: 'Space', backspace: 'Backspace', arrowdown: 'ArrowDown', arrowup: 'ArrowUp', return: 'Enter' };
    return { tool: 'browser_press', args: { key: keys[prm[1].toLowerCase()] } };
  }
  if (/\b(?:take\s+a\s+screenshot|screenshot\s+(?:the\s+)?page|capture\s+(?:the\s+)?page)\b/i.test(low)) {
    return { tool: 'browser_screenshot', args: {} };
  }
  /* "open this doc <url>" / "paste this doc" routes to the Document pane;
     browser_open stays the browser pane. No URL and no paste visible here
     means an honest pointer, never a faked open. */
  const pm = low.match(/^(?:please\s+)?paste\s+(this\s+|that\s+|the\s+)?(doc|document|draft|pasted?\s+document|paste|it)\b\s*(.*)$/);
  if (pm) {
    const urlm = /https?:\/\/\S+/.exec(q);
    if (urlm) return { tool: 'doc_open', args: { url: urlm[0].replace(/[.,;!?)]+$/, '') } };
    return { tool: 'doc_paste_hint', args: {} };
  }
  const dm = q.trim().match(/^(?:please\s+)?(?:open|show)\s+(?:this\s+|that\s+|the\s+)?(?:doc|document|draft|pasted?\s+document|paste)\b\s*(.*)$/i);
  if (dm) {
    const urlm = /https?:\/\/\S+/.exec(q);
    if (urlm) return { tool: 'doc_open', args: { url: urlm[0].replace(/[.,;!?)]+$/, '') } };
    // Preserve original URL path case: rest comes from the original-case match, never low.
    const rest = (dm[1] || '').replace(/^(at|from)\s+/i, '').trim();
    if (rest && isDocUrl(rest)) return { tool: 'doc_open', args: { url: /^https?:/i.test(rest) ? rest : 'https://' + rest } };
    return { tool: 'doc_paste_hint', args: {} };
  }
  let m = q.trim().match(/^(?:please\s+)?(?:open|show|launch|go to|take me to|browse|visit)\s+(?:a\s+|the\s+)?(?:browser\s+(?:on|to|for)\s+|brower\s+(?:on|to)\s+)?(.+)$/i);
  if (/^(open|show|launch)\s+(a\s+)?(browser|brower)$/.test(low)) return { tool: 'browser_open', args: { url: 'https://www.google.com' } };
  if (m && !/^(draft|write|file|slides|letter)/.test(low)) {
    let rawTarget = m[1].replace(/\s+please\s*$/i, '').replace(/\s+(properly|for me)\s*$/i, '').trim();
    // Strip filler before website affixes so "sky news website properly" still direct-matches.
    let target = rawTarget.replace(/\s+(properly|please|for me)\s*$/i, '').trim()
      .replace(/^(?:the\s+)?(?:website|site|webpage|page)\s+(?:of\s+|for\s+)?/i, '')
      .replace(/\s+(?:website|site|webpage|page)\s*$/i, '')
      .replace(/\s+(properly|please|for me)\s*$/i, '')
      .trim();
    if (!target) target = rawTarget;
    const known = siteFor(target.toLowerCase());
    if (known) return { tool: 'browser_open', args: { url: known } };
    const spoken = target.replace(/\s+dot\s+/gi, '.').replace(/\s+(properly|please)\s*$/i, '').trim();
    if (isDocUrl(spoken)) {
      return { tool: 'doc_open', args: { url: /^https?:/i.test(spoken) ? spoken : 'https://' + spoken.replace(/^www\./i, '') } };
    }
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(spoken) || /^https?:/i.test(spoken)) {
      return { tool: 'browser_open', args: { url: /^https?:/i.test(spoken) ? spoken : 'https://' + spoken } };
    }
    /* Unknown open-intent: list results, never auto-open the first hit (ad
       risk). The smart-model turn (or the user via "open result N") picks a
       justified result instead. */
    if (target.length > 2) return { tool: 'web_search', args: { query: target } };
  }
  // Preserve original query case for search: match the original text, not low.
  m = q.trim().match(/^search\s+(?:the\s+web\s+)?(?:for\s+)?(.+)$/i) || q.trim().match(/^(?:google|look up|find)\s+(.+)$/i);
  if (m) return { tool: 'web_search', args: { query: m[1].trim() } };
  if (/\b(what'?s|what is)\s+on\s+(this page|the page|bbc|the news)\b/.test(low) || /^read (this|the) page/.test(low)) {
    return { tool: 'browser_read', args: {} };
  }
  if (/\b(latest|today'?s?)\s+(news|headlines)\b/.test(low)) return { tool: 'web_search', args: { query: 'BBC News headlines today' } };
  if (/^https?:\/\/\S+$/i.test(q.trim()) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q.trim())) {
    return { tool: isDocUrl(q.trim()) ? 'doc_open' : 'browser_open', args: { url: /^https?:/i.test(q.trim()) ? q.trim() : 'https://' + q.trim() } };
  }
  const bare = low.replace(/\s+(please|properly|for me)\s*$/g, '').trim();
  if (bare && !/^(hi|hey|hello|yo|hiya|heya|howdy|sup|thanks|thank you|ok|okay|yes|no|bye)\b/.test(bare)
      && !/\?\s*$/.test(bare) && !/^(what|why|how|when|who|can|could|do|does|is|are|will|would|should|am)\b/.test(bare)
      && !/^(draft|write|make|create|file|save|log|add|send|delete|remind|schedule|help me get|reply|repeat|say |echo|tell me)/.test(bare)) {
    // A bare topic is a search, not an instruction to open the first result.
    const known = siteFor(bare);
    if (known) return { tool: 'browser_open', args: { url: known } };
    if (/^[a-z0-9][a-z0-9 .'-]{1,60}$/.test(bare) && bare.split(/\s+/).length <= 6)
      return { tool: 'web_search', args: { query: q.trim() } };
  }
  return null;
}
