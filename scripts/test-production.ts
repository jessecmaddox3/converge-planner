import assert from 'node:assert/strict';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {encode} from 'next-auth/jwt';
import {postgresDatabase} from '../src/lib/storage/postgres';
import {requireEmptySchema} from '../src/lib/storage/initialize';
import {migrate} from '../src/lib/storage/database';
import {accountActor} from '../src/lib/actor';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function unusedPort(){const server=net.createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
async function stop(child:ChildProcess|undefined){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(10000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function main(){
  const connection=process.env.CONVERGE_TEST_DATABASE_URL;
  if(!connection)throw new Error('Set CONVERGE_TEST_DATABASE_URL to a NEW EMPTY loopback PostgreSQL 17 database named converge_contract_*.');
  const url=new URL(connection);
  assert(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.startsWith('/converge_contract_'),'Disposable local test database only');
  const binary=process.env.CONVERGE_TEST_POSTGREST || 'postgrest';
  const version=spawnSync(binary,['--version'],{encoding:'utf8'});assert.equal(version.status,0,'Install official PostgREST 16.3 and set CONVERGE_TEST_POSTGREST if needed.');assert.match(version.stdout,/16\.3/);
  const directory=await mkdtemp(path.join(os.tmpdir(),'converge-api-test-'));
  const database=await postgresDatabase(connection);
  let rest:ChildProcess|undefined,app:ChildProcess|undefined,proxy:https.Server|undefined;
  const appLog:string[]=[],restLog:string[]=[];
  try{
    await requireEmptySchema(database);
    assert.match((await database.query<{server_version:string}>('SHOW server_version'))[0]?.server_version as string,/^17\./);
    await migrate(database);
    const restPort=await unusedPort(),proxyPort=await unusedPort(),appPort=await unusedPort();
    const jwtSecret=randomBytes(48).toString('base64url'),sessionSecret=randomBytes(48).toString('base64url'),actorSecret=randomBytes(48).toString('base64url');
    const jwt=(role:string)=>{const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const data=header+'.'+payload;return data+'.'+createHmac('sha256',jwtSecret).update(data).digest('base64url');}
    const serviceKey=jwt('service_role');
    rest=spawn(binary,[],{env:{...process.env,PGRST_DB_URI:connection,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:jwtSecret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(restPort)},stdio:['ignore','pipe','pipe']});
    rest.stdout?.on('data',value=>restLog.push(value.toString()));rest.stderr?.on('data',value=>restLog.push(value.toString()));
    for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${restPort}/`,{headers:{Authorization:'Bearer '+serviceKey}});if(r.ok)break;}catch{}if(i===79)throw new Error('PostgREST did not become ready');await delay(100);}
    const key=path.join(directory,'localhost.key'),cert=path.join(directory,'localhost.crt');
    const openssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'pipe'});assert.equal(openssl.status,0,'OpenSSL certificate generation failed');
    proxy=https.createServer({key:await readFile(key),cert:await readFile(cert)},(request,response)=>{
      if(!request.url?.startsWith('/rest/v1/')){response.writeHead(404);response.end();return;}
      const outgoing=http.request({hostname:'127.0.0.1',port:restPort,path:request.url.slice('/rest/v1'.length),method:request.method,headers:request.headers},incoming=>{response.writeHead(incoming.statusCode||500,incoming.headers);incoming.pipe(response);});
      outgoing.on('error',()=>{response.writeHead(502);response.end();});request.pipe(outgoing);
    });
    await new Promise<void>(resolve=>proxy!.listen(proxyPort,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${appPort}`;
    const env={...process.env,CONVERGE_MODE:'production',CONVERGE_ORIGIN:origin,NEXTAUTH_URL:origin,PORT:String(appPort),CONVERGE_NAMESPACE:'hosted-fiction.invalid',CONVERGE_OPERATOR:'Fictional test operator',CONVERGE_CONTACT:'operator@example.invalid',NEXTAUTH_SECRET:sessionSecret,ACTOR_KEY_SECRET:actorSecret,CRON_SECRET:randomBytes(48).toString('hex'),GOOGLE_CLIENT_ID:'fictional-client',GOOGLE_CLIENT_SECRET:'fictional-secret',SUPABASE_URL:`https://127.0.0.1:${proxyPort}`,SUPABASE_SERVICE_ROLE_KEY:serviceKey,NODE_EXTRA_CA_CERTS:cert,NEXT_TELEMETRY_DISABLED:'1',CONVERGE_ENABLE_AI:'no',SMTP_HOST:'',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',DATABASE_URL:''};
    const start=async()=>{
      app=spawn(process.execPath,['--import','tsx','scripts/serve.ts'],{env,stdio:['ignore','pipe','pipe','ipc']});
      app.stdout?.on('data',v=>appLog.push(v.toString()));app.stderr?.on('data',v=>appLog.push(v.toString()));
      await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Hosted startup timeout')),20000);app!.on('message',(value:any)=>{if(value?.kind==='converge-ready'){clearTimeout(timeout);resolve();}});app!.once('exit',()=>{clearTimeout(timeout);reject(new Error('Hosted server exited before readiness'));});});
    }
    await start();
    const identity=async(id:string)=>{return {actor:accountActor(id,actorSecret),cookie:'next-auth.session-token='+await encode({secret:sessionSecret,token:{sub:id,providerAccountId:id,name:'Invented '+id,email:id+'@example.invalid',expiresAt:Date.now()+3600000,accessToken:'fictional-token'},maxAge:3600})};}
    const organizer=await identity('organizer'),reader=await identity('reader');
    const api=async(endpoint:string,actor=organizer,method='GET',body?:unknown,headers:Record<string,string>={})=>{
      const response=await fetch(origin+endpoint,{method,headers:{Origin:origin,Cookie:actor.cookie,'X-Converge-Actor':actor.actor,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json()};
    }
    const draft={name:'Fictional hosted planning workshop',startDate:'2037-01-01',endDate:'2037-01-31',duration:3,durationPreset:'weekend',selectedDates:['2037-01-09','2037-01-16'],timeZone:'UTC',notes:'Invented records only'};
    const created=await api('/api/trips',organizer,'POST',draft);assert.equal(created.status,200);const id=created.data.id;assert.equal(typeof id,'string');
    assert.equal((await api('/api/trips',reader,'POST',draft,{'X-Converge-Actor':organizer.actor})).status,409);
    assert.equal((await api('/api/trips/'+id+'/manage',reader)).status,403);
    const answers={name:'Invented Reader',email:'spoof@example.invalid',answerVersion:2,answers:{'2037-01-09':'available','2037-01-16':'maybe'},selectedDates:['2037-01-09'],preferences:{'2037-01-09':'preferred'}};
    assert.equal((await api(`/api/trips/${id}/availability`,organizer,'PUT',answers)).status,403);
    const saved=await api(`/api/trips/${id}/availability`,reader,'PUT',answers);assert.equal(saved.status,200);assert.equal(saved.data.response.email,'reader@example.invalid');
    const before=saved.data.response;
    assert.equal((await api(`/api/trips/${id}/availability`,reader,'PUT',answers,{'X-Converge-Actor':'anonymous',Authorization:'Capability '+randomBytes(32).toString('base64url')})).status,409);
    assert.deepEqual((await api(`/api/trips/${id}/me`,reader)).data.response,before);
    assert.equal((await api('/api/calendars',reader,'GET',undefined,{'X-Converge-Actor':organizer.actor})).status,409);
    const managed=await api(`/api/trips/${id}/manage`);assert.equal(managed.status,200);assert.equal(managed.data.responses.length,1);
    const publicTrip=await (await fetch(origin+`/api/trips/${id}`)).json();assert(!JSON.stringify(publicTrip).includes('@example.invalid'));assert(!JSON.stringify(publicTrip).includes(reader.actor));
    const planning={revision:0,requiredResponseIds:[saved.data.response.publicId],expectedPeople:[{id:'unmatched',name:'Private expected person',required:false}],invitationsClosed:true};
    assert.equal((await api(`/api/trips/${id}/planning`,organizer,'PUT',planning)).status,200);
    const decisions=await Promise.all([api(`/api/trips/${id}/confirmation`,organizer,'PUT',{confirmedDate:'2037-01-09'}),api(`/api/trips/${id}/confirmation`,organizer,'PUT',{confirmedDate:'2037-01-09'})]);
    for(const result of decisions){assert.equal(result.status,200);assert.equal(result.data.confirmationVersion,1);}
    assert.equal((await database.query<{count:number}>('SELECT count(*)::integer AS count FROM trip_confirmation_deliveries WHERE trip_id=$1',[id]))[0].count,1);
    assert.equal((await api(`/api/trips/${id}/reopen`,organizer,'POST',{})).status,200);
    const reopened=(await api(`/api/trips/${id}/manage`)).data;assert.equal(reopened.planning.invitationsClosed,false);assert.equal(reopened.planning.revision,2);assert.equal(reopened.confirmationVersion,1);
    await stop(app);await start();assert.equal((await api(`/api/trips/${id}/manage`)).data.name,draft.name);
    assert.equal((await fetch(origin+'/api/demo/identity')).status,404);
    for(const role of ['anon','authenticated']){
      const denied=await fetch(`http://127.0.0.1:${restPort}/trips`,{headers:{Authorization:'Bearer '+jwt(role)}});assert([401,403].includes(denied.status));
      const deniedRpc=await fetch(`http://127.0.0.1:${restPort}/rpc/converge_schema_version`,{method:'POST',headers:{Authorization:'Bearer '+jwt(role),'Content-Type':'application/json'},body:'{}'});assert([401,403,404].includes(deniedRpc.status));
    }
    const report={postgres:17,postgrest:version.stdout.trim(),tls:'verified local certificate with explicit test CA',checks:['actual Supabase client via HTTPS/PostgREST','production startup schema verification','signed hosted sessions and stale-actor rejection','cross-owner and self-response rejection','account email authority and public projection','SQL close/confirm concurrent idempotency/reopen','durable server restart','demo identity endpoint absent','anonymous/authenticated direct database API denied']};
    await writeFile('artifacts/production-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }catch(error){console.error(appLog.join(''));console.error(restLog.slice(-10).join(''));throw error;}
  finally{await stop(app);if(proxy){proxy.closeAllConnections();await new Promise<void>(resolve=>proxy!.close(()=>resolve()));}await stop(rest);await database.close();await rm(directory,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
