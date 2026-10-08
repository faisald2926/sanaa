import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,rename,mkdir} from 'node:fs/promises';import {tmpdir}from'node:os';import {join}from'node:path';import {createServer}from'node:http';
import {startServer}from'../server.mjs';import {generateDraft}from'../src/gemini.mjs';
const guide={title:'<img src=x onerror=alert(1)>',skill:'طي منشفة',tools:['منشفة'],steps:[{id:'a',title:'بسط',instructions:'افرد المنشفة',dependsOn:[]},{id:'b',title:'طي',instructions:'اطو النصف',dependsOn:['a']}]};
async function harness(t){const dir=await mkdtemp(join(tmpdir(),'sanaa-'));const app=await startServer({port:0,file:join(dir,'state.json')});t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});const url=app.url;async function req(path,body,token,origin=url){const res=await fetch(url+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.text()};}const r=await req('/api/setup',{guide});assert.equal(r.status,201);const keys=JSON.parse(r.body);assert.equal(keys.learner,undefined);const joined=await req('/api/join',{invitation:keys.invitation,secret:'learner-secret-for-local-test'});assert.equal(joined.status,201);keys.learner=JSON.parse(joined.body).learner;assert.equal((await req('/api/join',{invitation:keys.invitation,secret:'second-learner-long-secret'})).status,409);return {app,req,keys,dir};}
test('actual HTTP lifecycle enforces role, current versions, prerequisite and two confirmations',async t=>{
 const {req,keys:k}=await harness(t);assert.equal((await req('/api/state')).status,401);assert.equal((await req('/api/action',{action:'edit',payload:{id:'a',patch:{title:'مزور'}}},k.learner)).status,403);
 const v=JSON.parse((await req('/api/state',null,k.learner)).body);assert.equal((await req('/api/action',{action:'complete',payload:{id:'b',hash:v.guide.steps[1].hash,result:'تم'}},k.learner)).status,409);
 assert.equal((await req('/api/action',{action:'complete',payload:{id:'a',hash:v.guide.steps[0].hash,result:'تم'}},k.teacher)).status,403);
 for(const s of v.guide.steps)assert.equal((await req('/api/action',{action:'complete',payload:{id:s.id,hash:s.hash,result:'نفذتها فعلًا'}},k.learner)).status,200);
 await req('/api/action',{action:'confirm',payload:{digest:v.digest}},k.teacher);let final=JSON.parse((await req('/api/state',null,k.teacher)).body);assert.equal(final.tested,false);
 await req('/api/action',{action:'confirm',payload:{digest:v.digest}},k.learner);final=JSON.parse((await req('/api/state',null,k.learner)).body);assert.equal(final.tested,true);
 const edit=JSON.parse((await req('/api/action',{action:'edit',payload:{id:'a',patch:{instructions:'افرد الزوايا'}}},k.teacher)).body);assert.equal(edit.tested,false);assert.deepEqual(edit.trial.completed,{});
 assert.equal((await req('/api/action',{action:'complete',payload:{id:'a',hash:v.guide.steps[0].hash,result:'قديم'}},k.learner)).status,409);
});
test('HTTP checks origin, body size, malformed JSON, XSS-safe print, secret-free export and persistence',async t=>{
 const {app,req,keys:k,dir}=await harness(t);assert.equal((await req('/api/action',{action:'approve'},k.teacher,'https://evil.example')).status,403);
 assert.equal((await req('/api/setup',{guide})).status,409);assert.equal((await req('/api/action',{action:'edit',payload:{oversize:'x'.repeat(70000)}},k.teacher)).status,413);
 const malformed=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,Authorization:'Bearer '+k.teacher},body:'{bad'});assert.equal(malformed.status,400);
 const p=await req('/api/print',null,k.teacher);assert.equal(p.status,200);assert.ok(p.body.includes('&lt;img'));assert.ok(!p.body.includes('<img src=x'));assert.ok(!p.body.includes(k.teacher));
 const exp=await req('/api/export',null,k.teacher);assert.ok(!exp.body.includes(k.teacher)&&!exp.body.includes(k.learner));
 const saved=await readFile(join(dir,'state.json'),'utf8');assert.ok(!saved.includes(k.teacher));
 const restored=await startServer({port:0,file:join(dir,'state.json')});t.after(()=>restored.close());const valid=await fetch(restored.url+'/api/state',{headers:{Authorization:'Bearer '+k.learner}});assert.equal(valid.status,200);
});
test('Gemini requires consent, timeout and schema validation; never publishes generated drafts',async t=>{
 const {req,keys:k}=await harness(t);assert.equal((await req('/api/draft',{notes:'ملاحظات',consent:false},k.teacher)).status,400);assert.equal((await req('/api/draft',{notes:'ملاحظات',consent:true},k.learner)).status,403);
 assert.equal((await req('/api/draft',{notes:'ملاحظات',consent:true},k.teacher)).status,503);
 const before=(await req('/api/state',null,k.teacher)).body;const mock=createServer((request,response)=>{let raw='';request.on('data',d=>raw+=d);request.on('end',()=>{assert.equal(request.headers['x-goog-api-key'],'test-only');assert.ok(JSON.parse(raw).generationConfig.responseJsonSchema);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(guide)}]}}]}));});});await new Promise(r=>mock.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>mock.close(r)));
 const baseUrl='http://127.0.0.1:'+mock.address().port;const draft=await generateDraft({notes:'افرد ثم اطو',consent:true},{key:'test-only',baseUrl});assert.equal(draft.steps.length,2);assert.equal((await req('/api/state',null,k.teacher)).body,before);
 const bad=createServer((_,r)=>r.end(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]})));await new Promise(r=>bad.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>bad.close(r)));await assert.rejects(()=>generateDraft({notes:'نص',consent:true},{key:'test-only',baseUrl:'http://127.0.0.1:'+bad.address().port}));
 const slow=createServer((_,r)=>{setTimeout(()=>r.end('{}'),100);});await new Promise(r=>slow.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>slow.close(r)));await assert.rejects(()=>generateDraft({notes:'نص',consent:true},{key:'test-only',baseUrl:'http://127.0.0.1:'+slow.address().port,timeout:10}));
});
test('failed physical persistence does not publish mutation and does not poison the next write',async t=>{
 const {req,keys:k,dir}=await harness(t),file=join(dir,'state.json');const before=JSON.parse((await req('/api/state',null,k.teacher)).body);
 await rename(file,file+'.backup');await mkdir(file);try{
  const failed=await req('/api/action',{action:'edit',payload:{id:'a',patch:{title:'لا يجب نشره'}}},k.teacher);assert.equal(failed.status,500);
  assert.deepEqual(JSON.parse((await req('/api/state',null,k.teacher)).body),before);
 }finally{await rm(file,{recursive:true});await rename(file+'.backup',file);}
 const next=await req('/api/action',{action:'edit',payload:{id:'a',patch:{title:'حفظ ناجح بعد الفشل'}}},k.teacher);assert.equal(next.status,200);assert.equal(JSON.parse(next.body).guide.steps[0].title,'حفظ ناجح بعد الفشل');
 assert.equal(JSON.parse(await readFile(file,'utf8')).guide.steps[0].title,'حفظ ناجح بعد الفشل');
});
