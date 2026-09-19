-- Only the installation owner writes this ledger. Service startup can compare it
-- with the exact release, without silently upgrading a running shared database.
create table if not exists public.converge_migrations(name text primary key,sha256 text not null);
alter table public.converge_migrations enable row level security;
revoke all on public.converge_migrations from public,anon,authenticated;
grant select on public.converge_migrations to service_role;
create or replace function public.converge_schema_version()
returns table(name text,sha256 text)
language sql security invoker set search_path=pg_catalog as $$
  select m.name,m.sha256 from public.converge_migrations m order by m.name;
$$;
revoke all on function public.converge_schema_version() from public,anon,authenticated;
grant execute on function public.converge_schema_version() to service_role;
