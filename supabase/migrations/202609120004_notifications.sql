begin;
alter table public.trip_confirmation_deliveries
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now();

create or replace function public.claim_notification_batch(p_trip_id text default null, p_limit integer default 3)
returns table(trip_id text, confirmation_version integer, response_public_id uuid, to_email text, lease_token uuid)
language plpgsql security invoker set search_path = pg_catalog as $$
declare candidate record; remaining integer := p_limit; claimed integer;
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_LIMIT'; end if;
  -- Lock trips before delivery rows, the same order used by confirm/reopen.
  for candidate in
    select t.id, t.confirmation_version from public.trips t
    where t.status = 'confirmed' and (p_trip_id is null or t.id = p_trip_id)
      and exists (select from public.trip_confirmation_deliveries d
        where d.trip_id = t.id and d.confirmation_version = t.confirmation_version and d.attempt_count < 8
          and ((d.status in ('pending','failed') and d.next_attempt_at <= clock_timestamp())
            or (d.status = 'sending' and coalesce(d.lease_expires_at, d.updated_at + interval '10 minutes') <= clock_timestamp())))
    order by t.updated_at, t.id limit p_limit for update of t skip locked
  loop
    return query with eligible as (
      select d.trip_id, d.confirmation_version, d.response_public_id
      from public.trip_confirmation_deliveries d
      where d.trip_id = candidate.id and d.confirmation_version = candidate.confirmation_version and d.attempt_count < 8
        and ((d.status in ('pending','failed') and d.next_attempt_at <= clock_timestamp())
          or (d.status = 'sending' and coalesce(d.lease_expires_at, d.updated_at + interval '10 minutes') <= clock_timestamp()))
      order by d.next_attempt_at, d.response_public_id limit remaining for update of d skip locked
    ) update public.trip_confirmation_deliveries d
      set status = 'sending', attempt_count = d.attempt_count + 1, lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp(), last_error = null
      from eligible e where d.trip_id = e.trip_id and d.confirmation_version = e.confirmation_version and d.response_public_id = e.response_public_id
      returning d.trip_id, d.confirmation_version, d.response_public_id, d.to_email, d.lease_token;
    get diagnostics claimed = row_count;
    remaining := remaining - claimed;
    exit when remaining <= 0;
  end loop;
end $$;

create or replace function public.notification_claim_is_current(p_trip_id text, p_confirmation_version integer, p_response_public_id uuid, p_lease_token uuid)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select exists (select from public.trip_confirmation_deliveries d join public.trips t on t.id = d.trip_id
    where t.id = p_trip_id and t.status = 'confirmed' and t.confirmation_version = p_confirmation_version
      and d.confirmation_version = p_confirmation_version and d.response_public_id = p_response_public_id
      and d.status = 'sending' and d.lease_token = p_lease_token and d.lease_expires_at > clock_timestamp());
$$;

create or replace function public.finish_notification(p_trip_id text, p_confirmation_version integer, p_response_public_id uuid, p_lease_token uuid, p_succeeded boolean)
returns boolean language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_succeeded is null then raise exception 'INVALID_RESULT'; end if;
  perform 1 from public.trips t where t.id = p_trip_id and t.status = 'confirmed' and t.confirmation_version = p_confirmation_version for update;
  if not found then return false; end if;
  update public.trip_confirmation_deliveries d set
    status = case when p_succeeded then 'sent' else 'failed' end,
    sent_at = case when p_succeeded then clock_timestamp() else null end,
    last_error = case when p_succeeded then null else 'delivery_failed' end,
    updated_at = clock_timestamp(), lease_token = null, lease_expires_at = null,
    next_attempt_at = clock_timestamp() + make_interval(secs => least(21600, (60 * power(2, least(d.attempt_count - 1, 9)))::integer))
  where d.trip_id = p_trip_id and d.confirmation_version = p_confirmation_version and d.response_public_id = p_response_public_id
    and d.status = 'sending' and d.lease_token = p_lease_token and d.lease_expires_at > clock_timestamp();
  return found;
end $$;

