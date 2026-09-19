import {requireEmptySchema} from '../src/lib/storage/initialize';
import {loadEnvConfig} from '@next/env';
import {migrate,verifyMigrations} from '../src/lib/storage/database';
import {postgresDatabase} from '../src/lib/storage/postgres';

async function main(){
  loadEnvConfig(process.cwd());
  const command=process.argv[2];
  if(!['init','migrate','status'].includes(command||''))throw new Error('Usage: npm run setup -- init|migrate|status. Use a new empty Supabase database for init.');
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL for your own PostgreSQL database. No host is selected automatically.');
  const db=await postgresDatabase(process.env.DATABASE_URL);
  try{
    if(command==='init'){
      await requireEmptySchema(db);
      await migrate(db,{createRoles:false});
    }else if(command==='migrate'){
      const [known]=await db.query<{ledger:string|null}>("SELECT to_regclass('public.converge_migrations')::text AS ledger");
      if(!known.ledger)throw new Error('Unrecognized database. Use init for a new empty database; do not migrate an unrelated schema.');
      await migrate(db,{createRoles:false});
    }
    await verifyMigrations(db);
    const roles=await db.query<{table_name:string;can_read:boolean}>("SELECT c.table_name,has_table_privilege('anon','public.'||c.table_name,'SELECT') OR has_table_privilege('authenticated','public.'||c.table_name,'SELECT') AS can_read FROM information_schema.tables c WHERE c.table_schema='public'");
    if(roles.some(r=>r.can_read))throw new Error('Browser database roles have unexpected read permissions. Review the installation grants before starting.');
    console.log('Converge database is ready. Schema checksums match; browser roles cannot read application tables. No trip records, provider credentials or addresses were printed.');
  }finally{await db.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Database setup failed');process.exitCode=1;});
