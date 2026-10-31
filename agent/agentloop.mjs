// The agent tool loop — how Claude Code / Codex actually work, distilled:
//   sense (classify) -> decide (deterministic router first, model second)
//   -> act (ONE allowlisted tool) -> observe (result fed back) -> answer.
// Tools are real functions with schemas, not vibes. Every tool returns
// structured observation; the chat answer is built from it, and the UI
// gets explicit actions (open this pane, refresh that view). MCP servers
// configured per profile join the same registry (tools/list, tools/call
// over JSON-RPC HTTP) — the runtime executes, the model suggests.
import { viewGo, viewCurrent, viewRead, webSearch } from './browseract.mjs';

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
  const t = target.replace(/\s+(website|site|webpage|page)\s*$/, '')
    .replace(/\s+(properly|please|for me)\s*$/, '')
    .replace(/\s+dot\s+/g, '.').replace(/\sdot\s/g, '.').trim();
  if (SITES[t]) return SITES[t];
  const gm = t.match(/^google\s+([a-z]+)$/);
  if (gm && GOOGLE_TLD[gm[1]]) return 'https://www.google.' + GOOGLE_TLD[gm[1]] + '/';
  if (/^bb?c\b/.test(t) || /bbc/.test(t)) return 'https://www.bbc.co.uk/news';
  return null;
}

export const AGENT_TOOLS = [
  { name: 'browser_open', description: 'Open a website in the integrated browser pane', input: 'url or site name' },
  { name: 'browser_read', description: 'Read the current browser page (title + text)', input: 'none' },
  { name: 'web_search', description: 'Search the web through the integrated browser', input: 'query' },
  { name: 'browser_current', description: 'Show what the browser is currently on', input: 'none' },
  { name: 'doc_open', description: 'Open a pasted text/markdown/HTML document link in the Document pane (staged)', input: 'document url' },
];

/* Document links route to the Document pane, never the browser: pasted
   text/markdown/HTML renders a sanitized preview + stages; heavy binaries
   get the honest fallback. Pure, tested. */
