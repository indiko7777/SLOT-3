import type { Plugin } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export function soundReviewServer():Plugin {
 return {name:'local-sound-review-storage',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
   if(!req.url?.startsWith('/__sound-review/'))return next();
   const url=new URL(req.url,'http://127.0.0.1');
   const origin=req.headers.origin;
   if(req.headers.host!=='127.0.0.1:5176'&&req.headers.host!=='localhost:5176'){res.statusCode=403;res.end();return;}
   if(origin && origin!==`http://${req.headers.host}`){res.statusCode=403;res.end();return;}
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   try{
    if(url.pathname==='/__sound-review/state'&&req.method==='GET'){
     const file=await fs.readFile(path.join(dir,'decisions.json'),'utf8').catch(()=>fs.readFile(path.join(dir,'confirmed-seed.json'),'utf8'));res.end(file);return;
    }
    if(req.method!=='PUT'&&req.method!=='POST'){res.statusCode=405;res.end('{}');return;}
    // Non-browser cross-site forms cannot set this required application header.
    if(req.headers['x-sound-review']!=='local'){res.statusCode=403;res.end('{}');return;}
    const chunks:Buffer[]=[];let size=0;const max=url.pathname.endsWith('/upload')?20*1024*1024:1024*1024;
    for await(const chunk of req){size+=chunk.length;if(size>max){res.statusCode=413;res.end('{"error":"File too large (20 MB maximum)"}');return;}chunks.push(Buffer.from(chunk));}
    const body=Buffer.concat(chunks);
    if(url.pathname==='/__sound-review/state'&&req.method==='PUT'){
     const data=JSON.parse(body.toString());if(data.version!==2||!data.decisions||typeof data.decisions!=='object'||Array.isArray(data.decisions))throw Error('Invalid review data');
     const temp=path.join(dir,`decisions-${randomUUID()}.tmp`);await fs.writeFile(temp,JSON.stringify(data,null,2)+'\n');await fs.rename(temp,path.join(dir,'decisions.json'));res.end('{"saved":true}');return;
    }
    if(url.pathname==='/__sound-review/upload'&&req.method==='POST'){
     const filename=url.searchParams.get('name')??'';const ext=path.extname(filename).toLowerCase();if(!['.mp3','.wav','.ogg','.m4a','.flac','.aac','.webm'].includes(ext))throw Error('Use an audio file');
     const name=`user-${randomUUID()}${ext}`;await fs.mkdir(path.join(dir,'uploads'),{recursive:true});await fs.writeFile(path.join(dir,'uploads',name),body);res.end(JSON.stringify({url:`/tools/sound-review/uploads/${name}`}));return;
    }
    res.statusCode=404;res.end('{}');
   }catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}
  });
 }};
}
