#!/usr/bin/env python3
"""Build a self-contained preview.html for a symbol (opens from disk, no server, no CDN).

Usage: python build_preview.py path/to/symbol_dir

Reads <dir>/<dir>.json, the .atlas named in manifest.json, packed.png.
Emits <dir>/preview.html with everything inlined (base64 PNG) and a
from-scratch canvas renderer: animation dropdown, loop toggle, speed control.
Handles Spine y-up -> canvas y-down without flipping texture pixels.
"""
import base64
import json
import sys
from pathlib import Path

TEMPLATE = r'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>%%TITLE%% preview</title>
<style>
 body{margin:0;background:#15151f;color:#cfd0e0;font:14px system-ui,sans-serif;
      display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px}
 canvas{background:#1d1d2b;border-radius:12px}
 .checker{background:repeating-conic-gradient(#23233200 0% 25%,#2a2a3d 0% 50%) 50%/24px 24px,#1d1d2b}
 .bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center}
 select,button{background:#262637;color:#e8e8f5;border:1px solid #3a3a52;border-radius:8px;padding:6px 10px}
 button{cursor:pointer} label{display:flex;gap:5px;align-items:center}
 #time{min-width:110px;text-align:center;opacity:.7}
</style></head><body>
<div class="bar">
 <select id="anim"></select>
 <label><input type="checkbox" id="loop" checked>loop</label>
 <select id="speed"><option value="0.25">0.25x</option><option value="0.5">0.5x</option>
  <option value="1" selected>1x</option><option value="1.5">1.5x</option></select>
 <button id="playpause">pause</button>
 <button id="restart">restart</button>
 <input type="range" id="scrub" min="0" max="1000" value="0" style="width:180px">
 <button id="bg">bg</button>
 <span id="time"></span>
</div>
<canvas id="cv" width="560" height="560"></canvas>
<script>
const RAD=Math.PI/180;
const data=%%SKELETON%%;
const atlasText=%%ATLAS%%;
const img=new Image();img.src="data:image/png;base64,%%PNG%%";

function parseAtlas(text){
  const lines=text.split(/\r?\n/);const regions={};let i=0;
  while(i<lines.length&&!lines[i].trim())i++;
  i++;                                        // page name
  while(i<lines.length&&lines[i].includes(':'))i++;   // page props
  while(i<lines.length){
    const name=lines[i].trim();i++;
    if(!name)continue;
    const r={rotate:false,x:0,y:0,w:0,h:0};
    while(i<lines.length&&lines[i].includes(':')){
      const idx=lines[i].indexOf(':');
      const k=lines[i].slice(0,idx).trim(),vals=lines[i].slice(idx+1).split(',').map(s=>s.trim());
      if(k==='rotate')r.rotate=(vals[0]==='true'||vals[0]==='90');
      else if(k==='xy'){r.x=+vals[0];r.y=+vals[1];}
      else if(k==='size'){r.w=+vals[0];r.h=+vals[1];}
      i++;
    }
    regions[name]=r;
  }
  return regions;
}

function buildSkeleton(d){
  const bones=[],byName={};
  for(const b of d.bones){
    const bone={name:b.name,parent:b.parent?byName[b.parent]:null,
      sx:b.x||0,sy:b.y||0,srot:b.rotation||0,ssx:b.scaleX??1,ssy:b.scaleY??1,
      x:0,y:0,rot:0,scx:1,scy:1,m:[1,0,0,1,0,0]};
    bones.push(bone);byName[b.name]=bone;
  }
  let skin=d.skins;
  if(Array.isArray(skin))skin=(skin.find(s=>s.name==='default')||skin[0]).attachments;
  else skin=skin.default||{};
  const slots=d.slots.map(s=>({name:s.name,bone:byName[s.bone],
    setupAtt:s.attachment||null,att:null,
    setupColor:s.color||'ffffffff',color:'ffffffff',atts:skin[s.name]||{}}));
  const byNameSlot={};for(const s of slots)byNameSlot[s.name]=s;
  return {bones,byName,slots,byNameSlot,anims:d.animations||{}};
}

function lerpAngle(a,b,r){const dd=((b-a)%360+540)%360-180;return a+dd*r;}
function lerpColor(a,b,r){
  a=a||'ffffffff';b=b||'ffffffff';let out='';
  for(let i=0;i<8;i+=2){
    const av=parseInt(a.slice(i,i+2),16),bv=parseInt(b.slice(i,i+2),16);
    out+=Math.round(av+(bv-av)*r).toString(16).padStart(2,'0');
  }
  return out;
}
function keyAt(frames,t,interp){
  if(t<=(frames[0].time||0))return interp(frames[0],frames[0],0);
  const last=frames[frames.length-1];
  if(t>=(last.time||0))return interp(last,last,0);
  let i=0;while(t>=(frames[i+1].time||0))i++;
  const f0=frames[i],f1=frames[i+1];
  const r=f0.curve==='stepped'?0:(t-(f0.time||0))/((f1.time||0)-(f0.time||0));
  return interp(f0,f1,r);
}

function applyPose(sk,animName,t){
  for(const b of sk.bones){b.x=b.sx;b.y=b.sy;b.rot=b.srot;b.scx=b.ssx;b.scy=b.ssy;}
  for(const s of sk.slots){s.att=s.setupAtt;s.color=s.setupColor;}
  const anim=sk.anims[animName];
  if(anim){
    for(const bn in (anim.bones||{})){
      const b=sk.byName[bn];if(!b)continue;const tl=anim.bones[bn];
      if(tl.rotate)b.rot=b.srot+keyAt(tl.rotate,t,(a,c,r)=>lerpAngle(a.angle||0,c.angle||0,r));
      if(tl.translate){
        b.x=b.sx+keyAt(tl.translate,t,(a,c,r)=>(a.x||0)+((c.x||0)-(a.x||0))*r);
        b.y=b.sy+keyAt(tl.translate,t,(a,c,r)=>(a.y||0)+((c.y||0)-(a.y||0))*r);
      }
      if(tl.scale){
        b.scx=b.ssx*keyAt(tl.scale,t,(a,c,r)=>{const av=a.x??1,cv=c.x??1;return av+(cv-av)*r;});
        b.scy=b.ssy*keyAt(tl.scale,t,(a,c,r)=>{const av=a.y??1,cv=c.y??1;return av+(cv-av)*r;});
      }
    }
    for(const sn in (anim.slots||{})){
      const s=sk.byNameSlot[sn];if(!s)continue;const tl=anim.slots[sn];
      if(tl.color)s.color=keyAt(tl.color,t,(a,c,r)=>lerpColor(a.color,c.color,r));
      if(tl.attachment){let name=s.setupAtt;
        for(const k of tl.attachment){if(t>=(k.time||0))name=k.name;}s.att=name;}
    }
  }
  // world transforms; Spine y-up/CCW-deg -> canvas y-down at compose time (no pixel flips)
  for(const b of sk.bones){
    const r=-b.rot*RAD,cos=Math.cos(r),sin=Math.sin(r);
    const l11=cos*b.scx,l12=sin*b.scx,l21=-sin*b.scy,l22=cos*b.scy,lx=b.x,ly=-b.y;
    if(b.parent){const p=b.parent.m;
      b.m=[p[0]*l11+p[2]*l12,p[1]*l11+p[3]*l12,
           p[0]*l21+p[2]*l22,p[1]*l21+p[3]*l22,
           p[0]*lx+p[2]*ly+p[4],p[1]*lx+p[3]*ly+p[5]];
    }else b.m=[l11,l12,l21,l22,lx,ly];
  }
}

function duration(anim){
  let d=0;const scan=o=>{for(const k in o){const v=o[k];
    if(Array.isArray(v)){for(const f of v)d=Math.max(d,f.time||0);}
    else if(v&&typeof v==='object')scan(v);}};
  if(anim)scan(anim);return d;
}

function render(ctx,sk,regions,view){
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  ctx.setTransform(view.s,0,0,view.s,view.tx,view.ty);
  for(const s of sk.slots){
    if(!s.att)continue;
    const att=s.atts[s.att];if(!att)continue;
    const reg=regions[att.path||s.att];if(!reg)continue;
    const alpha=parseInt((s.color||'ffffffff').slice(6,8),16)/255;
    if(alpha<=0)continue;
    ctx.save();ctx.globalAlpha=alpha;
    const m=s.bone.m;ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5]);
    ctx.translate(att.x||0,-(att.y||0));ctx.rotate(-(att.rotation||0)*RAD);
    if(att.scaleX!=null||att.scaleY!=null)ctx.scale(att.scaleX??1,att.scaleY??1);
    const w=att.width||reg.w,h=att.height||reg.h;
    if(reg.rotate){ // region stored rotated 90 deg in sheet: swap source dims
      ctx.rotate(Math.PI/2);
      ctx.drawImage(img,reg.x,reg.y,reg.h,reg.w,-h/2,-w/2,h,w);
    }else{
      ctx.drawImage(img,reg.x,reg.y,reg.w,reg.h,-w/2,-h/2,w,h);
    }
    ctx.restore();
  }
}

const sk=buildSkeleton(data);
const regions=parseAtlas(atlasText);
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
const skw=data.skeleton?.width||300,skh=data.skeleton?.height||300;
const view={s:Math.min(cv.width/(skw*1.9),cv.height/(skh*1.9)),tx:cv.width/2,ty:cv.height/2};

const sel=document.getElementById('anim');
const names=Object.keys(sk.anims);
for(const n of names){const o=document.createElement('option');o.value=o.textContent=n;sel.appendChild(o);}
if(!names.length){const o=document.createElement('option');o.textContent='(setup pose)';sel.appendChild(o);}
let cur=names[0]||null,t=0,playing=true,last=performance.now();
sel.onchange=()=>{cur=sel.value;t=0;playing=true;};
document.getElementById('restart').onclick=()=>{t=0;playing=true;};
const ppEl=document.getElementById('playpause'),scrubEl=document.getElementById('scrub');
ppEl.onclick=()=>{playing=!playing;ppEl.textContent=playing?'pause':'play';};
scrubEl.oninput=()=>{const dur=cur?duration(sk.anims[cur]):0;
  playing=false;ppEl.textContent='play';t=dur*scrubEl.value/1000;};
document.getElementById('bg').onclick=()=>cv.classList.toggle('checker');
const loopEl=document.getElementById('loop'),speedEl=document.getElementById('speed'),
      timeEl=document.getElementById('time');

function frame(now){
  const dt=(now-last)/1000;last=now;
  const dur=cur?duration(sk.anims[cur]):0;
  if(playing&&dur>0){
    t+=dt*parseFloat(speedEl.value);
    if(t>dur){if(loopEl.checked)t%=dur;else{t=dur;playing=false;}}
  }
  applyPose(sk,cur,t);
  render(ctx,sk,regions,view);
  timeEl.textContent=cur?`${t.toFixed(2)} / ${dur.toFixed(2)}s`:'setup pose';
  if(playing&&dur>0)scrubEl.value=Math.round(t/dur*1000);
  requestAnimationFrame(frame);
}
img.onload=()=>requestAnimationFrame(frame);
</script></body></html>
'''


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    d = Path(sys.argv[1])
    m = json.loads((d / "manifest.json").read_text())
    skel = (d / f"{d.name}.json").read_text()
    json.loads(skel)  # must parse
    atlas = (d / m["atlas"]).read_text()
    png64 = base64.b64encode((d / m["png"]).read_bytes()).decode()
    html = (TEMPLATE.replace("%%TITLE%%", d.name)
            .replace("%%SKELETON%%", skel)
            .replace("%%ATLAS%%", json.dumps(atlas))
            .replace("%%PNG%%", png64))
    (d / "preview.html").write_text(html)
    print(f"OK: {d / 'preview.html'} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
