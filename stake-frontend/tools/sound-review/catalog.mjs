import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'src/audio.ts'), 'utf8');
const tracks = [...source.match(/const ALL_TRACKS[^=]*= \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
const paths = Object.fromEntries([...source.match(/const TRACK_PATHS[^=]*= \{([\s\S]*?)\n\};/)[1].matchAll(/(\w+): "([^"]+)"/g)].map(m => [m[1], m[2]]));
const rows = [];
const add = (id, title, status, purpose, profile, current = null, evidence = '', group = 'Gameplay') => rows.push({id,title,status,purpose,profile,current,evidence,group});
add('combo','Winning symbol combination','Missing reward layer','One clear reward accent when a winning cluster highlights. Keep the physical symbol texture underneath. Start here: choose the main sound language before individual symbols.','reward',null,'src/audio.ts: cluster_win does nothing; PixiGameScene.playCombinationAnimation draws links only.');
add('cascade','Consecutive winning cascade','Missing dedicated layer','Short melodic step for each additional winning cascade; same motif, modest pitch progression, reset each round.','ladder',null,'No cascade-index audio motif in EventAudioBus.route.');
add('refill','Tumble refill / settle','Missing dedicated layer','Brief falling-air movement and a soft settled tick as the replacement symbols finish dropping. Avoid a sound for every cell.','whoosh',null,'tumble_drop has no audio route; symbol animation details may still play.');
add('heat1','First Wanted star','Missing explicit cue','A compact star-lock ping when the first earned star fills. Higher levels already use heat_rise / siren.','metal',null,'heat_advance only fires at to >= 2.');
for (const [id,title,profile,purpose] of [
 ['dynamite','Dynamite landing','impact','A dry mechanical landing before the fuse starts.'],
 ['fuse','Burning fuse','noise','A continuous fizz for the actual arming duration, cancelled at explosion or dismissal.'],
 ['double','Each gold-bar ×2','ladder','One short bright accent exactly as each affected value doubles; pitch by reveal order.'],
 ['held','Respins replenished / held','metal','A compact confirmation when the respin meter is held or replenished.'],
 ['spent','Respin consumed','tick','A quiet mechanical decrement; distinct from a reward.'],
 ['dud','Dynamite without a target','tick','A dry, neutral dud click. No winning flourish.'],
 ['bonusspin','Getaway spin start','whoosh','A short mechanical start cue for the bonus reels.'],
 ['bonusstop','Getaway column stop','impact','A restrained click at each bonus column stop; below the gold-bar landing.'],
]) add(id,title,'Emitted but unhandled',purpose,profile,null,'BonusView emits this moment; main.ts onGetawayCue handles only boom.','Getaway');
add('scatter','Individual scatter landing','Optional / intentionally quiet','Optional subtle identity accent, separate from bonus trigger. Existing code deliberately omits per-scatter tease audio; decide whether to restore it.','metal',null,'audio.ts scatter_tease; BoardView.scatterTease.');
add('uierror','Unavailable action / error','Optional proposal','A quiet neutral error tick, only when an action is rejected. Confirm the exact UI trigger before implementation.','tick',null,'New design proposal, not a confirmed missing runtime callback.','Interface');
const methods = [
 ['anticipation','Scatter anticipation','anticipation',[false],'riser','Rising cue while the anticipation reel is visibly slowing.'],
 ['miss','Anticipation ends without bonus','anticipationMiss',[],'down','Existing descending sting; consider shortening or removing it.'],
 ['dead','Getaway empty spin','deadSpin',[1],'down','Existing losing-spin cue; assess whether its weight fits the moment.'],
 ['truck','Truck drive-off','truckDriveOff',[],'engine','Engine movement as trucks drive away into the bonus.'],
 ['doors','Truck doors','truckDoors',[],'impact','Latch / door impact as the truck opens.'],
 ['piece','Collection piece movement','pieceWhoosh',[],'whoosh','Whoosh during the collection reveal.'],
 ...['low','mid','high','grand'].map(x=>['impact_'+x,'Banner impact: '+x,'bannerImpact',[x],'impact','Layer under the corresponding win-banner reveal.']),
 ['counter','Money counter (2-second demo)','startWinCounter',[],'counter','Existing count loop and stop accent, demonstrated for two seconds.'],
 ['result','Getaway result (4-second demo)','resultDemo',[],'reward','Current result opening, counter, tier accent, end and exit. Demonstration timing, not gameplay timing.'],
 ['helicopter','Maximum chase heat','setBonusHeat',[3],'engine','Existing siren plus procedural rotor at maximum bonus heat.'],
];
for(const [id,title,method,args,profile,purpose] of methods) add(id,title,'Existing procedural / mixed',purpose,profile,{kind:'method',method,args},'src/audio.ts / src/audio/GetawayResultSound.ts','Current effects');
const symbols = {PISTOL:['fire','casing','tink','slidelock','strip','impact'],AMMO:['jolt','rattle','scatter','impact'],CASH:['riffle','flutter','snap','flick','impact'],DUFFEL:['thump','jingle','burst','thud'],KNIFE:['swish','catch','shing','tick','slice'],DIAMOND:['chime','ping','shatter','fire'],BRASS:['punch','drop','thud'],BIKE:['rev','wheelie','vroom','thud'],PHONE_SCATTER:['thud']};
for(const [symbol,cues] of Object.entries(symbols)) for(const cue of cues) add('foley_'+symbol+'_'+cue,`${symbol}: ${cue}`,'Existing quiet texture',`Physical ${cue} detail for ${symbol}. Auditioned in isolation at the normal-game foley gain; actual playback depends on the authored animation and deduplication.`,/rev|wheelie|vroom/.test(cue)?'engine':/shing|chime|ping|tink|jingle/.test(cue)?'metal':/swish|flutter|riffle|strip|slice/.test(cue)?'whoosh':'impact',{kind:'foley',symbol,cue},'src/audio/SymbolFoley.ts; authored skeletal cues','Symbol details');
const purposes = {good_win_combo:'Candidate existing combination jingle. Loaded, but no current play call found; not the sound of cluster_win.',new_reel_stop:'Current base-reel impact callback. Active through PixiGameScene.onReelImpact.',reel_loop:'Current base reel loop, stopped on the final column impact.',sticky_gold_bar:'Current gold-bar / safe landing and Wanted-star sequence accent.',getaway_explosive:'Current dynamite explosion at the blast frame.',getaway_intro:'Bonus entry sting; played at 1.25× speed in game.',bg_bonus:'Current background loop for the bonus.',tumble_pop:'Current removal accent for winning symbols.',wild_sound:'Current WILD landing accent.',poker_machine_win:'Transformation accent; invoked from multiple paths. Check overlapping playback in the integration pass.',money_counter_loop:'Current count-up loop; follows visual count duration.',money_counter_end:'Raw ending recording. Game uses only a 0.28-second fading excerpt.',typewriter:'Current typing accompaniment for bonus intro.',win_big_lowest:'Lowest large-win banner sound.',win_mega_grand:'Shared middle large-win banner recording.',win_max:'Largest win-banner recording.'};
const used = new Set();
for(const id of tracks){
 const file=paths[id]??`assets/audio/${id}.mp3`; const exists=fs.existsSync(path.join(root,'public',file)); if(exists) used.add(file);
 const music=/bg_|sunset|turbo_night|vice_nights|open_lines/.test(id); const voice=/^mil/.test(id);
 add('track_'+id,id.replaceAll('_',' '),exists?'Existing file (routing varies)':'Missing file / fallback',purposes[id]??(voice?'Character milestone voice. Review each voice separately; keep performance, pacing and loudness consistent.':music?'Music / radio track. Review separately from gameplay effects.':'Loaded track name; availability alone does not establish active gameplay use. See source routing during integration.'),voice||music?'source':/loop/.test(id)?'counter':/win/.test(id)?'reward':/rise/.test(id)?'riser':'impact',exists?{kind:'file',url:'/'+file}:{kind:'method',method:'fire',args:[id]},`Track ${id} → ${file}`,'Track library');
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(path.join(root,'public/assets')).filter(f=>/\.(mp3|wav|ogg)$/i.test(f))){
 const rel=path.relative(path.join(root,'public'),file).replaceAll('\\','/'); if(used.has(rel))continue;
 add('asset_'+rel,path.basename(file),'Additional asset / verify use','Available recording for audition. Getaway sample files belong to a separate sound class that is not instantiated in the current game; they are options, not proof of active sound.','source',{kind:'file',url:'/'+rel},rel,'Additional assets');
}
fs.writeFileSync(path.join(root,'tools/sound-review/catalog.json'),JSON.stringify(rows,null,2)+'\n');
console.log(`Sound review: ${rows.length} entries; ${rows.filter(r=>r.current).length} current previews.`);
