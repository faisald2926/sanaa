import {cp,mkdir,writeFile,readFile,readdir}from'node:fs/promises';import {fileURLToPath}from'node:url';import {join,relative}from'node:path';import {spawnSync}from'node:child_process';import {createHash}from'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),dist=join(root,'dist');
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(async entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]))).flat();}
const runtime=[join(root,'server.mjs'),...await files(join(root,'src')),...await files(join(root,'public'))];
for(const path of runtime.filter(f=>f.endsWith('.mjs'))){const check=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(check.status!==0)throw Error(check.stderr||'Syntax check failed');}
for(const required of ['public/index.html','public/styles.css','public/assets/fold.svg','public/assets/transfer.svg','public/assets/branches.svg'])await readFile(join(root,required));
await mkdir(dist,{recursive:true});for(const path of ['server.mjs','src','public'])await cp(join(root,path),join(dist,path),{recursive:true});
await writeFile(join(dist,'package.json'),JSON.stringify({name:'sanaa-runtime',private:true,type:'module',engines:{node:'>=22'},scripts:{start:'node server.mjs'}},null,2));
const manifest={builtAt:new Date().toISOString(),runtimeDependencies:0,files:await Promise.all(runtime.map(async path=>({path:relative(root,path).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(path)).digest('hex')})))};
await writeFile(join(dist,'build-manifest.json'),JSON.stringify(manifest,null,2));console.log('Build verified: '+runtime.length+' production files; 0 runtime dependencies. Run: node dist/server.mjs');
