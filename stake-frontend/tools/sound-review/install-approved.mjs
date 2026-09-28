import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import ffmpeg from 'ffmpeg-static';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const state=read('decisions.json'),rows=read('queue.json'),designs=read('designs.json'),legacy=read('legacy-renders.json'),manifest={},sources=[];
const output=path.join(root,'public/assets/audio/approved');fs.mkdirSync(output,{recursive:true});
function convert(url,filter=''){
 const input=path.resolve(root,'.'+url);if(!input.startsWith(dir+path.sep))throw Error('Unexpected review source');const data=fs.readFileSync(input),hash=createHash('sha256').update(data).update(filter).digest('hex').slice(0,16),name=hash+'.mp3',target=path.join(output,name);
 if(!fs.existsSync(target)){if(path.extname(input)==='.mp3'&&!filter)fs.copyFileSync(input,target);else execFileSync(ffmpeg,['-v','error','-y','-i',input,...(filter?['-af',filter]:[]),'-ar','48000','-ac','1','-codec:a','libmp3lame','-b:a','96k',target],{windowsHide:true});}
 return 'assets/audio/approved/'+name;
}
for(const r of rows){const d=state.decisions[r.id];if(!d?.choice||d.choice==='needs-replacement')continue;
 if(d.choice==='silent'){manifest[r.id]={silent:true};continue;}
 let url;if(d.choice==='own-file')url=d.assetUrl;else if(d.choice.startsWith('design:'))url=designs[d.choice.slice(7)]?.url;else if(d.choice.startsWith('option-'))url=legacy[r.id];else if(r.id==='foley_PISTOL_fire')url=d.assetUrl;
 if(d.choice==='keep-current'&&!url)continue;
 if(!url)throw Error('No approved source for '+r.id);
 manifest[r.id]={path:convert(url)};sources.push({id:r.id,choice:d.choice,source:url,output:manifest[r.id].path});
 if(r.id==='counter'){manifest.counter.loopEnd=1.87;manifest.counter_end={path:convert(url,'atrim=start=1.93:end=2.4,asetpts=PTS-STARTPTS')};}
 if(r.id==='fuse')manifest.fuse.loopEnd=2;
}
fs.writeFileSync(path.join(root,'src/audio/approvedManifest.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(dir,'installed.json'),JSON.stringify({savedAt:state.savedAt,sources},null,2)+'\n');
console.log(`${Object.keys(manifest).length} approved overrides installed; ${new Set(Object.values(manifest).map(x=>x.path).filter(Boolean)).size} audio files.`);