create or replace function public.release_notification_claim(p_trip_id text, p_confirmation_version integer, p_response_public_id uuid, p_lease_token uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog as $$
begin
  perform 1 from public.trips t where t.id = p_trip_id and t.status = 'confirmed' and t.confirmation_version = p_confirmation_version for update;
  if not found then return false; end if;
  update public.trip_confirmation_deliveries d set status = 'pending', attempt_count = greatest(0,d.attempt_count - 1),
    lease_token = null, lease_expires_at = null, next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where d.trip_id = p_trip_id and d.confirmation_version = p_confirmation_version and d.response_public_id = p_response_public_id
    and d.status = 'sending' and d.lease_token = p_lease_token and d.lease_expires_at > clock_timestamp();
  return found;
end $$;
revoke all on function public.release_notification_claim(text,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.release_notification_claim(text,integer,uuid,uuid) to service_role;

grant delete on public.api_rate_limit_counters to service_role;

create or replace function public.cleanup_converge_storage()
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  delete from public.cached_jobs where (expires_at < clock_timestamp() or (expires_at is null and updated_at < clock_timestamp() - interval '5 minutes')) and (lease_expires_at is null or lease_expires_at < clock_timestamp());
  delete from public.api_rate_limit_counters where updated_at < clock_timestamp() - interval '2 days';
  delete from public.ai_generation_usage where day < (clock_timestamp() at time zone 'UTC')::date - 30;
  delete from public.ai_daily_budget where day < (clock_timestamp() at time zone 'UTC')::date - 30;
end $$;

revoke all on function public.claim_notification_batch(text,integer), public.notification_claim_is_current(text,integer,uuid,uuid), public.finish_notification(text,integer,uuid,uuid,boolean), public.cleanup_converge_storage() from public, anon, authenticated;
grant execute on function public.claim_notification_batch(text,integer), public.notification_claim_is_current(text,integer,uuid,uuid), public.finish_notification(text,integer,uuid,uuid,boolean), public.cleanup_converge_storage() to service_role;

-- Preserve old RPC signatures while preventing old completions from consuming a new lease.
create or replace function public.claim_confirmation_deliveries(
  p_trip_id text,
  p_actor_key text,
  p_confirmation_version integer
)
returns table (
  result_code text,
  response_public_id uuid,
  to_email text
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  trip_status text;
  organizer_key text;
  active_version integer;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = '' or
    p_confirmation_version is null or
    p_confirmation_version < 1
  then
    return query select 'invalid_argument'::text, null::uuid, null::text;
    return;
  end if;

  select trips.status, trips.organizer_actor_key, trips.confirmation_version
  into trip_status, organizer_key, active_version
  from public.trips as trips
  where trips.id = p_trip_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text;
    return;
  end if;
  if organizer_key is null or organizer_key <> p_actor_key then
    return query select 'forbidden'::text, null::uuid, null::text;
    return;
  end if;
  if trip_status <> 'confirmed' or active_version <> p_confirmation_version then
    return query select 'conflict'::text, null::uuid, null::text;
    return;
  end if;

  return query
  with claimed as (
    update public.trip_confirmation_deliveries as deliveries
    set
      status = 'sending',
      attempt_count = deliveries.attempt_count + 1,
      last_error = null,
      updated_at = clock_timestamp()
    where
      deliveries.trip_id = p_trip_id and
      deliveries.confirmation_version = p_confirmation_version and
      deliveries.lease_token is null and deliveries.attempt_count < 8 and deliveries.next_attempt_at <= clock_timestamp() and
      (
        deliveries.status in ('pending', 'failed') or
        (
          deliveries.status = 'sending' and
          deliveries.updated_at < clock_timestamp() - interval '10 minutes'
        )
      )
    returning deliveries.response_public_id, deliveries.to_email
  )
  select
    'claimed'::text,
    claimed.response_public_id,
    claimed.to_email
  from claimed;

  if not found then
    return query select 'none'::text, null::uuid, null::text;
  end if;
end;
$$;

create or replace function public.complete_confirmation_delivery(
  p_trip_id text,
  p_actor_key text,
  p_confirmation_version integer,
  p_response_public_id uuid,
  p_succeeded boolean
)
returns table (
  result_code text
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  organizer_key text;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = '' or
    p_confirmation_version is null or
    p_confirmation_version < 1 or
    p_response_public_id is null or
    p_succeeded is null
  then
    return query select 'invalid_argument'::text;
    return;
  end if;

  select trips.organizer_actor_key
  into organizer_key
  from public.trips as trips
  where trips.id = p_trip_id;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if organizer_key is null or organizer_key <> p_actor_key then
    return query select 'forbidden'::text;
    return;
  end if;

  update public.trip_confirmation_deliveries as deliveries
  set
    status = case when p_succeeded then 'sent' else 'failed' end,
    sent_at = case when p_succeeded then clock_timestamp() else null end,
    last_error = case when p_succeeded then null else 'delivery_failed' end,
    updated_at = clock_timestamp()
  where
    deliveries.trip_id = p_trip_id and
    deliveries.confirmation_version = p_confirmation_version and
    deliveries.response_public_id = p_response_public_id and
    deliveries.status = 'sending' and deliveries.lease_token is null;

  if not found then
    return query select 'conflict'::text;
    return;
  end if;

  return query select 'completed'::text;
end;
$$;


commit;
