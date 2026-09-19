import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database';
import { rpcSpecs, type RpcName } from './rpc';

type Row = Record<string, unknown>;
// RPC payloads remain untrusted at this boundary. Existing store parsers validate
// each result before it becomes a domain object or a public response.
export type Result<T = any> = { data: T | null; error: { message: string } | null };
export interface Storage {
  tripRow(id: string): Promise<Result<Row>>;
  responseRows(id: string): Promise<Result<Row[]>>;
  insertTrip(row: Row): Promise<Result>;
  claimUnownedTrip(id: string, actor: string, email: string, updatedAt: string): Promise<Result<Row>>;
  ownedTripRows(actor: string): Promise<Result<Row[]>>;
  responseTripIds(actor: string): Promise<Result<Row[]>>;
  tripRowsByIds(ids: string[]): Promise<Result<Row[]>>;
  deliveryStates(id: string, version: number): Promise<Result<{status: string; attempt_count: number}[]>>;
  rpc(name: RpcName, args?: Record<string, unknown>): Promise<Result>;
}
const columns = 'id,data,status,organizer_actor_key,organizer_email_normalized,confirmed_date,confirmed_at,confirmation_version,created_at';

export function supabaseStorage(client: SupabaseClient): Storage {
  return {
    async tripRow(id) { return await client.from('trips').select(columns).eq('id', id).maybeSingle(); },
    async responseRows(id) { return await client.from('trip_responses').select('person_key,data,public_id,submitted_at,updated_at').eq('trip_id', id); },
    async insertTrip(row) { return await client.from('trips').insert(row); },
    async claimUnownedTrip(id, actor, email, updatedAt) { return await client.from('trips').update({organizer_actor_key: actor, updated_at: updatedAt}).eq('id', id).is('organizer_actor_key', null).eq('organizer_email_normalized', email).select('organizer_actor_key').maybeSingle(); },
    async ownedTripRows(actor) { return await client.from('trips').select(columns).eq('organizer_actor_key', actor); },
    async responseTripIds(actor) { return await client.from('trip_responses').select('trip_id').eq('person_key', actor); },
    async tripRowsByIds(ids) { return ids.length ? await client.from('trips').select(columns).in('id', ids) : {data: [], error: null}; },
    async deliveryStates(id, version) { return await client.from('trip_confirmation_deliveries').select('status,attempt_count').eq('trip_id', id).eq('confirmation_version', version); },
    async rpc(name, args) { return args === undefined ? await client.rpc(name) : await client.rpc(name, args); },
  };
}

export function sqlStorage(database: () => Promise<Database>): Storage {
  async function run<T>(query: string, values: unknown[] = [], single = false): Promise<Result<T>> {
    try {
      const rows = await (await database()).query(query, values);
      return {data: (single ? rows[0] || null : rows) as T, error: null};
    } catch (error) {
      // Keep stable SQL business markers without leaking query contents or inputs.
      const message = error instanceof Error ? error.message : '';
      const marker = ['ANSWER_VERSION_REQUIRED', 'INVITATIONS_CLOSED', 'ORGANIZER_RESPONSE_FORBIDDEN', 'INVALID_ANSWERS', 'INVALID_ANSWER_PROJECTION', 'INVALID_FAVORITE'].find(code => message.includes(code));
      return {data: null, error: {message: marker || 'Storage operation failed'}};
    }
  }
  return {
    tripRow: id => run(`SELECT ${columns} FROM public.trips WHERE id=$1`, [id], true),
    responseRows: id => run('SELECT person_key,data,public_id,submitted_at,updated_at FROM public.trip_responses WHERE trip_id=$1', [id]),
    insertTrip: row => run('INSERT INTO public.trips(id,data,status,organizer_actor_key,organizer_email_normalized,confirmed_date,confirmed_at,confirmation_version,updated_at) VALUES($1,$2::jsonb,$3,$4,$5,$6::date,$7::timestamptz,$8::integer,$9::timestamptz)', [row.id, JSON.stringify(row.data), row.status, row.organizer_actor_key, row.organizer_email_normalized, row.confirmed_date, row.confirmed_at, row.confirmation_version, row.updated_at]),
    claimUnownedTrip: (id, actor, email, updatedAt) => run('UPDATE public.trips SET organizer_actor_key=$2,updated_at=$4::timestamptz WHERE id=$1 AND organizer_actor_key IS NULL AND organizer_email_normalized=$3 RETURNING organizer_actor_key', [id, actor, email, updatedAt], true),
    ownedTripRows: actor => run(`SELECT ${columns} FROM public.trips WHERE organizer_actor_key=$1`, [actor]),
    responseTripIds: actor => run('SELECT trip_id FROM public.trip_responses WHERE person_key=$1', [actor]),
    tripRowsByIds: ids => ids.length ? run(`SELECT ${columns} FROM public.trips WHERE id=ANY($1::text[])`, [ids]) : Promise.resolve({data: [], error: null}),
    deliveryStates: (id, version) => run('SELECT status,attempt_count FROM public.trip_confirmation_deliveries WHERE trip_id=$1 AND confirmation_version=$2::integer', [id, version]),
    async rpc(name, args = {}) {
      if (!Object.hasOwn(rpcSpecs, name)) throw new Error('Unknown storage operation');
      const spec = rpcSpecs[name];
      const values = spec.params.map(([key, type]) => type === 'jsonb' ? JSON.stringify(args[key] ?? null) : args[key] ?? null);
      const parameters = spec.params.map(([, type], index) => `$${index + 1}::${type}`).join(',');
      const result = await run<any>(spec.scalar ? `SELECT public.${name}(${parameters}) AS value` : `SELECT * FROM public.${name}(${parameters})`, values);
      return spec.scalar && !result.error ? {data: result.data?.[0]?.value ?? null, error: null} : result;
    },
  };
}
