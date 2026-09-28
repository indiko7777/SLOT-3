import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {EventAudioBus} from '../audio';
import {ApprovedAudio} from '../audio/ApprovedAudio';
import manifest from '../audio/approvedManifest.json';
import type {GameEvent} from '../domain';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn()});
 const param=()=>({value:.8,cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),setTargetAtTime:vi.fn()});
 const sources:any[]=[];
 const ctx={state:'running',currentTime:4,createGain:()=>({gain:param(),connect:vi.fn(n=>n),disconnect:vi.fn()}),createBufferSource:()=>{const s={buffer:null,playbackRate:param(),connect:vi.fn(n=>n),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),loop:false,loopEnd:0};sources.push(s);return s;}};
 const output=ctx.createGain(),bus=new EventAudioBus(),bank=(bus as unknown as {approved:ApprovedAudio}).approved;
 Object.assign(bus,{ctx,master:output});Object.assign(bank,{ready:true,ctx,out:output,buffers:new Map(Object.values(manifest).flatMap(e=>'path'in e?[[e.path,{duration:2.4,path:e.path}]]:[]))});
 const route=(ev:Partial<GameEvent>)=>(bus as unknown as {route(ev:GameEvent,turbo:boolean):void}).route(ev as GameEvent,false);
 return {bus,bank,sources,route};
}
describe('approved sound integration',()=>{
 it('ships every selected file under a relative production asset path',()=>{for(const e of Object.values(manifest)){if(!('path'in e))continue;expect(e.path.startsWith('assets/audio/approved/')).toBe(true);expect(fs.existsSync(path.resolve(__dirname,'../../public',e.path))).toBe(true);}});
 it('fires the single-shot pistol only once per winning cluster and drops its extra detail cues',()=>{const {bus,sources,route}=setup();route({type:'cluster_win',symbol:'PISTOL'});const before=sources.length;for(let i=0;i<8;i++){bus.symbolFoley('PISTOL','fire',false);bus.symbolFoley('PISTOL','casing',false);bus.symbolFoley('PISTOL','tink',false);}expect(sources.length-before).toBe(1);expect(sources.at(-1).buffer.path).toBe(manifest.foley_PISTOL_fire.path);route({type:'cluster_win',symbol:'PISTOL'});bus.symbolFoley('PISTOL','fire',true);expect(sources.length-before).toBe(2);});
 it('honors the explicitly silent scatter, bonus start and doubles',()=>{const {bus,bank,sources}=setup();expect(bank.play('foley_PHONE_SCATTER_thud')).toBe(true);bus.getawayCue({kind:'spin_start'},false);bus.getawayCue({kind:'double',index:0},false);expect(sources).toHaveLength(0);});
 it('bounds the fuse to its visual duration and stops it before explosion',()=>{const {bus,sources}=setup();bus.getawayCue({kind:'fuse',seconds:.6},false);expect(sources[0].loop).toBe(true);expect(sources[0].stop).toHaveBeenCalledWith(4.6);vi.spyOn(bus,'dynamiteBlast').mockImplementation(()=>{});bus.getawayCue({kind:'boom',power:1},false);expect(sources[0].stop).toHaveBeenCalledWith(4.015);expect(bus.dynamiteBlast).toHaveBeenCalledOnce();});
 it('loops only counter ticks, plays one ending on completion, and cancels cleanly',()=>{const {bus,sources}=setup();bus.startWinCounter();expect(sources[0].loopEnd).toBe(1.87);bus.stopWinCounter();expect(sources[0].stop).toHaveBeenCalledWith(4.015);expect(sources[1].buffer.path).toBe(manifest.counter_end.path);bus.stopWinCounter();expect(sources).toHaveLength(2);bus.cancelWinCounter();expect(sources[1].stop).toHaveBeenCalledWith(4.015);});
 it('mutes ongoing reviewed audio and does not trigger a finish sound',()=>{const {bus,sources}=setup();bus.startWinCounter();bus.setMuted(true);bus.stopWinCounter();bus.playApprovedEffect('combo');expect(sources).toHaveLength(1);expect(sources[0].stop).toHaveBeenCalledWith(4.015);});
 it('plays the combination once per cascade, with progression only after a refill',()=>{const {sources,route}=setup();route({type:'cluster_win',symbol:'CASH'});route({type:'cluster_win',symbol:'PISTOL'});expect(sources).toHaveLength(1);route({type:'tumble_drop'});route({type:'cluster_win',symbol:'CASH'});expect(sources).toHaveLength(3);expect(sources[2].buffer.path).toBe(manifest.cascade.path);});
 it('stops result, counter and chase voices when leaving the bonus',()=>{const {bus,sources}=setup();bus.setBonusHeat(3);bus.openGetawayResult();bus.startGetawayResultCount();bus.finishBonus();expect(sources.every(s=>s.stop.mock.calls.length>0)).toBe(true);});
});
