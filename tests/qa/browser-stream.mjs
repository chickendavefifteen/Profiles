// Exercise actual CDP/JPEG streaming with a client disconnect during setup.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { ensureSoftwareRuntime } from '../../scripts/qa-software-runtime.mjs';
ensureSoftwareRuntime();
const vault = await mkdtemp('/tmp/profiles-stream-state-');
process.env.PROFILES_VAULT_DIR = vault;
process.env.PROFILES_DISABLE_KEYRING = '1';
process.env.PROFILES_DEMO_MODE = '0';
const browser = await import('../../agent/browseract.mjs');
const { handleAgent } = await import('../../agent/sidecar.mjs');
const { withSlot, ensureSlot } = await import('../../agent/slots.mjs');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await fn()) return; await pause(20); }
  throw Error('Stream lifecycle did not settle');
}
let handled = 0;
const closed = [];
const server = createServer((req, res) => {
  if (req.url === '/fixture') { res.end('<title>STREAM-LIFETIME</title><h1>Actual browser pixels</h1>'); return; }
  const end = defer(); closed.push(end);
  res.once('close', end.resolve);
  withSlot('A', () => handleAgent(req, res)).then(() => { handled++; }).catch(error => res.destroy(error));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
function client() {
  const response = defer();
  const req = request(base + '/api/browser/stream?profileSlot=A&tabId=tab-1', res => response.resolve(res));
  req.on('error', () => {}); req.end();
  return { req, response: response.promise };
}
async function jpeg(res) {
  let all = Buffer.alloc(0);
  for await (const chunk of res.iterator({ destroyOnReturn: false })) {
    all = Buffer.concat([all, chunk]);
    const header = all.indexOf('\r\n\r\n');
    if (header < 0) continue;
    const length = Number(all.subarray(0, header).toString().match(/Content-Length: (\d+)/i)?.[1]);
    if (!length || all.length < header + 4 + length) continue;
    const pixels = all.subarray(header + 4, header + 4 + length);
    assert.equal(pixels.readUInt16BE(0), 0xffd8);
    assert.equal(pixels.readUInt16BE(pixels.length - 2), 0xffd9);
    return pixels;
  }
  throw Error('Stream ended without a complete JPEG');
}
let release;
try {
  await ensureSlot('A');
  const target = await browser.ensureSession('A');
  await target.page.goto(base + '/fixture');
  const original = target.page.screenshot.bind(target.page);
  function delayNextProof() {
    const reached = defer(), resume = defer(); let first = true;
    release = resume.resolve;
    target.page.screenshot = async (...args) => {
      const pixels = await original(...args);
      if (first) { first = false; reached.resolve(); await resume.promise; }
      return pixels;
    };
    return { reached: reached.promise, resume: resume.resolve };
  }
  // A disconnected setup has no subscriber; its encoder must stop.
  const firstGate = delayNextProof(), first = client();
  await firstGate.reached;
  first.req.destroy(); await closed[0].promise;
  const abandoned = await browser.ensureScreencast('A');
  firstGate.resume(); await until(() => handled === 1);
  await until(() => abandoned.dead);
  assert.equal(abandoned.stream.listenerCount('data'), 0);
  console.log('ok - disconnect during initial screenshot stops the unobserved CDP stream');
  // An old setup closing must not stop a cast already used by a new client.
  const secondGate = delayNextProof(), old = client();
  await secondGate.reached;
  old.req.destroy(); await closed[1].promise;
  const live = client(), response = await live.response;
  assert.equal(response.statusCode, 200);
  const pixels = await jpeg(response);
  const cast = await browser.ensureScreencast('A');
  secondGate.resume(); await until(() => handled === 3);
  assert.equal(cast.dead, false);
  assert.equal(cast.stream.listenerCount('data'), 1, 'Only the live response may subscribe');
  live.req.destroy(); response.destroy();
  await until(() => cast.dead);
  assert.equal(cast.stream.listenerCount('data'), 0);
  console.log('ok - late abandoned setup preserves the new JPEG viewer; last viewer closes its encoder (' + pixels.length + ' real JPEG bytes)');
} finally {
  release?.();
  await browser.closeAllSessions();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(vault, { recursive: true, force: true });
}
