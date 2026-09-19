import {createServer} from 'node:http';
import {loadEnvConfig} from '@next/env';
import next from 'next';
import {runtimeConfig} from '../src/lib/runtime/config';
import {closeLocalStore, getStorage, localStore} from '../src/lib/storage';
import {migrationFiles} from '../src/lib/storage/database';
import {seedDemo} from '../src/lib/demo/seed';
import {runNotificationWorker} from '../src/lib/notification-worker';

async function main(){
  if(process.argv.includes('--demo'))process.env.CONVERGE_MODE='demo';
  if(process.env.CONVERGE_MODE!=='demo')loadEnvConfig(process.cwd());
  process.env.NEXT_TELEMETRY_DISABLED='1';
  const config=runtimeConfig(),origin=new URL(config.origin);
  const hostname=config.mode==='demo'?origin.hostname.replace(/^\[|\]$/g,''):process.env.CONVERGE_BIND_ADDRESS||'127.0.0.1';
  if(config.mode==='demo'){
    await localStore();
    await seedDemo();
  }else{
    // Every configured host must have the required durable storage before serving.
    // The owner setup command applies the schema; startup only checks it.
    const storage=getStorage()!;
    const check=await storage.rpc('converge_schema_version'),files=await migrationFiles();
    if(check.error||!Array.isArray(check.data)||check.data.length!==files.length||files.some((file,index)=>check.data[index]?.name!==file.name||check.data[index]?.sha256!==file.sha256))throw new Error('Production storage is unavailable or missing the required schema. Run the documented setup before starting.');
  }
  const app=next({dev:process.argv.includes('--dev'),hostname,port:config.port});
  await app.prepare();
  const handler=app.getRequestHandler();
  const server=createServer((request,response)=>{
    if(request.headers.host!==origin.host){response.writeHead(403);response.end('Open the configured installation address.');return;}
    const unsafe=!['GET','HEAD','OPTIONS'].includes(request.method||'GET');
    if(unsafe&&!request.url?.startsWith('/api/auth/')){
      const site=request.headers['sec-fetch-site'];
      if(request.headers.origin!==config.origin||(site&&site!=='same-origin'&&site!=='none')){response.writeHead(403);response.end('Changes must come from this installation.');return;}
    }
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','same-origin');
    response.setHeader('X-Frame-Options','DENY');
    handler(request,response).catch(()=>{if(!response.headersSent)response.writeHead(500);response.end('The page could not be loaded.');});
  });
  let sweepRunning=false;
  const timer=config.mode==='demo'?setInterval(()=>{
    if(sweepRunning)return;sweepRunning=true;
    void (async()=>{const cleanup=await getStorage()!.rpc('cleanup_converge_storage');if(cleanup.error)console.error('Local cleanup could not finish; it will retry later.');await runNotificationWorker();})().catch(()=>console.error('Local maintenance could not finish; saved jobs remain recoverable.')).finally(()=>{sweepRunning=false;});
  },60000):undefined;
  timer?.unref();
  let stopping=false;
  async function stop(){
    if(stopping)return;stopping=true;if(timer)clearInterval(timer);
    await new Promise<void>(resolve=>{server.close(()=>resolve());const timeout=setTimeout(()=>{server.closeAllConnections();resolve();},5000);timeout.unref();});
    await app.close();await closeLocalStore();
  }
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().then(()=>process.exit(0),()=>process.exit(1));});
  server.once('error',error=>{console.error(error.message);void stop().then(()=>{process.exitCode=1;});});
  server.listen(config.port,hostname,()=>{console.log(`Converge: ${config.origin}\n${config.mode==='demo'?'Local fictional demo. Nothing is emailed.':'Authenticated hosted installation.'}\nPress Control+C to close safely.`);process.send?.({kind:'converge-ready',origin:config.origin});});
}
void main().catch(async error=>{console.error(error instanceof Error?error.message:'Could not start Converge.');await closeLocalStore().catch(()=>{});process.exitCode=1;});
