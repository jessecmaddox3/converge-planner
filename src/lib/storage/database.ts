import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export interface Database {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]>;
  execute(sql: string): Promise<void>;
  close(): Promise<void>;
  dump(): Promise<Uint8Array>;
}

function normalize(value: unknown, key = ''): unknown {
  if (value instanceof Date) return key === 'confirmed_date' ? value.toISOString().slice(0, 10) : value.toISOString();
  if (Array.isArray(value)) return value.map(item => normalize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  return value;
}

export async function embeddedDatabase(directory?: string, archive?: Uint8Array): Promise<Database> {
  const client = new PGlite(directory, archive ? { loadDataDir: new Blob([new Uint8Array(archive)]) } : {});
  await client.waitReady;
  return {
    async query<T>(sql: string, values: unknown[] = []) { return normalize((await client.query(sql, values)).rows) as T[]; },
    async execute(sql) { await client.exec(sql); },
    async close() { await client.close(); },
    async dump() { return new Uint8Array(await (await client.dumpDataDir('gzip')).arrayBuffer()); },
  };
}

export async function migrationFiles() {
  const folder = path.resolve('supabase/migrations');
  const names = (await readdir(folder)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async name => {
    const body = await readFile(path.join(folder, name), 'utf8');
    return { name, body, sha256: createHash('sha256').update(body).digest('hex') };
  }));
}

export async function migrate(db: Database, options: {createRoles?: boolean} = {}) {
  if (options.createRoles !== false) await db.execute("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;");
  await db.execute('CREATE TABLE IF NOT EXISTS public.converge_migrations(name text PRIMARY KEY, sha256 text NOT NULL); REVOKE ALL ON public.converge_migrations FROM PUBLIC,anon,authenticated;');
  const rows = await db.query<{name: string; sha256: string}>('SELECT name,sha256 FROM public.converge_migrations ORDER BY name');
  const files = await migrationFiles();
  if (rows.some(row => !files.some(file => file.name === row.name))) throw new Error('This database needs a newer application version.');
  for (const file of files) {
    const prior = rows.find(row => row.name === file.name);
    if (prior) { if (prior.sha256 !== file.sha256) throw new Error('A migration checksum changed: ' + file.name); continue; }
    await db.execute('BEGIN');
    try {
      // These source migrations may carry their own top-level transaction wrappers.
      // The ledger and migration must commit together in our single transaction.
      await db.execute(file.body.replace(/^\s*(?:begin|commit);\s*$/gmi, ''));
      await db.query('INSERT INTO public.converge_migrations(name,sha256) VALUES($1,$2)', [file.name, file.sha256]);
      await db.execute('COMMIT');
    } catch (error) { await db.execute('ROLLBACK'); throw error; }
  }
}

export async function verifyMigrations(db: Database) {
  const rows = await db.query<{name: string; sha256: string}>('SELECT name,sha256 FROM public.converge_migrations ORDER BY name');
  const files = await migrationFiles();
  if (rows.length !== files.length || rows.some((row, i) => row.name !== files[i].name || row.sha256 !== files[i].sha256)) throw new Error('Database version does not match this release. Back up and run the owner migration command; startup will not change it.');
}
