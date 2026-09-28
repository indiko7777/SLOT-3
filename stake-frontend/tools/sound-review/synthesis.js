// Original, deterministic audition sketches. No game integration or external samples.
export const styles = [
 {name:'A · Neon precision',description:'Bright glass notes, clean attack, compact tail. A crisp electronic direction.'},
 {name:'B · Vault weight',description:'Lower body, metallic overtones and restrained sparkle. A heavier heist direction.'},
 {name:'C · Arcade gloss',description:'Round plucks, quicker movement and a bright finish. A playful electronic direction.'},
];
export async function synthesize(profile,variant=0){
 const length = ['counter','noise','engine'].includes(profile)?2.4:profile==='ladder'?1.8:1.25;
 const ctx=new OfflineAudioContext(1,Math.ceil(48000*length),48000);
 const master=ctx.createGain(); master.gain.value=.65; master.connect(ctx.destination);
 const base=[523.25,293.66,659.25][variant]; const wave=['sine','triangle','triangle'][variant];
 function tone(f,t,d,v=.18,end=f,type=wave){
  const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(Math.max(25,end),t+d);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.005);g.gain.exponentialRampToValueAtTime(.0001,t+d);g.gain.linearRampToValueAtTime(0,t+d+.01);
  o.connect(g).connect(master);o.start(t);o.stop(t+d+.015);
 }
 function noise(t,d,v,frequency=2500,rise=false){
  const b=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*d),ctx.sampleRate),a=b.getChannelData(0);let seed=1241+variant;
  for(let i=0;i<a.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;a[i]=seed/2147483648;}
  const s=ctx.createBufferSource(),g=ctx.createGain(),f=ctx.createBiquadFilter();s.buffer=b;f.type='bandpass';f.Q.value=.8;f.frequency.setValueAtTime(frequency,t);f.frequency.exponentialRampToValueAtTime(rise?frequency*2:frequency*.6,t+d);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+(rise?d*.7:.008));g.gain.linearRampToValueAtTime(0,t+d);
  s.connect(f).connect(g).connect(master);s.start(t);s.stop(t+d);
 }
 const hit=(t=0)=>{tone(variant===1?155:220,t,.18,.28,55);noise(t,.045,.13);};
 const bell=(f,t=0)=>{tone(f,t,.28,.20);tone(f*2.01,t,.17,.07);tone(f*3.98,t,.07,.025);};
 if(profile==='reward'){
  hit();[0,4,7,12].slice(0,variant===1?3:4).forEach((n,i)=>bell(base*2**(n/12),.02+i*[.065,.08,.045][variant]));
 }else if(profile==='ladder'){
  [0,3,7,12].forEach((n,i)=>{tone(150,i*.32,.10,.13,65);bell(base*2**(n/12),i*.32);});
 }else if(profile==='metal'){
  hit();[1,1.49,2.03].forEach((r,i)=>tone(base*r,.025+i*.02,.35,.14/(i+1)));
 }else if(profile==='tick'){
  noise(0,.025,.15,3200);tone(base*.6,0,.07,.14,base*.45);
 }else if(profile==='impact'){
  hit();tone(variant===1?110:180,.01,.30,.2,48);noise(.01,.13,.16,variant===1?600:1500);tone(base,.01,.12,.045);
 }else if(profile==='whoosh'||profile==='riser'){
  const d=profile==='riser'?.8:.30;noise(0,d,.27,variant===1?600:1500,true);tone(base*.25,0,d,.07,base*(variant+1));
 }else if(profile==='down'){
  tone(base*.6,0,.22,.14,base*.3);noise(0,.06,.07,1100);
 }else if(profile==='counter'){
  for(let i=0;i<22;i++){const t=i*.085; tone(base*(1+i*.012),t,.04,.095);noise(t,.018,.045,2400);}
  bell(base*1.5,1.93);
 }else if(profile==='noise'){
  noise(0,2,.21,variant===1?1300:3300,true);for(let i=0;i<20;i++)noise(i*.093,.018,.06,4000);
 }else if(profile==='engine'){
  for(let i=0;i<20;i++)tone(80+variant*20+i*3,i*.08,.11,.12,65+i*3,'triangle');noise(.1,1.7,.16,450,true);
 }
 const result=await ctx.startRendering();
 // Equal peak ceiling for comparison; final perceived loudness still needs a mix pass.
 const data=result.getChannelData(0);let peak=0;for(const x of data)peak=Math.max(peak,Math.abs(x));
 if(peak>0)for(let i=0;i<data.length;i++)data[i]*=.65/peak;
 return result;
}
export function wav(buffer){
 const samples=buffer.getChannelData(0),bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);
 const str=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
 str(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);
 samples.forEach((v,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,v))*32767,true));
 return new Blob([bytes],{type:'audio/wav'});
}
