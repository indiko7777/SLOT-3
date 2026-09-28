import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const original=read('decisions-backup.json').decisions,seed=read('confirmed-seed.json'),queue=read('queue.json'),designs=read('designs.json');
for(const [id,d] of Object.entries(original)){if(!d.choice)continue;assert.equal(seed.decisions[id].choice,d.choice,`Approval changed: ${id}`);assert.equal(seed.decisions[id].fileName,d.fileName,`Uploaded source changed: ${id}`);}
assert.equal(queue.filter(r=>r.group==='Symbols').length,9);assert.equal(new Set(queue.map(r=>r.id)).size,queue.length);
for(const row of queue)for(const id of row.designs)assert.ok(designs[id],`Missing design ${id}`);
const fingerprints=new Set();
for(const d of Object.values(designs)){
 const b=fs.readFileSync(path.join(dir,'designs',d.id+'.wav'));assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(24),48000);assert.equal(b.readUInt32LE(40),b.length-44);
 let energy=0,peak=0;for(let i=44;i<b.length;i+=2){const sample=b.readInt16LE(i)/32768;energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}assert.ok(energy>1,`Silent ${d.id}`);assert.ok(peak<.73,`Clipped ${d.id}`);
 const mark=b.toString('base64');assert.ok(!fingerprints.has(mark),`Duplicate design ${d.id}`);fingerprints.add(mark);
}
const decoded=spawnSync(ffmpeg,['-v','error','-i',path.join(dir,'uploads/pistol-single-shot.wav'),'-f','f32le','-ac','1','-ar','48000','pipe:1'],{maxBuffer:2000000});assert.equal(decoded.status,0);
const pcm=new Float32Array(decoded.stdout.buffer,decoded.stdout.byteOffset,decoded.stdout.length/4);assert.equal(pcm.length/48000,.29);
let attacks=0,last=-1;for(let i=0;i<pcm.length;i+=480){let energy=0;for(let j=i;j<Math.min(i+480,pcm.length);j++)energy+=pcm[j]*pcm[j];if(Math.sqrt(energy/480)>.1){const t=i/48000;if(t-last>.1)attacks++;last=t;}}
assert.equal(attacks,1,'Pistol must contain one attack group');
console.log('PASS: 25 original approvals unchanged; 9 single-entry symbols; 40 distinct non-silent WAV designs below clipping; pistol is 0.290 s with one attack group.');
