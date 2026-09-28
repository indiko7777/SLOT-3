import approvedManifest from './approvedManifest.json';
type Entry={path?:string;silent?:boolean;loopEnd?:number};
type Voice={source:AudioBufferSourceNode;gain:GainNode};
/** The user's reviewed choices. Owns every voice so mute/skip cannot leave a loop behind. */
export class ApprovedAudio {
 readonly entries:Record<string,Entry>=approvedManifest;
 ready=false;
 private raw=new Map<string,ArrayBuffer>();
 private buffers=new Map<string,AudioBuffer>();
 private fetching:Promise<void>|null=null;
 private decoding:Promise<void>|null=null;
 private ctx:AudioContext|null=null;
 private out:AudioNode|null=null;
 private slots=new Map<string,Voice>();
 private voices=new Set<Voice>();
 prefetch():Promise<void>{return this.fetching??=Promise.all([...new Set(Object.values(this.entries).flatMap(e=>e.path?[e.path]:[]))].map(async p=>{try{const r=await fetch(encodeURI(p));if(r.ok)this.raw.set(p,await r.arrayBuffer());}catch{}})).then(()=>{});}
 init(ctx:AudioContext,out:AudioNode):Promise<void>{this.ctx=ctx;this.out=out;return this.decoding??=(async()=>{await this.prefetch();await Promise.all([...this.raw].map(async([p,b])=>{try{this.buffers.set(p,await ctx.decodeAudioData(b));}catch{}}));this.raw.clear();this.ready=true;})();}
 has(id:string):boolean{return Object.hasOwn(this.entries,id);}
 play(id:string,{gain=0.8,rate=1,slot=id,loop=false,duration,offset=0}:{gain?:number;rate?:number;slot?:string;loop?:boolean;duration?:number;offset?:number}={}):boolean{
  const entry=this.entries[id];if(!entry)return false;
  this.stop(slot);
  if(entry.silent||!this.ctx||!this.out||document.hidden)return true;
  const buffer=entry.path?this.buffers.get(entry.path):null;if(!buffer)return true;
  const source=this.ctx.createBufferSource(),g=this.ctx.createGain();source.buffer=buffer;source.loop=loop;source.playbackRate.value=rate;
  if(loop&&entry.loopEnd)source.loopEnd=Math.min(entry.loopEnd,buffer.duration);
  g.gain.value=gain;source.connect(g).connect(this.out);const voice={source,gain:g};this.slots.set(slot,voice);this.voices.add(voice);
  source.onended=()=>{source.disconnect();g.disconnect();this.voices.delete(voice);if(this.slots.get(slot)===voice)this.slots.delete(slot);};
  source.start(this.ctx.currentTime,offset);if(duration!==undefined)source.stop(this.ctx.currentTime+Math.max(.01,duration));return true;
 }
 playing(slot:string):boolean{return this.slots.has(slot);}
 rate(slot:string,value:number):void{if(this.ctx)this.slots.get(slot)?.source.playbackRate.setTargetAtTime(value,this.ctx.currentTime,.04);}
 stop(slot:string):void{const v=this.slots.get(slot);if(!v||!this.ctx)return;this.slots.delete(slot);this.stopVoice(v);}
 private stopVoice(v:Voice):void{if(!this.ctx)return;const t=this.ctx.currentTime;v.gain.gain.cancelScheduledValues(t);v.gain.gain.setValueAtTime(v.gain.gain.value,t);v.gain.gain.linearRampToValueAtTime(0,t+.01);try{v.source.stop(t+.015);}catch{}}
 stopAll():void{for(const v of this.voices)this.stopVoice(v);this.slots.clear();}
}
