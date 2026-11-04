// Universal web-dark state: pure logic, no DOM. Tested by tests/run.mjs;
// main.js inlines the same rules for the live app (see WEBDARK_MIRROR).
var STORE_GLOBAL = 'profiles.webDark';
var STORE_SITES = 'profiles.webDarkSites';

export function hostOf(url) {
  try {
    var u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase();
  } catch (e) { return ''; }
}

export function parseSites(raw) {
  try {
    var o = JSON.parse(raw || '{}');
    if (!o || typeof o !== 'object') return {};
    var out = {};
    for (var k of Object.keys(o)) { if (o[k] === true || o[k] === false) out[String(k).toLowerCase()] = o[k]; }
    return out;
  } catch (e) { return {}; }
}

// Effective state for a URL: per-site override wins, else the global.
export function effectiveDark(url, globalOn, sites) {
  var h = hostOf(url);
  if (h && sites && Object.prototype.hasOwnProperty.call(sites, h)) return !!sites[h];
  return !!globalOn;
}

// Flip the EFFECTIVE state for this site: store a site override.
// Returns {globalOn, sites} — caller persists.
export function toggleSite(url, globalOn, sites) {
  var h = hostOf(url);
  var next = Object.assign({}, sites || {});
  var now = effectiveDark(url, globalOn, next);
  if (h) next[h] = !now;
  return { globalOn: !!globalOn, sites: next, dark: h ? !now : !globalOn };
}

// Flip the global; clears per-site overrides.
export function toggleGlobal(globalOn) {
  return { globalOn: !globalOn, sites: {}, dark: !globalOn };
}
