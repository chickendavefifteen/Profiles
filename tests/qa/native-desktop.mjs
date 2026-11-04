// Explicitly approved native QA only. The normal headless gate never launches
// this window. Local fixtures, private state, no keyring, audio or GPU devices.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,readlink,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createSocket} from 'node:net';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {ensureSoftwareRuntime} from '../../scripts/qa-software-runtime.mjs';
assert.equal(process.env.PROFILES_NATIVE_QA_APPROVED,'1','Obtain owner permission for this isolated native run first');
assert.equal(process.platform,'linux','Native desktop regression requires Linux WebKitGTK');
ensureSoftwareRuntime();
const root=fileURLToPath(new URL('../../',import.meta.url));
const state=await mkdtemp('/tmp/profiles-native-regression-');
const evidence=await mkdtemp('/tmp/profiles-native-evidence-');
const sockets=new Set();
const fixture=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('content-type','text/html');
  if(url.pathname==='/tab-form'){
    if(url.searchParams.get('name')==='first')res.setHeader('set-cookie','nativeTabs=shared; Path=/; SameSite=Lax');
    res.end('<title>NATIVE-TAB-'+url.searchParams.get('name')+'</title><input id="Draft" oninput="document.getElementById(\'draftState\').textContent=this.value"><output id="draftState">empty draft</output><button id="Counter" onclick="this.textContent=\'Count \'+(++window.count)">Count 0</button><script>window.count=0</script><button id="Cookies" onclick="document.getElementById(\'cookiesState\').textContent=document.cookie">Read cookies</button><output id="cookiesState"></output><a id="Popup" target="_blank" href="/tab-form?name=popup">Popup</a>');
  }else
  if(url.pathname==='/head-first'){
    res.write('<title>HEAD-BEFORE-BODY</title>');
    setTimeout(()=>res.end('<p>BODY-PARSED-PROOF</p>'),600);
  }else if(url.pathname==='/pending-image'){
    res.writeHead(200,{'content-type':'image/png'});res.write(Buffer.from([137,80,78,71]));
  }else if(url.pathname==='/unfinished'){
    res.end('<title>DOM-READY-PENDING-IMAGE</title><p>READ-WITHOUT-IMAGE-PROOF</p><img src="/pending-image">');
  }else if(url.pathname==='/redirect'){
    res.writeHead(302,{location:'/form'});res.end();
  }else if(url.pathname==='/submitted'){
    res.end('<title>FORM-SUBMITTED</title><p>'+url.searchParams.get('q')+'</p>');
  }else{
    res.end('<title>NATIVE-FORM-READY</title><h1>Native browser regression</h1><button id="hit" onclick="document.title=\'NATIVE-CLICK-CONFIRMED\';document.getElementById(\'status\').textContent=\'Actual native click confirmed\'">Click proof</button><p id="status">Ready</p><input id="decoy" value="untouched"><form action="/submitted"><input name="q" id="QueryCase"><button>Search</button></form>');
  }
});
fixture.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.address().port;
async function freePort(){
  const socket=createSocket();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;
}
for(const name of ['data','cache','config','vault'])await mkdir(join(state,name));
const port=await freePort(), base='http://127.0.0.1:'+port;
// Scope launcher scrubs host displays and asserts a fresh owned Xvfb/private
// D-Bus session. It inherits the private /dev mounted above, not host devices.
const app=spawn('agent-isolated-desktop',['env','GDK_BACKEND=x11','WEBKIT_DISABLE_DMABUF_RENDERER=1','WEBKIT_DISABLE_COMPOSITING_MODE=1',join(root,'src-tauri/target/release/profiles')],{
  cwd:root,env:{...process.env,PROFILES_PORT:String(port),PROFILES_HOME:root,PROFILES_VAULT_DIR:join(state,'vault'),PROFILES_DISABLE_KEYRING:'1',XDG_DATA_HOME:join(state,'data'),XDG_CACHE_HOME:join(state,'cache'),XDG_CONFIG_HOME:join(state,'config'),PULSE_SERVER:'unix:/nonexistent',ALSOFT_DRIVERS:'null'},stdio:['ignore','pipe','pipe']
});
const stopped=once(app,'exit');let logs='';
app.stdout.on('data',chunk=>logs+=chunk);app.stderr.on('data',chunk=>logs+=chunk);
const call=(path,body,tabId)=>fetch(base+'/api/'+path+'?profileSlot=A'+(tabId?'&tabId='+encodeURIComponent(tabId):''),{
  method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)
}).then(response=>response.json());
async function waitFor(fn,seconds=20){
  const deadline=Date.now()+seconds*1000;
  while(Date.now()<deadline){try{const out=await fn();if(out)return out;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error('Native condition did not become true within '+seconds+' seconds');
}
const results=[], ownedPids=[];
function pass(check,extra={}){results.push({check,ok:true,...extra});console.log('ok - '+check);}
try{
  const health=await waitFor(async()=>{const h=await call('health');return h.nativeBrowserReady&&h;},30);
  const stat=await readFile('/proc/'+health.pid+'/stat','utf8');
  const appPid=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]);
  for(const pid of [appPid,health.pid]){
    const devices=await readdir('/proc/'+pid+'/root/dev');
    assert.ok(!devices.some(name=>name==='dri'||name==='kfd'||name.startsWith('nvidia')),'GPU device visible to native scope');
    for(const fd of await readdir('/proc/'+pid+'/fd')){
      let target;try{target=await readlink('/proc/'+pid+'/fd/'+fd);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      assert.ok(!/^\/dev\/(?:dri|kfd|nvidia)/.test(target),'Native process opened GPU handle');
    }
    ownedPids.push(pid);
  }
  pass('actual native shell and sidecar have no GPU nodes or handles',{pids:ownedPids});
  const deadPort=await freePort();
  assert.equal((await call('browser/view',{url:'http://127.0.0.1:'+deadPort+'/unreachable'})).ok,false);
  const recovered=await call('browser/view',{url:origin+'/form'});
  assert.equal(recovered.ok,true);assert.equal(recovered.title,'NATIVE-FORM-READY');
  pass('failed page does not prevent the next native navigation');
  assert.equal((await call('browser/view',{url:origin+'/redirect'})).ok,true);
  assert.equal((await call('ask',{query:'click #hit',mode:'Vibes'})).ok,true);
  const clicked=await call('browser/read',{});
  assert.equal(clicked.title,'NATIVE-CLICK-CONFIRMED');assert.match(clicked.text,/Actual native click confirmed/);
  pass('redirect and real agent click reach the displayed native document');
  assert.equal((await call('ask',{query:'click #does-not-exist',mode:'Vibes'})).ok,false);
  assert.equal((await call('browser/type',{selector:'#missing',text:'WRONG'})).ok,false);
  assert.equal((await call('browser/press',{key:'NotARealKey'})).ok,false);
  assert.equal((await call('browser/read',{})).title,'NATIVE-CLICK-CONFIRMED');
  pass('invalid actions fail without poisoning the native page');
  assert.equal((await call('browser/type',{selector:'#QueryCase',text:'Native Case-Sensitive Search',clear:true})).ok,true);
  assert.equal((await call('browser/press',{key:'Enter'})).ok,true);
  await waitFor(async()=>{const out=await call('browser/read',{});return out.title==='FORM-SUBMITTED'&&out.text.includes('Native Case-Sensitive Search');});
  pass('native typing and Enter perform real default HTTP form submission');
  const image=await call('browser/screenshot',{});assert.equal(image.ok,true);assert.equal(image.mime,'image/png');assert.equal(image.fullPage,false);
  const png=Buffer.from(image.dataUrl.split(',')[1],'base64');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await writeFile(join(evidence,'native-page.png'),png);
  assert.equal((await call('browser/screenshot',{fullPage:true})).ok,false);
  pass('native screenshot contains PNG pixels and never mislabels full-page capture',{width:image.width,height:image.height});
  await call('browser/view',{url:origin+'/head-first'});
  assert.match((await call('browser/read',{})).text,/BODY-PARSED-PROOF/);
  pass('reader waits for parsed body, not title alone');
  const start=Date.now();await call('browser/view',{url:origin+'/unfinished'});
  assert.match((await call('browser/read',{})).text,/READ-WITHOUT-IMAGE-PROOF/);assert.ok(Date.now()-start<8000);
  pass('reader remains usable while an image never finishes');
  const first=(await call('browser/tabs')).activeTabId;
  await call('browser/view',{url:origin+'/tab-form?name=first'},first);
  assert.equal((await call('browser/type',{selector:'#Draft',text:'UNSAVED-NATIVE-DRAFT',clear:true},first)).ok,true);
  await call('browser/click',{selector:'#Counter'},first);
  const secondState=await call('browser/tabs',{action:'create',url:origin+'/tab-form?name=second'});
  assert.equal(secondState.ok,true);
  const second=secondState.activeTabId;assert.notEqual(first,second);
  assert.equal((await call('browser/click',{selector:'#Cookies'},second)).ok,true);
  assert.match((await call('browser/read',{},second)).text,/nativeTabs=shared/);
  await call('browser/tabs',{action:'switch',tabId:first});
  const restored=await call('browser/read',{},first);
  assert.equal(restored.title,'NATIVE-TAB-first');
  assert.match(restored.text,/UNSAVED-NATIVE-DRAFT/);assert.match(restored.text,/Count 1/);
  assert.equal((await call('browser/click',{selector:'#Counter'},second)).ok,false,'Hidden native tab must not accept input');
  pass('native tabs retain unsaved form and JavaScript state, share person cookies, and reject hidden-tab input');
  await call('browser/view',{url:origin+'/tab-form?name=next'},first);
  await call('browser/back',{},first);
  await waitFor(async()=>{const out=await call('browser/read',{},first);return out.title==='NATIVE-TAB-first';});
  await call('browser/forward',{},first);
  await waitFor(async()=>{const out=await call('browser/read',{},first);return out.title==='NATIVE-TAB-next';});
  await call('browser/tabs',{action:'switch',tabId:second});
  assert.equal((await call('browser/read',{},second)).title,'NATIVE-TAB-second');
  pass('native history is independent per tab');
  await call('browser/click',{selector:'#Popup'},second);
  const popupState=await waitFor(async()=>{const out=await call('browser/tabs');return out.tabs.length===3&&out.activeTabId!==second&&out;});
  assert.equal((await call('browser/read',{},popupState.activeTabId)).title,'NATIVE-TAB-popup');
  for(const tab of popupState.tabs)assert.equal((await call('browser/tabs',{action:'close',tabId:tab.id})).ok,true);
  const blank=await call('browser/tabs');
  assert.equal(blank.tabs.length,1);assert.ok(!blank.tabs[0].url||blank.tabs[0].url==='about:blank');
  assert.equal((await call('browser/click',{selector:'#Counter'},first)).ok,false);
  pass('native popup creates an in-pane tab; closing the final tab leaves a new blank document');
}finally{
  app.kill('SIGTERM');
  await Promise.race([stopped,new Promise((_,reject)=>setTimeout(()=>reject(Error('Owned native launcher did not stop')),10000))]);
  for(const pid of ownedPids){
    const alive=await readFile('/proc/'+pid+'/stat','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    assert.ok(!alive||alive.slice(alive.lastIndexOf(')')+2).startsWith('Z '),'Owned native process survived teardown: '+pid);
  }
  for(const socket of sockets)socket.destroy();await new Promise(resolve=>fixture.close(resolve));
  await writeFile(join(evidence,'results.json'),JSON.stringify(results,null,2));
  await writeFile(join(evidence,'runtime.log'),logs);await rm(state,{recursive:true,force:true});
  console.log('Native evidence: '+evidence);
}
