// Model-agent checks — zero deps: node tests/model-agent.mjs
// Covers the new smart-model turn WITHOUT network: routing fixes in
// agentloop.decideTool, tool schema gates + target resolution in
// agent/model-agent.mjs, and honest no-config/no-key early failures.
// Anything needing a provider, keyring key or local server is NOT tested
// here (principal runs those live); every assertion below is deterministic.
import { decideTool } from '../src/agent-routing.mjs';
import { resolveSelection, resolveCloudTarget, resolveLocalTarget, validateModelTool, runModelTurn, DEFAULT_CLOUD_MODEL, DEFAULT_CLOUD_BASE } from '../agent/model-agent.mjs';

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
const savedEnv = { PROFILES_LOCAL_BASE: process.env.PROFILES_LOCAL_BASE, LOCAL_OPENAI_BASE: process.env.LOCAL_OPENAI_BASE };
delete process.env.PROFILES_LOCAL_BASE;
delete process.env.LOCAL_OPENAI_BASE;

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

Object.assign(process.env, Object.fromEntries(Object.entries(savedEnv).filter(([, v]) => v !== undefined)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
