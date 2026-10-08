// Import only the current guide; local archive history and confirmations are not sent.
export function guideForImport(input){
 const g=input?.guide??input;
 if(!g||typeof g!=='object'||Array.isArray(g))throw Error('ملف الدليل غير صالح');
 return {title:g.title,skill:g.skill,tools:g.tools,steps:Array.isArray(g.steps)?g.steps.map(s=>({id:s?.id,title:s?.title,instructions:s?.instructions,dependsOn:s?.dependsOn})):g.steps};
}
