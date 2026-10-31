// The agent tool loop — how Claude Code / Codex actually work, distilled:
//   sense (classify) -> decide (deterministic router first, model second)
//   -> act (ONE allowlisted tool) -> observe (result fed back) -> answer.
// Tools are real functions with schemas, not vibes. Every tool returns
// structured observation; the chat answer is built from it, and the UI
// gets explicit actions (open this pane, refresh that view). MCP servers
// configured per profile join the same registry (tools/list, tools/call
// over JSON-RPC HTTP) — the runtime executes, the model suggests.
import { viewGo, viewCurrent, viewRead, webSearch } from './browseract.mjs';

const lastResults = new Map();
export async function runTool(slot, decision) {
  if (decision.tool === 'open_result') {
    const list = lastResults.get(slot) || [];
    const n = decision.args?.n;
    if (!Number.isInteger(n) || n < 1 || n > list.length) return { tool: 'open_result', ok: false, observation: list.length ? `No saved result ${String(n).slice(0, 8)} — say "open result 1" through "open result ${list.length}".` : 'No saved result with that number — search first, then say "open result 1".' };
    const hit = list[n - 1];
    const out = await viewGo(slot, hit.href);
    // Never claim a successful navigation on error/blocked pages.
    const blocked = /Access Denied|403 Forbidden|Reference #[0-9a-f.]+|Attention Required|Security Check/i.test(String(out.title || '')) ||
      /Access Denied|403 Forbidden/i.test(String(out.error || ''));
    if (blocked) {
      return { tool: 'open_result', ok: false,
        observation: `The site returned ${out.title || 'Access Denied'} for result ${decision.args.n}. The denial page is visible; the requested content was not opened. I cannot bypass the site's access controls.`,
        ui: { showPane: 'pane-browser', browser: out } };
    }
    if (!out.ok) {
      return { tool: 'open_result', ok: false,
        observation: `Browser could not open result ${decision.args.n} (${out.error || 'unavailable'}) — nothing opened.`,
        ui: { showPane: 'pane-browser', browser: out } };
    }
    return { tool: 'open_result', ok: true, observation: `Opened result ${decision.args.n}: ${hit.title} — ${out.url}. Showing in the Browser pane.`,
      ui: { showPane: 'pane-browser', browser: out } };
  }
  switch (decision.tool) {
  // Accepted navigation can still have slow subresources; report that state
  // instead of inventing a loaded page or replacing its real WebView.
    case 'browser_open': {
      const out = await viewGo(slot, decision.args.url);
      const isBlocked = /Access Denied|403 Forbidden|Reference #[0-9a-f.]+|Attention Required|Security Check/i.test(out.title || '');
      if (isBlocked) {
        return {
          tool: decision.tool,
          ok: false,
          observation: `The site returned ${out.title || 'Access Denied'} in the Browser pane. Its requested content is unavailable; I cannot bypass the site's access controls.`,
          ui: { showPane: 'pane-browser', browser: out }
        };
      }
      if (!out.ok) {
        return { tool: decision.tool, ok: false, observation: `Browser could not open ${decision.args.url} (${out.error || 'unavailable'}). No successful navigation was verified.`,
          ui: { showPane: 'pane-browser', browser: out } };
      }
      if(out.loading && !out.title) return {tool:decision.tool,ok:true,observation:`The Browser pane is loading ${out.url || decision.args.url}. Its content is not yet verified.`,ui:{showPane:'pane-browser',browser:out}};
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
      const page={title:out.title,url:out.url,text:String(out.text || '').slice(0,1200)};
      return { tool: decision.tool, ok: true, observation: `Page “${page.title}” (${page.url}):\n${page.text}`, page };
    }
    case 'doc_paste_hint': {
      return { tool: decision.tool, ok: true,
        observation: 'I can\u2019t see your clipboard from here — paste the text, Markdown, HTML or link into the Document pane\u2019s Read box and hit Read. I\u2019ll render a preview and stage it for export.',
        ui: { showPane: 'pane-doc' } };
    }
    case 'doc_open': {
      // Text can be staged; modern binary documents go to the real client
      // reader, without manufacturing an editable draft or a fake preview.
      const target = String(decision.args.url || '');
      const { fetchUpstream, docKindForUrl, sanitizeDocHtml } = await import('./proxy.mjs');
      const { makePastedDoc, markdownToHtml } = await import('./staging.mjs');
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
      if(/\.(pdf|docx|odt|xlsx|pptx)(?:[?#]|$)/i.test(target)){
        return {tool:decision.tool,ok:true,observation:`Opening “${titleOf(target)}” in the Document reader. Document text has not been returned to the model; do not claim to have read or summarised it.`,
          ui:{showPane:'pane-doc',doc:{title:titleOf(target),sourceUrl:target,binary:true}}};
      }
      if(docKindForUrl(target)==='binary') return {tool:decision.tool,ok:false,observation:'This legacy document needs conversion to PDF, DOCX, ODT, XLSX or PPTX.',ui:{showPane:'pane-doc'}};
      let up;
      try { up = await fetchUpstream(target, slot); }
      catch (e) {
        return { tool: decision.tool, ok: false,
          observation: `I could not fetch ${target} (${String(e && e.message || e).slice(0, 120)}) — nothing staged, nothing faked.`,
          ui: { showPane: 'pane-doc' } };
      }
      if(up.status<200 || up.status>=300) return {tool:decision.tool,ok:false,observation:'Document server returned HTTP '+up.status+'.',ui:{showPane:'pane-doc'}};
      const ctype = String((up.headers && (up.headers.get ? up.headers.get('content-type') : up.headers['content-type'])) || '').toLowerCase();
      const isText = /text\/|markdown|json|xml|javascript/.test(ctype) || docKindForUrl(target) === 'text';
      if (!isText || !up.body || !up.body.length) {
        return {tool:decision.tool,ok:false,observation:'This response is not a supported text document. Use a PDF, DOCX, ODT, XLSX, PPTX or text file.',ui:{showPane:'pane-doc'}};
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
      // UI always carries the actual browser location + native flag — never a bare pane switch.
      const browser = { url: out.pageUrl || '', native: !!out.native, via: out.via || '' };
      if (!out.ok) {
        const where = out.pageUrl ? ` (Browser pane: ${out.pageUrl}${out.native ? ' — native view' : ''})` : '';
        return { tool: decision.tool, ok: false, observation: `Web search “${decision.args.query}” could not run (${out.error || 'unavailable'})${where} — try opening a site directly (“open bbc news”).`,
          ui: { showPane: 'pane-browser', browser }, results: [] };
      }
      const lines = (out.results || []).map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.href})`).join('\n');
      const where = out.pageUrl ? ` [${out.pageUrl}${out.native ? ' — native' : ''}]` : (out.native ? ' [native]' : '');
      const obs = lines
        ? `Web search “${decision.args.query}”${where}:\n${lines}`
        : (out.pageUrl
          ? `Web search “${decision.args.query}” is showing live in your Browser pane (${out.pageUrl}${out.native ? ' — native view' : ''}) — results are rendering there; tell me what you see or say "read this page" and I'll read it.`
          : `Web search “${decision.args.query}” is showing live in your Browser pane — tell me what you see or say "read this page".`);
      return { tool: decision.tool, ok: true, observation: obs,
        ui: { showPane: 'pane-browser', browser }, results: out.results };
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
