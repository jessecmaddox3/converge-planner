import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env,CONVERGE_MODE:'demo',NEXT_TELEMETRY_DISABLED:'1'};
const port=Number(env.PORT??5075);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be a whole number from 1024 to 65535.');
env.PORT=String(port);env.CONVERGE_ORIGIN=`http://127.0.0.1:${port}`;
const npm=process.platform==='win32'?'npm.cmd':'npm';
async function run(args){
 await new Promise((resolve,reject)=>{
  const child=spawn(npm,args,{cwd:root,env,stdio:'inherit',shell:process.platform==='win32'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`npm ${args[0]} did not finish. Check the message above, then reopen Start.`)));
 });
}
async function fingerprint(){
 const hash=createHash('sha256');
 async function visit(relative){
  const absolute=path.join(root,relative),info=await lstat(absolute);
  if(info.isSymbolicLink())throw new Error('Launcher source must use ordinary files, not symbolic links.');
  if(info.isDirectory()){for(const name of (await readdir(absolute)).sort())await visit(path.join(relative,name));}
  else {hash.update(relative.replaceAll(path.sep,'/'));hash.update(await readFile(absolute));}
 }
 for(const relative of ['src','public','supabase','scripts','package.json','package-lock.json','next.config.js','tsconfig.json'])await visit(relative);
 return hash.digest('hex');
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('Install the current LTS version of Node.js from https://nodejs.org/, then reopen Start.');
 console.log('Converge\nPlan an invented trip with Quinn, Reed and Morgan. Every starter record is fictional.\nThe first start downloads the project dependencies and builds the app. Later starts reuse them.');
 const lock=createHash('sha256').update(await readFile(path.join(root,'package-lock.json'))).digest('hex');
 const installedFile=path.join(root,'node_modules','.converge-lock');
 if(await readFile(installedFile,'utf8').catch(()=>null)!==lock){await run(['ci']);await writeFile(installedFile,lock);}
 const source=await fingerprint(),buildFile=path.join(root,'.next','converge-source');
 if(await readFile(buildFile,'utf8').catch(()=>null)!==source){await run(['run','build']);await writeFile(buildFile,source);}
 const child=spawn(process.execPath,['--import','tsx','scripts/serve.ts','--demo'],{cwd:root,env,stdio:['inherit','inherit','inherit','ipc']});
 let exited=false,started=false;
 child.on('message',message=>{if(message?.kind==='converge-ready'&&message.origin===env.CONVERGE_ORIGIN)started=true;});
 child.once('error',error=>{console.error(error.message);process.exitCode=1;exited=true;});
 child.once('exit',code=>{exited=true;process.exitCode=code??0;});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
 const ready=()=>new Promise(resolve=>{
  const request=http.get(env.CONVERGE_ORIGIN+'/demo',response=>{response.resume();resolve(response.statusCode===200);});
  request.setTimeout(1500,()=>{request.destroy();resolve(false);});request.once('error',()=>resolve(false));
 });
 for(let attempt=0;attempt<90&&!exited;attempt++){
  if(started&&await ready()){
   console.log(`Open ${env.CONVERGE_ORIGIN}\nKeep this window open while planning. Press Control+C to stop it safely.`);
   if(env.CONVERGE_LAUNCH_NO_OPEN!=='1'){
    const [command,args]=process.platform==='darwin'?['open',[env.CONVERGE_ORIGIN]]:process.platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',env.CONVERGE_ORIGIN]]:['xdg-open',[env.CONVERGE_ORIGIN]];
    const browser=spawn(command,args,{stdio:'ignore'});browser.on('error',()=>console.log('Paste the address above into your browser.'));browser.unref();
   }
   return;
  }
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!exited){child.kill('SIGTERM');throw new Error('The local server did not become ready. Check the message above.');}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Converge could not start.');process.exitCode=1;});
