/** One unbound cash wad at rest. Six hidden loose notes are released only by
 * the throwing animation; they never clutter the idle symbol. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, sharp, bbox, crop, blank, over, svgRaster, standardCanvas, glowFrom, saveWebp } from "../img.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW = 800, SH = 600;
const doc = (inner, w = SW, h = SH, tf = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="${tf}">${inner}</g></svg>`;
async function asset(file) {
  const raw = await load(path.join(HERE, file));
  const img = crop(raw, bbox(raw, 20));
  const png = await sharp(Buffer.from(img.data.buffer), {raw:{width:img.w,height:img.h,channels:4}}).png().toBuffer();
  return { uri:`data:image/png;base64,${png.toString('base64')}`, aspect:img.h/img.w };
}
export async function build() {
  const wad = await asset('cash-wad.source.png');
  const note = await asset('cash-note.source.png');
  const wadH = 640*wad.aspect;
  const drawing = `<image href="${wad.uri}" x="80" y="85" width="640" height="${wadH}"/>`;
  const sc = await standardCanvas(await svgRaster(doc(drawing),SW,SH));
  const {cw,ch}=sc, [tx,ty]=sc.map(0,0);
  const tf=`matrix(${sc.scale} 0 0 ${sc.scale} ${tx} ${ty})`;
  const R = svg => svgRaster(doc(svg,cw,ch,tf),cw,ch);
  const body = await R(drawing);
  const noteW=545, noteH=noteW*note.aspect;
  const nx=400-noteW/2, ny=85+wadH*.37-noteH/2;
  const paper = await R(`<image href="${note.uri}" x="${nx}" y="${ny}" width="${noteW}" height="${noteH}"/>`);
  const names=Array.from({length:6},(_,i)=>`throw_${i}`);
  const layers=[{name:'glow',raster:await glowFrom(body,[164,209,168])},{name:'wad',raster:body},...names.map(name=>({name,raster:paper}))];
  const pivots={glow:[cw/2,ch/2],wad:sc.map(400,85+wadH*.8)};
  for(const name of names) pivots[name]=sc.map(400,85+wadH*.37);
  await saveWebp(crop(body,bbox(body)),path.resolve(HERE,'../../../../public/assets/symbols/cash.webp'),false);
  return {canvas:[cw,ch],art:[sc.aw,sc.ah],layers,pivots,
    rig:{hidden:names,lowres:Object.fromEntries(names.map(name=>[name,.5])),shipLossy:true},
    meta:{throws:names,unit:sc.scale},checkAgainst:body};
}
