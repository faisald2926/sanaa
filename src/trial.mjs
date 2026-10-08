import {validateGuide,versionGuide,descendants,stepHash,hash,text,need} from './guide.mjs';
import {issueCredentials,authenticate} from './auth.mjs';
const emptyTrial=()=>({completed:{},issues:[],confirmations:{},events:[],rounds:0});
export class Workspace {
 constructor(state){this.state=state?structuredClone(state):{credentials:null,guide:null,trial:emptyTrial(),lastImpact:[]};}
 setup(raw){need(!this.state.credentials,'هذه المساحة مهيأة بالفعل',409);const guide=versionGuide(raw),auth=issueCredentials();this.state={credentials:auth.records,invitation:auth.invitation,guide,trial:emptyTrial(),lastImpact:[]};return auth.keys;}
 join(invitation,secret){need(this.state.credentials&&!this.state.credentials.learner,'المتعلّم انضم بالفعل أو المساحة غير مهيأة',409);const invite=this.state.invitation;need(invite&&invite.expiresAt>Date.now()&&typeof invitation==='string'&&hash(invitation)===invite.tokenHash,'الدعوة غير صحيحة أو انتهت صلاحيتها',401);need(typeof secret==='string'&&secret.length>=12&&secret.length<=200&&secret.trim()===secret,'اختر سرًا من ١٢ إلى ٢٠٠ حرف دون مسافات على الأطراف');need(hash(secret)!==this.state.credentials.teacher.tokenHash&&secret!==invitation,'سر المتعلّم يجب أن يكون مستقلًا عن رمز المعلّم والدعوة');this.state.credentials.learner={tokenHash:hash(secret),expiresAt:Date.now()+30*24*60*60*1000};this.state.invitation=null;return {learner:secret};}
 role(token){return authenticate(this.state.credentials,token);}
 digest(){return hash([this.state.guide.revision,this.state.guide.title,this.state.guide.tools,this.state.guide.steps.map(s=>s.hash)]);}
 view(token){const role=this.role(token);const {guide,trial,lastImpact}=this.state;const all=guide.approved&&guide.steps.every(s=>trial.completed[s.id]?.hash===s.hash);const digest=this.digest();return structuredClone({role,guide,trial,lastImpact,digest,learnerJoined:!!this.state.credentials.learner,allCompleted:all,tested:!!(all&&trial.confirmations.teacher===digest&&trial.confirmations.learner===digest)});}
 invalidate(ids){for(const id of ids)delete this.state.trial.completed[id];this.state.trial.confirmations={};this.state.lastImpact=ids;}
 edit(id,patch){
  const g=this.state.guide,old=g.steps.find(s=>s.id===id);need(old,'الخطوة غير موجودة');need(patch&&typeof patch==='object','تعديل غير صالح');
  const p={title:patch.title??old.title,instructions:patch.instructions??old.instructions,dependsOn:patch.dependsOn??old.dependsOn};
  const validated=validateGuide({...g,steps:g.steps.map(s=>s.id===id?{...s,...p}:s)});const next=validated.steps.find(s=>s.id===id);
  if(hash([next.title,next.instructions,next.dependsOn])===hash([old.title,old.instructions,old.dependsOn]))return;
  const affected=[...new Set([...descendants(g.steps,id),...descendants(validated.steps,id)])];
  const rebuilt=[];for(const s of validated.steps){const previous=g.steps.find(v=>v.id===s.id);if(!affected.includes(s.id)){rebuilt.push(previous);continue;}const version=previous.version+1;rebuilt.push({...s,hash:stepHash(s,s.dependsOn.map(id=>rebuilt.find(x=>x.id===id).hash),version),version,history:[...previous.history,{title:previous.title,instructions:previous.instructions,dependsOn:previous.dependsOn,hash:previous.hash,version:previous.version,reason:s.id===id?'content-change':'dependency-context-change',at:new Date().toISOString()}]});}g.steps=rebuilt;g.revision++;this.invalidate(affected);
 }
 act(token,action,payload={}){
  need(payload&&typeof payload==='object'&&!Array.isArray(payload),'بيانات العملية غير صالحة');
  const role=this.role(token),g=this.state.guide,tr=this.state.trial;const teacher=['edit','clarify','import','new','approve'];const learner=['complete','block'];
  need(teacher.includes(action)||learner.includes(action)||action==='confirm','عملية غير معروفة');need(!teacher.includes(action)||role==='teacher','صلاحية المعلّم مطلوبة',403);need(!learner.includes(action)||role==='learner','صلاحية المتعلّم مطلوبة',403);
  if(action==='edit')this.edit(payload.id,payload.patch);
  if(action==='new'||action==='import'){this.state.guide=versionGuide(payload.guide,action==='new');this.state.trial=emptyTrial();this.state.lastImpact=[];}
  if(action==='approve'){g.approved=true;g.revision++;tr.confirmations={};}
  if(action==='complete'||action==='block'){
   need(g.approved,'يجب مراجعة الدليل واعتماده من المعلّم أولًا');const s=g.steps.find(s=>s.id===payload.id);need(s,'الخطوة غير موجودة');need(payload.hash===s.hash,'تغيرت نسخة الخطوة؛ حدّث الصفحة وجرب النسخة الحالية',409);
   need(s.dependsOn.every(id=>tr.completed[id]?.hash===g.steps.find(s=>s.id===id).hash),'أنجز المتطلبات السابقة أولًا',409);
   if(action==='block'){const question=text(payload.question,1000);need(!tr.issues.some(i=>i.stepId===s.id&&i.status==='open'),'يوجد سؤال ينتظر المعلّم');tr.issues.push({id:hash([Date.now(),tr.issues.length]),stepId:s.id,hash:s.hash,question,status:'open',at:new Date().toISOString()});this.invalidate(descendants(g.steps,s.id));}
   else{need(!tr.issues.some(i=>i.stepId===s.id&&i.status==='open'),'انتظر توضيح المعلّم ثم أعد المحاولة',409);const result=text(payload.result,1000);tr.completed[s.id]={hash:s.hash,version:s.version,result,at:new Date().toISOString()};tr.rounds++;tr.confirmations={};}
  }
  if(action==='clarify'){
   const s=g.steps.find(s=>s.id===payload.id);need(s,'الخطوة غير موجودة');const issues=tr.issues.filter(i=>i.stepId===s.id&&i.status==='open');need(issues.length,'لا يوجد سؤال مفتوح');const answer=text(payload.answer,1000);
   this.edit(s.id,{instructions:s.instructions+'\nتوضيح المعلّم: '+answer});for(const i of issues){i.status='resolved';i.answer=answer;i.resolvedAt=new Date().toISOString();}
  }
  if(action==='confirm'){const v=this.view(token);need(v.allCompleted,'لم تنجز جميع الخطوات الحالية',409);need(payload.digest===v.digest,'تأكيد نسخة قديمة مرفوض',409);tr.confirmations[role]=v.digest;}
  this.state.trial.events.push({action,role,stepId:payload.id??null,revision:this.state.guide.revision,at:new Date().toISOString(),affected:action==='edit'||action==='clarify'?[...this.state.lastImpact]:[],...(action==='complete'?{hash:payload.hash,result:payload.result}:{})});
  return this.view(token);
 }
 export(token){this.role(token);return {format:'sanaa-guide-v1',exportedAt:new Date().toISOString(),guide:structuredClone(this.state.guide),trial:structuredClone(this.state.trial),notice:'الإقرارات سجل ذاتي لا يثبت الهوية أو جودة المهارة. الاستيراد يعيدها إلى انتظار المراجعة.'};}
 serialize(){return structuredClone(this.state);}
}
