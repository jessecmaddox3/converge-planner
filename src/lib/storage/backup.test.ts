import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {backupLocal,restoreLocal} from './backup';
import {openLocalStore} from './local';
import {accountActor} from '../actor';
import * as database from './database';
import {requireEmptySchema} from './initialize';

let root:string,source:string,backup:string,originalMarker:Awaited<ReturnType<typeof openLocalStore>>['marker'];
beforeAll(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'converge-storage-'));
  source=path.join(root,'source');backup=path.join(root,'saved.json');
  const store=await openLocalStore(source);originalMarker={...store.marker};
  await store.db.query("INSERT INTO trips(id,data,organizer_actor_key,status) VALUES($1,$2,$3,'collecting')",['saved-plan',{name:'Invented observatory plan'},accountActor('demo:quinn',store.marker.actorSecret)]);
  await store.close();await backupLocal(source,backup);
},30000);
afterAll(async()=>{vi.restoreAllMocks();if(root)await rm(root,{recursive:true,force:true});});
it('preserves saved plans and actor ownership through backup, restore and another restart',async()=>{
  const dest=path.join(root,'restored');await restoreLocal(backup,dest);
  const store=await openLocalStore(dest);
  expect(store.marker.actorSecret).toBe(originalMarker.actorSecret);
  expect(store.marker.sessionSecret).not.toBe(originalMarker.sessionSecret);
  expect(store.marker.instanceId).not.toBe(originalMarker.instanceId);
  const rows=await store.db.query<{organizer_actor_key:string}>('SELECT organizer_actor_key FROM trips WHERE id=$1',['saved-plan']);
  expect(rows[0].organizer_actor_key).toBe(accountActor('demo:quinn',store.marker.actorSecret));
  await store.close();const reopened=await openLocalStore(dest);expect((await reopened.db.query('SELECT id FROM trips')).length).toBe(1);await reopened.close();
},30000);
it('checks actor-secret integrity before touching the restore destination',async()=>{
  const value=JSON.parse(await readFile(backup,'utf8'));value.marker.actorSecret=(value.marker.actorSecret[0]==='A'?'B':'A')+value.marker.actorSecret.slice(1);
  const altered=path.join(root,'altered.json');await writeFile(altered,JSON.stringify(value));
  const dest=path.join(root,'bad-restore');await expect(restoreLocal(altered,dest)).rejects.toThrow(/checksum/);
  expect(await readdir(root)).not.toContain('bad-restore');
});
it('refuses another writer while restoring, and keeps the marker incomplete until the database closes',async()=>{
  const actual=database.embeddedDatabase;
  let reached!:()=>void,proceed!:()=>void;
  const closing=new Promise<void>(resolve=>{reached=resolve;}),allowClose=new Promise<void>(resolve=>{proceed=resolve;});
  const spy=vi.spyOn(database,'embeddedDatabase').mockImplementationOnce(async(...args)=>{
    const db=await actual(...args);
    return {...db,async close(){reached();await allowClose;await db.close();}};
  });
  const dest=path.join(root,'locked-restore'),restoring=restoreLocal(backup,dest);
  await closing;
  try {
    expect(JSON.parse(await readFile(path.join(dest,'instance.json'),'utf8')).state).toBe('initializing');
    await expect(openLocalStore(dest)).rejects.toThrow(/already open/);
  }finally{proceed();await restoring;spy.mockRestore();}
  expect(JSON.parse(await readFile(path.join(dest,'instance.json'),'utf8')).state).toBe('ready');
},30000);
it('does not overwrite a backup, restore over existing files, or back up a missing store',async()=>{
  const before=await readFile(backup,'utf8');await expect(backupLocal(source,backup)).rejects.toThrow();expect(await readFile(backup,'utf8')).toBe(before);
  const dest=path.join(root,'occupied');await mkdir(dest);await writeFile(path.join(dest,'keep.txt'),'keep');
  await expect(restoreLocal(backup,dest)).rejects.toThrow(/empty/);expect(await readFile(path.join(dest,'keep.txt'),'utf8')).toBe('keep');
  await expect(backupLocal(path.join(root,'missing'),path.join(root,'missing.json'))).rejects.toThrow(/existing/);
},30000);
it('can preserve an old schema before upgrading without migrating it during backup',async()=>{
  const store=await openLocalStore(source);
  const files=await database.migrationFiles(),last=files.at(-1)!;
  await store.db.query('DELETE FROM converge_migrations WHERE name=$1',[last.name]);await store.close();
  await expect(openLocalStore(source)).rejects.toThrow(/version does not match/);
  await backupLocal(source,path.join(root,'before-upgrade.json'));
  const preserved=await openLocalStore(source,{backupOnly:true});
  expect((await preserved.db.query('SELECT * FROM converge_migrations')).length).toBe(files.length-1);
  await preserved.db.query('INSERT INTO converge_migrations VALUES($1,$2)',[last.name,last.sha256]);await preserved.close();
},30000);
it('refuses incomplete markers, missing databases and nonempty unrelated folders without reseeding',async()=>{
  const incomplete=path.join(root,'incomplete');await mkdir(incomplete);await writeFile(path.join(incomplete,'instance.json'),JSON.stringify({...originalMarker,state:'initializing'}));
  await expect(openLocalStore(incomplete)).rejects.toThrow(/incomplete/);
  const missing=path.join(root,'missing-db');await mkdir(missing);await writeFile(path.join(missing,'instance.json'),JSON.stringify(originalMarker));
  await expect(openLocalStore(missing)).rejects.toThrow(/database is missing/);
  const unrelated=path.join(root,'unrelated');await mkdir(unrelated);await writeFile(path.join(unrelated,'keep.txt'),'keep');
  await expect(openLocalStore(unrelated)).rejects.toThrow(/Unrecognized/);
  expect(await readdir(unrelated)).toEqual(['keep.txt']);
});
it('rejects a routine-only schema before initialization could replace the routine',async()=>{
  const db=await database.embeddedDatabase();
  try {
    await requireEmptySchema(db);
    await db.execute("CREATE FUNCTION public.converge_schema_version() RETURNS text LANGUAGE sql AS $$ SELECT 'untouched'::text $$");
    await expect(requireEmptySchema(db)).rejects.toThrow(/empty public schema/);
    expect(await db.query('SELECT converge_schema_version() AS value')).toEqual([{value:'untouched'}]);
  }finally{await db.close();}
},30000);
