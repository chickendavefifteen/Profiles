// Exercise the exact fixed script embedded by the native backend against a
// real DOM and HTTP form. IPC mocks cannot prove default form submission.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {ensureSoftwareRuntime} from '../../scripts/qa-software-runtime.mjs';
ensureSoftwareRuntime();
const source=await readFile(new URL('../../src-tauri/src/browser-actions.js',import.meta.url),'utf8');
const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.url.startsWith('/submitted')) return res.end('<title>SUBMITTED</title><p>'+new URL(req.url,'http://localhost').searchParams.get('q')+'</p>');
  res.end('<title>ACTIONS</title><input id="decoy" value="untouched"><button id="hit" onclick="document.title=\'CLICK-CONFIRMED\'">Confirm</button><button id="disabled" disabled>Disabled</button><form action="/submitted"><input id="QueryCase" name="q" value="old"><button>Search</button></form>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  // No display/compositor, private throwaway browser profile, muted audio;
  // ensureSoftwareRuntime has already hidden all GPU device nodes.
  browser=await chromium.launch({headless:true,env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',PULSE_SERVER:'unix:/nonexistent'},args:['--disable-gpu','--mute-audio','--no-sandbox']});
  const page=await browser.newPage();
  const act=(action,args)=>page.evaluate(({source,action,args})=>JSON.parse((0,eval)(source)(action,args)),{source,action,args});
  await page.goto(base);
  assert.equal((await act('click',{selector:'#hit'})).ok,true);
  assert.equal(await page.title(),'CLICK-CONFIRMED');
  await page.reload();
  assert.equal((await act('click',{selector:'Confirm'})).ok,true);
  assert.equal(await page.title(),'CLICK-CONFIRMED','an exact visible control label reaches the intended control');
  assert.equal((await act('click',{selector:'#missing'})).ok,false);
  assert.equal((await act('click',{selector:'#disabled'})).ok,false);
  assert.equal((await act('type',{selector:'#Missing',text:'do not insert'})).ok,false);
  assert.equal(await page.inputValue('#decoy'),'untouched');
  assert.equal((await act('type',{selector:'#QueryCase',text:'Case-Sensitive + query',clear:true})).ok,true);
  assert.equal(await page.inputValue('#QueryCase'),'Case-Sensitive + query');
  await Promise.all([page.waitForURL('**/submitted?*'),act('press',{key:'Enter'})]);
  assert.equal(new URL(page.url()).searchParams.get('q'),'Case-Sensitive + query');
  assert.equal(await page.title(),'SUBMITTED');
  await page.goto(base);
  await Promise.all([page.waitForURL('**/submitted?*'),act('type',{selector:'#QueryCase',text:'second actual submission',clear:true,press:'Enter'})]);
  assert.equal(new URL(page.url()).searchParams.get('q'),'second actual submission');
  await page.goto(base);
  await act('click',{selector:'#QueryCase'});
  assert.equal((await act('press',{key:'InventedKey'})).ok,false);
  assert.equal(await page.inputValue('#QueryCase'),'old');
  console.log('native page actions: actual click, case-sensitive edit, missing/disabled controls, and both default HTTP submissions passed');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
