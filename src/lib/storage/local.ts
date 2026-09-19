import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { embeddedDatabase, migrate, verifyMigrations, type Database } from './database';

export type Marker = {kind: 'converge-demo'; version: 1; state: 'initializing' | 'ready'; instanceId: string; sessionSecret: string; actorSecret: string};
export type LocalStore = {db: Database; marker: Marker; directory: string; close(): Promise<void>};

export async function openLocalStore(directory: string, options: {migrate?: boolean; backupOnly?: boolean} = {}): Promise<LocalStore> {
  const root = path.resolve(directory);
  await mkdir(root, {recursive: true, mode: 0o700});
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Choose an ordinary local folder for demo data.');
  let release: () => Promise<void>;
  try { release = await lockfile.lock(root, {realpath: true, retries: 0, stale: 30000, update: 10000}); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new Error('This demo is already open. Stop its other terminal first. After a forced crash, wait 30 seconds before retrying.');
    throw error;
  }
  let db: Database | undefined;
  try {
    const markerPath = path.join(root, 'instance.json');
    const children = await readdir(root);
    let marker: Marker;
    if (!children.length) {
      if (options.backupOnly) throw new Error("Backup cannot create a missing instance.");
      marker = {kind: 'converge-demo', version: 1, state: 'initializing', instanceId: randomUUID(), sessionSecret: randomBytes(48).toString('base64url'), actorSecret: randomBytes(48).toString('base64url')};
      await writeFile(markerPath, JSON.stringify(marker) + '\n', {flag: 'wx', mode: 0o600});
    } else {
      const markerInfo = await lstat(markerPath).catch(() => null);
      if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) throw new Error('Unrecognized nonempty data folder. Existing files will not be replaced.');
      marker = JSON.parse(await readFile(markerPath, 'utf8'));
      if (marker.kind !== 'converge-demo' || marker.version !== 1 || marker.state !== 'ready' || !/^[a-f0-9-]{36}$/.test(marker.instanceId) || typeof marker.sessionSecret !== 'string' || marker.sessionSecret.length < 48 || typeof marker.actorSecret !== 'string' || marker.actorSecret.length < 48) throw new Error('The saved instance is incomplete, corrupt, or incompatible. Preserve it and restore a backup; startup will not reset it.');
    }
    const databasePath = path.join(root, 'database');
    const databaseInfo = await lstat(databasePath).catch(() => null);
    if (databaseInfo?.isSymbolicLink() || (databaseInfo && !databaseInfo.isDirectory())) throw new Error('The database must be an ordinary directory inside its demo folder.');
    if (marker.state === 'ready' && (!databaseInfo || !(await readdir(databasePath)).length)) throw new Error('The saved database is missing. Restore a matching backup; it will not be reseeded.');
    db = await embeddedDatabase(databasePath);
    if (marker.state === 'initializing') {
      await migrate(db);
      await db.execute('CREATE TABLE public.converge_instance(id integer PRIMARY KEY CHECK(id=1),instance_id text NOT NULL,seed_version integer NOT NULL DEFAULT 0,seed_data jsonb NOT NULL DEFAULT \'{}\'); REVOKE ALL ON public.converge_instance FROM PUBLIC,anon,authenticated;');
      await db.execute('CREATE TABLE public.converge_preview_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,confirmation_version integer NOT NULL,response_public_id uuid NOT NULL,lease_token uuid NOT NULL UNIQUE,message jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON public.converge_preview_outbox FROM PUBLIC,anon,authenticated;');
      await db.query('INSERT INTO public.converge_instance(id,instance_id) VALUES(1,$1)', [marker.instanceId]);
      marker.state = 'ready';
      const temporary = path.join(root, 'instance.ready.json');
      await writeFile(temporary, JSON.stringify(marker) + '\n', {flag: 'wx', mode: 0o600});
      await rename(temporary, markerPath);
    } else {
      const [instance] = await db.query<{instance_id: string}>('SELECT instance_id FROM public.converge_instance WHERE id=1');
      if (instance?.instance_id !== marker.instanceId) throw new Error('This database does not belong to the saved instance marker. Restore a matching backup.');
      if (options.migrate) await migrate(db);
      else if (!options.backupOnly) await verifyMigrations(db);
    }
    const database = db;
    let closed = false;
    return {db: database, marker, directory: root, async close() {if (closed) return; closed = true; try {await database.close();} finally {await release();}}};
  } catch (error) {try {if (db) await db.close();} finally {await release();} throw error;}
}
