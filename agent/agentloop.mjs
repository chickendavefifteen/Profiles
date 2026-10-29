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
  google: 'https://www.google.com', news: 'https://www.bbc.co.uk/news',
  youtube: 'https://www.youtube.com', github: 'https://github.com', wikipedia: 'https://en.wikipedia.org' };
function siteFor(target) {
  const t = target.replace(/\s+(website|site|webpage|page)\s*$/, '')
    .replace(/\s+(properly|please|for me)\s*$/, '')
    .replace(/\s+dot\s+/g, '.').replace(/\sdot\s/g, '.').trim();
  if (SITES[t]) return SITES[t];
  if (/^bb?c\b/.test(t) || /bbc/.test(t)) return 'https://www.bbc.co.uk/news';
  return null;
}

export const AGENT_TOOLS = [
  { name: 'browser_open', description: 'Open a website in the integrated browser pane', input: 'url or site name' },
  { name: 'browser_read', description: 'Read the current browser page (title + text)', input: 'none' },
  { name: 'web_search', description: 'Search the web through the integrated browser', input: 'query' },
  { name: 'browser_current', description: 'Show what the browser is currently on', input: 'none' },
];

/** Deterministic tool decision. Returns {tool, args} or null. */
export function decideTool(query) {
  const q = String(query || '');
  const low = q.toLowerCase().trim();
  let m = low.match(/^(?:please\s+)?(?:open|show|launch|go to|take me to|browse|visit)\s+(?:a\s+|the\s+)?(?:browser\s+(?:on|to|for)\s+|brower\s+(?:on|to)\s+)?(.+)$/);
  if (/^(open|show|launch)\s+(a\s+)?(browser|brower)$/.test(low)) return { tool: 'browser_open', args: { url: 'https://www.google.com' } };
  if (m && !/^(draft|write|file|slides|letter)/.test(low)) {
    let target = m[1].replace(/\s+please\s*$/, '').trim();
    const known = siteFor(target);
    if (known) return { tool: 'browser_open', args: { url: known } };
    const spoken = target.replace(/\s+dot\s+/g, '.').replace(/\s+(properly|please)\s*$/, '').trim();
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(spoken) || /^https?:/.test(spoken)) {
      return { tool: 'browser_open', args: { url: /^https?:/.test(spoken) ? spoken : 'https://www.' + spoken.replace(/^www\./, '') } };
    }
    if (target.length > 2) return { tool: 'web_search', args: { query: target } };
  }
  m = low.match(/^search\s+(?:the\s+web\s+)?(?:for\s+)?(.+)$/) || low.match(/^(?:google|look up|find)\s+(.+)$/);
  if (m) return { tool: 'web_search', args: { query: m[1] } };
  if (/\b(what'?s|what is)\s+on\s+(this page|the page|bbc|the news)\b/.test(low) || /^read (this|the) page/.test(low)) {
    return { tool: 'browser_read', args: {} };
  }
  if (/\b(latest|today'?s?)\s+(news|headlines)\b/.test(low)) return { tool: 'web_search', args: { query: 'BBC News headlines today' } };
  return null;
}

export async function runTool(slot, decision) {
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
    case 'web_search': {
      const out = await webSearch(slot, decision.args.query);
      if (!out.ok) {
        return { tool: decision.tool, ok: false, observation: `Web search “${decision.args.query}” could not run (${out.error || 'unavailable'}) — try opening a site directly (“open bbc news”).`,
          ui: { showPane: 'pane-browser' }, results: [] };
      }
      const lines = (out.results || []).map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.href})`).join('\n');
      return { tool: decision.tool, ok: true, observation: `Web search “${decision.args.query}”:\n${lines || 'no results came back'}`,
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
