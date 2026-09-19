import type {Database} from './database';

/** Namespace dependencies include routines, types, relations, operators and
 * extensions, even when a schema has no tables. Never adopt their names. */
export async function requireEmptySchema(db:Database) {
  const objects=await db.query("SELECT pg_describe_object(classid,objid,objsubid) AS object FROM pg_depend WHERE refclassid='pg_namespace'::regclass AND refobjid='public'::regnamespace LIMIT 1");
  if(objects.length)throw new Error('Initialization requires an empty public schema. Existing schema objects will not be adopted or replaced.');
}
