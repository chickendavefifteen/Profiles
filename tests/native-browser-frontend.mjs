import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A navigation can finish after its person has switched away. Its polling
// must remain tied to the original browser, without changing the new person.
let releaseNavigation;
const navigation = new Promise(resolve => { releaseNavigation = resolve; });
const pages = new Map([['A', {ok:true,slot:'A',url:'https://example.org/A',loading:false}], ['B', {ok:true,slot:'B',url:'https://example.org/B',loading:false}]]);
const window = {
  __TAURI__: {
    core: {invoke: async (command,args) => {
      if(command==='browser_switch' || command==='browser_ensure') return pages.get(args.slot) || {ok:false,error:'Unknown profile'};
      if(command==='browser_navigate') { await navigation; return pages.get(args.slot); }
      if(command==='browser_current') return pages.get(args.slot) || {ok:false,error:'Unknown profile'};
      throw new Error('Unexpected command: '+command);
    }},
    event: {listen: async () => () => {}}
  },
  dispatchEvent() {}
};
vm.runInNewContext(await readFile(new URL('../src/native-browser.js',import.meta.url),'utf8'), {window,Promise,setTimeout,Date,CustomEvent:class {}});
const browser=window.ProfilesNativeBrowser;
await browser.switchSlot('A');
const oldTurn=browser.navigate('https://example.org/A');
await browser.switchSlot('B');
releaseNavigation();
const completed=await oldTurn;
assert.equal(completed.slot,'A','an A turn must not start polling B after a switch');
assert.equal(browser.activeSlot,'B','completion must not restore the previous person');
assert.equal((await browser.current()).url,'https://example.org/B');
await browser.switchSlot('invalid');
assert.equal(browser.activeSlot,'B','a rejected switch cannot poison the active person');
await browser.ensure('invalid',{x:0,y:0,width:1,height:1});
assert.equal(browser.activeSlot,'B','a rejected browser creation cannot poison the active person');
pages.set('A',{ok:true,slot:'A',url:'https://example.org/A',title:'Usable main document',loading:true});
await browser.switchSlot('A');
let deadline;
const usable=await Promise.race([
  browser.navigate('https://example.org/A'),
  new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Waiting for unrelated resources hid a usable page')),2000);})
]).finally(()=>clearTimeout(deadline));
assert.equal(usable.ok,true);
assert.equal(usable.loading,true,'ongoing resource loading must remain truthful, not turn into a fake load failure');
assert.equal(usable.title,'Usable main document');
console.log('native frontend: profile isolation and usable-document readiness passed');
