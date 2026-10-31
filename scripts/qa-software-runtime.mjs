// Rendering flags alone do not prevent GTK/Xvfb/Chromium from opening GPU
// devices. Verification runs in a private /dev mount, including Xvfb when
// testing the native app. This is device isolation, not a full user-data sandbox.
import {existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
export function ensureSoftwareRuntime(){
  if(process.platform!=='linux') return;
  process.env.LIBGL_ALWAYS_SOFTWARE='1';
  process.env.GALLIUM_DRIVER='llvmpipe';
  process.env.__GLX_VENDOR_LIBRARY_NAME='mesa';
  const mesa='/usr/share/glvnd/egl_vendor.d/50_mesa.json';
  if(existsSync(mesa)) process.env.__EGL_VENDOR_LIBRARY_FILENAMES=mesa;
  const hasGpu=existsSync('/dev/dri') || existsSync('/dev/kfd') || readdirSync('/dev').some(name=>name.startsWith('nvidia'));
  if(!hasGpu) return;
  const child=spawnSync('bwrap',['--bind','/','/','--dev','/dev','--proc','/proc','--',process.execPath,...process.execArgv,...process.argv.slice(1)],{
    stdio:'inherit',env:process.env
  });
  if(child.error){console.error('Software-only verification requires bubblewrap; refusing GPU-visible fallback:',child.error.message);process.exit(1);}
  process.exit(child.status===null?1:child.status);
}
