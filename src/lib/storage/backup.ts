import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import {embeddedDatabase,verifyMigrations} from './database';
import {openLocalStore,type Marker} from './local';

type Backup={kind:'converge-local-backup';version:1;createdAt:string;marker:Marker;sha256:string;database:string};
const MAX_BACKUP_BYTES=512*1024*1024;
function checksum(saved:Omit<Backup,'sha256'>,bytes:Uint8Array) {
  const m=saved.marker;
  return createHash('sha256').update(JSON.stringify([saved.kind,saved.version,saved.createdAt,m.kind,m.version,m.state,m.instanceId,m.sessionSecret,m.actorSecret])).update(bytes).digest('hex');
}
function validMarker(marker:Marker) {
  return marker?.kind==='converge-demo' && marker.version===1 && marker.state==='ready' && /^[a-f0-9-]{36}$/.test(marker.instanceId) && typeof marker.actorSecret==='string' && marker.actorSecret.length>=48 && typeof marker.sessionSecret==='string' && marker.sessionSecret.length>=48;
}

export async function backupLocal(directory:string,file:string) {
  const marker=await lstat(path.join(directory,'instance.json')).catch(()=>null);
  if(!marker?.isFile()||marker.isSymbolicLink())throw new Error('Choose an existing local demo to back up.');
  const local=await openLocalStore(directory,{backupOnly:true});
  try {
    const bytes=await local.db.dump();
    const body:Omit<Backup,'sha256'>={kind:'converge-local-backup',version:1,createdAt:new Date().toISOString(),marker:local.marker,database:Buffer.from(bytes).toString('base64')};
    const output=JSON.stringify({...body,sha256:checksum(body,bytes)})+'\n';
    if(Buffer.byteLength(output)>MAX_BACKUP_BYTES)throw new Error('This backup exceeds the local restore limit of 512MB. No backup file was written.');
    await writeFile(path.resolve(file),output,{flag:'wx',mode:0o600});
  } finally {await local.close();}
}

export async function restoreLocal(file:string,destination:string) {
  const source=await lstat(file);
  if(!source.isFile()||source.isSymbolicLink()||source.size>MAX_BACKUP_BYTES)throw new Error('Choose an ordinary backup file smaller than 512MB.');
  const saved=JSON.parse(await readFile(file,'utf8')) as Backup;
  if(saved.kind!=='converge-local-backup'||saved.version!==1||!validMarker(saved.marker)||typeof saved.database!=='string'||typeof saved.createdAt!=='string')throw new Error('Unsupported backup.');
  const bytes=Buffer.from(saved.database,'base64');
  if(checksum(saved,bytes)!==saved.sha256)throw new Error('Backup checksum mismatch.');
  const root=path.resolve(destination),info=await lstat(root).catch(()=>null);
  if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw new Error('Restore only into a new empty ordinary folder.');
  if(!info)await mkdir(root,{recursive:true,mode:0o700});
  const release=await lockfile.lock(root,{realpath:true,retries:0,stale:30000,update:10000});
  try {
    if((await readdir(root)).length)throw new Error('Restore only into a new empty ordinary folder.');
    const marker:Marker={...saved.marker,instanceId:randomUUID(),sessionSecret:randomBytes(48).toString('base64url'),state:'initializing'};
    await writeFile(path.join(root,'instance.json'),JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600});
    const db=await embeddedDatabase(path.join(root,'database'),bytes);
    try {
      await verifyMigrations(db);
      const [known]=await db.query<{instance_id:string}>('SELECT instance_id FROM public.converge_instance WHERE id=1');
      if(known?.instance_id!==saved.marker.instanceId)throw new Error('Backup database and identity marker do not match.');
      await db.query('UPDATE public.converge_instance SET instance_id=$1 WHERE id=1',[marker.instanceId]);
    } finally {await db.close();}
    marker.state='ready';
    const temporary=path.join(root,'instance.ready.json');
    await writeFile(temporary,JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600});
    await rename(temporary,path.join(root,'instance.json'));
  } finally {await release();}
}
