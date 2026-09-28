import { EventAudioBus } from '../../src/audio';
import { playFoley } from '../../src/audio/SymbolFoley';
let bus: EventAudioBus | null = null;
let ctx: AudioContext | null = null;
let output: GainNode | null = null;
const later = (fn: () => void, ms: number) => window.setTimeout(fn, ms);
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin || e.source!==parent) return;
 if(e.data.action==='stop'){if(ctx) await ctx.close();return;}
 if(e.data.action==='volume'){if(output)output.gain.value=e.data.volume;return;}
 if(e.data.action!=='play')return;
 try{
  const {current,volume}=e.data;
  if(current.kind==='foley'){
   ctx=new AudioContext();await ctx.resume();output=ctx.createGain();output.gain.value=volume*.8;output.connect(ctx.destination);
   playFoley(ctx,output,current.symbol,current.cue,.38);
  }else{
   bus=new EventAudioBus();await bus.prefetch();await bus.unlock();
   // Dev-only adapter: reuse the exact synthesis, isolate its music and apply audition volume.
   const background=bus as unknown as {bgLoop:{source:AudioBufferSourceNode}|null};
   background.bgLoop?.source.stop();
   bus.selectStation('off');await Promise.resolve();bus.setMuted(false);
   const internals=bus as unknown as {ctx:AudioContext;master:GainNode};ctx=internals.ctx;
   output=ctx.createGain();output.gain.value=volume;
   const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-3;limiter.ratio.value=20;
   internals.master.disconnect();internals.master.connect(limiter).connect(output).connect(ctx.destination);
   if(current.method==='resultDemo'){
    bus.openGetawayResult();later(()=>{bus?.startGetawayResultCount();},500);
    for(let i=0;i<=20;i++)later(()=>bus?.updateGetawayResultCount(i/20),600+i*100);
    later(()=>bus?.getawayResultTier(1),1600);later(()=>bus?.endGetawayResultCount(),2800);later(()=>bus?.getawayResultExit(),3500);
   }else{
    const method=current.method as keyof EventAudioBus;
    const fn=bus[method];if(typeof fn!=='function')throw new Error('Unknown preview method');
    (fn as (...args:unknown[])=>void).apply(bus,current.args);
    if(method==='startWinCounter')later(()=>bus?.stopWinCounter(),2000);
   }
  }
  parent.postMessage({type:'preview-playing'},location.origin);
 }catch(error){parent.postMessage({type:'preview-error',message:String(error)},location.origin);}
});
window.addEventListener('pagehide',()=>{void ctx?.close();});
parent.postMessage({type:'preview-ready'},location.origin);
