import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import type {Database} from './database';

/** Owner CLI only. Hosted app requests still use the narrow Supabase adapter. */
export async function postgresDatabase(connection: string): Promise<Database> {
  const url=new URL(connection);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname)throw new Error('DATABASE_URL must have an explicit PostgreSQL host.');
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const ca=process.env.CONVERGE_DATABASE_CA_CERT;
  const client=postgres(connection,{max:1,connect_timeout:10,onnotice:()=>{},
    ...(local?{}:{ssl:{rejectUnauthorized:true,...(ca?{ca:await readFile(ca,'utf8')}:{})}}),
    types:{json:{to:114,from:[114,3802],serialize:(value:unknown)=>typeof value==='string'?value:JSON.stringify(value),parse:JSON.parse}},
  });
  return {
    async query<T>(sql:string,values:unknown[]=[]){return await client.unsafe(sql,values as never[]) as unknown as T[];},
    async execute(sql){await client.unsafe(sql).simple();},
    async close(){await client.end();},
    async dump(){throw new Error('Use PostgreSQL native backups for a hosted installation.');},
  };
}
