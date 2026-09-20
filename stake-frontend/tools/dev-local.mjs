import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
async function responds(url) {
  try { await fetch(url, {signal:AbortSignal.timeout(1000)}); return true; }
  catch { return false; }
}
function start(args) {
  const child = spawn(process.execPath,args,{cwd,stdio:'inherit',windowsHide:true});
  children.push(child);
  child.on('exit',code=>{if(code) {console.error(`Local process exited (${code}).`); shutdown();process.exitCode=code;}});
  return child;
}
function shutdown() { for (const child of children) if (child.exitCode === null) child.kill(); }
process.on('SIGINT',()=>{shutdown();process.exit(0);});
process.on('SIGTERM',()=>{shutdown();process.exit(0);});
process.on('exit',shutdown);

if (!await responds('http://127.0.0.1:8787/')) {
  console.log('Preparing local outcome books. The game will open when the RGS is ready…');
  const rgs = start(['--import','tsx','mock-rgs/server.ts']);
  const deadline = Date.now()+120000;
  while (!await responds('http://127.0.0.1:8787/')) {
    if (rgs.exitCode !== null || Date.now()>deadline) { shutdown(); throw new Error('Mock RGS did not start. Check the messages above.'); }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
}
if (!await responds('http://127.0.0.1:5176/')) {
  start(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5176','--open']);
}
console.log('\nPLAY: http://127.0.0.1:5176/\nART PREVIEW: http://127.0.0.1:5176/?preview=loading\n');
