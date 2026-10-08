import {createServer}from'node:http';import {readFile}from'node:fs/promises';import {fileURLToPath}from'node:url';import {join,dirname,resolve}from'node:path';import {createHash}from'node:crypto';
import {Workspace}from'./src/trial.mjs';import {need}from'./src/guide.mjs';import {load,createStore}from'./src/store.mjs';import {demo}from'./src/demo.mjs';import {generateDraft}from'./src/gemini.mjs';import {printable,printCSS}from'./src/print.mjs';
const root=dirname(fileURLToPath(import.meta.url));const assets={'/':'index.html','/styles.css':'styles.css','/app.mjs':'app.mjs','/import.mjs':'import.mjs','/assets/fold.svg':'assets/fold.svg','/assets/transfer.svg':'assets/transfer.svg','/assets/branches.svg':'assets/branches.svg'};
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;need(size<=262144,'الطلب أكبر من ٢٥٦ كيلوبايت',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{need(false,'صيغة JSON غير صالحة');}}
export async function startServer({port=Number(process.env.PORT||4313),file=process.env.DATA_FILE||join(root,'data','state.json'),aiOptions}={}){
 let w=new Workspace(await load(file));const save=createStore(file);let server,mutations=Promise.resolve();
 const transact=operation=>{const result=mutations.then(async()=>{const candidate=new Workspace(w.serialize());const value=operation(candidate);await save(candidate.serialize());w=candidate;return value;});mutations=result.catch(()=>{});return result;};
 server=createServer(async(req,res)=>{
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const styleHash=createHash('sha256').update(printCSS).digest('base64');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'sha256-"+styleHash+"'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  try{
   const hosts=['127.0.0.1:'+server.address().port,'localhost:'+server.address().port];need(hosts.includes(req.headers.host),'عنوان المضيف غير مسموح',403);const path=new URL(req.url,'http://127.0.0.1').pathname;
   if(req.method==='GET'&&assets[path]){const asset=assets[path];const ext=asset.split('.').pop();res.writeHead(200,{'Content-Type':ext==='html'?'text/html; charset=utf-8':ext==='css'?'text/css; charset=utf-8':ext==='svg'?'image/svg+xml':'text/javascript; charset=utf-8'});res.end(await readFile(join(root,'public',asset)));return;}
   if(req.method==='GET'&&path==='/api/status'){json(200,{initialized:!!w.state.credentials,aiAvailable:!!(aiOptions?.key||process.env.GEMINI_API_KEY),model:aiOptions?.model||process.env.GEMINI_MODEL||'gemini-3.5-flash-lite',demo:true});return;}
   if(req.method==='POST')need(['http://'+req.headers.host].includes(req.headers.origin),'الطلب يجب أن يأتي من أصل الموقع نفسه',403);
   if(req.method==='POST'&&path==='/api/setup'){const data=await body(req);const keys=await transact(candidate=>candidate.setup(data.guide||demo));json(201,keys);return;}
   if(req.method==='POST'&&path==='/api/join'){const data=await body(req);const keys=await transact(candidate=>candidate.join(data.invitation,data.secret));json(201,keys);return;}
   const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):undefined;const role=w.role(token);
   if(req.method==='GET'&&path==='/api/state'){json(200,w.view(token));return;}
   if(req.method==='GET'&&path==='/api/export'){json(200,w.export(token));return;}
   if(req.method==='GET'&&path==='/api/export-guide'){json(200,w.exportGuide(token));return;}
   if(req.method==='GET'&&path==='/api/print'){const v=w.view(token);need(v.guide.approved,'الدليل يحتاج اعتماد المعلّم قبل طباعته',409);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(printable(v));return;}
   if(req.method==='POST'&&path==='/api/action'){const data=await body(req);const v=await transact(candidate=>candidate.act(token,data.action,data.payload));json(200,v);return;}
   if(req.method==='POST'&&path==='/api/draft'){need(role==='teacher','صلاحية المعلّم مطلوبة',403);const data=await body(req);const draft=await generateDraft(data,aiOptions);json(200,{draft,published:false,requiresTeacherReview:true});return;}
   json(404,{error:'المسار غير موجود'});
  }catch(e){json(e.status||500,{error:e.status?e.message:'تعذّر إتمام الطلب. أعد المحاولة.'});}
 });await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((yes,no)=>server.close(e=>e?no(e):yes()))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const app=await startServer();console.log('صنعة: '+app.url);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});}
