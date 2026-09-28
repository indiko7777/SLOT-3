import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const original=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'),'utf8'));
const backup=JSON.parse(fs.readFileSync(path.join(dir,'decisions-backup.json'),'utf8'));
const byId=new Map(original.map(r=>[r.id,r]));
const queue=[];
const add=(id,designs,title)=>{const row=byId.get(id);if(!row)throw Error(id);queue.push({...row,title:title??row.title,designs});};
// One entry, and ultimately one selected sound, per symbol.
for(const [id,title,designs] of [
 ['foley_PISTOL_fire','Pistol · one shot',[]],
 ['foley_CASH_riffle','Cash',['cash-snap','cash-riffle']],
 ['foley_AMMO_jolt','Ammo',['ammo-chamber','ammo-spill']],
 ['foley_KNIFE_swish','Knife',['knife-draw','knife-cut']],
 ['foley_DUFFEL_thump','Duffel bag',['duffel-drop','duffel-zip']],
 ['foley_DIAMOND_chime','Diamond',['diamond-prism','diamond-spark']],
 ['foley_BRASS_punch','Brass knuckles',['brass-punch','brass-clang']],
 ['foley_BIKE_rev','Bike',['bike-rev','bike-launch']],
 ['foley_PHONE_SCATTER_thud','Scatter truck',['truck-latch','radio-chirp']],
]){
 add(id,designs,title);const r=queue.at(-1);r.group='Symbols';r.status='One sound per symbol';r.purpose=`One sound for the ${title.split(' · ')[0].toLowerCase()} winning animation. Choose one complete sound; no separate casing, impact or detail decisions.`;
}
const pistol=queue[0];pistol.current={kind:'file',url:'/tools/sound-review/uploads/pistol-single-shot.wav'};pistol.purpose='Your supplied recording, cut to exactly one shot. 0.290 seconds including the decay. The original repeated-shot file is preserved.';
const ids=['combo','cascade','refill','heat1','dynamite','fuse','double','held','spent','dud','bonusspin','bonusstop','uierror','anticipation','miss','dead','truck','doors','piece','impact_low','impact_mid','impact_high','impact_grand','counter','result','helicopter'];
const mappings={combo:['reward-coins','reward-brass'],cascade:['reward-coins','star-chord'],refill:['move-silk','move-zip'],heat1:['star-lock','star-chord'],dynamite:['impact-sub','impact-metal'],fuse:['fuse-sparks','fuse-grit'],double:['star-lock','ui-soft'],held:['star-chord','ui-click'],spent:['ui-click','end-dry'],dud:['end-dry','end-fall'],bonusspin:['reel-motor','reel-air'],bonusstop:['ui-click','ammo-chamber'],scatter:['scatter-call','scatter-metal'],uierror:['ui-soft','ui-click'],anticipation:['rise-tremolo','rise-air'],miss:['end-dry','end-fall'],dead:['end-dry','end-fall'],truck:['bike-launch','reel-motor'],doors:['truck-latch','impact-metal'],piece:['move-silk','move-zip'],impact_low:['impact-sub','reward-brass'],impact_mid:['reward-brass','impact-metal'],impact_high:['reward-brass','impact-metal'],impact_grand:['reward-brass','impact-metal'],counter:['counter-paper','counter-metal'],result:['reward-coins','reward-brass'],helicopter:['rotor','siren']};
ids.forEach(id=>add(id,mappings[id]));
// Active sound files only; unused aliases and historic files leave the main workflow.
for(const id of ['new_reel_stop','reel_loop','tumble_pop','wild_sound','poker_machine_win','sticky_gold_bar','getaway_explosive','getaway_intro','typewriter','win_big_lowest','win_mega_grand','win_max','ui_click','bg_base','bg_bonus','sunset_synths','vice_nights','open_lines']){
 const r=byId.get('track_'+id);const profile=r.profile;
 const designs=profile==='source'?[]:id==='reel_loop'?['reel-motor','reel-air']:id==='getaway_explosive'?['impact-sub','impact-metal']:id==='typewriter'?['counter-paper','counter-metal']:id==='getaway_intro'?['reward-brass','rise-tremolo']:profile==='reward'?['reward-coins','reward-brass']:['ui-click','star-lock'];
 add('track_'+id,designs);queue.at(-1).group=profile==='source'?'Music':'Other effects';
 // Do not label a one-shot design as a replacement for a loop without approval of its role.
 if(id==='reel_loop')queue.at(-1).designs=[];
}
for(const r of original.filter(r=>/^track_mil/.test(r.id))){queue.push({...r,group:'Voices',designs:[]});}
const decisions=structuredClone(backup.decisions);
for(const d of Object.values(decisions))if(d.choice?.startsWith('option-'))d.designVersion='legacy-v1';
decisions.combo.assetUrl='/tools/sound-review/uploads/combo-user.mp3';
decisions.dud.assetUrl='/tools/sound-review/uploads/dud-user.mp3';
decisions.foley_PISTOL_fire={...decisions.foley_PISTOL_fire,choice:'keep-current',assetUrl:pistol.current.url,confirmedBy:'User requested supplied pistol recording cut to one shot',updatedAt:new Date().toISOString()};
const archived=original.filter(r=>decisions[r.id]?.choice&&!queue.some(q=>q.id===r.id));
fs.writeFileSync(path.join(dir,'queue.json'),JSON.stringify(queue,null,2)+'\n');
fs.writeFileSync(path.join(dir,'confirmed-seed.json'),JSON.stringify({version:2,decisions,archived},null,2)+'\n');
console.log(`${queue.length} total curated entries. ${Object.values(backup.decisions).filter(d=>d.choice).length} original decisions preserved; pistol trim added. Default queue shows only pending symbols and core moments.`);
