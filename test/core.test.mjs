import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGuide } from '../src/guide.mjs';
import { Workspace } from '../src/trial.mjs';
const fixture=()=>({title:'طيّ منشفة',skill:'تعلم عملي',tools:['منشفة'],steps:[{id:'a',title:'بسط',instructions:'ابسط المنشفة',dependsOn:[]},{id:'b',title:'طي',instructions:'اطو النصف',dependsOn:['a']},{id:'c',title:'تسوية',instructions:'سو الحافة',dependsOn:['b']},{id:'d',title:'مكان',instructions:'جهز مكانًا',dependsOn:[]}]});
function setup(){const w=new Workspace();const keys=w.setup(fixture());const joined=w.join(keys.invitation,'learner-secret-at-least-twelve');return {w,t:keys.teacher,l:joined.learner};}
function complete(w,l){for(const s of w.view(l).guide.steps)w.act(l,'complete',{id:s.id,hash:s.hash,result:'نفذتها فعلًا'});}
test('validates DAG references, cycles, duplicate IDs and maximum twelve steps',()=>{
 const f=fixture(); assert.deepEqual(validateGuide(f).steps.map(s=>s.id),['a','b','c','d']);
 for(const bad of [{...f,steps:[{...f.steps[0],dependsOn:['missing']}]},{...f,steps:[{...f.steps[0],dependsOn:['a']}]},{...f,steps:[f.steps[0],f.steps[0]]},{...f,steps:Array.from({length:13},(_,i)=>({...f.steps[0],id:'x'+i}))}])assert.throws(()=>validateGuide(bad));
});
test('prerequisites and authorizations prevent false work and role impersonation',()=>{
 const {w,t,l}=setup();const b=w.view(l).guide.steps[1]; assert.throws(()=>w.act(l,'complete',{id:'b',hash:b.hash,result:'تم'}));
 assert.throws(()=>w.act(t,'complete',{id:'a',hash:w.view(t).guide.steps[0].hash,result:'تم',role:'learner'}));
 assert.throws(()=>w.act(l,'edit',{id:'a',patch:{instructions:'تغيير'}}));assert.throws(()=>w.view('forged'));assert.throws(()=>w.setup(fixture()));
});
test('edit invalidates changed step and descendants but preserves an independent branch and history',()=>{
 const {w,t,l}=setup();complete(w,l);const old=w.view(l).guide.steps[1].hash;
 w.act(t,'edit',{id:'b',patch:{instructions:'اطو النصف بعناية'}});const v=w.view(l);
 assert.deepEqual(Object.keys(v.trial.completed).sort(),['a','d']);assert.deepEqual(v.lastImpact,['b','c']);assert.equal(v.guide.steps[1].version,2);assert.equal(v.guide.steps[1].history.length,1);
 assert.throws(()=>w.act(l,'complete',{id:'b',hash:old,result:'تم'}));
});
test('dependency edits and title edits also invalidate current acknowledgments',()=>{
 const {w,t,l}=setup();complete(w,l);w.act(t,'edit',{id:'b',patch:{dependsOn:['d']}});assert.deepEqual(Object.keys(w.view(l).trial.completed).sort(),['a','d']);
 complete(w,l);w.act(t,'edit',{id:'a',patch:{title:'عنوان جديد'}});assert.deepEqual(Object.keys(w.view(l).trial.completed).sort(),['b','c','d']);
});
test('blocked work requires a teacher clarification and a new learner attempt',()=>{
 const {w,t,l}=setup();const s=w.view(l).guide.steps[0];w.act(l,'block',{id:'a',hash:s.hash,question:'كيف أبسطها؟'});
 assert.throws(()=>w.act(l,'complete',{id:'a',hash:s.hash,result:'تم'}));assert.throws(()=>w.act(l,'clarify',{id:'a',answer:'جواب'}));
 w.act(t,'clarify',{id:'a',answer:'ضعها فوق سطح مستوٍ وافرد الزوايا'});const v=w.view(l);assert.equal(v.trial.completed.a,undefined);assert.equal(v.trial.issues[0].status,'resolved');
 w.act(l,'complete',{id:'a',hash:v.guide.steps[0].hash,result:'بسطتها فوق الطاولة'});assert.ok(w.view(l).trial.completed.a);
});
test('final transfer needs all current steps and both distinct bearer roles, invalidated on any guide edit',()=>{
 const {w,t,l}=setup();assert.throws(()=>w.act(t,'confirm',{digest:w.view(t).digest}));complete(w,l);
 const digest=w.view(t).digest;w.act(t,'confirm',{digest});assert.equal(w.view(t).tested,false);w.act(l,'confirm',{digest});assert.equal(w.view(l).tested,true);
 w.act(t,'edit',{id:'d',patch:{title:'مكان التنفيذ'}});assert.equal(w.view(l).tested,false);assert.throws(()=>w.act(t,'confirm',{digest}));
});
test('export excludes credentials and imports reset all approvals',()=>{
 const {w,t,l}=setup();complete(w,l);const digest=w.view(t).digest;w.act(t,'confirm',{digest});w.act(l,'confirm',{digest});
 const out=w.export(t);const json=JSON.stringify(out);assert.ok(!json.includes(t)&&!json.includes(l)&&!json.includes('tokenHash'));
 w.act(t,'import',{guide:{...out.guide,approved:true,trial:{completed:{a:true}}}});assert.equal(w.view(l).guide.approved,false);assert.equal(w.view(l).tested,false);assert.deepEqual(w.view(l).trial.completed,{});assert.throws(()=>complete(w,l));
 w.act(t,'approve',{});complete(w,l);assert.equal(w.view(l).tested,false);
});
test('expired credential fails after persistence reload',()=>{
 const {w,t}=setup();const persisted=w.serialize();persisted.credentials.teacher.expiresAt=0;const restored=new Workspace(persisted);assert.throws(()=>restored.view(t));
});
test('independent reachability oracle: every forward DAG of four steps retains exactly unaffected confirmations',()=>{
 for(let mask=0;mask<64;mask++){
  const edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]].filter((_,i)=>mask&(1<<i));
  const f=fixture();f.steps=f.steps.map((s,i)=>({...s,dependsOn:edges.filter(e=>e[1]===i).map(e=>f.steps[e[0]].id)}));
  for(let changed=0;changed<4;changed++){
   const w=new Workspace();const k=w.setup(f);k.learner=w.join(k.invitation,'learner-secret-at-least-twelve').learner;complete(w,k.learner);const affected=new Set([changed]);let growing=true;
   while(growing){growing=false;for(const [a,b]of edges)if(affected.has(a)&&!affected.has(b)){affected.add(b);growing=true;}}
   w.act(k.teacher,'edit',{id:f.steps[changed].id,patch:{instructions:'تعليمات جديدة'}});
   assert.deepEqual(Object.keys(w.view(k.learner).trial.completed).sort(),f.steps.filter((_,i)=>!affected.has(i)).map(s=>s.id).sort());
  }
 }
});
test('teacher receives invitation only: learner chooses secret once, never returned by teacher state or export',()=>{
 const w=new Workspace(),keys=w.setup(fixture());assert.equal(keys.learner,undefined);assert.equal(w.serialize().credentials.learner,undefined);assert.throws(()=>w.join(keys.invitation,'short'));
 assert.throws(()=>w.join(keys.invitation,keys.teacher));const l=w.join(keys.invitation,'chosen-by-learner-only').learner;assert.equal(w.view(l).role,'learner');assert.equal(w.view(keys.teacher).learnerJoined,true);assert.throws(()=>w.join(keys.invitation,'another-long-secret'));
 const out=JSON.stringify([w.view(keys.teacher),w.export(keys.teacher)]);assert.ok(!out.includes(l)&&!out.includes(keys.invitation));
 const old=new Workspace();const expired=old.setup(fixture());const persisted=old.serialize();persisted.invitation.expiresAt=0;assert.throws(()=>new Workspace(persisted).join(expired.invitation,'learner-long-secret'));
});
test('exact descendant acknowledgment replay fails after ancestor is changed and re-completed',()=>{
 const {w,t,l}=setup();complete(w,l);const old=w.view(l).guide.steps.find(s=>s.id==='c');
 w.act(t,'edit',{id:'a',patch:{instructions:'افرد كل الزوايا الآن'}});let v=w.view(l);w.act(l,'complete',{id:'a',hash:v.guide.steps.find(s=>s.id==='a').hash,result:'أعدت البسط'});
 v=w.view(l);w.act(l,'complete',{id:'b',hash:v.guide.steps.find(s=>s.id==='b').hash,result:'أعدت الطي'});
 assert.throws(()=>w.act(l,'complete',{id:'c',hash:old.hash,result:'إعادة إرسال الإقرار القديم'}));assert.notEqual(w.view(l).guide.steps.find(s=>s.id==='c').hash,old.hash);
 assert.equal(w.view(l).guide.steps.find(s=>s.id==='c').version,2);
});
test('reserved object keys cannot become step identifiers; invalid payloads leave state unchanged',()=>{
 for(const id of ['__proto__','constructor','prototype'])assert.throws(()=>validateGuide({...fixture(),steps:[{id,title:'عنوان',instructions:'شرح',dependsOn:[]}]}));
 const {w,t}=setup(),before=w.serialize();assert.throws(()=>w.act(t,'edit',null),{status:400});assert.deepEqual(w.serialize(),before);
});
for(const action of ['new','import'])test(`${action} of identical content rejects prior trial hashes and both prior role confirmations`,()=>{
 const {w,t,l}=setup();complete(w,l);const old=w.view(l);w.act(t,'confirm',{digest:old.digest});w.act(l,'confirm',{digest:old.digest});assert.equal(w.view(l).tested,true);
 w.act(t,action,{guide:old.guide});if(action==='import')w.act(t,'approve',{});
 const fresh=w.view(l);assert.deepEqual(fresh.trial.completed,{});
 for(const s of old.guide.steps)assert.throws(()=>w.act(l,'complete',{id:s.id,hash:s.hash,result:'إقرار من الجولة السابقة'}),{status:409});
 assert.notEqual(fresh.guide.instanceId,old.guide.instanceId);assert.notEqual(fresh.digest,old.digest);
 complete(w,l);for(const key of [t,l])assert.throws(()=>w.act(key,'confirm',{digest:old.digest}),{status:409});assert.equal(w.view(l).tested,false);
 const current=w.view(l).digest;w.act(t,'confirm',{digest:current});w.act(l,'confirm',{digest:current});assert.equal(w.view(l).tested,true);
});
