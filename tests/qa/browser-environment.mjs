// Linux regression: a disposable desktop bus dying must not kill Profiles'
// headless browser actor. No host bus, display, audio, GPU or user vault.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureSoftwareRuntime} from '../../scripts/qa-software-runtime.mjs';
ensureSoftwareRuntime();
if(process.platform!=='linux') throw new Error('This diagnostic requires Linux and dbus-daemon.');
const vault=await mkdtemp(join(tmpdir(),'profiles-browser-environment-'));
const bus=spawn('dbus-daemon',['--session','--nofork','--print-address=1'],{stdio:['ignore','pipe','pipe']});
const stopped=once(bus,'exit');
let closeAllSessions;
try{
  const address=await new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(new Error('Owned D-Bus did not start')),5000);
    bus.once('error',error=>{clearTimeout(timer);reject(error);});
    bus.stdout.on('data',chunk=>{
      output+=chunk;
      if(output.includes('\n')){clearTimeout(timer);resolve(output.split('\n')[0]);}
    });
    bus.once('exit',()=>{clearTimeout(timer);reject(new Error('Owned D-Bus exited before readiness'));});
  });
  process.env.PROFILES_VAULT_DIR=vault;
  process.env.DBUS_SESSION_BUS_ADDRESS=address;
  const actor=await import('../../agent/browseract.mjs');
  closeAllSessions=actor.closeAllSessions;
  const {page}=await actor.ensureSession('A');
  await page.setContent('<title>Before bus shutdown</title><button onclick="document.title=\'AFTER-BUS-729\'">Verify live actor</button>');
  assert.equal(await page.title(),'Before bus shutdown');
  bus.kill('SIGTERM');
  await stopped;
  await page.getByRole('button',{name:'Verify live actor'}).click();
  assert.equal(await page.title(),'AFTER-BUS-729','browser must remain interactive after the inherited desktop bus exits');
  console.log('ok - real browser remains interactive after its parent desktop bus dies');
}finally{
  await closeAllSessions?.();
  if(bus.exitCode===null && bus.signalCode===null){bus.kill('SIGTERM');await stopped.catch(()=>{});}
  await rm(vault,{recursive:true,force:true});
}
