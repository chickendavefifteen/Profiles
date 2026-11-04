// The agent tool loop — how Claude Code / Codex actually work, distilled:
//   sense (classify) -> decide (deterministic router first, model second)
//   -> act (ONE allowlisted tool) -> observe (result fed back) -> answer.
// Tools are real functions with schemas, not vibes. Every tool returns
// structured observation; the chat answer is built from it, and the UI
// gets explicit actions (open this pane, refresh that view). MCP servers
// configured per profile join the same registry (tools/list, tools/call
// over JSON-RPC HTTP) — the runtime executes, the model suggests.
import { viewGo, viewCurrent, viewRead, webSearch, viewClick, viewType, viewPress, viewScreenshot } from './browseract.mjs';
import { inflateSync } from 'node:zlib';

export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

/** Accept bounded, decodable PNG pixels only. Never read a receipt from disk. */
export function validateScreenshot(image) {
  const fail = (error) => ({ error });
  const dataUrl = image?.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) return fail('missing PNG data URL');
  if (dataUrl.length > PNG_PREFIX.length + 4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3)) return fail('PNG exceeds 4 MiB byte limit');
  const encoded = dataUrl.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return fail('invalid PNG base64');
  const png = Buffer.from(encoded, 'base64');
  if (png.length > MAX_SCREENSHOT_BYTES) return fail('PNG exceeds 4 MiB byte limit');
  if (png.toString('base64') !== encoded || png.length < 57 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return fail('invalid PNG signature or encoding');
  if (image.mime != null && image.mime !== 'image/png') return fail('screenshot MIME is not image/png');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width !== width || image.height !== height)
    return fail('PNG dimensions missing or inconsistent');
  if (!width || !height || width > 16384 || height > 16384 || width * height > 16 * 1024 * 1024) return fail('PNG dimensions exceed pixel limit');
  const depth = png[24], color = png[25], interlace = png[28];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color];
  if (!channels || !depths.includes(depth) || png[26] !== 0 || png[27] !== 0 || interlace > 1) return fail('invalid PNG header');
  const idat = [];
  let ended = false, palette = false, dataEnded = false;
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) return fail('truncated PNG chunk');
    const length = png.readUInt32BE(offset), end = offset + 12 + length;
    if (end > png.length) return fail('truncated PNG chunk');
    const type = png.toString('ascii', offset + 4, offset + 8);
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++) crc = crcTable[(crc ^ png[i]) & 255] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== png.readUInt32BE(end - 4)) return fail('PNG checksum mismatch');
    if (offset === 8 ? type !== 'IHDR' || length !== 13 : type === 'IHDR') return fail('invalid PNG header order');
    if (type === 'PLTE') {
      if (palette || idat.length || !length || length % 3 || length > 768 || color === 0 || color === 4) return fail('invalid PNG palette');
      palette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) return fail('invalid PNG image data order');
      idat.push(png.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      if (length || !idat.length || end !== png.length) return fail('invalid PNG end chunk');
      ended = true;
    } else if (type !== 'IHDR' && !(png[offset + 4] & 32)) return fail('unsupported PNG critical chunk');
    if (idat.length && type !== 'IDAT') dataEnded = true;
    offset = end;
  }
  if (!ended) return fail('incomplete PNG');
  // Validate decompression and every scanline, including Adam7 interlacing.
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const rows = passes.map(([x,y,dx,dy]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    return { stride: Math.ceil(w * channels * depth / 8) + 1, count: w ? h : 0 };
  });
  const decodedBytes = rows.reduce((n, row) => n + row.stride * row.count, 0);
  if (decodedBytes > 64 * 1024 * 1024) return fail('PNG decoded byte limit exceeded');
  try {
    const pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: decodedBytes });
    if (pixels.length !== decodedBytes) return fail('invalid PNG pixel length');
    let offset = 0;
    for (const row of rows) for (let n = 0; n < row.count; n++, offset += row.stride)
      if (pixels[offset] > 4) return fail('invalid PNG scanline filter');
  } catch { return fail('invalid or oversized PNG pixel data'); }
  return { dataUrl, width, height, mime: 'image/png', bytes: png.length };
}

