-- Actor-scoped keys are constructed server-side. Raw scan data expires quickly;
-- history results use a separate versioned namespace and contain only clusters.
begin;
create table if not exists public.cached_jobs (
  key text primary key,
  lease_token uuid,
  lease_expires_at timestamptz,
  value jsonb,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.cached_jobs enable row level security;
revoke all on public.cached_jobs from public, anon, authenticated;
grant all on public.cached_jobs to service_role;
create index if not exists cached_jobs_expiry on public.cached_jobs(updated_at);

create or replace function public.claim_cached_job(p_key text, p_lease_seconds integer, p_force boolean default false)
returns table(state text, value jsonb, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare job public.cached_jobs%rowtype; stamp timestamptz := clock_timestamp(); next_lease uuid;
begin
  if p_key is null or length(p_key) not between 1 and 256 or p_lease_seconds is null or p_lease_seconds not between 1 and 120 then raise exception 'INVALID_CACHE_INPUT'; end if;
  insert into public.cached_jobs(key) values(p_key) on conflict (key) do nothing;
  select * into job from public.cached_jobs where key = p_key for update;
  stamp := clock_timestamp();
  if job.lease_expires_at > stamp then return query select 'pending'::text, null::jsonb, null::uuid; return; end if;
  if not p_force and job.expires_at > stamp and job.value is not null then return query select 'hit'::text, job.value, null::uuid; return; end if;
  next_lease := gen_random_uuid();
  update public.cached_jobs set lease_token = next_lease, lease_expires_at = stamp + make_interval(secs => p_lease_seconds), value = null, expires_at = null, updated_at = stamp where key = p_key;
  return query select 'claimed'::text, null::jsonb, next_lease;
end $$;

create or replace function public.complete_cached_job(p_key text, p_lease uuid, p_value jsonb, p_ttl_seconds integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_value is null or p_ttl_seconds is null or p_ttl_seconds not between 1 and 604800 then raise exception 'INVALID_CACHE_INPUT'; end if;
  update public.cached_jobs set value = p_value, expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds), lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
    where key = p_key and lease_token = p_lease and lease_expires_at > clock_timestamp();
  return found;
end $$;

create or replace function public.release_cached_job(p_key text, p_lease uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.cached_jobs where key = p_key and lease_token = p_lease;
  return found;
end $$;
revoke all on function public.claim_cached_job(text, integer, boolean), public.complete_cached_job(text, uuid, jsonb, integer), public.release_cached_job(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_cached_job(text, integer, boolean), public.complete_cached_job(text, uuid, jsonb, integer), public.release_cached_job(text, uuid) to service_role;
commit;
