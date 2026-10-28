// Cloud + accounts (P3). Secrets live in the OS keyring (libsecret via
// secret-tool), keyed per profile slot — never in vault plain text.
// Cloud is OFF until the profile enables it AND a key exists. Google
// OAuth is real PKCE; it needs the owner's own Google Cloud client
// (PROFILES_GOOGLE_CLIENT_ID / _SECRET) — without one, start explains.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slotPaths } from './slots.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function secretTool(args, input) {
  return new Promise((resolve) => {
    const c = spawn('secret-tool', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', () => resolve({ ok: false, out: '' }));
    c.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
    if (input != null) { c.stdin.write(input); }
    c.stdin.end();
  });
}
export async function storeSecret(slot, kind, value) {
  const r = await secretTool(['store', '--label', `Profiles ${slot} ${kind}`, 'service', 'profiles', 'profile', slot, 'kind', kind], value);
  return r.ok ? { ok: true, storage: 'os-keyring (libsecret)' } : { ok: false, error: 'keyring unavailable' };
}
export async function getSecret(slot, kind) {
  const r = await secretTool(['lookup', 'service', 'profiles', 'profile', slot, 'kind', kind]);
  return r.ok && r.out ? r.out : null;
}
export async function cloudStatus(slot, profile) {
  const key = await getSecret(slot, 'cloud-api-key');
  return { enabled: !!profile?.cloudEnabled, hasKey: !!key, model: profile?.cloudModel || 'gpt-4o-mini',
    base: profile?.cloudBase || 'https://api.openai.com/v1', storage: 'os-keyring' };
}

/** One cloud answer. Only called when enabled + key present. */
export async function cloudAnswer(slot, profile, query, modeLabel) {
  const key = await getSecret(slot, 'cloud-api-key');
  if (!key) return { ok: false, reason: 'no cloud key stored' };
  const base = (profile.cloudBase || 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: profile.cloudModel || 'gpt-4o-mini', max_tokens: 300,
        messages: [{ role: 'system', content: `You are the Profiles agent (mode ${modeLabel}). Helpful, plain-spoken, concise. Never claim you sent, bought, deleted or published anything.` },
          { role: 'user', content: String(query).slice(0, 1200) }] }),
    });
    if (!res.ok) return { ok: false, reason: 'cloud HTTP ' + res.status };
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text ? { ok: true, text: text.slice(0, 1600), model: profile.cloudModel || 'gpt-4o-mini' } : { ok: false, reason: 'empty cloud reply' };
  } catch (e) { return { ok: false, reason: 'cloud unreachable: ' + String(e.message).slice(0, 100) }; }
}

/* ---------------- Google OAuth (PKCE) + Docs push ---------------- */
const pendingOAuth = new Map();
const b64url = (buf) => Buffer.from(buf).toString('base64url');
export function googleClient() {
  const id = process.env.PROFILES_GOOGLE_CLIENT_ID || '';
  const secret = process.env.PROFILES_GOOGLE_CLIENT_SECRET || '';
  return id && secret ? { id, secret } : null;
}
export function googleStart(slot, redirectUri) {
  const client = googleClient();
  if (!client) return { ok: false, error: 'No Google client configured. Create one free in Google Cloud Console (OAuth, Desktop), then set PROFILES_GOOGLE_CLIENT_ID and PROFILES_GOOGLE_CLIENT_SECRET for the sidecar. Nothing else about Profiles changes.' };
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(12));
  pendingOAuth.set(state, { slot, verifier, redirectUri, expires: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: client.id, redirect_uri: redirectUri, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents',
    code_challenge: challenge, code_challenge_method: 'S256', state,
    access_type: 'offline', prompt: 'consent',
  });
  return { ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() };
}
export async function googleCallback(code, state) {
  const job = pendingOAuth.get(state);
  pendingOAuth.delete(state);
  if (!job) return { ok: false, error: 'oauth state missing/expired — start again' };
  if (Date.now() > job.expires) return { ok: false, error: 'oauth expired — start again' };
  const client = googleClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: client.id, client_secret: client.secret,
      redirect_uri: job.redirectUri, grant_type: 'authorization_code', code_verifier: job.verifier }),
  });
  if (!res.ok) return { ok: false, error: 'token exchange HTTP ' + res.status };
  const tok = await res.json();
  if (tok.refresh_token) await storeSecret(job.slot, 'google-refresh-token', tok.refresh_token);
  if (tok.access_token) await storeSecret(job.slot, 'google-access-token', tok.access_token);
  return { ok: true, slot: job.slot, connected: !!tok.refresh_token };
}
async function googleAccessToken(slot) {
  const rt = await getSecret(slot, 'google-refresh-token');
  if (!rt) return null;
  const client = googleClient();
  if (!client) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: rt, client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token' }),
  });
  if (!res.ok) return null;
  const tok = await res.json();
  return tok.access_token || null;
}
export async function googleStatus(slot) {
  return { connected: !!(await getSecret(slot, 'google-refresh-token')), clientConfigured: !!googleClient() };
}

/** Push a staged draft to Google Docs (docx -> converted Doc). */
export async function googlePush(slot, stagedId, draftToDocxFn) {
  const token = await googleAccessToken(slot);
  if (!token) return { ok: false, error: 'Google not connected for this profile (or client not configured)' };
  const p = slotPaths(slot);
  let draft;
  try { draft = JSON.parse(await readFile(join(p.staging, stagedId + '.json'), 'utf8')); }
  catch { return { ok: false, error: 'no such staged draft' }; }
  const docx = draftToDocxFn(draft);
  const boundary = 'profiles' + randomBytes(6).toString('hex');
  const meta = JSON.stringify({ name: draft.title, mimeType: 'application/vnd.google-apps.document' });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
    docx, Buffer.from(`\r\n--${boundary}--`)]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'multipart/related; boundary=' + boundary }, body });
  if (!res.ok) return { ok: false, error: 'Drive upload HTTP ' + res.status };
  const out = await res.json();
  return { ok: true, fileId: out.id, link: out.webViewLink, title: draft.title };
}
