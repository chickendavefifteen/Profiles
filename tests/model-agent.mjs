// Model-agent checks — zero deps: node tests/model-agent.mjs
// Routing, consent boundaries, demo cloud lock and genuine screenshot delivery.
// Provider fetches, secret lookup and browser capture are replaced at their
// I/O boundaries: no live cloud/keyring/browser calls in the added tests.
import { decideTool } from '../src/agent-routing.mjs';
import { resolveSelection, resolveCloudTarget, resolveLocalTarget, validateModelTool, runModelTurn, DEFAULT_CLOUD_MODEL, DEFAULT_CLOUD_BASE } from '../agent/model-agent.mjs';
import { runTool, validateScreenshot, MAX_SCREENSHOT_BYTES } from '../agent/agentloop.mjs';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name} ${extra}`); }
}

// A request to inspect the current page is not consent to replace it.
const inspect='Could you inspect the current page and tell me its title?';
ok(!!validateModelTool('browser_open',{url:'https://example.com'},inspect).error,'current-page request cannot navigate to a guessed example');
ok(!!validateModelTool('web_search',{query:'some other page'},inspect).error,'current-page request cannot replace the page with a search');
ok(validateModelTool('browser_read',{},inspect).tool==='browser_read','current-page request may read its displayed page');
ok(validateModelTool('browser_open',{url:'https://example.com'},'Open example.com').tool==='browser_open','explicit navigation remains available');

// Scrub local-endpoint env so "unconfigured" assertions are hermetic.
const savedEnv = { PROFILES_LOCAL_BASE: process.env.PROFILES_LOCAL_BASE, LOCAL_OPENAI_BASE: process.env.LOCAL_OPENAI_BASE, PROFILES_DEMO_MODE: process.env.PROFILES_DEMO_MODE };
delete process.env.PROFILES_LOCAL_BASE;
delete process.env.LOCAL_OPENAI_BASE;
process.env.PROFILES_DEMO_MODE = '0';

// 1. Cheap intent path intact: exact known sites still open directly.
ok(decideTool('bbc news')?.tool === 'browser_open', 'route: bare "bbc news" opens');
ok(decideTool('sky news')?.tool === 'browser_open', 'route: bare "sky news" opens');
ok(decideTool('open a brower on bbc news')?.tool === 'browser_open', 'route: typo-tolerant browser open');
ok(decideTool('open channel 4 website')?.args?.url === 'https://www.channel4.com', 'route: "open channel 4 website" opens channel4.com');
ok(decideTool('open itvx')?.tool === 'browser_open', 'route: bare "open itvx" opens directly');
ok(decideTool('open film4')?.tool === 'browser_open', 'route: bare "open film4" opens directly');
ok(decideTool('open example.com/notes.txt')?.tool === 'doc_open', 'route: bare doc url routes to doc pane');
ok(decideTool('https://example.com/Report.PDF?download=1')?.tool === 'doc_open', 'route: pasted PDF URL opens the document reader');
ok(decideTool('example.com/Workbook.xlsx')?.args.url === 'https://example.com/Workbook.xlsx' && decideTool('example.com/Workbook.xlsx')?.tool === 'doc_open', 'route: bare workbook URL preserves path case in the document reader');

// 2. Overbroad selection fixed: no fuzzy substring hijack, no blind auto-open.
ok(decideTool('open north berwick chip shop menu')?.tool === 'web_search', 'route: unknown open-intent still searches');
const u = decideTool('open north berwick chip shop menu');
ok(u && u.tool === 'web_search' && !('openTop' in (u.args || {})), 'route: no openTop flag emitted at all');
ok(u && !('url' in (u.args || {})), 'route: unknown open-intent never fabricates a URL to open');
const bare = decideTool('allotment jobs october');
ok(bare?.tool === 'web_search' && bare.args?.query === 'allotment jobs october', 'route: bare topic stays web_search (model justifies, never blind-opens)');
ok(bare && !('openTop' in (bare.args || {})) && !('url' in (bare.args || {})), 'route: bare topic never auto-opens either');
ok(decideTool('hi') === null && decideTool('what is 2+2?') === null, 'route: greetings/questions stay chat');
ok(decideTool('search the web for allotment jobs')?.tool === 'web_search', 'route: explicit search still searches');
ok(decideTool('draft a letter about rent') === null, 'route: no hijacking doc asks');

// 3. Tool schema gate: real shapes pass, sloppy/dangerous ones fail shut.
ok(validateModelTool('web_search', { query: 'chip shop menu' }).tool === 'web_search', 'gate: good web_search passes');
ok(validateModelTool('web_search', { query: 'x' }).error, 'gate: 1-char search rejected');
ok(validateModelTool('open_result', { n: 2 }).tool === 'open_result', 'gate: good open_result passes');
ok(validateModelTool('open_result', { n: 0 }).error && validateModelTool('open_result', { n: 99 }).error, 'gate: out-of-range result rejected');
ok(validateModelTool('browser_open', { url: 'https://example.com/a' }).tool === 'browser_open', 'gate: explicit https URL passes');
ok(validateModelTool('browser_open', { url: 'example.com/a' }).args.url === 'https://example.com/a', 'gate: bare domain normalised');
ok(validateModelTool('browser_open', { url: 'fluffy cats please' }).error, 'gate: prose is not openable (search first)');
ok(validateModelTool('doc_open', { url: 'https://x.org/notes.md' }).tool === 'doc_open', 'gate: doc URL passes');
ok(validateModelTool('doc_open', { url: 'not a url' }).error, 'gate: doc needs a full URL');
ok(validateModelTool('browser_read', {}).tool === 'browser_read', 'gate: arg-less tools pass');
ok(validateModelTool('shell_exec', { cmd: 'rm -rf ~' }).error, 'gate: no shell tool exists');
ok(validateModelTool('click', { fx: 0.5 }).error, 'gate: no click tool exists');

ok(validateModelTool('browser_click', { selector: '#submit' }).tool === 'browser_click', 'gate: browser_click with selector passes');
ok(validateModelTool('browser_click', { fx: 0.5, fy: 0.2 }).tool === 'browser_click', 'gate: browser_click with coordinates passes');
ok(validateModelTool('browser_click', {}).error, 'gate: browser_click without selector or coordinates rejected');
ok(validateModelTool('browser_type', { text: 'hello', selector: 'input' }).tool === 'browser_type', 'gate: browser_type with text and selector passes');
ok(validateModelTool('browser_type', { text: 'search query', press: 'Enter' }).args.press === 'Enter', 'gate: browser_type with press Enter passes');
ok(validateModelTool('browser_type', { text: '' }).error, 'gate: browser_type with empty text rejected');
ok(validateModelTool('browser_press', { key: 'Enter' }).tool === 'browser_press', 'gate: browser_press with key passes');
ok(validateModelTool('browser_press', {}).error, 'gate: browser_press without key rejected');
ok(validateModelTool('browser_screenshot', {}).tool === 'browser_screenshot', 'gate: browser_screenshot passes');
ok(!validateModelTool('browser_click', { selector: 'button' }, 'click this button on the page').error, 'gate: browser_click allowed on current page');
ok(!validateModelTool('browser_type', { text: 'abc' }, 'type in the box on this page').error, 'gate: browser_type allowed on current page');
for (const args of [
  { fx: 0.5 }, { fy: 0.5 }, { fx: null, fy: 0.5 }, { fx: '0.5', fy: 0.5 },
  { fx: NaN, fy: 0.5 }, { fx: 0.5, fy: Infinity }, { fx: -0.1, fy: 0.5 }, { fx: 0.5, fy: 1.1 },
]) {
  ok(!!validateModelTool('browser_click', args).error, 'gate: invalid/partial coordinate pair fails');
  ok(!!validateModelTool('browser_click', { ...args, selector: '#safe' }).error, 'gate: selector cannot hide invalid coordinates');
}
ok(!validateModelTool('browser_click', { fx: 0, fy: 1 }).error, 'gate: inclusive viewport coordinate boundaries pass');

// 4. Selection: explicit agentModel wins, unset falls back honestly.
ok(resolveSelection({ agentModel: 'cloud' }).selection === 'cloud', 'select: explicit cloud');
ok(resolveSelection({ agentModel: 'local' }).selection === 'local', 'select: explicit local');
ok(resolveSelection({ agentModel: 'lite' }).selection === 'lite', 'select: explicit lite');
ok(resolveSelection({ cloudEnabled: true }).selection === 'cloud', 'select: cloud opt-in without explicit choice');
ok(resolveSelection({}).selection === 'none', 'select: unconfigured is none (lite fallback)');
ok(resolveSelection({ localBase: 'http://127.0.0.1:11434/v1' }).selection === 'local', 'select: configured local base found');

// 5. Cloud target: Meta contributor-tier default on the Meta wire, explicit kept, OpenRouter refused.
const cloudDefault = resolveCloudTarget({});
ok(String(DEFAULT_CLOUD_MODEL || '').includes('muse-spark-1.3-contributor'), 'cloud: default model constant is contributor-tier');
ok(!/^muse-spark-1\.3$/i.test(String(cloudDefault.model || '')), 'cloud: resolved default is never the plain tier');
ok(String(cloudDefault.base || '').includes('api.meta.ai') && String(DEFAULT_CLOUD_BASE || '').includes('api.meta.ai'), 'cloud: default base is the Meta wire');
ok(resolveCloudTarget({ cloudModel: 'my-model', cloudBase: 'https://api.example.com/v1' }).model === 'my-model', 'cloud: explicit model kept');
ok(resolveCloudTarget({ cloudModel: 'openrouter/auto' }).error, 'cloud: OpenRouter model refused');
ok(resolveCloudTarget({ cloudBase: 'https://openrouter.ai/api/v1' }).error, 'cloud: OpenRouter base refused');

// 6. Local target: explicit only, never invented.
ok(resolveLocalTarget({}).error, 'local: unconfigured fails with the fix, never a guess');
ok(resolveLocalTarget({ localBase: 'http://127.0.0.1:11434/v1' }).base === 'http://127.0.0.1:11434/v1', 'local: explicit base kept');
ok(resolveLocalTarget({ localBase: 'https://openrouter.ai/api/v1' }).error, 'local: OpenRouter base refused');

// 8. Boundaries: explicit lite wins, plain tier refused, remote local refused,
//    file-turn failures terminate honestly with no guessed action or source.
{
  // Explicit lite keeps the basic brain even when a file and endpoint are present.
  ok(resolveSelection({ agentModel: 'lite', modelFile: 'qwen.gguf', localBase: 'http://127.0.0.1:11434/v1' }).selection === 'lite', 'select: explicit lite wins over file and endpoint');
  const liteWithFile = await runModelTurn({ slot: 'A', profile: { agentModel: 'lite', modelFile: 'missing-qa-model.gguf' }, query: 'hello', modeLabel: 'lifeful', events: [] });
  ok(liteWithFile.ok === false && /lite/.test(liteWithFile.error || ''), 'turn: explicit lite with modelFile still returns lite (no file turn)');
  // Existing modelFile chooses the local-file route, never an invented endpoint.
  const missing = await runModelTurn({ slot: 'A', profile: { agentModel: 'local', modelFile: 'missing-qa-model.gguf' }, query: 'hello', modeLabel: 'lifeful', events: [] });
  ok(missing.ok === false && /missing/.test(missing.error || '') && !/https?:\/\//.test(missing.error || ''), 'turn: missing modelFile fails honestly with no invented endpoint');
  const traversal = await runModelTurn({ slot: 'A', profile: { agentModel: 'local', modelFile: 'a/b.gguf' }, query: 'hello', modeLabel: 'lifeful', events: [] });
  ok(traversal.ok === false && /installed/.test(traversal.error || ''), 'turn: path-like modelFile rejected before anything executes');
  // Plain tier refused with and without the Meta prefix.
  ok(resolveCloudTarget({ cloudModel: 'muse-spark-1.3' }).error, 'cloud: plain muse-spark-1.3 refused (contributor tier only)');
  ok(resolveCloudTarget({ cloudModel: 'meta/muse-spark-1.3' }).error, 'cloud: prefixed plain tier refused too');
  // Local route requires loopback: remote hosts and LAN IPs fail shut.
  ok(resolveLocalTarget({ localBase: 'https://remote.example/v1' }).error, 'local: remote host refused (loopback only)');
  ok(resolveLocalTarget({ localBase: 'http://192.168.1.10:11434/v1' }).error, 'local: LAN address refused (loopback only)');
  // Oversized tool input fails shut without pinning any source.
  ok(validateModelTool('browser_open', { url: 'https://example.com/' + 'a'.repeat(5000) }).error, 'gate: oversized browser URL rejected');
}

// 9. Demo is an exact environment authorization, not profile opt-in or a hint.
const hostileProfile = {
  agentModel: 'local', cloudEnabled: false, cloudBase: 'https://openrouter.ai/api/v1',
  cloudModel: 'meta/muse-spark-1.3', reasoningEffort: 'low',
  localBase: 'http://127.0.0.1:11434/v1', localModel: 'other-model',
  modelFile: 'must-not-load.gguf', localSource: 'file',
};
for (const agentModel of ['local', 'lite', 'cloud', undefined]) {
  const profile = { ...hostileProfile, agentModel };
  const demoEnv = { PROFILES_DEMO_MODE: '1', PROFILES_LOCAL_BASE: 'http://127.0.0.1:9999/v1' };
  const selected = resolveSelection(profile, demoEnv), target = resolveCloudTarget(profile, demoEnv);
  ok(selected.selection === 'cloud' && selected.demo === true, 'demo: overrides every profile/local selection');
  ok(target.base === DEFAULT_CLOUD_BASE && target.model === DEFAULT_CLOUD_MODEL && target.reasoningEffort === 'xhigh', 'demo: endpoint, Contributor tier and effort locked');
}
for (const value of ['0', 'true', '', undefined]) {
  const env = { PROFILES_DEMO_MODE: value };
  ok(resolveSelection(hostileProfile, env).selection === 'local', 'demo off: explicit local precedence preserved');
  ok(resolveCloudTarget({ cloudModel: 'custom', cloudBase: 'https://custom.example/v1' }, env).model === 'custom', 'demo off: explicit cloud target preserved');
}

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const validImage = { dataUrl: pngDataUrl, width: 1, height: 1, mime: 'image/png' };
const capture = { ok: true, ...validImage, url: 'https://example.test/', slot: 'A', tabId: 'tab-2' };
const invalidImages = [
  undefined,
  { file: 'receipt.png', path: '/must/not/read/receipt.png' },
  { ...validImage, dataUrl: 'data:image/jpeg;base64,AAAA' },
  { ...validImage, dataUrl: 'data:image/png;base64,not-png' },
  { ...validImage, width: 2 },
  { ...validImage, height: undefined },
  { ...validImage, mime: 'image/jpeg' },
  { ...validImage, dataUrl: 'data:image/png;base64,' + 'A'.repeat(4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3) + 4) },
];
const corruptPng = Buffer.from(pngDataUrl.split(',')[1], 'base64');
corruptPng[45] ^= 1;
invalidImages.push({ ...validImage, dataUrl: 'data:image/png;base64,' + corruptPng.toString('base64') });
ok(validateScreenshot(validImage).dataUrl === pngDataUrl, 'vision: genuine PNG pixels and dimensions accepted');
for (const image of invalidImages) ok(!!validateScreenshot(image).error, 'vision: absent, invalid, mismatched or oversized PNG fails shut');
const capturedTool = await runTool('A', { tool: 'browser_screenshot', args: {} }, { screenshot: async () => capture });
ok(capturedTool.ok && capturedTool.screenshot.dataUrl === pngDataUrl && capturedTool.screenshot.width === 1, 'vision: actual tool preserves image bytes and dimensions');
ok(capturedTool.ui.browser.tabId === 'tab-2' && capturedTool.ui.browser.slot === 'A', 'vision: screenshot UI preserves originating profile/tab');
ok(!JSON.stringify(capturedTool.ui).includes(pngDataUrl) && !capturedTool.observation.includes(pngDataUrl), 'vision: pixels excluded from UI and textual observations');
const receiptOnly = await runTool('A', { tool: 'browser_screenshot', args: {} }, { screenshot: async () => ({ ok: true, file: 'x.png', path: '/not/read' }) });
ok(receiptOnly.ok === false && /PNG/.test(receiptOnly.observation), 'vision: saved receipt without pixels cannot fake success');

// Exercise the production turn and serialized provider body, not a copied
// request builder. Any local probe or fallback fails this fetch boundary.
const realFetch = globalThis.fetch;
const requests = [];
const secrets = [];
const dependencies = { getSecret: async (slot, kind) => { secrets.push({ slot, kind }); return 'test-only-key'; } };
const turn = (profile = hostileProfile, extra = {}, deps = dependencies) => runModelTurn({
  slot: 'A', profile, query: 'Explain the layout', events: [], ...extra,
}, deps);
const reply = (message) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });
const record = (url, options) => {
  if (url !== DEFAULT_CLOUD_BASE + '/chat/completions') throw new Error('unexpected endpoint or local probe');
  const body = JSON.parse(options.body);
  requests.push(body);
  return body;
};
const isDemoModel = (answer) => answer.model?.name === DEFAULT_CLOUD_MODEL && answer.model?.via === 'cloud' && answer.model?.reasoningEffort === 'xhigh';
try {
  process.env.PROFILES_DEMO_MODE = '1';
  globalThis.fetch = async (url, options) => { record(url, options); return reply({ content: 'cloud answer' }); };
  for (const agentModel of ['local', 'lite', 'cloud', undefined]) {
    const answer = await turn({ ...hostileProfile, agentModel });
    const body = requests.at(-1);
    ok(answer.ok && isDemoModel(answer) && body.model === DEFAULT_CLOUD_MODEL && body.reasoning_effort === 'xhigh', 'demo turn: forced Contributor xhigh really reaches provider body');
  }
  ok(secrets.length === 4 && secrets.every((s) => s.slot === 'A' && s.kind === 'cloud-api-key'), 'demo turn: only existing app-internal cloud key lookup used');
  let before = requests.length;
  const noKey = await turn(hostileProfile, {}, { getSecret: async () => null });
  ok(!noKey.ok && isDemoModel(noKey) && requests.length === before, 'demo failure: missing key retains xhigh metadata, no fallback/probe');
  const keyFailure = await turn(hostileProfile, {}, { getSecret: async () => { throw new Error('private secret-store diagnostic'); } });
  ok(!keyFailure.ok && isDemoModel(keyFailure) && !keyFailure.error.includes('private secret-store'), 'demo failure: lookup error honest and sanitized with xhigh metadata');
  const empty = await turn(hostileProfile, { query: '' });
  ok(!empty.ok && isDemoModel(empty) && requests.length === before, 'demo failure: empty query retains locked metadata without I/O');
  const readFailure = await turn(hostileProfile, { query: 'Read this page' }, { ...dependencies, runTool: async () => { throw new Error('read unavailable'); } });
  ok(!readFailure.ok && isDemoModel(readFailure) && requests.length === before, 'demo failure: page-read exception returns metadata before provider I/O');
  globalThis.fetch = async (url, options) => { record(url, options); return { ok: false, status: 503 }; };
  const failed = await turn();
  ok(!failed.ok && isDemoModel(failed) && requests.length === before + 1 && /No model was substituted/.test(failed.error), 'demo failure: provider error terminates, never retries another model/route');
  globalThis.fetch = async (url, options) => { record(url, options); return reply({}); };
  const emptyReply = await turn();
  ok(!emptyReply.ok && isDemoModel(emptyReply), 'demo failure: empty provider answer retains xhigh metadata');

  // Screenshot tool observation precedes a genuine image_url user message.
  const visionEvents = [], history = [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: [{ type: 'image_url', image_url: { url: pngDataUrl } }] },
  ];
  const historyBefore = JSON.stringify(history);
  let call = 0;
  const toolCalls = [
    { id: 'shot', type: 'function', function: { name: 'browser_screenshot', arguments: '{}' } },
    { id: 'current', type: 'function', function: { name: 'browser_current', arguments: '{}' } },
  ];
  globalThis.fetch = async (url, options) => {
    record(url, options);
    return reply(++call === 1 ? { content: '', tool_calls: toolCalls } : { content: 'The screenshot is one pixel.' });
  };
  const visionAnswer = await turn(hostileProfile, { events: visionEvents, history }, {
    ...dependencies,
    runTool: async (slot, decision) => decision.tool === 'browser_screenshot'
      ? runTool(slot, decision, { screenshot: async () => capture })
      : { ok: true, observation: 'Current page is example.test' },
  });
  const visionRequest = requests.at(-1), imageMessage = visionRequest.messages.at(-1);
  ok(visionAnswer.ok && call === 2 && isDemoModel(visionAnswer), 'vision: real model turn continues after screenshot observation');
  ok(imageMessage.role === 'user' && imageMessage.content[1]?.type === 'image_url' && imageMessage.content[1].image_url.url === pngDataUrl, 'vision: exact PNG pixels serialized as multimodal image_url');
  ok(visionRequest.messages.at(-2).role === 'tool' && visionRequest.messages.at(-2).tool_call_id === 'current', 'vision: all simultaneous tool observations complete before image user message');
  ok(!requests.at(-2).messages.some((m) => Array.isArray(m.content)), 'vision: historical images are not replayed');
  ok(JSON.stringify(history) === historyBefore && !JSON.stringify(visionAnswer).includes(pngDataUrl) && !JSON.stringify(visionEvents).includes(pngDataUrl), 'vision: no mutation/pixels in retained history, result or traces');
  const policy = visionRequest.messages[0].content;
  ok(/untrusted/.test(policy) && /explicit confirmation/.test(policy) && /credential/.test(policy), 'vision: page pixels remain untrusted and exact-action/credential consent retained');

  // A provider may request screenshots even when capture fails: next request
  // must report false, contain no image, and make no visual-success assertion.
  for (const image of invalidImages) {
    let n = 0;
    const events = [];
    globalThis.fetch = async (url, options) => {
      record(url, options);
      return reply(++n === 1 ? { tool_calls: [toolCalls[0]] } : { content: 'Screenshot unavailable.' });
    };
    await turn(hostileProfile, { events }, { ...dependencies, runTool: async () => ({ ok: true, screenshot: image, observation: 'untrusted fake success' }) });
    const request = requests.at(-1);
    const observation = JSON.parse(request.messages.at(-1).content);
    ok(observation.ok === false && /Screenshot pixels unavailable/.test(observation.observation) && !request.messages.some((m) => Array.isArray(m.content)), 'vision failure: invalid PNG never enters provider image content or fake success');
    ok(events.some((e) => e.tool === 'browser_screenshot' && e.ok === false), 'vision failure: capture rejection exposed as failed tool event');
  }
  let n = 0;
  globalThis.fetch = async (url, options) => {
    record(url, options);
    return ++n === 1 ? reply({ tool_calls: [toolCalls[0]] }) : { ok: false, status: 400 };
  };
  const visionRejected = await turn(hostileProfile, {}, { ...dependencies, runTool: async () => capturedTool });
  ok(!visionRejected.ok && isDemoModel(visionRejected) && /HTTP 400/.test(visionRejected.error), 'vision failure: image provider rejection is not a visual answer or text-only fallback');

  // Simple commands whose tools succeed must not die as "no final answer".
  const clickCall = [{ id: 'c1', type: 'function', function: { name: 'browser_click', arguments: '{"selector":"Search"}' } }];
  globalThis.fetch = async (url, options) => { record(url, options); return reply({ content: '', tool_calls: clickCall }); };
  const clicked = await turn(hostileProfile, { query: 'click on Search' }, {
    ...dependencies, runTool: async () => ({ ok: true, observation: 'clicked the Search button' }),
  });
  ok(clicked.ok && isDemoModel(clicked) && /clicked the Search button/.test(clicked.text || ''), 'loop: stubborn tool-calling after successful tools closes out done, not bound-error');
  globalThis.fetch = async (url, options) => { record(url, options); return reply({ content: '', tool_calls: clickCall }); };
  const failedTools = await turn(hostileProfile, { query: 'click on Search' }, {
    ...dependencies, runTool: async () => ({ ok: false, observation: 'no matching page control' }),
  });
  ok(!failedTools.ok && isDemoModel(failedTools) && /bound reached/.test(failedTools.error || ''), 'loop: nothing succeeded keeps the honest bound error');

  // Demo off preserves both opt-in failure and the selected local route.
  process.env.PROFILES_DEMO_MODE = '0';
  globalThis.fetch = async () => { throw new Error('unexpected network'); };
  const disabled = await turn({ agentModel: 'cloud', cloudEnabled: false });
  ok(!disabled.ok && /not enabled/.test(disabled.error), 'demo off: cloud still needs profile authorization');
  const explicitLite = await turn({ agentModel: 'lite', modelFile: 'must-not-load.gguf' });
  ok(!explicitLite.ok && /lite/.test(explicitLite.error), 'demo off: explicit lite still wins without provider/file fallback');
  const localUrls = [];
  globalThis.fetch = async (url, options) => {
    localUrls.push(url);
    if (url === 'http://127.0.0.1:11434/v1/models') return { ok: true, json: async () => ({ data: [{ id: 'running-model' }] }) };
    if (url !== 'http://127.0.0.1:11434/v1/chat/completions') throw new Error('unexpected cloud route');
    const body = JSON.parse(options.body);
    ok(body.model === 'running-model' && !body.reasoning_effort, 'demo off: local provider body unchanged');
    return reply({ content: 'local answer' });
  };
  const local = await turn({ agentModel: 'local', localBase: 'http://127.0.0.1:11434/v1', localModel: 'running-model' });
  ok(local.ok && local.model?.via === 'local' && localUrls.length === 2, 'demo off: existing local probe and turn semantics preserved');
} finally {
  globalThis.fetch = realFetch;
}

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
