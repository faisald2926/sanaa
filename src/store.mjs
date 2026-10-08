import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';import {dirname} from 'node:path';
export async function load(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
export function createStore(file){let queue=Promise.resolve();return state=>{const snapshot=JSON.stringify(state,null,2),write=async()=>{await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',snapshot,{mode:0o600});await rename(file+'.tmp',file);};const result=queue.then(write,write);queue=result.catch(()=>{});return result;};}
