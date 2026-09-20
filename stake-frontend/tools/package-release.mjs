import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const build = path.join(root,'stake-frontend/dist');
if (!fs.existsSync(path.join(build,'index.html'))) throw new Error('Run npm run check before packaging.');
const output = path.join(root,'release',new Date().toISOString().replaceAll(':','-').replace(/\.\d+Z$/,'Z'));
const unused = new Set([
  'assets/miami_loadscreen.webp', 'assets/slot3_bg.webp', 'assets/miami_marina_gameplay_v1.webp',
  'assets/symbols/packed.png', 'assets/symbols/cyan_car_wild.png', 'assets/highway_loop.jpg', 'assets/wanted_star.webp'
]);
function files(dir, prefix='') {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
    const relative=prefix+item.name;
    return item.isDirectory()?files(path.join(dir,item.name),relative+'/'):[relative];
  });
}
const manifest={createdAt:new Date().toISOString(),status:'LOCAL_RELEASE_CANDIDATE',stakeApproval:'Pending, including earned star-mode eligibility',files:[]};
for (const [name, source] of [['frontend',build],['math',path.join(root,'stake-math/publish_files')]]) {
  for (const file of files(source)) {
    if (name==='frontend' && unused.has(file)) continue;
    const data=fs.readFileSync(path.join(source,file));
    const target=path.join(output,name,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,data);
    manifest.files.push({bundle:name,path:file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
  }
}
const html=fs.readFileSync(path.join(output,'frontend/index.html'),'utf8');
if (/\b(?:src|href)=["']\/(?!\/)/.test(html)) throw new Error('Absolute entry asset URL is unsafe on a CDN subpath.');
for(const file of manifest.files.filter(f=>f.bundle==='frontend' && f.path.endsWith('.css'))) {
  const css=fs.readFileSync(path.join(output,'frontend',file.path),'utf8');
  for(const match of css.matchAll(/url\(([^)]+)\)/g)) {
    const value=match[1].replace(/["']/g,'');
    if (/^(data:|https?:)/.test(value)) continue;
    if(!fs.existsSync(path.resolve(output,'frontend',path.dirname(file.path),value))) throw new Error(`Missing CSS asset: ${value}`);
  }
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
for(const name of ['frontend','math']) {
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const dir=quote(path.join(output,name));
  const zip=quote(path.join(output,`heat-chase-${name}.zip`));
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${dir}, ${zip}, [System.IO.Compression.CompressionLevel]::Optimal, $false)`],{windowsHide:true,stdio:'pipe'});
}
fs.writeFileSync(path.join(root,'release','LATEST.txt'),output+'\n');
console.log(output);
for(const name of ['frontend','math']) console.log(`${name}: ${manifest.files.filter(f=>f.bundle===name).reduce((n,f)=>n+f.bytes,0)} bytes, archive ready`);
