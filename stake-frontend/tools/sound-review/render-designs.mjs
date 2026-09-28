import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),rate=48000;
const out=path.join(root,'designs');fs.mkdirSync(out,{recursive:true});
// Each recipe is an authored event sequence, not a pitch preset of one shared jingle.
class Render {
 constructor(seconds){this.a=new Float64Array(Math.ceil(seconds*rate));this.seed=7091;}
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)|0;return this.seed/2147483648;}
 add(start,duration,fn){const offset=Math.round(start*rate),n=Math.round(duration*rate);for(let i=0;i<n&&offset+i<this.a.length;i++)this.a[offset+i]+=fn(i/rate,i/n);}
 tone(start,duration,freq,volume,end=freq,wave='sine',attack=.002){let phase=0;this.add(start,duration,(t,p)=>{const f=freq*Math.pow(end/freq,p);phase+=f/rate;const sine=Math.sin(2*Math.PI*phase);const v=wave==='saw'?2*(phase%1)-1:wave==='triangle'?2/Math.PI*Math.asin(sine):sine;return v*volume*Math.min(1,t/attack)*Math.exp(-6*p)*Math.min(1,(1-p)*60);});}
 noise(start,duration,volume,lo=300,hi=6000,attack=.002,decay=5){let l=0,h=0;const kl=1-Math.exp(-2*Math.PI*lo/rate),kh=1-Math.exp(-2*Math.PI*hi/rate);this.add(start,duration,(t,p)=>{const x=this.random();l+=kl*(x-l);h+=kh*(x-h);return (h-l)*volume*Math.min(1,t/attack)*Math.exp(-decay*p)*Math.min(1,(1-p)*90);});}
 metal(start,freq,volume=.2,duration=.35){[1,1.47,2.12,3.31,4.72].forEach((v,i)=>this.tone(start,duration/(1+i*.28),freq*v,volume/(1+i*1.8)));}
 thud(start=0,volume=.4){this.tone(start,.19,175,volume,48);this.noise(start,.035,.19,600,2400);}
 air(start,duration,volume=.4){this.noise(start,duration,volume,600,9000,duration*.42,1.5);}
 brass(start,duration,root=146.83){[1,1.5,2].forEach((m,i)=>[-5,5].forEach(det=>this.tone(start,duration,root*m*2**(det/1200),.10/(i+1),root*m,'saw',.018)));this.thud(start,.45);}
 paper(start,volume=.7){this.noise(start,.024,volume,1700,10000);this.noise(start+.013,.045,volume*.5,2200,7000);}
 engine(start,duration,from,to){let phase=0;this.add(start,duration,(t,p)=>{const f=from+(to-from)*Math.sin(p*Math.PI*.65);phase+=f/rate;const motor=Math.sin(2*Math.PI*phase)+.32*Math.sin(4*Math.PI*phase)+.15*Math.sin(6*Math.PI*phase);const pulse=.65+.35*Math.sin(2*Math.PI*t*from*.38);return Math.tanh(motor*1.5)*pulse*.24*Math.min(1,t/.035)*Math.min(1,(1-p)*5);});this.noise(start,duration,.25,100,900,.03,1);}
 wav(){let peak=0;for(const x of this.a)peak=Math.max(peak,Math.abs(x));const scale=peak>0?.72/peak:1;const b=Buffer.alloc(44+this.a.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(this.a.length*2,40);this.a.forEach((v,i)=>b.writeInt16LE(Math.round(v*scale*32767),44+i*2));return b;}
}
const designs={};
function make(id,name,description,seconds,recipe){const r=new Render(seconds);recipe(r);fs.writeFileSync(path.join(out,id+'.wav'),r.wav());designs[id]={id,name,description,duration:seconds,url:`/tools/sound-review/designs/${id}.wav`};}
make('cash-snap','Banknote snap','One sharp paper flick, a short rustle, then a soft stack landing. No melody.',.36,r=>{r.paper(0);r.noise(.04,.20,.35,1100,5400);r.tone(.12,.13,170,.20,95);});
make('cash-riffle','Cash fan','A fast six-note paper riffle closing with a rubber-band snap. A longer, textured motion.',.55,r=>{for(let i=0;i<6;i++)r.paper(i*.042,.40+i*.04);r.noise(.27,.014,.65,1800,9500);r.tone(.27,.13,260,.15,120);});
make('ammo-chamber','Chamber click','Two tight mechanical clicks, followed by one small brass ring. Compact and dry.',.30,r=>{r.noise(0,.014,.7,800,4500);r.noise(.055,.025,.65,1600,6800);r.metal(.064,1740,.09,.17);});
make('ammo-spill','Cartridge scatter','Three uneven brass collisions, descending in weight. Metallic, without a pitched reward tune.',.51,r=>{[0,.085,.19].forEach((t,i)=>{r.metal(t,1820+i*430,.15/(1+i*.35),.22);r.noise(t,.009,.48,2300,10000);});});
make('knife-draw','Blade draw','A rising air swipe into one sustained steel ring. Smooth and bright.',.58,r=>{r.air(0,.16,.55);r.metal(.10,2450,.14,.42);});
make('knife-cut','Hard slice','A short cutting swish with a blunt stop and a tiny blade tick. Much drier than Blade draw.',.28,r=>{r.noise(0,.10,.8,1200,10000,.025,1.8);r.noise(.085,.014,.75,2400,9500);r.metal(.092,3700,.065,.12);});
make('duffel-drop','Loaded bag drop','One low padded impact, followed by fabric movement. Weight without a musical ping.',.50,r=>{r.tone(0,.31,108,.6,38);r.noise(0,.15,.5,70,800);r.noise(.08,.24,.22,600,2200);});
make('duffel-zip','Zip and cash','A short zipper rasp, then a banknote flap. A textured opening motion instead of a bass hit.',.56,r=>{for(let i=0;i<22;i++)r.noise(i*.011,.009,.22,900,5500);r.paper(.25,.7);r.paper(.31,.38);});
make('diamond-prism','Prism ring','One high glass strike with a clear, lingering shimmer. No sequence of reward notes.',.86,r=>{[1,2.76,4.05].forEach((m,i)=>r.tone(0,.75/(1+i*.5),1318.5*m,.3/(i+1)));r.noise(0,.012,.25,6000,16000);});
make('diamond-spark','Crystal sparkle','Four tiny glass flecks sweep upward, ending in a higher crystal ping. Light and airy.',.69,r=>{[2093,2637,3136,4186].forEach((f,i)=>r.tone(i*.060,.37,f,.18/(1+i*.18)));r.noise(.025,.21,.15,7000,17000,.025,2);});
make('brass-punch','Knuckle impact','One midrange punch with a low body and a very short metal edge. No ringing tail.',.28,r=>{r.thud();r.noise(0,.067,.55,180,1900);r.metal(.006,720,.065,.09);});
make('brass-clang','Heavy brass clang','A hard, resonant metal strike over a low drop. Rings longer and feels hollow.',.68,r=>{r.thud();r.metal(.005,490,.30,.58);r.noise(0,.025,.42,1200,5000);});
make('bike-rev','Throttle blip','One short engine rev rising and releasing. Gritty pulses, no chime.',.68,r=>r.engine(0,.61,54,160));
make('bike-launch','Launch and skid','A longer accelerating engine with a brief high tyre squeal at the exit.',1.10,r=>{r.engine(0,.93,70,255);r.tone(.55,.39,1900,.08,950,'saw',.055);r.noise(.55,.43,.19,1400,6500,.06,1.6);});
make('truck-latch','Armored latch','Two heavy metal lock clicks with a short door-body thump.',.47,r=>{r.noise(0,.035,.6,300,3200);r.metal(.018,580,.12,.20);r.thud(.14,.5);});
make('radio-chirp','Radio dispatch chirp','A pair of short radio tones ending in a dry static cut. Electronic, without an engine impact.',.47,r=>{r.tone(0,.12,1320,.20,1320,'sine');r.tone(.14,.13,880,.16);r.noise(.25,.10,.25,1000,3500);});
make('reel-motor','Reel motor kick','A brief low motor rise and a dry latch at the start of movement.',.39,r=>{r.engine(0,.25,40,83);r.noise(.22,.024,.4,1600,7000);});
make('reel-air','Reel air pull','A clean sucked-air sweep followed by a small tick. Lighter and less mechanical.',.36,r=>{r.air(0,.26,.6);r.noise(.25,.020,.4,3100,11000);});
make('scatter-call','Incoming call','Two rounded telephone-style tones with a tiny electronic pop. Clear symbol identity.',.52,r=>{[0,.18].forEach(t=>{r.tone(t,.12,770,.14);r.tone(t,.12,1336,.09);});});
make('scatter-metal','Scatter stamp','A single heavy latch and a short bright metal ring. No phone tones.',.38,r=>{r.thud();r.metal(.018,1200,.19,.30);});
make('rotor','Rotor pass','A pulsing low rotor bed with a rising filtered wind texture. A 1.8-second audition.',1.8,r=>{for(let i=0;i<22;i++){r.tone(i*.075,.07,95,.2,45);r.noise(i*.075,.033,.2,180,1300);}r.air(.05,1.7,.23);});
make('siren','Police two-tone','A sustained alternating siren sweep with a quiet low motor underneath. A 1.8-second audition.',1.8,r=>{let phase=0;r.add(0,1.75,(t,p)=>{phase+=(740+330*Math.sin(t*Math.PI*3))/rate;return Math.sin(phase*2*Math.PI)*.25*Math.min(1,t/.04)*Math.min(1,(1-p)*10);});r.engine(0,1.7,38,48);});
make('reward-coins','Coin tumble','Five scattered metallic coin strikes followed by one resolved bright bell. Irregular physical rhythm.',.77,r=>{[0,.043,.113,.19,.31].forEach((t,i)=>r.metal(t,1800+i*197,.14,.2));r.tone(.34,.37,1568,.19);});
make('reward-brass','Heist stamp','One warm brass chord and a low punch. A single bold hit with no coin or arpeggio sequence.',.67,r=>r.brass(0,.56));
make('counter-paper','Paper roller','Fast irregular paper flicks with a short stack tap at the end. A 1.5-second preview.',1.5,r=>{for(let i=0;i<20;i++)r.paper(i*.06,.23);r.tone(1.21,.16,210,.20,110);});
make('counter-metal','Mechanical ticker','Even dry metal ticks, slightly accelerating, with a closing register clack. A 1.5-second preview.',1.5,r=>{let t=0;for(let i=0;i<19;i++){r.metal(t,1600+i*16,.10,.055);t+=.087-i*.002;}r.noise(1.2,.035,.55,500,4500);});
make('fuse-sparks','Spark fuse','Continuous fine hiss with sharp, irregular tiny sparks. Two-second preview; no melody.',2.0,r=>{r.noise(0,1.95,.27,3200,15000,.03,.2);for(let i=0;i<31;i++)r.noise(i*.06,.008,.24+(i%4)*.06,5000,17000);});
make('fuse-grit','Coarse fuse','A lower gritty burn, with a small sputter every quarter second. Two-second preview.',2.0,r=>{r.noise(0,1.95,.6,500,4800,.03,.4);for(let i=0;i<8;i++)r.noise(i*.23,.035,.45,1000,8000);});
make('ui-soft','Soft UI pop','A single rounded pop with a quick pitch drop. Short and non-metallic.',.18,r=>r.tone(0,.14,780,.3,310));
make('ui-click','Switch click','One dry, high mechanical click with no pitched tail.',.13,r=>r.noise(0,.027,.7,1800,11000));
make('impact-sub','Sub impact','One deep thump with a broad noise crack. Low and short.',.47,r=>{r.thud(0,.7);r.noise(0,.13,.5,200,3800);});
make('impact-metal','Metal slam','A sharper steel impact with a resonant ringing tail. Bright and longer.',.62,r=>{r.noise(0,.025,.5,2200,10000);r.metal(.007,620,.31,.51);r.tone(0,.17,120,.27,42);});
make('move-silk','Silk sweep','A smooth rising air sweep. No impact or pitched reward notes.',.46,r=>r.air(0,.41,.9));
make('move-zip','Electric zip','A sharply rising electronic glide with a thin scratch. Short, synthetic and pointed.',.30,r=>{r.tone(0,.23,210,.19,2400,'saw',.025);r.noise(.025,.19,.3,2500,11000,.025,2);});
make('rise-tremolo','Pulsing charge','Five tightening low pulses followed by a bright rise. Rhythmic rather than a sustained sweep.',.98,r=>{[0,.25,.44,.59,.71].forEach((t,i)=>r.tone(t,.13,130+i*50,.21,150+i*60,'triangle'));r.air(.5,.43,.30);});
make('rise-air','Air swell','One continuous rising wash over a low tone. Smooth, with no repeated pulses.',.98,r=>{r.air(0,.90,.9);r.tone(0,.86,130,.12,480,'triangle',.2);});
make('end-dry','Dry stop','A neutral low stop tick. No sad melody or celebratory notes.',.24,r=>{r.tone(0,.17,155,.3,72);r.noise(0,.018,.25,900,4800);});
make('end-fall','Power-down','One short descending electronic glide, ending cleanly.',.42,r=>r.tone(0,.35,600,.23,85,'triangle',.012));
make('star-lock','Star lock','A mechanical click and a short bright harmonic ring. One compact event.',.37,r=>{r.noise(0,.02,.55,1600,8000);r.tone(.01,.29,1174.66,.24);r.tone(.01,.19,2349.32,.06);});
make('star-chord','Star chord','A rounded three-note chord struck at once, without a mechanical click.',.49,r=>[587.33,739.99,880].forEach(f=>r.tone(0,.42,f,.12)));
fs.writeFileSync(path.join(root,'designs.json'),JSON.stringify(designs,null,2)+'\n');
console.log(`Rendered ${Object.keys(designs).length} original, individually described effects.`);
