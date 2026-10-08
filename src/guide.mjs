import {createHash} from 'node:crypto';
export function need(ok,message,status=400){if(!ok){const e=new Error(message);e.status=status;throw e;}}
export function text(value,max=2000){need(typeof value==='string'&&value.trim().length>0&&value.length<=max,'نص مطلوب أو تجاوز الحد المسموح');return value.trim();}
export function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function stepHash(s,dependencyHashes=[],version=s.version||1){return hash([s.id,s.title,s.instructions,s.dependsOn,version,dependencyHashes]);}
export function validateGuide(raw){
 need(raw&&typeof raw==='object','دليل غير صالح');const title=text(raw.title,120),skill=text(raw.skill,500);
 need(Array.isArray(raw.tools)&&raw.tools.length<=20,'الأدوات يجب أن تكون قائمة حتى ٢٠ أداة');const tools=raw.tools.map(v=>text(v,120));
 need(Array.isArray(raw.steps)&&raw.steps.length>0&&raw.steps.length<=12,'الدليل يحتاج من خطوة إلى ١٢ خطوة');
 const steps=raw.steps.map(s=>{need(s&&typeof s.id==='string'&&/^[a-zA-Z0-9_-]{1,30}$/.test(s.id)&&!['__proto__','constructor','prototype'].includes(s.id),'معرّف خطوة غير صالح');need(Array.isArray(s.dependsOn)&&s.dependsOn.length<=12,'متطلبات غير صالحة');return {id:s.id,title:text(s.title,120),instructions:text(s.instructions),dependsOn:[...new Set(s.dependsOn)].sort()};});
 const ids=new Set(steps.map(s=>s.id));need(ids.size===steps.length,'معرّفات الخطوات مكررة');
 for(const s of steps)for(const d of s.dependsOn)need(ids.has(d),'مرجع متطلب غير موجود');
 const sorted=[],visited=new Set(),visiting=new Set();function visit(s){need(!visiting.has(s.id),'الخطوات تحتوي اعتمادًا دائريًا');if(visited.has(s.id))return;visiting.add(s.id);for(const d of s.dependsOn)visit(steps.find(v=>v.id===d));visiting.delete(s.id);visited.add(s.id);sorted.push(s);}
 steps.forEach(visit);return {title,skill,tools,steps:sorted};
}
export function descendants(steps,id){const set=new Set([id]);let changed=true;while(changed){changed=false;for(const s of steps)if(!set.has(s.id)&&s.dependsOn.some(d=>set.has(d))){set.add(s.id);changed=true;}}return [...set];}
export function versionGuide(raw,approved=true){const g=validateGuide(raw),steps=[];for(const s of g.steps)steps.push({...s,hash:stepHash(s,s.dependsOn.map(id=>steps.find(x=>x.id===id).hash),1),version:1,history:[]});return {...g,approved,revision:1,steps};}
export function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