export function isDocUrl(u) {
  const s = String(u || '').replace(/\s+dot\s+/gi, '.').trim();
  return /\.(md|markdown|txt|text|html?)([?#/]|$)/i.test(s);
}

/** Deterministic tool decision. Returns {tool, args} or null. */
export function decideTool(query) {
  const q = String(query || '');
  const low = q.toLowerCase().trim();
  let rm0 = low.match(/^(?:open|show|go to)\s+result\s+(\d{1,2})$/);
  if (rm0) return { tool: 'open_result', args: { n: Number(rm0[1]) } };
  /* "open this doc <url>" / "paste this doc" routes to the Document pane;
     browser_open stays the browser pane. No URL and no paste visible here
     means an honest pointer, never a faked open. */
  const pm = low.match(/^(?:please\s+)?paste\s+(this\s+|that\s+|the\s+)?(doc|document|draft|pasted?\s+document|paste|it)\b\s*(.*)$/);
  if (pm) {
    const urlm = /https?:\/\/\S+/.exec(q);
    if (urlm) return { tool: 'doc_open', args: { url: urlm[0].replace(/[.,;!?)]+$/, '') } };
    return { tool: 'doc_paste_hint', args: {} };
  }
  const dm = low.match(/^(?:please\s+)?(?:open|show)\s+(?:this\s+|that\s+|the\s+)?(?:doc|document|draft|pasted?\s+document|paste)\b\s*(.*)$/);
  if (dm) {
    const urlm = /https?:\/\/\S+/.exec(q);
    if (urlm) return { tool: 'doc_open', args: { url: urlm[0].replace(/[.,;!?)]+$/, '') } };
    const rest = (dm[1] || '').replace(/^(at|from)\s+/, '').trim();
    if (rest && isDocUrl(rest)) return { tool: 'doc_open', args: { url: /^https?:/.test(rest) ? rest : 'https://' + rest } };
    return { tool: 'doc_paste_hint', args: {} };
  }
  let m = low.match(/^(?:please\s+)?(?:open|show|launch|go to|take me to|browse|visit)\s+(?:a\s+|the\s+)?(?:browser\s+(?:on|to|for)\s+|brower\s+(?:on|to)\s+)?(.+)$/);
  if (/^(open|show|launch)\s+(a\s+)?(browser|brower)$/.test(low)) return { tool: 'browser_open', args: { url: 'https://www.google.com' } };
  if (m && !/^(draft|write|file|slides|letter)/.test(low)) {
    let target = m[1].replace(/\s+please\s*$/, '').trim();
    const known = siteFor(target);
    if (known) return { tool: 'browser_open', args: { url: known } };
    const spoken = target.replace(/\s+dot\s+/g, '.').replace(/\s+(properly|please)\s*$/, '').trim();
    if (isDocUrl(spoken)) {
      return { tool: 'doc_open', args: { url: /^https?:/.test(spoken) ? spoken : 'https://' + spoken.replace(/^www\./, '') } };
    }
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(spoken) || /^https?:/.test(spoken)) {
      return { tool: 'browser_open', args: { url: /^https?:/.test(spoken) ? spoken : 'https://www.' + spoken.replace(/^www\./, '') } };
    }
    if (target.length > 2) return { tool: 'web_search', args: { query: target, openTop: true } };
  }
  m = low.match(/^search\s+(?:the\s+web\s+)?(?:for\s+)?(.+)$/) || low.match(/^(?:google|look up|find)\s+(.+)$/);
  if (m) return { tool: 'web_search', args: { query: m[1] } };
  if (/\b(what'?s|what is)\s+on\s+(this page|the page|bbc|the news)\b/.test(low) || /^read (this|the) page/.test(low)) {
    return { tool: 'browser_read', args: {} };
  }
  if (/\b(latest|today'?s?)\s+(news|headlines)\b/.test(low)) return { tool: 'web_search', args: { query: 'BBC News headlines today' } };
  const bare = low.replace(/\s+(please|properly|for me)\s*$/g, '').trim();
  if (bare && !/^(hi|hey|hello|yo|hiya|heya|howdy|sup|thanks|thank you|ok|okay|yes|no|bye)\b/.test(bare)
      && !/\?\s*$/.test(bare) && !/^(what|why|how|when|who|can|could|do|does|is|are|will|would|should|am)\b/.test(bare)
      && !/^(draft|write|make|create|file|save|log|add|send|delete|remind|schedule|help me get|reply|repeat|say |echo|tell me)/.test(bare)) {
    const known = siteFor(bare);
    if (known) return { tool: 'browser_open', args: { url: known } };
    if (/^[a-z0-9][a-z0-9 .'-]{1,60}$/.test(bare) && bare.split(/\s+/).length <= 6) {
      return { tool: 'web_search', args: { query: q.trim() } };
    }
  }
  return null;
}

const lastResults = new Map();
export async function runTool(slot, decision) {
  if (decision.tool === 'open_result') {
    const list = lastResults.get(slot) || [];
    const hit = list[(decision.args.n || 1) - 1];
    if (!hit) return { tool: 'open_result', ok: false, observation: 'No saved result with that number — search first, then say "open result 1".' };
    const out = await viewGo(slot, hit.href);
    return { tool: 'open_result', ok: out.ok, observation: `Opened result ${decision.args.n}: ${hit.title} — ${out.url}. Showing in the Browser pane.`,
      ui: { showPane: 'pane-browser', browser: out } };
  }
  switch (decision.tool) {
    case 'browser_open': {
      const out = await viewGo(slot, decision.args.url);
      if (!out.ok) {
        return { tool: decision.tool, ok: false, observation: `Browser could not snapshot (${out.error || 'unavailable'}) — opening ${out.url || decision.args.url} directly in the Browser pane instead.`,
          ui: { showPane: 'pane-browser', browser: out } };
      }
      return { tool: decision.tool, ok: out.ok, observation: `Browser opened ${out.url} — “${out.title}”. It is showing in the Browser pane.`,
        ui: { showPane: 'pane-browser', browser: out } };
    }
    case 'browser_current': {
      const out = await viewCurrent(slot);
      if (!out.ok) {
        return { tool: decision.tool, ok: false, observation: `Browser snapshot unavailable (${out.error || 'unavailable'}) — the Browser pane shows the page directly.`,
          ui: { showPane: 'pane-browser', browser: out } };
      }
      return { tool: decision.tool, ok: true, observation: `Browser is on ${out.url} — “${out.title}”.`, ui: { showPane: 'pane-browser', browser: out } };
    }
    case 'browser_read': {
      const out = await viewRead(slot);
      if (!out.ok) {
        return { tool: decision.tool, ok: false, observation: `Could not read the page (${out.error || 'unavailable'}) — open it in the Browser pane and I will try again.` };
      }
      return { tool: decision.tool, ok: true, observation: `Page “${out.title}” (${out.url}):\n${String(out.text || '').slice(0, 1200)}`, pageText: out.text };
    }
    case 'doc_paste_hint': {
      return { tool: decision.tool, ok: true,
        observation: 'I can\u2019t see your clipboard from here — paste the text, Markdown, HTML or link into the Document pane\u2019s Read box and hit Read. I\u2019ll render a preview and stage it for export.',
        ui: { showPane: 'pane-doc' } };
    }
    case 'doc_open': {
      /* Doc-pane fetch: same framing proxy + slot cookie jar as the
         browser, only the rendering differs (sanitized preview + stage).
         Heavy binaries get the honest fallback — never a faked render. */
      const target = String(decision.args.url || '');
      const { fetchUpstream, docKindForUrl, sanitizeDocHtml } = await import('./proxy.mjs');
      const { makePastedDoc, markdownToHtml, binaryFallbackHtml } = await import('./staging.mjs');
      const { slotPaths } = await import('./slots.mjs');
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const saveDoc = async (draft) => {
        const p = slotPaths(slot);
        await mkdir(p.staging, { recursive: true });
        await writeFile(join(p.staging, draft.id + '.json'), JSON.stringify(draft, null, 2));
      };
      const titleOf = (u) => { try { const segs = new URL(u).pathname.split('/').filter(Boolean); return decodeURIComponent(segs.pop() || new URL(u).host); } catch { return u.slice(0, 80); } };
      if (!/^https?:\/\//i.test(target)) {
        return { tool: decision.tool, ok: false,
          observation: 'That didn\u2019t look like a document link — paste the text or a full https:// link into the Document pane Read box.',
          ui: { showPane: 'pane-doc' } };
      }
      if (docKindForUrl(target) === 'binary') {
        const draft = makePastedDoc({ title: titleOf(target),
          markdown: 'Pointer to ' + target + ' — open it in its own app; export here when handy.', sourceUrl: target });
        await saveDoc(draft);
        const html = binaryFallbackHtml(titleOf(target), target);
        return { tool: decision.tool, ok: true, staged: { id: draft.id, title: draft.title, kind: draft.kind },
          observation: `“${draft.title}” needs its own app, so I staged a pointer in the Document pane (export .md/.docx when handy, or open it externally).`,
          ui: { showPane: 'pane-doc', doc: { id: draft.id, title: draft.title, html } } };
      }
      let up;
      try { up = await fetchUpstream(target, slot); }
      catch (e) {
        return { tool: decision.tool, ok: false,
          observation: `I could not fetch ${target} (${String(e && e.message || e).slice(0, 120)}) — nothing staged, nothing faked.`,
          ui: { showPane: 'pane-doc' } };
      }
      const ctype = String((up.headers && (up.headers.get ? up.headers.get('content-type') : up.headers['content-type'])) || '').toLowerCase();
      const isText = /text\/|markdown|json|xml|javascript/.test(ctype) || docKindForUrl(target) === 'text';
      if (!isText || !up.body || !up.body.length) {
        const draft = makePastedDoc({ title: titleOf(up.url || target),
          markdown: 'Pointer to ' + (up.url || target) + ' — open it in its own app; export here when handy.', sourceUrl: up.url || target });
        await saveDoc(draft);
        const html = binaryFallbackHtml(titleOf(up.url || target), up.url || target);
        return { tool: decision.tool, ok: true, staged: { id: draft.id, title: draft.title, kind: draft.kind },
          observation: `“${draft.title}” isn\u2019t plain text I can preview, so I staged a pointer in the Document pane (export .md/.docx when handy, or open it externally).`,
          ui: { showPane: 'pane-doc', doc: { id: draft.id, title: draft.title, html } } };
      }
      const raw = up.body.toString('utf8').slice(0, 60000);
      if (!raw.trim()) {
        return { tool: decision.tool, ok: false,
          observation: `I fetched ${up.url || target} but it came back empty — nothing staged, nothing faked.`,
          ui: { showPane: 'pane-doc' } };
      }
      const asHtml = /text\/html/.test(ctype);
      const draft = makePastedDoc({ title: titleOf(up.url || target), markdown: raw, sourceUrl: up.url || target });
      await saveDoc(draft);
      const html = sanitizeDocHtml(asHtml ? raw : markdownToHtml(raw));
      return { tool: decision.tool, ok: true, staged: { id: draft.id, title: draft.title, kind: draft.kind },
        observation: `“${draft.title}” is previewing in the Document pane and staged for export.`,
        ui: { showPane: 'pane-doc', doc: { id: draft.id, title: draft.title, html } } };
    }
    case 'web_search': {
      const out = await webSearch(slot, decision.args.query);
      if (out.ok && out.results && out.results.length) lastResults.set(slot, out.results);
      if (!out.ok) {
        return { tool: decision.tool, ok: false, observation: `Web search “${decision.args.query}” could not run (${out.error || 'unavailable'}) — try opening a site directly (“open bbc news”).`,
          ui: { showPane: 'pane-browser' }, results: [] };
      }
      if (decision.args.openTop && out.results && out.results.length) {
        const first = out.results[0];
        const go = await viewGo(slot, first.href);
        const where = (go && go.url) || first.href;
        return { tool: decision.tool, ok: true,
          observation: `Opened ${first.title} (${where}) for “${decision.args.query}” — it is showing in the Browser pane.`,
          ui: { showPane: 'pane-browser', browser: go }, results: out.results };
      }
      const lines = (out.results || []).map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.href})`).join('\n');
      const obs = lines
        ? `Web search “${decision.args.query}”:\n${lines}`
        : (out.pageUrl
          ? `Web search “${decision.args.query}” is showing live in your Browser pane (${out.pageUrl}) — results are rendering there; tell me what you see or say "read this page" and I'll read it.`
          : `Web search “${decision.args.query}” is showing live in your Browser pane — tell me what you see or say "read this page".`);
      return { tool: decision.tool, ok: true, observation: obs,
        ui: { showPane: 'pane-browser' }, results: out.results };
    }
    default: return { tool: decision.tool, ok: false, observation: 'unknown tool' };
}
}

/* ---- MCP: per-profile servers join the registry ---- */
export async function mcpListTools(server) {
  const res = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  if (!res.ok) throw new Error('MCP HTTP ' + res.status);
  const data = await res.json();
  return (data?.result?.tools || []).map((t) => ({ name: t.name, description: t.description || '', via: server.name }));
}
export async function mcpCallTool(server, name, args) {
  const res = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args || {} } }) });
  if (!res.ok) throw new Error('MCP HTTP ' + res.status);
  const data = await res.json();
  return data?.result ?? data?.error ?? null;
}