const lastResults = new Map();
export async function runTool(slot, decision, { screenshot = viewScreenshot } = {}) {
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
      const page={title:out.title,url:out.url,slot:out.slot || slot,tabId:out.tabId,text:String(out.text || '').slice(0,1200)};
      return { tool: decision.tool, ok: true, observation: `Page “${page.title}” (${page.url}):\n${page.text}`, page };
    }
    case 'browser_click': {
      const out = await viewClick(slot, decision.args?.fx, decision.args?.fy, decision.args?.selector);
      if (!out || out.ok !== true) {
        return { tool: decision.tool, ok: false, observation: `Could not click ${decision.args?.selector || 'on page'} (${out?.error || 'element not found'}).`, ui: { showPane: 'pane-browser', browser: out } };
      }
      const targetDesc = decision.args?.selector ? `“${decision.args.selector}”` : `at (${Math.round((decision.args?.fx ?? 0.5) * 100)}%, ${Math.round((decision.args?.fy ?? 0.5) * 100)}%)`;
      return { tool: decision.tool, ok: true, observation: `Clicked ${targetDesc} on ${out.url || 'the page'} (${out.title || 'updated'}).`, ui: { showPane: 'pane-browser', browser: out } };
    }
    case 'browser_type': {
      const out = await viewType(slot, decision.args?.text, decision.args?.selector, decision.args?.press, decision.args?.clear);
      if (!out || out.ok !== true) {
        return { tool: decision.tool, ok: false, observation: `Could not type into page (${out?.error || 'failed'}).`, ui: { showPane: 'pane-browser', browser: out } };
      }
      const intoDesc = decision.args?.selector ? ` into “${decision.args.selector}”` : '';
      const pressDesc = decision.args?.press ? ` and pressed ${decision.args.press}` : '';
      return { tool: decision.tool, ok: true, observation: `Typed “${decision.args.text}”${intoDesc}${pressDesc} on ${out.url || 'the page'}.`, ui: { showPane: 'pane-browser', browser: out } };
    }
    case 'browser_press': {
      const out = await viewPress(slot, decision.args?.key);
      if (!out || out.ok !== true) {
        return { tool: decision.tool, ok: false, observation: `Could not press key “${decision.args?.key}” (${out?.error || 'failed'}).`, ui: { showPane: 'pane-browser', browser: out } };
      }
      return { tool: decision.tool, ok: true, observation: `Pressed “${decision.args.key}” on ${out.url || 'the page'}.`, ui: { showPane: 'pane-browser', browser: out } };
    }
    case 'browser_screenshot': {
      const out = await screenshot(slot, decision.args?.fullPage);
      // Pixels are transient model input, not a UI/history/activity receipt.
      const { dataUrl, ...browser } = out || {};
      const image = out?.ok === true ? validateScreenshot(out) : { error: out?.error || 'capture failed' };
      if (image.error) {
        return { tool: decision.tool, ok: false, observation: `Could not capture screenshot (${image.error}).`, ui: { showPane: 'pane-browser', browser } };
      }
      return { tool: decision.tool, ok: true, screenshot: image,
        observation: `Captured PNG screenshot of ${out.url || 'the page'} (${image.width}×${image.height}). Capture alone does not mean image pixels were delivered to a model.`,
        ui: { showPane: 'pane-browser', browser } };
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
      lastResults.delete(slot);
      const out = await webSearch(slot, decision.args.query);
      if (out.ok && out.results && out.results.length) lastResults.set(slot, out.results);
      // UI always carries the actual browser location + native flag — never a bare pane switch.
      const browser = { url: out.pageUrl || '', native: !!out.native, via: out.via || '', slot: out.slot || slot, tabId: out.tabId };
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
